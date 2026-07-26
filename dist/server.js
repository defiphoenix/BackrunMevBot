import { createServer } from 'node:http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from './config.js';
import { log } from './logger.js';
/**
 * Express + WebSocket server around the opportunity feed.
 *
 *   GET /health         — liveness + counters
 *   GET /opportunities  — recent opportunities (newest first, ?limit=N)
 *   WS  /ws             — every opportunity pushed as it is detected:
 *                         { type: 'arb_opportunity', data: ArbOpportunity }
 */
export class OpportunityServer {
    app = express();
    http = createServer(this.app);
    wss = new WebSocketServer({ server: this.http, path: '/ws' });
    history = [];
    published = 0;
    constructor() {
        this.app.get('/health', (_req, res) => {
            res.json({
                status: 'ok',
                uptimeSec: Math.floor(process.uptime()),
                wsClients: this.wss.clients.size,
                opportunitiesPublished: this.published,
            });
        });
        this.app.get('/opportunities', (req, res) => {
            const limit = Math.min(Number(req.query.limit) || 100, CONFIG.opportunityHistorySize);
            res.json({
                count: Math.min(limit, this.history.length),
                opportunities: this.history.slice(0, limit),
            });
        });
        this.wss.on('connection', (ws, req) => {
            log.info(`WS client connected (${req.socket.remoteAddress}); total ${this.wss.clients.size}`);
            ws.send(JSON.stringify({ type: 'hello', data: { history: this.history.slice(0, 10) } }));
        });
    }
    start() {
        this.http.listen(CONFIG.apiPort, () => {
            log.info(`Opportunity API listening on http://localhost:${CONFIG.apiPort} ` +
                `(WS feed at ws://localhost:${CONFIG.apiPort}/ws)`);
        });
    }
    stop() {
        for (const client of this.wss.clients)
            client.terminate();
        this.wss.close();
        this.http.close();
    }
    /** Broadcast an opportunity to all WS clients and keep it in history. */
    publish(opp) {
        this.published++;
        this.history.unshift(opp);
        if (this.history.length > CONFIG.opportunityHistorySize)
            this.history.pop();
        const frame = JSON.stringify({ type: 'arb_opportunity', data: opp });
        for (const client of this.wss.clients) {
            if (client.readyState === WebSocket.OPEN)
                client.send(frame);
        }
    }
}
