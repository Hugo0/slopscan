// Markdown rendering helpers for analysis output.

export function mdTable(headers, rows) {
    const out = [];
    out.push('| ' + headers.join(' | ') + ' |');
    out.push('|' + headers.map(() => '---').join('|') + '|');
    for (const r of rows) out.push('| ' + r.join(' | ') + ' |');
    return out.join('\n');
}

export function mdHeading(level, text) {
    return '#'.repeat(level) + ' ' + text;
}

export function fmtSim(sim) {
    return sim.toFixed(3);
}

export function fmtFileLine(path, line) {
    return `\`${path}\`:${line}`;
}

// ROI ranking for clusters: prefer big clusters of fat chunks across many dirs.
export function clusterRoiScore(cluster, items) {
    const sizes = cluster.members.map((i) => items[i].bodyLen ?? 0);
    const medianLoc = median(sizes);
    const dirs = new Set(
        cluster.members.map((i) => {
            const f = items[i].file ?? '';
            return f.split('/').slice(0, 2).join('/');
        }),
    );
    const crossDirBonus = Math.min(dirs.size / 3, 2); // saturates at 6 dirs
    return cluster.size * medianLoc * cluster.avgSim * (1 + crossDirBonus);
}

function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function similarityLegend() {
    return [
        '## How to interpret',
        '',
        '- **0.95+** — Almost certainly the same logic. Strong DRY candidate.',
        '- **0.85–0.95** — Same concept, possibly drift. Good refactor candidate.',
        '- **0.75–0.85** — Related patterns. May be legitimate (e.g. parallel validators) or hidden duplication.',
        '- **0.70–0.75** — Weak signal, often noise. Skim for surprises.',
        '',
    ].join('\n');
}
