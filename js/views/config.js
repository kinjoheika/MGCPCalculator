// Configuration — manager. Users, channels, products, price watch zones and the clients list.
// Every save goes through store.commit, so configuration changes are logged like price changes.

import * as store from '../store.js';
import { fmt } from '../money.js';
import { esc, toast, options, download, preserveFocus } from '../ui.js';
import { parseCsv, toCsv, rowsToAccounts, accountsToRows, templateRows, newAccount } from '../csv.js';
import { channelLabel, skuLabel } from '../pricing.js';
import { FIELDS, labelFor, inputValue, displayValue, parseValue, usableKg } from '../clientterms.js';

const ROLES = ['seller', 'manager', 'messenger', 'viewer'];
const ui = { tab: 'users', users: null, base: null, userErr: '', preview: null, mode: 'merge', fileName: '', clientQuery: '', editClient: null, terms: {}, basic: {}, clientErr: '', channels: null, chanBase: null, chanErr: '',
  skus: null, skuBase: null, skuErr: '', zones: null, zoneBase: null, zoneErr: '' };

export function render(root, ctx) {
  const { state: s } = ctx;
  const base = JSON.stringify(s.users);
  if (!ui.users || ui.base !== base) { ui.users = JSON.parse(base); ui.base = base; }
  const chanBase = JSON.stringify(s.channels);
  if (!ui.channels || ui.chanBase !== chanBase) { ui.channels = JSON.parse(chanBase); ui.chanBase = chanBase; }
  const skuBase = JSON.stringify(s.skus);
  if (!ui.skus || ui.skuBase !== skuBase) { ui.skus = JSON.parse(skuBase); ui.skuBase = skuBase; }
  const zoneBase = JSON.stringify(s.zones);
  if (!ui.zones || ui.zoneBase !== zoneBase) { ui.zones = s.zones.map(z => ({ name: z, from: z })); ui.zoneBase = zoneBase; }
  const tabs = [['users', 'Users'], ['channels', `Channels (${s.channels.length})`], ['products', `Products (${s.skus.length})`],
    ['zones', `Zones (${s.zones.length})`], ['clients', `Clients (${s.accounts.length})`]];
  const body = {
    users: () => usersHtml(s, ctx.user), channels: () => channelsHtml(s), products: () => productsHtml(s),
    zones: () => zonesHtml(s), clients: () => clientsHtml(s),
  };
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
</div>
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

// "3|-1" — move the row at index 3 one place up.
function move(list, spec) {
  const [i, step] = spec.split('|').map(Number);
  const to = i + step;
  if (to < 0 || to >= list.length) return;
  [list[i], list[to]] = [list[to], list[i]];
}

function channelsHtml(s) {
  const usage = id => ({
    clients: s.accounts.filter(a => a.channelId === id).length,
    products: s.marginRules.filter(r => r.channelId === id && r.effectiveTo == null).length,
  });
  return `<div class="card">
    <div class="card-head"><div><h2>Channels and price lists</h2>
</div>
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

// ---------------- Products ----------------
// This order is the order products appear in every list and on every price list.

function productUsage(s, id) {
  return {
    priced: s.marginRules.filter(r => r.skuId === id && r.effectiveTo == null).length,
    clients: s.accounts.filter(a => a.primarySkuId === id).length,
    quotes: s.quotes.filter(q => q.skuId === id).length + s.competitorReadings.filter(r => r.skuId === id).length,
  };
}

function productsHtml(s) {
  return `<div class="card">
    <div class="card-head"><h2>Products</h2>
      <div class="row"><button type="button" id="sk-add" class="small">Add product</button>
        <button type="button" id="sk-discard" class="small">Discard changes</button>
        <button type="button" id="sk-save" class="primary small">Save products</button></div></div>
    ${ui.skuErr ? `<div class="banner red" role="alert">${esc(ui.skuErr)}</div>` : ''}
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th class="num">#</th><th>Name</th><th class="num">Content kg</th><th class="center">Sold</th><th>ID</th><th class="num">Priced on</th><th class="num">Clients</th><th class="center">Move</th><th></th></tr></thead>
      <tbody>${ui.skus.map((k, i) => {
        const u = k._new ? { priced: 0, clients: 0, quotes: 0 } : productUsage(s, k.id);
        const locked = u.priced || u.clients || u.quotes;
        return `<tr>
          <td class="num">${i + 1}</td>
          <td><input type="text" data-sk="${i}" data-f="label" value="${esc(k.label)}" aria-label="Product name"></td>
          <td><input type="number" min="0.1" step="0.1" data-sk="${i}" data-f="contentKg" value="${esc(k.contentKg ?? '')}" aria-label="Content kg"></td>
          <td class="center"><input type="checkbox" data-sk="${i}" data-f="active" ${k.active ? 'checked' : ''} aria-label="Sold"></td>
          <td class="small muted">${k._new ? '<i>set on save</i>' : esc(k.id)}</td>
          <td class="num">${u.priced} channel${u.priced === 1 ? '' : 's'}</td>
          <td class="num">${u.clients}</td>
          <td class="center nowrap"><button type="button" class="icon small" data-sk-move="${i}|-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button type="button" class="icon small" data-sk-move="${i}|1" ${i === ui.skus.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></td>
          <td><button type="button" class="small" data-sk-del="${i}" ${locked ? `disabled title="Priced on ${u.priced} channels, ${u.clients} clients, ${u.quotes} quotes or readings"` : ''}>Remove</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>
    <p class="small muted">Untick <b>Sold</b> to take a product off the pickers and price lists without deleting it. A product can only be removed once nothing references it.</p></div>`;
}

async function saveProducts() {
  const s = store.get();
  ui.skuErr = '';
  const next = ui.skus.map(k => ({ ...k, label: k.label.trim(), contentKg: Number(k.contentKg), active: !!k.active }));
  if (!next.length) return (ui.skuErr = 'Keep at least one product');
  const blank = next.find(k => !k.label);
  if (blank) return (ui.skuErr = 'Every product needs a name');
  const badKg = next.find(k => !Number.isFinite(k.contentKg) || k.contentKg <= 0);
  if (badKg) return (ui.skuErr = `${badKg.label} needs a content in kilograms`);

  const taken = new Set(next.filter(k => !k._new).map(k => k.id));
  for (const k of next) {
    if (!k._new) continue;
    let id = channelId(k.label), n = 2;
    while (taken.has(id)) id = `${channelId(k.label)}_${n++}`;
    taken.add(id);
    k.id = id;
    delete k._new;
  }

  const summary = [];
  for (const k of next) {
    const old = s.skus.find(x => x.id === k.id);
    if (!old) { summary.push(`added ${k.label}`); continue; }
    if (old.label !== k.label) summary.push(`renamed ${old.label} → ${k.label}`);
    if (old.contentKg !== k.contentKg) summary.push(`${k.label} content ${old.contentKg} → ${k.contentKg} kg`);
    if (old.active !== k.active) summary.push(`${k.label} ${k.active ? 'sold again' : 'no longer sold'}`);
  }
  for (const old of s.skus) if (!next.some(k => k.id === old.id)) summary.push(`removed ${old.label}`);
  if (s.skus.map(k => k.id).join() !== next.map(k => k.id).filter(id => s.skus.some(x => x.id === id)).join()) summary.push(`order: ${next.map(k => k.label).join(' › ')}`);
  if (!summary.length) { toast('No changes to save'); return; }

  await store.commit({
    action: 'CONFIG_CHANGED', entity: 'skus', entityId: 'skus', field: 'skus',
    before: s.skus, after: { summary: summary.join('; '), skus: next },
  }, d => { d.skus = next; });
  ui.skus = null;
  toast('Products saved');
}

// ---------------- Price watch zones ----------------

function zoneUsage(s, name) {
  return {
    readings: s.competitorReadings.filter(r => r.zone === name).length,
    clients: s.accounts.filter(a => a.zone && (a.zone === name || a.zone.startsWith(name))).length,
  };
}

function zonesHtml(s) {
  return `<div class="card">
    <div class="card-head"><h2>Price watch zones</h2>
      <div class="row"><button type="button" id="z-add" class="small">Add zone</button>
        <button type="button" id="z-discard" class="small">Discard changes</button>
        <button type="button" id="z-save" class="primary small">Save zones</button></div></div>
    ${ui.zoneErr ? `<div class="banner red" role="alert">${esc(ui.zoneErr)}</div>` : ''}
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th class="num">#</th><th>Zone</th><th class="num">Readings</th><th class="num">Clients</th><th class="center">Move</th><th></th></tr></thead>
      <tbody>${ui.zones.map((z, i) => {
        const u = z.from ? zoneUsage(s, z.from) : { readings: 0, clients: 0 };
        return `<tr>
          <td class="num">${i + 1}</td>
          <td><input type="text" data-z="${i}" value="${esc(z.name)}" aria-label="Zone name"></td>
          <td class="num">${u.readings}</td>
          <td class="num">${u.clients}</td>
          <td class="center nowrap"><button type="button" class="icon small" data-z-move="${i}|-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button type="button" class="icon small" data-z-move="${i}|1" ${i === ui.zones.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></td>
          <td><button type="button" class="small" data-z-del="${i}" ${u.readings || u.clients ? `disabled title="${u.readings} readings, ${u.clients} clients"` : ''}>Remove</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>
    <p class="small muted">Zones drive the messenger's weekly checklist, the competitor readings and the "no reading this week" exceptions. Renaming one carries its readings and clients across.</p></div>`;
}

async function saveZones() {
  const s = store.get();
  ui.zoneErr = '';
  const next = ui.zones.map(z => ({ ...z, name: z.name.trim() }));
  if (!next.length) return (ui.zoneErr = 'Keep at least one zone');
  if (next.some(z => !z.name)) return (ui.zoneErr = 'Every zone needs a name');
  const names = next.map(z => z.name.toLowerCase());
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  if (dupe) return (ui.zoneErr = `Two zones are both called "${dupe}"`);

  const renames = next.filter(z => z.from && z.from !== z.name);
  const summary = [
    ...next.filter(z => !z.from).map(z => `added ${z.name}`),
    ...renames.map(z => `renamed ${z.from} → ${z.name}`),
    ...s.zones.filter(z => !next.some(n => n.from === z)).map(z => `removed ${z}`),
  ];
  const order = next.map(z => z.name);
  if (s.zones.join() !== order.filter(n => s.zones.includes(n)).join()) summary.push(`order: ${order.join(' › ')}`);
  if (!summary.length) { toast('No changes to save'); return; }

  await store.commit({
    action: 'CONFIG_CHANGED', entity: 'zones', entityId: 'zones', field: 'zones',
    before: s.zones, after: { summary: summary.join('; '), zones: order },
  }, d => {
    d.zones = order;
    for (const { from, name } of renames) {
      for (const r of d.competitorReadings) if (r.zone === from) r.zone = name;
      for (const a of d.accounts) {
        if (a.zone === from) a.zone = name;
        else if (a.zone && a.zone.startsWith(from)) a.zone = name + a.zone.slice(from.length);
      }
    }
  });
  ui.zones = null;
  toast('Zones saved');
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
        <td><button type="button" class="small" data-c-edit="${esc(a.id)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="10" class="muted">No clients match.</td></tr>'}
      </tbody></table></div></div>`;
}

// The basic client record, edited alongside the terms below it.
const BASIC = [
  { key: 'name', label: 'Client name', type: 'text' },
  { key: 'channelId', label: 'Channel', type: 'select', from: s => s.channels.map(c => [c.id, c.label]) },
  { key: 'status', label: 'Status', type: 'select', from: () => [['Active', 'Active'], ['Inactive', 'Inactive']] },
  { key: 'needsAttention', label: 'Needs attention', type: 'select', from: () => [['no', 'No'], ['yes', 'Yes']] },
  { key: 'zone', label: 'Zone', type: 'zone' },
  { key: 'primarySkuId', label: 'Main product', type: 'select', from: s => s.skus.filter(k => k.active).map(k => [k.id, k.label]) },
  { key: 'avgMonthlyVolumeKg', label: 'Avg monthly volume (kg)', type: 'int' },
  { key: 'creditTermDays', label: 'Credit term (days)', type: 'int' },
  { key: 'competitorBrand', label: 'Competitor brand', type: 'text' },
];

const basicValue = (a, f) => {
  if (ui.basic[f.key] !== undefined) return ui.basic[f.key];
  if (f.key === 'needsAttention') return a.needsAttention ? 'yes' : 'no';
  return a[f.key] == null ? '' : String(a[f.key]);
};

// Client editor — the basic record, then the terms the pricing grid shows read-only.
function termsEditor(s) {
  const a = s.accounts.find(x => x.id === ui.editClient);
  if (!a) return '';
  const draft = ui.terms;
  return `<div class="card terms-editor" style="margin-top:16px">
    <div class="card-head"><div><h2>${esc(a.name)}</h2>
      <p class="small muted">${esc(a.id)} · fields marked <span class="pill amber">price lever</span> change the price as soon as they are saved.</p></div>
      <div class="row"><button type="button" id="ct-cancel" class="small">Cancel</button><button type="button" id="ct-save" class="primary small">Save client</button></div></div>
    ${ui.clientErr ? `<div class="banner red" role="alert">${esc(ui.clientErr)}</div>` : ''}
    <div class="section-title">Client details</div>
    <div class="prof-grid">
      ${BASIC.map(f => {
        const v = basicValue(a, f);
        const input = f.type === 'select'
          ? `<select data-cb="${f.key}">${f.key === 'primarySkuId' ? '<option value=""></option>' : ''}${f.from(s).map(([val, label]) => `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`
          : f.type === 'zone'
            ? `<input data-cb="zone" type="text" list="cfg-zones" value="${esc(v)}">`
            : `<input data-cb="${f.key}" type="${f.type === 'int' ? 'number' : 'text'}"${f.type === 'int' ? ' min="0" step="1"' : ''} value="${esc(v)}">`;
        return `<label class="prof-f"><span>${esc(f.label)}</span>${input}</label>`;
      }).join('')}
    </div>
    <datalist id="cfg-zones">${s.zones.map(z => `<option value="${esc(z)}"></option>`).join('')}</datalist>
    <div class="section-title">Client terms</div>
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
  ui.clientErr = '';

  // Basic record first, so a bad value stops the whole save.
  for (const f of BASIC) {
    if (ui.basic[f.key] === undefined) continue;
    const raw = String(ui.basic[f.key]).trim();
    let value;
    if (f.key === 'needsAttention') value = raw === 'yes';
    else if (f.type === 'int') { value = raw === '' ? null : Math.round(Number(raw.replace(/[,\s]/g, ''))); if (value != null && (!Number.isFinite(value) || value < 0)) { ui.clientErr = `${f.label} must be a number of 0 or more`; return; } }
    else value = raw === '' ? null : raw;
    if (f.key === 'name' && !value) { ui.clientErr = 'The client needs a name'; return; }
    if ((f.key === 'channelId' || f.key === 'status') && !value) { ui.clientErr = `${f.label} is required`; return; }
    const before = a[f.key] ?? (f.key === 'needsAttention' ? false : null);
    if (before === value) continue;
    top[f.key] = value;
    const show = v => (v == null || v === '' ? 'none' : f.key === 'channelId' ? channelLabel(s, v) : f.key === 'primarySkuId' ? skuLabel(s, v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v);
    changed.push(`${f.label} ${show(before)} → ${show(value)}`);
  }

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
  ui.basic = {};
  toast('Client saved');
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
  root.querySelectorAll('[data-ch-move]').forEach(b => b.onclick = () => { move(ui.channels, b.dataset.chMove); rerender(); });
  root.querySelectorAll('[data-ch-del]').forEach(b => b.onclick = () => { ui.channels.splice(+b.dataset.chDel, 1); rerender(); });
  if ($('ch-add')) $('ch-add').onclick = () => {
    ui.channels.push({ id: '', label: '', audience: '', _new: true });
    rerender();
    root.querySelector(`[data-ch="${ui.channels.length - 1}"][data-f="label"]`)?.focus();
  };
  if ($('ch-discard')) $('ch-discard').onclick = () => { ui.channels = null; ui.chanErr = ''; rerender(); };
  if ($('ch-save')) $('ch-save').onclick = async () => { await saveChannels(); rerender(); };

  // Products
  root.querySelectorAll('[data-sk][data-f]').forEach(el => {
    const k = ui.skus[+el.dataset.sk];
    if (el.type === 'checkbox') el.onchange = () => { k.active = el.checked; };
    else el.oninput = () => { k[el.dataset.f] = el.value; };
  });
  root.querySelectorAll('[data-sk-move]').forEach(b => b.onclick = () => { move(ui.skus, b.dataset.skMove); rerender(); });
  root.querySelectorAll('[data-sk-del]').forEach(b => b.onclick = () => { ui.skus.splice(+b.dataset.skDel, 1); rerender(); });
  if ($('sk-add')) $('sk-add').onclick = () => {
    ui.skus.push({ id: '', label: '', contentKg: '', active: true, _new: true });
    rerender();
    root.querySelector(`[data-sk="${ui.skus.length - 1}"][data-f="label"]`)?.focus();
  };
  if ($('sk-discard')) $('sk-discard').onclick = () => { ui.skus = null; ui.skuErr = ''; rerender(); };
  if ($('sk-save')) $('sk-save').onclick = async () => { await saveProducts(); rerender(); };

  // Zones
  root.querySelectorAll('[data-z]').forEach(el => el.oninput = () => { ui.zones[+el.dataset.z].name = el.value; });
  root.querySelectorAll('[data-z-move]').forEach(b => b.onclick = () => { move(ui.zones, b.dataset.zMove); rerender(); });
  root.querySelectorAll('[data-z-del]').forEach(b => b.onclick = () => { ui.zones.splice(+b.dataset.zDel, 1); rerender(); });
  if ($('z-add')) $('z-add').onclick = () => {
    ui.zones.push({ name: '', from: null });
    rerender();
    root.querySelector(`[data-z="${ui.zones.length - 1}"]`)?.focus();
  };
  if ($('z-discard')) $('z-discard').onclick = () => { ui.zones = null; ui.zoneErr = ''; rerender(); };
  if ($('z-save')) $('z-save').onclick = async () => { await saveZones(); rerender(); };

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
    ui.basic = {};
    ui.clientErr = '';
    rerender();
    root.querySelector('[data-ct]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  root.querySelectorAll('[data-ct]').forEach(el => {
    const write = () => { ui.terms[el.dataset.ct] = el.value; };
    el.oninput = write;
    el.onchange = () => { write(); rerender(); };
  });
  root.querySelectorAll('[data-cb]').forEach(el => {
    const write = () => { ui.basic[el.dataset.cb] = el.value; };
    el.oninput = write;
    el.onchange = () => { write(); rerender(); };
  });
  if ($('ct-cancel')) $('ct-cancel').onclick = () => { ui.editClient = null; ui.terms = {}; ui.basic = {}; ui.clientErr = ''; rerender(); };
  if ($('ct-save')) $('ct-save').onclick = async () => { await saveTerms(); rerender(); };
}
