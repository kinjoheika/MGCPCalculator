// Client pricing grid — every client of one channel on a single page.
// Rows are clients; columns are the line types. Fields open with the client's last saved amounts.
// One Save button: price levers go into the open MPL proposal, the rest is saved as client terms.

import * as store from '../store.js';
import { fmt, fmtKg, toCentavos, toInput } from '../money.js';
import { esc, toast, preserveFocus } from '../ui.js';
import { byId, priceFor, currentCostBasis, bufferFor, channelLabel, skuLabel, marginRule, fmtDate, currentPublication, subVersionsOf, subLabel } from '../pricing.js';
import { derivePremiumPerKg } from '../engine.js';
import { FIELDS, labelFor, displayValue } from '../clientterms.js';
import { inRange, rangeActive, rangeBar } from '../pricerange.js';
import * as wizard from './priceroom-wizard.js';
import * as dealer from './dealersheet.js';
import * as session from '../session.js';
import { level } from '../access.js';

const ui = { channelId: 'COMMERCIAL', expanded: {}, rows: {}, margins: {}, filterQuery: '', selectedIds: null, filterOpen: false, filterScroll: 0, acqInput: '', marginInput: '', bufferInput: '', histOpen: false };

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

export function isFilterOpen() { return ui.filterOpen; }
export function closeFilter() { ui.filterOpen = false; }

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
  return Object.keys(ui.rows).length + Object.keys(ui.margins).length;
}

// ---- Render ----

