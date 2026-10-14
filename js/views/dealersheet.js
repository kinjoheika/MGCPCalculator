// Dealer pricing comparison sheet.
// Tabs: Mgas / Sulit Gas / Both
// Columns: Future price | Current price | CODO pricing | Dealer pick-up | Semi-dealer | 4 competitors | Final price

import { fmt, toCentavos, toInput } from '../money.js';
import { esc } from '../ui.js';
import { byId, currentPublication, priceFor, marginRule, isStaleReading, fmtDate } from '../pricing.js';

const OWN_COLS = [
  { id: 'DEALER',       label: 'Current price',        note: 'Published' },
  { id: 'COBANKIAT',    label: 'CODO pricing',          note: 'CBK pick-up' },
  { id: 'DEALER',       label: 'Dealer pick-up',        note: 'Live' },
  { id: 'RETAIL_OUTLET',label: 'Semi-dealer delivered', note: '' },
];

const COMP_BRANDS = ['Solane LPG', 'PryceGas', 'Phoenix', 'Petron Gasul'];

const MGAS_SKUS  = ['50KG_A', '11KG_MGAS', '2.7KG'];
const SULIT_SKUS = ['11KG_SULIT', '5KG_SULIT', '2.7KG_SULIT'];

const ui = {
  tab: 'mgas',
  acqInput: '',
  marginInput: '',
  bufferInput: '',
  finalPrices: {},
};

function sessionInputs() {
  const acq = toCentavos(ui.acqInput);
  const mar = toCentavos(ui.marginInput);
  const buf = toCentavos(ui.bufferInput);
  if (acq == null || mar == null || buf == null) return null;
  return { acq, mar, buf };
}

function computedFuturePrice(s, sku, inp) {
  if (!inp || !sku?.contentKg) return null;
  const netPerKg = inp.acq + inp.mar + inp.buf;
  const netPerCyl = Math.round(netPerKg * sku.contentKg);
  const vatRate = s.settings.vatRate || 0;
  const vatInclusive = s.settings.vatInclusive !== false;
  const vatPerCyl = vatInclusive ? Math.round(netPerCyl * vatRate) : 0;
  return netPerCyl + vatPerCyl;
}

function publishedPrice(s, channelId, skuId) {
  const pub = currentPublication(s);
  return pub?.prices?.[channelId]?.find(p => p.skuId === skuId)?.grossPerCyl ?? null;
}

function livePrice(s, channelId, skuId) {
  if (!marginRule(s, channelId, skuId)) return null;
  return priceFor(s, { channelId, skuId }).result?.grossPerCyl ?? null;
}

function newestCompReading(s, brand, skuId) {
  return (s.competitorReadings || [])
    .filter(r => r.brand === brand && r.skuId === skuId)
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1))[0] || null;
}

function skusForTab(s, tab) {
  const ids = tab === 'mgas' ? MGAS_SKUS : tab === 'sulit' ? SULIT_SKUS : [...MGAS_SKUS, ...SULIT_SKUS];
  return ids.map(id => byId(s.skus, id)).filter(Boolean);
}

function diffSpan(price, ref) {
  if (price == null || ref == null) return '';
  const d = price - ref;
  if (d === 0) return '';
  return `<span class="ds-diff ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span>`;
}

function priceTd(grossPerCyl, contentKg, futureRef, extraCls = '') {
  if (grossPerCyl == null) return `<td class="num ds-td ${extraCls}"><span class="muted">—</span></td>`;
  const perKg = contentKg ? Math.round(grossPerCyl / contentKg) : null;
  return `<td class="num ds-td ${extraCls}">
    <span class="cell-price">${fmt(grossPerCyl)}</span>${diffSpan(grossPerCyl, futureRef)}
    ${perKg != null ? `<span class="ds-pkg small muted">${fmt(perKg)}/kg</span>` : ''}
  </td>`;
}

function futureTd(grossPerCyl, contentKg) {
  if (grossPerCyl == null) return '<td class="num ds-td ds-future-col"><span class="muted small">—</span></td>';
  const perKg = contentKg ? Math.round(grossPerCyl / contentKg) : null;
  return `<td class="num ds-td ds-future-col">
    <span class="cell-price cell-future">${fmt(grossPerCyl)}</span>
    ${perKg != null ? `<span class="ds-pkg small muted">${fmt(perKg)}/kg</span>` : ''}
  </td>`;
}

