// Tiny inline SVG charts. No deps. Returns an HTML string each.
//
//   - severityPieSvg(counts)         — pie of severity counts
//   - painscoreHistogramSvg(values)  — distribution histogram
//   - kindBarSvg(byKind, n=15)       — top-N kind bar chart
//   - trendLineSvg(points)           — over-time trend (if multiple baselines)

const SEV_COLOR = {
    critical: '#f85149',
    high: '#ff8e3c',
    medium: '#d29922',
    low: '#3fb950',
    info: '#6e7681',
};

export function severityPieSvg(counts, { size = 220 } = {}) {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    const filtered = order.map((s) => ({ s, n: counts[s] || 0 })).filter((x) => x.n > 0);
    const total = filtered.reduce((a, b) => a + b.n, 0);
    if (!total) return '<div class="muted">No findings.</div>';
    const cx = size / 2, cy = size / 2, r = size / 2 - 8;
    let acc = 0;
    const arcs = filtered.map(({ s, n }) => {
        const start = acc / total;
        acc += n;
        const end = acc / total;
        const path = arcPath(cx, cy, r, start, end);
        return `<path d="${path}" fill="${SEV_COLOR[s]}" stroke="#161b22" stroke-width="1"/>`;
    });
    const legend = filtered
        .map(({ s, n }) => `
            <div style="display:flex;gap:6px;align-items:center;font-size:12px;">
              <span style="display:inline-block;width:10px;height:10px;background:${SEV_COLOR[s]};border-radius:2px"></span>
              ${s} <span class="muted">${n}</span>
            </div>`)
        .join('');
    return `
        <div style="display:flex;gap:18px;align-items:center">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs.join('')}</svg>
          <div style="display:flex;flex-direction:column;gap:4px">${legend}</div>
        </div>`;
}

export function painscoreHistogramSvg(values, { width = 520, height = 160, bins = 20 } = {}) {
    if (!values.length) return '<div class="muted">No painscore data.</div>';
    const max = Math.max(...values);
    if (max === 0) return '<div class="muted">All zero.</div>';
    const counts = new Array(bins).fill(0);
    for (const v of values) {
        const idx = Math.min(bins - 1, Math.floor((v / max) * bins));
        counts[idx]++;
    }
    const peak = Math.max(...counts, 1);
    const barW = width / bins;
    const bars = counts.map((c, i) => {
        const h = (c / peak) * (height - 30);
        const x = i * barW;
        const y = height - 20 - h;
        return `<rect x="${x + 1}" y="${y}" width="${barW - 2}" height="${h}" fill="#58a6ff" />` +
            (c > 0 ? `<text x="${x + barW / 2}" y="${y - 2}" font-size="9" fill="#8b949e" text-anchor="middle">${c}</text>` : '');
    }).join('');
    const xLabels = `<text x="0" y="${height - 4}" font-size="10" fill="#8b949e">0</text>` +
        `<text x="${width}" y="${height - 4}" font-size="10" fill="#8b949e" text-anchor="end">${max.toFixed(0)}</text>` +
        `<text x="${width / 2}" y="${height - 4}" font-size="10" fill="#8b949e" text-anchor="middle">painscore →</text>`;
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}${xLabels}</svg>`;
}

export function kindBarSvg(byKind, { topN = 15, width = 520, rowH = 18 } = {}) {
    const entries = Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, topN);
    if (!entries.length) return '<div class="muted">No findings.</div>';
    const max = entries[0][1];
    const labelW = 200;
    const barW = width - labelW - 60;
    const height = entries.length * rowH + 8;
    const rows = entries.map(([k, v], i) => {
        const w = (v / max) * barW;
        const y = i * rowH + 8;
        return `<text x="0" y="${y + 12}" font-size="11" fill="#e6edf3">${escape(k)}</text>` +
            `<rect x="${labelW}" y="${y + 3}" width="${w}" height="${rowH - 6}" fill="#58a6ff" rx="2"/>` +
            `<text x="${labelW + w + 4}" y="${y + 12}" font-size="11" fill="#8b949e">${v}</text>`;
    }).join('');
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rows}</svg>`;
}

export function trendLineSvg(points, { width = 520, height = 160 } = {}) {
    if (points.length < 2) return '<div class="muted">Need ≥2 baselines for a trend line.</div>';
    const xs = points.map((p) => p.t);
    const ys = points.map((p) => p.painscoreTotal);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = 0, yMax = Math.max(...ys, 1);
    const pad = 30;
    const xPx = (x) => pad + ((x - xMin) / (xMax - xMin || 1)) * (width - 2 * pad);
    const yPx = (y) => height - pad - ((y - yMin) / (yMax - yMin || 1)) * (height - 2 * pad);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${xPx(p.t)},${yPx(p.painscoreTotal)}`).join(' ');
    const dots = points.map((p) =>
        `<circle cx="${xPx(p.t)}" cy="${yPx(p.painscoreTotal)}" r="3" fill="#58a6ff" />`
    ).join('');
    const xL = `<text x="${pad}" y="${height - 6}" font-size="10" fill="#8b949e">${new Date(xMin).toISOString().slice(0, 10)}</text>` +
        `<text x="${width - pad}" y="${height - 6}" font-size="10" fill="#8b949e" text-anchor="end">${new Date(xMax).toISOString().slice(0, 10)}</text>`;
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <path d="${path}" stroke="#58a6ff" stroke-width="2" fill="none"/>${dots}${xL}
    </svg>`;
}

function arcPath(cx, cy, r, t0, t1) {
    if (t1 - t0 >= 1) {
        return `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
    }
    const a0 = t0 * Math.PI * 2 - Math.PI / 2;
    const a1 = t1 * Math.PI * 2 - Math.PI / 2;
    const x0 = cx + Math.cos(a0) * r;
    const y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;
    const large = t1 - t0 > 0.5 ? 1 : 0;
    return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large},1 ${x1},${y1} Z`;
}

function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
