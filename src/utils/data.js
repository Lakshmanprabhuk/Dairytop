export const monthly = [
  {m:'Jan 25',rev:1320954,orders:783},
  {m:'Feb 25',rev:1311099,orders:715},
  {m:'Mar 25',rev:1853061,orders:825},
  {m:'Apr 25',rev:1465193,orders:636},
  {m:'May 25',rev:1705014,orders:630},
  {m:'Jun 25',rev:1465193,orders:659},
  {m:'Jul 25',rev:1734057,orders:805},
  {m:'Aug 25',rev:1957480,orders:799},
  {m:'Sep 25',rev:1709665,orders:842},
  {m:'Oct 25',rev:2153787,orders:951},
  {m:'Nov 25',rev:1607823,orders:703},
  {m:'Dec 25',rev:2909244,orders:1107},
  {m:'Jan 26',rev:1575882,orders:718},
  {m:'Feb 26',rev:1502503,orders:880},
  {m:'Mar 26',rev:2210843,orders:792},
  {m:'Apr 26',rev:1465121,orders:756},
  {m:'May 26',rev:1300362,orders:751},
  {m:'Jun 26',rev:1683083,orders:892},
  {m:'Jul 26',rev:427036,orders:199}
];

export const salesreps = [
  {n:'Johan Hoogendoorn',rev:10340036,qty:39696,orders:2539},
  {n:'Edo Steenbergen',rev:5990648,qty:15616,orders:2245},
  {n:'Bärbel Achelpöhler',rev:3759609,qty:27777,orders:2220},
  {n:'Karen Hoogendoorn',rev:3202887,qty:3472,orders:1565},
  {n:'Brugt Pilat',rev:2522513,qty:6555,orders:1834},
  {n:'Orsi Hongarije',rev:2454132,qty:1480,orders:300},
  {n:'Sharon Harberink',rev:1532287,qty:3385,orders:1042},
  {n:'Beeke Gerdes',rev:1130884,qty:3371,orders:934},
  {n:'Webshop',rev:252881,qty:5322,orders:1516},
  {n:'Leon',rev:142284,qty:283,orders:132},
  {n:'Emily Gaasbeek',rev:16503,qty:0,orders:7},
  {n:'Unknown',rev:13341,qty:0,orders:105},
  {n:'Kantoor',rev:-606,qty:-17,orders:4}
];

export const customers = [
  {n:'Gut Trossin VGmbH',rev:1010900,orders:130},
  {n:'Lübars Agrar GmbH',rev:1000636,orders:95},
  {n:'Gut Hohen Luckow Milch GmbH & Co KG',rev:848636,orders:88},
  {n:'Nyakas Farm Kft.',rev:557430,orders:38},
  {n:'Agrarunternehmen Starbach-Sachsen eG',rev:555700,orders:41},
  {n:'Lenzener Wische Rinderzucht GmbH',rev:543520,orders:78},
  {n:'The Calf Company (Europe) Ltd',rev:532804,orders:55},
  {n:'Aalberts-Krap GmbH',rev:425610,orders:130},
  {n:'Agrargenossenschaft eG Tucheim',rev:356509,orders:22},
  {n:'CLA Milk Kft.',rev:354390,orders:12},
  {n:'Agrarproduktion Stäbelow GmbH',rev:336877,orders:64},
  {n:'Milchgut Reichenbach GmbH',rev:308397,orders:80},
  {n:'Lune-Milch GmbH & Co. KG',rev:278987,orders:112},
  {n:'Vanselow Dairy GmbH',rev:275703,orders:25},
  {n:'Milchhof Friesian GmbH & Co. KG',rev:273124,orders:35}
];

export const products = [
  {n:'Pro Elite 60 - GMO Controlled',rev:14554215,qty:0,orders:2402},
  {n:'Pro Elite 40 - GMO Controlled',rev:4478378,qty:0,orders:575},
  {n:'Optima Klima Ställe (OKS)',rev:2099366,qty:473,orders:67},
  {n:'Dairy Kälber TMR HL 18 - GMO Controlled',rev:2093730,qty:0,orders:900},
  {n:'Premium - GMO Controlled',rev:882847,qty:0,orders:81},
  {n:'Dairy Kälber TMR HL 18',rev:524416,qty:0,orders:311},
  {n:'Pro Elite 30 - GMO Controlled',rev:482712,qty:0,orders:123},
  {n:'Dairy Pansen Pro BB - GMO Controlled',rev:465098,qty:0,orders:146},
  {n:'Pro Elite 24 - GMO Controlled',rev:354558,qty:0,orders:12},
  {n:'Matilda Pasteurizer System',rev:317570,qty:58,orders:60}
];

export const categories = [
  {n:'Melkpoeder',rev:21316891,orders:3257},
  {n:'Kalverhuisvesting',rev:3896332,orders:507},
  {n:'Overig veevoer',rev:3300260,orders:2047},
  {n:'Perfect Udder',rev:1060375,orders:1566},
  {n:'Veevoeders',rev:700432,orders:501},
  {n:'Milkbar',rev:414422,orders:1223},
  {n:'Overige artikelen',rev:298355,orders:1934},
  {n:'Kleine Kalverbenodigdheden',rev:285077,orders:2641},
  {n:'Overige Artikelen',rev:39005,orders:583},
  {n:'Aanvullende diervoeders',rev:27143,orders:84},
  {n:'CalfOtel',rev:16680,orders:65},
  {n:'Aanvullende Veevoeders',rev:1654,orders:11},
  {n:'Unknown',rev:1182,orders:18},
  {n:'Geen groep',rev:-406,orders:6}
];

export const PALETTE = [
  '#0891B2', '#0369A1', '#0E7490', '#06B6D4', '#67E8F9',
  '#059669', '#D97706', '#DC2626', '#7C3AED', '#0284C7',
  '#0F766E', '#A16207',
];

export function fmt(n) {
  if (n >= 1e6) return '€' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '€' + Math.round(n / 1e3) + 'K';
  return '€' + n;
}

export function fmtN(n) {
  return n.toLocaleString('de-DE');
}