export function html(s) {
  const inp = sessionInputs();
  const { tab } = ui;
  const skus = skusForTab(s, tab);
  const now = new Date();

  const tabBar = `<div class="ds-tabs">
    <button type="button" class="tab-btn${tab === 'mgas'  ? ' on' : ''}" data-ds-tab="mgas">Mgas</button>
    <button type="button" class="tab-btn${tab === 'sulit' ? ' on' : ''}" data-ds-tab="sulit">Sulit Gas</button>
    <button type="button" class="tab-btn${tab === 'both'  ? ' on' : ''}" data-ds-tab="both">Both</button>
  </div>`;

  const toolbar = `<div class="cg-sess ds-sess">
    <label class="cg-sess-lbl"><span>Acq ₱/kg</span>
      <input type="number" min="0" step="0.01" inputmode="decimal" id="ds-acq"
        placeholder="0.00" value="${esc(ui.acqInput)}"></label>
    <label class="cg-sess-lbl"><span>Margin ₱/kg</span>
      <input type="number" min="0" step="0.01" inputmode="decimal" id="ds-mar"
        placeholder="0.00" value="${esc(ui.marginInput)}"></label>
    <label class="cg-sess-lbl"><span>Buffer ₱/kg</span>
      <input type="number" min="0" step="0.01" inputmode="decimal" id="ds-buf"
        placeholder="0.00" value="${esc(ui.bufferInput)}"></label>
  </div>`;

  const rows = skus.map(sku => {
    const futureCyl = computedFuturePrice(s, sku, inp);
    const futureCell = futureTd(futureCyl, sku.contentKg);

    const ownCells = OWN_COLS.map(col => {
      const price = col.note === 'Published'
        ? publishedPrice(s, col.id, sku.id)
        : livePrice(s, col.id, sku.id);
      return priceTd(price, sku.contentKg, futureCyl);
    }).join('');

    const compCells = COMP_BRANDS.map(brand => {
      const r = newestCompReading(s, brand, sku.id);
      if (!r) return '<td class="num ds-td ds-comp-td"><span class="muted">—</span></td>';
      const stale = isStaleReading(s, r, now);
      const perKg = sku.contentKg ? Math.round(r.pricePerCyl / sku.contentKg) : null;
      return `<td class="num ds-td ds-comp-td${stale ? ' stale' : ''}">
        <span class="cell-price">${fmt(r.pricePerCyl)}</span>${diffSpan(r.pricePerCyl, futureCyl)}
        ${perKg != null ? `<span class="ds-pkg small muted">${fmt(perKg)}/kg</span>` : ''}
        ${stale ? `<span class="pill grey ds-stale-pill" title="${esc(fmtDate(r.capturedAt))}">stale</span>` : ''}
      </td>`;
    }).join('');

    const finalVal = ui.finalPrices[sku.id] ?? '';
    const finalCell = `<td class="num ds-td ds-final-col">
      <input class="mini" type="number" min="0" step="1" inputmode="decimal"
        placeholder="—" value="${esc(finalVal)}"
        data-ds-final="${esc(sku.id)}" aria-label="Final price for ${esc(sku.label)}">
    </td>`;

    return `<tr>
      <th scope="row" class="ds-prod-th">${esc(sku.label)}</th>
      ${futureCell}${ownCells}${compCells}${finalCell}
    </tr>`;
  }).join('');

  const ownHead = OWN_COLS.map(col => `<th class="num">${esc(col.label)}</th>`).join('');
  const compHead = COMP_BRANDS.map(b => `<th class="num ds-comp-sub">${esc(b)}</th>`).join('');

  return `<div class="ds-head one-row">${tabBar}${toolbar}</div>
  <div class="card" style="padding:0;margin-top:12px">
    <div class="table-wrap"><table class="matrix ds-table">
      <thead>
        <tr>
          <th rowspan="2" class="ds-prod-th">Product</th>
          <th rowspan="2" class="num ds-future-col">Future price</th>
          ${ownHead}
          <th colspan="${COMP_BRANDS.length}" class="center ds-comp-grp">Competitors</th>
          <th rowspan="2" class="num ds-final-col">Final price</th>
        </tr>
        <tr>${compHead}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>
  <p class="small muted" style="margin-top:8px">
    Competitor prices from Price Watch &nbsp;·&nbsp;
    Difference = column price minus Future price &nbsp;·&nbsp;
    <span class="pos">+positive</span> = competitor higher &nbsp;·&nbsp;
    <span class="neg">−negative</span> = competitor lower
  </p>`;
}

export function bind(root, rerender) {
  root.querySelectorAll('[data-ds-tab]').forEach(b => {
    b.onclick = () => { ui.tab = b.dataset.dsTab; rerender(); };
  });

  const wire = (id, key) => {
    const el = root.querySelector(`#${id}`);
    if (!el) return;
    el.oninput = e => { ui[key] = e.target.value; rerender(); };
  };
  wire('ds-acq', 'acqInput');
  wire('ds-mar', 'marginInput');
  wire('ds-buf', 'bufferInput');

  root.querySelectorAll('[data-ds-final]').forEach(el => {
    const skuId = el.dataset.dsFinal;
    el.oninput = () => { ui.finalPrices[skuId] = el.value; };
    el.onblur = () => {
      const c = toCentavos(el.value);
      el.value = c == null ? '' : toInput(c);
      ui.finalPrices[skuId] = el.value;
    };
  });
}
