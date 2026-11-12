/* ── CHATBOT LOCAL ANSWER ENGINE ─────────────────────────────────────────
   Answers dashboard questions directly from the data object — no AI call.

   resolve(question, opts, d) → { answer, topic, subject, parsed }
     answer === null  →  the question needs AI (reasoning, or words we do
                         not understand). Everything else is answered here.

   `d` is the dashboard data: the data.js module in knitworks-dashboard,
   the Supabase snapshot in knitworks-dashboard-1. Both row shapes are
   supported (d/iso vs day_label/day_iso, start/end vs week_start_s/…).
   This file is identical in both folders.
   ───────────────────────────────────────────────────────────────────── */
import { parseQuestion, normalizeText } from './chatLanguage.js';

export const normalize = normalizeText;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthId = m => {
  const [mon, year] = String(m ?? '').trim().split(/\s+/);
  const i = MON.findIndex(x => x.toLowerCase() === String(mon).slice(0, 3).toLowerCase());
  const y = Number(year);
  return i < 0 || !Number.isFinite(y) ? NaN : (y < 100 ? 2000 + y : y) * 12 + i;
};
const monthLabel = id => `${MON[((id % 12) + 12) % 12]} ${String(Math.floor(id / 12) % 100).padStart(2, '0')}`;

const fmtInt = n => Math.round(Number(n) || 0).toLocaleString('de-DE');
const money = n => { const v = Math.round(Number(n) || 0); return `${v < 0 ? '-' : ''}€${Math.abs(v).toLocaleString('de-DE')}`; };
const num = n => (Number(n) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const pct = (part, whole) => whole ? `${((part / whole) * 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—';
const pctVal = v => `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const delta = (a, b) => b ? `${a - b >= 0 ? '+' : ''}${(((a - b) / Math.abs(b)) * 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—';
const sumBy = (rows, f) => rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
const isoToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const isoLabel = iso => { const [y, m, dd] = iso.split('-'); return `${dd}/${m}/${y}`; };
const shiftIso = (iso, days) => { const t = new Date(`${iso}T12:00:00`); t.setDate(t.getDate() + days); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

const TYPE_WORDS = {
  customers: { en: ['customers', 'customer'], nl: ['klanten', 'klant'] },
  products: { en: ['products', 'product'], nl: ['producten', 'product'] },
  salesreps: { en: ['sales reps', 'sales rep'], nl: ['verkopers', 'verkoper'] },
  categories: { en: ['categories', 'category'], nl: ['categorieën', 'categorie'] },
};
const SALES_TYPES = Object.keys(TYPE_WORDS);

/* Same rules the Customer Scorecard page uses (App.jsx computeRisk / computeNonPayer). */
export const debtorRisk = c => { const age = c.ageOfOldest || 0, val = c.openValue || 0; return age < 30 ? 'A' : age <= 60 ? 'B' : age > 90 && val >= 5000 ? 'D' : 'C'; };
export const debtorNonPayer = c => (c.ageOfOldest || 0) > 60;

/* ── environment: normalised views over the data ── */
export function makeEnv(d, opts, lang) {
  const say = (en, nl) => lang === 'nl' ? nl : en;
  const monthIds = [...new Set((d.monthly || []).map(r => monthId(r.m)).filter(Number.isFinite))].sort((a, b) => a - b);
  const weeks = (d.weekly || []).map(r => {
    const m = /W?(\d+)\D+(\d+)/.exec(String(r.w)) || [];
    return { w: r.w, n: Number(m[1]), y: 2000 + (Number(m[2]) % 100), start: r.start ?? r.week_start_s ?? '', end: r.end ?? r.week_end_s ?? '', rev: Number(r.rev) || 0, orders: Number(r.orders) || 0 };
  });
  const days = (d.daily || []).map(r => ({ iso: r.iso ?? r.day_iso, label: r.d ?? r.day_label, rev: Number(r.rev) || 0, orders: Number(r.orders) || 0 }))
    .filter(r => r.iso).sort((a, b) => a.iso.localeCompare(b.iso));
  const latest = monthIds[monthIds.length - 1], first = monthIds[0];
  const through = d.maxFactuurDatum || d.lastUpdated || '';
  return { d, opts, lang, say, monthIds, latest, first, latestYear: Math.floor(latest / 12), weeks, days, through, today: opts.today || isoToday() };
}

/* ── periods ── */
const P = {
  months: (from, to, label, kind = 'range') => ({ g: 'm', from, to, label, kind }),
  all: env => ({ g: 'all', from: env.first, to: env.latest, label: env.say('all available months', 'alle beschikbare maanden'), kind: 'all' }),
};
const rangeLabel = (from, to) => from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;

export function buildPeriods(tags, env) {
  const { latest, latestYear, say } = env;
  const used = new Set();
  const out = [];
  let lastEnd = -2, joinNext = false, between = false, since = false;
  const yearAfter = i => { const t = tags[i + 1]; if (t && t.k === 'year') { used.add(i + 1); return t.v; } return undefined; };
  const quarter = (qn, y) => { const yy = y ?? (latestYear * 12 + (qn - 1) * 3 <= latest ? latestYear : latestYear - 1); return P.months(yy * 12 + (qn - 1) * 3, yy * 12 + (qn - 1) * 3 + 2, `Q${qn} ${yy}`, 'quarter'); };
  const curQ = Math.floor((latest % 12) / 3) + 1;
  for (let i = 0; i < tags.length; i++) {
    if (used.has(i)) continue;
    const t = tags[i];
    let p = null, end = i;
    if (t.k === 'range') {
      if (t.v === 'between') between = true;
      else if (t.v === 'since') since = true;
      else if ((t.v === 'to' || (t.v === 'and' && between)) && lastEnd === i - 1) joinNext = true;
      continue;
    }
    if (t.k === 'time') {
      switch (t.v) {
        case 'thismonth': p = P.months(latest, latest, monthLabel(latest), 'thismonth'); break;
        case 'lastmonth': p = P.months(latest - 1, latest - 1, monthLabel(latest - 1), 'prev'); break;
        case 'thisyear': p = P.months(latestYear * 12, latest, `${latestYear} YTD`, 'ytd'); break;
        case 'lastyear': p = P.months((latestYear - 1) * 12, (latestYear - 1) * 12 + 11, String(latestYear - 1), 'prevyear'); break;
        case 'thisquarter': p = { ...quarter(curQ, latestYear), kind: 'thisquarter' }; break;
        case 'lastquarter': p = { ...(curQ === 1 ? quarter(4, latestYear - 1) : quarter(curQ - 1, latestYear)), kind: 'prev' }; break;
        case 'alltime': p = P.all(env); break;
        case 'nextmonth': p = P.months(latest + 1, latest + 1, monthLabel(latest + 1), 'future'); break;
        case 'nextyear': p = P.months((latestYear + 1) * 12, (latestYear + 1) * 12 + 11, String(latestYear + 1), 'future'); break;
        case 'nextquarter': p = curQ === 4 ? quarter(1, latestYear + 1) : quarter(curQ + 1, latestYear); break;
        case 'thisweek': { const w = env.weeks[env.weeks.length - 1]; if (w) p = { g: 'w', keys: [w.w], label: weekLabel(w, say), kind: 'thisweek' }; break; }
        case 'lastweek': { const w = env.weeks[env.weeks.length - 2]; if (w) p = { g: 'w', keys: [w.w], label: weekLabel(w, say), kind: 'prev' }; break; }
        case 'today': p = { g: 'd', isos: [env.today], label: isoLabel(env.today), kind: 'today' }; break;
        case 'yesterday': p = { g: 'd', isos: [shiftIso(env.today, -1)], label: isoLabel(shiftIso(env.today, -1)), kind: 'prev' }; break;
        case 'thisperiod': p = { ...pagePeriod(env), pageFilter: true }; break;
        case 'prevperiod': p = { g: 'm', kind: 'prevperiod', pending: true }; break;
        case 'lastn': {
          const a = tags[i + 1], b = tags[i + 2];
          const n = a && a.k === 'num' ? a.v : null;
          const g = n != null ? b : a;
          if (g && g.k === 'gran') {
            const count = n ?? 1;
            used.add(i + 1); if (n != null) used.add(i + 2);
            end = n != null ? i + 2 : i + 1;
            if (g.v === 'month') p = P.months(latest - count, latest - 1, `${rangeLabel(latest - count, latest - 1)} (${say(`last ${count} complete month${count > 1 ? 's' : ''}`, `laatste ${count} volledige maand${count > 1 ? 'en' : ''}`)})`, 'prev');
            else if (g.v === 'year') p = n == null || n === 1 ? P.months(latest - 12, latest - 1, `${rangeLabel(latest - 12, latest - 1)} (${say('last 12 complete months', 'laatste 12 volledige maanden')})`, 'prev') : P.months(latest - 12 * count, latest - 1, rangeLabel(latest - 12 * count, latest - 1), 'prev');
            else if (g.v === 'quarter') p = P.months(latest - 3 * count, latest - 1, `${rangeLabel(latest - 3 * count, latest - 1)} (${say(`last ${3 * count} complete months`, `laatste ${3 * count} volledige maanden`)})`, 'prev');
            else if (g.v === 'week') { const ws = env.weeks.slice(-(count + 1), -1); if (ws.length) p = { g: 'w', keys: ws.map(w => w.w), label: say(`last ${ws.length} complete weeks (${ws[0].w} – ${ws[ws.length - 1].w})`, `laatste ${ws.length} volledige weken (${ws[0].w} – ${ws[ws.length - 1].w})`), kind: 'prev' }; }
            else if (g.v === 'day') { const lastDay = env.days.length ? env.days[env.days.length - 1].iso : env.today; const isos = Array.from({ length: count }, (_, k) => shiftIso(lastDay, -k)); p = { g: 'd', isos, label: `${isoLabel(isos[isos.length - 1])} – ${isoLabel(lastDay)}`, kind: 'prev' }; }
          }
          break;
        }
        default: break;
      }
    } else if (t.k === 'm') {
      p = { g: 'm', mi: t.v, y: yearAfter(i), kind: 'month', pending: true };
      if (p.y !== undefined) end = i + 1;
    } else if (t.k === 'q') { const y = yearAfter(i); p = quarter(t.v, y); if (y !== undefined) end = i + 1; }
    else if (t.k === 'h') {
      let y = yearAfter(i); if (y !== undefined) end = i + 1;
      y = y ?? (latestYear * 12 + (t.v - 1) * 6 <= latest ? latestYear : latestYear - 1);
      p = P.months(y * 12 + (t.v - 1) * 6, y * 12 + (t.v - 1) * 6 + 5, `H${t.v} ${y}`, 'half');
    } else if (t.k === 'year') p = P.months(t.v * 12, t.v * 12 + 11, String(t.v), t.v === latestYear ? 'ytd' : 'year');
    else if (t.k === 'date') p = { g: 'd', isos: [t.v], label: isoLabel(t.v), kind: 'day' };
    else if (t.k === 'gran' && t.v === 'week' && tags[i + 1] && tags[i + 1].k === 'num' && tags[i + 1].v >= 1 && tags[i + 1].v <= 53 && !(tags[i - 1] && tags[i - 1].k === 'op')) {
      used.add(i + 1); end = i + 1;
      const y = yearAfter(i + 1); if (y !== undefined) end = i + 2;
      const hits = env.weeks.filter(w => w.n === tags[i + 1].v && (y === undefined || w.y === y));
      const w = hits[hits.length - 1];
      p = w ? { g: 'w', keys: [w.w], label: weekLabel(w, say), kind: 'week' } : { g: 'w', keys: [], label: `${say('week', 'week')} ${tags[i + 1].v}`, kind: 'week', missing: true };
    }
    if (!p) continue;
    used.add(i);
    const rangeable = x => ['month', 'quarter', 'half', 'year', 'ytd', 'day', 'range'].includes(x.kind);
    if (joinNext && out.length && rangeable(out[out.length - 1]) && rangeable(p)) {
      const a = out[out.length - 1];
      if (a.g === 'm' && p.g === 'm') out[out.length - 1] = { g: 'm', kind: 'range', pendingRange: [a, p] };
      else if (a.g === 'd' && p.g === 'd') {
        const isos = []; for (let x = a.isos[0]; x <= p.isos[0] && isos.length < 400; x = shiftIso(x, 1)) isos.push(x);
        out[out.length - 1] = { g: 'd', isos, label: `${a.label} – ${p.label}`, kind: 'range' };
      } else out.push(p);
    } else out.push(since ? { ...p, since: true } : p);
    joinNext = false; since = false; lastEnd = end;
  }
  // resolve months without an explicit year, ranges, "since", "previous period"
  const resolveMonth = (p, fallbackYear) => {
    if (!p.pending || p.kind !== 'month') return p;
    const y = p.y ?? fallbackYear ?? (latestYear * 12 + p.mi <= latest ? latestYear : latestYear - 1);
    return P.months(y * 12 + p.mi, y * 12 + p.mi, `${MON[p.mi]} ${String(y % 100).padStart(2, '0')}`, 'month');
  };
  const list = out.map(p => {
    if (p.pendingRange) {
      const [a, b] = p.pendingRange;
      const B = resolveMonth(b);
      const A = a.pending && a.kind === 'month' && a.y === undefined ? resolveMonth(a, Math.floor(B.to / 12) - (a.mi > (B.to % 12) ? 1 : 0)) : resolveMonth(a);
      return P.months(Math.min(A.from, B.from), Math.max(A.to, B.to), rangeLabel(Math.min(A.from, B.from), Math.max(A.to, B.to)), 'range');
    }
    let r = resolveMonth(p);
    if (p.since && r.g === 'm') r = P.months(r.from, latest, rangeLabel(r.from, latest), 'range');
    return r;
  });
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind === 'prevperiod') {
      const base = list.find(x => x.kind !== 'prevperiod' && x.g === 'm') || pagePeriod(env);
      list[i] = { ...previousOf(base, env), kind: 'prev' };
      if (!list.some(x => x === base)) list.unshift(base);
    }
  }
  return { list, used };
}
const weekLabel = (w, say) => `${say('week', 'week')} ${w.n} (${w.start}${w.start && w.end ? ' – ' : ''}${w.end})`.replace(' ()', '');

/* "This period" = whatever the page's date filter shows (context.dateRange, e.g. "Jan 25 – Nov 26"). */
function pagePeriod(env) {
  const m = /([A-Za-z]{3} \d{2,4})\s*[–—-]\s*([A-Za-z]{3} \d{2,4})/.exec(env.opts.context?.dateRange || '');
  if (m) {
    const from = monthId(m[1]), to = monthId(m[2]);
    if (Number.isFinite(from) && Number.isFinite(to) && !(from <= env.first && to >= env.latest)) return P.months(from, to, rangeLabel(from, to), 'range');
  }
  // No narrower page filter → "this period" is the current year to date (compared with the same months last year).
  return P.months(env.latestYear * 12, env.latest, `${env.latestYear} YTD`, 'ytd');
}
export function previousOf(p, env) {
  if (p.g === 'w') { const i = env.weeks.findIndex(w => w.w === p.keys[0]); const ws = env.weeks.slice(Math.max(0, i - p.keys.length), Math.max(0, i)); return { g: 'w', keys: ws.map(w => w.w), label: ws.length === 1 ? weekLabel(ws[0], env.say) : ws.map(w => w.w).join(', '), kind: 'prev' }; }
  if (p.g === 'd') { const n = p.isos.length; const firstIso = [...p.isos].sort()[0]; const isos = Array.from({ length: n }, (_, k) => shiftIso(firstIso, -(k + 1))); return { g: 'd', isos, label: n === 1 ? isoLabel(isos[0]) : `${isoLabel(isos[isos.length - 1])} – ${isoLabel(isos[0])}`, kind: 'prev' }; }
  if (p.g === 'all') return null;
  if (p.kind === 'ytd' || p.kind === 'year' || p.kind === 'prevyear') return yearBefore(p, env);
  const len = p.to - p.from + 1;
  return P.months(p.from - len, p.from - 1, rangeLabel(p.from - len, p.from - 1), 'prev');
}
function yearBefore(p, env) {
  const to = Math.min(p.to, env.latest);
  return P.months(p.from - 12, to - 12, `${rangeLabel(p.from - 12, to - 12)}`, 'prev');
}
const isPartial = (p, env) => (p.g === 'm' || p.g === 'all') && p.from <= env.latest && p.to >= env.latest;

/* ── data access ── */
export function rowsFor(env, type, p) {
  const d = env.d;
  if (p.g === 'w') { const keys = new Set(p.keys); return (d[`${type}Weekly`] || []).filter(r => keys.has(r.w)); }
  if (p.g === 'd') { const isos = new Set(p.isos); return (d[`${type}Daily`] || []).filter(r => isos.has(r.iso ?? r.day_iso)); }
  const src = d[type] || [];
  if (p.g === 'all') return src;
  return src.filter(r => { const id = monthId(r.m); return id >= p.from && id <= p.to; });
}
function baseFor(env, p) {
  if (p.g === 'w') { const keys = new Set(p.keys); return env.weeks.filter(w => keys.has(w.w)); }
  if (p.g === 'd') { const isos = new Set(p.isos); return env.days.filter(x => isos.has(x.iso)); }
  const src = (env.d.monthly || []).map(r => ({ id: monthId(r.m), m: r.m, rev: Number(r.rev) || 0, orders: Number(r.orders) || 0 }));
  return p.g === 'all' ? src : src.filter(r => r.id >= p.from && r.id <= p.to);
}
export function group(rows) {
  const map = new Map();
  for (const r of rows) {
    const name = String(r.n).trim();
    let g = map.get(name);
    if (!g) map.set(name, g = { name, rev: 0, orders: 0, qty: 0 });
    g.rev += Number(r.rev) || 0; g.orders += Number(r.orders) || 0; g.qty += Number(r.qty) || 0;
  }
  return [...map.values()];
}
const measure = (env, p, sel) => {
  const rows = sel ? rowsFor(env, sel.type, p).filter(r => sel.names.has(String(r.n).trim())) : baseFor(env, p);
  return { rev: sumBy(rows, 'rev'), orders: sumBy(rows, 'orders'), qty: sumBy(rows, 'qty'), count: rows.length };
};

/* ════════════════════════════════════════════════════════════════════════
   resolve
   ════════════════════════════════════════════════════════════════════════ */
const SUBJECT_KINDS = new Set(['dim', 'ent', 'metric', 'dom', 'debtor', 'fin', 'chan']);

export function resolve(question, opts = {}, d = {}) {
  const lang = opts.lang === 'nl' ? 'nl' : 'en';
  const env = makeEnv(d || {}, opts, lang);
  const { say } = env;
  const parsed = parseQuestion(question, env.d);
  let tags = parsed.tags;
  const done = (answer, topic = 'general') => ({ answer, topic, subject: tags.filter(t => SUBJECT_KINDS.has(t.k) || (t.k === 'meta' && t.v === 'summary')), parsed });
  const has = (k, v) => tags.some(t => t.k === k && (v === undefined || t.v === v));

  if (!normalizeText(question)) return done(helpText(env), 'general');

  const subjectCount = tags.filter(t => SUBJECT_KINDS.has(t.k)).length;
  const structural = tags.filter(t => t.k !== 'talk').length;

  // small talk — instant, never AI
  if (has('talk') && !structural && parsed.unknown.length <= 2) {
    const kind = tags.find(t => t.k === 'talk').v;
    if (kind === 'help') return done(helpText(env));
    if (kind === 'who') return done(say("I'm the DairyTop dashboard assistant. I answer questions about your sales, finance, open orders and accounts receivable straight from the dashboard data.", 'Ik ben de DairyTop dashboard-assistent. Ik beantwoord vragen over verkoop, financiën, open orders en debiteuren rechtstreeks uit de dashboardgegevens.'));
    if (kind === 'thanks') return done(say("You're welcome! Anything else you'd like to look at?", 'Graag gedaan! Wil je nog iets anders bekijken?'));
    if (kind === 'bye') return done(say('Goodbye! I am here whenever you need a number.', 'Tot ziens! Ik ben er wanneer je een cijfer nodig hebt.'));
    if (kind === 'yesno') return done(say('Okay. What would you like to look at? For example "top 5 customers this year" or "revenue this month".', 'Oké. Wat wil je bekijken? Bijvoorbeeld "top 5 klanten dit jaar" of "omzet deze maand".'));
    return done(say('Hi there! Ask me about revenue, customers, products, sales reps, open orders, finance or accounts receivable.', 'Hoi! Vraag me over omzet, klanten, producten, verkopers, open orders, financiën of debiteuren.'));
  }
  tags = tags.filter(t => t.k !== 'talk' || t.v === 'help');

  // questions that need reasoning go to AI (with a slim data slice)
  if (has('ai')) return done(null, 'ai');

  // names we could not pin down
  if (parsed.unknown.length) {
    const c = parsed.clarify;
    if (c && c.words.length === parsed.unknown.length) {
      const show = c.candidates.slice(0, 8).map(e => `• ${e.name} (${TYPE_WORDS[e.type]?.[lang][1] || e.type})`).join('\n');
      const more = c.candidates.length > 8 ? say(`\n…and ${c.candidates.length - 8} more. Add another word of the name to narrow it down.`, `\n…en nog ${c.candidates.length - 8}. Voeg een extra woord van de naam toe.`) : '';
      return done(say(`"${c.words.join(' ')}" matches ${c.candidates.length} names. Which one do you mean?\n`, `"${c.words.join(' ')}" past bij ${c.candidates.length} namen. Welke bedoel je?\n`) + show + more, 'clarify');
    }
    if (!subjectCount && !opts.prev?.length) return done(scopeText(env), 'general');
    return done(null, 'ai');
  }

  // follow-ups ("top 5", "compare to last month", "more") inherit the previous subject
  if (!subjectCount && !has('meta') && !has('talk') && opts.prev?.length) tags = [...opts.prev, ...tags];
  const hasSubject = tags.some(t => SUBJECT_KINDS.has(t.k));

  if (has('meta', 'updated') && !hasSubject) return done(updatedText(env));
  if (has('meta', 'summary') && !hasSubject) return done(summaryText(env), 'general');
  if (has('talk', 'help') && !hasSubject) return done(helpText(env));
  if (!hasSubject && tags.length && tags.every(t => t.k === 'op' && t.v === 'more')) return done(summaryText(env), 'general');
  if (!tags.length) return done(scopeText(env));

  const periods = buildPeriods(tags, env);
  const I = {
    tags, has, periods: periods.list,
    nums: tags.filter((t, i) => t.k === 'num' && !periods.used.has(i)).map(t => t.v),
    dims: tags.filter(t => t.k === 'dim'),
    ents: tags.filter(t => t.k === 'ent').map(t => t.e),
    op: v => tags.some(t => t.k === 'op' && t.v === v),
    gran: v => tags.find(t => t.k === 'gran' && (v === undefined || t.v === v)),
  };
  I.dims = I.dims.filter((t, i, a) => a.findIndex(x => x.v === t.v) === i);
  I.ents = I.ents.filter((e, i, a) => a.indexOf(e) === i);

  // Forecasts. A plain revenue/orders forecast is a transparent trend projection done here;
  // forecasts per customer/product/rep or for finance and receivables go to AI.
  const futureOnly = I.periods.some(p => p.g === 'm' && p.from > env.latest);
  if (has('predict') || futureOnly) {
    const plain = !I.dims.length && !I.ents.length && !has('dom', 'debtor') && !has('debtor') && !has('dom', 'finance') && !has('fin') && !has('metric', 'tonnage') && !has('metric', 'qty') && !has('chan') && !has('dom', 'openorders');
    if (plain && env.monthIds.length) return done(forecastAnswer(env, I), 'revenue');
    if (has('predict')) return done(null, 'ai');
  }

  let out;
  if (has('dom', 'openorders') && !has('dom', 'debtor')) out = [openOrdersAnswer(env, I), 'orders'];
  else if (has('dom', 'mtd') && !has('dom', 'debtor') && !has('fin')) out = [mtdAnswer(env), 'orders'];
  else if (has('dom', 'debtor') || has('debtor')) out = [debtorAnswer(env, I), 'debtor'];
  else if (has('dom', 'finance') || has('fin') || I.ents.some(e => e.type === 'fincat')) out = [financeAnswer(env, I), 'finance'];
  else if (has('dom', 'mtd')) out = [mtdAnswer(env), 'orders'];
  else if (has('dom', 'openorders')) out = [openOrdersAnswer(env, I), 'orders'];
  else if (has('metric', 'tonnage')) out = [tonnageAnswer(env, I), 'tonnage'];
  else out = salesAnswer(env, I);
  // be transparent when a name was matched from part of it
  const guessed = tags.filter(t => t.k === 'ent' && t.partial).map(t => `"${t.partial}" → ${t.e.name}`);
  const note = guessed.length && out[0] ? say(`Matched ${guessed.join(', ')}.\n`, `Herkend: ${guessed.join(', ')}.\n`) : '';
  return done(out[0] ? note + out[0] : out[0], out[1]);
}

/** String answer, or null when the question should go to AI. */
export function answerFromData(question, opts = {}, d = {}) {
  return resolve(question, opts, d).answer;
}

/** Used when AI is unreachable: always returns something useful. */
export function buildFallbackAnswer(question, options = {}, d = {}) {
  const nl = options?.lang === 'nl';
  let answer = null;
  try { answer = answerFromData(question, options, d); } catch { /* fall through */ }
  if (answer) return answer;
  let summary = '';
  try { summary = summaryText(makeEnv(d || {}, options, nl ? 'nl' : 'en')); } catch { /* ignore */ }
  return (nl
    ? 'De AI-assistent is nu niet bereikbaar en deze vraag kan ik niet rechtstreeks uit de gegevens beantwoorden. Dit zijn de kerncijfers:\n\n'
    : "The AI assistant can't be reached right now and I can't answer this one straight from the data. Here are the key numbers instead:\n\n") + summary;
}

/* ── static texts ── */
function helpText(env) {
  return env.say(
    'I answer straight from the dashboard data. You can ask about:\n• Revenue — "revenue this month", "best month", "2025 vs 2026", "revenue last week"\n• Customers, products, sales reps, categories — "top 10 customers this year", "revenue Johan Hoogendoorn", "share of top 3 reps"\n• Channels — "webshop vs direct sales"\n• Open orders and MTD — "open order value", "MTD vs projected"\n• Finance — "gross margin", "biggest cost drivers", "EBITDA"\n• Receivables — "total open AR", "risk D customers", "oldest invoices"\n• Tonnage — "tonnage by category", "top reps by tonnage"',
    'Ik antwoord rechtstreeks uit de dashboardgegevens. Je kunt vragen naar:\n• Omzet — "omzet deze maand", "beste maand", "2025 vs 2026", "omzet vorige week"\n• Klanten, producten, verkopers, categorieën — "top 10 klanten dit jaar", "omzet Johan Hoogendoorn", "aandeel top 3 verkopers"\n• Kanalen — "webshop vs directe verkoop"\n• Open orders en MTD — "openstaande orderwaarde", "MTD vs prognose"\n• Financiën — "brutomarge", "grootste kostenposten", "EBITDA"\n• Debiteuren — "totaal openstaand", "risico D klanten", "oudste facturen"\n• Tonnage — "tonnage per categorie", "top verkopers op tonnage"'
  );
}
function scopeText(env) {
  return env.say(
    'I can only help with the DairyTop dashboard data — revenue, customers, products, sales reps, categories, open orders, finance and receivables. Try "revenue this month" or "top 5 customers".',
    'Ik kan alleen helpen met de DairyTop dashboardgegevens — omzet, klanten, producten, verkopers, categorieën, open orders, financiën en debiteuren. Probeer "omzet deze maand" of "top 5 klanten".'
  );
}
function updatedText(env) {
  const { d, say } = env;
  const lines = [say(`Data last refreshed: **${d.lastUpdated || '—'}**`, `Gegevens laatst bijgewerkt: **${d.lastUpdated || '—'}**`)];
  if (d.maxFactuurDatum) lines.push(say(`Latest invoice date: ${d.maxFactuurDatum}`, `Laatste factuurdatum: ${d.maxFactuurDatum}`));
  if (env.latest) lines.push(say(`Sales months: ${monthLabel(env.first)} – ${monthLabel(env.latest)} (${monthLabel(env.latest)} is incomplete)`, `Verkoopmaanden: ${monthLabel(env.first)} – ${monthLabel(env.latest)} (${monthLabel(env.latest)} is onvolledig)`));
  if (d.debtorAsOf) lines.push(say(`Receivables as of: ${d.debtorAsOf}`, `Debiteuren per: ${d.debtorAsOf}`));
  if (d.finPeriodLabel) lines.push(say(`Finance periods: ${d.finPeriodLabel}`, `Financiële perioden: ${d.finPeriodLabel}`));
  return lines.join('\n');
}

const PAGE_TOPIC = {
  overview: 'overview', revenue: 'revenue', salesreps: 'salesreps', customers: 'customers', products: 'products', categories: 'categories', channels: 'channels',
  plsummary: 'finance', finrevcosts: 'costs', finledger: 'ledger', debtors: 'debtor', debtorcustomers: 'debtorcustomers', debtortrend: 'debtortrend',
};
/* "Summarise this page" → the key numbers of the page the user is on. */
export function summaryText(env) {
  const { say } = env;
  const topic = PAGE_TOPIC[env.opts.context?.page] || 'overview';
  const all = P.all(env);
  const mk = (extra = {}) => ({ tags: [], has: () => false, periods: [], nums: [], dims: [], ents: [], op: () => false, gran: () => undefined, ...extra });
  const dimI = (v, n) => mk({ dims: [{ k: 'dim', v, one: false }], nums: [n] });
  if (!env.monthIds.length && topic !== 'debtor') return say('The dashboard data is not loaded yet.', 'De dashboardgegevens zijn nog niet geladen.');
  switch (topic) {
    case 'revenue': return monthSeries(env, mk(), P.months(env.latest - 5, env.latest, rangeLabel(env.latest - 5, env.latest)));
    case 'salesreps': case 'customers': case 'products': case 'categories': return ranking(env, dimI(topic, 5), topic, all);
    case 'channels': return channelAnswer(env, mk(), all);
    case 'finance': return financeAnswer(env, mk());
    case 'costs': return financeAnswer(env, mk({ has: (k, v) => k === 'fin' && (v === undefined || v === 'costs') }));
    case 'ledger': return financeAnswer(env, mk({ has: (k, v) => k === 'fin' && (v === undefined || v === 'ledger'), op: v => v === 'growth' }));
    case 'debtor': return debtorAnswer(env, mk());
    case 'debtorcustomers': return debtorAnswer(env, mk({ dims: [{ k: 'dim', v: 'customers', one: false }] }));
    case 'debtortrend': return debtorAnswer(env, mk({ has: (k, v) => k === 'debtor' && (v === undefined || v === 'pct30') }));
    default: break;
  }
  const d = env.d;
  const cur = measure(env, P.months(env.latest, env.latest)), prev = measure(env, P.months(env.latest - 1, env.latest - 1));
  const ytd = measure(env, P.months(env.latestYear * 12, env.latest));
  const lastY = measure(env, P.months((env.latestYear - 1) * 12, env.latest - 12));
  const top = type => group(rowsFor(env, type, P.months(env.latestYear * 12, env.latest))).sort((a, b) => b.rev - a.rev)[0];
  const lines = [
    say(`**Key numbers** (data through ${env.through})`, `**Kerncijfers** (gegevens t/m ${env.through})`),
    say(`${monthLabel(env.latest)} so far: **${money(cur.rev)}** (${fmtInt(cur.orders)} orders) · ${monthLabel(env.latest - 1)}: ${money(prev.rev)}`, `${monthLabel(env.latest)} tot nu toe: **${money(cur.rev)}** (${fmtInt(cur.orders)} orders) · ${monthLabel(env.latest - 1)}: ${money(prev.rev)}`),
    say(`${env.latestYear} YTD: **${money(ytd.rev)}** vs ${money(lastY.rev)} same months last year (${delta(ytd.rev, lastY.rev)})`, `${env.latestYear} YTD: **${money(ytd.rev)}** vs ${money(lastY.rev)} zelfde maanden vorig jaar (${delta(ytd.rev, lastY.rev)})`),
  ];
  const tc = top('customers'), tr = top('salesreps'), tk = top('categories');
  if (tc) lines.push(say(`Top customer ${env.latestYear}: ${tc.name} (${money(tc.rev)})`, `Topklant ${env.latestYear}: ${tc.name} (${money(tc.rev)})`));
  if (tr) lines.push(say(`Top sales rep ${env.latestYear}: ${tr.name} (${money(tr.rev)})`, `Topverkoper ${env.latestYear}: ${tr.name} (${money(tr.rev)})`));
  if (tk) lines.push(say(`Top category ${env.latestYear}: ${tk.name} (${money(tk.rev)})`, `Topcategorie ${env.latestYear}: ${tk.name} (${money(tk.rev)})`));
  if (d.openOrderValuePresent != null) lines.push(say(`Open orders: ${money(d.openOrderValuePresent)} present + ${money(d.openOrderValueFuture || 0)} future`, `Open orders: ${money(d.openOrderValuePresent)} huidig + ${money(d.openOrderValueFuture || 0)} toekomstig`));
  if (d.debtorKPI?.totalDebtorValue != null) lines.push(say(`Open receivables: ${money(d.debtorKPI.totalDebtorValue)} (${money(d.debtorKPI.over90)} over 90 days)`, `Openstaande debiteuren: ${money(d.debtorKPI.totalDebtorValue)} (${money(d.debtorKPI.over90)} ouder dan 90 dagen)`));
  return lines.join('\n');
}

/* ════════════════════════════════════════════════════════════════════════
   FORECAST — a simple, explainable trend projection (no AI)
   Each future month = the same month one year earlier × recent year-over-year
   growth. Growth is measured on the latest complete months that have a
   year-ago counterpart. The low/high range is "no growth" vs "growth continues".
   ════════════════════════════════════════════════════════════════════════ */
function forecastAnswer(env, I) {
  const { say, latest, first, latestYear } = env;
  const field = I.has('metric', 'orders') ? 'orders' : 'rev';
  const fmt = v => field === 'rev' ? money(v) : fmtInt(v);
  const what = field === 'rev' ? say('revenue', 'omzet') : say('orders', 'orders');
  const actual = new Map((env.d.monthly || []).map(r => [monthId(r.m), Number(r[field]) || 0]));
  const complete = env.monthIds.filter(id => id < latest);
  const pairs = complete.filter(id => id >= latest - 12 && actual.has(id - 12));
  const cur = pairs.reduce((s, id) => s + actual.get(id), 0), old = pairs.reduce((s, id) => s + actual.get(id - 12), 0);
  const enough = pairs.length >= 3 && old > 0;
  const growth = enough ? cur / old - 1 : 0;
  const avg12 = complete.slice(-12).reduce((s, id) => s + actual.get(id), 0) / Math.max(1, complete.slice(-12).length);
  const estimator = g => { const memo = new Map(); const est = id => { if (id < latest && actual.has(id)) return actual.get(id); if (memo.has(id)) return memo.get(id); const v = id - 12 >= first ? est(id - 12) * (1 + g) : avg12; memo.set(id, v); return v; }; return est; };
  const trend = estimator(growth), flat = estimator(0);
  const sumOver = (est, from, to) => { let s = 0; for (let id = from; id <= to; id++) s += est(id); return s; };
  const pct1 = v => `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

  let target = I.periods.find(p => p.g === 'm' && p.kind !== 'all' && p.to >= latest);
  if (!target) target = P.months((latestYear + 1) * 12, (latestYear + 1) * 12 + 11, String(latestYear + 1), 'future');
  // "this year" / "2026" in a forecast means the full calendar year, not year-to-date
  if (target.kind === 'ytd') target = P.months(target.from, Math.floor(target.from / 12) * 12 + 11, String(Math.floor(target.from / 12)), 'year');
  if (target.from > latest + 36) return say(`That is too far ahead to project from ${complete.length} months of history. I can estimate up to ${latestYear + 3}.`, `Dat is te ver vooruit om te schatten op basis van ${complete.length} maanden historie. Ik kan tot ${latestYear + 3} schatten.`);
  const label = target.label.replace(' YTD', '');
  const a = sumOver(trend, target.from, target.to), b = sumOver(flat, target.from, target.to);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const invoiced = (() => { let s = 0; for (let id = target.from; id <= Math.min(target.to, latest - 1); id++) s += actual.get(id) || 0; return s; })();
  const lines = [say(`**${label} ${what} estimate: about ${fmt(a)}**`, `**Schatting ${what} ${label}: ongeveer ${fmt(a)}**`) + (Math.abs(hi - lo) > 1 ? say(` (range ${fmt(lo)} – ${fmt(hi)})`, ` (bandbreedte ${fmt(lo)} – ${fmt(hi)})`) : '')];
  if (invoiced > 0) lines.push(say(`Of this, ${fmt(invoiced)} is already invoiced in complete months; the rest is estimated.`, `Hiervan is ${fmt(invoiced)} al gefactureerd in volledige maanden; de rest is geschat.`));
  if (enough) lines.push(say(`Method: each month = the same month a year earlier × recent year-over-year growth of ${pct1(growth)} (${rangeLabel(pairs[0], pairs[pairs.length - 1])} vs the same months a year before). The other end of the range assumes no growth.`, `Methode: elke maand = dezelfde maand een jaar eerder × recente groei jaar-op-jaar van ${pct1(growth)} (${rangeLabel(pairs[0], pairs[pairs.length - 1])} t.o.v. dezelfde maanden een jaar eerder). Het andere uiterste gaat uit van geen groei.`));
  else lines.push(say('Method: there is not enough history for a growth rate yet, so this repeats the same months of last year (or the 12-month average).', 'Methode: er is nog te weinig historie voor een groeicijfer, dus dit herhaalt dezelfde maanden van vorig jaar (of het 12-maands gemiddelde).'));
  if (target.from > latest && Math.floor(target.from / 12) > latestYear) {
    const y = latestYear * 12;
    lines.push(say(`For reference, ${latestYear} is heading for about ${fmt(sumOver(trend, y, y + 11))} (${fmt(sumOver(trend, y, latest - 1))} invoiced through ${monthLabel(latest - 1)}).`, `Ter vergelijking: ${latestYear} komt uit op ongeveer ${fmt(sumOver(trend, y, y + 11))} (${fmt(sumOver(trend, y, latest - 1))} gefactureerd t/m ${monthLabel(latest - 1)}).`));
  }
  if (target.from === target.to && target.from === latest && env.d.projectedMTD) lines.push(say(`The dashboard's own projection for ${monthLabel(latest)} (invoiced + open orders) is ${money(env.d.projectedMTD)}.`, `De eigen prognose van het dashboard voor ${monthLabel(latest)} (gefactureerd + open orders) is ${money(env.d.projectedMTD)}.`));
  lines.push(say(`This is a simple trend projection from ${complete.length} complete months — it does not know about open orders, pricing or market changes.`, `Dit is een eenvoudige trendprojectie op basis van ${complete.length} volledige maanden — zonder kennis van open orders, prijzen of marktveranderingen.`));
  return lines.join('\n');
}

