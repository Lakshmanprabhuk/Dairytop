/* ── CHATBOT LANGUAGE LAYER ──────────────────────────────────────────────
   Turns a free-text question (EN / NL) into a list of TAGS the engine can
   reason about. Nothing here touches numbers.

   Pipeline:  dates → exact entity names → typo repair → phrase lexicon →
              numbers → partial / fuzzy entity names → leftover "unknown".

   Safety rule kept from the previous version: a word we do not understand
   is NEVER silently dropped. It ends up in `unknown`, and the engine then
   hands the question to AI instead of answering something else.
   This file is identical in knitworks-dashboard and knitworks-dashboard-1.
   ───────────────────────────────────────────────────────────────────── */

export const normalizeText = value => String(value ?? '').replace(/ß/g, 'ss').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const ENTITY_TYPES = ['customers', 'products', 'salesreps', 'categories'];
const TYPE_PRIORITY = ['salesreps', 'categories', 'customers', 'products', 'fincat'];

/* tag(s) → phrases. Several tags can be joined with "+". Longest phrase wins. */
const LEXICON = {
  // ── dimensions (plural = ranking, singular = "the one") ──
  'dim:customers': 'customers,clients,buyers,purchasers,customer accounts,buying customers,klanten,afnemers,kopers,klantenbestand,customer base',
  'dim1:customers': 'customer,client,buyer,purchaser,klant,afnemer,koper',
  'dim:products': 'products,items,articles,sales items,catalog items,product lines,producten,artikelen,verkoopartikelen,assortimentsartikelen,skus',
  'dim1:products': 'product,item,article,artikel,sku',
  'dim:salesreps': 'sales reps,salesreps,reps,sales representatives,representatives,salespeople,salespersons,salesmen,saleswomen,sales agents,agents,account managers,accountmanagers,verkopers,vertegenwoordigers,verkoopmedewerkers,sellers,sales team,sales persons',
  'dim1:salesreps': 'sales rep,salesrep,rep,sales representative,representative,salesperson,salesman,saleswoman,sales agent,account manager,accountmanager,verkoper,vertegenwoordiger,verkoopmedewerker,seller,sales person,sales man',
  'op:top+dim:salesreps': 'topverkopers',
  'op:top+dim:customers': 'topklanten',
  'op:top+dim:products': 'topproducten',
  'dim:categories': 'categories,product categories,sales categories,category groups,categorieen,productcategorieen,artikelgroepen,productgroepen,product groups',
  'dim1:categories': 'category,product category,categorie,productcategorie,artikelgroep,productgroep,product group,category group',
  'dim:channels': 'channels,sales channels,kanalen,verkoopkanalen,channel split,sales channel split,kanaalverdeling,channel mix,kanaalsplit',
  'dim1:channels': 'channel,sales channel,kanaal,verkoopkanaal',
  'chan:webshop': 'webshop,web shop,online shop,online store,web store,webwinkel,online',
  'chan:direct': 'direct sales,direct selling,directe verkoop,directe verkopen,direct',
  // ── metrics ──
  'metric:rev': 'revenue,revenues,turnover,sales,sale,sales revenue,sales turnover,sales value,revenue amount,turnover amount,total sales value,omzet,verkoopomzet,verkoopwaarde,omzetbedrag,omzetwaarde,verkoop,verkopen,verkoopt,verkocht,sold,sell,sells,selling,income',
  'metric:orders': 'order,orders,order count,order counts,number of orders,count of orders,orders placed,bestelling,bestellingen,orderaantal,orderaantallen,aantal bestellingen,aantal orders,transactions',
  'metric:qty': 'quantity,quantities,qty,units,unit count,number of units,units sold,quantity sold,sales quantity,hoeveelheid,verkochte hoeveelheid,verkochte aantallen,aantal eenheden,eenheden,volume,pieces,stuks',
  'metric:tonnage': 'tonnage,ton,tons,tonnen,tonnes,tonne',
  'metric:aov': 'average order value,avg order value,aov,gemiddelde orderwaarde,order size,average order size,revenue per order,omzet per order',
  // ── operations ──
  'op:top': 'top,best,leading,highest,highest ranked,best performing,top performing,highest performing,largest,biggest,most successful,most,beste,hoogste,grootste,best presterende,hoogst scorende,meeste,best selling,bestselling,top selling,strongest,number one,greatest,leader,leaders,drove,drive,drives,driving,driven,generated,generates,contributed,behaalde,behaalt,best verkopende,best verkochte,winner,star',
  'op:bottom': 'bottom,worst,lowest,lowest ranked,worst performing,lowest performing,smallest,least successful,least,slechtste,laagste,kleinste,minst presterende,minste,weakest,poorest,underperforming,worst selling,fewest',
  'op:total': 'total,totals,overall total,combined total,grand total,sum,sum of,aggregate total,totaal,totalen,totale,som,som van,gezamenlijk totaal,overall,altogether,in total,combined',
  'op:avg': 'average,avg,mean,gemiddeld,gemiddelde,on average',
  'op:count': 'how many,number of,count,count of,hoeveel,aantal',
  'op:share': 'share,shares,percentage,percent,pct,proportion,portion,concentration,concentrated,aandeel,concentratie,geconcentreerd,market share,contribution,dependent,dependency,reliant,afhankelijk',
  'op:trend': 'trend,trends,trending,trended,over time,development,evolution,progression,monthly,month by month,per month,by month,monthly breakdown,monthly trend,maandelijks,maandelijkse,per maand,maand voor maand,maandoverzicht,ontwikkelt,ontwikkeling,verloop,verloopt,changed,changing,evolving,history,timeline,each month,every month,omzettrend+metric:rev,maandomzet+metric:rev',
  'op:compare': 'compare,compared,compares,comparison,contrast,versus,vs,vergelijk,vergelijking,vergeleken,against,relative to,difference,differences,verschil,verschillen,differ,verhoudt,verhouden,verhouding,ten opzichte van,tov',
  'op:growth': 'growth,grow,grew,grown,growing,groei,gegroeid,groeit,increase,increased,increases,decrease,decreased,decline,declined,declining,drop,dropped,rise,rose,rising,stijging,daling,gestegen,gedaald,swing,swings,change',
  'op:more': 'more,meer,tell me more,vertel meer,more details,more detail,details,elaborate,go on,continue',
  'by': 'by,per,each,every,across,among,amongst,elke,elk,ieder,iedere,op,naar,grouped by,split by,broken down by,uitgesplitst naar,for each,for every',
  // ── granularity ──
  'gran:month': 'month,months,maand,maanden',
  'gran:week': 'week,weeks,weekly,wekelijks,wekelijkse,weken,per week,by week,weekomzet+metric:rev',
  'gran:day': 'day,days,daily,dagelijks,dagelijkse,dagen,per day,by day',
  'gran:quarter': 'quarter,quarters,quarterly,kwartaal,kwartalen,per kwartaal',
  'gran:year': 'year,years,yearly,annual,annually,jaar,jaren,jaarlijks',
  // ── time ──
  'time:thismonth': 'this month,current month,present month,latest month,deze maand,huidige maand,lopende maand,laatste maand,right now,at the moment,op dit moment,so far this month,this months',
  'time:lastmonth': 'last month,previous month,preceding month,prior month,vorige maand,voorgaande maand,afgelopen maand',
  'time:thisyear': 'this year,current year,present year,dit jaar,huidige jaar,huidig jaar,lopende jaar,ytd,year to date,so far this year',
  'time:lastyear': 'last year,previous year,preceding year,prior year,vorig jaar,vorige jaar,voorgaande jaar,afgelopen jaar',
  'time:thisquarter': 'this quarter,current quarter,dit kwartaal,huidig kwartaal,huidige kwartaal',
  'time:lastquarter': 'last quarter,previous quarter,prior quarter,vorig kwartaal,vorige kwartaal,afgelopen kwartaal',
  'time:thisweek': 'this week,current week,deze week,huidige week',
  'time:lastweek': 'last week,previous week,prior week,vorige week,afgelopen week',
  'time:today': 'today,vandaag',
  'time:yesterday': 'yesterday,gisteren',
  'time:alltime': 'all time,all available data,over the whole period,lifetime,ever,on record,of all time,alle beschikbare maanden,over de hele periode,ooit,since the beginning,to date,all months,alle maanden',
  'time:thisperiod': 'this period,current period,selected period,deze periode,huidige periode',
  'time:prevperiod': 'previous period,last period,prior period,previous one,the previous one,vorige periode,voorgaande periode,period before',
  'time:yoy': 'yoy,year over year,year on year,jaar op jaar',
  'time:lastn': 'last,past,previous,recent,afgelopen,laatste',
  'q:1': 'q1,quarter 1,first quarter,1st quarter,kwartaal 1,eerste kwartaal',
  'q:2': 'q2,quarter 2,second quarter,2nd quarter,kwartaal 2,tweede kwartaal',
  'q:3': 'q3,quarter 3,third quarter,3rd quarter,kwartaal 3,derde kwartaal',
  'q:4': 'q4,quarter 4,fourth quarter,4th quarter,kwartaal 4,vierde kwartaal',
  'h:1': 'h1,first half,1st half,eerste helft,first half year,eerste halfjaar',
  'h:2': 'h2,second half,2nd half,tweede helft,second half year,tweede halfjaar',
  'm:0': 'jan,january,januari', 'm:1': 'feb,february,februari', 'm:2': 'mar,march,maart,mrt',
  'm:3': 'apr,april', 'm:4': 'may,mei', 'm:5': 'jun,june,juni', 'm:6': 'jul,july,juli',
  'm:7': 'aug,august,augustus', 'm:8': 'sep,sept,september', 'm:9': 'oct,october,okt,oktober',
  'm:10': 'nov,november', 'm:11': 'dec,december',
  'range:to': 'to,until,till,through,thru,tot,tot en met,t m,up to',
  'range:since': 'since,sinds,vanaf,starting,as from',
  'range:between': 'between,tussen',
  'range:and': 'and,en',
  // ── accounts receivable ──
  'dom:debtor': 'accounts receivable,account receivable,receivables,receivable,debtor,debtors,debtor balance,debtor balances,open balance,open balances,outstanding balance,outstanding balances,debiteuren,debiteur,debiteurensaldo,openstaande saldi,openstaand saldo,ar,open ar,outstanding,unpaid,overdue,owed,owes,owe,openstaand,openstaande,onbetaald,achterstallig,open invoices,outstanding invoices,unpaid invoices,open facturen,openstaande facturen,invoices,invoice,facturen,factuur,collections,open saldo',
  'debtor:ageing': 'ageing,aging,ageing breakdown,aging breakdown,ouderdom,ouderdomsanalyse,age buckets,buckets,ageing buckets,aging buckets',
  'debtor:nonpayer': 'non payer,non payers,nonpayer,nonpayers,wanbetaler,wanbetalers,non paying,bad payers,bad payer,slechte betalers',
  'debtor:risk': 'risk,risks,risky,risico,risicovol,risk rating,risk class,risk classes,risk ratings,credit risk',
  'debtor:riskA': 'risk a,low risk,laag risico,lowest risk,risico a,risicoklasse a,class a', 'debtor:riskB': 'risk b,risico b,risicoklasse b,class b', 'debtor:riskC': 'risk c,risico c,risicoklasse c,class c',
  'debtor:riskD': 'risk d,risico d,risicoklasse d,class d,high risk,hoog risico,highest risk,hoogste risico,high risk customers',
  'debtor:dtp': 'days to pay,average days to pay,avg days to pay,payment days,betaaldagen,betalingsdagen,betalingstermijn,payment term,payment terms,dso,days sales outstanding,time to pay,gemiddelde betaaltermijn',
  'debtor:slow': 'slow payers,slowest payers,late payers,slow paying,trage betalers,langzame betalers,langzaamste betalers,slow payer,late payer,slowest,pay late,pays late',
  'debtor:fast': 'fastest payers,fast payers,best payers,snelste betalers,fastest,pay fastest',
  'debtor:pct30': 'paid within 30 days,paid within,within 30 days,payment performance,payment behaviour,payment behavior,betaalgedrag,binnen 30 dagen,paid on time,on time payment,on time payments,payment trend,payment trends,betaaltrend,payment speed,pay on time',
  'debtor:oldest': 'oldest,oudste,longest outstanding,longest overdue,oldest invoice,oldest invoices,oldest outstanding invoices,oldest outstanding',
  // ── finance ──
  'dom:finance': 'finance,financial,financials,financial overview,financial summary,financial totals,financial results,financieel,financiele,financiele totalen,financieel overzicht,financiele resultaten,financien,p l,pnl,p and l,profit and loss,income statement,winst en verlies,resultatenrekening',
  'fin:cogs': 'cogs,cost of goods sold,cost of sales,kostprijs,kostprijs verkopen,inkoopwaarde,inkoopkosten',
  'fin:opex': 'opex,operating expenses,operating costs,operationele kosten,bedrijfskosten,overhead,overheads',
  'fin:gp': 'profit,gross profit,gross earnings,gross result,brutowinst,bruto winst,winst',
  'fin:margin': 'margin,margins,gross margin,marge,brutomarge,profit margin,profitability,winstmarge,winstgevendheid,profitable',
  'fin:ebitda': 'ebitda,operating profit,operating result,bedrijfsresultaat',
  'fin:net': 'net profit,nettowinst,net income,net result,bottom line,netto resultaat',
  'fin:costs': 'cost,costs,expenses,expense,kosten,uitgaven,spend,spending,cost drivers,cost driver,kostenposten,cost breakdown,kostenanalyse,cost structure,cost increases,cost increase,kostenstijging,kostenstijgingen',
  'fin:ledger': 'ledger,general ledger,grootboek,accounts,account,ledger accounts,gl,grootboekrekeningen,rekeningen,ledger lines',
  // ── open orders / month-to-date ──
  'dom:openorders': 'open orders,open order,openstaande orders,openstaande order,pipeline,backlog,pijplijn,order value,orderwaarde,open order value,openstaande orderwaarde,order book,orderboek,pending orders,outstanding orders,undelivered orders,open value,open waarde,totale open waarde,total open value,orders in progress',
  'dom:mtd': 'mtd,month to date,projected,projection,prognose,gepland,projected mtd,actual vs projected,mtd actual vs projected,actueel vs prognose,mtd actueel vs prognose,maand tot heden,on track,expected this month,mtd vs projected',
  // ── questions that need reasoning → always AI (with a slim data slice) ──
  'ai:reason': 'why,waarom,reason,reasons,cause,causes,caused,explain,explanation,because,recommend,recommendation,recommendations,advice,advise,should,suggest,suggestion,suggestions,strategy,what if,improve,hoe komt,insight,insights,analyse,analyze,analysis,opinion,think,risk of',
  // ── forecasts: plain revenue forecasts are calculated locally, anything more specific goes to AI ──
  'predict': 'forecast,forecasts,forecasting,forecasted,predict,predicts,predicted,prediction,predictions,estimate,estimates,estimated,estimation,expect,expected,expectation,outlook,projection for,voorspel,voorspelling,voorspellen,verwachting,verwacht,verwachte,schatting,schat,prognose voor,going to be,will be,will we,gaan we,year end,end of year,full year,eind van het jaar,heel jaar',
  'time:nextmonth': 'next month,coming month,volgende maand,komende maand',
  'time:nextyear': 'next year,coming year,volgend jaar,komend jaar',
  'time:nextquarter': 'next quarter,coming quarter,volgend kwartaal,komend kwartaal',
  // ── small talk & meta (answered instantly, never AI) ──
  'talk:greet': 'hi,hii,hello,helo,hey,heya,hoi,hallo,goedemorgen,goedemiddag,goedenavond,good morning,good afternoon,good evening,good day,howdy,yo,hiya,greetings,goedendag,goeiedag,morning,how are you,hoe gaat het met je',
  'talk:thanks': 'thanks,thank you,thankyou,thx,ty,bedankt,dank,dank je,dank u,dankjewel,dank je wel,cheers,great,nice,awesome,perfect,good,fine,ok,okay,oke,cool,super,prima,mooi,got it,understood,duidelijk,well done,good job,great job',
  'talk:bye': 'bye,goodbye,good bye,see you,doei,tot ziens,later,good night,goedenacht',
  'talk:yesno': 'yes,no,ja,nee,yep,nope,sure',
  'talk:who': 'who are you,what are you,wie ben jij,wie ben je,your name,are you ai,are you a bot,are you human,are you real',
  'talk:help': 'help,help menu,supported questions,available questions,what can you answer,what can i ask,what can you do,hulp,wat kan ik vragen,wat kun je,wat kan je,capabilities,how do you work,how does this work,examples,example questions,what do you know,what should i ask',
  'meta:updated': 'last updated,updated,last update,data date,date of the data,refresh,refreshed,how recent,how current,how fresh,up to date,latest data,bijgewerkt,laatste update,actueel,data through,last refresh,last refreshed,last sync',
  'meta:summary': 'summary,summarize,summarise,summarized,overview,kpi,kpis,key numbers,key figures,key metrics,highlights,snapshot,at a glance,samenvatting,overzicht,kerncijfers,vat samen,about this page,this page,dashboard,how are we doing,hoe gaat het,how is business,how is the business,status,recap,big picture,headline numbers,main numbers,deze pagina,key takeaways,how is it going',
  // ── filler: understood, carries no meaning ──
  'stop': 'komt,komen,hadden,levert,leveren,oplevert,opleveren,verdeeld,ouder,ouder dan,older than,vertel,vertellen,zorgt,brengt,geeft,maakt,doet,gaan,ging,heb,hebt,werd,ranked,ranking,rank,rankings,sorted,sort,ordered by,ranglijst,gerangschikt,now,currently,nu,momenteel,show,give,tell,me,us,please,list,display,find,get,see,view,want,need,would,like,i,we,you,can,could,will,the,a,an,of,for,in,on,at,with,or,their,its,our,my,your,is,are,was,were,be,been,being,has,have,had,do,does,did,there,here,that,this,these,those,what,which,who,whom,whose,when,where,how,much,many,it,as,so,if,about,any,some,all,available,data,just,also,really,actually,exactly,quick,quickly,brief,briefly,number,numbers,amount,amounts,value,values,figure,figures,stats,statistics,info,information,report,look,looking,check,know,let,lets,s,t,d,m,re,ve,ll,flagged,marked,labelled,labeled,classified,saw,seen,come,comes,coming,came,gets,got,made,make,makes,go,goes,went,stand,stands,right,active,far,over,from,up,down,doing,going,performing,performance,split,breakdown,break,broken,distribution,grouped,group,groups,one,ones,them,they,he,she,his,her,us,im,am,may i,may we,can i,can we,could you,would you,id,kindly,pls,plz,hey,then,than,older,above,past,into,out,off,mine,ours,currently have,do we have,we have,have we,are there,is there,to me,for me,record,records,entire,whole,full,complete,date,name,names,called,named,regarding,concerning,related,terms,based,according,using,use,take,put,pull,bring,print,write,provide,share with,need to,want to,id like,i d like,would like,like to,able,possible,answer,question,quick question,hello there,business,company,dairytop,we ve,weve,ve got,theyve,money,euro,euros,eur,in euros,wise,level,side,part,kind,sort,type,types,way,thing,things,stuff,bit,little,lot,lots,very,too,quite,rather,mostly,mainly,primarily,generally,usually,typically,toon,geef,mij,wat,wie,welke,welk,zijn,onze,ons,de,het,een,van,voor,alle,hoe,gaat,staat,er,hier,dit,dat,deze,die,kun,kunt,kan,je,u,ik,wil,graag,zien,laat,bekijk,heeft,hebben,is,waren,worden,wordt,zich,met,in,bij,aan,uit,om,te,dan,als,ook,nog,maar,even,eens,alsjeblieft,alstublieft,verdeling,uitsplitsing,uitgesplitst,we,wij,jullie,zij,hun,mijn,kunnen,mag,mogen,zou,willen,hoeveelheid aan,tonen,geven,laten,weergeven,overzicht van,cijfers,gegevens,bedrag,waarde,during,gedurende,throughout,within,inside,total of,buy,buys,bought,buying,purchased,koopt,kopen,gekocht,take,takes',
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10,
  elf: 11, twaalf: 12, dertien: 13, veertien: 14, vijftien: 15, zestien: 16, zeventien: 17, achttien: 18, negentien: 19, twintig: 20, dertig: 30, veertig: 40, vijftig: 50,
  single: 1, couple: 2, dozen: 12,
};
const AMBIGUOUS_NUMBER_WORDS = new Set(['one', 'een', 'single']);

