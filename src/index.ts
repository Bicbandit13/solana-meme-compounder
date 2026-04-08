import dotenv from 'dotenv';
import { Coordinator, CoordinatorConfig } from './agents/coordinator';

dotenv.config();

async function bootstrap() {
  const config: CoordinatorConfig = {
    rpcEndpoint: process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
    wsEndpoint: process.env.WS_ENDPOINT || 'wss://api.mainnet-beta.solana.com',
    maxActivePositions: parseInt(process.env.MAX_ACTIVE_POSITIONS || '5')
  };

  console.log('[Main] Initializing Solana Meme Compounder...');
  const coordinator = new Coordinator(config);

  process.on('SIGINT', async () => {
    console.log('[Main] Shutting down...');
    await coordinator.stop();
    process.exit(0);
  });

  await coordinator.start();
}

bootstrap().catch(err => {
  console.error('[Main] FATAL ERROR:', err);
  process.exit(1);
});
