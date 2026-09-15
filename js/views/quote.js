// Quote Desk — seller. Phone width. No editable price field exists on this screen.

import * as store from '../store.js';
import { fmt, toCentavos, roundHalfUp } from '../money.js';
import { esc, toast, options, modal, preserveFocus } from '../ui.js';
import {
  byId, priceFor, userChannels, skusForChannel, boardIsStale, currentPublication, pendingRequest,
  zoneOf, skuLabel, channelLabel, fmtDate, fmtDateTime, daysSince, isStaleReading,
} from '../pricing.js';

const DAY = 86400000;
const ui = { tab: 'new', walkIn: false, query: '', accountId: null, channelId: null, skuId: null, qty: 1, showWhy: false, openQuoteId: null };

export function render(root, ctx) {
  preserveFocus(root, () => { root.innerHTML = view(ctx); });
  bind(root, ctx);
}

function view({ state: s, user }) {
  const tabs = `<div class="tabs" role="tablist">
    <button type="button" data-tab="new" class="${ui.tab === 'new' ? 'on' : ''}">New quote</button>
    <button type="button" data-tab="mine" class="${ui.tab === 'mine' ? 'on' : ''}">My quotes</button></div>`;
  const body = ui.tab === 'mine' ? myQuotes(s, user) : newQuote(s, user);
  const open = ui.openQuoteId ? s.quotes.find(q => q.quoteId === ui.openQuoteId) : null;
  return `<section class="page narrow">
    <h1>Quote desk</h1>${tabs}
    ${open ? printable(s, open) : ''}
    <div class="${open ? 'no-print' : ''}">${body}</div></section>`;
}

function chans(s, user) {
  return userChannels(s, user);
}

function newQuote(s, user) {
  const myChannels = chans(s, user);
  const account = ui.accountId ? byId(s.accounts, ui.accountId) : null;
  const channelId = ui.walkIn ? (ui.channelId || myChannels[0]) : account?.channelId;
  const stale = boardIsStale(s);

  let customer;
  if (ui.walkIn) {
    customer = `<label class="field"><span>Channel</span>
      <select id="q-channel">${options(s.channels.filter(c => myChannels.includes(c.id)), channelId)}</select></label>`;
  } else if (account) {
    customer = `<div class="field"><span class="muted small">Customer</span>
      <div class="card row"><div class="grow"><b>${esc(account.name)}</b><br><span class="small muted">${esc(channelLabel(s, account.channelId))} · ${esc(account.zone)}</span></div>
      <button type="button" id="q-clear" class="small">Change</button></div></div>`;
  } else {
    customer = `<div class="typeahead"><label class="field"><span>Customer</span>
      <input id="q-query" type="search" autocomplete="off" placeholder="Type a customer name" value="${esc(ui.query)}"></label>
      <div id="q-results">${typeaheadResults(s, user)}</div></div>`;
  }

  const skus = channelId ? skusForChannel(s, channelId) : [];
  if (ui.skuId && !skus.some(k => k.id === ui.skuId)) ui.skuId = null;
  if (!ui.skuId && account?.primarySkuId && skus.some(k => k.id === account.primarySkuId)) ui.skuId = account.primarySkuId;

  const form = `<div class="stack">
    <label class="toggle"><input id="q-walkin" type="checkbox" ${ui.walkIn ? 'checked' : ''}> Walk-in / no account</label>
    ${customer}
    <div class="row">
      <label class="field grow"><span>Product</span><select id="q-sku" ${channelId ? '' : 'disabled'}>${options(skus, ui.skuId, { placeholder: 'Choose product' })}</select></label>
      <label class="field" style="flex:0 0 110px"><span>Quantity</span><input id="q-qty" type="number" min="1" step="1" inputmode="numeric" value="${esc(ui.qty)}"></label>
    </div></div>`;

  return `${stale ? '<div class="banner red">Board is out of date — prices cannot be sent. Ask a manager to republish.</div>' : ''}
    ${form}<div id="q-result">${resultHtml(s, user)}</div>`;
}

