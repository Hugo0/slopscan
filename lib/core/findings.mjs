// Unified Finding schema. Every analyzer emits Finding[] with this shape;
// the orchestrator merges them, the scorecard aggregates per file, and the
// dashboard renders directly from this single representation.
//
// Schema is versioned via FINDINGS_VERSION so dashboards can reject stale data.

export const FINDINGS_VERSION = 1;

// Severity ordering for sort + filter:
export const SEVERITY = Object.freeze({
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
});

export const SEVERITY_NAMES = Object.freeze(['info', 'low', 'medium', 'high', 'critical']);

// Kind taxonomy. Keep flat. Add carefully — every kind that the dashboard
// renders needs a column header and a per-file roll-up rule.
export const FINDING_KINDS = Object.freeze({
    // file-level metrics
    complexity: 'complexity',                // CC / Halstead / MI per file
    method_complexity: 'method-complexity',  // hot method inside a file

    // duplication
    semantic_dup: 'semantic-dup',            // embedding-cosine cluster
    structural_dup: 'structural-dup',        // jscpd token-exact

    // dead code
    unused_export: 'unused-export',
    unused_file: 'unused-file',
    unused_dep: 'unused-dep',
    unused_binding: 'unused-binding',

    // imports
    cycle: 'import-cycle',
    fan_in_high: 'fan-in-high',

    // churn
    hotspot: 'hotspot',                      // high churn × high complexity

    // type
    type_error: 'type-error',
    any_usage: 'any-usage',
    ts_ignore: 'ts-ignore',

    // coverage
    low_coverage: 'low-coverage',

    // lint
    lint_warning: 'lint-warning',
    lint_error: 'lint-error',
});

// Construct a single finding with sane defaults.
//   makeFinding({ kind, file, message, severity?, line?, score?, refs?, meta? })
// `score` is an analyzer-specific magnitude (CC value, cluster size, churn count).
// `refs` is array of { file, line?, name? } for cross-file findings (clusters).
// `meta` is free-form analyzer-specific data.
export function makeFinding({
    kind,
    file,
    message,
    severity = 'medium',
    line = null,
    score = null,
    refs = null,
    meta = null,
}) {
    if (!kind) throw new Error('makeFinding: kind is required');
    if (!file) throw new Error('makeFinding: file is required');
    if (!message) throw new Error('makeFinding: message is required');
    if (!(severity in SEVERITY)) {
        throw new Error(`makeFinding: invalid severity ${severity}`);
    }
    return {
        kind,
        file,
        line,
        severity,
        score,
        message,
        refs,
        meta,
    };
}

// Group findings by file. Returns Map<file, Finding[]>.
export function groupByFile(findings) {
    const m = new Map();
    for (const f of findings) {
        if (!m.has(f.file)) m.set(f.file, []);
        m.get(f.file).push(f);
    }
    return m;
}

// Deduplicate findings by (kind, file, line, message). Stable: keeps first.
export function dedupe(findings) {
    const seen = new Set();
    const out = [];
    for (const f of findings) {
        const key = `${f.kind}\0${f.file}\0${f.line}\0${f.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
    }
    return out;
}

// Sort findings: severity desc, then score desc, then file alpha.
export function sortFindings(findings) {
    return [...findings].sort((a, b) => {
        const sa = SEVERITY[a.severity] ?? 0;
        const sb = SEVERITY[b.severity] ?? 0;
        if (sa !== sb) return sb - sa;
        const za = a.score ?? 0;
        const zb = b.score ?? 0;
        if (za !== zb) return zb - za;
        return (a.file ?? '').localeCompare(b.file ?? '');
    });
}

// Build the wrapper that goes to disk.
export function buildFindingsDoc({ findings, root, label, analyzers }) {
    return {
        version: FINDINGS_VERSION,
        generatedAt: new Date().toISOString(),
        root,
        label: label || '',
        analyzers: analyzers || [],
        count: findings.length,
        findings,
    };
}
