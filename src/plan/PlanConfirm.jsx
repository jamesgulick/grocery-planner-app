// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import React, { useState } from "react";
import { multiMealCounts } from "../app/pills.js";
import { getActivePlan, writeActivePlan } from "../app/plans.js";
import { C, S, TIER_COLORS } from "../app/styles.js";
import { Check } from "../components/common.jsx";
import { ItemEditPanel } from "../components/ItemEditPanel.jsx";
import { isExplicitNo, isOrdering, isRelevant } from "./ordering.js";

function PlanConfirm({ mode = "confirm", onUpdateItem, keptIds = [], checkedIds, setOrdering, addedOff = [], setAddedOff, addedItems, setAddedItems, stapleFlags, quantities = {}, setQuantities, mealPlan, meals, ingredients, onNext, onFinish, db, persistDB, days, daysFull }) {
  const [newItem, setNewItem]   = useState("");
  const [view, setView]         = useState("meal");
  const [copied, setCopied]     = useState(false);
  const [copiedRows, setCopiedRows] = useState(() => new Set()); // Order rows copied this visit
  const [manualBatch, setManualBatch] = useState(null); // { idx, text } when clipboard fails
  const [lastDropped, setLastDropped] = useState(null); // shared item just dropped from the cart check (Undo)
  const [sharedSparkyCopied, setSharedSparkyCopied] = useState(false);
  const [editId, setEditId]     = useState(null);        // item whose "⋯ edit" panel is open

  const activePlan         = getActivePlan(db);
  const dismissedShared   = activePlan?.dismissedShared || [];
  // Dismiss a shared-item flag for THIS list only (e.g. butter — a package always
  // covers several meals). Lives on the plan record, so it survives leaving and
  // returning to this step, and clears when a new week starts.
  const toggleDismissShared = id => {
    const plan = activePlan;
    if (!plan) return;
    const cur = plan.dismissedShared || [];
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    persistDB(writeActivePlan(db, { ...plan, dismissedShared: next }));
  };

  const plannedNames = Object.values(mealPlan).flat();
  const plannedMeals = meals.filter(m => plannedNames.includes(m.name));
  const mealIngIds   = new Set(plannedMeals.flatMap(m => m.ingredients||[]));
  const multiMeal    = multiMealCounts(mealPlan, meals);

  // CHECKED = ORDERING (Phase 1b, SPEC §3b). One buy-or-not decision per item, shared
  // with Inventory (ordering.js); unchecking here writes the same decision Inventory does.
  const st       = { checkedIds, stapleFlags, mealIngIds, keptIds };
  const relevant = ingredients.filter(i => isRelevant(i, st));
  const buying   = ing => isOrdering(ing, st);
  // What you see is fixed when you arrive: rows on the list stay in place (dimmed when
  // unchecked, never moved) and the "Skipped in Inventory" group holds the explicit no's
  // from before you got here. Nothing moves between them while you're on the screen.
  // Each visit is a fresh mount (this step renders only while it is the current one).
  const [arrival] = useState(() => ({
    listed:  new Set(relevant.filter(buying).map(i => i.id)),
    skipped: new Set(relevant.filter(i => isExplicitNo(i, st)).map(i => i.id)),
  }));
  const [showSkipped, setShowSkipped] = useState(false);
  const inArrival = i => arrival.listed.has(i.id);

  const seen = new Set();
  const dedup = arr => arr.filter(i => { if(seen.has(i.id)) return false; seen.add(i.id); return true; });
  const alwaysNeeded  = dedup(ingredients.filter(i => i.tier==="always" && inArrival(i)));
  const stapleNeeded  = dedup(ingredients.filter(i => i.tier==="staple" && inArrival(i)));
  const mealNeeded    = dedup(ingredients.filter(i => i.tier==="specialty" && inArrival(i)));
  const allListed     = [...alwaysNeeded, ...stapleNeeded, ...mealNeeded];
  const skippedRows   = ingredients.filter(i => arrival.skipped.has(i.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity:"base" }));
  // Authoritative set of what's actually being ordered right now. Count, copy, save and
  // the shared check all read this, so they can't disagree with the checkboxes.
  const byTier        = arr => [...arr.filter(i => i.tier==="always"), ...arr.filter(i => i.tier==="staple"), ...arr.filter(i => i.tier==="specialty")];
  const allNeeded     = byTier(relevant.filter(buying));
  const orderingIds   = new Set(allNeeded.map(i => i.id));
  const addedOn       = addedItems.filter(x => !addedOff.includes(x));
  const activeCount   = allNeeded.length + addedOn.length;
  const toggleAdded   = item => setAddedOff(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);

  // "⋯ edit item": the item's profile (how often, where kept, usual amount), written to
  // the item itself. This week's amount stays the amount chip's job.
  const updateItem = (id, patch) => onUpdateItem ? onUpdateItem(id, patch) : persistDB({ ...db, ingredients: db.ingredients.map(i => i.id === id ? { ...i, ...patch } : i) });

  // KEEP AS USUAL (VALIDATION-LOG 10/27): one card, only when this week's amounts differ
  // from the items' usual ones. Nothing is pre-ticked (most changes are one-offs).
  // "Just this week" dismisses it for this exact set of changes (kept on the plan), so it
  // comes back only if an amount changes again.
  const changedAmounts = allNeeded.filter(i =>
    quantities[i.id] !== undefined && quantities[i.id] !== (i.defaultQuantity || ""));
  const changedSig = changedAmounts.map(i => `${i.id}=${quantities[i.id]}`).sort().join("|");
  const showKeepCard = mode === "confirm" && changedAmounts.length > 0 && activePlan?.usualPromptDismissed !== changedSig;
  // Per row "Keep as usual", or "Keep all as usual" (canvas 11/12); doing nothing = this week only.
  const keepAsUsual = idList => {
    const ids = new Set(idList.filter(id => changedAmounts.some(i => i.id === id)));
    if (!ids.size) return;
    persistDB({ ...db, ingredients: db.ingredients.map(i => ids.has(i.id) ? { ...i, defaultQuantity: quantities[i.id] } : i) });
  };
  const justThisWeek = () => {
    if (!activePlan) return;
    persistDB(writeActivePlan(db, { ...activePlan, usualPromptDismissed: changedSig }));
  };

  // Shared ingredients = EVERY multi-meal item this week, regardless of status.
  // This deliberately INCLUDES in-stock and in-cart items — those are the dangerous
  // ones: "I already have it / already bought it" is exactly the thought that makes
  // you forget one package has to cover 3 meals. Each is tagged with its status so
  // the checklist tells you what to actually verify. Sorted most-shared first.
  const sharedItems = Object.keys(multiMeal)
    .map(id => {
      const ing = ingredients.find(i => i.id === id);
      if (!ing) return null;
      // "ordering" only when it is on the list being sent (orderingIds, not dropped here):
      // a staple left at "have enough" or an item dropped on this step is not on the order.
      const status = checkedIds.includes(id)        ? "in stock"
                   : orderingIds.has(id) ? "ordering"
                   : "not on list";
      return { id, name:ing.name, loc:ing.storageLocation || "", n:multiMeal[id], status, dismissed:dismissedShared.includes(id) };
    })
    .filter(Boolean)
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const activeShared = sharedItems.filter(s => !s.dismissed);
  const locSuffix = s => s.loc && s.loc !== "Unassigned" ? ` (${s.loc})` : "";
  // Sparky-directed version: Sparky knows the cart but NOT the meal plan, so we
  // give it the per-item meal counts, ask it to report the cart quantity of each
  // (a fact it owns), and offer its opinion (which James sanity-checks — Sparky
  // can't know per-meal amounts, so its verdict is a prompt, not the truth).
  const sharedSparkyText =
    "Each of these ingredients is used across the number of dinners shown this week. " +
    "For each one, tell me how much is currently in my cart, and whether you think that's enough to cover that many meals. " +
    "Flag any that look short so I can decide.\n\n" +
    activeShared.map(s => `• ${s.name} — needed for ${s.n} meals`).join("\n");

  // Sparky (Walmart's chatbot) batches inputs into ~10 items per paste, so we
  // chunk into batches of 10 to paste sequentially. Quantity is kept on each
  // line as a reference for you while selecting amounts.
  const BATCH_SIZE = 10;
  const listLines = (() => {
    const lines = [];
    allNeeded.forEach(i => {
      const q = quantities[i.id] !== undefined ? quantities[i.id] : (i.defaultQuantity || "");
      lines.push(q ? `${i.name} — ${q}` : i.name);
    });
    addedOn.forEach(i => lines.push(i));
    return lines;
  })();
  const batches = [];
  for (let i = 0; i < listLines.length; i += BATCH_SIZE) batches.push(listLines.slice(i, i + BATCH_SIZE));

  // The full Sparky instructions, copied ONCE on their own (Sparky has a
  // character limit, so repeating this on every batch is too verbose). Paste
  // this first, then paste each numbered batch after.
  const introText = batches.length > 1
    ? `I'm going to paste my grocery list in ${batches.length} numbered parts. For each part: add every numbered item to my cart, treat each line as a separate item, and do not skip, merge, or substitute. If you can't find an exact match, add the closest option and tell me — don't silently leave anything out. When there's a choice of brand or size for an item, prefer my usual pick where you can tell from my order history. After the last part, list everything you added across all parts and name any you could not.`
    : `I'm going to paste my grocery list below. Add every numbered item to my cart, treat each line as a separate item, and do not skip, merge, or substitute. If you can't find an exact match, add the closest option and tell me — don't silently leave anything out. When there's a choice of brand or size for an item, prefer my usual pick where you can tell from my order history. After adding, list back what you added and name any you could not.`;

  // Each batch: items are always numbered, with a short one-line preamble naming the part;
  // the careful-matching rules live in introText, always included (canvas 11/12: no toggle).
  const framedBatchText = idx => {
    const b = batches[idx];
    const numbered = b.map((line, i) => `${i + 1}. ${line}`).join("\n");
    const preamble = batches.length > 1
      ? `Part ${idx + 1} of ${batches.length}${idx === batches.length - 1 ? " (last part)" : ""} — add each numbered item:`
      : `Add each numbered item to my cart:`;
    return `${preamble}\n${numbered}`;
  };

  const copyText = (text, idx) => {
    let ok = false;
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      ok = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch(e) { ok = false; }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => {}).catch(() => {});
    return ok;
  };

  // Order rows: Intro, then each batch. Copied rows dim with ✓; the first uncopied one is next up.
  const orderRows = [
    { key:"intro", label:"Intro", text:introText },
    ...batches.map((b, i) => ({ key:"b" + i, label:`Batch ${i + 1}`, meta:`${b.length} items`, text:framedBatchText(i) })),
  ];
  const nextRow = orderRows.find(r => !copiedRows.has(r.key))?.key;
  const copyRow = row => {
    const ok = copyText(row.text);
    setCopiedRows(prev => new Set(prev).add(row.key));
    // If neither copy path worked, surface the text so it can be selected by hand.
    setManualBatch(ok ? null : { idx:row.key, text:row.text });
  };
  // Shared items: × drops one from the cart check (dismissedShared), with Undo.
  const dropShared = item => { toggleDismissShared(item.id); setLastDropped(item); };
  const undoDrop   = () => { if (lastDropped) toggleDismissShared(lastDropped.id); setLastDropped(null); };

  const savePlan = () => {
    const listItems = allNeeded.map(i => ({ ingredientId:i.id, status:"ordering", quantity:(quantities[i.id] !== undefined ? quantities[i.id] : (i.defaultQuantity||"")) }));
    const today     = new Date().toISOString().split("T")[0];
    const updated   = activePlan
      ? { ...activePlan, meals:mealPlan, items:listItems }
      : { weekStartDate:today, notes:"", dismissedShared:[], meals:mealPlan, items:listItems };
    persistDB(writeActivePlan(db, updated));
  };

  const QtyChip = ({ ing }) => {
    const override = quantities[ing.id];
    const effective = override !== undefined ? override : (ing.defaultQuantity || "");
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(effective);
    const isCustom = override !== undefined && override !== (ing.defaultQuantity || "");
    if (editing) {
      const commit = () => {
        const v = val.trim();
        setQuantities(prev => { const next = { ...prev }; if (v === "" || v === (ing.defaultQuantity || "")) delete next[ing.id]; else next[ing.id] = v; return next; });
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

  // One row for every list (by meal, flat, skipped group). Checked = ordering; an
  // unchecked row stays exactly where it is, dimmed, so it can be re-decided in context.
  const ItemRow = ({ ing, flat }) => {
    const on     = buying(ing);
    const custom = quantities[ing.id] !== undefined && quantities[ing.id] !== (ing.defaultQuantity || "");
    const tc     = TIER_COLORS[ing.tier] || {};
    return (
      <>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 0", borderBottom:`1px solid ${C.border}`, opacity:on?1:0.45, cursor:"pointer", transition:"opacity 0.2s" }} onClick={() => setOrdering(ing, !on)}>
        <Check checked={on} onChange={v => setOrdering(ing, v)} label={`Order ${ing.name}`} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14 }}>{ing.name}</div>
          {flat && <span style={S.badge(tc.color, tc.bg)}>{ing.tier}</span>}
          {flat && multiMeal[ing.id] && <span style={{ fontSize:11, fontWeight:700, color:"#B45309", background:"#FEF3C7", borderRadius:5, padding:"1px 5px", marginLeft:4 }}>×{multiMeal[ing.id]} meals</span>}
          {custom && on && <div style={{ fontSize:11, color:C.faint }}>this week {quantities[ing.id] || "none"} · usual {ing.defaultQuantity || "none"}</div>}
        </div>
        <div onClick={e => e.stopPropagation()} style={{ display:"flex", alignItems:"center", gap:8 }}>
          {on && <QtyChip ing={ing} />}
          <button style={{ background:"none", border:"none", color:editId === ing.id ? C.primary : C.faint, fontSize:18, cursor:"pointer", minWidth:36, minHeight:44, padding:0 }} onClick={() => setEditId(editId === ing.id ? null : ing.id)} aria-label={`Edit ${ing.name}`}>⋯</button>
        </div>
      </div>
      {editId === ing.id && <ItemEditPanel ing={ing} thisWeek={quantities[ing.id]} onUpdate={patch => updateItem(ing.id, patch)} onClose={() => setEditId(null)} />}
      </>
    );
  };
  // Items typed in on this step: the same Check; unchecked ones stay, dimmed (addedOff).
  const AddedRow = ({ item, flat }) => {
    const on = !addedOff.includes(item);
    return (
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 0", borderBottom:`1px solid ${C.border}`, opacity:on?1:0.45, cursor:"pointer" }} onClick={() => toggleAdded(item)}>
        <Check checked={on} onChange={() => toggleAdded(item)} label={`Order ${item}`} />
        <div style={{ flex:1, fontSize:14 }}>{item}{flat && <span style={{ fontSize:11, color:C.faint }}> (added)</span>}</div>
      </div>
    );
  };

  return (
    <div>
      {mode === "confirm" && <>
      <div style={S.card}>
        <div style={S.sectionLabel}>Confirm & adjust</div>
        <div style={S.h2}>{activeCount} items to buy</div>
        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button style={{ ...S.btnSm, flex:1, background:view==="meal"?C.primary:"#F3F4F6", color:view==="meal"?"#fff":C.muted }} onClick={() => setView("meal")}>By meal</button>
          <button style={{ ...S.btnSm, flex:1, background:view==="flat"?C.primary:"#F3F4F6", color:view==="flat"?"#fff":C.muted }} onClick={() => setView("flat")}>A–Z</button>
        </div>
      </div>

      {showKeepCard && (
        <div style={{ ...S.card, padding:"0 16px" }}>
          <div style={{ fontSize:14, fontWeight:700, padding:"12px 0 4px" }}>{changedAmounts.length} amount{changedAmounts.length === 1 ? "" : "s"} changed this week</div>
          {changedAmounts.map(i => (
            <div key={i.id} style={{ display:"flex", alignItems:"center", gap:10, minHeight:48, borderBottom:`1px solid ${C.border}` }}>
              <div style={{ flex:1, minWidth:0, fontSize:14 }}>{i.name} <span style={{ color:C.muted }}>· {i.defaultQuantity || "none"} → {quantities[i.id] || "none"}</span></div>
              <button type="button" style={{ ...S.btnSm, minHeight:36, background:"#fff", color:C.primary, border:`1.5px solid ${C.primary}`, fontWeight:700, flexShrink:0 }} onClick={() => keepAsUsual([i.id])}>Keep as usual</button>
            </div>
          ))}
          <div style={{ display:"flex", gap:8, padding:"10px 0 12px" }}>
            <button type="button" style={{ ...S.btnSm, flex:1, minHeight:40, background:"#F3F4F6", color:C.muted }} onClick={justThisWeek}>Just this week</button>
            <button type="button" style={{ ...S.btnSm, flex:1, minHeight:40, background:C.primary, color:"#fff", fontWeight:700 }} onClick={() => keepAsUsual(changedAmounts.map(i => i.id))}>Keep all as usual</button>
          </div>
        </div>
      )}

      {view === "meal" ? (
        <>
          {alwaysNeeded.length > 0 && (
            <>
              <div style={{ fontSize:12, fontWeight:700, color:C.accent, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Always</div>
              <div style={{ ...S.card, padding:"0 16px", marginBottom:12 }}>{alwaysNeeded.map(i => <ItemRow key={i.id} ing={i} />)}</div>
            </>
          )}
          {stapleNeeded.length > 0 && (
            <>
              <div style={{ fontSize:12, fontWeight:700, color:"#3730A3", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Staples - running low</div>
              <div style={{ ...S.card, padding:"0 16px", marginBottom:12 }}>{stapleNeeded.map(i => <ItemRow key={i.id} ing={i} />)}</div>
            </>
          )}
          {plannedMeals.map(meal => {
            // The meal-specific buy: specialty items on the list when you arrived (always
            // and staple items have their own sections above).
            const ings = ingredients.filter(i => (meal.ingredients||[]).includes(i.id) && inArrival(i) && i.tier === "specialty");
            if (!ings.length) return null;
            return (
              <div key={meal.id} style={{ marginBottom:12 }}>
                <div style={{ background:C.primary, color:"#E8F5EE", padding:"8px 14px", borderRadius:10, fontSize:13, fontWeight:700, marginBottom:4 }}>{meal.name}</div>
                <div style={{ ...S.card, padding:"0 16px" }}>{ings.map(i => <ItemRow key={i.id} ing={i} />)}</div>
              </div>
            );
          })}
          {addedItems.length > 0 && (
            <div style={{ marginBottom:12 }}>
              <div style={{ background:C.primary, color:"#E8F5EE", padding:"8px 14px", borderRadius:10, fontSize:13, fontWeight:700, marginBottom:4 }}>Added items</div>
              <div style={{ ...S.card, padding:"0 16px" }}>
                {addedItems.map((item, idx) => <AddedRow key={idx} item={item} />)}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ ...S.card, padding:"0 16px" }}>
          <div style={{ fontSize:11, color:C.faint, padding:"10px 0 6px", borderBottom:`1px solid ${C.border}` }}>{allListed.length + addedItems.length} items A–Z · tap a quantity to adjust for this week</div>
          {[...allListed].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity:"base" })).map(i => <ItemRow key={i.id} ing={i} flat />)}
          {addedItems.map((item, idx) => <AddedRow key={idx} item={item} flat />)}
          {allListed.length===0 && addedItems.length===0 && <div style={{ textAlign:"center", color:C.faint, padding:24 }}>No items — add ingredients to meals in Manage tab</div>}
        </div>
      )}

      {skippedRows.length > 0 && (
        <div style={{ ...S.card, padding:"0 16px" }}>
          <button style={{ display:"flex", alignItems:"center", width:"100%", gap:8, background:"none", border:"none", padding:"12px 0", cursor:"pointer", textAlign:"left" }} onClick={() => setShowSkipped(v => !v)} aria-expanded={showSkipped}>
            <span style={{ flex:1 }}>
              <span style={{ display:"block", fontSize:14, fontWeight:600, color:C.text }}>Skipped in Inventory ({skippedRows.length})</span>
            </span>
            <span style={{ fontSize:16, color:C.faint }}>{showSkipped ? "▾" : "▸"}</span>
          </button>
          {showSkipped && <div style={{ borderTop:`1px solid ${C.border}` }}>{skippedRows.map(i => <ItemRow key={i.id} ing={i} flat={view === "flat"} />)}</div>}
        </div>
      )}

      <div style={S.card}>
        <div style={S.sectionLabel}>Add item</div>
        <div style={{ display:"flex", gap:8 }}>
          <input style={{ ...S.input, flex:1 }} placeholder="Type item name..." value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if(e.key==="Enter"&&newItem.trim()){ setAddedItems(prev=>[...prev,newItem.trim()]); setNewItem(""); } }} />
          <button style={{ ...S.btn, ...S.btnP, width:"auto", padding:"11px 16px", marginBottom:0 }} onClick={() => { if(newItem.trim()){ setAddedItems(prev=>[...prev,newItem.trim()]); setNewItem(""); } }}>Add</button>
        </div>
      </div>

      <button style={{ ...S.btn, ...S.btnP }} onClick={() => { savePlan(); onNext(); }}>Next: Order ›</button>
      </>}

      {mode === "sparky" && <>
      {/* ORDER (canvas 11/12): Intro + Batch rows in one list. Tap a row to copy it; copied rows
          dim with ✓; the next one up is highlighted. The careful-matching rules are always in the
          intro (no toggle). No helper copy. */}
      <div style={{ ...S.card, padding:"0 16px" }}>
        <div style={{ ...S.sectionLabel, padding:"12px 0 6px", marginBottom:0 }}>Copy for Sparky</div>
        {orderRows.map((row, k) => {
          const done   = copiedRows.has(row.key);
          const isNext = row.key === nextRow;
          return (
            <button key={row.key} type="button" onClick={() => copyRow(row)}
              style={{ display:"flex", alignItems:"center", gap:10, width:"100%", minHeight:52, padding:"8px 0", background:"none", border:"none", borderTop: k ? `1px solid ${C.border}` : "none", cursor:"pointer", textAlign:"left", opacity: done && !isNext ? 0.45 : 1 }}>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:"block", fontSize:15, fontWeight:600, color:C.text }}>{row.label}</span>
                {row.meta && <span style={{ display:"block", fontSize:12, color:C.faint }}>{row.meta}</span>}
              </span>
              {done
                ? <span style={{ fontSize:13, fontWeight:700, color:C.primary }}>✓</span>
                : isNext
                  ? <span style={{ fontSize:13, fontWeight:700, color:"#fff", background:C.primary, borderRadius:18, padding:"8px 14px" }}>Copy</span>
                  : <span style={{ fontSize:13, fontWeight:600, color:C.primary }}>Copy</span>}
            </button>
          );
        })}
      </div>

      {sharedItems.length > 0 && (
        <div style={{ ...S.card, padding:"0 16px" }}>
          <div style={{ ...S.sectionLabel, padding:"12px 0 6px", marginBottom:0 }}>Shared items</div>
          {activeShared.map(s => (
            <div key={s.id} style={{ display:"flex", alignItems:"center", gap:10, minHeight:44, borderTop:`1px solid ${C.border}`, fontSize:14 }}>
              <span style={{ flex:1, minWidth:0 }}>{s.name}</span>
              <span style={{ fontWeight:700, color:C.muted }}>×{s.n}</span>
              {/* × drops it from the cart check only; it stays in the order (Confirm removes from the order). */}
              <button type="button" aria-label={`Drop ${s.name} from the cart check`} onClick={() => dropShared(s)}
                style={{ width:44, height:44, flexShrink:0, background:"none", border:"none", cursor:"pointer", color:C.muted, fontSize:16 }}>✕</button>
            </div>
          ))}
          {lastDropped && (
            <div style={{ display:"flex", alignItems:"center", gap:10, minHeight:44, borderTop:`1px solid ${C.border}`, fontSize:13, color:C.muted }}>
              <span style={{ flex:1, minWidth:0 }}>Dropped {lastDropped.name}</span>
              <button type="button" onClick={undoDrop} style={{ minHeight:44, padding:"0 4px", background:"none", border:"none", cursor:"pointer", fontSize:13, fontWeight:700, color:C.primary }}>Undo</button>
            </div>
          )}
          {activeShared.length > 0 && (
            <div style={{ padding:"8px 0 12px" }}>
              <button type="button" style={{ ...S.btn, ...S.btnP, marginBottom:0 }} onClick={() => { const ok = copyText(sharedSparkyText); setSharedSparkyCopied(true); setTimeout(()=>setSharedSparkyCopied(false),2000); if(!ok) setManualBatch({ idx:-1, text:sharedSparkyText }); }}>
                {sharedSparkyCopied ? "Copied" : "Copy cart check"}
              </button>
            </div>
          )}
        </div>
      )}

      {manualBatch && (
        <div style={{ ...S.card, border:`1px solid ${C.warning}`, background:C.warningLight }}>
          <div style={{ fontSize:13, color:C.warning, fontWeight:600, marginBottom:8 }}>Copy was blocked. Select the text and copy it.</div>
          <textarea readOnly value={manualBatch.text} onFocus={e => e.target.select()} style={{ ...S.input, height:130, fontSize:13, fontFamily:"monospace", resize:"none", marginBottom:8 }} />
          <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={() => setManualBatch(null)}>Done</button>
        </div>
      )}
      <button style={{ ...S.btn, ...S.btnP }} onClick={() => { try { savePlan(); } finally { onFinish && onFinish(); } }}>Finish plan</button>
      </>}
    </div>
  );
}

export { PlanConfirm };
