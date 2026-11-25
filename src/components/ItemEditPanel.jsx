// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { useState } from "react";
import { INVENTORY_LOCS } from "../app/globals.js";
import { C, S } from "../app/styles.js";
import { BUY_OPTIONS, buyOf, buyPatch } from "../library/libraryModel.js";
import { Chip } from "../ui/kit.jsx";

// "⋯ edit item" (VALIDATION-LOG 10/27): fix an item's profile where it's noticed while
// planning (Inventory, Confirm): how often it's bought, where it's kept, its USUAL
// amount. Writes the item itself; this week's amount stays the amount button's job,
// and the panel says so when the two differ.
// Inventory item panel (brief §5, 11/24): the panel is part of its row (no line between them;
// the row's line goes under the panel), Buy uses the item page's words, chips are tag chips
// (pale green + ✓ when chosen), and "All details ›" (when `onDetails` is given) opens the
// item page.
function ItemEditPanel({ ing, thisWeek, onUpdate, onClose, onDetails }) {
  const [usual, setUsual] = useState(ing.defaultQuantity || "");
  const commitUsual = () => { const v = usual.trim(); if (v !== (ing.defaultQuantity || "")) onUpdate({ defaultQuantity: v }); };
  const label = t => <div className="ui-section-label item-panel-label">{t}</div>;
  const chip = (active, text, onClick) => <Chip key={text} on={active} onClick={onClick}>{text}</Chip>;
  const locs = ing.storageLocation === "Unassigned" ? ["Unassigned", ...INVENTORY_LOCS] : INVENTORY_LOCS;
  return (
    <div className="item-panel" style={{ borderBottom:`1px solid ${C.border}` }}>
      <div className="item-panel-head">
        {label("Buy")}
        {onDetails && <button type="button" className="item-panel-details" onClick={() => { commitUsual(); onDetails(); }}>All details ›</button>}
      </div>
      <div className="item-panel-chips">
        {BUY_OPTIONS.map(o => chip(buyOf(ing) === o.value, o.label, () => onUpdate(buyPatch(o.value))))}
      </div>
      {label("Where it's kept")}
      <div className="item-panel-chips">
        {locs.map(l => chip(ing.storageLocation === l, l, () => onUpdate({ storageLocation: l })))}
      </div>
      {label("Usual amount")}
      <input style={{ ...S.input, marginBottom:0, fontSize:13, padding:"6px 8px" }} value={usual} placeholder="e.g. 2 cans" onChange={e => setUsual(e.target.value)} onBlur={commitUsual} onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }} />
      {thisWeek !== undefined && thisWeek !== (ing.defaultQuantity || "") && (
        <div style={{ fontSize:11, color:C.faint, marginTop:4 }}>This week: {thisWeek || "none"}. That's set with the amount button and doesn't change the usual.</div>
      )}
      <div style={{ textAlign:"right", marginTop:8 }}>
        <button style={{ ...S.btnSm, background:C.primary, color:"#fff" }} onClick={() => { commitUsual(); onClose(); }}>Done</button>
      </div>
    </div>
  );
}

export { ItemEditPanel };