/* ════════════════════════════════════════════════════════════════════════
   SALES
   ════════════════════════════════════════════════════════════════════════ */
function footer(env, p) {
  const { say } = env;
  let s = `\n${say('Period', 'Periode')}: ${p.label}`;
  if (isPartial(p, env)) s += say(` · ${monthLabel(env.latest)} is incomplete (invoices through ${env.through})`, ` · ${monthLabel(env.latest)} is onvolledig (facturen t/m ${env.through})`);
  return s;
}
const metricOf = I => I.has('metric', 'orders') ? 'orders' : I.has('metric', 'qty') ? 'qty' : 'rev';
const metricName = (env, m) => m === 'rev' ? env.say('revenue', 'omzet') : m === 'orders' ? env.say('orders', 'orders') : env.say('quantity', 'hoeveelheid');
const fmtMetric = (m, v) => m === 'rev' ? money(v) : num(v);
const typeWord = (env, type, one) => TYPE_WORDS[type][env.lang][one ? 1 : 0];

function salesAnswer(env, I) {
  const { say } = env;
  if (!env.monthIds.length) return [say('Sales data is not loaded yet.', 'Verkoopgegevens zijn nog niet geladen.'), 'general'];
  const compareLike = I.op('compare') || I.op('growth') || I.has('time', 'yoy');
  let periods = I.periods;
  const missing = periods.find(p => p.missing);
  if (missing) return [say(`There is no data for ${missing.label}. Weekly data covers ${env.weeks[0]?.w} – ${env.weeks[env.weeks.length - 1]?.w}.`, `Er zijn geen gegevens voor ${missing.label}. Weekgegevens lopen van ${env.weeks[0]?.w} t/m ${env.weeks[env.weeks.length - 1]?.w}.`), 'revenue'];
  const p = periods[0] || P.all(env);
  const ents = I.ents.filter(e => SALES_TYPES.includes(e.type));
  const dims = I.dims.filter(t => SALES_TYPES.includes(t.v));
  const wantsChannels = I.dims.some(t => t.v === 'channels') || I.has('chan');
  const entTypes = [...new Set(ents.map(e => e.type))];
  const topicOf = () => entTypes[0] || dims[0]?.v || (wantsChannels ? 'channels' : 'revenue');

  // sales rep × category (the only cross-table the dashboard has)
  const repSide = ents.some(e => e.type === 'salesreps') || dims.some(t => t.v === 'salesreps');
  const catSide = ents.some(e => e.type === 'categories') || dims.some(t => t.v === 'categories');
  const others = entTypes.filter(t => t !== 'salesreps' && t !== 'categories').length + dims.filter(t => t.v !== 'salesreps' && t.v !== 'categories').length;
  if (repSide && catSide && !others) return [repCategory(env, I, p), 'salesreps'];

  // anything else that needs two tables joined does not exist in the data — say so instead of guessing
  const involved = [...new Set([...entTypes, ...dims.map(t => t.v)])];
  if (involved.length > 1) {
    const names = involved.map(t => typeWord(env, t)).join(say(' and ', ' en '));
    let msg = say(`The dashboard data does not link ${names} to each other (only sales reps × categories are linked), so I can't break that down.`, `De dashboardgegevens koppelen ${names} niet aan elkaar (alleen verkopers × categorieën), dus die uitsplitsing is er niet.`);
    if (ents.length === 1) msg += '\n\n' + entitySummary(env, I, ents[0], p);
    return [msg, topicOf()];
  }
  if (wantsChannels && !ents.length && !dims.length) return [channelAnswer(env, I, p), 'channels'];

  if (ents.length === 1) {
    if (compareLike) { const pair = comparePair(env, I); if (pair) return [compareText(env, I, pair, selOf(ents[0]), ents[0].name), topicOf()]; }
    if (I.op('trend') || I.gran('month')) return [entityTrend(env, I, ents[0], p), topicOf()];
    return [entitySummary(env, I, ents[0], p), topicOf()];
  }
  if (ents.length > 1) return [entitiesSideBySide(env, I, ents, p), topicOf()];

  if (dims.length === 1) {
    const type = dims[0].v;
    if (compareLike && (periods.length >= 2 || I.has('time', 'yoy') || (periods.length === 1 && !I.op('top') && !I.nums.length))) {
      const pair = comparePair(env, I);
      if (pair) return [rankingCompare(env, I, type, pair), type];
    }
    if (I.op('count')) return [countAnswer(env, I, type, p), type];
    if (I.op('share') && !(dims[0].one && I.op('top'))) return [shareAnswer(env, I, type, p), type];
    if (I.op('avg')) return [averagePerMember(env, I, type, p), type];
    if (I.op('trend') && !I.op('top') && !I.op('bottom')) return [dimTrend(env, I, type, p), type];
    if (I.op('total') && !I.op('top') && !I.op('bottom') && !I.nums.length) return [dimTotal(env, I, type, p), type];
    return [ranking(env, I, type, p, dims[0].one), type];
  }

  // company level
  if (compareLike) { const pair = comparePair(env, I); if (pair) return [compareText(env, I, pair, null, null), 'revenue']; }
  const g = I.gran();
  if ((I.op('top') || I.op('bottom')) && g) return [bestPeriods(env, I, g, p), 'revenue'];
  if (I.op('top') || I.op('bottom')) return [leaders(env, I, p), 'revenue'];
  if (I.has('metric', 'aov')) { const m = measure(env, p); return [say(`Average order value: **${money(m.orders ? m.rev / m.orders : 0)}** (${money(m.rev)} / ${fmtInt(m.orders)} orders)`, `Gemiddelde orderwaarde: **${money(m.orders ? m.rev / m.orders : 0)}** (${money(m.rev)} / ${fmtInt(m.orders)} orders)`) + footer(env, p), 'revenue']; }
  if (I.op('avg')) return [averagePerPeriod(env, I, g?.v || 'month', p), 'revenue'];
  if (p.kind === 'thismonth' && !I.op('total') && !I.op('count')) return [monthToDate(env), 'revenue'];
  if (g && (g.v === 'quarter' || g.v === 'year')) return [bestPeriods(env, I, g, p, true), 'revenue'];
  if (I.op('trend') || g) return [g?.v === 'week' ? weekSeries(env, I, p) : g?.v === 'day' ? daySeries(env, I, p) : monthSeries(env, I, periods.length ? p : null), 'revenue'];
  return [totalAnswer(env, I, p), 'revenue'];
}
const selOf = e => ({ type: e.type, names: new Set(e.names) });

