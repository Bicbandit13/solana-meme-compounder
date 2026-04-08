import { Connection } from '@solana/web3.js';
import { PumpFunWatcher, TokenSignal } from '../detection/pumpFunWatcher';
import { RiskEngine, RiskAnalysis, TokenHeuristics } from '../risk/riskEngine';
import { JupiterExecutor, SwapQuote, ExecutionResult } from '../execution/jupiterExecutor';
import { CompoundingEngine, RiskTier } from '../compounding/compoundingEngine';
import { PnLAgent, ThresholdEvent } from '../pnl/pnlAgent';

export interface CoordinatorConfig {
  rpcEndpoint: string;
  wsEndpoint: string;
  maxActivePositions: number;
}

/**
 * Coordinator
 * 
 * Orchestrates the full lifecycle of a trade by connecting multiple agents:
 * 1. Detection (PumpFunWatcher)
 * 2. Scoring (RiskEngine)
 * 3. Position Sizing (CompoundingEngine)
 * 4. Execution (JupiterExecutor)
 * 5. Monitoring (PnLAgent)
 */
export class Coordinator {
  private watcher: PumpFunWatcher;
  private riskEngine: RiskEngine;
  private executor: JupiterExecutor;
  private compoundingEngine: CompoundingEngine;
  private pnlAgent: PnLAgent;
  private activePositionsCount: number = 0;

  constructor(private config: CoordinatorConfig) {
    this.compoundingEngine = new CompoundingEngine(1.0, 0.0, 0.0);
    this.watcher = new PumpFunWatcher({
      rpcEndpoint: config.rpcEndpoint,
      wsEndpoint: config.wsEndpoint,
      minLiquidityThreshold: 10,
      maxDevHoldingPercentage: 10,
      enableHeuristics: true
    });
    this.riskEngine = new RiskEngine();
    this.executor = new JupiterExecutor({
      rpcEndpoint: config.rpcEndpoint,
      maxSlippageBps: 200,
      priorityFeeLamports: 100000
    });
    this.pnlAgent = new PnLAgent(this.compoundingEngine);
    this.setupListeners();
  }

  public async start(): Promise<void> {
    console.log('[Coordinator] System active. Monitoring Pump.fun...');
    await this.watcher.start();
  }

  public async stop(): Promise<void> {
    await this.watcher.stop();
    console.log('[Coordinator] System dormant.');
  }

  private setupListeners(): void {
    this.watcher.on('tokenDetected', async (signal: TokenSignal) => {
      if (this.activePositionsCount >= this.config.maxActivePositions) return;

      const mockHeuristics: TokenHeuristics = {
        devWalletHoldingsPercent: 5,
        liquidityAddedSecondsAgo: 60,
        isLiquidityBurned: true,
        top10HoldersPercent: 30,
        mintVelocity: 10,
        earlyBuyerClusteringScore: 0.2,
        slippageProfile: 500
      };

      const analysis: RiskAnalysis = this.riskEngine.analyzeToken(signal.mint, mockHeuristics);

      if (analysis.riskTier >= 2) {
        const allocation = this.compoundingEngine.getAvailableCapitalForTrade(analysis.riskTier);
        const amountToSpend = allocation.maxTradeSize;

        if (amountToSpend <= 0) return;

        try {
          const quote = await this.executor.getQuote(
            'So11111111111111111111111111111111111111112',
            signal.mint,
            amountToSpend
          );
          const result = await this.executor.executeSwap(quote);

          if (result.success) {
            this.pnlAgent.openPosition(
              signal.mint,
              1, 
              result.outputAmount,
              amountToSpend,
              analysis.riskTier,
              analysis.convictionScore
            );
            this.activePositionsCount++;
          }
        } catch (error) {
          console.error(`[Coordinator] FAILED to open position for ${signal.mint}:`, error);
        }
      }
    });

    this.pnlAgent.on('thresholdHit', async (event: ThresholdEvent) => {
      console.log(`[Coordinator] ALERT: ${event.threshold}x hit for ${event.mint}! Realizing profit...`);
    });

    this.pnlAgent.on('positionClosed', (data) => {
      this.activePositionsCount--;
    });
  }
}
