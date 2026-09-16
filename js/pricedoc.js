// One printable template for quotations and price lists.
// Drawn on a canvas at short bond (US Letter, 8.5 × 11 in) portrait, then printed or wrapped in a one-page PDF.
// No libraries: the PDF embeds the page as a JPEG, so ₱ and the brand font render exactly as on screen.

import { fmt } from './money.js';
import { download } from './ui.js';

const DPI = 150;
const W = 8.5 * DPI;  // 1275
const H = 11 * DPI;   // 1650
const M = 90;
const C = { navy: '#0B1F3A', blue: '#1F5AD6', blue50: '#EDF3FF', tiffany: '#0ABAB5', tiffanyDark: '#067F7B', alt: '#EAF8F7', line: '#D9E1EA', muted: '#5A6A80' };
const FONT = '"Inter", "Segoe UI", system-ui, sans-serif';

// d: { title, docNo, customer, subtitle, version, effective, issued, validUntil, issuedBy, vatRate, ref,
//      rows: [{ label, contentKg, netPerKg, grossPerCyl, qty?, total? }], total? }
export async function renderDoc(d) {
  try { await document.fonts?.ready; } catch { /* fonts API unavailable */ }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  const text = (t, x, y, { w = 400, px = 24, color = C.navy, align = 'left', max = 0 } = {}) => {
    g.font = `${w} ${px}px ${FONT}`;
    g.fillStyle = color;
    g.textAlign = align;
    let s = String(t ?? '');
    if (max) while (s.length > 1 && g.measureText(s).width > max) s = s.slice(0, -2) + '…';
    g.fillText(s, x, y);
  };
  const rect = (x, y, w, h, color) => { g.fillStyle = color; g.fillRect(x, y, w, h); };

  rect(0, 0, W, H, '#fff');

  // Header band
  rect(0, 0, W, 210, C.navy);
  rect(0, 210, W, 8, C.tiffany);
  const grad = g.createLinearGradient(M, 62, M + 76, 138);
  grad.addColorStop(0, C.tiffany); grad.addColorStop(1, C.blue);
  g.fillStyle = grad;
  g.beginPath(); g.roundRect ? g.roundRect(M, 62, 76, 76, 16) : g.rect(M, 62, 76, 76); g.fill();
  text('M', M + 38, 116, { w: 800, px: 40, color: '#fff', align: 'center' });
  text('MGC', M + 100, 100, { w: 800, px: 34, color: '#fff' });
  text('Pricing', M + 100, 136, { w: 500, px: 24, color: 'rgba(255,255,255,.72)' });
  text(d.title, W - M, 112, { w: 700, px: 52, color: '#fff', align: 'right' });
  text(d.docNo, W - M, 152, { w: 500, px: 22, color: 'rgba(255,255,255,.72)', align: 'right', max: 560 });

  // Parties and document facts
  text('Prepared for', M, 292, { w: 600, px: 20, color: C.tiffanyDark });
  text(d.customer, M, 338, { w: 700, px: 34, max: 640 });
  text(d.subtitle, M, 376, { px: 22, color: C.muted, max: 640 });
  // The version stamp: the first thing the eye should land on, and the mark a forwarded copy carries.
  const sw = 300, sh = 96, sx = W - M - sw, sy = 268;
  g.lineWidth = 3;
  g.strokeStyle = C.navy;
  g.fillStyle = C.alt;
  g.beginPath();
  g.roundRect ? g.roundRect(sx, sy, sw, sh, 10) : g.rect(sx, sy, sw, sh);
  g.fill();
  g.stroke();
  text(`v${d.version}`, sx + 22, sy + 66, { w: 800, px: 48 });
  text('Price list', sx + 110, sy + 44, { w: 700, px: 17, color: C.tiffanyDark });
  text(d.effective, sx + 110, sy + 72, { w: 700, px: 21, max: sw - 130 });

  const facts = [['Issued', d.issued], ['Valid until', d.validUntil]].filter(f => f[1]);
  facts.forEach(([k, v], i) => {
    const y = sy + sh + 34 + i * 34;
    text(k, sx, y, { px: 19, color: C.muted });
    text(v, W - M, y, { w: 600, px: 20, align: 'right' });
  });

  // Table
  const withQty = d.rows.some(r => r.qty != null);
  const cols = withQty
    ? [['Product', M, 'left'], ['Qty', 610, 'right'], ['Per kg, net', 790, 'right'], ['Per cylinder, VAT incl.', 1000, 'right'], ['Total', W - M, 'right']]
    : [['Product', M, 'left'], ['Content', 640, 'right'], ['Per kg, net', 880, 'right'], ['Per cylinder, VAT incl.', W - M, 'right']];
  const top = 480;
  rect(M - 16, top, W - 2 * M + 32, 58, C.blue50);
  rect(M - 16, top + 58, W - 2 * M + 32, 3, C.navy);
  cols.forEach(([t, x, a]) => text(t, x, top + 37, { w: 650, px: 19, align: a }));

  const tableBottomLimit = d.total != null ? 1250 : 1340;
  const rowH = Math.min(68, (tableBottomLimit - (top + 61)) / Math.max(1, d.rows.length));
  const px = Math.min(23, Math.max(15, rowH * 0.36));
  d.rows.forEach((r, i) => {
    const y = top + 61 + i * rowH;
    if (i % 2 === 1) rect(M - 16, y, W - 2 * M + 32, rowH, C.alt);
    const base = y + rowH / 2 + px * 0.36;
    if (withQty) {
      text(r.label, M, base, { w: 600, px, max: 420 });
      text(r.qty ?? '', 610, base, { px, align: 'right' });
      text(fmt(r.netPerKg), 790, base, { px, align: 'right' });
      text(fmt(r.grossPerCyl), 1000, base, { w: 700, px, align: 'right' });
      text(r.total != null ? fmt(r.total) : '', W - M, base, { w: 700, px, align: 'right' });
    } else {
      text(r.label, M, base, { w: 600, px, max: 440 });
      text(`${r.contentKg} kg`, 640, base, { px, color: C.muted, align: 'right' });
      text(fmt(r.netPerKg), 880, base, { px, align: 'right' });
      text(fmt(r.grossPerCyl), W - M, base, { w: 700, px, align: 'right' });
    }
  });
  let y = top + 61 + d.rows.length * rowH;
  rect(M - 16, y, W - 2 * M + 32, 2, C.line);

  if (d.total != null) {
    y += 30;
    rect(700, y, W - M + 16 - 700, 84, C.navy);
    rect(700, y + 84, W - M + 16 - 700, 5, C.tiffany);
    text('Total, VAT incl.', 730, y + 52, { w: 600, px: 22, color: 'rgba(255,255,255,.8)' });
    text(fmt(d.total), W - M - 10, y + 56, { w: 750, px: 36, color: '#fff', align: 'right' });
    y += 90;
  }

  text(`Per-cylinder prices include ${Math.round((d.vatRate ?? 0.12) * 100)}% VAT. Per-kg prices are net of VAT. Amounts in Philippine pesos.`, M, y + 60, { px: 19, color: C.muted, max: W - 2 * M });

  // Footer
  rect(M, H - 150, W - 2 * M, 2, C.line);
  text(`Issued by ${d.issuedBy} · ${d.issued}`, M, H - 106, { px: 19, color: C.muted, max: 800 });
  if (d.ref) text(`Ref ${d.ref}`, W - M, H - 106, { w: 600, px: 19, color: C.muted, align: 'right' });
  text(`Check the live MGC price list v${d.version} before relying on a forwarded copy.`, M, H - 70, { w: 600, px: 18, color: C.tiffanyDark });
  return c;
}

function jpegPdf(jpeg) {
  const enc = new TextEncoder();
  const parts = [], offsets = [];
  let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  const PW = 612, PH = 792; // points
  push('%PDF-1.4\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream');
  });
  const content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(n => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

export async function docPdfBlob(d) {
  const c = await renderDoc(d);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  return jpegPdf(new Uint8Array(await blob.arrayBuffer()));
}

export async function savePdf(d, filename) {
  download(filename, await docPdfBlob(d));
}

export async function previewUrl(d) {
  return (await renderDoc(d)).toDataURL('image/jpeg', 0.85);
}

export async function printDoc(d) {
  const c = await renderDoc(d);
  let sheet = document.getElementById('print-sheet');
  if (!sheet) { sheet = document.createElement('div'); sheet.id = 'print-sheet'; document.body.appendChild(sheet); }
  sheet.innerHTML = `<img alt="" src="${c.toDataURL('image/jpeg', 0.95)}">`;
  const img = sheet.querySelector('img');
  if (!img.complete) await new Promise(r => { img.onload = r; });
  document.body.classList.add('print-doc');
  const done = () => { document.body.classList.remove('print-doc'); sheet.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

export const slug = s => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
