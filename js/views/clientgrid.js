// Client pricing grid — every client of one channel on a single page.
// Rows are clients; columns are the line types. Fields open with the client's last saved amounts.
// One Save button: price levers go into the open MPL proposal, the rest is saved as client terms.

import * as store from '../store.js';
import { fmt, fmtKg, toCentavos, toInput } from '../money.js';
import { esc, toast } from '../ui.js';
import { byId, priceFor, currentCostBasis, bufferFor, channelLabel, skuLabel, fmtDate } from '../pricing.js';
import * as wizard from './priceroom-wizard.js';

const ui = { channelId: 'COMMERCIAL', expanded: {}, rows: {}, profile: {} };

// Multi-row premium columns.
const COLS = [
  { code: 'ROI_INSTALL', title: 'Installation cost for ROI', note: 'Investment ₱ · ₱/kg · note', roi: true },
  { code: 'CREDIT_RISK', title: 'Credit risk / bad debts', note: '₱/kg · note' },
];

const TANKS = [
  { key: 'tank3_2mt', label: '3.2 MT', kg: 3200 },
  { key: 'tank600', label: '600 kg', kg: 600 },
  { key: 'tank4000', label: '4,000 kg', kg: 4000 },
  { key: 'tank2000', label: '2,000 kg', kg: 2000 },
  { key: 'tank20000', label: '20,000 kg', kg: 20000 },
];

// top: stored on the client record itself; the rest live in client.profile.
const FIELDS = [
  { key: 'installedAt', label: 'Date (installed / activated)', type: 'date' },
  { key: 'lpgContentBilling', label: 'LPG content billing', type: 'text' },
  { key: 'factorRate', label: 'Factor rate', type: 'text' },
  { key: 'tankOwnership', label: 'Tank ownership', type: 'select', choices: ['MGC-owned', 'Client-owned', 'Leased'] },
  ...TANKS.map(t => ({ key: t.key, label: t.label, type: 'int', tank: true })),
  { key: '_usable', label: '60% of tank capacity (90%)', type: 'computed' },
  { key: 'minKgPerDrop', label: 'Minimum kilograms per drop', type: 'int' },
  { key: 'fixedMarginPerKg', label: 'Fixed margin', type: 'money', top: true, lever: true },
  { key: 'investmentCentavos', label: 'Total investment', type: 'money', top: true, lever: true },
  { key: 'reqVolPerMonthKg', label: 'Required volume per month', type: 'int', top: true },
  { key: 'contractStart', label: 'Date start', type: 'date', top: true },
  { key: 'volumeGeneratedKg', label: 'Total generated volume', type: 'int', top: true, asOf: true },
];

export function setChannel(id) {
  ui.channelId = id;
}

// ---- Editing state: drafts start from what is saved, so fields open pre-filled ----

const rowKey = (accId, code) => `${accId}|${code}`;

