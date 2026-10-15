// Price room — manager. Comparison boards on the left; MPL calculator and approvals in a sliding panel
// on the right. The panel's proposal is cumulative: every change added there is previewed on all boards.

import * as store from '../store.js';
import { fmt, fmtKg } from '../money.js';
import { esc, toast, options, stamp } from '../ui.js';
import { parse, priceRoomTabs, priceRoomTabsFor } from '../router.js';
import { level, canView, canEdit, canApprove, canSeeMpl, canSeeApprovals } from '../access.js';
import {
  byId, currentCostBasis, currentPublication, daysSince, exceptions, priceFor, marginRule, applyChanges,
  skuLabel, channelLabel, userName, fmtDate, fmtDateTime, userChannels, isStaleReading, boardIsStale, allBoardPrices, newestReading, subVersionsOf, subLabel,
} from '../pricing.js';
import { inRange, rangeActive, rangeBar, bindRange } from '../pricerange.js';
import * as wizard from './priceroom-wizard.js';
import * as grid from './clientgrid.js';

const DAY = 86400000;
const MAX = 5;
const TABS = priceRoomTabs;
const me = () => store.currentUser();
const ui = {
  tab: 'competitors', open: false, lastChanges: 0, panel: 'mpl', wide: false, animate: false, lastSim: null, scrollTop: null, excAll: false,
  compDecisions: {}, compChannel: '', compZone: null, histProducts: [], histFrom: '', histTo: '',
  chanOpen: false, channels: ['DEALER', 'COMMERCIAL', 'END_USER'],
  reasons: {}, errors: {},
};

const delta = c => (c ? `<span class="delta ${c > 0 ? 'up' : 'down'}">${c > 0 ? '+' : '−'}${fmt(Math.abs(c))}</span>` : '');

function setQuery(key, value) {
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  if (value == null) qs.delete(key); else qs.set(key, value);
  const str = qs.toString();
  history.replaceState(null, '', `#/priceroom${str ? '?' + str : ''}`);
}

