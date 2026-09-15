// Price room — manager. Comparison boards on the left; MPL calculator and exceptions in a sliding panel
// on the right. The panel's proposal is cumulative: every change added there is previewed on all boards.

import * as store from '../store.js';
import { fmt, fmtKg } from '../money.js';
import { esc, toast, options } from '../ui.js';
import { derivePremiumPerKg } from '../engine.js';
import { parse } from '../router.js';
import {
  byId, currentCostBasis, currentPublication, daysSince, exceptions, priceFor, marginRule, bufferFor, applyChanges,
  skuLabel, channelLabel, userName, fmtDate, fmtDateTime, userChannels, isStaleReading, boardIsStale,
} from '../pricing.js';
import * as wizard from './priceroom-wizard.js';

const DAY = 86400000;
const MAX = 5;
// Column order on PL notices: Bulk, Commercial, Dealer, Semi-dealer, CBK, MGSA; anything else after.
const NOTICE_ORDER = ['BULK', 'COMMERCIAL', 'DEALER', 'RETAIL_OUTLET', 'COBANKIAT', 'MGSA'];
const TABS = [['clients', 'Clients board'], ['products', 'Products board'], ['channels', 'Channels board'], ['notices', 'PL notices']];
const ui = {
  tab: 'clients', open: true, panel: 'exceptions', wide: false, animate: false, lastSim: null, scrollTop: null,
  clients: ['acc_alta', 'acc_kja', 'acc_silca'], clientQuery: '', clientSku: '',
  products: ['11KG_MGAS', '50KG_A', '22KG_A'], prodOpen: false, channels: ['DEALER', 'COMMERCIAL', 'END_USER'],
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

  const changes = wizard.pendingChanges();
  const proposed = changes.length ? applyChanges(s, changes, new Date().toISOString()) : null;
  const exc = exceptions(s);
  const cb = currentCostBasis(s), pub = currentPublication(s);
  const pcb = proposed ? currentCostBasis(proposed) : cb;
  const arrow = (a, b) => (a !== b ? ` <em>→ ${fmt(b)}</em>` : '');

  const strip = `<div class="strip">
    <div><span>Acquisition</span><b>${fmtKg(cb.acqPerKg)}</b>${arrow(cb.acqPerKg, pcb.acqPerKg)}</div>
    <div><span>Hauling</span><b>${fmtKg(cb.haulingPerKg)}</b>${arrow(cb.haulingPerKg, pcb.haulingPerKg)}</div>
    <div><span>Cost basis total</span><b>${fmtKg(cb.acqPerKg + cb.haulingPerKg)}</b>${arrow(cb.acqPerKg + cb.haulingPerKg, pcb.acqPerKg + pcb.haulingPerKg)}</div>
    <div><span>Price list version</span><b>v${pub.version}</b></div>
    <div><span>Days since publish</span><b>${daysSince(pub.publishedAt)}</b></div>
    ${boardIsStale(s) ? '<div><span>Price lists</span><b class="pos">Out of date</b></div>' : ''}
  </div>`;

  const bodies = { clients: clientsBoard, products: productsBoard, channels: channelsBoard, notices: noticesTab };
  const shift = ui.open && !ui.wide && !ui.animate;

  root.innerHTML = `<div class="pr ${shift ? 'pr-shift' : ''}"><section class="page wide">
      <div class="page-head"><div><div class="eyebrow">Management</div><h1>Price room</h1></div>
        <button type="button" id="pr-toggle" class="${ui.open ? '' : 'primary'}">${ui.open ? 'Hide' : 'Open'} MPL calculator</button></div>
      ${strip}
      ${proposed ? `<div class="banner tiffany">Boards show proposed prices from ${changes.length} change${changes.length > 1 ? 's' : ''} in the MPL calculator — nothing is published until stage 05.</div>` : ''}
      <div class="tabs">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
      <div id="pr-main">${bodies[ui.tab](s, proposed)}</div>
    </section></div>
    <aside id="pr-aside" class="drawer ${ui.open && !ui.animate ? 'open' : ''} ${ui.wide ? 'wide' : ''}" aria-label="MPL calculator and exceptions" ${ui.open ? '' : 'inert'}>
      <div class="drawer-head">
        <div class="drawer-tabs">
          <button type="button" data-panel="mpl" class="${ui.panel === 'mpl' ? 'on' : ''}">MPL calculator${changes.length ? ` <span class="count">${changes.length}</span>` : ''}</button>
          <button type="button" data-panel="exceptions" class="${ui.panel === 'exceptions' ? 'on' : ''}">Exceptions <span class="count">${exc.length}</span></button>
        </div>
        <button type="button" id="pr-wide" class="icon" aria-label="${ui.wide ? 'Narrow the panel' : 'Widen the panel'}" title="${ui.wide ? 'Narrow' : 'Widen'}">${ui.wide ? '⇥' : '⇤'}</button>
        <button type="button" id="pr-close" class="icon" aria-label="Close panel" title="Close">✕</button>
      </div>
      <div class="drawer-body" id="pr-drawer">${ui.panel === 'mpl' ? wizard.html(s, user) : exceptionsPanel(s, exc)}</div>
    </aside>
    ${ui.open ? '' : `<button type="button" id="pr-handle" class="drawer-handle">MPL calculator · ${exc.length} exceptions</button>`}`;

  const aside = root.querySelector('#pr-aside');
  root.querySelector('#pr-drawer').scrollTop = prevScroll;
  if (ui.animate) {
    ui.animate = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      aside.classList.add('open');
      if (!ui.wide) root.querySelector('.pr').classList.add('pr-shift');
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
    root.querySelector('.pr').classList.remove('pr-shift');
    setTimeout(() => { ui.open = false; rerender(); }, 250);
  };
  root.querySelector('#pr-toggle').onclick = () => (ui.open ? closePanel() : openPanel('mpl'));
  root.querySelector('#pr-close').onclick = closePanel;
  root.querySelector('#pr-wide').onclick = () => { ui.wide = !ui.wide; rerender(); };
  const handle = root.querySelector('#pr-handle');
  if (handle) handle.onclick = () => openPanel();
  root.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; setQuery('tab', ui.tab); rerender(); });

  bindMain(root.querySelector('#pr-main'), rerender);
  if (ui.panel === 'mpl') wizard.bind(root.querySelector('#pr-drawer'), user, rerender);
  else bindExceptions(root, rerender);
}

