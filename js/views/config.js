// Configuration — manager. Users and roles; clients list with CSV import.
// Every save goes through store.commit, so configuration changes are logged like price changes.

import * as store from '../store.js';
import { fmt } from '../money.js';
import { esc, toast, options, download, preserveFocus } from '../ui.js';
import { parseCsv, toCsv, rowsToAccounts, accountsToRows, templateRows, newAccount } from '../csv.js';
import { channelLabel, skuLabel } from '../pricing.js';
import { FIELDS, labelFor, inputValue, displayValue, parseValue, usableKg } from '../clientterms.js';

const ROLES = ['seller', 'manager', 'messenger', 'viewer'];
const ui = { tab: 'users', users: null, base: null, userErr: '', preview: null, mode: 'merge', fileName: '', clientQuery: '', editClient: null, terms: {}, channels: null, chanBase: null, chanErr: '' };

export function render(root, ctx) {
  const { state: s } = ctx;
  const base = JSON.stringify(s.users);
  if (!ui.users || ui.base !== base) { ui.users = JSON.parse(base); ui.base = base; }
  const chanBase = JSON.stringify(s.channels);
  if (!ui.channels || ui.chanBase !== chanBase) { ui.channels = JSON.parse(chanBase); ui.chanBase = chanBase; }
  const tabs = [['users', 'Users'], ['channels', `Channels (${s.channels.length})`], ['clients', `Clients (${s.accounts.length})`]];
  const body = { users: () => usersHtml(s, ctx.user), channels: () => channelsHtml(s), clients: () => clientsHtml(s) };
  preserveFocus(root, () => {
    root.innerHTML = `<section class="page wide">
      <div class="page-head"><div><div class="eyebrow">Settings</div><h1>Configuration</h1></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
      ${(body[ui.tab] || body.users)()}
    </section>`;
  });
  bind(root, ctx);
}

// ---------------- Users ----------------

