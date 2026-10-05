// Supply-chain analyzer. Wraps npm/pnpm audit --json and emits per-vuln findings.
// Plus dep-health checks: outdated, deprecated, duplicates.
//
// Auto-detects package manager (pnpm > npm). Skips gracefully if no manager
// available or no advisories.
//
// cfg.deprecatedList: caller-provided list of deps to flag as deprecated.
// cfg.skipOutdated: true to skip the (slow) outdated check.

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'supply-chain';

const SEV_MAP = {
    critical: 'critical',
    high: 'high',
    moderate: 'medium',
    low: 'low',
    info: 'info',
};

export async function run({ root, cfg = {} }) {
    const manager = detectManager(root, cfg.manager);
    if (!manager) {
        return { findings: [], rawSignals: new Map(), stats: { skipped: 'no package manager lockfile' } };
    }

    let report;
    const cmd = manager === 'pnpm' ? 'pnpm audit --json' : 'npm audit --json';
    try {
        const stdout = execSync(cmd, {
            cwd: root,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024,
        });
        report = JSON.parse(stdout);
    } catch (err) {
        // Both managers exit nonzero on advisories; stdout still has JSON.
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

    const findings = [];

    if (manager === 'npm') {
        // npm audit shape: { vulnerabilities: { name: {severity, via, ...} } }
        const vulns = report.vulnerabilities || {};
        for (const [name, v] of Object.entries(vulns)) {
            findings.push(makeAdvisoryFinding({ name, severity: v.severity, via: v.via, range: v.range }));
        }
    } else {
        // pnpm audit shape: { advisories: { id: {module_name, severity, ...} } }
        const adv = report.advisories || {};
        for (const a of Object.values(adv)) {
            findings.push(
                makeAdvisoryFinding({
                    name: a.module_name,
                    severity: a.severity,
                    via: a.title,
                    range: a.vulnerable_versions,
                    cwe: a.cwe,
                    url: a.url,
                }),
            );
        }
    }

    // ── Dep health: outdated + deprecated + duplicates ──────────────────
    const advisoryCount = findings.length;

    // Deprecated check: caller-provided list (codebase-agnostic; presets
    // can supply their own kill-list).
    const pkgPath = join(root, 'package.json');
    if ((cfg.deprecatedList?.length || 0) > 0 && existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            const installed = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            for (const dep of cfg.deprecatedList) {
                if (installed[dep]) {
                    findings.push(
                        makeFinding({
                            kind: 'deprecated-dep',
                            file: 'package.json',
                            message: `\`${dep}\` is on the deprecated/kill list`,
                            severity: 'medium',
                            score: 1,
                            meta: { name: dep, version: installed[dep] },
                        }),
                    );
                }
            }
        } catch {}
    }

    // Outdated check
    let outdatedCount = 0;
    if (!cfg.skipOutdated) {
        const outdatedCmd = manager === 'pnpm' ? 'pnpm outdated --format json' : 'npm outdated --json';
        try {
            let stdout = '';
            try {
                stdout = execSync(outdatedCmd, {
                    cwd: root, encoding: 'utf-8',
                    stdio: ['ignore', 'pipe', 'pipe'],
                    maxBuffer: 64 * 1024 * 1024,
                });
            } catch (err) {
                stdout = err.stdout?.toString() || '';
            }
            if (stdout.trim()) {
                const outdated = JSON.parse(stdout);
                // npm shape: { name: {current, wanted, latest, ...} }
                // pnpm shape: { name: {current, wanted, latest, ...} } (similar)
                const entries = Array.isArray(outdated) ? outdated : Object.entries(outdated).map(([name, v]) => ({ name, ...v }));
                for (const e of entries) {
                    const name = e.name || e.packageName;
                    const current = e.current ?? '?';
                    const latest = e.latest ?? '?';
                    if (!name || current === latest) continue;
                    const majorBehind = isMajorBehind(current, latest);
                    findings.push(
                        makeFinding({
                            kind: 'outdated-dep',
                            file: 'package.json',
                            message: `${name}: ${current} → ${latest}${majorBehind ? ' (major version behind)' : ''}`,
                            severity: majorBehind ? 'low' : 'info',
                            score: majorBehind ? 2 : 1,
                            meta: { name, current, latest, major_behind: majorBehind },
                        }),
                    );
                    outdatedCount++;
                }
            }
        } catch {}
    }

    return {
        findings,
        rawSignals: new Map(),
        stats: {
            manager,
            advisories: advisoryCount,
            outdated: outdatedCount,
            findings: findings.length,
        },
    };
}

function isMajorBehind(current, latest) {
    if (!current || !latest) return false;
    const cMajor = parseInt(String(current).split('.')[0], 10);
    const lMajor = parseInt(String(latest).split('.')[0], 10);
    return Number.isFinite(cMajor) && Number.isFinite(lMajor) && lMajor > cMajor;
}

function makeAdvisoryFinding({ name, severity, via, range, cwe, url }) {
    const sev = SEV_MAP[severity] || 'medium';
    let viaStr = '';
    if (Array.isArray(via)) viaStr = via.map((v) => (typeof v === 'string' ? v : v.title || v.name)).join(', ');
    else if (via) viaStr = String(via);
    return makeFinding({
        kind: 'cve',
        file: 'package.json',
        message: `${name}${range ? `@${range}` : ''}: ${viaStr || severity}`,
        severity: sev,
        score: SEV_MAP[severity] === 'critical' ? 4 : SEV_MAP[severity] === 'high' ? 3 : 1,
        meta: { name, severity, via: viaStr, range, cwe, url },
    });
}

function detectManager(root, override) {
    if (override) return override;
    if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(root, 'package-lock.json'))) return 'npm';
    if (existsSync(join(root, 'yarn.lock'))) return 'npm'; // yarn audit different shape; fall back to npm
    return null;
}
