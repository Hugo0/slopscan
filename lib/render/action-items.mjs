// Ranked action items: take the top-N painscore files + their dominant
// signals + their top findings, emit a structured TODO list with one-line
// "why" rationale per file.
//
// Deterministic — no LLM. The LLM-review analyzer is separate and additive.

const SIGNAL_LABELS = {
    cyclomatic: 'high cyclomatic complexity',
    inverse_mi: 'low maintainability index',
    sloc: 'large file',
    structural_dup: 'token-exact duplication',
    semantic_dup: 'semantic-near duplicates elsewhere',
    churn: 'churns frequently',
    fan_in: 'high fan-in (many files import this)',
    cycle: 'in an import cycle',
    type_errors: 'TypeScript errors',
    any_count: 'many `any` types',
    unused_export: 'unused exports',
    low_coverage: 'low test coverage',
    cognitive_mdd_avg: 'high mean dependency distance',
    cognitive_dlt_avg: 'high call-graph fan-out',
    react_antipatterns: 'React anti-patterns',
    nextjs_violations: 'Next.js violations',
    schema_mixed_casing: 'mixed-case Prisma identifiers',
};

const ACTION_TEMPLATES = {
    cyclomatic: 'extract helpers — split branches into named functions; aim for CC ≤ 10/function',
    inverse_mi: 'reduce file size + branching; the MI penalty is composite',
    sloc: 'split into smaller modules by concern',
    structural_dup: 'extract shared block into a helper or component',
    semantic_dup: 'reconcile with the near-duplicates flagged in clusters tab',
    churn: 'frequent churn × complexity = best-kept candidate for refactor before a regression',
    fan_in: 'changes here ripple to many callers — guard with tests + types',
    cycle: 'break the import cycle (move shared types to a leaf module)',
    type_errors: 'fix the tsc errors (or strengthen types)',
    any_count: 'replace `any` with explicit types; reach for `unknown` + narrowing',
    unused_export: 'delete unused exports — they are dead surface area',
    low_coverage: 'add tests for the dominant code path',
    cognitive_mdd_avg: 'variables travel too far — narrow scopes, shorten lifetimes',
    cognitive_dlt_avg: 'split into smaller call-trees',
    react_antipatterns: 'refactor effects deriving state, multiple exports, etc.',
    nextjs_violations: 'use `next/image` + `next/link`, drop barrel imports',
    schema_mixed_casing: 'unify casing in Prisma raw SQL',
};

// Build action items from current scorecard + findings doc.
//   buildActionItems({ scorecard, doc, topN: 25 })
//   → [{ rank, file, painscore, dominantSignals: [...], reasons: [...], suggestedActions: [...], findingsCount }]
export function buildActionItems({ scorecard, doc, topN = 25 }) {
    const findingsByFile = new Map();
    for (const f of doc.findings || []) {
        if (!findingsByFile.has(f.file)) findingsByFile.set(f.file, []);
        findingsByFile.get(f.file).push(f);
    }

    const items = [];
    const top = (scorecard.files || []).slice(0, topN);
    for (let i = 0; i < top.length; i++) {
        const f = top[i];
        const dominant = topContribsArray(f.breakdown, 4);
        const reasons = dominant.map((d) => SIGNAL_LABELS[d.k] || d.k);
        const actions = dominant.map((d) => ACTION_TEMPLATES[d.k]).filter(Boolean);
        const fileFindings = findingsByFile.get(f.file) || [];
        const criticalFindings = fileFindings
            .filter((x) => x.severity === 'critical' || x.severity === 'high')
            .slice(0, 3);

        items.push({
            rank: i + 1,
            file: f.file,
            painscore: f.painscore,
            dominantSignals: dominant,
            reasons,
            suggestedActions: actions,
            findingsCount: fileFindings.length,
            topFindings: criticalFindings.map((x) => ({
                kind: x.kind,
                severity: x.severity,
                message: x.message,
                line: x.line,
            })),
        });
    }
    return items;
}

function topContribsArray(breakdown, n) {
    if (!breakdown) return [];
    return Object.entries(breakdown)
        .map(([k, v]) => ({ k, c: v.contribution || 0 }))
        .filter((e) => e.c > 0.5)
        .sort((a, b) => b.c - a.c)
        .slice(0, n);
}

// Render to markdown.
export function renderActionItemsMd(items) {
    if (!items.length) return '## Action items\n\nNo action items — corpus is below thresholds.\n';
    const lines = ['## Action items (top by painscore)', ''];
    for (const it of items) {
        lines.push(`### ${it.rank}. \`${it.file}\` — pain ${it.painscore.toFixed(1)}`);
        lines.push('');
        if (it.reasons.length) {
            lines.push(`**Why:** ${it.reasons.join('; ')}`);
            lines.push('');
        }
        if (it.suggestedActions.length) {
            for (const a of it.suggestedActions) lines.push(`- ${a}`);
            lines.push('');
        }
        if (it.topFindings.length) {
            lines.push(`**Top findings:**`);
            for (const f of it.topFindings) {
                lines.push(`- ${f.severity} \`${f.kind}\`${f.line ? ` (L${f.line})` : ''} — ${f.message}`);
            }
            lines.push('');
        }
    }
    return lines.join('\n');
}
