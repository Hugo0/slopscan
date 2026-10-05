// Markdown rendering for the unified report.

import { mdTable } from '../report.mjs';

const SEVERITY_BADGE = {
    critical: '🔴 critical',
    high: '🟠 high',
    medium: '🟡 medium',
    low: '🟢 low',
    info: 'info',
};

export function renderSummary({ doc, scorecard, stats }) {
    const findings = doc.findings || [];
    const lines = [];
    lines.push(`# slopscan report`);
    lines.push('');
    lines.push(`Generated ${doc.generatedAt}.`);
    lines.push(`Root: \`${doc.root}\``);
    if (doc.label) lines.push(`Label: \`${doc.label}\``);
    lines.push(`Analyzers: ${doc.analyzers.join(', ') || '(none)'}`);
    lines.push(`Total findings: **${findings.length}**`);
    lines.push('');

    // Stats per analyzer
    lines.push('## Pipeline stats');
    lines.push('');
    const statRows = Object.entries(stats || {}).map(([name, s]) => [
        name,
        s.findings ?? 0,
        s.elapsed_ms ? `${s.elapsed_ms}ms` : '—',
        Object.entries(s)
            .filter(([k]) => !['findings', 'elapsed_ms'].includes(k))
            .map(([k, v]) => `${k}=${v}`)
            .join(' '),
    ]);
    lines.push(mdTable(['Analyzer', 'Findings', 'Time', 'Notes'], statRows));
    lines.push('');

    // Severity breakdown
    const bySev = {};
    for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;
    lines.push('## Severity breakdown');
    lines.push('');
    for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
        if (bySev[sev]) lines.push(`- ${SEVERITY_BADGE[sev]}: **${bySev[sev]}**`);
    }
    lines.push('');

    // Kind breakdown
    const byKind = {};
    for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    lines.push('## Findings by kind');
    lines.push('');
    const kindRows = Object.entries(byKind)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [`\`${k}\``, v]);
    lines.push(mdTable(['Kind', 'Count'], kindRows));
    lines.push('');

    // Painscore top 30
    lines.push('## Top files by painscore');
    lines.push('');
    const top = (scorecard.files || []).slice(0, 30);
    const painRows = top.map((f) => [
        f.painscore,
        f.file,
        topContribsString(f.breakdown),
    ]);
    lines.push(mdTable(['Pain', 'File', 'Top signals'], painRows));
    lines.push('');

    // Top findings by severity
    lines.push('## Top findings (by severity then score)');
    lines.push('');
    const top30 = findings.slice(0, 50);
    const findRows = top30.map((f) => [
        SEVERITY_BADGE[f.severity] || f.severity,
        f.kind,
        f.score ?? '',
        `\`${f.file}\`${f.line ? `:${f.line}` : ''}`,
        truncate(f.message, 80),
    ]);
    lines.push(mdTable(['Severity', 'Kind', 'Score', 'Location', 'Message'], findRows));
    lines.push('');

    return lines.join('\n');
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function topContribsString(breakdown) {
    if (!breakdown) return '';
    const entries = Object.entries(breakdown)
        .map(([k, v]) => ({ k, c: v.contribution }))
        .filter((e) => e.c > 1)
        .sort((a, b) => b.c - a.c)
        .slice(0, 3);
    return entries.map((e) => `${e.k}=${e.c.toFixed(0)}`).join(', ');
}
