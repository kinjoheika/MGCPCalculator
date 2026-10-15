// Notifications: the bell at the top right. It holds the price requests that sales assistants send for one client
// after a major price version went out, with a recommended adjustment for each. Approving one creates a sub-version
// under the major version (v5.1, v5.2 …) that stays in the price history inside that version.

import * as store from './store.js';
import { fmt, toCentavos, toInput, roundHalfUp } from './money.js';
import { esc, toast } from './ui.js';
import {
  byId, channelLabel, skuLabel, userName, fmtDate, fmtDateTime, daysSince, isStaleReading, exceptions, currentPublication,
  recommendRequest, subVersionsOf, subLabel,
} from './pricing.js';
import { canView, canApprove, canSeeApprovals } from './access.js';

const DAY = 86400000;
const st = { open: false, reasons: {}, prices: {}, errors: {}, excAll: false };
let host = null;

const KIND = { below_floor: 'Below floor', contract: 'Contract', trmv: 'TRMV pace', no_reading: 'No reading', competitor_below: 'Competitor lower' };

const BELL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

export function mount(el) {
  host = el;
  document.addEventListener('click', e => { if (st.open && host && !host.contains(e.target) && e.target.isConnected) { st.open = false; render(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.open) { st.open = false; render(); } });
  store.subscribe(() => render());
  render();
}

function requestCard(s, r, canDecide) {
  const reading = s.competitorReadings.find(x => x.id === r.competitorReadingId);
  const subject = r.accountId ? byId(s.accounts, r.accountId)?.name ?? r.accountId : `Walk-in, ${channelLabel(s, r.channelId)}`;
  const rec = recommendRequest(s, r);
  const stale = reading && isStaleReading(s, reading);
  const price = st.prices[r.id] ?? (rec ? toInput(rec.gross) : '');
  const pub = currentPublication(s);
  return `<div class="nf-card">
    <div class="nf-top"><b>${esc(subject)}</b><span class="pill amber">Will be v${pub.version}.${subVersionsOf(s, pub.version).length + 1}</span></div>
    <div class="small muted">${esc(skuLabel(s, r.skuId))} × ${r.qty} · ${esc(userName(s, r.requestedBy))} · ${fmtDateTime(r.requestedAt)}</div>
    <p class="nf-reason">“${esc(r.reason)}”</p>
    <div class="nf-prices"><span>Now <b>${fmt(r.currentGrossPerCyl)}</b></span><span>Client asks <b>${fmt(r.targetGrossPerCyl)}</b></span>
      ${rec ? `<span class="rec">Recommended <b>${fmt(rec.gross)}</b> <small>−${fmt(rec.cur - rec.gross)}/cyl · ${fmt(rec.perKg)}/kg</small></span>` : ''}</div>
    ${rec ? `<p class="small muted nf-why">${esc(rec.why)}</p>` : '<p class="small muted">No recommendation: this product has no price for the client.</p>'}
    ${reading ? `<p class="small ${stale ? 'stale' : ''}">Competitor: ${esc(reading.brand)}, ${esc(reading.zone)} at ${fmt(reading.pricePerCyl)} on ${fmtDate(reading.capturedAt)}${stale ? `, ${daysSince(reading.capturedAt)} days old` : ''}</p>` : ''}
    ${canDecide && rec ? `<div class="nf-act">
      <label class="nf-price"><span>Approve at ₱</span><input type="text" inputmode="decimal" data-price="${esc(r.id)}" value="${esc(price)}" aria-label="Approved price per cylinder"></label>
      <button type="button" class="primary small" data-decide="approved" data-req="${esc(r.id)}">Approve</button>
    </div>
    <label class="field"><span class="small muted">Reason (required to decline)</span><input type="text" data-reason="${esc(r.id)}" value="${esc(st.reasons[r.id] || '')}"></label>
    ${st.errors[r.id] ? `<p class="err" role="alert">${esc(st.errors[r.id])}</p>` : ''}
    <div class="row"><button type="button" class="small" data-decide="declined" data-req="${esc(r.id)}">Decline</button></div>` : ''}
  </div>`;
}

function render() {
  if (!host) return;
  // Do not redraw under someone who is typing a reason or a price.
  if (host.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const s = store.get();
  const user = store.currentUser();
  if (!s || !user || !canSeeApprovals(s, user)) { host.innerHTML = ''; return; }
  const seeReq = canView(s, user, 'appr_requests'), seeRev = canView(s, user, 'appr_review');
  const canDecide = canApprove(s, user, 'appr_requests');
  const pending = seeReq ? s.priceRequests.filter(r => r.status === 'pending').sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1)) : [];
  const rows = seeRev ? exceptions(s).filter(r => r.kind !== 'request') : [];
  const pub = currentPublication(s);
  const recent = seeReq ? subVersionsOf(s, pub.version).slice(-3).reverse() : [];

  let panel = '';
  if (st.open) {
    const order = { red: 0, amber: 1 };
    const sorted = [...rows].sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2));
    const shown = st.excAll ? sorted : sorted.slice(0, 20);
    panel = `<div class="bell-panel" role="dialog" aria-label="Notifications">
      ${seeReq ? `<h3 class="nf-h">${pending.length} price request${pending.length === 1 ? '' : 's'}</h3>
        ${canDecide ? '' : '<p class="small muted">You can see requests but not decide them.</p>'}
        ${pending.length ? pending.map(r => requestCard(s, r, canDecide)).join('') : '<p class="small muted">No requests waiting.</p>'}
        ${recent.length ? `<h3 class="nf-h">Recent sub-versions of v${pub.version}</h3>${recent.map(r => `<div class="nf-line"><b>${subLabel(r)}</b> ${esc(byId(s.accounts, r.accountId)?.name ?? 'Walk-in')} · ${esc(skuLabel(s, r.skuId))} · ${fmt(r.approvedGrossPerCyl ?? r.currentGrossPerCyl)}</div>`).join('')}` : ''}` : ''}
      ${seeRev ? `<details class="nf-rev"><summary>${rows.length} need review</summary>
        ${shown.map(r => `<div class="exc"><span class="pill ${r.severity}">${esc(KIND[r.kind] || r.kind)}</span><div><div class="subject">${esc(r.subject)}</div><div class="small">${esc(r.text)}</div></div></div>`).join('')}
        ${rows.length > 20 ? `<button type="button" class="small" id="nf-all">${st.excAll ? 'Show fewer' : `Show all ${rows.length}`}</button>` : ''}</details>` : ''}
    </div>`;
  }
  host.innerHTML = `<button type="button" id="bell" class="bell" aria-label="Notifications${pending.length ? `, ${pending.length} price requests` : ''}" aria-expanded="${st.open}">${BELL}${pending.length ? `<span class="bell-n">${pending.length}</span>` : ''}</button>${panel}`;

  host.querySelector('#bell').onclick = () => { st.open = !st.open; render(); };
  const all = host.querySelector('#nf-all');
  if (all) all.onclick = () => { st.excAll = !st.excAll; render(); };
  host.querySelectorAll('[data-reason]').forEach(i => i.oninput = () => { st.reasons[i.dataset.reason] = i.value; });
  host.querySelectorAll('[data-price]').forEach(i => i.oninput = () => { st.prices[i.dataset.price] = i.value; });
  host.querySelectorAll('[data-decide]').forEach(b => b.onclick = async () => { await decide(b.dataset.req, b.dataset.decide); render(); });
}

