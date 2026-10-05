// Dead-code detection via knip. Emits findings for unused exports, files,
// dependencies, and bindings. knip auto-detects Next.js / Nuxt / Vite / etc.
//
// knip must be run from the target repo's working dir (it reads project config).
// We invoke it as a subprocess and parse JSON.

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { bundledBin } from '../core/bin.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'dead-code';

export async function run({ root, cfg = {} }) {
    const { bin = bundledBin('knip'), includeProductionOnly = false, ignoreDeps = false } = cfg;
    const findings = [];
    const counts = new Map();

    // knip loads the project's own config files (vite/next/nuxt/...) and
    // resolves dependencies, so it needs the target's dependencies installed.
    if (!existsSync(join(root, 'node_modules'))) {
        return {
            findings: [],
            rawSignals: new Map(),
            stats: { skipped: true, skippedReason: 'no node_modules in target — install its dependencies to enable dead-code' },
        };
    }

    // knip has its own filtering via .knip.json or knip.config.{js,ts}.
    // We rely on the target repo's config; if absent, knip uses its own heuristics.
    const reporter = '--reporter json';
    const flags = [
        reporter,
        includeProductionOnly ? '--production' : '',
        ignoreDeps ? '--no-deps' : '',
    ].filter(Boolean).join(' ');
    const cmd = `${bin} ${flags}`;

    let report;
    try {
        const stdout = execSync(cmd, {
            cwd: root,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024,
        });
        report = JSON.parse(stdout);
    } catch (err) {
        // knip exits nonzero when issues found — stdout still has JSON
        if (err.stdout) {
            try {
                report = JSON.parse(err.stdout.toString());
            } catch (e2) {
                const detail = (err.stderr?.toString() || err.stdout.toString()).split('\n').find(Boolean) || e2.message;
                return { findings: [], rawSignals: new Map(), stats: { error: 'knip failed: ' + detail.slice(0, 300) } };
            }
        } else {
            return { findings: [], rawSignals: new Map(), stats: { error: String(err.message || err) } };
        }
    }

    if (!report) return { findings: [], rawSignals: new Map(), stats: { error: 'no report' } };

    // knip v6 JSON shape: { issues: [{ file, files?, exports?, types?,
    //   enumMembers?, classMembers?, dependencies?, devDependencies?,
    //   unlisted?, unresolved?, duplicates? }, ...] }
    const arr = (v) => (Array.isArray(v) ? v : []);
    const issues = arr(report.issues);
    let unusedFileCount = 0;
    let unusedDepCount = 0;

    for (const issue of issues) {
        const file = issue.file;
        if (!file) continue;

        // Unused file: knip emits {file: path, files: [{name: path}]} when a
        // whole file is unused.
        if (Array.isArray(issue.files) && issue.files.length > 0) {
            findings.push(
                makeFinding({
                    kind: 'unused-file',
                    file,
                    message: 'File appears unused (no import path)',
                    severity: 'medium',
                    score: 1,
                }),
            );
            bump(counts, file, 'unused_file');
            unusedFileCount++;
        }

        for (const e of arr(issue.exports)) {
            const name = e.name || e;
            const line = e.line || null;
            findings.push(
                makeFinding({
                    kind: 'unused-export',
                    file,
                    line,
                    message: `unused export: ${name}`,
                    severity: 'low',
                    score: 1,
                    meta: { name, symbol_kind: 'export' },
                }),
            );
            bump(counts, file, 'unused_export');
        }
        for (const e of arr(issue.types)) {
            const name = e.name || e;
            findings.push(
                makeFinding({
                    kind: 'unused-export',
                    file,
                    line: e.line || null,
                    message: `unused type: ${name}`,
                    severity: 'low',
                    score: 1,
                    meta: { name, symbol_kind: 'type' },
                }),
            );
            bump(counts, file, 'unused_export');
        }
        for (const e of arr(issue.enumMembers)) {
            const name = e.name || e;
            findings.push(
                makeFinding({
                    kind: 'unused-binding',
                    file,
                    line: e.line || null,
                    message: `unused enum member: ${name}`,
                    severity: 'low',
                    score: 1,
                }),
            );
            bump(counts, file, 'unused_binding');
        }
        for (const e of arr(issue.classMembers)) {
            const name = e.name || e;
            findings.push(
                makeFinding({
                    kind: 'unused-binding',
                    file,
                    line: e.line || null,
                    message: `unused class member: ${name}`,
                    severity: 'low',
                    score: 1,
                }),
            );
            bump(counts, file, 'unused_binding');
        }

        // Deps live on the package.json issue
        for (const d of arr(issue.dependencies)) {
            const name = d.name || d;
            if (!name) continue;
            findings.push(
                makeFinding({
                    kind: 'unused-dep',
                    file,
                    line: d.line || null,
                    message: `unused dependency: ${name}`,
                    severity: 'low',
                    score: 1,
                    meta: { dep_name: name },
                }),
            );
            unusedDepCount++;
        }
        for (const d of arr(issue.devDependencies)) {
            const name = d.name || d;
            if (!name) continue;
            findings.push(
                makeFinding({
                    kind: 'unused-dep',
                    file,
                    line: d.line || null,
                    message: `unused devDependency: ${name}`,
                    severity: 'info',
                    score: 1,
                    meta: { dep_name: name, is_dev: true },
                }),
            );
            unusedDepCount++;
        }
    }

    const rawSignals = new Map();
    for (const [file, sig] of counts.entries()) rawSignals.set(file, sig);

    return {
        findings,
        rawSignals,
        stats: {
            unused_files: unusedFileCount,
            issues: issues.length,
            unused_deps: unusedDepCount,
            findings: findings.length,
        },
    };
}

function bump(map, file, key) {
    const cur = map.get(file) || {};
    cur[key] = (cur[key] || 0) + 1;
    map.set(file, cur);
}
