import { CONFIG } from './config.js';
import { log } from './logger.js';
/**
 * Fetches and caches every Meteora pool that is paired against SOL.
 * Covers DLMM and DAMM v2 (the pool types memecoins migrate/list on).
 * Keyed by the non-SOL token mint; when a token has several pools the
 * one with the highest liquidity wins.
 */
export class MeteoraPoolCache {
    pools = new Map();
    refreshTimer = null;
    get size() {
        return this.pools.size;
    }
    getPool(mint) {
        return this.pools.get(mint);
    }
    /** Tracked mints, highest-liquidity pools first, capped for WS fair-use. */
    trackedMints() {
        return [...this.pools.values()]
            .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
            .slice(0, CONFIG.maxTrackedMints)
            .map((p) => p.tokenMint);
    }
    async start(onRefresh) {
        await this.refresh();
        this.refreshTimer = setInterval(async () => {
            try {
                await this.refresh();
                onRefresh();
            }
            catch (err) {
                log.error(`Meteora pool refresh failed: ${err}`);
            }
        }, CONFIG.poolRefreshIntervalMs);
    }
    stop() {
        if (this.refreshTimer)
            clearInterval(this.refreshTimer);
    }
    async refresh() {
        const started = Date.now();
        const [dlmm, dammv2] = await Promise.allSettled([
            this.fetchDlmmPools(),
            this.fetchDammV2Pools(),
        ]);
        const next = new Map();
        for (const result of [dlmm, dammv2]) {
            if (result.status === 'rejected') {
                log.error(`Meteora fetch failed: ${result.reason}`);
                continue;
            }
            for (const pool of result.value) {
                const existing = next.get(pool.tokenMint);
                if (!existing || pool.liquidityUsd > existing.liquidityUsd) {
                    next.set(pool.tokenMint, pool);
                }
            }
        }
        if (next.size === 0 && this.pools.size > 0) {
            log.warn('Meteora refresh returned no pools; keeping previous cache');
            return;
        }
        this.pools = next;
        log.info(`Meteora cache refreshed: ${next.size} SOL-paired pools in ${Date.now() - started}ms`);
    }
    /**
     * Re-fetch a single pool right before evaluating an opportunity so the
     * price is fresh, falling back to the cached value on failure.
     */
    async freshPrice(pool) {
        const base = pool.kind === 'dlmm' ? CONFIG.meteoraDlmmApi : CONFIG.meteoraDammV2Api;
        try {
            const r = await fetch(`${base}/pools/${pool.address}`);
            if (!r.ok)
                throw new Error(`HTTP ${r.status}`);
            const p = await r.json();
            const price = Number(p.current_price);
            if (!isFinite(price) || price <= 0)
                throw new Error('bad price');
            // current_price is token_x priced in token_y; invert if SOL is x.
            return p.token_x?.address === CONFIG.wsolMint ? 1 / price : price;
        }
        catch (err) {
            log.warn(`Fresh price fetch failed for ${pool.address} (${err}); using cached`);
            return pool.priceSolPerToken;
        }
    }
    fetchDlmmPools() {
        return this.fetchPools(CONFIG.meteoraDlmmApi, 'dlmm');
    }
    fetchDammV2Pools() {
        return this.fetchPools(CONFIG.meteoraDammV2Api, 'dammv2');
    }
    /**
     * Both datapi hosts share the same /pools shape. There is no token filter
     * and each program lists ~120k pools, so we page sorted by TVL descending
     * and stop once TVL falls below the arb-relevant floor (or we have enough
     * SOL-paired pools to fill the tracked-mint cap).
     */
    async fetchPools(base, kind) {
        const pools = [];
        const pageSize = 1000;
        let totalSeen = 0;
        for (let page = 1;; page++) {
            const r = await fetch(`${base}/pools?page=${page}&page_size=${pageSize}&sort_by=tvl:desc`);
            if (!r.ok)
                throw new Error(`${kind} pools HTTP ${r.status} (page ${page})`);
            const body = await r.json();
            const items = body.data ?? [];
            totalSeen += items.length;
            let belowFloor = false;
            for (const p of items) {
                const tvl = Number(p.tvl) || 0;
                if (tvl < CONFIG.minPoolTvlUsd) {
                    belowFloor = true;
                    break;
                }
                const solIsX = p.token_x?.address === CONFIG.wsolMint;
                const solIsY = p.token_y?.address === CONFIG.wsolMint;
                if (!solIsX && !solIsY)
                    continue;
                const rawPrice = Number(p.current_price);
                if (!isFinite(rawPrice) || rawPrice <= 0)
                    continue;
                pools.push({
                    address: p.address,
                    kind,
                    tokenMint: solIsX ? p.token_y.address : p.token_x.address,
                    name: p.name ?? kind,
                    // current_price is token_x priced in token_y; invert if SOL is x.
                    priceSolPerToken: solIsX ? 1 / rawPrice : rawPrice,
                    liquidityUsd: tvl,
                });
            }
            if (belowFloor || items.length < pageSize || pools.length >= CONFIG.maxTrackedMints) {
                break;
            }
        }
        log.info(`${kind}: ${pools.length} SOL-paired pools (scanned ${totalSeen})`);
        return pools;
    }
}
