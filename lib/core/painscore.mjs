// Painscore: one number per file blending every analyzer's signal.
// Higher = more pain = better refactor target.
//
// All signals normalize to 0..100 within the corpus before weighting.
// Weights are tunable via opts.weights; defaults below.

const DEFAULT_WEIGHTS = {
    cyclomatic: 0.16,
    inverse_mi: 0.08,
    sloc: 0.04,
    structural_dup: 0.08,
    semantic_dup: 0.08,
    churn: 0.12,
    fan_in: 0.04,
    cycle: 0.04,
    type_errors: 0.06,
    any_count: 0.03,
    unused_export: 0.02,
    low_coverage: 0.04,
    cognitive_mdd_avg: 0.06,
    cognitive_dlt_avg: 0.05,
    react_antipatterns: 0.04,
    nextjs_violations: 0.03,
    schema_mixed_casing: 0.03,
};

// signals: Map<file, {cyclomatic, maintainability, sloc, structural_dup, ...}>
// Returns Map<file, {painscore, signals, normalized}>.
export function computePainscore(signals, opts = {}) {
    const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
    const files = [...signals.keys()];

    // Collect raw values per signal
    const rawBySignal = {};
    for (const sig of Object.keys(weights)) {
        rawBySignal[sig] = files.map((f) => sigValue(signals.get(f), sig));
    }

    // Normalize each signal independently to 0..100 by max in corpus
    const normBySignal = {};
    for (const [sig, vals] of Object.entries(rawBySignal)) {
        const max = Math.max(...vals, 1);
        normBySignal[sig] = vals.map((v) => (v / max) * 100);
    }

    // Per-file weighted sum
    const out = new Map();
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let score = 0;
        const breakdown = {};
        for (const sig of Object.keys(weights)) {
            const n = normBySignal[sig][i];
            const w = weights[sig];
            const contrib = n * w;
            score += contrib;
            breakdown[sig] = { raw: rawBySignal[sig][i], normalized: n, weight: w, contribution: contrib };
        }
        out.set(file, { painscore: round2(score), breakdown });
    }
    return out;
}

function sigValue(rec, key) {
    if (!rec) return 0;
    if (key === 'inverse_mi') {
        const mi = rec.maintainability ?? 100;
        return Math.max(0, 100 - mi);
    }
    return rec[key] ?? 0;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// Sort + take top-N. Returns array of { file, painscore, breakdown }.
export function rankByPainscore(painMap, n = null) {
    const arr = [...painMap.entries()]
        .map(([file, v]) => ({ file, ...v }))
        .sort((a, b) => b.painscore - a.painscore);
    return n ? arr.slice(0, n) : arr;
}

export { DEFAULT_WEIGHTS };
