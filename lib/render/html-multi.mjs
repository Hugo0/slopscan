// Consolidated multi-run dashboard. One HTML file, top-level run-tabs
// (one per analysed package, plus an optional cross-repo run). Each run-tab contains
// the same sub-tabs as the per-run dashboard (overview / scorecard / findings
// / clusters / actions / stats), driven by embedded JSON.
//
// Inputs:
//   runs: [{ label, doc, scorecard, stats, actions, baseline?, delta?, charts? }]
//   meta: { generatedAt, gitSha, gitBranch, baselineRef? }

export function renderMultiDashboard({ runs, meta = {} }) {
    // ALL aggregation happens on the CLIENT (see buildAllRun() in the inline
    // script) — duplicating every finding + scorecard row server-side doubles
    // the HTML payload (saw 4.5MB → 8.7MB). Mark whether ALL should appear so
    // the client knows whether to render the synthetic tab.
    const showAllTab = runs.length >= 2;
    // Embed via JSON.parse(stringLiteral) instead of as a raw JS object
    // literal — V8 parses a JSON string ~2-3× faster than the equivalent
    // object literal because the JS parser is more general.
    // See: https://v8.dev/blog/cost-of-javascript-2019#json
    const payloadJson = JSON.stringify(JSON.stringify({ runs, meta, showAllTab }));

    // Pre-compute raw chart data per run — Chart.js handles rendering client-side.
    // Expose every dimension the analyzers compute so the dashboard can chart any of them.
    const chartDataByRun = {};
    for (const r of runs) {
        const findings = r.doc.findings || [];
        const sevCounts = {};
        for (const f of findings) sevCounts[f.severity] = (sevCounts[f.severity] || 0) + 1;
        const byKind = {};
        for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
        const kindsTopN = Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 15);

        // Per-file complexity points from `complexity` findings (CC, MI, Halstead, SLOC).
        const complexity = findings
            .filter((f) => f.kind === 'complexity' && f.meta)
            .map((f) => ({
                file: f.file,
                cc: f.meta.cyclomatic,
                mi: f.meta.maintainability,
                bugs: f.meta.halstead_bugs,
                difficulty: f.meta.halstead_difficulty,
                sloc: f.meta.sloc,
            }));

        // Per-file scorecard breakdown — every analyzer dimension as raw values.
        // Used for churn × complexity scatter, cognitive distributions, top-painscore lists.
        const files = (r.scorecard.files || []).map((f) => {
            const b = f.breakdown || {};
            const raw = (k) => (b[k] && typeof b[k].raw === 'number' ? b[k].raw : null);
            return {
                file: f.file,
                painscore: f.painscore,
                cc: raw('cyclomatic'),
                inverse_mi: raw('inverse_mi'),
                sloc: raw('sloc'),
                churn: raw('churn'),
                fan_in: raw('fan_in'),
                mdd: raw('cognitive_mdd_avg'),
                dlt: raw('cognitive_dlt_avg'),
                struct_dup: raw('structural_dup'),
                sem_dup: raw('semantic_dup'),
                any_count: raw('any_count'),
                type_errors: raw('type_errors'),
                react_anti: raw('react_antipatterns'),
                nextjs_violations: raw('nextjs_violations'),
                unused_export: raw('unused_export'),
                low_coverage: raw('low_coverage'),
                bundle_size: raw('bundle_size'),
            };
        });

        chartDataByRun[r.label] = {
            severity: sevCounts,
            kinds: kindsTopN,
            painscoreValues: (r.scorecard.files || []).map((x) => x.painscore),
            trendPoints: r.trendPoints || [],
            complexity,
            files,
        };
    }
    const chartDataJson = JSON.stringify(JSON.stringify(chartDataByRun));

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>slopscan report</title>
<link rel="icon" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' fill='%230a0c10'/><path d='M8 2 L13 8 L8 14 L3 8 Z' fill='%23FF90E8'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.js"></script>
<style>
:root {
  /* Base */
  --bg:           #0a0c10;
  --bg-elev:      #11141a;
  --bg-sunk:      #060709;
  --line:         #1d222b;
  --line-strong:  #2c333d;

  /* Type */
  --ink:        #e8ecf1;
  --ink-soft:   #b0b8c4;
  --ink-mute:   #6e7884;
  --ink-faint:  #424b56;

  /* Signature accent */
  --signal:     #FF90E8;
  --signal-dim: rgba(255,144,232,0.10);
  --signal-edge:rgba(255,144,232,0.32);

  /* Severity (terminal-tuned) */
  --crit: #f25555;
  --high: #f4924c;
  --med:  #d6b66a;
  --low:  #7bbf7e;
  --info: #6e7884;

  /* Type system */
  --display: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  --body:    'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  --mono:    'JetBrains Mono', ui-monospace, 'SF Mono', monospace;

  /* Rhythm */
  --r-1: 4px; --r-2: 8px; --r-3: 12px; --r-4: 16px;
  --r-5: 20px; --r-6: 24px; --r-8: 32px;
}

* { box-sizing: border-box; }
*, *::before, *::after { min-width: 0; }

html { background: var(--bg-sunk); }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 13px/1.55 var(--body);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* ── Header ribbon ────────────────────────────────────────────── */
header {
  display: flex;
  align-items: center;
  gap: var(--r-5);
  padding: var(--r-3) var(--r-5);
  background: var(--bg-elev);
  border-bottom: 1px solid var(--line);
  position: relative;
  flex-wrap: wrap;
}
header::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--signal) 20%, var(--signal) 80%, transparent);
  opacity: 0.35;
  pointer-events: none;
}
header h1 {
  margin: 0;
  font: 600 12.5px/1 var(--display);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 9px;
}
header h1::before {
  content: '◆';
  color: var(--signal);
  font-size: 10px;
}
header .meta {
  font: 400 10.5px/1 var(--mono);
  color: var(--ink-mute);
  letter-spacing: 0.04em;
}
header .ref-pill {
  font: 500 10.5px/1 var(--mono);
  letter-spacing: 0.05em;
  color: var(--signal);
  background: var(--signal-dim);
  border: 1px solid var(--signal-edge);
  padding: 4px 8px;
  border-radius: 2px;
}
header .stats {
  margin-left: auto;
  display: flex;
  gap: var(--r-5);
}
header .stat {
  font: 500 10px/1 var(--display);
  color: var(--ink-mute);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
header .stat b {
  color: var(--ink);
  font: 600 14px/1 var(--display);
  font-feature-settings: "tnum";
  letter-spacing: 0;
}

/* ── Run tabs ─────────────────────────────────────────────────── */
nav.run-tabs {
  display: flex;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--line);
  padding: 0 var(--r-5);
  gap: 0;
  overflow-x: auto;
}
nav.run-tabs button {
  background: none;
  border: none;
  color: var(--ink-mute);
  font: 500 12px/1 var(--display);
  letter-spacing: 0.02em;
  padding: 14px 18px;
  cursor: pointer;
  border-bottom: 1px solid transparent;
  white-space: nowrap;
  transition: color 120ms ease;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
nav.run-tabs button .count {
  font: 400 10px/1 var(--mono);
  color: var(--ink-faint);
  font-feature-settings: "tnum";
  letter-spacing: 0;
}
nav.run-tabs button:hover { color: var(--ink-soft); }
nav.run-tabs button.active {
  color: var(--ink);
  border-bottom-color: var(--signal);
}
nav.run-tabs button.active .count { color: var(--ink-mute); }
nav.run-tabs button.all-tab { font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
nav.run-tabs button.all-tab::before {
  content: '◆';
  color: var(--signal);
  margin-right: 6px;
  font-size: 9px;
}

/* ── Sub tabs ─────────────────────────────────────────────────── */
nav.sub-tabs {
  display: flex;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  padding: 0 var(--r-5);
  overflow-x: auto;
}
nav.sub-tabs button {
  background: none;
  border: none;
  color: var(--ink-mute);
  font: 400 12px/1 var(--body);
  padding: 11px 14px;
  cursor: pointer;
  border-bottom: 1px solid transparent;
  white-space: nowrap;
  transition: color 120ms ease;
}
nav.sub-tabs button:hover { color: var(--ink-soft); }
nav.sub-tabs button.active {
  color: var(--ink);
  border-bottom-color: var(--ink);
}

/* ── Main ─────────────────────────────────────────────────────── */
main {
  padding: var(--r-5);
  max-width: 1600px;
  margin: 0 auto;
}

main h3 {
  font: 500 10.5px/1 var(--display);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-mute);
  margin: var(--r-6) 0 var(--r-3);
}

/* ── Cards ────────────────────────────────────────────────────── */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--r-3);
  margin-bottom: var(--r-4);
}
.card {
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: var(--r-4);
  min-width: 0;
  overflow: visible;       /* allow tooltip popups to escape card bounds */
  display: flex;
  flex-direction: column;
}
.card h3 {
  margin: 0 0 var(--r-3);
  font: 500 10px/1 var(--display);
  color: var(--ink-mute);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.card svg {
  width: 100%;
  max-width: 680px;       /* keep viewBox-scaled text legible — don't stretch SVGs to full card width */
  height: auto;
  display: block;
  margin: 0 auto;
}
/* Chart.js canvas containers — fixed heights so charts render to their slot.
   Chart.js uses parent dimensions when responsive: true. */
.chart-wrap { position: relative; width: 100%; }
.chart-sm { height: 200px; }
.chart-md { height: 260px; }
.chart-lg { height: 380px; }
.chart-xl { height: 460px; }

/* Grid presets for tabs that need bespoke layouts */
.cards.cols-2 { grid-template-columns: repeat(2, 1fr); }
.cards.cols-4 { grid-template-columns: repeat(4, 1fr); }
.cards.cols-12 { grid-template-columns: repeat(12, 1fr); } /* fine-grained (use grid-column: span N) */

/* Compact tables inside cards (CVE list, drift list) */
table.compact { font-size: 11px; }
table.compact td { padding: 5px 8px; vertical-align: top; }
table.compact th { padding: 6px 8px; }
table.compact td .file {
  font-size: 11px;
  word-break: break-all;
  display: inline;
  white-space: normal;
  direction: ltr;
}

/* ── Info tooltip (CSS-only) ──────────────────────────────────────────── */
.tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--line-strong);
  color: var(--ink-mute);
  font: 700 9px/1 var(--display);
  margin-left: 6px;
  vertical-align: 1px;
  cursor: help;
  letter-spacing: 0;
  text-transform: none;
  user-select: none;
  transition: background 120ms ease, color 120ms ease;
}
.tip::before { content: 'i'; }
.tip:hover { background: var(--signal); color: var(--bg-sunk); }
.tip::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  width: max-content;
  max-width: 340px;
  padding: 9px 11px;
  background: var(--bg-sunk);
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  color: var(--ink-soft);
  font: 400 11px/1.55 var(--body);
  letter-spacing: 0;
  text-transform: none;
  text-align: left;
  white-space: pre-wrap;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
  transition: opacity 140ms ease, transform 140ms ease;
  z-index: 100;
  box-shadow: 0 6px 24px rgba(0,0,0,0.4);
}
.tip:hover::after { opacity: 1; transform: translateX(-50%) translateY(0); }
/* Arrow */
.tip::before { content: 'i'; }

