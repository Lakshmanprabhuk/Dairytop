// Chatbot question bank: run with `npm test` (scripts/run-tests.mjs loads the real modules).
import assert from 'node:assert/strict';

const { app, qa } = globalThis.__DT;
const M = app.DASH;
let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('ok -', name); };

const bank = qa.questionBank(M);

ok('9 tiles, each with at least 30 questions', () => {
  assert.equal(qa.TILES.length, 9);
  for (const t of qa.TILES) assert.ok(bank.questions.filter(q => q.tile === t.id).length >= 30, t.id);
});
ok('question ids and texts are unique in both languages', () => {
  assert.equal(new Set(bank.questions.map(q => q.id)).size, bank.questions.length);
  for (const L of ['en', 'nl']) assert.equal(new Set(bank.questions.map(q => q.q(L))).size, bank.questions.length, L);
});
ok('every question answers in English and Dutch without errors', () => {
  for (const q of bank.questions) for (const L of ['en', 'nl']) {
    const a = qa.answer(M, q.id, L);
    assert.ok(a.text && !/NaN|Infinity|undefined|^This answer cannot|^Dit antwoord kan niet/.test(a.text), `${q.id} ${L}: ${a.text.slice(0, 80)}`);
  }
});
ok('every question has 5 valid follow-ups, never itself', () => {
  for (const q of bank.questions) {
    assert.equal(q.fu.length, 5, q.id);
    for (const f of q.fu) { assert.ok(bank.byId.has(f), f); assert.notEqual(f, q.id); }
  }
});
ok('this year\'s turnover equals the sum of the facts', () => {
  const X = M.X, F = X.facts, y = X.months.at(-1).slice(0, 4);
  let c = 0; for (let i = 0; i < F.r.length; i++) if (X.months[F.m[i]].startsWith(y)) c += F.r[i];
  const txt = qa.answer(M, 'overview.rev.ytd', 'en').text;
  const shown = Number(txt.match(/€([\d.]+)/)[1].replace(/\./g, ''));
  assert.ok(Math.abs(shown - c / 100) < 1, `${shown} vs ${c / 100}`);
});
ok('no network calls in the chatbot', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['src/ChatBot.jsx', 'src/utils/chatQA.js']) assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(readFileSync(f, 'utf8')), f);
});
console.log(`\n${pass} chatbot tests passed (${bank.questions.length} questions)`);
