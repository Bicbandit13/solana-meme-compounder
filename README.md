# solana-meme-compounder

A multi-agent Solana meme coin trading system designed for pump.fun detection, Jupiter execution, and automated compounding with strict risk controls.

## Overview

solana-meme-compounder is an autonomous trading framework built on the Solana blockchain. It monitors pump.fun for newly launched meme coins, evaluates them using a detection pipeline, executes trades through Jupiter Aggregator for optimal routing and slippage, and compounds realized profits back into new positions — all while enforcing per-trade and portfolio-level risk limits.

The system is composed of specialized agents that each own a discrete responsibility: detection, scoring, execution, risk enforcement, compounding logic, and PnL tracking. Agents communicate through a shared state bus and are orchestrated by a root coordinator that manages trade lifecycle from signal to settlement.

## Architecture

```
solana-meme-compounder/
├── src/
│   ├── agents/          # Agent definitions and coordinator logic
│   ├── compounding/     # Profit reinvestment and position sizing strategies
│   ├── execution/       # Jupiter swap execution, retry logic, transaction building
│   ├── risk/            # Per-trade stop-loss, drawdown limits, exposure caps
│   ├── detection/       # pump.fun token launch monitoring and scoring
│   ├── pnl/             # Real-time profit/loss tracking and reporting
│   └── utils/           # RPC helpers, wallet management, logging, config
├── docs/                # Architecture diagrams, agent specs, flow documentation
├── prompts/             # LLM prompts for agent reasoning and scoring decisions
└── flows/               # End-to-end flow definitions for trade lifecycle stages
```

## Modules

### `src/agents/`
Contains the multi-agent system core. Each agent is a self-contained module with a defined input/output contract. The `coordinator.js` orchestrates agent execution order, passes state between agents, and handles failure escalation. Agents include: `DetectionAgent`, `ScoringAgent`, `ExecutionAgent`, `RiskAgent`, and `CompoundAgent`.

### `src/detection/`
Monitors the pump.fun bonding curve program on Solana for newly created token mints. Uses WebSocket subscriptions to Solana RPC endpoints to listen for program account changes in real time. Applies heuristic filters (liquidity threshold, holder velocity, dev wallet checks) to generate a scored signal before passing to the execution pipeline.

### `src/execution/`
Handles all swap logic through the Jupiter V6 API. Builds and signs transactions using versioned transactions with address lookup tables. Implements retry logic with exponential backoff for RPC failures and slippage tolerance management. Supports priority fees (compute unit limits) to ensure landing during high-congestion periods.

### `src/risk/`
Enforces all risk controls. Defines max position size as a percentage of current wallet balance, sets per-trade stop-loss levels, tracks open exposure across all active positions, and enforces a global daily drawdown limit that halts all trading if breached. Risk parameters are configurable via environment variables.

### `src/compounding/`
Implements the profit compounding strategy. After a profitable exit, calculates the reinvestment amount based on a configurable compounding ratio (e.g., 60% of profits re-enter the next trade). Maintains a running compounded balance separate from the base wallet to track growth over time.

### `src/pnl/`
Tracks all trade entries, exits, fees, and net PnL in real time. Writes trade records to a local JSON ledger and optionally syncs to a remote endpoint. Calculates win rate, average return per trade, best/worst trade, and total compounded return since system start.

### `src/utils/`
Shared utilities: RPC connection management with fallback endpoints, wallet keypair loading from encrypted storage, structured logging with severity levels, environment config parsing, and time/slot utilities for Solana-specific timing logic.

### `docs/`
Contains architecture decision records (ADRs), agent interaction diagrams, API references for Jupiter and pump.fun program accounts, and deployment guides for running the system on a VPS or local machine.

### `prompts/`
Stores LLM prompt templates used by agents that incorporate AI-assisted reasoning — including token scoring prompts, risk evaluation prompts, and market context summarization prompts. Each prompt is versioned and documented with expected input/output format.

### `flows/`
Defines the complete lifecycle flows for each trading scenario: new token detection flow, entry execution flow, exit trigger flow, compounding flow, and emergency halt flow. Written as structured JSON or YAML for use with flow orchestration tools.

## Requirements

- Node.js 20+
- Solana wallet with SOL for transaction fees
- Helius or Triton RPC endpoint (WebSocket + HTTP)
- Jupiter V6 API access
- `.env` file with wallet path, RPC URLs, and risk parameters

## Quick Start

```bash
git clone https://github.com/Bicbandit13/solana-meme-compounder
cd solana-meme-compounder
npm install
cp .env.example .env
# Edit .env with your RPC endpoint and wallet path
npm run start
```

## Risk Disclaimer

This system trades highly volatile meme coins on Solana. All capital is at risk. The compounding module amplifies both gains and losses. Use only funds you can afford to lose entirely. This is not financial advice.

## License

MIT
