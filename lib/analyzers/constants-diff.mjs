// Cross-repo constants drift detector. Extracts SHOUTY_SNAKE exported consts
// from each of two roots and finds:
//   - exact name match with different value (drift!)
//   - similar names (edit distance ≤ 2)
//   - identical numeric values with different names
//
// Use:
//   cfg.crossRoots: [{root, label}, {root, label}] — two repos to diff
//
// Findings emitted on the first root (UI side conventionally), with `refs`
// pointing into the second root.

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { relative } from 'path';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'constants-diff';

export async function run({ cfg = {} }) {
    const { crossRoots = [] } = cfg;
    if (crossRoots.length !== 2) {
        return { findings: [], rawSignals: new Map(), stats: { skipped: 'needs cfg.crossRoots: [{root, label}, {root, label}]' } };
    }
    const [a, b] = crossRoots;
    if (!existsSync(a.root) || !existsSync(b.root)) {
        return { findings: [], rawSignals: new Map(), stats: { error: 'one of crossRoots missing' } };
    }

    const aConsts = extractConstants(a);
    const bConsts = extractConstants(b);
    const findings = [];

    // Exact name match → drift if values differ
    const aByName = new Map();
    for (const c of aConsts) {
        if (!aByName.has(c.name)) aByName.set(c.name, []);
        aByName.get(c.name).push(c);
    }
    for (const bc of bConsts) {
        const aMatches = aByName.get(bc.name);
        if (!aMatches) continue;
        for (const ac of aMatches) {
            if (ac.value !== bc.value) {
                findings.push(makeFinding({
                    kind: 'constants-drift',
                    file: ac.file,
                    line: ac.line,
                    message: `\`${ac.name}\` drift: ${a.label}=${truncate(ac.value, 30)} vs ${b.label}=${truncate(bc.value, 30)}`,
                    severity: 'high',
                    score: 1,
                    refs: [
                        { file: ac.file, line: ac.line, name: `${a.label}:${ac.value}` },
                        { file: bc.file, line: bc.line, name: `${b.label}:${bc.value}` },
                    ],
                    meta: { name: ac.name, a_value: ac.value, b_value: bc.value, a_label: a.label, b_label: b.label },
                }));
            }
        }
    }

    // Similar names (edit distance ≤ 2 of normalized form)
    const aByNorm = new Map();
    for (const c of aConsts) {
        const n = normalize(c.name);
        if (!aByNorm.has(n)) aByNorm.set(n, []);
        aByNorm.get(n).push(c);
    }
    for (const bc of bConsts) {
        const bn = normalize(bc.name);
        for (const [an, aList] of aByNorm.entries()) {
            if (an === bn) continue; // exact-norm = handled above (or both same name)
            if (editDistance(an, bn) <= 2) {
                for (const ac of aList) {
                    if (ac.name === bc.name) continue;
                    findings.push(makeFinding({
                        kind: 'constants-similar-names',
                        file: ac.file,
                        line: ac.line,
                        message: `\`${ac.name}\` ↔ \`${bc.name}\` similar names`,
                        severity: 'low',
                        score: 1,
                        refs: [
                            { file: ac.file, line: ac.line, name: `${a.label}:${ac.name}` },
                            { file: bc.file, line: bc.line, name: `${b.label}:${bc.name}` },
                        ],
                    }));
                }
            }
        }
    }

    // Identical numeric values with different names
    const aByNum = new Map();
    for (const c of aConsts) {
        const n = extractNumericValue(c.value);
        if (n != null) {
            if (!aByNum.has(n)) aByNum.set(n, []);
            aByNum.get(n).push(c);
        }
    }
    for (const bc of bConsts) {
        const n = extractNumericValue(bc.value);
        if (n == null) continue;
        const aMatches = aByNum.get(n);
        if (!aMatches) continue;
        for (const ac of aMatches) {
            if (ac.name === bc.name) continue;
            findings.push(makeFinding({
                kind: 'constants-shared-value',
                file: ac.file,
                line: ac.line,
                message: `\`${ac.name}\` and \`${bc.name}\` both = ${n}`,
                severity: 'medium',
                score: 1,
                refs: [
                    { file: ac.file, line: ac.line, name: `${a.label}:${ac.name}` },
                    { file: bc.file, line: bc.line, name: `${b.label}:${bc.name}` },
                ],
                meta: { value: n },
            }));
        }
    }

    return {
        findings,
        rawSignals: new Map(),
        stats: { a_consts: aConsts.length, b_consts: bConsts.length, findings: findings.length },
    };
}

function extractConstants({ root, label }) {
    let out = '';
    try {
        out = execSync(
            `grep -rn --include="*.ts" --include="*.tsx" -E "^export const [A-Z][A-Z0-9_]*\\s*[:=]" src/ 2>/dev/null || true`,
            { cwd: root, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
        );
    } catch {}
    const constants = [];
    for (const line of out.split('\n')) {
        const m = line.match(/^([^:]+):(\d+):export const ([A-Z][A-Z0-9_]*)\s*[:=]\s*(.+?)(?:;|\s*$)/);
        if (!m) continue;
        const [, file, lineNum, name, rawValue] = m;
        const value = rawValue.trim().replace(/\s*as\s+const\s*$/, '').replace(/;$/, '');
        constants.push({ repo: label, file: relative(root, root) || file, line: parseInt(lineNum, 10), name, value });
    }
    return constants;
}

function normalize(name) {
    return name.replace(/_/g, '').toLowerCase()
        .replace(/(rate|percent|percentage)$/, 'pct')
        .replace(/(ms|interval)$/, 'timeout');
}

function editDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

function extractNumericValue(v) {
    const cleaned = v.replace(/\s*as\s+const\s*/, '').replace(/,$/, '').trim();
    const numMatch = cleaned.match(/^-?\d+\.?\d*(?:e-?\d+)?$/);
    if (numMatch) return parseFloat(cleaned);
    try {
        if (/^[\d\s+\-*/.()e_]+$/.test(cleaned)) {
            const result = Function(`"use strict"; return (${cleaned.replace(/_/g, '')})`)();
            if (typeof result === 'number' && !isNaN(result)) return result;
        }
    } catch {}
    return null;
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
