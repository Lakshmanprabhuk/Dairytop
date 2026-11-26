# DairyTop Business Intelligence (React)

Sales, debtors and finance dashboard for DairyTop. Every figure comes from **`src/dash.json`** (Microfas extract, schema 5.0.0).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm test           # chatbot + data tests
npm run lint
```

Sign in with the same accounts as before.

## Files

| Path | What it is |
|---|---|
| `src/App.jsx` | The whole dashboard: data model on dash.json, filters, all 14 pages, charts, login, sidebar, styles |
| `src/dash.json` | The data. Replace this file with a newer extract to update every page |
| `src/ChatBot.jsx` | Chat window (UI): 9 topic tiles, question lists, answers, follow-ups |
| `src/utils/chatQA.js` | Question bank and answer engine (English + Dutch), calculated from dash.json in the browser |
| `src/assets/` | Logo, chatbot images, sidebar icons |
| `tests/chat.test.mjs`, `scripts/run-tests.mjs` | Tests, run through Vite so they use the real app code |

## Chatbot

- No typing and no AI: users pick one of 9 topic tiles, then one of 30+ questions; every answer has 5 follow-up questions.
- Every answer is calculated **in the browser** from dash.json. Nothing is sent to any server or AI service.
- The questions adapt to the data: periods (this month, last month, this year, last year), and the largest verkopers, customers, products, product groups and markets are picked from the current data, so new names appear automatically.
- English and Dutch: questions and answers follow the EN/NL switch.
- To add or change a question, edit `src/utils/chatQA.js` (each question has an English and a Dutch text and one answer function).

## Data notes

- Amounts are euros excl. VAT. Weights are shown in tonnes.
- Jan 2025 – Mar 2026 come from the former portal: monthly totals only (no weeks, days or invoices). Week/day drill-down, orders and average order value start Apr 2026.
- Receivables start with invoices of 7 Apr 2026; the books (P&L) start 1 Apr 2026.
- Filters are per page; Compare with starts on "No comparison".
- Language: EN / NL switch in the top bar (and on the login screen). English is the default; the choice is remembered in the browser. Data names (customers, products, ledger accounts) are never translated.
- Overview open-order cards count open order lines with stage "delivered, not invoiced" or "to deliver"; "due by month end" = due today or earlier plus due until the last day of the month. Lines without a price in Microfas are listed but have no value.
- Voorraad (stock level) and gross margin wait for the Microfas export: stock is not in dash.json yet, and purchase prices are only present for a few products.
