// Client pricing grid — every client of one channel on a single page.
// Rows are clients; columns are the line types. Fields open with the client's last saved amounts.
// One Save button: price levers go into the open MPL proposal, the rest is saved as client terms.

import * as store from '../store.js';
import { fmt, fmtKg, toCentavos, toInput } from '../money.js';
import { esc, toast, preserveFocus } from '../ui.js';
import { byId, priceFor, currentCostBasis, bufferFor, channelLabel, skuLabel, marginRule, fmtDate, currentPublication, subVersionsOf, subLabel, VOLUME_BANDS, clientSkus, latestSubVersion, approvedPrice } from '../pricing.js';
import { derivePremiumPerKg } from '../engine.js';
import { FIELDS, labelFor, displayValue } from '../clientterms.js';
import { inRange, rangeActive, rangeBar } from '../pricerange.js';
import * as wizard from './priceroom-wizard.js';
import * as dealer from './dealersheet.js';
import * as session from '../session.js';
import { level, canEdit as canEditPart } from '../access.js';

const ui = { channelId: 'COMMERCIAL', expanded: {}, rows: {}, prod: {}, filterQuery: '', selectedIds: null, filterOpen: false, filterScroll: 0, acqInput: '', marginInput: '', bufferInput: '', histOpen: false, prodFilter: [], prodQuery: '', prodOpen: false, termsFor: null, termsOpen: false };

// Every product any Commercial client buys, smallest pack first.
function commercialProducts(s) {
  const used = new Map();
  for (const a of s.accounts.filter(x => x.channelId === 'COMMERCIAL')) for (const k of clientProducts(s, a)) used.set(k.id, k);
  return [...used.values()].sort((x, y) => (x.contentKg - y.contentKg) || x.label.localeCompare(y.label));
}

// Product options for the Products filter, narrowed by its search box.
function prodOptions(list) {
  const q = ui.prodQuery.trim().toLowerCase();
  return list.filter(k => !q || k.label.toLowerCase().includes(q)).map(k =>
    `<label class="multi-opt"><input type="checkbox" data-cg-prod="${esc(k.id)}" ${ui.prodFilter.includes(k.id) ? 'checked' : ''}><span class="grow">${esc(k.label)}</span></label>`).join('')
    || '<span class="muted small">No product matches</span>';
}

// Two column groups, each with its own subcolumns. Every cell takes as many rows as the client needs.
const PREMIUM_COLS = [
  { code: 'ROI_INSTALL', title: 'Installation cost for ROI', note: 'Investment ₱ · ₱/kg · note', roi: true },
  { code: 'CREDIT_RISK', title: 'Credit risk / bad debts', note: '₱/kg · note' },
];
const DISCOUNT_COLS = [
  { code: 'SUPPLY_ONLY', title: 'Supply only', note: '₱/kg · note' },
  { code: 'DUAL_SUPPLIER', title: 'Competition (dual supplier)', note: '₱/kg · note' },
  { code: 'CASH_ZERO', title: 'Cash / zero-rated (short term)', note: '₱/kg · note' },
];
const COLS = [...PREMIUM_COLS, ...DISCOUNT_COLS];
// Which access part governs each column (see js/access.js).
const PART_OF = { ROI_INSTALL: 'cp_premiums', CREDIT_RISK: 'cp_premiums', SUPPLY_ONLY: 'cp_supply', DUAL_SUPPLIER: 'cp_compete', CASH_ZERO: 'cp_cash' };
const lvl = (s, code) => level(s, store.currentUser(), PART_OF[code]);
const editable = (s, code) => lvl(s, code) >= 2;

// Field definitions live in clientterms.js; this screen only reads them.

export function setChannel(id) {
  ui.channelId = id;
}

export function isFilterOpen() { return ui.filterOpen || ui.prodOpen; }
export function closeFilter() { ui.filterOpen = false; ui.prodOpen = false; }

// ---- Editing state: drafts start from what is saved, so fields open pre-filled ----

const rowKey = (accId, code) => `${accId}|${code}`;
const listFor = (a, code) => (DISCOUNT_COLS.some(c => c.code === code) ? a.discounts : a.premiums) || [];

function currentRows(a, code) {
  return listFor(a, code).filter(p => p.code === code).map(p => ({
    perKg: p.perKg == null ? '' : toInput(p.perKg),
    investment: p.investmentCentavos ? toInput(p.investmentCentavos) : '',
    note: p.note || '',
  }));
}

function draftRows(a, code) {
  return ui.rows[rowKey(a.id, code)] ?? currentRows(a, code);
}

function editRows(a, code) {
  const k = rowKey(a.id, code);
  if (!ui.rows[k]) ui.rows[k] = currentRows(a, code);
  if (!ui.rows[k].length) ui.rows[k] = [{ perKg: '', investment: '', note: '' }];
  return ui.rows[k];
}

// Live total of every premium on the client: the two grid columns plus any other premium it carries,
// including premiums that take their rate from the catalogue or from a formula.
export function premiumTotal(s, a) {
  let total = 0;
  const gridCodes = PREMIUM_COLS.map(c => c.code);
  for (const col of PREMIUM_COLS) {
    for (const r of draftRows(a, col.code)) {
      const perKg = toCentavos(r.perKg);
      if (perKg != null) { total += perKg; continue; }
      const investment = toCentavos(r.investment);
      if (investment && a.trmvKg) total += Math.round(investment / a.trmvKg);
    }
  }
  const other = (a.premiums || []).filter(p => !gridCodes.includes(p.code));
  const otherTotal = other.reduce((t, p) => {
    const comp = s.premiumComponents.find(c => c.code === p.code);
    const perKg = p.perKg ?? (comp ? derivePremiumPerKg(comp, { ...a, investmentCentavos: p.investmentCentavos ?? a.investmentCentavos }) : null);
    return t + (perKg ?? 0);
  }, 0);
  return { total: total + otherTotal, otherTotal, otherCount: other.length };
}

