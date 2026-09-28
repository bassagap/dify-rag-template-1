// Reads Playwright's JSON report and turns it into one row per test with pass counts.
// Used by summary.mjs (GitHub job summary) and dashboard.mjs (history page on GitHub Pages).
import { readFileSync } from 'node:fs';

const SUITES = {
  '1-retrieval': 'Level 1 · Retrieval',
  '2-chatbot': 'Level 2 · Chatbot',
  '3-judge': 'Level 3 · LLM judge',
  '4-adversarial': 'Adversarial',
};

export function readResults(file) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const rows = new Map();

  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const base = spec.file.split('/').pop().replace(/\.spec\.ts$/, '');
      for (const t of spec.tests) {
        const key = `${base} › ${spec.title}`;
        const row = rows.get(key) ?? {
          key,
          suite: SUITES[base] ?? base,
          title: spec.title,
          passed: 0,
          failed: 0,
          skipped: 0,
          flaky: 0,
          answer: '',
          judge: '',
          error: '',
          failedAnswer: '',
        };
        // With --repeat-each every repetition is its own entry; retries live inside `results`
        if (t.status === 'skipped') row.skipped++;
        else if (t.status === 'unexpected') row.failed++;
        else {
          row.passed++;
          if (t.status === 'flaky') row.flaky++;
        }
        const last = t.results.at(-1);
        const notes = [...(last?.annotations ?? []), ...(t.annotations ?? [])];
        row.answer ||= notes.find((a) => a.type === 'answer')?.description ?? '';
        row.judge ||= notes.find((a) => a.type.startsWith('judge:'))?.type.replace('judge: ', '') ?? '';
        if (t.status === 'unexpected' && !row.error) {
          row.error = (last?.errors?.[0]?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0];
          row.failedAnswer = notes.find((a) => a.type === 'answer')?.description ?? '';
        }
        rows.set(key, row);
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const s of report.suites) walk(s);

  const list = [...rows.values()];
  const count = (f) => list.filter(f).length;
  return {
    startTime: report.stats?.startTime,
    durationSeconds: Math.round((report.stats?.duration ?? 0) / 1000),
    totals: {
      tests: list.length,
      allPassed: count((r) => r.failed === 0 && r.passed > 0),
      someFailed: count((r) => r.failed > 0 && r.passed > 0),
      allFailed: count((r) => r.failed > 0 && r.passed === 0),
      skipped: count((r) => r.passed + r.failed === 0),
      runsPassed: list.reduce((n, r) => n + r.passed, 0),
      runsTotal: list.reduce((n, r) => n + r.passed + r.failed, 0),
    },
    rows: list,
  };
}