/* ── compiled lexicon ── */
const PHRASES = new Map();           // "phrase" → [tags]
const WORDS = new Set();             // every single word that appears in a phrase
let MAX_PHRASE = 1;
for (const [tagExpr, list] of Object.entries(LEXICON)) {
  for (const raw of list.split(',')) {
    let phrase = raw, tags = tagExpr.split('+');
    if (raw.includes('+')) { const parts = raw.split('+'); phrase = parts[0]; tags = [...tags, ...parts.slice(1)]; }
    phrase = normalizeText(phrase);
    if (!phrase) continue;
    if (!PHRASES.has(phrase) || tagExpr !== 'stop') PHRASES.set(phrase, tags);
    const words = phrase.split(' ');
    MAX_PHRASE = Math.max(MAX_PHRASE, words.length);
    words.forEach(w => WORDS.add(w));
  }
}
Object.keys(NUMBER_WORDS).forEach(w => WORDS.add(w));
const WORDS_BY_INITIAL = new Map();
for (const w of WORDS) { if (w.length < 4) continue; const k = w[0]; (WORDS_BY_INITIAL.get(k) || WORDS_BY_INITIAL.set(k, []).get(k)).push(w); }

/* Damerau-Levenshtein distance with an early exit above `max`. */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v); if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}
const allowedDistance = word => word.length >= 8 ? 2 : word.length >= 5 ? 1 : 0;
/* Real words that sit one typo away from a keyword — never "repair" these. */
const NO_REPAIR = new Set('price,prices,priced,pricing,stock,stocks,store,stores,country,countries,region,regions,discount,discounts,delivery,deliveries,supplier,suppliers,employee,employees,weather,target,targets,budget,budgets,market,markets,contract,contracts,return,returns,product,payment,payments,credit,credits,north,south,east,west,purchase,purchases,sample,samples,season,seasons,order,ordered,shipped,shipping,invoiced,new,lost,churn,churned'.split(','));

