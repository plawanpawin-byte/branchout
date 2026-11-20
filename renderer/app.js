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
const toast = (m) => { const t = h('div', { class: 'toast', text: m }); document.body.append(t); setTimeout(() => t.remove(), 2400); };

// ---------- model ----------
// node: { id, text, kids:[], collapsed, color, note }
const COLORS = ['#cfcfcf', '#ffffff', '#9a9a9a', '#6b6b6b', '#d9e0e6', '#e6e0d2', '#dce6dc', '#e8d9d9'];
let doc = { title: 'Untitled', layout: 'map', root: mk('Central idea') };
let sel = null;
let undoS = [], redoS = [];
let zoom = 1, panX = 0, panY = 0, fileName = '';
const ICONS = ['\u2605', '\u2713', '!', '?', '\u2691', '\u2665', '\u263C', '\u270E', '\u260E', '\u2699', '\u25B6', '\u2736'];
function mk(text) { return { id: uid(), text, kids: [], collapsed: false, color: '', note: '', icon: '' }; }
const snapshot = () => JSON.stringify(doc);
function commit() { undoS.push(snapshot()); if (undoS.length > 100) undoS.shift(); redoS = []; }
function undo() { if (!undoS.length) return; redoS.push(snapshot()); doc = JSON.parse(undoS.pop()); fixSel(); render(); }
function redo() { if (!redoS.length) return; undoS.push(snapshot()); doc = JSON.parse(redoS.pop()); fixSel(); render(); }
function fixSel() { if (!sel || !find(sel)) sel = doc.root.id; }
function find(id, n = doc.root, parent = null) { if (n.id === id) return { n, parent }; for (const k of n.kids) { const r = find(id, k, n); if (r) return r; } return null; }

// ---------- UI shell ----------
const app = $('#app');
const toolbar = h('div', { class: 'toolbar' });
const stage = h('div', { class: 'stage', style: 'overflow:hidden;position:relative' });
const right = h('div', { class: 'sidebar right' });
const status = h('div', { class: 'status' });
app.append(toolbar, h('div', { class: 'main' }, stage, right), status);
const btn = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn, text: label });
toolbar.append(btn('New', newDoc), btn('Open', openDoc), btn('Save', saveDoc, 'primary'), h('span', { class: 'sep' }),
  btn('Add child', addChild), btn('Add sibling', addSibling), btn('Delete', del), btn('Edit', editSel), h('span', { class: 'sep' }),
  btn('Collapse', toggleCollapse), btn('Expand all', () => { commit(); walk(doc.root, (n) => (n.collapsed = false)); render(); }), h('span', { class: 'sep' }),
  btn('Undo', undo), btn('Redo', redo), h('span', { class: 'sep' }),
  btn('-', () => zoomBy(1 / 1.2), 'icon'), btn('+', () => zoomBy(1.2), 'icon'), btn('Fit', fit), h('span', { class: 'grow' }),
  btn('Present', present), btn('Outline', showOutline), btn('Export PNG', () => exportImg('png')), btn('Export SVG', () => exportImg('svg')));