function totalAnswer(env, I, p) {
  const { say } = env;
  const m = measure(env, p);
  if (p.g === 'd' && !m.count) {
    const last = env.days[env.days.length - 1];
    return say(`No invoices are recorded for ${p.label}.`, `Er zijn geen facturen geboekt voor ${p.label}.`) + (last ? say(` The latest day in the data is ${last.label}: **${money(last.rev)}** (${fmtInt(last.orders)} orders).`, ` De laatste dag in de gegevens is ${last.label}: **${money(last.rev)}** (${fmtInt(last.orders)} orders).`) : '');
  }
  if (!m.count) return say(`There is no sales data for ${p.label}. Data covers ${monthLabel(env.first)} – ${monthLabel(env.latest)}.`, `Er zijn geen verkoopgegevens voor ${p.label}. Gegevens lopen van ${monthLabel(env.first)} t/m ${monthLabel(env.latest)}.`);
  const metric = metricOf(I);
  if (metric === 'qty') return say('Quantity is only available per product or sales rep — try "top 5 products by quantity".', 'Hoeveelheid is alleen per product of verkoper beschikbaar — probeer "top 5 producten op hoeveelheid".');
  const head = metric === 'orders'
    ? say(`Orders: **${fmtInt(m.orders)}** · revenue ${money(m.rev)}`, `Orders: **${fmtInt(m.orders)}** · omzet ${money(m.rev)}`)
    : say(`Revenue: **${money(m.rev)}** · ${fmtInt(m.orders)} orders · avg order ${money(m.orders ? m.rev / m.orders : 0)}`, `Omzet: **${money(m.rev)}** · ${fmtInt(m.orders)} orders · gem. order ${money(m.orders ? m.rev / m.orders : 0)}`);
  return head + footer(env, p);
}

