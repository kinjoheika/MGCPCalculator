// The Board — one page per channel audience. Only that channel's SKUs and prices.

import * as store from '../store.js';
import { fmt } from '../money.js';
import { esc, toast, download } from '../ui.js';
import { byId, boardPrices, currentPublication, boardIsStale, userChannels, fmtDate, fmtDateTime } from '../pricing.js';

export function render(root, ctx) {
  const { state: s, user, route } = ctx;
  const channelId = route.args[0];
  if (!channelId) { root.innerHTML = index(s, user); return; }

  const channel = byId(s.channels, channelId);
  if (!channel) { root.innerHTML = `<section class="page narrow"><h1>No such board</h1><p><a href="#/board">All boards</a></p></section>`; return; }

  const pub = currentPublication(s);
  const askedVersion = route.query.v ? parseInt(route.query.v, 10) : pub.version;
  const shownPub = s.publications.find(p => p.version === askedVersion) || pub;
  const superseded = shownPub.version < pub.version;
  const rows = superseded ? shownPub.prices?.[channelId] ?? null : boardPrices(s, channelId);
  const ack = s.acknowledgments.find(a => a.userId === user.id && a.boardVersion === pub.version && a.channelId === channelId);

  root.innerHTML = `<section class="page" style="max-width:760px">
    ${superseded ? `<div class="banner amber">This is board v${shownPub.version}, superseded. <a href="#/board/${esc(channelId)}">Open the current board (v${pub.version})</a></div>` : ''}
    ${!superseded && boardIsStale(s) ? '<div class="banner red">Cost basis has changed since this board was published — republish before quoting.</div>' : ''}
    <div class="board-head">
      <div><div class="muted">${esc(channel.audience)} board</div><h1 style="margin:2px 0 0">${esc(channel.label)}</h1></div>
      <div style="text-align:right"><div class="version">v${shownPub.version}</div><div class="muted">Effective ${fmtDate(shownPub.publishedAt)}</div></div>
    </div>
    <hr class="hr">
    ${rows ? `<div class="table-wrap"><table>
      <thead><tr><th>Product</th><th class="num">Per kg, net</th><th class="num">Per cylinder, net</th><th class="num">Per cylinder, VAT incl.</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td><b>${esc(r.label)}</b><br><span class="small muted">${r.contentKg} kg</span></td>
        <td class="num">${fmt(r.netPerKg)}</td><td class="num">${fmt(r.netPerCyl)}</td><td class="num"><b>${fmt(r.grossPerCyl)}</b></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">Prices for this version were not captured in the prototype seed.</p>'}
    ${superseded ? '' : `<div class="row no-print" style="margin-top:16px">
      ${ack ? `<span class="pill green">Acknowledged ${esc(fmtDateTime(ack.acknowledgedAt))}</span>`
        : '<button type="button" id="b-ack" class="primary">Acknowledge board</button>'}
      <button type="button" id="b-img">Export image</button></div>`}
  </section>`;

  const ackBtn = root.querySelector('#b-ack');
  if (ackBtn) ackBtn.onclick = async () => {
    await store.commit({
      action: 'BOARD_ACKNOWLEDGED', entity: 'board', entityId: channelId, field: 'boardVersion', after: { boardVersion: pub.version, channelId },
    }, (d, ev) => { d.acknowledgments.push({ userId: user.id, boardVersion: pub.version, channelId, acknowledgedAt: ev.timestamp }); });
    toast('Acknowledged');
  };
  const imgBtn = root.querySelector('#b-img');
  if (imgBtn) imgBtn.onclick = () => exportImage(channel, pub, rows);
}

function index(s, user) {
  const pub = currentPublication(s);
  const mine = s.channels.filter(c => userChannels(s, user).includes(c.id));
  return `<section class="page narrow"><h1>Boards</h1><p class="muted">Current version v${pub.version}, effective ${fmtDate(pub.publishedAt)}</p>
    <ul class="stack" style="list-style:none;padding:0">${mine.map(c => `<li><a class="btn" style="width:100%;justify-content:space-between" href="#/board/${esc(c.id)}">
      <span>${esc(c.label)}</span><span class="muted small">${esc(c.audience)}</span></a></li>`).join('')}</ul></section>`;
}

function exportImage(channel, pub, rows) {
  const scale = 2, W = 900, rowH = 44, top = 170;
  const H = top + rows.length * rowH + 80;
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#141414';
  g.font = '600 16px system-ui, sans-serif'; g.fillText(`${channel.audience} board`, 32, 44);
  g.font = '700 30px system-ui, sans-serif'; g.fillText(channel.label, 32, 82);
  g.textAlign = 'right';
  g.font = '700 44px system-ui, sans-serif'; g.fillText(`v${pub.version}`, W - 32, 76);
  g.font = '15px system-ui, sans-serif'; g.fillText(`Effective ${fmtDate(pub.publishedAt)}`, W - 32, 100);
  g.textAlign = 'left';
  g.fillStyle = '#5f5f5a'; g.font = '600 13px system-ui, sans-serif';
  const cols = [[32, 'Product', 'left'], [470, 'Per kg, net', 'right'], [680, 'Per cyl, net', 'right'], [W - 32, 'Per cyl, VAT incl.', 'right']];
  cols.forEach(([x, t, a]) => { g.textAlign = a; g.fillText(t, x, top - 16); });
  g.fillStyle = '#e3e3df'; g.fillRect(32, top - 8, W - 64, 1);
  rows.forEach((r, i) => {
    const y = top + i * rowH + 26;
    g.fillStyle = '#141414';
    g.textAlign = 'left'; g.font = '600 16px system-ui, sans-serif'; g.fillText(r.label, 32, y);
    g.font = '16px ui-monospace, Consolas, monospace';
    g.textAlign = 'right'; g.fillText(fmt(r.netPerKg), 470, y); g.fillText(fmt(r.netPerCyl), 680, y);
    g.font = '700 17px ui-monospace, Consolas, monospace'; g.fillText(fmt(r.grossPerCyl), W - 32, y);
    g.fillStyle = '#e3e3df'; g.fillRect(32, y + 14, W - 64, 1);
  });
  // Version stamp burned in, so a forwarded image always carries its version.
  g.textAlign = 'left'; g.fillStyle = '#b3261e'; g.font = '600 13px system-ui, sans-serif';
  g.fillText(`MGC board v${pub.version} · ${channel.id} · effective ${fmtDate(pub.publishedAt)} · check the live board before quoting`, 32, H - 30);
  c.toBlob(blob => download(`MGC-board-${channel.id}-v${pub.version}.png`, blob), 'image/png');
}
