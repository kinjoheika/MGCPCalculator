// The price list, one page per channel. The product table is the published price list. Below it, the client prices:
// compare with one or two earlier versions, flag a client price (which opens a Price request for it), and approve the channel's list.

import * as store from '../store.js';
import { fmt } from '../money.js';
import { esc, toast, stamp } from '../ui.js';
import { printDoc, savePdf, slug } from '../pricedoc.js';
import { byId, boardPrices, currentPublication, boardIsStale, userChannels, fmtDate, fmtDateTime, userName, clientSkus, clientPriceSnapshot } from '../pricing.js';

const ui = { cmpA: null, cmpB: null };
let rootRef = null;
let ctxRef = null;
const redraw = () => { if (rootRef && ctxRef) render(rootRef, ctxRef); };

export function render(root, ctx) {
  rootRef = root;
  ctxRef = ctx;
  const { state: s, user, route } = ctx;
  const channelId = route.args[0];
  if (!channelId) { root.innerHTML = index(s, user); return; }

  const channel = byId(s.channels, channelId);
  if (!channel) { root.innerHTML = `<section class="page narrow"><h1>No such price list</h1><p><a href="#/board">All price lists</a></p></section>`; return; }

  const pub = currentPublication(s);
  const askedVersion = route.query.v ? parseInt(route.query.v, 10) : pub.version;
  const shownPub = s.publications.find(p => p.version === askedVersion) || pub;
  const superseded = shownPub.version < pub.version;
  // The list is shown as it was stored at publish. The live calculation is only a fallback for a version with no stored prices.
  const rows = shownPub.prices?.[channelId] ?? (superseded ? null : boardPrices(s, channelId));
  const canWork = !superseded && userChannels(s, user).includes(channelId);

  root.innerHTML = `<section class="page" style="max-width:960px">
    ${superseded ? `<div class="banner amber">This is price list v${shownPub.version}, superseded. <a href="#/board/${esc(channelId)}">Open the current price list (v${pub.version})</a></div>` : ''}
    ${!superseded && boardIsStale(s) ? '<div class="banner red">Cost basis has changed since this price list was published — republish before quoting.</div>' : ''}
    <div class="board-head">
      <div><div class="muted">${esc(channel.audience)} price list</div><h1 style="margin:2px 0 0">${esc(channel.label)}</h1></div>
      ${stamp(shownPub.version, fmtDate(shownPub.publishedAt), { size: 'lg', note: superseded ? 'Superseded' : '' })}
    </div>
    <hr class="hr">
    ${rows ? `<div class="table-wrap"><table>
      <tbody>${rows.map(r => `<tr><td><b>${esc(r.label)}</b><br><span class="small muted">${r.contentKg} kg</span></td>
        <td class="num">${fmt(r.netPerKg)}</td><td class="num"><b>${fmt(r.grossPerCyl)}</b></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">Prices for this version were not captured in the prototype seed.</p>'}


    ${clientSection(s, channel, shownPub, pub, superseded, canWork)}
  </section>`;

  const $ = id => root.querySelector('#' + id);
  if ($('b-print')) $('b-print').onclick = () => printDoc(boardDoc(s, user, channel, pub, rows));
  if ($('b-save')) $('b-save').onclick = async () => {
    await savePdf(boardDoc(s, user, channel, pub, rows), `MGC-price-list-${slug(channel.label)}-v${pub.version}.pdf`);
    toast('Price list saved');
  };

  root.querySelectorAll('[data-cmp]').forEach(sel => sel.onchange = () => {
    if (sel.dataset.cmp === 'a') ui.cmpA = sel.value ? +sel.value : null;
    else ui.cmpB = sel.value ? +sel.value : null;
    redraw();
  });
  if ($('approve-channel')) $('approve-channel').onclick = () => approveChannel(shownPub.version, channelId);
}

function index(s, user) {
  const pub = currentPublication(s);
  const mine = s.channels.filter(c => userChannels(s, user).includes(c.id));
  return `<section class="page narrow"><div class="page-head"><h1>Price lists</h1>${stamp(pub.version, fmtDate(pub.publishedAt))}</div>
    <ul class="stack" style="list-style:none;padding:0">${mine.map(c => `<li><a class="btn" style="width:100%;justify-content:space-between" href="#/board/${esc(c.id)}">
      <span>${esc(c.label)}</span><span class="muted small">${esc(c.audience)}</span></a></li>`).join('')}</ul></section>`;
}

// ---------------- Client prices ----------------

// The price of each client product in a version. The current version falls back to the live calculation when it has no snapshot.
function pricesIn(v) {
  return v.clientPrices ?? null;
}

function clientSection(s, channel, shownPub, pub, superseded, canWork) {
  const versions = [...s.publications].filter(v => v.version !== shownPub.version).sort((a, b) => b.version - a.version);
  const accounts = s.accounts.filter(a => a.channelId === channel.id).sort((a, b) => a.name.localeCompare(b.name));
  const shownPrices = pricesIn(shownPub) ?? (shownPub.version === pub.version ? clientPriceSnapshot(s) : null);
  // Default comparison: the version before this one.
  const defaultA = versions.find(v => v.version < shownPub.version)?.version ?? null;
  const cmpA = ui.cmpA ?? defaultA;
  const cmpB = ui.cmpB;
  const verA = cmpA != null ? s.publications.find(v => v.version === cmpA) : null;
  const verB = cmpB != null ? s.publications.find(v => v.version === cmpB) : null;
  const pricesA = verA ? pricesIn(verA) : null;
  const pricesB = verB ? pricesIn(verB) : null;
  const approval = shownPub.channelApprovals?.[channel.id];
  const verOpts = (sel, label) => `<option value="">${label}</option>` + versions.map(v => `<option value="${v.version}"${v.version === sel ? ' selected' : ''}>v${v.version}</option>`).join('');

  // One row per client product. Flag opens a Price request for that client and product.
  const rowsHtml = accounts.flatMap(a => clientSkus(s, a).map(k => {
    const cur = shownPrices?.[a.id]?.[k.id];
    const pa = pricesA?.[a.id]?.[k.id];
    const pb = pricesB?.[a.id]?.[k.id];
    const change = cur != null && pa != null ? cur - pa : null;
    return `<tr>
      <td><b>${esc(a.name)}</b></td><td>${esc(k.label)}</td>
      <td class="num">${cur == null ? '<span class="muted">—</span>' : `<b>${fmt(cur)}</b>`}</td>
      ${cmpA != null ? `<td class="num">${pa == null ? '<span class="muted">—</span>' : fmt(pa)}</td>` : ''}
      ${cmpB != null ? `<td class="num">${pb == null ? '<span class="muted">—</span>' : fmt(pb)}</td>` : ''}
      ${cmpA != null ? `<td class="num">${change == null || change === 0 ? '' : `<span class="${change > 0 ? 'neg' : 'pos'}">${change > 0 ? '+' : '−'}${fmt(Math.abs(change))}</span>`}</td>` : ''}
      <td>${canWork ? `<a class="btn small" href="#/request?client=${esc(a.id)}&sku=${esc(k.id)}">Flag</a>` : ''}</td>
    </tr>`;
  })).join('');

  const approvalHtml = approval
    ? `<span class="pill green">Approved by ${esc(userName(s, approval.userId))} · ${fmtDateTime(approval.at)}</span>`
    : (canWork && !superseded ? `<button type="button" id="approve-channel" class="primary">Approve ${esc(channel.label)} price list</button>` : '<span class="muted small">Not approved yet</span>');

  // Approval, print and save sit together, visible to everyone who can see this price list, whether or not the version has client prices.
  const actionsHtml = `<div class="row no-print" style="margin:16px 0 10px">
      ${approvalHtml}
      <button type="button" id="b-print">Print</button>
      <button type="button" id="b-save">Save</button>
    </div>`;

  return `${actionsHtml}
    <h2 class="sub-h">Client prices</h2>
    ${shownPrices == null ? '<p class="muted">Client prices were not captured for this version.</p>' : `
    <div class="row no-print" style="margin-bottom:8px">
      <label class="small">Compare with <select data-cmp="a">${verOpts(cmpA, 'None')}</select></label>
      <label class="small">and <select data-cmp="b">${verOpts(cmpB, 'None')}</select></label>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Client</th><th>Product</th><th class="num">v${shownPub.version}</th>${cmpA != null ? `<th class="num">v${cmpA}</th>` : ''}${cmpB != null ? `<th class="num">v${cmpB}</th>` : ''}${cmpA != null ? '<th class="num">Change</th>' : ''}<th></th></tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="7" class="muted">No clients on this channel.</td></tr>'}</tbody>
    </table></div>`}`;
}

// ---------------- Actions ----------------

async function approveChannel(version, channelId) {
  const me = store.currentUser();
  if (!userChannels(store.get(), me).includes(channelId)) { toast('Your access does not include this price list', 'bad'); return; }
  await store.commit({
    action: 'CHANNEL_APPROVED', entity: 'publication', entityId: `board_v${version}`, field: channelId,
    after: { version, channelId, approvedBy: me.id },
  }, (d, ev) => {
    const p = d.publications.find(x => x.version === version);
    (p.channelApprovals ||= {})[channelId] = { userId: me.id, at: ev.timestamp };
  });
  toast('Price list approved');
  redraw();
}

function boardDoc(s, user, channel, pub, rows) {
  return {
    title: 'Price list', docNo: `Price list v${pub.version} · ${channel.id}`,
    customer: channel.label, subtitle: `${channel.audience} price list`,
    version: pub.version, effective: fmtDate(pub.publishedAt), issued: fmtDateTime(new Date()), validUntil: null,
    issuedBy: user.name, ref: (pub.snapshotHash || '').slice(0, 8),
    rows: rows.map(r => ({ label: r.label, contentKg: r.contentKg, netPerKg: r.netPerKg, grossPerCyl: r.grossPerCyl })),
    total: null,
  };
}
