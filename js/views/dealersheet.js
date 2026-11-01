// Dealer page: one table. Primary rows are the price bases, SRP and Dealer Price; under each, the Price Watch products.
// Columns: Product, Future price, internal pricing (Current, CODO, Dealer pick-up, Semi-dealer), Final price,
// then one column per partner for each category (Dealer-Delivered, Dealer-Pickup). Hover a competitor price to see its photo.
// The tabs choose which category is shown: Dealer-Pickup, Dealer-Delivered, or Both.

import { fmt, toCentavos, toInput } from '../money.js';
import { esc } from '../ui.js';
import { currentPublication, priceFor, marginRule, isStaleReading, fmtDate, userName } from '../pricing.js';
import * as session from '../session.js';
import { bindPhotoHover } from '../photo-hover.js';

const OWN_COLS = [
  { id: 'DEALER',       label: 'Current price',        note: 'Published' },
  { id: 'COBANKIAT',    label: 'CODO pricing',          note: 'CBK pick-up' },
  { id: 'DEALER',       label: 'Dealer pick-up',        note: 'Live' },
  { id: 'RETAIL_OUTLET',label: 'Semi-dealer delivered', note: '' },
];

const CATEGORIES = [
  { id: 'delivered', service: 'Dealer-Delivered', label: 'Dealer-Delivered' },
  { id: 'pickup', service: 'Dealer-Pickup', label: 'Dealer-Pickup' },
];
const BASES = ['SRP', 'Dealer Price'];

const ui = {
  tab: 'both',
  finalPrices: {},
};

// Price Watch products are the parents (Bulk LPG, 50 kg, 11 kg, 2.7 kg). Internal prices use the parent's first active variant.
function watchSkus(s) {
  return s.skus.filter(k => k.active && k.priceWatch);
}
function representative(s, sku) {
  return sku.hasVariants ? (s.skus.find(v => v.parentId === sku.id && v.active) ?? null) : sku;
}

function computedFuturePrice(s, sku, inp) {
  if (!inp || !sku?.contentKg) return null;
  const netPerKg = inp.acq + inp.mar + inp.buf;
  return Math.round(netPerKg * sku.contentKg);
}

function publishedPrice(s, channelId, skuId) {
  const pub = currentPublication(s);
  return pub?.prices?.[channelId]?.find(p => p.skuId === skuId)?.grossPerCyl ?? null;
}

function livePrice(s, channelId, skuId) {
  if (!marginRule(s, channelId, skuId)) return null;
  return priceFor(s, { channelId, skuId }).result?.grossPerCyl ?? null;
}

// Newest Price Watch reading for a partner, product, price basis and category.
function newestReading(s, brand, skuId, basis, service) {
  return (s.competitorReadings || [])
    .filter(r => r.brand === brand && r.skuId === skuId && r.priceBasis === basis && r.service === service)
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1))[0] || null;
}

function diffSpan(price, ref) {
  if (price == null || ref == null) return '';
  const d = price - ref;
  if (d === 0) return '';
  return `<span class="ds-diff ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span>`;
}

