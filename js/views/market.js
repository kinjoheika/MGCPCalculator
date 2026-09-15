// Market Watch — messenger. Four fields plus a required photo. No MGC prices anywhere on this screen.

import * as store from '../store.js';
import { fmt, toCentavos } from '../money.js';
import { esc, toast, options, preserveFocus } from '../ui.js';
import { newestReading, isStaleReading, daysSince, fmtDate, userName } from '../pricing.js';

const LAST_ZONE = 'mgc_pricing_v1_last_zone';
const ui = { dueOpen: true, recentOpen: false, brand: '', brandOther: '', zone: null, skuId: '11KG_MGAS', price: '', photoUrl: null, photoName: '', noCamera: false, error: '', outlier: null };

function lastZone() {
  try { return localStorage.getItem(LAST_ZONE); } catch { return null; }
}

export function render(root, ctx) {
  preserveFocus(root, () => { root.innerHTML = view(ctx); });
  bind(root, ctx);
}

function brands(s) {
  return [...new Set([...(s.trackedBrands || []), ...s.competitorReadings.map(r => r.brand)])].sort();
}

function view({ state: s, user }) {
  if (!ui.zone) ui.zone = lastZone() || s.zones[0];
  const now = new Date();
  const today = now.toDateString();
  const todayCount = s.competitorReadings.filter(r => r.capturedBy === user.id && new Date(r.capturedAt).toDateString() === today).length;

  const due = [];
  for (const brand of s.trackedBrands || []) for (const zone of s.zones) {
    const r = newestReading(s, { zone, brand });
    if (!r || isStaleReading(s, r, now)) due.push({ brand, zone, r });
  }

  const recent = [...s.competitorReadings].sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1)).slice(0, 12);
  const brandList = brands(s);
  const skuList = s.skus.filter(k => k.active);

  return `<section class="page narrow">
    <div class="page-head"><div><div class="eyebrow">Field</div><h1>Competitor price watch</h1></div></div>
    <p class="muted small">One reading per brand, zone and product each week.</p>
    <div class="stack">
      <label class="field"><span>Brand</span>
        <select id="m-brand">${options(brandList.map(b => ({ id: b, label: b })), ui.brand, { placeholder: 'Choose brand' })}<option value="__other"${ui.brand === '__other' ? ' selected' : ''}>Other (type it)</option></select></label>
      ${ui.brand === '__other' ? `<label class="field"><span>Brand name</span><input id="m-brand-other" type="text" value="${esc(ui.brandOther)}"></label>` : ''}
      <label class="field"><span>Zone</span><select id="m-zone">${options(s.zones.map(z => ({ id: z, label: z })), ui.zone)}</select></label>
      <label class="field"><span>Product</span><select id="m-sku">${options(skuList, ui.skuId)}</select></label>
      <label class="field"><span>Price per cylinder (₱)</span><input id="m-price" type="text" inputmode="decimal" placeholder="e.g. 1055.00" value="${esc(ui.price)}"></label>
      <div class="field"><span class="muted small">Photo of the price (required)</span>
        ${ui.noCamera
          ? `<input id="m-photo-name" type="text" placeholder="Photo filename, e.g. IMG_2031.jpg" value="${esc(ui.photoName)}">`
          : `<input id="m-photo" type="file" accept="image/*" capture="environment">${ui.photoUrl ? `<p class="small">Attached: ${esc(ui.photoName)}</p>` : ''}`}
        <label class="toggle small"><input id="m-nocam" type="checkbox" ${ui.noCamera ? 'checked' : ''}> No camera — enter a filename instead</label>
      </div>
      ${ui.outlier ? `<div class="banner amber" role="alert">${esc(ui.outlier.message)}
          <div class="row" style="margin-top:8px"><button type="button" id="m-confirm" class="primary">Yes, submit reading</button><button type="button" id="m-fix">Fix the price</button></div></div>` : ''}
      ${ui.error ? `<div class="err" role="alert">${esc(ui.error)}</div>` : ''}
      <button type="button" id="m-submit" class="primary" ${ui.outlier ? 'disabled' : ''}>Submit reading</button>
    </div>

    <div class="panel" style="margin-top:20px"><b>Today: ${todayCount} submitted</b></div>

    <details class="collapse" id="m-due" ${ui.dueOpen ? 'open' : ''}><summary>Still due this week (${due.length})</summary>
    ${due.length ? `<ul class="stack" style="list-style:none;padding:0;margin:0 0 12px">${due.map(d => `<li class="row"><span aria-hidden="true">☐</span>
      <span class="grow">${esc(d.brand)} · ${esc(d.zone)}</span>
      <span class="small muted">${d.r ? `last ${daysSince(d.r.capturedAt, now)} days ago` : 'never'}</span></li>`).join('')}</ul>`
      : '<p class="muted">All tracked brands and zones have a reading this week.</p>'}
    </details>

    <details class="collapse" id="m-recent" ${ui.recentOpen ? 'open' : ''}><summary>Recent readings (${recent.length})</summary>
    <div class="table-wrap"><table><thead><tr><th>Brand · zone</th><th>Submitted by</th><th class="num">Per cyl</th></tr></thead><tbody>
    ${recent.map(r => {
      const stale = isStaleReading(s, r, now);
      return `<tr class="${stale ? 'stale' : ''}"><td>${esc(r.brand)}<br><span class="small">${esc(r.zone)} · ${esc(s.skus.find(k => k.id === r.skuId)?.label ?? r.skuId)}</span></td>
        <td class="small">${esc(userName(s, r.capturedBy))}</td>
        <td class="num">${fmt(r.pricePerCyl)}<br><span class="small">${fmtDate(r.capturedAt)}${stale ? ` · <span class="pill grey">${daysSince(r.capturedAt, now)} days old</span>` : ''}</span></td></tr>`;
    }).join('')}
    </tbody></table></div></details>
  </section>`;
}

