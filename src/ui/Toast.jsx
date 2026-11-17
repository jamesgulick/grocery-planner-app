// The confirmation bar's host (brief standing rules, 11/17). Mounted once in the app root. A dark
// bar, 16 from each side, floating just above the bottom chrome: the tab bar (and a screen's
// action bar over it), or a sheet's footer when a sheet is open. About 2 s, or 5 s with Undo.
import { useEffect, useLayoutEffect, useState } from "react";
import { bindToast } from "./toast.js";

const PLAIN_MS = 2000, UNDO_MS = 5000;

// How far up the bar sits: above the highest fixed bar at the bottom of the screen.
function bottomOffset() {
  const h = window.innerHeight;
  const sheet = document.querySelector(".ui-sheet");
  let top = h;
  if (sheet) {
    const footer = sheet.querySelector(".ui-sheet-footer");
    top = footer ? footer.getBoundingClientRect().top
      : sheet.getBoundingClientRect().bottom - parseFloat(getComputedStyle(sheet).paddingBottom || "0");   // above the safe area
  } else {
    for (const el of document.querySelectorAll(".ui-tabbar, .ui-actionbar")) top = Math.min(top, el.getBoundingClientRect().top);
  }
  return Math.max(0, h - top);
}

export function ToastHost() {
  const [toast, setToast] = useState(null);
  const [bottom, setBottom] = useState(0);
  useEffect(() => bindToast(setToast), []);
  // Measured after the screen has updated (before paint): an action that shows a bar and closes
  // its sheet in the same tap must place the bar for the screen left behind, not the sheet.
  useLayoutEffect(() => { if (toast) setBottom(bottomOffset()); }, [toast]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.undo ? UNDO_MS : PLAIN_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return <div role="status" className="ui-toast-live" />;
  return (
    <div role="status" className="ui-toast-live">
      <div key={toast.id} className="ui-toast" style={{ bottom: `calc(${bottom}px + var(--space-2))` }}>
        <span className="ui-toast-text">{toast.text}</span>
        {toast.undo && <button type="button" className="ui-toast-undo" onClick={() => { const u = toast.undo; setToast(null); u(); }}>Undo</button>}
      </div>
    </div>
  );
}
