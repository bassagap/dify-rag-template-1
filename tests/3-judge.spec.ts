import { expect, test } from '@playwright/test';
import { golden } from './golden';
import { ask, ChatResponse, expectOk, judge, requireEnv, Verdict } from './helpers/dify';

// LEVEL 3 – LLM-AS-A-JUDGE
// Some qualities can't be checked with "contains": is every claim in the answer supported by the
// retrieved documents? Did the bot refuse instead of answering from general knowledge?
// A second LLM (the "Exercise 5: RAG Judge" Dify workflow) grades ONE criterion at a time and
// returns PASS or FAIL with its reasoning.
//
// Part A checks the judge itself on answers whose correct verdict we already know.
// Only trust the judge in Part B once Part A is green.

const { criteria, calibration, live } = golden.judge;

function explain(v: Verdict) {
  test.info().annotations.push({ type: `judge: ${v.verdict}`, description: v.reasoning || v.raw });
}

test.describe('Level 3A – Calibrate the judge', () => {
  test.beforeEach(() => requireEnv('DIFY_BASE_URL', 'DIFY_JUDGE_KEY'));

  for (const c of calibration) {
    test(`${c.criterion}: ${c.name} → ${c.expected}`, async ({ request }) => {
      await test.step(`Given an answer we know should ${c.expected}`, async () => {});

      const v = await test.step(`When the judge grades ${c.criterion}`, () =>
        judge(request, { criterion: criteria[c.criterion], question: c.question, answer: c.answer, context: c.context, reference: c.reference }),
      );
      explain(v);

      await test.step(`Then the judge says ${c.expected}`, async () => {
        expect(v.verdict, `judge reasoning: ${v.reasoning || v.raw}`).toBe(c.expected);
      });
    });
  }
});

test.describe('Level 3B – Judge the chatbot', () => {
  test.beforeEach(() => requireEnv('DIFY_BASE_URL', 'DIFY_APP_KEY', 'DIFY_JUDGE_KEY'));

  for (const c of live) {
    test(`${c.criterion}: ${c.name}`, async ({ request }) => {
      let reply!: ChatResponse;

      await test.step(`When I ask the chatbot "${c.query}"`, async () => {
        const res = await ask(request, c.query);
        await expectOk(res);
        reply = await res.json();
        test.info().annotations.push({ type: 'answer', description: reply.answer });
      });

      // The judge sees exactly what the chatbot was grounded on: the chunks Dify cites
      const context = (reply.metadata.retriever_resources ?? []).map((r) => r.content).join('\n\n---\n\n');

      const v = await test.step(`And the judge grades ${c.criterion}`, () =>
        judge(request, { criterion: criteria[c.criterion], question: c.query, answer: reply.answer, context, reference: c.reference }),
      );
      explain(v);

      await test.step('Then the judge says PASS', async () => {
        expect(v.verdict, `judge reasoning: ${v.reasoning || v.raw}`).toBe('PASS');
      });
    });
  }
});
