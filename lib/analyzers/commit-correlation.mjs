// Historical commit correlation — backend concepts that changed without
// matching frontend updates. Indicates places where the API contract evolved
// but the UI hasn't caught up.
//
// Heuristic: for each commit in repo A (typically API) touching routes or
// schemas, find any commit in repo B (UI) within ±N days that mentions a
// shared concept (path component or subject keyword). Commits without any
// match → "orphan" → likely contract drift.
//
// Use:
//   cfg.crossRoots: [{root: api, label}, {root: ui, label}]
//   cfg.since: "6 months ago"
//   cfg.windowDays: 60

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'commit-correlation';

const STOP_WORDS = new Set([
    'this', 'that', 'with', 'from', 'into', 'have', 'been', 'were', 'what', 'will',
    'feat', 'fix', 'chore', 'test', 'docs', 'bump', 'merge', 'refactor', 'update', 'added', 'adding',
]);
const SKIP_PATH_COMPONENTS = new Set(['src', 'routes', 'index', 'utils', 'types', 'consts']);

export async function run({ cfg = {} }) {
    const { crossRoots = [], since = '6 months ago', windowDays = 60, apiPathFilter } = cfg;
    if (crossRoots.length !== 2) {
        return { findings: [], rawSignals: new Map(), stats: { skipped: 'needs cfg.crossRoots: [{root, label}, {root, label}]' } };
    }
    const [api, ui] = crossRoots;
    if (!existsSync(api.root) || !existsSync(ui.root)) {
        return { findings: [], rawSignals: new Map(), stats: { error: 'one of crossRoots missing' } };
    }

    const apiCommits = fetchCommits(api.root, since, apiPathFilter);
    const uiCommits = fetchCommits(ui.root, since);

    const findings = [];
    const windowMs = windowDays * 86400 * 1000;
    for (const c of apiCommits) {
        const concepts = extractConcepts(c);
        const candidates = uiCommits.filter((u) => Math.abs((u.ts - c.ts) * 1000) <= windowMs);
        const match = candidates.find((u) => uiMatches(u, concepts));
        if (!match) {
            findings.push(makeFinding({
                kind: 'orphan-backend-change',
                file: c.files[0] || 'unknown',
                message: `API commit ${c.hash.slice(0, 8)} (${truncate(c.subject, 60)}) had no matching UI commit within ${windowDays}d`,
                severity: 'medium',
                score: 1,
                refs: c.files.slice(0, 5).map((f) => ({ file: f })),
                meta: { hash: c.hash, ts: c.ts, subject: c.subject, file_count: c.files.length, concepts },
            }));
        }
    }

    return {
        findings,
        rawSignals: new Map(),
        stats: { api_commits: apiCommits.length, ui_commits: uiCommits.length, orphans: findings.length },
    };
}

function fetchCommits(root, since, pathFilter) {
    const filter = pathFilter ? ` -- ${pathFilter}` : '';
    let log = '';
    try {
        log = execSync(
            `git log --since="${since}" --format="%H|%ct|%s" --name-only${filter}`,
            { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
        );
    } catch {
        return [];
    }
    const commits = [];
    let current = null;
    for (const line of log.split('\n')) {
        const m = line.match(/^([a-f0-9]{40})\|(\d+)\|(.*)$/);
        if (m) {
            if (current) commits.push(current);
            current = { hash: m[1], ts: parseInt(m[2], 10), subject: m[3], files: [] };
        } else if (line.trim() && current) {
            current.files.push(line.trim());
        }
    }
    if (current) commits.push(current);
    return commits;
}

function extractConcepts(commit) {
    const concepts = new Set();
    const words = commit.subject.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
    for (const w of words) concepts.add(w);
    for (const file of commit.files) {
        for (const p of file.split('/')) {
            const base = p.replace(/\.(ts|tsx|js|prisma)$/, '').toLowerCase();
            if (base.length > 3 && !SKIP_PATH_COMPONENTS.has(base)) concepts.add(base);
        }
    }
    return [...concepts];
}

function uiMatches(uiCommit, concepts) {
    const haystack = (uiCommit.subject + ' ' + uiCommit.files.join(' ')).toLowerCase();
    return concepts.some((c) => haystack.includes(c));
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
