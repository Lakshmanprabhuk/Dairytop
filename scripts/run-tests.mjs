// Loads the app's real modules through Vite (JSX, JSON and images handled), then runs tests/*.test.mjs.
import { createServer } from 'vite';
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  globalThis.__DT = {
    app: await server.ssrLoadModule('/src/App.jsx'),
    qa: await server.ssrLoadModule('/src/utils/chatQA.js'),
  };
  for (const f of readdirSync('tests').filter(n => n.endsWith('.test.mjs')).sort()) await import(pathToFileURL('tests/' + f).href);
} finally {
  setTimeout(() => server.close(), 0);
}
