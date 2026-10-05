// Diff two findings reports. New findings, resolved findings, painscore deltas.
//
// Two reports are produced by analyze on different commits/branches.
// We compare findings with a stable identity (kind + file + line + message)
// and per-file painscore deltas.

export function diffReports(baseDoc, headDoc, baseScorecard, headScorecard) {
    // Identity normalizes file paths so two reports run from different
    // worktrees still match per file (e.g. /tmp/wt-base/src/foo.ts vs
    // /work/repo/src/foo.ts → both → src/foo.ts).
    const norm = (path) => {
        if (!path) return path;
        // Strip leading absolute-prefix junk if any analyzer leaked it.
        return path.replace(/^.*?(?=\b(?:src|app|server|lib|pages|components)\b)/, '');
    };
    const idOf = (f) =>
        `${f.kind}\0${norm(f.file)}\0${f.line ?? ''}\0${f.message ?? ''}`;

    const baseSet = new Map(baseDoc.findings.map((f) => [idOf(f), f]));
    const headSet = new Map(headDoc.findings.map((f) => [idOf(f), f]));

    const newFindings = [];
    const resolved = [];

    for (const [id, f] of headSet) if (!baseSet.has(id)) newFindings.push(f);
    for (const [id, f] of baseSet) if (!headSet.has(id)) resolved.push(f);

    // Per-file painscore deltas
    const baseScoreByFile = new Map((baseScorecard?.files || []).map((f) => [f.file, f.painscore]));
    const headScoreByFile = new Map((headScorecard?.files || []).map((f) => [f.file, f.painscore]));

    const deltas = [];
    const allFiles = new Set([...baseScoreByFile.keys(), ...headScoreByFile.keys()]);
    for (const file of allFiles) {
        const before = baseScoreByFile.get(file) ?? 0;
        const after = headScoreByFile.get(file) ?? 0;
        if (Math.abs(after - before) < 0.5) continue;
        deltas.push({ file, before, after, delta: after - before });
    }
    deltas.sort((a, b) => b.delta - a.delta);

    const totalBefore = (baseScorecard?.files || []).reduce((s, f) => s + f.painscore, 0);
    const totalAfter = (headScorecard?.files || []).reduce((s, f) => s + f.painscore, 0);

    return {
        new: newFindings,
        resolved,
        deltas,
        totals: {
            before: round2(totalBefore),
            after: round2(totalAfter),
            delta: round2(totalAfter - totalBefore),
        },
        counts: {
            new: newFindings.length,
            resolved: resolved.length,
            net: newFindings.length - resolved.length,
        },
    };
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// Render a diff report as markdown for PR comment.
export function renderDiffMarkdown(diff, opts = {}) {
    const { topN = 20 } = opts;
    const lines = [];

    const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
    lines.push(`# slopscan diff`);
    lines.push('');
    lines.push(`**Painscore total:** ${diff.totals.before} → ${diff.totals.after} (${sign(diff.totals.delta)})`);
    lines.push(`**Findings:** ${sign(diff.counts.net)} net (+${diff.counts.new} new, -${diff.counts.resolved} resolved)`);
    lines.push('');

    if (diff.new.length) {
        lines.push(`## 🆕 New findings (${diff.new.length})`);
        lines.push('');
        const top = diff.new.slice(0, topN);
        for (const f of top) {
            lines.push(`- **${f.severity}** \`${f.kind}\` — ${f.file}${f.line ? ':' + f.line : ''} — ${truncate(f.message, 120)}`);
        }
        if (diff.new.length > topN) lines.push(`\n_…and ${diff.new.length - topN} more._`);
        lines.push('');
    }

    if (diff.resolved.length) {
        lines.push(`## ✅ Resolved (${diff.resolved.length})`);
        lines.push('');
        const top = diff.resolved.slice(0, topN);
        for (const f of top) {
            lines.push(`- ${f.file}${f.line ? ':' + f.line : ''} — ${truncate(f.message, 120)}`);
        }
        if (diff.resolved.length > topN) lines.push(`\n_…and ${diff.resolved.length - topN} more._`);
        lines.push('');
    }

    if (diff.deltas.length) {
        lines.push(`## 📈 Painscore deltas (top movers)`);
        lines.push('');
        lines.push('| File | Before | After | Δ |');
        lines.push('|---|---|---|---|');
        for (const d of diff.deltas.slice(0, topN)) {
            lines.push(`| \`${d.file}\` | ${d.before.toFixed(1)} | ${d.after.toFixed(1)} | ${sign(d.delta.toFixed(1))} |`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
