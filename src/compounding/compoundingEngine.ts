/**
 * compoundingEngine.ts
 *
 * Core compounding logic for the Solana meme-coin multi-agent trading system.
 * Manages isolated balance vaults and routes capital based on trade conviction and risk-tier multipliers.
 * Ensures the primary principal vault remains untouched by compounding losses.
 */

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

export class CompoundingEngine {
  private principalVault: number;
  private reinvestmentPool: number = 0;
  private extractionBucket: number = 0;
  private trades: TradeRecord[] = [];

  // Configuration for risk-tier gated reinvestment scaling
  // Higher tiers (Riskier) extract more profit and reinvest less.
  private readonly TIER_CONFIG = {
    1: { reinvest: 0.8, extract: 0.2 }, // Low risk: Reinvest 80%
    2: { reinvest: 0.6, extract: 0.4 }, // Mid risk: Reinvest 60%
    3: { reinvest: 0.4, extract: 0.6 }, // High risk: Reinvest 40%
    4: { reinvest: 0.2, extract: 0.8 }, // Ultra risk: Reinvest 20%
  };

  constructor(initialPrincipal: number) {
    this.principalVault = initialPrincipal;
  }

  /**
   * Routes profits into reinvestment or extraction based on risk tier.
   * Principal is ALWAYS returned to the principal vault first.
   */
  public routeProfits(tradeId: string, totalReturned: number, principalUsed: number, riskTier: RiskTier, convictionScore: number): void {
    const profit = totalReturned - principalUsed;

    // Return principal to vault immediately. Principal logic is isolated.
    this.principalVault += principalUsed;

    if (profit > 0) {
      const { reinvest, extract } = this.TIER_CONFIG[riskTier];
      
      // Scaling reinvestment based on conviction score
      const reinvestmentAmount = profit * reinvest * convictionScore;
      const extractionAmount = profit - reinvestmentAmount;

      this.reinvestmentPool += reinvestmentAmount;
      this.extractionBucket += extractionAmount;

      this.trades.push({
        tradeId,
        principalUsed,
        profit,
        convictionScore,
        riskTier,
        reinvestmentAmount,
        extractionAmount,
        timestamp: Date.now(),
      });
    } else {
      // Logic for losses: Compounding losses only affect the reinvestment pool.
      // If reinvestment pool is insufficient, the loss is tracked as 'reinvestment debt'.
      // Principal vault is NEVER touched to cover losses from compounding trades.
      this.reinvestmentPool += profit; 
      
      this.trades.push({
        tradeId,
        principalUsed,
        profit,
        convictionScore,
        riskTier,
        reinvestmentAmount: 0,
        extractionAmount: 0,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Calculates allowed trade size. 
   * Entries are gated by the reinvestment pool size for compounding.
   */
  public getAllocation(riskTier: RiskTier, convictionScore: number): CapitalAllocation {
    const basePrincipalSize = this.principalVault * 0.02; // 2% principal risk per trade
    const reinvestmentBonus = Math.max(0, this.reinvestmentPool * convictionScore);

    return {
      maxTradeSize: basePrincipalSize + reinvestmentBonus,
      availableFromPrincipal: basePrincipalSize,
      availableFromReinvestment: reinvestmentBonus,
    };
  }

  public getVaultSnapshot(): VaultSnapshot {
    return {
      principalVault: this.principalVault,
      reinvestmentPool: this.reinvestmentPool,
      extractionBucket: this.extractionBucket,
      totalEquity: this.principalVault + this.reinvestmentPool + this.extractionBucket,
    };
  }
}
