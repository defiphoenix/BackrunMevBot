import { CONFIG } from './config.js';
import { log } from './logger.js';
import { fetchBuyQuote, fetchSellQuote } from './jupiter.js';
const PUMPSWAP_LABEL = 'Pump.fun Amm';
const METEORA_LABELS = new Set(['Meteora DLMM', 'Meteora DAMM v2']);
/**
 * On every big PumpSwap SELL (> threshold SOL) of a pump.fun-migrated token
 * that also has a Meteora pool: quote both legs via Jupiter — buy
 * CONFIG.tradeAmountSol SOL of the token on PumpSwap, sell the resulting
 * tokens on Meteora — and calculate the backrun arb from the quoted
 * outAmounts.
 *
 * Single-hop only: each leg must be exactly one pool (PumpSwap on the buy,
 * Meteora on the sell) — multi-hop routes are rejected so this detector
 * never involves any DEX besides pump.fun/PumpSwap and Meteora.
 */
export class ArbDetector {
    meteora;
    server;
    constructor(meteora, server) {
        this.meteora = meteora;
        this.server = server;
    }
    async onTrade(e) {
        if (!(e.quoteAmount > CONFIG.bigSellThresholdSol))
            return;
        const pool = this.meteora.getPool(e.mint);
        if (!pool)
            return; // big sell, but no Meteora pool for this token
        log.info(`Big sell detected: ${e.quoteAmount.toFixed(2)} SOL of ${e.mint} ` +
            `by ${e.txSigner} (tx ${e.signature}) — Meteora pool found: ` +
            `${pool.name} [${pool.kind}] ${pool.address}`);
        const tradeSol = CONFIG.tradeAmountSol;
        // Buy leg: Jupiter quote for tradeSol SOL -> token on PumpSwap. The
        // quoted outAmount already includes PumpSwap fees and price impact.
        const buyQuote = await fetchBuyQuote(e.mint, tradeSol);
        if (!buyQuote) {
            log.warn(`Cannot price buy leg for ${e.mint} — Jupiter quote failed`);
            return;
        }
        if (buyQuote.legs.length !== 1 || buyQuote.legs[0].label !== PUMPSWAP_LABEL) {
            log.warn(`Rejecting buy leg for ${e.mint} — not a single PumpSwap hop [${buyQuote.route}]`);
            return;
        }
        const tokenOut = buyQuote.outAmountUi;
        const buyPrice = tradeSol / tokenOut;
        // Sell leg: Jupiter quote for tokenOut tokens -> SOL on Meteora.
        const sellQuote = await fetchSellQuote(e.mint, tokenOut);
        if (!sellQuote) {
            log.warn(`Cannot price sell leg for ${e.mint} — Jupiter quote failed`);
            return;
        }
        const solOut = sellQuote.outAmountUi;
        // Effective sell price realized (SOL per token) and the arb PnL.
        const sellPrice = solOut / tokenOut;
        const spreadPct = ((sellPrice - buyPrice) / buyPrice) * 100;
        const grossProfitSol = solOut - tradeSol;
        const fixedCostsSol = CONFIG.jitoTipSol + CONFIG.priorityFeeSol;
        const netProfitSol = grossProfitSol - fixedCostsSol;
        const summary = `detector=single-hop backrun (PumpSwap -> Meteora) | ` +
            `mint=${e.mint}${e.symbol ? ` (${e.symbol})` : ''} | ` +
            `sellSize=${e.quoteAmount.toFixed(3)} SOL | ` +
            `buyLeg=${tradeSol.toFixed(3)} SOL -> ${tokenOut.toFixed(2)} tokens ` +
            `[${buyQuote.route}] impact ${buyQuote.priceImpactPct.toFixed(2)}% | ` +
            `sellLeg=${tokenOut.toFixed(2)} tokens -> ${solOut.toFixed(4)} SOL ` +
            `[${sellQuote.route}] impact ${sellQuote.priceImpactPct.toFixed(2)}% | ` +
            `buyPrice=${buyPrice.toExponential(6)} SOL/token | ` +
            `sellPrice=${sellPrice.toExponential(6)} SOL/token | ` +
            `spread=${spreadPct.toFixed(2)}% | ` +
            `buyPool=${buyQuote.ammKeys.join(',') || e.poolId || '?'} | ` +
            `sellPool=${sellQuote.ammKeys.join(',') || pool.address} | ` +
            `meteoraPool=${pool.name} [${pool.kind}] ${pool.address} tvl=$${pool.liquidityUsd.toFixed(0)} | ` +
            `pumpswapPool=${e.poolId ?? '?'} reserves=${e.quoteInPool != null ? `${e.quoteInPool.toFixed(2)} SOL` : '?'}` +
            `${e.tokensInPool != null ? ` / ${e.tokensInPool.toFixed(0)} tokens` : ''} | ` +
            `tip+prio=${fixedCostsSol.toFixed(4)} SOL | ` +
            `grossPnL=${grossProfitSol >= 0 ? '+' : ''}${grossProfitSol.toFixed(4)} SOL | ` +
            `netPnL=${netProfitSol >= 0 ? '+' : ''}${netProfitSol.toFixed(4)} SOL | ` +
            `tx=${e.signature}`;
        if (netProfitSol >= CONFIG.minProfitSol) {
            log.opportunity(summary);
            const now = Date.now();
            const opportunity = {
                id: `${e.signature}:${e.mint}`,
                timestamp: now,
                detectedAt: new Date(now).toISOString(),
                strategy: 'pumpswap-meteora-two-leg',
                sourceMint: e.mint,
                tokenSymbol: e.symbol ?? null,
                targetMint: CONFIG.wsolMint,
                poolIn: buyQuote.ammKeys,
                poolOut: sellQuote.ammKeys,
                dexIn: buyQuote.route,
                dexOut: sellQuote.route,
                buyAmount: tradeSol,
                tokenAmount: tokenOut,
                sellAmount: solOut,
                buyPrice,
                sellPrice,
                spreadPct,
                priceImpactInPct: buyQuote.priceImpactPct,
                priceImpactOutPct: sellQuote.priceImpactPct,
                grossPnl: grossProfitSol,
                arbPnl: netProfitSol,
                costs: {
                    jitoTipSol: CONFIG.jitoTipSol,
                    priorityFeeSol: CONFIG.priorityFeeSol,
                    slippageBps: CONFIG.slippageBps,
                },
                liquidity: {
                    meteora: {
                        pool: pool.address,
                        kind: pool.kind,
                        name: pool.name,
                        tvlUsd: pool.liquidityUsd,
                    },
                    pumpswap: {
                        pool: e.poolId ?? buyQuote.ammKeys[0] ?? null,
                        tokensInPool: e.tokensInPool ?? null,
                        solInPool: e.quoteInPool ?? null,
                    },
                },
                trigger: {
                    signature: e.signature,
                    sellSizeSol: e.quoteAmount,
                    txSigner: e.txSigner ?? null,
                    pumpswapPool: e.poolId ?? null,
                },
            };
            this.server?.publish(opportunity);
        }
        else {
            log.info(`No edge: ${e.mint} netPnL=${netProfitSol.toFixed(4)} SOL < minProfitSol=${CONFIG.minProfitSol}`);
        }
    }
}
