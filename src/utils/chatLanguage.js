// Controlled language expansion. Entity words are indexed, never ignored as filler.
export const normalizeText = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const LANGUAGE_RULES = [
  ['customers', ['customer','customers','client','clients','buyer','buyers','purchaser','purchasers','customer accounts','buying customers','klant','klanten','afnemer','afnemers','kopers','koper','klantenbestand']],
  ['products', ['product','products','item','items','article','articles','sales items','catalog items','product lines','producten','artikel','artikelen','verkoopartikelen','assortimentsartikelen']],
  ['sales reps', ['sales rep','sales reps','salesrep','salesreps','sales representative','sales representatives','salesperson','salespeople','salesman','salesmen','saleswoman','saleswomen','sales agent','sales agents','account manager','account managers','verkoper','verkopers','vertegenwoordiger','vertegenwoordigers','verkoopmedewerker','verkoopmedewerkers','accountmanager','accountmanagers']],
  ['categories', ['category','categories','product category','product categories','sales categories','category groups','categorie','categorieen','productcategorie','productcategorieen','artikelgroep','artikelgroepen','productgroep','productgroepen']],
  ['revenue', ['revenue','revenues','turnover','sales revenue','sales turnover','sales value','revenue amount','turnover amount','total sales value','omzet','verkoopomzet','verkoopwaarde','omzetbedrag','omzetwaarde']],
  ['orders', ['order','orders','order count','order counts','number of orders','count of orders','orders placed','bestelling','bestellingen','orderaantal','orderaantallen','aantal bestellingen','aantal orders']],
  ['quantity', ['quantity','quantities','qty','units','unit count','number of units','units sold','quantity sold','sales quantity','hoeveelheid','verkochte hoeveelheid','verkochte aantallen','aantal eenheden','eenheden']],
  ['top', ['top','best','leading','highest','highest ranked','best performing','highest performing','largest','biggest','most successful','top performing','beste','hoogste','grootste','best presterende','hoogst scorende']],
  ['bottom', ['bottom','worst','lowest','lowest ranked','worst performing','lowest performing','smallest','least successful','slechtste','laagste','kleinste','minst presterende']],
  ['total', ['total','totals','overall total','combined total','grand total','sum','sum of','aggregate total','totaal','totalen','totale','som','som van','gezamenlijk totaal']],
  ['monthly', ['monthly','month by month','per month','by month','monthly breakdown','monthly trend','maandelijks','per maand','maand voor maand','maandoverzicht','maandelijkse trend']],
  ['this month', ['this month','current month','present month','latest month','deze maand','huidige maand','lopende maand','laatste maand']],
  ['last month', ['last month','previous month','preceding month','vorige maand','voorgaande maand']],
  ['this year', ['this year','current year','present year','dit jaar','huidige jaar','lopende jaar']],
  ['last year', ['last year','previous year','preceding year','vorig jaar','vorige jaar','voorgaande jaar']],
  ['q1', ['q1','quarter 1','first quarter','1st quarter','kwartaal 1','eerste kwartaal']],
  ['q2', ['q2','quarter 2','second quarter','2nd quarter','kwartaal 2','tweede kwartaal']],
  ['q3', ['q3','quarter 3','third quarter','3rd quarter','kwartaal 3','derde kwartaal']],
  ['q4', ['q4','quarter 4','fourth quarter','4th quarter','kwartaal 4','vierde kwartaal']],
  ['webshop', ['webshop','web shop','online shop','online store','web store','webwinkel']],
  ['direct sales', ['direct sales','direct selling','directe verkoop','directe verkopen']],
  ['channels', ['channel','channels','sales channels','channel split','sales channel split','kanalen','verkoopkanalen','kanaalverdeling']],
  ['finance', ['finance','financial','financial overview','financial summary','financial totals','financial results','financieel','financiele totalen','financieel overzicht','financiele resultaten','financien']],
  ['cogs', ['cogs','cost of goods sold','cost of sales','kostprijs','kostprijs verkopen','inkoopwaarde']],
  ['opex', ['opex','operating expenses','operating costs','operationele kosten','bedrijfskosten']],
  ['profit', ['profit','gross profit','gross earnings','gross result','brutowinst','bruto winst','winst']],
  ['accounts receivable', ['accounts receivable','account receivable','receivables','debtor','debtors','debtor balance','debtor balances','open balances','outstanding balance','outstanding balances','debiteuren','debiteurensaldo','openstaande saldi','openstaand saldo']],
  ['ageing', ['ageing','aging','ageing breakdown','aging breakdown','ouderdom','ouderdomsanalyse']],
  ['help', ['help','help menu','supported questions','available questions','what can you answer','what can i ask','hulp','wat kan ik vragen']],
  ['compare', ['compare','comparison','contrast','versus','vergelijk','vergelijking']],
  ['forecast', ['forecast','forecasting','predict','prediction','projection','estimate','estimated','voorspel','voorspelling','verwachting','schatting']],
];
// Remove only whole conversational phrases, not unknown filter words.
export const INTRODUCTIONS = [
  'could you please show me','can you please show me','would you please show me',
  'could you show me','can you show me','would you show me','please show me','show me',
  'please list','list','please display','display','please give me','give me',
  'could you tell me','can you tell me','please tell me','tell me',
  'i would like to see','i want to see','i need to see','let me see','find',
  'kun je mij tonen','kun je me tonen','kunt u mij tonen','wil je mij tonen',
  'laat mij zien','laat me zien','toon mij','toon me','toon','geef mij','geef me',
  'ik wil graag zien','ik wil zien','graag een overzicht van','geef een overzicht van',
];
const numberWords = {
 one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
 eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,
 een:1,twee:2,drie:3,vier:4,vijf:5,zes:6,zeven:7,acht:8,negen:9,tien:10,
 elf:11,twaalf:12,dertien:13,veertien:14,vijftien:15,zestien:16,zeventien:17,achttien:18,negentien:19,twintig:20,dertig:30,veertig:40,vijftig:50,
};
export const ENTITY_TYPES = ['customers','products','salesreps','categories'];
const cache = new WeakMap();
export function getLanguageIndex(d) {
  if (cache.has(d)) return cache.get(d);
  const entities = [];
  const words = new Map();
  const add = (text, scope) => {
    for (const word of normalizeText(text).split(' ').filter(w => /^[a-z]+$/.test(w))) {
      if (!words.has(word)) words.set(word, new Set());
      words.get(word).add(scope);
    }
  };
  for (const type of ENTITY_TYPES) {
    for (const name of new Set((d[type] || []).map(r => String(r.n).trim()))) {
      entities.push({type, name, normalized:normalizeText(name)}); add(name, `entity:${type}`);
    }
  }
  for (const [canonical, variants] of LANGUAGE_RULES) for (const variant of [canonical,...variants]) add(variant,'language');
  for (const phrase of INTRODUCTIONS) add(phrase,'language');
  Object.keys(numberWords).forEach(word => add(word, 'number'));
  add('January February March April May June July August September October November December januari februari maart april mei juni juli augustus september oktober november december jan feb mar mrt apr jun jul aug sep oct okt nov dec in for by and the our please alstublieft alsjeblieft van voor op naar en de het onze during gedurende all available data lifetime over alle beschikbare maanden over de hele periode', 'language');
  const result = {entities:entities.sort((a,b)=>b.normalized.length-a.normalized.length), words};
  cache.set(d,result);
  return result;
}
const rules = LANGUAGE_RULES.flatMap(([canonical, variants]) => variants.map(phrase => ({canonical,phrase:normalizeText(phrase)})))
  .sort((a,b)=>b.phrase.length-a.phrase.length);
