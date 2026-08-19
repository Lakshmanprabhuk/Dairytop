// api/chat.js
// Vercel serverless function — proxies requests to Gemini so the API key
// never ships to the browser. Deployed separately from the GitHub Pages
// frontend; only this function needs to live on Vercel.

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

  try {
    const response = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || `Gemini API error ${response.status}`;
      return res.status(502).json({ error: message });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    if (!text) {
      return res.status(502).json({ error: 'No response from Gemini.' });
    }

    return res.status(200).json({ text });
  } catch (err) {
    console.error('Gemini proxy error:', err);
    return res.status(500).json({ error: 'Failed to reach Gemini.' });
  }
}