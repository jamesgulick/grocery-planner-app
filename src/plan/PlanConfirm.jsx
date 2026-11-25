// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { addDaysISO } from "../app/globals.js";
import { buyWord, notHomeCooked } from "../library/libraryModel.js";
import { dayTitle } from "./WeekStep.jsx";
import "./confirm.css";
import { multiMealCounts } from "../app/pills.js";
import { getActivePlan, writeActivePlan } from "../app/plans.js";
import { C, S } from "../app/styles.js";
import { Check } from "../components/common.jsx";
import { ItemEditPanel } from "../components/ItemEditPanel.jsx";
import { Icon, PillButton, RowChevron, Segmented } from "../ui/kit.jsx";
import { showToast } from "../ui/toast.js";
import { latestDB } from "../app/latestDB.js";
import { isExplicitNo, isOrdering, isRelevant } from "./ordering.js";
import { MoreButton } from "../components/ItemEditPanel.jsx";

function PlanConfirm({ headSlot, onOpenMeal, onOpenItem, registerHeld, inFlow, registerNext, mode = "confirm", onUpdateItem, keptIds = [], addedIds = [], onAddFromLibrary, checkedIds, setOrdering, addedOff = [], setAddedOff, addedItems, setAddedItems, stapleFlags, quantities = {}, setQuantities, mealPlan, meals, ingredients, onNext, onFinish, db, persistDB, days, daysFull }) {
  const [newItem, setNewItem]   = useState("");
  const [adding, setAdding]     = useState(false);
  const [view, setView]         = useState("meal");
  const [copied, setCopied]     = useState(false);
  const [manualBatch, setManualBatch] = useState(null); // { text } when clipboard fails
  const [editId, setEditId]     = useState(null);        // item whose "⋯ edit" panel is open
  const [pending, setPending]   = useState({});          // its Buy / place choice, applied when the panel closes (11/24)

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

  // "Added" (brief §5, 11/25): Library items added here or reclassified to As needed while
  // checked (addedIds), and any older As needed item kept with no meal (keptIds). They show
  // only in Added, never also in their own group.
  const isAdded = id => addedIds.includes(id) || (keptIds.includes(id) && !mealIngIds.has(id));
  const addedReal = [...new Set([...addedIds, ...keptIds])].filter(isAdded)
    .map(id => ingredients.find(i => i.id === id)).filter(i => i && isRelevant(i, st));
  const seen = new Set();
  const dedup = arr => arr.filter(i => { if(seen.has(i.id) || isAdded(i.id)) return false; seen.add(i.id); return true; });
  const alwaysNeeded  = dedup(ingredients.filter(i => i.tier==="always" && inArrival(i)));
  const stapleNeeded  = dedup(ingredients.filter(i => i.tier==="staple" && inArrival(i)));
  const mealNeeded    = dedup(ingredients.filter(i => i.tier==="specialty" && inArrival(i)));
  const allListed     = [...alwaysNeeded, ...stapleNeeded, ...mealNeeded];
  const skippedRows   = ingredients.filter(i => arrival.skipped.has(i.id) && !isAdded(i.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity:"base" }));
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
  // As on Inventory (11/24): the panel's Buy / place choice is held and applied in one save when
  // the panel closes (Done, its ⋯, another item's ⋯, All details).
  const applyPending = (extra = {}) => {
    const patch = { ...pending, ...extra };
    if (editId && Object.keys(patch).length) updateItem(editId, patch);
    setPending({});
  };
  const openPanel = id => { applyPending(); setEditId(editId === id ? null : id); };

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
    showToast(ids.size === 1 ? `${changedAmounts.find(i => ids.has(i.id)).name} saved as usual` : "Saved as usual amounts");
  };
  const justThisWeek = () => {
    if (!activePlan) return;
    const before = activePlan.usualPromptDismissed;
    persistDB(writeActivePlan(db, { ...activePlan, usualPromptDismissed: changedSig }));
    showToast("Amounts kept for this week only", () => {
      const cur = latestDB(), p = cur && getActivePlan(cur);
      if (p) persistDB(writeActivePlan(cur, { ...p, usualPromptDismissed: before }));
    });
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

  // Sending (decided 11/16): every Sparky button opens the share sheet with its text, called
  // straight from the tap. A row is sent only when the share completes (a cancel leaves it next
  // up); with no share sheet, or a share error other than a cancel, it copies and counts as sent.
  // What was sent is kept on the plan (orderSent: one key per text) so the ✓ survives the
  // Confirm ↔ Order mounts and drops off by itself when a batch's text changes.
  const textKey  = t => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const orderSent = activePlan?.orderSent || [];
  const isSent    = text => orderSent.includes(textKey(text));
  const markSent  = text => {
    const plan = getActivePlan(db);
    const key  = textKey(text);
    if (!plan || (plan.orderSent || []).includes(key)) return;
    persistDB(writeActivePlan(db, { ...plan, orderSent: [...(plan.orderSent || []), key] }), { background: true });
  };
  const sendText = async text => {
    if (navigator.share) {
      try { await navigator.share({ text }); markSent(text); setManualBatch(null); return; }
      catch (e) { if (e?.name === "AbortError") return; }
    }
    const ok = copyText(text);
    markSent(text);
    // If neither copy path worked, surface the text so it can be selected by hand.
    setManualBatch(ok ? null : { text });
  };

  // Order rows: Intro, then each batch. Sent rows dim with ✓; the first unsent one is next up.
  const orderRows = [
    { key:"intro", label:"Intro", text:introText },
    ...batches.map((b, i) => ({ key:"b" + i, label: batches.length > 1 ? `Batch ${i + 1} of ${batches.length}` : "Batch 1", meta:`${b.length} item${b.length === 1 ? "" : "s"}`, text:framedBatchText(i) })),
  ];
  const nextRow = orderRows.find(r => !isSent(r.text))?.key;
  // Shared items: × drops one from the cart check (dismissedShared); Undo is on the confirmation bar.
  const dropShared = item => {
    toggleDismissShared(item.id);
    showToast(`Removed ${item.name} from the cart check`, () => {
      const cur = latestDB(), p = cur && getActivePlan(cur);
      if (p) persistDB(writeActivePlan(cur, { ...p, dismissedShared: (p.dismissedShared || []).filter(x => x !== item.id) }));
    });
  };

  // The order snapshot (the list as ordered). It goes to PlanTab with the step change and is
  // saved in that same write: saved on its own, the step change right after it re-saved the
  // plan from before the snapshot and dropped it.
  const orderSnapshot = () => ({
    meals: mealPlan,
    items: allNeeded.map(i => ({ ingredientId:i.id, status:"ordering", quantity:(quantities[i.id] !== undefined ? quantities[i.id] : (i.defaultQuantity||"")) })),
  });
  // In the Plan frame, its fixed Next / Finish plan take the snapshot from here.
  registerNext?.(orderSnapshot);
  // Leaving the step with a panel open (Prev / Next) saves its held choice with the step change.
  registerHeld?.(() => (editId && Object.keys(pending).length ? { id: editId, patch: pending } : null));

  // This week's amount (board "Plan, confirm the order"): plain text at the row's right, green
  // when it differs from the usual; tap to change it for this week only.
  const Amount = ({ ing }) => {
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
        <input autoFocus className="cf-amount-input" aria-label={`Amount of ${ing.name}`} value={val} onChange={e => setVal(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          placeholder={ing.defaultQuantity || "Amount"} />
      );
    }
    return <button type="button" className={isCustom ? "cf-amount is-changed" : "cf-amount"} onClick={() => { setVal(effective); setEditing(true); }}>{effective || "+ amount"}</button>;
  };

  // Subline: "×2 meals" for a shared item; in A–Z, "for <meal>" when one planned meal needs it.
  const usedBy = {};
  plannedMeals.forEach(m => (m.ingredients || []).forEach(id => { (usedBy[id] = usedBy[id] || []).push(m.name); }));
  // A Buy type changed this week adds "<type> from next week" (brief §5, 11/25).
  const subOf = (ing, flat) => [multiMeal[ing.id] ? `×${multiMeal[ing.id]} meals`
    : flat && ing.tier === "specialty" && (usedBy[ing.id] || []).length === 1 ? `for ${usedBy[ing.id][0]}` : null,
    ing.nextBuy ? `${ing.nextBuy.toLowerCase()} from next week` : null].filter(Boolean).join(" · ") || null;

  // One row for every list (by meal, A–Z, skipped). Checked = ordering; an unchecked row stays
  // exactly where it is, dimmed, so it can be re-decided in context. The ⋯ panel belongs to
  // its row: the line between items runs under the panel.
  const ItemRow = ({ ing, flat }) => {
    const on  = buying(ing);
    const sub = subOf(ing, flat);
    return (
      <div className="cf-item">
        <div className={on ? "cf-row" : "cf-row is-off"} onClick={() => setOrdering(ing, !on)}>
          <Check checked={on} onChange={v => setOrdering(ing, v)} label={`Order ${ing.name}`} />
          <span className="cf-text"><span className="cf-name">{ing.name}</span>{sub && <span className="cf-sub">{sub}</span>}</span>
          <span className="cf-trail" onClick={e => e.stopPropagation()}>
            <Amount ing={ing} />
            <MoreButton open={editId === ing.id} name={ing.name} onClick={() => openPanel(ing.id)} />
          </span>
        </div>
        {editId === ing.id && (
          <div className="cf-panel">
            <ItemEditPanel ing={ing.realBuy ? { ...ing, ...ing.realBuy } : ing} thisWeek={quantities[ing.id]} onUpdate={patch => updateItem(ing.id, patch)} pending={pending} setPending={setPending}
              onClose={extra => { applyPending(extra); setEditId(null); }} onDetails={onOpenItem ? extra => { applyPending(extra); onOpenItem(ing.id); } : null} />
          </div>
        )}
      </div>
    );
  };
  // Items typed in on this step: the same Check; unchecked ones stay, dimmed (addedOff).
  const AddedRow = ({ item, flat }) => {
    const on = !addedOff.includes(item);
    return (
      <div className="cf-item">
        <div className={on ? "cf-row" : "cf-row is-off"} onClick={() => toggleAdded(item)}>
          <Check checked={on} onChange={() => toggleAdded(item)} label={`Order ${item}`} />
          <span className="cf-text"><span className="cf-name">{item}</span>{flat && <span className="cf-sub">Added</span>}</span>
        </div>
      </div>
    );
  };
  // A sticky grey label over a white card (Confirm groups stick, 24 above, 12 to the card).
  const CfGroup = ({ label, children }) => (
    <section className="cf-group">
      {label && <div className="ui-section-label cf-label">{label}</div>}
      <div className="cf-card">{children}</div>
    </section>
  );

  // Order risk (brief §5, Ruling 17.1): planned home-cooked dishes with nothing on their
  // ingredient list, in one amber card at the top; each opens its meal page.
  const weekStart = activePlan?.weekStartDate;
  const nothingToBuy = (days || []).flatMap((d, i) => (mealPlan[d] || []).map(n => ({ d, i, name: n.trim(), meal: meals.find(m => m.name === n) })))
    .filter(x => x.meal && !(x.meal.ingredients || []).length && !notHomeCooked(x.meal));
  const addItem = () => { const v = newItem.trim(); if (v) { setAddedItems(prev => [...prev, v]); setNewItem(""); } };
  // "+ Add an item" searches the Library as you type (brief §5, 11/25): a match adds the real
  // item to Added; one already being bought reads "Already on the list · <place>"; below the
  // matches, Add "<text>" adds free text as before. Nothing new goes into the Library here.
  const query = newItem.trim().toLowerCase();
  const matches = !query ? [] : ingredients
    .filter(i => query.split(/s+/).every(w => i.name.toLowerCase().includes(w)))
    .sort((a, b) => (b.name.toLowerCase().startsWith(query) - a.name.toLowerCase().startsWith(query)) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .slice(0, 8);
  const placeOf = i => i.storageLocation && i.storageLocation !== "Unassigned" ? i.storageLocation : "No place";
  const addMatch = ing => { onAddFromLibrary?.(ing); setNewItem(""); };
  const flatRows = [
    ...[...allListed, ...addedReal].map(i => ({ key: i.id, name: i.name, ing: i })),
    ...addedItems.map((item, idx) => ({ key: "added" + idx, name: item, added: item })),
  ].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return (
    <div>
      {mode === "confirm" && <>
      {headSlot && createPortal(
        <Segmented label="View" value={view} onChange={setView} options={[{ value: "meal", label: "By meal" }, { value: "flat", label: "A–Z" }]} />, headSlot)}
      <div className="cf">
        {nothingToBuy.length > 0 && (
          <div className="cf-risk">
            {nothingToBuy.map(x => (
              <button key={x.d + x.name} type="button" className="cf-risk-row" onClick={() => onOpenMeal?.(x.meal.id)}>
                <span className="cf-text">
                  <span className="cf-risk-name">{x.name} · {weekStart ? dayTitle(addDaysISO(weekStart, x.i)) : x.d}</span>
                  <span className="cf-risk-sub">Nothing to buy</span>
                </span>
                <RowChevron />
              </button>
            ))}
          </div>
        )}

        {showKeepCard && (
          <section className="cf-keep" aria-label="Amounts changed this week">
            <div className="cf-keep-title">{changedAmounts.length} amount{changedAmounts.length === 1 ? "" : "s"} changed this week</div>
            {changedAmounts.map(i => (
              <div key={i.id} className="cf-keep-row">
                <span className="cf-keep-name">{i.name} <span className="cf-keep-change">· {i.defaultQuantity || "none"} → {quantities[i.id] || "none"}</span></span>
                <button type="button" className="cf-keep-btn" onClick={() => keepAsUsual([i.id])}>Keep as usual</button>
              </div>
            ))}
            <div className="cf-keep-foot">
              <button type="button" className="cf-text-btn" onClick={justThisWeek}>Just this week</button>
              <button type="button" className="cf-text-btn is-strong" onClick={() => keepAsUsual(changedAmounts.map(i => i.id))}>Keep all as usual</button>
            </div>
          </section>
        )}

        {view === "meal" ? <>
          {alwaysNeeded.length > 0 && <CfGroup label="Always buy">{alwaysNeeded.map(i => <ItemRow key={i.id} ing={i} />)}</CfGroup>}
          {stapleNeeded.length > 0 && <CfGroup label="Staples">{stapleNeeded.map(i => <ItemRow key={i.id} ing={i} />)}</CfGroup>}
          {plannedMeals.map(meal => {
            // The meal-specific buy: specialty items on the list when you arrived (always and
            // staple items have their own groups above).
            const ings = ingredients.filter(i => (meal.ingredients || []).includes(i.id) && inArrival(i) && i.tier === "specialty");
            return ings.length ? <CfGroup key={meal.id} label={meal.name}>{ings.map(i => <ItemRow key={i.id} ing={i} />)}</CfGroup> : null;
          })}
          {(addedReal.length > 0 || addedItems.length > 0) && <CfGroup label="Added">
            {addedReal.map(i => <ItemRow key={i.id} ing={i} />)}
            {addedItems.map((item, idx) => <AddedRow key={idx} item={item} />)}
          </CfGroup>}
        </> : flatRows.length > 0 && (
          <CfGroup>{flatRows.map(r => (r.ing ? <ItemRow key={r.key} ing={r.ing} flat /> : <AddedRow key={r.key} item={r.added} flat />))}</CfGroup>
        )}

        {skippedRows.length > 0 && (
          <CfGroup label="Skipped in Inventory">
            <button type="button" className="cf-skipped" aria-expanded={showSkipped} onClick={() => setShowSkipped(v => !v)}>
              <span className="cf-skipped-names">{showSkipped ? `${skippedRows.length} item${skippedRows.length === 1 ? "" : "s"}` : skippedRows.map(i => i.name).join(", ")}</span>
              <span className={showSkipped ? "cf-skipped-chev is-open" : "cf-skipped-chev"} aria-hidden="true"><Icon name="chevron" size={18} /></span>
            </button>
            {showSkipped && skippedRows.map(i => <ItemRow key={i.id} ing={i} flat={view === "flat"} />)}
          </CfGroup>
        )}

        {adding ? (
          <div className="cf-add-box">
            <div className="cf-add-field">
              <input autoFocus className="cf-add-input" aria-label="Item name" placeholder="Item name" value={newItem} onChange={e => setNewItem(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addItem(); if (e.key === "Escape") { setNewItem(""); setAdding(false); } }}
                onBlur={() => { if (!newItem.trim()) setAdding(false); }} />
            </div>
            {query && (
              <div className="cf-card cf-matches">
                {matches.map(i => {
                  const on = buying(i);
                  return (
                    <button key={i.id} type="button" className="cf-match" disabled={on} onMouseDown={e => e.preventDefault()} onClick={() => addMatch(i)}>
                      <span className="cf-name">{i.name}</span>
                      <span className="cf-sub">{on ? `Already on the list · ${placeOf(i)}` : `${placeOf(i)} · ${i.nextBuy || buyWord(i)}`}</span>
                    </button>
                  );
                })}
                <button type="button" className="cf-match cf-match-free" onMouseDown={e => e.preventDefault()} onClick={addItem}>Add “{newItem.trim()}”</button>
              </div>
            )}
          </div>
        ) : <button type="button" className="cf-add" onClick={() => setAdding(true)}>+ Add an item</button>}
      </div>

      {!inFlow && <button style={{ ...S.btn, ...S.btnP }} onClick={() => onNext(orderSnapshot())}>Next: Order ›</button>}
      </>}

      {mode === "sparky" && <>
      {/* ORDER (stage 4c; boards "Plan, order" and "Send to Sparky", decisions 11/12, 11/16, 11/17;
          brief §12). Intro + batch rows under "Send to Sparky · N items": tap a row to share it.
          The next row is tinted with a filled "Share" pill; sent rows grey with "✓ Sent"; later
          rows a grey share icon (still tappable). Shared items: × drops one from the cart check
          (Undo on the bar), then "Share cart check" → "Sent ✓". Full-width lines. No helper copy. */}
      <div className="cf">
        <section className="cf-group">
          <div className="ui-section-label">Send to Sparky · {listLines.length} item{listLines.length === 1 ? "" : "s"}</div>
          <div className="cf-card">
            {orderRows.map(row => {
              const done   = isSent(row.text);
              const isNext = row.key === nextRow;
              return (
                <button key={row.key} type="button" aria-label={`Share ${row.label}`} onClick={() => sendText(row.text)}
                  className={done ? "ord-row is-sent" : isNext ? "ord-row is-next" : "ord-row"}>
                  <span className="cf-text">
                    <span className="ord-label">{row.label}</span>
                    {row.meta && <span className="cf-sub">{row.meta}</span>}
                  </span>
                  {done
                    ? <span className="ord-sent">✓ Sent</span>
                    : isNext
                      ? <span className="ord-share"><Icon name="share" size={18} />Share</span>
                      : <span className="ord-later"><Icon name="share" size={20} /></span>}
                </button>
              );
            })}
          </div>
        </section>

        {activeShared.length > 0 && (
          <section className="cf-group">
            <div className="ui-section-label">Shared items</div>
            <div className="cf-card ord-shared">
              <div className="ord-shared-list">
                {activeShared.map(s => (
                  <div key={s.id} className="ord-shared-row">
                    <span className="ord-shared-name">{s.name}</span>
                    <span className="ord-shared-n">{s.n} meals</span>
                    {/* × drops it from the cart check only; it stays in the order (Confirm removes from the order). */}
                    <button type="button" className="ord-x" aria-label={`Remove ${s.name} from the cart check`} onClick={() => dropShared(s)}>×</button>
                  </div>
                ))}
              </div>
              <button type="button" className={isSent(sharedSparkyText) ? "ord-check is-sent" : "ord-check"} onClick={() => sendText(sharedSparkyText)}>
                {isSent(sharedSparkyText) ? <span>Sent ✓</span> : <><span>Share cart check</span><Icon name="share" size={20} /></>}
              </button>
            </div>
          </section>
        )}

        {manualBatch && (
          <section className="ord-manual">
            <div className="ord-manual-title">Copy was blocked. Select the text and copy it.</div>
            <textarea readOnly className="ord-manual-text" value={manualBatch.text} onFocus={e => e.target.select()} />
            <PillButton inline onClick={() => setManualBatch(null)}>Done</PillButton>
          </section>
        )}
      </div>
      {!inFlow && <button style={{ ...S.btn, ...S.btnP }} onClick={() => onFinish && onFinish(orderSnapshot())}>Finish plan</button>}
      </>}
    </div>
  );
}

export { PlanConfirm };
