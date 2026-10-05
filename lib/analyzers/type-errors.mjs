// Type-aware analyzer: runs tsc --noEmit and parses errors.
// Also greps each walked file for `any` and `@ts-ignore` / `@ts-expect-error`.
//
// This analyzer is best-effort. tsc may not be installed, the project may not
// have a tsconfig, or it may take many seconds on big repos. We surface what
// we can and skip the rest.

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'type-errors';

const TSC_LINE_RX = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/;
const ANY_RX = /\b:\s*any\b|\bas\s+any\b|<any[>,]/g;
const TS_IGNORE_RX = /@ts-ignore\b/g;
const TS_EXPECT_RX = /@ts-expect-error\b/g;

export async function run({ root, walk, cfg = {} }) {
    const { runTsc = true, tsconfig = null, bin = 'npx --no-install tsc' } = cfg;

    const findings = [];
    const counts = new Map();

    // ── 1. tsc --noEmit, parse errors ──────────────────────────────────
    if (runTsc && hasTsconfig(root, tsconfig)) {
        const cmd = `${bin} --noEmit --pretty false${tsconfig ? ` --project ${tsconfig}` : ''}`;
        let stdout = '';
        try {
            stdout = execSync(cmd, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
        } catch (err) {
            stdout = err.stdout?.toString() || '';
        }
        for (const line of stdout.split('\n')) {
            const m = line.match(TSC_LINE_RX);
            if (!m) continue;
            const [, file, lineNum, , kind, code, msg] = m;
            const sev = kind === 'error' ? 'medium' : 'low';
            const rel = file.startsWith(root) ? relative(root, file) : file;
            findings.push(
                makeFinding({
                    kind: 'type-error',
                    file: rel,
                    line: parseInt(lineNum, 10),
                    message: `${code}: ${msg}`,
                    severity: sev,
                    score: 1,
                    meta: { ts_code: code },
                }),
            );
            bump(counts, rel, 'type_errors');
        }
    }

    // ── 2. any / @ts-ignore / @ts-expect-error per walked file ─────────
    const files = walkSourceFiles(walk);
    for (const f of files) {
        let code;
        try {
            code = readFileSync(f, 'utf-8');
        } catch {
            continue;
        }
        const rel = relative(root, f);
        const anyCount = countMatches(code, ANY_RX);
        const ignoreCount = countMatches(code, TS_IGNORE_RX);
        const expectCount = countMatches(code, TS_EXPECT_RX);

        if (anyCount > 0) {
            const sev = anyCount >= 10 ? 'medium' : 'low';
            findings.push(
                makeFinding({
                    kind: 'any-usage',
                    file: rel,
                    message: `${anyCount} \`any\` annotation(s)`,
                    severity: sev,
                    score: anyCount,
                    meta: { count: anyCount },
                }),
            );
            bump(counts, rel, 'any_count', anyCount);
        }
        if (ignoreCount > 0 || expectCount > 0) {
            findings.push(
                makeFinding({
                    kind: 'ts-ignore',
                    file: rel,
                    message: `${ignoreCount} @ts-ignore + ${expectCount} @ts-expect-error`,
                    severity: ignoreCount > 0 ? 'medium' : 'low',
                    score: ignoreCount + expectCount,
                    meta: { ts_ignore: ignoreCount, ts_expect_error: expectCount },
                }),
            );
            bump(counts, rel, 'ts_ignore', ignoreCount + expectCount);
        }
    }

    const rawSignals = new Map();
    for (const [file, sig] of counts.entries()) rawSignals.set(file, sig);

    return {
        findings,
        rawSignals,
        stats: {
            tsc_ran: runTsc && hasTsconfig(root, tsconfig),
            findings: findings.length,
            files_with_any: [...counts.values()].filter((s) => s.any_count).length,
        },
    };
}

function hasTsconfig(root, override) {
    if (override) return existsSync(override);
    return ['tsconfig.json', 'tsconfig.base.json'].some((f) => existsSync(join(root, f)));
}

function countMatches(s, rx) {
    rx.lastIndex = 0;
    let n = 0;
    while (rx.exec(s) !== null) n++;
    return n;
}

function bump(map, file, key, by = 1) {
    const cur = map.get(file) || {};
    cur[key] = (cur[key] || 0) + by;
    map.set(file, cur);
}
