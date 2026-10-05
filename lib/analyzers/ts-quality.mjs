// Type-aware quality checks via ts-morph. Surfaces:
//   - functions with implicit `any` returns (no annotation, signature too loose)
//   - functions returning Promise<any>
//   - exported APIs missing return-type annotations (public-API hygiene)
//   - non-null assertions (!) in expressions
//   - regex-grep for: `Function` type, `object`/`Object` type, empty interfaces,
//     `enum` usage (prefer `as const`)
//
// Cheap heuristics — we don't run the full type-checker. Augments tsc errors
// rather than replacing them.

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { relative } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { preprocess, defaultPreprocessors } from '../preprocessors/index.mjs';
import { makeFinding } from '../core/findings.mjs';

const require = createRequire(import.meta.url);
const { Project, ScriptKind, SyntaxKind } = require('ts-morph');

export const NAME = 'ts-quality';

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

export async function run({ root, walk, cfg = {}, onProgress = () => {} }) {
    const { onlyExported = true } = cfg;
    const findings = [];
    const counts = new Map();

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
        const ext = f.slice(f.lastIndexOf('.'));
        if (!['.ts', '.tsx'].includes(ext) && !f.endsWith('.vue')) continue;

        const proj = getProject();
        const fakePath = `/_q_/${i}.${ext === '.vue' ? 'ts' : ext.slice(1)}`;
        let sf;
        try {
            sf = proj.createSourceFile(fakePath, src, {
                overwrite: true,
                scriptKind: scriptKindFor(f),
            });
        } catch {
            continue;
        }

        const issues = checkSourceFile(sf, { onlyExported });
        // Regex-only checks across the raw script (covers what AST is overkill for)
        const grepIssues = grepChecks(src);
        for (const issue of issues.concat(grepIssues)) {
            counts.set(rel, (counts.get(rel) || 0) + 1);
            findings.push(
                makeFinding({
                    kind: issue.kind,
                    file: rel,
                    line: issue.line,
                    message: issue.message,
                    severity: issue.severity,
                    score: 1,
                    meta: { name: issue.name },
                }),
            );
        }

        proj.removeSourceFile(sf);
    }

    const rawSignals = new Map();
    for (const [file, n] of counts.entries()) rawSignals.set(file, { ts_quality: n });

    return {
        findings,
        rawSignals,
        stats: { files: files.length, findings: findings.length },
    };
}

function checkSourceFile(sf, opts) {
    const issues = [];
    for (const stmt of sf.getStatements()) {
        check(stmt, issues, opts);
    }
    return issues;
}

function check(node, issues, opts) {
    const k = node.getKind();

    // Function declarations / arrow functions / methods
    if (k === SyntaxKind.FunctionDeclaration || k === SyntaxKind.MethodDeclaration) {
        evalFn(node, issues, opts);
    } else if (k === SyntaxKind.VariableStatement) {
        for (const decl of node.getDeclarationList().getDeclarations()) {
            const init = decl.getInitializer?.();
            if (!init) continue;
            const ik = init.getKind();
            if (ik === SyntaxKind.ArrowFunction || ik === SyntaxKind.FunctionExpression) {
                evalFn(init, issues, opts, decl.getName?.(), node);
            }
        }
    } else if (k === SyntaxKind.ClassDeclaration) {
        for (const m of node.getMethods?.() || []) evalFn(m, issues, opts);
    }
}

function evalFn(fn, issues, opts, declName = null, parentForExport = null) {
    if (!fn) return;
    const isExported = nodeIsExported(parentForExport || fn);
    if (opts.onlyExported && !isExported) return;
    const name = (fn.getName?.() || declName || '<anon>');
    const line = fn.getStartLineNumber?.() ?? 1;
    let returnType = null;
    try {
        returnType = fn.getReturnTypeNode?.()?.getText?.() ?? null;
    } catch {}

    if (!returnType) {
        issues.push({
            kind: 'missing-return-type',
            name,
            line,
            severity: 'low',
            message: `${name}: exported fn missing return type annotation`,
        });
    } else if (returnType === 'any' || returnType === 'Promise<any>' || returnType.endsWith('<any>')) {
        issues.push({
            kind: 'any-return',
            name,
            line,
            severity: 'medium',
            message: `${name}: return type is \`${returnType}\``,
        });
    }

    // Walk body for non-null assertions (x!.y) — possible safety-net abuse
    try {
        let bangs = 0;
        fn.forEachDescendant?.((d) => {
            if (d.getKind() === SyntaxKind.NonNullExpression) bangs++;
        });
        if (bangs >= 5) {
            issues.push({
                kind: 'non-null-asserts',
                name,
                line,
                severity: 'low',
                message: `${name}: ${bangs} non-null assertions inside body`,
            });
        }
    } catch {}
}

function nodeIsExported(node) {
    try {
        return !!node?.getModifiers?.()?.some?.((m) => m.getText() === 'export');
    } catch {
        return false;
    }
}

// Regex-based grep checks for things ts-morph would be overkill on.
// Returns [{kind, line, severity, message, name}, ...]
function grepChecks(src) {
    const issues = [];
    const lineOf = (idx) => src.slice(0, idx).split('\n').length;

    // `: Function` or `<Function>` — banned, prefer specific signature
    let m;
    const fnRx = /:\s*Function\b|<Function[>,]/g;
    while ((m = fnRx.exec(src)) !== null) {
        issues.push({
            kind: 'banned-type',
            line: lineOf(m.index),
            severity: 'low',
            message: '`Function` type used — prefer specific call signature',
            name: 'Function',
        });
    }

    // `: object` / `: Object` — banned, prefer Record<string, unknown> or specific shape
    const objRx = /:\s*(?:Object|object)\b/g;
    while ((m = objRx.exec(src)) !== null) {
        issues.push({
            kind: 'banned-type',
            line: lineOf(m.index),
            severity: 'low',
            message: '`object`/`Object` type used — prefer specific shape or `Record<string, unknown>`',
            name: 'object',
        });
    }

    // Empty interface
    const emptyRx = /^\s*(?:export\s+)?interface\s+(\w+)\s*\{\s*\}/gm;
    while ((m = emptyRx.exec(src)) !== null) {
        issues.push({
            kind: 'empty-interface',
            line: lineOf(m.index),
            severity: 'low',
            message: `Empty interface \`${m[1]}\` — use a type alias instead`,
            name: m[1],
        });
    }

    // `enum` declarations — prefer `as const` objects
    const enumRx = /^\s*(?:export\s+)?(?:const\s+)?enum\s+(\w+)/gm;
    while ((m = enumRx.exec(src)) !== null) {
        issues.push({
            kind: 'enum-usage',
            line: lineOf(m.index),
            severity: 'low',
            message: `\`enum ${m[1]}\` — prefer \`as const\` object literals`,
            name: m[1],
        });
    }

    return issues;
}
