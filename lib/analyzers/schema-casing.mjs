// Schema casing + shape consistency checker. Targets API routes that define
// Type.Object({...}) (TypeBox / Fastify schemas) and flags:
//   - mixed casing in a single schema (camel + snake side by side)
//   - reply.code() vs reply.status() inconsistency in same file
//
// Generic: works on any TS source that uses TypeBox-shaped Type.Object literals.

import { readFileSync } from 'fs';
import { relative } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'schema-casing';

const camelRx = /^[a-z][a-zA-Z0-9]*$/;
const snakeRx = /^[a-z][a-z0-9_]*_[a-z0-9_]*$/;

export async function run({ root, walk, cfg = {}, onProgress = () => {} }) {
    const findings = [];
    const counts = new Map();
    const files = walkSourceFiles(walk);
    let i = 0;
    for (const f of files) {
        i++;
        if (i % 100 === 0) onProgress({ done: i, total: files.length });
        let code;
        try {
            code = readFileSync(f, 'utf-8');
        } catch {
            continue;
        }
        const rel = relative(root, f);

        // Type.Object({...}) bodies
        const re = /Type\.Object\(\s*\{([\s\S]*?)\}\s*\)/g;
        let m;
        while ((m = re.exec(code)) !== null) {
            const body = m[1];
            const fields = [];
            const fieldRx = /^\s*['"`]?(\w+)['"`]?\s*:\s*Type\./gm;
            let fm;
            while ((fm = fieldRx.exec(body)) !== null) fields.push(fm[1]);
            if (fields.length < 2) continue;
            const camel = fields.filter((x) => camelRx.test(x) && !snakeRx.test(x));
            const snake = fields.filter((x) => snakeRx.test(x));
            if (camel.length > 0 && snake.length > 0) {
                const ln = code.slice(0, m.index).split('\n').length;
                findings.push(makeFinding({
                    kind: 'schema-mixed-casing',
                    file: rel,
                    line: ln,
                    message: `Mixed casing: camel=[${camel.slice(0, 3).join(',')}…] snake=[${snake.slice(0, 3).join(',')}…]`,
                    severity: 'medium',
                    score: camel.length + snake.length,
                    meta: { camel, snake, all_fields: fields },
                }));
                bump(counts, rel, 'schema_mixed_casing');
            }
        }

        // reply.code / reply.status mix
        const codeCount = (code.match(/reply\.code\(\d+\)/g) || []).length;
        const statusCount = (code.match(/reply\.status\(\d+\)/g) || []).length;
        if (codeCount > 0 && statusCount > 0) {
            findings.push(makeFinding({
                kind: 'schema-reply-style-mix',
                file: rel,
                line: 1,
                message: `Mixes reply.code() (${codeCount}) and reply.status() (${statusCount})`,
                severity: 'low',
                score: 1,
                meta: { code_count: codeCount, status_count: statusCount },
            }));
            bump(counts, rel, 'schema_reply_mix');
        }
    }

    const rawSignals = new Map();
    for (const [file, sig] of counts.entries()) rawSignals.set(file, sig);

    return {
        findings,
        rawSignals,
        stats: { files: files.length, findings: findings.length },
    };
}

function bump(map, file, key) {
    const cur = map.get(file) || {};
    cur[key] = (cur[key] || 0) + 1;
    map.set(file, cur);
}