// ---------------- Exceptions (panel) ----------------

function label(kind) {
  return { below_floor: 'Below floor', contract: 'Contract', trmv: 'TRMV pace', no_reading: 'No reading', competitor_below: 'Competitor lower', request: 'Request' }[kind] || kind;
}

function exceptionsPanel(s, rows) {
  const pending = s.priceRequests.filter(r => r.status === 'pending');
  const readings = [...s.competitorReadings].sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1)).slice(0, 15);
  return `<h2 style="margin-top:0">Exceptions <span class="muted">(${rows.length})</span></h2>
    ${rows.length ? rows.map(r => `<div class="exc"><span class="pill ${r.severity}">${esc(label(r.kind))}</span>
      <div><div class="subject">${esc(r.subject)}</div><div class="small">${esc(r.text)}</div>
      ${r.requestId ? `<button type="button" class="link small" data-jump="${esc(r.requestId)}">Decide</button>`
        : byId(s.accounts, r.entityId) ? `<button type="button" class="link small" data-compare="${esc(r.entityId)}">Compare on Clients board</button>` : ''}</div></div>`).join('')
      : '<p class="muted">Nothing needs attention.</p>'}
    <h2>Pending price requests <span class="muted">(${pending.length})</span></h2>
    ${pending.length ? pending.map(r => requestCard(s, r)).join('') : '<p class="muted">None pending.</p>'}
    <details class="collapse"><summary>Latest competitor readings (${readings.length})</summary>
      <div class="table-wrap"><table class="mini"><thead><tr><th>Brand · zone</th><th>Product</th><th class="num">Per cyl</th><th>Captured</th></tr></thead><tbody>
      ${readings.map(r => { const st = isStaleReading(s, r); return `<tr class="${st ? 'stale' : ''}"><td>${esc(r.brand)}<br><span class="small">${esc(r.zone)}</span></td><td>${esc(skuLabel(s, r.skuId))}</td>
        <td class="num">${fmt(r.pricePerCyl)}</td><td class="nowrap">${fmtDate(r.capturedAt)}<br><span class="small">${esc(userName(s, r.capturedBy))}</span>${st ? `<br><span class="pill grey">${daysSince(r.capturedAt)} days old</span>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div></details>`;
}