export function pendingEdits() {
  return Object.keys(ui.rows).length + Object.keys(ui.prod).length;
}

// ---- Render ----

export function html(s) {
  const allClients = s.accounts.filter(a => a.channelId === ui.channelId);
  if (ui.selectedIds === null) ui.selectedIds = new Set(allClients.map(a => a.id));
  const selected = allClients.filter(a => ui.selectedIds.has(a.id));
  const grossOf = a => { const p = a.primarySkuId ? priceFor(s, { accountId: a.id, skuId: a.primarySkuId }) : null; return p && !p.error ? p.result.grossPerCyl : null; };
  const byRange = rangeActive() ? selected.filter(a => inRange(grossOf(a))) : selected;
  // Commercial only: with products ticked in the Products filter, only the clients that buy one of them are listed.
  const prodFilter = ui.channelId === 'COMMERCIAL' ? ui.prodFilter : [];
  const clients = prodFilter.length ? byRange.filter(a => rowProducts(s, a, prodFilter).length) : byRange;
  const cb = currentCostBasis(s);
  const edits = pendingEdits();
  // Columns the user may see; the rest are left out entirely.
  // With the price history open, it takes the place of margin, premiums and discounts entirely.
  const coverC = ui.histOpen;
  const pCols = coverC ? [] : PREMIUM_COLS.filter(c => lvl(s, c.code) >= 1), dCols = coverC ? [] : DISCOUNT_COLS.filter(c => lvl(s, c.code) >= 1);
  const showPrice = level(s, store.currentUser(), 'cp_price') >= 1;
  const inp = sessionInputs();
  const showFuture = showPrice;
  const showMargin = showPrice && !coverC;
  const histOpen = ui.histOpen;
  const histPubs = histOpen ? historyDates(s, ui.channelId) : [];
  // Commercial is laid out by product: one line of client details, then one line per product (1 to 3).
  // Margin, Premiums and Discounts are one column each.
  const simple = ui.channelId === 'COMMERCIAL';
  const showPrem = simple && !coverC && PREMIUM_COLS.some(c => lvl(s, c.code) >= 1);
  const showDisc = simple && !coverC && DISCOUNT_COLS.some(c => lvl(s, c.code) >= 1);
  // Commercial and Bulk list the clients with a running number on the left.
  const numbered = ['COMMERCIAL', 'BULK'].includes(ui.channelId);
  const v = { pCols, dCols, showPrice, showFuture, showMargin, inp, histOpen, histPubs, simple, showPrem, showDisc, numbered };

  const chSel = `<select id="cg-ch" aria-label="Channel">${s.channels.map(c => `<option value="${esc(c.id)}"${c.id === ui.channelId ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>`;

  // Dealer (pick-up) is priced product by product against CODO, semi-dealer and competitor prices: the dealer sheet.
  if (ui.channelId === 'DEALER') return `${wizard.summaryHtml(s)}${session.barHtml(s, { saveDisabled: !rowChanges(s).length })}<div class="one-row">${chSel}</div>${dealer.html(s)}`;

  const q = ui.filterQuery.toLowerCase();
  const filtered = q ? allClients.filter(a => a.name.toLowerCase().includes(q) || (a.zone || '').toLowerCase().includes(q)) : allClients;
  const allChecked = allClients.length === selected.length;

  const filterHtml = `<div class="multi" id="cg-multi">
      <button type="button" id="cg-toggle" class="multi-btn" aria-haspopup="listbox" aria-expanded="${ui.filterOpen}">
        <span>Clients <b>${selected.length}</b>/${allClients.length}</span><span aria-hidden="true">▾</span></button>
      ${ui.filterOpen ? `<div class="multi-menu cg-filter-menu">
        <input id="cg-search" type="search" autocomplete="off" placeholder="Search client or zone" aria-label="Search clients" value="${esc(ui.filterQuery)}">
        <div class="multi-actions small"><label class="check"><input type="checkbox" id="cg-all" ${allChecked ? 'checked' : ''}> All (${allClients.length})</label>
          <span class="muted">${selected.length} shown</span></div>
        <div id="cg-list" class="multi-list" role="listbox" aria-multiselectable="true" aria-label="Clients">${filtered.map(a =>
          `<label class="multi-opt"><input type="checkbox" data-cg-sel="${esc(a.id)}" ${ui.selectedIds.has(a.id) ? 'checked' : ''}>
            <span class="grow">${esc(a.name)}</span><span class="small muted">${esc(a.zone ?? '—')}</span></label>`).join('')}
        </div>
      </div>` : ''}
    </div>`;

  // The products Commercial clients buy, for the Products filter.
  let prodHtml = '';
  if (ui.channelId === 'COMMERCIAL') {
    const list = commercialProducts(s);
    prodHtml = `<div class="multi" id="cg-pmulti">
      <button type="button" id="cg-ptoggle" class="multi-btn" aria-haspopup="listbox" aria-expanded="${ui.prodOpen}">
        <span>${ui.prodFilter.length ? `Products <b>${ui.prodFilter.length}</b>/${list.length}` : 'All products'}</span><span aria-hidden="true">▾</span></button>
      ${ui.prodOpen ? `<div class="multi-menu">
          <div class="multi-actions small"><input id="cg-psearch" type="search" autocomplete="off" placeholder="Search product" aria-label="Search products" value="${esc(ui.prodQuery)}">
          <button type="button" class="link" id="cg-pclear">Clear</button></div>
          <div class="multi-list" id="cg-plist" role="listbox" aria-multiselectable="true" aria-label="Products">${prodOptions(list)}</div></div>` : ''}
    </div>`;
  }

  return `${wizard.summaryHtml(s)}${session.barHtml(s, { saveDisabled: !(edits || rowChanges(s).length) })}<div class="one-row">${chSel}${filterHtml}${prodHtml}${rangeBar(clients.length, selected.length, 'clients', selected.map(grossOf))}
      <span class="small muted nowrap">${clients.length}${edits ? ` · ${edits} unsaved` : ''}</span>
      <button type="button" class="small" data-open-mpl>MPL calculator</button></div>
    ${clients.length && simple ? `<table class="matrix grid-table simple${histOpen ? ' hist-open' : ''}">
      <thead><tr class="grp">
        ${numbered ? '<th class="col-no">#</th>' : ''}
        <th class="col-client">Client</th>
        <th class="col-product">Product</th>
        ${showFuture ? '<th class="num col-price col-future">Future price</th>' : ''}
        ${showPrice ? `<th class="num col-price">Current price <button type="button" id="cg-hist-toggle" class="hist-col-toggle" title="${histOpen ? 'Hide price history' : 'Show past prices'}" aria-expanded="${histOpen}">${histOpen ? '▴' : '▾'}</button></th>` : ''}
        ${histOpen ? histPubs.map(p => `<th class="num col-hist"><span class="hist-ver">${esc(p.label)}</span></th>`).join('') : ''}
        ${showMargin ? '<th class="num grp-margin">Margin</th>' : ''}
        ${showPrem ? '<th class="num grp-prem">Premiums</th>' : ''}
        ${showDisc ? '<th class="num grp-disc">Discounts</th>' : ''}
      </tr></thead>
      <tbody>${clients.map((a, i) => simpleRows(s, a, v, i + 1, prodFilter)).join('')}</tbody>
    </table>` : clients.length ? `<table class="matrix grid-table${histOpen ? ' hist-open' : ''}">
      <thead>
      <tr class="grp">
        ${numbered ? '<th rowspan="2" class="col-no">#</th>' : ''}
        <th rowspan="2" class="col-client">Client</th>
        ${showFuture ? '<th rowspan="2" class="num col-price col-future">Future price</th>' : ''}
        ${showPrice ? `<th rowspan="2" class="num col-price">Current price <button type="button" id="cg-hist-toggle" class="hist-col-toggle" title="${histOpen ? 'Hide price history' : 'Show past 5 prices'}" aria-expanded="${histOpen}">${histOpen ? '▴' : '▾'}</button></th>` : ''}
        ${histOpen ? histPubs.map(p => `<th rowspan="2" class="num col-hist"><span class="hist-ver">${esc(p.label)}</span></th>`).join('') : ''}
        ${showMargin ? '<th colspan="1" class="grp-margin">Margin/kg</th>' : ''}
        ${pCols.length ? `<th colspan="${pCols.length + 1}" class="grp-prem">Premiums</th>` : ''}
        ${dCols.length ? `<th colspan="${dCols.length + 1}" class="grp-disc">Discounts</th>` : ''}
      </tr>
      <tr>
        ${showMargin ? '<th class="num grp-margin-sub col-margin">₱/kg</th>' : ''}
        ${pCols.length ? `<th class="num grp-prem-sub col-total">Total premium</th>${pCols.map(c => `<th class="col-line">${esc(c.title)}</th>`).join('')}` : ''}
        ${dCols.length ? `<th class="num grp-disc-sub col-total">Total discounts</th>${dCols.map(c => `<th class="col-line">${esc(c.title)}</th>`).join('')}` : ''}
      </tr></thead>
      <tbody>${clients.map((a, i) => clientRow(s, a, cb, v, i + 1)).join('')}</tbody>
    </table>` : '<p class="muted">No clients match the filter or price range.</p>'}
    ${['BULK', 'COMMERCIAL'].includes(ui.channelId) ? termsDrawer(s) : ''}`;
}

// Dated price history: one column per snapshot date for this channel, newest first.
function historyDates(s, channelId) {
  const dates = [...new Set((s.clientPriceHistory || []).filter(r => r.channelId === channelId).map(r => r.effectiveDate))];
  return dates.sort().reverse().map(d => ({ date: d, label: fmtDate(d) }));
}

// Approved price requests for this client and product, shown inside the major version they were approved under.
// Only the latest approved sub-version is shown; the full list is in Price History.
function subPrices(s, a, skuId, version) {
  const r = latestSubVersion(s, a.id, skuId, version);
  return r ? `<span class="sub-v" title="Approved ${esc(fmtDate(r.decidedAt))}: ${esc(r.decisionReason || '')}">${esc(subLabel(r))} ${fmt(approvedPrice(r))}</span>` : '';
}

// The price this client had on that snapshot date, from the worksheets.
function histPriceCell(s, a, date, skuId = a.primarySkuId) {
  if (!skuId) return '<span class="muted small">—</span>';
  const r = (s.clientPriceHistory || []).find(x => x.accountId === a.id && x.channelId === a.channelId && x.effectiveDate === date && x.skuId === skuId);
  if (!r) return '<span class="muted small">—</span>';
  return `<span class="cell-price cell-hist">${fmt(r.grossCentavos)}</span>`;
}

// Bulk: hovering a price shows what it was made of at the time. Four lines: margin, acquisition cost, hauling, buffer.
// (The lines can be changed later; they are all read from the history the app already keeps.)
const inForce = (row, at) => new Date(row.effectiveFrom) <= at && (row.effectiveTo == null || at < new Date(row.effectiveTo));
function priceNote(s, a, skuId, whenIso) {
  const at = whenIso ? new Date(whenIso) : new Date();
  const now = !whenIso;
  const cbRow = now ? currentCostBasis(s) : s.costBasis.find(r => inForce(r, at));
  const rule = s.marginRules.find(r => r.channelId === a.channelId && r.skuId === skuId && (now ? r.effectiveTo == null : inForce(r, at)));
  const buf = (s.buffers || []).find(r => r.channelId === a.channelId && (now ? r.effectiveTo == null : inForce(r, at)));
  const margin = now && a.fixedMarginPerKg != null ? a.fixedMarginPerKg : rule?.perKg;
  const line = (label, c) => `${label}: ${c == null ? '—' : fmt(c) + '/kg'}`;
  return [line('Margin', margin), line('Acquisition cost', cbRow?.acqPerKg), line('Hauling', cbRow?.haulingPerKg), line('Buffer', buf ? buf.perKg : (now ? 0 : null))].join('\n');
}

function clientRow(s, a, cb, v, n) {
  const open = !!ui.expanded[a.id];
  const p = a.primarySkuId ? priceFor(s, { accountId: a.id, skuId: a.primarySkuId }) : null;
  let price = '<span class="muted small">No main product</span>';
  if (p && !p.error) {
    const margin = p.input.marginPerKg;
    const buffer = p.input.bufferPerKg || 0;
    price = `<span class="cell-price" title="MPL ${fmt(cb.acqPerKg + margin)} (acq + margin) · margin + buffer ${fmt(margin + buffer)}">${fmt(p.result.grossPerCyl)}</span>${subPrices(s, a, a.primarySkuId, currentPublication(s).version)}`;
  } else if (p?.error) price = `<span class="muted small">${esc(p.error)}</span>`;

  const volGen = a.volumeGeneratedKg != null ? Number(a.volumeGeneratedKg).toLocaleString('en-PH') + ' kg' : '—';
  const reqVol = a.reqVolPerMonthKg != null ? Number(a.reqVolPerMonthKg).toLocaleString('en-PH') + ' kg' : '—';
  const totalCols = (v.numbered ? 3 : 2) + (v.showFuture ? 1 : 0) + (v.showPrice ? 1 : 0) + v.histPubs.length + (v.showMargin ? 1 : 0) + (v.pCols.length ? v.pCols.length + 1 : 0) + (v.dCols.length ? v.dCols.length + 1 : 0);

  const bulk = ui.channelId === 'BULK';
  const priceCell = v.showPrice ? `<td class="num"${bulk ? ` data-note="${esc(priceNote(s, a, a.primarySkuId, null))}"` : ''}>${price}</td>` : '';

  return `<tr>
      ${v.numbered ? `<td class="col-no">${n}</td>` : ''}<th scope="row" title="${esc(`${a.clientCode ? a.clientCode + ' · ' : ''}${a.status} · ${a.zone ?? '—'} · Gen vol ${volGen} · Req/mo ${reqVol}`)}">
        ${bulk
          ? `<button type="button" class="link exp" data-cg-terms="${esc(a.id)}" aria-controls="ct-aside">${esc(a.name)}</button>`
          : `<button type="button" class="link exp" data-cg-exp="${esc(a.id)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${esc(a.name)}</button>`}
      </th>
      ${v.showFuture ? `<td class="num col-future" id="fp-${esc(a.id)}">${futurePriceCell(s, a, v.inp)}</td>` : ''}
      ${priceCell}
      ${v.histPubs.map(pub => `<td class="num col-hist"${bulk ? ` data-note="${esc(priceNote(s, a, a.primarySkuId, pub.date))}"` : ''}>${histPriceCell(s, a, pub.date)}</td>`).join('')}
      ${v.showMargin ? `<td class="num grp-margin-sub col-margin">${marginCell(s, a)}</td>` : ''}
      ${v.pCols.length ? `<td class="num grp-prem-sub" id="tp-${esc(a.id)}">${totalCell(s, a)}</td>${v.pCols.map(c => `<td>${cellRows(s, a, c)}</td>`).join('')}` : ''}
      ${v.dCols.length ? `<td class="num grp-disc-sub" id="td-${esc(a.id)}">${discountCell(a)}</td>${v.dCols.map(c => `<td>${cellRows(s, a, c)}</td>`).join('')}` : ''}
    </tr>
    ${open && !bulk ? `<tr class="prof"><td colspan="${totalCols}">${profileBox(a)}</td></tr>` : ''}`;
}

// Bulk only: the client's terms slide in from the right. Main terms sit at the top; the name's hover still lists the status, zone and volumes.
function termsDrawer(s) {
  const a = ui.termsFor ? byId(s.accounts, ui.termsFor) : null;
  const open = ui.termsOpen;
  const row = f => `<div class="term-row"><span class="term-k">${esc(labelFor(f))}</span><span class="term-v">${esc(displayValue(a, f))}</span></div>`;
  const body = a
    ? `<h3 class="sub-h first">Main terms</h3>
       <div class="term-list">${FIELDS.filter(f => f.top).map(row).join('')}</div>
       <h3 class="sub-h">Other terms</h3>
       <div class="term-list">${FIELDS.filter(f => !f.top).map(row).join('')}</div>
       <p class="small"><a href="#/config">Edit terms</a></p>`
    : '<p class="muted">Click a client name to see its terms.</p>';
  return `<aside id="ct-aside" class="drawer ct-drawer ${open ? 'open' : ''}" aria-label="Client terms" ${open ? '' : 'inert'}>
      <div class="drawer-head">
        <div class="drawer-tabs"><span class="drawer-title">${a ? esc(a.name) : 'Client terms'}</span></div>
        <button type="button" id="ct-close" class="icon" aria-label="Close client terms" title="Close">✕</button>
      </div>
      <div class="drawer-body">${body}</div>
    </aside>
    ${open ? '' : '<button type="button" id="ct-handle" class="drawer-handle">Client terms</button>'}`;
}

// The products a client buys, main product first: the main product plus any the client's terms list (volume per drop), up to three.
const DROP_SKU = { '50kg': a => `50KG_${a.profile?.contentClass || 'A'}`, '22kgRegular': () => '22KG_A', '22kgForklift': () => '22KG_FL_A', '11kg': () => '11KG_MGAS', '2.7kg': () => '2.7KG' };
// The client's products, from its checklist or the worksheet list (see clientSkus in pricing.js).
function clientProducts(s, a) {
  return clientSkus(s, a);
}

const kgText = n => (n == null ? '—' : `${Number(n).toLocaleString('en-PH')} kg`);

// Which volume band a drop falls in: 0 = 1–2, 1 = 3–5, 2 = 6–10, 3 = 11 & up, -1 = no volume set.
const bandIndex = qty => (!qty || qty < 1 ? -1 : qty <= 2 ? 0 : qty <= 5 ? 1 : qty <= 10 ? 2 : 3);

// The volume-per-drop key (worksheet columns X to AB) that belongs to a product, for this client.
const dropKeyOf = (a, sku) => Object.keys(DROP_SKU).find(k => DROP_SKU[k](a) === sku.id);

// Hover on a Commercial future price: the client's volume per drop, then the product's band prices, its band highlighted.
// base is the price per cylinder the bands are taken from.
function bandTip(s, a, sku, base) {
  const key = dropKeyOf(a, sku);
  const qty = key ? Number(a.profile?.volumePerDrop?.[key]) || null : null;
  const cur = bandIndex(qty);
  const step = sku.volStepCentavos || 0;
  const bands = VOLUME_BANDS.map((label, k) => `<span class="tip-row${k === cur ? ' on' : ''}"><i>${esc(label)} cyl</i><b>${fmt(Math.max(0, base - step * k))}</b></span>`).join('');
  return `<span class="tip-name">${esc(sku.label)}</span>
      <span class="tip-ident">${esc(a.name)}</span>
      <span class="tip-sec">Volume per drop</span>
      <span class="tip-row"><i>${qty ? 'Cylinders per drop' : 'Not set'}</i><b>${qty ? qty.toLocaleString('en-PH') : '—'}</b></span>
      <span class="tip-sec">Price by drop size</span>${bands}`;
}

// The hover card on a client name: identity, main terms, then the volume and competitor lines.
function clientTip(s, a) {
  const used = a.trmvKg && a.volumeGeneratedKg != null ? `${Math.round(a.volumeGeneratedKg / a.trmvKg * 100)}% of TRMV` : '—';
  const volume = [
    ['Last month', kgText(a.lastMonthKg)],
    ['Avg per month', kgText(a.avgMonthlyVolumeKg)],
    ['Contract ends', a.contractEnd ? fmtDate(a.contractEnd) : '—'],
    ['Volume used', used],
    ['Competitor', a.competitorBrand || '—'],
  ];
  const line = (k, val) => `<span class="tip-row"><i>${esc(k)}</i><b>${esc(val)}</b></span>`;
  const main = FIELDS.filter(f => f.top).map(f => line(labelFor(f), displayValue(a, f))).join('');
  const ident = `${a.clientCode ? esc(a.clientCode) + ' · ' : ''}${esc(a.status ?? '—')} · ${esc(a.zone ?? '—')}`;
  return `<span class="tip-name">${esc(a.name)}</span>
      <span class="tip-ident">${ident}</span>
      <span class="tip-sec">Main terms</span>${main}
      <span class="tip-sec">Volume</span>${volume.map(([k, val]) => line(k, val)).join('')}`;
}

// The hover card is one floating element on the page body, so the table's scroll box cannot clip it.
function hideTip() { document.getElementById('cg-float')?.remove(); }
function showTip(el) {
  hideTip();
  const t = document.createElement('div');
  t.id = 'cg-float';
  t.className = 'cg-float';
  t.innerHTML = el.dataset.tip;
  document.body.appendChild(t);
  const r = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left + 8, window.innerWidth - t.offsetWidth - 12));
  const below = r.bottom + 6;
  const top = below + t.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - t.offsetHeight - 6) : below;
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
  window.addEventListener('scroll', hideTip, { once: true, capture: true });
}

// Commercial: one row per product, the client in the first column and the product in the next. The client's name and
// number span its rows; margin, premium and discount are per product. The product filter narrows the rows.
function simpleRows(s, a, v, n, prodFilter) {
  const prods = rowProducts(s, a, prodFilter);
  const list = prods.length ? prods : [null];
  const k = list.length;
  return list.map((sku, i) => {
    const first = i === 0;
    const span = first ? ` rowspan="${k}"` : '';
    const no = v.numbered && first ? `<td class="col-no"${span}>${n}</td>` : '';
    const name = first ? `<th scope="row" class="cl-tip" data-tip="${esc(clientTip(s, a))}"${span}>
        <button type="button" class="link exp" data-cg-terms="${esc(a.id)}" aria-controls="ct-aside">${esc(a.name)}</button>
      </th>` : '';
    const p = sku ? priceFor(s, { accountId: a.id, skuId: sku.id }) : null;
    const price = p && !p.error ? `<span class="cell-price">${fmt(p.result.grossPerCyl)}</span>${subPrices(s, a, sku.id, currentPublication(s).version)}` : '<span class="muted small">—</span>';
    const dash = '<span class="muted small">—</span>';
    return `<tr class="${first ? 'cl-row' : 'pr-row'}">
      ${no}${name}
      <td class="pr-prod">${sku ? esc(sku.label) : dash}</td>
      ${v.showFuture ? `<td class="num col-future"${sku ? ` data-fp="${esc(a.id)}" data-fpsku="${esc(sku.id)}"` : ''}${sku && futureTip(s, a, v.inp, sku.id) ? ` data-tip="${esc(futureTip(s, a, v.inp, sku.id))}"` : ''}>${sku ? futurePriceCell(s, a, v.inp, sku.id) : dash}</td>` : ''}
      ${v.showPrice ? `<td class="num">${sku ? price : dash}</td>` : ''}
      ${v.histPubs.map(pub => `<td class="num col-hist">${sku ? histPriceCell(s, a, pub.date, sku.id) : dash}</td>`).join('')}
      ${v.showMargin ? `<td class="num grp-margin-sub col-margin">${sku ? marginCell(s, a, sku.id) : dash}</td>` : ''}
      ${v.showPrem ? `<td class="num grp-prem-sub">${sku ? simpleAdjCell(s, a, 'P', sku.id) : dash}</td>` : ''}
      ${v.showDisc ? `<td class="num grp-disc-sub">${sku ? simpleAdjCell(s, a, 'D', sku.id) : dash}</td>` : ''}
    </tr>`;
  }).join('');
}

// The products a client's rows show: all of its products, or only those ticked in the Products filter.
function rowProducts(s, a, prodFilter) {
  const all = clientProducts(s, a);
  return prodFilter.length ? all.filter(k => prodFilter.includes(k.id)) : all;
}

// One number for all premiums (or all discounts). Typing it sets the client's credit-risk premium (or its supply-only or
// competition discount) to whatever makes the total match; every other premium or discount the client carries stays.
const adjCode = (a, kind) => (kind === 'P' ? 'CREDIT_RISK' : a.competitorBrand ? 'DUAL_SUPPLIER' : 'SUPPLY_ONLY');
// Per-product terms (margin, premium, discount) live on the client's productPricing map, one entry per product.
// A typed value waits in ui.prod until the Save button turns it into a proposal change.
const prodKey = (accId, skuId, field) => `${accId}|${skuId}|${field}`;
function prodDraft(a, skuId, field) {
  const k = prodKey(a.id, skuId, field);
  if (k in ui.prod) return ui.prod[k];
  const saved = a.productPricing?.[skuId]?.[field];
  return saved == null ? '' : toInput(saved);
}

function simpleAdjCell(s, a, kind, skuId) {
  const field = kind === 'P' ? 'premiumPerKg' : 'discountPerKg';
  const ro = editable(s, adjCode(a, kind)) ? '' : ' readonly tabindex="-1"';
  return `<input class="mini" type="number" min="0" step="0.01" inputmode="decimal" placeholder="-" value="${esc(prodDraft(a, skuId, field))}" aria-label="${kind === 'P' ? 'Premium' : 'Discount'} ₱/kg" data-prod="${esc(prodKey(a.id, skuId, field))}"${ro}>`;
}

function totalCell(s, a) {
  const { total, otherTotal, otherCount } = premiumTotal(s, a);
  return `<span class="cell-price" ${otherCount ? `title="incl. ${otherCount} other premium${otherCount === 1 ? '' : 's'} ${fmt(otherTotal)}"` : ''}>${fmt(total)}</span>`;
}

// Live total of the client's discounts, from the three columns plus anything else it carries.
export function discountTotal(a) {
  const gridCodes = DISCOUNT_COLS.map(c => c.code);
  let total = 0;
  for (const col of DISCOUNT_COLS) for (const r of draftRows(a, col.code)) total += toCentavos(r.perKg) ?? 0;
  const other = (a.discounts || []).filter(d => !gridCodes.includes(d.code));
  const otherTotal = other.reduce((t, d) => t + (d.perKg ?? 0), 0);
  return { total: total + otherTotal, otherTotal, otherCount: other.length };
}

function discountCell(a) {
  const { total, otherTotal, otherCount } = discountTotal(a);
  return `<span class="cell-price" ${otherCount ? `title="incl. ${otherCount} other ${fmt(otherTotal)}"` : ''}>${total ? '−' : ''}${fmt(total)}</span>`;
}

// The shared row of Acq, Hauling cost, Total Acq, Margin and Buffer at the top (see js/session.js).
function sessionInputs() {
  return session.get(store.get());
}

// The future price per cylinder for a client and product, or null when it cannot be worked out.
function futureValue(s, a, inp, skuId = a.primarySkuId) {
  if (!inp || !skuId) return null;
  const sku = s.skus.find(k => k.id === skuId);
  if (!sku) return null;
  const { total: premC } = premiumTotal(s, a);
  const { total: discC } = discountTotal(a);
  // This product's own margin, premium and discount, on top of the client's and the session's margin.
  const own = a.productPricing?.[sku.id] || {};
  const mar = own.marginPerKg ?? inp.mar;
  // Formula: MPL (acq + margin + buffer) + premiums - discounts
  const netPerKg = inp.acq + mar + inp.buf + premC + (own.premiumPerKg ?? 0) - discC - (own.discountPerKg ?? 0);
  return Math.round(netPerKg * sku.contentKg);
}

function futurePriceCell(s, a, inp, skuId = a.primarySkuId) {
  const value = futureValue(s, a, inp, skuId);
  if (value == null) return '<span class="muted small">—</span>';
  return `<span class="cell-price cell-future">${fmt(value)}</span>`;
}

// The hover text for a future price cell: the band prices built from that future price (raw HTML, or null).
function futureTip(s, a, inp, skuId) {
  const value = futureValue(s, a, inp, skuId);
  const sku = s.skus.find(k => k.id === skuId);
  return value == null || !sku ? null : bandTip(s, a, sku, value);
}

function marginCell(s, a, skuId) {
  const mr = marginRule(s, a.channelId, skuId);
  const rulePerKg = mr?.perKg;
  const pastHtml = rulePerKg != null
    ? `<span class="cell-price muted small mg-rule">${fmt(rulePerKg)}/kg</span>`
    : '';
  return `<div class="cellfields">
    ${pastHtml}
    <input class="mini" type="number" min="0" step="0.01" inputmode="decimal" placeholder="-" value="${esc(prodDraft(a, skuId, 'marginPerKg'))}" aria-label="Margin ₱/kg" data-prod="${esc(prodKey(a.id, skuId, 'marginPerKg'))}">
  </div>`;
}

// One row of fields per client and line type. Any extra rows a client already carries are kept as they are.
// Amounts are money: two decimals, never negative.
function cellRows(s, a, col) {
  const ro = editable(s, col.code) ? '' : ' readonly tabindex="-1"';
  const rows = draftRows(a, col.code);
  const r = rows[0] || { perKg: '', investment: '', note: '' };
  const extra = Math.max(0, rows.length - 1);
  const amount = `<input class="mini" type="number" min="0" step="0.01" inputmode="decimal" placeholder="-" value="${esc(r.perKg)}" aria-label="Per kg" data-cg="${esc(a.id)}|${col.code}|0|perKg"${ro}>`;
  return `<div class="cellfields">
    ${amount}
  </div>`;
}

// View only, and kept tight. These are maintained in Configuration → Clients.
const INLINE_KEYS = new Set(['volumeGeneratedKg', 'reqVolPerMonthKg']);
function profileBox(a) {
  return `<div class="terms-line">
    ${FIELDS.filter(f => !INLINE_KEYS.has(f.key)).map(f => `<span class="term"><i>${esc(labelFor(f))}</i>${esc(displayValue(a, f))}</span>`).join('')}
    <a class="term-edit small" href="#/config">Edit terms</a>
  </div>`;
}

// ---- Save ----

// The top row's Acq, Hauling cost and Buffer, as proposed price changes when they differ from what is in force.
// Margin in that row only drives the Future price; it is a per-product lever and is set in the margin column.
function rowChanges(s) {
  const me = store.currentUser();
  const v = session.values();
  const cb = currentCostBasis(s);
  const out = [];
  if (canEditPart(s, me, 'mpl_cost')) {
    if (v.acq != null && v.acq > 0 && v.acq !== cb.acqPerKg) out.push({ type: 'ACQ', perKg: v.acq });
    if (v.hauling != null && v.hauling > 0 && v.hauling !== cb.haulingPerKg) out.push({ type: 'HAULING', perKg: v.hauling });
  }
  if (canEditPart(s, me, 'mpl_buffer') && v.buffer != null && v.buffer !== bufferFor(s, ui.channelId)) out.push({ type: 'BUFFER', channelId: ui.channelId, perKg: v.buffer });
  return out;
}

async function saveAll(rerender) {
  const s = store.get();
  const changes = rowChanges(s);

  // Premium and discount rows → one change per client and code.
  for (const [key, rows] of Object.entries(ui.rows)) {
    const [accId, code] = key.split('|');
    const a = byId(s.accounts, accId);
    if (!a || !editable(s, code)) continue;
    const next = rows
      .map(r => ({ perKg: toCentavos(r.perKg), investmentCentavos: toCentavos(r.investment), note: (r.note || '').trim() }))
      .filter(r => r.perKg != null || r.investmentCentavos != null || r.note)
      .map(r => ({ ...(r.perKg == null ? {} : { perKg: r.perKg }), ...(r.investmentCentavos ? { investmentCentavos: r.investmentCentavos } : {}), ...(r.note ? { note: r.note } : {}) }));
    const before = listFor(a, code).filter(p => p.code === code).map(({ code: _c, ...rest }) => rest);
    if (JSON.stringify(before) !== JSON.stringify(next)) changes.push({ type: 'ACCOUNT_COMPONENT', accountId: accId, code, rows: next });
  }

  // Per-product margin, premium and discount → one ACCOUNT_PRODUCT change per value that differs from what is saved.
  for (const [key, valStr] of Object.entries(ui.prod)) {
    const [accId, skuId, field] = key.split('|');
    const a = byId(s.accounts, accId);
    if (!a) continue;
    if (field !== 'marginPerKg' && !editable(s, adjCode(a, field === 'premiumPerKg' ? 'P' : 'D'))) continue;
    const val = toCentavos(valStr) ?? null;
    const before = a.productPricing?.[skuId]?.[field] ?? null;
    if (val !== before) changes.push({ type: 'ACCOUNT_PRODUCT', accountId: accId, skuId, field, value: val });
  }

  const total = changes.length ? wizard.addChanges(changes) : 0;

  ui.rows = {};
  ui.prod = {};
  rerender();
  if (!changes.length) toast('Nothing changed');
  else toast(`${changes.length} price change${changes.length === 1 ? '' : 's'} added to the proposal (${total} in total) — simulate and publish to apply.`);
}

// ---- Behaviour ----

export function bind(root, rerender) {
  hideTip();
  wizard.bindSummary(root, rerender);
  root.querySelectorAll('[data-tip]').forEach(el => {
    el.onmouseenter = () => showTip(el);
    el.onmouseleave = hideTip;
  });
  const chSel = root.querySelector('#cg-ch');
  if (chSel) chSel.onchange = () => { ui.channelId = chSel.value; ui.selectedIds = null; ui.filterQuery = ''; ui.filterOpen = false; ui.termsOpen = false; rerender(); };
  if (ui.channelId === 'DEALER') { session.bind(root, rerender, { onSave: () => saveAll(rerender) }); dealer.bind(root, rerender); return; }
  root.querySelectorAll('[data-cg-exp]').forEach(b => b.onclick = () => {
    const id = b.dataset.cgExp;
    // Commercial clients start open, so "closed" is the stored state there; elsewhere "open" is.
    ui.expanded[id] = ui.channelId === 'COMMERCIAL' ? ui.expanded[id] === false : !ui.expanded[id];
    rerender();
  });

  root.querySelectorAll('[data-cg-terms]').forEach(b => b.onclick = () => {
    ui.termsFor = b.dataset.cgTerms;
    ui.termsOpen = true;
    rerender();
  });
  const ctClose = root.querySelector('#ct-close');
  if (ctClose) ctClose.onclick = () => { ui.termsOpen = false; rerender(); };
  const ctHandle = root.querySelector('#ct-handle');
  if (ctHandle) ctHandle.onclick = () => { ui.termsOpen = true; rerender(); };

  const ptoggle = root.querySelector('#cg-ptoggle');
  if (ptoggle) ptoggle.onclick = () => { ui.prodOpen = !ui.prodOpen; ui.filterOpen = false; rerender(); };
  const bindProdOpts = scope => scope.querySelectorAll('[data-cg-prod]').forEach(cb => cb.onchange = () => {
    const id = cb.dataset.cgProd;
    ui.prodFilter = ui.prodFilter.includes(id) ? ui.prodFilter.filter(x => x !== id) : [...ui.prodFilter, id];
    rerender();
  });
  bindProdOpts(root);
  const psearch = root.querySelector('#cg-psearch');
  if (psearch) psearch.oninput = () => {
    ui.prodQuery = psearch.value;
    const plist = root.querySelector('#cg-plist');
    if (plist) { plist.innerHTML = prodOptions(commercialProducts(store.get())); bindProdOpts(plist); }
  };
  const pclear = root.querySelector('#cg-pclear');
  if (pclear) pclear.onclick = () => { ui.prodFilter = []; ui.prodQuery = ''; rerender(); };

  const toggle = root.querySelector('#cg-toggle');
  if (toggle) toggle.onclick = () => {
    ui.filterOpen = !ui.filterOpen;
    ui.prodOpen = false;
    ui.filterScroll = 0;
    rerender();
    if (ui.filterOpen) document.getElementById('cg-search')?.focus();
  };

  const bindFilterOpts = () => root.querySelectorAll('[data-cg-sel]').forEach(cb => cb.onchange = () => {
    ui.filterScroll = document.getElementById('cg-list')?.scrollTop ?? 0;
    const id = cb.dataset.cgSel;
    if (cb.checked) ui.selectedIds.add(id); else ui.selectedIds.delete(id);
    rerender();
  });
  bindFilterOpts();
  const list = root.querySelector('#cg-list');
  if (list) list.scrollTop = ui.filterScroll;

  const search = root.querySelector('#cg-search');
  if (search) search.oninput = () => {
    ui.filterQuery = search.value;
    ui.filterScroll = 0;
    const s = store.get();
    const q = ui.filterQuery.toLowerCase();
    const allClients = s.accounts.filter(a => a.channelId === ui.channelId);
    const filtered = q ? allClients.filter(a => a.name.toLowerCase().includes(q) || (a.zone || '').toLowerCase().includes(q)) : allClients;
    const listEl = root.querySelector('#cg-list');
    if (listEl) {
      listEl.innerHTML = filtered.map(a =>
        `<label class="multi-opt"><input type="checkbox" data-cg-sel="${esc(a.id)}" ${ui.selectedIds.has(a.id) ? 'checked' : ''}>
          <span class="grow">${esc(a.name)}</span><span class="small muted">${esc(a.zone ?? '—')}</span></label>`).join('');
      listEl.scrollTop = 0;
      bindFilterOpts();
    }
  };
  const allCb = root.querySelector('#cg-all');
  if (allCb) allCb.onchange = () => {
    const all = store.get().accounts.filter(a => a.channelId === ui.channelId);
    ui.selectedIds = allCb.checked ? new Set(all.map(a => a.id)) : new Set();
    rerender();
  };
  root.querySelectorAll('[data-cg]').forEach(el => {
    const [accId, code, i, field] = el.dataset.cg.split('|');
    const a = byId(store.get().accounts, accId);
    if (!a) return;
    el.oninput = () => {
      if (field === 'perKg' && el.value.startsWith('-')) el.value = el.value.replace(/-/g, '');
      editRows(a, code)[+i][field] = el.value;
      // Totals follow every keystroke without redrawing the field being typed into.
      const prem = root.querySelector(`#tp-${CSS.escape(accId)}`);
      if (prem && PREMIUM_COLS.some(c => c.code === code)) prem.innerHTML = totalCell(store.get(), a);
      const disc = root.querySelector(`#td-${CSS.escape(accId)}`);
      if (disc && DISCOUNT_COLS.some(c => c.code === code)) disc.innerHTML = discountCell(a);
      const fut = root.querySelector(`#fp-${CSS.escape(accId)}`);
      const inp = sessionInputs();
      if (fut && inp) fut.innerHTML = futurePriceCell(store.get(), a, inp);
    };
    // Leave the field showing centavos, the way every other amount in the app reads.
    if (field === 'perKg') el.onblur = () => {
      const v = toCentavos(el.value);
      el.value = v == null || v < 0 ? '' : toInput(v);
      editRows(a, code)[+i].perKg = el.value;
    };
  });
  // Per-product margin, premium and discount inputs: typing updates that product's future price and waits for Save.
  root.querySelectorAll('[data-prod]').forEach(el => {
    const [accId] = el.dataset.prod.split('|');
    el.oninput = () => {
      if (el.value.startsWith('-')) el.value = el.value.replace(/-/g, '');
      ui.prod[el.dataset.prod] = el.value;
      const s = store.get();
      const a = byId(s.accounts, accId);
      const inp = sessionInputs();
      if (a && inp) root.querySelectorAll(`[data-fp="${CSS.escape(accId)}"]`).forEach(td => {
        td.innerHTML = futurePriceCell(s, a, inp, td.dataset.fpsku);
        const tip = futureTip(s, a, inp, td.dataset.fpsku);
        if (tip) td.dataset.tip = tip;
        else delete td.dataset.tip;
      });
      const saveBtn = root.querySelector('#cg-save');
      if (saveBtn) saveBtn.disabled = false;
    };
    el.onblur = () => {
      const c = toCentavos(el.value);
      el.value = c == null || c < 0 ? '' : toInput(c);
      ui.prod[el.dataset.prod] = el.value;
    };
  });
  const save = root.querySelector('#cg-save');
  if (save) save.onclick = () => saveAll(rerender);

  const histToggle = root.querySelector('#cg-hist-toggle');
  if (histToggle) histToggle.onclick = () => { ui.histOpen = !ui.histOpen; rerender(); };

  session.bind(root, rerender);
}
