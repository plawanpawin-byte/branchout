'use strict';
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const toast = (m, ms = 2400) => { const t = h('div', { class: 'toast', role: 'status', text: m }); document.body.append(t); setTimeout(() => t.remove(), ms); };
// an error from the main process without Electron's "Error invoking remote method ..." wrapper
const cleanErr = (e) => String((e && e.message) || e).replace(/Error invoking remote method '[^']*': (?:\w*Error: )?/g, '');
// the letter of a key press, also on non-Latin keyboard layouts (Ctrl+S on a Thai layout still saves)
const keyOf = (e) => { const k = (e.key || '').toLowerCase(); return /^[a-z]$/.test(k) || !/^Key[A-Z]$/.test(e.code || '') ? k : e.code.slice(3).toLowerCase(); };

// ---------- model ----------
// node: { id, text, kids:[], collapsed, color, note }
const COLORS = ['#cfcfcf', '#ffffff', '#9a9a9a', '#6b6b6b', '#d9e0e6', '#e6e0d2', '#dce6dc', '#e8d9d9'];
let doc = { title: 'Untitled', layout: 'map', root: mk('Central idea') };
let sel = null;
let undoS = [], redoS = [];
let zoom = 1, panX = 0, panY = 0, fileName = '';
const ICONS = ['★', '✓', '!', '?', '⚑', '♥', '☼', '✎', '☎', '⚙', '▶', '✶'];
function mk(text) { return { id: uid(), text, kids: [], collapsed: false, color: '', note: '', icon: '' }; }
// the map without the layout numbers that layout() keeps on each topic (_x, _w, _lines, ...)
const snapshot = () => JSON.stringify(doc, (k, v) => (k[0] === '_' ? undefined : v));
// commit(before) records an undo step; pass the snapshot taken before a change that is already made
function commit(before = snapshot()) { undoS.push(before); if (undoS.length > 100) undoS.shift(); redoS = []; }
function undo() { if (!undoS.length) return; redoS.push(snapshot()); doc = JSON.parse(undoS.pop()); fixSel(); render(); }
function redo() { if (!redoS.length) return; undoS.push(snapshot()); doc = JSON.parse(redoS.pop()); fixSel(); render(); }
// the selection always names a topic that is on screen: a topic inside a collapsed one passes it to that topic
function fixSel() {
  if (!sel || !find(sel)) { sel = doc.root.id; return; }
  const path = []; const walkTo = (n) => { path.push(n); if (n.id === sel) return true; for (const k of n.kids) if (walkTo(k)) return true; path.pop(); return false; };
  walkTo(doc.root);
  const c = path.findIndex((n) => n.collapsed && n.id !== sel); if (c >= 0) sel = path[c].id;
}
// unsaved changes: the map differs from what was last opened, saved or started, or a field holds typing not yet applied
let savedSnap = null;
const isDirty = () => savedSnap !== null && snapshot() !== savedSnap;
const pendingEdit = () => [...document.querySelectorAll('[data-orig]')].some((el) => el.value !== el.dataset.orig);
const hasUnsaved = () => isDirty() || pendingEdit();
// before New, Open or a dropped file replaces the map
const okToDiscard = () => !hasUnsaved() || confirm('Discard the unsaved changes to this map?');
function find(id, n = doc.root, parent = null) { if (n.id === id) return { n, parent }; for (const k of n.kids) { const r = find(id, k, n); if (r) return r; } return null; }

// ---------- icons ----------
// Material Symbols (Outlined) style icons, fill-based, on a 24px grid. Path data in the style of Google's Material icons (Apache-2.0).
const MI = {
  newdoc: 'M13 11h-2v3H8v2h3v3h2v-3h3v-2h-3zm1-9H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z',
  open: 'M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z',
  save: 'M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  redo: 'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z',
  present: 'M10 8v8l5-4-5-4zm9-5H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z',
  outline: 'M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z',
  text: 'M8 16h8v2H8zm0-4h8v2H8zm6-10H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z',
  download: 'M18 15v3H6v-3H4v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3h-2zm-1-4l-1.41-1.41L13 12.17V4h-2v8.17L8.41 9.59 7 11l5 5 5-5z',
  image: 'M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z',
  code: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
  keyboard: 'M20 7v10H4V7h16m0-2H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2zm0 3h2v2h-2zM8 8h2v2H8zm0 3h2v2H8zm-3 0h2v2H5zm0-3h2v2H5zm3 6h8v2H8zm6-3h2v2h-2zm0-3h2v2h-2zm3 3h2v2h-2zm0-3h2v2h-2z',
  panr: 'M5 3h14c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2zm10 16h4V5h-4v14zM5 19h8V5H5v14z',
  child: 'M19 15l-6 6-1.42-1.42L15.17 16H4V4h2v10h9.17l-3.59-3.58L13 9l6 6z',
  sibling: 'M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM5.92 19H5v-.92l9.06-9.06.92.92L5.92 19zM20.71 5.63l-2.34-2.34c-.2-.2-.45-.29-.71-.29s-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41z',
  fold: 'M7.41 18.59L8.83 20 12 16.83 15.17 20l1.41-1.41L12 14l-4.59 4.59zm9.18-13.18L15.17 4 12 7.17 8.83 4 7.41 5.41 12 10l4.59-4.59z',
  unfold: 'M12 5.83L15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z',
  del: 'M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z',
  zout: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z',
  zin: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z',
  fit: 'M17 4h3c1.1 0 2 .9 2 2v2h-2V6h-3V4zM4 8V6h3V4H4c-1.1 0-2 .9-2 2v2h2zm16 8v2h-3v2h3c1.1 0 2-.9 2-2v-2h-2zM7 18H4v-2H2v2c0 1.1.9 2 2 2h3v-2zM16 8H8c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h8c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 6H9v-4h6v4z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  prev: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  next: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
};
// one fill-based 24px icon; evenodd keeps cut-outs open
const fillIcon = (d, size = 20) => { const s = sv('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor', 'aria-hidden': 'true', class: 'ms' }); s.append(sv('path', { d, 'fill-rule': 'evenodd' })); return s; };
const icon = (name, size = 20) => fillIcon(MI[name] || MI.newdoc, size);