async function decide(id, status) {
  const s = store.get();
  const me = store.currentUser();
  if (!canApprove(s, me, 'appr_requests')) { toast('Your access does not include deciding price requests', 'bad'); return; }
  const r = s.priceRequests.find(x => x.id === id);
  if (!r || r.status !== 'pending') return;
  const reason = (st.reasons[id] || '').trim();
  const rec = recommendRequest(s, r);
  let price = null;
  if (status === 'declined') {
    if (!reason) { st.errors[id] = 'Write the reason for declining'; return; }
  } else {
    if (!rec) { st.errors[id] = 'This product has no price for the client'; return; }
    price = toCentavos(st.prices[id] ?? toInput(rec.gross));
    if (price == null || price >= rec.cur) { st.errors[id] = `Enter a price below the current ${fmt(rec.cur)}`; return; }
    if (price < rec.floorGross) { st.errors[id] = `${fmt(price)} is below the floor ${fmt(rec.floorGross)}`; return; }
  }
  delete st.errors[id];
  const pub = currentPublication(s);
  const subNo = s.priceRequests.filter(x => x.status === 'approved' && x.subOf === pub.version).length + 1;
  const approvedDiscountPerKg = status === 'approved' ? roundHalfUp((rec.cur - price) / (rec.kg * (1 + rec.vat))) : null;
  const validUntil = status === 'approved' ? new Date(Date.now() + (s.settings.quoteValidityDays || 7) * DAY).toISOString() : null;
  const decisionReason = reason || (status === 'approved' ? (price === rec.gross ? 'Approved as recommended' : 'Approved at an adjusted price') : '');
  await store.commit({
    action: 'REQUEST_DECIDED', entity: 'priceRequest', entityId: r.accountId ?? r.lineKey, field: 'status', before: 'pending',
    after: { requestId: id, status, decisionReason, accountId: r.accountId, skuId: r.skuId, approvedDiscountPerKg, ...(status === 'approved' ? { subVersion: `v${pub.version}.${subNo}`, approvedGrossPerCyl: price } : {}) },
  }, (d, ev) => {
    Object.assign(d.priceRequests.find(x => x.id === id), {
      status, decidedBy: ev.actorId, decidedAt: ev.timestamp, decisionReason, approvedDiscountPerKg, validUntil,
      ...(status === 'approved' ? { approvedGrossPerCyl: price, recommendedGrossPerCyl: rec.gross, subOf: pub.version, subNo } : {}),
    });
  });
  delete st.reasons[id];
  delete st.prices[id];
  toast(status === 'approved' ? `Approved as v${pub.version}.${subNo}` : 'Request declined');
}