const svg = sv('svg', { width: '100%', height: '100%', style: 'display:block;touch-action:none' });
const world = sv('g');
svg.append(world); stage.append(svg);

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
function wrapText(text, maxW) {
  const out = [];
  for (const p of text.split('\n')) {
    let line = '';
    for (const w of p.split(' ')) { const t = line ? line + ' ' + w : w; if (meas.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
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
let lastBounds = { x: 0, y: 0, w: 100, h: 100 };
function render() {
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
        gl.append(sv('path', { d: `M${parent._cx} ${sy}C${parent._cx} ${my} ${n._cx} ${my} ${n._cx} ${ey}`, fill: 'none', stroke: '#8a8a8a', 'stroke-width': Math.max(1.4, 3.2 - n._d * 0.6), 'stroke-linecap': 'round' })); }
      else {
      const dir = n._dir; const sx = dir === 1 ? parent._x + parent._w : parent._x, ex = dir === 1 ? n._x : n._x + n._w;
      const mx = (sx + ex) / 2;
      gl.append(sv('path', { d: `M${sx} ${parent._cy}C${mx} ${parent._cy} ${mx} ${n._cy} ${ex} ${n._cy}`, fill: 'none', stroke: '#8a8a8a', 'stroke-width': Math.max(1.4, 3.2 - n._d * 0.6), 'stroke-linecap': 'round' }));
      }
    }
    const g = sv('g', { 'data-id': n.id, style: 'cursor:pointer' });
    const fill = n.color || (n._d === 0 ? '#e4e4e4' : n._d === 1 ? '#bdbdbd' : '#3a3a3a');
    const dark = n.color ? lum(n.color) < 140 : n._d >= 2;
    g.append(sv('rect', { x: n._x, y: top, width: n._w, height: n._h, rx: n._d === 0 ? n._h / 2 : 8, fill, stroke: sel === n.id ? '#ffffff' : n._d >= 2 ? '#6a6a6a' : 'none', 'stroke-width': sel === n.id ? 2.5 : 1 }));
    const t = sv('text', { 'text-anchor': 'middle', fill: dark ? '#f0f0f0' : '#1a1a1a', 'font-size': n._fs, 'font-weight': n._d < 2 ? 600 : 400, 'font-family': 'Segoe UI, Arial, sans-serif', style: 'pointer-events:none' });
    const tcx = n._x + n._w / 2 + (n.icon ? 12 : 0);
    n._lines.forEach((ln, i) => { const ts = sv('tspan', { x: tcx, y: n._cy - ((n._lines.length - 1) * n._fs * 1.25) / 2 + i * n._fs * 1.25 + n._fs * 0.35 }); ts.textContent = ln; t.append(ts); });
    g.append(t);
    if (n.icon) { const ic = sv('text', { x: n._x + 14, y: n._cy + n._fs * 0.35, 'text-anchor': 'middle', fill: dark ? '#f0f0f0' : '#1a1a1a', 'font-size': n._fs + 2, 'font-family': 'Segoe UI Symbol, Segoe UI, Arial, sans-serif', style: 'pointer-events:none' }); ic.textContent = n.icon; g.append(ic); }
    if (n.note) { const c = sv('circle', { cx: n._x + n._w - 4, cy: top + 4, r: 4, fill: '#e4e4e4', stroke: '#222' }); g.append(c); }
    if (n.kids.length) {
      const dn = doc.layout === 'down'; const bx = dn ? n._cx : n._dir === -1 ? n._x - 10 : n._x + n._w + 10, by = dn ? n._cy + n._h / 2 + 10 : n._cy; if (n._d > 0 || dn) {
        const side = (n._d === 0 && !dn) ? null : bx;
        if (side != null) { const b = sv('g', { 'data-fold': n.id, style: 'cursor:pointer' }); b.append(sv('circle', { cx: bx, cy: by, r: 7, fill: '#2b2b2b', stroke: '#8a8a8a' })); const tx = sv('text', { x: bx, y: by + 4, 'text-anchor': 'middle', fill: '#e0e0e0', 'font-size': 11 }); tx.textContent = n.collapsed ? '+' : '-'; b.append(tx); gn.append(b); }
      }
    }
    gn.append(g);
    if (!n.collapsed) n.kids.forEach((k) => draw(k, n));
  };
  draw(doc.root, null);
  lastBounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  applyView(); renderRight(); renderStatus();
}
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
function applyView() { world.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`); }
function zoomBy(f, cx, cy) { const r = svg.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2; const nz = clamp(zoom * f, 0.2, 4); panX = cx - (cx - panX) * (nz / zoom); panY = cy - (cy - panY) * (nz / zoom); zoom = nz; applyView(); renderStatus(); }
function fit() { const r = svg.getBoundingClientRect(); const b = lastBounds; zoom = clamp(Math.min((r.width - 80) / b.w, (r.height - 80) / b.h), 0.2, 1.5); panX = (r.width - b.w * zoom) / 2 - b.x * zoom; panY = (r.height - b.h * zoom) / 2 - b.y * zoom; applyView(); renderStatus(); }
function count(n) { return 1 + n.kids.reduce((t, k) => t + count(k), 0); }
function renderStatus() { status.textContent = ''; status.append(h('span', { text: fileName || 'Untitled' }), h('span', { class: 'grow' }), h('span', { text: count(doc.root) + ' topics' }), h('span', { text: Math.round(zoom * 100) + '%' })); }
function renderRight() {
  right.textContent = '';
  right.append(h('h3', { text: 'Map' }), h('label', { class: 'field' }, 'Title', h('input', { type: 'text', value: doc.title, oninput: (e) => { doc.title = e.target.value; } })));
  const lsel = h('select', { onchange: (e) => { commit(); doc.layout = e.target.value; render(); setTimeout(fit, 0); } }, ...[['map', 'Map (both sides)'], ['right', 'Tree to the right'], ['left', 'Tree to the left'], ['down', 'Org chart (down)']].map(([v, t]) => h('option', { value: v, text: t, selected: (doc.layout || 'map') === v })));
  right.append(h('label', { class: 'field' }, 'Layout', lsel));
  const f = sel && find(sel); if (!f) return; const n = f.n;
  right.append(h('h3', { text: 'Topic' }));
  const ta = h('textarea', { rows: 3, style: 'width:100%' }); ta.value = n.text; ta.addEventListener('focus', commit, { once: true }); ta.addEventListener('input', () => { n.text = ta.value; layoutOnly(); });
  right.append(ta);
  right.append(h('h3', { text: 'Color' }), h('div', { class: 'swatches' }, [h('button', { title: 'Default', style: 'background:#2b2b2b', onclick: () => { commit(); n.color = ''; render(); } }), ...COLORS.map((c) => h('button', { style: `background:${c}`, onclick: () => { commit(); n.color = c; render(); } }))]));
  right.append(h('h3', { text: 'Icon' }), h('div', { class: 'swatches' }, [h('button', { title: 'None', style: 'background:#2b2b2b;color:#aaa;font-size:12px', text: '\u00D7', onclick: () => { commit(); n.icon = ''; render(); } }), ...ICONS.map((c) => h('button', { style: 'background:#333;color:#e8e8e8;font-size:14px', text: c, class: n.icon === c ? 'on' : '', onclick: () => { commit(); n.icon = c; render(); } }))]));
  const note = h('textarea', { rows: 4, style: 'width:100%', placeholder: 'Notes' }); note.value = n.note; note.addEventListener('focus', commit, { once: true }); note.addEventListener('input', () => { n.note = note.value; });
  note.addEventListener('blur', render);
  right.append(h('h3', { text: 'Notes' }), note);
  right.append(h('h3', { text: 'Shortcuts' }), h('div', { class: 'muted', style: 'font-size:12px;line-height:1.6', text: 'Tab: add child\nEnter: add sibling\nF2 or double-click: edit\nDelete: remove\nSpace: fold\nArrows: move selection\nScroll: pan. Ctrl+scroll: zoom' }));
  right.lastChild.style.whiteSpace = 'pre-line';
}
function layoutOnly() { render2(); }
function render2() { const keep = document.activeElement; render(); /* keep typing focus */ if (keep && keep.tagName === 'TEXTAREA') { const t = $('.sidebar.right textarea'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } } }

// ---------- actions ----------
function addChild() { const f = find(sel); if (!f) return; commit(); const k = mk('New topic'); f.n.kids.push(k); f.n.collapsed = false; sel = k.id; render(); setTimeout(editSel, 0); }
function addSibling() { const f = find(sel); if (!f) return; if (!f.parent) return addChild(); commit(); const k = mk('New topic'); f.parent.kids.splice(f.parent.kids.indexOf(f.n) + 1, 0, k); sel = k.id; render(); setTimeout(editSel, 0); }
function del() { const f = find(sel); if (!f || !f.parent) { toast('The central topic cannot be deleted'); return; } commit(); const i = f.parent.kids.indexOf(f.n); f.parent.kids.splice(i, 1); sel = (f.parent.kids[i] || f.parent.kids[i - 1] || f.parent).id; render(); }
function toggleCollapse() { const f = find(sel); if (!f || !f.n.kids.length) return; commit(); f.n.collapsed = !f.n.collapsed; render(); }
function editSel() {
  const f = find(sel); if (!f) return; const n = f.n;
  const ta = h('textarea', { rows: 3, style: 'width:320px' }); ta.value = n.text;
  const done = () => { commit(); n.text = ta.value.trim() || 'Topic'; back.remove(); render(); };
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('h2', { text: 'Edit topic' }), ta, h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Cancel', () => back.remove()), btn('OK', done, 'primary'))));
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(); } if (e.key === 'Escape') back.remove(); });
  document.body.append(back); ta.focus(); ta.select();
}
function newDoc() { if (count(doc.root) > 1 && !confirm('Discard the current map?')) return; doc = { title: 'Untitled', layout: 'map', root: mk('Central idea') }; sel = doc.root.id; undoS = []; redoS = []; fileName = ''; render(); fit(); }
function move(key) {
  const f = find(sel); if (!f) return; const n = f.n;
  const dirOf = n._dir || 1; // side of the root
  let target = null;
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const sibs = f.parent ? f.parent.kids.filter((k) => !f.parent.collapsed) : [n]; const i = sibs.indexOf(n);
    target = sibs[i + (key === 'ArrowDown' ? 1 : -1)];
  } else if (!f.parent) {
    const kids = n.kids; if (kids.length) target = key === 'ArrowRight' ? kids[0] : kids[Math.ceil(kids.length / 2)] || null;
  } else {
    const toward = key === 'ArrowRight' ? 1 : -1;
    if (toward === dirOf) target = !n.collapsed && n.kids[0]; else target = f.parent;
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
  if (e.target.matches('input,textarea')) return;
  const k = e.key;
  if (k === 'Tab') { e.preventDefault(); addChild(); }
  else if (k === 'Enter') { e.preventDefault(); addSibling(); }
  else if (k === 'F2') editSel();
  else if (k === 'Delete' || k === 'Backspace') del();
  else if (k === ' ') { e.preventDefault(); toggleCollapse(); }
  else if (k.startsWith('Arrow')) { e.preventDefault(); move(k); }
  else if (e.ctrlKey && k.toLowerCase() === 'z') { e.shiftKey ? redo() : undo(); e.preventDefault(); }
  else if (e.ctrlKey && k.toLowerCase() === 'y') { redo(); e.preventDefault(); }
  else if (e.ctrlKey && k.toLowerCase() === 's') { saveDoc(); e.preventDefault(); }
  else if (e.ctrlKey && k.toLowerCase() === 'o') { openDoc(); e.preventDefault(); }
});

// ---------- files / export ----------
function toOutline(n, d = 0) { return '  '.repeat(d) + '- ' + n.text.replace(/\n/g, ' ') + '\n' + (n.note ? '  '.repeat(d + 1) + '> ' + n.note.replace(/\n/g, ' ') + '\n' : '') + n.kids.map((k) => toOutline(k, d + 1)).join(''); }
function showOutline() {
  const ta = h('textarea', { rows: 16, style: 'width:480px;font-family:Consolas,monospace', readonly: true }); ta.value = toOutline(doc.root);
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('h2', { text: 'Outline' }), ta, h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Close', () => back.remove()),
    btn('Save as text', async () => { const r = await window.host.saveFile({ name: (doc.title || 'map') + '.md', filters: [['Markdown', ['md', 'txt']]], data: new TextEncoder().encode(toOutline(doc.root)) }); if (r) toast('Saved ' + r.name); }, 'primary'))));
  document.body.append(back);
}
const cleanNode = (n, depth = 0) => ({ id: String(n.id || uid()), text: String(n.text ?? ''), collapsed: !!n.collapsed, color: /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : '', note: String(n.note || ''), icon: ICONS.includes(n.icon) ? n.icon : '', kids: depth > 60 || !Array.isArray(n.kids) ? [] : n.kids.map((k) => cleanNode(k, depth + 1)) });
async function openDoc(dropped) {
  const f = (dropped && dropped.data) ? dropped : (await window.host.openFiles({ filters: [['Branchout map', ['branchout', 'json']]] }))[0]; if (!f) return;
  try { const d = JSON.parse(new TextDecoder().decode(f.data)); if (!d.root) throw new Error('Not a Branchout file'); doc = { title: String(d.title || 'Untitled'), layout: ['map', 'right', 'left', 'down'].includes(d.layout) ? d.layout : 'map', root: cleanNode(d.root) }; fileName = f.name; sel = doc.root.id; undoS = []; redoS = []; render(); fit(); }
  catch (e) { toast('Cannot open: ' + e.message); }
}
async function saveDoc() {
  const clean = (n) => ({ id: n.id, text: n.text, collapsed: n.collapsed, color: n.color, note: n.note, icon: n.icon || '', kids: n.kids.map(clean) });
  const r = await window.host.saveFile({ name: (doc.title || 'map') + '.branchout', filters: [['Branchout map', ['branchout']]], data: new TextEncoder().encode(JSON.stringify({ title: doc.title, layout: doc.layout || 'map', root: clean(doc.root) }, null, 1)) });
  if (r) { fileName = r.name; toast('Saved ' + r.name); renderStatus(); }
}
function exportSvgString() {
  const b = lastBounds, pad = 30;
  const root = sv('svg', { xmlns: NS, width: b.w + pad * 2, height: b.h + pad * 2, viewBox: `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}` });
  root.append(sv('rect', { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, fill: '#ffffff' }));
  const c = world.cloneNode(true); c.removeAttribute('transform');
  c.querySelectorAll('[stroke="#ffffff"]').forEach((n) => n.setAttribute('stroke', 'none'));
  c.querySelectorAll('[data-fold]').forEach((n) => n.remove());
  root.append(c); return { str: new XMLSerializer().serializeToString(root), w: b.w + pad * 2, h: b.h + pad * 2 };
}
async function exportImg(kind) {
  const { str, w, h: hh } = exportSvgString();
  if (kind === 'svg') { const r = await window.host.saveFile({ name: (doc.title || 'map') + '.svg', filters: [['SVG', ['svg']]], data: new TextEncoder().encode(str) }); if (r) toast('Saved ' + r.name); return; }
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str); await img.decode();
  const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = hh * 2; const ctx = cv.getContext('2d'); ctx.scale(2, 2); ctx.drawImage(img, 0, 0, w, hh);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const res = await window.host.saveFile({ name: (doc.title || 'map') + '.png', filters: [['PNG image', ['png']]], data: new Uint8Array(await blob.arrayBuffer()) });
  if (res) toast('Saved ' + res.name);
}

// ---------- presentation ----------
function present() {
  const slides = []; const go = (n, path) => { slides.push({ n, path }); n.kids.forEach((k) => go(k, [...path, n.text])); }; go(doc.root, []);
  let i = Math.max(0, slides.findIndex((s) => s.n.id === sel));
  const body = h('div', { style: 'max-width:900px;width:100%;padding:40px;display:flex;flex-direction:column;gap:22px' });
  const back = h('div', { class: 'modal-back', style: 'background:#161616;z-index:80' }, body);
  const draw = () => {
    const { n, path } = slides[i]; body.textContent = '';
    body.append(h('div', { class: 'muted', style: 'font-size:13px', text: path.length ? path.join('  \u203A  ') : doc.title }),
      h('div', { style: 'font-size:44px;font-weight:600;line-height:1.15', text: (n.icon ? n.icon + '  ' : '') + n.text }));
    if (n.note) body.append(h('div', { class: 'muted', style: 'font-size:18px;white-space:pre-line', text: n.note }));
    if (n.kids.length) body.append(h('div', { style: 'display:flex;flex-direction:column;gap:10px;font-size:24px' }, n.kids.map((k) => h('div', { text: '\u2022  ' + k.text }))));
    body.append(h('div', { class: 'muted', style: 'font-size:12px;margin-top:20px', text: `${i + 1} / ${slides.length}   Arrows to move, Esc to close` }));
  };
  const key = (e) => { if (e.key === 'Escape') { close(); } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { i = Math.min(slides.length - 1, i + 1); draw(); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { i = Math.max(0, i - 1); draw(); } e.stopPropagation(); };
  const close = () => { document.removeEventListener('keydown', key, true); back.remove(); };
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', key, true); document.body.append(back); draw();
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
  const f = [...(e.dataTransfer?.files || [])].find((x) => /.(branchout|json)$/i.test(x.name)); if (!f) { toast('Drop a .branchout file to open it'); return; }
  openDoc({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
});
