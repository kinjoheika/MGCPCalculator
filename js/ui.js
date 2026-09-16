// Tiny DOM helpers shared by views.

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The version-and-date stamp. Every screen that shows a price carries the same mark,
// so a number can always be traced to the price list it came from.
export function stamp(version, dateText, { size = '', note = '' } = {}) {
  return `<span class="stamp ${size ? `stamp-${size}` : ''}" title="Price list v${version}, effective ${esc(dateText)}">
    <span class="stamp-v">v${esc(version)}</span>
    <span class="stamp-t"><b>Price list</b><span>${esc(dateText)}</span></span>
    ${note ? `<span class="stamp-n">${esc(note)}</span>` : ''}</span>`;
}

export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2600);
}

export function options(list, selected, { value = x => x.id, label = x => x.label, placeholder = null } = {}) {
  const head = placeholder != null ? `<option value="">${esc(placeholder)}</option>` : '';
  return head + list.map(x => {
    const v = value(x);
    return `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(label(x))}</option>`;
  }).join('');
}

// Modal dialog. body is HTML; returns the dialog element. Closes on Cancel / Escape.
export function modal(title, body, { onMount } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `<form method="dialog" class="modal-inner">
    <h2>${esc(title)}</h2>${body}</form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  if (onMount) onMount(dlg);
  return dlg;
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Preserve focus and caret across a re-render of root.
export function preserveFocus(root, fn) {
  const active = document.activeElement;
  const id = active && root.contains(active) ? active.id : null;
  const start = active?.selectionStart, end = active?.selectionEnd;
  fn();
  if (id) {
    const el = document.getElementById(id);
    if (el) {
      el.focus();
      try { if (start != null) el.setSelectionRange(start, end); } catch { /* not a text input */ }
    }
  }
}
