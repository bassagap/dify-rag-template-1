import { APIRequestContext, expect, test } from '@playwright/test';

// Small wrappers around the two Dify endpoints we test.
// Docs: https://docs.dify.ai/en/api-reference/guides/chat
//       https://docs.dify.ai/en/api-reference/knowledge-bases/retrieve-chunks-from-a-knowledge-base-test-retrieval

const BASE_URL = (process.env.DIFY_BASE_URL ?? '').replace(/\/+$/, '');
const TEST_USER = 'qa-e2e'; // Dify requires a `user`; one fixed value keeps test conversations together

export type Citation = { document_name: string; content: string; score: number; position: number };

export type ChatResponse = {
  answer: string;
  message_id: string;
  conversation_id: string;
  metadata: {
    retriever_resources?: Citation[];
    usage?: { latency: number; total_tokens: number };
  };
};

export type RetrievedChunk = {
  score: number;
  segment: { content: string; document: { name: string } };
};

/** Skip the current test with a helpful message when a setting is missing from .env */
export function requireEnv(...names: string[]) {
  const isPlaceholder = (v: string) => v.includes('xxxx') || v.includes('<your-') || /^[0-]+$/.test(v);
  const missing = names.filter((n) => !process.env[n] || isPlaceholder(process.env[n]!));
  test.skip(missing.length > 0, `Fill in ${missing.join(', ')} in your .env file (see .env.example)`);
}

/**
 * Errors that say nothing about answer quality: too many requests, a server hiccup, or the
 * shared LLM being rate limited. We wait and try again instead of failing the test.
 */
async function isTemporaryError(res: ApiResponse) {
  if (res.status() === 429 || res.status() >= 500) return true;
  if (res.status() !== 400) return false;
  const body = await res.text();
  return /completion_request_error|rate.?limit|quota|timeout/i.test(body);
}

export type ApiResponse = { status(): number; text(): Promise<string>; json(): Promise<any> };

// We call Dify with Node's fetch instead of Playwright's `request` on purpose: Playwright would list
// every call with its full URL in the HTML report, and that report is published on GitHub Pages.
// This way your Dify address never appears in the public report. (`request` is kept in the signatures
// so the tests read like normal Playwright API tests.)
async function send(path: string, key: string, data: object): Promise<ApiResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  return { status: () => res.status, text: async () => body, json: async () => JSON.parse(body) };
}

async function post(_request: APIRequestContext, path: string, key: string, data: object) {
  const waits = [5_000, 15_000]; // wait 5 s before attempt 2 and 15 s before attempt 3
  for (let attempt = 0; ; attempt++) {
    const res = await send(path, key, data);
    if (attempt === waits.length || !(await isTemporaryError(res))) return res;
    await new Promise((r) => setTimeout(r, waits[attempt]));
  }
}

/** Ask the chatbot one question (new conversation, blocking mode) */
export async function ask(request: APIRequestContext, query: string, key = process.env.DIFY_APP_KEY!) {
  return post(request, '/chat-messages', key, {
    inputs: {},
    query,
    response_mode: 'blocking',
    conversation_id: '',
    user: TEST_USER,
  });
}

/** Search the knowledge base directly – no LLM involved */
export async function retrieve(request: APIRequestContext, query: string) {
  // Same settings as the Exercise 2.1 retrieval benchmark, so results don't depend on UI changes
  return post(request, `/datasets/${process.env.DIFY_DATASET_ID}/retrieve`, process.env.DIFY_DATASET_KEY!, {
    query,
    retrieval_model: {
      search_method: 'hybrid_search',
      reranking_enable: false,
      reranking_mode: 'weighted_score',
      weights: {
        weight_type: 'customized',
        vector_setting: { vector_weight: 0.3, embedding_provider_name: '', embedding_model_name: '' },
        keyword_setting: { keyword_weight: 0.7 },
      },
      top_k: 10,
      score_threshold_enabled: true,
      score_threshold: 0.05,
    },
  });
}

/** Jira keys such as REST-266 mentioned in a text (only the workshop's Jira projects, so "UTF-8" is ignored) */
export function issueKeys(text: string): string[] {
  return [...new Set(text.match(/\b(?:REST|WEBHOOKS|VOTE|TOC|QUID)-\d+\b/g) ?? [])];
}

/** Does this chunk/citation belong to the given Jira issue? Works for API- and UI-ingested documents */
export function isAbout(issue: string, name: string, content: string) {
  return name.includes(issue) || content.includes(`Jira Issue: ${issue}`);
}

export type Verdict = { verdict: 'PASS' | 'FAIL'; reasoning: string; raw: string };

/**
 * Ask the "Exercise 5: RAG Judge" Dify workflow to grade ONE criterion of an answer.
 * The judge replies with JSON: {"reasoning": "...", "verdict": "PASS" | "FAIL"}
 */
export async function judge(
  request: APIRequestContext,
  input: { criterion: string; question: string; answer: string; context?: string; reference?: string },
): Promise<Verdict> {
  const res = await post(request, '/workflows/run', process.env.DIFY_JUDGE_KEY!, {
    inputs: { context: '', reference: '', ...input },
    response_mode: 'blocking',
    user: TEST_USER,
  });
  const body = await res.json();
  if (res.status() !== 200 || body.data?.status !== 'succeeded') {
    throw new Error(`Judge workflow failed (HTTP ${res.status()}): ${JSON.stringify(body).slice(0, 500)}`);
  }
  const raw: string = body.data.outputs.result ?? '';
  // LLMs sometimes wrap JSON in ```json fences or add text around it: take the first {...} block
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  try {
    const parsed = JSON.parse(json ?? '');
    const verdict = String(parsed.verdict).toUpperCase() === 'PASS' ? 'PASS' : 'FAIL';
    return { verdict, reasoning: String(parsed.reasoning ?? ''), raw };
  } catch {
    // An unreadable verdict counts as FAIL, so the test shows the judge's raw reply
    return { verdict: 'FAIL', reasoning: `Could not read the judge's reply as JSON`, raw };
  }
}

/** Expect HTTP 200. The response body is only shown when Dify returns an error (keeps the public report small). */
export async function expectOk(res: ApiResponse) {
  const status = res.status();
  expect(status, status === 200 ? 'Dify answered' : `Dify returned an error: ${await res.text()}`).toBe(200);
}