function currentRows(a, code) {
  return (a.premiums || []).filter(p => p.code === code).map(p => ({
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
  return ui.rows[k];
}

function fieldValue(a, f) {
  const draft = ui.profile[a.id]?.[f.key];
  if (draft !== undefined) return draft;
  const raw = f.top ? a[f.key] : a.profile?.[f.key];
  if (raw == null) return '';
  return f.type === 'money' ? toInput(raw) : String(raw);
}

function setField(a, key, value) {
  (ui.profile[a.id] ||= {})[key] = value;
}

function usableKg(a) {
  const total = TANKS.reduce((t, k) => {
    const v = parseInt(ui.profile[a.id]?.[k.key] ?? a.profile?.[k.key] ?? 0, 10);
    return t + (Number.isFinite(v) ? v : 0) * k.kg;
  }, 0);
  return total ? Math.round(total * 0.9 * 0.6) : 0;
}

export function pendingEdits() {
  return Object.keys(ui.rows).length + Object.keys(ui.profile).length;
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
      <p class="small muted" style="margin:8px 0 0">Fields hold the last saved amounts. Price levers (premiums, discounts, fixed margin, total investment) go into the MPL proposal and take effect on Publish; the remaining client terms are saved straight away.</p>
    </div>
    ${clients.length ? `<div class="table-wrap"><table class="matrix grid-table">
      <thead><tr>
        <th style="min-width:190px">Client</th>
        <th class="num" style="min-width:150px">Current price offered<div class="small muted">view only</div></th>
        ${COLS.map(c => `<th style="min-width:250px">${esc(c.title)}<div class="small muted">${esc(c.note)}</div></th>`).join('')}
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
      <div class="small muted">${esc(skuLabel(s, a.primarySkuId))} · per cyl, VAT incl.</div>
      <div class="fact"><b>MPL ${fmt(cb.acqPerKg + margin)}</b><span>Acq cost + margin</span></div>
      <div class="fact"><b>Margin ${fmt(margin + buffer)}</b><span>Margin + buffer</span></div>`;
  } else if (p?.error) price = `<span class="muted small">${esc(p.error)}</span>`;

  return `<tr>
      <th scope="row">
        <button type="button" class="link exp" data-cg-exp="${esc(a.id)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${esc(a.name)}</button>
        <div class="small muted">${esc(a.zone ?? '—')} · ${esc(a.status)}</div>
      </th>
      <td class="num">${price}</td>
      ${COLS.map(c => `<td>${cellRows(a, c)}</td>`).join('')}
    </tr>
    ${open ? `<tr class="prof"><td colspan="${2 + COLS.length}">${profileBox(a)}</td></tr>` : ''}`;
}

function cellRows(a, col) {
  const rows = draftRows(a, col.code);
  return `<div class="rowlines">
    ${rows.map((r, i) => `<div class="rowline">
      ${col.roi ? `<input class="mini" style="width:92px" inputmode="decimal" placeholder="Investment ₱" value="${esc(r.investment)}" aria-label="Investment" data-cg="${esc(a.id)}|${col.code}|${i}|investment">` : ''}
      <input class="mini" style="width:74px" inputmode="decimal" placeholder="₱/kg" value="${esc(r.perKg)}" aria-label="Per kg" data-cg="${esc(a.id)}|${col.code}|${i}|perKg">
      <input class="mini grow" placeholder="Note" value="${esc(r.note)}" aria-label="Note" data-cg="${esc(a.id)}|${col.code}|${i}|note">
      <button type="button" class="icon small" data-cg-rm="${esc(a.id)}|${col.code}|${i}" aria-label="Remove row">✕</button>
    </div>`).join('')}
    <button type="button" class="small" data-cg-add="${esc(a.id)}|${col.code}">+ Add row</button>
    ${col.roi && !a.trmvKg ? '<div class="small muted">Blank ₱/kg needs a TRMV on the client to divide the investment.</div>' : ''}
  </div>`;
}

function profileBox(a) {
  const today = fmtDate(new Date());
  return `<div class="prof-grid">
    ${FIELDS.map(f => {
      const label = `${f.label}${f.asOf ? ` as of ${today}` : ''}${f.lever ? ' <span class="pill tiffany">price lever</span>' : ''}`;
      if (f.type === 'computed') return `<label class="prof-f"><span>${label}</span><input value="${usableKg(a).toLocaleString('en-PH')} kg" readonly aria-readonly="true"></label>`;
      const v = fieldValue(a, f);
      const input = f.type === 'select'
        ? `<select data-cg-p="${esc(a.id)}|${f.key}"><option value=""></option>${f.choices.map(c => `<option${c === v ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`
        : `<input data-cg-p="${esc(a.id)}|${f.key}" type="${f.type === 'date' ? 'date' : 'text'}" ${f.type === 'money' || f.type === 'int' ? 'inputmode="decimal"' : ''} value="${esc(v)}">`;
      return `<label class="prof-f"><span>${label}</span>${input}</label>`;
    }).join('')}
  </div>`;
}

// ---- Save ----

function num(v) {
  const n = Number(String(v).replace(/[₱,\s]/g, ''));
  return v === '' || !Number.isFinite(n) ? null : n;
}

async function saveAll(rerender) {
  const s = store.get();
  const changes = [];
  const termsPatches = [];
  const summary = [];

  // Premium rows → one change per client and code.
  for (const [key, rows] of Object.entries(ui.rows)) {
    const [accId, code] = key.split('|');
    const a = byId(s.accounts, accId);
    if (!a) continue;
    const next = rows
      .map(r => ({ perKg: toCentavos(r.perKg), investmentCentavos: toCentavos(r.investment), note: r.note.trim() }))
      .filter(r => r.perKg != null || r.investmentCentavos != null || r.note)
      .map(r => ({ ...(r.perKg == null ? {} : { perKg: r.perKg }), ...(r.investmentCentavos ? { investmentCentavos: r.investmentCentavos } : {}), ...(r.note ? { note: r.note } : {}) }));
    const before = (a.premiums || []).filter(p => p.code === code).map(({ code: _c, ...rest }) => rest);
    if (JSON.stringify(before) !== JSON.stringify(next)) changes.push({ type: 'ACCOUNT_COMPONENT', accountId: accId, code, rows: next });
  }

  // Profile fields → price levers into the proposal, everything else straight to client terms.
  for (const [accId, patch] of Object.entries(ui.profile)) {
    const a = byId(s.accounts, accId);
    if (!a) continue;
    const terms = {};
    const top = {};
    for (const [key, raw] of Object.entries(patch)) {
      const f = FIELDS.find(x => x.key === key);
      if (!f || f.type === 'computed') continue;
      const value = f.type === 'money' ? toCentavos(raw) : f.type === 'int' ? (num(raw) == null ? null : Math.round(num(raw))) : (raw.trim() === '' ? null : raw.trim());
      if (f.lever) {
        if ((a[key] ?? null) !== value) changes.push({ type: 'ACCOUNT_FIELD', accountId: accId, field: key, value });
      } else if (f.top) {
        if ((a[key] ?? null) !== value) top[key] = value;
      } else if ((a.profile?.[key] ?? null) !== value) terms[key] = value;
    }
    if (Object.keys(terms).length || Object.keys(top).length) {
      termsPatches.push({ accountId: accId, terms, top });
      summary.push(`${a.name}: ${[...Object.keys(top), ...Object.keys(terms)].map(k => FIELDS.find(f => f.key === k)?.label ?? k).join(', ')}`);
    }
  }

  if (termsPatches.length) {
    await store.commit({
      action: 'CLIENT_TERMS_SAVED', entity: 'account', entityId: termsPatches[0].accountId, field: 'terms',
      after: { count: termsPatches.length, summary: summary.join('; '), accountIds: termsPatches.map(p => p.accountId), patches: termsPatches },
    }, d => {
      for (const p of termsPatches) {
        const a = byId(d.accounts, p.accountId);
        if (!a) continue;
        Object.assign(a, p.top);
        a.profile = { ...(a.profile || {}), ...p.terms };
      }
    });
  }
  const total = changes.length ? wizard.addChanges(changes) : 0;

  ui.rows = {};
  ui.profile = {};
  rerender();
  if (!changes.length && !termsPatches.length) toast('Nothing changed');
  else toast(`${termsPatches.length ? `Terms saved for ${termsPatches.length} client${termsPatches.length === 1 ? '' : 's'}. ` : ''}${changes.length ? `${changes.length} price change${changes.length === 1 ? '' : 's'} added to the proposal (${total} in total) — simulate and publish to apply.` : ''}`);
}

// ---- Behaviour ----

export function bind(root, rerender) {
  root.querySelectorAll('[data-cg-ch]').forEach(b => b.onclick = () => { ui.channelId = b.dataset.cgCh; rerender(); });
  root.querySelectorAll('[data-cg-exp]').forEach(b => b.onclick = () => { const id = b.dataset.cgExp; ui.expanded[id] = !ui.expanded[id]; rerender(); });
  root.querySelectorAll('[data-cg]').forEach(el => el.oninput = () => {
    const [accId, code, i, field] = el.dataset.cg.split('|');
    const a = byId(store.get().accounts, accId);
    if (a) editRows(a, code)[+i][field] = el.value;
  });
  root.querySelectorAll('[data-cg-add]').forEach(b => b.onclick = () => {
    const [accId, code] = b.dataset.cgAdd.split('|');
    const a = byId(store.get().accounts, accId);
    if (a) editRows(a, code).push({ perKg: '', investment: '', note: '' });
    rerender();
  });
  root.querySelectorAll('[data-cg-rm]').forEach(b => b.onclick = () => {
    const [accId, code, i] = b.dataset.cgRm.split('|');
    const a = byId(store.get().accounts, accId);
    if (a) editRows(a, code).splice(+i, 1);
    rerender();
  });
  root.querySelectorAll('[data-cg-p]').forEach(el => {
    const [accId, key] = el.dataset.cgP.split('|');
    const a = byId(store.get().accounts, accId);
    const write = () => { if (a) setField(a, key, el.value); };
    el.oninput = write;
    if (el.tagName === 'SELECT') el.onchange = () => { write(); rerender(); };
    if (TANKS.some(t => t.key === key)) el.onchange = () => { write(); rerender(); };
  });
  const save = root.querySelector('#cg-save');
  if (save) save.onclick = () => saveAll(rerender);
}
