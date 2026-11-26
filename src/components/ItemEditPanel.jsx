// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { useState } from "react";
import { INVENTORY_LOCS } from "../app/globals.js";
import { BUY_OPTIONS, buyOf, buyPatch } from "../library/libraryModel.js";
import { Chip, RowAction } from "../ui/kit.jsx";

// "⋯ edit item" (VALIDATION-LOG 10/27): fix an item's profile where it's noticed while
// planning (Inventory, Confirm): how often it's bought, where it's kept, its USUAL
// amount. Writes the item itself; this week's amount stays the row's amount pill.
// Inventory item panel (brief §5, 11/24): the panel is part of its row (no line between them;
// the row's line goes under the panel), Buy uses the item page's words, chips are tag chips
// (pale green + ✓ when chosen), and "All details ›" (when `onDetails` is given) opens the
// item page.
// With `pending` / `setPending` (Inventory, Confirm), Buy and Where it's kept are held as a choice and
// the parent applies them when the panel closes, so the item only moves to its new section or
// place after Done (11/24). Without them a chip saves at once.
function ItemEditPanel({ ing, onUpdate, onClose, onDetails, pending, setPending }) {
  const cur = pending ? { ...ing, ...pending } : ing;
  const choose = patch => (setPending ? setPending({ ...(pending || {}), ...patch }) : onUpdate(patch));
  const [usual, setUsual] = useState(ing.defaultQuantity || "");
  // Held mode: the usual amount rides along in the one save that closes the panel.
  const usualPatch = () => { const v = usual.trim(); return v !== (ing.defaultQuantity || "") ? { defaultQuantity: v } : {}; };
  const commitUsual = () => { const v = usual.trim(); if (v !== (ing.defaultQuantity || "")) onUpdate({ defaultQuantity: v }); };
  const label = t => <div className="ui-section-label item-panel-label">{t}</div>;
  const chip = (active, text, onClick) => <Chip key={text} on={active} onClick={onClick}>{text}</Chip>;
  const locs = ing.storageLocation === "Unassigned" ? ["Unassigned", ...INVENTORY_LOCS] : INVENTORY_LOCS;
  return (
    <div className="item-panel">
      <div className="item-panel-head">
        {label("Buy")}
        {onDetails && <button type="button" className="item-panel-details" onClick={() => { if (setPending) onDetails(usualPatch()); else { commitUsual(); onDetails(); } }}>All details ›</button>}
      </div>
      <div className="item-panel-chips">
        {BUY_OPTIONS.map(o => chip(buyOf(cur) === o.value, o.label, () => choose(buyPatch(o.value))))}
      </div>
      {label("Where it's kept")}
      <div className="item-panel-chips">
        {locs.map(l => chip(cur.storageLocation === l, l, () => choose({ storageLocation: l })))}
      </div>
      {label("Usual amount")}
      <input className="ui-input item-panel-input" aria-label="Usual amount" value={usual} placeholder="e.g. 2 cans" onChange={e => setUsual(e.target.value)} onBlur={commitUsual} onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }} />
      <div className="item-panel-foot">
        <RowAction onClick={() => { if (setPending) onClose(usualPatch()); else { commitUsual(); onClose(); } }}>Done</RowAction>
      </div>
    </div>
  );
}

export { ItemEditPanel };

// The row's ⋯; while its panel is open, a green ✓ in a small pale-green circle in the same
// place and tap area, which closes and saves like Done (brief "Inventory item panel", 11/25).
export function MoreButton({ open, name, onClick }) {
  return open
    ? <button type="button" className="cf-more is-done" aria-label={`Done with ${name}`} onClick={onClick}><span className="cf-done-dot" aria-hidden="true">✓</span></button>
    : <button type="button" className="cf-more" aria-label={`Edit ${name}`} onClick={onClick}>⋯</button>;
}
