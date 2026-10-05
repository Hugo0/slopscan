// Import graph + cycle detection + fan-in/fan-out via lightweight regex parsing.
//
// Why regex instead of ts-morph: import-graph just needs source-string parsing
// of `import` / `from` lines, no type info, no resolution beyond string match.
// 50× faster than spinning up a full Project for thousands of files.
//
// Path resolution is heuristic: relative imports are resolved against the
// importing file's directory; bare specifiers are kept as-is and ignored for
// the graph.

import { readFileSync } from 'fs';
import { dirname, resolve, relative as relPath } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { preprocess, defaultPreprocessors } from '../preprocessors/index.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'import-graph';

const IMPORT_RX =
    /(?:^|\n)\s*(?:import\s+(?:[^'"\n]+\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;

export async function run({ root, walk, cfg = {} }) {
    const { fanInHighThreshold = 20, cycleSeverity = 'high' } = cfg;

    const files = walkSourceFiles(walk);
    const fileSet = new Set(files);

    // Map<absPath, { imports: absPath[], external: string[] }>
    const graph = new Map();

    for (const f of files) {
        let code;
        try {
            code = readFileSync(f, 'utf-8');
        } catch {
            continue;
        }
        const src = preprocess(code, f, defaultPreprocessors);
        const node = { imports: [], external: [] };
        IMPORT_RX.lastIndex = 0;
        let m;
        while ((m = IMPORT_RX.exec(src)) !== null) {
            const spec = m[1];
            if (spec.startsWith('.') || spec.startsWith('/')) {
                const resolved = resolveModulePath(f, spec, fileSet);
                if (resolved) node.imports.push(resolved);
            } else if (spec.startsWith('~') || spec.startsWith('@/')) {
                // Project alias — attempt naive resolution against the root
                const stripped = spec.replace(/^[~@]\//, '');
                const resolved = resolveModulePath(root + '/_dummy', './' + stripped, fileSet, root);
                if (resolved) node.imports.push(resolved);
                else node.external.push(spec);
            } else {
                node.external.push(spec);
            }
        }
        graph.set(f, node);
    }

    // Build fan-in
    const fanIn = new Map(); // absPath → count
    for (const [, node] of graph) {
        for (const imp of node.imports) fanIn.set(imp, (fanIn.get(imp) || 0) + 1);
    }

    // Cycle detection (Tarjan-style strongly connected components, simplified)
    const cycles = findCycles(graph);

    const findings = [];
    const rawSignals = new Map();

    for (const f of files) {
        const rel = relPath(root, f);
        const node = graph.get(f);
        if (!node) continue;
        const fi = fanIn.get(f) || 0;
        const fo = node.imports.length;
        rawSignals.set(rel, { fan_in: fi, fan_out: fo });

        if (fi >= fanInHighThreshold) {
            findings.push(
                makeFinding({
                    kind: 'fan-in-high',
                    file: rel,
                    message: `Imported by ${fi} files (high coupling)`,
                    severity: fi >= fanInHighThreshold * 2 ? 'high' : 'medium',
                    score: fi,
                    meta: { fan_in: fi, fan_out: fo },
                }),
            );
        }
    }

    for (const c of cycles) {
        const cycleFiles = c.map((p) => relPath(root, p));
        // Attach finding to each file in the cycle
        for (const f of cycleFiles) {
            findings.push(
                makeFinding({
                    kind: 'import-cycle',
                    file: f,
                    message: `Cycle of length ${c.length}: ${cycleFiles.slice(0, 6).join(' → ')}${c.length > 6 ? '…' : ''}`,
                    severity: cycleSeverity,
                    score: c.length,
                    refs: cycleFiles.map((cf) => ({ file: cf })),
                    meta: { cycle: cycleFiles },
                }),
            );
            const cur = rawSignals.get(f) || {};
            cur.cycle = (cur.cycle || 0) + 1;
            rawSignals.set(f, cur);
        }
    }

    return {
        findings,
        rawSignals,
        stats: { files: files.length, edges: countEdges(graph), cycles: cycles.length },
    };
}

const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.mjs', '.cjs'];
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.vue'];

function resolveModulePath(fromFile, spec, fileSet, baseDir = null) {
    const fromDir = baseDir || dirname(fromFile);
    const base = resolve(fromDir, spec);
    if (fileSet.has(base)) return base;
    for (const ext of RESOLVE_EXTS) {
        if (fileSet.has(base + ext)) return base + ext;
    }
    for (const idx of INDEX_FILES) {
        const p = resolve(base, idx);
        if (fileSet.has(p)) return p;
    }
    return null;
}

function countEdges(graph) {
    let n = 0;
    for (const [, node] of graph) n += node.imports.length;
    return n;
}

// Find SCCs of size >= 2 (cycles). Tarjan's algorithm.
function findCycles(graph) {
    const idx = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    let counter = 0;
    const sccs = [];

    function strongConnect(v) {
        idx.set(v, counter);
        low.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
        const node = graph.get(v);
        for (const w of node?.imports || []) {
            if (!idx.has(w)) {
                strongConnect(w);
                low.set(v, Math.min(low.get(v), low.get(w)));
            } else if (onStack.has(w)) {
                low.set(v, Math.min(low.get(v), idx.get(w)));
            }
        }
        if (low.get(v) === idx.get(v)) {
            const scc = [];
            let w;
            do {
                w = stack.pop();
                onStack.delete(w);
                scc.push(w);
            } while (w !== v);
            if (scc.length >= 2) sccs.push(scc);
        }
    }

    // Wrap in try/catch — extremely deep graphs can blow the call stack.
    try {
        for (const v of graph.keys()) if (!idx.has(v)) strongConnect(v);
    } catch {}
    return sccs;
}
