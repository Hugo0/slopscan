// Orchestrator: runs analyzers in order, merges Finding[], aggregates raw
// signals into per-file painscore, returns one consolidated report.
//
//   import { runOrchestrator } from './lib/core/orchestrator.mjs';
//   const report = await runOrchestrator({
//       root, walk,
//       analyzers: [{ name: 'complexity', module, cfg }, ...],
//   });

import { dedupe, sortFindings, buildFindingsDoc } from './findings.mjs';
import { computePainscore, rankByPainscore } from './painscore.mjs';

// Merge two raw-signal Maps. Numeric fields add, others overwrite.
function mergeSignals(into, from) {
    for (const [file, sigs] of from.entries()) {
        const cur = into.get(file) || {};
        for (const [k, v] of Object.entries(sigs)) {
            if (typeof v === 'number' && typeof cur[k] === 'number') {
                cur[k] = (cur[k] || 0) + v;
            } else {
                cur[k] = v;
            }
        }
        into.set(file, cur);
    }
}

export async function runOrchestrator({
    root,
    walk,
    label = '',
    analyzers = [],
    weights = null,
    parallel = false,
    onProgress = () => {},
}) {
    const allFindings = [];
    const allSignals = new Map();
    const stats = {};
    const ran = [];

    async function runOne({ name, module, cfg }) {
        onProgress({ phase: 'start', name });
        const t0 = Date.now();
        const subProgress = (e) => onProgress({ phase: 'tick', name, ...e });
        let result;
        try {
            result = await module.run({ root, walk, cfg: cfg || {}, onProgress: subProgress });
        } catch (err) {
            stats[name] = { error: String(err?.message || err) };
            onProgress({ phase: 'error', name, error: err });
            return;
        }
        const elapsed = Date.now() - t0;
        for (const f of result.findings || []) allFindings.push(f);
        if (result.rawSignals) mergeSignals(allSignals, result.rawSignals);
        stats[name] = { ...(result.stats || {}), elapsed_ms: elapsed, findings: result.findings?.length ?? 0 };
        ran.push(name);
        onProgress({ phase: 'done', name, elapsed, findings: result.findings?.length ?? 0 });
    }

    if (parallel) {
        await Promise.all(analyzers.map(runOne));
    } else {
        for (const a of analyzers) await runOne(a);
    }

    const findings = sortFindings(dedupe(allFindings));

    // Compute painscore from merged signals
    const painMap = computePainscore(allSignals, { weights });
    const ranked = rankByPainscore(painMap);

    return {
        doc: buildFindingsDoc({ findings, root, label, analyzers: ran }),
        scorecard: {
            generatedAt: new Date().toISOString(),
            root,
            label,
            files: ranked,
            weights: weights || null,
        },
        rawSignals: allSignals,
        stats,
    };
}
