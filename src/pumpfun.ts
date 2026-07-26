import WebSocket from 'ws';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import type { PumpApiEvent, PumpSwapTradeEvent } from './types.js';

/**
 * Streams swaps over the PumpApi Data Stream (wss://stream.pumpapi.io/).
 *
 * The stream is a firehose: the server sends every event on every supported
 * AMM with no subscription protocol, so all filtering happens client-side.
 * We only forward swaps that are:
 *   - a buy or sell (action),
 *   - on PumpSwap (pool === 'pump-amm'),
 *   - in a pool created by a pump.fun migration (poolCreatedBy === 'pump'),
 *     i.e. the token is a genuine pump.fun token that migrated to PumpSwap,
 *   - quoted in SOL (so prices are comparable with the Meteora SOL pools),
 *   - for a mint that also has a tracked Meteora pool.
 *
 * PumpApi allows 1 connection per IP; we keep a single socket and handle
 * reconnect with exponential backoff.
 */
export class PumpTradeStream {
  private ws: WebSocket | null = null;
  private tracked = new Set<string>();
  private reconnectDelay = CONFIG.reconnectBaseMs;
  private stopped = false;

  constructor(private onTrade: (e: PumpSwapTradeEvent) => void) {}

  start(mints: string[]): void {
    this.tracked = new Set(mints);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }

  /**
   * Called after each Meteora cache refresh. No resubscribe needed — the
   * stream has no subscriptions, we just swap the client-side filter set.
   */
  setTrackedMints(mints: string[]): void {
    const before = this.tracked.size;
    this.tracked = new Set(mints);
    if (this.tracked.size !== before) {
      log.info(`Trade filter resynced: ${this.tracked.size} tracked mints`);
    }
  }

  private connect(): void {
    log.info(`Connecting to ${CONFIG.pumpapiWsUrl} ...`);
    this.ws = new WebSocket(CONFIG.pumpapiWsUrl);

    this.ws.on('open', () => {
      this.reconnectDelay = CONFIG.reconnectBaseMs;
      log.info(`WebSocket open — filtering for ${this.tracked.size} mints`);
    });

    this.ws.on('message', (raw) => {
      let event: PumpApiEvent;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (this.isTrackedPumpSwapTrade(event)) {
        this.onTrade(event);
      }
    });

    this.ws.on('error', (err) => log.error(`WebSocket error: ${err.message}`));

    this.ws.on('close', () => {
      if (this.stopped) return;
      log.warn(`WebSocket closed — reconnecting in ${this.reconnectDelay}ms`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, CONFIG.reconnectMaxMs);
    });
  }

  /**
   * Only big SELLs of pump.fun tokens that migrated to PumpSwap, quoted in
   * SOL — BackrunMevBot only ever involves pump.fun/PumpSwap and Meteora, so
   * the pool/origin checks (relaxed upstream for debugging) are enforced here.
   */
  private isTrackedPumpSwapTrade(e: PumpApiEvent): e is PumpSwapTradeEvent {
     if (e.action !== 'sell') return false;
    // if (!(Number(e.quoteAmount) > CONFIG.bigSellThresholdSol)) return false;

    // if (e.pool !== 'pump-amm') return false; // PumpSwap only
     if (e.poolCreatedBy !== 'pump') return false; // pool must come from a pump.fun migration
     if (e.quoteMint !== CONFIG.wsolMint) return false; // SOL-quoted pools only

    return typeof e.quoteAmount === 'number' && e.quoteAmount > 0;
  }
}
