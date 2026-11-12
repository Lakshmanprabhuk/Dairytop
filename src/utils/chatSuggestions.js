/* ── CHATBOT SUGGESTED QUESTIONS ─────────────────────────────────────────
   Every question in this file is answered by the local engine without AI.
   tests/chips.test.mjs fails if one of them (or one of App.jsx's
   SUGGESTED_QUESTIONS) ever stops being answerable — run `npm test`
   after adding or rewording a chip.
   This file is identical in knitworks-dashboard and knitworks-dashboard-1.
   ───────────────────────────────────────────────────────────────────── */

/* Dutch wording for the per-page questions defined in App.jsx (SUGGESTED_QUESTIONS). */
export const QUESTION_NL = {
  'How is revenue trending this month?': 'Hoe ontwikkelt de omzet zich deze maand?',
  'Which category is driving sales right now?': 'Welke categorie levert op dit moment de meeste omzet?',
  "Who is this month's top verkoper?": 'Wie is deze maand de beste verkoper?',
  'What was our best month on record?': 'Wat was onze beste maand ooit?',
  'How does this period compare to the previous one?': 'Hoe verhoudt deze periode zich tot de vorige periode?',
  "What's the average monthly revenue?": 'Wat is de gemiddelde maandelijkse omzet?',
  'Who is the top-performing verkoper?': 'Wie is de best presterende verkoper?',
  'How concentrated is revenue among the top 3 reps?': 'Hoe geconcentreerd is de omzet bij de top 3 verkopers?',
  'Break down sales by verkoper and category': 'Omzet per verkoper en categorie',
  'Who are our top 5 customers?': 'Wie zijn onze top 5 klanten?',
  'What share of revenue comes from our top customers?': 'Welk aandeel van de omzet komt van onze beste klanten?',
  "What's the average revenue per client?": 'Wat is de gemiddelde omzet per klant?',
  'What is our best-selling product?': 'Wat is ons best verkopende product?',
  'How concentrated is revenue across products?': 'Hoe geconcentreerd is de omzet over producten?',
  'Show me products with the smallest share': 'Toon producten met het kleinste aandeel',
  'Which category has the biggest share of revenue?': 'Welke categorie heeft het grootste aandeel in de omzet?',
  'How many active category groups are there?': 'Hoeveel categorieën zijn er?',
  'Compare the top two categories': 'Vergelijk de top twee categorieën',
  'Which channel drives the most revenue?': 'Welk kanaal levert de meeste omzet?',
  'How is revenue split across channels?': 'Hoe is de omzet verdeeld over de kanalen?',
  'How is gross margin trending?': 'Hoe ontwikkelt de brutomarge zich?',
  'What is driving EBITDA this period?': 'Wat bepaalt de EBITDA deze periode?',
  'What are our biggest cost drivers?': 'Wat zijn onze grootste kostenposten?',
  'How do revenue and costs compare year over year?': 'Hoe verhouden omzet en kosten zich jaar op jaar?',
  'What are the largest YoY swings in the ledger?': 'Wat zijn de grootste verschillen jaar op jaar in het grootboek?',
  'Which accounts saw the biggest cost increases?': 'Welke rekeningen hadden de grootste kostenstijging?',
  'What is the total open AR?': 'Wat is het totaal aan openstaande debiteuren?',
  'Which customers have the oldest outstanding invoices?': 'Welke klanten hebben de oudste openstaande facturen?',
  'How much AR is over 90 days?': 'Hoeveel debiteuren zijn ouder dan 90 dagen?',
  'Which customer has the highest open AR?': 'Welke klant heeft het hoogste open saldo?',
  'How many customers are flagged as non-payer?': 'Hoeveel klanten zijn wanbetaler?',
  'Show me all Risk D customers': 'Toon alle klanten met risico D',
  'What is the average days to pay this year?': 'Wat is de gemiddelde betaaltermijn dit jaar?',
  'How has the % paid within 30 days changed over time?': 'Hoe heeft het betaalgedrag binnen 30 dagen zich ontwikkeld?',
  'Which quarter had the best payment performance?': 'Welk kwartaal had het beste betaalgedrag?',
  'What can you tell me about this page?': 'Wat kun je me vertellen over deze pagina?',
  'Summarize the key numbers here': 'Geef een samenvatting van de kerncijfers',
};

const q = (icon, enLabel, nlLabel, en, nl) => ({ icon, label: { en: enLabel, nl: nlLabel }, prompt: { en, nl } });