export function html(s) {
  const allClients = s.accounts.filter(a => a.channelId === ui.channelId);
  if (ui.selectedIds === null) ui.selectedIds = new Set(allClients.map(a => a.id));
  const selected = allClients.filter(a => ui.selectedIds.has(a.id));
  const grossOf = a => { const p = a.primarySkuId ? priceFor(s, { accountId: a.id, skuId: a.primarySkuId }) : null; return p && !p.error ? p.result.grossPerCyl : null; };
  const clients = rangeActive() ? selected.filter(a => inRange(grossOf(a))) : selected;
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
  const histPubs = histOpen ? pastPublications(s, ui.channelId) : [];
  // Commercial is laid out by product: one line of client details, then one line per product (1 to 3).
  // Margin, Premiums and Discounts are one column each.
  const simple = ui.channelId === 'COMMERCIAL';
  const showPrem = simple && !coverC && PREMIUM_COLS.some(c => lvl(s, c.code) >= 1);
  const showDisc = simple && !coverC && DISCOUNT_COLS.some(c => lvl(s, c.code) >= 1);
  const v = { pCols, dCols, showPrice, showFuture, showMargin, inp, histOpen, histPubs, simple, showPrem, showDisc };

  const chSel = `<select id="cg-ch" aria-label="Channel">${s.channels.map(c => `<option value="${esc(c.id)}"${c.id === ui.channelId ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>`;

  // Dealer (pick-up) is priced product by product against CODO, semi-dealer and competitor prices: the dealer sheet.
  if (ui.channelId === 'DEALER') return `${session.barHtml(s)}<div class="one-row">${chSel}</div>${dealer.html(s)}`;

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

  return `${session.barHtml(s, { saveDisabled: !edits })}<div class="one-row">${chSel}${filterHtml}${rangeBar(clients.length, selected.length, 'clients', selected.map(grossOf))}
      <span class="small muted nowrap">${clients.length}${edits ? ` · ${edits} unsaved` : ''}</span>
      <button type="button" class="small" data-open-mpl>MPL calculator</button></div>
    ${clients.length && simple ? `<table class="matrix grid-table simple${histOpen ? ' hist-open' : ''}">
      <thead><tr class="grp">
        <th class="col-client">Client</th>
        ${showFuture ? '<th class="num col-price col-future">Future price</th>' : ''}
        ${showPrice ? `<th class="num col-price">Current price <button type="button" id="cg-hist-toggle" class="hist-col-toggle" title="${histOpen ? 'Hide price history' : 'Show past prices'}" aria-expanded="${histOpen}">${histOpen ? '▴' : '▾'}</button></th>` : ''}
        ${histOpen ? histPubs.map(p => `<th class="num col-hist"><span class="hist-ver">v${p.version}</span><span class="hist-date">${fmtDate(p.publishedAt)}</span></th>`).join('') : ''}
        ${showMargin ? '<th class="num grp-margin">Margin</th>' : ''}
        ${showPrem ? '<th class="num grp-prem">Premiums</th>' : ''}
        ${showDisc ? '<th class="num grp-disc">Discounts</th>' : ''}
      </tr></thead>
      <tbody>${clients.map(a => simpleRows(s, a, v)).join('')}</tbody>
    </table>` : clients.length ? `<table class="matrix grid-table${histOpen ? ' hist-open' : ''}">
      <thead>
      <tr class="grp">
        <th rowspan="2" class="col-client">Client</th>
        ${showFuture ? '<th rowspan="2" class="num col-price col-future">Future price</th>' : ''}
        ${showPrice ? `<th rowspan="2" class="num col-price">Current price <button type="button" id="cg-hist-toggle" class="hist-col-toggle" title="${histOpen ? 'Hide price history' : 'Show past 5 prices'}" aria-expanded="${histOpen}">${histOpen ? '▴' : '▾'}</button></th>` : ''}
        ${histOpen ? histPubs.map(p => `<th rowspan="2" class="num col-hist"><span class="hist-ver">v${p.version}</span><span class="hist-date">${fmtDate(p.publishedAt)}</span></th>`).join('') : ''}
        ${showMargin ? '<th colspan="1" class="grp-margin">Margin/kg</th>' : ''}
        ${pCols.length ? `<th colspan="${pCols.length + 1}" class="grp-prem">Premiums</th>` : ''}
        ${dCols.length ? `<th colspan="${dCols.length + 1}" class="grp-disc">Discounts</th>` : ''}
      </tr>
      <tr>
        ${showMargin ? '<th class="num grp-margin-sub col-margin">₱/kg</th>' : ''}
        ${pCols.length ? `<th class="num grp-prem-sub col-total">Total premium</th>${pCols.map(c => `<th class="col-line">${esc(c.title)}</th>`).join('')}` : ''}
        ${dCols.length ? `<th class="num grp-disc-sub col-total">Total discounts</th>${dCols.map(c => `<th class="col-line">${esc(c.title)}</th>`).join('')}` : ''}
      </tr></thead>
      <tbody>${clients.map(a => clientRow(s, a, cb, v)).join('')}</tbody>
    </table>` : '<p class="muted">No clients match the filter or price range.</p>'}`;
}

function pastPublications(s, channelId, limit = 5) {
  const curVer = currentPublication(s)?.version;
  return [...s.publications]
    .filter(p => p.version !== curVer && p.prices?.[channelId])
    .sort((x, y) => y.version - x.version)
    .slice(0, limit);
}

// Approved price requests for this client and product, shown inside the major version they were approved under.
function subPrices(s, a, skuId, version) {
  return subVersionsOf(s, version).filter(r => r.accountId === a.id && r.skuId === skuId)
    .map(r => `<span class="sub-v" title="Approved ${esc(fmtDate(r.decidedAt))}: ${esc(r.decisionReason || '')}">${esc(subLabel(r))} ${fmt(r.approvedGrossPerCyl ?? r.currentGrossPerCyl)}</span>`).join('');
}

function histPriceCell(s, a, pub, skuId = a.primarySkuId) {
  if (!skuId || !pub.prices?.[a.channelId]) return '<span class="muted small">—</span>';
  const entry = pub.prices[a.channelId].find(p => p.skuId === skuId);
  if (entry?.grossPerCyl == null) return '<span class="muted small">—</span>';
  return `<span class="cell-price cell-hist">${fmt(entry.grossPerCyl)}</span>${subPrices(s, a, skuId, pub.version)}`;
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

function clientRow(s, a, cb, v) {
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
  const totalCols = 2 + (v.showFuture ? 1 : 0) + (v.showPrice ? 1 : 0) + v.histPubs.length + (v.showMargin ? 1 : 0) + (v.pCols.length ? v.pCols.length + 1 : 0) + (v.dCols.length ? v.dCols.length + 1 : 0);

  const bulk = ui.channelId === 'BULK';
  const priceCell = v.showPrice ? `<td class="num"${bulk ? ` data-note="${esc(priceNote(s, a, a.primarySkuId, null))}"` : ''}>${price}</td>` : '';

  return `<tr>
      <th scope="row" title="${esc(`${a.clientCode ? a.clientCode + ' · ' : ''}${a.status} · ${a.zone ?? '—'} · Gen vol ${volGen} · Req/mo ${reqVol}`)}">
        <button type="button" class="link exp" data-cg-exp="${esc(a.id)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${esc(a.name)}</button>
      </th>
      ${v.showFuture ? `<td class="num col-future" id="fp-${esc(a.id)}">${futurePriceCell(s, a, v.inp)}</td>` : ''}
      ${priceCell}
      ${v.histPubs.map(pub => `<td class="num col-hist"${bulk ? ` data-note="${esc(priceNote(s, a, a.primarySkuId, pub.publishedAt))}"` : ''}>${histPriceCell(s, a, pub)}</td>`).join('')}
      ${v.showMargin ? `<td class="num grp-margin-sub col-margin">${marginCell(s, a)}</td>` : ''}
      ${v.pCols.length ? `<td class="num grp-prem-sub" id="tp-${esc(a.id)}">${totalCell(s, a)}</td>${v.pCols.map(c => `<td>${cellRows(s, a, c)}</td>`).join('')}` : ''}
      ${v.dCols.length ? `<td class="num grp-disc-sub" id="td-${esc(a.id)}">${discountCell(a)}</td>${v.dCols.map(c => `<td>${cellRows(s, a, c)}</td>`).join('')}` : ''}
    </tr>
    ${open ? `<tr class="prof"><td colspan="${totalCols}">${profileBox(a)}</td></tr>` : ''}`;
}

// The products a client buys, main product first: the main product plus any the client's terms list (volume per drop), up to three.
const DROP_SKU = { '50kg': a => `50KG_${a.profile?.contentClass || 'A'}`, '22kgRegular': () => '22KG_A', '22kgForklift': () => '22KG_FL_A', '11kg': () => '11KG_MGAS', '2.7kg': () => '2.7KG' };
function clientProducts(s, a) {
  const ids = [a.primarySkuId, ...Object.keys(a.profile?.volumePerDrop || {}).map(k => DROP_SKU[k]?.(a))].filter(Boolean);
  return [...new Set(ids)].map(id => byId(s.skus, id)).filter(Boolean).slice(0, 3);
}

const kgText = n => (n == null ? '—' : `${Number(n).toLocaleString('en-PH')} kg`);

function simpleRows(s, a, v) {
  const open = ui.expanded[a.id] !== false; // every client opens by default
  const span = (v.showFuture ? 1 : 0) + (v.showPrice ? 1 : 0) + v.histPubs.length + (v.showMargin ? 1 : 0) + (v.showPrem ? 1 : 0) + (v.showDisc ? 1 : 0);
  const used = a.trmvKg && a.volumeGeneratedKg != null ? `${Math.round(a.volumeGeneratedKg / a.trmvKg * 100)}% of TRMV` : '—';
  const items = [
    ['Last month', kgText(a.lastMonthKg)],
    ['Avg per month', kgText(a.avgMonthlyVolumeKg)],
    ['Contract ends', a.contractEnd ? fmtDate(a.contractEnd) : '—'],
    ['Volume used', used],
    ['Competitor', a.competitorBrand || '—'],
  ];
  const head = `<tr class="cl-row">
      <th scope="row" title="${esc(`${a.clientCode ? a.clientCode + ' · ' : ''}${a.status} · ${a.zone ?? '—'}`)}">
        <button type="button" class="link exp" data-cg-exp="${esc(a.id)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${esc(a.name)}</button>
      </th>
      <td colspan="${span}"><div class="cd-line">${items.map(([k, val]) => `<span><i>${k}</i> ${esc(val)}</span>`).join('')}</div></td>
    </tr>`;
  if (!open) return head;
  const prods = clientProducts(s, a);
  return head + prods.map((sku, i) => {
    const p = priceFor(s, { accountId: a.id, skuId: sku.id });
    const price = p && !p.error ? `<span class="cell-price">${fmt(p.result.grossPerCyl)}</span>${subPrices(s, a, sku.id, currentPublication(s).version)}` : '<span class="muted small">—</span>';
    const first = i === 0; // margin, premiums and discounts belong to the client: shown once, on its main product
    const none = '<td class="num muted">·</td>';
    return `<tr class="pr-row">
      <th scope="row" class="pr-th">${esc(sku.label)}</th>
      ${v.showFuture ? `<td class="num col-future" data-fp="${esc(a.id)}" data-fpsku="${esc(sku.id)}">${futurePriceCell(s, a, v.inp, sku.id)}</td>` : ''}
      ${v.showPrice ? `<td class="num">${price}</td>` : ''}
      ${v.histPubs.map(pub => `<td class="num col-hist">${histPriceCell(s, a, pub, sku.id)}</td>`).join('')}
      ${v.showMargin ? (first ? `<td class="num grp-margin-sub col-margin">${marginCell(s, a, sku.id)}</td>` : none) : ''}
      ${v.showPrem ? (first ? `<td class="num grp-prem-sub">${simpleAdjCell(s, a, 'P')}</td>` : none) : ''}
      ${v.showDisc ? (first ? `<td class="num grp-disc-sub">${simpleAdjCell(s, a, 'D')}</td>` : none) : ''}
    </tr>`;
  }).join('');
}

// One number for all premiums (or all discounts). Typing it sets the client's credit-risk premium (or its supply-only or
// competition discount) to whatever makes the total match; every other premium or discount the client carries stays.
const adjCode = (a, kind) => (kind === 'P' ? 'CREDIT_RISK' : a.competitorBrand ? 'DUAL_SUPPLIER' : 'SUPPLY_ONLY');
function adjTotal(s, a, kind) { return kind === 'P' ? premiumTotal(s, a).total : discountTotal(a).total; }
function simpleAdjCell(s, a, kind) {
  const code = adjCode(a, kind);
  const total = adjTotal(s, a, kind);
  const ro = editable(s, code) ? '' : ' readonly tabindex="-1"';
  return `<input class="mini" type="number" min="0" step="0.01" inputmode="decimal" placeholder="-" value="${total ? esc(toInput(total)) : ''}" aria-label="${kind === 'P' ? 'Premiums' : 'Discounts'} ₱/kg" data-cgs="${esc(a.id)}|${kind}"${ro}>`;
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

function futurePriceCell(s, a, inp, skuId = a.primarySkuId) {
  if (!inp || !skuId) return '<span class="muted small">—</span>';
  const sku = s.skus.find(k => k.id === skuId);
  if (!sku) return '<span class="muted small">—</span>';
  const { total: premC } = premiumTotal(s, a);
  const { total: discC } = discountTotal(a);
  // Formula: MPL (acq + margin + buffer) + premiums - discounts
  const netPerKg = inp.acq + inp.mar + inp.buf + premC - discC;
  const netPerCyl = Math.round(netPerKg * sku.contentKg);
  const vatRate = s.settings.vatRate || 0;
  const vatInclusive = s.settings.vatInclusive !== false;
  const vatPerCyl = vatInclusive ? Math.round(netPerCyl * vatRate) : 0;
  const grossPerCyl = netPerCyl + vatPerCyl;
  return `<span class="cell-price cell-future">${fmt(grossPerCyl)}</span>`;
}

function marginCell(s, a, skuId = a.primarySkuId) {
  if (!skuId) return '<span class="muted small">—</span>';
  const mr = marginRule(s, a.channelId, skuId);
  const rulePerKg = mr?.perKg;
  const draftVal = ui.margins[a.id] ?? (a.fixedMarginPerKg != null ? toInput(a.fixedMarginPerKg) : '');
  const pastHtml = rulePerKg != null
    ? `<span class="cell-price muted small mg-rule">${fmt(rulePerKg)}/kg</span>`
    : '';
  return `<div class="cellfields">
    ${pastHtml}
    <input class="mini" type="number" min="0" step="0.01" inputmode="decimal" placeholder="-" value="${esc(draftVal)}" aria-label="Margin ₱/kg" data-mg="${esc(a.id)}">
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

async function saveAll(rerender) {
  const s = store.get();
  const changes = [];

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

  // Margin overrides → ACCOUNT_FIELD on fixedMarginPerKg
  for (const [accId, valStr] of Object.entries(ui.margins)) {
    const a = byId(s.accounts, accId);
    if (!a) continue;
    const val = toCentavos(valStr);
    const before = a.fixedMarginPerKg ?? null;
    if ((val ?? null) !== before)
      changes.push({ type: 'ACCOUNT_FIELD', accountId: accId, field: 'fixedMarginPerKg', value: val ?? null });
  }

  const total = changes.length ? wizard.addChanges(changes) : 0;

  ui.rows = {};
  ui.margins = {};
  rerender();
  if (!changes.length) toast('Nothing changed');
  else toast(`${changes.length} price change${changes.length === 1 ? '' : 's'} added to the proposal (${total} in total) — simulate and publish to apply.`);
}

// ---- Behaviour ----

export function bind(root, rerender) {
  const chSel = root.querySelector('#cg-ch');
  if (chSel) chSel.onchange = () => { ui.channelId = chSel.value; ui.selectedIds = null; ui.filterQuery = ''; ui.filterOpen = false; rerender(); };
  if (ui.channelId === 'DEALER') { session.bind(root, rerender, { onSave: session.savedToast }); dealer.bind(root, rerender); return; }
  root.querySelectorAll('[data-cg-exp]').forEach(b => b.onclick = () => {
    const id = b.dataset.cgExp;
    // Commercial clients start open, so "closed" is the stored state there; elsewhere "open" is.
    ui.expanded[id] = ui.channelId === 'COMMERCIAL' ? ui.expanded[id] === false : !ui.expanded[id];
    rerender();
  });

  const toggle = root.querySelector('#cg-toggle');
  if (toggle) toggle.onclick = () => {
    ui.filterOpen = !ui.filterOpen;
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
  root.querySelectorAll('[data-cgs]').forEach(el => {
    const [accId, kind] = el.dataset.cgs.split('|');
    el.oninput = () => {
      const s = store.get();
      const a = byId(s.accounts, accId);
      if (!a) return;
      if (el.value.startsWith('-')) el.value = el.value.replace(/-/g, '');
      const code = adjCode(a, kind);
      const row = editRows(a, code)[0];
      const own = toCentavos(row.perKg) || 0;
      const others = adjTotal(s, a, kind) - own;
      const typed = toCentavos(el.value) || 0;
      row.perKg = typed - others > 0 ? toInput(typed - others) : '';
      const inp = sessionInputs();
      if (inp) root.querySelectorAll(`[data-fp="${CSS.escape(accId)}"]`).forEach(td => { td.innerHTML = futurePriceCell(s, a, inp, td.dataset.fpsku); });
      const saveBtn = root.querySelector('#cg-save');
      if (saveBtn) saveBtn.disabled = false;
    };
    el.onblur = () => {
      const a = byId(store.get().accounts, accId);
      const total = a ? adjTotal(store.get(), a, kind) : 0;
      el.value = total ? toInput(total) : '';
    };
  });
  const save = root.querySelector('#cg-save');
  if (save) save.onclick = () => saveAll(rerender);

  const histToggle = root.querySelector('#cg-hist-toggle');
  if (histToggle) histToggle.onclick = () => { ui.histOpen = !ui.histOpen; rerender(); };

  root.querySelectorAll('[data-mg]').forEach(el => {
    const accId = el.dataset.mg;
    el.oninput = () => {
      ui.margins[accId] = el.value;
      const saveBtn = root.querySelector('#cg-save');
      if (saveBtn) saveBtn.disabled = false;
    };
    el.onblur = () => {
      const c = toCentavos(el.value);
      el.value = c == null ? '' : toInput(c);
      ui.margins[accId] = el.value;
    };
  });

  session.bind(root, rerender);
}
