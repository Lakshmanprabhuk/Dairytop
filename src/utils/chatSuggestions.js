/* Suggested questions, follow-ups and Dutch labels for the assistant. */
export const QUESTION_NL = {
 "How much have we sold this month so far?": "Hoeveel hebben we deze maand tot nu toe verkocht?",
 "What is our open order value?": "Wat is onze openstaande orderwaarde?",
 "How did the last 3 complete months compare with last year?": "Hoe verhouden de laatste 3 volledige maanden zich tot vorig jaar?",
 "How much milk powder did we sell this year?": "Hoeveel melkpoeder hebben we dit jaar verkocht?",
 "What was our best month?": "Wat was onze beste maand?",
 "How does this year compare with last year?": "Hoe verhoudt dit jaar zich tot vorig jaar?",
 "What is the average monthly revenue?": "Wat is de gemiddelde omzet per maand?",
 "Who is the top verkoper?": "Wie is de beste verkoper?",
 "How concentrated is revenue in the top 3 verkopers?": "Hoeveel omzet komt van de top 3 verkopers?",
 "Which verkoper sells the most milk powder?": "Welke verkoper verkoopt het meeste melkpoeder?",
 "Who are our top 5 customers?": "Wie zijn onze top 5 klanten?",
 "How many customers bought this year?": "Hoeveel klanten hebben dit jaar gekocht?",
 "What share of revenue comes from the top 15 customers?": "Welk deel van de omzet komt van de top 15 klanten?",
 "What is our best-selling product?": "Wat is ons best verkochte product?",
 "Which product groups grow fastest?": "Welke productgroepen groeien het snelst?",
 "How many products did we sell?": "Hoeveel producten hebben we verkocht?",
 "Which category has the biggest share of revenue?": "Welke categorie heeft het grootste omzetaandeel?",
 "How does each product group compare?": "Hoe verhouden de productgroepen zich?",
 "How is revenue split between webshop and direct?": "Hoe is de omzet verdeeld tussen webshop en direct?",
 "What is the webshop average order value?": "Wat is de gemiddelde orderwaarde van de webshop?",
 "How many tonnes of milk powder did we sell?": "Hoeveel ton melkpoeder hebben we verkocht?",
 "Who sells the most tonnes?": "Wie verkoopt de meeste tonnen?",
 "How much is still open?": "Hoeveel staat er nog open?",
 "How much is overdue more than 30 days?": "Hoeveel is meer dan 30 dagen te laat?",
 "Which customers owe us the most?": "Welke klanten zijn ons het meeste schuldig?",
 "Which customers are late to reorder?": "Welke klanten zijn laat met nabestellen?",
 "How much monthly revenue is at risk?": "Hoeveel maandomzet loopt risico?",
 "What is the milk powder price per kg?": "Wat is de melkpoederprijs per kg?",
 "What is the feed price per kg?": "Wat is de voerprijs per kg?",
 "Which market is the biggest?": "Wat is de grootste markt?",
 "What share of revenue is export?": "Welk deel van de omzet is export?",
 "What is the result in the books?": "Wat is het resultaat in de boekhouding?",
 "What is the gross margin?": "Wat is de brutomarge?",
 "What are our biggest cost accounts?": "Wat zijn onze grootste kostenrekeningen?",
 "What are the biggest cost accounts?": "Wat zijn de grootste kostenrekeningen?",
 "How big are purchases compared with revenue?": "Hoe groot zijn de inkopen ten opzichte van de omzet?",
 "How many accounts are in the books?": "Hoeveel rekeningen staan er in de boekhouding?",
 "What can you tell me about this page?": "Wat kun je me over deze pagina vertellen?",
 "Summarize the key numbers": "Vat de belangrijkste cijfers samen"
};
const nl = en => QUESTION_NL[en] || en;
const q = (icon, label, prompt) => ({ icon, label: { en: label, nl: label }, prompt: { en: prompt, nl: nl(prompt) } });
export const CONTEXT_SUGGESTIONS = {
  overview: [q('trend', 'This month', 'How much have we sold this month so far?'), q('people', 'Top customers', 'Who are our top 5 customers?'), q('grid', 'By category', 'Which category has the biggest share of revenue?'), q('box', 'Key numbers', 'Summarize the key numbers')],
  sales: [q('trend', 'This year vs last', 'How does this year compare with last year?'), q('box', 'Best month', 'What was our best month?'), q('grid', 'Group growth', 'Which product groups grow fastest?'), q('people', 'Markets', 'Which market is the biggest?')],
  finance: [q('trend', 'Result', 'What is the result in the books?'), q('box', 'Gross margin', 'What is the gross margin?'), q('people', 'Cost accounts', 'What are our biggest cost accounts?'), q('grid', 'Receivables', 'How much is still open?')],
  orders: [q('box', 'Open order value', 'What is our open order value?'), q('box', 'Late reorders', 'Which customers are late to reorder?'), q('trend', 'Revenue at risk', 'How much monthly revenue is at risk?'), q('grid', 'Overdue', 'How much is overdue more than 30 days?'), q('people', 'Biggest debtors', 'Which customers owe us the most?')],
  reps: [q('people', 'Top verkopers', 'Who is the top verkoper?'), q('trend', 'Top 3 share', 'How concentrated is revenue in the top 3 verkopers?'), q('grid', 'Milk powder', 'Which verkoper sells the most milk powder?'), q('box', 'Tonnes', 'Who sells the most tonnes?')],
};
const FU = {
  revenue: ['How does this year compare with last year?', 'What was our best month?', 'What is the average monthly revenue?'],
  tonnage: ['Who sells the most tonnes?', 'What is the milk powder price per kg?', 'Which verkoper sells the most milk powder?'],
  salesreps: ['Who is the top verkoper?', 'How concentrated is revenue in the top 3 verkopers?'],
  customers: ['Who are our top 5 customers?', 'What share of revenue comes from the top 15 customers?', 'Which customers owe us the most?'],
  products: ['What is our best-selling product?', 'Which product groups grow fastest?', 'What is the feed price per kg?'],
  categories: ['How does each product group compare?', 'Which category has the biggest share of revenue?'],
  channels: ['What is the webshop average order value?', 'How is revenue split between webshop and direct?'],
  debtor: ['How much is overdue more than 30 days?', 'Which customers owe us the most?', 'How much is still open?'],
  orders: ['How much monthly revenue is at risk?', 'Which customers are late to reorder?'],
  finance: ['What is the gross margin?', 'What are our biggest cost accounts?', 'How big are purchases compared with revenue?'],
  general: ['Summarize the key numbers', 'How much have we sold this month so far?', 'Who are our top 5 customers?'],
};
const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function followupsFor(topic, lang, justAsked = '', max = 3) { const a = norm(justAsked); return (FU[topic] || FU.general).filter(x => norm(x) !== a && norm(nl(x)) !== a).slice(0, max).map(x => lang === 'nl' ? nl(x) : x); }
export function topicFromText(t = '') { const s = t.toLowerCase(); if (/verkoper|salesrep/.test(s)) return 'salesreps'; if (/receiv|overdue|owe|debiteur|open invoice/.test(s)) return 'debtor'; if (/reorder|order/.test(s)) return 'orders'; if (/margin|cost|books|p&l|result/.test(s)) return 'finance'; if (/tonne|ton |milk powder|melkpoeder/.test(s)) return 'tonnage'; if (/customer|klant/.test(s)) return 'customers'; if (/product/.test(s)) return 'products'; if (/categor|group/.test(s)) return 'categories'; if (/webshop|channel/.test(s)) return 'channels'; if (/revenue|turnover|omzet|month|year/.test(s)) return 'revenue'; return 'general'; }
