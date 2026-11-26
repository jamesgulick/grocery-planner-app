// The confirmation bar's host (brief standing rules, 11/17). Mounted once in the app root. A dark
// bar, 16 from each side, floating just above the bottom chrome: the tab bar (and a screen's
// action bar over it), or a sheet's footer when a sheet is open. About 2 s, or 5 s with Undo.
import { useEffect, useLayoutEffect, useState } from "react";
import { bindToast } from "./toast.js";

const PLAIN_MS = 2000, UNDO_MS = 5000;

// How far up the bar sits: above the highest fixed bar at the bottom of the screen. The screen's
// bottom is read from the live region (fixed, bottom 0) in the same coordinates as the bars, not
// window.innerHeight, which an iPhone Home Screen app reports stale after a resume (11/23).
function bottomOffset() {
  const live = document.querySelector(".ui-toast-live");
  const h = live ? live.getBoundingClientRect().bottom : window.innerHeight;
  const sheet = document.querySelector(".ui-sheet");
  let top = h;
  if (sheet) {
    const footer = sheet.querySelector(".ui-sheet-footer");
    top = footer ? footer.getBoundingClientRect().top
      : sheet.getBoundingClientRect().bottom - parseFloat(getComputedStyle(sheet).paddingBottom || "0");   // above the safe area
  } else {
    // The floating things themselves, not the fade behind them (11/22).
    for (const el of document.querySelectorAll(".ui-tabbar-capsule, .ui-tab-plus, .ui-actionbar-inner")) top = Math.min(top, el.getBoundingClientRect().top);
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
  // While it shows, a sheet opening or closing moves it (audit 11/25): a bar fired in a sheet that
  // then closes drops to its page position, 8px above the floating pills or the tab bar.
  useEffect(() => {
    if (!toast) return;
    const obs = new MutationObserver(() => setBottom(bottomOffset()));
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [toast]);
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