function monthToDate(env) {
  const { say, d, latest } = env;
  const cur = measure(env, P.months(latest, latest)), prev = measure(env, P.months(latest - 1, latest - 1)), ly = measure(env, P.months(latest - 12, latest - 12));
  const lines = [say(`**${monthLabel(latest)} so far: ${money(cur.rev)}** from ${fmtInt(cur.orders)} orders (invoices through ${env.through}).`, `**${monthLabel(latest)} tot nu toe: ${money(cur.rev)}** uit ${fmtInt(cur.orders)} orders (facturen t/m ${env.through}).`)];
  if (d.projectedMTD) lines.push(say(`Projected for the month incl. open orders: ${money(d.projectedMTD)} — ${pct(d.turnoverMTD ?? cur.rev, d.projectedMTD)} already invoiced.`, `Prognose voor de maand incl. open orders: ${money(d.projectedMTD)} — ${pct(d.turnoverMTD ?? cur.rev, d.projectedMTD)} al gefactureerd.`));
  lines.push(say(`Last month (${monthLabel(latest - 1)}): ${money(prev.rev)}`, `Vorige maand (${monthLabel(latest - 1)}): ${money(prev.rev)}`) + (ly.count ? say(` · same month last year (${monthLabel(latest - 12)}): ${money(ly.rev)}`, ` · zelfde maand vorig jaar (${monthLabel(latest - 12)}): ${money(ly.rev)}`) : ''));
  const w = env.weeks.slice(-3);
  if (w.length) lines.push(say('Recent weeks: ', 'Recente weken: ') + w.map(x => `W${x.n} ${money(x.rev)}`).join(' · '));
  lines.push(say('The month is incomplete, so it is not yet comparable with full months.', 'De maand is onvolledig en dus nog niet vergelijkbaar met volledige maanden.'));
  return lines.join('\n');
}

function monthSeries(env, I, p) {
  const { say } = env;
  const period = p || P.months(Math.max(env.first, env.latest - 11), env.latest, rangeLabel(Math.max(env.first, env.latest - 11), env.latest));
  if (period.g === 'w') return weekSeries(env, I, period);
  if (period.g === 'd') return daySeries(env, I, period);
  const metric = metricOf(I) === 'orders' ? 'orders' : 'rev';
  const rows = baseFor(env, period).sort((a, b) => a.id - b.id);
  if (!rows.length) return totalAnswer(env, I, period);
  if (rows.length === 1) {
    const prev = measure(env, P.months(rows[0].id - 1, rows[0].id - 1)), ly = measure(env, P.months(rows[0].id - 12, rows[0].id - 12));
    return `**${rows[0].m}: ${fmtMetric(metric, rows[0][metric])}**` + (prev.count ? say(`\nvs ${monthLabel(rows[0].id - 1)}: ${fmtMetric(metric, prev[metric])} (${delta(rows[0][metric], prev[metric])})`, `\nt.o.v. ${monthLabel(rows[0].id - 1)}: ${fmtMetric(metric, prev[metric])} (${delta(rows[0][metric], prev[metric])})`) : '') + (ly.count ? say(`\nvs ${monthLabel(rows[0].id - 12)}: ${fmtMetric(metric, ly[metric])} (${delta(rows[0][metric], ly[metric])})`, `\nt.o.v. ${monthLabel(rows[0].id - 12)}: ${fmtMetric(metric, ly[metric])} (${delta(rows[0][metric], ly[metric])})`) : '') + footer(env, period);
  }
  const shown = rows.slice(-24);
  const body = shown.map((r, i) => `${r.m}: **${fmtMetric(metric, r[metric])}**${i ? ` (${delta(r[metric], shown[i - 1][metric])})` : ''}`).join('\n');
  const complete = rows.filter(r => r.id < env.latest);
  const best = [...complete].sort((a, b) => b[metric] - a[metric])[0], worst = [...complete].sort((a, b) => a[metric] - b[metric])[0];
  const tail = best && worst && complete.length > 2 ? say(`\nHighest: ${best.m} (${fmtMetric(metric, best[metric])}) · lowest: ${worst.m} (${fmtMetric(metric, worst[metric])})`, `\nHoogste: ${best.m} (${fmtMetric(metric, best[metric])}) · laagste: ${worst.m} (${fmtMetric(metric, worst[metric])})`) : '';
  return say(`Monthly ${metricName(env, metric)} (change vs previous month):\n`, `Maandelijkse ${metricName(env, metric)} (verandering t.o.v. vorige maand):\n`) + body + `\n${say('Total', 'Totaal')}: ${fmtMetric(metric, sumBy(rows, metric))}` + tail + footer(env, period);
}
function weekSeries(env, I, p) {
  const { say } = env;
  const metric = metricOf(I) === 'orders' ? 'orders' : 'rev';
  const rows = p.g === 'w' ? baseFor(env, p) : env.weeks.slice(-8);
  if (!rows.length) return say('Weekly data is not available.', 'Wekelijkse gegevens zijn niet beschikbaar.');
  if (rows.length === 1) return `${weekLabel(rows[0], say)}: **${fmtMetric(metric, rows[0][metric])}** · ${fmtInt(rows[0].orders)} orders`;
  return say(`Weekly ${metricName(env, metric)}:\n`, `Wekelijkse ${metricName(env, metric)}:\n`) + rows.map(w => `W${w.n} (${w.start}): **${fmtMetric(metric, w[metric])}**`).join('\n') + say(`\nTotal: ${fmtMetric(metric, sumBy(rows, metric))} · the latest week may be incomplete`, `\nTotaal: ${fmtMetric(metric, sumBy(rows, metric))} · de laatste week kan onvolledig zijn`);
}
function daySeries(env, I, p) {
  const { say } = env;
  const metric = metricOf(I) === 'orders' ? 'orders' : 'rev';
  const rows = p.g === 'd' ? baseFor(env, p) : env.days.slice(-10);
  if (!rows.length) return totalAnswer(env, I, p.g === 'd' ? p : { g: 'd', isos: [env.today], label: isoLabel(env.today) });
  return say(`Daily ${metricName(env, metric)}:\n`, `Dagelijkse ${metricName(env, metric)}:\n`) + rows.map(x => `${x.label}: **${fmtMetric(metric, x[metric])}**`).join('\n') + `\n${say('Total', 'Totaal')}: ${fmtMetric(metric, sumBy(rows, metric))}`;
}

function bestPeriods(env, I, g, p, chrono = false) {
  const { say } = env;
  const metric = metricOf(I) === 'orders' ? 'orders' : 'rev';
  const asc = I.op('bottom');
  const single = /^(month|maand|week|day|dag|quarter|kwartaal|year|jaar)$/.test(g.phrase || '');
  const n = I.nums[0] ?? (single ? 1 : 5);
  let rows, unit, note = '';
  if (g.v === 'week') { rows = (p.g === 'w' ? baseFor(env, p) : env.weeks.slice(0, -1)).map(w => ({ name: `W${w.n} (${w.start})`, rev: w.rev, orders: w.orders })); unit = say('week', 'week'); note = p.g === 'w' ? '' : say(' (current week excluded)', ' (lopende week niet meegeteld)'); }
  else if (g.v === 'day') { rows = (p.g === 'd' ? baseFor(env, p) : env.days).map(x => ({ name: x.label, rev: x.rev, orders: x.orders })); unit = say('day', 'dag'); }
  else {
    const keepPartial = chrono || p.kind === 'thismonth';
    const months = baseFor(env, p.g === 'm' || p.g === 'all' ? p : P.all(env)).filter(r => r.id < env.latest || keepPartial);
    note = keepPartial ? (isPartial(p, env) ? say(` (${monthLabel(env.latest)} is incomplete, so the latest ${g.v} is not final)`, ` (${monthLabel(env.latest)} is onvolledig, dus de laatste periode is niet definitief)`) : '') : isPartial(p, env) ? say(` (${monthLabel(env.latest)} excluded — incomplete)`, ` (${monthLabel(env.latest)} niet meegeteld — onvolledig)`) : '';
    if (g.v === 'quarter' || g.v === 'year') {
      const map = new Map();
      for (const r of months) { const key = g.v === 'year' ? String(Math.floor(r.id / 12)) : `Q${Math.floor((r.id % 12) / 3) + 1} ${Math.floor(r.id / 12)}`; const x = map.get(key) || map.set(key, { name: key, rev: 0, orders: 0 }).get(key); x.rev += r.rev; x.orders += r.orders; }
      rows = [...map.values()]; unit = g.v === 'year' ? say('year', 'jaar') : say('quarter', 'kwartaal');
    } else { rows = months.map(r => ({ name: r.m, rev: r.rev, orders: r.orders })); unit = say('month', 'maand'); }
  }
  if (!rows.length) return say('There is no data for that period.', 'Er zijn geen gegevens voor die periode.');
  const where = g.v === 'week' && p.g !== 'w' ? `${env.weeks[0]?.w} – ${env.weeks[env.weeks.length - 1]?.w}` : g.v === 'day' && p.g !== 'd' ? `${env.days[0]?.label} – ${env.days[env.days.length - 1]?.label}` : p.label;
  if (chrono) return say(`${metricName(env, metric)[0].toUpperCase() + metricName(env, metric).slice(1)} per ${unit}:\n`, `${metricName(env, metric)[0].toUpperCase() + metricName(env, metric).slice(1)} per ${unit}:\n`) + rows.slice(-24).map((r, i, a) => `${r.name}: **${fmtMetric(metric, r[metric])}**${i ? ` (${delta(r[metric], a[i - 1][metric])})` : ''}`).join('\n') + `\n${say('Period', 'Periode')}: ${where}${note}`;
  const sorted = [...rows].sort((a, b) => (asc ? 1 : -1) * (a[metric] - b[metric]));
  const top = sorted.slice(0, Math.max(1, Math.min(n, 24)));
  const title = asc ? say(`Lowest ${unit}`, `Laagste ${unit}`) : say(`Best ${unit}`, `Beste ${unit}`);
  const avg = sumBy(rows, metric) / rows.length;
  if (top.length === 1) return `${title}: **${top[0].name} — ${fmtMetric(metric, top[0][metric])}**` + (metric === 'rev' ? ` · ${fmtInt(top[0].orders)} orders` : '') + say(`\nAverage ${unit}: ${fmtMetric(metric, avg)}`, `\nGemiddelde ${unit}: ${fmtMetric(metric, avg)}`) + (sorted[1] ? say(` · next: ${sorted[1].name} (${fmtMetric(metric, sorted[1][metric])})`, ` · daarna: ${sorted[1].name} (${fmtMetric(metric, sorted[1][metric])})`) : '') + `\n${say('Period', 'Periode')}: ${where}${note}`;
  return `${title} — ${metricName(env, metric)}:\n` + top.map((r, i) => `${i + 1}. **${r.name}** — ${fmtMetric(metric, r[metric])}`).join('\n') + `\n${say('Period', 'Periode')}: ${where}${note}`;
}

function averagePerPeriod(env, I, gran, p) {
  const { say } = env;
  const metric = metricOf(I) === 'orders' ? 'orders' : 'rev';
  if (gran === 'week') { const rows = env.weeks.slice(0, -1); return say(`Average weekly ${metricName(env, metric)}: **${fmtMetric(metric, sumBy(rows, metric) / (rows.length || 1))}** over ${rows.length} complete weeks`, `Gemiddelde wekelijkse ${metricName(env, metric)}: **${fmtMetric(metric, sumBy(rows, metric) / (rows.length || 1))}** over ${rows.length} volledige weken`); }
  if (gran === 'day') { const rows = env.days; return say(`Average ${metricName(env, metric)} per invoicing day: **${fmtMetric(metric, sumBy(rows, metric) / (rows.length || 1))}** over ${rows.length} days`, `Gemiddelde ${metricName(env, metric)} per factuurdag: **${fmtMetric(metric, sumBy(rows, metric) / (rows.length || 1))}** over ${rows.length} dagen`); }
  const rows = baseFor(env, p.g === 'm' || p.g === 'all' ? p : P.all(env));
  const complete = rows.filter(r => r.id < env.latest);
  const use = complete.length ? complete : rows;
  const avg = sumBy(use, metric) / (use.length || 1);
  return say(`Average monthly ${metricName(env, metric)}: **${fmtMetric(metric, avg)}** over ${use.length} complete months`, `Gemiddelde maandelijkse ${metricName(env, metric)}: **${fmtMetric(metric, avg)}** over ${use.length} volledige maanden`)
    + (complete.length !== rows.length ? say(` (${monthLabel(env.latest)} left out because it is incomplete)`, ` (${monthLabel(env.latest)} niet meegeteld omdat die onvolledig is)`) : '')
    + `\n${say('Period', 'Periode')}: ${p.label}`;
}

