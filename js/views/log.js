// Log — manager. Four read-only tabs over the one append-only event array.
// There is no "add log entry" control anywhere: events are written only by store.commit().

import { fmt } from '../money.js';
import { esc, options } from '../ui.js';
import { byId, skuLabel, channelLabel, userName, fmtDate, fmtDateTime, currentPublication, allBoardPrices } from '../pricing.js';

const DAY = 86400000;
const ui = { tab: 'week', accountId: null, skuId: '11KG_MGAS' };

const ACTION_LABEL = {
  DRAFT: 'Draft', SIMULATE: 'Simulate', APPROVE: 'Approve', PUBLISH: 'Publish', QUOTE_SENT: 'Quote sent',
  REQUEST_LOWER: 'Price request', REQUEST_DECIDED: 'Request decided', READING_CAPTURED: 'Reading captured',
  BOARD_ACKNOWLEDGED: 'PL notice acknowledged', ACCOUNTS_IMPORTED: 'Clients imported', CONFIG_CHANGED: 'Configuration', PRICE_LIST_ISSUED: 'Price list issued',
};

export function describeEvent(s, ev) {
  const a = ev.after || {};
  switch (ev.action) {
    case 'DRAFT': return `Proposal drafted. Objective: ${ev.objective}. Changes: ${a.cause ?? '—'}`;
    case 'SIMULATE': return `Simulated ${a.cause}. Estimated monthly impact ${fmt(a.monthlyImpact)} (${a.excludedCount} accounts without volume excluded); ${a.newlyBelowFloor} accounts newly below floor. No prices changed.`;
    case 'APPROVE': return `Approved. Instructed by ${userName(s, ev.instructedBy)}, verified by ${userName(s, ev.verifiedBy)}.`;
    case 'PUBLISH': return `Cause: ${a.cause}. Price list v${a.version} published.`;
    case 'QUOTE_SENT': return `${byId(s.accounts, ev.entityId)?.name ?? ev.entityId}: ${skuLabel(s, a.skuId)} × ${a.qty} quoted at ${fmt(a.grossPerCyl)}/cyl (${fmt(a.grossTotal)})`;
    case 'REQUEST_LOWER': return `${byId(s.accounts, ev.entityId)?.name ?? ev.entityId}: lower price requested, ${fmt(ev.before)} → ${fmt(ev.after)}/cyl`;
    case 'REQUEST_DECIDED': return `${byId(s.accounts, a.accountId)?.name ?? 'Walk-in'}: request ${a.status}. Reason: ${a.decisionReason}`;
    case 'READING_CAPTURED': {
      const r = s.competitorReadings.find(x => x.id === ev.entityId);
      return r ? `${r.brand}, ${r.zone}, ${skuLabel(s, r.skuId)}: ${fmt(ev.after)}${ev.before != null ? ` (previous ${fmt(ev.before)})` : ''}` : `Reading ${fmt(ev.after)}`;
    }
    case 'BOARD_ACKNOWLEDGED': return `${channelLabel(s, a.channelId)} price list v${a.boardVersion} acknowledged`;
    case 'ACCOUNTS_IMPORTED': return `Clients imported from ${a.file}: ${a.added} added, ${a.updated} updated${a.removed ? `, ${a.removed} removed (replace)` : ''}, ${a.skipped} rows skipped`;
    case 'CONFIG_CHANGED': return `Users changed — ${a.summary}`;
    case 'PRICE_LIST_ISSUED': return `${byId(s.accounts, a.accountId)?.name ?? 'Walk-in'}: price list ${a.mode === 'print' ? 'printed' : 'saved as PDF'} — ${(a.lines || []).map(l => `${skuLabel(s, l.skuId)} ${fmt(l.grossPerCyl)}${l.qty ? ` × ${l.qty}` : ''}`).join(', ')}`;
    default: return ev.action;
  }
}

export function eventTouchesAccount(ev, accountId) {
  return ev.entityId === accountId || ev.after?.accountId === accountId || (ev.after?.accountIds || []).includes(accountId);
}

