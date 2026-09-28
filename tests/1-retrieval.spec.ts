import { expect, test } from '@playwright/test';
import { golden } from './golden';
import { expectOk, isAbout, requireEnv, retrieve, RetrievedChunk } from './helpers/dify';

// LEVEL 1 – RETRIEVAL
// Does the knowledge base find the right Jira issue? No LLM is involved, so these tests are
// fast, free and give the same result every run. If they fail, the chatbot cannot be right either.

test.describe('Level 1 – Knowledge retrieval', () => {
  test.beforeEach(() => requireEnv('DIFY_BASE_URL', 'DIFY_DATASET_KEY', 'DIFY_DATASET_ID'));

  for (const c of golden.retrieval) {
    test(c.name, async ({ request }) => {
      let chunks: RetrievedChunk[] = [];

      await test.step('Given the Jira REST knowledge base is indexed', async () => {});

      await test.step(`When I search for "${c.query}"`, async () => {
        const res = await retrieve(request, c.query);
        await expectOk(res);
        chunks = (await res.json()).records;
      });

      await test.step(`Then ${c.expectedIssue} is ranked in the top ${c.maxRank}`, async () => {
        const ranking = chunks.map((r) => r.segment.document.name);
        const rank = chunks.findIndex((r) => isAbout(c.expectedIssue, r.segment.document.name, r.segment.content)) + 1;
        expect(rank, `ranking was: ${ranking.join(', ')}`).toBeGreaterThan(0);
        expect(rank, `ranking was: ${ranking.join(', ')}`).toBeLessThanOrEqual(c.maxRank);
      });
    });
  }

  for (const c of golden.retrievalNoMatch) {
    test(c.name, async ({ request }) => {
      await test.step(`When I search for "${c.query}"`, async () => {
        const res = await retrieve(request, c.query);
        expect(res.status()).toBe(200);
        const { records } = await res.json();

        await test.step('Then no chunks are returned', async () => {
          expect(records.map((r: RetrievedChunk) => r.segment.document.name)).toEqual([]);
        });
      });
    });
  }
});