function requestCard(s, r) {
  const reading = s.competitorReadings.find(x => x.id === r.competitorReadingId);
  const subject = r.accountId ? byId(s.accounts, r.accountId)?.name ?? r.accountId : `Walk-in, ${channelLabel(s, r.channelId)}`;
  const stale = reading && isStaleReading(s, reading);
  return `<div class="card" style="margin-bottom:12px">
    <b>${esc(subject)}</b>
    <div class="small muted">${esc(skuLabel(s, r.skuId))} × ${r.qty} · ${fmtDateTime(r.requestedAt)} · by ${esc(userName(s, r.requestedBy))}</div>
    <div class="price-sub"><span>Now <b>${fmt(r.currentGrossPerCyl)}</b></span><span>Target <b>${fmt(r.targetGrossPerCyl)}</b></span></div>
    <p class="small">Needs a discount of ${fmt(r.impliedDiscountPerKg)}/kg, valid ${s.settings.quoteValidityDays} days if approved.</p>
    <p>“${esc(r.reason)}”</p>
    ${reading ? `<p class="small ${stale ? 'stale' : ''}">Competitor: ${esc(reading.brand)}, ${esc(reading.zone)} at ${fmt(reading.pricePerCyl)} on ${fmtDate(reading.capturedAt)}${stale ? ` — stale, ${daysSince(reading.capturedAt)} days old` : ''}</p>` : ''}
    <label class="field"><span>Decision reason (required)</span><textarea id="reason-${esc(r.id)}" data-reason="${esc(r.id)}">${esc(ui.reasons[r.id] || '')}</textarea></label>
    ${ui.errors[r.id] ? `<p class="err" role="alert">${esc(ui.errors[r.id])}</p>` : ''}
    <div class="row" style="margin-top:8px"><button type="button" class="primary" data-decide="approved" data-req="${esc(r.id)}">Approve</button>
      <button type="button" data-decide="declined" data-req="${esc(r.id)}">Decline</button></div></div>`;
}

async function decide(id, status) {
  const s = store.get();
  const r = s.priceRequests.find(x => x.id === id);
  const reason = (ui.reasons[id] || '').trim();
  if (!reason) { ui.errors[id] = `Write the reason for ${status === 'approved' ? 'approving' : 'declining'} — it is required`; return; }
  delete ui.errors[id];
  const validUntil = status === 'approved' ? new Date(Date.now() + (s.settings.quoteValidityDays || 7) * DAY).toISOString() : null;
  const approvedDiscountPerKg = status === 'approved' ? r.impliedDiscountPerKg : null;
  await store.commit({
    action: 'REQUEST_DECIDED', entity: 'priceRequest', entityId: r.accountId ?? r.lineKey, field: 'status', before: 'pending',
    after: { requestId: id, status, decisionReason: reason, accountId: r.accountId, skuId: r.skuId, approvedDiscountPerKg },
  }, (d, ev) => {
    Object.assign(d.priceRequests.find(x => x.id === id), { status, decidedBy: ev.actorId, decidedAt: ev.timestamp, decisionReason: reason, approvedDiscountPerKg, validUntil });
  });
  delete ui.reasons[id];
  toast(status === 'approved' ? 'Request approved' : 'Request declined');
}

function bindExceptions(root, rerender) {
  root.querySelectorAll('[data-reason]').forEach(t => t.oninput = e => { ui.reasons[t.dataset.reason] = e.target.value; });
  root.querySelectorAll('[data-decide]').forEach(b => b.onclick = async () => { await decide(b.dataset.req, b.dataset.decide); rerender(); });
  root.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => {
    const el = document.getElementById('reason-' + b.dataset.jump);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); }
  });
  root.querySelectorAll('[data-compare]').forEach(b => b.onclick = () => {
    const id = b.dataset.compare;
    if (!ui.clients.includes(id)) {
      if (ui.clients.length >= MAX) { toast(`Clients board holds ${MAX} clients — remove one first`, 'bad'); return; }
      ui.clients.push(id);
    }
    ui.tab = 'clients';
    setQuery('tab', 'clients');
    rerender();
  });
}

// ---------------- Clients board ----------------

