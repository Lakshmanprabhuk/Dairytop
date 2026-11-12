// Every suggested question the UI can show must be answered locally — never by AI, never with a dead end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from '../src/utils/chatFallback.js';
import { QUESTION_NL, CONTEXT_SUGGESTIONS, FOLLOWUPS } from '../src/utils/chatSuggestions.js';
import * as data from '../src/utils/data.js';

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const start = app.indexOf('const SUGGESTED_QUESTIONS={');
const PAGE_QUESTIONS = new Function(`return (${app.slice(start + 'const SUGGESTED_QUESTIONS='.length, app.indexOf('\n};', start) + 2)})`)();

const DEAD_END = /can only help with|kan alleen helpen|Which one do you mean|Welke bedoel je|not loaded|niet geladen|not available|niet beschikbaar/;
function mustAnswer(question, lang, page) {
  const r = resolve(question, { lang, context: { page, dateRange: 'Jan 25 – Nov 26' }, today: '2026-11-06' }, data);
  assert.ok(r.answer, `[${lang}] "${question}" is not answered locally (unknown words: ${r.parsed.unknown.join(', ') || '—'})`);
  assert.ok(!DEAD_END.test(r.answer), `[${lang}] "${question}" gets a dead-end reply: ${r.answer.slice(0, 120)}`);
  assert.ok(/\d/.test(r.answer), `[${lang}] "${question}" answer contains no figures: ${r.answer.slice(0, 120)}`);
}

test('App.jsx page questions are all answered locally (EN)', () => {
  assert.ok(Object.keys(PAGE_QUESTIONS).length >= 10);
  for (const [page, list] of Object.entries(PAGE_QUESTIONS)) for (const question of list) mustAnswer(question, 'en', page);
});
test('every App.jsx page question has a Dutch version that is answered locally', () => {
  for (const [page, list] of Object.entries(PAGE_QUESTIONS)) for (const question of list) {
    assert.ok(QUESTION_NL[question], `Add a Dutch version of "${question}" to QUESTION_NL in chatSuggestions.js`);
    mustAnswer(QUESTION_NL[question], 'nl', page);
  }
});
test('context chips are answered locally in both languages', () => {
  for (const list of Object.values(CONTEXT_SUGGESTIONS)) for (const chip of list) { mustAnswer(chip.prompt.en, 'en', 'overview'); mustAnswer(chip.prompt.nl, 'nl', 'overview'); }
});
test('follow-up chips are answered locally in both languages', () => {
  for (const list of Object.values(FOLLOWUPS)) for (const chip of list) { mustAnswer(chip.en, 'en', 'overview'); mustAnswer(chip.nl, 'nl', 'overview'); }
});
test('EN and NL versions of a page question give the same figures', () => {
  const figures = s => (s.match(/€[\d.]+|\d+,\d%/g) || []).join(' ');
  for (const [page, list] of Object.entries(PAGE_QUESTIONS)) for (const question of list) {
    const en = resolve(question, { lang: 'en', context: { page }, today: '2026-11-06' }, data).answer;
    const nl = resolve(QUESTION_NL[question], { lang: 'nl', context: { page }, today: '2026-11-06' }, data).answer;
    assert.equal(figures(nl), figures(en), `"${question}" vs "${QUESTION_NL[question]}"`);
  }
});
