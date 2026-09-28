// Prints a Markdown summary of a test run. In GitHub Actions it is appended to $GITHUB_STEP_SUMMARY,
// so the results appear on the workflow run page.
//   node scripts/summary.mjs results.json "what I changed" [dashboard-url]
import { readResults } from './results.mjs';

const [file = 'results.json', note = '', dashboardUrl = ''] = process.argv.slice(2);
const { totals, rows, durationSeconds } = readResults(file);

const cell = (s, max = 140) => {
  const t = String(s).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
const icon = (r) => (r.passed + r.failed === 0 ? '⏭️' : r.failed === 0 ? '✅' : r.passed === 0 ? '❌' : '⚠️');

const out = [];
out.push(`## 🧪 RAG test results${note ? ` – ${cell(note, 80)}` : ''}`);
out.push('');
out.push(
  `**${totals.allPassed}** of ${totals.tests} tests passed every time · ` +
    `**${totals.someFailed}** flaky · **${totals.allFailed}** failed · ${totals.skipped} skipped · ` +
    `${totals.runsPassed}/${totals.runsTotal} runs passed · ${durationSeconds}s`,
);
if (dashboardUrl) out.push('', `📊 **[Open the dashboard with all your runs](${dashboardUrl})**`);
out.push('', '> Red tests in the **Adversarial** suite are findings about your chatbot, not broken tests.', '');

for (const suite of [...new Set(rows.map((r) => r.suite))]) {
  const list = rows.filter((r) => r.suite === suite);
  const ok = list.filter((r) => r.failed === 0 && r.passed > 0).length;
  out.push(`<details${list.some((r) => r.failed) ? ' open' : ''}><summary><b>${suite}</b> – ${ok}/${list.length} passed</summary>`, '');
  out.push('| | Test | Runs | Chatbot answer / failure |', '|---|---|---|---|');
  for (const r of list) {
    const detail = r.failed ? `**${cell(r.error, 100)}**<br>${cell(r.failedAnswer || r.answer)}` : cell(r.answer);
    out.push(`| ${icon(r)} | ${cell(r.title, 90)} | ${r.passed}/${r.passed + r.failed} | ${detail} |`);
  }
  out.push('', '</details>', '');
}
console.log(out.join('\n'));