/* ── Drilldown panel (clicked-bar file list) ──────────────────────────── */
.drill {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 11.5px;
  display: none;
}
.drill.open { display: block; }
.drill-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font: 500 10.5px/1 var(--display);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-mute);
  margin-bottom: 8px;
}
.drill-header .clear-btn {
  background: none;
  border: 1px solid var(--line);
  color: var(--ink-mute);
  padding: 3px 8px;
  font: 400 10px/1 var(--mono);
  border-radius: 2px;
  cursor: pointer;
}
.drill-header .clear-btn:hover { color: var(--ink); border-color: var(--line-strong); }
.drill ul {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 180px;
  overflow-y: auto;
}
.drill li {
  padding: 3px 0;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  font: 400 11px/1.4 var(--mono);
}
.drill li:last-child { border-bottom: none; }
.drill li .v {
  color: var(--ink-mute);
  font-feature-settings: 'tnum';
  flex-shrink: 0;
}
.drill li .file {
  color: var(--ink);
  word-break: break-all;
  text-align: right;
  flex: 1;
  direction: ltr;
}
.card table {
  border: none;
  background: transparent;
  border-radius: 0;
  table-layout: fixed;     /* keep number column from collapsing */
}
.card table th { display: none; }
.card table td {
  padding: 6px 8px 6px 0;  /* horizontal gap between numeric column and file column */
  border-bottom: 1px solid var(--line);
  font-size: 11.5px;
}
.card table td:first-child {
  padding-right: 14px;     /* extra breathing room after painscore */
  width: 1%;               /* shrink-wrap the number column so file gets the rest */
  white-space: nowrap;
}
.card table tr:hover { background: transparent; }
.card table tr:last-child td { border-bottom: none; }

.metric {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.metric .v {
  font: 600 38px/1 var(--display);
  font-feature-settings: "tnum";
  letter-spacing: -0.02em;
  color: var(--ink);
}
.metric .l {
  font: 400 11px/1.3 var(--body);
  color: var(--ink-mute);
}
.metric .delta-good { color: var(--low); }
.metric .delta-bad  { color: var(--crit); }

/* ── Tables ───────────────────────────────────────────────────── */
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: 3px;
  overflow: hidden;
  table-layout: auto;
}
th, td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  vertical-align: top;
}
th {
  background: var(--bg);
  cursor: pointer;
  user-select: none;
  font: 500 10px/1 var(--display);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-mute);
  position: sticky;
  top: 0;
}
th:hover { color: var(--ink); }
tr:last-child td { border-bottom: none; }
tr:hover { background: rgba(255, 255, 255, 0.015); }
td.num {
  text-align: right;
  font-family: var(--mono);
  font-feature-settings: "tnum";
  white-space: nowrap;
  font-size: 11.5px;
}

td.file, .file {
  font: 400 11.5px/1.4 var(--mono);
  color: var(--ink);
  word-break: break-all;
}

/* In compact card-tables, truncate the file column from the LEFT
   (filename stays visible — most-significant info on the right) */
.card td.file,
.card .file {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.card td.file::after { content: ''; }

/* ── Severity & kind ──────────────────────────────────────────── */
.sev {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 2px;
  font: 600 9.5px/1.5 var(--display);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  vertical-align: middle;
  border: 1px solid transparent;
}
.sev-critical { background: rgba(242,85,85,0.10);  color: var(--crit); border-color: rgba(242,85,85,0.32); }
.sev-high     { background: rgba(244,146,76,0.10); color: var(--high); border-color: rgba(244,146,76,0.32); }
.sev-medium   { background: rgba(214,182,106,0.10);color: var(--med);  border-color: rgba(214,182,106,0.32); }
.sev-low      { background: rgba(123,191,126,0.10);color: var(--low);  border-color: rgba(123,191,126,0.32); }
.sev-info     { background: rgba(110,120,132,0.12);color: var(--info); border-color: rgba(110,120,132,0.30); }

.kind {
  font: 400 10.5px/1.4 var(--mono);
  color: var(--ink-mute);
  background: var(--bg);
  border: 1px solid var(--line);
  padding: 1px 5px;
  border-radius: 2px;
  white-space: nowrap;
  display: inline-block;
}

.bar {
  display: inline-block;
  height: 4px;
  background: var(--signal);
  vertical-align: middle;
  border-radius: 1px;
  margin-left: 6px;
  opacity: 0.7;
}

/* ── Action items ─────────────────────────────────────────────── */
.action-item {
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-left: 2px solid var(--signal);
  border-radius: 2px;
  padding: var(--r-3) var(--r-4);
  margin-bottom: var(--r-2);
}
.action-item h4 {
  margin: 0 0 var(--r-2);
  font: 500 12px/1.5 var(--mono);
  display: flex;
  align-items: center;
  gap: var(--r-2);
  flex-wrap: wrap;
}
.action-item h4 > :last-child {
  word-break: break-all;
  flex: 1 1 auto;
  min-width: 0;
}
.action-item .rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  padding: 0 5px;
  border-radius: 2px;
  background: var(--signal);
  color: var(--bg-sunk);
  font: 700 10px/1 var(--display);
  flex-shrink: 0;
}
.action-item .reasons {
  font: 400 11px/1.5 var(--body);
  color: var(--ink-mute);
  margin-bottom: var(--r-2);
}
.action-item ul {
  margin: var(--r-2) 0 0 18px;
  padding: 0;
  font-size: 11.5px;
  line-height: 1.55;
}
.action-item li { margin: 1px 0; color: var(--ink-soft); }
.action-item details { margin-top: var(--r-2); }
.action-item summary { cursor: pointer; color: var(--ink-mute); font-size: 11px; }

/* ── Controls ─────────────────────────────────────────────────── */
.controls {
  display: flex;
  gap: var(--r-2);
  align-items: center;
  margin-bottom: var(--r-3);
  flex-wrap: wrap;
}
.controls input, .controls select {
  background: var(--bg-elev);
  border: 1px solid var(--line);
  color: var(--ink);
  padding: 6px 10px;
  border-radius: 2px;
  font: 400 12px/1 var(--mono);
  height: 28px;
}
.controls input:focus, .controls select:focus {
  outline: none;
  border-color: var(--signal);
}
.controls input { min-width: 240px; }
.controls > span {
  font: 500 10.5px/1 var(--display);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-mute);
}

.pill {
  font: 500 10px/1 var(--display);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 5px 9px;
  border-radius: 2px;
  background: var(--bg-elev);
  color: var(--ink-mute);
  border: 1px solid var(--line);
  cursor: pointer;
  user-select: none;
}
.pill:hover { color: var(--ink-soft); }
.pill.active            { background: var(--signal); color: var(--bg-sunk); border-color: var(--signal); }
.pill.sev-critical.active { background: var(--crit); color: var(--bg-sunk); border-color: var(--crit); }
.pill.sev-high.active     { background: var(--high); color: var(--bg-sunk); border-color: var(--high); }
.pill.sev-medium.active   { background: var(--med);  color: var(--bg-sunk); border-color: var(--med); }
.pill.sev-low.active      { background: var(--low);  color: var(--bg-sunk); border-color: var(--low); }

/* ── Compare view ─────────────────────────────────────────────── */
.compare-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--r-3);
  margin-bottom: var(--r-5);
}
.delta-table tr.improved td.num { color: var(--low); }
.delta-table tr.worsened td.num { color: var(--crit); }

/* ── Cluster cards ────────────────────────────────────────────── */
.cluster-detail {
  padding: var(--r-3);
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: 2px;
  margin-bottom: var(--r-2);
}
.cluster-detail b {
  font: 600 12px/1 var(--display);
  color: var(--ink);
}
.refs { color: var(--ink-mute); font-size: 11.5px; margin-top: var(--r-2); }

/* ── Misc ─────────────────────────────────────────────────────── */
.muted { color: var(--ink-mute); }
.right { text-align: right; }
.hidden { display: none !important; }
details summary { cursor: pointer; color: var(--ink-mute); font-size: 12px; }

code {
  font: 400 11.5px/1.4 var(--mono);
  background: var(--bg);
  border: 1px solid var(--line);
  padding: 1px 5px;
  border-radius: 2px;
  color: var(--signal);
}
pre {
  background: var(--bg-sunk);
  border: 1px solid var(--line);
  padding: var(--r-3);
  border-radius: 2px;
  font: 400 11.5px/1.5 var(--mono);
  overflow-x: auto;
  white-space: pre;
  color: var(--ink-soft);
}
p { margin: var(--r-2) 0; }

/* Subtle entrance for content area on tab switch */
@keyframes contentEnter {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0); }
}
main > * { animation: contentEnter 180ms ease-out; }