export function render(root, ctx) {
  const { state: s, user, route } = ctx;
  const q = route.query;
  if (q.tab && TABS.some(([k]) => k === q.tab)) ui.tab = q.tab;
  if (q.sim && q.sim !== ui.lastSim) {
    ui.lastSim = q.sim;
    if (!ui.open) ui.animate = true;
    ui.open = true;
    ui.panel = 'mpl';
    wizard.loadShared(q.sim, s);
  }
  const prevScroll = ui.scrollTop ?? root.querySelector('#pr-drawer')?.scrollTop ?? 0;
  ui.scrollTop = null;

  const tabs = priceRoomTabsFor(s, user);
  if (!tabs.some(([k]) => k === ui.tab)) ui.tab = tabs[0]?.[0] ?? null;
  const showMpl = canSeeMpl(s, user);
  ui.panel = 'mpl';
  if (!showMpl) ui.open = false;
  const changes = wizard.pendingChanges();
  // The panel opens by itself the first time a change is proposed; otherwise it stays out of the way.
  if (showMpl && changes.length > ui.lastChanges && !ui.open) { ui.open = true; ui.animate = true; ui.panel = 'mpl'; }
  ui.lastChanges = changes.length;
  const proposed = changes.length ? applyChanges(s, changes, new Date().toISOString()) : null;
  const cb = currentCostBasis(s), pub = currentPublication(s);
  const pcb = proposed ? currentCostBasis(proposed) : cb;
  const arrow = (a, b) => (a !== b ? ` <em>→ ${fmt(b)}</em>` : '');

  const unsaved = grid.pendingEdits();
  const statusbar = `<footer class="statusbar">
    <span><b>v${pub.version}</b> ${fmtDate(pub.publishedAt)} · ${daysSince(pub.publishedAt)}d ago${boardIsStale(s) ? ' · <b class="bad">out of date</b>' : ''}</span>
    <span>Acq <b>${fmtKg(cb.acqPerKg)}</b>${arrow(cb.acqPerKg, pcb.acqPerKg)}</span>
    <span>Haul <b>${fmtKg(cb.haulingPerKg)}</b>${arrow(cb.haulingPerKg, pcb.haulingPerKg)}</span>
    <span>Total <b>${fmtKg(cb.acqPerKg + cb.haulingPerKg)}</b>${arrow(cb.acqPerKg + cb.haulingPerKg, pcb.acqPerKg + pcb.haulingPerKg)}</span>
    <span class="grow"></span>
    ${changes.length || unsaved ? `<span class="edit-note">${changes.length ? `${changes.length} proposed` : ''}${changes.length && unsaved ? ' · ' : ''}${unsaved ? `${unsaved} unsaved` : ''}</span>` : ''}
  </footer>`;

  const bodies = { competitors: competitorsBoard, channels: channelsBoard, grid: st => grid.html(st), history: priceHistoryTab, notices: noticesTab };
  const shift = ui.open && !ui.animate;

  root.innerHTML = `<div class="pr ${shift ? 'pr-shift' : ''}"><section class="page wide">
      <div class="page-head"><h1>Price room${ui.tab ? ' · ' + esc(TABS.find(([k]) => k === ui.tab)[1]) : ''}</h1></div>
      <div id="pr-main">${ui.tab ? bodies[ui.tab](s, proposed) : '<p class="muted">Your access does not include a Price room board. The panel on the right has what you can use.</p>'}</div>
    </section></div>
    <aside id="pr-aside" class="drawer ${ui.open && !ui.animate ? 'open' : ''} ${ui.wide ? 'wide' : ''}" aria-label="MPL calculator" ${ui.open ? '' : 'inert'}>
      <div class="drawer-head">
        <div class="drawer-tabs">
          ${showMpl ? `<button type="button" data-panel="mpl" class="${ui.panel === 'mpl' ? 'on' : ''}">MPL calculator${changes.length ? ` <span class="count">${changes.length}</span>` : ''}</button>` : ''}
        </div>
        <button type="button" id="pr-wide" class="icon" aria-label="${ui.wide ? 'Narrow the panel' : 'Widen the panel'}" title="${ui.wide ? 'Narrow' : 'Widen'}">${ui.wide ? '⇥' : '⇤'}</button>
        <button type="button" id="pr-close" class="icon" aria-label="Close panel" title="Close">✕</button>
      </div>
      <div class="drawer-body" id="pr-drawer">${wizard.html(s, user)}</div>
    </aside>
    ${ui.open || !showMpl ? '' : `<button type="button" id="pr-handle" class="drawer-handle">MPL calculator${changes.length ? ` · ${changes.length}` : ''}</button>`}
    ${statusbar}`;

  const aside = root.querySelector('#pr-aside');
  root.querySelector('#pr-drawer').scrollTop = prevScroll;
  if (ui.animate) {
    ui.animate = false;
    // The user may navigate away before these frames run.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!aside.isConnected) return;
      aside.classList.add('open');
      root.querySelector('.pr')?.classList.add('pr-shift');
    }));
  }

  const rerender = () => render(root, { ...ctx, state: store.get(), route: parse() });
  const openPanel = panel => {
    if (panel && panel !== ui.panel) { ui.panel = panel; ui.scrollTop = 0; }
    if (!ui.open) { ui.open = true; ui.animate = true; }
    rerender();
  };
  const closePanel = () => {
    aside.classList.remove('open');
    root.querySelector('.pr')?.classList.remove('pr-shift');
    setTimeout(() => {
      ui.open = false;
      if (document.getElementById('pr-aside')) rerender(); // still on the Price room
    }, 250);
  };
  const toggleTo = panel => (ui.open && ui.panel === panel ? closePanel() : openPanel(panel));
  root.querySelectorAll('[data-open-mpl]').forEach(b => b.onclick = () => toggleTo('mpl'));
  root.querySelector('#pr-close').onclick = closePanel;
  root.querySelector('#pr-wide').onclick = () => { ui.wide = !ui.wide; rerender(); };
  const handle = root.querySelector('#pr-handle');
  if (handle) handle.onclick = () => openPanel();
  root.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; setQuery('tab', ui.tab); rerender(); });

  bindMain(root.querySelector('#pr-main'), rerender);
  if (ui.tab === 'grid') grid.bind(root.querySelector('#pr-main'), rerender);
  wizard.bind(root.querySelector('#pr-drawer'), user, rerender);
  // "Bulk clients" / "Commercial clients" in the calculator open the grid for that channel.
  root.querySelectorAll('[data-grid]').forEach(b => b.onclick = () => {
    grid.setChannel(b.dataset.grid);
    ui.tab = 'grid';
    setQuery('tab', 'grid');
    rerender();
  });
}

