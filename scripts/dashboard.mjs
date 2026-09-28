// Adds one test run to the GitHub Pages site and rebuilds the dashboard.
//   node scripts/dashboard.mjs <site-dir> <results.json> <playwright-report-dir>
// Run metadata comes from environment variables set by the workflow (RUN_NUMBER, RUN_NOTE, …).
// The site keeps: history.json (all runs), runs/<n>/ (each Playwright HTML report), index.html (dashboard).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readResults } from './results.mjs';

const [site, resultsFile, reportDir] = process.argv.slice(2);
const env = process.env;
const runNumber = env.RUN_NUMBER ?? String(Date.now());

// 1. Store this run's Playwright report
mkdirSync(join(site, 'runs'), { recursive: true });
if (reportDir && existsSync(reportDir)) cpSync(reportDir, join(site, 'runs', runNumber), { recursive: true });

// 2. Append this run to the history
const historyFile = join(site, 'history.json');
const history = existsSync(historyFile) ? JSON.parse(readFileSync(historyFile, 'utf8')) : [];
const { totals, rows, startTime } = readResults(resultsFile);
history.push({
  run: Number(runNumber),
  date: startTime ?? new Date().toISOString(),
  note: env.RUN_NOTE ?? '',
  suite: env.RUN_SUITE ?? '',
  repeat: Number(env.RUN_REPEAT ?? 1),
  sha: (env.GITHUB_SHA ?? '').slice(0, 7),
  actionsUrl: env.RUN_URL ?? '',
  totals,
  tests: Object.fromEntries(
    rows.map((r) => [r.key, { suite: r.suite, title: r.title, passed: r.passed, failed: r.failed, answer: (r.failedAnswer || r.answer).slice(0, 400), error: r.error.slice(0, 200) }]),
  ),
});
writeFileSync(historyFile, JSON.stringify(history, null, 1));
writeFileSync(join(site, '.nojekyll'), '');