/* ── Skip banner (analyzers that soft-failed) ────────────────────────── */
.skip-banner {
  padding: 10px 20px;
  background: rgba(255, 144, 232, 0.06);
  border-bottom: 1px solid var(--signal-edge);
  color: var(--ink-soft);
  font: 400 11.5px/1.55 var(--body);
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.skip-banner.hidden { display: none; }
.skip-banner::before {
  content: '!';
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--signal);
  color: var(--bg-sunk);
  font: 700 10px/1 var(--display);
  flex-shrink: 0;
  margin-top: 1px;
}
.skip-banner b { color: var(--ink); font-weight: 600; }
.skip-banner code {
  font: 400 11px/1.4 var(--mono);
  background: var(--bg-sunk);
  border: 1px solid var(--line);
  padding: 1px 5px;
  border-radius: 2px;
  color: var(--signal);
}

/* Scrollbar in dark theme */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--bg-sunk); }
::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 0; }
::-webkit-scrollbar-thumb:hover { background: var(--ink-faint); }
</style>
</head>
<body>
<header>
  <h1>slopscan</h1>
  <div class="meta" id="meta"></div>
  <span class="ref-pill" id="gitRef"></span>
  <div class="stats">
    <div class="stat">Findings <b id="findCountTotal"></b></div>
    <div class="stat">Files <b id="fileCountTotal"></b></div>
  </div>
</header>
<div id="skipBanner" class="skip-banner hidden"></div>
<nav class="run-tabs" id="runTabs"></nav>
<nav class="sub-tabs" id="subTabs">
  <button data-sub="overview" class="active">Overview</button>
  <button data-sub="actions">Action items</button>
  <button data-sub="complexity">Complexity</button>
  <button data-sub="health">Health</button>
  <button data-sub="scorecard">Scorecard</button>
  <button data-sub="findings">Findings</button>
  <button data-sub="clusters">Clusters</button>
  <button data-sub="compare">Compare to baseline</button>
  <button data-sub="stats">Pipeline</button>
</nav>
<main id="main"></main>

<script>
const PAYLOAD = JSON.parse(${payloadJson});
const CHART_DATA = JSON.parse(${chartDataJson});

// Chart.js theme defaults — applied once. Matches the dashboard's dark palette.
if (window.Chart) {
  Chart.defaults.color = '#b0b8c4';
  Chart.defaults.borderColor = '#1d222b';
  Chart.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.legend.labels.padding = 12;
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(17, 20, 26, 0.96)';
  Chart.defaults.plugins.tooltip.borderColor = '#2c333d';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleColor = '#e8ecf1';
  Chart.defaults.plugins.tooltip.bodyColor = '#b0b8c4';
  Chart.defaults.plugins.tooltip.padding = 8;
  Chart.defaults.plugins.tooltip.titleFont = { family: "'JetBrains Mono', monospace", size: 11, weight: '600' };
  Chart.defaults.plugins.tooltip.bodyFont = { family: "'JetBrains Mono', monospace", size: 11 };
  Chart.defaults.plugins.tooltip.cornerRadius = 2;
}
const SEVERITY_COLORS = { critical: '#f25555', high: '#f4924c', medium: '#d6b66a', low: '#7bbf7e', info: '#6e7884' };
const SIGNAL = '#FF90E8';
const GRID_LINE = 'rgba(28,33,42,0.9)';
// Track every chart instance so we can destroy on tab/run switch (avoids canvas-reuse errors).
let __charts = [];
function destroyCharts() { for (const c of __charts) { try { c.destroy(); } catch {} } __charts = []; }
function reg(c) { __charts.push(c); return c; }

// Build a synthetic "all" run on the fly by concatenating findings + scorecard
// + actions across every real run. Computed lazily + cached. Doesn't deep-copy
// anything — just spreads the arrays once and caches the result.
let __allRunCache = null;
let __allChartCache = null;
function buildAllRun() {
  if (__allRunCache) return __allRunCache;
  const findings = [], scorecardFiles = [], actions = [];
  const stats = {};
  for (const r of PAYLOAD.runs) {
    for (const f of (r.doc.findings || [])) findings.push(f);
    for (const sf of (r.scorecard.files || [])) scorecardFiles.push(sf);
    for (const a of (r.actions || [])) actions.push(a);
    for (const [k, v] of Object.entries(r.stats || {})) stats[r.label + '/' + k] = v;
  }
  scorecardFiles.sort((a, b) => (b.painscore || 0) - (a.painscore || 0));
  actions.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  __allRunCache = {
    label: '__all__',
    doc: { findings, count: findings.length, version: 1 },
    scorecard: { files: scorecardFiles, label: 'all' },
    stats, actions, delta: null, trendPoints: [],
  };
  return __allRunCache;
}
function buildAllChartData() {
  if (__allChartCache) return __allChartCache;
  const sevCounts = {}, byKind = {};
  // Tag every per-finding/per-file row with its source run so charts on the
  // ALL tab can colour-segment by repo (otherwise UI dominates visually + you
  // can't tell which bubble came from where).
  const complexity = [];
  const files = [];
  for (const r of PAYLOAD.runs) {
    const findings = r.doc.findings || [];
    for (const f of findings) {
      sevCounts[f.severity] = (sevCounts[f.severity] || 0) + 1;
      byKind[f.kind] = (byKind[f.kind] || 0) + 1;
      if (f.kind === 'complexity' && f.meta) {
        complexity.push({
          file: f.file, _run: r.label,
          cc: f.meta.cyclomatic, mi: f.meta.maintainability,
          bugs: f.meta.halstead_bugs, difficulty: f.meta.halstead_difficulty, sloc: f.meta.sloc,
        });
      }
    }
    const rd = CHART_DATA[r.label] || {};
    for (const f of (rd.files || [])) files.push({ ...f, _run: r.label });
  }
  const all = buildAllRun();
  __allChartCache = {
    severity: sevCounts,
    kinds: Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 15),
    painscoreValues: all.scorecard.files.map(x => x.painscore),
    trendPoints: [], complexity, files,
  };
  CHART_DATA['__all__'] = __allChartCache;
  return __allChartCache;
}

// Per-repo colour palette for ALL-tab segmentation. Distinct hues, all readable
// against the dark background.
const RUN_COLORS = {
  'cross-repo':      { bg: 'rgba(214,182,106,0.45)',  border: '#d6b66a' },  // ochre
};
const RUN_PALETTE = [
  { bg: 'rgba(255,144,232,0.45)', border: '#FF90E8' },  // pink (signal)
  { bg: 'rgba(120,180,255,0.45)', border: '#78b4ff' },  // blue
  { bg: 'rgba(120,220,160,0.45)', border: '#78dca0' },  // green
  { bg: 'rgba(200,160,255,0.45)', border: '#c8a0ff' },  // violet
];
function colorForRun(label) {
  if (RUN_COLORS[label]) return RUN_COLORS[label];
  const idx = (PAYLOAD.runs || []).findIndex(r => r.label === label);
  return RUN_PALETTE[(idx < 0 ? 0 : idx) % RUN_PALETTE.length];
}
function isAllRun(label) { return label === '__all__'; }
// Split a row array into per-run buckets — preserves insertion order within each.
function splitByRun(rows) {
  const out = new Map();
  for (const row of rows) {
    const k = row._run || 'unknown';
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(row);
  }
  return out;
}
function findRun(label) {
  if (label === '__all__') return buildAllRun();
  return PAYLOAD.runs.find(r => r.label === label);
}
// Ensure ALL chart-data is computed before any chart-attaching code reads it.
function ensureChartData(label) {
  if (label === '__all__' && !CHART_DATA['__all__']) buildAllChartData();
}

// ----- header
document.getElementById('meta').textContent =
  PAYLOAD.meta.generatedAt + (PAYLOAD.meta.gitBranch ? ' · ' + PAYLOAD.meta.gitBranch : '');
document.getElementById('gitRef').textContent = PAYLOAD.meta.gitSha || '(no git)';
const totalFindings = PAYLOAD.runs.reduce((a, r) => a + (r.doc.findings || []).length, 0);
const totalFiles = PAYLOAD.runs.reduce((a, r) => a + (r.scorecard.files || []).length, 0);
document.getElementById('findCountTotal').textContent = totalFindings.toLocaleString();
document.getElementById('fileCountTotal').textContent = totalFiles.toLocaleString();

// Skip banner — surface any analyzer that soft-skipped (e.g. semantic-dup
// when OPENAI_API_KEY isn't set) prominently at the top of the dashboard
// so users know what's missing without digging into the Pipeline tab.
(function showSkipBanner() {
  const skipped = [];
  for (const r of PAYLOAD.runs) {
    for (const [name, s] of Object.entries(r.stats || {})) {
      if (s && s.skipped) skipped.push({ run: r.label, analyzer: name, reason: s.skippedReason || 'no reason given' });
    }
  }
  if (skipped.length === 0) return;
  // Group by analyzer (same skip across all runs is one row)
  const byAnalyzer = new Map();
  for (const s of skipped) {
    if (!byAnalyzer.has(s.analyzer)) byAnalyzer.set(s.analyzer, { runs: [], reason: s.reason });
    byAnalyzer.get(s.analyzer).runs.push(s.run);
  }
  const lines = [...byAnalyzer.entries()].map(([analyzer, data]) =>
    '<div><b>' + escape(analyzer) + '</b> skipped on ' + data.runs.map(r => '<code>' + escape(r) + '</code>').join(', ') + ' — ' + escape(data.reason) + '</div>'
  );
  const banner = document.getElementById('skipBanner');
  banner.innerHTML = '<div>' + lines.join('') + '</div>';
  banner.classList.remove('hidden');
})();