/* Chips for the dashboard-context switcher inside the chat window. */
export const CONTEXT_SUGGESTIONS = {
  overview: [
    q('trend', 'Revenue trend', 'Omzettrend', 'How is revenue trending this month?', 'Hoe ontwikkelt de omzet zich deze maand?'),
    q('people', 'Top customers', 'Top klanten', 'Top 5 customers by revenue', 'Top 5 klanten op omzet'),
    q('box', 'Open orders', 'Open orders', 'What is our open order value?', 'Wat is onze openstaande orderwaarde?'),
    q('grid', 'By category', 'Per categorie', 'Revenue by category', 'Omzet per categorie'),
  ],
  sales: [
    q('people', 'Top customers', 'Top klanten', 'Top 5 customers this year', 'Top 5 klanten dit jaar'),
    q('grid', 'By category', 'Per categorie', 'Revenue by category this year', 'Omzet per categorie dit jaar'),
    q('trend', 'Monthly trend', 'Maandelijkse trend', 'Monthly revenue trend this year', 'Maandelijkse omzettrend dit jaar'),
    q('box', 'Product revenue', 'Productomzet', 'Top 5 products by revenue', 'Top 5 producten op omzet'),
  ],
  finance: [
    q('trend', 'Finance totals', 'Financiële totalen', 'Finance totals', 'Financiële totalen'),
    q('grid', 'COGS and OPEX', 'COGS en OPEX', 'What are our COGS and OPEX?', 'Wat zijn onze COGS en OPEX?'),
    q('box', 'Margin and EBITDA', 'Marge en EBITDA', 'What is our gross margin and EBITDA?', 'Wat is onze brutomarge en EBITDA?'),
    q('people', 'Cost drivers', 'Kostenposten', 'What are our biggest cost drivers?', 'Wat zijn onze grootste kostenposten?'),
  ],
  orders: [
    q('box', 'Open order value', 'Openstaande waarde', 'What is our open order value?', 'Wat is onze openstaande orderwaarde?'),
    q('trend', 'MTD vs projected', 'MTD vs prognose', 'What is our MTD actual vs projected?', 'Wat is onze MTD actueel vs prognose?'),
    q('grid', 'This week', 'Deze week', 'Revenue this week', 'Omzet deze week'),
    q('people', 'Last week', 'Vorige week', 'Revenue last week', 'Omzet vorige week'),
  ],
  reps: [
    q('people', 'Top reps', 'Top verkopers', 'Top 5 sales reps by revenue', 'Top 5 verkopers op omzet'),
    q('trend', 'Rep trend', 'Verkooptrend', 'Monthly revenue per sales rep', 'Maandelijkse omzet per verkoper'),
    q('grid', 'Reps by category', 'Verkopers per categ.', 'Which categories does each rep sell?', 'Welke categorieën verkoopt elke verkoper?'),
    q('box', 'Rep tonnage', 'Tonnage verkopers', 'Top reps by tonnage', 'Top verkopers op tonnage'),
  ],
};

const f = (en, nl) => ({ en, nl });
/* Follow-up chips shown under the latest answer, by answer topic. */
export const FOLLOWUPS = {
  revenue: [f('Compare to last month', 'Vergelijk met vorige maand'), f('Monthly revenue trend this year', 'Maandelijkse omzettrend dit jaar'), f('Revenue 2025 vs 2026', 'Omzet 2025 vs 2026'), f('Top 5 customers this year', 'Top 5 klanten dit jaar')],
  customers: [f('Top 10 customers this year', 'Top 10 klanten dit jaar'), f('What share of revenue comes from the top 10 customers?', 'Welk aandeel van de omzet komt van de top 10 klanten?'), f('Average revenue per customer', 'Gemiddelde omzet per klant')],
  products: [f('Top 10 products this year', 'Top 10 producten dit jaar'), f('How concentrated is revenue across products?', 'Hoe geconcentreerd is de omzet over producten?'), f('Top 5 products last month', 'Top 5 producten vorige maand')],
  salesreps: [f('Top 5 sales reps this year', 'Top 5 verkopers dit jaar'), f('Monthly revenue per sales rep', 'Maandelijkse omzet per verkoper'), f('Sales by sales rep and category', 'Omzet per verkoper en categorie')],
  categories: [f('Revenue by category this year', 'Omzet per categorie dit jaar'), f('Compare the top two categories', 'Vergelijk de top twee categorieën'), f('Tonnage by category', 'Tonnage per categorie')],
  channels: [f('Webshop revenue this year', 'Webshop omzet dit jaar'), f('Channel split last month', 'Kanaalverdeling vorige maand'), f('Revenue this month', 'Omzet deze maand')],
  orders: [f('MTD actual vs projected', 'MTD actueel vs prognose'), f('Revenue this week', 'Omzet deze week'), f('Revenue last week', 'Omzet vorige week'), f('Open order value', 'Openstaande orderwaarde')],
  debtor: [f('How much AR is over 90 days?', 'Hoeveel debiteuren zijn ouder dan 90 dagen?'), f('Show Risk D customers', 'Toon klanten met risico D'), f('Oldest outstanding invoices', 'Oudste openstaande facturen'), f('Receivables ageing', 'Ouderdom debiteuren')],
  finance: [f('What is the gross margin?', 'Wat is de brutomarge?'), f('Biggest cost drivers', 'Grootste kostenposten'), f('What is driving EBITDA?', 'Wat bepaalt de EBITDA?'), f('Finance totals', 'Financiële totalen')],
  tonnage: [f('Top reps by tonnage', 'Top verkopers op tonnage'), f('Tonnage by category', 'Tonnage per categorie'), f('Revenue by category this year', 'Omzet per categorie dit jaar')],
  general: [f('Summarize the key numbers', 'Geef een samenvatting van de kerncijfers'), f('Revenue this month', 'Omzet deze maand'), f('Top 5 customers this year', 'Top 5 klanten dit jaar')],
};

/** Topic for an AI-written answer (local answers already carry their topic). */
export function topicFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/receivable|debtor|debiteur|invoice|factu|overdue/.test(t)) return 'debtor';
  if (/ebitda|cogs|opex|margin|marge|profit|winst|cost|kosten/.test(t)) return 'finance';
  if (/open order|backlog|mtd|prognose|projected/.test(t)) return 'orders';
  if (/sales rep|verkoper|vertegenwoordiger/.test(t)) return 'salesreps';
  if (/customer|klant/.test(t)) return 'customers';
  if (/product/.test(t)) return 'products';
  if (/categor/.test(t)) return 'categories';
  if (/revenue|omzet|sales|turnover/.test(t)) return 'revenue';
  return 'general';
}

/** Up to `max` follow-up prompts for a topic, never repeating the question just asked. */
export function followupsFor(topic, lang, justAsked = '', max = 3) {
  const list = FOLLOWUPS[topic] || FOLLOWUPS.general;
  const asked = justAsked.trim().toLowerCase();
  return list.map(x => x[lang] || x.en).filter(x => x.toLowerCase() !== asked).slice(0, max);
}
