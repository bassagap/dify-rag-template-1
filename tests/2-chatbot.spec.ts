import { expect, test } from '@playwright/test';
import { golden } from './golden';
import { ask, ChatResponse, expectOk, isAbout, issueKeys, requireEnv } from './helpers/dify';

// LEVEL 2 – THE CHATBOT END TO END
// We ask the published Exercise 3 app real questions and check PROPERTIES of the answer
// (never the exact text – LLM wording changes from run to run):
//   - it mentions the right fact
//   - it is grounded: the right document is cited
//   - it does not invent Jira issues that were not retrieved (hallucination check)
//   - it refuses when the knowledge base has no answer
//   - it is fast enough

test.describe('Level 2 – Chatbot answers', () => {
  test.beforeEach(() => requireEnv('DIFY_BASE_URL', 'DIFY_APP_KEY'));

  for (const c of golden.grounded) {
    test(`grounded: ${c.name}`, async ({ request }) => {
      let reply!: ChatResponse;

      await test.step('Given the chatbot is connected to the Jira knowledge base', async () => {});

      await test.step(`When I ask "${c.query}"`, async () => {
        const res = await ask(request, c.query);
        await expectOk(res);
        reply = await res.json();
        test.info().annotations.push({ type: 'answer', description: reply.answer });
      });

      for (const fact of c.mustMention) {
        await test.step(`Then the answer mentions "${fact}"`, async () => {
          expect.soft(reply.answer.toLowerCase()).toContain(fact.toLowerCase());
        });
      }

      const citations = reply.metadata.retriever_resources ?? [];

      await test.step(`And the answer cites the document for ${c.expectedIssue}`, async () => {
        const cited = citations.some((r) => isAbout(c.expectedIssue, r.document_name, r.content));
        expect.soft(cited, `cited: ${citations.map((r) => r.document_name).join(', ') || 'nothing'}`).toBe(true);
      });

      await test.step('And it only mentions Jira issues that it actually retrieved', async () => {
        const retrievedText = citations.map((r) => `${r.document_name}\n${r.content}`).join('\n');
        const invented = issueKeys(reply.answer).filter((key) => !retrievedText.includes(key));
        expect.soft(invented, 'issues in the answer that no cited document supports').toEqual([]);
      });

      await test.step(`And it answers within ${golden.latencyBudgetSeconds} seconds`, async () => {
        const usage = reply.metadata.usage;
        test.info().annotations.push({ type: 'usage', description: `${usage?.latency}s, ${usage?.total_tokens} tokens` });
        expect.soft(usage?.latency).toBeLessThan(golden.latencyBudgetSeconds);
      });
    });
  }

  for (const c of golden.refusals) {
    test(`refusal: ${c.name}`, async ({ request }) => {
      let reply!: ChatResponse;

      await test.step(`When I ask "${c.query}"`, async () => {
        const res = await ask(request, c.query);
        await expectOk(res);
        reply = await res.json();
        test.info().annotations.push({ type: 'answer', description: reply.answer });
      });

      await test.step('Then the chatbot politely says it cannot find it', async () => {
        expect(reply.answer).toMatch(new RegExp(golden.refusalPattern, 'i'));
      });

      await test.step('And it does not make up any Jira issue', async () => {
        const mentioned = issueKeys(reply.answer.replace(/REST-999/g, ''));
        expect(mentioned).toEqual([]);
      });

      if (c.expectNoCitations) {
        await test.step('And no documents are cited', async () => {
          expect(reply.metadata.retriever_resources ?? []).toEqual([]);
        });
      }
    });
  }

  test('error path: a wrong API key is rejected', async ({ request }) => {
    await test.step('When I call the chatbot with an invalid key', async () => {
      const res = await ask(request, 'hello', 'app-this-key-does-not-exist');

      await test.step('Then Dify answers 401 with a clear error body', async () => {
        expect(res.status()).toBe(401);
        expect(await res.json()).toMatchObject({ code: 'unauthorized', status: 401 });
      });
    });
  });
});