function clientResults(s) {
  const q = ui.clientQuery.trim().toLowerCase();
  if (!q) return '';
  const hits = s.accounts.filter(a => !ui.clients.includes(a.id) && a.name.toLowerCase().includes(q)).slice(0, 8);
  return hits.length
    ? `<ul>${hits.map(a => `<li><button type="button" data-pick="${esc(a.id)}"><span><b>${esc(a.name)}</b> ${a.status === 'Active' ? '' : '<span class="pill grey">Inactive</span>'}<br>
        <span class="small muted">${esc(channelLabel(s, a.channelId))} · ${esc(a.zone ?? '—')}</span></span></button></li>`).join('')}</ul>`
    : '<p class="small muted">No other clients match.</p>';
}

function clientsBoard(s, proposed) {
  ui.clients = ui.clients.filter(id => byId(s.accounts, id));
  const sel = ui.clients.map(id => byId(s.accounts, id));
  const full = sel.length >= MAX;
  const picker = `<div class="picker">
    <div class="chips">${sel.map(a => `<span class="chip">${esc(a.name)}<button type="button" data-unpick="${esc(a.id)}" aria-label="Remove ${esc(a.name)}">✕</button></span>`).join('')}
      <span class="small muted">${sel.length} of ${MAX} clients</span></div>
    <div class="row">
      <div class="typeahead grow"><input id="cb-q" type="search" autocomplete="off" aria-label="Add a client" value="${esc(ui.clientQuery)}"
        placeholder="${full ? 'Remove a client to add another' : 'Add a client to compare'}" ${full ? 'disabled' : ''}><div id="cb-results">${full ? '' : clientResults(s)}</div></div>
      <label class="field inline"><span>Price for</span><select id="cb-sku" style="min-width:220px">${options(s.skus, ui.clientSku, { placeholder: "Each client's main product" })}</select></label>
    </div></div>`;
  if (!sel.length) return picker + '<p class="muted">Add up to 5 clients to compare side by side.</p>';

  const n = sel.length;
  const grid = (title, fn) => `<div class="section-title">${title}</div><div class="cmp" style="--n:${n}">${sel.map(a => `<div class="card cmp-card">${fn(s, a, proposed)}</div>`).join('')}</div>`;
  return picker + `<div class="cmp-scroll">
    <div class="cmp" style="--n:${n}">${sel.map(a => `<div class="cmp-head"><b>${esc(a.name)}</b><div class="small muted">${esc(channelLabel(s, a.channelId))} · ${esc(a.zone ?? '—')}</div></div>`).join('')}</div>
    ${grid('Client details', detailsCard)}
    ${grid('Premiums and discounts', premiumsCard)}
    ${grid('Current price', priceCard)}
  </div>`;
}

function detailsCard(s, a) {
  let pace = '—';
  if (a.trmvKg && a.volumeGeneratedKg != null && a.contractStart && a.contractEnd) {
    const elapsed = Math.min(1, Math.max(0, (Date.now() - new Date(a.contractStart)) / (new Date(a.contractEnd) - new Date(a.contractStart))));
    pace = `${(a.volumeGeneratedKg / a.trmvKg * 100).toFixed(0)}% at ${(elapsed * 100).toFixed(0)}% of time`;
  }
  const kg = v => (v == null ? '<span class="muted">not on record</span>' : `${v.toLocaleString('en-PH')} kg`);
  return `<div class="row" style="gap:6px"><span class="pill ${a.status === 'Active' ? 'green' : 'grey'}">${esc(a.status)}</span>${a.needsAttention ? '<span class="pill amber">Needs attention</span>' : ''}</div>
    <dl class="kv">
      <dt>Main product</dt><dd>${esc(a.primarySkuId ? skuLabel(s, a.primarySkuId) : '—')}</dd>
      <dt>Contract</dt><dd>${a.contractStart ? `${fmtDate(a.contractStart)} – ${fmtDate(a.contractEnd)}` : '—'}</dd>
      <dt>TRMV</dt><dd>${a.trmvKg ? kg(a.trmvKg) : '—'}</dd>
      <dt>Volume vs contract</dt><dd>${esc(pace)}</dd>
      <dt>Avg monthly</dt><dd>${kg(a.avgMonthlyVolumeKg)}</dd>
      <dt>Credit term</dt><dd>${a.creditTermDays != null ? `${a.creditTermDays} days` : '—'}</dd>
      <dt>Floor override</dt><dd>${a.floorOverridePerKg == null ? 'Default' : fmtKg(a.floorOverridePerKg)}</dd>
      <dt>Competitor</dt><dd>${esc(a.competitorBrand ?? '—')}</dd>
    </dl>`;
}