const ruleMap = new Map(rules.map(r=>[r.phrase,r.canonical]));
const ruleRegex = new RegExp(`\\b(?:${[...ruleMap.keys()].join('|')})\\b`, 'g');

export function prepareQuestion(question, d) {
  const index = getLanguageIndex(d);
  let q = ` ${normalizeText(question)} `;
  const entities = [];
  // Protect exact names BEFORE changing words such as "Elite", "May" or "Sales".
  for (const entity of index.entities) {
    const needle = ` ${entity.normalized} `;
    if (entity.normalized.length < 3 || !q.includes(needle)) continue;
    const matches = index.entities.filter(e => e.normalized === entity.normalized);
    if (new Set(matches.map(e=>`${e.type}:${e.name}`)).size > 1) {
      return {error:'ambiguous',candidates:matches.map(e=>e.name)};
    }
    q = q.replaceAll(needle, ` entitytoken${entities.length} `);
    entities.push(entity);
  }
  q = q.trim();
  for (const phrase of [...INTRODUCTIONS].sort((a,b)=>b.length-a.length)) {
    if (q.startsWith(`${phrase} `)) {q=q.slice(phrase.length+1);break;}
  }
  q = q.replace(/\b(?:please|alstublieft|alsjeblieft)\b/g,' ').replace(/\s+/g,' ').trim();
  // Resolve partial names only after explicit "for/voor" and only if unique.
  // Never discard an unrecognized region, condition, or metric.
  const partial = q.match(/\b(?:for|voor) (.+?)(?=\s+(?:in|during|gedurende)\b|$)/);
  if (partial && !/entitytoken\d+/.test(partial[1])) {
    const value = partial[1].trim();
    const matches = index.entities.filter(e=>value.length >= 4 && (` ${e.normalized} `).includes(` ${value} `));
    if (matches.length === 1) {
      q = q.replace(partial[0], `for entitytoken${entities.length}`); entities.push(matches[0]);
    } else if (matches.length > 1) return {error:'ambiguous', candidates:matches.slice(0,8).map(e=>e.name)};
  }
  q = q.replace(ruleRegex, phrase => ruleMap.get(phrase));
  q = q.replace(/\b(top|bottom) ([a-z]+)(?: ([a-z]+))?\b/g,(whole, direction, first, second)=> {
    const a=numberWords[first], b=numberWords[second];
    if (!a) return whole;
    if (a>=20 && b && b<10) return `${direction} ${a+b}`;
    return `${direction} ${a}${second ? ` ${second}` : ''}`;
  });
  q=q.replace(/\b(?:during|gedurende)\b/g,'in')
    .replace(/\b(?:op|naar)\b/g,'by')
    .replace(/\b(?:all time|all available data|over the whole period|alle beschikbare maanden|over de hele periode)\b/g,'lifetime')
    .replace(/\s+/g,' ').trim();
  return {query:q,entities};
}

export function vocabularyRows(d) {
  return [...getLanguageIndex(d).words].sort(([a],[b])=>a.localeCompare(b))
    .map(([word,scopes])=>({word,scopes:[...scopes].sort()}));
}
