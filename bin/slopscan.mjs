#!/usr/bin/env node
// slopscan — find complexity, duplication, dead code and other slop in a JS/TS repo.
//
//   npx slopscan [path] [--out dir] [--preset react-next|node-ts|vue-nuxt|./my-preset.mjs]
//                [--no-semantic] [--analyzers a,b | +a,-b] [--baseline auto|<ref>]
//                [--save-baseline] [--llm-review] [--env-file path] [--since "6 months ago"]
//
// Output (default ./slopscan-report/):
//   index.html        interactive dashboard
//   SUMMARY.md        action items in markdown
//   index.json        machine-readable rollup
//   <label>/          raw findings.json / scorecard.json / stats.json / dashboard.html
//   .cache/           embeddings + AST cache (safe to delete)
//   baselines/<ref>/  saved snapshots for --baseline comparisons

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { parseArgs } from '../lib/args.mjs';
import { renderMultiDashboard } from '../lib/render/html-multi.mjs';
import { buildActionItems, renderActionItemsMd } from '../lib/render/action-items.mjs';
import { runLlmReview } from '../lib/llm-review.mjs';
import {
    saveBaseline,
    loadBaseline,
    computeDelta,
    resolveBaselineRef,
    gitShortSha,
    gitBranch,
    listBaselines,
} from '../lib/core/baseline.mjs';
import { detectPreset, PRESETS } from '../presets/detect.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const toolRoot = resolve(here, '..');
const args = parseArgs();

if (args.help || args.h) {
    printHelp();
    process.exit(0);
}
if (args.version || args.v) {
    console.log(JSON.parse(readFileSync(join(toolRoot, 'package.json'), 'utf-8')).version);
    process.exit(0);
}

const root = resolve(args._[0] || args.root || '.');
if (!existsSync(root)) {
    console.error(`Path not found: ${root}`);
    process.exit(1);
}
const outputRoot = resolve(args.out && args.out !== true ? args.out : 'slopscan-report');
const preset = args.preset && args.preset !== true ? args.preset : detectPreset(root);
const label = sanitizeLabel(args.label && args.label !== true ? args.label : repoName(root));
const runOut = join(outputRoot, label);
const cacheDir = join(outputRoot, '.cache');
const baselineRefArg = args.baseline === true ? 'auto' : args.baseline;

mkdirSync(runOut, { recursive: true });
console.log(`slopscan ${root}`);
console.log(`   preset: ${preset}${args.preset ? '' : ' (auto-detected)'}`);
console.log(`   output: ${outputRoot}`);

// ----- run the analyzers (bin/analyze.mjs does the work; we forward flags)
const OWN_FLAGS = new Set(['out', 'preset', 'label', 'root', 'baseline', 'save-baseline', 'llm-review', 'llm-top-n']);
const forwarded = [];
for (const [k, v] of Object.entries(args)) {
    if (k === '_' || OWN_FLAGS.has(k)) continue;
    forwarded.push(`--${k}`);
    if (v !== true) forwarded.push(String(v));
}
await runNode(join(toolRoot, 'bin', 'analyze.mjs'), [
    '--root', root,
    '--preset', preset,
    '--label', label,
    '--cache', cacheDir,
    '--out-dir', runOut,
    '--parallel',
    ...forwarded,
]);

const doc = readJSON(join(runOut, 'findings.json'));
const scorecard = readJSON(join(runOut, 'scorecard.json'));
const stats = readJSON(join(runOut, 'stats.json')) || {};
if (!doc || !scorecard) {
    console.error('Analysis produced no findings/scorecard — see errors above.');
    process.exit(1);
}
const run = { label, doc, scorecard, stats };
run.actions = buildActionItems({ scorecard, doc, topN: 25 });

// ----- optional LLM review of the top hot-spots (Anthropic API)
if (args['llm-review']) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        console.warn('--llm-review requested but ANTHROPIC_API_KEY is not set. Skipping.');
    } else if (scorecard.files.length) {
        const topN = parseInt(args['llm-top-n'] || '10', 10);
        console.log(`\nLLM review (top ${topN})`);
        try {
            const result = await runLlmReview({
                scorecard, doc, root, topN, apiKey,
                cacheDir: join(cacheDir, 'llm-review', label),
                onProgress: ({ done, total }) => process.stderr.write(`\r   ${done}/${total}`),
            });
            process.stderr.write('\n');
            doc.findings = [...doc.findings, ...result.findings];
            doc.count = doc.findings.length;
            stats['llm-review'] = { findings: result.findings.length, elapsed_ms: 0, ...result.stats };
            run.actions = buildActionItems({ scorecard, doc, topN: 25 });
        } catch (err) {
            console.warn(`   LLM review failed: ${err.message}`);
        }
    }
}

