// Quote Desk — seller. Phone width. No editable price field exists on this screen.
// Floor, margin bar and the price ladder are management information and are not shown to sellers.
// Print, Save price list and Send quote all produce the same short bond document (pricedoc.js).

import * as store from '../store.js';
import { fmt, toCentavos, roundHalfUp } from '../money.js';
import { esc, toast, options, modal, preserveFocus } from '../ui.js';
import {
  byId, priceFor, userChannels, skusForChannel, boardIsStale, currentPublication, pendingRequest,
  zoneOf, skuLabel, channelLabel, userName, fmtDate, fmtDateTime, daysSince, isStaleReading,
} from '../pricing.js';
import { printDoc, savePdf, previewUrl, slug } from '../pricedoc.js';

const DAY = 86400000;
const ALL = '__all';
const ui = { tab: 'new', walkIn: false, query: '', accountId: null, channelId: null, skuId: ALL, qty: 1, openQuoteId: null };

export function render(root, ctx) {
  preserveFocus(root, () => { root.innerHTML = view(ctx); });
  bind(root, ctx);
  const img = root.querySelector('#q-doc');
  const q = img && ctx.state.quotes.find(x => x.quoteId === ui.openQuoteId);
  if (q) previewUrl(quoteDoc(ctx.state, q)).then(url => { if (img.isConnected) img.src = url; });
}

function view({ state: s, user }) {
  const tabs = `<div class="tabs" role="tablist">
    <button type="button" data-tab="new" class="${ui.tab === 'new' ? 'on' : ''}">New quote</button>
    <button type="button" data-tab="past" class="${ui.tab === 'past' ? 'on' : ''}">Past quotes</button></div>`;
  const open = ui.openQuoteId ? s.quotes.find(q => q.quoteId === ui.openQuoteId) : null;
  const body = open ? sentPanel(s, open) : ui.tab === 'past' ? pastQuotes(s, user) : newQuote(s, user);
  return `<section class="page narrow">
    <div class="page-head"><div><div class="eyebrow">Sales</div><h1>Quote desk</h1></div></div>
    ${tabs}${body}</section>`;
}

function context(s, user) {
  const myChannels = userChannels(s, user);
  const account = !ui.walkIn && ui.accountId ? byId(s.accounts, ui.accountId) : null;
  const channelId = ui.walkIn ? (ui.channelId || myChannels[0]) : account?.channelId;
  return { myChannels, account, channelId };
}

// ---------------- New quote ----------------

function newQuote(s, user) {
  const { myChannels, account, channelId } = context(s, user);

  let customer;
  if (ui.walkIn) {
    customer = `<label class="field"><span>Channel</span>
      <select id="q-channel">${options(s.channels.filter(c => myChannels.includes(c.id)), channelId)}</select></label>`;
  } else if (account) {
    customer = `<div class="field"><span class="muted small">Customer</span>
      <div class="card row"><div class="grow"><b>${esc(account.name)}</b><br><span class="small muted">${esc(channelLabel(s, account.channelId))} · ${esc(account.zone ?? '—')}</span></div>
      <button type="button" id="q-clear" class="small">Change</button></div></div>`;
  } else {
    customer = `<div class="typeahead"><label class="field"><span>Customer</span>
      <input id="q-query" type="search" autocomplete="off" placeholder="Type a customer name" value="${esc(ui.query)}"></label>
      <div id="q-results">${typeaheadResults(s, user)}</div></div>`;
  }

  const skus = channelId ? skusForChannel(s, channelId) : [];
  if (ui.skuId !== ALL && !skus.some(k => k.id === ui.skuId)) ui.skuId = ALL;
  const single = ui.skuId !== ALL;

  return `${boardIsStale(s) ? '<div class="banner red">Price list is out of date — prices cannot be sent or printed. Ask a manager to republish.</div>' : ''}
    <div class="stack">
      <label class="toggle"><input id="q-walkin" type="checkbox" ${ui.walkIn ? 'checked' : ''}> Walk-in / no account</label>
      ${customer}
      <div class="row">
        <label class="field grow"><span>Product</span><select id="q-sku" ${channelId ? '' : 'disabled'}>
          <option value="${ALL}"${single ? '' : ' selected'}>All products</option>${options(skus, single ? ui.skuId : null)}</select></label>
        ${single ? `<label class="field" style="flex:0 0 110px"><span>Quantity</span><input id="q-qty" type="number" min="1" step="1" inputmode="numeric" value="${esc(ui.qty)}"></label>` : ''}
      </div>
    </div>
    <div id="q-result">${resultHtml(s, user)}</div>`;
}

