// Per-file dependency weight via static import resolution.
//
// We don't hit bundlephobia (rate-limited and online-only). Instead we
// estimate weight by reading installed `node_modules/<dep>/package.json`
// fields and counting bytes of `dist/` or `main` files. Heuristic but local
// and free.

import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { dirname, join, relative as relPath } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { preprocess, defaultPreprocessors } from '../preprocessors/index.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'bundle-size';

const IMPORT_RX =
    /(?:^|\n)\s*(?:import\s+(?:[^'"\n]+\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;

export async function run({ root, walk, cfg = {}, onProgress = () => {} }) {
    const { heavyThresholdKb = 200 } = cfg;
    const findings = [];
    const fileWeights = new Map();
    const depWeights = new Map();

    const files = walkSourceFiles(walk);
    let i = 0;
    for (const f of files) {
        i++;
        if (i % 50 === 0) onProgress({ done: i, total: files.length });
        let code;
        try {
            code = readFileSync(f, 'utf-8');
        } catch {
            continue;
        }
        const src = preprocess(code, f, defaultPreprocessors);
        const rel = relPath(root, f);
        let weight = 0;
        const usedDeps = new Set();
        IMPORT_RX.lastIndex = 0;
        let m;
        while ((m = IMPORT_RX.exec(src)) !== null) {
            const spec = m[1];
            // bare specifier → look up package weight
            if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('~') && !spec.startsWith('@/')) {
                const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
                if (!depWeights.has(pkgName)) depWeights.set(pkgName, estimateDepWeight(root, pkgName));
                const w = depWeights.get(pkgName);
                if (w > 0) {
                    weight += w;
                    usedDeps.add(pkgName);
                }
            }
        }
        if (weight > 0) fileWeights.set(rel, { weight, deps: [...usedDeps] });
    }

    // Findings: heavy importers
    for (const [file, info] of fileWeights.entries()) {
        if (info.weight / 1024 < heavyThresholdKb) continue;
        const sev = info.weight / 1024 >= 1000 ? 'high' : info.weight / 1024 >= 500 ? 'medium' : 'low';
        findings.push(
            makeFinding({
                kind: 'heavy-imports',
                file,
                message: `~${(info.weight / 1024).toFixed(0)} KB transitive imports across ${info.deps.length} dep(s)`,
                severity: sev,
                score: Math.round(info.weight / 1024),
                meta: { kb: Math.round(info.weight / 1024), deps: info.deps },
            }),
        );
    }

    const rawSignals = new Map();
    for (const [file, info] of fileWeights.entries()) {
        rawSignals.set(file, { import_weight_kb: Math.round(info.weight / 1024) });
    }

    return {
        findings,
        rawSignals,
        stats: { files: files.length, deps_resolved: depWeights.size, heavy_files: findings.length },
    };
}

const sizeCache = new Map();

function estimateDepWeight(root, pkg) {
    const cacheKey = root + '\0' + pkg;
    if (sizeCache.has(cacheKey)) return sizeCache.get(cacheKey);

    const pkgDir = join(root, 'node_modules', pkg);
    if (!existsSync(pkgDir)) {
        sizeCache.set(cacheKey, 0);
        return 0;
    }
    let weight = 0;
    // Prefer dist/ if it exists; else fall back to walking the whole package.
    const candidates = ['dist', 'lib', 'esm', 'build', 'es'];
    let target = pkgDir;
    for (const c of candidates) {
        const p = join(pkgDir, c);
        if (existsSync(p)) {
            target = p;
            break;
        }
    }
    weight = sumFileBytes(target, ['.js', '.mjs', '.cjs']);
    if (weight === 0) {
        // No bundled output found — fall back to package.json `main`
        try {
            const mainEntry = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')).main;
            if (mainEntry) {
                const p = join(pkgDir, mainEntry);
                if (existsSync(p)) weight = statSync(p).size;
            }
        } catch {}
    }
    sizeCache.set(cacheKey, weight);
    return weight;
}

function sumFileBytes(dir, exts, depth = 0) {
    if (depth > 4) return 0; // bound recursion
    if (!existsSync(dir)) return 0;
    let bytes = 0;
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return 0;
    }
    for (const e of entries) {
        if (e.startsWith('.')) continue;
        const p = join(dir, e);
        let s;
        try {
            s = statSync(p);
        } catch {
            continue;
        }
        if (s.isDirectory()) {
            bytes += sumFileBytes(p, exts, depth + 1);
        } else if (s.isFile()) {
            const ext = e.slice(e.lastIndexOf('.'));
            if (exts.includes(ext)) bytes += s.size;
        }
    }
    return bytes;
}
