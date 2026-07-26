import { CONFIG } from './config.js';
import { log } from './logger.js';
import { MeteoraPoolCache } from './meteora.js';
import { PumpTradeStream } from './pumpfun.js';
import { ArbDetector } from './arb.js';
import { OpportunityServer } from './server.js';

async function main(): Promise<void> {
  log.info('BackrunMevBot starting');
  log.info(
    `detector=single-hop backrun (PumpSwap -> Meteora only) | ` +
      `threshold=sells > ${CONFIG.bigSellThresholdSol} SOL | ` +
      `tradeSize=${CONFIG.tradeAmountSol} SOL | ` +
      `minProfit=${CONFIG.minProfitSol} SOL | ` +
      `poolRefresh=every ${CONFIG.poolRefreshIntervalMs / 60000} min | ` +
      `maxTrackedMints=${CONFIG.maxTrackedMints}`,
  );

  const meteora = new MeteoraPoolCache();
  const server = new OpportunityServer();

  // Single detector: single-hop PumpSwap -> Meteora backrun (requires a
  // cached Meteora pool and a single-hop route on each leg).
  const detector = new ArbDetector(meteora, server);
  const stream = new PumpTradeStream((e) => {
    detector.onTrade(e).catch((err) => log.error(`trade handler failed: ${err}`));
  });

  // 1. Fetch + cache all Meteora pools (and refresh on an interval).
  await meteora.start(() => stream.setTrackedMints(meteora.trackedMints()));

  // 2. Stream pump.fun trades for every token that has a Meteora pool.
  stream.start(meteora.trackedMints());

  // 3. Publish opportunities over HTTP + WS.
  server.start();

  const shutdown = () => {
    log.info('Shutting down');
    stream.stop();
    meteora.stop();
    server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error(`Fatal: ${err?.stack ?? err}`);
  process.exit(1);
});
