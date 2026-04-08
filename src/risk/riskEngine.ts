import { RiskTier } from '../compounding/compoundingEngine';

/**
 * riskEngine.ts
 * 
 * Analyzes Solana meme coins for potential rug pulls and scams.
 * Scores tokens based on on-chain heuristics and behavioral patterns.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskAnalysis {
  mint: string;
  riskScore: number; // 0-100 (100 = highest risk)
  riskTier: RiskTier;
  convictionScore: number; // 0.0-1.0 (1.0 = absolute moonshot)
  flags: string[];
}

export interface TokenHeuristics {
  devWalletHoldingsPercent: number;
  liquidityAddedSecondsAgo: number;
  isLiquidityBurned: boolean;
  top10HoldersPercent: number;
  mintVelocity: number; // txs per minute
  earlyBuyerClusteringScore: number; // 0-1
  slippageProfile: number; // bps required for test swap
}

// ---------------------------------------------------------------------------
// RiskEngine
// ---------------------------------------------------------------------------

export class RiskEngine {
  
  /**
   * Main entry point for token analysis.
   * Feeds directly into CompoundingEngine for position sizing.
   */
  public analyzeToken(mint: string, heuristics: TokenHeuristics): RiskAnalysis {
    const flags: string[] = [];
    let baseScore = 0;

    // -- 1. Dev Wallet Behavior
    if (heuristics.devWalletHoldingsPercent > 10) {
      baseScore += 30;
      flags.push('HIGH_DEV_HOLDINGS');
    }

    // -- 2. Liquidity Timing
    if (heuristics.liquidityAddedSecondsAgo < 300) { // < 5 mins
      baseScore += 20;
      flags.push('VERY_NEW_LIQUIDITY');
    }
    if (!heuristics.isLiquidityBurned) {
      baseScore += 40;
      flags.push('LIQUIDITY_NOT_BURNED');
    }

    // -- 3. Top Holders / Clustering
    if (heuristics.top10HoldersPercent > 50) {
      baseScore += 15;
      flags.push('CONCENTRATED_HOLDERS');
    }
    if (heuristics.earlyBuyerClusteringScore > 0.8) {
      baseScore += 25;
      flags.push('BOT_CLUSTERING_DETECTED');
    }

    // -- 4. Slippage Profile (High slippage = honeypot risk)
    if (heuristics.slippageProfile > 1500) { // > 15%
      baseScore += 50;
      flags.push('EXTREME_SLIPPAGE_WARNING');
    }

    const riskScore = Math.min(100, baseScore);
    const riskTier = this.mapScoreToTier(riskScore);
    const convictionScore = this.calculateConviction(riskScore, heuristics);

    return {
      mint,
      riskScore,
      riskTier,
      convictionScore,
      flags
    };
  }

  /**
   * Maps risk score to CompoundingEngine tiers.
   * Lower Risk Score -> Higher Tier (more aggressive compounding)
   */
  private mapScoreToTier(score: number): RiskTier {
    if (score < 15) return 4; // High conviction, low risk
    if (score < 40) return 3;
    if (score < 70) return 2;
    return 1; // High risk, minimal exposure
  }

  /**
   * Calculates conviction score based on alpha signals.
   */
  private calculateConviction(riskScore: number, heuristics: TokenHeuristics): number {
    // Inverse of risk score is the foundation
    let conviction = (100 - riskScore) / 100;

    // Boost for high mint velocity (active trading)
    if (heuristics.mintVelocity > 50) conviction += 0.1;
    
    // Boost for burned liquidity
    if (heuristics.isLiquidityBurned) conviction += 0.1;

    // Cap at 1.0
    return Math.min(1.0, Math.max(0.1, conviction));
  }
}