function leaders(env, I, p) {
  const { say } = env;
  const asc = I.op('bottom');
  const lines = SALES_TYPES.map(type => {
    const g = group(rowsFor(env, type, p)).sort((a, b) => (asc ? 1 : -1) * (a.rev - b.rev));
    const total = g.reduce((s, x) => s + x.rev, 0);
    return g[0] ? `${typeWord(env, type, true)[0].toUpperCase()}${typeWord(env, type, true).slice(1)}: **${g[0].name}** — ${money(g[0].rev)} (${pct(g[0].rev, total)})` : null;
  }).filter(Boolean);
  if (!lines.length) return totalAnswer(env, I, p);
  return (asc ? say('Smallest contributors to revenue:\n', 'Kleinste bijdragen aan de omzet:\n') : say('Biggest contributors to revenue:\n', 'Grootste bijdragen aan de omzet:\n')) + lines.join('\n') + footer(env, p);
}

function ranking(env, I, type, p, one) {
  const { say } = env;
  const metric = metricOf(I);
  const asc = I.op('bottom');
  const groups = group(rowsFor(env, type, p));
  if (!groups.length) return say(`There are no ${typeWord(env, type)} with sales in ${p.label}.`, `Er zijn geen ${typeWord(env, type)} met verkopen in ${p.label}.`);
  if (metric === 'qty' && !groups.some(g => g.qty)) return say(`No quantities are recorded per ${typeWord(env, type, true)} for ${p.label}. Quantities exist for products and sales reps in earlier months — try "top 5 products by quantity in 2025".`, `Er zijn geen hoeveelheden vastgelegd per ${typeWord(env, type, true)} voor ${p.label}. Hoeveelheden bestaan voor producten en verkopers in eerdere maanden — probeer "top 5 producten op hoeveelheid in 2025".`);
  const n = Math.max(1, Math.min(50, I.nums[0] ?? (one ? 1 : I.op('more') ? 10 : I.op('compare') ? Math.min(8, groups.length) : 5)));
  const sorted = [...groups].sort((a, b) => (asc ? 1 : -1) * (a[metric] - b[metric]) || a.name.localeCompare(b.name));
  const total = groups.reduce((s, g) => s + g[metric], 0);
  const line = (g, i) => `${i + 1}. **${g.name}** — ${fmtMetric(metric, g[metric])}${metric !== 'qty' && total > 0 && g[metric] > 0 ? ` (${pct(g[metric], total)})` : ''}`;
  const dirWord = asc ? say('Bottom', 'Laagste') : 'Top';
  if (n === 1) {
    const g = sorted[0];
    return `${dirWord} ${typeWord(env, type, true)} — ${metricName(env, metric)}: **${g.name} — ${fmtMetric(metric, g[metric])}**${metric !== 'qty' && total > 0 && g[metric] > 0 ? say(` (${pct(g[metric], total)} of the total)`, ` (${pct(g[metric], total)} van het totaal)`) : ''}`
      + (sorted.length > 1 ? say('\nNext: ', '\nDaarna: ') + sorted.slice(1, 3).map((x, i) => `${i + 2}. ${x.name} ${fmtMetric(metric, x[metric])}`).join(' · ') : '') + footer(env, p);
  }
  const gap = n === 2 && sorted.length >= 2 && sorted[1][metric] > 0 ? say(`\n${sorted[0].name} is ${fmtMetric(metric, sorted[0][metric] - sorted[1][metric])} ahead — ${(sorted[0][metric] / sorted[1][metric]).toLocaleString('de-DE', { maximumFractionDigits: 1 })}× ${sorted[1].name}.`, `\n${sorted[0].name} ligt ${fmtMetric(metric, sorted[0][metric] - sorted[1][metric])} voor — ${(sorted[0][metric] / sorted[1][metric]).toLocaleString('de-DE', { maximumFractionDigits: 1 })}× ${sorted[1].name}.`) : '';
  return `${dirWord} ${Math.min(n, sorted.length)} ${typeWord(env, type)} — ${metricName(env, metric)}:\n` + sorted.slice(0, n).map(line).join('\n') + gap
    + say(`\nAll ${groups.length} ${typeWord(env, type)}: ${fmtMetric(metric, total)}`, `\nAlle ${groups.length} ${typeWord(env, type)}: ${fmtMetric(metric, total)}`) + footer(env, p);
}

function shareAnswer(env, I, type, p) {
  const { say } = env;
  const groups = group(rowsFor(env, type, p)).sort((a, b) => b.rev - a.rev);
  if (!groups.length) return say(`There are no ${typeWord(env, type)} with sales in ${p.label}.`, `Er zijn geen ${typeWord(env, type)} met verkopen in ${p.label}.`);
  const total = groups.reduce((s, g) => s + g.rev, 0);
  if (I.op('bottom')) {
    const n = Math.min(I.nums[0] ?? 5, groups.length);
    const tail = [...groups].filter(g => g.rev > 0).reverse().slice(0, n);
    return say(`${typeWord(env, type)[0].toUpperCase() + typeWord(env, type).slice(1)} with the smallest share of revenue (positive revenue only):\n`, `${typeWord(env, type)[0].toUpperCase() + typeWord(env, type).slice(1)} met het kleinste omzetaandeel (alleen positieve omzet):\n`)
      + tail.map((g, i) => `${i + 1}. **${g.name}** — ${money(g.rev)} (${pct(g.rev, total)})`).join('\n') + footer(env, p);
  }
  const n = Math.min(I.nums[0] ?? (groups.length <= 15 ? 3 : 5), groups.length);
  const cum = k => groups.slice(0, k).reduce((s, g) => s + g.rev, 0);
  const lines = [say(`The top ${n} ${typeWord(env, type)} bring in **${pct(cum(n), total)}** of revenue (${money(cum(n))} of ${money(total)}).`, `De top ${n} ${typeWord(env, type)} leveren **${pct(cum(n), total)}** van de omzet (${money(cum(n))} van ${money(total)}).`)];
  lines.push(...groups.slice(0, n).map((g, i) => `${i + 1}. **${g.name}** — ${money(g.rev)} (${pct(g.rev, total)})`));
  const extra = [10, 20, 50].filter(k => k > n && k < groups.length).map(k => `top ${k}: ${pct(cum(k), total)}`);
  if (extra.length) lines.push(say('Further: ', 'Verder: ') + extra.join(' · ') + say(` · ${groups.length} ${typeWord(env, type)} in total`, ` · ${groups.length} ${typeWord(env, type)} in totaal`));
  return lines.join('\n') + footer(env, p);
}

function averagePerMember(env, I, type, p) {
  const { say } = env;
  const metric = metricOf(I);
  const groups = group(rowsFor(env, type, p));
  if (!groups.length) return say(`There are no ${typeWord(env, type)} with sales in ${p.label}.`, `Er zijn geen ${typeWord(env, type)} met verkopen in ${p.label}.`);
  const total = groups.reduce((s, g) => s + g[metric], 0);
  const sorted = groups.map(g => g[metric]).sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return say(`Average ${metricName(env, metric)} per ${typeWord(env, type, true)}: **${fmtMetric(metric, total / groups.length)}** (${fmtMetric(metric, total)} across ${groups.length} ${typeWord(env, type)}).\nMedian: ${fmtMetric(metric, median)} — a few large ${typeWord(env, type)} pull the average up.`, `Gemiddelde ${metricName(env, metric)} per ${typeWord(env, type, true)}: **${fmtMetric(metric, total / groups.length)}** (${fmtMetric(metric, total)} over ${groups.length} ${typeWord(env, type)}).\nMediaan: ${fmtMetric(metric, median)} — enkele grote ${typeWord(env, type)} trekken het gemiddelde omhoog.`) + footer(env, p);
}

function countAnswer(env, I, type, p) {
  const { say, d } = env;
  const metric = metricOf(I);
  const groups = group(rowsFor(env, type, p));
  if (metric !== 'rev') return dimTotal(env, I, type, p);
  let s = say(`**${fmtInt(groups.length)} ${typeWord(env, type)}** with sales in the period.`, `**${fmtInt(groups.length)} ${typeWord(env, type)}** met verkopen in de periode.`);
  if (type === 'customers' && p.g === 'all' && d.totalClients && d.totalClients !== groups.length) s += say(` The dashboard KPI "total clients" shows ${fmtInt(d.totalClients)}.`, ` De dashboard-KPI "totaal klanten" toont ${fmtInt(d.totalClients)}.`);
  if (type === 'categories' || type === 'salesreps') s += '\n' + groups.sort((a, b) => b.rev - a.rev).map(g => g.name).join(', ');
  return s + footer(env, p);
}
function dimTotal(env, I, type, p) {
  const metric = metricOf(I);
  const rows = rowsFor(env, type, p);
  const groups = group(rows);
  return env.say(`Total ${metricName(env, metric)} across ${groups.length} ${typeWord(env, type)}: **${fmtMetric(metric, sumBy(rows, metric))}**`, `Totale ${metricName(env, metric)} over ${groups.length} ${typeWord(env, type)}: **${fmtMetric(metric, sumBy(rows, metric))}**`) + footer(env, p);
}

function dimTrend(env, I, type, p) {
  const { say } = env;
  const metric = metricOf(I) === 'orders' ? 'orders' : 'rev';
  const period = p.g === 'm' || p.g === 'all' ? p : P.all(env);
  const to = Math.min(period.to, env.latest), from = Math.max(period.from, to - 5);
  const rows = rowsFor(env, type, P.months(from, to));
  const top = group(rows).sort((a, b) => b[metric] - a[metric]).slice(0, I.nums[0] ?? 5);
  if (!top.length) return say(`There are no ${typeWord(env, type)} with sales in ${period.label}.`, `Er zijn geen ${typeWord(env, type)} met verkopen in ${period.label}.`);
  const ids = []; for (let id = from; id <= to; id++) ids.push(id);
  const cell = (name, id) => sumBy(rows.filter(r => String(r.n).trim() === name && monthId(r.m) === id), metric);
  return say(`Monthly ${metricName(env, metric)} per ${typeWord(env, type, true)} (top ${top.length}, ${rangeLabel(from, to)}):\n`, `Maandelijkse ${metricName(env, metric)} per ${typeWord(env, type, true)} (top ${top.length}, ${rangeLabel(from, to)}):\n`)
    + top.map(g => `**${g.name}**\n` + ids.map(id => `${MON[id % 12]} ${fmtMetric(metric, cell(g.name, id))}`).join(' · ')).join('\n')
    + say(`\n${monthLabel(env.latest)} is incomplete.`, `\n${monthLabel(env.latest)} is onvolledig.`);
}

function channelAnswer(env, I, p) {
  const { say } = env;
  const metric = metricOf(I) === 'orders' ? 'orders' : 'rev';
  const rows = rowsFor(env, 'salesreps', p);
  const web = rows.filter(r => String(r.n).trim() === 'Webshop'), direct = rows.filter(r => String(r.n).trim() !== 'Webshop');
  const w = sumBy(web, metric), dsum = sumBy(direct, metric), total = w + dsum;
  if (!rows.length) return say(`There is no sales data for ${p.label}.`, `Er zijn geen verkoopgegevens voor ${p.label}.`);
  const big = dsum >= w ? say('Direct sales', 'Directe verkoop') : 'Webshop';
  const lineD = `${say('Direct sales', 'Directe verkoop')}: **${fmtMetric(metric, dsum)}** (${pct(dsum, total)})`, lineW = `Webshop: **${fmtMetric(metric, w)}** (${pct(w, total)})`;
  if (I.has('chan') && !I.has('chan', 'direct')) return `${lineW}\n${lineD}` + footer(env, p);
  if (I.has('chan') && !I.has('chan', 'webshop')) return `${lineD}\n${lineW}` + footer(env, p);
  return say(`${big} is the larger channel.\n`, `${big} is het grootste kanaal.\n`) + `${lineD}\n${lineW}` + footer(env, p);
}

