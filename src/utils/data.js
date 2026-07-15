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
  {m:'Jul 26',rev:652451,orders:341}
];

export const salesreps = [
  {n:'Johan Hoogendoorn',rev:10436968,qty:39696,orders:2581},
  {n:'Edo Steenbergen',rev:6006964,qty:15616,orders:2254},
  {n:'Bärbel Achelpöhler',rev:3785466,qty:27777,orders:2246},
  {n:'Karen Hoogendoorn',rev:3203571,qty:3472,orders:1574},
  {n:'Brugt Pilat',rev:2526233,qty:6555,orders:1851},
  {n:'Orsi Hongarije',rev:2524607,qty:1480,orders:317},
  {n:'Sharon Harberink',rev:1531830,qty:3385,orders:1043},
  {n:'Beeke Gerdes',rev:1140522,qty:3371,orders:936},
  {n:'Webshop',rev:254548,qty:5322,orders:1525},
  {n:'Leon',rev:142284,qty:283,orders:132},
  {n:'Emily Gaasbeek',rev:16503,qty:0,orders:9},
  {n:'Unknown',rev:13924,qty:0,orders:113},
  {n:'Kantoor',rev:-606,qty:-17,orders:4}
];

export const customers = [
  {n:'Gut Trossin VGmbH',rev:1010900,orders:130},
  {n:'Lübars Agrar GmbH',rev:1000636,orders:95},
  {n:'Gut Hohen Luckow Milch GmbH & Co KG',rev:848636,orders:88},
  {n:'The Calf Company (Europe) Ltd',rev:602118,orders:75},
  {n:'Nyakas Farm Kft.',rev:557430,orders:38},
  {n:'Agrarunternehmen Starbach-Sachsen eG',rev:555700,orders:41},
  {n:'Lenzener Wische Rinderzucht GmbH',rev:546009,orders:82},
  {n:'Aalberts-Krap GmbH',rev:440959,orders:133},
  {n:'CLA Milk Kft.',rev:419436,orders:15},
  {n:'Agrargenossenschaft eG Tucheim',rev:356509,orders:22},
  {n:'Agrarproduktion Stäbelow GmbH',rev:336877,orders:64},
  {n:'Milchgut Reichenbach GmbH',rev:308397,orders:80},
  {n:'Lune-Milch GmbH & Co. KG',rev:280379,orders:116},
  {n:'Vanselow Dairy GmbH',rev:275703,orders:25},
  {n:'Milchhof Friesian GmbH & Co. KG',rev:273124,orders:35}
];

export const products = [
  {n:'Pro Elite 60 - GMO Controlled',rev:14604813,qty:0,orders:2414},
  {n:'Pro Elite 40 - GMO Controlled',rev:4487078,qty:0,orders:576},
  {n:'Optima Klima Ställe (OKS)',rev:2164265,qty:473,orders:70},
  {n:'Dairy Kälber TMR HL 18 - GMO Controlled',rev:2093730,qty:0,orders:900},
  {n:'Premium - GMO Controlled',rev:882847,qty:0,orders:81},
  {n:'Dairy Kälber TMR HL 18',rev:528655,qty:0,orders:315},
  {n:'Pro Elite 30 - GMO Controlled',rev:483462,qty:0,orders:124},
  {n:'Dairy Pansen Pro BB - GMO Controlled',rev:465098,qty:0,orders:146},
  {n:'Pro Elite 24 - GMO Controlled',rev:421602,qty:0,orders:13},
  {n:'Matilda Pasteurizer System',rev:317570,qty:58,orders:60}
];

export const categories = [
  {n:'Melkpoeder',rev:21443983,orders:3272},
  {n:'Kalverhuisvesting',rev:3961231,orders:510},
  {n:'Overig veevoer',rev:3300260,orders:2047},
  {n:'Perfect Udder',rev:1075619,orders:1590},
  {n:'Veevoeders',rev:706877,orders:516},
  {n:'Milkbar',rev:419492,orders:1233},
  {n:'Overige artikelen',rev:298355,orders:1934},
  {n:'Kleine Kalverbenodigdheden',rev:287817,orders:2662},
  {n:'Overige Artikelen',rev:42613,orders:636},
  {n:'Aanvullende diervoeders',rev:27143,orders:84},
  {n:'CalfOtel',rev:16680,orders:65},
  {n:'Aanvullende Veevoeders',rev:1969,orders:12},
  {n:'Unknown',rev:1182,orders:18},
  {n:'Geen groep',rev:-406,orders:6}
];

export const totalClients = 1355;

export const PALETTE = [
  '#0891B2', '#0369A1', '#0E7490', '#06B6D4', '#67E8F9',
  '#059669', '#D97706', '#DC2626', '#7C3AED', '#0284C7',
  '#0F766E', '#A16207',
];

export function fmt(n) {
  if (n >= 1e6) return '€' + (n / 1e6).toFixed(2) + 'M';
  return '€' + n.toLocaleString('en-US');
}

export function fmtN(n) {
  return n.toLocaleString('en-US');
}

export function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  return n.toLocaleString('en-US');
}

export const legendClickHandler = function(e, legendItem, legend) {
  const index = legendItem.index;
  const ci = legend.chart;
  const meta = ci.getDatasetMeta(0);
  
  const visibleCount = meta.data.filter(d => !d.hidden).length;
  const isOnlyOneVisible = visibleCount === 1 && !meta.data[index].hidden;
  
  if (isOnlyOneVisible) {
    meta.data.forEach(d => d.hidden = false);
  } else {
    meta.data.forEach((d, i) => d.hidden = i !== index);
  }
  ci.update();
  return false;
};

export const multiLegendClickHandler = function(e, legendItem, legend) {
  const index = legendItem.datasetIndex;
  const ci = legend.chart;
  
  const visibleCount = ci.data.datasets.filter(d => !d.hidden).length;
  const isOnlyOneVisible = visibleCount === 1 && !ci.data.datasets[index].hidden;
  
  if (isOnlyOneVisible) {
    ci.data.datasets.forEach(d => d.hidden = false);
  } else {
    ci.data.datasets.forEach((d, i) => d.hidden = i !== index);
  }
  ci.update();
  return false;
};

export const getLegendOptions = (position = 'bottom') => ({
  position: position,
  labels: { boxWidth: 10, padding: 10, color: '#334E5A', font: { size: 10 } },
  onClick: legendClickHandler
});