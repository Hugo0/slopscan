// Lint analyzer. Either:
//   - parses a pre-computed eslint --format json file (--eslint-json path)
//   - or runs `npx eslint --format json` on demand (slower)

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, relative } from 'path';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'lint';

export async function run({ root, walk, cfg = {} }) {
    const { eslintJsonPath, runEslint = false, bin = 'npx eslint' } = cfg;

    let report;
    if (eslintJsonPath) {
        const path = resolve(eslintJsonPath);
        if (!existsSync(path)) {
            return { findings: [], rawSignals: new Map(), stats: { error: `missing ${path}` } };
        }
        try {
            report = JSON.parse(readFileSync(path, 'utf-8'));
        } catch (err) {
            return { findings: [], rawSignals: new Map(), stats: { error: 'parse: ' + err.message } };
        }
    } else if (runEslint) {
        // Run eslint over walked file extensions
        const exts = (walk?.extensions || ['.ts', '.tsx', '.js', '.jsx']).join(',');
        try {
            const stdout = execSync(`${bin} --format json --ext ${exts} .`, {
                cwd: root,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'pipe'],
                maxBuffer: 256 * 1024 * 1024,
            });
            report = JSON.parse(stdout);
        } catch (err) {
            // eslint exits 1 on lint errors but stdout still has JSON
            if (err.stdout) {
                try {
                    report = JSON.parse(err.stdout.toString());
                } catch (e2) {
                    return { findings: [], rawSignals: new Map(), stats: { error: 'parse: ' + e2.message } };
                }
            } else {
                return { findings: [], rawSignals: new Map(), stats: { error: String(err.message || err) } };
            }
        }
    } else {
        return { findings: [], rawSignals: new Map(), stats: { skipped: 'no --eslint-json and --run-eslint not set' } };
    }

    const findings = [];
    const counts = new Map();

    for (const fileResult of report) {
        const filePath = fileResult.filePath;
        if (!filePath) continue;
        const rel = filePath.startsWith(root) ? relative(root, filePath) : filePath;

        let errN = 0, warnN = 0;
        for (const m of fileResult.messages || []) {
            const sev = m.severity === 2 ? 'medium' : 'low';
            const kind = m.severity === 2 ? 'lint-error' : 'lint-warning';
            findings.push(
                makeFinding({
                    kind,
                    file: rel,
                    line: m.line,
                    message: `${m.ruleId || 'parse'}: ${m.message}`,
                    severity: sev,
                    score: 1,
                    meta: { rule: m.ruleId, severity_num: m.severity },
                }),
            );
            if (m.severity === 2) errN++;
            else warnN++;
        }
        if (errN || warnN) {
            counts.set(rel, { lint_errors: errN, lint_warnings: warnN });
        }
    }

    const rawSignals = new Map();
    for (const [file, sig] of counts.entries()) rawSignals.set(file, sig);

    return {
        findings,
        rawSignals,
        stats: {
            files_with_lint: counts.size,
            findings: findings.length,
        },
    };
}