// 3. Rebuild the dashboard (a single static page; the data is embedded, no requests needed)
const data = JSON.stringify(history.slice(-30)).replace(/</g, '\\u003c');
writeFileSync(join(site, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RAG Test Dashboard</title>
<style>
:root{--bg:#f7f7fb;--card:#fff;--text:#1d1b26;--muted:#6b6880;--line:#e4e2ee;--accent:#7c3aed;
--pass:#16a34a;--pass-bg:#dcfce7;--warn:#b45309;--warn-bg:#fef3c7;--fail:#dc2626;--fail-bg:#fee2e2;--skip-bg:#eeedf3}
@media (prefers-color-scheme:dark){:root{--bg:#131219;--card:#1d1b26;--text:#ecebf3;--muted:#a19eb5;--line:#2e2b3b;--accent:#a78bfa;
--pass:#4ade80;--pass-bg:#14331f;--warn:#fbbf24;--warn-bg:#3a2e10;--fail:#f87171;--fail-bg:#3d1717;--skip-bg:#26242f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.1rem;margin:32px 0 12px}.muted{color:var(--muted)}
a{color:var(--accent)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card b{display:block;font-size:1.7rem;line-height:1.2}.card span{color:var(--muted);font-size:.85rem}
.note{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:10px 14px;margin-top:16px}
svg{display:block;width:100%;height:140px;background:var(--card);border:1px solid var(--line);border-radius:12px}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:.85rem}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th.run{min-width:96px;font-weight:600}th.run small{display:block;font-weight:400;color:var(--muted);max-width:140px;white-space:normal}
td.test{min-width:260px;max-width:420px}tr.suite td{background:var(--bg);font-weight:700;padding-top:14px}
td.c{text-align:center;font-weight:600;cursor:help;border-left:2px solid var(--card)}
.p{background:var(--pass-bg);color:var(--pass)}.w{background:var(--warn-bg);color:var(--warn)}.f{background:var(--fail-bg);color:var(--fail)}.s{background:var(--skip-bg);color:var(--muted)}
.legend span{display:inline-block;padding:1px 8px;border-radius:6px;margin-right:6px;font-size:.8rem}
</style>
</head>
<body>
<main>
<h1>🧪 RAG Test Dashboard</h1>
<div class="muted">Every run of the GitHub Action against your Dify chatbot. Change something in Exercise 3, run the workflow again, and compare the columns.</div>
<div id="latest"></div>
<h2>Pass rate per run</h2>
<svg id="trend" role="img" aria-label="Percentage of passed test runs per workflow run"></svg>
<h2>Every test, every run</h2>
<div class="legend muted"><span class="p">3/3</span>always passed <span class="w">1/3</span>sometimes <span class="f">0/3</span>never <span class="s">–</span>not run · hover a cell to read the chatbot's answer · click a run to open its full Playwright report</div>
<div class="scroll" style="margin-top:10px"><table id="matrix"></table></div>
</main>
<script>
const runs = ${data};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (r) => (r.totals.runsTotal ? Math.round((100 * r.totals.runsPassed) / r.totals.runsTotal) : 0);
const latest = runs.at(-1);
if (latest) {
  const t = latest.totals;
  document.getElementById('latest').innerHTML =
    '<div class="note"><b>Latest run #' + latest.run + '</b> · ' + esc(new Date(latest.date).toLocaleString()) +
    (latest.note ? ' · <b>' + esc(latest.note) + '</b>' : '') + ' · suite: ' + esc(latest.suite) +
    ' · <a href="runs/' + latest.run + '/index.html">Playwright report</a>' +
    (latest.actionsUrl ? ' · <a href="' + esc(latest.actionsUrl) + '">GitHub Actions run</a>' : '') + '</div>' +
    '<div class="cards">' +
    '<div class="card"><b style="color:var(--pass)">' + t.allPassed + '</b><span>of ' + t.tests + ' tests always passed</span></div>' +
    '<div class="card"><b style="color:var(--warn)">' + t.someFailed + '</b><span>flaky (passed sometimes)</span></div>' +
    '<div class="card"><b style="color:var(--fail)">' + t.allFailed + '</b><span>always failed</span></div>' +
    '<div class="card"><b>' + pct(latest) + '%</b><span>' + t.runsPassed + ' of ' + t.runsTotal + ' executions passed</span></div></div>';
}
// Trend line
const svg = document.getElementById('trend');
if (runs.length) {
  const W = 1000, H = 140, pad = 28, n = runs.length;
  const x = (i) => (n === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
  const y = (v) => H - pad - (v / 100) * (H - 2 * pad);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'none');
  let g = [0, 50, 100].map((v) => '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="4" y="' + (y(v) + 4) + '" font-size="11" fill="var(--muted)">' + v + '%</text>').join('');
  g += '<polyline fill="none" stroke="var(--accent)" stroke-width="3" points="' + runs.map((r, i) => x(i) + ',' + y(pct(r))).join(' ') + '"/>';
  g += runs.map((r, i) => '<circle cx="' + x(i) + '" cy="' + y(pct(r)) + '" r="5" fill="var(--accent)"><title>#' + r.run + ' ' + esc(r.note) + ': ' + pct(r) + '%</title></circle>').join('');
  svg.innerHTML = g;
}
// Matrix: rows = tests grouped by suite, columns = runs (newest first)
const cols = runs.slice().reverse();
const keys = new Map();
for (const r of runs) for (const [k, v] of Object.entries(r.tests)) keys.set(k, v);
const suites = [...new Set([...keys.values()].map((v) => v.suite))];
let html = '<thead><tr><th>Test</th>' + cols.map((r) =>
  '<th class="run"><a href="runs/' + r.run + '/index.html">#' + r.run + '</a><small>' + esc(r.note || '—') + '</small><small>' + esc(new Date(r.date).toLocaleDateString()) + ' · ' + pct(r) + '%</small></th>').join('') + '</tr></thead><tbody>';
for (const s of suites) {
  html += '<tr class="suite"><td colspan="' + (cols.length + 1) + '">' + esc(s) + '</td></tr>';
  for (const [k, v] of keys) {
    if (v.suite !== s) continue;
    html += '<tr><td class="test">' + esc(v.title) + '</td>' + cols.map((r) => {
      const t = r.tests[k];
      if (!t || t.passed + t.failed === 0) return '<td class="c s">–</td>';
      const cls = t.failed === 0 ? 'p' : t.passed === 0 ? 'f' : 'w';
      const tip = (t.error ? t.error + '\\n\\n' : '') + (t.answer || '');
      return '<td class="c ' + cls + '" title="' + esc(tip) + '">' + t.passed + '/' + (t.passed + t.failed) + '</td>';
    }).join('') + '</tr>';
  }
}
document.getElementById('matrix').innerHTML = html + '</tbody>';
</script>
</body>
</html>
`);
console.log(`Dashboard updated: ${history.length} runs, latest #${runNumber}`);