// ----- run tabs
const runTabsEl = document.getElementById('runTabs');
// Render concrete run-tabs first; if there are 2+ runs, prepend a synthetic
// ALL tab that aggregates them client-side on click (no upfront cost).
const tabRuns = PAYLOAD.runs.slice();
if (PAYLOAD.showAllTab) {
  // Quick aggregate counts for the tab label (cheap — just sum lengths).
  let f = 0, fl = 0;
  for (const r of PAYLOAD.runs) { f += (r.doc.findings || []).length; fl += (r.scorecard.files || []).length; }
  const allBtn = document.createElement('button');
  allBtn.dataset.run = '__all__';
  allBtn.classList.add('all-tab', 'active');
  allBtn.innerHTML = '<span>all</span><span class="count">' + f.toLocaleString() + ' findings · ' + fl.toLocaleString() + ' files</span>';
  allBtn.addEventListener('click', () => switchRun('__all__'));
  runTabsEl.appendChild(allBtn);
}
tabRuns.forEach((r, i) => {
  const b = document.createElement('button');
  b.dataset.run = r.label;
  const files = (r.scorecard.files || []).length;
  const findings = (r.doc.findings || []).length;
  const count = files > 0 ? files.toLocaleString() + ' files' : findings.toLocaleString() + ' findings';
  b.innerHTML = '<span>' + escape(r.label) + '</span><span class="count">' + count + '</span>';
  if (!PAYLOAD.showAllTab && i === 0) b.classList.add('active');
  b.addEventListener('click', () => switchRun(r.label));
  runTabsEl.appendChild(b);
});

let currentRun = PAYLOAD.showAllTab ? '__all__' : PAYLOAD.runs[0]?.label;
let currentSub = 'overview';

document.getElementById('subTabs').querySelectorAll('button').forEach(b =>
  b.addEventListener('click', () => switchSub(b.dataset.sub))
);

function switchRun(label) {
  currentRun = label;
  runTabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.run === label));
  render();
}
function switchSub(sub) {
  currentSub = sub;
  document.getElementById('subTabs').querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.sub === sub)
  );
  render();
}

function render() {
  destroyCharts();
  ensureChartData(currentRun);
  const run = findRun(currentRun);
  if (!run) return;
  const main = document.getElementById('main');
  if (currentSub === 'overview')         { main.innerHTML = overviewLayout(run);   attachOverview(run); }
  else if (currentSub === 'actions')     { main.innerHTML = renderActions(run); }
  else if (currentSub === 'complexity')  { main.innerHTML = complexityLayout(run); attachComplexity(run); }
  else if (currentSub === 'health')      { main.innerHTML = healthLayout(run);     attachHealth(run); }
  else if (currentSub === 'scorecard')   { main.innerHTML = scorecardSection();    attachScorecard(run); }
  else if (currentSub === 'findings')    { main.innerHTML = findingsSection();     attachFindings(run); }
  else if (currentSub === 'clusters')    { main.innerHTML = clustersSection();     attachClusters(run); }
  else if (currentSub === 'compare')     { main.innerHTML = renderCompare(run); }
  else if (currentSub === 'stats')       { main.innerHTML = renderStats(run); }
}

