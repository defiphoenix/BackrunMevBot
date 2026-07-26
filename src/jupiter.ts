import { CONFIG } from './config.js';
import { log } from './logger.js';

export interface JupiterRouteLeg {
  /** Pool (AMM) account address of this leg. */
  ammKey: string;
  /** DEX label, e.g. "Meteora DLMM". */
  label: string;
  /** Mints and amounts (base units, as returned by Jupiter) swapped on this leg. */
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
}

export interface JupiterQuote {
  /** Output amount in UI units (SOL for sell quotes, tokens for buy quotes). */
  outAmountUi: number;
  /** Price impact of the route in percent. */
  priceImpactPct: number;
  /** Route summary, e.g. "Meteora DLMM" or "Pump.fun Amm". */
  route: string;
  /** Pool (AMM) account addresses along the route, in hop order. */
  ammKeys: string[];
  /** Full per-pool route breakdown (Jupiter routePlan). No reserve data —
   *  the quote API does not expose pool reserves, only per-leg amounts. */
  legs: JupiterRouteLeg[];
}

const SOL_DECIMALS = 9;

/**
 * Single Jupiter endpoint, no connection pool — every quote request is
 * serialized through one throttle with at least CONFIG.jupiterMinRequestGapMs
 * between requests.
 */
const headers: Record<string, string> =
  CONFIG.jupiterApiKey && CONFIG.jupiterQuoteApi.includes('api.jup.ag')
    ? { 'x-api-key': CONFIG.jupiterApiKey }
    : {};

let throttleTail: Promise<void> = Promise.resolve();
let nextSlotAt = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const slot = Math.max(nextSlotAt, Date.now());
  nextSlotAt = slot + CONFIG.jupiterMinRequestGapMs;
  const run = throttleTail.then(async () => {
    const wait = slot - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return fn();
  });
  throttleTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Quote buying `mint` with `solAmountUi` SOL, routed through PumpSwap only
 * (CONFIG.jupiterBuyDexes) so it prices the PumpSwap buy leg of the arb.
 */
export function fetchBuyQuote(mint: string, solAmountUi: number): Promise<JupiterQuote | null> {
  return fetchQuote({
    inputMint: CONFIG.wsolMint,
    outputMint: mint,
    amountUi: solAmountUi,
    inDecimals: SOL_DECIMALS,
    outDecimals: CONFIG.tokenDecimals,
    dexes: CONFIG.jupiterBuyDexes,
  });
}

/**
 * Quote selling `tokenAmountUi` of `mint` into SOL, routed through Meteora
 * only (CONFIG.jupiterSellDexes) so it prices the Meteora sell leg.
 */
export function fetchSellQuote(mint: string, tokenAmountUi: number): Promise<JupiterQuote | null> {
  return fetchQuote({
    inputMint: mint,
    outputMint: CONFIG.wsolMint,
    amountUi: tokenAmountUi,
    inDecimals: CONFIG.tokenDecimals,
    outDecimals: SOL_DECIMALS,
    dexes: CONFIG.jupiterSellDexes,
  });
}

/**
 * ExactIn quote via the Jupiter quote API. The returned outAmount already
 * includes DEX fees and price impact. Returns null on any failure so the
 * caller can fall back to its own estimate.
 */
async function fetchQuote(opts: {
  inputMint: string;
  outputMint: string;
  amountUi: number;
  inDecimals: number;
  outDecimals: number;
  dexes: string;
}): Promise<JupiterQuote | null> {
  const amountBase = Math.floor(opts.amountUi * 10 ** opts.inDecimals);
  if (!(amountBase > 0)) return null;

  const params = new URLSearchParams({
    inputMint: opts.inputMint,
    outputMint: opts.outputMint,
    amount: String(amountBase),
    slippageBps: String(CONFIG.slippageBps),
    swapMode: 'ExactIn',
  });
  if (opts.dexes) params.set('dexes', opts.dexes);

  try {
    const q: any = await fetchQuoteJson(params);

    const outAmount = Number(q.outAmount);
    if (!isFinite(outAmount) || outAmount <= 0) throw new Error('bad outAmount');

    const routePlan = (q.routePlan as any[] | undefined) ?? [];
    return {
      outAmountUi: outAmount / 10 ** opts.outDecimals,
      priceImpactPct: Number(q.priceImpactPct) || 0,
      route: routePlan.map((s) => s?.swapInfo?.label ?? '?').join(' -> ') || 'unknown',
      ammKeys: routePlan.map((s) => String(s?.swapInfo?.ammKey ?? '')).filter(Boolean),
      legs: routePlan.map((s): JupiterRouteLeg => ({
        ammKey: String(s?.swapInfo?.ammKey ?? ''),
        label: String(s?.swapInfo?.label ?? '?'),
        inputMint: String(s?.swapInfo?.inputMint ?? ''),
        outputMint: String(s?.swapInfo?.outputMint ?? ''),
        inAmount: String(s?.swapInfo?.inAmount ?? ''),
        outAmount: String(s?.swapInfo?.outAmount ?? ''),
      })),
    };
  } catch (err) {
    log.warn(`Jupiter quote failed (${opts.inputMint} -> ${opts.outputMint}): ${err}`);
    return null;
  }
}

/**
 * Throttled GET of /quote with retry on 429 (honoring Retry-After, capped at
 * 5 s). Gives up once the request is older than CONFIG.jupiterQuoteMaxAgeMs —
 * for an arb, a quote priced off stale state is worse than no quote.
 */
async function fetchQuoteJson(params: URLSearchParams): Promise<any> {
  const startedAt = Date.now();

  for (;;) {
    const r = await throttled(() => fetch(`${CONFIG.jupiterQuoteApi}/quote?${params}`, { headers }));
    if (r.ok) return r.json();

    const body = (await r.text()).slice(0, 200);
    if (r.status !== 429) throw new Error(`HTTP ${r.status} from ${CONFIG.jupiterQuoteApi}: ${body}`);

    const retryAfterMs = Math.min(5000, (Number(r.headers.get('retry-after')) || 1) * 1000);
    if (Date.now() + retryAfterMs - startedAt > CONFIG.jupiterQuoteMaxAgeMs) {
      throw new Error(`HTTP 429: ${body} (gave up after ${Date.now() - startedAt} ms)`);
    }
    await new Promise((res) => setTimeout(res, retryAfterMs));
  }
}