function typeaheadResults(s, user) {
  const q = ui.query.trim().toLowerCase();
  if (!q) return '';
  // Inactive accounts never appear here.
  const myChannels = chans(s, user);
  const matches = s.accounts.filter(a => a.status === 'Active' && myChannels.includes(a.channelId) && a.name.toLowerCase().includes(q)).slice(0, 8);
  return matches.length
    ? `<ul>${matches.map(a => `<li><button type="button" data-acc="${esc(a.id)}"><span><b>${esc(a.name)}</b><br><span class="small muted">${esc(channelLabel(s, a.channelId))} · ${esc(a.zone)}</span></span></button></li>`).join('')}</ul>`
    : '<p class="muted small">No active customers match.</p>';
}

function resultHtml(s, user) {
  const account = !ui.walkIn && ui.accountId ? byId(s.accounts, ui.accountId) : null;
  const channelId = ui.walkIn ? (ui.channelId || chans(s, user)[0]) : account?.channelId;
  if (!channelId || !ui.skuId) return '';
  const p = priceFor(s, { accountId: account?.id ?? null, channelId, skuId: ui.skuId, quantity: ui.qty });
  return p.error ? `<p class="err">${esc(p.error)}</p>` : resultCard(s, p, boardIsStale(s));
}

function marginBar(r) {
  const d = r.marginVsFloorPerKg;
  const color = d < 0 ? 'red' : d < 50 ? 'amber' : 'green';
  const pct = 50 + Math.max(-1, Math.min(1, d / 1000)) * 50;
  const label = d === 0 ? 'At your floor' : d > 0 ? `${fmt(d)}/kg above your floor` : `${fmt(-d)}/kg below your floor`;
  return `<div class="bar ${color}" role="img" aria-label="${esc(label)}"><i style="width:${pct}%"></i><span class="floor"></span></div>
    <div class="bar-label ${color}">${esc(label)}</div>`;
}