function componentRows(s, a) {
  const prem = (a.premiums || []).map(x => {
    const comp = s.premiumComponents.find(c => c.code === x.code);
    const v = x.perKg ?? (comp ? derivePremiumPerKg(comp, a) : null);
    return `<tr><td>${esc(comp?.label ?? x.code)}</td><td class="num">${v == null ? '<span class="muted">missing inputs</span>' : '+' + fmt(v)}</td></tr>`;
  });
  const disc = (a.discounts || []).map(x => `<tr><td>${esc(s.discountComponents.find(c => c.code === x.code)?.label ?? x.code)}</td><td class="num">${x.perKg ? '−' + fmt(x.perKg) : '—'}</td></tr>`);
  return prem.join('') + disc.join('') || '<tr><td class="muted">None</td><td></td></tr>';
}

function premiumsCard(s, a, proposed) {
  const pa = proposed && byId(proposed.accounts, a.id);
  const changed = pa && (JSON.stringify(pa.premiums) !== JSON.stringify(a.premiums) || JSON.stringify(pa.discounts) !== JSON.stringify(a.discounts));
  return `<table class="mini"><tbody>${componentRows(s, a)}</tbody></table>
    ${changed ? `<div class="proposed" style="margin-top:8px">Proposed</div><table class="mini"><tbody>${componentRows(proposed, pa)}</tbody></table>` : ''}
    <div class="small muted" style="margin-top:6px">Per kg, before VAT</div>`;
}

function priceCard(s, a, proposed) {
  const skuId = ui.clientSku || a.primarySkuId;
  if (!skuId) return '<p class="muted small">No main product — choose one in Price for.</p>';
  const p = priceFor(s, { accountId: a.id, skuId });
  if (p.error) return `<p class="muted small">${esc(p.error)}</p>`;
  const r = p.result;
  const pr = proposed ? priceFor(proposed, { accountId: a.id, skuId }).result : null;
  const d = r.marginVsFloorPerKg;
  const color = d < 0 ? 'red' : d < 50 ? 'amber' : 'green';
  const floorText = d === 0 ? 'At floor' : d > 0 ? `${fmt(d)}/kg above floor` : `${fmt(-d)}/kg below floor`;
  return `<div class="small muted">${esc(p.sku.label)}</div>
    <div class="price-md">${fmt(r.grossPerCyl)}</div>
    <div class="small muted">per cylinder, VAT incl. · ${fmt(r.netPerKg)}/kg net</div>
    ${pr && pr.grossPerCyl !== r.grossPerCyl ? `<div class="proposed">Proposed ${fmt(pr.grossPerCyl)} ${delta(pr.grossPerCyl - r.grossPerCyl)}${pr.belowFloor && !r.belowFloor ? ' <span class="pill red">Below floor</span>' : ''}</div>` : ''}
    <div class="floor-tag ${color}">${floorText}</div>
    <table class="mini"><tbody>
      ${r.ladder.map(l => `<tr><td>${esc(l.step)}</td><td class="num">${l.perKg < 0 ? '−' : ''}${fmt(Math.abs(l.perKg))}</td><td class="num muted">${fmt(l.runningPerKg)}</td></tr>`).join('')}
      <tr class="total"><td>Net per kg</td><td></td><td class="num">${fmt(r.netPerKg)}</td></tr>
      <tr><td>Floor</td><td></td><td class="num">${fmt(r.floorPerKg)}</td></tr>
    </tbody></table>`;
}

// ---------------- Products and channels boards ----------------

function cell(s, proposed, channelId, skuId) {
  const m = marginRule(s, channelId, skuId);
  const b = m ? priceFor(s, { channelId, skuId }).result : null;
  const a = proposed && marginRule(proposed, channelId, skuId) ? priceFor(proposed, { channelId, skuId }).result : null;
  if (!b && !a) return '<td class="num muted">—</td>';
  return `<td class="num">
    <div class="cell-price">${b ? fmt(b.grossPerCyl) : '<span class="muted">New</span>'}</div>
    ${b ? `<div class="small muted">${fmt(b.netPerKg)}/kg · margin ${fmt(m.perKg)}</div>` : ''}
    ${a && (!b || a.grossPerCyl !== b.grossPerCyl) ? `<div class="proposed">→ ${fmt(a.grossPerCyl)} ${b ? delta(a.grossPerCyl - b.grossPerCyl) : ''}</div>` : ''}</td>`;
}

