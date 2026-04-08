import { EventEmitter } from 'events';
import { CompoundingEngine, RiskTier } from '../compounding/compoundingEngine';

/**
 * pnlAgent.ts
 * 
 * Specialized PnL tracking agent for Solana meme coins.
 * Monitors open positions, calculates unrealized gains, and triggers
 * partial exits + compounding events at fixed profit thresholds (2x, 3x, 5x).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Position {
  mint: string;
  entryPrice: number; // in lamports or price relative to SOL
  amount: number;
  initialPrincipal: number; // SOL spent
  riskTier: RiskTier;
  convictionScore: number;
  lastThresholdHit: number; // 1, 2, 3, or 5 (multiplier)
}

export interface PnLUpdate {
  mint: string;
  unrealizedPnL: number;
  unrealizedPercent: number;
  currentPrice: number;
}

export interface ThresholdEvent {
  mint: string;
  threshold: number; // 2, 3, 5
  profitRealized: number;
  remainingAmount: number;
}

// ---------------------------------------------------------------------------
// PnLAgent
// ---------------------------------------------------------------------------

export class PnLAgent extends EventEmitter {
  private positions: Map<string, Position> = new Map();
  private realizedPnL: number = 0;
  private totalTrades: number = 0;

  constructor(private compoundingEngine: CompoundingEngine) {
    super();
  }

  /**
   * Registers a new open position.
   */
  public openPosition(
    mint: string,
    entryPrice: number,
    amount: number,
    initialPrincipal: number,
    riskTier: RiskTier,
    convictionScore: number
  ): void {
    const position: Position = {
      mint,
      entryPrice,
      amount,
      initialPrincipal,
      riskTier,
      convictionScore,
      lastThresholdHit: 1
    };

    this.positions.set(mint, position);
    this.emit('positionOpened', position);
  }

  /**
   * Updates the current price for a token and checks thresholds.
   * This should be called by a price feed or monitoring loop.
   */
  public updatePrice(mint: string, currentPrice: number): PnLUpdate | null {
    const pos = this.positions.get(mint);
    if (!pos) return null;

    const multiplier = currentPrice / pos.entryPrice;
    const currentVal = pos.amount * currentPrice;
    const unrealizedPnL = currentVal - pos.initialPrincipal;
    const unrealizedPercent = (multiplier - 1) * 100;

    this.checkThresholds(pos, multiplier, currentPrice);

    return {
      mint,
      unrealizedPnL,
      unrealizedPercent,
      currentPrice
    };
  }

  /**
   * Internal logic to check 2x, 3x, 5x thresholds.
   */
  private checkThresholds(pos: Position, currentMultiplier: number, currentPrice: number): void {
    const thresholds = [5, 3, 2];
    
    for (const t of thresholds) {
      if (currentMultiplier >= t && pos.lastThresholdHit < t) {
        this.handleThresholdHit(pos, t, currentPrice);
        break; // Only hit one threshold per update
      }
    }
  }

  /**
   * Handles profit taking at a threshold.
   * Logic: Sell a portion of the position, realize profit, send to compounding.
   */
  private handleThresholdHit(pos: Position, threshold: number, currentPrice: number): void {
    // Strategy: Sell 25% of the ORIGINAL amount at 2x, 3x, 5x
    const sellRatio = 0.25;
    const amountToSell = pos.amount * sellRatio;
    
    // In a real system, this would trigger an actual swap via Jupiter/Raydium
    // Here we calculate the resulting profit for the CompoundingEngine
    const proceeds = amountToSell * currentPrice;
    
    // Calculate fractional principal and profit for this partial sell
    const principalPortion = pos.initialPrincipal * sellRatio;
    const profit = proceeds - principalPortion;

    // Record result in compounding engine
    const record = this.compoundingEngine.recordTradeResult(
      `threshold-${threshold}-${pos.mint}-${Date.now()}`,
      principalPortion,
      profit,
      pos.convictionScore,
      pos.riskTier
    );

    // Commit the funds immediately
    this.compoundingEngine.routeFunds();

    // Update internal state
    this.realizedPnL += profit;
    pos.amount -= amountToSell;
    pos.lastThresholdHit = threshold;

    const event: ThresholdEvent = {
      mint: pos.mint,
      threshold,
      profitRealized: profit,
      remainingAmount: pos.amount
    };

    this.emit('thresholdHit', event);
    this.emit('profitRealized', record);

    // If it's a 5x, maybe close the whole thing? 
    // For now, just keep the remainder running.
  }

  /**
   * Closes a position entirely (e.g., stop loss or manual exit).
   */
  public closePosition(mint: string, exitPrice: number): void {
    const pos = this.positions.get(mint);
    if (!pos) return;

    const proceeds = pos.amount * exitPrice;
    const profit = proceeds - pos.initialPrincipal;

    this.compoundingEngine.recordTradeResult(
      `close-${mint}-${Date.now()}`,
      pos.initialPrincipal,
      profit,
      pos.convictionScore,
      pos.riskTier
    );
    this.compoundingEngine.routeFunds();

    this.realizedPnL += profit;
    this.totalTrades++;
    this.positions.delete(mint);

    this.emit('positionClosed', { mint, profit });
  }

  public getStats() {
    return {
      openPositions: this.positions.size,
      totalRealizedPnL: this.realizedPnL,
      activeMints: Array.from(this.positions.keys())
    };
  }
}
