import { appendFileSync } from 'node:fs';
import { OpportunityServer } from './src/server.js';
import WebSocket from 'ws';

const out = (s: string) => { appendFileSync('smoke-out.txt', Date.now() + ' ' + s + '\n'); };
process.on('uncaughtException', (e) => out('UNCAUGHT: ' + (e as Error).stack));
process.on('unhandledRejection', (e) => out('UNHANDLED: ' + e));
process.on('exit', (code) => out('EXIT code=' + code));

const s = new OpportunityServer();
s.start();
out('started');

setTimeout(() => {
  out('connecting ws');
  const ws = new WebSocket('ws://127.0.0.1:8787/ws');
  ws.on('error', (e) => out('WS ERR: ' + e));
  ws.on('message', (d) => out('WS RECV: ' + d.toString().slice(0, 150)));
  ws.on('open', () => {
    out('ws open');
    setTimeout(() => {
      out('publishing');
      s.publish({
        id: '5xyz:AbcMint', timestamp: Date.now(), detectedAt: new Date().toISOString(),
        strategy: 'pumpswap-meteora-two-leg', sourceMint: 'AbcMint', tokenSymbol: 'TEST',
        targetMint: 'So11111111111111111111111111111111111111112',
        poolIn: ['PumpPool111'], poolOut: ['MeteoraPool111'],
        dexIn: 'Pump.fun Amm', dexOut: 'Meteora DLMM',
        buyAmount: 0.5, tokenAmount: 41823.1, sellAmount: 0.5091,
        buyPrice: 1.1955e-5, sellPrice: 1.2173e-5, spreadPct: 1.82,
        priceImpactInPct: 0.42, priceImpactOutPct: 0.35,
        grossPnl: 0.0091, arbPnl: 0.0089,
        costs: { jitoTipSol: 0.0001, priorityFeeSol: 0.0001, slippageBps: 100 },
        trigger: { signature: '5xyz', sellSizeSol: 12.3, txSigner: 'Signer111', pumpswapPool: 'PumpPool111' },
      });
      out('published');
    }, 200);
  });
  setTimeout(async () => {
    try {
      const h = await (await fetch('http://127.0.0.1:8787/health')).json();
      out('HEALTH: ' + JSON.stringify(h));
      const o: any = await (await fetch('http://127.0.0.1:8787/opportunities?limit=5')).json();
      out('HISTORY count=' + o.count + ' arbPnl=' + o.opportunities[0]?.arbPnl);
    } catch (e) {
      out('FETCH ERR: ' + e);
    }
    process.exit(0);
  }, 1500);
}, 300);