// ---------- UI shell ----------
const app = $('#app');
const toolbar = h('div', { class: 'toolbar' });
const stage = h('div', { class: 'stage', style: 'overflow:hidden;position:relative' });
const right = h('div', { class: 'sidebar right', style: 'width:280px' });
const status = h('div', { class: 'status' });
app.append(toolbar, h('div', { class: 'main' }, stage, right), status);
const btn = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn, text: label });
// top-bar button: our own fill icon (data-for tells kit.js not to add its line icon) + a label kit.js hides unless "Aa" is on
function tbtn(label, ic, fn, cls = '', tip = label) {
  const b = h('button', { class: 'btn ' + cls, onclick: (e) => fn(e), title: tip, 'aria-label': label });
  const i = icon(ic, 20); i.classList.add('ic'); i.dataset.for = label; b.append(i, document.createTextNode(label)); return b;
}
// A button clicked with the mouse lets go of focus before it acts, so Tab, Enter, Space and the other shortcuts go to the
// map again. A button pressed from the keyboard (detail 0) keeps its focus.
document.addEventListener('click', (e) => { if (e.detail > 0) { const b = e.target.closest && e.target.closest('button'); if (b && b === document.activeElement) b.blur(); } }, true);
// A click on any other control ends typing in a text field outside dialogs (the floating bar keeps focus on purpose,
// so without this the field would keep the keys).
document.addEventListener('pointerdown', (e) => {
  const a = document.activeElement;
  if (a && a.matches('input,textarea') && !a.closest('.modal-back') && a !== e.target && !a.contains(e.target)) a.blur();
}, true);

// editable map title in the top bar: Enter keeps it, Escape puts the old title back, one edit is one undo step
let titleOld = null, titleSnap = null;
function titleDone() { if (titleSnap !== null && snapshot() !== titleSnap) commit(titleSnap); titleOld = null; titleSnap = null; }
const titleInput = h('input', { type: 'text', class: 'tbtitle', maxlength: 120, title: 'Map title', 'aria-label': 'Map title', placeholder: 'Untitled',
  onfocus: () => { if (titleOld === null) { titleOld = doc.title || ''; titleSnap = snapshot(); } }, onblur: () => titleDone(),
  oninput: (e) => { if (titleOld === null) { titleOld = doc.title || ''; titleSnap = snapshot(); } doc.title = e.target.value; renderStatus(); },
  onchange: (e) => { if (!e.target.value.trim()) { doc.title = 'Untitled'; e.target.value = doc.title; } },
  onkeydown: (e) => {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['s', 'o'].includes(keyOf(e))) { e.preventDefault(); const k = keyOf(e); e.target.blur(); if (k === 's') saveDoc(); else openDoc(); return; }
    if (e.key === 'Enter') { e.target.blur(); titleDone(); }
    if (e.key === 'Escape') { if (titleOld !== null) doc.title = titleOld; e.target.value = doc.title; e.target.blur(); titleDone(); }
  } });
function syncTitle() { if (document.activeElement !== titleInput) titleInput.value = doc.title || ''; }
// before another map replaces this one: drop any half-finished typing in the title or the Details panel, so it can
// not land in the new map's undo history, and let go of the field so the new map's values show in it
function endEditing() {
  fieldSnap = null; titleOld = null; titleSnap = null;
  const a = document.activeElement;
  if (a && a.matches('input,textarea') && !a.closest('.modal-back')) a.blur();
  fieldSnap = null; titleOld = null; titleSnap = null;
}

// small menus (Export) anchored under a button; Esc, an outside click or focus leaving closes them
let fly = null, flyAnchor = null;
function closeFly(refocus) { if (fly) { fly.remove(); fly = null; } const a = flyAnchor; flyAnchor = null; if (refocus && a && a.isConnected) a.focus(); }
function openMenu(anchor, id, items, kb) {
  const was = fly && fly.dataset.g === 'menu:' + id; closeFly(); if (was) return;
  fly = h('div', { class: 'fly menu', role: 'menu', 'data-g': 'menu:' + id });
  for (const [ic, label, fn] of items) fly.append(h('button', { class: 'fi', role: 'menuitem', onclick: (e) => { closeFly(e.detail === 0); fn(); } }, icon(ic, 20), h('span', { class: 'fl', text: label })));
  fly.style.position = 'fixed'; document.body.append(fly);
  const r = anchor.getBoundingClientRect(), w = fly.offsetWidth;
  fly.style.top = (r.bottom + 6) + 'px'; fly.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  flyAnchor = anchor; if (kb) fly.classList.add('kb'); fly.querySelector('.fi').focus();
}
document.addEventListener('pointerdown', (e) => { if (fly && !fly.contains(e.target) && !e.target.closest('[data-menu]')) closeFly(); }, true);
document.addEventListener('focusin', (e) => { if (fly && !fly.contains(e.target) && !e.target.closest('[data-menu]')) closeFly(); });
document.addEventListener('keydown', (e) => {
  if (!fly) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFly(true); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const l = [...fly.querySelectorAll('.fi')], i = l.indexOf(document.activeElement); l[(i + (e.key === 'ArrowDown' ? 1 : l.length - 1)) % l.length].focus(); fly.classList.add('kb'); e.preventDefault(); e.stopPropagation(); }
  if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeFly(true); }
}, true);
const exportBtn = tbtn('Export', 'download', (e) => openMenu(e.currentTarget, 'export', [['image', 'Export PNG', () => exportImg('png')], ['code', 'Export SVG', () => exportImg('svg')], ['text', 'Outline text', () => saveOutline()]], e.detail === 0), '', 'Export');
exportBtn.dataset.menu = 'export'; exportBtn.setAttribute('aria-haspopup', 'menu');
toolbar.append(titleInput, h('span', { class: 'grow' }),
  tbtn('New', 'newdoc', newDoc, '', 'New map'), tbtn('Open', 'open', openDoc, '', 'Open a map (Ctrl+O)'),
  tbtn('Undo', 'undo', undo, '', 'Undo (Ctrl+Z)'), tbtn('Redo', 'redo', redo, '', 'Redo (Ctrl+Y)'),
  tbtn('Present', 'present', present, '', 'Present the map topic by topic'), tbtn('Outline', 'outline', showOutline, '', 'Show the map as an outline'),
  exportBtn, tbtn('Keyboard shortcuts', 'keyboard', () => showHelp(), '', 'Keyboard shortcuts (?)'),
  tbtn('Save', 'save', saveDoc, 'primary', 'Save (Ctrl+S)'));

