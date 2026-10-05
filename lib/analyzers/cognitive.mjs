// Cognitive complexity — Mean Dependency Distance (MDD) + Dependency Locality
// Theory call-graph fan-out (DLT). Two metrics distinct from cyclomatic /
// Halstead, capturing reader working-memory load.
//
// Methodology — follows Philodev § Linguistic Complexity:
//   MDD: avg lines between a variable's declaration and each use within the
//        same function. Parameters count as declared at function start.
//   DLT: count of DISTINCT callees (function names) inside the function body.
//
// Implementation: walks ts-morph AST, no extra parser dep. Vue script
// blocks come through the preprocessor first.

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { relative } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { preprocess, defaultPreprocessors } from '../preprocessors/index.mjs';
import { makeFinding } from '../core/findings.mjs';

const require = createRequire(import.meta.url);
const { Project, ScriptKind, SyntaxKind } = require('ts-morph');

export const NAME = 'cognitive';

let project;
function getProject() {
    if (!project) {
        project = new Project({
            useInMemoryFileSystem: true,
            skipFileDependencyResolution: true,
            compilerOptions: { allowJs: true, jsx: 4 },
        });
    }
    return project;
}

function scriptKindFor(filepath) {
    if (filepath.endsWith('.tsx')) return ScriptKind.TSX;
    if (filepath.endsWith('.jsx')) return ScriptKind.JSX;
    if (filepath.endsWith('.js')) return ScriptKind.JS;
    return ScriptKind.TS;
}

const FN_KINDS = new Set([
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.FunctionExpression,
    SyntaxKind.ArrowFunction,
    SyntaxKind.MethodDeclaration,
]);

export async function run({ root, walk, cfg = {}, onProgress = () => {} }) {
    const { mddThreshold = 10, dltThreshold = 15 } = cfg;
    const findings = [];
    const counts = new Map();          // file → { mdd_high, dlt_high }
    const fileAvg = new Map();          // file → { avg_mdd, avg_dlt, fn_count }

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
        if (!src.trim()) continue;
        const rel = relative(root, f);

        const proj = getProject();
        const fakePath = `/_cog_/${i}.${scriptExt(f)}`;
        let sf;
        try {
            sf = proj.createSourceFile(fakePath, src, { overwrite: true, scriptKind: scriptKindFor(f) });
        } catch {
            continue;
        }

        const fnMetrics = [];
        sf.forEachDescendant((node) => {
            if (!FN_KINDS.has(node.getKind())) return;
            const m = analyzeFunction(node);
            if (m) fnMetrics.push(m);
        });

        // File-level avg
        if (fnMetrics.length) {
            const avgMdd = mean(fnMetrics.map((m) => m.mdd));
            const avgDlt = mean(fnMetrics.map((m) => m.dlt));
            fileAvg.set(rel, { avg_mdd: avgMdd, avg_dlt: avgDlt, fn_count: fnMetrics.length });
        }

        for (const m of fnMetrics) {
            if (m.mdd >= mddThreshold) {
                findings.push(makeFinding({
                    kind: 'high-mdd',
                    file: rel,
                    line: m.line,
                    message: `${m.name}: MDD ${m.mdd.toFixed(1)} (uses across many lines from declarations)`,
                    severity: m.mdd >= mddThreshold * 2 ? 'medium' : 'low',
                    score: Math.round(m.mdd),
                    meta: { metric: 'mdd', value: m.mdd, function_name: m.name },
                }));
                bump(counts, rel, 'mdd_high');
            }
            if (m.dlt >= dltThreshold) {
                findings.push(makeFinding({
                    kind: 'high-dlt',
                    file: rel,
                    line: m.line,
                    message: `${m.name}: DLT ${m.dlt} (calls ${m.dlt} distinct functions — high context load)`,
                    severity: m.dlt >= dltThreshold * 2 ? 'medium' : 'low',
                    score: m.dlt,
                    meta: { metric: 'dlt', value: m.dlt, function_name: m.name, total_calls: m.calls },
                }));
                bump(counts, rel, 'dlt_high');
            }
        }

        proj.removeSourceFile(sf);
    }

    const rawSignals = new Map();
    for (const [file, agg] of fileAvg.entries()) {
        const c = counts.get(file) || {};
        rawSignals.set(file, {
            cognitive_mdd_avg: agg.avg_mdd,
            cognitive_dlt_avg: agg.avg_dlt,
            ...c,
        });
    }

    return {
        findings,
        rawSignals,
        stats: { files: files.length, findings: findings.length },
    };
}

function scriptExt(f) {
    if (f.endsWith('.tsx')) return 'tsx';
    if (f.endsWith('.jsx')) return 'jsx';
    if (f.endsWith('.js') || f.endsWith('.mjs')) return 'js';
    return 'ts';
}

function bump(map, file, key) {
    const cur = map.get(file) || {};
    cur[key] = (cur[key] || 0) + 1;
    map.set(file, cur);
}

function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, x) => s + x, 0) / arr.length;
}

// MDD + DLT analysis for a single function node.
function analyzeFunction(fnNode) {
    const fnStart = fnNode.getStartLineNumber?.() ?? 1;
    const fnName = getFunctionName(fnNode);

    // Collect bindings (parameter + variable + function/class decls inside body)
    const decls = new Map(); // name → declLine

    // Parameters
    try {
        for (const p of fnNode.getParameters?.() || []) {
            const name = p.getName?.();
            if (name) decls.set(name, fnStart);
        }
    } catch {}

    // Body declarations
    fnNode.forEachDescendant?.((d) => {
        const k = d.getKind();
        if (k === SyntaxKind.VariableDeclaration) {
            const name = d.getName?.();
            if (name && !decls.has(name)) decls.set(name, d.getStartLineNumber?.() ?? fnStart);
        } else if (k === SyntaxKind.FunctionDeclaration || k === SyntaxKind.ClassDeclaration) {
            const name = d.getName?.();
            if (name && !decls.has(name)) decls.set(name, d.getStartLineNumber?.() ?? fnStart);
        }
    });

    // Walk uses + callees
    let totalDistance = 0;
    let useCount = 0;
    const callees = new Set();
    let calls = 0;

    fnNode.forEachDescendant?.((d, traversal) => {
        const k = d.getKind();
        if (k === SyntaxKind.Identifier) {
            const name = d.getText?.();
            if (!name) return;
            const declLine = decls.get(name);
            if (declLine != null) {
                const useLine = d.getStartLineNumber?.() ?? declLine;
                if (useLine > declLine) {
                    totalDistance += useLine - declLine;
                    useCount++;
                }
            }
        } else if (k === SyntaxKind.CallExpression) {
            calls++;
            try {
                const expr = d.getExpression?.();
                if (!expr) return;
                if (expr.getKind() === SyntaxKind.Identifier) {
                    callees.add(expr.getText());
                } else if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
                    const propName = expr.getName?.();
                    if (propName) callees.add(propName);
                }
            } catch {}
        }
    });

    return {
        name: fnName,
        line: fnStart,
        bindings: decls.size,
        uses: useCount,
        mdd: useCount ? totalDistance / useCount : 0,
        dlt: callees.size,
        calls,
    };
}

function getFunctionName(node) {
    try {
        const own = node.getName?.();
        if (own) return own;
        const parent = node.getParent?.();
        if (!parent) return '<anon>';
        const pk = parent.getKind?.();
        if (pk === SyntaxKind.VariableDeclaration) return parent.getName?.() || '<anon>';
        if (pk === SyntaxKind.PropertyAssignment) return parent.getName?.() || '<anon>';
        return '<anon>';
    } catch {
        return '<anon>';
    }
}
