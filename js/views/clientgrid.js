// Client pricing grid — every client of one channel on a single page.
// Rows are clients; columns are the line types. Fields open with the client's last saved amounts.
// One Save button: price levers go into the open MPL proposal, the rest is saved as client terms.

import * as store from '../store.js';
import { fmt, fmtKg, toCentavos, toInput } from '../money.js';
import { esc, toast } from '../ui.js';
import { byId, priceFor, currentCostBasis, bufferFor, channelLabel, skuLabel } from '../pricing.js';
import { derivePremiumPerKg } from '../engine.js';
import { FIELDS, labelFor, displayValue } from '../clientterms.js';
import * as wizard from './priceroom-wizard.js';

const ui = { channelId: 'COMMERCIAL', expanded: {}, rows: {} };

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

// Field definitions live in clientterms.js; this screen only reads them.

export function setChannel(id) {
  ui.channelId = id;
}

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
  return Object.keys(ui.rows).length;
}

// ---- Render ----

export function html(s) {
  const clients = s.accounts.filter(a => a.channelId === ui.channelId);
  const cb = currentCostBasis(s);
  const edits = pendingEdits();

  const chips = s.channels.map(c => `<button type="button" class="chip-btn ${c.id === ui.channelId ? 'on' : ''}" data-cg-ch="${esc(c.id)}">${esc(c.label)}</button>`).join('');

  return `<div class="picker">
      <div class="row"><div class="chips grow" style="margin:0">${chips}</div>
        <span class="small muted">${clients.length} client${clients.length === 1 ? '' : 's'}${edits ? ` · ${edits} unsaved` : ''}</span>
        <button type="button" id="cg-save" class="primary" ${edits ? '' : 'disabled'}>Save all changes</button></div>
    </div>
    ${clients.length ? `<div class="table-wrap"><table class="matrix grid-table">
      <thead>
      <tr class="grp">
        <th rowspan="2" class="col-client">Client</th>
        <th rowspan="2" class="num col-price">Current price<div class="small muted">per cyl, VAT incl.</div></th>
        <th colspan="${PREMIUM_COLS.length + 1}" class="grp-prem">Premiums</th>
        <th colspan="${DISCOUNT_COLS.length + 1}" class="grp-disc">Discounts</th>
      </tr>
      <tr>
        <th class="num grp-prem-sub col-total">Total premium</th>
        ${PREMIUM_COLS.map(c => `<th class="col-line">${esc(c.title)}</th>`).join('')}
        <th class="num grp-disc-sub col-total">Total discounts<div class="small muted">view only</div></th>
        ${DISCOUNT_COLS.map(c => `<th class="col-line">${esc(c.title)}</th>`).join('')}
      </tr></thead>
      <tbody>${clients.map(a => clientRow(s, a, cb)).join('')}</tbody>
    </table></div>` : '<p class="muted">No clients on this channel yet.</p>'}`;
}

function clientRow(s, a, cb) {
  const open = !!ui.expanded[a.id];
  const p = a.primarySkuId ? priceFor(s, { accountId: a.id, skuId: a.primarySkuId }) : null;
  let price = '<span class="muted small">No main product</span>';
  if (p && !p.error) {
    const margin = p.input.marginPerKg;
    const buffer = p.input.bufferPerKg || 0;
    price = `<div class="cell-price">${fmt(p.result.grossPerCyl)}</div>
      <div class="small muted">${esc(skuLabel(s, a.primarySkuId))}</div>
      <div class="fact"><b>MPL ${fmt(cb.acqPerKg + margin)}</b><span>Acq + margin</span></div>
      <div class="fact"><b>Margin ${fmt(margin + buffer)}</b><span>Margin + buffer</span></div>`;
  } else if (p?.error) price = `<span class="muted small">${esc(p.error)}</span>`;

  return `<tr>
      <th scope="row">
        <button type="button" class="link exp" data-cg-exp="${esc(a.id)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${esc(a.name)}</button>
        <div class="small muted">${esc(a.zone ?? '—')} · ${esc(a.status)}</div>
      </th>
      <td class="num">${price}</td>
      <td class="num grp-prem-sub" id="tp-${esc(a.id)}">${totalCell(s, a)}</td>
      ${PREMIUM_COLS.map(c => `<td>${cellRows(a, c)}</td>`).join('')}
      <td class="num grp-disc-sub" id="td-${esc(a.id)}">${discountCell(a)}</td>
      ${DISCOUNT_COLS.map(c => `<td>${cellRows(a, c)}</td>`).join('')}
    </tr>
    ${open ? `<tr class="prof"><td colspan="${4 + COLS.length}">${profileBox(a)}</td></tr>` : ''}`;
}