// floating toolbar at the bottom of the canvas. A mouse press on it does not take focus, and it lets go of a button
// that still had keyboard focus, so Enter or Space can not press that older button afterwards.
const dockDown = (e) => { e.preventDefault(); const a = document.activeElement; if (a && a !== document.body && !a.closest('.modal-back')) a.blur(); };
const dk = (ic, label, key, fn) => h('button', { class: 'dk', title: label + (key ? ' (' + key + ')' : ''), 'aria-label': label, onclick: fn, onpointerdown: dockDown }, icon(ic, 20));
const bCollapse = dk('fold', 'Collapse', 'Space', () => toggleCollapse());
const zoomPct = h('button', { class: 'zk zpct', title: 'Zoom to 100%', 'aria-label': 'Zoom to 100%', onclick: () => zoomBy(1 / zoom), onpointerdown: dockDown, text: '100%' });
const dock = h('div', { class: 'dock', role: 'toolbar', 'aria-label': 'Topic tools' },
  h('div', { class: 'dg' }, dk('child', 'Add child', 'Tab', () => addChild()), dk('sibling', 'Add sibling', 'Enter', () => addSibling()), dk('edit', 'Edit', 'F2', () => editSel()),
    bCollapse, dk('unfold', 'Expand all', '', () => expandAll()), dk('del', 'Delete', 'Del', () => del())),
  h('div', { class: 'dg' }, dk('zout', 'Zoom out', '', () => zoomBy(1 / 1.2)), zoomPct, dk('zin', 'Zoom in', '', () => zoomBy(1.2)), dk('fit', 'Fit to screen', '', () => fit())));
function refreshDock() {
  const f = find(sel), n = f && f.n, has = !!(n && n.kids.length);
  bCollapse.disabled = !has;
  const lab = has && n.collapsed ? 'Expand' : 'Collapse';
  bCollapse.setAttribute('aria-label', lab); bCollapse.title = lab + ' (Space)';
  bCollapse.firstChild.replaceWith(icon(has && n.collapsed ? 'unfold' : 'fold', 20));
}
// panel header: title + a round button that folds the panel away (the kit.js grip brings it back)
function phead(title, side) {
  const hide = 'Hide ' + title.toLowerCase() + ' panel';
  return h('div', { class: 'phead' }, h('h2', { class: 'ptitle', text: title }),
    h('button', { class: 'pbtn', title: hide, 'aria-label': hide, onclick: (e) => {
      if (!window.lkPanel) return; window.lkPanel(side);
      // from the keyboard, focus goes to the grip that brings the panel back (the button itself is now hidden)
      if (e.detail === 0) { const g = document.querySelector(`.grip[data-side="${side}"]`); if (g) g.focus(); }
    } }, icon('panr', 20)));
}

const svg = sv('svg', { width: '100%', height: '100%', style: 'display:block;touch-action:none' });
const world = sv('g');
svg.append(world); stage.append(svg, dock);

const walk = (n, fn) => { fn(n); n.kids.forEach((k) => walk(k, fn)); };

// ---------- layout ----------
const meas = document.createElement('canvas').getContext('2d');
const FS = (depth) => (depth === 0 ? 20 : depth === 1 ? 16 : 14);
function nodeSize(n, depth) {
  const fs = FS(depth); meas.font = `${depth < 2 ? '600 ' : ''}${fs}px Segoe UI, Arial, sans-serif`;
  const lines = wrapText(n.text || ' ', 200);
  const w = Math.max(...lines.map((l) => meas.measureText(l).width)) + 24; const hh = lines.length * fs * 1.25 + 14;
  return { w: Math.max(w, 60) + (n.icon ? 24 : 0), h: hh, lines, fs };
}
// lines of at most maxW (in the font nodeSize set): breaks at spaces, then between words (Thai has no spaces), and a
// word longer than the line between letters, never inside a letter with its marks
const segWord = Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const segChar = Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
const words = (t) => (segWord ? [...segWord.segment(t)].map((x) => x.segment) : t.split(/(\s+)/).filter(Boolean));
const letters = (t) => (segChar ? [...segChar.segment(t)].map((x) => x.segment) : [...t]);
function wrapText(text, maxW) {
  const fits = (t) => meas.measureText(t).width <= maxW;
  const out = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const wd of words(para)) {
      if (fits(line + wd)) { line += wd; continue; }
      if (!wd.trim()) { out.push(line); line = ''; continue; } // break at a space and drop it
      if (line.trim()) out.push(line.replace(/\s+$/, ''));
      line = '';
      if (fits(wd)) { line = wd; continue; }
      for (const c of letters(wd)) { if (line && !fits(line + c)) { out.push(line); line = c; } else line += c; } // a word longer than the line
    }
    out.push(line);
  }
  return out;
}
const HGAP = 56, VGAP = 10;
// returns subtree height; assigns n._w,_h,_y(relative center)
function measure(n, depth) {
  const sz = nodeSize(n, depth); n._w = sz.w; n._h = sz.h; n._lines = sz.lines; n._fs = sz.fs; n._d = depth;
  const kids = n.collapsed ? [] : n.kids;
  kids.forEach((k) => measure(k, depth + 1));
  const kh = kids.reduce((t, k) => t + k._sub, 0) + Math.max(0, kids.length - 1) * VGAP;
  n._sub = Math.max(n._h, kh);
}
function place(n, x, cy, dir) {
  // x = anchor edge (left edge if dir=1, right edge if dir=-1)
  n._x = dir === 1 ? x : x - n._w; n._cy = cy;
  const kids = n.collapsed ? [] : n.kids;
  const total = kids.reduce((t, k) => t + k._sub, 0) + Math.max(0, kids.length - 1) * VGAP;
  let y = cy - total / 2;
  for (const k of kids) { place(k, dir === 1 ? n._x + n._w + HGAP : n._x - HGAP, y + k._sub / 2, dir); y += k._sub + VGAP; }
}
function layoutDown() {
  const r = doc.root;
  const sub = (n, depth) => { const sz = nodeSize(n, depth); n._w = sz.w; n._h = sz.h; n._lines = sz.lines; n._fs = sz.fs; n._d = depth; n._dir = 1;
    const ks = n.collapsed ? [] : n.kids; ks.forEach((k) => sub(k, depth + 1)); n._sub = Math.max(n._w, ks.reduce((t, k) => t + k._sub, 0) + Math.max(0, ks.length - 1) * 20); };
  sub(r, 0);
  const rowH = []; const lv = (n, d) => { rowH[d] = Math.max(rowH[d] || 0, n._h); (n.collapsed ? [] : n.kids).forEach((k) => lv(k, d + 1)); }; lv(r, 0);
  const rowY = []; let acc = 0; rowH.forEach((hh, d) => { rowY[d] = acc + hh / 2; acc += hh + 60; });
  const pl = (n, left) => { n._cx = left + n._sub / 2; n._x = n._cx - n._w / 2; n._cy = rowY[n._d];
    let x = left; (n.collapsed ? [] : n.kids).forEach((k) => { pl(k, x); x += k._sub + 20; }); };
  pl(r, 0);
}
function layout() {
  if (doc.layout === 'down') return layoutDown();
  const r = doc.root; measure(r, 0);
  const kids = r.collapsed ? [] : r.kids;
  const lay = doc.layout || 'map';
  const half = lay === 'right' ? kids.length : lay === 'left' ? 0 : Math.ceil(kids.length / 2);
  const rightK = kids.slice(0, half), leftK = kids.slice(half);
  r._x = -r._w / 2; r._cy = 0;
  const side = (ks, dir) => {
    const total = ks.reduce((t, k) => t + k._sub, 0) + Math.max(0, ks.length - 1) * VGAP; let y = -total / 2;
    for (const k of ks) { k._dir = dir; place(k, dir === 1 ? r._x + r._w + HGAP : r._x - HGAP, y + k._sub / 2, dir); y += k._sub + VGAP; }
  };
  side(rightK, 1); side(leftK, -1);
  const mark = (n, dir) => { n._dir = dir; (n.collapsed ? [] : n.kids).forEach((k) => mark(k, dir)); };
  rightK.forEach((k) => mark(k, 1)); leftK.forEach((k) => mark(k, -1));
}