function repairWord(word, index) {
  if (WORDS.has(word) || NO_REPAIR.has(word) || /\d/.test(word) || index.tokens.has(word)) return word;
  const max = allowedDistance(word);
  if (!max) return word;
  let best = null, bestDist = max + 1, tie = false;
  for (const cand of WORDS_BY_INITIAL.get(word[0]) || []) {
    const dist = editDistance(word, cand, max);
    if (dist < bestDist) { best = cand; bestDist = dist; tie = false; }
    else if (dist === bestDist && best && String(PHRASES.get(cand)) !== String(PHRASES.get(best))) tie = true;
  }
  return best && !tie ? best : word;
}

/* ── entity index (built once per data object) ── */
const cache = new WeakMap();
export function getLanguageIndex(d) {
  if (cache.has(d)) return cache.get(d);
  const byKey = new Map();
  const add = (type, rawName) => {
    const name = String(rawName ?? '').trim();
    const normalized = normalizeText(name);
    if (!normalized) return;
    const key = `${type}|${normalized}`;
    if (!byKey.has(key)) byKey.set(key, { type, normalized, name, names: [name], words: normalized.split(' ') });
    else if (!byKey.get(key).names.includes(name)) byKey.get(key).names.push(name);
  };
  for (const type of ENTITY_TYPES) for (const row of d[type] || []) add(type, row.n);
  // Customers that only exist in the debtor ledger must still be recognised by name.
  for (const row of d.debtorCustomers || []) add('customers', row.name);
  for (const row of d.finCategories || []) if (!/^(revenue|cogs|other|finance)$/i.test(row.cat)) add('fincat', row.cat);
  const entities = [...byKey.values()].sort((a, b) => b.normalized.length - a.normalized.length);
  const tokens = new Map();
  entities.forEach((e, i) => { for (const w of new Set(e.words)) (tokens.get(w) || tokens.set(w, []).get(w)).push(i); });
  const result = { entities, tokens };
  cache.set(d, result);
  return result;
}