function totalCell(s, a) {
  const { total, otherTotal, otherCount } = premiumTotal(s, a);
  return `<div class="cell-price">${fmt(total)}</div><div class="small muted">per kg</div>
    ${otherCount ? `<div class="small muted">incl. ${otherCount} other premium${otherCount === 1 ? '' : 's'} ${fmt(otherTotal)}</div>` : ''}`;
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
  return `<div class="cell-price">${total ? '−' : ''}${fmt(total)}</div><div class="small muted">per kg</div>
    ${otherCount ? `<div class="small muted">incl. ${otherCount} other ${fmt(otherTotal)}</div>` : ''}`;
}

// One row of fields per client and line type. Any extra rows a client already carries are kept as they are.
// Amounts are money: two decimals, never negative.
function cellRows(a, col) {
  const rows = draftRows(a, col.code);
  const r = rows[0] || { perKg: '', investment: '', note: '' };
  const extra = Math.max(0, rows.length - 1);
  const amount = `<input class="mini" type="number" min="0" step="0.01" inputmode="decimal" placeholder="₱/kg" value="${esc(r.perKg)}" aria-label="Per kg" data-cg="${esc(a.id)}|${col.code}|0|perKg">`;
  const note = `<input class="mini" type="text" placeholder="Note" value="${esc(r.note)}" aria-label="Note" data-cg="${esc(a.id)}|${col.code}|0|note">`;
  return `<div class="cellfields">
    ${amount}${note}
    ${col.roi && r.investment ? `<div class="small muted">Investment ${fmt(toCentavos(r.investment))} ÷ TRMV when ₱/kg is blank</div>` : ''}
    ${extra ? `<div class="small muted">+${extra} more row${extra === 1 ? '' : 's'} kept</div>` : ''}
  </div>`;
}

// View only, and kept tight. These are maintained in Configuration → Clients.
function profileBox(a) {
  return `<div class="terms-line">
    ${FIELDS.map(f => `<span class="term"><i>${esc(labelFor(f))}</i>${esc(displayValue(a, f))}</span>`).join('')}
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
    if (!a) continue;
    const next = rows
      .map(r => ({ perKg: toCentavos(r.perKg), investmentCentavos: toCentavos(r.investment), note: (r.note || '').trim() }))
      .filter(r => r.perKg != null || r.investmentCentavos != null || r.note)
      .map(r => ({ ...(r.perKg == null ? {} : { perKg: r.perKg }), ...(r.investmentCentavos ? { investmentCentavos: r.investmentCentavos } : {}), ...(r.note ? { note: r.note } : {}) }));
    const before = listFor(a, code).filter(p => p.code === code).map(({ code: _c, ...rest }) => rest);
    if (JSON.stringify(before) !== JSON.stringify(next)) changes.push({ type: 'ACCOUNT_COMPONENT', accountId: accId, code, rows: next });
  }

  const total = changes.length ? wizard.addChanges(changes) : 0;

  ui.rows = {};
  rerender();
  if (!changes.length) toast('Nothing changed');
  else toast(`${changes.length} price change${changes.length === 1 ? '' : 's'} added to the proposal (${total} in total) — simulate and publish to apply.`);
}

// ---- Behaviour ----

export function bind(root, rerender) {
  root.querySelectorAll('[data-cg-ch]').forEach(b => b.onclick = () => { ui.channelId = b.dataset.cgCh; rerender(); });
  root.querySelectorAll('[data-cg-exp]').forEach(b => b.onclick = () => { const id = b.dataset.cgExp; ui.expanded[id] = !ui.expanded[id]; rerender(); });
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
    };
    // Leave the field showing centavos, the way every other amount in the app reads.
    if (field === 'perKg') el.onblur = () => {
      const v = toCentavos(el.value);
      el.value = v == null || v < 0 ? '' : toInput(v);
      editRows(a, code)[+i].perKg = el.value;
    };
  });
  const save = root.querySelector('#cg-save');
  if (save) save.onclick = () => saveAll(rerender);
}
