# Branchout: Google-style UI + full bug sweep

Spec: the user's standing request (Thai): "Fix every bug by trying hard to break the app. Make the UI look very much like
Google's own apps (NotebookLM, AI Studio, Gemini): bars, icons, layout, theme; decide which categories belong in the bar."
Then, after Chartout shipped with this treatment, the user chose "branchout" as the next app. Rulings are provisional and
logged in D:/Lookout-apps/NOTES.md.

## Global Constraints

- App: D:/Lookout-apps/branchout (Electron mind-map app, plain JS, no build step). Files: main.js, preload.js,
  renderer/index.html, renderer/kit.js, renderer/lookout.css (shared base, identical across apps: keep it unchanged),
  renderer/app.css, renderer/app.js.
- Style reference: D:/Lookout-apps/chartout/renderer (finished this week with the same treatment) and chartout/main.js
  (will-prevent-unload handler, atomic write with fsync and retry, plain error messages).
- CSP in index.html stays: no external fonts, scripts or images. Icons are inline SVG (Material Symbols Outlined path
  data allowed, Apache-2.0).
- The .branchout file format must not change in a breaking way, and opening a VALID file written by any older version
  must never alter its content (no caps, trimming or dropping that a real old file could hit). If anything is repaired
  on load, mark the map unsaved and say so. App stays offline. UI text plain English, short, no emoji.
- Test harness: D:/Lookout-apps/_tools/multi-main.js with env LK_APP, LK_STEPS, LK_LOG, LK_USERDATA (fresh dir under
  _tools/test/), LK_RESLEN, LK_OPEN, LK_SAVE, LK_MSGBOX, and a {winclose:true} step. Without dialog stubs a real dialog
  opens and the run hangs. See _tools/run-chart-gui.sh, _tools/run-chart-bugs.sh and their step files for the pattern.
  Never kill electron processes you did not start (the Claude app is one).
- Commit on branch google-ui. Do not push, release or bump the version.

## Task 1: Google-style UI

- Top app bar ~56px: product mark + "Branchout", editable map title, 40px Material icon buttons with tooltips and
  aria-labels (new, open, undo, redo, present, outline, shortcuts), Export menu (PNG, SVG, outline text), primary pill
  "Save".
- Canvas in a rounded surface (radius ~16px, ~8px gutters); right "Details" panel as a rounded surface, collapsible,
  with sections: Layout (4 layouts as visual choices), Topic text, Color, Icon, Notes.
- Floating Google-style toolbar at the bottom of the canvas: Add child, Add sibling, Edit, Collapse, Expand all, Delete,
  zoom out / percent / zoom in / Fit. Fit must never leave topics hidden under floating bars.
- Material 3 dark dialogs, menus, inputs, toasts. Presentation mode restyled to match. Keyboard shortcuts dialog.
- Every existing function stays reachable. Keyboard shortcuts (Tab, Enter, F2, Delete, Space, arrows, Ctrl+Z/Y/S/O)
  must keep working after clicking any button or toolbar item (blur on mouse click, keep keyboard activation), and
  clicking a toolbar button ends editing in text fields. Works at 900x600.
- GUI harness st-branch-gui.js (PASS/FAIL lines), runner _tools/run-branch-gui.sh, screenshots
  _tools/test/out/branch-gui-*.png (before and after).

## Task 2: Break-it bug sweep

Try hard to break Branchout; for each bug write a failing harness step first, then fix. Cover at least: unsaved-changes
guard on New / Open / drop a file / window close (main.js has no will-prevent-unload handler, so check the window can
close and that it asks); pending text in dialogs or fields on close and save; save integrity (atomic, read-only target,
save/reopen round trip equality including Thai and emoji); hostile files (empty, not JSON, wrong types, missing root,
duplicate ids, very deep trees: cleanNode drops children below depth 60, which would silently lose data); undo/redo
(clicks and unchanged edits must not add steps or clear redo; typing in topic and notes fields; title; layout);
deleting and collapsing with selection; arrow navigation in all four layouts; adding under collapsed topics; very long
words and Thai wrapping; zoom and Fit extremes; export PNG/SVG fidelity (selection outline, fold buttons, dark text on
white, huge maps, notes marker); presentation mode keys; outline export; shortcuts while typing, with dialogs open and
with a Thai keyboard layout; stacked dialogs; 500+ topics performance; seeded fuzzer with invariants (no console errors,
unique ids, undo-all returns to start, redo-all to end, save/reopen equals).