function pickByType(cands, wantedTypes) {
  if (cands.length <= 1) return cands;
  const wanted = cands.filter(e => wantedTypes.includes(e.type));
  if (wanted.length) return wanted;
  return cands;
}

/* Find entities whose name contains every word of `run` (whole word, or prefix ≥ 4 chars). */
function partialMatches(run, index, fuzzy) {
  let ids = null;
  for (const word of run) {
    const hit = new Set(index.tokens.get(word) || []);
    if (word.length >= 5) for (const [tok, list] of index.tokens) {
      if (tok === word) continue;
      if (tok.startsWith(word) || (fuzzy && word.length >= 6 && tok.length >= 6 && tok[0] === word[0] && editDistance(word, tok, allowedDistance(word)) <= allowedDistance(word))) list.forEach(i => hit.add(i));
    }
    ids = ids ? new Set([...ids].filter(i => hit.has(i))) : hit;
    if (!ids.size) return [];
  }
  return [...ids].map(i => index.entities[i]);
}

/**
 * @returns {{ tags: Array, unknown: string[], clarify: null|{text:string,candidates:Array}, normalized: string }}
 * tag shapes: {k:'dim',v:'customers',one:bool} {k:'ent',e:entity} {k:'num',v:5} {k:'year',v:2026}
 *             {k:'date',v:'2026-11-04'} and {k:<lexicon kind>, v:<value>} for everything else.
 */
