// Price Room — manager. Desktop, two columns.

import * as store from '../store.js';
import { fmt, fmtKg } from '../money.js';
import { esc, toast, options } from '../ui.js';
import { derivePremiumPerKg } from '../engine.js';
import {
  byId, currentCostBasis, currentPublication, daysSince, exceptions, priceFor, marginRule, bufferFor,
  skusForChannel, skuLabel, channelLabel, userName, fmtDate, fmtDateTime, userChannels, isStaleReading, boardIsStale,
} from '../pricing.js';
import * as wizard from './priceroom-wizard.js';

const DAY = 86400000;
const TABS = [['exceptions', 'Exceptions'], ['change', 'Price change'], ['receipts', 'Read receipts'], ['account', 'Account lens'], ['sku', 'SKU lens'], ['channel', 'Channel lens']];
const ui = { tab: 'exceptions', lensAccount: null, lensSku: '11KG_MGAS', lensChannel: 'DEALER', reasons: {}, errors: {} };

export function render(root, ctx) {
  const { state: s, user, route } = ctx;
  if (route.query.tab && TABS.some(([k]) => k === route.query.tab)) ui.tab = route.query.tab;
  if (route.query.sim) { ui.tab = 'change'; wizard.loadShared(route.query.sim, s); }

  const cb = currentCostBasis(s);
  const pub = currentPublication(s);
  const strip = `<div class="strip">
    <div><span>Acquisition</span><b>${fmtKg(cb.acqPerKg)}</b></div>
    <div><span>Hauling</span><b>${fmtKg(cb.haulingPerKg)}</b></div>
    <div><span>Cost basis total</span><b>${fmtKg(cb.acqPerKg + cb.haulingPerKg)}</b></div>
    <div><span>Board version</span><b>v${pub.version}</b></div>
    <div><span>Days since publish</span><b>${daysSince(pub.publishedAt)}</b></div>
    ${boardIsStale(s) ? '<div><span>Board</span><b class="pos">Out of date</b></div>' : ''}
  </div>`;

  const bodies = { exceptions: exceptionsTab, change: () => wizard.html(s, user), receipts: receiptsTab, account: accountLens, sku: skuLens, channel: channelLens };
  root.innerHTML = `<section class="page wide">
    <h1>Price room</h1>${strip}
    <div class="tabs">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
    <div id="pr-body">${bodies[ui.tab](s, user)}</div></section>`;

  const rerender = () => render(root, { ...ctx, state: store.get(), route: { ...route, query: Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || '')) } });
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    ui.tab = b.dataset.tab;
    history.replaceState(null, '', `#/priceroom?tab=${ui.tab}`);
    rerender();
  });
  if (ui.tab === 'change') wizard.bind(root.querySelector('#pr-body'), user, rerender);
  else bindTab(root, s, rerender);
}

// ---------------- Exceptions ----------------

function exceptionsTab(s) {
  const rows = exceptions(s);
  const pending = s.priceRequests.filter(r => r.status === 'pending');
  const readings = [...s.competitorReadings].sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1)).slice(0, 15);
  return `<div class="cols">
    <div><h2>Exceptions <span class="muted">(${rows.length})</span></h2>
      ${rows.length ? rows.map(r => `<div class="exc"><span class="pill ${r.severity}">${esc(label(r.kind))}</span>
        <div><div class="subject">${esc(r.subject)}</div><div class="small">${esc(r.text)}</div>
        ${r.requestId ? `<a class="small" href="#req-${esc(r.requestId)}" data-jump="${esc(r.requestId)}">Decide</a>` : ''}</div></div>`).join('')
        : '<p class="muted">Nothing needs attention.</p>'}
    </div>
    <div>
      <h2>Pending price requests <span class="muted">(${pending.length})</span></h2>
      ${pending.length ? pending.map(r => requestCard(s, r)).join('') : '<p class="muted">None pending.</p>'}
      <h2>Latest competitor readings</h2>
      <div class="table-wrap"><table><thead><tr><th>Brand · zone</th><th>Product</th><th class="num">Per cyl</th><th>Captured</th></tr></thead><tbody>
      ${readings.map(r => { const st = isStaleReading(s, r); return `<tr class="${st ? 'stale' : ''}"><td>${esc(r.brand)}<br><span class="small">${esc(r.zone)}</span></td><td>${esc(skuLabel(s, r.skuId))}</td>
        <td class="num">${fmt(r.pricePerCyl)}</td><td class="nowrap">${fmtDate(r.capturedAt)}${st ? `<br><span class="pill grey">${daysSince(r.capturedAt)} days old</span>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>
    </div></div>`;
}

