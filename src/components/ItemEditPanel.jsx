// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { useState } from "react";
import { INVENTORY_LOCS, tierOptions, tierValueOf } from "../app/globals.js";
import { C, S } from "../app/styles.js";

// "⋯ edit item" (VALIDATION-LOG 10/27): fix an item's profile where it's noticed while
// planning (Inventory, Confirm): how often it's bought, where it's kept, its USUAL
// amount. Writes the item itself; this week's amount stays the amount button's job,
// and the panel says so when the two differ.
function ItemEditPanel({ ing, thisWeek, onUpdate, onClose }) {
  const [usual, setUsual] = useState(ing.defaultQuantity || "");
  const commitUsual = () => { const v = usual.trim(); if (v !== (ing.defaultQuantity || "")) onUpdate({ defaultQuantity: v }); };
  const label = t => <div style={{ fontSize:11, color:C.muted, fontWeight:600, margin:"8px 0 4px" }}>{t}</div>;
  const chip = (active, text, onClick) => (
    <button key={text} style={{ ...S.btnSm, padding:"3px 8px", fontSize:11, background:active ? C.primary : "#fff", color:active ? "#fff" : C.muted, border:`1px solid ${active ? C.primary : C.border}` }} onClick={onClick}>{text}</button>
  );
  const locs = ing.storageLocation === "Unassigned" ? ["Unassigned", ...INVENTORY_LOCS] : INVENTORY_LOCS;
  return (
    <div style={{ margin:"2px 0 10px", padding:"6px 10px 10px", background:"#FAFAFA", border:`1px solid ${C.border}`, borderRadius:8 }}>
      {label("How often")}
      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
        {tierOptions().map(o => chip(tierValueOf(ing) === o.value, o.label, () => onUpdate({ tier: o.tier, stapleType: o.subtype || undefined })))}
      </div>
      {label("Where it's kept")}
      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
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
