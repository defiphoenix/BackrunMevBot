export const CONFIG = {
  /**
   * PumpApi public Data Stream (free, no API key). Sends *all* events —
   * filtering happens client-side. Strict limit: 1 connection per IP.
   */
  pumpapiWsUrl: 'wss://stream.pumpapi.io/',

  /** Meteora public data APIs (unified datapi; old *-api.meteora.ag hosts are gone). */
  meteoraDlmmApi: 'https://dlmm.datapi.meteora.ag',
  meteoraDammV2Api: 'https://damm-v2.datapi.meteora.ag',

  /**
   * Stop paging the pool list once TVL drops below this (USD). The datapi
   * has no token filter and ~120k pools per program, so we page sorted by
   * TVL descending and cut off where pools are too shallow to arb anyway.
   */
  minPoolTvlUsd: Number(process.env.MIN_POOL_TVL_USD ?? 500),

  /** Wrapped SOL mint — pools must be paired against SOL to compare prices. */
  wsolMint: 'So11111111111111111111111111111111111111112',

  /**
   * Trigger threshold: a pump.fun SELL of more than this many SOL. Higher
   * than the multi-strategy bot's default (10) — BackrunMevBot only backruns
   * large sells, where the post-trade price dislocation is big enough to
   * clear a single-hop PumpSwap -> Meteora spread after fees.
   */
  bigSellThresholdSol: Number(process.env.BIG_SELL_THRESHOLD_SOL ?? 8),

  /**
   * SOL to spend per arb trade (PumpSwap buy leg). Hard floor of 0.5 SOL —
   * smaller sizes aren't worth the fees.
   */
  tradeAmountSol: Math.max(0.25, Number(process.env.TRADE_AMOUNT_SOL ?? 0.25)),

  /** Minimum NET profit (SOL, after fees/slippage/tips) before an opportunity is logged/acted on. */
  minProfitSol: Number(process.env.MIN_PROFIT_SOL ?? 0.0001),

  /** PumpSwap LP + protocol fee on the buy leg (bps of SOL in). Default 25 bps = 0.25%. */
  pumpswapFeeBps: Number(process.env.PUMPSWAP_FEE_BPS ?? 25),

  /** Meteora pool trade fee on the sell leg (bps). DAMM v2/DLMM fees vary; 200 bps is a conservative default. */
  meteoraFeeBps: Number(process.env.METEORA_FEE_BPS ?? 200),

  /** Extra slippage haircut on the Meteora sell leg (bps) — price impact + staleness of the quoted spot price. */
  slippageBps: Number(process.env.SLIPPAGE_BPS ?? 100),

  /**
   * Single Jupiter quote API endpoint — no connection pool / rotation.
   * Defaults to the standard Jupiter API (lite tier, or api.jup.ag when
   * JUPITER_API_KEY is set). Override with JUPITER_QUOTE_API if needed.
   */
  jupiterQuoteApi: (
    process.env.JUPITER_QUOTE_API ??
    (process.env.JUPITER_API_KEY ? 'https://api.jup.ag/swap/v1' : 'https://lite-api.jup.ag/swap/v1')
  )
    .trim()
    // Normalize: drop a trailing slash and a trailing /quote (the client
    // appends /quote itself), so a URL pasted in either form works.
    .replace(/\/+$/, '')
    .replace(/\/quote$/, ''),

  /** Jupiter API key (pro tier). When set, quotes go to api.jup.ag with the x-api-key header. */
  jupiterApiKey: process.env.JUPITER_API_KEY ?? '',

  /**
   * Min gap between Jupiter quote requests per endpoint (ms). Lite tier is
   * ~1 req/s per IP, so default 1100 ms; set to 0 (or lower) on the pro tier.
   */
  jupiterMinRequestGapMs: Number(
    process.env.JUPITER_MIN_REQUEST_GAP_MS ?? (process.env.JUPITER_API_KEY ? 0 : 1100),
  ),

  /**
   * Drop a queued/retrying quote request once it's older than this (ms) —
   * a quote priced off seconds-old state is worse than no quote for an arb.
   */
  jupiterQuoteMaxAgeMs: Number(process.env.JUPITER_QUOTE_MAX_AGE_MS ?? 5000),

  /**
   * Restrict Jupiter routing per leg to exactly one DEX label each — fixed,
   * not env-overridable, since BackrunMevBot must only ever touch pump.fun
   * (PumpSwap) and Meteora. arb.ts additionally rejects any quote that isn't
   * a single hop on these labels.
   */
  jupiterBuyDexes: 'Pump.fun Amm',
  jupiterSellDexes: 'Meteora DLMM,Meteora DAMM v2',

  /** Token decimals for base-unit conversion (pump.fun tokens are always 6). */
  tokenDecimals: Number(process.env.TOKEN_DECIMALS ?? 6),

  /** Jito tip per bundle (SOL). */
  jitoTipSol: Number(process.env.JITO_TIP_SOL ?? 0.0001),

  /** Priority fee + base tx fee budget for both legs (SOL). */
  priorityFeeSol: Number(process.env.PRIORITY_FEE_SOL ?? 0.0001),

  /** How often to re-fetch the full Meteora pool list (ms). */
  poolRefreshIntervalMs: Number(process.env.POOL_REFRESH_MS ?? 10 * 60 * 1000),

  /**
   * Max number of mints to watch on the trade stream, taken from the
   * highest-liquidity Meteora pools first. Filtering is client-side (the
   * stream is a firehose), so this only bounds Meteora paging/memory.
   */
  maxTrackedMints: Number(process.env.MAX_TRACKED_MINTS ?? 10),

  /** WebSocket reconnect backoff (ms). */
  reconnectBaseMs: 1000,
  reconnectMaxMs: 30000,

  /** Port for the Express API + WS opportunity feed. */
  apiPort: Number(process.env.API_PORT ?? 8080),

  /** How many recent opportunities to keep for GET /opportunities. */
  opportunityHistorySize: Number(process.env.OPPORTUNITY_HISTORY_SIZE ?? 500),

  /** Optional file to append opportunity logs to (empty = console only). */
  logFile: process.env.LOG_FILE ?? 'opportunities.log',
};
