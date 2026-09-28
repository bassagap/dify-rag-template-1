import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The golden dataset: questions + what a correct answer must contain + expected source document
export const golden = JSON.parse(readFileSync(join(__dirname, '..', 'golden', 'jira-rest.json'), 'utf8'));
