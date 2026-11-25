// Inventory's place tabs (decisions 11/12 "Sub-steps", board "Plan, inventory"): the segmented
// look (white segment on a grey track); 4+ parts scroll inside the track with ‹ › at the ends.
// The chevrons only scroll, grey at the ends, hidden when everything fits. Done places get a ✓.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function LocTabs({ locs, value, doneUpTo, onChange }) {
  const scroller = useRef(null);
  const [edge, setEdge] = useState({ fits: true, start: true, end: true });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({ fits: max <= 1, start: el.scrollLeft <= 1, end: el.scrollLeft >= max - 1 });
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  // Keep the chosen place in view (sideways only: the page never moves).
  useLayoutEffect(() => {
    const el = scroller.current, tab = el?.children[value];
    if (!el || !tab) return;
    const left = tab.offsetLeft - el.children[0].offsetLeft, right = left + tab.offsetWidth;   // from the scroller's own start
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    measure();
  }, [value, locs.length, measure]);
  const nudge = dir => { const el = scroller.current; if (el) el.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: "smooth" }); };

  return (
    <div className={edge.fits ? "loc-tabs fits" : "loc-tabs"}>
      {!edge.fits && <button type="button" className="loc-chev" aria-label="Scroll places left" disabled={edge.start} onClick={() => nudge(-1)}>‹</button>}
      <div ref={scroller} className={edge.end ? "loc-scroll" : "loc-scroll is-more"} role="tablist" aria-label="Places" onScroll={measure}>
        {locs.map((l, i) => (
          <button key={l} type="button" role="tab" aria-selected={i === value} className="loc-tab" onClick={() => onChange(i)}>
            {i <= doneUpTo && i !== value && <span className="plan-sub-done" aria-label="done">✓</span>}{l}
          </button>
        ))}
      </div>
      {!edge.fits && <button type="button" className="loc-chev" aria-label="Scroll places right" disabled={edge.end} onClick={() => nudge(1)}>›</button>}
    </div>
  );
}