// ---------------- Competitors board ----------------

function brandName(b) { return typeof b === 'string' ? b : b.name; }
function brandZone(b) { return typeof b === 'string' ? '' : (b.zone || ''); }

function competitorsBoard(s) {
  const decLv = level(s, me(), 'comp_decision');
  const channelId = byId(s.channels, ui.compChannel) ? ui.compChannel : s.channels[0]?.id;
  const channel = byId(s.channels, channelId);
  const now = new Date();
  const skus = s.skus.filter(k => k.active);

  // Everything on this board comes straight from Price Watch readings. A reading with no channel counts for every channel.
  const forChannel = s.competitorReadings.filter(r => skus.some(k => k.id === r.skuId) && (!r.channelId || r.channelId === channelId));
  const zones = [...new Set([...forChannel.map(r => r.zone), ...(s.trackedBrands || []).map(brandZone)])].filter(Boolean).sort();
  const topZone = [...zones].sort((x, y) => forChannel.filter(r => r.zone === y).length - forChannel.filter(r => r.zone === x).length)[0] || '';
  const zone = ui.compZone === null ? topZone : zones.includes(ui.compZone) ? ui.compZone : '';

  const seen = new Map();
  const addCol = (name, z) => { if (name && z && (!zone || z === zone)) seen.set(name + '|' + z, { name, zone: z }); };
  for (const b of s.trackedBrands || []) addCol(brandName(b), brandZone(b));
  for (const r of forChannel) addCol(r.brand, r.zone);
  const brands = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.zone.localeCompare(b.zone));

  const readingFor = (b, skuId) => forChannel
    .filter(r => r.brand === b.name && r.zone === b.zone && r.skuId === skuId)
    .sort((a, c) => (a.capturedAt < c.capturedAt ? 1 : -1))[0] || null;
  const latestOf = b => forChannel.filter(r => r.brand === b.name && r.zone === b.zone).sort((a, c) => (a.capturedAt < c.capturedAt ? 1 : -1))[0] || null;
  const ownPrice = sku => (marginRule(s, channelId, sku.id) ? priceFor(s, { channelId, skuId: sku.id }).result?.grossPerCyl : null);
  const stampOf = r => `${esc(userName(s, r.capturedBy))}<br>${fmtDate(r.capturedAt)} ${new Date(r.capturedAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`;

  const productIds = [...new Set(forChannel.filter(r => !zone || r.zone === zone).map(r => r.skuId))];
  const allProducts = productIds.map(id => byId(s.skus, id)).filter(Boolean);
  const cells = sku => [ownPrice(sku), ...brands.map(b => readingFor(b, sku.id)?.pricePerCyl)];
  const products = allProducts.filter(sku => !rangeActive() || cells(sku).some(inRange));
  const spread = allProducts.flatMap(cells);
  const latest = [...forChannel].sort((a, c) => (a.capturedAt < c.capturedAt ? 1 : -1))[0];

  const filters = `<div class="picker"><div class="row">
      <label class="field inline"><span>Channel</span><select id="cp-ch">${options(s.channels, channelId)}</select></label>
      <label class="field inline"><span>Zone</span><select id="cp-zone"><option value="">All zones</option>${zones.map(z => `<option${z === zone ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
      <span class="small muted grow">${forChannel.length} Price Watch reading${forChannel.length === 1 ? '' : 's'}${latest ? ` · latest ${fmtDate(latest.capturedAt)} by ${esc(userName(s, latest.capturedBy))}` : ''}</span>
      ${canEdit(s, me(), 'comp_board') ? '<a class="btn small" href="#/market">Add a reading in Price Watch</a>' : ''}
    </div></div>`;

  if (!allProducts.length) return filters + '<p class="muted">No Price Watch readings for this channel and zone yet.</p>';
  if (!products.length) return filters + rangeBar(0, allProducts.length, 'products', spread) + '<p class="muted">No product has a price in this range.</p>';

  return filters + rangeBar(products.length, allProducts.length, 'products', spread) + `<div class="card" style="padding:0"><div class="table-wrap"><table class="matrix">
    <thead><tr>
      <th>Product</th>
      ${decLv ? '<th class="num decision-col">Price decision</th>' : ''}
      <th class="num">Masagana</th>
      ${brands.map(b => {
        const l = latestOf(b);
        return `<th class="num" title="${l ? `Latest: ${esc(userName(s, l.capturedBy))}, ${fmtDate(l.capturedAt)}` : 'No readings'}">${esc(b.name)}${zone ? '' : ` · ${esc(b.zone)}`}</th>`;
      }).join('')}
    </tr></thead>
    <tbody>${products.map(sku => {
      const masaganaPrice = ownPrice(sku);
      const decVal = ui.compDecisions[sku.id] ?? '';
      return `<tr>
        <th scope="row">${esc(sku.label)}</th>
        ${decLv ? `<td class="num decision-col"><input type="text" inputmode="decimal" class="comp-decision" data-comp-dec="${esc(sku.id)}" placeholder="—" value="${esc(decVal)}" ${decLv >= 2 ? '' : 'readonly'}></td>` : ''}
        <td class="num ${rangeActive() && !inRange(masaganaPrice) ? 'out-range' : ''}">${masaganaPrice ? `<span class="comp-masagana">${fmt(masaganaPrice)}</span>` : '<span class="muted">—</span>'}</td>
        ${brands.map(b => {
          const r = readingFor(b, sku.id);
          if (!r) return '<td class="num muted">—</td>';
          const stale = isStaleReading(s, r, now);
          const diff = masaganaPrice && r.pricePerCyl !== masaganaPrice
            ? ` <span class="small ${r.pricePerCyl < masaganaPrice ? 'neg' : 'pos'}">${r.pricePerCyl < masaganaPrice ? '−' : '+'}${fmt(Math.abs(r.pricePerCyl - masaganaPrice))}</span>` : '';
          return `<td class="num ${stale ? 'stale' : ''} ${rangeActive() && !inRange(r.pricePerCyl) ? 'out-range' : ''}" title="${esc((r.productBrand ? r.productBrand + ' · ' : '') + userName(s, r.capturedBy) + ', ' + fmtDate(r.capturedAt))}"><span class="cell-price">${fmt(r.pricePerCyl)}</span>${diff}${stale ? ` <span class="pill grey">${daysSince(r.capturedAt, now)}d</span>` : ''}</td>`;
        }).join('')}
      </tr>`;
    }).join('')}</tbody></table></div></div>`;
}

// ---------------- Channels board ----------------

function cell(s, proposed, channelId, skuId) {
  const m = marginRule(s, channelId, skuId);
  const b = m ? priceFor(s, { channelId, skuId }).result : null;
  const a = proposed && marginRule(proposed, channelId, skuId) ? priceFor(proposed, { channelId, skuId }).result : null;
  if (!b && !a) return '<td class="num muted">—</td>';
  const out = rangeActive() && !(b && inRange(b.grossPerCyl)) && !(a && inRange(a.grossPerCyl));
  return `<td class="num ${out ? 'out-range' : ''}"><span class="cell-price">${b ? fmt(b.grossPerCyl) : '<span class="muted">New</span>'}</span>${a && (!b || a.grossPerCyl !== b.grossPerCyl) ? ` <span class="proposed">→ ${fmt(a.grossPerCyl)} ${b ? delta(a.grossPerCyl - b.grossPerCyl) : ''}</span>` : ''}</td>`;
}

// Gross per cylinder on a channel, current or proposed, so the range filter sees what the cell shows.
function grossesFor(s, proposed, channelId, skuId) {
  const out = [];
  if (marginRule(s, channelId, skuId)) out.push(priceFor(s, { channelId, skuId }).result?.grossPerCyl);
  if (proposed && marginRule(proposed, channelId, skuId)) out.push(priceFor(proposed, { channelId, skuId }).result?.grossPerCyl);
  return out;
}
const anyInRange = list => list.some(inRange);

function channelPicker(s) {
  const full = ui.channels.length >= MAX;
  return `<div class="multi" id="ch-multi">
    <button type="button" id="ch-toggle" class="multi-btn" aria-haspopup="listbox" aria-expanded="${ui.chanOpen}">
      <span>Channels · <b>${ui.channels.length}</b> of ${s.channels.length}</span><span aria-hidden="true">▾</span></button>
    ${ui.chanOpen ? `<div class="multi-menu" role="listbox" aria-multiselectable="true">${s.channels.map(c => {
      const on = ui.channels.includes(c.id), dis = !on && full;
      return `<label class="multi-opt ${dis ? 'dis' : ''}"><input type="checkbox" data-chan="${esc(c.id)}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}><span class="grow">${esc(c.label)}</span></label>`;
    }).join('')}</div>` : ''}</div>`;
}

