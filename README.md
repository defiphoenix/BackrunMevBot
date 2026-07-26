# pump-meteora-arb-bot

Detection-only bot (no trading, no keys) that:

1. Fetches **all Meteora pools** paired against SOL (DLMM `pair/all` + DAMM v2
   `pools`, paginated) and caches them in memory, keyed by token mint.
   The cache refreshes every 10 minutes.
2. Connects to the **PumpDev WebSocket** (`wss://pumpdev.io/ws`) and streams
   pump.fun trades. The feed only supports per-mint subscriptions, so the bot
   subscribes to exactly the tokens that have a Meteora pool — the only trades
   an arb check can act on (capped at the top 5000 pools by liquidity;
   subscriptions are diffed on every cache refresh).
3. On a **sell larger than 10 SOL**, it looks the mint up in the Meteora
   cache, re-fetches that pool's fresh price, computes the post-sell pump.fun
   bonding-curve price, simulates buying the same SOL amount on pump.fun
   (`tokenOut` via the constant-product curve), values that `tokenOut` at the
   Meteora price, and logs the spread and gross PnL. Profitable spreads are
   printed green as `OPPORTUNITY` lines and appended to `opportunities.log`.

## Run

```bash
npm install
npm start
```

No API key is required — the PumpDev WebSocket and Meteora APIs are public.

## Config (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `BIG_SELL_THRESHOLD_SOL` | `10` | Minimum sell size (SOL) to trigger a check |
| `POOL_REFRESH_MS` | `600000` | Meteora pool cache refresh interval |
| `MAX_TRACKED_MINTS` | `5000` | Cap on subscribed mints (WS fair-use) |
| `LOG_FILE` | `opportunities.log` | Opportunity log file (empty to disable) |

## Notes / limitations

- PnL is **gross**: it ignores swap fees, priority fees, Meteora pool depth
  and slippage. Treat the log as a signal, not an executable quote.
- Tokens still on the pump.fun bonding curve rarely have Meteora pools;
  most hits will be graduated tokens whose trades route through pump AMM —
  for those the event carries no curve state, so the trade's own execution
  price is used as the pump.fun price.
