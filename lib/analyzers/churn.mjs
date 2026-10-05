// Git-churn analyzer. Per-file:
//   - commit_count (in window)
//   - lines_added / lines_deleted
//   - last_modified (days ago)
//   - hotspot_score = log(commits) × cyclomatic (computed in painscore stage)
//
// Emits 'hotspot' findings for top files; rawSignals exposes churn per file.

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { relative } from 'path';
import { walkSourceFiles } from '../walker.mjs';
import { makeFinding } from '../core/findings.mjs';

export const NAME = 'churn';

export async function run({ root, walk, cfg = {} }) {
    const { since = '6 months ago', topN = 30, hotspotMinChurn = 5 } = cfg;

    if (!isGitRepo(root)) {
        return { findings: [], rawSignals: new Map(), stats: { skipped: 'not a git repo' } };
    }

    // Restrict git log to walked dirs — saves enormous time on repos with
    // huge non-source history (e.g. data/, public/) that we'd discard anyway.
    const pathArgs = (walk.include || [])
        .map((d) => `'${d}'`)
        .join(' ');
    const pathSpec = pathArgs ? ` -- ${pathArgs}` : '';

    // Get commit/line stats per file via git log --numstat
    let logOut;
    try {
        logOut = execSync(
            `git log --since="${since}" --pretty=format:'%H' --numstat --no-renames${pathSpec}`,
            { cwd: root, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 },
        );
    } catch (err) {
        return { findings: [], rawSignals: new Map(), stats: { error: String(err.message || err) } };
    }

    const churn = new Map(); // relPath → { commits, added, deleted }
    let currentSha = null;
    const seenInCommit = new Set();
    for (const line of logOut.split('\n')) {
        if (!line.trim()) continue;
        if (!line.includes('\t')) {
            currentSha = line.trim();
            seenInCommit.clear();
            continue;
        }
        const [a, d, path] = line.split('\t');
        if (!path) continue;
        if (seenInCommit.has(path)) continue;
        seenInCommit.add(path);
        const added = parseInt(a, 10) || 0;
        const deleted = parseInt(d, 10) || 0;
        const cur = churn.get(path) || { commits: 0, added: 0, deleted: 0 };
        cur.commits++;
        cur.added += added;
        cur.deleted += deleted;
        churn.set(path, cur);
    }

    // Last-modified per file (epoch)
    let lastMod = new Map();
    try {
        const mtimeOut = execSync(
            `git log --since="${since}" --pretty=format:'%H %ct' --name-only --no-renames${pathSpec}`,
            { cwd: root, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 },
        );
        let curTs = null;
        for (const line of mtimeOut.split('\n')) {
            if (!line.trim()) continue;
            if (line.match(/^[0-9a-f]+\s\d+$/)) {
                curTs = parseInt(line.split(' ')[1], 10);
            } else if (curTs && !lastMod.has(line)) {
                lastMod.set(line, curTs);
            }
        }
    } catch {}

    // Restrict to walked files
    const walked = new Set(walkSourceFiles(walk).map((p) => relative(root, p)));
    const findings = [];
    const rawSignals = new Map();

    const ranked = [];
    for (const [path, c] of churn) {
        if (!walked.has(path)) continue;
        const totalChurn = c.added + c.deleted;
        rawSignals.set(path, {
            churn: c.commits,
            churn_lines: totalChurn,
            commits: c.commits,
            lines_added: c.added,
            lines_deleted: c.deleted,
        });
        ranked.push({ path, ...c, totalChurn });
    }

    ranked.sort((a, b) => b.commits - a.commits);
    for (const r of ranked.slice(0, topN)) {
        if (r.commits < hotspotMinChurn) break;
        const sev = r.commits >= 30 ? 'high' : r.commits >= 15 ? 'medium' : 'low';
        findings.push(
            makeFinding({
                kind: 'hotspot',
                file: r.path,
                message: `${r.commits} commits, +${r.added}/-${r.deleted} lines since ${since}`,
                severity: sev,
                score: r.commits,
                meta: {
                    commits: r.commits,
                    lines_added: r.added,
                    lines_deleted: r.deleted,
                    last_mod_epoch: lastMod.get(r.path) || null,
                },
            }),
        );
    }

    return {
        findings,
        rawSignals,
        stats: {
            window: since,
            files_with_churn: churn.size,
            top_emit: Math.min(topN, ranked.length),
        },
    };
}

function isGitRepo(dir) {
    try {
        execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}
