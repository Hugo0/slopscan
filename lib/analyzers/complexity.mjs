// Complexity analyzer plugin. Wraps the existing escomplex-based analyzeFile.
// Emits Finding[] for: per-file complexity, hot methods.
// Also returns rawSignals: Map<file, {cyclomatic, maintainability, sloc, ...}>
// for the painscore aggregator.

import { readFileSync } from 'fs';
import { relative } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { analyzeFile } from '../complexity.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'complexity';

const SEV_BY_CC = (cc) =>
    cc >= 50 ? 'critical' : cc >= 30 ? 'high' : cc >= 15 ? 'medium' : 'low';

const SEV_BY_MI = (mi) =>
    mi <= 30 ? 'critical' : mi <= 50 ? 'high' : mi <= 65 ? 'medium' : 'low';

export async function run({ root, walk, cfg = {}, onProgress = () => {} }) {
    const findings = [];
    const rawSignals = new Map();

    const files = walkSourceFiles(walk);
    let i = 0;
    for (const filePath of files) {
        i++;
        if (i % 50 === 0) onProgress({ done: i, total: files.length });
        let code;
        try {
            code = readFileSync(filePath, 'utf-8');
        } catch {
            continue;
        }
        const m = analyzeFile(code, filePath);
        if (!m) continue;
        const file = relative(root, filePath);

        rawSignals.set(file, {
            cyclomatic: m.cyclomatic ?? 0,
            maintainability: m.maintainability ?? 100,
            sloc: m.sloc ?? 0,
            method_count: m.methodCount ?? 0,
            halstead_bugs: m.halstead?.bugs ?? 0,
            halstead_difficulty: m.halstead?.difficulty ?? 0,
            methods: m.methods || [],
        });

        // File-level finding only for non-trivial files
        if ((m.cyclomatic ?? 0) >= 15 || (m.maintainability ?? 100) <= 65) {
            const cc = m.cyclomatic ?? 0;
            const mi = m.maintainability ?? 100;
            const sev = worstSev(SEV_BY_CC(cc), SEV_BY_MI(mi));
            findings.push(
                makeFinding({
                    kind: 'complexity',
                    file,
                    message: `CC ${cc}, MI ${mi}, SLOC ${m.sloc ?? 0}`,
                    severity: sev,
                    score: cc,
                    meta: {
                        cyclomatic: cc,
                        maintainability: mi,
                        sloc: m.sloc,
                        halstead_bugs: m.halstead?.bugs,
                        halstead_difficulty: m.halstead?.difficulty,
                    },
                }),
            );
        }

        // Method-level for hot methods
        const minMethodCc = cfg.minMethodCc ?? 15;
        for (const method of m.methods || []) {
            if ((method.cyclomatic ?? 0) < minMethodCc) continue;
            findings.push(
                makeFinding({
                    kind: 'method-complexity',
                    file,
                    line: method.line,
                    message: `${method.name || '<anon>'} CC ${method.cyclomatic} SLOC ${method.sloc}`,
                    severity: SEV_BY_CC(method.cyclomatic),
                    score: method.cyclomatic,
                    meta: {
                        method_name: method.name,
                        cyclomatic: method.cyclomatic,
                        sloc: method.sloc,
                        halstead_bugs: method.halsteadBugs,
                    },
                }),
            );
        }
    }

    return { findings, rawSignals, stats: { files: files.length, withFinding: findings.length } };
}

function worstSev(a, b) {
    const order = ['low', 'medium', 'high', 'critical'];
    return order[Math.max(order.indexOf(a), order.indexOf(b))];
}