// Close the Client Pricing client dropdown on an outside click or Escape.
document.addEventListener('click', e => {
  if (ui.chanOpen && e.target.isConnected && !e.target.closest('#ch-multi')) { ui.chanOpen = false; closeMenu?.(); }
  if (!grid.isFilterOpen()) return;
  if (!document.querySelector('#cg-multi')) { grid.closeFilter(); return; }
  if (e.target.isConnected && !e.target.closest('#cg-multi')) { grid.closeFilter(); closeMenu?.(); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !grid.isFilterOpen() || !document.querySelector('#cg-multi')) return;
  grid.closeFilter();
  closeMenu?.();
});
let closeMenu = null;

function channelsBoard(s, proposed) {
  const cols = ui.channels.map(id => byId(s.channels, id)).filter(Boolean);
  const pills = channelPicker(s);
  if (!cols.length) return pills + '<p class="muted">Pick up to 5 channels.</p>';
  const pricedIn = st => st && s.skus.filter(k => k.active && cols.some(c => marginRule(st, c.id, k.id)));
  const priced = s.skus.filter(k => pricedIn(s).includes(k) || (proposed && pricedIn(proposed).some(x => x.id === k.id)));
  const skus = priced.filter(k => !rangeActive() || anyInRange(cols.flatMap(c => grossesFor(s, proposed, c.id, k.id))));
  const spreadPr = priced.flatMap(k => cols.flatMap(c => grossesFor(s, proposed, c.id, k.id)));
  const top = `<div class="one-row">${pills}${rangeBar(skus.length, priced.length, 'products', spreadPr)}</div>`;
  return top + (!skus.length ? '<p class="muted">No product has a price in this range.</p>' : `<div class="card" style="padding:0"><div class="table-wrap"><table class="matrix">
    <thead><tr><th>Product</th>${cols.map(c => `<th class="num">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${skus.map(k => `<tr><th scope="row">${esc(k.label)}</th>
      ${cols.map(c => cell(s, proposed, c.id, k.id)).join('')}</tr>`).join('')}</tbody></table></div></div>`);
}

// ---------------- Price History ----------------

function priceHistoryTab(s) {
  const all = [...s.publications].sort((a, b) => b.version - a.version);
  if (!all.length) return '<p class="muted">No published versions yet.</p>';
  const allSkus = s.skus.filter(k => k.active && !k.hasVariants);
  const skus = ui.histProducts.length ? allSkus.filter(k => ui.histProducts.includes(k.id)) : allSkus;
  const from = ui.histFrom === '' ? -Infinity : +ui.histFrom, to = ui.histTo === '' ? Infinity : +ui.histTo;
  const cur = currentPublication(s).version;
  const pricesOf = pub => pub.prices ?? (pub.version === cur ? allBoardPrices(s) : null);
  const priceAt = (pub, channelId, skuId) => pricesOf(pub)?.[channelId]?.find(x => x.skuId === skuId)?.grossPerCyl ?? null;
  // Versions are columns, newest first. Each cell is compared with the version before it.
  const cols = all.filter(v => v.version >= from && v.version <= to);
  const vOpts = (label, chosen) => `<option value="">${label}</option>` + [...all].reverse().map(v => `<option value="${v.version}"${String(v.version) === String(chosen) ? ' selected' : ''}>v${v.version}</option>`).join('');
  const approver = pub => {
    const ev = s.events.find(e => e.action === 'APPROVE' && e.proposalId && s.events.some(p => p.proposalId === e.proposalId && p.action === 'PUBLISH' && p.after?.version === pub.version));
    return ev ? userName(s, ev.verifiedBy) : '—';
  };
  const cell = (pub, channelId, skuId) => {
    const v = priceAt(pub, channelId, skuId);
    if (v == null) return '<td class="num muted">—</td>';
    const prev = all.find(x => x.version < pub.version);
    const pv = prev ? priceAt(prev, channelId, skuId) : null;
    const cls = pv == null || pv === v ? '' : v > pv ? 'chg-up' : 'chg-down';
    return `<td class="num ${cls}">${fmt(v)}</td>`;
  };

  return `<div class="hist-filters">
      <label class="small">Product <select id="h-prod"><option value="">All products</option>${allSkus.map(k => `<option value="${esc(k.id)}"${ui.histProducts[0] === k.id ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>
      <label class="small">Version <select id="h-from">${vOpts('From', ui.histFrom)}</select></label>
      <label class="small">to <select id="h-to">${vOpts('To', ui.histTo)}</select></label>
      ${ui.histProducts.length || ui.histFrom !== '' || ui.histTo !== '' ? '<button type="button" id="h-clear" class="small">Clear</button>' : ''}
      <span class="small muted">${cols.length} of ${all.length} versions · per cyl, VAT incl. · <span class="chg-up key">higher</span> <span class="chg-down key">lower</span> than the version before</span>
    </div>
    ${cols.length ? `<div class="raw-scroll"><table class="raw">
      <thead>
        <tr><th class="sticky">Product · Channel</th>${cols.map(v => `<th>v${v.version}${v.version === cur ? ' <span class="pill green">Current</span>' : ''}</th>`).join('')}</tr>
        <tr class="sub"><th class="sticky">Published</th>${cols.map(v => `<th>${fmtDate(v.publishedAt)}</th>`).join('')}</tr>
        <tr class="sub"><th class="sticky">Approved by</th>${cols.map(v => `<th>${esc(approver(v))}</th>`).join('')}</tr>
      </thead>
      <tbody>${skus.map(k => ({ k, chs: s.channels.filter(c => cols.some(v => priceAt(v, c.id, k.id) != null)) })).filter(x => x.chs.length).map(({ k, chs }) => `<tr class="grp-row"><th class="sticky" colspan="${cols.length + 1}">${esc(k.label)}</th></tr>
        ${chs.map(c => `<tr><td class="sticky ch">${esc(c.label)}</td>${cols.map(v => cell(v, c.id, k.id)).join('')}</tr>`).join('')}`).join('')}</tbody></table></div>` : '<p class="muted">No versions in this range.</p>'}
    ${subTable(s, cols)}`;
}

// Sub-versions: approved price requests, grouped under their major version.
function subTable(s, versions) {
  const groups = versions.map(v => ({ v, list: subVersionsOf(s, v.version) })).filter(g => g.list.length);
  if (!groups.length) return '';
  return `<h2 class="sub-h">Sub-versions</h2><div class="table-wrap"><table class="raw"><thead><tr><th>Version</th><th>Client</th><th>Product</th><th class="num">Before</th><th class="num">After</th><th>Approved by</th><th>Date</th><th>Reason</th></tr></thead><tbody>
    ${groups.map(g => `<tr class="grp-row"><th colspan="8">v${g.v.version} · ${fmtDate(g.v.publishedAt)}</th></tr>${g.list.map(r => `<tr>
      <td><b>${esc(subLabel(r))}</b></td><td>${esc(byId(s.accounts, r.accountId)?.name ?? 'Walk-in')}</td><td>${esc(skuLabel(s, r.skuId))}</td>
      <td class="num">${fmt(r.currentGrossPerCyl)}</td><td class="num">${fmt(r.approvedGrossPerCyl ?? r.currentGrossPerCyl)}</td>
      <td>${esc(userName(s, r.decidedBy))}</td><td>${fmtDate(r.decidedAt)}</td><td>${esc(r.decisionReason || '')}</td></tr>`).join('')}`).join('')}
  </tbody></table></div>`;
}

// ---------------- PL notices ----------------

function noticesTab(s) {
  const pub = currentPublication(s);
  const people = s.users.filter(u => u.role !== 'messenger');
  const lists = s.channels; // order comes from Configuration → Channels
  let acked = 0, total = 0;
  const body = people.map(u => {
    const mine = userChannels(s, u);
    return `<tr><th scope="row">${esc(u.name)} <span class="small muted">${esc(u.role)}</span></th>
      ${lists.map(c => {
        if (!mine.includes(c.id)) return '<td class="center muted">·</td>';
        total++;
        const a = s.acknowledgments.find(x => x.userId === u.id && x.channelId === c.id && x.boardVersion === pub.version);
        if (a) acked++;
        return `<td class="center">${a
          ? `<span class="badge green" title="${esc(fmtDateTime(a.acknowledgedAt))}">✓ Seen</span>`
          : '<span class="badge amber">Not seen</span>'}</td>`;
      }).join('')}</tr>`;
  }).join('');
  const emailLog = s.plEmailLog || [];
  const emailRows = emailLog.filter(e => e.version === pub.version).sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));

  return `<div class="card">
    <div class="notice-head">
      <h2 class="sub-h first">Notice acknowledgement</h2>
      <div class="row">${stamp(pub.version, fmtDate(pub.publishedAt))}<span class="muted"><b>${acked}/${total}</b> acknowledged</span></div>
    </div>
    <div class="legend"><span class="lg green">Green: user acknowledged</span><span class="lg amber">Amber: not seen</span><span class="muted">· not on this user's price lists</span></div>
    <div class="table-wrap fit"><table class="matrix">
      <thead><tr><th>User</th>${lists.map(c => `<th class="center"><span class="pl-badge">${esc(c.label)}</span></th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div></div>
  <div class="card" style="margin-top:16px">
    <h2 class="sub-h first">Email notifications — v${pub.version}</h2>
    ${emailRows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Client</th><th>Email</th><th>Sent</th><th>Status</th></tr></thead>
      <tbody>${emailRows.map(e => {
        const acc = byId(s.accounts, e.accountId);
        return `<tr><td>${esc(acc?.name ?? e.accountId ?? 'Walk-in')}</td><td>${esc(e.email)}</td>
          <td class="small">${fmtDateTime(e.sentAt)}</td>
          <td><span class="pill ${e.status === 'sent' ? 'green' : e.status === 'received' ? 'blue' : 'amber'}">${esc(e.status)}</span></td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="muted">No emails sent for this version yet. Emails are sent from the Quote Desk when issuing price lists.</p>'}
  </div>`;
}

// ---------------- Board behaviour ----------------

function bindMain(root, rerender) {
  const $ = id => root.querySelector('#' + id);
  const toggle = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : list.length < MAX ? [...list, id] : list);
  closeMenu = rerender;
  if ($('ch-toggle')) $('ch-toggle').onclick = () => { ui.chanOpen = !ui.chanOpen; rerender(); };
  root.querySelectorAll('[data-chan]').forEach(b => b.onchange = () => { ui.channels = toggle(ui.channels, b.dataset.chan); rerender(); });
  bindRange(root, rerender);
  if ($('cp-ch')) $('cp-ch').onchange = e => { ui.compChannel = e.target.value; rerender(); };
  if ($('cp-zone')) $('cp-zone').onchange = e => { ui.compZone = e.target.value; rerender(); };
  if ($('h-prod')) $('h-prod').onchange = e => { ui.histProducts = e.target.value ? [e.target.value] : []; rerender(); };
  if ($('h-from')) $('h-from').onchange = e => { ui.histFrom = e.target.value; rerender(); };
  if ($('h-to')) $('h-to').onchange = e => { ui.histTo = e.target.value; rerender(); };
  if ($('h-clear')) $('h-clear').onclick = () => { ui.histProducts = []; ui.histFrom = ui.histTo = ''; rerender(); };
  root.querySelectorAll('[data-comp-dec]').forEach(inp => inp.oninput = e => { ui.compDecisions[inp.dataset.compDec] = e.target.value; });
}

// ---------------- Keyboard ----------------
// "/" jumps to the board's filter. Up / Down / Enter move between the inputs of a table column.
document.addEventListener('keydown', e => {
  const main = document.getElementById('pr-main');
  if (!main) return;
  const t = e.target;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
    const el = main.querySelector('#cg-toggle, #ch-toggle, #cp-ch, #h-prod');
    if (el) { e.preventDefault(); if (el.tagName === 'BUTTON') el.click(); else el.focus(); }
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) || t.tagName !== 'INPUT' || !t.closest('td')) return;
  const td = t.closest('td'), idx = td.cellIndex;
  const up = e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey);
  let tr = td.parentElement;
  for (;;) {
    tr = up ? tr.previousElementSibling : tr.nextElementSibling;
    if (!tr) return;
    const next = tr.cells[idx]?.querySelector('input');
    if (next) { e.preventDefault(); next.focus(); next.select?.(); return; }
  }
});
