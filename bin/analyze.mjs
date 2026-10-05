#!/usr/bin/env node
// Unified analyzer. One command, all phases.
//
//   node bin/analyze.mjs \
//     --root <repo> \
//     --include src,app \
//     --exclude node_modules,.next,.nuxt \
//     --extensions .ts,.tsx,.vue,.js,.jsx \
//     --analyzers complexity,semantic-dup,structural-dup,dead-code,import-graph,churn,type-errors,coverage,lint \
//     --filter default|jsx-aware|vue-aware \
//     --threshold 0.82 \
//     --cache .cache \
//     --env-file path/to/.env \
//     --out-dir output/
//
// Outputs:
//   <out-dir>/findings.json     unified Finding[]
//   <out-dir>/scorecard.json    per-file painscore
//   <out-dir>/SUMMARY.md        human-readable rollup
//   <out-dir>/dashboard.html    interactive (Phase 7)

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseArgs, requireArg, csv } from '../lib/args.mjs';
import { runOrchestrator } from '../lib/core/orchestrator.mjs';
import { renderSummary } from '../lib/render/markdown.mjs';
import { renderDashboard } from '../lib/render/html.mjs';
import { discoverWorkspaces } from '../lib/core/workspace.mjs';

const args = parseArgs();

// Load preset (if any) — caller-supplied flags override preset values.
let preset = {};
if (args.preset && args.preset !== true) {
    const presetPath = /[\\/]/.test(args.preset) || args.preset.endsWith('.mjs')
        ? resolve(args.preset)
        : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'presets', args.preset + '.mjs');
    try {
        const mod = await import(pathToFileURL(presetPath).href);
        preset = mod.default || {};
    } catch (err) {
        console.error(`Preset "${args.preset}" not found at ${presetPath}: ${err.message}`);
        process.exit(1);
    }
}

const root = resolve(args.root || preset.root || requireArg(args, 'root'));
const include = csv(args.include, preset.include || []);
const rootFiles = csv(args['root-files'], preset.rootFiles || []);
const exclude = csv(args.exclude, preset.exclude || [
    'node_modules', '.git', '.next', '.nuxt', '.output', 'dist', 'build',
    'coverage', '__tests__', '__pycache__', 'archive', 'public',
]);
const extensions = csv(args.extensions, preset.extensions || ['.ts', '.tsx', '.js', '.jsx', '.vue']);
const analyzerNames = resolveAnalyzerList(args.analyzers, preset.analyzers || ['complexity', 'semantic-dup']);
const outDir = resolve(args['out-dir'] || 'analysis-output');
const label = args.label || preset.label || '';
const cacheDir = args.cache ? resolve(args.cache) : null;
// Only explicit env files (plus ~/.config/slopscan/.env, read by the embeddings
// client). The scanned repo's own .env is never read.
const envFiles = csv(args['env-file'], []).map((f) => resolve(f));
const filterName = (args.filter && args.filter !== true ? args.filter : (preset.filter || 'default'));
const weights = parseWeights(args.weights) || preset.weights || null;
const threshold = parseFloat(args.threshold || preset.threshold || '0.82');
const minBodyLen = parseInt(args['min-loc'] || preset.minBodyLen || '80', 10);
const useAst = args['use-ast'] !== undefined ? !!args['use-ast'] : !!preset.useAst;
const maxClusterSize = parseInt(args['max-cluster-size'] || preset.maxClusterSize || '50', 10);
const deprecatedDeps = csv(args['deprecated-deps'], preset.deprecatedDeps || []);

// `--analyzers a,b` replaces the preset list; `--analyzers +a,-b` edits it.
function resolveAnalyzerList(v, base) {
    const items = csv(v, []);
    if (!items.length) return base;
    if (!items.every((x) => /^[+-]/.test(x))) return items;
    const out = [...base];
    for (const x of items) {
        const name = x.slice(1);
        const i = out.indexOf(name);
        if (x[0] === '+' && i === -1) out.push(name);
        if (x[0] === '-' && i !== -1) out.splice(i, 1);
    }
    return out;
}

function parseWeights(v) {
    if (!v || v === true) return null;
    try {
        const parsed = JSON.parse(v);
        if (typeof parsed !== 'object' || parsed === null) return null;
        return parsed;
    } catch (err) {
        console.error(`Bad --weights JSON: ${err.message}`);
        process.exit(1);
    }
}

const walk = { root, include, rootFiles, exclude, extensions };

// Load analyzer plugins lazily so we only import what we use.
const analyzers = [];
for (const name of analyzerNames) {
    const cfg = analyzerCfg(name);
    let module;
    try {
        module = await import(`../lib/analyzers/${name}.mjs`);
    } catch (err) {
        console.error(`Skipping unknown analyzer "${name}": ${err.message}`);
        continue;
    }
    analyzers.push({ name, module, cfg });
}

if (!analyzers.length) {
    console.error('No analyzers loaded.');
    process.exit(1);
}

