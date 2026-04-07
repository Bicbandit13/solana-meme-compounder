/**
 * compoundingEngine.ts
 *
 * Core compounding logic for the Solana meme-coin multi-agent trading system.
 * Manages three isolated balance vaults and routes capital based on trade
 * conviction and risk-tier multipliers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskTier = 1 | 2 | 3 | 4;

export interface TradeRecord {
  tradeId: string;
  principalUsed: number;
  profit: number;
  convictionScore: number; // 0.0 – 1.0
  riskTier: RiskTier;
  reinvestmentAmount: number;
  extractionAmount: number;
  timestamp: number;
}

export interface VaultSnapshot {
  principalVault: number;
  reinvestmentPool: number;
  extractionBucket: number;
  totalEquity: number;
}

export interface CapitalAllocation {
  maxTradeSize: number;
  availableFromPrincipal: number;
  availableFromReinvestment: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RISK_TIER_MULTIPLIERS: Record<RiskTier, number> = {
  1: 0.25,
  2: 1.0,
  3: 2.0,
  4: 5.0,
} as const;

/**
 * Maximum fraction of the reinvestmentPool that can be deployed per trade,
 * per risk tier. Prevents the pool from being fully drained in one position.
 */
const MAX_REINVESTMENT_DEPLOY_RATIO: Record<RiskTier, number> = {
  1: 0.10, // 10 % of reinvestmentPool per trade
  2: 0.20,
  3: 0.35,
  4: 0.50,
} as const;

/**
 * Maximum fraction of principalVault deployable per trade per tier.
 * Tier 4 is deliberately capped low to protect principal.
 */
const MAX_PRINCIPAL_DEPLOY_RATIO: Record<RiskTier, number> = {
  1: 0.05,
  2: 0.10,
  3: 0.15,
  4: 0.20,
} as const;

// ---------------------------------------------------------------------------
// CompoundingEngine
// ---------------------------------------------------------------------------

export class CompoundingEngine {
  // -- Vault balances (always >= 0) -----------------------------------------
  private principalVault: number;
  private reinvestmentPool: number;
  private extractionBucket: number;

  // -- Audit trail -----------------------------------------------------------
  private readonly tradeHistory: TradeRecord[] = [];

  // -- Pending-route queue ---------------------------------------------------
  // Funds queued by recordTradeResult() and flushed by routeFunds().
  private pendingPrincipalReturn: number = 0;
  private pendingReinvestment: number = 0;
  private pendingExtraction: number = 0;

