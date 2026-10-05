// File-level complexity wrapper around typhonjs-escomplex.
// Framework wrappers (Vue SFC etc.) are stripped via the preprocessor registry.

import { createRequire } from 'module';
import { preprocess, defaultPreprocessors } from './preprocessors/index.mjs';

const require = createRequire(import.meta.url);
const escomplex = require('typhonjs-escomplex');

const DEFAULT_OPTS = {
    sourceType: 'module',
    logicalor: true,
    switchcase: true,
    forin: false,
    trycatch: false,
    newmi: true,
};

// analyze(code, filepath, opts) → metrics or null on failure
export function analyzeFile(code, filepath, opts = {}) {
    const { preprocessors = defaultPreprocessors, ...escomplexOpts } = opts;
    const src = preprocess(code, filepath, preprocessors);
    if (!src.trim()) return null;
    let report;
    try {
        report = escomplex.analyzeModule(src, { ...DEFAULT_OPTS, ...escomplexOpts });
    } catch {
        return null;
    }
    const agg = report.aggregate;
    const methods = report.methods || [];
    return {
        sloc: agg.sloc.logical,
        slocPhysical: agg.sloc.physical,
        cyclomatic: agg.cyclomatic,
        cyclomaticDensity: agg.cyclomaticDensity,
        maintainability: Math.round(report.maintainability * 100) / 100,
        halstead: {
            bugs: Math.round(agg.halstead.bugs * 1000) / 1000,
            difficulty: Math.round(agg.halstead.difficulty * 100) / 100,
            effort: Math.round(agg.halstead.effort),
            volume: Math.round(agg.halstead.volume),
            vocabulary: agg.halstead.vocabulary,
            length: agg.halstead.length,
        },
        methodCount: methods.length,
        methods: methods.map((m) => ({
            name: m.name,
            line: m.lineStart,
            cyclomatic: m.cyclomatic,
            sloc: m.sloc?.logical ?? 0,
            halsteadBugs: Math.round((m.halstead?.bugs ?? 0) * 1000) / 1000,
        })),
    };
}

// Distribution helper for cyclomatic complexity buckets.
export function cyclomaticBuckets(results) {
    const buckets = { '1-5': 0, '6-10': 0, '11-20': 0, '21-30': 0, '31+': 0 };
    for (const r of results) {
        const cc = r.cyclomatic ?? 0;
        if (cc <= 5) buckets['1-5']++;
        else if (cc <= 10) buckets['6-10']++;
        else if (cc <= 20) buckets['11-20']++;
        else if (cc <= 30) buckets['21-30']++;
        else buckets['31+']++;
    }
    return buckets;
}