// Workspace mode: iterate per-package, label findings, write under <out-dir>/<pkg>/
if (args.workspace) {
    const pkgs = discoverWorkspaces(root);
    if (!pkgs || !pkgs.length) {
        console.error(`No workspace detected at ${root}`);
        process.exit(1);
    }
    console.error(`Workspace mode: ${pkgs.length} package(s)`);
    const allDocs = [];
    for (const pkg of pkgs) {
        console.error(`\n=== ${pkg.name} (${pkg.root}) ===`);
        const pkgWalk = { ...walk, root: pkg.root };
        const pkgResult = await runOrchestrator({
            root: pkg.root, walk: pkgWalk, label: pkg.name, analyzers, weights, parallel: !!args.parallel, onProgress,
        });
        const pkgOut = join(outDir, pkg.name.replace(/[\/@]/g, '_'));
        if (!existsSync(pkgOut)) mkdirSync(pkgOut, { recursive: true });
        writeFileSync(join(pkgOut, 'findings.json'), JSON.stringify(pkgResult.doc, null, 2));
        writeFileSync(join(pkgOut, 'scorecard.json'), JSON.stringify(pkgResult.scorecard, null, 2));
        writeFileSync(join(pkgOut, 'stats.json'), JSON.stringify(pkgResult.stats, null, 2));
        writeFileSync(join(pkgOut, 'SUMMARY.md'), renderSummary({ doc: pkgResult.doc, scorecard: pkgResult.scorecard, stats: pkgResult.stats }));
        writeFileSync(join(pkgOut, 'dashboard.html'), renderDashboard({ doc: pkgResult.doc, scorecard: pkgResult.scorecard, stats: pkgResult.stats }));
        allDocs.push({ name: pkg.name, count: pkgResult.doc.count, totalPain: pkgResult.scorecard.files.reduce((s, f) => s + f.painscore, 0) });
    }
    console.error('\n\nWorkspace summary:');
    for (const d of allDocs) console.error(`  ${d.name.padEnd(30)} ${d.count} findings, total pain ${d.totalPain.toFixed(1)}`);
    process.exit(0);
}

console.error(`Running ${analyzers.length} analyzers on ${root}`);

let lastTick = '';
const onProgress = (e) => {
    if (e.phase === 'start') {
        process.stderr.write(`\n[${e.name}] running…`);
        lastTick = '';
    } else if (e.phase === 'tick') {
        // Re-render single-line progress for analyzers that report it.
        const tick = e.message || (e.done && e.total ? `${e.done}/${e.total}` : '');
        if (tick && tick !== lastTick) {
            process.stderr.write(`\r[${e.name}] ${tick}`.padEnd(70));
            lastTick = tick;
        }
    } else if (e.phase === 'done') {
        process.stderr.write(`\r[${e.name}] done in ${e.elapsed}ms (${e.findings} findings)`.padEnd(70));
    } else if (e.phase === 'error') {
        process.stderr.write(`\r[${e.name}] ERROR: ${e.error}`.padEnd(70));
    }
};

const result = await runOrchestrator({
    root, walk, label, analyzers, weights, parallel: !!args.parallel, onProgress,
});
process.stderr.write('\n');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'findings.json'), JSON.stringify(result.doc, null, 2));
writeFileSync(join(outDir, 'scorecard.json'), JSON.stringify(result.scorecard, null, 2));
writeFileSync(join(outDir, 'stats.json'), JSON.stringify(result.stats, null, 2));

// ndjson stream — one finding per line, suitable for piping into jq / other tools.
if (args.ndjson) {
    const ndPath = join(outDir, 'findings.ndjson');
    const lines = result.doc.findings.map((f) => JSON.stringify(f));
    writeFileSync(ndPath, lines.join('\n') + '\n');
    console.error(`Wrote ${ndPath}`);
}

const md = renderSummary({ doc: result.doc, scorecard: result.scorecard, stats: result.stats });
writeFileSync(join(outDir, 'SUMMARY.md'), md);

const html = renderDashboard({ doc: result.doc, scorecard: result.scorecard, stats: result.stats });
writeFileSync(join(outDir, 'dashboard.html'), html);

console.error(`\nWrote ${join(outDir, 'findings.json')} (${result.doc.count} findings)`);
console.error(`Wrote ${join(outDir, 'scorecard.json')} (${result.scorecard.files.length} files ranked)`);
console.error(`Wrote ${join(outDir, 'SUMMARY.md')}`);
console.error(`Wrote ${join(outDir, 'dashboard.html')}`);

function analyzerCfg(name) {
    const common = { walk, root, label };
    if (name === 'complexity') return common;
    if (name === 'semantic-dup') {
        return {
            ...common,
            threshold,
            minBodyLen,
            filter: filterName,
            useAst,
            maxClusterSize,
            cacheDir: cacheDir ? join(cacheDir, 'embeddings') : null,
            envFiles,
            sliceLarge: !args['no-slice'],
            includeTemplates: !args['no-templates'],
            disabled: !!args['no-semantic'],
        };
    }
    if (name === 'structural-dup') {
        return { ...common, minTokens: parseInt(args['jscpd-min-tokens'] || '50', 10) };
    }
    if (name === 'dead-code') return common;
    if (name === 'import-graph') return common;
    if (name === 'churn') {
        return { ...common, since: args.since || '6 months ago' };
    }
    if (name === 'type-errors') return common;
    if (name === 'ts-quality') return common;
    if (name === 'cognitive') return common;
    if (name === 'react') return common;
    if (name === 'nextjs') return common;
    if (name === 'schema-casing') return common;
    if (name === 'bundle-size') return common;
    if (name === 'supply-chain') {
        return { ...common, deprecatedList: deprecatedDeps, skipOutdated: !!args['skip-outdated'] };
    }
    if (name === 'constants-diff' || name === 'commit-correlation' || name === 'api-field-usage') {
        const crossRoots = parseCrossRoots(args);
        return { ...common, crossRoots };
    }
    if (name === 'coverage') {
        return { ...common, lcovPath: args['coverage-lcov'] };
    }
    if (name === 'lint') {
        return { ...common, eslintJsonPath: args['eslint-json'] };
    }
    return common;
}

function parseCrossRoots(a) {
    const ax = a['cross-a'];
    const bx = a['cross-b'];
    if (!ax || !bx || ax === true || bx === true) return [];
    const al = a['cross-a-label'] || 'A';
    const bl = a['cross-b-label'] || 'B';
    return [
        { root: resolve(ax), label: al },
        { root: resolve(bx), label: bl },
    ];
}
