# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BackrunMevBot — a trimmed-down, single-strategy fork of `pump-meteora-arb-bot`. Detection-only Solana backrun bot (no trading, no private keys). It watches for **big** SOL-quoted SELLs of pump.fun tokens on PumpSwap streamed from the PumpApi firehose, and for any mint that also has a Meteora pool it prices a **single-hop** backrun (buy on PumpSwap → sell on Meteora) via Jupiter quotes. Opportunities with net PnL ≥ `minProfitSol` are logged and published over HTTP/WS.

Unlike the parent bot, this fork:
- Runs **only** the single-hop PumpSwap → Meteora detector (the parent's 3-hop `v2`/`v3` detectors were removed).
- Rejects any Jupiter quote that isn't exactly one hop on `Pump.fun Amm` (buy leg) or `Meteora DLMM`/`Meteora DAMM v2` (sell leg) — enforced both by the `dexes` query param and by checking `quote.legs.length === 1` in `src/arb.ts`.
- Uses a **higher** sell-size trigger (`bigSellThresholdSol` default 25 SOL vs. 10) — only backruns sells big enough to move price.
- Calls a **single** Jupiter endpoint (`CONFIG.jupiterQuoteApi`) with one serialized throttle — no multi-endpoint connection pool/rotation.

## Commands

- `npm start` — run the bot (`tsx src/index.ts`)
- `npm run dev` — run with `tsx watch`
- `npm run typecheck` — `tsc --noEmit` (the only check; there is no lint or test suite)
- `npx tsx server-smoke.ts` — smoke-test the OpportunityServer (starts the API on `apiPort`, publishes a fake opportunity, writes results to `smoke-out.txt`)

No API keys required by default. All tuning is via env vars defined in `src/config.ts` (`CONFIG` object) — thresholds, fees, rate-limit gap, port. Optional `JUPITER_API_KEY` switches Jupiter from the lite tier (~1 req/s, throttled client-side) to the pro tier. `apiPort` defaults to `8788` (vs. `8787` in the parent bot) so both can run side by side.

## Architecture

`src/index.ts` wires three long-lived components; data flows one way:

1. **`MeteoraPoolCache`** (`src/meteora.ts`) — pages the Meteora datapi (`dlmm.datapi.meteora.ag` + `damm-v2.datapi.meteora.ag`, same `/pools` shape) sorted by TVL desc, stopping below `minPoolTvlUsd`. Keeps only SOL-paired pools, keyed by the non-SOL mint (highest-liquidity pool wins). Refreshes every `poolRefreshIntervalMs`; a refresh returning zero pools keeps the old cache.
2. **`PumpTradeStream`** (`src/pumpfun.ts`) — single WebSocket to `wss://stream.pumpapi.io/` (strict 1 connection per IP, exponential-backoff reconnect). The stream is a **firehose with no subscription protocol** — all filtering is client-side in `isTrackedPumpSwapTrade`, which requires `action === 'sell'`, `pool === 'pump-amm'`, `poolCreatedBy === 'pump'`, SOL-quoted, and `quoteAmount > bigSellThresholdSol`. On each Meteora cache refresh, `setTrackedMints` just swaps the filter set.
3. **`ArbDetector`** (`src/arb.ts`) — on each qualifying big sell: Jupiter buy quote (SOL → token, PumpSwap only) and sell quote (token → SOL, Meteora only) via `src/jupiter.ts`. Rejects any quote whose route isn't a single hop on the expected DEX label. Computes spread and net PnL (minus `jitoTipSol` + `priorityFeeSol`), logs it and publishes an `ArbOpportunity` if profitable.
4. **`OpportunityServer`** (`src/server.ts`) — Express + WS on `apiPort`: `GET /health`, `GET /opportunities?limit=N`, and `WS /ws` pushing `{ type: 'arb_opportunity', data }` frames (new clients get a `hello` frame with recent history).

`src/jupiter.ts` has a **single-endpoint serialized throttle** (`throttled()`): all quote requests share one promise chain with `jupiterMinRequestGapMs` between them against `CONFIG.jupiterQuoteApi`, retrying 429s until the request exceeds `jupiterQuoteMaxAgeMs` (stale quotes are worse than none for a backrun). Per-leg DEX restriction (`CONFIG.jupiterBuyDexes` / `jupiterSellDexes`) is fixed in code, not env-overridable — this bot must only ever touch pump.fun/PumpSwap and Meteora.

Types live in `src/types.ts` (`MeteoraPool`, `PumpApiEvent`/`PumpSwapTradeEvent`, `ArbOpportunity`). ESM project (`"type": "module"`, NodeNext) — imports use `.js` extensions.

## Gotchas

- **README.md is stale**: inherited from the parent bot and describes an older design (PumpDev per-mint subscriptions, on-the-fly bonding-curve math). Trust the code.
- Meteora `current_price` is token_x priced in token_y; both `meteora.ts` call sites invert when SOL is token_x — keep that convention when touching price math.
- PnL is a signal, not an executable quote: quotes include DEX fees/impact, but no execution ever happens.
- This fork intentionally has no multi-hop or multi-endpoint code paths (they were removed, not just disabled) — if you need those, look at the sibling `pump-meteora-arb-bot` project instead of re-adding them here.