export function parseQuestion(question, d) {
  const index = getLanguageIndex(d);
  // 1. explicit dates → placeholders that survive normalisation
  let raw = String(question ?? '')
    .replace(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g, (_, y, m, day) => ` datex${y}${m.padStart(2, '0')}${day.padStart(2, '0')} `)
    .replace(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/g, (_, day, m, y) => ` datex${y.length === 2 ? '20' + y : y}${m.padStart(2, '0')}${day.padStart(2, '0')} `)
    .replace(/%/g, ' percent ').replace(/>\s*(\d)/g, ' over $1');
  let q = ` ${normalizeText(raw)} `;
  // 2. exact full entity names, longest first (protects words like "May", "Elite", "Sales")
  const found = [];
  for (const entity of index.entities) {
    if (entity.normalized.length < 3 || PHRASES.has(entity.normalized)) continue;
    const needle = ` ${entity.normalized} `;
    if (!q.includes(needle)) continue;
    const same = index.entities.filter(e => e.normalized === entity.normalized);
    q = q.split(needle).join(` entx${found.length} `);
    found.push(same);
  }
  // 3. typo repair, word by word
  let words = q.trim().split(/\s+/).filter(Boolean).map(w => /^(entx|datex)\d+$/.test(w) ? w : repairWord(w, index));
  // 4. greedy longest-phrase match
  const tags = [];
  const pending = [];                       // consecutive words nobody understood
  const flush = () => { if (pending.length) { tags.push({ k: 'unk', words: pending.splice(0) }); } };
  for (let i = 0; i < words.length;) {
    const w = words[i];
    let m;
    if ((m = /^entx(\d+)$/.exec(w))) { flush(); tags.push({ k: 'ent', cands: found[Number(m[1])] }); i++; continue; }
    if ((m = /^datex(\d{4})(\d{2})(\d{2})$/.exec(w))) { flush(); tags.push({ k: 'date', v: `${m[1]}-${m[2]}-${m[3]}` }); i++; continue; }
    let matched = false;
    for (let len = Math.min(MAX_PHRASE, words.length - i); len >= 1; len--) {
      const phrase = words.slice(i, i + len).join(' ');
      const hit = PHRASES.get(phrase);
      if (!hit) continue;
      flush();
      for (const t of hit) {
        if (t === 'stop') continue;
        const [k, v] = t.split(':');
        if (k === 'dim1') tags.push({ k: 'dim', v, one: true });
        else if (k === 'dim') tags.push({ k: 'dim', v, one: false });
        else if (k === 'q' || k === 'h' || k === 'm') tags.push({ k, v: Number(v) });
        else if (t === 'by') tags.push({ k: 'by' });
        else if (t === 'predict') tags.push({ k: 'predict' });
        else tags.push({ k, v, phrase });
      }
      i += len; matched = true; break;
    }
    if (matched) continue;
    if (/^\d+$/.test(w) && pending.length && index.tokens.has(w)) { pending.push(w); i++; continue; }   // "pro elite 60"
    if (/^\d+$/.test(w)) {
      flush();
      const n = Number(w);
      tags.push(n >= 2000 && n <= 2099 ? { k: 'year', v: n } : { k: 'num', v: n });
      i++; continue;
    }
    if ((m = /^w(\d{1,2})$/.exec(w))) { flush(); tags.push({ k: 'gran', v: 'week' }, { k: 'num', v: Number(m[1]) }); i++; continue; }
    if (w in NUMBER_WORDS && !AMBIGUOUS_NUMBER_WORDS.has(w)) {
      flush();
      let n = NUMBER_WORDS[w];
      const next = NUMBER_WORDS[words[i + 1]];
      if (n >= 20 && next && next < 10) { n += next; i++; }
      tags.push({ k: 'num', v: n }); i++; continue;
    }
    pending.push(w); i++;
  }
  flush();
  // "mar 25" → March 2025 (two-digit year directly after a month)
  for (let i = 0; i < tags.length - 1; i++) {
    if (tags[i].k === 'm' && tags[i + 1].k === 'num' && tags[i + 1].v >= 20 && tags[i + 1].v <= 39) tags[i + 1] = { k: 'year', v: 2000 + tags[i + 1].v };
  }
  // "revenue per rep" / "omzet per categorie" ask for a list, not for the single best one
  for (let i = 0; i < tags.length - 1; i++) if (tags[i].k === 'by' && tags[i + 1].k === 'dim') tags[i + 1].one = false;
  // 5. resolve names
  const wantedTypes = tags.filter(t => t.k === 'dim').map(t => t.v);
  const preferType = list => { for (const type of TYPE_PRIORITY) { const hit = list.filter(e => e.type === type); if (hit.length) return hit; } return list; };
  let clarify = null;
  const unknown = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.k === 'ent') {
      let cands = pickByType(t.cands, wantedTypes);
      if (cands.length > 1) cands = preferType(cands);
      tags[i] = { k: 'ent', e: cands[0] };
    } else if (t.k === 'unk') {
      let cands = partialMatches(t.words, index, false);
      // typo-tolerant name matching only for multi-word names — a single ordinary word must never "become" a customer
      if (!cands.length && t.words.length >= 2) cands = partialMatches(t.words, index, true);
      cands = cands.filter(e => !PHRASES.has(e.normalized));
      cands = pickByType(cands, wantedTypes);
      if (cands.length > 1) {
        const run = t.words.join(' ');
        const starts = cands.filter(e => e.normalized.startsWith(run));
        if (starts.length === 1) cands = starts;
        else if (starts.length > 1 && new Set(starts.map(e => e.type)).size > 1) { const p = preferType(starts); if (p.length === 1) cands = p; }
      }
      if (cands.length === 1) tags[i] = { k: 'ent', e: cands[0], partial: t.words.join(' ') };
      else if (cands.length > 1 && !clarify) { clarify = { words: t.words, candidates: cands }; unknown.push(...t.words); }
      else unknown.push(...t.words);
    }
  }
  return { tags: tags.filter(t => t.k !== 'unk' && t.k !== 'by'), unknown, clarify, normalized: words.join(' ') };
}

/* Kept for tests / tooling: every word the bot understands, with where it comes from. */
export function vocabularyRows(d) {
  const index = getLanguageIndex(d);
  const map = new Map();
  const add = (w, scope) => { if (!/^[a-z]+$/.test(w)) return; if (!map.has(w)) map.set(w, new Set()); map.get(w).add(scope); };
  for (const w of WORDS) add(w, 'language');
  for (const e of index.entities) for (const w of e.words) add(w, `entity:${e.type}`);
  return [...map].sort(([a], [b]) => a.localeCompare(b)).map(([word, scopes]) => ({ word, scopes: [...scopes].sort() }));
}
