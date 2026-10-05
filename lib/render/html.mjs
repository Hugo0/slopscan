// Single-file interactive HTML dashboard. Reads findings + scorecard + stats
// in-place (embedded as JSON) — no server, no build, no deps.

export function renderDashboard({ doc, scorecard, stats }) {
    const payload = JSON.stringify({ doc, scorecard, stats });
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>slopscan dashboard</title>
<style>
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --panel-2: #21262d;
  --border: #30363d;
  --text: #e6edf3;
  --muted: #8b949e;
  --accent: #58a6ff;
  --critical: #f85149;
  --high: #ff8e3c;
  --medium: #d29922;
  --low: #3fb950;
  --info: #6e7681;
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--text); }
header { padding: 12px 20px; background: var(--panel); border-bottom: 1px solid var(--border); display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
header h1 { margin: 0; font-size: 16px; font-weight: 600; }
header .meta { color: var(--muted); font-size: 12px; }
header .stat { font-size: 13px; }
header .stat b { color: var(--accent); }
nav.tabs { display: flex; gap: 4px; padding: 0 20px; background: var(--panel); border-bottom: 1px solid var(--border); }
nav.tabs button { background: none; border: none; color: var(--muted); padding: 12px 20px; cursor: pointer; font: inherit; border-bottom: 2px solid transparent; }
nav.tabs button.active { color: var(--text); border-bottom-color: var(--accent); }
nav.tabs button:hover { color: var(--text); }
main { padding: 20px; }
.controls { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.controls input, .controls select { background: var(--panel-2); border: 1px solid var(--border); color: var(--text); padding: 6px 10px; border-radius: 6px; font: inherit; }
.controls input { min-width: 240px; }
.pill { padding: 2px 8px; border-radius: 12px; background: var(--panel-2); font-size: 12px; cursor: pointer; user-select: none; }
.pill.active { background: var(--accent); color: var(--bg); }
.pill.sev-critical.active { background: var(--critical); }
.pill.sev-high.active { background: var(--high); }
.pill.sev-medium.active { background: var(--medium); color: var(--bg); }
.pill.sev-low.active { background: var(--low); color: var(--bg); }
table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: top; }
th { background: var(--panel-2); cursor: pointer; user-select: none; position: sticky; top: 0; }
th:hover { color: var(--accent); }
tr:last-child td { border-bottom: none; }
tr:hover { background: var(--panel-2); }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.sev { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
.sev-critical { background: var(--critical); color: white; }
.sev-high { background: var(--high); color: white; }
.sev-medium { background: var(--medium); color: var(--bg); }
.sev-low { background: var(--low); color: var(--bg); }
.sev-info { background: var(--info); color: white; }
.kind { padding: 1px 6px; border-radius: 4px; font-size: 11px; background: var(--panel-2); color: var(--muted); font-family: ui-monospace, monospace; }
.file { font-family: ui-monospace, monospace; font-size: 12px; }
.bar { display: inline-block; height: 8px; background: var(--accent); vertical-align: middle; border-radius: 2px; }
details { margin-top: 6px; }
details summary { cursor: pointer; color: var(--muted); font-size: 12px; }
.hidden { display: none !important; }
.cluster-detail { padding: 12px; background: var(--panel-2); border-radius: 6px; margin: 4px 0; }
.refs { color: var(--muted); font-size: 12px; margin-top: 4px; }
.muted { color: var(--muted); }
.right { text-align: right; }
</style>
</head>
<body>
<header>
  <h1>slopscan</h1>
  <div class="meta" id="meta"></div>
  <div class="stat">Files: <b id="fileCount"></b></div>
  <div class="stat">Findings: <b id="findCount"></b></div>
  <div class="stat">Analyzers: <b id="analyzerCount"></b></div>
</header>
<nav class="tabs">
  <button data-tab="scorecard" class="active">Scorecard</button>
  <button data-tab="findings">Findings</button>
  <button data-tab="clusters">Clusters</button>
  <button data-tab="stats">Pipeline stats</button>
</nav>
<main>
  <section id="tab-scorecard">
    <div class="controls">
      <input id="scorecardSearch" type="search" placeholder="Filter file path..." />
      <span class="muted">Top files by painscore (higher = more pain).</span>
    </div>
    <table id="scorecardTable">
      <thead>
        <tr>
          <th data-sort="painscore" class="right">Pain ▾</th>
          <th data-sort="file">File</th>
          <th>Top contributors</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section id="tab-findings" class="hidden">
    <div class="controls">
      <input id="findingsSearch" type="search" placeholder="Filter file or message..." />
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
      <thead>
        <tr>
          <th data-sort="severity">Sev</th>
          <th data-sort="kind">Kind</th>
          <th data-sort="score" class="right">Score</th>
          <th data-sort="file">Location</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section id="tab-clusters" class="hidden">
    <div class="controls">
      <input id="clustersSearch" type="search" placeholder="Filter cluster..." />
      <span class="muted">Semantic-dup clusters, sorted by size × similarity.</span>
    </div>
    <div id="clusters"></div>
  </section>

  <section id="tab-stats" class="hidden">
    <table>
      <thead><tr><th>Analyzer</th><th class="right">Findings</th><th class="right">Time (ms)</th><th>Notes</th></tr></thead>
      <tbody id="statsTable"></tbody>
    </table>
  </section>
</main>

<script>
const PAYLOAD = ${payload};
const findings = PAYLOAD.doc.findings;
const scorecard = PAYLOAD.scorecard;
const stats = PAYLOAD.stats;

document.getElementById('meta').textContent = PAYLOAD.doc.root + ' · ' + PAYLOAD.doc.generatedAt;
document.getElementById('fileCount').textContent = scorecard.files.length;
document.getElementById('findCount').textContent = findings.length;
document.getElementById('analyzerCount').textContent = PAYLOAD.doc.analyzers.length;

document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav.tabs button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
  document.getElementById('tab-' + b.dataset.tab).classList.remove('hidden');
}));

