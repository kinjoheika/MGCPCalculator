// Generates data/clients.mock.json — the demo client list and competitor readings.
// Keeping it out of data/seed.json means the seed holds configuration (products, channels,
// margins, components, users) while the made-up clients live here and can be regenerated.
//
//   node tools/make-mock-clients.mjs
//
// The random numbers are seeded, so the same command always produces the same file.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'data', 'clients.mock.json');
const TODAY = '2026-09-16';

// ---- Seeded randomness ----
let state = 20260916;
const rnd = () => { state |= 0; state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = list => list[Math.floor(rnd() * list.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = p => rnd() < p;
const round = (n, to) => Math.round(n / to) * to;
const pad = (n, w = 3) => String(n).padStart(w, '0');
const dateOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const ZONES = ['Silang', 'Tagaytay City', 'Plaridel', 'Caloocan', 'Canlubang', 'Dasmariñas', 'Makati'];
const BRANDS = ['Solane', 'Petron Gasul', 'Island Gas', 'DC Starr', 'Regasco'];

const BULK_NAMES = ['ASIA STEEL', 'METRO CERAMICS', 'GOLDEN HARVEST', 'PACIFIC GLASSWORKS', 'EVERGREEN TEXTILE',
  'SUNRISE POULTRY', 'NORTHPOINT PAPER', 'SILVERCREST FOODS', 'MABUHAY RUBBER', 'CRYSTAL BOTTLING',
  'GRANDEUR TILES', 'PRIME AGGREGATES', 'LIBERTY NOODLES', 'SEAWIND CANNERY', 'HIGHLAND DAIRY',
  'FORTUNE PLASTICS', 'BAYANI MILLING', 'ORIENT LAUNDRY SYSTEMS', 'SUMMIT PACKAGING', 'CORDILLERA COFFEE',
  'PEARL GARMENTS', 'VANGUARD METALS', 'ROYALE BAKESHOP COMMISSARY', 'MARIPOSA CHEMICALS', 'TANGLAW GLASS'];
const BULK_TYPES = ['MANUFACTURING CORP.', 'INDUSTRIES INC.', 'PROCESSING PLANT', 'FOODS CORPORATION', 'WORKS INC.'];

const COM_NAMES = ['KUSINA NI ALING ROSA', 'CAFE MARIPOSA', 'ALOHA GRILL', 'LOLA CONSING', "MANANG'S KITCHEN",
  'BAGONG SILANG', 'CASA VERDE', 'MILKY WAY DINER', 'SAN MIGUEL BISTRO', 'PANADERIA DE ORO',
  'TITA BABY', 'GOLDEN SPOON', 'HAPAG IHAW', 'CAFE DE LUNA', 'BAHAY KUBO',
  'PUNTO CENTRAL', 'MASARAP EATERY', 'RIVERSIDE INN', 'BULALOHAN SA KANTO', 'SEASIDE VERANDA',
  'PINOY LUTONG BAHAY', 'THE BREAD STATION', 'CRAVINGS CORNER', 'NANAY LUISA', 'SIZZLING PLATE',
  'GRANDVIEW SUITES', 'LUTONG MACAO', 'FIESTA CARINDERIA', 'CAFE ESCOLTA', 'BALAI SILANGAN'];
const COM_TYPES = ['RESTAURANT', 'BAKERY', 'GRILL HOUSE', 'HOTEL', 'LAUNDRY SERVICES', 'CANTEEN',
  'CATERING SERVICES', 'COFFEE ROASTERY', 'EATERY', 'HOTEL & SUITES', 'FOOD HAUS', 'SNACK BAR'];

const CREDIT_PREMIUM = { 0: null, 7: 'CREDIT_07', 15: 'CREDIT_15', 30: 'CREDIT_30' };

function tanks(scale) {
  const t = {};
  if (scale === 'bulk') {
    if (chance(0.55)) t.tank20000 = between(1, 2);
    if (chance(0.7)) t.tank4000 = between(1, 3);
    if (chance(0.4)) t.tank2000 = between(1, 2);
  } else {
    if (chance(0.5)) t.tank2000 = between(1, 2);
    if (chance(0.6)) t.tank600 = between(1, 4);
    if (chance(0.25)) t.tank3_2mt = 1;
  }
  return t;
}

function makeClient(id, name, channelId, scale) {
  const status = chance(0.87) ? 'Active' : 'Inactive';
  const creditTermDays = pick(scale === 'bulk' ? [15, 30, 30] : [0, 7, 15, 30]);
  const hasContract = scale === 'bulk' ? chance(0.8) : chance(0.35);
  const startY = between(2022, 2026);
  const startM = startY === 2026 ? between(1, 8) : between(1, 12); // never in the future
  const contractStart = hasContract ? dateOf(startY, startM, between(1, 28)) : null;
  const contractEnd = hasContract ? dateOf(startY + pick([3, 5, 5]), startM, between(1, 28)) : null;
  const avgMonthly = chance(0.1) ? null : scale === 'bulk' ? round(between(8000, 60000), 500) : round(between(800, 12000), 100);
  const trmvKg = hasContract ? round((avgMonthly || 6000) * between(30, 60), 1000) : null;

  const premiums = [];
  if (CREDIT_PREMIUM[creditTermDays]) premiums.push({ code: CREDIT_PREMIUM[creditTermDays] });
  const mgcTanks = chance(scale === 'bulk' ? 0.8 : 0.6);
  if (mgcTanks) premiums.push({ code: 'TANK_RENTAL' });
  const investment = mgcTanks && chance(scale === 'bulk' ? 0.6 : 0.3) ? round(between(180000, 2400000), 5000) * 100 : null;
  if (investment && trmvKg) premiums.push({ code: 'ROI_INSTALL', investmentCentavos: investment, note: `Installation ${startY}` });
  if (chance(0.15)) premiums.push({ code: 'CREDIT_RISK', perKg: round(between(25, 90), 5), note: 'Slow payer' });
  if (chance(0.12)) premiums.push({ code: 'REPAIRS' });

  // Discounts are sized against the premiums the client carries, so only a deliberate
  // ~15% of clients end up under the floor — enough to give the exceptions panel something real.
  const CATALOGUE = { CREDIT_07: 50, CREDIT_15: 100, CREDIT_30: 150, TANK_RENTAL: 90, REPAIRS: 100 };
  const premiumTotal = premiums.reduce((t, p) => t + (p.perKg ?? CATALOGUE[p.code] ?? (p.investmentCentavos && trmvKg ? Math.round(p.investmentCentavos / trmvKg) : 0)), 0);
  const belowFloor = chance(0.15);
  let budget = belowFloor ? premiumTotal + round(between(25, 175), 25) : Math.max(0, premiumTotal - round(between(0, 60), 25));

  const discounts = [];
  const competitorBrand = chance(0.45) ? pick(BRANDS) : null;
  const take = share => { const v = round(Math.min(budget, budget * share), 25); budget -= v; return v; };
  if (competitorBrand && budget > 0) { const v = take(0.7); if (v > 0) discounts.push({ code: 'DUAL_SUPPLIER', perKg: v }); }
  if (chance(0.2) && budget > 0) { const v = take(0.6); if (v > 0) discounts.push({ code: 'SUPPLY_ONLY', perKg: v }); }
  if (creditTermDays === 0 && chance(0.7) && budget > 0) { const v = take(1); if (v > 0) discounts.push({ code: 'CASH_ZERO', perKg: v }); }

  return {
    id,
    name,
    status,
    needsAttention: status === 'Active' && chance(0.15),
    channelId,
    zone: pick(ZONES),
    primarySkuId: scale === 'bulk' ? pick(['50KG_A', '50KG_A', '22KG_A']) : pick(['11KG_MGAS', '11KG_MGAS', '50KG_A', '22KG_A', '22KG_FL_A']),
    contractStart,
    contractEnd,
    trmvKg,
    volumeGeneratedKg: trmvKg ? round(trmvKg * (0.2 + rnd() * 0.7), 500) : null,
    avgMonthlyVolumeKg: avgMonthly,
    creditTermDays,
    floorOverridePerKg: null,
    fixedMarginPerKg: scale === 'bulk' && chance(0.08) ? round(between(2200, 3200), 25) : null,
    investmentCentavos: investment,
    reqVolPerMonthKg: hasContract ? round((avgMonthly || 6000) * 1.1, 500) : null,
    premiums,
    discounts,
    competitorBrand,
    profile: {
      installedAt: mgcTanks ? dateOf(startY, startM, between(1, 28)) : null,
      lpgContentBilling: pick(['By meter', 'By weight', 'By delivery receipt']),
      factorRate: (1.6 + rnd() * 0.5).toFixed(2),
      tankOwnership: mgcTanks ? 'MGC-owned' : pick(['Client-owned', 'Leased']),
      ...tanks(scale),
      minKgPerDrop: scale === 'bulk' ? round(between(1000, 4000), 250) : round(between(200, 1200), 50),
    },
  };
}

// The five clients carried over from the original brief, plus five more named ones.
const NAMED = [
  { id: 'acc_alta', name: "ALTA D' TAGAYTAY HOTEL", channelId: 'COMMERCIAL', zone: 'Tagaytay City', status: 'Active', needsAttention: true,
    primarySkuId: '50KG_A', contractStart: '2024-03-19', contractEnd: '2029-03-19', trmvKg: 135000, volumeGeneratedKg: 81250,
    avgMonthlyVolumeKg: null, creditTermDays: 30, premiums: [{ code: 'TANK_RENTAL' }, { code: 'CREDIT_30' }],
    discounts: [{ code: 'DUAL_SUPPLIER', perKg: 625 }], competitorBrand: 'DC Starr' },
  { id: 'acc_kja', name: 'KJA SUMMIT FOOD CORP.', channelId: 'COMMERCIAL', zone: 'Plaridel, Bulacan', status: 'Active', needsAttention: false,
    primarySkuId: '50KG_A', avgMonthlyVolumeKg: 6000, creditTermDays: 15, premiums: [{ code: 'TANK_RENTAL' }],
    discounts: [{ code: 'DUAL_SUPPLIER', perKg: 400 }], competitorBrand: 'Petron' },
  { id: 'acc_silca', name: 'SILCA COFFEE ROASTING COMPANY', channelId: 'COMMERCIAL', zone: 'Silang', status: 'Active', needsAttention: true,
    primarySkuId: '11KG_MGAS', avgMonthlyVolumeKg: 2000, creditTermDays: 30, premiums: [{ code: 'CREDIT_30' }],
    discounts: [{ code: 'DUAL_SUPPLIER', perKg: 400 }], competitorBrand: 'Solane' },
  { id: 'acc_ifp', name: 'IFP MANUFACTURING CORPORATION', channelId: 'COMMERCIAL', zone: 'Caloocan', status: 'Inactive', needsAttention: false,
    primarySkuId: '50KG_A', avgMonthlyVolumeKg: 3050, creditTermDays: 30, premiums: [], discounts: [] },
  { id: 'acc_leslies', name: "LESLIE'S CORPORATION (CANLUBANG)", channelId: 'COMMERCIAL', zone: 'Canlubang', status: 'Active', needsAttention: false,
    primarySkuId: '22KG_FL_A', avgMonthlyVolumeKg: 8000, creditTermDays: 30, premiums: [{ code: 'REPAIRS' }, { code: 'CREDIT_30' }],
    discounts: [{ code: 'DUAL_SUPPLIER', perKg: 675 }] },
  { id: 'acc_jmr', name: 'JMR LPG TRADING', channelId: 'DEALER', zone: 'Dasmariñas', status: 'Active', needsAttention: false,
    primarySkuId: '11KG_MGAS', avgMonthlyVolumeKg: 12000, creditTermDays: 7, premiums: [{ code: 'CREDIT_07' }], discounts: [] },
  { id: 'acc_sanroque', name: 'SAN ROQUE GAS CENTER', channelId: 'DEALER', zone: 'Silang', status: 'Active', needsAttention: false,
    primarySkuId: '11KG_SULIT', avgMonthlyVolumeKg: 9000, creditTermDays: 0, premiums: [],
    discounts: [{ code: 'CASH_ZERO', perKg: 50 }] },
  { id: 'acc_cbk_makati', name: 'COBANKIAT HARDWARE — MAKATI', channelId: 'COBANKIAT', zone: 'Makati', status: 'Active', needsAttention: false,
    primarySkuId: '50KG_A', avgMonthlyVolumeKg: 15000, creditTermDays: 30, premiums: [{ code: 'CREDIT_30' }], discounts: [] },
  { id: 'acc_nena', name: 'ALING NENA SARI-SARI STORE', channelId: 'RETAIL_OUTLET', zone: 'Tagaytay City', status: 'Active', needsAttention: false,
    primarySkuId: '11KG_MGAS', avgMonthlyVolumeKg: null, creditTermDays: 7,
    premiums: [{ code: 'CREDIT_07' }, { code: 'MARKETING' }], discounts: [] },
  { id: 'acc_bayview', name: 'BAYVIEW LPG REFILLING STATION', channelId: 'RETAIL_OUTLET', zone: 'Plaridel, Bulacan', status: 'Inactive', needsAttention: true,
    primarySkuId: '11KG_MGAS', avgMonthlyVolumeKg: 1500, creditTermDays: 15, premiums: [], discounts: [] },
];

const DEFAULTS = {
  contractStart: null, contractEnd: null, trmvKg: null, volumeGeneratedKg: null, floorOverridePerKg: null,
  fixedMarginPerKg: null, investmentCentavos: null, reqVolPerMonthKg: null, competitorBrand: null, profile: {},
};

const accounts = NAMED.map(n => ({ ...DEFAULTS, ...n }));

// 50 bulk clients.
for (let i = 1; i <= 50; i++) {
  const name = `${BULK_NAMES[(i - 1) % BULK_NAMES.length]} ${BULK_TYPES[Math.floor((i - 1) / BULK_NAMES.length) % BULK_TYPES.length]}`;
  accounts.push(makeClient(`acc_bulk_${pad(i)}`, name, 'BULK', 'bulk'));
}

// 120 commercial clients in total, including the five named ones above.
const commercialToMake = 120 - accounts.filter(a => a.channelId === 'COMMERCIAL').length;
for (let i = 1; i <= commercialToMake; i++) {
  const base = COM_NAMES[(i - 1) % COM_NAMES.length];
  const type = COM_TYPES[Math.floor((i - 1) / COM_NAMES.length) % COM_TYPES.length];
  accounts.push(makeClient(`acc_com_${pad(i)}`, `${base} ${type}`, 'COMMERCIAL', 'commercial'));
}

// Competitor readings: three fixed ones from the brief (cr_3 deliberately stale) plus weekly cover elsewhere.
const competitorReadings = [
  { id: 'cr_1', brand: 'Solane', zone: 'Silang', skuId: '11KG_MGAS', pricePerCyl: 105500, capturedAt: '2026-09-09', capturedBy: 'u_msgr_1', photoUrl: 'placeholder.jpg' },
  { id: 'cr_2', brand: 'Petron Gasul', zone: 'Plaridel', skuId: '11KG_MGAS', pricePerCyl: 102000, capturedAt: '2026-09-08', capturedBy: 'u_msgr_1', photoUrl: 'placeholder.jpg' },
  { id: 'cr_3', brand: 'Island Gas', zone: 'Tagaytay City', skuId: '11KG_MGAS', pricePerCyl: 88000, capturedAt: '2026-07-02', capturedBy: 'u_msgr_2', photoUrl: 'placeholder.jpg' },
];
let n = 4;
for (const zone of ZONES) {
  for (const brand of ['Solane', 'Petron Gasul', 'Island Gas']) {
    if (competitorReadings.some(r => r.zone === zone && r.brand === brand)) continue;
    if (chance(0.25)) continue; // leave gaps so the weekly checklist has work to show
    competitorReadings.push({
      id: `cr_${n++}`, brand, zone, skuId: '11KG_MGAS',
      pricePerCyl: round(between(96000, 112000), 500),
      capturedAt: dateOf(2026, 9, between(10, 15)),
      capturedBy: chance(0.5) ? 'u_msgr_1' : 'u_msgr_2',
      photoUrl: 'placeholder.jpg',
    });
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generatedAt: TODAY,
  note: 'Demo clients and competitor readings. Regenerate with: node tools/make-mock-clients.mjs',
  accounts,
  competitorReadings,
}, null, 2) + '\n');

const byChannel = accounts.reduce((m, a) => ({ ...m, [a.channelId]: (m[a.channelId] || 0) + 1 }), {});
console.log(`Wrote ${OUT}`);
console.log(`${accounts.length} clients:`, byChannel);
console.log(`${competitorReadings.length} competitor readings`);
