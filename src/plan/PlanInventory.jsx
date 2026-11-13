// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import React, { useEffect, useState } from "react";
import { INVENTORY_LOCS } from "../app/globals.js";
import { multiMealCounts } from "../app/pills.js";
import { C, S } from "../app/styles.js";
import { Check } from "../components/common.jsx";
import { ItemEditPanel } from "../components/ItemEditPanel.jsx";
import { isOrdering } from "./ordering.js";

function PlanInventory({ checkedIds, stapleFlags, setOrdering, quantities, setQuantities, mealPlan, meals, ingredients, onNext, days, onUpdateItem, keptIds = [] }) {
  const [locIdx, setLocIdx] = useState(0);
  const [editId, setEditId] = useState(null);     // item whose "⋯ edit" panel is open
  const [moveNote, setMoveNote] = useState(null); // what happened to an item moved to another location
  const [slowOpen, setSlowOpen] = useState(null);   // slow staples card expanded? null = decide from the data
  useEffect(() => { setMoveNote(null); setEditId(null); setSlowOpen(null); }, [locIdx]);
  const LOCS    = INVENTORY_LOCS;
  const loc     = LOCS[locIdx];

  const plannedNames   = Object.values(mealPlan).flat();
  const plannedMealIds = meals.filter(m => plannedNames.includes(m.name)).map(m => m.id);
  const mealIngIds     = new Set(meals.filter(m => plannedMealIds.includes(m.id)).flatMap(m => m.ingredients||[]));
  const locIngs        = ingredients.filter(i => i.storageLocation === loc);
  const alwaysHere     = locIngs.filter(i => i.tier === "always");
  // Staples split by consumption rate. Unset stapleType defaults to "weekly"
  // (the careful-check bias), so older items and saved DBs keep working.
  const stapleAll      = locIngs.filter(i => i.tier === "staple");
  const weeklyHere     = stapleAll.filter(i => (i.stapleType || "weekly") === "weekly");
  // Slow staples normally coast on a quick scan — UNLESS one is needed for a meal
  // planned this week, in which case it earns the same rigor as a weekly staple.
  const slowAll        = stapleAll.filter(i => (i.stapleType || "weekly") === "slow");
  const slowNeededHere = slowAll.filter(i => mealIngIds.has(i.id));
  const slowHere       = slowAll.filter(i => !mealIngIds.has(i.id));
  // Specialty items show if a planned meal needs them — OR if they've been marked
  // "in cart" during prep (so an off-plan purchase like whole milk still appears
  // here, flagged as In cart, rather than vanishing from the inventory view).
  // keptIds: specialty items chosen to buy this week that no planned meal needs (an item
  // re-filed as specialty while on the list stays on it).
  const mealHere       = locIngs.filter(i => i.tier === "specialty" && (mealIngIds.has(i.id) || keptIds.includes(i.id)));

  // Checked = buying (Phase 1b): every row has the one Check; see ordering.js.
  const st        = { checkedIds, stapleFlags, mealIngIds, keptIds };
  const buying    = ing => isOrdering(ing, st);
  const toggle    = ing => setOrdering(ing, !buying(ing));
  const multiMeal = multiMealCounts(mealPlan, meals);
  // The slow-staples card opens by itself when one is already checked, and then stays open
  // for this location, so unchecking it never snaps the card shut under your finger.
  useEffect(() => { if (!slowOpen && slowHere.some(buying)) setSlowOpen(true); });

  // ingredient id -> names of planned meals that use it (for context on promoted rows)
  const usedByMeal = {};
  meals.filter(m => plannedMealIds.includes(m.id)).forEach(m => {
    (m.ingredients||[]).forEach(id => { (usedByMeal[id] = usedByMeal[id] || []).push(m.name); });
  });

  // Inline per-week quantity editor. Shows the override if set, else the item's
  // defaultQuantity as the starting value. Writes only to the plan's quantities
  // map — never touches the item's defaultQuantity.
  const QtyEdit = ({ ing }) => {
    const override = quantities[ing.id];
    const effective = override !== undefined ? override : (ing.defaultQuantity || "");
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(effective);
    const isCustom = override !== undefined && override !== (ing.defaultQuantity || "");
    if (editing) {
      const commit = () => {
        const v = val.trim();
        setQuantities(prev => {
          const next = { ...prev };
          if (v === "" || v === (ing.defaultQuantity || "")) delete next[ing.id];
          else next[ing.id] = v;
          return next;
        });
        setEditing(false);
      };
      return (
        <input autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          placeholder={ing.defaultQuantity || "qty"}
          style={{ width:72, fontSize:12, padding:"3px 6px", borderRadius:6, border:`1.5px solid ${C.primary}`, outline:"none" }} />
      );
    }
    return (
      <button onClick={() => { setVal(effective); setEditing(true); }}
        style={{ background:isCustom?C.primaryLight:"#fff", border:`1px solid ${isCustom?C.primary:C.border}`, borderRadius:6, padding:"3px 8px", fontSize:12, cursor:"pointer", color:isCustom?C.primary:C.muted, fontWeight:isCustom?700:500, whiteSpace:"nowrap" }}>
        {effective ? `${effective} ✎` : "+ qty"}
      </button>
    );
  };

  // "⋯ edit": fix an item's profile (how often, where kept, usual amount) without
  // leaving the walk. The panel opens under the row; changes persist to the item, so a
  // re-filed item re-sections live. An item moved to ANOTHER location leaves this view,
  // so the note at the top says where it went and whether it's still on the list.
  const updateItem = (ing, patch) => {
    if (!onUpdateItem) return;
    onUpdateItem(ing.id, patch);
    // Re-filed as specialty with no planned meal needing it: specialty items only show
    // when a meal does, so it drops out of the walk. Say so rather than let it vanish.
    // Re-filed as specialty: specialty items only show when a planned meal needs one, or
    // when kept because they were already on the list. Say which, rather than let an
    // unneeded one vanish.
    if (patch.tier === "specialty" && ing.tier !== "specialty" && !mealIngIds.has(ing.id) && !buying(ing)) {
      setEditId(null);
      setMoveNote(`${ing.name} is now specialty. Specialty items only come up when a planned meal needs one, so it's off this week's list.`);
    }
    const to = patch.storageLocation;
    if (to && to !== loc) {
      setEditId(null);
      const toIdx = LOCS.indexOf(to);
      setMoveNote(toIdx >= 0 && toIdx < locIdx
        ? `${ing.name} moved to ${to}. You've already been through ${to}; it's ${buying(ing) ? "still on" : "not on"} this week's list.`
        : toIdx > locIdx ? `${ing.name} moved to ${to}. It'll come up there.` : `${ing.name} moved to ${to}.`);
    }
  };
  const EditBtn = ({ ing }) => !onUpdateItem ? null : (
    <button style={{ background:"none", border:"none", color:editId === ing.id ? C.primary : C.faint, fontSize:18, cursor:"pointer", minWidth:36, minHeight:44, padding:0 }} onClick={() => setEditId(editId === ing.id ? null : ing.id)} aria-label={`Edit ${ing.name}`}>⋯</button>
  );
  const EditPanel = ({ ing }) => editId !== ing.id ? null : (
    <ItemEditPanel ing={ing} thisWeek={quantities[ing.id]} onUpdate={patch => updateItem(ing, patch)} onClose={() => setEditId(null)} />
  );

  // One row shape for every section. `dimOff`: an unchecked always or meal item is a
  // skip, so it dims; an unchecked staple is the normal "have enough", so it doesn't.
  const ItemRow = ({ ing, accent, dimOff }) => {
    const on      = buying(ing);
    const dim     = dimOff && !on;
    // 1 meal -> name context line; 2+ meals -> the ×N badge (never both)
    const usedBy  = !multiMeal[ing.id] && (usedByMeal[ing.id] || []).length === 1 ? usedByMeal[ing.id] : [];
    return (
      <>
      <div style={{ display:"flex", alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${C.border}`, gap:10, cursor:"pointer", opacity:dim?0.45:1, transition:"opacity 0.2s" }} onClick={() => toggle(ing)}>
        <Check checked={on} onChange={v => setOrdering(ing, v)} label={`Buy ${ing.name}`} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:500 }}>{ing.name}{multiMeal[ing.id] && <span style={{ marginLeft:6, fontSize:11, fontWeight:700, color:"#B45309", background:"#FEF3C7", borderRadius:5, padding:"1px 5px" }}>×{multiMeal[ing.id]} meals</span>}</div>
          {usedBy.length > 0 && <div style={{ fontSize:11, color:accent, fontWeight:600 }}>for {usedBy.join(", ")}</div>}
        </div>
        <div onClick={e => e.stopPropagation()} style={{ display:"flex", alignItems:"center", gap:8 }}>
          {!dim && <QtyEdit ing={ing} />}
          <EditBtn ing={ing} />
        </div>
      </div>
      <EditPanel ing={ing} />
      </>
    );
  };
  const StapleRow = ({ ing, accent }) => <ItemRow ing={ing} accent={accent} />;

  return (
    <div>
      <div style={S.card}>
        <div style={S.sectionLabel}>Step 3 - Inventory - {loc}</div>
        <div style={S.h2}>{loc}</div>
        {moveNote && <div style={{ fontSize:12, lineHeight:1.4, marginTop:8, padding:"6px 8px", borderRadius:6, background:C.primaryLight, color:C.primary }}>{moveNote}</div>}
      </div>

      {(alwaysHere.length > 0 || weeklyHere.length > 0 || slowNeededHere.length > 0 || slowHere.length > 0 || mealHere.length > 0) ? (
        <div style={{ ...S.card, padding:"0 16px" }}>
          {alwaysHere.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, padding:"14px 0 4px", textTransform:"uppercase", letterSpacing:"0.06em" }}>Always buy</div>
              {alwaysHere.map(ing => <ItemRow key={ing.id} ing={ing} accent={C.accent} dimOff />)}
            </>
          )}
          {weeklyHere.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, padding:"14px 0 4px", textTransform:"uppercase", letterSpacing:"0.06em" }}>Weekly staples</div>
              {weeklyHere.map(ing => <StapleRow key={ing.id} ing={ing} accent="#3730A3" />)}
            </>
          )}
          {(mealHere.length > 0 || slowNeededHere.length > 0) && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, padding:"14px 0 4px", textTransform:"uppercase", letterSpacing:"0.06em" }}>For this week's meals</div>
              {mealHere.map(ing => <ItemRow key={ing.id} ing={ing} accent={C.accent} dimOff />)}
              {slowNeededHere.map(ing => <StapleRow key={ing.id} ing={ing} accent={C.accent} />)}
            </>
          )}
          {slowHere.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, padding:"14px 0 4px", textTransform:"uppercase", letterSpacing:"0.06em" }}>Slow staples</div>
              {/* Collapsed to one line of names (canvas 11/12, the Skipped-group pattern); it opens by
                  itself when one is already checked, so a buy is never hidden. */}
              {slowOpen
                ? slowHere.map(ing => <StapleRow key={ing.id} ing={ing} accent={C.primary} />)
                : <button type="button" aria-expanded="false" onClick={() => setSlowOpen(true)}
                    style={{ display:"flex", alignItems:"center", gap:8, width:"100%", minHeight:44, padding:"0 0 10px", background:"none", border:"none", borderBottom:`1px solid ${C.border}`, cursor:"pointer", textAlign:"left", fontSize:13, color:C.muted }}>
                    <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{slowHere.map(i => i.name).join(", ")}</span>
                    <span aria-hidden="true">⌄</span>
                  </button>}
            </>
          )}
        </div>
      ) : (
        <div style={{ ...S.card, textAlign:"center", color:C.faint, padding:24 }}>No items stored here</div>
      )}

      <div style={{ display:"flex", gap:10 }}>
        {locIdx > 0 && <button style={{ ...S.btn, ...S.btnS, flex:1, marginBottom:0 }} onClick={() => setLocIdx(l=>l-1)}>Back</button>}
        {locIdx < LOCS.length-1
          ? <button style={{ ...S.btn, ...S.btnP, flex:1, marginBottom:0, marginTop:10 }} onClick={() => setLocIdx(l=>l+1)}>Next: {LOCS[locIdx+1]}</button>
          : <button style={{ ...S.btn, ...S.btnP, flex:1, marginBottom:0, marginTop:10 }} onClick={onNext}>Build my list</button>
        }
      </div>
      <div style={{ display:"flex", gap:6, marginTop:12, flexWrap:"wrap" }}>
        {LOCS.map((l, i) => (
          <button key={l} onClick={() => setLocIdx(i)} style={{ padding:"4px 10px", borderRadius:20, border:"none", fontSize:12, fontWeight:600, cursor:"pointer", background:i===locIdx?C.primary:i<locIdx?"#B8E8CA":"#EEE", color:i===locIdx?"#fff":i<locIdx?C.primary:"#888" }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export { PlanInventory };