function bind(root, ctx) {
  const rerender = () => render(root, { ...ctx, state: store.get() });
  const $ = id => root.querySelector('#' + id);
  const clearFlags = () => { ui.error = ''; ui.outlier = null; };

  $('m-due').ontoggle = e => { ui.dueOpen = e.target.open; };
  $('m-recent').ontoggle = e => { ui.recentOpen = e.target.open; };
  $('m-brand').onchange = e => { ui.brand = e.target.value; clearFlags(); rerender(); };
  if ($('m-brand-other')) $('m-brand-other').oninput = e => { ui.brandOther = e.target.value; clearFlags(); };
  $('m-zone').onchange = e => { ui.zone = e.target.value; clearFlags(); rerender(); };
  $('m-sku').onchange = e => { ui.skuId = e.target.value; clearFlags(); rerender(); };
  $('m-price').oninput = e => { ui.price = e.target.value; if (ui.outlier || ui.error) { clearFlags(); rerender(); } };
  $('m-nocam').onchange = e => { ui.noCamera = e.target.checked; ui.photoUrl = null; ui.photoName = ''; rerender(); };
  if ($('m-photo')) $('m-photo').onchange = e => {
    const f = e.target.files[0];
    if (ui.photoUrl) URL.revokeObjectURL(ui.photoUrl);
    ui.photoUrl = f ? URL.createObjectURL(f) : null;
    ui.photoName = f ? f.name : '';
    ui.error = '';
    rerender();
  };
  if ($('m-photo-name')) $('m-photo-name').oninput = e => { ui.photoName = e.target.value; };
  if ($('m-fix')) $('m-fix').onclick = () => { ui.outlier = null; rerender(); root.querySelector('#m-price')?.focus(); };
  if ($('m-confirm')) $('m-confirm').onclick = () => submit(ctx, true).then(rerender);
  $('m-submit').onclick = () => submit(ctx, false).then(rerender);
}

async function submit({ user }, confirmed) {
  const s = store.get();
  const brand = (ui.brand === '__other' ? ui.brandOther : ui.brand).trim();
  const price = toCentavos(ui.price);
  ui.error = '';
  if (!brand) { ui.error = 'Choose a brand, or pick Other and type it'; return; }
  if (!ui.zone) { ui.error = 'Choose a zone'; return; }
  if (!price || price <= 0) { ui.error = 'Enter the price per cylinder, for example 1055.00'; return; }
  const photo = ui.noCamera ? ui.photoName.trim() : ui.photoUrl;
  if (!photo) { ui.error = ui.noCamera ? 'Enter the photo filename — a reading needs a photo' : 'Attach a photo of the price — a reading needs a photo'; return; }

  const last = newestReading(s, { zone: ui.zone, skuId: ui.skuId, brand });
  if (last && !confirmed) {
    const diff = (price - last.pricePerCyl) / last.pricePerCyl;
    if (Math.abs(diff) > 0.10) {
      ui.outlier = { message: `This is ${Math.round(Math.abs(diff) * 100)}% ${diff > 0 ? 'higher' : 'lower'} than the last ${last.brand} reading in ${last.zone} (${fmt(last.pricePerCyl)} on ${fmtDate(last.capturedAt)}). Correct?` };
      return;
    }
  }

  const id = store.uid('cr');
  const reading = {
    id, brand, zone: ui.zone, skuId: ui.skuId, pricePerCyl: price,
    capturedAt: new Date().toISOString(), capturedBy: user.id,
    photoUrl: ui.noCamera ? ui.photoName.trim() : ui.photoUrl, photoName: ui.photoName || null,
    outlierConfirmed: !!confirmed,
  };
  await store.commit({
    action: 'READING_CAPTURED', entity: 'competitorReading', entityId: id, field: 'pricePerCyl',
    before: last ? last.pricePerCyl : null, after: price,
  }, d => { d.competitorReadings.push(reading); });

  try { localStorage.setItem(LAST_ZONE, ui.zone); } catch { /* storage unavailable */ }
  Object.assign(ui, { brand: '', brandOther: '', price: '', photoUrl: null, photoName: '', outlier: null, error: '' });
  toast('Reading captured');
}
