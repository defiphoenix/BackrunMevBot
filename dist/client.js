import WebSocket from 'ws';
/**
 * Standalone WS client for the opportunity feed. Connects to the bot's
 * OpportunityServer (`WS /ws`), prints the recent history from the `hello`
 * frame, then pretty-prints every `arb_opportunity` as it arrives.
 * Reconnects with exponential backoff.
 *
 *   npx tsx src/client.ts [ws://host:port/ws]
 */
const url = process.argv[2] ?? `ws://localhost:${process.env.API_PORT ?? 8787}/ws`;
/** ANSI helpers — no-ops when stdout is not a TTY (e.g. piped/redirected). */
const useColor = process.stdout.isTTY === true;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c('2');
const bold = c('1');
const cyan = c('36');
const yellow = c('33');
const red = c('31');
const green = c('32');
const greenBold = c('1;32');
const sol = (n, digits = 4) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)} SOL`;
const price = (n) => `${n.toExponential(6)} SOL/token`;
const short = (addr) => (addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr);
function printOpportunity(o, tag = '★ OPPORTUNITY') {
    const pnlColor = o.arbPnl >= 0 ? green : red;
    const rows = [
        ['token', `${o.tokenSymbol ?? '?'} (${o.sourceMint})`],
        ['detected', o.detectedAt],
        ['trigger', `sell ${o.trigger.sellSizeSol.toFixed(3)} SOL by ${o.trigger.txSigner ? short(o.trigger.txSigner) : '?'} (tx ${short(o.trigger.signature)})`],
        ['buy leg', `${o.buyAmount.toFixed(3)} SOL -> ${o.tokenAmount.toFixed(2)} tokens on ${o.dexIn} @ ${price(o.buyPrice)} (impact ${o.priceImpactInPct.toFixed(2)}%)`],
        ['sell leg', `${o.tokenAmount.toFixed(2)} tokens -> ${o.sellAmount.toFixed(4)} SOL on ${o.dexOut} @ ${price(o.sellPrice)} (impact ${o.priceImpactOutPct.toFixed(2)}%)`],
        ['spread', `${o.spreadPct.toFixed(2)}%`],
        ['costs', `tip ${o.costs.jitoTipSol} + prio ${o.costs.priorityFeeSol} SOL, slippage ${o.costs.slippageBps} bps`],
        ['gross PnL', sol(o.grossPnl)],
        ['net PnL', pnlColor(bold(sol(o.arbPnl)))],
    ];
    const keyWidth = Math.max(...rows.map(([k]) => k.length));
    console.log(`${dim(`[${new Date().toISOString()}]`)} ${greenBold(tag)} ${dim(o.id)}`);
    for (const [k, v] of rows) {
        console.log(`    ${bold(k.padEnd(keyWidth))}  ${v}`);
    }
    console.log();
}
let reconnectDelay = 1000;
function connect() {
    console.log(`${dim(`[${new Date().toISOString()}]`)} ${cyan('INFO ')} Connecting to ${url} ...`);
    const ws = new WebSocket(url);
    ws.on('open', () => {
        reconnectDelay = 1000;
        console.log(`${dim(`[${new Date().toISOString()}]`)} ${cyan('INFO ')} Connected — waiting for opportunities`);
    });
    ws.on('message', (raw) => {
        let frame;
        try {
            frame = JSON.parse(raw.toString());
        }
        catch {
            return;
        }
        if (frame.type === 'hello') {
            const history = frame.data?.history ?? [];
            console.log(`${dim(`[${new Date().toISOString()}]`)} ${cyan('INFO ')} Server hello — ${history.length} recent opportunities`);
            // hello history is newest-first; replay oldest-first so the feed reads chronologically.
            for (const o of [...history].reverse())
                printOpportunity(o, '★ RECENT');
        }
        else if (frame.type === 'arb_opportunity') {
            printOpportunity(frame.data);
        }
    });
    ws.on('error', (err) => console.error(`${dim(`[${new Date().toISOString()}]`)} ${red('ERROR')} ${err.message}`));
    ws.on('close', () => {
        console.warn(`${dim(`[${new Date().toISOString()}]`)} ${yellow('WARN ')} Disconnected — reconnecting in ${reconnectDelay}ms`);
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    });
}
connect();
