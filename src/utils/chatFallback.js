// Deterministic answers: never infer relationships between independent aggregates.
import * as data from './data.js';
import { prepareQuestion } from './chatLanguage.js';

export const normalize = value => String(value ?? '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const has = (q, pattern) => pattern.test(q);
const sum = (rows, field) => rows.reduce((n, r) => n + (Number(r[field]) || 0), 0);
const money = n => `€${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })}`;
const number = n => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
const aliases = [
  ['jan', 'january', 'januari'], ['feb', 'february', 'februari'], ['mar', 'march', 'maart', 'mrt'],
  ['apr', 'april'], ['may', 'mei'], ['jun', 'june', 'juni'], ['jul', 'july', 'juli'],
  ['aug', 'august', 'augustus'], ['sep', 'september'], ['oct', 'october', 'okt', 'oktober'],
  ['nov', 'november'], ['dec', 'december'],
];
const monthId = m => {
  const [mon, year] = normalize(m).split(' ');
  const index = aliases.findIndex(a => a.includes(mon));
  return index < 0 || !year ? NaN : (Number(year) < 100 ? 2000 + Number(year) : Number(year)) * 12 + index;
};
const definitions = [
  ['customers', /\b(customers?|clients?|klanten?|klant)\b/, 'customers', 'klanten'],
  ['products', /\b(products?|items?|artikelen|product|producten)\b/, 'products', 'producten'],
  ['salesreps', /\b(sales ?reps?|salesmen|salesman|salespeople|sales person|representatives?|verkopers?|verkoper|vertegenwoordigers?)\b/, 'sales reps', 'verkopers'],
  ['categories', /\b(categor(?:y|ies)|categorie(?:en|s)?)\b/, 'categories', 'categorieën'],
];
function aggregate(rows) {
  const groups = new Map();
  for (const row of rows) {
    const name = String(row.n).trim();
    if (!groups.has(name)) groups.set(name, { name, rev: 0, orders: 0, qty: 0 });
    const target = groups.get(name);
    for (const field of ['rev', 'orders', 'qty']) target[field] += Number(row[field]) || 0;
  }
  return [...groups.values()];
}

function period(q, d, say) {
  const ids = (d.monthly || []).map(r => monthId(r.m)).filter(Number.isFinite);
  const latest = Math.max(...ids);
  const latestYear = Math.floor(latest / 12);
  const years = [...new Set(q.match(/\b20\d{2}\b/g) || [])].map(Number);
  const months = aliases.flatMap((a, i) => a.some(s => (` ${q} `).includes(` ${s} `)) ? [i] : []);
  if (years.length > 1 || months.length > 1 || /\b(from|between|until|through|since|tussen|vanaf|tot)\b/.test(q))
    return { error: say('Please specify one month, one year, or one quarter for local analysis.', 'Geef één maand, jaar of kwartaal op voor lokale analyse.') };
  let year = years[0] ?? latestYear;
  if (/\b(last year|previous year|vorig jaar)\b/.test(q)) year = latestYear - 1;
  const quarter = q.match(/\bq([1-4])\b/) || q.match(/\b(?:quarter|kwartaal) ([1-4])\b/);
  let selected;
  let label;
  if (/\b(this month|current month|deze maand|huidige maand)\b/.test(q)) {
    selected = [latest]; label = d.monthly.find(r => monthId(r.m) === latest)?.m;
  } else if (/\b(last month|previous month|vorige maand)\b/.test(q)) {
    selected = [latest - 1]; label = d.monthly.find(r => monthId(r.m) === latest - 1)?.m;
  } else if (months.length) { selected = [year * 12 + months[0]]; label = `${aliases[months[0]][0]} ${year}`;
  } else if (quarter) { selected = [0, 1, 2].map(i => year * 12 + (Number(quarter[1]) - 1) * 3 + i); label = `Q${quarter[1]} ${year}`;
  } else if (years.length || /\b(this year|current year|last year|previous year|dit jaar|vorig jaar|ytd)\b/.test(q)) {
    selected = Array.from({ length: 12 }, (_, i) => year * 12 + i); label = String(year);
  } else { label = say('all available months', 'alle beschikbare maanden'); }
  return { label, selected, latest, filter: rows => rows.filter(r => !selected || selected.includes(monthId(r.m))),
    partial: !selected || selected.includes(latest) };
}

export function answerFromData(question, { lang = 'en', context } = {}, d = data) {
  const say = (en, nl) => lang === 'nl' ? nl : en;
  const prepared = prepareQuestion(question, d);
  if (prepared.error) return say('That name matches several records. Please use an unambiguous full name: ', 'Die naam past bij meerdere records. Gebruik een eenduidige volledige naam: ') + prepared.candidates.join('; ');
  const q = prepared.query;
  const help = say(
    'Local analysis supports: top customers/products/reps/categories, monthly revenue trend, channel split, finance totals, accounts receivable, weekly revenue, open order value, MTD projected vs actual, tonnage by category, rep revenue per category. Use full entity names. Try "top 5 customers in 2026" or "revenue this week".',
    'Lokale analyse ondersteunt: topklanten/producten/verkopers/categorieën, maandomzet, kanaalsplit, financiële totalen, debiteuren, wekelijkse omzet, openstaande orderwaarde, MTD-prognose, tonnage per categorie, verkopers per categorie. Gebruik volledige namen. Probeer "top 5 klanten in 2026" of "omzet deze week".'
  );
  if (!q || /\b(help|hulp)\b/.test(q)) return help;
  if (/\b(why|predict|forecast|recommend|waarom|voorspel|verwacht|growth|groei|compare|comparison|vergelijk|versus)\b/.test(q))
    return null; // let AI handle comparisons / predictions

  // Weekly handler — before the daily blocker so "this week" is handled
  if (/\b(week|weeks?|weekly|wekelijks|weekomzet)\b/.test(q)) {
    const weekAllowed = /^(?:week|weeks?|weekly|wekelijks|weekomzet|revenue|sales|omzet|orders?|bestellingen|this|current|last|previous|huidige|vorige|top|bottom|best|worst|highest|lowest|beste|slechtste|laagste|first|show|me|the|what|is|our|for|aantal|trending?|monthly|maandelijks|\d+|q[1-4])$/;
    if (q.split(' ').some(w => w && !weekAllowed.test(w))) return null;
    const weeks = d.weekly || [];
    if (!weeks.length) return say('Weekly data is not available.', 'Wekelijkse gegevens zijn niet beschikbaar.');
    const latest = weeks[weeks.length - 1];
    const metricW = /\b(orders?|bestellingen)\b/.test(q) ? 'orders' : 'rev';
    const fmtW = v => metricW === 'rev' ? money(v) : number(v);
    const metricNmW = metricW === 'rev' ? say('revenue', 'omzet') : say('orders', 'orders');
    const numMatch = q.match(/\bweek\s+(\d+)\b/);
    let selectedWeeks;
    if (numMatch) {
      const target = Number(numMatch[1]);
      selectedWeeks = weeks.filter(w => Number(String(w.w).replace(/^.*?(\d+)$/, '$1')) === target);
    } else if (/\b(this week|current week|deze week|huidige week)\b/.test(q)) {
      selectedWeeks = [latest];
    } else if (/\b(last week|previous week|vorige week)\b/.test(q)) {
      const idx = weeks.length - 2;
      selectedWeeks = idx >= 0 ? [weeks[idx]] : [];
    } else {
      selectedWeeks = weeks;
    }
    if (!selectedWeeks.length) return say('No weekly data found for that period.', 'Geen wekelijkse gegevens gevonden voor die periode.');
    if (selectedWeeks.length === 1) {
      const w = selectedWeeks[0];
      return `${say('Week','Week')} ${w.w} (${w.start} – ${w.end}): ${fmtW(w[metricW])}.\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
    }
    const isTopW = /\b(top|bottom|best|worst|highest|lowest|beste|slechtste|laagste)\b/.test(q);
    const ascW = /\b(bottom|worst|lowest|slechtste|laagste)\b/.test(q);
    const countW = Number(q.match(/\b(\d+)\b/)?.[1] ?? selectedWeeks.length);
    if (isTopW) {
      const sorted = [...selectedWeeks].sort((a, b) => (ascW ? 1 : -1) * (a[metricW] - b[metricW]));
      return `${say('Top weeks —','Topweken —')} ${metricNmW}:\n` + sorted.slice(0, countW).map(w => `${say('Week','Week')} ${w.w}: ${fmtW(w[metricW])}`).join('\n') + `\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
    }
    return `${say('Weekly','Wekelijkse')} ${metricNmW}:\n` + selectedWeeks.map(w => `${w.w}: ${fmtW(w[metricW])}`).join('\n') + `\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
  }

  // Daily blocker (narrowed — weekly handled above)
  if (/\b(today|yesterday|daily|day|vandaag|gisteren|dag|dagelijks)\b/.test(q) || /\b\d{4} \d{1,2} \d{1,2}\b/.test(q))
    return say('Local sales analysis currently uses monthly data. Please ask for a month, quarter or year.', 'Lokale verkoopanalyse gebruikt maandgegevens. Vraag naar een maand, kwartaal of jaar.');

  // Debtor handler
  if (/\b(debtors?|receivables?|debiteuren|outstanding|unpaid|overdue|ageing|aging)\b/.test(q) || /\b(non.?payer|wanbetaler)\b/.test(q)) {
    const allowed = /^(?:accounts?|receivables?|debtors?|debiteuren|outstanding|unpaid|overdue|ageing|aging|balance|total|totals|summary|overview|top|customers?|klanten|show|me|the|what|is|our|and|please|\d+|non|payer|payers|wanbetaler|wanbetalers|risk|risico|high|hoog|payment|betaling|days|dagen|gemiddeld|average|slow|langzaam|avg|betalingsdagen|betalingstermijn|risicovol)$/;
    if (q.split(' ').some(word => !allowed.test(word))) return say(`Local accounts receivable supports overall totals, ageing, top customers by open balance, non-payers, high-risk and slow-payer analysis (as of ${d.debtorAsOf}).`, `Lokale debiteurenanalyse ondersteunt totalen, ouderdom, topklanten, wanbetalers, hoog-risico en trage betalers (per ${d.debtorAsOf}).`);
    if (/\b20\d{2}\b|\b(month|year|maand|jaar)\b/.test(q)) return say(`Accounts receivable is a snapshot as of ${d.debtorAsOf}; historical filtering is not supported locally.`, `Debiteuren is een momentopname per ${d.debtorAsOf}; historische filtering is lokaal niet ondersteund.`);
    const k = d.debtorKPI;
    if (!k) return help;
    const debtorCount = Number(q.match(/\b(\d+)\b/)?.[1] ?? 10);
    if (/\b(non.?payer|wanbetaler)\b/.test(q)) {
      const nonPayers = (d.debtorCustomers || []).filter(r => r.nonPayer);
      if (!nonPayers.length) return say(`No non-payers on record as of ${d.debtorAsOf}.`, `Geen wanbetalers gevonden per ${d.debtorAsOf}.`);
      return `${say('Non-payers','Wanbetalers')} (${nonPayers.length}) ${say('as of','per')} ${d.debtorAsOf}:\n` + nonPayers.slice(0, debtorCount).map(r => `${r.name}: ${money(r.openValue)}`).join('\n');
    }
    if (/\b(risk|risico|hoog|high)\b/.test(q)) {
      const highRisk = (d.debtorCustomers || []).filter(r => r.risk && /high|hoog/i.test(String(r.risk)));
      if (!highRisk.length) return say(`No high-risk customers flagged as of ${d.debtorAsOf}.`, `Geen hoog-risico klanten gevonden per ${d.debtorAsOf}.`);
      return `${say('High-risk customers','Hoog-risico klanten')} (${highRisk.length}) ${say('as of','per')} ${d.debtorAsOf}:\n` + highRisk.slice(0, debtorCount).map(r => `${r.name}: ${money(r.openValue)} | ${r.avgDaysToPay ?? '?'} ${say('avg days','gem. dagen')}`).join('\n');
    }
    if (/\b(payment|betaling|days|dagen|gemiddeld|average|slow|langzaam|avg)\b/.test(q)) {
      const withDays = (d.debtorCustomers || []).filter(r => r.avgDaysToPay != null).sort((a, b) => b.avgDaysToPay - a.avgDaysToPay);
      if (!withDays.length) return say('Average days-to-pay data is not available.', 'Gemiddelde betaaldagen zijn niet beschikbaar.');
      return `${say('Slowest payers — avg days to pay','Langzaamste betalers — gem. betaaldagen')} (${say('as of','per')} ${d.debtorAsOf}):\n` + withDays.slice(0, debtorCount).map(r => `${r.name}: ${r.avgDaysToPay} ${say('days','dagen')}`).join('\n');
    }
    if (/\b(ageing|aging|ouderdom)\b/.test(q)) return `${d.debtorAsOf}\n` + (d.debtorAgeing || []).map(r => `${r.bucket}: ${money(r.value)}`).join('\n');
    if (/\b(top|customers?|klanten)\b/.test(q)) return `${say('Top customers by open balance','Topklanten op open saldo')} (${say('as of','per')} ${d.debtorAsOf}):\n` + [...(d.debtorCustomers || [])].sort((a,b) => b.openValue-a.openValue).slice(0,debtorCount).map(r => `${r.name}: ${money(r.openValue)}`).join('\n');
    return say(`Accounts receivable as of ${d.debtorAsOf}: ${money(k.totalDebtorValue)}. Over 30 days: ${money(k.over30)}. Over 90 days: ${money(k.over90)}. Open invoices: ${k.openInvoiceCount}.`, `Debiteuren per ${d.debtorAsOf}: ${money(k.totalDebtorValue)}. Ouder dan 30 dagen: ${money(k.over30)}. Ouder dan 90 dagen: ${money(k.over90)}. Open facturen: ${k.openInvoiceCount}.`);
  }

  // Finance handler
  if (/\b(finance|financial|financieel|financiele|cogs|opex|ebitda|profit|winst|margin|marge)\b/.test(q)) {
    if (/\b20\d{2}\b|\b(month|year|maand|jaar)\b/.test(q)) return say(`Available finance periods only: ${d.finPeriodLabel}. Ask "finance totals".`, `Alleen beschikbare financiële perioden: ${d.finPeriodLabel}. Vraag "financiële totalen" (finance totals).`);
    if (/entitytoken\d+/.test(q) || !q.split(' ').every(w => /^(finance|financial|total|totals|cogs|opex|ebitda|profit|margin|marge|show|me|the|what|is|our|and|please)$/.test(w))) return say('Local finance supports overall totals only, without entity or custom filters.', 'Lokale financiele analyse ondersteunt alleen algemene totalen, zonder naam- of aangepaste filters.');
    if (!d.finSummary) return help;
    const f = d.finSummary;
    return `${d.finPeriodLabel}\n` + ['cy','py'].map(key => `${key === 'cy' ? say('Current period', 'Huidige periode') : say('Prior period', 'Vorige periode')}: ${say('revenue', 'omzet')} ${money(f.revenue[key])}; COGS ${money(f.cogs[key])}; OPEX ${money(f.opex[key])}; ${say('gross profit', 'brutowinst')} ${money(f.revenue[key]-f.cogs[key])}; EBITDA ${money(f.revenue[key]-f.cogs[key]-f.opex[key])}.`).join('\n') + '\n' + say('These periods have different lengths; this is not a like-for-like comparison.', 'Deze perioden hebben verschillende lengtes; dit is geen gelijkwaardige vergelijking.');
  }

  // Open orders handler
  if (/\b(open orders?|openstaande orders?|pipeline|backlog|pijplijn|order value|orderwaarde)\b/.test(q)) {
    const pres = d.openOrderValuePresent ?? null;
    if (pres === null) return say('Open order data is not available.', 'Open ordergegevens zijn niet beschikbaar.');
    return say(
      `Open order value as of ${d.lastUpdated}:\n**Present (confirmed):** ${money(pres)}\n**Future (not yet due):** ${money(d.openOrderValueFuture ?? 0)}\n**Month-to-date (MTD):** ${money(d.openOrderValueMTD ?? 0)}`,
      `Openstaande orderwaarde per ${d.lastUpdated}:\n**Huidig (bevestigd):** ${money(pres)}\n**Toekomstig (nog niet vervallen):** ${money(d.openOrderValueFuture ?? 0)}\n**Maand tot heden (MTD):** ${money(d.openOrderValueMTD ?? 0)}`
    );
  }

  // MTD projected vs actual handler
  if (/\b(projected?|prognose|gepland|mtd|month.to.date)\b/.test(q)) {
    if (d.projectedMTD == null || d.turnoverMTD == null) return say('MTD projection data is not available.', 'MTD-prognosegegevens zijn niet beschikbaar.');
    const pct = d.projectedMTD ? Math.round((d.turnoverMTD / d.projectedMTD) * 100) : 0;
    return say(
      `Month-to-date (as of ${d.lastUpdated}):\n**Actual:** ${money(d.turnoverMTD)}\n**Projected (full month):** ${money(d.projectedMTD)}\n**Progress:** ${pct}% of projected`,
      `Maand tot heden (per ${d.lastUpdated}):\n**Actueel:** ${money(d.turnoverMTD)}\n**Prognose (volle maand):** ${money(d.projectedMTD)}\n**Voortgang:** ${pct}% van prognose`
    );
  }

  // Tonnage handler
  if (/\b(tonnage|ton(?:nen)?|tons?)\b/.test(q)) {
    const tonnageAllowed = /^(?:tonnage|ton(?:nen)?|tons?|total|totaal|per|by|category|categorie|categorieen|salesman|verkopers?|show|me|the|what|is|for|top|bottom|best|worst|our|and|how|many|revenue|omzet|orders?|\d+|entitytoken\d+)$/;
    if (q.split(' ').some(w => w && !tonnageAllowed.test(w)))
      return say('Tonnage questions: "total tonnage", "Melkpoeder tonnage", "top reps by tonnage", "tonnage for [rep name]".', 'Tonnage vragen: "totaal tonnage", "Melkpoeder tonnage", "top verkopers op tonnage".');
    const repEntT = prepared.entities.find(e => e.type === 'salesreps');
    const catEntT = prepared.entities.find(e => e.type === 'categories');
    const ascT = /\b(bottom|worst|lowest|least)\b/.test(q);
    const countT = Number(q.match(/\b(\d+)\b/)?.[1] ?? 5);
    if (repEntT && catEntT) {
      const rows = (d.tonnagePerSalesman || []).filter(r => normalize(r.salesman) === normalize(repEntT.name) && normalize(r.category) === normalize(catEntT.name));
      if (!rows.length) return say(`No tonnage data for ${repEntT.name} in ${catEntT.name}.`, `Geen tonnagegegevens voor ${repEntT.name} in ${catEntT.name}.`);
      const tot = rows.reduce((s, r) => s + (r.tonnage || 0), 0);
      return `${repEntT.name} × ${catEntT.name}: ${number(tot)} ${say('tons','ton')}.\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
    }
    if (repEntT) {
      const rows = (d.tonnagePerSalesman || []).filter(r => normalize(r.salesman) === normalize(repEntT.name));
      if (!rows.length) return say(`No tonnage data for ${repEntT.name}.`, `Geen tonnagegegevens voor ${repEntT.name}.`);
      const tot = rows.reduce((s, r) => s + (r.tonnage || 0), 0);
      const rev = rows.reduce((s, r) => s + (r.revenue || 0), 0);
      return `${repEntT.name}: ${number(tot)} ${say('tons','ton')} | ${say('revenue','omzet')}: ${money(rev)}.\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
    }
    if (catEntT) {
      const rows = (d.totalTonnageByCategory || []).filter(r => normalize(r.category) === normalize(catEntT.name));
      if (!rows.length) return say(`No tonnage data for ${catEntT.name}.`, `Geen tonnagegegevens voor ${catEntT.name}.`);
      const tot = rows.reduce((s, r) => s + (r.tonnage || 0), 0);
      return `${catEntT.name}: ${number(tot)} ${say('tons','ton')}.\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
    }
    if (/\b(salesman|verkopers?|rep|top|bottom)\b/.test(q)) {
      const repTonnage = (d.tonnagePerSalesman || []).reduce((m, r) => { m.set(r.salesman, (m.get(r.salesman) || 0) + (r.tonnage || 0)); return m; }, new Map());
      if (!repTonnage.size) return say('Tonnage per salesman data is not available.', 'Tonnage per verkoper niet beschikbaar.');
      const sorted = [...repTonnage.entries()].sort((a, b) => (ascT ? 1 : -1) * (a[1] - b[1]));
      return `${say('Top reps by tonnage','Top verkopers op tonnage')}:\n` + sorted.slice(0, countT).map(([name, ton]) => `${name}: ${number(ton)} ${say('tons','ton')}`).join('\n') + `\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
    }
    const totCat = d.totalTonnageByCategory || [];
    if (!totCat.length) return say('Tonnage data is not available.', 'Tonnagegegevens zijn niet beschikbaar.');
    const sortedCat = [...totCat].sort((a, b) => (ascT ? 1 : -1) * (a.tonnage - b.tonnage));
    return `${say('Tonnage by category','Tonnage per categorie')}:\n` + sortedCat.map(r => `${r.category}: ${number(r.tonnage)} ${say('tons','ton')} (${money(r.revenue)})`).join('\n') + `\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
  }

  // Period detection
  const p = period(q, d, say);
  if (p.error) return p.error;
  if (!p.filter(d.monthly || []).length) return say(`No sales data for ${p.label}.`, `Geen verkoopgegevens voor ${p.label}.`);
  const footer = `\n${say('Period', 'Periode')}: ${p.label}. ${say('Updated', 'Bijgewerkt')}: ${d.lastUpdated}.` + (p.partial ? say(' Includes the latest, incomplete invoice month.', ' Inclusief de laatste, onvolledige factuurmaand.') : '') + (context?.filterLabel ? say(' Local results use the period stated here, not the page filter.', ' Lokale resultaten gebruiken de hier vermelde periode, niet het paginafilter.') : '');

  const countMatch = q.match(/\b(?:top|bottom|best|worst|beste|slechtste|first|eerste)\s+(\d+)\b/);
  const count = countMatch ? Math.max(1, Math.min(50, Number(countMatch[1]))) : /\b(the top|the best|best revenue month|de beste)\b/.test(q) ? 1 : 5;
  const metric = /\b(orders?|bestellingen)\b/.test(q) ? 'orders' : /\b(qty|quantity|quantities|units|aantal|hoeveelheid)\b/.test(q) ? 'qty' : 'rev';
  const format = value => metric === 'rev' ? money(value) : number(value);
  const metricLabel = metric === 'rev' ? say('revenue', 'omzet') : metric === 'orders' ? say('summed order counts', 'opgetelde orderaantallen') : say('quantity', 'hoeveelheid');
  const ascending = /\b(bottom|worst|lowest|least|laagste|slechtste)\b/.test(q);
  const rank = rows => [...rows].sort((a, b) => (ascending ? 1 : -1) * (a[metric] - b[metric]) || a.name.localeCompare(b.name));
  const list = rows => rows.map(r => `**${r.name}**: ${format(r[metric])}`).join('\n');

  const all = definitions.map(def => ({ def, rows: d[def[0]] || [] }));
  const named = prepared.entities.map(e => ({ name: e.name, def: definitions.find(def => def[0] === e.type) }));
  const explicit = all.filter(({def}) => def[1].test(q)).map(({def}) => def);
  const types = [...new Set([...explicit.map(def => def[0]), ...named.map(n => n.def?.[0]).filter(Boolean)])];

  // Salesman × category cross-reference (before multi-entity rejection)
  const repNamed = named.find(n => n.def?.[0] === 'salesreps');
  const catNamed = named.find(n => n.def?.[0] === 'categories');
  const hasRepExplicit = explicit.some(d => d[0] === 'salesreps');
  const hasCatExplicit = explicit.some(d => d[0] === 'categories');
  if ((repNamed || hasRepExplicit) && (catNamed || hasCatExplicit) && (repNamed || catNamed)) {
    const smcRows = d.salesmanCategorySales || [];
    if (!smcRows.length) return say('Salesman-by-category data is not available.', 'Verkoper-per-categorie gegevens zijn niet beschikbaar.');
    const countSMC = Number(q.match(/\b(\d+)\b/)?.[1] ?? 5);
    const ascSMC = /\b(bottom|worst|lowest|least|laagste|slechtste)\b/.test(q);
    const metricSMC = /\b(orders?|bestellingen)\b/.test(q) ? 'orders' : 'rev';
    if (repNamed && catNamed) {
      const rows = smcRows.filter(r => normalize(r.salesman) === normalize(repNamed.name) && normalize(r.category) === normalize(catNamed.name));
      if (!rows.length) return say(`No data for ${repNamed.name} in ${catNamed.name}.`, `Geen gegevens voor ${repNamed.name} in ${catNamed.name}.`);
      const totRev = rows.reduce((s, r) => s + (r.rev || 0), 0);
      const totQty = rows.reduce((s, r) => s + (r.qty || 0), 0);
      const totOrd = rows.reduce((s, r) => s + (r.orders || 0), 0);
      return `${repNamed.name} × ${catNamed.name}:\n${say('Revenue','Omzet')}: ${money(totRev)} | ${say('Qty','Hoeveelheid')}: ${number(totQty)} | ${say('Orders','Orders')}: ${number(totOrd)}\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
    }
    if (repNamed && hasCatExplicit) {
      const rows = smcRows.filter(r => normalize(r.salesman) === normalize(repNamed.name));
      if (!rows.length) return say(`No category breakdown for ${repNamed.name}.`, `Geen categorie-uitsplitsing voor ${repNamed.name}.`);
      const sorted = [...rows].sort((a, b) => (ascSMC ? 1 : -1) * ((a[metricSMC] || 0) - (b[metricSMC] || 0)));
      return `${repNamed.name} — ${say('by category','per categorie')}:\n` + sorted.slice(0, countSMC).map(r => `${r.category}: ${format(r[metricSMC] || 0)}`).join('\n') + `\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
    }
    if (catNamed && hasRepExplicit) {
      const rows = smcRows.filter(r => normalize(r.category) === normalize(catNamed.name));
      if (!rows.length) return say(`No rep breakdown for ${catNamed.name}.`, `Geen verkoper-uitsplitsing voor ${catNamed.name}.`);
      const sorted = [...rows].sort((a, b) => (ascSMC ? 1 : -1) * ((a[metricSMC] || 0) - (b[metricSMC] || 0)));
      return `${catNamed.name} — ${say('by rep','per verkoper')}:\n` + sorted.slice(0, countSMC).map(r => `${r.salesman}: ${format(r[metricSMC] || 0)}`).join('\n') + `\n${say('Updated','Bijgewerkt')}: ${d.lastUpdated}.`;
    }
  }

  if (types.length > 1) return null; // let AI handle cross-entity queries

  let remainder = ` ${q} `;
  for (const {name} of [...named].sort((a,b) => b.name.length-a.name.length)) remainder = remainder.replace(` ${normalize(name)} `, ' ');
  const vocabulary = new Set(('show give tell me please list who what which is are was were our the a an of for in by with and their all available data total totals sum overall lifetime top bottom best worst highest lowest least first revenue sales turnover orders order qty quantity quantities units number how many customers customer clients client klanten klant products product products items item artikelen producten salesrep salesreps sales rep reps salesmen salesman salespeople person representatives representative verkopers verkoper vertegenwoordiger vertegenwoordigers category categories categorie categorieen channels channel webshop direct split versus vs distribution kanalen directe verkoop verdeling month monthly trend trending current this last previous year years quarter ytd deze huidige vorige dit vorig jaar maand maandelijks omzet omzetmaand beste slechtste laagste aantal hoeveel hoeveelheid bestellingen toon geef mij wat wie welke zijn onze de het een per van voor alle totaal totalen s t d m re ve ll hoe gaat verloopt staat hi hello hey hoi hallo dag goedemorgen goedemiddag goedenavond thanks thank bedankt dank ok okay ja nee yes no fine good great average avg mean gemiddeld gemiddelde'.split(' ')));
  aliases.flat().forEach(word => vocabulary.add(word));
  const unknown = remainder.trim().split(/\s+/).filter(word => word && !vocabulary.has(word) && !/^\d+$|^q[1-4]$|^entitytoken\d+$/.test(word));
  if (unknown.length) return null; // unknown words → let AI interpret

  if (/\b(channels?|webshop|direct sales|directe verkoop|kanalen)\b/.test(q)) {
    if (types.length) return help;
    const rows = p.filter(d.salesreps || []);
    return [true, false].map(web => `${web ? 'Webshop' : say('Direct sales','Directe verkoop')}: ${format(sum(rows.filter(r => (r.n.trim() === 'Webshop') === web), metric))}`).join('\n') + footer;
  }
  const selected = types[0];
  if (selected) {
    const def = definitions.find(v => v[0] === selected);
    let rows = p.filter(d[selected] || []);
    const names = named.filter(n => n.def?.[0] === selected).map(n => n.name);
    if (names.length) rows = rows.filter(r => names.includes(String(r.n).trim()));
    else if (/\b(for|van|voor)\b/.test(q) && !/\b(number of|aantal van)\b/.test(q)) return null;
    if (metric === 'qty' && rows.some(r => !Number.isFinite(r.qty))) return say('Quantity is not available for this entity type.', 'Hoeveelheid is niet beschikbaar voor dit type.');
    if (!rows.length) return say('No matching rows for that entity and period.', 'Geen passende regels voor deze naam en periode.');
    const groups = aggregate(rows);
    if (/\b(how many|number of|hoeveel|aantal)\b/.test(q) && metric === 'rev') return `${groups.length} ${def[lang === 'nl' ? 3 : 2]}` + footer;
    if (!names.length && /\b(total|totals|sum|totaal|totalen)\b/.test(q)) return `${def[lang === 'nl' ? 3 : 2]} — ${metricLabel}: **${format(sum(rows, metric))}**` + footer;
    return `${def[lang === 'nl' ? 3 : 2]} — ${metricLabel}\n` + list(rank(groups).slice(0, names.length || count)) + footer;
  }
  if (/\b(revenue|sales|turnover|omzet|orders?|bestellingen|month|monthly|maand|omzetmaand)\b/.test(q)) {
    const rows = p.filter(d.monthly || []);
    if (metric === 'qty') return null;
    if (/\b(average|avg|mean|gemiddeld)\b/.test(q)) {
      const avg = rows.length ? sum(rows, metric) / rows.length : 0;
      return `${say('Average monthly', 'Gemiddeld maandelijks')} ${metricLabel}: **${format(avg)}**` + footer;
    }
    if (/\b(top|best|worst|highest|lowest|beste|laagste|monthly|maandelijks|trend)\b/.test(q)) {
      const result = rows.map(r => ({...r, name:r.m}));
      return list(/\b(monthly|maandelijks|trend(?:ing)?)\b/.test(q) ? result : rank(result).slice(0,count)) + footer;
    }
    return `${metricLabel}: **${format(sum(rows, metric))}**` + footer;
  }
  return null;
}

export function buildFallbackAnswer(question, options) {
  const nl = options?.lang === 'nl';
  const prefix = nl ? 'AI is niet beschikbaar. Lokaal berekend uit dashboardgegevens:\n\n' : 'AI is unavailable. Calculated locally from dashboard data:\n\n';
  try {
    const answer = answerFromData(question, options);
    if (answer == null) return prefix + (nl ? 'Deze vraag kan lokaal niet worden beantwoord. Probeer het opnieuw als AI beschikbaar is.' : 'This question could not be answered locally. Try again when AI is available, or ask \'top 5 customers\'.');
    return prefix + answer;
  }
  catch { return prefix + (nl ? 'Deze vraag kan lokaal niet worden beantwoord. Probeer "top 5 klanten".' : 'This question could not be answered locally. Try "top 5 customers".'); }
}