function ladderTable(r) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>Step</th><th class="num">Per kg</th><th class="num">Running</th></tr></thead><tbody>
    ${r.ladder.map(l => `<tr><td>${esc(l.step)}</td><td class="num">${l.perKg < 0 ? '−' : l.kind === 'cost' && l.step === 'Acquisition cost' ? '' : '+'}${fmt(Math.abs(l.perKg))}</td><td class="num">${fmt(l.runningPerKg)}</td></tr>`).join('')}
    <tr class="total"><td>Net per kg</td><td></td><td class="num">${fmt(r.netPerKg)}</td></tr>
    <tr><td>Net per cylinder</td><td></td><td class="num">${fmt(r.netPerCyl)}</td></tr>
    <tr><td>VAT</td><td></td><td class="num">+${fmt(r.vatPerCyl)}</td></tr>
    <tr class="total"><td>Price per cylinder</td><td></td><td class="num">${fmt(r.grossPerCyl)}</td></tr>
    <tr><td class="muted">Floor</td><td></td><td class="num muted">${fmt(r.floorPerKg)}/kg</td></tr>
    </tbody></table></div>`;
}

function resultCard(s, p, stale) {
  const r = p.result;
  const pending = pendingRequest(s, p.lineKey, p.sku.id);
  const blockedByFloor = r.belowFloor && !p.exception;
  const canSend = !stale && !pending && !blockedByFloor && r.quantity > 0;
  const reasons = [];
  if (stale) reasons.push('Board is out of date — republish before sending.');
  if (pending) reasons.push(`Price request pending in the Price Room since ${fmtDateTime(pending.requestedAt)}.`);
  if (blockedByFloor) reasons.push('Below floor — request a lower price for approval before sending.');
  if (r.quantity <= 0) reasons.push('Enter a quantity of at least 1.');

  return `<div class="card" style="margin-top:14px">
    <div class="muted small">${esc(p.sku.label)} · ${esc(p.channel.label)} · board v${currentPublication(s).version}</div>
    <div class="price-hero">${fmt(r.grossPerCyl)}</div>
    <div class="muted small">per cylinder, VAT inclusive</div>
    <div class="price-sub"><span>Per kg <b>${fmt(r.netPerKg)}</b> <span class="small muted">net</span></span>
      <span>Total × ${r.quantity} <b>${fmt(r.grossTotal)}</b></span></div>
    ${marginBar(r)}
    ${p.exception ? `<div class="banner green small">Approved price exception applied — valid until ${fmtDate(p.exception.validUntil)}</div>` : ''}
    ${p.notes.map(n => `<p class="small muted">${esc(n)}</p>`).join('')}
    <details id="q-why" ${ui.showWhy ? 'open' : ''}><summary>Why this price</summary>${ladderTable(r)}</details>
    ${reasons.map(t => `<p class="err">${esc(t)}</p>`).join('')}
    <div class="row" style="margin-top:10px">
      <button type="button" id="q-send" class="primary grow" ${canSend ? '' : 'disabled'}>Send quote</button>
      <button type="button" id="q-lower" class="grow" ${pending ? 'disabled' : ''}>Request lower</button>
    </div></div>`;
}

function myQuotes(s, user) {
  const now = new Date();
  const mine = s.quotes.filter(q => q.sentBy === user.id).sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
  const reqs = s.priceRequests.filter(r => r.requestedBy === user.id).sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  const quotes = mine.length ? `<div class="table-wrap"><table><thead><tr><th>Quote</th><th class="num">Per cyl</th><th>Status</th><th></th></tr></thead><tbody>
    ${mine.map(q => {
      const valid = new Date(q.validUntil) >= now;
      return `<tr><td><b>${esc(q.snapshot.customerName)}</b><br><span class="small muted">${esc(skuLabel(s, q.skuId))} × ${q.qty} · ${fmtDate(q.sentAt)}</span></td>
        <td class="num">${fmt(q.snapshot.output.grossPerCyl)}</td>
        <td><span class="pill ${valid ? 'green' : 'grey'}">${valid ? 'Valid' : 'Expired'}</span></td>
        <td><button type="button" class="small" data-open="${esc(q.quoteId)}">Open</button></td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="muted">No quotes sent yet.</p>';
  const requests = reqs.length ? `<h2>My price requests</h2><div class="table-wrap"><table><tbody>
    ${reqs.map(r => `<tr><td>${esc(r.accountId ? byId(s.accounts, r.accountId)?.name : 'Walk-in, ' + channelLabel(s, r.channelId))}<br>
      <span class="small muted">${esc(skuLabel(s, r.skuId))} to ${fmt(r.targetGrossPerCyl)}</span>
      ${r.decisionReason ? `<br><span class="small">Decision: ${esc(r.decisionReason)}</span>` : ''}</td>
      <td><span class="pill ${r.status === 'approved' ? 'green' : r.status === 'declined' ? 'red' : 'amber'}">${esc(r.status[0].toUpperCase() + r.status.slice(1))}</span></td></tr>`).join('')}
    </tbody></table></div>` : '';
  return quotes + requests;
}

function printable(s, q) {
  const o = q.snapshot.output;
  const valid = new Date(q.validUntil) >= new Date();
  return `<div class="printable stack">
    <div class="row"><div class="grow"><b>MGC quotation</b><br><span class="small muted">${esc(q.quoteId)} · hash ${esc((q.snapshotHash || '').slice(0, 8))}</span></div>
      <span class="pill ${valid ? 'green' : 'grey'}">${valid ? 'Valid' : 'Expired'}</span></div>
    <div><b>${esc(q.snapshot.customerName)}</b><br><span class="small muted">${esc(q.snapshot.input.channel.label)}</span></div>
    <div class="price-hero">${fmt(o.grossPerCyl)}</div>
    <div class="muted small">${esc(q.snapshot.input.sku.label)}, per cylinder, VAT inclusive</div>
    <div class="price-sub"><span>Quantity <b>${o.quantity}</b></span><span>Total <b>${fmt(o.grossTotal)}</b></span></div>
    <p class="small">Sent ${fmtDateTime(q.sentAt)} by ${esc(byId(s.users, q.sentBy)?.name)} · valid until ${fmtDate(q.validUntil)} · board v${q.snapshot.boardVersion}</p>
    <details><summary>Why this price</summary>${ladderTable(o)}</details>
    <div class="row no-print"><button type="button" onclick="window.print()">Print</button><button type="button" id="q-close">Close</button></div></div>`;
}

function bind(root, ctx) {
  const { state: s, user } = ctx;
  const rerender = () => render(root, { ...ctx, state: store.get() });
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; ui.openQuoteId = null; rerender(); });
  root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { ui.openQuoteId = b.dataset.open; rerender(); });
  const $ = id => root.querySelector('#' + id);
  if ($('q-close')) $('q-close').onclick = () => { ui.openQuoteId = null; rerender(); };
  if ($('q-walkin')) $('q-walkin').onchange = e => { ui.walkIn = e.target.checked; ui.skuId = null; rerender(); };
  if ($('q-channel')) $('q-channel').onchange = e => { ui.channelId = e.target.value; ui.skuId = null; rerender(); };
  // Typing updates only the results list / price card, never the input being typed into.
  const bindResults = () => root.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => { ui.accountId = b.dataset.acc; ui.query = ''; ui.skuId = null; rerender(); });
  bindResults();
  if ($('q-query')) $('q-query').oninput = e => { ui.query = e.target.value; $('q-results').innerHTML = typeaheadResults(store.get(), user); bindResults(); };
  if ($('q-clear')) $('q-clear').onclick = () => { ui.accountId = null; ui.skuId = null; rerender(); };
  if ($('q-sku')) $('q-sku').onchange = e => { ui.skuId = e.target.value || null; rerender(); };
  if ($('q-qty')) $('q-qty').oninput = e => { ui.qty = Math.max(0, parseInt(e.target.value, 10) || 0); $('q-result').innerHTML = resultHtml(store.get(), user); bindResult(root, user, rerender); };
  bindResult(root, user, rerender);
}

function bindResult(root, user, rerender) {
  const $ = id => root.querySelector('#' + id);
  if ($('q-why')) $('q-why').ontoggle = e => { ui.showWhy = e.target.open; };
  if ($('q-send')) $('q-send').onclick = () => sendQuote(store.get(), user).then(rerender);
  if ($('q-lower')) $('q-lower').onclick = () => requestLower(store.get(), user);
}

function currentLine(s, user) {
  const account = !ui.walkIn && ui.accountId ? byId(s.accounts, ui.accountId) : null;
  const channelId = ui.walkIn ? (ui.channelId || chans(s, user)[0]) : account?.channelId;
  return { account, channelId, p: priceFor(s, { accountId: account?.id ?? null, channelId, skuId: ui.skuId, quantity: ui.qty }) };
}

async function sendQuote(s, user) {
  const { account, channelId, p } = currentLine(s, user);
  if (p.error) return;
  // Re-check every gate at the moment of sending.
  if (boardIsStale(s)) return toast('Board is out of date — republish before sending', 'bad');
  if (pendingRequest(s, p.lineKey, p.sku.id)) return toast('A price request is pending for this line', 'bad');
  if (p.result.belowFloor && !p.exception) return toast('Below floor — request a lower price first', 'bad');

  const now = new Date();
  const quoteId = store.uid('q');
  const snapshot = {
    quoteId,
    customerName: account ? account.name : `Walk-in — ${channelLabel(s, channelId)}`,
    boardVersion: currentPublication(s).version,
    exceptionRequestId: p.exception?.id ?? null,
    input: p.input,
    output: p.result,
  };
  await store.commit({
    action: 'QUOTE_SENT', entity: 'quote', entityId: account?.id ?? p.lineKey, field: 'grossPerCyl',
    after: { quoteId, skuId: p.sku.id, qty: p.result.quantity, grossPerCyl: p.result.grossPerCyl, grossTotal: p.result.grossTotal },
    hashOf: snapshot,
  }, (d, ev) => {
    d.quotes.push({
      quoteId, accountId: account?.id ?? null, channelId, skuId: p.sku.id, qty: p.result.quantity,
      snapshot, snapshotHash: ev.snapshotHash, sentBy: user.id, sentAt: ev.timestamp,
      validUntil: new Date(now.getTime() + (s.settings.quoteValidityDays || 7) * DAY).toISOString(),
    });
  });
  ui.openQuoteId = quoteId;
  toast('Quote sent');
}

function requestLower(s, user) {
  const { account, channelId, p } = currentLine(s, user);
  if (p.error) return;
  const zone = account ? zoneOf(s, account.zone) : null;
  const readings = s.competitorReadings
    .filter(r => r.skuId === p.sku.id && (!zone || r.zone === zone))
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
  const readingLabel = r => `${r.brand}, ${r.zone} — ${fmt(r.pricePerCyl)} · ${fmtDate(r.capturedAt)}${isStaleReading(s, r) ? ` (stale, ${daysSince(r.capturedAt)} days)` : ''}`;

  const dlg = modal('Request lower price', `
    <p class="small muted">${esc(account ? account.name : 'Walk-in')} · ${esc(p.sku.label)} · now ${fmt(p.result.grossPerCyl)}/cyl</p>
    <div class="stack">
      <label class="field"><span>Target price per cylinder, VAT inclusive (₱)</span><input id="rl-target" type="text" inputmode="decimal" placeholder="e.g. 1250.00"></label>
      <label class="field"><span>Reason</span><textarea id="rl-reason" placeholder="What the customer said, and why this matters"></textarea></label>
      <label class="field"><span>Competitor reading${zone ? ` in ${esc(zone)}` : ''}</span>
        <select id="rl-reading">${options(readings, null, { label: readingLabel, placeholder: readings.length ? 'Select a reading' : 'No readings for this product' + (zone ? ' in this zone' : '') })}</select></label>
      ${readings.length ? '' : '<p class="small muted">Ask a messenger to capture a reading in Market Watch first.</p>'}
      <div id="rl-err" class="err" role="alert"></div>
      <div class="row"><button type="button" id="rl-submit" class="primary grow">Submit request</button><button type="button" id="rl-cancel" class="grow">Cancel</button></div>
    </div>`);

  dlg.querySelector('#rl-cancel').onclick = () => dlg.close();
  dlg.querySelector('#rl-submit').onclick = async () => {
    const err = dlg.querySelector('#rl-err');
    const target = toCentavos(dlg.querySelector('#rl-target').value);
    const reason = dlg.querySelector('#rl-reason').value.trim();
    const readingId = dlg.querySelector('#rl-reading').value;
    if (!target || target <= 0) return err.textContent = 'Enter a target price, for example 1250.00';
    if (target >= p.result.grossPerCyl) return err.textContent = `Target must be below the current ${fmt(p.result.grossPerCyl)}`;
    if (!reason) return err.textContent = 'Write the reason for the request';
    if (!readingId) return err.textContent = 'Select a competitor reading — a request cannot be submitted without one';

    const id = store.uid('req');
    await store.commit({
      action: 'REQUEST_LOWER', entity: 'priceRequest', entityId: account?.id ?? p.lineKey, field: 'grossPerCyl',
      before: p.result.grossPerCyl, after: target,
    }, d => {
      d.priceRequests.push({
        id, lineKey: p.lineKey, accountId: account?.id ?? null, channelId, skuId: p.sku.id, qty: p.result.quantity,
        currentGrossPerCyl: p.result.grossPerCyl, currentNetPerKg: p.result.netPerKg, targetGrossPerCyl: target,
        // Discount per kg that would reach the target, ex-VAT.
        impliedDiscountPerKg: roundHalfUp((p.result.grossPerCyl - target) / (p.sku.contentKg * (1 + (p.input.vatInclusive ? p.input.vatRate : 0)))),
        reason, competitorReadingId: readingId, requestedBy: user.id, requestedAt: new Date().toISOString(),
        status: 'pending', decidedBy: null, decidedAt: null, decisionReason: null, approvedDiscountPerKg: null, validUntil: null,
      });
    });
    dlg.close();
    toast('Request sent to the Price Room');
  };
}
