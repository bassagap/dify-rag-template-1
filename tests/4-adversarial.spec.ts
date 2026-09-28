import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { golden } from './golden';
import { ask, ChatResponse, expectOk, judge, requireEnv } from './helpers/dify';

// ADVERSARIAL SUITE – try to make the chatbot fail
// Each case targets one known weakness of RAG systems (similar documents, counting, false
// premises, missing data, prompt injection…). The expected behaviour comes from the raw Jira data.
// A RED test here is a FINDING about the chatbot, not a broken test. Run it with:
//   npm run test:adversarial
// See ADVERSARIAL.md for the results we measured and what they mean.

type Checks = {
  mustMention?: string[];
  mustNotMention?: string[];
  mustMatch?: string[];
  mustNotMatch?: string[];
  expectRefusal?: boolean;
  judge?: { criterion: string; reference?: string };
};
type Case = { id: string; category: string; why: string; query: string; truth: string; checks: Checks };

const { cases } = JSON.parse(readFileSync(join(__dirname, '..', 'golden', 'adversarial.json'), 'utf8')) as { cases: Case[] };

test.describe('Adversarial – try to break the chatbot', () => {
  test.beforeEach(() => requireEnv('DIFY_BASE_URL', 'DIFY_APP_KEY'));

  for (const c of cases) {
    test(`${c.id} ${c.category}: ${c.query}`, async ({ request }) => {
      test.info().annotations.push({ type: 'why it is hard', description: c.why }, { type: 'truth', description: c.truth });
      let reply!: ChatResponse;

      await test.step(`When I ask "${c.query}"`, async () => {
        const res = await ask(request, c.query);
        await expectOk(res);
        reply = await res.json();
        test.info().annotations.push({ type: 'answer', description: reply.answer });
      });

      const answer = reply.answer;
      const { checks } = c;

      for (const fact of checks.mustMention ?? []) {
        await test.step(`Then the answer mentions "${fact}"`, async () => {
          expect.soft(answer.toLowerCase(), `expected: ${c.truth}`).toContain(fact.toLowerCase());
        });
      }
      for (const wrong of checks.mustNotMention ?? []) {
        await test.step(`And it does not mention "${wrong}"`, async () => {
          expect.soft(answer.toLowerCase()).not.toContain(wrong.toLowerCase());
        });
      }
      for (const pattern of checks.mustMatch ?? []) {
        await test.step(`Then the answer matches /${pattern}/`, async () => {
          expect.soft(answer, `expected: ${c.truth}`).toMatch(new RegExp(pattern, 'i'));
        });
      }
      for (const pattern of checks.mustNotMatch ?? []) {
        await test.step(`And the answer does not match /${pattern}/`, async () => {
          expect.soft(answer).not.toMatch(new RegExp(pattern, 'i'));
        });
      }
      if (checks.expectRefusal) {
        await test.step('Then the chatbot refuses', async () => {
          expect.soft(answer, `expected: ${c.truth}`).toMatch(new RegExp(golden.refusalPattern, 'i'));
        });
      }
      if (checks.judge) {
        const { criterion, reference } = checks.judge;
        await test.step(`And the judge says the answer passes "${criterion}"`, async () => {
          if (!process.env.DIFY_JUDGE_KEY) {
            test.info().annotations.push({ type: 'judge skipped', description: 'Set DIFY_JUDGE_KEY to run the judge checks' });
            return;
          }
          const context = (reply.metadata.retriever_resources ?? []).map((r) => r.content).join('\n\n---\n\n');
          const v = await judge(request, { criterion: golden.judge.criteria[criterion], question: c.query, answer, context, reference });
          test.info().annotations.push({ type: `judge: ${v.verdict}`, description: v.reasoning || v.raw });
          expect.soft(v.verdict, `judge reasoning: ${v.reasoning || v.raw}`).toBe('PASS');
        });
      }
    });
  }
});
