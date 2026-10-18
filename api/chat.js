// api/chat.js
// Vercel serverless function — proxies requests to Gemini so the API key
// never ships to the browser. Deployed separately from the GitHub Pages
// frontend; only this function needs to live on Vercel.

// Ordered list of models to try, best-first. The first one that returns
// usable text wins; later entries only run if earlier ones fail (404 /
// 429 / 5xx / empty response / timeout).
//
// Override without touching code by setting GEMINI_MODELS on Vercel, e.g.
//   GEMINI_MODELS=gemini-2.5-flash,gemini-2.0-flash
//
// Verify what your key can actually use:
//   curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY"
const DEFAULT_MODELS = [
  'gemini-2.5-flash',       // primary: best quality/cost/latency for chat
  'gemini-2.5-pro',         // stronger reasoning fallback
  'gemini-2.5-flash-lite',  // cheapest fallback
  'gemini-2.0-flash',       // older stable fallback
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',       // legacy; may be retired on your key
  'gemini-1.5-pro',
];

const GEMINI_MODELS = (process.env.GEMINI_MODELS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .concat() || [];

const MODELS = (process.env.GEMINI_MODELS
  ? process.env.GEMINI_MODELS.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_MODELS);

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Total time budget for the whole fallback chain, in ms. Kept below
// Vercel's function timeout (10s on Hobby) so we can still return a
// clean JSON error instead of being killed mid-flight.
const TOTAL_BUDGET_MS = 9000;
const MIN_ATTEMPT_MS = 2500;

// Comma-separated list of allowed origins, set in Vercel env vars.
// e.g. "https://www.fmis-ai.com,https://lakshmanprabhuk.github.io"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Lets the frontend read which model answered (handy when debugging
  // the fallback chain). Harmless if the frontend ignores it.
  res.setHeader('Access-Control-Expose-Headers', 'X-Model-Used');
}

// One attempt against a single model. Returns { ok: true, text } or
// { ok: false, reason } — never throws, so the caller can keep looping.
async function tryModel(model, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        reason: data?.error?.message || `HTTP ${response.status}`,
        status: response.status,
      };
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    if (!text.trim()) {
      // A candidate can come back with only a finishReason / safety block.
      const finish = data?.candidates?.[0]?.finishReason;
      return { ok: false, reason: finish ? `empty response (${finish})` : 'empty response' };
    }

    return { ok: true, text };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: err?.message || 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY; // NOTE: no VITE_ prefix — server-side only
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY' });
  }

  const { systemPrompt, history, message } = req.body || {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Missing "message"' });
  }
  if (typeof systemPrompt !== 'string') {
    return res.status(400).json({ error: 'Missing "systemPrompt"' });
  }
  if (!Array.isArray(history)) {
    return res.status(400).json({ error: '"history" must be an array' });
  }

  // Basic shape/size guardrails — this endpoint is public, so don't trust the body.
  if (message.length > 4000) {
    return res.status(400).json({ error: 'Message too long' });
  }
  if (history.length > 40) {
    return res.status(400).json({ error: 'History too long' });
  }

  const contents = [
    ...history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(h.text || '').slice(0, 4000) }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const requestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
  };

  const startedAt = Date.now();
  const failures = [];

  for (const model of MODELS) {
    const elapsed = Date.now() - startedAt;
    const remaining = TOTAL_BUDGET_MS - elapsed;
    if (remaining < MIN_ATTEMPT_MS) {
      failures.push(`${model}: skipped (out of time budget)`);
      break;
    }

    const result = await tryModel(model, apiKey, requestBody, remaining);

    if (result.ok) {
      res.setHeader('X-Model-Used', model);
      return res.status(200).json({ text: result.text, model });
    }

    // 400/401/403 mean the request or the key is bad — every other model
    // will fail identically, so stop early instead of burning the budget.
    if (result.status === 400 || result.status === 401 || result.status === 403) {
      console.error(`Gemini rejected the request on ${model}:`, result.reason);
      return res.status(502).json({ error: result.reason });
    }

    console.warn(`Gemini model ${model} failed: ${result.reason}`);
    failures.push(`${model}: ${result.reason}`);
  }

  console.error('All Gemini models failed:', failures);
  return res.status(502).json({
    error: 'No Gemini model returned a response. Check that GEMINI_MODELS lists models your API key can access.',
  });
}