function pickerPills(items, selected, attr, noun) {
  return `<div class="picker"><div class="chips" style="margin:0">${items.map(x => {
    const on = selected.includes(x.id);
    return `<button type="button" class="chip-btn ${on ? 'on' : ''}" data-${attr}="${esc(x.id)}" aria-pressed="${on}" ${!on && selected.length >= MAX ? 'disabled' : ''}>${on ? '✓ ' : ''}${esc(x.label)}</button>`;
  }).join('')}<span class="small muted">${selected.length} of ${MAX} ${noun}</span></div></div>`;
}

// Dropdown with checkboxes, up to MAX products; selected ones also show as removable chips.
function productPicker(s) {
  const sel = ui.products;
  const full = sel.length >= MAX;
  return `<div class="picker"><div class="row">
    <div class="multi" id="pb-multi">
      <button type="button" id="pb-toggle" class="multi-btn" aria-haspopup="listbox" aria-expanded="${ui.prodOpen}">
        <span>Products · <b>${sel.length}</b> of ${MAX} selected</span><span aria-hidden="true">▾</span></button>
      ${ui.prodOpen ? `<div class="multi-menu" role="listbox" aria-multiselectable="true" aria-label="Products">
        <div class="multi-actions small"><span class="muted">${full ? `Maximum of ${MAX} reached` : `Choose up to ${MAX}`}</span><button type="button" class="link" id="pb-clear">Clear all</button></div>
        ${s.skus.filter(k => k.active).map(k => {
          const on = sel.includes(k.id);
          const dis = !on && full;
          return `<label class="multi-opt ${dis ? 'dis' : ''}"><input type="checkbox" data-prod="${esc(k.id)}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}>
            <span class="grow">${esc(k.label)}</span><span class="small muted">${k.contentKg} kg</span></label>`;
        }).join('')}</div>` : ''}
    </div>
    <div class="chips" style="margin:0">${sel.map(id => `<span class="chip">${esc(skuLabel(s, id))}<button type="button" data-unprod="${esc(id)}" aria-label="Remove ${esc(skuLabel(s, id))}">✕</button></span>`).join('')}</div>
  </div></div>`;
}

let closeProductMenu = null;
document.addEventListener('click', e => {
  if (!ui.prodOpen) return;
  if (!document.getElementById('pb-multi')) { ui.prodOpen = false; return; }
  if (!e.target.isConnected || e.target.closest('#pb-multi')) return;
  ui.prodOpen = false;
  closeProductMenu?.();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.prodOpen && document.getElementById('pb-multi')) { ui.prodOpen = false; closeProductMenu?.(); }
});

