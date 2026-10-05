// React 19 anti-pattern scanner. Regex-based; runs only on .tsx/.jsx files
// since the patterns are JSX-specific.
//
// Checks:
//   - class components (use functions in React 19)
//   - forwardRef (no longer needed in React 19)
//   - useEffect with empty deps that sets state (derived-state anti-pattern)
//   - useEffect that fetches (should be server components / TanStack Query)
//   - inline arrow handlers (perf + extraction smell)
//   - direct DOM manipulation (use refs)
//   - missing key in .map(...JSX)
//   - long components (>300 lines)
//   - multiple component exports per file
//   - useMemo on primitives (cheap, doesn't help)

import { readFileSync } from 'fs';
import { relative } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'react';

export async function run({ root, walk, cfg = {}, onProgress = () => {} }) {
    const findings = [];
    const counts = new Map();
    const files = walkSourceFiles({
        ...walk,
        extensions: (walk.extensions || []).filter((e) => e === '.tsx' || e === '.jsx'),
    });
    if (!files.length) {
        return { findings: [], rawSignals: new Map(), stats: { skipped: 'no .tsx/.jsx files' } };
    }
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
        const rel = relative(root, f);
        const lines = code.split('\n');
        let m;

        const issues = [];

        // class components
        const classRx = /class\s+(\w+)\s+extends\s+(?:React\.)?(?:Component|PureComponent)/g;
        while ((m = classRx.exec(code)) !== null) {
            issues.push({ kind: 'react-class-component', line: lineOf(code, m.index), message: `\`${m[1]}\` is a class component (use a function)`, severity: 'medium' });
        }

        // forwardRef
        const fwdRx = /forwardRef\s*[<(]/g;
        while ((m = fwdRx.exec(code)) !== null) {
            issues.push({ kind: 'react-forward-ref', line: lineOf(code, m.index), message: '`forwardRef` no longer needed in React 19', severity: 'low' });
            break; // one per file
        }

        // useEffect: derived state + async fetch
        const useEffectRx = /useEffect\s*\(\s*(?:\(\)\s*=>|async\s*\(\)\s*=>|function)[^{]*\{([\s\S]*?)\},\s*\[([^\]]*)\]\s*\)/g;
        while ((m = useEffectRx.exec(code)) !== null) {
            const body = m[1];
            const deps = m[2].trim();
            const line = lineOf(code, m.index);
            if (!deps) {
                if (/\bset[A-Z]\w*\s*\(/.test(body) && !/fetch\(|axios|api\.|async/.test(body)) {
                    issues.push({ kind: 'react-effect-derives-state', line, message: 'useEffect with empty deps + setState — derived state anti-pattern', severity: 'medium' });
                }
                if (/fetch\(|axios\.|api\.|await/.test(body)) {
                    issues.push({ kind: 'react-effect-fetches', line, message: 'useEffect for async data fetching — use TanStack Query / server components', severity: 'medium' });
                }
            } else {
                const setStateCount = (body.match(/\bset[A-Z]\w*\s*\(/g) || []).length;
                const realLogic = body.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;
                if (setStateCount > 0 && realLogic < 5 && !/fetch|api|async|await|subscribe|addEventListener|timer|timeout|interval/.test(body)) {
                    issues.push({ kind: 'react-effect-derives-state', line, message: 'small useEffect that only sets state from deps', severity: 'medium' });
                }
            }
        }

        // inline arrow props ≥ 8 in one file = smell
        const inlineRx = /\s(?:onClick|onChange|onSubmit|onFocus|onBlur|onInput|onPress|onMouseDown|onKeyDown)=\{\(\s*[^)]*\)\s*=>\s*[^}]{3,80}\}/g;
        const inlineCount = (code.match(inlineRx) || []).length;
        if (inlineCount >= 8) {
            issues.push({ kind: 'react-inline-arrows', line: 1, message: `${inlineCount} inline arrow handlers (extract or use useCallback)`, severity: 'low', score: inlineCount });
        }

        // direct DOM manipulation
        const domRx = /document\.(getElementById|querySelector|querySelectorAll|createElement)|\.innerHTML\s*=/g;
        while ((m = domRx.exec(code)) !== null) {
            issues.push({ kind: 'react-direct-dom', line: lineOf(code, m.index), message: `direct DOM: ${m[0]}`, severity: 'medium' });
        }

        // missing key in .map(...JSX)
        const mapRx = /\.map\s*\(\s*(?:\([^)]*\)|\w+)\s*=>\s*\(?\s*</g;
        while ((m = mapRx.exec(code)) !== null) {
            const ln = lineOf(code, m.index);
            const next = lines.slice(ln - 1, ln + 3).join('\n');
            if (!/\skey=\{?/.test(next)) {
                issues.push({ kind: 'react-missing-key', line: ln, message: '.map() returning JSX without `key` prop', severity: 'medium' });
            }
        }

        // long components
        const compRx = /^export\s+(?:default\s+)?function\s+([A-Z]\w*)\s*\(/gm;
        while ((m = compRx.exec(code)) !== null) {
            const startLine = lineOf(code, m.index);
            let depth = 0, sawOpen = false, endLine = startLine;
            for (let p = m.index; p < code.length; p++) {
                if (code[p] === '{') { depth++; sawOpen = true; }
                else if (code[p] === '}') { depth--; if (sawOpen && depth === 0) { endLine = lineOf(code, p); break; } }
            }
            const len = endLine - startLine;
            if (len > 300) {
                issues.push({ kind: 'react-long-component', line: startLine, message: `\`${m[1]}\` is ${len} lines — split it`, severity: 'medium', score: len });
            }
        }

        // multiple component exports per file
        const exportCount = (code.match(/^export\s+(?:default\s+)?(?:function|const)\s+[A-Z]\w*/gm) || []).length;
        if (exportCount > 2) {
            issues.push({ kind: 'react-multiple-exports', line: 1, message: `${exportCount} component exports — one per file is the convention`, severity: 'low', score: exportCount });
        }

        // useMemo on primitives
        const useMemoRx = /useMemo\s*\(\s*\(\)\s*=>\s*([^,}]+),\s*\[/g;
        while ((m = useMemoRx.exec(code)) !== null) {
            const expr = m[1].trim();
            if (/^[\w.]+\s*(?:[=!<>]=|[<>]|&&|\|\|)\s*\w+\s*$/.test(expr) || /^[\w.]+\s*\?\s*\w+\s*:\s*\w+\s*$/.test(expr)) {
                issues.push({ kind: 'react-useless-memo', line: lineOf(code, m.index), message: `useMemo over primitive expression: \`${expr.slice(0, 50)}\``, severity: 'low' });
            }
        }

        for (const issue of issues) {
            findings.push(makeFinding({
                kind: issue.kind,
                file: rel,
                line: issue.line,
                message: issue.message,
                severity: issue.severity,
                score: issue.score ?? 1,
            }));
            counts.set(rel, (counts.get(rel) || 0) + 1);
        }
    }

    const rawSignals = new Map();
    for (const [file, n] of counts.entries()) rawSignals.set(file, { react_antipatterns: n });

    return {
        findings,
        rawSignals,
        stats: { files: files.length, findings: findings.length },
    };
}

function lineOf(code, idx) {
    return code.slice(0, idx).split('\n').length;
}