  constructor(
    initialPrincipal: number = 0,
    initialReinvestment: number = 0,
    initialExtraction: number = 0,
  ) {
    if (initialPrincipal < 0 || initialReinvestment < 0 || initialExtraction < 0) {
      throw new RangeError('Initial vault balances must be non-negative.');
    }
    this.principalVault = initialPrincipal;
    this.reinvestmentPool = initialReinvestment;
    this.extractionBucket = initialExtraction;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Records the outcome of a completed trade.
   *
   * - Principal is ALWAYS returned to principalVault in full.
   * - Only the profit portion may enter reinvestmentPool.
   * - Any profit not reinvested flows to extractionBucket.
   *
   * Funds are queued here; call routeFunds() to commit them to the vaults.
   *
   * @param tradeId        Unique identifier for the trade (e.g. transaction sig).
   * @param principalUsed  Amount of capital put at risk (must be > 0).
   * @param profit         Realised P&L (can be negative for a loss).
   * @param convictionScore Normalised conviction in [0, 1].
   * @param riskTier       Risk tier 1–4 determining multiplier aggressiveness.
   */
  public recordTradeResult(
    tradeId: string,
    principalUsed: number,
    profit: number,
    convictionScore: number,
    riskTier: RiskTier,
  ): TradeRecord {
    this.validateTradeInputs(tradeId, principalUsed, convictionScore, riskTier);

    const reinvestmentAmount = this.calculateReinvestmentAmount(
      profit,
      convictionScore,
      riskTier,
    );

    // Extraction = whatever profit is NOT reinvested.
    // On a loss (profit < 0), reinvestmentAmount is 0 and extraction is also 0;
    // the loss is absorbed by the principal return being smaller.
    const profitForExtraction = Math.max(0, profit);
    const extractionAmount = profitForExtraction - reinvestmentAmount;

    // Queue amounts for routeFunds().
    this.pendingPrincipalReturn += principalUsed;
    this.pendingReinvestment += reinvestmentAmount;
    this.pendingExtraction += extractionAmount;

    const record: TradeRecord = {
      tradeId,
      principalUsed,
      profit,
      convictionScore,
      riskTier,
      reinvestmentAmount,
      extractionAmount,
      timestamp: Date.now(),
    };

    this.tradeHistory.push(record);
    return record;
  }

  /**
   * Calculates the amount of profit to reinvest using the formula:
   *
   *   reinvest = profit * convictionScore * riskTierMultiplier
   *
   * Result is clamped to [0, profit] — you can never reinvest more than
   * the actual profit, and losses are never pushed to the reinvestment pool.
   *
   * @param profit          Realised profit (SOL / USD / lamports — caller's unit).
   * @param convictionScore Normalised conviction score in [0, 1].
   * @param riskTier        Risk tier 1–4.
   * @returns               Amount to route into reinvestmentPool.
   */
  public calculateReinvestmentAmount(
    profit: number,
    convictionScore: number,
    riskTier: RiskTier,
  ): number {
    if (profit <= 0) return 0; // losses never enter the reinvestment pool

    const multiplier = RISK_TIER_MULTIPLIERS[riskTier];
    const raw = profit * convictionScore * multiplier;

    // Clamp: cannot reinvest more than total profit.
    return Math.min(raw, profit);
  }

  /**
   * Commits all pending fund movements to the three vaults.
   *
   * Must be called after one or more recordTradeResult() calls to finalise
   * the bookkeeping. Designed to be idempotent — calling it with nothing
   * pending is a no-op.
   *
   * @returns A snapshot of vault balances after routing.
   */
  public routeFunds(): VaultSnapshot {
    // Commit queued amounts.
    this.principalVault += this.pendingPrincipalReturn;
    this.reinvestmentPool += this.pendingReinvestment;
    this.extractionBucket += this.pendingExtraction;

    // Reset queue.
    this.pendingPrincipalReturn = 0;
    this.pendingReinvestment = 0;
    this.pendingExtraction = 0;

    return this.getVaultSnapshot();
  }

  /**
   * Returns the maximum capital available for a new trade at the given tier.
   *
   * Capital is sourced from two pools:
   *  1. principalVault  — bounded by MAX_PRINCIPAL_DEPLOY_RATIO[riskTier]
   *  2. reinvestmentPool — bounded by MAX_REINVESTMENT_DEPLOY_RATIO[riskTier]
   *
   * The combined total is the effective ceiling for the next trade at that tier.
   *
   * @param riskTier Risk tier 1–4.
   * @returns        Detailed breakdown of available capital.
   */
  public getAvailableCapitalForTrade(riskTier: RiskTier): CapitalAllocation {
    const availableFromPrincipal =
      this.principalVault * MAX_PRINCIPAL_DEPLOY_RATIO[riskTier];

    const availableFromReinvestment =
      this.reinvestmentPool * MAX_REINVESTMENT_DEPLOY_RATIO[riskTier];

    return {
      availableFromPrincipal,
      availableFromReinvestment,
      maxTradeSize: availableFromPrincipal + availableFromReinvestment,
    };
  }

  // ---------------------------------------------------------------------------
  // Read-only helpers
  // ---------------------------------------------------------------------------

  /** Returns a point-in-time snapshot of all vault balances. */
  public getVaultSnapshot(): VaultSnapshot {
    return {
      principalVault: this.principalVault,
      reinvestmentPool: this.reinvestmentPool,
      extractionBucket: this.extractionBucket,
      totalEquity:
        this.principalVault + this.reinvestmentPool + this.extractionBucket,
    };
  }

  /** Immutable copy of every trade recorded in this session. */
  public getTradeHistory(): ReadonlyArray<TradeRecord> {
    return Object.freeze([...this.tradeHistory]);
  }

  /** Total realised profit across all recorded trades. */
  public getTotalRealisedProfit(): number {
    return this.tradeHistory.reduce((sum, t) => sum + t.profit, 0);
  }

  /** Total capital ever deployed across all recorded trades. */
  public getTotalDeployedCapital(): number {
    return this.tradeHistory.reduce((sum, t) => sum + t.principalUsed, 0);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validateTradeInputs(
    tradeId: string,
    principalUsed: number,
    convictionScore: number,
    riskTier: RiskTier,
  ): void {
    if (!tradeId || tradeId.trim().length === 0) {
      throw new TypeError('tradeId must be a non-empty string.');
    }
    if (principalUsed <= 0) {
      throw new RangeError(`principalUsed must be > 0 (got ${principalUsed}).`);
    }
    if (convictionScore < 0 || convictionScore > 1) {
      throw new RangeError(
        `convictionScore must be in [0, 1] (got ${convictionScore}).`,
      );
    }
    if (!(riskTier in RISK_TIER_MULTIPLIERS)) {
      throw new RangeError(`riskTier must be 1–4 (got ${riskTier}).`);
    }
  }
}