function priceTd(grossPerCyl, contentKg, futureRef) {
  if (grossPerCyl == null) return '<td class="num ds-td"><span class="muted">—</span></td>';
  const perKg = contentKg ? Math.round(grossPerCyl / contentKg) : null;
  return `<td class="num ds-td">
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

// One competitor price: the newest reading, with its photo on hover when it has one.
function compTd(s, brand, sku, basis, category, futureCyl, perKgOf, now) {
  const r = newestReading(s, brand, sku.id, basis, category.service);
  if (!r) return '<td class="num ds-td ds-comp-td"><span class="muted">—</span></td>';
  const stale = isStaleReading(s, r, now);
  const perKg = perKgOf ? Math.round(r.pricePerCyl / perKgOf) : null;
  const caption = `${userName(s, r.capturedBy)} · ${fmtDate(r.capturedAt)}`;
  return `<td class="num ds-td ds-comp-td${stale ? ' stale' : ''}"${r.photoPath ? ` data-photo="${esc(r.photoPath)}" data-photo-caption="${esc(caption)}"` : ''} title="${esc(caption)}">
    <span class="cell-price">${fmt(r.pricePerCyl)}</span>${diffSpan(r.pricePerCyl, futureCyl)}
    ${perKg != null ? `<span class="ds-pkg small muted">${fmt(perKg)}/kg</span>` : ''}
    ${stale ? '<span class="pill grey ds-stale-pill">stale</span>' : ''}
  </td>`;
}

export function html(s) {
  const inp = session.get(s);
  const { tab } = ui;
  const tabBar = `<div class="ds-tabs">
    <button type="button" class="tab-btn${tab === 'pickup' ? ' on' : ''}" data-ds-tab="pickup">Dealer-Pickup</button>
    <button type="button" class="tab-btn${tab === 'delivered' ? ' on' : ''}" data-ds-tab="delivered">Dealer-Delivered</button>
    <button type="button" class="tab-btn${tab === 'both' ? ' on' : ''}" data-ds-tab="both">Both</button>
  </div>`;

  const cats = tab === 'both' ? CATEGORIES : CATEGORIES.filter(c => c.id === tab);
  const products = watchSkus(s);
  const partners = [...new Set((s.competitorReadings || [])
    .filter(r => cats.some(c => c.service === r.service)).map(r => r.brand))].sort();
  const partnerCols = Math.max(1, partners.length);
  const now = new Date();
  // Product | Future | internal (4) | Final | one column per partner, for each category.
  const totalCols = 1 + 1 + OWN_COLS.length + 1 + cats.length * partnerCols;

  // One product under a basis. Internal pricing is the same under both bases; the final price is kept per basis and product.
  const productRow = (basis, sku) => {
    const rep = representative(s, sku);
    const futureCyl = rep ? computedFuturePrice(s, rep, inp) : null;
    const own = OWN_COLS.map(col => {
      const price = !rep ? null : col.note === 'Published'
        ? publishedPrice(s, col.id, rep.id)
        : livePrice(s, col.id, rep.id);
      return priceTd(price, rep?.contentKg, futureCyl);
    }).join('');
    const key = `${basis}|${sku.id}`;
    const finalVal = ui.finalPrices[key] ?? '';
    const comp = cats.map(c => partners.length
      ? partners.map(p => compTd(s, p, sku, basis, c, futureCyl, rep?.contentKg, now)).join('')
      : '<td class="num ds-td ds-comp-td"><span class="muted">—</span></td>').join('');
    return `<tr>
      <th scope="row" class="ds-prod-th">${esc(sku.label)}</th>
      ${futureTd(futureCyl, rep?.contentKg)}${own}
      <td class="num ds-td ds-final-col">
        <input class="mini" type="number" min="0" step="1" inputmode="decimal"
          placeholder="—" value="${esc(finalVal)}"
          data-ds-final="${esc(key)}" aria-label="Final price, ${esc(basis)} ${esc(sku.label)}">
      </td>
      ${comp}
    </tr>`;
  };

  const body = BASES.map(basis => `<tr class="ds-basis"><th colspan="${totalCols}" scope="rowgroup">${esc(basis)}</th></tr>`
    + (products.length
      ? products.map(sku => productRow(basis, sku)).join('')
      : `<tr><td colspan="${totalCols}" class="muted">No products are ticked for Price Watch yet. Tick them in Configuration → Products.</td></tr>`)).join('');

  const ownHead = OWN_COLS.map(col => `<th rowspan="2" class="num">${esc(col.label)}</th>`).join('');
  const partnerHead = cats.map(() => partners.length
    ? partners.map(p => `<th class="num ds-comp-sub">${esc(p)}</th>`).join('')
    : '<th class="muted small">No readings yet</th>').join('');

  return `${tabBar}
    <div class="card" style="padding:0;margin-top:12px">
      <div class="table-wrap"><table class="matrix ds-table">
        <thead>
          <tr>
            <th rowspan="2" class="ds-prod-th">Product</th>
            <th rowspan="2" class="num ds-future-col">Future price</th>
            ${ownHead}
            <th rowspan="2" class="num ds-final-col">Final price</th>
            ${cats.map(c => `<th colspan="${partnerCols}" class="center ds-comp-grp">${esc(c.label)}</th>`).join('')}
          </tr>
          <tr>${partnerHead}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table></div>
    </div>
    <p class="small muted" style="margin-top:8px">
      Internal pricing and competitor prices from Price Watch. Hover a competitor price to see its photo. &nbsp;·&nbsp;
      Difference = price minus Future price &nbsp;·&nbsp;
      <span class="pos">+positive</span> = higher &nbsp;·&nbsp;
      <span class="neg">−negative</span> = lower
    </p>`;
}

export function bind(root, rerender) {
  bindPhotoHover(root);
  root.querySelectorAll('[data-ds-tab]').forEach(b => {
    b.onclick = () => { ui.tab = b.dataset.dsTab; rerender(); };
  });

  root.querySelectorAll('[data-ds-final]').forEach(el => {
    const key = el.dataset.dsFinal;
    el.oninput = () => { ui.finalPrices[key] = el.value; };
    el.onblur = () => {
      const c = toCentavos(el.value);
      el.value = c == null ? '' : toInput(c);
      ui.finalPrices[key] = el.value;
    };
  });
}
