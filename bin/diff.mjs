#!/usr/bin/env node
// Diff two analysis runs.
//
//   node bin/diff.mjs --base path/to/base/output --head path/to/head/output --out diff.md
//
// Or convenience wrapper that runs analyze on a git ref and diffs:
//   node bin/diff.mjs --root <repo> --since main --include src --analyzers ... --out diff.md

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join, dirname } from 'path';
import { execSync } from 'child_process';
import { parseArgs } from '../lib/args.mjs';
import { diffReports, renderDiffMarkdown } from '../lib/core/diff.mjs';

const args = parseArgs();
const out = args.out ? resolve(args.out) : null;
const outJson = args['out-json'] ? resolve(args['out-json']) : null;

let baseDoc, headDoc, baseScorecard, headScorecard;

if (args.base && args.head) {
    // Static diff: two pre-computed output dirs
    baseDoc = readJson(join(resolve(args.base), 'findings.json'));
    headDoc = readJson(join(resolve(args.head), 'findings.json'));
    baseScorecard = readJson(join(resolve(args.base), 'scorecard.json'));
    headScorecard = readJson(join(resolve(args.head), 'scorecard.json'));
} else if (args.root && args.since) {
    // Dynamic diff: run analyze on `since` commit, then on HEAD
    const root = resolve(args.root);
    const since = args.since;
    const tmp = mkdtempSync(join(tmpdir(), 'analyze-diff-'));
    const baseDir = join(tmp, 'base');
    const headDir = join(tmp, 'head');
    mkdirSync(baseDir, { recursive: true });
    mkdirSync(headDir, { recursive: true });

    const passthrough = passthroughArgs(args);

    // Validate ref exists before attempting worktree
    let sha, headSha;
    try {
        sha = execSync(`git rev-parse --verify ${JSON.stringify(since)}^{commit}`, {
            cwd: root, encoding: 'utf-8',
        }).trim();
    } catch {
        console.error(`Cannot resolve --since "${since}". Try \`git fetch\` or pass a valid ref/sha.`);
        process.exit(2);
    }
    try {
        headSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf-8' }).trim();
    } catch {
        console.error(`${root} does not appear to be a git repository.`);
        process.exit(2);
    }

    if (sha === headSha) {
        console.error(`Base and head are the same commit (${sha.slice(0, 8)}). Nothing to diff.`);
        process.exit(0);
    }

    // Warn (not fail) on dirty tree — head pass will run against the working copy
    let dirty = false;
    try {
        const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' });
        dirty = !!status.trim();
    } catch {}
    if (dirty) {
        console.error(`Note: working tree has uncommitted changes; HEAD analysis includes them.`);
    }

    console.error(`Diffing ${sha.slice(0, 8)} (base) vs ${headSha.slice(0, 8)} (head)`);

    // Use git worktree for base
    const wt = mkdtempSync(join(tmpdir(), 'analyze-wt-'));
    try {
        execSync(`git worktree add --quiet --detach "${wt}" ${sha}`, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
        const msg = err.stderr?.toString() || err.message;
        console.error(`Failed to create worktree at ${wt}: ${msg}`);
        try { rmSync(wt, { recursive: true, force: true }); } catch {}
        process.exit(2);
    }
    try {
        const analyze = `${process.execPath} ${join(dirname(process.argv[1]), 'analyze.mjs')}`;
        execSync(`${analyze} --root "${wt}" ${passthrough} --out-dir "${baseDir}"`, { stdio: 'inherit' });
        execSync(`${analyze} --root "${root}" ${passthrough} --out-dir "${headDir}"`, { stdio: 'inherit' });
    } finally {
        try { execSync(`git worktree remove --force "${wt}"`, { cwd: root, stdio: 'ignore' }); } catch {}
        try { rmSync(wt, { recursive: true, force: true }); } catch {}
    }
    baseDoc = readJson(join(baseDir, 'findings.json'));
    headDoc = readJson(join(headDir, 'findings.json'));
    baseScorecard = readJson(join(baseDir, 'scorecard.json'));
    headScorecard = readJson(join(headDir, 'scorecard.json'));
} else {
    console.error('Usage: --base DIR --head DIR  |  --root REPO --since REF [analyze args]');
    process.exit(1);
}

const diff = diffReports(baseDoc, headDoc, baseScorecard, headScorecard);
const md = renderDiffMarkdown(diff);

if (out) {
    if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, md);
    console.error(`Wrote ${out}`);
} else {
    console.log(md);
}
if (outJson) {
    if (!existsSync(dirname(outJson))) mkdirSync(dirname(outJson), { recursive: true });
    writeFileSync(outJson, JSON.stringify(diff, null, 2));
    console.error(`Wrote ${outJson}`);
}

console.error(
    `Net: ${diff.counts.net >= 0 ? '+' : ''}${diff.counts.net} findings, ` +
    `painscore total ${diff.totals.before} → ${diff.totals.after} (${diff.totals.delta >= 0 ? '+' : ''}${diff.totals.delta})`,
);

function readJson(p) {
    if (!existsSync(p)) {
        console.error(`Missing ${p}`);
        process.exit(1);
    }
    return JSON.parse(readFileSync(p, 'utf-8'));
}

function passthroughArgs(a) {
    const skip = new Set(['_', 'base', 'head', 'root', 'since', 'out', 'out-json', 'out-dir']);
    const parts = [];
    for (const [k, v] of Object.entries(a)) {
        if (skip.has(k) || k === '_') continue;
        if (v === true) parts.push(`--${k}`);
        else parts.push(`--${k}`, JSON.stringify(v));
    }
    return parts.join(' ');
}