// ----- OVERVIEW
function overviewLayout(run) {
  const findingsCount = (run.doc.findings || []).length;
  const hasScorecard = (run.scorecard.files || []).length > 0;
  const isAll = run.label === '__all__';
  const isCrossRepo = !hasScorecard && !isAll;

  // Cross-repo runs have no per-file painscore — replace painscore-flavored
  // cards with drift summaries that actually have data for that run.
  if (isCrossRepo) {
    const findings = run.doc.findings || [];
    const orphans = findings.filter(f => f.kind === 'orphan-backend-change').length;
    const drift = findings.filter(f => f.kind === 'constants-drift').length;
    const shared = findings.filter(f => f.kind === 'constants-shared-value').length;
    const apiUnused = findings.filter(f => f.kind === 'api-unused-response-field').length;
    return \`
      <div class="cards">
        <div class="card">
          <h3>Total drift findings\${tip("Cross-repo run only flags drift between the two compared repos — not per-file painscore.")}</h3>
          <div class="metric"><span class="v">\${findingsCount.toLocaleString()}</span></div>
          <div class="chart-wrap chart-sm"><canvas id="ov-severity"></canvas></div>
        </div>
        <div class="card">
          <h3>Orphan backend changes\${tip("Backend commits in last 6mo with no matching frontend commit. Suggests API contract evolved but UI didn't catch up.")}</h3>
          <div class="metric"><span class="v" style="color:\${orphans > 5 ? 'var(--high)' : 'var(--ink)'}">\${orphans}</span><span class="l">need FE follow-up?</span></div>
        </div>
        <div class="card">
          <h3>Constants drift\${tip("Identifiers with the same name in api-ts and ui that have DIFFERENT values. Either the FE is reading stale values, or the BE is.")}</h3>
          <div class="metric"><span class="v" style="color:\${drift > 0 ? 'var(--crit)' : 'var(--low)'}">\${drift}</span><span class="l">FE↔BE mismatched</span></div>
        </div>
        <div class="card">
          <h3>API fields unused\${tip("Response fields the BE returns that the FE never reads. Candidates for backend cleanup or FE consumption.")}</h3>
          <div class="metric"><span class="v">\${apiUnused}</span><span class="l">BE returns, FE ignores</span></div>
        </div>
        <div class="card">
          <h3>Shared constants\${tip("Same value defined separately in both repos. Candidates for extraction into a shared module.")}</h3>
          <div class="metric"><span class="v">\${shared}</span><span class="l">duplicated values</span></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <h3>Findings by kind</h3>
          <div class="chart-wrap chart-md"><canvas id="ov-kinds"></canvas></div>
        </div>
      </div>\`;
  }

  const top5 = (run.scorecard.files || []).slice(0, 5);
  const topRows = top5.map(f =>
    '<tr><td class="num" style="width:4em">' + f.painscore.toFixed(1) + '</td><td style="max-width:0;width:100%"><span class="file">' + escape(f.file) + '</span></td></tr>'
  ).join('');
  const deltaCard = (run.delta && !isAll) ? renderDeltaCard(run.delta) : '';
  const actionsCount = (run.actions || []).length;

  // ALL run gets the same layout but with no per-baseline trend (each baseline
  // is per-repo). Hide the trend card for ALL.
  const trendCard = isAll ? '' : \`
      <div class="card" style="grid-column:1/-1">
        <h3>Painscore trend (across baselines)\${tip("How the painscore total has moved across the most recent baselines (commits where you ran --save-baseline). Trends down = code health improving.")}</h3>
        <div class="chart-wrap chart-md"><canvas id="ov-trend"></canvas></div>
      </div>\`;

  return \`
    <div class="cards">
      <div class="card">
        <h3>Total findings\${tip("Every issue every analyzer found, summed. Weight by severity in Action Items / Scorecard tabs — raw count is just a temperature gauge.")}</h3>
        <div class="metric"><span class="v">\${findingsCount.toLocaleString()}</span></div>
        <div class="chart-wrap chart-sm"><canvas id="ov-severity"></canvas></div>
      </div>
      <div class="card">
        <h3>Painscore distribution\${tip("Painscore = weighted sum of every analyzer signal per file: cyclomatic, churn, duplication, type-errors, anys, etc. Higher = more pain. Histogram shows how many files sit at each painscore bucket.")}</h3>
        <div class="chart-wrap chart-sm"><canvas id="ov-painhist"></canvas></div>
      </div>
      <div class="card">
        <h3>Top files\${tip("Top 5 files by painscore — same as the head of the Scorecard tab. These are where refactor effort yields the most leverage.")}</h3>
        <table><tbody>\${topRows || '<tr><td class="muted" colspan="2">No painscore data.</td></tr>'}</tbody></table>
      </div>
      \${deltaCard}
      <div class="card">
        <h3>Action items queued\${tip("Files where the painscore + reason combo crosses the threshold for 'open a refactor PR'. See Action Items tab for the suggested concrete moves per file.")}</h3>
        <div class="metric"><span class="v">\${actionsCount}</span><span class="l">prioritized refactors</span></div>
        <button class="pill active" style="align-self:flex-start;margin-top:auto" onclick="switchSub('actions')">Open action items →</button>
      </div>
      <div class="card" style="grid-column:1/-1">
        <h3>Findings by kind (top 15)\${tip("Histogram of issue kinds. high-mdd / missing-return-type / complexity etc. are produced by separate analyzers; this view is the cross-cutting summary.")}</h3>
        <div class="chart-wrap chart-md"><canvas id="ov-kinds"></canvas></div>
      </div>
      \${trendCard}
    </div>\`;
}
function attachOverview(run) {
  const data = CHART_DATA[run.label] || {};
  // Severity doughnut (skip empty)
  const sev = data.severity || {};
  const sevLabels = ['critical', 'high', 'medium', 'low', 'info'].filter(k => (sev[k]||0) > 0);
  if (sevLabels.length) {
    reg(new Chart(document.getElementById('ov-severity'), {
      type: 'doughnut',
      data: {
        labels: sevLabels,
        datasets: [{
          data: sevLabels.map(k => sev[k]),
          backgroundColor: sevLabels.map(k => SEVERITY_COLORS[k]),
          borderColor: '#11141a', borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'right' } },
      },
    }));
  }
  // Painscore histogram
  const painBuckets = histogramBuckets(data.painscoreValues || [], 20);
  reg(new Chart(document.getElementById('ov-painhist'), {
    type: 'bar',
    data: {
      labels: painBuckets.labels,
      datasets: [{ data: painBuckets.counts, backgroundColor: SIGNAL, borderRadius: 1, barPercentage: 0.95, categoryPercentage: 1 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (i) => 'pain ' + i[0].label, label: (i) => i.parsed.y + ' files' } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } }, y: { grid: { color: GRID_LINE }, ticks: { precision: 0 } } },
    },
  }));
  // Kinds horizontal bar
  const kinds = data.kinds || [];
  reg(new Chart(document.getElementById('ov-kinds'), {
    type: 'bar',
    data: {
      labels: kinds.map(k => k[0]),
      datasets: [{ data: kinds.map(k => k[1]), backgroundColor: SIGNAL, borderRadius: 1 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { color: GRID_LINE } }, y: { grid: { display: false } } },
    },
  }));
  // Trend line
  const trend = data.trendPoints || [];
  if (trend.length >= 2) {
    reg(new Chart(document.getElementById('ov-trend'), {
      type: 'line',
      data: {
        labels: trend.map(p => p.date || p.label || p.sha?.slice(0, 7) || '?'),
        datasets: [{
          data: trend.map(p => p.value ?? p.painscore ?? 0),
          borderColor: SIGNAL, backgroundColor: 'rgba(255,144,232,0.10)',
          tension: 0.25, fill: true, pointRadius: 3, pointBackgroundColor: SIGNAL,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: GRID_LINE } } },
      },
    }));
  } else {
    document.getElementById('ov-trend').replaceWith(Object.assign(document.createElement('div'), { className: 'muted', style: 'padding:24px 0;font-size:11.5px', textContent: 'No trend data — run again on another commit to populate.' }));
  }
}

// ----- COMPLEXITY (deep dive into code-quality dimensions)
function complexityLayout(run) {
  const cFindings = (CHART_DATA[run.label] || {}).complexity || [];
  const files = (CHART_DATA[run.label] || {}).files || [];
  const haveCC = cFindings.length > 0;
  const haveScores = files.some(f => f.cc != null && f.churn != null);
  if (!haveCC && !haveScores) {
    return '<div class="muted" style="padding:24px 0">No complexity data — this run targets cross-repo drift, not per-file metrics. See the <a href="#" onclick="switchSub(\\'health\\');return false">Health</a> tab for cross-repo signals.</div>';
  }
  return \`
    <div class="cards cols-2">
      <div class="card" style="grid-column:1/-1">
        <h3>Churn × Complexity (refactor candidates)\${tip("Each bubble is a file. X = git commits in last 6 months. Y = cyclomatic complexity (count of independent code paths). Bubble size = SLOC. Top-right files change often AND are complex — best refactor candidates.")}</h3>
        <div class="chart-wrap chart-xl"><canvas id="cx-churn-cc"></canvas></div>
        <div class="muted" style="font-size:10.5px;margin-top:6px">Click a bubble to jump to its scorecard row. Hover for file path.</div>
      </div>
      <div class="card">
        <h3>Cyclomatic distribution\${tip("Cyclomatic complexity (CC) counts independent execution paths through a function. CC=1 is straight-line code; CC≥10 is hard to test, ≥20 is hard to read, ≥30 is a refactor candidate. Click a bar to see the files in that bucket.")}</h3>
        <div class="chart-wrap chart-md"><canvas id="cx-cc-hist"></canvas></div>
        <div class="drill" id="cx-cc-drill"></div>
        <div class="muted" style="font-size:10.5px;margin-top:6px">Click a bar to drill into its files.</div>
      </div>
      <div class="card">
        <h3>Maintainability Index\${tip("MI is a 0-100 score combining cyclomatic complexity, Halstead volume, and SLOC. <65 = needs attention, <50 = critical. Lower-score buckets get red. Click a bar to see the files in that bucket.")}</h3>
        <div class="chart-wrap chart-md"><canvas id="cx-mi-hist"></canvas></div>
        <div class="drill" id="cx-mi-drill"></div>
        <div class="muted" style="font-size:10.5px;margin-top:6px">MI &lt; 65 = needs attention. Click a bar to drill in.</div>
      </div>
      <div class="card">
        <h3>Halstead: difficulty × bugs\${tip("Halstead difficulty estimates how hard the code is to write/read from operator and operand counts. Estimated bugs = volume × effort, a heuristic for fault-likelihood. Top-right = hardest + buggiest. Bubble size = SLOC.")}</h3>
        <div class="chart-wrap chart-md"><canvas id="cx-halstead"></canvas></div>
      </div>
      <div class="card">
        <h3>Cognitive complexity (MDD × DLT)\${tip("Mean Dependency Distance (MDD) = avg distance between a variable's declaration and its use — high MDD = variables defined far from where they're used. Dependency-Locality Theory (DLT) = density of call-graph edges within a function. Both are AST-based proxies for how hard a function is to mentally trace.")}</h3>
        <div class="chart-wrap chart-md"><canvas id="cx-cognitive"></canvas></div>
        <div class="muted" style="font-size:10.5px;margin-top:6px">Higher MDD = scattered variable scope. Higher DLT = dense call-graphs.</div>
      </div>
    </div>\`;
}
// Inline tooltip helper — emits a CSS-only .tip span with the given text.
function tip(text) {
  return '<span class="tip" data-tip="' + escape(text).replace(/"/g, '&quot;') + '"></span>';
}
function attachComplexity(run) {
  const data = CHART_DATA[run.label] || {};
  const cFindings = data.complexity || [];
  const files = data.files || [];
  const isAll = isAllRun(run.label);

  // Scatter: CC × Churn × SLOC. On ALL run, segment by source repo with
  // distinct colors + a legend so api isn't visually swallowed by ui.
  const toBubble = (f) => ({ x: f.churn, y: f.cc, r: Math.min(20, Math.max(3, Math.sqrt((f.sloc || 0) / 4))), file: f.file, sloc: f.sloc });
  const valid = files.filter(f => f.cc != null && f.churn != null && f.cc > 0);
  let scatterDatasets;
  if (isAll) {
    const byRun = splitByRun(valid);
    scatterDatasets = [...byRun.entries()].map(([label, rows]) => {
      const c = colorForRun(label);
      return { label: label + ' (' + rows.length + ')', data: rows.map(toBubble), backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 };
    });
  } else {
    scatterDatasets = [{ data: valid.map(toBubble), backgroundColor: 'rgba(255,144,232,0.45)', borderColor: SIGNAL, borderWidth: 1 }];
  }
  if (scatterDatasets.length && document.getElementById('cx-churn-cc')) {
    reg(new Chart(document.getElementById('cx-churn-cc'), {
      type: 'bubble',
      data: { datasets: scatterDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: isAll, position: 'top', labels: { boxWidth: 10, boxHeight: 10 } },
          tooltip: { callbacks: { title: (i) => i[0].raw.file, label: (i) => 'CC ' + i.raw.y + '  · churn ' + i.raw.x + '  · SLOC ' + (i.raw.sloc || '?') } },
        },
        scales: {
          x: { title: { display: true, text: 'Churn (commits last 6mo)' }, grid: { color: GRID_LINE } },
          y: { title: { display: true, text: 'Cyclomatic Complexity' }, grid: { color: GRID_LINE } },
        },
      },
    }));
  }

  // CC histogram (clickable drilldown). On ALL run: stacked bars per repo so
  // each bucket shows ui-vs-api breakdown.
  if (cFindings.length && document.getElementById('cx-cc-hist')) {
    const buckets = histogramBuckets(cFindings, 15, (f) => f.cc);
    const ccDrill = document.getElementById('cx-cc-drill');
    let ccDatasets;
    if (isAll) {
      // Pre-bucket per run + reuse the same edges
      const perRun = new Map();
      for (const f of cFindings) {
        const k = f._run || 'unknown';
        if (!perRun.has(k)) perRun.set(k, []);
        perRun.get(k).push(f);
      }
      ccDatasets = [...perRun.entries()].map(([label, rows]) => {
        const counts = new Array(buckets.labels.length).fill(0);
        const min = Math.min(...cFindings.map(f => f.cc).filter(v => typeof v === 'number'));
        const max = Math.max(...cFindings.map(f => f.cc).filter(v => typeof v === 'number'));
        const w = (max - min) / buckets.labels.length;
        for (const f of rows) {
          const v = f.cc; if (typeof v !== 'number') continue;
          const i = Math.min(buckets.labels.length - 1, Math.max(0, Math.floor((v - min) / w)));
          counts[i]++;
        }
        const c = colorForRun(label);
        return { label, data: counts, backgroundColor: c.border, borderRadius: 1, stack: 'cc' };
      });
    } else {
      ccDatasets = [{
        data: buckets.counts,
        backgroundColor: buckets.midpoints.map(m => m >= 30 ? SEVERITY_COLORS.critical : m >= 15 ? SEVERITY_COLORS.high : m >= 8 ? SEVERITY_COLORS.medium : SEVERITY_COLORS.low),
        borderRadius: 1, barPercentage: 0.95, categoryPercentage: 1,
      }];
    }
    reg(new Chart(document.getElementById('cx-cc-hist'), {
      type: 'bar',
      data: { labels: buckets.labels, datasets: ccDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: isAll, position: 'top', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { title: (i) => 'CC ' + i[0].label, label: (i) => i.dataset.label ? i.dataset.label + ': ' + i.parsed.y + ' files' : i.parsed.y + ' files · click to drill' } } },
        scales: { x: { stacked: isAll, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: { stacked: isAll, grid: { color: GRID_LINE }, ticks: { precision: 0 } } },
        onClick: (_evt, els) => {
          if (!els.length) return;
          const i = els[0].index;
          renderDrilldown(ccDrill, 'CC ' + buckets.labels[i], buckets.buckets[i], (f) => f.cc);
        },
      },
    }));
  }

  // MI histogram — same stacking treatment on ALL.
  if (cFindings.length && document.getElementById('cx-mi-hist')) {
    const buckets = histogramBuckets(cFindings, 15, (f) => f.mi);
    const miDrill = document.getElementById('cx-mi-drill');
    let miDatasets;
    if (isAll) {
      const perRun = new Map();
      for (const f of cFindings) {
        const k = f._run || 'unknown';
        if (!perRun.has(k)) perRun.set(k, []);
        perRun.get(k).push(f);
      }
      const allMI = cFindings.map(f => f.mi).filter(v => typeof v === 'number');
      const min = Math.min(...allMI), max = Math.max(...allMI);
      const w = (max - min) / buckets.labels.length;
      miDatasets = [...perRun.entries()].map(([label, rows]) => {
        const counts = new Array(buckets.labels.length).fill(0);
        for (const f of rows) {
          const v = f.mi; if (typeof v !== 'number') continue;
          const i = Math.min(buckets.labels.length - 1, Math.max(0, Math.floor((v - min) / w)));
          counts[i]++;
        }
        const c = colorForRun(label);
        return { label, data: counts, backgroundColor: c.border, borderRadius: 1, stack: 'mi' };
      });
    } else {
      miDatasets = [{
        data: buckets.counts,
        backgroundColor: buckets.midpoints.map(m => m < 50 ? SEVERITY_COLORS.critical : m < 65 ? SEVERITY_COLORS.high : m < 80 ? SEVERITY_COLORS.medium : SEVERITY_COLORS.low),
        borderRadius: 1, barPercentage: 0.95, categoryPercentage: 1,
      }];
    }
    reg(new Chart(document.getElementById('cx-mi-hist'), {
      type: 'bar',
      data: { labels: buckets.labels, datasets: miDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: isAll, position: 'top', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { title: (i) => 'MI ' + i[0].label, label: (i) => i.dataset.label ? i.dataset.label + ': ' + i.parsed.y + ' files' : i.parsed.y + ' files · click to drill' } } },
        scales: { x: { stacked: isAll, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: { stacked: isAll, grid: { color: GRID_LINE }, ticks: { precision: 0 } } },
        onClick: (_evt, els) => {
          if (!els.length) return;
          const i = els[0].index;
          renderDrilldown(miDrill, 'MI ' + buckets.labels[i], buckets.buckets[i], (f) => f.mi);
        },
      },
    }));
  }

  // Halstead difficulty × bugs — segmented per repo on ALL.
  const halsteadValid = cFindings.filter(f => f.difficulty != null && f.bugs != null);
  const toHalstead = (f) => ({ x: f.difficulty, y: f.bugs, r: Math.min(18, Math.max(3, Math.sqrt((f.sloc || 0) / 5))), file: f.file, sloc: f.sloc });
  let halsteadDatasets;
  if (isAll) {
    const byRun = splitByRun(halsteadValid);
    halsteadDatasets = [...byRun.entries()].map(([label, rows]) => {
      const c = colorForRun(label);
      return { label: label + ' (' + rows.length + ')', data: rows.map(toHalstead), backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 };
    });
  } else {
    halsteadDatasets = [{ data: halsteadValid.map(toHalstead), backgroundColor: 'rgba(255,144,232,0.40)', borderColor: SIGNAL, borderWidth: 1 }];
  }
  if (halsteadDatasets.length && document.getElementById('cx-halstead')) {
    reg(new Chart(document.getElementById('cx-halstead'), {
      type: 'bubble',
      data: { datasets: halsteadDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: isAll, position: 'top', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { title: (i) => i[0].raw.file, label: (i) => 'difficulty ' + i.raw.x.toFixed(1) + '  · est. bugs ' + i.raw.y.toFixed(2) + '  · SLOC ' + (i.raw.sloc || '?') } } },
        scales: {
          x: { title: { display: true, text: 'Halstead difficulty' }, grid: { color: GRID_LINE } },
          y: { title: { display: true, text: 'Halstead bugs (estimate)' }, grid: { color: GRID_LINE } },
        },
      },
    }));
  }

  // Cognitive: MDD × DLT scatter — segmented on ALL.
  const cognValid = files.filter(f => f.mdd != null && f.dlt != null && (f.mdd > 0 || f.dlt > 0));
  const toCog = (f) => ({ x: f.mdd, y: f.dlt, r: 4, file: f.file });
  let cogDatasets;
  if (isAll) {
    const byRun = splitByRun(cognValid);
    cogDatasets = [...byRun.entries()].map(([label, rows]) => {
      const c = colorForRun(label);
      return { label: label + ' (' + rows.length + ')', data: rows.map(toCog), backgroundColor: c.bg, borderColor: c.border, borderWidth: 1, pointRadius: 4 };
    });
  } else {
    cogDatasets = [{ data: cognValid.map(toCog), backgroundColor: 'rgba(255,144,232,0.55)', borderColor: SIGNAL, borderWidth: 1, pointRadius: 4 }];
  }
  if (cogDatasets.length && document.getElementById('cx-cognitive')) {
    reg(new Chart(document.getElementById('cx-cognitive'), {
      type: 'scatter',
      data: { datasets: cogDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: isAll, position: 'top', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { title: (i) => i[0].raw.file, label: (i) => 'MDD ' + i.raw.x.toFixed(2) + '  · DLT ' + i.raw.y.toFixed(2) } } },
        scales: {
          x: { title: { display: true, text: 'Mean dependency distance (MDD)' }, grid: { color: GRID_LINE } },
          y: { title: { display: true, text: 'Dependency-locality theory (DLT)' }, grid: { color: GRID_LINE } },
        },
      },
    }));
  }
}

// ----- HEALTH (bundle bloat, CVEs, coupling, cross-repo drift)
function healthLayout(run) {
  const findings = run.doc.findings || [];
  const isCrossRepo = run.label === 'cross-repo' || /cross/i.test(run.label);
  const cves = findings.filter(f => f.kind === 'cve');
  const heavy = findings.filter(f => f.kind === 'heavy-imports');
  const fanIn = findings.filter(f => f.kind === 'fan-in-high');
  const cycles = findings.filter(f => f.kind === 'import-cycle');
  const orphans = findings.filter(f => f.kind === 'orphan-backend-change');
  const drift = findings.filter(f => f.kind === 'constants-drift');
  const apiUnused = findings.filter(f => f.kind === 'api-unused-response-field');
  const cveBySev = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of cves) cveBySev[f.severity] = (cveBySev[f.severity] || 0) + 1;

  const topCveRows = cves.slice(0, 10).map(f => {
    const m = f.meta || {};
    return '<tr>' +
      '<td><span class="sev sev-' + f.severity + '">' + f.severity + '</span></td>' +
      '<td><span class="kind">' + escape(m.name || '?') + '</span></td>' +
      '<td class="muted" style="font:400 10.5px/1.4 var(--mono)">' + escape(m.range || '') + '</td>' +
      '<td>' + escape((m.via || f.message || '').slice(0, 80)) + '</td>' +
      '</tr>';
  }).join('');

  const cveSection = cves.length === 0
    ? '<div class="muted" style="font-size:11.5px">No CVEs in this run.</div>'
    : '<div class="chart-wrap chart-sm" style="max-width:280px"><canvas id="hl-cve"></canvas></div>' +
      '<table class="compact" style="margin-top:12px"><thead><tr><th>Sev</th><th>Pkg</th><th>Range</th><th>Via</th></tr></thead><tbody>' + topCveRows + '</tbody></table>';

  const heavySection = heavy.length === 0
    ? '<div class="muted" style="font-size:11.5px">No heavy-imports findings.</div>'
    : '<div class="chart-wrap chart-lg"><canvas id="hl-bundle"></canvas></div>' +
      '<div class="muted" style="font-size:10.5px;margin-top:6px">Top files by transitive bundle weight (KB). Bigger = imports more / heavier deps. Hover for deps.</div>';

  const fanInSection = fanIn.length === 0 && cycles.length === 0
    ? '<div class="muted" style="font-size:11.5px">No high-coupling findings.</div>'
    : '<div class="chart-wrap chart-lg"><canvas id="hl-fanin"></canvas></div>' +
      (cycles.length > 0
        ? '<div class="muted" style="font-size:10.5px;margin-top:6px"><b style="color:var(--crit)">' + cycles.length + ' import cycles</b> detected — see Findings tab (kind: import-cycle).</div>'
        : '<div class="muted" style="font-size:10.5px;margin-top:6px">No import cycles. Top fan-in files = candidates for splitting.</div>');

  // Cross-repo drift card — only for the cross-repo run
  const crossRepoSection = isCrossRepo
    ? '<div class="card" style="grid-column:span 2">' +
      '<h3>Cross-repo drift (orphan + constants)</h3>' +
      (orphans.length + drift.length === 0
        ? '<div class="muted" style="font-size:11.5px">No drift detected.</div>'
        : '<div class="cards" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));margin-bottom:12px">' +
          '<div class="card" style="padding:12px"><h3>Orphan backend changes</h3><div class="metric"><span class="v">' + orphans.length + '</span><span class="l">no matching FE update</span></div></div>' +
          '<div class="card" style="padding:12px"><h3>Constants drift</h3><div class="metric"><span class="v">' + drift.length + '</span><span class="l">FE↔BE mismatched values</span></div></div>' +
          '<div class="card" style="padding:12px"><h3>Unused response fields</h3><div class="metric"><span class="v">' + apiUnused.length + '</span><span class="l">BE returns, FE ignores</span></div></div>' +
          '</div>' +
          '<table class="compact"><thead><tr><th>Kind</th><th>File</th><th>Detail</th></tr></thead><tbody>' +
          [...orphans, ...drift, ...apiUnused].slice(0, 20).map(f =>
            '<tr><td><span class="kind">' + f.kind + '</span></td>' +
            '<td><span class="file">' + escape(f.file) + (f.line ? ':' + f.line : '') + '</span></td>' +
            '<td>' + escape((f.message || '').slice(0, 100)) + '</td></tr>'
          ).join('') +
          '</tbody></table>'
      ) +
      '</div>'
    : '';

  return \`
    <div class="cards cols-12">
      <div class="card" style="grid-column:span 4">
        <h3>Supply chain (CVEs)</h3>
        <div class="metric">
          <span class="v" style="color:\${cveBySev.critical > 0 ? 'var(--crit)' : cveBySev.high > 0 ? 'var(--high)' : 'var(--ink)'}">\${cves.length}</span>
          <span class="l">vulns · \${cveBySev.critical} crit · \${cveBySev.high} high</span>
        </div>
        \${cveSection}
      </div>
      <div class="card" style="grid-column:span 8">
        <h3>Bundle bloat (top files by transitive KB)</h3>
        \${heavySection}
      </div>
      <div class="card" style="grid-column:1/-1">
        <h3>Import coupling (top fan-in)</h3>
        \${fanInSection}
      </div>
      \${crossRepoSection ? '<div style="grid-column:1/-1">' + crossRepoSection + '</div>' : ''}
    </div>\`;
}

function attachHealth(run) {
  const findings = run.doc.findings || [];
  const cves = findings.filter(f => f.kind === 'cve');
  const heavy = findings.filter(f => f.kind === 'heavy-imports');
  const fanIn = findings.filter(f => f.kind === 'fan-in-high');

  // CVE severity doughnut
  const cveBySev = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of cves) cveBySev[f.severity] = (cveBySev[f.severity] || 0) + 1;
  const cveLabels = ['critical', 'high', 'medium', 'low', 'info'].filter(k => cveBySev[k] > 0);
  if (cveLabels.length && document.getElementById('hl-cve')) {
    reg(new Chart(document.getElementById('hl-cve'), {
      type: 'doughnut',
      data: {
        labels: cveLabels,
        datasets: [{
          data: cveLabels.map(k => cveBySev[k]),
          backgroundColor: cveLabels.map(k => SEVERITY_COLORS[k]),
          borderColor: '#11141a', borderWidth: 2,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right' } } },
    }));
  }

  // Bundle bloat horizontal bar — top 12 files by transitive KB
  const heavyTop = heavy.sort((a, b) => (b.meta?.kb || 0) - (a.meta?.kb || 0)).slice(0, 12);
  if (heavyTop.length && document.getElementById('hl-bundle')) {
    reg(new Chart(document.getElementById('hl-bundle'), {
      type: 'bar',
      data: {
        labels: heavyTop.map(f => shortenPath(f.file)),
        datasets: [{
          data: heavyTop.map(f => Math.round((f.meta?.kb || 0) / 1024 * 10) / 10),
          backgroundColor: heavyTop.map(f => f.severity === 'critical' ? SEVERITY_COLORS.critical : f.severity === 'high' ? SEVERITY_COLORS.high : SIGNAL),
          borderRadius: 1,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: (i) => heavyTop[i[0].dataIndex].file,
            label: (i) => i.parsed.x + ' MB · ' + ((heavyTop[i.dataIndex].meta?.deps || []).slice(0, 5).join(', ') || ''),
          } },
        },
        scales: { x: { title: { display: true, text: 'transitive MB' }, grid: { color: GRID_LINE } }, y: { grid: { display: false } } },
      },
    }));
  }

  // Fan-in horizontal bar — top 12 high-coupling files
  const fanInTop = fanIn.sort((a, b) => (b.meta?.fan_in || 0) - (a.meta?.fan_in || 0)).slice(0, 12);
  if (fanInTop.length && document.getElementById('hl-fanin')) {
    reg(new Chart(document.getElementById('hl-fanin'), {
      type: 'bar',
      data: {
        labels: fanInTop.map(f => shortenPath(f.file)),
        datasets: [{
          data: fanInTop.map(f => f.meta?.fan_in || 0),
          backgroundColor: fanInTop.map(f => f.severity === 'critical' ? SEVERITY_COLORS.critical : f.severity === 'high' ? SEVERITY_COLORS.high : SIGNAL),
          borderRadius: 1,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: (i) => fanInTop[i[0].dataIndex].file,
            label: (i) => 'imported by ' + i.parsed.x + ' files · fan-out ' + (fanInTop[i.dataIndex].meta?.fan_out ?? '?'),
          } },
        },
        scales: { x: { title: { display: true, text: 'fan-in (importers)' }, grid: { color: GRID_LINE } }, y: { grid: { display: false } } },
      },
    }));
  }
}

// Truncate long file paths for chart axis labels (keep filename + parent dir)
function shortenPath(p, maxLen = 36) {
  if (p.length <= maxLen) return p;
  const parts = p.split('/');
  if (parts.length <= 2) return p;
  return '…/' + parts.slice(-2).join('/');
}

// histogram helper — equal-width buckets.
// items: array of arbitrary objects. valueFn: extracts the bucketing value.
// Returns labels, counts, midpoints, AND items-per-bucket for drilldown.
function histogramBuckets(items, n, valueFn) {
  const getValue = valueFn || ((x) => x);
  const values = items.map(getValue).filter((v) => typeof v === 'number' && !isNaN(v));
  if (!values.length) return { labels: [], counts: [], midpoints: [], buckets: [] };
  const min = Math.min(...values), max = Math.max(...values);
  if (min === max) {
    return {
      labels: [min.toFixed(1)],
      counts: [values.length],
      midpoints: [min],
      buckets: [items.filter((it) => typeof getValue(it) === 'number')],
    };
  }
  const w = (max - min) / n;
  const counts = new Array(n).fill(0);
  const buckets = new Array(n).fill(null).map(() => []);
  for (const it of items) {
    const v = getValue(it);
    if (typeof v !== 'number' || isNaN(v)) continue;
    const i = Math.min(n - 1, Math.floor((v - min) / w));
    counts[i]++;
    buckets[i].push(it);
  }
  const labels = [], midpoints = [];
  for (let i = 0; i < n; i++) {
    const lo = min + i * w, hi = lo + w;
    labels.push(lo.toFixed(lo < 10 ? 1 : 0) + '-' + hi.toFixed(hi < 10 ? 1 : 0));
    midpoints.push(lo + w / 2);
  }
  return { labels, counts, midpoints, buckets };
}

// Render a drilldown panel showing the files in a histogram bucket.
// valueFn formats the per-item value shown next to each filename.
function renderDrilldown(drillEl, label, items, valueFn) {
  if (!drillEl) return;
  if (!items || !items.length) {
    drillEl.classList.remove('open');
    drillEl.innerHTML = '';
    return;
  }
  const sorted = items.slice().sort((a, b) => (valueFn(b) - valueFn(a)));
  const rows = sorted.slice(0, 50).map(it =>
    '<li><span class="v">' + valueFn(it).toFixed(1) + '</span><span class="file">' + escape(it.file || '?') + '</span></li>'
  ).join('');
  const more = sorted.length > 50 ? '<li class="muted" style="font-size:10.5px;justify-content:center">+ ' + (sorted.length - 50) + ' more</li>' : '';
  drillEl.innerHTML =
    '<div class="drill-header">' +
    '<span>' + escape(label) + ' · ' + items.length + ' file' + (items.length === 1 ? '' : 's') + '</span>' +
    '<button class="clear-btn" onclick="this.closest(\\'.drill\\').classList.remove(\\'open\\')">clear</button>' +
    '</div>' +
    '<ul>' + rows + more + '</ul>';
  drillEl.classList.add('open');
}

function renderDeltaCard(d) {
  if (!d) return '';
  const sameCommit = PAYLOAD.meta.gitSha && d.baselineRef === PAYLOAD.meta.gitSha;
  if (sameCommit) {
    return \`<div class="card">
      <h3>Vs baseline (\${escape(d.baselineRef)})</h3>
      <div style="font-size:13px;color:var(--muted);margin-top:6px">
        Baseline ref is the current commit — no deltas to compute.
      </div>
    </div>\`;
  }
  const sign = d.painscoreDelta.totalDelta >= 0 ? '+' : '';
  const cls = d.painscoreDelta.totalDelta < 0 ? 'delta-good' : 'delta-bad';
  return \`<div class="card">
    <h3>Vs baseline (\${escape(d.baselineRef || 'auto')})</h3>
    <div class="metric"><span class="v \${cls}">\${sign}\${d.painscoreDelta.totalDelta.toFixed(1)}</span><span class="l">painscore total Δ</span></div>
    <div style="font-size:12px;color:var(--muted);margin-top:6px">
      added <b style="color:var(--critical)">\${d.summary.addedCount}</b>,
      resolved <b style="color:var(--low)">\${d.summary.resolvedCount}</b><br/>
      improved <b>\${d.summary.painscoreImproved}</b> files,
      worsened <b>\${d.summary.painscoreWorsened}</b>
    </div>
  </div>\`;
}

// ----- ACTION ITEMS
function renderActions(run) {
  const items = run.actions || [];
  if (!items.length) return '<div class="muted">No action items above threshold.</div>';
  return items.map(it => {
    const findings = (it.topFindings || []).map(f =>
      '<li><span class="sev sev-' + f.severity + '">' + f.severity + '</span> ' +
      '<span class="kind">' + f.kind + '</span>' + (f.line ? ' L' + f.line : '') +
      ' — ' + escape(f.message) + '</li>'
    ).join('');
    const actions = (it.suggestedActions || []).map(a => '<li>' + escape(a) + '</li>').join('');
    return \`<div class="action-item">
      <h4><span class="rank">\${it.rank}</span><span class="kind">pain \${it.painscore.toFixed(1)}</span> \${escape(it.file)}</h4>
      <div class="reasons">\${escape((it.reasons || []).join(' · '))}</div>
      <ul>\${actions}</ul>
      \${findings ? '<details open><summary>Top findings (' + (it.topFindings || []).length + ')</summary><ul>' + findings + '</ul></details>' : ''}
    </div>\`;
  }).join('');
}

// ----- SCORECARD (per-run)
function scorecardSection() {
  return \`<div class="controls">
    <input id="scorecardSearch" type="search" placeholder="Filter file path…" />
    <span class="muted">Top files by painscore.</span>
  </div>
  <table id="scorecardTable">
    <thead><tr><th data-sort="painscore" class="right">Pain ▾</th><th data-sort="file">File</th><th>Top contributors</th></tr></thead>
    <tbody></tbody>
  </table>\`;
}
let scorecardSort = { col: 'painscore', dir: -1 };
function attachScorecard(run) {
  function renderTable() {
    const q = (document.getElementById('scorecardSearch').value || '').toLowerCase();
    const rows = (run.scorecard.files || [])
      .filter(f => !q || f.file.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        const c = scorecardSort.col;
        const v = c === 'file' ? a.file.localeCompare(b.file) : (a[c] - b[c]);
        return scorecardSort.dir * v;
      })
      .slice(0, 200);
    const maxPain = Math.max(...((run.scorecard.files || []).map(f => f.painscore)), 1);
    document.querySelector('#scorecardTable tbody').innerHTML = rows.map(f => {
      const contribs = topContribs(f.breakdown);
      const barW = (f.painscore / maxPain) * 100;
      return '<tr><td class="num">' + f.painscore.toFixed(1) +
        ' <span class="bar" style="width:' + barW.toFixed(0) + 'px"></span></td>' +
        '<td class="file">' + escape(f.file) + '</td>' +
        '<td>' + contribs + '</td></tr>';
    }).join('');
  }
  document.getElementById('scorecardSearch').addEventListener('input', renderTable);
  document.querySelectorAll('#scorecardTable th').forEach(th => th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (!col) return;
    if (scorecardSort.col === col) scorecardSort.dir = -scorecardSort.dir;
    else { scorecardSort.col = col; scorecardSort.dir = -1; }
    renderTable();
  }));
  renderTable();
}

// ----- FINDINGS
function findingsSection() {
  return \`<div class="controls">
    <input id="findingsSearch" type="search" placeholder="Filter file or message…" />
    <span>Severity:</span>
    <span class="pill sev-critical active" data-sev="critical">critical</span>
    <span class="pill sev-high active" data-sev="high">high</span>
    <span class="pill sev-medium active" data-sev="medium">medium</span>
    <span class="pill sev-low" data-sev="low">low</span>
    <span class="pill" data-sev="info">info</span>
    <span>Kind:</span>
    <select id="kindFilter"><option value="">all</option></select>
  </div>
  <table id="findingsTable">
    <thead><tr><th data-sort="severity">Sev</th><th data-sort="kind">Kind</th><th data-sort="score" class="right">Score</th><th data-sort="file">Location</th><th>Message</th></tr></thead>
    <tbody></tbody>
  </table>\`;
}
function attachFindings(run) {
  const findings = run.doc.findings || [];
  const sevSet = new Set(['critical', 'high', 'medium']);
  const kindSelect = document.getElementById('kindFilter');
  const kinds = [...new Set(findings.map(f => f.kind))].sort();
  for (const k of kinds) kindSelect.innerHTML += '<option value="' + k + '">' + k + '</option>';
  function renderTable() {
    const q = (document.getElementById('findingsSearch').value || '').toLowerCase();
    const kind = kindSelect.value;
    const rows = findings
      .filter(f => sevSet.has(f.severity))
      .filter(f => !kind || f.kind === kind)
      .filter(f => !q || (f.file.toLowerCase().includes(q) || (f.message || '').toLowerCase().includes(q)))
      .slice(0, 500);
    document.querySelector('#findingsTable tbody').innerHTML = rows.map(f =>
      '<tr><td><span class="sev sev-' + f.severity + '">' + f.severity + '</span></td>' +
      '<td><span class="kind">' + f.kind + '</span></td>' +
      '<td class="num">' + (f.score ?? '') + '</td>' +
      '<td class="file">' + escape(f.file) + (f.line ? ':' + f.line : '') + '</td>' +
      '<td>' + escape(f.message || '') + '</td></tr>'
    ).join('');
  }
  document.querySelectorAll('.pill[data-sev]').forEach(c => c.addEventListener('click', () => {
    const sev = c.dataset.sev;
    if (sevSet.has(sev)) { sevSet.delete(sev); c.classList.remove('active'); }
    else { sevSet.add(sev); c.classList.add('active'); }
    renderTable();
  }));
  document.getElementById('findingsSearch').addEventListener('input', renderTable);
  kindSelect.addEventListener('change', renderTable);
  renderTable();
}

// ----- CLUSTERS
function clustersSection() {
  return \`<div class="controls">
    <input id="clustersSearch" type="search" placeholder="Filter cluster…" />
    <span class="muted">Semantic-dup clusters, sorted by size × similarity.</span>
  </div>
  <div id="clusters"></div>\`;
}
function attachClusters(run) {
  const findings = run.doc.findings || [];
  function render() {
    const q = (document.getElementById('clustersSearch').value || '').toLowerCase();
    const byCluster = new Map();
    for (const f of findings) {
      if (f.kind !== 'semantic-dup') continue;
      const id = f.meta?.cluster_id;
      if (!id) continue;
      if (!byCluster.has(id)) byCluster.set(id, { id, members: [], avgSim: f.meta.avg_sim, size: f.meta.cluster_size });
      byCluster.get(id).members.push(f);
    }
    const sorted = [...byCluster.values()].sort((a, b) => b.size - a.size);
    const filtered = sorted.filter(c => !q || c.members.some(m => m.file.toLowerCase().includes(q)));
    document.getElementById('clusters').innerHTML = filtered.slice(0, 80).map(c => {
      const memberLines = c.members.map(m =>
        '<div class="file">• ' + escape(m.file) + ':' + (m.line || '') + ' — <span class="muted">' + escape(m.meta?.chunk_name || '') + '</span></div>'
      ).join('');
      return '<div class="cluster-detail"><b>Cluster #' + c.id + '</b> · ' + c.size +
        ' members · avg sim ' + (c.avgSim?.toFixed(3) || '?') +
        '<div class="refs">' + memberLines + '</div></div>';
    }).join('');
  }
  document.getElementById('clustersSearch').addEventListener('input', render);
  render();
}

// ----- COMPARE
function renderCompare(run) {
  const d = run.delta;
  if (!d) return '<div class="muted">No baseline saved yet. Run <code>slopscan --save-baseline</code> on the ref you want to compare against, then re-run.</div>';
  // Same-commit comparison: deltas are necessarily zero. Show explanation.
  const sameCommit = PAYLOAD.meta.gitSha && d.baselineRef === PAYLOAD.meta.gitSha;
  if (sameCommit) {
    return '<div class="card" style="max-width:720px"><h3>Baseline ref matches current commit</h3>' +
      '<p>Comparing <code>' + escape(d.baselineRef) + '</code> to itself — by definition zero deltas.</p>' +
      '<p class="muted">To see real deltas, save a baseline on a different commit:</p>' +
      '<pre style="background:var(--panel-2);padding:10px;border-radius:6px;font-size:12px"># save now\\nslopscan --save-baseline\\n\\n# … make changes …\\n\\n# compare\\nslopscan --baseline auto</pre></div>';
  }
  const allZero = d.painscoreDelta.totalDelta === 0 && d.summary.addedCount === 0 && d.summary.resolvedCount === 0;
  if (allZero) {
    return '<div class="card" style="max-width:720px"><h3>No changes vs baseline <code>' + escape(d.baselineRef) + '</code></h3>' +
      '<p class="muted">Painscore total Δ = 0, no findings added or resolved. Either the codebase is identical to baseline or this run targeted the same content.</p></div>';
  }
  const perFile = (d.painscoreDelta.perFile || []).slice(0, 50);
  const rows = perFile.map(p => {
    const cls = p.delta < 0 ? 'improved' : 'worsened';
    const sign = p.delta >= 0 ? '+' : '';
    return '<tr class="' + cls + '"><td class="file">' + escape(p.file) + '</td>' +
      '<td class="num">' + p.before.toFixed(1) + '</td>' +
      '<td class="num">' + p.after.toFixed(1) + '</td>' +
      '<td class="num">' + sign + p.delta.toFixed(1) + '</td></tr>';
  }).join('');
  const addRows = (d.findings.added || []).slice(0, 50).map(f =>
    '<tr><td><span class="sev sev-' + f.severity + '">' + f.severity + '</span></td>' +
    '<td><span class="kind">' + f.kind + '</span></td>' +
    '<td class="file">' + escape(f.file) + '</td>' +
    '<td>' + escape(f.message || '') + '</td></tr>'
  ).join('');
  const resRows = (d.findings.resolved || []).slice(0, 50).map(f =>
    '<tr><td><span class="sev sev-' + f.severity + '">' + f.severity + '</span></td>' +
    '<td><span class="kind">' + f.kind + '</span></td>' +
    '<td class="file">' + escape(f.file) + '</td>' +
    '<td>' + escape(f.message || '') + '</td></tr>'
  ).join('');
  return \`
    <div class="compare-cards">
      <div class="card"><h3>Painscore total Δ</h3><div class="metric"><span class="v \${d.painscoreDelta.totalDelta < 0 ? 'delta-good' : 'delta-bad'}">\${d.painscoreDelta.totalDelta >= 0 ? '+' : ''}\${d.painscoreDelta.totalDelta.toFixed(1)}</span></div></div>
      <div class="card"><h3>Findings added</h3><div class="metric"><span class="v" style="color:var(--critical)">+\${d.summary.addedCount}</span></div></div>
      <div class="card"><h3>Findings resolved</h3><div class="metric"><span class="v" style="color:var(--low)">-\${d.summary.resolvedCount}</span></div></div>
    </div>
    <h3 style="margin-top:24px">Per-file painscore Δ (top 50 by |Δ|)</h3>
    <table class="delta-table"><thead><tr><th>File</th><th class="right">Before</th><th class="right">After</th><th class="right">Δ</th></tr></thead><tbody>\${rows}</tbody></table>
    <h3 style="margin-top:24px">Findings added</h3>
    <table><thead><tr><th>Sev</th><th>Kind</th><th>File</th><th>Message</th></tr></thead><tbody>\${addRows || '<tr><td colspan=4 class="muted">none</td></tr>'}</tbody></table>
    <h3 style="margin-top:24px">Findings resolved</h3>
    <table><thead><tr><th>Sev</th><th>Kind</th><th>File</th><th>Message</th></tr></thead><tbody>\${resRows || '<tr><td colspan=4 class="muted">none</td></tr>'}</tbody></table>
  \`;
}

// ----- STATS
function renderStats(run) {
  const rows = Object.entries(run.stats || {}).map(([name, s]) => {
    const notes = Object.entries(s).filter(([k]) => !['findings', 'elapsed_ms'].includes(k))
      .map(([k, v]) => k + '=' + v).join(' ');
    return '<tr><td>' + escape(name) + '</td>' +
      '<td class="num">' + (s.findings || 0) + '</td>' +
      '<td class="num">' + (s.elapsed_ms || 0) + '</td>' +
      '<td class="muted">' + escape(notes) + '</td></tr>';
  }).join('');
  return \`<table>
    <thead><tr><th>Analyzer</th><th class="right">Findings</th><th class="right">Time (ms)</th><th>Notes</th></tr></thead>
    <tbody>\${rows}</tbody>
  </table>\`;
}

// ----- helpers
function topContribs(b) {
  if (!b) return '';
  return Object.entries(b)
    .map(([k, v]) => ({ k, c: v.contribution || 0 }))
    .filter(e => e.c > 0.5)
    .sort((a, b) => b.c - a.c).slice(0, 4)
    .map(e => '<span class="kind">' + e.k + ' ' + e.c.toFixed(1) + '</span>')
    .join(' ');
}
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

render();
</script>
</body>
</html>`;
}
