// Structural duplication via jscpd. Token-fingerprinted exact duplicates.
// Complementary to semantic-dup: structural finds copy-paste; semantic finds
// paraphrased. Files appearing in both signals are the highest-confidence
// refactor candidates.

import { execSync } from 'child_process';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { bundledBin } from '../core/bin.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'structural-dup';

export async function run({ root, walk, cfg = {} }) {
    const {
        minTokens = 50,
        minLines = 5,
        formats = 'typescript,javascript,jsx,tsx,vue',
        bin = bundledBin('jscpd'),
    } = cfg;

    const findings = [];
    const dupCount = new Map();

    // Build target list. jscpd takes a path; we'll point it at the include dirs.
    const targets = (walk.include?.length ? walk.include : ['.'])
        .map((d) => join(root, d))
        .map((p) => `"${p}"`);

    if (!targets.length) return { findings: [], rawSignals: new Map(), stats: { skipped: 'no targets' } };

    const tmp = mkdtempSync(join(tmpdir(), 'jscpd-'));
    const ignorePatterns = (walk.exclude || [])
        .map((d) => `"**/${d}/**"`)
        .join(',');

    const cmd =
        `${bin} ${targets.join(' ')} ` +
        `--min-tokens ${minTokens} ` +
        `--min-lines ${minLines} ` +
        `--reporters json ` +
        `--output "${tmp}" ` +
        `--silent ` +
        (ignorePatterns ? `--ignore ${ignorePatterns} ` : '') +
        `--format "${formats}"`;

    let report;
    try {
        execSync(cmd, { encoding: 'utf-8', cwd: root, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
        const reportPath = join(tmp, 'jscpd-report.json');
        report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    } catch (err) {
        rmSync(tmp, { recursive: true, force: true });
        return { findings: [], rawSignals: new Map(), stats: { error: String(err.message || err) } };
    } finally {
        try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    }

    const dups = report.duplicates || [];
    for (let i = 0; i < dups.length; i++) {
        const d = dups[i];
        const fileA = relativize(root, d.firstFile?.name);
        const fileB = relativize(root, d.secondFile?.name);
        if (!fileA || !fileB) continue;
        const lines = d.lines ?? d.tokens ?? 0;
        const tokens = d.tokens ?? 0;
        const sev = lines >= 50 ? 'high' : lines >= 20 ? 'medium' : 'low';
        const refs = [
            { file: fileA, line: d.firstFile?.start, name: `(lines ${d.firstFile?.start}-${d.firstFile?.end})` },
            { file: fileB, line: d.secondFile?.start, name: `(lines ${d.secondFile?.start}-${d.secondFile?.end})` },
        ];
        const meta = {
            lines,
            tokens,
            fragment_a: { file: fileA, start: d.firstFile?.start, end: d.firstFile?.end },
            fragment_b: { file: fileB, start: d.secondFile?.start, end: d.secondFile?.end },
        };
        findings.push(
            makeFinding({
                kind: 'structural-dup',
                file: fileA,
                line: d.firstFile?.start,
                message: `${lines} duplicate lines / ${tokens} tokens with ${fileB}:${d.secondFile?.start}`,
                severity: sev,
                score: lines,
                refs,
                meta,
            }),
        );
        dupCount.set(fileA, (dupCount.get(fileA) ?? 0) + 1);
        dupCount.set(fileB, (dupCount.get(fileB) ?? 0) + 1);
    }

    const rawSignals = new Map();
    for (const [file, count] of dupCount) rawSignals.set(file, { structural_dup: count });

    return {
        findings,
        rawSignals,
        stats: {
            duplicates: dups.length,
            files_with_dup: dupCount.size,
            total_clones: report.statistics?.total?.clones ?? 0,
            total_dup_lines: report.statistics?.total?.duplicatedLines ?? 0,
        },
    };
}

function relativize(root, p) {
    if (!p) return null;
    return p.startsWith(root) ? relative(root, p) : p;
}