function usersHtml(s, me) {
  return `<div class="card">
    <div class="card-head"><div><h2>Users and roles</h2>
      <p class="small muted">Sellers quote on their price lists. Managers reach everything. Messengers see only Competitor price watch. Viewers see their own price list.</p></div>
      <div class="row"><button type="button" id="u-add" class="small">Add user</button>
        <button type="button" id="u-discard" class="small">Discard changes</button>
        <button type="button" id="u-save" class="primary small">Save users</button></div></div>
    ${ui.userErr ? `<div class="banner red" role="alert">${esc(ui.userErr)}</div>` : ''}
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th>Name</th><th>Role</th><th>Price lists</th><th class="center">May draft</th><th class="center">May approve</th><th></th></tr></thead>
      <tbody>${ui.users.map((u, i) => `<tr>
        <td style="min-width:220px"><input type="text" data-u="${i}" data-f="name" value="${esc(u.name)}" aria-label="Name"><div class="small muted">${esc(u.id)}</div></td>
        <td style="min-width:130px"><select data-u="${i}" data-f="role" aria-label="Role">${options(ROLES.map(r => ({ id: r, label: r[0].toUpperCase() + r.slice(1) })), u.role)}</select></td>
        <td>${u.role === 'manager' ? '<span class="pill blue">All price lists</span>'
          : u.role === 'messenger' ? '<span class="small muted">None — messengers see no MGC prices</span>'
          : `<div class="checks">${s.channels.map(c => `<label class="check"><input type="checkbox" data-u="${i}" data-ch="${esc(c.id)}" ${u.channels.includes(c.id) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}</div>`}</td>
        <td class="center"><input type="checkbox" data-u="${i}" data-f="canDraft" ${u.canDraft ? 'checked' : ''} ${u.role === 'manager' ? '' : 'disabled'} aria-label="May draft"></td>
        <td class="center"><input type="checkbox" data-u="${i}" data-f="canApprove" ${u.canApprove ? 'checked' : ''} ${u.role === 'manager' ? '' : 'disabled'} aria-label="May approve"></td>
        <td><button type="button" class="small" data-u-del="${i}" ${u.id === me.id ? 'disabled title="You are acting as this user"' : ''}>Remove</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
}

async function saveUsers(me) {
  const s = store.get();
  ui.userErr = '';
  const users = ui.users.map(u => ({
    ...u, name: u.name.trim(),
    channels: u.role === 'manager' ? ['*'] : u.role === 'messenger' ? [] : u.channels.filter(c => c !== '*'),
    canDraft: u.role === 'manager' && !!u.canDraft, canApprove: u.role === 'manager' && !!u.canApprove,
  }));
  const blankName = users.find(u => !u.name);
  if (blankName) return (ui.userErr = `User ${blankName.id} needs a name`);
  if (users.filter(u => u.role === 'manager').length < 2) return (ui.userErr = 'Keep at least two managers — approval needs a verifier who is not the drafter');
  const noList = users.find(u => (u.role === 'seller' || u.role === 'viewer') && !u.channels.length);
  if (noList) return (ui.userErr = `${noList.name} needs at least one price list`);
  const meAfter = users.find(u => u.id === me.id);
  if (!meAfter || meAfter.role !== 'manager') return (ui.userErr = 'You are acting as this manager — switch to another manager before changing your own role');

  const summary = [];
  for (const u of users) {
    const old = s.users.find(x => x.id === u.id);
    if (!old) { summary.push(`added ${u.name} (${u.role})`); continue; }
    const diffs = [];
    if (old.name !== u.name) diffs.push(`name ${old.name} → ${u.name}`);
    if (old.role !== u.role) diffs.push(`role ${old.role} → ${u.role}`);
    if (JSON.stringify(old.channels) !== JSON.stringify(u.channels)) diffs.push(`price lists ${old.channels.join('/') || 'none'} → ${u.channels.join('/') || 'none'}`);
    if (old.canDraft !== u.canDraft) diffs.push(`may draft ${u.canDraft ? 'on' : 'off'}`);
    if (old.canApprove !== u.canApprove) diffs.push(`may approve ${u.canApprove ? 'on' : 'off'}`);
    if (diffs.length) summary.push(`${u.name}: ${diffs.join(', ')}`);
  }
  for (const old of s.users) if (!users.some(u => u.id === old.id)) summary.push(`removed ${old.name}`);
  if (!summary.length) { toast('No changes to save'); return; }

  await store.commit({
    action: 'CONFIG_CHANGED', entity: 'users', entityId: 'users', field: 'users',
    before: s.users, after: { summary: summary.join('; '), users },
  }, d => { d.users = users; });
  ui.users = null;
  toast('Users saved');
}

// ---------------- Channels ----------------
// The order of this list is the order every channel list in the app uses.

const channelId = label => (label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'CHANNEL').slice(0, 20);

function channelsHtml(s) {
  const usage = id => ({
    clients: s.accounts.filter(a => a.channelId === id).length,
    products: s.marginRules.filter(r => r.channelId === id && r.effectiveTo == null).length,
  });
  return `<div class="card">
    <div class="card-head"><div><h2>Channels and price lists</h2>
      <p class="small muted">This order is the order used everywhere: price lists, the boards, PL notices, the client grid, pickers and the Quote desk.</p></div>
      <div class="row"><button type="button" id="ch-add" class="small">Add channel</button>
        <button type="button" id="ch-discard" class="small">Discard changes</button>
        <button type="button" id="ch-save" class="primary small">Save channels</button></div></div>
    ${ui.chanErr ? `<div class="banner red" role="alert">${esc(ui.chanErr)}</div>` : ''}
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th class="num">#</th><th>Name</th><th>Audience</th><th>ID</th><th class="num">Clients</th><th class="num">Priced products</th><th class="center">Move</th><th></th></tr></thead>
      <tbody>${ui.channels.map((c, i) => {
        const u = c._new ? { clients: 0, products: 0 } : usage(c.id);
        const locked = u.clients || u.products;
        return `<tr>
          <td class="num">${i + 1}</td>
          <td><input type="text" data-ch="${i}" data-f="label" value="${esc(c.label)}" aria-label="Channel name"></td>
          <td><input type="text" data-ch="${i}" data-f="audience" value="${esc(c.audience ?? '')}" aria-label="Audience"></td>
          <td class="small muted">${c._new ? '<i>set on save</i>' : esc(c.id)}</td>
          <td class="num">${u.clients}</td>
          <td class="num">${u.products}</td>
          <td class="center nowrap"><button type="button" class="icon small" data-ch-move="${i}|-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button type="button" class="icon small" data-ch-move="${i}|1" ${i === ui.channels.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></td>
          <td><button type="button" class="small" data-ch-del="${i}" ${locked ? `disabled title="${u.clients} clients, ${u.products} priced products"` : ''}>Remove</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>
    <p class="small muted">A channel can only be removed once it has no clients and no priced products.</p></div>`;
}

async function saveChannels() {
  const s = store.get();
  ui.chanErr = '';
  const next = ui.channels.map(c => ({ ...c, label: c.label.trim(), audience: (c.audience ?? '').trim() }));
  if (!next.length) return (ui.chanErr = 'Keep at least one channel');
  const blank = next.find(c => !c.label);
  if (blank) return (ui.chanErr = 'Every channel needs a name');

  // New rows get their id from the name; existing ids never change, because the data references them.
  const taken = new Set(next.filter(c => !c._new).map(c => c.id));
  for (const c of next) {
    if (!c._new) continue;
    let id = channelId(c.label), n = 2;
    while (taken.has(id)) id = `${channelId(c.label)}_${n++}`;
    taken.add(id);
    c.id = id;
    delete c._new;
  }

  const beforeIds = s.channels.map(c => c.id);
  const afterIds = next.map(c => c.id);
  const summary = [];
  for (const c of next) {
    const old = s.channels.find(x => x.id === c.id);
    if (!old) { summary.push(`added ${c.label}`); continue; }
    if (old.label !== c.label) summary.push(`renamed ${old.label} → ${c.label}`);
    if ((old.audience ?? '') !== c.audience) summary.push(`${c.label} audience → ${c.audience || 'none'}`);
  }
  for (const id of beforeIds) if (!afterIds.includes(id)) summary.push(`removed ${s.channels.find(c => c.id === id).label}`);
  if (beforeIds.join() !== afterIds.filter(id => beforeIds.includes(id)).join()) summary.push(`order: ${next.map(c => c.label).join(' › ')}`);
  if (!summary.length) { toast('No changes to save'); return; }

  await store.commit({
    action: 'CONFIG_CHANGED', entity: 'channels', entityId: 'channels', field: 'channels',
    before: s.channels, after: { summary: summary.join('; '), channels: next },
  }, d => {
    const gone = beforeIds.filter(id => !afterIds.includes(id));
    d.channels = next;
    d.buffers = (d.buffers || []).filter(b => !gone.includes(b.channelId));
    for (const c of next) {
      if (d.buffers.some(b => b.channelId === c.id && b.effectiveTo == null)) continue;
      d.buffers.push({ id: store.uid('buf'), channelId: c.id, perKg: 0, effectiveFrom: new Date().toISOString(), effectiveTo: null });
    }
    for (const u of d.users) u.channels = u.channels.filter(ch => ch === '*' || !gone.includes(ch));
  });
  ui.channels = null;
  toast('Channels saved');
}

// ---------------- Clients ----------------

function clientsHtml(s) {
  const q = ui.clientQuery.trim().toLowerCase();
  const list = s.accounts.filter(a => !q || a.name.toLowerCase().includes(q));
  const compOut = (xs, cat) => (xs || []).map(x => {
    const c = s[cat].find(k => k.code === x.code);
    return `${c?.label ?? x.code}${x.perKg != null ? ` ${fmt(x.perKg)}` : ''}`;
  }).join(', ') || '—';

  return `<div class="card">
    <div class="card-head"><div><h2>Import clients from CSV</h2>
      <p class="small muted">Required columns: Name, Channel, Status. Every other column is optional; a column left out keeps the client's current value. Download the template for the full set of columns.</p></div>
      <div class="row"><button type="button" id="c-template" class="small">Download template</button><button type="button" id="c-export" class="small">Export clients CSV</button></div></div>
    <div class="row"><label class="btn primary small" for="c-file">Choose CSV file</label><input id="c-file" type="file" accept=".csv,.tsv,.txt,text/csv" hidden>
      <span class="small muted">${esc(ui.fileName || 'No file chosen')}</span></div>
    ${ui.preview ? previewHtml(s) : ''}
  </div>

  ${ui.editClient ? termsEditor(s) : ''}

  <div class="card" style="margin-top:16px">
    <div class="card-head"><h2>Clients (${s.accounts.length})</h2>
      <input id="c-q" type="search" placeholder="Filter by name" value="${esc(ui.clientQuery)}" style="max-width:280px" aria-label="Filter clients"></div>
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th>Name</th><th>Channel</th><th>Status</th><th>Zone</th><th>Main product</th><th class="num">Avg monthly kg</th><th class="num">Credit days</th><th>Premiums</th><th>Discounts</th><th></th></tr></thead>
      <tbody>${list.map(a => `<tr><td><b>${esc(a.name)}</b><div class="small muted">${esc(a.id)}</div></td>
        <td>${esc(channelLabel(s, a.channelId))}</td>
        <td><span class="pill ${a.status === 'Active' ? 'green' : 'grey'}">${esc(a.status)}</span>${a.needsAttention ? ' <span class="pill amber">Attention</span>' : ''}</td>
        <td>${esc(a.zone ?? '—')}</td><td>${esc(a.primarySkuId ? skuLabel(s, a.primarySkuId) : '—')}</td>
        <td class="num">${a.avgMonthlyVolumeKg == null ? '—' : a.avgMonthlyVolumeKg.toLocaleString('en-PH')}</td>
        <td class="num">${a.creditTermDays ?? '—'}</td>
        <td class="small">${esc(compOut(a.premiums, 'premiumComponents'))}</td>
        <td class="small">${esc(compOut(a.discounts, 'discountComponents'))}</td>
        <td><button type="button" class="small" data-c-edit="${esc(a.id)}">Edit terms</button></td></tr>`).join('') || '<tr><td colspan="10" class="muted">No clients match.</td></tr>'}
      </tbody></table></div></div>`;
}

// Client terms editor — the fields the pricing grid shows read-only.
function termsEditor(s) {
  const a = s.accounts.find(x => x.id === ui.editClient);
  if (!a) return '';
  const draft = ui.terms;
  return `<div class="card terms-editor" style="margin-top:16px">
    <div class="card-head"><div><h2>Client terms — ${esc(a.name)}</h2>
      <p class="small muted">${esc(channelLabel(s, a.channelId))} · ${esc(a.zone ?? '—')} · fields marked <span class="pill amber">price lever</span> change the price as soon as they are saved.</p></div>
      <div class="row"><button type="button" id="ct-cancel" class="small">Cancel</button><button type="button" id="ct-save" class="primary small">Save terms</button></div></div>
    <div class="prof-grid">
      ${FIELDS.map(f => {
        const label = `${esc(labelFor(f))}${f.lever ? ' <span class="pill amber">price lever</span>' : ''}`;
        if (f.type === 'computed') return `<label class="prof-f"><span>${label}</span><input value="${usableKg(a, draft).toLocaleString('en-PH')} kg" readonly aria-readonly="true"></label>`;
        const v = inputValue(a, f, draft);
        const input = f.type === 'select'
          ? `<select data-ct="${esc(f.key)}"><option value=""></option>${f.choices.map(c => `<option${c === v ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`
          : `<input data-ct="${esc(f.key)}" type="${f.type === 'date' ? 'date' : 'text'}"${f.type === 'money' || f.type === 'int' ? ' inputmode="decimal"' : ''} value="${esc(v)}">`;
        return `<label class="prof-f"><span>${label}</span>${input}</label>`;
      }).join('')}
    </div></div>`;
}

async function saveTerms() {
  const s = store.get();
  const a = s.accounts.find(x => x.id === ui.editClient);
  if (!a) return;
  const top = {}, terms = {}, changed = [];
  for (const [key, raw] of Object.entries(ui.terms)) {
    const f = FIELDS.find(x => x.key === key);
    if (!f || f.type === 'computed') continue;
    const value = parseValue(f, raw);
    const before = (f.top ? a[key] : a.profile?.[key]) ?? null;
    if (before === value) continue;
    (f.top ? top : terms)[key] = value;
    changed.push(`${f.label} ${displayValue(a, f)} → ${displayValue(a, f, { [key]: value })}`);
  }
  if (!changed.length) { toast('Nothing changed'); return; }
  await store.commit({
    action: 'CLIENT_TERMS_SAVED', entity: 'account', entityId: a.id, field: 'terms',
    before: { profile: a.profile ?? null },
    after: { count: 1, accountId: a.id, accountIds: [a.id], summary: `${a.name}: ${changed.join('; ')}`, top, terms },
  }, d => {
    const acc = d.accounts.find(x => x.id === a.id);
    Object.assign(acc, top);
    acc.profile = { ...(acc.profile || {}), ...terms };
  });
  ui.terms = {};
  toast('Client terms saved');
}

function previewHtml(s) {
  const p = ui.preview;
  if (p.fatal) return `<div class="banner red" role="alert" style="margin-top:12px">${esc(p.fatal)}</div>`;
  const valid = p.results.filter(r => r.action !== 'error');
  const adds = valid.filter(r => r.action === 'add').length;
  const replace = ui.mode === 'replace';
  const rows = [...p.results].sort((a, b) => (a.action === 'error') - (b.action === 'error') || a.rowNo - b.rowNo).slice(0, 300);
  return `<div class="preview">
    <div class="kpis">
      <div><span>Rows read</span><b>${p.rowCount}</b></div>
      <div><span>New clients</span><b>${replace ? valid.length : adds}</b></div>
      <div><span>Updates</span><b>${replace ? 0 : valid.length - adds}</b></div>
      <div><span>Skipped with errors</span><b class="${p.results.length - valid.length ? 'pos' : ''}">${p.results.length - valid.length}</b></div>
    </div>
    ${p.ignored.length ? `<p class="small muted">Ignored columns: ${esc(p.ignored.join(', '))}</p>` : ''}
    <div class="row" style="margin:8px 0">
      <label class="check"><input type="radio" name="c-mode" value="merge" ${replace ? '' : 'checked'}> Add new, update matching clients</label>
      <label class="check"><input type="radio" name="c-mode" value="replace" ${replace ? 'checked' : ''}> Replace the whole list (${s.accounts.length} current clients removed)</label>
    </div>
    <div class="table-wrap" style="max-height:360px"><table class="mini">
      <thead><tr><th>Row</th><th>Name</th><th>Channel</th><th>Status</th><th>Result</th><th>Notes</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="num">${r.rowNo}</td><td>${esc(r.name || '—')}</td><td>${esc(r.channelId ? channelLabel(s, r.channelId) : '—')}</td>
        <td>${esc(r.status ?? '—')}${r.patch.needsAttention ? ' <span class="pill amber">Attention</span>' : ''}</td>
        <td><span class="pill ${r.action === 'error' ? 'red' : r.action === 'add' || replace ? 'tiffany' : 'blue'}">${r.action === 'error' ? 'Skipped' : r.action === 'add' || replace ? 'New' : 'Update'}</span></td>
        <td class="small">${[...r.errors.map(e => `<span class="pos">${esc(e)}</span>`), ...r.warnings.map(w => `<span class="muted">${esc(w)}</span>`)].join('<br>')}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="row" style="margin-top:12px"><button type="button" id="c-import" class="primary" ${valid.length ? '' : 'disabled'}>Import ${valid.length} client${valid.length === 1 ? '' : 's'}</button>
      <button type="button" id="c-cancel">Cancel</button></div></div>`;
}

async function doImport() {
  const s = store.get();
  const p = ui.preview;
  const valid = p.results.filter(r => r.action !== 'error');
  const replace = ui.mode === 'replace';
  await store.commit({
    action: 'ACCOUNTS_IMPORTED', entity: 'account', entityId: 'accounts', field: 'accounts',
    before: { count: s.accounts.length },
    after: { file: ui.fileName || 'pasted rows', mode: ui.mode, rows: p.rowCount, skipped: p.results.length - valid.length },
  }, (d, ev) => {
    let added = 0, updated = 0;
    const ids = [];
    const removed = replace ? d.accounts.length : 0;
    if (replace) d.accounts = [];
    for (const r of valid) {
      const existing = !replace && r.matchId ? d.accounts.find(a => a.id === r.matchId) : null;
      if (existing) { Object.assign(existing, r.patch); updated++; ids.push(existing.id); }
      else {
        const acc = newAccount(d.accounts, replace && r.matchId ? { _newId: r.matchId, ...r.patch } : r.patch);
        d.accounts.push(acc); added++; ids.push(acc.id);
      }
    }
    Object.assign(ev.after, { added, updated, removed, accountIds: ids });
  });
  ui.preview = null;
  ui.fileName = '';
  toast(`Imported ${valid.length} client${valid.length === 1 ? '' : 's'}`);
}

// ---------------- Behaviour ----------------

function bind(root, ctx) {
  const rerender = () => render(root, { ...ctx, state: store.get(), user: store.currentUser() });
  const $ = id => root.querySelector('#' + id);
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; rerender(); });

  // Users
  root.querySelectorAll('[data-u][data-f]').forEach(el => {
    const u = ui.users[+el.dataset.u];
    if (el.type === 'checkbox') el.onchange = () => { u[el.dataset.f] = el.checked; };
    else if (el.tagName === 'SELECT') el.onchange = () => { u.role = el.value; rerender(); };
    else el.oninput = () => { u.name = el.value; };
  });
  root.querySelectorAll('[data-u][data-ch]').forEach(el => el.onchange = () => {
    const u = ui.users[+el.dataset.u];
    u.channels = el.checked ? [...new Set([...u.channels, el.dataset.ch])] : u.channels.filter(c => c !== el.dataset.ch);
  });
  root.querySelectorAll('[data-u-del]').forEach(b => b.onclick = () => { ui.users.splice(+b.dataset.uDel, 1); rerender(); });
  if ($('u-add')) $('u-add').onclick = () => {
    ui.users.push({ id: store.uid('u'), name: '', role: 'seller', channels: [], canDraft: false, canApprove: false });
    rerender();
    root.querySelector(`[data-u="${ui.users.length - 1}"][data-f="name"]`)?.focus();
  };
  if ($('u-discard')) $('u-discard').onclick = () => { ui.users = null; ui.userErr = ''; rerender(); };
  if ($('u-save')) $('u-save').onclick = async () => { await saveUsers(ctx.user); rerender(); };

  // Channels
  root.querySelectorAll('[data-ch][data-f]').forEach(el => el.oninput = () => { ui.channels[+el.dataset.ch][el.dataset.f] = el.value; });
  root.querySelectorAll('[data-ch-move]').forEach(b => b.onclick = () => {
    const [i, step] = b.dataset.chMove.split('|').map(Number);
    const to = i + step;
    if (to < 0 || to >= ui.channels.length) return;
    const list = ui.channels;
    [list[i], list[to]] = [list[to], list[i]];
    rerender();
  });
  root.querySelectorAll('[data-ch-del]').forEach(b => b.onclick = () => { ui.channels.splice(+b.dataset.chDel, 1); rerender(); });
  if ($('ch-add')) $('ch-add').onclick = () => {
    ui.channels.push({ id: '', label: '', audience: '', _new: true });
    rerender();
    root.querySelector(`[data-ch="${ui.channels.length - 1}"][data-f="label"]`)?.focus();
  };
  if ($('ch-discard')) $('ch-discard').onclick = () => { ui.channels = null; ui.chanErr = ''; rerender(); };
  if ($('ch-save')) $('ch-save').onclick = async () => { await saveChannels(); rerender(); };

  // Clients
  const preview = (text, name) => {
    ui.fileName = name;
    ui.preview = rowsToAccounts(store.get(), parseCsv(text));
    rerender();
  };
  if ($('c-file')) $('c-file').onchange = async e => { const f = e.target.files[0]; if (f) preview(await f.text(), f.name); };
  root.querySelectorAll('[name=c-mode]').forEach(r => r.onchange = () => { ui.mode = r.value; rerender(); });
  if ($('c-import')) $('c-import').onclick = async () => {
    if (ui.mode === 'replace' && !confirm(`Replace all ${store.get().accounts.length} clients with this file?`)) return;
    await doImport(); rerender();
  };
  if ($('c-cancel')) $('c-cancel').onclick = () => { ui.preview = null; ui.fileName = ''; rerender(); };
  if ($('c-template')) $('c-template').onclick = () => download('mgc-clients-template.csv', new Blob(['﻿' + toCsv(templateRows())], { type: 'text/csv' }));
  if ($('c-export')) $('c-export').onclick = () => download('mgc-clients.csv', new Blob(['﻿' + toCsv(accountsToRows(store.get().accounts))], { type: 'text/csv' }));
  if ($('c-q')) $('c-q').oninput = e => { ui.clientQuery = e.target.value; rerender(); };

  // Client terms
  root.querySelectorAll('[data-c-edit]').forEach(b => b.onclick = () => {
    ui.editClient = b.dataset.cEdit;
    ui.terms = {};
    rerender();
    root.querySelector('[data-ct]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  root.querySelectorAll('[data-ct]').forEach(el => {
    const write = () => { ui.terms[el.dataset.ct] = el.value; };
    el.oninput = write;
    el.onchange = () => { write(); rerender(); };
  });
  if ($('ct-cancel')) $('ct-cancel').onclick = () => { ui.editClient = null; ui.terms = {}; rerender(); };
  if ($('ct-save')) $('ct-save').onclick = async () => { await saveTerms(); rerender(); };
}
