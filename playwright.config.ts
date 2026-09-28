import { defineConfig } from '@playwright/test';
import 'dotenv/config';

// API tests only: no browser is needed, so nothing extra to download.
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: 1, // LLM answers can vary; one retry avoids failing on a single odd answer
  workers: 1, // one question at a time, to stay under Dify's concurrency limits
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },
  projects: [
    // The regression suite: must be green on a healthy chatbot
    { name: 'regression', testIgnore: /adversarial/ },
    // Tries to break the chatbot: red tests here are findings, not broken tests
    { name: 'adversarial', testMatch: /adversarial/, retries: 0 },
  ],
});
