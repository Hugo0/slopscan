// Baseline snapshot store + delta computation.
//
// Layout:
//   <output-root>/
//     baselines/
//       <git-sha-or-label>/
//         <run-label>/
//           findings.json
//           scorecard.json
//
// On a snapshot run, after writing the per-run findings + scorecard, save a
// copy under baselines/<ref>/<run-label>/. Subsequent runs can compare against
// any saved ref.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

export function gitShortSha(repoRoot) {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
    } catch {
        return null;
    }
}

export function gitBranch(repoRoot) {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
    } catch {
        return null;
    }
}

// Save a per-run snapshot under baselines/<ref>/<runLabel>/.
export function saveBaseline({ outputRoot, ref, runLabel, doc, scorecard }) {
    const dir = join(outputRoot, 'baselines', ref, runLabel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'findings.json'), JSON.stringify(doc, null, 2));
    writeFileSync(join(dir, 'scorecard.json'), JSON.stringify(scorecard, null, 2));
    return dir;
}

// List saved baseline refs (newest first by mtime).
export function listBaselines(outputRoot) {
    const root = join(outputRoot, 'baselines');
    if (!existsSync(root)) return [];
    return readdirSync(root)
        .map((name) => ({ ref: name, mtime: statSync(join(root, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
}

// Load a saved baseline run, or null if missing.
export function loadBaseline({ outputRoot, ref, runLabel }) {
    const dir = join(outputRoot, 'baselines', ref, runLabel);
    if (!existsSync(dir)) return null;
    try {
        return {
            doc: JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf-8')),
            scorecard: JSON.parse(readFileSync(join(dir, 'scorecard.json'), 'utf-8')),
        };
    } catch {
        return null;
    }
}

// Compute delta between current and baseline. Returns:
//   {
//     painscoreDelta: { totalDelta, perFile: [{ file, before, after, delta }, ...] },
//     findings: { added: Finding[], resolved: Finding[], unchanged: number },
//     summary: { addedCount, resolvedCount, painscoreImproved, painscoreWorsened }
//   }
export function computeDelta({ current, baseline }) {
    if (!baseline) return null;

    const beforeFiles = new Map(baseline.scorecard.files.map((f) => [f.file, f.painscore]));
    const afterFiles = new Map(current.scorecard.files.map((f) => [f.file, f.painscore]));
    const allFiles = new Set([...beforeFiles.keys(), ...afterFiles.keys()]);

    const perFile = [];
    let totalBefore = 0;
    let totalAfter = 0;
    for (const file of allFiles) {
        const before = beforeFiles.get(file) ?? 0;
        const after = afterFiles.get(file) ?? 0;
        totalBefore += before;
        totalAfter += after;
        if (before !== after) {
            perFile.push({ file, before, after, delta: after - before });
        }
    }
    perFile.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const findKey = (f) => `${f.kind}\0${f.file}\0${f.line ?? ''}\0${f.message}`;
    const beforeKeys = new Set(baseline.doc.findings.map(findKey));
    const afterKeys = new Set(current.doc.findings.map(findKey));
    const added = current.doc.findings.filter((f) => !beforeKeys.has(findKey(f)));
    const resolved = baseline.doc.findings.filter((f) => !afterKeys.has(findKey(f)));
    const unchangedCount = current.doc.findings.length - added.length;

    return {
        baselineRef: baseline.scorecard.label || baseline.doc.label || '',
        baselineGeneratedAt: baseline.doc.generatedAt,
        painscoreDelta: {
            totalDelta: round2(totalAfter - totalBefore),
            totalBefore: round2(totalBefore),
            totalAfter: round2(totalAfter),
            perFile: perFile.slice(0, 100),
        },
        findings: {
            added,
            resolved,
            unchanged: unchangedCount,
        },
        summary: {
            addedCount: added.length,
            resolvedCount: resolved.length,
            painscoreImproved: perFile.filter((d) => d.delta < 0).length,
            painscoreWorsened: perFile.filter((d) => d.delta > 0).length,
        },
    };
}

// Resolve a baseline ref to a concrete saved snapshot. Accepts:
//   - "auto"     → most recent saved baseline
//   - "<git-sha-or-label>" → exact match
//   - "HEAD~N"   → resolve via git, then exact match
export function resolveBaselineRef({ outputRoot, ref, repoRoot }) {
    if (!ref) return null;
    if (ref === 'auto') {
        const list = listBaselines(outputRoot);
        return list[0]?.ref || null;
    }
    if (ref.startsWith('HEAD') && repoRoot) {
        try {
            const sha = execSync(`git rev-parse --short ${ref}`, {
                cwd: repoRoot,
                stdio: ['ignore', 'pipe', 'ignore'],
            })
                .toString()
                .trim();
            return sha;
        } catch {
            return null;
        }
    }
    return ref;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}
