// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import React, { useState } from "react";
import { multiMealCounts } from "../app/pills.js";
import { getActivePlan, writeActivePlan } from "../app/plans.js";
import { C, S, TIER_COLORS } from "../app/styles.js";
import { Toggle } from "../components/common.jsx";
import { ItemEditPanel } from "../components/ItemEditPanel.jsx";

function PlanConfirm({ mode = "confirm", onUpdateItem, keptIds = [], checkedIds, removedIds, setRemovedIds, addedItems, setAddedItems, stapleFlags, quantities = {}, setQuantities, mealPlan, meals, ingredients, onNext, onFinish, db, persistDB, days, daysFull }) {
  const [newItem, setNewItem]   = useState("");
  const [view, setView]         = useState("meal");
  const [copied, setCopied]     = useState(false);
  const [batchIdx, setBatchIdx] = useState(0); // which batch is "current" in the stepper
  const [batchCopied, setBatchCopied] = useState(null); // index of the batch just copied
  const [manualBatch, setManualBatch] = useState(null); // { idx, text } when clipboard fails
  const [framed, setFramed] = useState(true); // prepend the Sparky instruction header
  const [sharedSparkyCopied, setSharedSparkyCopied] = useState(false);
  const [editId, setEditId]     = useState(null);        // item whose "⋯ edit" panel is open
  const [keepSel, setKeepSel]   = useState(() => new Set()); // amounts ticked to become the usual

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

  const seen = new Set();
  const dedup = arr => arr.filter(i => { if(seen.has(i.id)) return false; seen.add(i.id); return true; });
  const alwaysNeeded  = dedup(ingredients.filter(i => i.tier==="always" && !checkedIds.includes(i.id)));
  const stapleNeeded  = dedup(ingredients.filter(i => i.tier==="staple" && stapleFlags[i.id] && !checkedIds.includes(i.id)));
  const mealNeeded    = dedup(ingredients.filter(i => (mealIngIds.has(i.id) || keptIds.includes(i.id)) && i.tier==="specialty" && !checkedIds.includes(i.id)));
  const allNeeded     = [...alwaysNeeded, ...stapleNeeded, ...mealNeeded];
  // Authoritative set of what's actually being ordered. Every view (by-meal,
  // flat, copy, save) filters against this so they can't disagree. A staple
  // toggled "have enough" is absent here, so it won't show under a meal that
  // uses it — the inventory judgment wins.
  const orderingIds   = new Set(allNeeded.map(i => i.id));
  const activeCount   = allNeeded.filter(i => !removedIds.includes(i.id)).length + addedItems.length;

  // "⋯ edit item": the item's profile (how often, where kept, usual amount), written to
  // the item itself. This week's amount stays the amount chip's job.
  const updateItem = (id, patch) => onUpdateItem ? onUpdateItem(id, patch) : persistDB({ ...db, ingredients: db.ingredients.map(i => i.id === id ? { ...i, ...patch } : i) });

  // KEEP AS USUAL (VALIDATION-LOG 10/27): one card, only when this week's amounts differ
  // from the items' usual ones. Nothing is pre-ticked (most changes are one-offs).
  // "Just this week" dismisses it for this exact set of changes (kept on the plan), so it
  // comes back only if an amount changes again.
  const changedAmounts = allNeeded.filter(i => !removedIds.includes(i.id)
    && quantities[i.id] !== undefined && quantities[i.id] !== (i.defaultQuantity || ""));
  const changedSig = changedAmounts.map(i => `${i.id}=${quantities[i.id]}`).sort().join("|");
  const showKeepCard = mode === "confirm" && changedAmounts.length > 0 && activePlan?.usualPromptDismissed !== changedSig;
  const keepAsUsual = () => {
    const ids = new Set([...keepSel].filter(id => changedAmounts.some(i => i.id === id)));
    if (!ids.size) return;
    persistDB({ ...db, ingredients: db.ingredients.map(i => ids.has(i.id) ? { ...i, defaultQuantity: quantities[i.id] } : i) });
    setKeepSel(new Set());
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
                   : orderingIds.has(id) && !removedIds.includes(id) ? "ordering"
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
    allNeeded.filter(i => !removedIds.includes(i.id)).forEach(i => {
      const q = quantities[i.id] !== undefined ? quantities[i.id] : (i.defaultQuantity || "");
      lines.push(q ? `${i.name} — ${q}` : i.name);
    });
    addedItems.forEach(i => lines.push(i));
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

  // Each batch: items are ALWAYS numbered (framed or not). When framed, a short
  // one-line preamble identifies the part; the verbose rules live in introText.
  const framedBatchText = idx => {
    const b = batches[idx];
    const numbered = b.map((line, i) => `${i + 1}. ${line}`).join("\n");
    if (!framed) return numbered;
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

  const copyBatch = idx => {
    const text = framedBatchText(idx);
    const ok = copyText(text, idx);
    setBatchCopied(idx);
    setTimeout(() => setBatchCopied(c => c === idx ? null : c), 2000);
    if (idx < batches.length - 1) setBatchIdx(idx + 1);

    // If neither copy path worked, surface the text so it can be selected manually.
    if (!ok) setManualBatch({ idx, text });
    else setManualBatch(null);
  };

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

  const ItemRow = ({ ing }) => {
    const isRemoved = removedIds.includes(ing.id);
    const custom    = quantities[ing.id] !== undefined && quantities[ing.id] !== (ing.defaultQuantity || "");
    return (
      <>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 0", borderBottom:`1px solid ${C.border}`, opacity:isRemoved?0.4:1 }}>
        <div style={{ ...S.checkBoxisRemoved, background:isRemoved?"#CCC":"#fff", border:isRemoved?"none":`2px solid ${C.border}`, color:"#888" }}
          onClick={() => { setRemovedIds(prev => prev.includes(ing.id) ? prev.filter(x => x !== ing.id) : [...prev, ing.id]); }}>
          {isRemoved && "✓"}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, textDecoration:isRemoved?"line-through":"none" }}>{ing.name}</div>
          {custom && !isRemoved && <div style={{ fontSize:11, color:C.faint }}>this week {quantities[ing.id] || "none"} · usual {ing.defaultQuantity || "none"}</div>}
        </div>
        {!isRemoved && <QtyChip ing={ing} />}
        <button style={{ background:"none", border:"none", color:editId === ing.id ? C.primary : C.faint, fontSize:11, cursor:"pointer", padding:"2px 4px", whiteSpace:"nowrap" }} onClick={() => setEditId(editId === ing.id ? null : ing.id)}>⋯ edit</button>
      </div>
      {editId === ing.id && <ItemEditPanel ing={ing} thisWeek={quantities[ing.id]} onUpdate={patch => updateItem(ing.id, patch)} onClose={() => setEditId(null)} />}
      </>
    );
  };

  return (
    <div>
      {mode === "confirm" && <>
      <div style={S.card}>
        <div style={S.sectionLabel}>Confirm & adjust</div>
        <div style={S.h2}>{activeCount} items to buy</div>
        <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>Tune quantities for this week, drop anything you don't need. Check shared items below.</div>
        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button style={{ ...S.btnSm, flex:1, background:view==="meal"?C.primary:"#F3F4F6", color:view==="meal"?"#fff":C.muted }} onClick={() => setView("meal")}>By meal</button>
          <button style={{ ...S.btnSm, flex:1, background:view==="flat"?C.primary:"#F3F4F6", color:view==="flat"?"#fff":C.muted }} onClick={() => setView("flat")}>Flat list</button>
        </div>
      </div>

      {showKeepCard && (
        <div style={S.card}>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>You changed {changedAmounts.length} amount{changedAmounts.length === 1 ? "" : "s"} this week. Keep any as the new usual?</div>
          <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Tick the ones that should be the amount from now on. The rest stay just for this week.</div>
          {changedAmounts.map(i => {
            const on = keepSel.has(i.id);
            return (
              <div key={i.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", cursor:"pointer" }}
                onClick={() => setKeepSel(prev => { const n = new Set(prev); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n; })}>
                <div style={S.checkBox(on)}>{on && "✓"}</div>
                <div style={{ flex:1, fontSize:13 }}>{i.name}</div>
                <div style={{ fontSize:12, color:C.muted, whiteSpace:"nowrap" }}>{i.defaultQuantity || "none"} → <b style={{ color:C.text }}>{quantities[i.id] || "none"}</b></div>
              </div>
            );
          })}
          <div style={{ display:"flex", gap:8, marginTop:8 }}>
            <button style={{ ...S.btnSm, flex:1, background:keepSel.size ? C.primary : "#F3F4F6", color:keepSel.size ? "#fff" : C.faint }} disabled={!keepSel.size} onClick={keepAsUsual}>Make checked the usual</button>
            <button style={{ ...S.btnSm, flex:1, background:"#F3F4F6", color:C.muted }} onClick={justThisWeek}>Just this week</button>
          </div>
        </div>
      )}

      {sharedItems.length > 0 && (
        <div style={S.card}>
          <div style={{ fontSize:12, fontWeight:700, color:"#B45309", marginBottom:4 }}>⚠ Used across multiple meals</div>
          <div style={{ fontSize:12, color:C.muted, marginBottom:8, lineHeight:1.4 }}>
            Each feeds several meals — including ones you have or already bought. Easy to under-buy when you've mentally checked it off. Tap any you know are fine (like butter) to cross them off.
          </div>
          <div style={{ background:"#FEF9EF", border:`1px solid #FCE7C3`, borderRadius:8, padding:"8px 10px" }}>
            {sharedItems.map(s => {
              const sc = s.status === "in cart" ? C.verified : s.status === "ordering" ? "#B45309" : C.muted;
              return (
                <div key={s.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:13, padding:"3px 0", opacity:s.dismissed?0.45:1 }}>
                  <span style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0, cursor:"pointer" }} onClick={() => toggleDismissShared(s.id)}>
                    <span style={{ fontSize:13, color:C.faint }}>{s.dismissed ? "○" : "✕"}</span>
                    <span style={{ textDecoration:s.dismissed?"line-through":"none" }}>{s.name}{s.loc && s.loc !== "Unassigned" && <span style={{ color:C.faint, fontWeight:400 }}> ({s.loc})</span>}</span>
                  </span>
                  {s.dismissed
                    ? <span style={{ fontSize:11, color:C.faint }}>fine — tap to restore</span>
                    : <span style={{ display:"flex", gap:8, alignItems:"center" }}>
                        <span style={{ fontSize:11, color:sc, fontWeight:600 }}>{s.status}</span>
                        <span style={{ fontWeight:700, color:"#B45309" }}>×{s.n}</span>
                      </span>}
                </div>
              );
            })}
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
            // Show only ingredients actually being ordered (a staple marked "have
            // enough" is excluded). Skip always/staple items here since they each
            // have their own section above — this section is the meal-specific buy.
            const ings = ingredients.filter(i => (meal.ingredients||[]).includes(i.id) && orderingIds.has(i.id) && i.tier === "specialty");
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
                {addedItems.map((item, idx) => (
                  <div key={idx} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 0", borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ ...S.checkBox(false), border:`2px solid ${C.border}`, color:"#888" }} />
                    <div style={{ flex:1, fontSize:14 }}>{item}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ ...S.card, padding:"0 16px" }}>
          <div style={{ fontSize:11, color:C.faint, padding:"10px 0 6px", borderBottom:`1px solid ${C.border}` }}>All {activeCount} items A–Z · tap a quantity to adjust for this week</div>
          {[...allNeeded].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity:"base" })).map(i => {
            const isRemoved = removedIds.includes(i.id);
            const tc = TIER_COLORS[i.tier] || {};
            const custom = quantities[i.id] !== undefined && quantities[i.id] !== (i.defaultQuantity || "");
            return (
              <React.Fragment key={i.id}>
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 0", borderBottom:`1px solid ${C.border}`, opacity:isRemoved?0.4:1 }}>
                <div style={{ ...S.checkBoxisRemoved, background:isRemoved?"#CCC":"#fff", border:isRemoved?"none":`2px solid ${C.border}`, color:"#888" }}
                  onClick={() => { setRemovedIds(prev => prev.includes(i.id) ? prev.filter(x => x !== i.id) : [...prev, i.id]); }}>
                  {isRemoved && "✓"}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, textDecoration:isRemoved?"line-through":"none" }}>{i.name}</div>
                  <span style={S.badge(tc.color, tc.bg)}>{i.tier}</span>
                  {multiMeal[i.id] && <span style={{ fontSize:11, fontWeight:700, color:"#B45309", background:"#FEF3C7", borderRadius:5, padding:"1px 5px", marginLeft:4 }}>×{multiMeal[i.id]} meals</span>}
                  {custom && !isRemoved && <div style={{ fontSize:11, color:C.faint }}>this week {quantities[i.id] || "none"} · usual {i.defaultQuantity || "none"}</div>}
                </div>
                {!isRemoved && <QtyChip ing={i} />}
                <button style={{ background:"none", border:"none", color:editId === i.id ? C.primary : C.faint, fontSize:11, cursor:"pointer", padding:"2px 4px", whiteSpace:"nowrap" }} onClick={() => setEditId(editId === i.id ? null : i.id)}>⋯ edit</button>
              </div>
              {editId === i.id && <ItemEditPanel ing={i} thisWeek={quantities[i.id]} onUpdate={patch => updateItem(i.id, patch)} onClose={() => setEditId(null)} />}
              </React.Fragment>
            );
          })}
          {addedItems.map((item, idx) => (
            <div key={idx} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 0", borderBottom:`1px solid ${C.border}` }}>
              <div style={{ ...S.checkBox(false), border:`2px solid ${C.border}`, color:"#888" }} />
              <div style={{ flex:1, fontSize:14 }}>{item} <span style={{ fontSize:11, color:C.faint }}>(added)</span></div>
            </div>
          ))}
          {allNeeded.length===0 && addedItems.length===0 && <div style={{ textAlign:"center", color:C.faint, padding:24 }}>No items — add ingredients to meals in Manage tab</div>}
        </div>
      )}

      <div style={S.card}>
        <div style={S.sectionLabel}>Add item</div>
        <div style={{ display:"flex", gap:8 }}>
          <input style={{ ...S.input, flex:1 }} placeholder="Type item name..." value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if(e.key==="Enter"&&newItem.trim()){ setAddedItems(prev=>[...prev,newItem.trim()]); setNewItem(""); } }} />
          <button style={{ ...S.btn, ...S.btnP, width:"auto", padding:"11px 16px", marginBottom:0 }} onClick={() => { if(newItem.trim()){ setAddedItems(prev=>[...prev,newItem.trim()]); setNewItem(""); } }}>Add</button>
        </div>
      </div>

      <button style={{ ...S.btn, ...S.btnP }} onClick={() => { savePlan(); onNext(); }}>Next: copy for Sparky →</button>
      </>}

      {mode === "sparky" && <>
      <div style={{ ...S.card }}>
        <div style={S.sectionLabel}>Copy for Sparky{batches.length > 1 ? ` — ${batches.length} batches` : ""}</div>

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 0 10px", borderBottom:`1px solid ${C.border}`, marginBottom:10 }}>
          <div style={{ flex:1, paddingRight:10 }}>
            <div style={{ fontSize:13, fontWeight:600 }}>Add careful-matching instructions</div>
            <div style={{ fontSize:11, color:C.faint, lineHeight:1.4 }}>Copy the intro once and paste it into Sparky first. Each batch then carries only a short preamble (Sparky has a character limit).</div>
          </div>
          <Toggle value={framed} onChange={setFramed} />
        </div>

        {framed && (
          <div style={{ ...S.btn, ...S.btnS, cursor:"pointer", marginBottom:10 }}
            onClick={() => { const ok = copyText(introText, "intro"); setBatchCopied("intro"); setTimeout(() => setBatchCopied(c => c === "intro" ? null : c), 2000); if (!ok) setManualBatch({ idx:"intro", text:introText }); else setManualBatch(null); }}>
            {batchCopied==="intro" ? "✓ Intro copied — paste into Sparky first" : "① Copy intro for Sparky"}
          </div>
        )}

        {batches.length <= 1 ? (
          <div style={{ ...S.btn, ...S.btnP, cursor:"pointer", marginBottom:0 }} onClick={() => batches.length && copyBatch(0)}>
            {batchCopied===0 ? "✓ Copied!" : framed ? "② Copy list" : "Copy list"}
          </div>
        ) : (
          <>
            <div style={{ fontSize:13, color:C.muted, marginBottom:10, lineHeight:1.5 }}>
              Sparky takes ~10 items at a time, so paste these in order. {framed ? "Paste the intro first, then tap a batch to copy it" : "Tap a batch to copy it"}, paste into Sparky, then come back for the next.
            </div>
            {batches.map((b, i) => {
              const isCopied = batchCopied === i;
              const isCurrent = batchIdx === i;
              return (
                <button key={i} onClick={() => copyBatch(i)}
                  style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", textAlign:"left", marginBottom:6, padding:"11px 14px", borderRadius:10, cursor:"pointer",
                    border:`1.5px solid ${isCurrent ? C.primary : C.border}`,
                    background: isCopied ? C.primaryLight : isCurrent ? "#F0FAF4" : "#fff" }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14, color:isCurrent?C.primary:C.text }}>Batch {i+1} of {batches.length}</div>
                    <div style={{ fontSize:11, color:C.faint }}>{b.length} items {isCurrent && !isCopied ? "· next up" : ""}</div>
                  </div>
                  <span style={{ fontSize:13, fontWeight:700, color:isCopied?C.verified:C.primary }}>{isCopied ? "✓ Copied" : "Copy"}</span>
                </button>
              );
            })}
          </>
        )}

        {activeShared.length > 0 && (
          <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${C.border}` }}>
            <div style={{ fontSize:12, fontWeight:700, color:"#B45309", marginBottom:4 }}>Shared-item quantity check</div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:8, lineHeight:1.4 }}>
              {activeShared.length} ingredient{activeShared.length>1?"s":""} feed multiple meals. Ask Sparky to confirm the cart has enough of each:
            </div>
            <button style={{ ...S.btn, ...S.btnP, marginBottom:0 }} onClick={() => { const ok = copyText(sharedSparkyText); setSharedSparkyCopied(true); setTimeout(()=>setSharedSparkyCopied(false),2000); if(!ok) setManualBatch({ idx:-1, text:sharedSparkyText }); }}>
              {sharedSparkyCopied ? "✓ Copied!" : "Copy prompt to ask Sparky"}
            </button>
          </div>
        )}
      </div>

      {manualBatch && (
        <div style={{ ...S.card, border:`1px solid ${C.warning}`, background:C.warningLight }}>
          <div style={{ fontSize:13, color:C.warning, fontWeight:600, marginBottom:8 }}>
            Auto-copy was blocked{manualBatch.idx >= 0 && batches.length > 1 ? ` for batch ${manualBatch.idx + 1}` : ""} — tap the box, select all, and copy:
          </div>
          <textarea readOnly value={manualBatch.text} onFocus={e => e.target.select()} style={{ ...S.input, height:130, fontSize:13, fontFamily:"monospace", resize:"none", marginBottom:8 }} />
          <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={() => setManualBatch(null)}>Done</button>
        </div>
      )}
      <button style={{ ...S.btn, ...S.btnP }} onClick={() => { try { savePlan(); } finally { onFinish && onFinish(); } }}>Done — finish plan</button>
      </>}
    </div>
  );
}

export { PlanConfirm };