function entitySummary(env, I, e, p) {
  const { say } = env;
  const sel = selOf(e);
  const all = rowsFor(env, e.type, p);
  const rows = all.filter(r => sel.names.has(String(r.n).trim()));
  const kind = typeWord(env, e.type, true);
  if (!rows.length) {
    const any = (env.d[e.type] || []).some(r => sel.names.has(String(r.n).trim()));
    return any ? say(`**${e.name}** (${kind}) has no sales in ${p.label}.`, `**${e.name}** (${kind}) heeft geen verkopen in ${p.label}.`)
      : say(`**${e.name}** has no sales rows — it only appears in the receivables data. Try "open balance ${e.name}".`, `**${e.name}** heeft geen verkoopregels — alleen debiteurengegevens. Probeer "open saldo ${e.name}".`);
  }
  const rev = sumBy(rows, 'rev'), orders = sumBy(rows, 'orders'), qty = sumBy(rows, 'qty');
  const groups = group(all).sort((a, b) => b.rev - a.rev);
  const total = groups.reduce((s, g) => s + g.rev, 0);
  const rank = groups.findIndex(g => sel.names.has(g.name)) + 1;
  const lines = [`**${e.name}** (${kind})`, say(`Revenue: **${money(rev)}** · ${fmtInt(orders)} orders`, `Omzet: **${money(rev)}** · ${fmtInt(orders)} orders`) + (qty ? ` · ${say('qty', 'aantal')} ${num(qty)}` : '')];
  if (e.names.length > 1) lines.push(say('This name covers several records: ', 'Deze naam omvat meerdere records: ') + e.names.map(nm => `${nm} ${money(sumBy(rows.filter(r => String(r.n).trim() === nm), 'rev'))}`).join(' · '));
  if (total > 0) lines.push(say(`Rank #${rank} of ${groups.length} ${typeWord(env, e.type)} · ${pct(rev, total)} of revenue`, `Plaats #${rank} van ${groups.length} ${typeWord(env, e.type)} · ${pct(rev, total)} van de omzet`));
  if (p.g === 'm' || p.g === 'all') {
    const byMonth = new Map();
    for (const r of rows) byMonth.set(monthId(r.m), (byMonth.get(monthId(r.m)) || 0) + (Number(r.rev) || 0));
    const ids = [...byMonth.keys()].sort((a, b) => a - b);
    if (ids.length > 1) {
      const best = ids.reduce((a, b) => byMonth.get(b) > byMonth.get(a) ? b : a);
      lines.push(say('Recent months: ', 'Recente maanden: ') + ids.slice(-3).map(id => `${monthLabel(id)} ${money(byMonth.get(id))}`).join(' · '));
      lines.push(say(`Best month: ${monthLabel(best)} (${money(byMonth.get(best))})`, `Beste maand: ${monthLabel(best)} (${money(byMonth.get(best))})`));
    }
  }
  return lines.join('\n') + footer(env, p);
}
function entityTrend(env, I, e, p) {
  const { say } = env;
  const metric = metricOf(I);
  const sel = selOf(e);
  const period = p.g === 'm' || p.g === 'all' ? p : P.all(env);
  const rows = rowsFor(env, e.type, period).filter(r => sel.names.has(String(r.n).trim()));
  if (!rows.length) return entitySummary(env, I, e, p);
  const byMonth = new Map();
  for (const r of rows) byMonth.set(monthId(r.m), (byMonth.get(monthId(r.m)) || 0) + (Number(r[metric]) || 0));
  const ids = [...byMonth.keys()].sort((a, b) => a - b).slice(-18);
  return `**${e.name}** — ${say('monthly', 'maandelijkse')} ${metricName(env, metric)}:\n` + ids.map(id => `${monthLabel(id)}: **${fmtMetric(metric, byMonth.get(id))}**`).join('\n')
    + `\n${say('Total', 'Totaal')}: ${fmtMetric(metric, [...byMonth.values()].reduce((a, b) => a + b, 0))}` + footer(env, period);
}
function entitiesSideBySide(env, I, ents, p) {
  const { say } = env;
  const type = ents[0].type;
  const all = rowsFor(env, type, p);
  const total = sumBy(all, 'rev');
  const stats = ents.map(e => { const s = selOf(e); const rows = all.filter(r => s.names.has(String(r.n).trim())); return { name: e.name, rev: sumBy(rows, 'rev'), orders: sumBy(rows, 'orders') }; }).sort((a, b) => b.rev - a.rev);
  const lines = stats.map(s => `**${s.name}** — ${money(s.rev)} · ${fmtInt(s.orders)} orders · ${pct(s.rev, total)} ${say('of revenue', 'van de omzet')}`);
  if (stats.length === 2 && stats[1].rev > 0) lines.push(say(`${stats[0].name} is ${money(stats[0].rev - stats[1].rev)} ahead (${(stats[0].rev / stats[1].rev).toLocaleString('de-DE', { maximumFractionDigits: 1 })}× ${stats[1].name}).`, `${stats[0].name} ligt ${money(stats[0].rev - stats[1].rev)} voor (${(stats[0].rev / stats[1].rev).toLocaleString('de-DE', { maximumFractionDigits: 1 })}× ${stats[1].name}).`));
  return lines.join('\n') + footer(env, p);
}

/* compare two periods */
function comparePair(env, I) {
  const ps = I.periods;
  const yoy = I.has('time', 'yoy');
  if (ps.length >= 2) {
    let [a, b] = ps;
    if (a.g !== b.g) return null;
    if (a.g === 'm' && a.from < b.from) [a, b] = [b, a];           // newest first
    if (a.kind === 'ytd' && (b.kind === 'year' || b.kind === 'prevyear') && b.to - b.from === 11) b = yearBefore(a, env);
    return [a, b];
  }
  if (ps.length === 1) {
    const p = ps[0];
    if (p.g === 'all') return null;
    if (yoy && p.g === 'm') return [p.to > env.latest ? P.months(p.from, env.latest, p.label, p.kind) : p, yearBefore(p, env)];
    if (p.kind === 'prevyear') { const cur = P.months(env.latestYear * 12, env.latest, `${env.latestYear} YTD`, 'ytd'); return [cur, yearBefore(cur, env)]; }
    if (p.kind === 'prev' && p.g === 'm' && p.from === p.to && p.to === env.latest - 1) return [P.months(env.latest, env.latest, monthLabel(env.latest), 'thismonth'), p];
    if (p.kind === 'prev' && p.g === 'w') { const w = env.weeks[env.weeks.length - 1]; return [{ g: 'w', keys: [w.w], label: weekLabel(w, env.say), kind: 'thisweek' }, p]; }
    if (p.kind === 'prev' && p.g === 'd' && p.isos.length === 1) return [{ g: 'd', isos: [env.today], label: isoLabel(env.today), kind: 'today' }, p];
    const prev = previousOf(p, env);
    return prev ? [p, prev] : null;
  }
  if (I.ents.length > 1) return null;
  if (yoy || I.gran('year')) { const cur = P.months(env.latestYear * 12, env.latest, `${env.latestYear} YTD`, 'ytd'); return [cur, yearBefore(cur, env)]; }
  if (I.dims.length && !I.op('growth')) return null;
  // no period given → last complete month vs the month before
  return [P.months(env.latest - 1, env.latest - 1, monthLabel(env.latest - 1)), P.months(env.latest - 2, env.latest - 2, monthLabel(env.latest - 2))];
}
function compareText(env, I, [a, b], sel, name) {
  const { say } = env;
  const A = measure(env, a, sel), B = measure(env, b, sel);
  const lines = [];
  if (name) lines.push(`**${name}**`);
  if (!A.count && !B.count) return say(`There is no data for ${a.label} or ${b.label}.`, `Er zijn geen gegevens voor ${a.label} of ${b.label}.`);
  lines.push(`${a.label}: **${money(A.rev)}** · ${fmtInt(A.orders)} orders`);
  lines.push(`${b.label}: **${money(B.rev)}** · ${fmtInt(B.orders)} orders`);
  lines.push(say(`Change: **${delta(A.rev, B.rev)}** revenue (${A.rev - B.rev >= 0 ? '+' : '-'}${money(Math.abs(A.rev - B.rev))}) · ${delta(A.orders, B.orders)} orders`, `Verschil: **${delta(A.rev, B.rev)}** omzet (${A.rev - B.rev >= 0 ? '+' : '-'}${money(Math.abs(A.rev - B.rev))}) · ${delta(A.orders, B.orders)} orders`));
  if (a.g === 'm' && isPartial(a, env) && !(b.g === 'm' && a.to - a.from === b.to - b.from && a.kind === 'ytd')) {
    lines.push(say(`${monthLabel(env.latest)} is incomplete (invoices through ${env.through}), so this is not yet a like-for-like comparison.`, `${monthLabel(env.latest)} is onvolledig (facturen t/m ${env.through}), dus dit is nog geen gelijke vergelijking.`));
  } else if (a.g === 'm' && isPartial(a, env)) lines.push(say(`Same months compared; ${monthLabel(env.latest)} is incomplete.`, `Zelfde maanden vergeleken; ${monthLabel(env.latest)} is onvolledig.`));
  return lines.join('\n');
}
function rankingCompare(env, I, type, [a, b]) {
  const { say } = env;
  const ga = group(rowsFor(env, type, a)).sort((x, y) => y.rev - x.rev);
  const gb = new Map(group(rowsFor(env, type, b)).map(g => [g.name, g.rev]));
  const n = Math.min(I.nums[0] ?? 5, ga.length);
  if (!ga.length) return say(`There are no ${typeWord(env, type)} with sales in ${a.label}.`, `Er zijn geen ${typeWord(env, type)} met verkopen in ${a.label}.`);
  return say(`Top ${n} ${typeWord(env, type)} — ${a.label} vs ${b.label}:\n`, `Top ${n} ${typeWord(env, type)} — ${a.label} vs ${b.label}:\n`)
    + ga.slice(0, n).map((g, i) => `${i + 1}. **${g.name}** — ${money(g.rev)} vs ${money(gb.get(g.name) || 0)} (${delta(g.rev, gb.get(g.name) || 0)})`).join('\n')
    + (isPartial(a, env) ? say(`\n${monthLabel(env.latest)} is incomplete.`, `\n${monthLabel(env.latest)} is onvolledig.`) : '');
}

/* sales rep × category */
function repCategory(env, I, p) {
  const { say, d } = env;
  const src = d.salesmanCategorySales || [];
  if (!src.length) return say('The sales rep × category table is not available.', 'De tabel verkoper × categorie is niet beschikbaar.');
  const ids = src.flatMap(r => (r.monthly || []).map(x => monthId(x.m))).filter(Number.isFinite);
  const cover = ids.length ? rangeLabel(Math.min(...ids), Math.max(...ids)) : '';
  const usePeriod = p.g === 'm' && p.kind !== 'all';
  const val = r => usePeriod ? (r.monthly || []).filter(x => { const id = monthId(x.m); return id >= p.from && id <= p.to; }).reduce((s, x) => ({ rev: s.rev + (x.rev || 0), qty: s.qty + (x.qty || 0), orders: s.orders + (x.orders || 0) }), { rev: 0, qty: 0, orders: 0 }) : { rev: r.rev || 0, qty: r.qty || 0, orders: r.orders || 0 };
  const rows = src.map(r => ({ rep: String(r.salesman).trim(), cat: String(r.category).trim(), ...val(r) }));
  const rep = I.ents.find(e => e.type === 'salesreps'), cat = I.ents.find(e => e.type === 'categories');
  const foot = `\n${say('Period', 'Periode')}: ${usePeriod ? p.label : cover}${say(' · this table covers ', ' · deze tabel dekt ')}${cover}`;
  const n = I.nums[0];
  if (rep && cat) {
    const hit = rows.filter(r => rep.names.includes(r.rep) && cat.names.includes(r.cat));
    if (!hit.length) return say(`${rep.name} has no sales in ${cat.name}.`, `${rep.name} heeft geen verkopen in ${cat.name}.`) + foot;
    const repTotal = sumBy(rows.filter(r => rep.names.includes(r.rep)), 'rev');
    return `**${rep.name} × ${cat.name}**\n${say('Revenue', 'Omzet')}: **${money(sumBy(hit, 'rev'))}** · ${fmtInt(sumBy(hit, 'orders'))} orders · ${say('qty', 'aantal')} ${num(sumBy(hit, 'qty'))}\n${pct(sumBy(hit, 'rev'), repTotal)} ${say(`of ${rep.name}'s revenue`, `van de omzet van ${rep.name}`)}` + foot;
  }
  if (rep) {
    const hit = rows.filter(r => rep.names.includes(r.rep)).sort((a, b) => b.rev - a.rev);
    if (!hit.length) return say(`There is no category breakdown for ${rep.name}.`, `Er is geen categorie-uitsplitsing voor ${rep.name}.`) + foot;
    const total = sumBy(hit, 'rev');
    return `**${rep.name}** — ${say('by category', 'per categorie')}:\n` + hit.slice(0, n ?? 10).map((r, i) => `${i + 1}. ${r.cat} — **${money(r.rev)}** (${pct(r.rev, total)})`).join('\n') + `\n${say('Total', 'Totaal')}: ${money(total)}` + foot;
  }
  if (cat) {
    const hit = rows.filter(r => cat.names.includes(r.cat)).sort((a, b) => b.rev - a.rev);
    if (!hit.length) return say(`There is no sales rep breakdown for ${cat.name}.`, `Er is geen verkoper-uitsplitsing voor ${cat.name}.`) + foot;
    const total = sumBy(hit, 'rev');
    return `**${cat.name}** — ${say('by sales rep', 'per verkoper')}:\n` + hit.slice(0, n ?? 10).map((r, i) => `${i + 1}. ${r.rep} — **${money(r.rev)}** (${pct(r.rev, total)})`).join('\n') + `\n${say('Total', 'Totaal')}: ${money(total)}` + foot;
  }
  const byRep = new Map();
  for (const r of rows) (byRep.get(r.rep) || byRep.set(r.rep, []).get(r.rep)).push(r);
  const reps = [...byRep.entries()].map(([name, list]) => ({ name, total: sumBy(list, 'rev'), list: list.sort((a, b) => b.rev - a.rev) })).filter(r => r.total > 0).sort((a, b) => b.total - a.total).slice(0, n ?? 6);
  return say('Sales by sales rep and category (top 3 categories each):\n', 'Verkoop per verkoper en categorie (top 3 categorieën):\n')
    + reps.map(r => `**${r.name}** — ${money(r.total)}\n` + r.list.slice(0, 3).map(c => `${c.cat} ${money(c.rev)} (${pct(c.rev, r.total)})`).join(' · ')).join('\n') + foot;
}

/* ════════════════════════════════════════════════════════════════════════
   TONNAGE
   ════════════════════════════════════════════════════════════════════════ */
function tonnageAnswer(env, I) {
  const { say, d } = env;
  const perRep = d.tonnagePerSalesman || [], perCat = d.totalTonnageByCategory || [];
  if (!perRep.length && !perCat.length) return say('Tonnage data is not available.', 'Tonnagegegevens zijn niet beschikbaar.');
  const p = I.periods.find(x => x.g === 'm' && x.kind !== 'all');
  const val = r => p ? (r.monthly || []).filter(x => { const id = monthId(x.m); return id >= p.from && id <= p.to; }).reduce((s, x) => ({ t: s.t + (x.tonnage || 0), rev: s.rev + (x.revenue || 0) }), { t: 0, rev: 0 }) : { t: r.tonnage || 0, rev: r.revenue || 0 };
  const ids = perCat.flatMap(r => (r.monthly || []).map(x => monthId(x.m))).filter(Number.isFinite);
  const foot = `\n${say('Period', 'Periode')}: ${p ? p.label : ids.length ? rangeLabel(Math.min(...ids), Math.max(...ids)) : '—'}${say(' · tonnage is tracked for feed and milk powder categories only', ' · tonnage wordt alleen bijgehouden voor voer- en melkpoedercategorieën')}`;
  const tons = v => `${num(v)} ${say('t', 'ton')}`;
  const rep = I.ents.find(e => e.type === 'salesreps'), cat = I.ents.find(e => e.type === 'categories');
  const asc = I.op('bottom'), n = I.nums[0] ?? 10;
  const repRows = perRep.map(r => ({ rep: String(r.salesman).trim(), cat: String(r.category).trim(), ...val(r) }));
  if (rep) {
    const hit = repRows.filter(r => rep.names.includes(r.rep) && (!cat || cat.names.includes(r.cat)));
    if (!hit.length) return say(`There is no tonnage for ${rep.name}${cat ? ` in ${cat.name}` : ''}.`, `Er is geen tonnage voor ${rep.name}${cat ? ` in ${cat.name}` : ''}.`) + foot;
    return `**${rep.name}${cat ? ` × ${cat.name}` : ''}**: **${tons(sumBy(hit, 't'))}** · ${money(sumBy(hit, 'rev'))}` + (!cat && hit.length > 1 ? '\n' + hit.sort((a, b) => b.t - a.t).map(r => `${r.cat}: ${tons(r.t)}`).join(' · ') : '') + foot;
  }
  if (cat && !I.dims.some(t => t.v === 'salesreps')) {
    const hit = perCat.filter(r => cat.names.includes(String(r.category).trim())).map(val);
    if (!hit.length) return say(`Tonnage is not tracked for ${cat.name}.`, `Tonnage wordt niet bijgehouden voor ${cat.name}.`) + foot;
    return `**${cat.name}**: **${tons(sumBy(hit, 't'))}** · ${money(sumBy(hit, 'rev'))}` + foot;
  }
  if (I.dims.some(t => t.v === 'salesreps') || cat) {
    const map = new Map();
    for (const r of repRows) if (!cat || cat.names.includes(r.cat)) map.set(r.rep, (map.get(r.rep) || 0) + r.t);
    const sorted = [...map.entries()].sort((a, b) => (asc ? 1 : -1) * (a[1] - b[1]));
    const total = sorted.reduce((s, x) => s + x[1], 0);
    return say(`Sales reps by tonnage${cat ? ` — ${cat.name}` : ''}:\n`, `Verkopers op tonnage${cat ? ` — ${cat.name}` : ''}:\n`) + sorted.slice(0, n).map(([name, t], i) => `${i + 1}. **${name}** — ${tons(t)} (${pct(t, total)})`).join('\n') + `\n${say('Total', 'Totaal')}: ${tons(total)}` + foot;
  }
  const cats = perCat.map(r => ({ name: String(r.category).trim(), ...val(r) })).sort((a, b) => (asc ? 1 : -1) * (a.t - b.t));
  const total = sumBy(cats, 't');
  return say(`Total tonnage: **${tons(total)}**\n`, `Totale tonnage: **${tons(total)}**\n`) + cats.map(c => `${c.name}: **${tons(c.t)}** (${pct(c.t, total)}) · ${money(c.rev)}`).join('\n') + foot;
}

