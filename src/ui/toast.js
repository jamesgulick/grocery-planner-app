// The confirmation bar (toast) — brief standing rules, 11/17: one shared bar, app-wide. Anything
// can call showToast(text, undo?); the one <ToastHost/> in the app root shows it. One at a time:
// a new one replaces the old. With `undo`, the bar carries an "Undo" button that runs it.
let listener = null, seq = 0;
export function showToast(text, undo) { listener?.({ id: ++seq, text, undo: typeof undo === "function" ? undo : null }); }
export function bindToast(fn) { listener = fn; return () => { if (listener === fn) listener = null; }; }
