// Generic content-keyed disk cache. One file per entry, sha256-hashed key.
// Used by AST parsing, embeddings, jscpd, knip, anything else worth memoizing.
//
//   const cache = createCache('./.cache/ast');
//   const ast = await cache.getOrCompute(sourceText, () => parse(sourceText));

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

export function sha256(...parts) {
    const h = createHash('sha256');
    for (const p of parts) h.update(typeof p === 'string' ? p : JSON.stringify(p));
    return h.digest('hex');
}

export function createCache(dir, opts = {}) {
    const { format = 'json' } = opts;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    function pathFor(key) {
        const ext = format === 'raw' ? '' : '.json';
        return join(dir, `${key}${ext}`);
    }

    function has(key) {
        return existsSync(pathFor(key));
    }

    function get(key) {
        const p = pathFor(key);
        if (!existsSync(p)) return null;
        try {
            const text = readFileSync(p, 'utf-8');
            return format === 'raw' ? text : JSON.parse(text);
        } catch {
            return null;
        }
    }

    function set(key, value) {
        const p = pathFor(key);
        const text = format === 'raw' ? String(value) : JSON.stringify(value);
        writeFileSync(p, text);
    }

    async function getOrCompute(keyParts, computeFn) {
        const key = Array.isArray(keyParts) ? sha256(...keyParts) : sha256(keyParts);
        const cached = get(key);
        if (cached !== null) return { value: cached, hit: true };
        const value = await computeFn();
        set(key, value);
        return { value, hit: false };
    }

    function size() {
        try {
            return statSync(dir).size; // not real recursive size, just dir-stat
        } catch {
            return 0;
        }
    }

    return { has, get, set, getOrCompute, size, dir };
}
