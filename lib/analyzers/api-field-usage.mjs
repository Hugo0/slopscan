// API response field usage auditor. For each route in the API repo, extracts
// the declared response schema (Type.Object({...}) on response 200/201) and
// checks which fields the UI actually reads. Flags fields returned-but-unused
// (the "Bridge-fee bug" class — backend computes a value the frontend ignores).
//
// Use:
//   cfg.crossRoots: [{root: api, label}, {root: ui, label}]
//   cfg.routesDir: 'src/routes' (where API routes live)

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { join, relative } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'api-field-usage';

export async function run({ cfg = {}, onProgress = () => {} }) {
    const { crossRoots = [], routesDir = 'src/routes' } = cfg;
    if (crossRoots.length !== 2) {
        return { findings: [], rawSignals: new Map(), stats: { skipped: 'needs cfg.crossRoots: [{root: api}, {root: ui}]' } };
    }
    const [api, ui] = crossRoots;
    if (!existsSync(api.root) || !existsSync(ui.root)) {
        return { findings: [], rawSignals: new Map(), stats: { error: 'one of crossRoots missing' } };
    }

    // 1. Walk API routes, extract schemas
    const routeFiles = walkSourceFiles({
        root: api.root,
        include: [routesDir],
        extensions: ['.ts', '.tsx'],
    });
    const endpoints = [];
    for (const f of routeFiles) {
        let code;
        try { code = readFileSync(f, 'utf-8'); } catch { continue; }
        const rel = relative(api.root, f);
        const { routes, responseSchemas, replySends } = extractResponseFields(code);
        for (const r of routes) {
            const schema = responseSchemas.find((s) => s.pos > r.pos && s.pos - r.pos < 3000);
            const reply = replySends.find((s) => s.pos > r.pos && s.pos - r.pos < 3000);
            const fields = schema?.fields || reply?.fields || [];
            if (fields.length) endpoints.push({ file: rel, method: r.method, path: r.path, fields });
        }
    }
    onProgress({ message: `${endpoints.length} endpoints with declared response shape` });

    // 2. Grep UI for each field name
    const findings = [];
    let i = 0;
    for (const ep of endpoints) {
        i++;
        if (i % 25 === 0) onProgress({ done: i, total: endpoints.length });
        const unused = [];
        for (const field of ep.fields) {
            // Skip very generic field names that would always match
            if (['id', 'data', 'type', 'name', 'value', 'status', 'message', 'error'].includes(field)) continue;
            const used = grepCount(ui.root, field) > 0;
            if (!used) unused.push(field);
        }
        if (unused.length) {
            findings.push(makeFinding({
                kind: 'api-unused-response-field',
                file: ep.file,
                message: `${ep.method} ${ep.path}: returned-but-unused ${unused.length}/${ep.fields.length}: ${unused.join(', ')}`,
                severity: 'medium',
                score: unused.length,
                meta: { method: ep.method, path: ep.path, unused, all_fields: ep.fields },
            }));
        }
    }

    return {
        findings,
        rawSignals: new Map(),
        stats: { endpoints: endpoints.length, findings: findings.length },
    };
}

function extractResponseFields(code) {
    const routes = [];
    const routeRx = /app\.(get|post|put|delete|patch)\s*[(<][^'"`]*['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = routeRx.exec(code)) !== null) {
        routes.push({ method: m[1].toUpperCase(), path: m[2], pos: m.index });
    }

    const responseSchemas = [];
    const respRx = /response\s*:\s*\{\s*(?:20[01])\s*:\s*Type\.Object\(\s*\{([\s\S]*?)\}\s*\)/g;
    while ((m = respRx.exec(code)) !== null) {
        const fields = [];
        const fieldRx = /^\s*(\w+)\s*:\s*Type\./gm;
        let fm;
        while ((fm = fieldRx.exec(m[1])) !== null) fields.push(fm[1]);
        responseSchemas.push({ pos: m.index, fields });
    }

    const replySends = [];
    const replyRx = /reply\.(?:code\(\d+\)\.)?(?:status\(\d+\)\.)?send\(\s*\{([^}]{3,500})\}/g;
    while ((m = replyRx.exec(code)) !== null) {
        const fields = [];
        const fieldRx = /(\w+)\s*:/g;
        let fm;
        while ((fm = fieldRx.exec(m[1])) !== null) {
            if (!['error', 'statusCode', 'success', 'message'].includes(fm[1])) fields.push(fm[1]);
        }
        if (fields.length) replySends.push({ pos: m.index, fields });
    }

    return { routes, responseSchemas, replySends };
}

function grepCount(root, term) {
    try {
        const out = execSync(
            `grep -r --include="*.ts" --include="*.tsx" -l "\\b${term.replace(/[^a-zA-Z0-9_]/g, '')}\\b" src/ 2>/dev/null | wc -l`,
            { cwd: root, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
        );
        return parseInt(out.trim(), 10) || 0;
    } catch {
        return 0;
    }
}