// ---------- render ----------
// default topic colours (Material 3 dark): central topic in the accent, main branches tonal, the rest on the surface
const EDGE = '#5f6368';
const DEF = [{ fill: '#a8c7fa', ink: '#062e6f', stroke: 'none' }, { fill: '#004a77', ink: '#c2e7ff', stroke: 'none' }, { fill: '#282a2c', ink: '#e3e3e3', stroke: '#5f6368' }];
let lastBounds = { x: 0, y: 0, w: 100, h: 100 };
// panel = false keeps the Details panel as it is (used while typing in it, so the field keeps its focus and caret)
function render(panel = true) {
  fixSel();
  layout();
  world.textContent = '';
  const gl = sv('g'), gn = sv('g'); world.append(gl, gn);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const draw = (n, parent) => {
    const top = n._cy - n._h / 2;
    x0 = Math.min(x0, n._x); x1 = Math.max(x1, n._x + n._w); y0 = Math.min(y0, top); y1 = Math.max(y1, top + n._h);
    if (parent) {
      if (doc.layout === 'down') { const sy = parent._cy + parent._h / 2, ey = top, my = (sy + ey) / 2;
        gl.append(sv('path', { d: `M${parent._cx} ${sy}C${parent._cx} ${my} ${n._cx} ${my} ${n._cx} ${ey}`, fill: 'none', stroke: EDGE, 'stroke-width': Math.max(1.4, 3.2 - n._d * 0.6), 'stroke-linecap': 'round' })); }
      else {
      const dir = n._dir; const sx = dir === 1 ? parent._x + parent._w : parent._x, ex = dir === 1 ? n._x : n._x + n._w;
      const mx = (sx + ex) / 2;
      gl.append(sv('path', { d: `M${sx} ${parent._cy}C${mx} ${parent._cy} ${mx} ${n._cy} ${ex} ${n._cy}`, fill: 'none', stroke: EDGE, 'stroke-width': Math.max(1.4, 3.2 - n._d * 0.6), 'stroke-linecap': 'round' }));
      }
    }
    const g = sv('g', { 'data-id': n.id, style: 'cursor:pointer' });
    const def = DEF[Math.min(n._d, 2)];
    const fill = n.color || def.fill;
    const ink = n.color ? (lum(n.color) < 140 ? '#f0f0f0' : '#1a1a1a') : def.ink;
    const rx = n._d === 0 ? n._h / 2 : 8;
    // the selection ring is its own shape (data-selring), so exports can drop it
    if (sel === n.id) g.append(sv('rect', { 'data-selring': '1', x: n._x - 4, y: top - 4, width: n._w + 8, height: n._h + 8, rx: rx + 4, fill: 'none', stroke: '#a8c7fa', 'stroke-width': 2.5 }));
    // pale fills get a soft dark outline so they still have an edge on the white background of exports
    const pale = lum(fill) > 200;
    g.append(sv('rect', { x: n._x, y: top, width: n._w, height: n._h, rx, fill, stroke: pale ? '#80868b' : n.color ? 'none' : def.stroke, 'stroke-width': 1 }));
    const t = sv('text', { 'text-anchor': 'middle', fill: ink, 'font-size': n._fs, 'font-weight': n._d < 2 ? 600 : 400, 'font-family': 'Segoe UI, Arial, sans-serif', style: 'pointer-events:none' });
    const tcx = n._x + n._w / 2 + (n.icon ? 12 : 0);
    n._lines.forEach((ln, i) => { const ts = sv('tspan', { x: tcx, y: n._cy - ((n._lines.length - 1) * n._fs * 1.25) / 2 + i * n._fs * 1.25 + n._fs * 0.35 }); ts.textContent = ln; t.append(ts); });
    g.append(t);
    if (n.icon) { const ic = sv('text', { x: n._x + 14, y: n._cy + n._fs * 0.35, 'text-anchor': 'middle', fill: ink, 'font-size': n._fs + 2, 'font-family': 'Segoe UI Symbol, Segoe UI, Arial, sans-serif', style: 'pointer-events:none' }); ic.textContent = n.icon; g.append(ic); }
    if (n.note) { const c = sv('circle', { cx: n._x + n._w - 4, cy: top + 4, r: 4, fill: '#fdd663', stroke: '#1f1f1f' }); g.append(c); }
    if (n.kids.length) {
      const dn = doc.layout === 'down'; const bx = dn ? n._cx : n._dir === -1 ? n._x - 10 : n._x + n._w + 10, by = dn ? n._cy + n._h / 2 + 10 : n._cy; if (n._d > 0 || dn) {
        const side = (n._d === 0 && !dn) ? null : bx;
        if (side != null) { const b = sv('g', { 'data-fold': n.id, style: 'cursor:pointer' }); b.append(sv('circle', { cx: bx, cy: by, r: 7, fill: '#1e1f20', stroke: '#8e918f' })); const tx = sv('text', { x: bx, y: by + 4, 'text-anchor': 'middle', fill: '#e3e3e3', 'font-size': 11 }); tx.textContent = n.collapsed ? '+' : '-'; b.append(tx); gn.append(b); }
      }
    }
    gn.append(g);
    if (!n.collapsed) n.kids.forEach((k) => draw(k, n));
  };
  draw(doc.root, null);
  lastBounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  applyView(); if (panel) renderRight(); renderStatus(); refreshDock(); syncTitle();
}
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
function applyView() { world.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`); }
// the smallest zoom still fits a map of a few thousand topics on screen
const ZMIN = 0.02;
function zoomBy(f, cx, cy) { const r = svg.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2; const nz = clamp(zoom * f, ZMIN, 4); panX = cx - (cx - panX) * (nz / zoom); panY = cy - (cy - panY) * (nz / zoom); zoom = nz; applyView(); renderStatus(); }
// Fit keeps every topic clear of the floating toolbar: the map is fitted into the canvas above the bar
const FIT = { top: 32, side: 40, gap: 16 };
function fit() {
  const r = svg.getBoundingClientRect(); const b = lastBounds; if (!r.width || !r.height) return;
  const d = dock.getBoundingClientRect();
  const bottom = d.height ? Math.max(FIT.top, r.bottom - d.top + FIT.gap) : FIT.top;
  const iw = r.width - FIT.side * 2, ih = r.height - FIT.top - bottom;
  zoom = clamp(Math.min(iw / Math.max(1, b.w), ih / Math.max(1, b.h)), ZMIN, 1.5);
  panX = (r.width - b.w * zoom) / 2 - b.x * zoom; panY = FIT.top + (ih - b.h * zoom) / 2 - b.y * zoom; applyView(); renderStatus();
}
function count(n) { return 1 + n.kids.reduce((t, k) => t + count(k), 0); }
function renderStatus() {
  status.textContent = ''; status.append(h('span', { text: fileName || 'Not saved to a file yet' }), isDirty() ? h('span', { class: 'muted', text: 'Unsaved changes' }) : null, h('span', { class: 'grow' }), h('span', { text: count(doc.root) + ' topics' }), h('span', { text: Math.round(zoom * 100) + '%' }));
  zoomPct.textContent = Math.round(zoom * 100) + '%';
}

// ---------- Details panel ----------
const LAYOUTS = [['map', 'Map', 'Both sides'], ['right', 'Right', 'Tree to the right'], ['left', 'Left', 'Tree to the left'], ['down', 'Down', 'Org chart']];
// a small picture of each layout for the layout cards
function layoutPic(k) {
  const s = sv('svg', { viewBox: '0 0 64 36', width: 64, height: 36, 'aria-hidden': 'true' });
  const line = (d) => s.append(sv('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', opacity: 0.7 }));
  const box = (x, y, w, hh, main) => s.append(sv('rect', { x, y, width: w, height: hh, rx: hh / 2, fill: main ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));
  if (k === 'down') {
    box(24, 3, 16, 8, 1); line('M32 11V17M12 17H52M12 17V22M32 17V22M52 17V22'); box(4, 24, 16, 8); box(24, 24, 16, 8); box(44, 24, 16, 8);
  } else if (k === 'map') {
    box(24, 14, 16, 8, 1); line('M40 18C46 18 44 7 50 7M40 18C46 18 44 29 50 29M24 18C18 18 20 7 14 7M24 18C18 18 20 29 14 29');
    box(50, 3, 12, 8); box(50, 25, 12, 8); box(2, 3, 12, 8); box(2, 25, 12, 8);
  } else {
    const L = k === 'left', X = (x) => (L ? 64 - x : x), bx = (x, w) => (L ? 64 - x - w : x);
    box(bx(3, 16), 14, 16, 8, 1);
    line(`M${X(19)} 18C${X(28)} 18 ${X(26)} 6 ${X(34)} 6M${X(19)} 18H${X(34)}M${X(19)} 18C${X(28)} 18 ${X(26)} 30 ${X(34)} 30`);
    box(bx(34, 14), 2, 14, 8); box(bx(34, 14), 14, 14, 8); box(bx(34, 14), 26, 14, 8);
  }
  return s;
}
// typing in the Topic or Notes field is one undo step per visit to the field
let fieldSnap = null;
function fieldStart() { if (fieldSnap === null) fieldSnap = snapshot(); }
function fieldDone() { const s = fieldSnap; fieldSnap = null; if (s !== null && snapshot() !== s) commit(s); }
function setLayout(k) { if ((doc.layout || 'map') === k) return; commit(); doc.layout = k; render(); fit(); }
function renderRight() {
  fieldDone();
  const keep = right.contains(document.activeElement) && document.activeElement.dataset.k; const st = right.scrollTop;
  right.textContent = '';
  right.append(phead('Details', 'right'));
  right.append(h('h3', { text: 'Layout' }), h('div', { class: 'lgrid', role: 'group', 'aria-label': 'Layout' }, LAYOUTS.map(([k, name, tip]) => {
    const on = (doc.layout || 'map') === k;
    return h('button', { class: 'lcard' + (on ? ' on' : ''), 'data-k': 'lay-' + k, title: tip, 'aria-label': 'Layout: ' + tip, 'aria-pressed': on ? 'true' : 'false', onclick: () => setLayout(k) }, layoutPic(k), h('span', { text: name }));
  })));
  const f = sel && find(sel);
  if (f) {
    const n = f.n;
    const ta = h('textarea', { rows: 3, 'aria-label': 'Topic text', placeholder: 'Topic text' }); ta.value = n.text;
    ta.addEventListener('focus', fieldStart); ta.addEventListener('blur', fieldDone);
    ta.addEventListener('input', () => { fieldStart(); n.text = ta.value; render(false); });
    right.append(h('h3', { text: 'Topic' }), ta);
    const sw = (label, style, on, fn, text) => h('button', { 'data-k': 'sw-' + label, 'aria-label': label, title: label, style, class: on ? 'on' : '', 'aria-pressed': on ? 'true' : 'false', text, onclick: fn });
    right.append(h('h3', { text: 'Color' }), h('div', { class: 'swatches' }, [sw('Default color', 'background:' + DEF[Math.min(n._d || 0, 2)].fill, !n.color, () => setNode(n, 'color', '')),
      ...COLORS.map((c) => sw('Color ' + c, `background:${c}`, n.color === c, () => setNode(n, 'color', c)))]));
    right.append(h('h3', { text: 'Icon' }), h('div', { class: 'swatches icons' }, [sw('No icon', '', !n.icon, () => setNode(n, 'icon', ''), '×'),
      ...ICONS.map((c) => sw('Icon ' + c, '', n.icon === c, () => setNode(n, 'icon', c), c))]));
    const note = h('textarea', { rows: 4, placeholder: 'Add a note', 'aria-label': 'Notes' }); note.value = n.note;
    note.addEventListener('focus', fieldStart);
    note.addEventListener('input', () => { fieldStart(); n.note = note.value; });
    note.addEventListener('blur', () => { fieldDone(); render(false); });
    right.append(h('h3', { text: 'Notes' }), note);
  }
  right.scrollTop = st;
  if (keep) { const b = right.querySelector(`[data-k="${keep}"]`); if (b) b.focus(); }
}
function setNode(n, key, v) { if (n[key] === v) return; commit(); n[key] = v; render(); }

// ---------- actions ----------
function addChild() { const f = find(sel); if (!f) return; commit(); const k = mk('New topic'); f.n.kids.push(k); f.n.collapsed = false; sel = k.id; render(); setTimeout(editSel, 0); }
function addSibling() { const f = find(sel); if (!f) return; if (!f.parent) return addChild(); commit(); const k = mk('New topic'); f.parent.kids.splice(f.parent.kids.indexOf(f.n) + 1, 0, k); sel = k.id; render(); setTimeout(editSel, 0); }
function del() { const f = find(sel); if (!f || !f.parent) { toast('The central topic cannot be deleted'); return; } commit(); const i = f.parent.kids.indexOf(f.n); f.parent.kids.splice(i, 1); sel = (f.parent.kids[i] || f.parent.kids[i - 1] || f.parent).id; render(); }
function toggleCollapse() { const f = find(sel); if (!f || !f.n.kids.length) return; commit(); f.n.collapsed = !f.n.collapsed; render(); }
function expandAll() { const before = snapshot(); walk(doc.root, (n) => (n.collapsed = false)); if (snapshot() !== before) commit(before); render(); }
// closes a dialog and gives focus back to the control that opened it (if it is still on the page)
function dlgCloser(back) { const opener = document.activeElement; let done = false; return () => { if (done) return; done = true; back.remove(); if (opener && opener !== document.body && opener.isConnected) opener.focus(); }; }
function editSel() {
  if (document.querySelector('.modal-back')) return;
  const f = find(sel); if (!f) return; const n = f.n;
  const ta = h('textarea', { rows: 3, style: 'width:360px;max-width:100%', 'aria-label': 'Topic text' }); ta.value = n.text;
  ta.dataset.orig = n.text; // typing not yet applied counts as unsaved (closing the window asks)
  // OK with the text left as it was changes nothing (no undo step, and old text with spaces round it stays as it is)
  const ok = () => { close(); if (ta.value === n.text) return; const before = snapshot(); n.text = ta.value.trim() || 'Topic'; if (snapshot() !== before) commit(before); render(); };
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit topic' }, h('h2', { text: 'Edit topic' }), ta,
    h('div', { class: 'msub', text: 'Enter to finish, Shift+Enter for a new line.' }), h('div', { class: 'row mact' }, btn('Cancel', () => close()), btn('OK', ok, 'primary'))));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ok(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    // Ctrl+S keeps the typed text and saves
    if ((e.ctrlKey || e.metaKey) && !e.altKey && keyOf(e) === 's') { e.preventDefault(); e.stopPropagation(); ok(); saveDoc(); }
  });
  const close = dlgCloser(back); document.body.append(back); ta.focus(); ta.select();
}
function newDoc() { if (!okToDiscard()) return; endEditing(); doc = { title: 'Untitled', layout: 'map', root: mk('Central idea') }; sel = doc.root.id; undoS = []; redoS = []; fileName = ''; savedSnap = snapshot(); render(); fit(); }
// arrow keys follow the picture: in the side layouts Left and Right go toward and away from the central topic and Up and
// Down move between topics on the same side; in the Down layout Up and Down go between levels, Left and Right between siblings
function move(key) {
  const f = find(sel); if (!f) return; const n = f.n, p = f.parent;
  const open = (x) => (x.collapsed ? [] : x.kids);
  let target = null;
  if (doc.layout === 'down') {
    if (key === 'ArrowUp') target = p;
    else if (key === 'ArrowDown') target = open(n)[0];
    else if (p) target = p.kids[p.kids.indexOf(n) + (key === 'ArrowRight' ? 1 : -1)];
  } else if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (p) { const sibs = p.kids.filter((k) => k._dir === n._dir); target = sibs[sibs.indexOf(n) + (key === 'ArrowDown' ? 1 : -1)]; }
  } else {
    const toward = key === 'ArrowRight' ? 1 : -1;
    if (!p) target = open(n).find((k) => k._dir === toward);
    else if (toward === (n._dir || 1)) target = open(n)[0]; else target = p;
  }
  if (target) { sel = target.id; render(); }
}

// ---------- pointer ----------
let drag = null;
svg.addEventListener('pointerdown', (ev) => {
  const fold = ev.target.closest('[data-fold]');
  if (fold) { const f = find(fold.dataset.fold); commit(); f.n.collapsed = !f.n.collapsed; render(); return; }
  const node = ev.target.closest('[data-id]');
  if (node) { sel = node.dataset.id; render(); return; }
  drag = { sx: ev.clientX, sy: ev.clientY, px: panX, py: panY }; svg.setPointerCapture(ev.pointerId);
});
svg.addEventListener('pointermove', (ev) => { if (!drag) return; panX = drag.px + ev.clientX - drag.sx; panY = drag.py + ev.clientY - drag.sy; applyView(); });
svg.addEventListener('pointerup', () => { drag = null; });
svg.addEventListener('dblclick', (ev) => { const node = ev.target.closest('[data-id]'); if (node) { sel = node.dataset.id; editSel(); } });
svg.addEventListener('wheel', (ev) => { ev.preventDefault(); const r = svg.getBoundingClientRect(); if (ev.ctrlKey || ev.metaKey) zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev.clientX - r.left, ev.clientY - r.top); else { panX -= ev.deltaX; panY -= ev.deltaY; applyView(); } }, { passive: false });
document.addEventListener('keydown', (e) => {
  const k = keyOf(e);
  // Save and Open also work while typing in the Details panel (leaving the field keeps what was typed)
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 's' || k === 'o') && e.target.matches('input,textarea,select') && !document.querySelector('.modal-back')) { e.preventDefault(); e.target.blur(); if (k === 's') saveDoc(); else openDoc(); return; }
  if (e.target.matches('input,textarea,select,[contenteditable]') || document.querySelector('.modal-back') || fly) return;
  // a focused panel grip uses Enter, Space and the arrows itself (fold, resize); Tab moves on from it as usual
  if (e.target.closest('.grip') && (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab' || e.key.startsWith('Arrow'))) return;
  // a button focused from the keyboard keeps Tab, Enter and Space for itself; every other shortcut still works
  if (e.target.matches('button') && (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab') && e.target.matches(':focus-visible')) return;
  if (k === 'Tab' || e.key === 'Tab') { e.preventDefault(); addChild(); }
  else if (e.key === 'Enter') { e.preventDefault(); addSibling(); }
  else if (e.key === 'F2') { e.preventDefault(); editSel(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); }
  else if (e.key === ' ') { e.preventDefault(); toggleCollapse(); }
  else if (e.key.startsWith('Arrow')) { e.preventDefault(); move(e.key); }
  else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.shiftKey ? redo() : undo(); e.preventDefault(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'y') { redo(); e.preventDefault(); }
  else if ((e.ctrlKey || e.metaKey) && k === 's') { saveDoc(); e.preventDefault(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'o') { openDoc(); e.preventDefault(); }
  else if (e.key === '?') { e.preventDefault(); showHelp(); }
});
// Tab stays inside the top dialog
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return; const backs = document.querySelectorAll('.modal-back'); if (!backs.length) return;
  const m = backs[backs.length - 1]; const f = [...m.querySelectorAll('button,input,textarea,select,[tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null); if (!f.length) { e.preventDefault(); return; }
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
}, true);

// ---------- files / export ----------
function toOutline(n, d = 0) { return '  '.repeat(d) + '- ' + n.text.replace(/\r?\n/g, ' ') + '\n' + (n.note ? '  '.repeat(d + 1) + '> ' + n.note.replace(/\r?\n/g, ' ') + '\n' : '') + n.kids.map((k) => toOutline(k, d + 1)).join(''); }
async function saveOutline() {
  try { const r = await window.host.saveFile({ name: (doc.title || 'map') + '.md', filters: [['Markdown', ['md', 'txt']]], data: new TextEncoder().encode(toOutline(doc.root)) }); if (r) toast('Saved ' + r.name); }
  catch (e) { toast('Not saved. ' + cleanErr(e), 6000); }
}
function showOutline() {
  if (document.querySelector('.modal-back')) return;
  const ta = h('textarea', { 'aria-label': 'Outline text', rows: 16, class: 'otext', readonly: true }); ta.value = toOutline(doc.root);
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Outline' }, h('h2', { text: 'Outline' }), ta,
    h('div', { class: 'row mact' }, btn('Close', () => close()), btn('Save as text', () => saveOutline(), 'primary'))));
  const close = dlgCloser(back); document.body.append(back);
}
// Reads a .branchout file. A valid file from any version opens exactly as it was written (a missing title, layout or
// icon just takes its default). Anything else that can be kept is repaired and reported in `fixed`, so the map then counts
// as unsaved; a file that is not a map at all throws a plain message.
const KEYS = ['id', 'text', 'collapsed', 'color', 'note', 'icon', 'kids'];
function parseMap(bytes) {
  const t = new TextDecoder().decode(bytes).replace(/^\ufeff/, '');
  if (!t.trim()) throw new Error('the file is empty.');
  const notMap = () => new Error('this is not a Branchout map, or the file is damaged.');
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  let d; try { d = JSON.parse(t); } catch (e) { if (e instanceof RangeError) throw new Error('the map is nested too deeply.'); throw notMap(); }
  if (!isObj(d) || !isObj(d.root)) throw notMap();
  let fixed = false; const fix = () => { fixed = true; };
  const ids = new Set();
  const node = (n) => {
    if (Object.keys(n).some((k) => !KEYS.includes(k))) fix();
    let id = n.id; if (typeof id !== 'string' || !id || ids.has(id)) { fix(); do id = uid(); while (ids.has(id)); } ids.add(id);
    const str = (v) => (typeof v === 'string' ? v : (fix(), typeof v === 'number' ? String(v) : ''));
    const text = str(n.text);
    const note = n.note === undefined ? '' : str(n.note);
    const collapsed = n.collapsed === undefined ? false : typeof n.collapsed === 'boolean' ? n.collapsed : (fix(), !!n.collapsed);
    const color = n.color === undefined || n.color === '' ? '' : /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : (fix(), '');
    const icon = n.icon === undefined || n.icon === '' ? '' : ICONS.includes(n.icon) ? n.icon : (fix(), '');
    let kids = [];
    if (Array.isArray(n.kids)) for (const k of n.kids) { if (isObj(k)) kids.push(node(k)); else fix(); }
    else if (n.kids !== undefined) fix();
    return { id, text, collapsed, color, note, icon, kids };
  };
  let root; try { root = node(d.root); } catch (e) { if (e instanceof RangeError) throw new Error('the map is nested too deeply.'); throw e; }
  const title = d.title === undefined ? 'Untitled' : typeof d.title === 'string' ? d.title : (fix(), typeof d.title === 'number' ? String(d.title) : 'Untitled');
  const LAY = ['map', 'right', 'left', 'down'];
  const lay = d.layout === undefined ? 'map' : LAY.includes(d.layout) ? d.layout : (fix(), 'map');
  return { doc: { title, layout: lay, root }, fixed };
}
async function openDoc(dropped) {
  if (!okToDiscard()) return;
  let f;
  if (dropped && dropped.data) f = dropped;
  else { try { f = (await window.host.openFiles({ filters: [['Branchout map', ['branchout', 'json']]] }))[0]; } catch (e) { toast(cleanErr(e), 6000); return; } }
  if (!f) return;
  let m; try { m = parseMap(f.data); } catch (e) { toast(`Cannot open "${f.name}": ${e.message}`, 6000); return; }
  const old = { doc, sel, undoS, redoS, fileName, savedSnap };
  try { endEditing(); doc = m.doc; fileName = f.name; sel = doc.root.id; undoS = []; redoS = []; savedSnap = m.fixed ? '' : snapshot(); render(); fit(); }
  catch (e) {
    ({ doc, sel, undoS, redoS, fileName, savedSnap } = old); render();
    toast(`Cannot open "${f.name}": ` + (e instanceof RangeError ? 'the map is nested too deeply.' : cleanErr(e)), 6000); return;
  }
  if (m.fixed) toast('Some items in this file were repaired.', 5000);
}
async function saveDoc() {
  const clean = (n) => ({ id: n.id, text: n.text, collapsed: n.collapsed, color: n.color, note: n.note, icon: n.icon || '', kids: n.kids.map(clean) });
  // what is written is the map as it is now; a change made while the Save dialog is open stays unsaved
  const snap = snapshot();
  const data = new TextEncoder().encode(JSON.stringify({ title: doc.title, layout: doc.layout || 'map', root: clean(doc.root) }, null, 1));
  let r; try { r = await window.host.saveFile({ name: (doc.title || 'map') + '.branchout', filters: [['Branchout map', ['branchout']]], data }); }
  catch (e) { toast('Not saved. ' + cleanErr(e), 6000); return; }
  if (r) { savedSnap = snap; fileName = r.name; toast('Saved ' + r.name); renderStatus(); }
}
function exportSvgString() {
  const b = lastBounds, pad = 30;
  const root = sv('svg', { xmlns: NS, width: b.w + pad * 2, height: b.h + pad * 2, viewBox: `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}` });
  root.append(sv('rect', { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, fill: '#ffffff' }));
  const c = world.cloneNode(true); c.removeAttribute('transform');
  c.querySelectorAll('[data-selring]').forEach((n) => n.remove());
  c.querySelectorAll('[data-fold]').forEach((n) => n.remove());
  root.append(c); return { str: new XMLSerializer().serializeToString(root), w: b.w + pad * 2, h: b.h + pad * 2 };
}
async function exportImg(kind) {
  const { str, w, h: hh } = exportSvgString();
  if (kind === 'svg') { try { const r = await window.host.saveFile({ name: (doc.title || 'map') + '.svg', filters: [['SVG', ['svg']]], data: new TextEncoder().encode(str) }); if (r) toast('Saved ' + r.name); } catch (e) { toast('Not exported. ' + cleanErr(e), 7000); } return; }
  try {
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str); await img.decode();
    // twice the size for sharpness, but a big map is scaled down so the picture stays within what a canvas can hold
    const sc = Math.min(2, 16000 / w, 16000 / hh, Math.sqrt(100e6 / (w * hh)));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.floor(w * sc)); cv.height = Math.max(1, Math.floor(hh * sc)); const ctx = cv.getContext('2d'); ctx.scale(sc, sc); ctx.drawImage(img, 0, 0, w, hh);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    if (!blob) { toast('This map is too big for a PNG picture. Try SVG instead.', 6000); return; }
    const res = await window.host.saveFile({ name: (doc.title || 'map') + '.png', filters: [['PNG image', ['png']]], data: new Uint8Array(await blob.arrayBuffer()) });
    if (res) toast('Saved ' + res.name);
  } catch (e) { toast('Not exported. ' + cleanErr(e), 7000); }
}

// ---------- keyboard shortcuts ----------
const SHORTCUTS = [
  ['Topics', [[['Tab'], 'Add a child topic'], [['Enter'], 'Add a sibling topic'], [['F2'], 'Edit the topic'], [['Double-click'], 'Edit the topic'], [['Del'], 'Delete the topic'], [['Space'], 'Collapse or expand'], [['Arrows'], 'Move the selection']]],
  ['File and edit', [[['Ctrl', 'Z'], 'Undo'], [['Ctrl', 'Y'], 'Redo'], [['Ctrl', 'S'], 'Save'], [['Ctrl', 'O'], 'Open']]],
  ['View', [[['Drag'], 'Pan the map'], [['Scroll'], 'Pan the map'], [['Ctrl', 'Scroll'], 'Zoom'], [['?'], 'This list']]],
  ['Presentation', [[['Right', 'Space'], 'Next topic'], [['Left'], 'Previous topic'], [['Esc'], 'Stop presenting']]],
];
function showHelp() {
  if (document.querySelector('.modal-back')) return;
  const keys = h('div', { class: 'keys' }, SHORTCUTS.map(([g, rows]) => h('div', { class: 'kgrp' }, h('h3', { text: g }),
    rows.map(([ks, what]) => h('div', { class: 'krow' }, h('span', { class: 'kk' }, ks.map((k) => h('kbd', { text: k }))), h('span', { text: what }))))));
  const back = h('div', { class: 'modal-back help', onclick: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'modal wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts' }, h('h2', { text: 'Keyboard shortcuts' }), keys, h('div', { class: 'row mact' }, btn('Close', () => close(), 'primary'))));
  const close = dlgCloser(back); document.body.append(back);
  back.querySelector('.mact .btn').focus();
}

// ---------- presentation ----------
function present() {
  if (document.querySelector('.modal-back')) return;
  const slides = []; const go = (n, path) => { slides.push({ n, path }); n.kids.forEach((k) => go(k, [...path, n.text])); }; go(doc.root, []);
  let i = Math.max(0, slides.findIndex((s) => s.n.id === sel));
  const crumb = h('div', { class: 'pcrumb' });
  const body = h('div', { class: 'pbody', tabindex: '-1' });
  const counter = h('span', { class: 'pcount' });
  const pv = h('button', { class: 'pbtn', title: 'Previous topic (Left)', 'aria-label': 'Previous topic', onclick: () => step(-1) }, icon('prev', 24));
  const nx = h('button', { class: 'pbtn', title: 'Next topic (Right)', 'aria-label': 'Next topic', onclick: () => step(1) }, icon('next', 24));
  const back = h('div', { class: 'modal-back pres', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Presentation' },
    h('div', { class: 'ptop' }, crumb, h('button', { class: 'pbtn', title: 'Stop presenting (Esc)', 'aria-label': 'Stop presenting', onclick: () => close() }, icon('close', 24))),
    body,
    h('div', { class: 'pfoot' }, pv, counter, nx, h('span', { class: 'phint', text: 'Arrows to move, Esc to stop' })));
  const draw = () => {
    const { n, path } = slides[i]; body.textContent = '';
    crumb.textContent = path.length ? path.join('  ›  ') : doc.title;
    body.append(h('div', { class: 'ptitle2', text: (n.icon ? n.icon + '  ' : '') + n.text }));
    if (n.note) body.append(h('div', { class: 'pnote2', text: n.note }));
    if (n.kids.length) body.append(h('div', { class: 'pkids' }, n.kids.map((k) => h('div', { class: 'pkid', text: (k.icon ? k.icon + '  ' : '') + k.text }))));
    counter.textContent = `${i + 1} / ${slides.length}`;
    pv.disabled = i === 0; nx.disabled = i === slides.length - 1;
  };
  const step = (d) => { i = clamp(i + d, 0, slides.length - 1); draw(); };
  const key = (e) => {
    if (e.key === 'Tab') return; // the dialog focus trap handles Tab
    // Enter or Space on a focused button (Previous, Next, Stop presenting) presses that button
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('button') && back.contains(e.target)) { e.stopPropagation(); return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); i = 0; draw(); }
    else if (e.key === 'End') { e.preventDefault(); i = slides.length - 1; draw(); }
    e.stopPropagation();
  };
  let closed = false;
  const close = () => { if (closed) return; closed = true; document.removeEventListener('keydown', key, true); back.remove(); };
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', key, true); document.body.append(back); draw(); body.focus();
}

// sample map
(function sample() {
  const m = (t, ...k) => { const n = mk(t); n.kids = k; return n; };
  doc.root = m('Launch plan', m('Research', m('Customers'), m('Competitors'), m('Pricing')), m('Product', m('Core features'), m('Beta feedback')), m('Marketing', m('Website'), m('Announcement')), m('Team', m('Roles'), m('Schedule')));
  doc.title = 'Launch plan'; sel = doc.root.id;
})();
render(); setTimeout(fit, 30);
window.addEventListener('resize', fit);
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (document.querySelector('.modal-back')) return; // not while a dialog is open
  const f = [...(e.dataTransfer?.files || [])].find((x) => /.(branchout|json)$/i.test(x.name)); if (!f) { toast('Drop a .branchout file to open it'); return; }
  openDoc({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
});

savedSnap = snapshot(); renderStatus();
// closing the window with unsaved changes: main.js asks (will-prevent-unload)
window.addEventListener('beforeunload', (e) => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } });
