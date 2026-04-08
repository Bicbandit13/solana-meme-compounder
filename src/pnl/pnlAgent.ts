import { EventEmitter } from 'events';
import { CompoundingEngine, RiskTier } from '../compounding/compoundingEngine';

/**
 * pnlAgent.ts
 * 
 * Specialized PnL tracking agent for Solana meme coins.
 * Monitors open positions, calculates unrealized gains, and triggers
 * partial exits + compounding events at fixed profit thresholds (2x, 3x, 5x).
 * Logic is streamlined to ensure accurate threshold detection and event emission.
 */

export interface Position {
  mint: string;
  entryPrice: number; // relative to SOL
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
  riskTier: RiskTier;
  convictionScore: number;
}

export class PnLAgent extends EventEmitter {
  private openPositions: Map<string, Position> = new Map();
  private compoundingEngine: CompoundingEngine;

  constructor(compoundingEngine: CompoundingEngine) {
    super();
    this.compoundingEngine = compoundingEngine;
  }

  /**
   * Tracks a new open position.
   */
  public trackPosition(position: Position): void {
    this.openPositions.set(position.mint, {
      ...position,
      lastThresholdHit: 1 // Start at 1x (entry)
    });
  }

  /**
   * Evaluates current price against entry for threshold triggers.
   */
  public updatePnL(mint: string, currentPrice: number): PnLUpdate | null {
    const position = this.openPositions.get(mint);
    if (!position) return null;

    const unrealizedPercent = (currentPrice / position.entryPrice);
    const unrealizedPnL = (currentPrice * position.amount) - position.initialPrincipal;

    this.checkThresholds(position, currentPrice, unrealizedPercent);

    return {
      mint,
      unrealizedPnL,
      unrealizedPercent,
      currentPrice
    };
  }

  /**
   * Core logic for threshold-based partial exits.
   * Emits events that the CompoundingEngine listens for to route profits.
   */
  private checkThresholds(position: Position, currentPrice: number, multiplier: number): void {
    const thresholds = [2, 3, 5];
    
    for (const threshold of thresholds) {
      if (multiplier >= threshold && position.lastThresholdHit < threshold) {
        // Calculate partial exit size (e.g., 50% of current holding on 2x)
        const exitPercentage = 0.5; 
        const amountToSell = position.amount * exitPercentage;
        const profitRealized = (amountToSell * currentPrice) - (position.initialPrincipal * exitPercentage);

        const event: ThresholdEvent = {
          mint: position.mint,
          threshold,
          profitRealized,
          riskTier: position.riskTier,
          convictionScore: position.convictionScore
        };

        this.emit('thresholdHit', event);
        
        // Update position state: reduce amount and mark threshold as hit
        position.amount -= amountToSell;
        position.lastThresholdHit = threshold;

        // Route profit to CompoundingEngine (Principal is handled here too)
        this.compoundingEngine.routeProfits(
          `${position.mint}-${threshold}x`,
          amountToSell * currentPrice,
          position.initialPrincipal * exitPercentage,
          position.riskTier,
          position.convictionScore
        );
      }
    }
  }

  public getOpenPositions(): Position[] {
    return Array.from(this.openPositions.values());
  }
}
