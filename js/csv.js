// CSV import/export for the clients list. Pure functions over state; the view commits.

import { roundHalfUp, toCentavos } from './money.js';

const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pad = n => String(n).padStart(2, '0');
const peso = c => (c == null ? '' : (c / 100).toFixed(2));

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

export function toCsv(rows) {
  return rows.map(r => r.map(v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

// ---- Column parsers ----

const text = key => raw => ({ [key]: raw || null });

const number = (key, { int = false, money = false } = {}) => raw => {
  if (raw === '') return { [key]: null };
  const n = Number(raw.replace(/[₱,\s]|kgs?|days?/gi, ''));
  if (!Number.isFinite(n) || n < 0) throw new Error(`"${raw}" is not a number`);
  return { [key]: money ? roundHalfUp(n * 100) : int ? Math.round(n) : n };
};

const date = key => raw => {
  if (!raw) return { [key]: null };
  let y, m, d, hit;
  if ((hit = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = hit;
  else if ((hit = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, m, d, y] = hit;
  else {
    const t = new Date(raw);
    if (Number.isNaN(t.getTime())) throw new Error(`"${raw}" is not a date — use YYYY-MM-DD`);
    [y, m, d] = [t.getFullYear(), t.getMonth() + 1, t.getDate()];
  }
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) throw new Error(`"${raw}" is not a date — use YYYY-MM-DD`);
  return { [key]: `${y}-${pad(m)}-${pad(d)}` };
};

const components = (key, listKey, needsAmount) => (raw, s) => {
  if (!raw) return { [key]: [] };
  return {
    [key]: raw.split(/[;|\n]/).map(x => x.trim()).filter(Boolean).map(part => {
      const [name, amt] = part.split('=').map(x => x.trim());
      const comp = s[listKey].find(c => norm(c.code) === norm(name) || norm(c.label) === norm(name));
      if (!comp) throw new Error(`unknown code "${name}" — use ${s[listKey].map(c => c.code).join(', ')}`);
      const out = { code: comp.code };
      if (amt) {
        const v = toCentavos(amt);
        if (v == null || v < 0) throw new Error(`"${amt}" is not an amount`);
        out.perKg = v;
      } else if (needsAmount) throw new Error(`${comp.code} needs an amount, e.g. ${comp.code}=6.25`);
      return out;
    }),
  };
};

const compOut = list => (list || []).map(x => (x.perKg != null ? `${x.code}=${peso(x.perKg)}` : x.code)).join('; ');

export const ACCOUNT_COLUMNS = [
  { key: 'id', header: 'Account ID', aliases: ['id'], hint: 'Optional. Updates the client with this ID', parse: text('id'), out: a => a.id },
  { key: 'name', header: 'Name', aliases: ['customer', 'customer name', 'client', 'client name', 'account', 'account name'], required: true, parse: text('name'), out: a => a.name },
  { key: 'channelId', header: 'Channel', aliases: ['segment', 'price list'], required: true, hint: 'Channel ID, label or audience, e.g. COMMERCIAL or Dealer',
    parse: (raw, s) => {
      if (!raw) throw new Error('is empty');
      const n = norm(raw);
      let hits = s.channels.filter(c => [c.id, c.label, c.audience].some(v => norm(v) === n));
      if (!hits.length) hits = s.channels.filter(c => norm(c.label).startsWith(n) || norm(c.id).startsWith(n));
      if (hits.length !== 1) throw new Error(hits.length ? `"${raw}" matches more than one channel` : `"${raw}" is not a channel — use ${s.channels.map(c => c.id).join(', ')}`);
      return { channelId: hits[0].id };
    }, out: a => a.channelId },
  { key: 'status', header: 'Status', aliases: ['account status'], required: true, hint: 'Active or Inactive. "Active but needs attention" imports as Inactive + needs attention',
    parse: raw => {
      const n = norm(raw);
      if (!n) throw new Error('is empty — use Active or Inactive');
      if (n.includes('attention')) return { status: 'Inactive', _attention: true };
      if (n === 'active') return { status: 'Active' };
      if (['inactive', 'closed', 'terminated', 'lost', 'dormant', 'suspended'].includes(n)) return { status: 'Inactive' };
      throw new Error(`"${raw}" — use Active or Inactive`);
    }, out: a => a.status },
  { key: 'needsAttention', header: 'Needs attention', aliases: ['attention'], hint: 'Yes or No',
    parse: raw => {
      const n = norm(raw);
      if (!n || ['no', 'n', 'false', '0'].includes(n)) return { needsAttention: false };
      if (['yes', 'y', 'true', '1', 'x'].includes(n)) return { needsAttention: true };
      throw new Error(`"${raw}" — use Yes or No`);
    }, out: a => (a.needsAttention ? 'Yes' : 'No') },
  { key: 'zone', header: 'Zone', aliases: ['area', 'location', 'city'], parse: text('zone'), out: a => a.zone },
  { key: 'primarySkuId', header: 'Main product', aliases: ['primary product', 'product', 'sku'], hint: 'SKU ID or label, e.g. 11KG_MGAS',
    parse: (raw, s) => {
      if (!raw) return { primarySkuId: null };
      const hit = s.skus.find(k => norm(k.id) === norm(raw) || norm(k.label) === norm(raw));
      if (!hit) throw new Error(`"${raw}" is not a product`);
      return { primarySkuId: hit.id };
    }, out: a => a.primarySkuId },
  { key: 'contractStart', header: 'Contract start', aliases: ['start', 'contract start date'], hint: 'YYYY-MM-DD or M/D/YYYY', parse: date('contractStart'), out: a => a.contractStart },
  { key: 'contractEnd', header: 'Contract end', aliases: ['end', 'contract end date', 'expiry'], hint: 'YYYY-MM-DD or M/D/YYYY', parse: date('contractEnd'), out: a => a.contractEnd },
  { key: 'trmvKg', header: 'TRMV kg', aliases: ['trmv', 'total required minimum volume'], parse: number('trmvKg'), out: a => a.trmvKg },
  { key: 'volumeGeneratedKg', header: 'Volume generated kg', aliases: ['volume generated'], parse: number('volumeGeneratedKg'), out: a => a.volumeGeneratedKg },
  { key: 'avgMonthlyVolumeKg', header: 'Avg monthly volume kg', aliases: ['avg monthly volume', 'average monthly volume', 'monthly volume'], hint: 'Blank is excluded from peso impact, never treated as zero', parse: number('avgMonthlyVolumeKg'), out: a => a.avgMonthlyVolumeKg },
  { key: 'creditTermDays', header: 'Credit term days', aliases: ['credit term', 'credit terms', 'terms'], parse: number('creditTermDays', { int: true }), out: a => a.creditTermDays },
  { key: 'floorOverridePerKg', header: 'Floor override per kg', aliases: ['floor override', 'floor'], hint: '₱/kg', parse: number('floorOverridePerKg', { money: true }), out: a => peso(a.floorOverridePerKg) },
  { key: 'premiums', header: 'Premiums', hint: 'Codes separated by ; — optional =₱/kg, e.g. TANK_RENTAL; CREDIT_30', parse: components('premiums', 'premiumComponents', false), out: a => compOut(a.premiums) },
  { key: 'discounts', header: 'Discounts', hint: 'CODE=₱/kg separated by ;, e.g. DUAL_SUPPLIER=6.25', parse: components('discounts', 'discountComponents', true), out: a => compOut(a.discounts) },
  { key: 'competitorBrand', header: 'Competitor brand', aliases: ['competitor', 'other supplier'], parse: text('competitorBrand'), out: a => a.competitorBrand },
  { key: 'investmentCentavos', header: 'Installation investment', aliases: ['investment'], hint: '₱ — feeds the ROI installation premium', parse: number('investmentCentavos', { money: true }), out: a => peso(a.investmentCentavos) },
  { key: 'entrustedCylCount', header: 'Entrusted cylinders', hint: 'Count — feeds the entrusted cylinders premium', parse: number('entrustedCylCount', { int: true }), out: a => a.entrustedCylCount },
  { key: 'cylCostCentavos', header: 'Cylinder cost', hint: '₱ per cylinder', parse: number('cylCostCentavos', { money: true }), out: a => peso(a.cylCostCentavos) },
];

const DEFAULTS = {
  status: 'Active', needsAttention: false, channelId: null, zone: null, primarySkuId: null,
  contractStart: null, contractEnd: null, trmvKg: null, volumeGeneratedKg: null, avgMonthlyVolumeKg: null,
  creditTermDays: null, floorOverridePerKg: null, premiums: [], discounts: [], competitorBrand: null,
};

export function newAccount(accounts, patch) {
  const { _newId, ...rest } = patch;
  const base = _newId || 'acc_' + (norm(rest.name).slice(0, 24) || 'client');
  let id = base, i = 2;
  while (accounts.some(a => a.id === id)) id = `${base}_${i++}`;
  return { id, ...DEFAULTS, ...rest };
}

const priced = (s, channelId, skuId) => s.marginRules.some(r => r.channelId === channelId && r.skuId === skuId && r.effectiveTo == null);

export function rowsToAccounts(s, table) {
  if (!table.length) return { fatal: 'The file is empty' };
  const map = [], ignored = [];
  table[0].forEach((h, i) => {
    const n = norm(h);
    const col = ACCOUNT_COLUMNS.find(c => norm(c.header) === n || (c.aliases || []).some(a => norm(a) === n));
    if (col && !map.some(m => m && m.key === col.key)) map[i] = col;
    else if (h.trim()) ignored.push(h.trim());
  });
  const present = new Set(map.filter(Boolean).map(c => c.key));
  const missing = ACCOUNT_COLUMNS.filter(c => c.required && !present.has(c.key)).map(c => c.header);
  if (missing.length) return { fatal: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. The first row must be the header row.` };

  const seen = new Map();
  const results = table.slice(1).map((cells, idx) => {
    const rowNo = idx + 2;
    const errors = [], warnings = [], patch = {};
    map.forEach((col, i) => {
      if (!col) return;
      try { Object.assign(patch, col.parse((cells[i] ?? '').trim(), s)); } catch (e) { errors.push(`${col.header}: ${e.message}`); }
    });
    if (patch._attention) { patch.needsAttention = true; delete patch._attention; }
    if (!patch.name && !errors.some(e => e.startsWith('Name'))) errors.push('Name is empty');

    let matchId = null;
    if (patch.id) {
      if (s.accounts.some(a => a.id === patch.id)) matchId = patch.id;
      else { patch._newId = norm(patch.id) ? patch.id.replace(/[^\w.-]/g, '_') : undefined; warnings.push(`Account ID ${patch.id} not found — added as new`); }
    }
    delete patch.id;
    if (!matchId && patch.name) matchId = s.accounts.find(a => norm(a.name) === norm(patch.name))?.id ?? null;

    const key = matchId || norm(patch.name);
    if (key && seen.has(key)) errors.push(`Duplicate of row ${seen.get(key)}`);
    else if (key) seen.set(key, rowNo);

    const existing = matchId ? s.accounts.find(a => a.id === matchId) : null;
    const ch = patch.channelId ?? existing?.channelId;
    const sku = present.has('primarySkuId') ? patch.primarySkuId : existing?.primarySkuId;
    if (ch && sku && !priced(s, ch, sku)) warnings.push(`${s.skus.find(k => k.id === sku)?.label} is not priced on ${s.channels.find(c => c.id === ch)?.label}`);
    if (ch && !sku && !errors.length) {
      const fallback = priced(s, ch, '11KG_MGAS') ? '11KG_MGAS' : s.skus.find(k => priced(s, ch, k.id))?.id;
      if (fallback) { patch.primarySkuId = fallback; warnings.push(`Main product not set — using ${s.skus.find(k => k.id === fallback).label}`); }
    }
    return { rowNo, name: patch.name || '', channelId: patch.channelId, status: patch.status, action: errors.length ? 'error' : matchId ? 'update' : 'add', errors, warnings, patch, matchId };
  });
  return { rowCount: results.length, ignored, results };
}

export function accountsToRows(accounts) {
  return [ACCOUNT_COLUMNS.map(c => c.header), ...accounts.map(a => ACCOUNT_COLUMNS.map(c => c.out(a) ?? ''))];
}

export function templateRows() {
  return accountsToRows([
    { id: '', name: 'SAMPLE HOTEL INC.', channelId: 'COMMERCIAL', status: 'Active', needsAttention: false, zone: 'Tagaytay City', primarySkuId: '50KG_A',
      contractStart: '2026-01-15', contractEnd: '2029-01-15', trmvKg: 120000, volumeGeneratedKg: 18000, avgMonthlyVolumeKg: 4000, creditTermDays: 30,
      floorOverridePerKg: null, premiums: [{ code: 'TANK_RENTAL' }, { code: 'CREDIT_30' }], discounts: [{ code: 'DUAL_SUPPLIER', perKg: 625 }],
      competitorBrand: 'Solane', investmentCentavos: 15000000, entrustedCylCount: 20, cylCostCentavos: 450000 },
    { id: '', name: 'SAMPLE LPG DEALER', channelId: 'DEALER', status: 'Active but needs attention', needsAttention: true, zone: 'Silang', primarySkuId: '11KG_MGAS',
      avgMonthlyVolumeKg: 9000, creditTermDays: 7, premiums: [{ code: 'CREDIT_07' }], discounts: [] },
  ]);
}
