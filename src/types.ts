export interface MeteoraPool {
  /** Pool account address. */
  address: string;
  /** 'dlmm' | 'dammv2' */
  kind: 'dlmm' | 'dammv2';
  /** The non-SOL token mint. */
  tokenMint: string;
  /** Pool display name, e.g. "TOKEN-SOL". */
  name: string;
  /** Price in SOL per token (decimals already applied by the Meteora API). */
  priceSolPerToken: number;
  /** Pool liquidity/TVL in USD as reported by the API (used for ranking). */
  liquidityUsd: number;
}

/**
 * Event from wss://stream.pumpapi.io/ (PumpApi Data Stream).
 * The server sends *all* events (trades, creates, migrations, liquidity
 * changes, transfers...) with no subscription protocol — filtering is done
 * client-side. Amounts and reserves are in display units.
 */
export interface PumpApiEvent {
  action:
    | 'buy'
    | 'sell'
    | 'create'
    | 'createPool'
    | 'migrate'
    | 'add'
    | 'remove'
    | 'transfer'
    | string;
  signature: string;
  /** AMM/launchpad, e.g. 'pump' (bonding curve) or 'pump-amm' (PumpSwap). */
  pool?: string;
  /** 'pump' when the pool was created by a pump.fun migration; else 'custom' etc. */
  poolCreatedBy?: string;
  poolId?: string;
  mint?: string;
  /** The quote side of the pool (WSOL, USDC, ...). */
  quoteMint?: string;
  txSigner?: string;
  /** Base tokens swapped in this trade. */
  tokenAmount?: number;
  /** Quote (e.g. SOL) swapped in this trade. */
  quoteAmount?: number;
  /** Post-trade pool reserves. */
  tokensInPool?: number;
  quoteInPool?: number;
  /** Post-trade price in quote per token. */
  price?: number;
  marketCapQuote?: number;
  name?: string;
  symbol?: string;
  poolFeeRate?: number;
  burnedLiquidity?: string;
  block?: number;
  timestamp?: number;
}

/**
 * A detected arbitrage opportunity, shaped after the circular.fi arbitrage
 * opportunity standard: source/target mints, in/out pools per leg, sized
 * amounts and PnL. Published on the WS feed and kept in the REST history.
 */
export interface ArbOpportunity {
  /** Unique id for this opportunity (signature + mint based). */
  id: string;
  /** Detection time (ms since epoch) and ISO form for convenience. */
  timestamp: number;
  detectedAt: string;
  strategy: 'pumpswap-meteora-two-leg';
  /** Token being arbed. */
  sourceMint: string;
  tokenSymbol: string | null;
  /** Quote asset for both legs (WSOL). */
  targetMint: string;
  /** Buy-leg pool (PumpSwap) and sell-leg pool (Meteora), route order. */
  poolIn: string[];
  poolOut: string[];
  dexIn: string;
  dexOut: string;
  /** SOL spent on the buy leg. */
  buyAmount: number;
  /** Tokens received from the buy leg. */
  tokenAmount: number;
  /** SOL received from the sell leg. */
  sellAmount: number;
  /** Effective prices (SOL per token) and spread between the legs. */
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  priceImpactInPct: number;
  priceImpactOutPct: number;
  /** PnL in SOL: gross = sellAmount - buyAmount; arbPnl is net of costs. */
  grossPnl: number;
  arbPnl: number;
  costs: {
    jitoTipSol: number;
    priorityFeeSol: number;
    slippageBps: number;
  };
  /** Liquidity on each leg at detection time. */
  liquidity: {
    /** Sell-leg Meteora pool (from the pool cache). */
    meteora: {
      pool: string;
      kind: 'dlmm' | 'dammv2';
      name: string;
      tvlUsd: number;
    };
    /** Buy-leg PumpSwap pool and its post-trade reserves from the trigger event (display units). */
    pumpswap: {
      pool: string | null;
      tokensInPool: number | null;
      solInPool: number | null;
    };
  };
  /** The big sell that triggered detection. */
  trigger: {
    signature: string;
    sellSizeSol: number;
    txSigner: string | null;
    pumpswapPool: string | null;
  };
}

/** A buy/sell on PumpSwap (pump-amm) for a pump.fun-migrated, SOL-quoted pool. */
export interface PumpSwapTradeEvent extends PumpApiEvent {
  action: 'buy' | 'sell';
  mint: string;
  quoteAmount: number;
}
