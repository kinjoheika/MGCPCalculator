// Money helpers. All money is integer centavos.

export function roundHalfUp(x) {
  const v = Number(Number(x).toFixed(6)); // kill float noise like 22477.500000000004
  return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
}

export function toCentavos(pesos) {
  if (pesos === null || pesos === undefined || pesos === '') return null;
  const n = Number(String(pesos).replace(/[₱,\s]/g, ''));
  return Number.isFinite(n) ? roundHalfUp(n * 100) : null;
}

export function fromCentavos(c) {
  return c / 100;
}

export function fmt(c) {
  if (c === null || c === undefined || Number.isNaN(c)) return '—';
  const r = roundHalfUp(c);
  const sign = r < 0 ? '−' : '';
  const abs = Math.abs(r);
  const whole = Math.floor(abs / 100).toLocaleString('en-PH');
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}₱${whole}.${cents}`;
}

export function fmtSigned(c) {
  if (c === null || c === undefined) return '—';
  return (c > 0 ? '+' : '') + fmt(c);
}

export function fmtKg(c) {
  return `${fmt(c)}/kg`;
}

// Plain number string for inputs, e.g. 6550 -> "65.50"
export function toInput(c) {
  if (c === null || c === undefined) return '';
  return (roundHalfUp(c) / 100).toFixed(2);
}
