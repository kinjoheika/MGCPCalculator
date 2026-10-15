// The row of number fields at the top of Bulk, Commercial and Dealer pricing: Acq, Hauling cost, Total Acq, Margin, Buffer.
// One set of values shared by all three pages, kept in this browser so it is still there after saving or switching page.
// Total Acq = Acq + Hauling cost. A blank Hauling cost means the current hauling cost.

import { toCentavos, toInput } from './money.js';
import { esc, toast } from './ui.js';
import { currentCostBasis } from './pricing.js';

const KEY = 'mgc_pricing_row_inputs';
const v = { acq: '', hauling: '', margin: '', buffer: '' };
try { Object.assign(v, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* start empty */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } };

const haulingOf = s => toCentavos(v.hauling) ?? currentCostBasis(s)?.haulingPerKg ?? 0;

// For the future-price formulas: acq is Total Acq (Acq + Hauling), mar is Margin, buf is Buffer. Null until all three are filled.
export function get(s) {
  const acq = toCentavos(v.acq), mar = toCentavos(v.margin), buf = toCentavos(v.buffer);
  if (acq == null || mar == null || buf == null) return null;
  return { acq: acq + haulingOf(s), mar, buf };
}

export function barHtml(s, { saveDisabled = false } = {}) {
  const cb = currentCostBasis(s);
  const acq = toCentavos(v.acq);
  const total = acq == null ? '' : toInput(acq + haulingOf(s));
  const field = (id, label, key, ph) => `<label class="rw-lbl"><span>${label}</span><input type="number" id="${id}" min="0" step="0.01" inputmode="decimal" placeholder="${ph}" value="${esc(v[key])}"></label>`;
  return `<div class="row-inputs">
    ${field('rw-acq', 'Acq ₱/kg', 'acq', '0.00')}
    ${field('rw-haul', 'Hauling cost ₱/kg', 'hauling', cb ? toInput(cb.haulingPerKg) : '0.00')}
    <label class="rw-lbl"><span>Total Acq ₱/kg</span><input type="text" id="rw-total" class="rw-total" readonly tabindex="-1" placeholder="Acq + Hauling" value="${esc(total)}"></label>
    ${field('rw-margin', 'Margin ₱/kg', 'margin', '0.00')}
    ${field('rw-buf', 'Buffer ₱/kg', 'buffer', '0.00')}
    <button type="button" id="cg-save" class="primary small" ${saveDisabled ? 'disabled' : ''}>Save</button>
  </div>`;
}

// onSave replaces the Save button's action (the client grid has its own save).
export function bind(root, rerender, { onSave } = {}) {
  [['rw-acq', 'acq'], ['rw-haul', 'hauling'], ['rw-margin', 'margin'], ['rw-buf', 'buffer']].forEach(([id, key]) => {
    const el = root.querySelector('#' + id);
    if (!el) return;
    el.oninput = () => { v[key] = el.value; persist(); rerender(); };
    el.onblur = () => {
      const c = toCentavos(el.value);
      el.value = c == null ? '' : toInput(c);
      v[key] = el.value;
      persist();
    };
  });
  const save = root.querySelector('#cg-save');
  if (save && onSave) save.onclick = onSave;
}

export const savedToast = () => toast('Saved');