/* ════════════════════════════════════════════════════════════════════════
   OPEN ORDERS / MTD
   ════════════════════════════════════════════════════════════════════════ */
function openOrdersAnswer(env, I) {
  const { say, d } = env;
  if (d.openOrderValuePresent == null) return say('Open order data is not available.', 'Open ordergegevens zijn niet beschikbaar.');
  const lines = [
    say(`Open order value as of ${d.lastUpdated}: **${money((d.openOrderValuePresent || 0) + (d.openOrderValueFuture || 0))}**`, `Openstaande orderwaarde per ${d.lastUpdated}: **${money((d.openOrderValuePresent || 0) + (d.openOrderValueFuture || 0))}**`),
    say(`Present (due now): **${money(d.openOrderValuePresent)}**`, `Huidig (nu leverbaar): **${money(d.openOrderValuePresent)}**`),
    say(`Future (not yet due): **${money(d.openOrderValueFuture || 0)}**`, `Toekomstig (nog niet vervallen): **${money(d.openOrderValueFuture || 0)}**`),
    say(`Counted in this month's projection: ${money(d.openOrderValueMTD || 0)}`, `Meegeteld in de prognose van deze maand: ${money(d.openOrderValueMTD || 0)}`),
  ];
  if (I.op('count') || I.dims.length || I.ents.length || I.has('debtor', 'oldest') || I.op('top'))
    lines.push(say('The dashboard only holds these open-order totals — there is no count or split per customer, product or order.', 'Het dashboard bevat alleen deze totalen — geen aantal of uitsplitsing per klant, product of order.'));
  return lines.join('\n');
}
function mtdAnswer(env) {
  const { say, d } = env;
  if (d.projectedMTD == null || d.turnoverMTD == null) return monthToDate(env);
  return [
    say(`Month to date (${monthLabel(env.latest)}, as of ${d.lastUpdated}):`, `Maand tot heden (${monthLabel(env.latest)}, per ${d.lastUpdated}):`),
    say(`Actual invoiced: **${money(d.turnoverMTD)}**`, `Werkelijk gefactureerd: **${money(d.turnoverMTD)}**`),
    say(`Open orders for this month: ${money(d.openOrderValueMTD || 0)}`, `Open orders voor deze maand: ${money(d.openOrderValueMTD || 0)}`),
    say(`Projected: **${money(d.projectedMTD)}** — ${pct(d.turnoverMTD, d.projectedMTD)} reached`, `Prognose: **${money(d.projectedMTD)}** — ${pct(d.turnoverMTD, d.projectedMTD)} behaald`),
  ].join('\n');
}

/* ════════════════════════════════════════════════════════════════════════
   ACCOUNTS RECEIVABLE
   ════════════════════════════════════════════════════════════════════════ */
function debtorAnswer(env, I) {
  const { say, d } = env;
  const k = d.debtorKPI;
  const custs = (d.debtorCustomers || []).map(c => ({ ...c, risk: debtorRisk(c), nonPayer: debtorNonPayer(c) }));
  if (!k && !custs.length) return say('Receivables data is not available.', 'Debiteurengegevens zijn niet beschikbaar.');
  const asOf = say(`as of ${d.debtorAsOf || '—'}`, `per ${d.debtorAsOf || '—'}`);
  const n = (() => { const free = I.nums.filter(v => ![30, 60, 90, 120, 180].includes(v)); return free[0]; })();
  const one = I.dims.some(t => t.v === 'customers' && t.one);
  const listN = n ?? (one ? 1 : 10);
  const total = k?.totalDebtorValue ?? sumBy(custs, 'openValue');
  const row = c => `**${c.name}** — ${money(c.openValue)} · ${say('oldest', 'oudste')} ${c.ageOfOldest ?? '?'} ${say('days', 'dagen')} · ${say('risk', 'risico')} ${c.risk}`;

  // one named customer
  const ent = I.ents.find(e => e.type === 'customers');
  if (ent) {
    const c = custs.find(x => normalizeText(x.name) === ent.normalized);
    if (!c) return say(`**${ent.name}** has no open invoices ${asOf}.`, `**${ent.name}** heeft geen open facturen ${asOf}.`);
    const items = (d.debtorOpenItems || []).filter(x => normalizeText(x.name) === ent.normalized).sort((a, b) => (b.daysOutstanding || 0) - (a.daysOutstanding || 0));
    return [`**${c.name}** — ${say('receivables', 'debiteuren')} ${asOf}`,
      say(`Open balance: **${money(c.openValue)}** in ${c.openInvoices} invoice(s)`, `Open saldo: **${money(c.openValue)}** in ${c.openInvoices} factu(u)r(en)`),
      say(`Oldest invoice: ${c.oldestInvoice || '—'} (${c.ageOfOldest ?? '?'} days) · average days to pay: ${c.avgDaysToPay ?? '—'}`, `Oudste factuur: ${c.oldestInvoice || '—'} (${c.ageOfOldest ?? '?'} dagen) · gem. betaaldagen: ${c.avgDaysToPay ?? '—'}`),
      say(`Risk ${c.risk} · non-payer: ${c.nonPayer ? 'yes' : 'no'} · last payment: ${c.lastPayment || '—'}`, `Risico ${c.risk} · wanbetaler: ${c.nonPayer ? 'ja' : 'nee'} · laatste betaling: ${c.lastPayment || '—'}`),
      ...(items.length ? [say('Open invoices: ', 'Open facturen: ') + items.slice(0, 5).map(x => `${x.invoiceNr} ${money(x.openAmount)} (${x.daysOutstanding}d)`).join(' · ')] : []),
    ].join('\n');
  }

  // payment behaviour over time
  const periodsQY = d.debtorQuarterlyYearly || [];
  if (I.has('debtor', 'pct30') || (I.has('debtor', 'dtp') && (I.gran('quarter') || I.op('trend'))) || (I.gran('quarter') && I.op('top'))) {
    const qs = periodsQY.filter(r => r.type === 'Q');
    if (!qs.length) return say('Payment trend data is not available.', 'Betaaltrendgegevens zijn niet beschikbaar.');
    const solid = qs.filter(r => (r.invoiceCount || 0) >= 20);
    const pool = solid.length ? solid : qs;
    const best = [...pool].sort((a, b) => b.pct30 - a.pct30 || a.avgDays - b.avgDays)[0];
    const lines = [say('Paid within 30 days, per quarter:', 'Betaald binnen 30 dagen, per kwartaal:')];
    lines.push(...qs.slice(-8).map(r => `${r.period}: **${pctVal(r.pct30)}** · ${say('avg', 'gem.')} ${num(r.avgDays)} ${say('days', 'dagen')} · ${fmtInt(r.invoiceCount)} ${say('invoices', 'facturen')}`));
    lines.push(say(`Best quarter: **${best.period}** (${pctVal(best.pct30)} within 30 days, ${num(best.avgDays)} days on average).`, `Beste kwartaal: **${best.period}** (${pctVal(best.pct30)} binnen 30 dagen, gemiddeld ${num(best.avgDays)} dagen).`));
    lines.push(say('Quarters with fewer than 20 invoices are ignored for "best"; the latest quarter only counts invoices already paid.', 'Kwartalen met minder dan 20 facturen tellen niet mee voor "beste"; het laatste kwartaal bevat alleen al betaalde facturen.'));
    return lines.join('\n');
  }
  if (I.has('debtor', 'dtp') && !I.has('debtor', 'slow') && !I.has('debtor', 'fast') && !I.op('top') && !I.op('bottom') && !I.dims.length) {
    const ys = periodsQY.filter(r => r.type === 'Y');
    const wantedYear = I.tags.find(t => t.k === 'year')?.v ?? (I.has('time', 'lastyear') ? env.latestYear - 1 : null);
    const y = wantedYear ? ys.find(r => String(r.period) === String(wantedYear)) : ys[ys.length - 1];
    if (y) {
      const prev = ys[ys.indexOf(y) - 1];
      return say(`Average days to pay in ${y.period}: **${num(y.avgDays)} days** over ${fmtInt(y.invoiceCount)} paid invoices; ${pctVal(y.pct30)} were paid within 30 days.`, `Gemiddelde betaaldagen in ${y.period}: **${num(y.avgDays)} dagen** over ${fmtInt(y.invoiceCount)} betaalde facturen; ${pctVal(y.pct30)} is binnen 30 dagen betaald.`)
        + (prev ? say(`\n${prev.period}: ${num(prev.avgDays)} days (${fmtInt(prev.invoiceCount)} invoices).`, `\n${prev.period}: ${num(prev.avgDays)} dagen (${fmtInt(prev.invoiceCount)} facturen).`) : '');
    }
  }
  if (I.has('debtor', 'dtp') || I.has('debtor', 'slow') || I.has('debtor', 'fast')) {
    const fast = I.has('debtor', 'fast') || I.op('bottom');
    const list = custs.filter(c => c.avgDaysToPay != null).sort((a, b) => (fast ? 1 : -1) * (a.avgDaysToPay - b.avgDaysToPay));
    if (!list.length) return say('Average days-to-pay is not available per customer.', 'Gemiddelde betaaldagen per klant zijn niet beschikbaar.');
    return (fast ? say(`Fastest payers among customers with open invoices (${asOf}):\n`, `Snelste betalers onder klanten met open facturen (${asOf}):\n`) : say(`Slowest payers among customers with open invoices (${asOf}):\n`, `Traagste betalers onder klanten met open facturen (${asOf}):\n`))
      + list.slice(0, listN).map((c, i) => `${i + 1}. **${c.name}** — ${c.avgDaysToPay} ${say('days on average', 'dagen gemiddeld')} · ${say('open', 'open')} ${money(c.openValue)}`).join('\n');
  }
  if (I.has('debtor', 'nonpayer')) {
    const list = custs.filter(c => c.nonPayer).sort((a, b) => b.openValue - a.openValue);
    const head = say(`**${list.length} of ${custs.length} customers** are flagged as non-payer (an open invoice older than 60 days), together ${money(sumBy(list, 'openValue'))} open ${asOf}.`, `**${list.length} van ${custs.length} klanten** zijn gemarkeerd als wanbetaler (een open factuur ouder dan 60 dagen), samen ${money(sumBy(list, 'openValue'))} open ${asOf}.`);
    return head + (list.length ? '\n' + list.slice(0, listN).map((c, i) => `${i + 1}. ${row(c)}`).join('\n') : '');
  }
  const riskTag = I.tags.find(t => t.k === 'debtor' && /^risk[A-D]$/.test(t.v));
  if (riskTag || I.has('debtor', 'risk')) {
    const counts = ['A', 'B', 'C', 'D'].map(r => `${r}: ${custs.filter(c => c.risk === r).length}`).join(' · ');
    const legend = say('A <30 days · B 30–60 · C 60+ days under €5k · D 90+ days and €5k or more', 'A <30 dagen · B 30–60 · C 60+ dagen onder €5k · D 90+ dagen en €5k of meer');
    if (!riskTag) return say(`Customers per risk class (${asOf}): ${counts}\n${legend}`, `Klanten per risicoklasse (${asOf}): ${counts}\n${legend}`);
    const letter = riskTag.v.slice(-1);
    const list = custs.filter(c => c.risk === letter).sort((a, b) => b.openValue - a.openValue);
    const shown = n ?? (I.tags.some(t => t.k === 'op') ? 10 : 25);
    return say(`**${list.length} Risk ${letter} customers**, ${money(sumBy(list, 'openValue'))} open ${asOf}:\n`, `**${list.length} klanten met risico ${letter}**, ${money(sumBy(list, 'openValue'))} open ${asOf}:\n`)
      + list.slice(0, shown).map((c, i) => `${i + 1}. **${c.name}** — ${money(c.openValue)} · ${c.ageOfOldest} ${say('days', 'dagen')}`).join('\n')
      + (list.length > shown ? say(`\n…and ${list.length - shown} more — the Customer Scorecard page lists them all.`, `\n…en nog ${list.length - shown} — de pagina Customer Scorecard toont ze allemaal.`) : '') + `\n${legend}`;
  }
  if (I.has('debtor', 'oldest')) {
    const list = [...custs].sort((a, b) => (b.ageOfOldest || 0) - (a.ageOfOldest || 0));
    return say(`Customers with the oldest open invoices (${asOf}):\n`, `Klanten met de oudste open facturen (${asOf}):\n`)
      + list.slice(0, n ?? 5).map((c, i) => `${i + 1}. **${c.name}** — ${c.ageOfOldest} ${say('days', 'dagen')} (${say('invoice of', 'factuur van')} ${c.oldestInvoice || '—'}) · ${say('open', 'open')} ${money(c.openValue)}`).join('\n');
  }
  // "over 90 days"
  const days = I.nums.find(v => [30, 60, 90, 120, 180].includes(v));
  if (days && !I.has('debtor', 'ageing')) {
    const buckets = d.debtorAgeing || [];
    const lower = b => { const m = /(\d+)/.exec(String(b.bucket)); return /^>/.test(String(b.bucket)) ? Number(m?.[1]) + 1 : Number(m?.[1]); };
    let value = days === 30 ? k?.over30 : days === 90 ? k?.over90 : null;
    if (value == null) value = sumBy(buckets.filter(b => !/settled/i.test(b.bucket) && lower(b) > days), 'value');
    const affected = custs.filter(c => (c.ageOfOldest || 0) > days).sort((a, b) => b.openValue - a.openValue);
    return say(`Receivables older than ${days} days: **${money(value)}** — ${pct(value, total)} of ${money(total)} open ${asOf}.`, `Debiteuren ouder dan ${days} dagen: **${money(value)}** — ${pct(value, total)} van ${money(total)} open ${asOf}.`)
      + (affected.length ? say(`\n${affected.length} customers have an invoice older than ${days} days. Largest: `, `\n${affected.length} klanten hebben een factuur ouder dan ${days} dagen. Grootste: `) + affected.slice(0, 3).map(c => `${c.name} (${money(c.openValue)})`).join(' · ') : '');
  }
  if (I.has('debtor', 'ageing')) {
    const buckets = (d.debtorAgeing || []).filter(b => !/settled/i.test(b.bucket));
    return say(`Receivables ageing ${asOf} — total **${money(total)}**:\n`, `Ouderdom debiteuren ${asOf} — totaal **${money(total)}**:\n`)
      + buckets.map(b => `${b.bucket} ${say('days', 'dagen')}: **${money(b.value)}** (${b.pct != null ? pctVal(b.pct) : pct(b.value, total)}) · ${fmtInt(b.count)} ${say('invoices', 'facturen')}`).join('\n');
  }
  if (I.op('count') && I.dims.some(t => t.v === 'customers')) return say(`**${custs.length} customers** have open invoices ${asOf} (${fmtInt(k?.openInvoiceCount ?? 0)} invoices, ${money(total)}).`, `**${custs.length} klanten** hebben open facturen ${asOf} (${fmtInt(k?.openInvoiceCount ?? 0)} facturen, ${money(total)}).`);
  if (I.dims.some(t => t.v === 'customers') || I.op('top') || I.op('bottom')) {
    const asc = I.op('bottom');
    const list = [...custs].sort((a, b) => (asc ? 1 : -1) * (a.openValue - b.openValue));
    if (listN === 1) return say(`Highest open balance ${asOf}: `, `Hoogste open saldo ${asOf}: `) + row(list[0]) + ` (${pct(list[0].openValue, total)})` + (list[1] ? say('\nNext: ', '\nDaarna: ') + list.slice(1, 3).map(c => `${c.name} ${money(c.openValue)}`).join(' · ') : '');
    return say(`${asc ? 'Smallest' : 'Largest'} open balances ${asOf}:\n`, `${asc ? 'Kleinste' : 'Grootste'} open saldi ${asOf}:\n`) + list.slice(0, listN).map((c, i) => `${i + 1}. ${row(c)}`).join('\n') + say(`\nTotal open: ${money(total)} across ${custs.length} customers`, `\nTotaal open: ${money(total)} over ${custs.length} klanten`);
  }
  if (!k) return say(`Open receivables ${asOf}: **${money(total)}** across ${custs.length} customers.`, `Openstaande debiteuren ${asOf}: **${money(total)}** over ${custs.length} klanten.`);
  return [
    say(`Open receivables ${asOf}: **${money(k.totalDebtorValue)}**`, `Openstaande debiteuren ${asOf}: **${money(k.totalDebtorValue)}**`),
    say(`${fmtInt(k.openInvoiceCount)} open invoices · ${fmtInt(k.customerCount ?? custs.length)} customers`, `${fmtInt(k.openInvoiceCount)} open facturen · ${fmtInt(k.customerCount ?? custs.length)} klanten`),
    say(`Older than 30 days: **${money(k.over30)}** (${pct(k.over30, k.totalDebtorValue)})`, `Ouder dan 30 dagen: **${money(k.over30)}** (${pct(k.over30, k.totalDebtorValue)})`),
    say(`Older than 90 days: **${money(k.over90)}** (${pct(k.over90, k.totalDebtorValue)})`, `Ouder dan 90 dagen: **${money(k.over90)}** (${pct(k.over90, k.totalDebtorValue)})`),
  ].join('\n');
}

