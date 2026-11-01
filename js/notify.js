// Notifications: the bell at the top right. For managers it lists the price requests waiting for a decision, and the
// exceptions that need review. Each request opens in the Price requests view, where it is approved or cancelled.

import * as store from './store.js';
import { esc } from './ui.js';
import { byId, channelLabel, skuLabel, userName, fmtDateTime, exceptions, currentPublication, subVersionsOf, subLabel, approvedPrice } from './pricing.js';
import { fmt } from './money.js';
import { canView, canSeeApprovals } from './access.js';
import { isManager } from './price-requests.js';

const st = { open: false, excAll: false };
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

function requestRow(s, r) {
  const subject = r.accountId ? byId(s.accounts, r.accountId)?.name ?? r.accountId : `Walk-in, ${channelLabel(s, r.channelId)}`;
  return `<button type="button" class="nf-line nf-req" data-open-req="${esc(r.id)}">
    <b>${esc(subject)}</b> · ${esc(skuLabel(s, r.skuId))}<br>
    <span class="small muted">${fmt(r.currentGrossPerCyl)} → ${fmt(r.requestedGrossPerCyl)} · ${esc(userName(s, r.requestedBy))} · ${fmtDateTime(r.submittedAt || r.requestedAt)}</span>
  </button>`;
}

function render() {
  if (!host) return;
  // Do not redraw under someone who is typing in the panel.
  if (host.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const s = store.get();
  const user = store.currentUser();
  if (!s || !user || !canSeeApprovals(s, user)) { host.innerHTML = ''; return; }
  const seeReq = isManager(s, user);
  const seeRev = canView(s, user, 'appr_review');
  const waiting = seeReq ? s.priceRequests.filter(r => r.status === 'review').sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)) : [];
  const rows = seeRev ? exceptions(s).filter(r => r.kind !== 'request') : [];
  const pub = currentPublication(s);
  const recent = seeReq ? subVersionsOf(s, pub.version).slice(-3).reverse() : [];

  let panel = '';
  if (st.open) {
    const order = { red: 0, amber: 1 };
    const sorted = [...rows].sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2));
    const shown = st.excAll ? sorted : sorted.slice(0, 20);
    panel = `<div class="bell-panel" role="dialog" aria-label="Notifications">
      ${seeReq ? `<h3 class="nf-h">${waiting.length} price request${waiting.length === 1 ? '' : 's'} waiting</h3>
        ${waiting.length ? waiting.map(r => requestRow(s, r)).join('') : '<p class="small muted">No requests waiting.</p>'}
        ${recent.length ? `<h3 class="nf-h">Recent sub-versions of v${pub.version}</h3>${recent.map(r => `<div class="nf-line"><b>${subLabel(r)}</b> ${esc(byId(s.accounts, r.accountId)?.name ?? 'Walk-in')} · ${esc(skuLabel(s, r.skuId))} · ${fmt(approvedPrice(r))}</div>`).join('')}` : ''}` : ''}
    </div>`;
  }
  host.innerHTML = `<button type="button" id="bell" class="bell" aria-label="Notifications${waiting.length ? `, ${waiting.length} price requests waiting` : ''}" aria-expanded="${st.open}">${BELL}${waiting.length ? `<span class="bell-n">${waiting.length}</span>` : ''}</button>${panel}`;

  host.querySelector('#bell').onclick = () => { st.open = !st.open; render(); };
  const all = host.querySelector('#nf-all');
  if (all) all.onclick = () => { st.excAll = !st.excAll; render(); };
  host.querySelectorAll('[data-open-req]').forEach(b => b.onclick = () => {
    st.open = false;
    location.hash = `#/requests/${b.dataset.openReq}`;
    render();
  });
}