function typeaheadResults(s, user) {
  const q = ui.query.trim().toLowerCase();
  if (!q) return '';
  // Inactive accounts never appear here.
  const myChannels = userChannels(s, user);
  const matches = s.accounts.filter(a => a.status === 'Active' && myChannels.includes(a.channelId) && a.name.toLowerCase().includes(q)).slice(0, 8);
  return matches.length
    ? `<ul>${matches.map(a => `<li><button type="button" data-acc="${esc(a.id)}"><span><b>${esc(a.name)}</b><br><span class="small muted">${esc(channelLabel(s, a.channelId))} · ${esc(a.zone ?? '—')}</span></span></button></li>`).join('')}</ul>`
    : '<p class="muted small">No active customers match.</p>';
}

function resultHtml(s, user) {
  const { account, channelId } = context(s, user);
  if (!channelId) return '';
  return ui.skuId === ALL ? allProductsCard(s, account, channelId) : singleCard(s, account, channelId);
}

// A line may be issued (sent, printed, saved) only when it needs no approval.
function lineStatus(s, p) {
  if (pendingRequest(s, p.lineKey, p.sku.id)) return 'Request pending';
  if (p.result.belowFloor && !p.exception) return 'Needs approval';
  return null;
}

function linesFor(s, account, channelId, quantity = 1) {
  return skusForChannel(s, channelId)
    .map(k => priceFor(s, { accountId: account?.id ?? null, channelId, skuId: k.id, quantity }))
    .filter(p => !p.error);
}