function productsBoard(s, proposed) {
  const cols = ui.products.map(id => byId(s.skus, id)).filter(Boolean);
  const pills = productPicker(s);
  if (!cols.length) return pills + '<p class="muted">Pick up to 5 products to compare across channels.</p>';
  return pills + `<div class="card" style="padding:0"><div class="table-wrap"><table class="matrix">
    <thead><tr><th>Channel</th>${cols.map(k => `<th class="num"><div class="mh">${esc(k.label)}</div><div class="small muted">${k.contentKg} kg · per cyl, VAT incl.</div></th>`).join('')}</tr></thead>
    <tbody>${s.channels.map(c => `<tr><th scope="row"><div class="mh">${esc(c.label)}</div><div class="small muted">${esc(c.audience)} · buffer ${fmt(bufferFor(s, c.id))}</div></th>
      ${cols.map(k => cell(s, proposed, c.id, k.id)).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}

function channelsBoard(s, proposed) {
  const cols = ui.channels.map(id => byId(s.channels, id)).filter(Boolean);
  const pills = pickerPills(s.channels, ui.channels, 'chan', 'channels');
  if (!cols.length) return pills + '<p class="muted">Pick up to 5 channels to compare across products.</p>';
  const pricedIn = st => st && s.skus.filter(k => k.active && cols.some(c => marginRule(st, c.id, k.id)));
  const skus = s.skus.filter(k => pricedIn(s).includes(k) || (proposed && pricedIn(proposed).some(x => x.id === k.id)));
  return pills + `<div class="card" style="padding:0"><div class="table-wrap"><table class="matrix">
    <thead><tr><th>Product</th>${cols.map(c => `<th class="num"><div class="mh">${esc(c.label)}</div>
      <div class="small muted">${esc(c.audience)} · ${s.accounts.filter(a => a.channelId === c.id && a.status === 'Active').length} active clients</div></th>`).join('')}</tr></thead>
    <tbody>${skus.map(k => `<tr><th scope="row"><div class="mh">${esc(k.label)}</div><div class="small muted">${k.contentKg} kg</div></th>
      ${cols.map(c => cell(s, proposed, c.id, k.id)).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}

// ---------------- PL notices ----------------

function noticesTab(s) {
  const pub = currentPublication(s);
  const people = s.users.filter(u => u.role !== 'messenger');
  const rank = id => { const i = NOTICE_ORDER.indexOf(id); return i < 0 ? NOTICE_ORDER.length : i; };
  const lists = [...s.channels].sort((a, b) => rank(a.id) - rank(b.id));
  let acked = 0, total = 0;
  const body = people.map(u => {
    const mine = userChannels(s, u);
    return `<tr><th scope="row"><div class="mh">${esc(u.name)}</div><div class="small muted">${esc(u.role)}</div></th>
      ${lists.map(c => {
        if (!mine.includes(c.id)) return '<td class="center muted">·</td>';
        total++;
        const a = s.acknowledgments.find(x => x.userId === u.id && x.channelId === c.id && x.boardVersion === pub.version);
        if (a) acked++;
        return `<td class="center">${a
          ? `<span class="badge green">✓ Acknowledged</span><div class="ack-date">${esc(fmtDateTime(a.acknowledgedAt))}</div>`
          : '<span class="badge amber">Not seen</span><div class="ack-date">&nbsp;</div>'}</td>`;
      }).join('')}</tr>`;
  }).join('');
  return `<div class="card">
    <div class="notice-head">
      <h2>Notice acknowledgement</h2>
      <div class="muted">Price List v${pub.version} · Published ${fmtDate(pub.publishedAt)} · <b>${acked}/${total}</b> acknowledged</div>
    </div>
    <div class="legend"><span class="lg green">Green: user acknowledged</span><span class="lg amber">Amber: not seen</span><span class="muted">· not on this user's price lists</span></div>
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th>User</th>${lists.map(c => `<th class="center"><span class="pl-badge">${esc(c.label)}</span><div class="small muted">${esc(c.audience)}</div></th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
}

// ---------------- Board behaviour ----------------

function bindMain(root, rerender) {
  const $ = id => root.querySelector('#' + id);
  const bindPick = () => root.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
    if (ui.clients.length < MAX && !ui.clients.includes(b.dataset.pick)) ui.clients.push(b.dataset.pick);
    ui.clientQuery = '';
    rerender();
    document.getElementById('cb-q')?.focus();
  });
  bindPick();
  if ($('cb-q')) $('cb-q').oninput = e => { ui.clientQuery = e.target.value; $('cb-results').innerHTML = clientResults(store.get()); bindPick(); };
  root.querySelectorAll('[data-unpick]').forEach(b => b.onclick = () => { ui.clients = ui.clients.filter(x => x !== b.dataset.unpick); rerender(); });
  if ($('cb-sku')) $('cb-sku').onchange = e => { ui.clientSku = e.target.value; rerender(); };
  const toggle = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : list.length < MAX ? [...list, id] : list);
  closeProductMenu = rerender;
  if ($('pb-toggle')) $('pb-toggle').onclick = () => { ui.prodOpen = !ui.prodOpen; rerender(); };
  if ($('pb-clear')) $('pb-clear').onclick = () => { ui.products = []; rerender(); };
  root.querySelectorAll('[data-prod]').forEach(b => b.onchange = () => { ui.products = toggle(ui.products, b.dataset.prod); rerender(); });
  root.querySelectorAll('[data-unprod]').forEach(b => b.onclick = () => { ui.products = ui.products.filter(x => x !== b.dataset.unprod); rerender(); });
  root.querySelectorAll('[data-chan]').forEach(b => b.onclick = () => { ui.channels = toggle(ui.channels, b.dataset.chan); rerender(); });
}