function eventItem(s, ev, { showActor = true } = {}) {
  const review = ev.action === 'PUBLISH' && ev.after?.review?.length
    ? `<ul class="small">${ev.after.review.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
  return `<li><div class="small muted">${fmtDateTime(ev.timestamp)} · <b>${esc(ACTION_LABEL[ev.action])}</b>${showActor ? ` · ${esc(userName(s, ev.actorId))}` : ''}${ev.snapshotHash ? ` · hash <code>${esc(ev.snapshotHash.slice(0, 8))}</code>` : ''}</div>
    <div>${esc(describeEvent(s, ev))}</div>${review}</li>`;
}

export function render(root, { state: s }) {
  const tabs = [['week', 'Issues'], ['actor', 'Users'], ['account', 'Account history'], ['sku', 'SKU across channels']];
  let body = '';
  const events = [...s.events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  if (ui.tab === 'week') {
    const since = Date.now() - 7 * DAY;
    const week = events.filter(e => new Date(e.timestamp).getTime() >= since);
    const groups = new Map();
    for (const e of week) {
      const k = e.proposalId || `single_${e.id}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    body = week.length ? [...groups.entries()].map(([k, evs]) => {
      if (!k.startsWith('single_')) {
        const first = evs[evs.length - 1];
        const pub = evs.find(e => e.action === 'PUBLISH');
        const cause = pub?.after?.cause ?? evs.find(e => e.after?.cause)?.after?.cause ?? '—';
        return `<div class="card" style="margin-bottom:12px"><div><b>Cause: ${esc(cause)}</b></div>
          <div class="small muted">Proposal ${esc(k.slice(-8))} · objective: ${esc(first.objective ?? '—')} · ${pub ? `published as v${pub.after.version}` : 'not published'}</div>
          <ul class="timeline" style="margin-top:10px">${evs.map(e => eventItem(s, e)).join('')}</ul></div>`;
      }
      return `<ul class="timeline" style="margin:0 0 12px 4px">${eventItem(s, evs[0])}</ul>`;
    }).join('') : '<p class="muted">Nothing logged in the last 7 days.</p>';
  }

  if (ui.tab === 'actor') {
    const byActor = new Map();
    for (const e of events) {
      if (!byActor.has(e.actorId)) byActor.set(e.actorId, []);
      byActor.get(e.actorId).push(e);
    }
    body = byActor.size ? [...byActor.entries()].map(([actor, evs]) => `<details class="card" style="margin-bottom:10px">
      <summary>${esc(userName(s, actor))} <span class="muted small" style="margin-left:8px">${esc(byId(s.users, actor)?.role ?? '')} · ${evs.length} events</span></summary>
      <ul class="timeline">${evs.map(e => eventItem(s, e, { showActor: false })).join('')}</ul></details>`).join('')
      : '<p class="muted">No events yet.</p>';
  }

  if (ui.tab === 'account') {
    if (!ui.accountId) ui.accountId = s.accounts[0]?.id;
    const acc = byId(s.accounts, ui.accountId);
    const evs = events.filter(e => eventTouchesAccount(e, ui.accountId));
    body = `<label class="field" style="max-width:420px"><span>Account</span><select id="l-acc">${options(s.accounts, ui.accountId, { label: a => `${a.name} (${a.status})` })}</select></label>
      <p class="small muted">${esc(acc?.name)} · ${esc(channelLabel(s, acc?.channelId))} · ${esc(acc?.zone)}</p>
      ${evs.length ? `<ul class="timeline" style="margin-top:12px">${evs.map(e => eventItem(s, e)).join('')}</ul>` : '<p class="muted">No events for this account yet.</p>'}`;
  }

  if (ui.tab === 'sku') {
    const versions = [...s.publications].sort((a, b) => b.version - a.version);
    const rules = s.marginRules.filter(r => r.skuId === ui.skuId).sort((a, b) => (a.channelId + a.effectiveFrom < b.channelId + b.effectiveFrom ? -1 : 1));
    const cbs = [...s.costBasis].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
    body = `<label class="field" style="max-width:420px"><span>Product</span><select id="l-sku">${options(s.skus, ui.skuId)}</select></label>
      <h2>Published prices, per cylinder VAT incl.</h2>
      <div class="table-wrap"><table><thead><tr><th>Version</th>${s.channels.map(c => `<th class="num">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
      ${versions.map(p => `<tr><td class="nowrap">v${p.version}<br><span class="small muted">${fmtDate(p.publishedAt)}</span></td>
        ${s.channels.map(c => { const prices = p.prices ?? (p.version === currentPublication(s).version ? allBoardPrices(s) : null); const r = prices?.[c.id]?.find(x => x.skuId === ui.skuId); return `<td class="num">${r ? fmt(r.grossPerCyl) : '<span class="muted">—</span>'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>
      <h2>Margin versions</h2>
      <div class="table-wrap"><table><thead><tr><th>Channel</th><th class="num">Margin/kg</th><th>From</th><th>To</th></tr></thead><tbody>
      ${rules.map(r => `<tr class="${r.effectiveTo ? 'stale' : ''}"><td>${esc(channelLabel(s, r.channelId))}</td><td class="num">${fmt(r.perKg)}</td><td>${fmtDateTime(r.effectiveFrom)}</td><td>${r.effectiveTo ? fmtDateTime(r.effectiveTo) : '<span class="pill green">Current</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Not priced on any channel.</td></tr>'}
      </tbody></table></div>
      <h2>Cost basis versions</h2>
      <div class="table-wrap"><table><thead><tr><th class="num">Acquisition</th><th class="num">Hauling</th><th>From</th><th>To</th></tr></thead><tbody>
      ${cbs.map(c => `<tr class="${c.effectiveTo ? 'stale' : ''}"><td class="num">${fmt(c.acqPerKg)}</td><td class="num">${fmt(c.haulingPerKg)}</td><td>${fmtDateTime(c.effectiveFrom)}</td><td>${c.effectiveTo ? fmtDateTime(c.effectiveTo) : '<span class="pill green">Current</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  root.innerHTML = `<section class="page wide"><h1>Log</h1>
    <p class="muted small">${s.events.length} events. Append-only — written by the same action that made the change.</p>
    <div class="tabs">${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
    ${body}</section>`;

  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; render(root, { state: s }); });
  const acc = root.querySelector('#l-acc');
  if (acc) acc.onchange = e => { ui.accountId = e.target.value; render(root, { state: s }); };
  const sku = root.querySelector('#l-sku');
  if (sku) sku.onchange = e => { ui.skuId = e.target.value; render(root, { state: s }); };
}
