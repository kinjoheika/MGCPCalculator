// Client terms: the installation and contract fields shown under a client in the pricing grid
// (view only) and edited in Configuration → Clients. One definition, two screens.

import { fmt, toCentavos, toInput } from './money.js';
import { fmtDate } from './pricing.js';

export const TANKS = [
  { key: 'tank3_2mt', label: '3.2 MT', kg: 3200 },
  { key: 'tank600', label: '600 kg', kg: 600 },
  { key: 'tank4000', label: '4,000 kg', kg: 4000 },
  { key: 'tank2000', label: '2,000 kg', kg: 2000 },
  { key: 'tank20000', label: '20,000 kg', kg: 20000 },
];

// top: stored on the client record itself; the rest live in client.profile.
// lever: also moves the price, so it is flagged wherever it is edited.
export const FIELDS = [
  { key: 'installedAt', label: 'Date (installed / activated)', type: 'date' },
  { key: 'lpgContentBilling', label: 'LPG content billing', type: 'text' },
  { key: 'factorRate', label: 'Factor rate', type: 'text' },
  { key: 'tankOwnership', label: 'Tank ownership', type: 'select', choices: ['MGC-owned', 'Client-owned', 'Leased'] },
  ...TANKS.map(t => ({ key: t.key, label: t.label, type: 'int', tank: true })),
  { key: '_usable', label: '60% of tank capacity (90%)', type: 'computed' },
  { key: 'minKgPerDrop', label: 'Minimum kilograms per drop', type: 'int', unit: 'kg' },
  { key: 'fixedMarginPerKg', label: 'Fixed margin', type: 'money', top: true, lever: true },
  { key: 'investmentCentavos', label: 'Total investment', type: 'money', top: true, lever: true },
  { key: 'reqVolPerMonthKg', label: 'Required volume per month', type: 'int', top: true, unit: 'kg' },
  { key: 'contractStart', label: 'Date start', type: 'date', top: true },
  { key: 'volumeGeneratedKg', label: 'Total generated volume', type: 'int', top: true, unit: 'kg', asOf: true },
];

export function labelFor(f) {
  return f.asOf ? `${f.label} as of ${fmtDate(new Date())}` : f.label;
}

export function rawValue(a, f, overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides, f.key)) return overrides[f.key];
  return (f.top ? a[f.key] : a.profile?.[f.key]) ?? null;
}

export function usableKg(a, overrides = {}) {
  const total = TANKS.reduce((t, k) => {
    const raw = Object.prototype.hasOwnProperty.call(overrides, k.key) ? overrides[k.key] : a.profile?.[k.key];
    const n = parseInt(raw ?? 0, 10);
    return t + (Number.isFinite(n) ? n : 0) * k.kg;
  }, 0);
  return total ? Math.round(total * 0.9 * 0.6) : 0;
}

// String for a text input.
export function inputValue(a, f, overrides = {}) {
  const v = rawValue(a, f, overrides);
  if (v == null || v === '') return '';
  return f.type === 'money' ? toInput(v) : String(v);
}

// Formatted for reading.
export function displayValue(a, f, overrides = {}) {
  if (f.type === 'computed') return `${usableKg(a, overrides).toLocaleString('en-PH')} kg`;
  const v = rawValue(a, f, overrides);
  if (v == null || v === '') return '—';
  if (f.type === 'money') return fmt(v);
  if (f.type === 'date') return fmtDate(v);
  if (f.type === 'int') return `${Number(v).toLocaleString('en-PH')}${f.unit ? ` ${f.unit}` : ''}`;
  return String(v);
}

// Input string → stored value.
export function parseValue(f, raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  if (f.type === 'money') return toCentavos(s);
  if (f.type === 'int') {
    const n = Number(s.replace(/[,\s]|kg/gi, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return s;
}
