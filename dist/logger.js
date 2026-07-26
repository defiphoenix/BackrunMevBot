import { appendFileSync } from 'node:fs';
import { CONFIG } from './config.js';
function ts() {
    return new Date().toISOString();
}
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
/**
 * Pretty-print a ` | `-separated summary line as an aligned multi-line block:
 * key=value segments get the key colorized and padded, other segments print as-is.
 */
function prettySegments(msg, accent) {
    const segments = msg.split(' | ');
    if (segments.length === 1)
        return ' ' + msg;
    const kv = segments.map((seg) => {
        const eq = seg.indexOf('=');
        // Only treat as key=value when the key is a single word (avoid splitting prose).
        if (eq > 0 && !seg.slice(0, eq).includes(' ')) {
            return [seg.slice(0, eq), seg.slice(eq + 1)];
        }
        return [null, seg];
    });
    const keyWidth = Math.max(...kv.map(([k]) => k?.length ?? 0));
    return ('\n' +
        kv
            .map(([k, v]) => k === null
            ? `    ${v}`
            : `    ${accent(k.padEnd(keyWidth))}  ${v}`)
            .join('\n'));
}
export const log = {
    info(msg) {
        console.log(`${dim(`[${ts()}]`)} ${cyan('INFO ')}${prettySegments(msg, dim)}`);
    },
    warn(msg) {
        console.warn(`${dim(`[${ts()}]`)} ${yellow('WARN ')} ${msg}`);
    },
    error(msg) {
        console.error(`${dim(`[${ts()}]`)} ${red('ERROR')} ${msg}`);
    },
    /** Arbitrage opportunities go to console (pretty) AND the log file (single line). */
    opportunity(msg) {
        console.log(`${dim(`[${ts()}]`)} ${greenBold('★ OPPORTUNITY')}${green(prettySegments(msg, bold))}`);
        if (CONFIG.logFile) {
            try {
                appendFileSync(CONFIG.logFile, `[${ts()}] OPPORTUNITY ${msg}\n`);
            }
            catch {
                // file logging is best-effort
            }
        }
    },
};
