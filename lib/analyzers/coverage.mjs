// Coverage analyzer. Reads an istanbul/c8 lcov.info or coverage-final.json
// and emits per-file low-coverage findings.

import { existsSync, readFileSync } from 'fs';
import { resolve, relative } from 'path';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'coverage';

export async function run({ root, cfg = {} }) {
    const { lcovPath, lowThreshold = 50 } = cfg;

    if (!lcovPath) {
        return { findings: [], rawSignals: new Map(), stats: { skipped: 'no --coverage-lcov path' } };
    }
    const path = resolve(lcovPath);
    if (!existsSync(path)) {
        return { findings: [], rawSignals: new Map(), stats: { error: `missing ${path}` } };
    }

    const raw = readFileSync(path, 'utf-8');
    const findings = [];
    const rawSignals = new Map();

    let curFile = null;
    let lf = 0, lh = 0; // lines found, lines hit
    for (const line of raw.split('\n')) {
        if (line.startsWith('SF:')) {
            curFile = line.slice(3).trim();
            lf = 0;
            lh = 0;
        } else if (line.startsWith('LF:')) {
            lf = parseInt(line.slice(3), 10) || 0;
        } else if (line.startsWith('LH:')) {
            lh = parseInt(line.slice(3), 10) || 0;
        } else if (line.startsWith('end_of_record')) {
            if (curFile && lf > 0) {
                const pct = (lh / lf) * 100;
                const rel = curFile.startsWith(root) ? relative(root, curFile) : curFile;
                rawSignals.set(rel, { coverage_pct: pct, low_coverage: pct < lowThreshold ? 1 : 0 });
                if (pct < lowThreshold) {
                    findings.push(
                        makeFinding({
                            kind: 'low-coverage',
                            file: rel,
                            message: `Coverage ${pct.toFixed(1)}% (${lh}/${lf} lines)`,
                            severity: pct < 25 ? 'high' : pct < 40 ? 'medium' : 'low',
                            score: Math.round(100 - pct),
                            meta: { coverage_pct: pct, lines_hit: lh, lines_found: lf },
                        }),
                    );
                }
            }
            curFile = null;
        }
    }

    return {
        findings,
        rawSignals,
        stats: { lcov_path: lcovPath, files: rawSignals.size, low: findings.length },
    };
}