// SCORECARD
let scorecardSort = { col: 'painscore', dir: -1 };
function renderScorecard() {
  const q = document.getElementById('scorecardSearch').value.toLowerCase();
  const rows = scorecard.files
    .filter(f => !q || f.file.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      const c = scorecardSort.col;
      const v = c === 'file' ? a.file.localeCompare(b.file) : (a[c] - b[c]);
      return scorecardSort.dir * v;
    })
    .slice(0, 200);
  const maxPain = Math.max(...scorecard.files.map(f => f.painscore), 1);
  document.querySelector('#scorecardTable tbody').innerHTML = rows.map(f => {
    const contribs = topContribs(f.breakdown);
    const barW = (f.painscore / maxPain) * 100;
    return '<tr><td class="num">' + f.painscore.toFixed(1) + ' <span class="bar" style="width:' + barW.toFixed(0) + 'px"></span></td>' +
      '<td class="file">' + escape(f.file) + '</td>' +
      '<td>' + contribs + '</td></tr>';
  }).join('');
}
document.getElementById('scorecardSearch').addEventListener('input', renderScorecard);
document.querySelectorAll('#scorecardTable th').forEach(th => th.addEventListener('click', () => {
  const col = th.dataset.sort;
  if (!col) return;
  if (scorecardSort.col === col) scorecardSort.dir = -scorecardSort.dir;
  else { scorecardSort.col = col; scorecardSort.dir = -1; }
  renderScorecard();
}));

// FINDINGS
const sevSet = new Set(['critical', 'high', 'medium']);
const kindSelect = document.getElementById('kindFilter');
const kinds = [...new Set(findings.map(f => f.kind))].sort();
for (const k of kinds) kindSelect.innerHTML += '<option value="' + k + '">' + k + '</option>';

document.querySelectorAll('.pill[data-sev]').forEach(c => c.addEventListener('click', () => {
  const sev = c.dataset.sev;
  if (sevSet.has(sev)) { sevSet.delete(sev); c.classList.remove('active'); }
  else { sevSet.add(sev); c.classList.add('active'); }
  renderFindings();
}));

function renderFindings() {
  const q = document.getElementById('findingsSearch').value.toLowerCase();
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
document.getElementById('findingsSearch').addEventListener('input', renderFindings);
kindSelect.addEventListener('change', renderFindings);

// CLUSTERS — group semantic-dup findings by cluster_id
function renderClusters() {
  const q = document.getElementById('clustersSearch').value.toLowerCase();
  const byCluster = new Map();
  for (const f of findings) {
    if (f.kind !== 'semantic-dup') continue;
    const id = f.meta?.cluster_id;
    if (!id) continue;
    if (!byCluster.has(id)) byCluster.set(id, { id, members: [], avgSim: f.meta.avg_sim, size: f.meta.cluster_size });
    byCluster.get(id).members.push(f);
  }
  const sorted = [...byCluster.values()].sort((a, b) => b.size - a.size);
  const filtered = sorted.filter(c => {
    if (!q) return true;
    return c.members.some(m => m.file.toLowerCase().includes(q));
  });
  document.getElementById('clusters').innerHTML = filtered.slice(0, 80).map(c => {
    const memberLines = c.members.map(m =>
      '<div class="file">• ' + escape(m.file) + ':' + (m.line || '') + ' — <span class="muted">' + escape(m.meta?.chunk_name || '') + '</span></div>'
    ).join('');
    return '<div class="cluster-detail"><b>Cluster #' + c.id + '</b> · ' + c.size +
      ' members · avg sim ' + (c.avgSim?.toFixed(3) || '?') +
      '<div class="refs">' + memberLines + '</div></div>';
  }).join('');
}
document.getElementById('clustersSearch').addEventListener('input', renderClusters);

// STATS
const statRows = Object.entries(stats || {}).map(([name, s]) => {
  const notes = Object.entries(s).filter(([k]) => !['findings', 'elapsed_ms'].includes(k))
    .map(([k, v]) => k + '=' + v).join(' ');
  return '<tr><td>' + name + '</td><td class="num">' + (s.findings || 0) + '</td><td class="num">' + (s.elapsed_ms || 0) + '</td><td class="muted">' + escape(notes) + '</td></tr>';
}).join('');
document.getElementById('statsTable').innerHTML = statRows;

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

renderScorecard();
renderFindings();
renderClusters();
</script>
</body>
</html>`;
}