function allProductsCard(s, account, channelId) {
  const lines = linesFor(s, account, channelId);
  const stale = boardIsStale(s);
  const held = lines.filter(p => lineStatus(s, p)).length;
  const canIssue = !stale && lines.length > held;
  return `<div class="card" style="margin-top:14px">
    <div class="muted small">${esc(account ? account.name : 'Walk-in')} · ${esc(channelLabel(s, channelId))} · price list v${currentPublication(s).version}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Product</th><th class="num">Per kg, net</th><th class="num">Per cylinder</th></tr></thead>
      <tbody>${lines.map(p => {
        const st = lineStatus(s, p);
        return `<tr><td><button type="button" class="link" data-sku="${esc(p.sku.id)}">${esc(p.sku.label)}</button>
          <div class="small muted">${p.sku.contentKg} kg${st ? ` · <span class="pill amber">${esc(st)}</span>` : ''}</div></td>
          <td class="num">${fmt(p.result.netPerKg)}</td><td class="num"><b>${fmt(p.result.grossPerCyl)}</b></td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="small muted">Per cylinder includes VAT. Tap a product to quote a quantity.</p>
    ${held ? `<p class="small">${held} product${held > 1 ? 's' : ''} marked above ${held > 1 ? 'are' : 'is'} left off the printed price list until approved.</p>` : ''}
    <div class="row" style="margin-top:10px">
      <button type="button" id="q-print" class="grow" ${canIssue ? '' : 'disabled'}>Print</button>
      <button type="button" id="q-savelist" class="primary grow" ${canIssue ? '' : 'disabled'}>Save price list</button>
    </div></div>`;
}

function singleCard(s, account, channelId) {
  const p = priceFor(s, { accountId: account?.id ?? null, channelId, skuId: ui.skuId, quantity: ui.qty });
  if (p.error) return `<p class="err">${esc(p.error)}</p>`;
  const r = p.result;
  const pending = pendingRequest(s, p.lineKey, p.sku.id);
  const reasons = [];
  if (boardIsStale(s)) reasons.push('Price list is out of date — republish before sending.');
  if (pending) reasons.push(`Price request pending in the Price room since ${fmtDateTime(pending.requestedAt)}.`);
  else if (r.belowFloor && !p.exception) reasons.push('This price needs manager approval — use Request lower before sending.');
  if (r.quantity <= 0) reasons.push('Enter a quantity of at least 1.');
  const ok = !reasons.length;

  return `<div class="card" style="margin-top:14px">
    <div class="muted small">${esc(p.sku.label)} · ${esc(p.channel.label)} · price list v${currentPublication(s).version}</div>
    <div class="price-hero">${fmt(r.grossPerCyl)}</div>
    <div class="muted small">per cylinder, VAT inclusive</div>
    <div class="price-sub"><span>Per kg <b>${fmt(r.netPerKg)}</b> <span class="small muted">net</span></span>
      <span>Total × ${r.quantity} <b>${fmt(r.grossTotal)}</b></span></div>
    ${p.exception ? `<div class="banner green small" style="margin-top:10px">Approved price — valid until ${fmtDate(p.exception.validUntil)}</div>` : ''}
    ${p.notes.map(n => `<p class="small muted">${esc(n)}</p>`).join('')}
    ${reasons.map(t => `<p class="err">${esc(t)}</p>`).join('')}
    <div class="row" style="margin-top:12px">
      <button type="button" id="q-send" class="primary grow" ${ok ? '' : 'disabled'}>Send quote</button>
      <button type="button" id="q-lower" class="grow" ${pending ? 'disabled' : ''}>Request lower</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button type="button" id="q-print" class="grow" ${ok ? '' : 'disabled'}>Print</button>
      <button type="button" id="q-savelist" class="grow" ${ok ? '' : 'disabled'}>Save price list</button>
    </div></div>`;
}

// ---------------- Documents ----------------

function listDoc(s, user, account, channelId, lines, withQty) {
  const pub = currentPublication(s);
  const now = new Date();
  return {
    title: 'Price list', docNo: `Price list v${pub.version} · ${channelLabel(s, channelId)}`,
    customer: account ? account.name : 'Walk-in customer',
    subtitle: `${channelLabel(s, channelId)}${account?.zone ? ` · ${account.zone}` : ''}`,
    version: pub.version, effective: fmtDate(pub.publishedAt), issued: fmtDateTime(now),
    validUntil: fmtDate(new Date(now.getTime() + (s.settings.quoteValidityDays || 7) * DAY)),
    issuedBy: user.name, vatRate: s.settings.vatRate, ref: '',
    rows: lines.map(p => ({ label: p.sku.label, contentKg: p.sku.contentKg, netPerKg: p.result.netPerKg, grossPerCyl: p.result.grossPerCyl,
      ...(withQty ? { qty: p.result.quantity, total: p.result.grossTotal } : {}) })),
    total: withQty ? lines.reduce((t, p) => t + p.result.grossTotal, 0) : null,
  };
}

export function quoteDoc(s, q) {
  const o = q.snapshot.output, i = q.snapshot.input;
  const pub = s.publications.find(p => p.version === q.snapshot.boardVersion);
  const zone = q.accountId ? byId(s.accounts, q.accountId)?.zone : null;
  return {
    title: 'Quotation', docNo: q.quoteId, customer: q.snapshot.customerName,
    subtitle: `${i.channel.label}${zone ? ` · ${zone}` : ''}`,
    version: q.snapshot.boardVersion, effective: pub ? fmtDate(pub.publishedAt) : '—',
    issued: fmtDateTime(q.sentAt), validUntil: fmtDate(q.validUntil), issuedBy: userName(s, q.sentBy),
    vatRate: i.vatRate, ref: (q.snapshotHash || '').slice(0, 8),
    rows: [{ label: i.sku.label, contentKg: i.sku.contentKg, netPerKg: o.netPerKg, grossPerCyl: o.grossPerCyl, qty: o.quantity, total: o.grossTotal }],
    total: o.grossTotal,
  };
}

// Printing or saving a customer price list is an outbound price, so it is gated and logged like a quote.
async function issueList(user, mode) {
  const s = store.get();
  const { account, channelId } = context(s, user);
  if (!channelId) return;
  if (boardIsStale(s)) return toast('Price list is out of date — republish before printing', 'bad');
  const single = ui.skuId !== ALL;
  const lines = single
    ? [priceFor(s, { accountId: account?.id ?? null, channelId, skuId: ui.skuId, quantity: ui.qty })].filter(p => !p.error)
    : linesFor(s, account, channelId);
  const ok = lines.filter(p => !lineStatus(s, p) && p.result.quantity > 0);
  if (!ok.length) return toast('No approved prices to issue', 'bad');

  const doc = listDoc(s, user, account, channelId, ok, single);
  const { event } = await store.commit({
    action: 'PRICE_LIST_ISSUED', entity: 'priceList', entityId: account?.id ?? `walkin:${channelId}`, field: 'grossPerCyl',
    after: { mode, accountId: account?.id ?? null, channelId, count: ok.length,
      lines: ok.map(p => ({ skuId: p.sku.id, grossPerCyl: p.result.grossPerCyl, qty: single ? p.result.quantity : null })) },
    hashOf: doc,
  });
  doc.ref = event.snapshotHash.slice(0, 8);
  if (mode === 'print') await printDoc(doc);
  else { await savePdf(doc, `MGC-price-list-${slug(doc.customer)}-v${doc.version}.pdf`); toast('Price list saved'); }
}

// ---------------- Past quotes ----------------

function pastQuotes(s, user) {
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
  const requests = reqs.length ? `<h2>Price requests</h2><div class="table-wrap"><table><tbody>
    ${reqs.map(r => `<tr><td>${esc(r.accountId ? byId(s.accounts, r.accountId)?.name ?? r.accountId : 'Walk-in, ' + channelLabel(s, r.channelId))}<br>
      <span class="small muted">${esc(skuLabel(s, r.skuId))} to ${fmt(r.targetGrossPerCyl)}</span>
      ${r.decisionReason ? `<br><span class="small">Decision: ${esc(r.decisionReason)}</span>` : ''}</td>
      <td><span class="pill ${r.status === 'approved' ? 'green' : r.status === 'declined' ? 'red' : 'amber'}">${esc(r.status[0].toUpperCase() + r.status.slice(1))}</span></td></tr>`).join('')}
    </tbody></table></div>` : '';
  return quotes + requests;
}

function sentPanel(s, q) {
  const valid = new Date(q.validUntil) >= new Date();
  return `<div class="card">
    <div class="row"><div class="grow"><b>${esc(q.snapshot.customerName)}</b><div class="small muted">${esc(q.quoteId)} · sent ${fmtDateTime(q.sentAt)}</div></div>
      <span class="pill ${valid ? 'green' : 'grey'}">${valid ? 'Valid' : 'Expired'}</span></div>
    <img id="q-doc" class="doc-preview" alt="Quotation for ${esc(q.snapshot.customerName)}">
    <div class="row" style="margin-top:10px">
      <button type="button" id="q-doc-print" class="grow">Print</button>
      <button type="button" id="q-doc-save" class="primary grow">Save PDF</button>
      <button type="button" id="q-close" class="grow">Close</button>
    </div></div>`;
}

// ---------------- Behaviour ----------------

function bind(root, ctx) {
  const { user } = ctx;
  const rerender = () => render(root, { ...ctx, state: store.get() });
  const $ = id => root.querySelector('#' + id);
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; ui.openQuoteId = null; rerender(); });
  root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { ui.openQuoteId = b.dataset.open; rerender(); });
  if ($('q-close')) $('q-close').onclick = () => { ui.openQuoteId = null; rerender(); };
  const openQuote = () => store.get().quotes.find(x => x.quoteId === ui.openQuoteId);
  if ($('q-doc-print')) $('q-doc-print').onclick = () => printDoc(quoteDoc(store.get(), openQuote()));
  if ($('q-doc-save')) $('q-doc-save').onclick = () => savePdf(quoteDoc(store.get(), openQuote()), `MGC-quotation-${ui.openQuoteId}.pdf`);

  if ($('q-walkin')) $('q-walkin').onchange = e => { ui.walkIn = e.target.checked; ui.skuId = ALL; rerender(); };
  if ($('q-channel')) $('q-channel').onchange = e => { ui.channelId = e.target.value; ui.skuId = ALL; rerender(); };
  // Typing updates only the results list, never the input being typed into.
  const bindResults = () => root.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => { ui.accountId = b.dataset.acc; ui.query = ''; ui.skuId = ALL; rerender(); });
  bindResults();
  if ($('q-query')) $('q-query').oninput = e => { ui.query = e.target.value; $('q-results').innerHTML = typeaheadResults(store.get(), user); bindResults(); };
  if ($('q-clear')) $('q-clear').onclick = () => { ui.accountId = null; ui.skuId = ALL; rerender(); };
  if ($('q-sku')) $('q-sku').onchange = e => { ui.skuId = e.target.value || ALL; rerender(); };
  if ($('q-qty')) $('q-qty').oninput = e => { ui.qty = Math.max(0, parseInt(e.target.value, 10) || 0); $('q-result').innerHTML = resultHtml(store.get(), user); bindResult(root, user, rerender); };
  bindResult(root, user, rerender);
}

function bindResult(root, user, rerender) {
  const $ = id => root.querySelector('#' + id);
  root.querySelectorAll('[data-sku]').forEach(b => b.onclick = () => { ui.skuId = b.dataset.sku; rerender(); });
  if ($('q-send')) $('q-send').onclick = () => sendQuote(user).then(rerender);
  if ($('q-lower')) $('q-lower').onclick = () => requestLower(store.get(), user);
  if ($('q-print')) $('q-print').onclick = () => issueList(user, 'print');
  if ($('q-savelist')) $('q-savelist').onclick = () => issueList(user, 'save');
}

async function sendQuote(user) {
  const s = store.get();
  const { account, channelId } = context(s, user);
  const p = priceFor(s, { accountId: account?.id ?? null, channelId, skuId: ui.skuId, quantity: ui.qty });
  if (p.error) return;
  // Re-check every gate at the moment of sending.
  if (boardIsStale(s)) return toast('Price list is out of date — republish before sending', 'bad');
  if (pendingRequest(s, p.lineKey, p.sku.id)) return toast('A price request is pending for this line', 'bad');
  if (p.result.belowFloor && !p.exception) return toast('This price needs manager approval first', 'bad');

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
  const after = store.get();
  await savePdf(quoteDoc(after, after.quotes.find(q => q.quoteId === quoteId)), `MGC-quotation-${quoteId}.pdf`);
  toast('Quote sent');
}

function requestLower(s, user) {
  const { account, channelId } = context(s, user);
  const p = priceFor(s, { accountId: account?.id ?? null, channelId, skuId: ui.skuId, quantity: ui.qty });
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
      ${readings.length ? '' : '<p class="small muted">Ask a messenger to capture a reading in Competitor price watch first.</p>'}
      <div id="rl-err" class="err" role="alert"></div>
      <div class="row"><button type="button" id="rl-submit" class="primary grow">Submit request</button><button type="button" id="rl-cancel" class="grow">Cancel</button></div>
    </div>`);

  dlg.querySelector('#rl-cancel').onclick = () => dlg.close();
  dlg.querySelector('#rl-submit').onclick = async () => {
    const err = dlg.querySelector('#rl-err');
    const target = toCentavos(dlg.querySelector('#rl-target').value);
    const reason = dlg.querySelector('#rl-reason').value.trim();
    const readingId = dlg.querySelector('#rl-reading').value;
    if (!target || target <= 0) return (err.textContent = 'Enter a target price, for example 1250.00');
    if (target >= p.result.grossPerCyl) return (err.textContent = `Target must be below the current ${fmt(p.result.grossPerCyl)}`);
    if (!reason) return (err.textContent = 'Write the reason for the request');
    if (!readingId) return (err.textContent = 'Select a competitor reading — a request cannot be submitted without one');

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
    toast('Request sent to the Price room');
  };
}