// ----- baselines
const sha = gitShortSha(root);
const branch = gitBranch(root);
const resolvedBaseline = baselineRefArg ? resolveBaselineRef({ outputRoot, ref: baselineRefArg, repoRoot: root }) : null;
if (resolvedBaseline) {
    const baseline = loadBaseline({ outputRoot, ref: resolvedBaseline, runLabel: label });
    if (baseline) run.delta = computeDelta({ current: run, baseline });
    console.log(`\nCompared against baseline ${resolvedBaseline}${baseline ? '' : ' (not found for this label)'}`);
}
run.trendPoints = collectTrendPoints({ outputRoot, runLabel: label, currentScorecard: scorecard });
if (args['save-baseline']) {
    const ref = sha || new Date().toISOString().replace(/[:.]/g, '-');
    saveBaseline({ outputRoot, ref, runLabel: label, doc, scorecard });
    console.log(`Saved baseline ${ref}`);
}

// ----- dashboard + rollups
const meta = { generatedAt: new Date().toISOString(), gitSha: sha, gitBranch: branch, baselineRef: resolvedBaseline, preset };
writeFileSync(join(outputRoot, 'index.html'), renderMultiDashboard({ runs: [run], meta }));
writeFileSync(
    join(outputRoot, 'index.json'),
    JSON.stringify(
        {
            meta,
            runs: [{
                label,
                generatedAt: doc.generatedAt,
                analyzers: doc.analyzers,
                findingsCount: doc.findings.length,
                files: scorecard.files.length,
                actions: run.actions,
                delta: run.delta || null,
            }],
        },
        null,
        2,
    ),
);
const summary = [
    `# slopscan report — ${label}`,
    '',
    `Generated ${meta.generatedAt} with preset \`${preset}\``,
    sha ? `Git: \`${sha}\` on \`${branch}\`` : '',
    '',
    `${doc.findings.length} findings, ${scorecard.files.length} files ranked by painscore.`,
    '',
    renderActionItemsMd(run.actions),
].join('\n');
writeFileSync(join(outputRoot, 'SUMMARY.md'), summary);

console.log(`\nDone. ${doc.findings.length} findings, ${scorecard.files.length} files ranked.`);
console.log(`   Dashboard: ${join(outputRoot, 'index.html')}`);
console.log(`   Summary:   ${join(outputRoot, 'SUMMARY.md')}`);

// ----- helpers
function runNode(script, argv) {
    return new Promise((res, rej) => {
        const child = spawn(process.execPath, [script, ...argv], { stdio: 'inherit' });
        child.on('error', rej);
        child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${basename(script)} exited ${code}`))));
    });
}
function readJSON(p) {
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}
function repoName(dir) {
    try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        if (pkg.name) return pkg.name;
    } catch {}
    return basename(dir);
}
function sanitizeLabel(s) {
    return String(s).replace(/^@/, '').replace(/[^A-Za-z0-9._-]+/g, '-');
}
function collectTrendPoints({ outputRoot, runLabel, currentScorecard }) {
    const points = [];
    for (const b of listBaselines(outputRoot)) {
        const loaded = loadBaseline({ outputRoot, ref: b.ref, runLabel });
        if (!loaded) continue;
        points.push({
            t: new Date(loaded.doc.generatedAt).getTime(),
            painscoreTotal: loaded.scorecard.files.reduce((a, f) => a + f.painscore, 0),
            ref: b.ref,
        });
    }
    points.push({ t: Date.now(), painscoreTotal: currentScorecard.files.reduce((a, f) => a + f.painscore, 0), ref: 'current' });
    return points.sort((a, b) => a.t - b.t);
}
function printHelp() {
    console.log(`slopscan [path] [options]

Scan a JS/TS/Vue repo for complexity, duplication, dead code and other slop.

Options:
  --out <dir>          output directory (default ./slopscan-report)
  --preset <name>      ${PRESETS.join(' | ')} | path/to/preset.mjs (default: auto-detect)
  --no-semantic        skip embedding-based semantic duplication
  --analyzers <list>   replace the preset's analyzers, or edit it: +dead-code,-churn
  --include <dirs>     only walk these dirs (comma-separated, relative to path)
  --exclude <names>    directory names to skip
  --since <date>       churn window (default "6 months ago")
  --baseline [ref]     compare against a saved baseline (auto = most recent)
  --save-baseline      save this run as a baseline (keyed by git sha)
  --llm-review         ask Claude to review the top hot-spots (needs ANTHROPIC_API_KEY)
  --env-file <path>    extra dotenv file to read embedding keys from
  -h, --help           show this help

Env:
  OPENAI_API_KEY | OPENROUTER_API_KEY    embeddings key (semantic-dup)
  SLOPSCAN_EMBED_BASE_URL                OpenAI-compatible endpoint override
  SLOPSCAN_EMBED_MODEL                   embedding model override
  Keys are also read from ~/.config/slopscan/.env`);
}