function label(kind) {
  return { below_floor: 'Below floor', contract: 'Contract', trmv: 'TRMV pace', no_reading: 'No reading', competitor_below: 'Competitor lower', request: 'Request' }[kind] || kind;
}

function requestCard(s, r) {
  const reading = s.competitorReadings.find(x => x.id === r.competitorReadingId);
  const subject = r.accountId ? byId(s.accounts, r.accountId)?.name : `Walk-in, ${channelLabel(s, r.channelId)}`;
  const stale = reading && isStaleReading(s, reading);
  return `<div class="card" id="req-${esc(r.id)}" style="margin-bottom:12px">
    <b>${esc(subject)}</b>
    <div class="small muted">${esc(skuLabel(s, r.skuId))} × ${r.qty} · ${fmtDateTime(r.requestedAt)} · ref ${esc(r.id.slice(-6))}</div>
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

// ---------------- Read receipts ----------------

function receiptsTab(s) {
  const pub = currentPublication(s);
  const people = s.users.filter(u => u.role !== 'messenger');
  let acked = 0, total = 0;
  const rows = people.map(u => {
    const chans = userChannels(s, u);
    const cells = chans.map(ch => {
      const a = s.acknowledgments.find(x => x.userId === u.id && x.channelId === ch && x.boardVersion === pub.version);
      total++; if (a) acked++;
      return `<span class="pill ${a ? 'green' : 'amber'}" title="${a ? 'Acknowledged ' + esc(fmtDateTime(a.acknowledgedAt)) : 'Not yet acknowledged'}">${esc(channelLabel(s, ch))}${a ? ' ✓' : ''}</span>`;
    }).join(' ');
    return `<tr><td><b>${esc(u.name)}</b><br><span class="small muted">${esc(u.role)}</span></td><td>${cells}</td></tr>`;
  }).join('');
  return `<h2>Board v${pub.version} — ${acked} of ${total} board acknowledgements</h2>
    <p class="small muted">Green acknowledged, amber not yet. Published ${fmtDateTime(pub.publishedAt)}.</p>
    <div class="table-wrap"><table><tbody>${rows}</tbody></table></div>`;
}

// ---------------- Lenses ----------------

function ladder(r) {
  return `<div class="table-wrap"><table><tbody>
    ${r.ladder.map(l => `<tr><td>${esc(l.step)}</td><td class="num">${fmt(l.perKg)}</td><td class="num">${fmt(l.runningPerKg)}</td></tr>`).join('')}
    <tr class="total"><td>Net per kg</td><td></td><td class="num">${fmt(r.netPerKg)}</td></tr>
    <tr><td>Per cylinder, VAT incl.</td><td></td><td class="num">${fmt(r.grossPerCyl)}</td></tr>
    <tr><td>Floor</td><td></td><td class="num">${fmt(r.floorPerKg)}/kg (${r.marginVsFloorPerKg >= 0 ? '+' : ''}${fmt(r.marginVsFloorPerKg)})</td></tr>
  </tbody></table></div>`;
}

function accountLens(s) {
  if (!ui.lensAccount) ui.lensAccount = s.accounts[0].id;
  const a = byId(s.accounts, ui.lensAccount);
  const p = a.primarySkuId ? priceFor(s, { accountId: a.id, skuId: a.primarySkuId }) : null;
  const quotes = s.quotes.filter(q => q.accountId === a.id).sort((x, y) => (x.sentAt < y.sentAt ? 1 : -1));
  const reqs = s.priceRequests.filter(r => r.accountId === a.id);
  const publishes = s.events.filter(e => e.action === 'PUBLISH' && (e.after?.accountIds || []).includes(a.id));
  let pace = '—';
  if (a.trmvKg && a.volumeGeneratedKg != null && a.contractStart && a.contractEnd) {
    const elapsed = Math.min(1, Math.max(0, (Date.now() - new Date(a.contractStart)) / (new Date(a.contractEnd) - new Date(a.contractStart))));
    pace = `${a.volumeGeneratedKg.toLocaleString('en-PH')} of ${a.trmvKg.toLocaleString('en-PH')} kg (${(a.volumeGeneratedKg / a.trmvKg * 100).toFixed(0)}%) at ${(elapsed * 100).toFixed(0)}% of contract time`;
  }
  const prem = (a.premiums || []).map(x => {
    const comp = s.premiumComponents.find(c => c.code === x.code);
    const v = x.perKg ?? (comp ? derivePremiumPerKg(comp, a) : null);
    return `<tr><td>${esc(comp?.label ?? x.code)}${comp?.type === 'derived' ? ` <span class="small muted">${esc(comp.formula)}</span>` : ''}</td><td class="num">${v == null ? '<span class="muted">missing inputs</span>' : '+' + fmt(v)}</td></tr>`;
  }).join('');
  const disc = (a.discounts || []).map(x => `<tr><td>${esc(s.discountComponents.find(c => c.code === x.code)?.label ?? x.code)}</td><td class="num">−${fmt(x.perKg)}</td></tr>`).join('');

  return `<label class="field" style="max-width:480px"><span>Account</span><select id="lens-acc">${options(s.accounts, a.id, { label: x => `${x.name} (${x.status})` })}</select></label>
    <div class="cols" style="margin-top:12px">
      <div class="stack">
        <div class="card"><b>${esc(a.name)}</b> <span class="pill ${a.status === 'Active' ? 'green' : 'grey'}">${esc(a.status)}</span>${a.needsAttention ? ' <span class="pill amber">Needs attention</span>' : ''}
          <div class="table-wrap"><table><tbody>
            <tr><td>Channel</td><td>${esc(channelLabel(s, a.channelId))}</td></tr>
            <tr><td>Zone</td><td>${esc(a.zone)}</td></tr>
            <tr><td>Contract</td><td>${a.contractStart ? `${fmtDate(a.contractStart)} – ${fmtDate(a.contractEnd)}` : '—'}</td></tr>
            <tr><td>Volume vs contract</td><td>${esc(pace)}</td></tr>
            <tr><td>Average monthly volume</td><td>${a.avgMonthlyVolumeKg == null ? '<span class="muted">not on record</span>' : a.avgMonthlyVolumeKg.toLocaleString('en-PH') + ' kg'}</td></tr>
            <tr><td>Credit term</td><td>${a.creditTermDays ?? '—'} days</td></tr>
            <tr><td>Floor override</td><td>${a.floorOverridePerKg == null ? 'None (default floor)' : fmtKg(a.floorOverridePerKg)}</td></tr>
            <tr><td>Competitor brand</td><td>${esc(a.competitorBrand ?? '—')}</td></tr>
          </tbody></table></div></div>
        <div class="card"><h3 style="margin-top:0">Premiums and discounts, per kg</h3>
          <div class="table-wrap"><table><tbody>${prem}${disc}${prem || disc ? '' : '<tr><td class="muted">None</td></tr>'}</tbody></table></div></div>
      </div>
      <div class="stack">
        ${p?.result ? `<div class="card"><h3 style="margin-top:0">Current price — ${esc(skuLabel(s, a.primarySkuId))}</h3>${ladder(p.result)}</div>` : ''}
        <div class="card"><h3 style="margin-top:0">Price history — quotes</h3>
          ${quotes.length ? `<div class="table-wrap"><table><thead><tr><th>Sent</th><th>Product</th><th class="num">Per cyl</th><th>Board</th></tr></thead><tbody>
          ${quotes.map(q => `<tr><td>${fmtDate(q.sentAt)}</td><td>${esc(skuLabel(s, q.skuId))} × ${q.qty}</td><td class="num">${fmt(q.snapshot.output.grossPerCyl)}</td><td>v${q.snapshot.boardVersion} <code class="small">${esc((q.snapshotHash || '').slice(0, 8))}</code></td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted small">No quotes yet.</p>'}
          <h3>Publishes affecting this account</h3>
          ${publishes.length ? `<ul class="small">${publishes.map(e => `<li>v${e.after.version}, ${fmtDate(e.timestamp)} — ${esc(e.after.cause)}</li>`).join('')}</ul>` : '<p class="muted small">None.</p>'}
          <h3>Price requests</h3>
          ${reqs.length ? `<ul class="small">${reqs.map(r => `<li>${esc(skuLabel(s, r.skuId))} to ${fmt(r.targetGrossPerCyl)} — ${esc(r.status)}${r.decisionReason ? `: ${esc(r.decisionReason)}` : ''}</li>`).join('')}</ul>` : '<p class="muted small">None.</p>'}
        </div>
      </div></div>`;
}

function skuLens(s) {
  const rows = s.channels.map(c => {
    const mr = marginRule(s, c.id, ui.lensSku);
    const p = mr ? priceFor(s, { channelId: c.id, skuId: ui.lensSku }) : null;
    return `<tr><td>${esc(c.label)}</td>${p?.result ? `<td class="num">${fmt(mr.perKg)}</td><td class="num">${fmt(bufferFor(s, c.id))}</td><td class="num">${fmt(p.result.netPerKg)}</td><td class="num">${fmt(p.result.netPerCyl)}</td><td class="num"><b>${fmt(p.result.grossPerCyl)}</b></td>`
      : '<td colspan="5" class="muted">Not priced on this channel</td>'}</tr>`;
  }).join('');
  return `<label class="field" style="max-width:360px"><span>Product</span><select id="lens-sku">${options(s.skus, ui.lensSku)}</select></label>
    <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Channel</th><th class="num">Margin/kg</th><th class="num">Buffer/kg</th><th class="num">Net/kg</th><th class="num">Net/cyl</th><th class="num">Per cyl, VAT incl.</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function channelLens(s) {
  const rows = skusForChannel(s, ui.lensChannel).map(k => {
    const p = priceFor(s, { channelId: ui.lensChannel, skuId: k.id });
    return `<tr><td>${esc(k.label)}</td><td class="num">${k.contentKg}</td><td class="num">${fmt(p.input.marginPerKg)}</td><td class="num">${fmt(p.result.netPerKg)}</td><td class="num">${fmt(p.result.netPerCyl)}</td><td class="num"><b>${fmt(p.result.grossPerCyl)}</b></td></tr>`;
  }).join('');
  const accounts = s.accounts.filter(a => a.channelId === ui.lensChannel);
  return `<label class="field" style="max-width:360px"><span>Channel</span><select id="lens-ch">${options(s.channels, ui.lensChannel)}</select></label>
    <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Product</th><th class="num">kg</th><th class="num">Margin/kg</th><th class="num">Net/kg</th><th class="num">Net/cyl</th><th class="num">Per cyl, VAT incl.</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">No products priced.</td></tr>'}</tbody></table></div>
    <h3>Accounts on this channel</h3>
    <p class="small">${accounts.map(a => `${esc(a.name)} <span class="pill ${a.status === 'Active' ? 'green' : 'grey'}">${esc(a.status)}</span>`).join(' · ') || '<span class="muted">None</span>'}</p>`;
}

function bindTab(root, s, rerender) {
  root.querySelectorAll('[data-reason]').forEach(t => t.oninput = e => { ui.reasons[t.dataset.reason] = e.target.value; });
  root.querySelectorAll('[data-decide]').forEach(b => b.onclick = async () => { await decide(b.dataset.req, b.dataset.decide); rerender(); });
  root.querySelectorAll('[data-jump]').forEach(a => a.onclick = e => {
    e.preventDefault();
    const el = document.getElementById('reason-' + a.dataset.jump);
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
  });
  const acc = root.querySelector('#lens-acc');
  if (acc) acc.onchange = e => { ui.lensAccount = e.target.value; rerender(); };
  const sku = root.querySelector('#lens-sku');
  if (sku) sku.onchange = e => { ui.lensSku = e.target.value; rerender(); };
  const ch = root.querySelector('#lens-ch');
  if (ch) ch.onchange = e => { ui.lensChannel = e.target.value; rerender(); };
}