/* ════════════════════════════════════════════════════════════════════════
   FINANCE (P&L)
   ════════════════════════════════════════════════════════════════════════ */
function financeAnswer(env, I) {
  const { say, d } = env;
  const f = d.finSummary;
  if (!f) return say('Finance data is not available.', 'Financiële gegevens zijn niet beschikbaar.');
  const label = d.finPeriodLabel || '';
  const m = /(\d{4})\s+([A-Za-z]{3})\S*?\s*[–—-]\s*([A-Za-z]{3}).*?(\d{4})\s+([A-Za-z]{3})\S*?\s*[–—-]\s*([A-Za-z]{3})/.exec(label);
  const span = (a, b) => { const x = MON.findIndex(v => v.toLowerCase() === a.toLowerCase()), y = MON.findIndex(v => v.toLowerCase() === b.toLowerCase()); return x >= 0 && y >= x ? y - x + 1 : null; };
  const cyName = m ? `${m[1]} ${m[2]}–${m[3]}` : say('current period', 'huidige periode');
  const pyName = m ? `${m[4]} ${m[5]}–${m[6]}` : say('prior period', 'vorige periode');
  const cyM = m ? span(m[2], m[3]) : null, pyM = m ? span(m[5], m[6]) : null;
  const unequal = cyM && pyM && cyM !== pyM;
  const caveat = unequal ? say(`\nNote: ${cyName} is ${cyM} months and ${pyName} is ${pyM} months, so compare margins and monthly averages rather than totals.`, `\nLet op: ${cyName} is ${cyM} maanden en ${pyName} is ${pyM} maanden; vergelijk dus marges en maandgemiddelden, geen totalen.`) : '';
  const v = key => { const rev = f.revenue[key], cogs = f.cogs[key], opex = f.opex[key]; return { rev, cogs, opex, gp: rev - cogs, ebitda: rev - cogs - opex }; };
  const cy = v('cy'), py = v('py');
  const perMonth = (x, months) => months ? ` (${money(x / months)}/${say('month', 'maand')})` : '';
  const cats = (d.finCategories || []).filter(c => !/^revenue$/i.test(c.cat));
  const lines = d.finLines || [];
  const n = I.nums[0];
  const sales = I.ents.some(e => SALES_TYPES.includes(e.type)) || I.dims.some(t => SALES_TYPES.includes(t.v) && t.v !== 'categories');
  if (sales) return say('Profit, margin and costs only exist company-wide in the P&L — the data has no cost or margin per customer, product, sales rep or sales category.', 'Winst, marge en kosten bestaan alleen op bedrijfsniveau in de W&V — er zijn geen kosten of marges per klant, product, verkoper of verkoopcategorie.');
  const timeAsked = I.periods.some(p => !p.pageFilter && p.kind !== 'all') && !I.has('time', 'yoy');
  const periodNote = timeAsked ? say(`\nFinance figures only exist for these two periods (${label}); other date filters are not available.`, `\nFinanciële cijfers bestaan alleen voor deze twee perioden (${label}); andere datumfilters zijn niet beschikbaar.`) : '';

  // one cost category
  const catEnt = I.ents.find(e => e.type === 'fincat');
  if (catEnt) {
    const c = cats.find(x => normalizeText(x.cat) === catEnt.normalized);
    const own = lines.filter(l => normalizeText(l.cat) === catEnt.normalized).sort((a, b) => Math.abs(b.cy) - Math.abs(a.cy));
    return `**${c.cat}**\n${cyName}: **${money(c.cy)}**${perMonth(c.cy, cyM)} · ${pct(c.cy, cy.rev)} ${say('of revenue', 'van de omzet')}\n${pyName}: ${money(c.py)}${perMonth(c.py, pyM)} · ${pct(c.py, py.rev)} ${say('of revenue', 'van de omzet')}`
      + (own.length ? say('\nLargest lines: ', '\nGrootste posten: ') + own.slice(0, 4).map(l => `${l.desc} ${money(l.cy)}`).join(' · ') : '') + caveat;
  }
  // ledger: biggest swings / increases
  if (I.has('fin', 'ledger') || (I.has('fin', 'costs') && I.op('growth'))) {
    if (!lines.length) return say('Ledger lines are not available.', 'Grootboekregels zijn niet beschikbaar.');
    const costOnly = I.has('fin', 'costs');
    const pool = lines.filter(l => !costOnly || !/^revenue$/i.test(l.cat));
    const up = costOnly ? pool.filter(l => (l.yoy || 0) > 0).sort((a, b) => b.yoy - a.yoy) : [...pool].sort((a, b) => Math.abs(b.yoy || 0) - Math.abs(a.yoy || 0));
    const fmtLine = (l, i) => `${i + 1}. **${l.desc}** (${l.acct}, ${l.cat}) — ${l.yoy >= 0 ? '+' : '-'}${money(Math.abs(l.yoy))}: ${money(l.py)} → ${money(l.cy)}`;
    if (!up.length) return say(`No cost account is higher in ${cyName} than in ${pyName}.`, `Geen kostenrekening is hoger in ${cyName} dan in ${pyName}.`) + caveat;
    return (costOnly ? say(`Accounts with the biggest cost increases (${pyName} → ${cyName}):\n`, `Rekeningen met de grootste kostenstijging (${pyName} → ${cyName}):\n`) : say(`Largest swings in the ledger (${pyName} → ${cyName}):\n`, `Grootste verschillen in het grootboek (${pyName} → ${cyName}):\n`))
      + up.slice(0, n ?? 6).map(fmtLine).join('\n') + caveat;
  }
  // costs: drivers / by category / revenue vs costs
  if (I.has('fin', 'costs') || I.dims.some(t => t.v === 'categories')) {
    const totalCy = sumBy(cats, 'cy'), totalPy = sumBy(cats, 'py');
    const sorted = [...cats].sort((a, b) => b.cy - a.cy);
    const head = I.has('metric', 'rev') || I.op('compare') || I.has('time', 'yoy')
      ? `${say('Revenue', 'Omzet')}: **${money(cy.rev)}**${perMonth(cy.rev, cyM)} vs ${money(py.rev)}${perMonth(py.rev, pyM)}\n${say('Total costs', 'Totale kosten')}: **${money(totalCy)}**${perMonth(totalCy, cyM)} vs ${money(totalPy)}${perMonth(totalPy, pyM)}\n${say('Costs as % of revenue', 'Kosten als % van omzet')}: **${pct(totalCy, cy.rev)}** vs ${pct(totalPy, py.rev)}\n`
      : say(`Total costs ${cyName}: **${money(totalCy)}** (${pct(totalCy, cy.rev)} of revenue)\n`, `Totale kosten ${cyName}: **${money(totalCy)}** (${pct(totalCy, cy.rev)} van de omzet)\n`);
    return `${cyName} vs ${pyName}\n` + head + say('Biggest cost drivers:\n', 'Grootste kostenposten:\n')
      + sorted.slice(0, n ?? 6).map((c, i) => `${i + 1}. **${c.cat}** — ${money(c.cy)} (${pct(c.cy, totalCy)} ${say('of costs', 'van de kosten')}) · ${say('was', 'was')} ${money(c.py)}`).join('\n') + caveat + periodNote;
  }
  if (I.has('fin', 'margin')) {
    return `${say('Gross margin', 'Brutomarge')}: **${pct(cy.gp, cy.rev)}** (${cyName}) vs ${pct(py.gp, py.rev)} (${pyName})\n${say('EBITDA margin', 'EBITDA-marge')}: **${pct(cy.ebitda, cy.rev)}** vs ${pct(py.ebitda, py.rev)}\n`
      + say(`Gross profit ${money(cy.gp)} on revenue ${money(cy.rev)}; COGS is ${pct(cy.cogs, cy.rev)} of revenue (was ${pct(py.cogs, py.rev)}).`, `Brutowinst ${money(cy.gp)} op omzet ${money(cy.rev)}; COGS is ${pct(cy.cogs, cy.rev)} van de omzet (was ${pct(py.cogs, py.rev)}).`)
      + say('\nMargins are ratios, so they are comparable even though the periods differ in length.', '\nMarges zijn verhoudingen en dus vergelijkbaar, ook al verschillen de perioden in lengte.') + periodNote;
  }
  if (I.has('fin', 'ebitda') || I.has('fin', 'net')) {
    const opexCats = cats.filter(c => !/^cogs$/i.test(c.cat)).sort((a, b) => b.cy - a.cy);
    return (I.has('fin', 'net') ? say('Net profit is not in the data (no tax or interest lines); EBITDA is the closest figure.\n', 'Nettowinst zit niet in de gegevens (geen belasting- of rentelijnen); EBITDA komt het dichtst in de buurt.\n') : '')
      + `EBITDA ${cyName}: **${money(cy.ebitda)}** (${pct(cy.ebitda, cy.rev)} ${say('of revenue', 'van de omzet')}) · ${pyName}: ${money(py.ebitda)} (${pct(py.ebitda, py.rev)})\n`
      + say(`How it builds up: revenue ${money(cy.rev)} − COGS ${money(cy.cogs)} = gross profit ${money(cy.gp)}; − OPEX ${money(cy.opex)} = EBITDA.`, `Opbouw: omzet ${money(cy.rev)} − COGS ${money(cy.cogs)} = brutowinst ${money(cy.gp)}; − OPEX ${money(cy.opex)} = EBITDA.`)
      + say(`\nMain driver: COGS takes ${pct(cy.cogs, cy.rev)} of revenue (was ${pct(py.cogs, py.rev)}), leaving a gross margin of ${pct(cy.gp, cy.rev)}.`, `\nBelangrijkste factor: COGS neemt ${pct(cy.cogs, cy.rev)} van de omzet (was ${pct(py.cogs, py.rev)}), waardoor de brutomarge ${pct(cy.gp, cy.rev)} is.`)
      + (opexCats.length ? say('\nLargest OPEX items: ', '\nGrootste OPEX-posten: ') + opexCats.slice(0, 3).map(c => `${c.cat} ${money(c.cy)}`).join(' · ') : '') + caveat + periodNote;
  }
  const only = ['cogs', 'opex', 'gp'].filter(x => I.has('fin', x));
  const block = (name, x) => `${name}: ${say('revenue', 'omzet')} ${money(x.rev)} · COGS ${money(x.cogs)} · OPEX ${money(x.opex)} · ${say('gross profit', 'brutowinst')} ${money(x.gp)} (${pct(x.gp, x.rev)}) · EBITDA ${money(x.ebitda)} (${pct(x.ebitda, x.rev)})`;
  if (only.length) {
    const nm = { cogs: 'COGS', opex: 'OPEX', gp: say('Gross profit', 'Brutowinst') };
    return only.map(x => `${nm[x]}: **${money(cy[x])}**${perMonth(cy[x], cyM)} · ${pct(cy[x], cy.rev)} ${say('of revenue', 'van de omzet')} (${cyName}) — ${money(py[x])}${perMonth(py[x], pyM)} · ${pct(py[x], py.rev)} (${pyName})`).join('\n')
      + (only.length < 3 ? `\nEBITDA: ${money(cy.ebitda)} vs ${money(py.ebitda)}` : '') + caveat + periodNote;
  }
  return `**${say('Finance totals', 'Financiële totalen')}**\n${block(cyName, cy)}\n${block(pyName, py)}` + caveat + periodNote;
}
