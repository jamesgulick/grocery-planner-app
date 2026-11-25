// Plan › Inventory (stage 4c; board "Plan, inventory", decisions 11/11–11/16, brief §5): walk the
// storage places (the tabs live in Plan's header), each in four sections under sticky labels:
// Always buy · Weekly staples · For this week's meals · Slow staples (collapsed to one line of
// names). Checked = buying (ordering.js); an unchecked row dims and drops its amount. A "No
// place" tab follows the real places when this week's list has items with no storage place.
import React, { useEffect, useState } from "react";
import { INVENTORY_LOCS } from "../app/globals.js";
import { multiMealCounts } from "../app/pills.js";
import { Check } from "../components/common.jsx";
import { ItemEditPanel, MoreButton } from "../components/ItemEditPanel.jsx";
import { PickListSheet } from "../library/LibrarySheets.jsx";
import { showToast } from "../ui/toast.js";
import { Icon } from "../ui/kit.jsx";
import { isOrdering } from "./ordering.js";
import { NO_PLACE, hasPlace, mealIngredientIds } from "./inventoryModel.js";
import "./confirm.css";
import "./inventory.css";

function PlanInventory({ onOpenItem, registerHeld, loc, placed = {}, setPlaced, checkedIds, stapleFlags, setOrdering, quantities, setQuantities, mealPlan, meals, ingredients, onUpdateItem, keptIds = [] }) {
  const [editId, setEditId] = useState(null);     // item whose ⋯ panel is open
  const [pending, setPending] = useState({});     // its Buy / place choice, applied when the panel closes
  const [placeFor, setPlaceFor] = useState(null); // No place: the item whose "Kept in" sheet is open
  const [slowOpen, setSlowOpen] = useState(null); // slow staples card: null = decide from the data
  // Leaving the place with a panel open still keeps its choice.
  useEffect(() => { if (editId && Object.keys(pending).length) onUpdateItem?.(editId, pending); setPending({}); setEditId(null); setSlowOpen(null); setPlaceFor(null); }, [loc]);

  // Leaving the step with a panel open (‹ Meals, Next: Confirm, the step bar) saves its held choice.
  registerHeld?.(() => (editId && Object.keys(pending).length ? { id: editId, patch: pending } : null));

  const noPlace    = loc === NO_PLACE;
  const mealIngIds = mealIngredientIds(mealPlan, meals);
  const locIngs    = noPlace ? ingredients.filter(i => !hasPlace(i) || placed[i.id])
    : ingredients.filter(i => i.storageLocation === loc && !placed[i.id]);
  const alwaysHere = locIngs.filter(i => i.tier === "always");
  // A staple a planned meal needs goes in "For this week's meals" and starts checked (11/16).
  const stapleAll  = locIngs.filter(i => i.tier === "staple");
  const weeklyAll  = stapleAll.filter(i => (i.stapleType || "weekly") === "weekly");
  const slowAll    = stapleAll.filter(i => (i.stapleType || "weekly") === "slow");
  const weeklyHere = weeklyAll.filter(i => !mealIngIds.has(i.id));
  const slowHere   = slowAll.filter(i => !mealIngIds.has(i.id));
  const mealHere   = [
    ...locIngs.filter(i => i.tier === "specialty" && mealIngIds.has(i.id)),   // As needed with no meal: Confirm's "Added"
    ...weeklyAll.filter(i => mealIngIds.has(i.id)), ...slowAll.filter(i => mealIngIds.has(i.id)),
  ];

  const st        = { checkedIds, stapleFlags, mealIngIds, keptIds };
  const buying    = ing => isOrdering(ing, st);
  const multiMeal = multiMealCounts(mealPlan, meals);
  // The slow staples card opens by itself when one is already checked (so a buy is never
  // hidden), once per place; after that it's yours to open or close.
  useEffect(() => { if (slowOpen === null && slowHere.some(buying)) setSlowOpen(true); });

  const usedByMeal = {};
  const planned = new Set(Object.values(mealPlan || {}).flat());
  meals.filter(m => planned.has(m.name)).forEach(m => (m.ingredients || []).forEach(id => { (usedByMeal[id] = usedByMeal[id] || []).push(m.name); }));

  // This week's amount: an outlined pill, pale green when it differs from the usual; tap to
  // change it for this week only (the item's usual amount is the panel's).
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
        <input autoFocus className="inv-amount-input" aria-label={`Amount of ${ing.name}`} value={val} onChange={e => setVal(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          placeholder={ing.defaultQuantity || "Amount"} />
      );
    }
    return <button type="button" className={isCustom ? "inv-amount is-changed" : "inv-amount"} onClick={() => { setVal(effective); setEditing(true); }}>{effective || "+ amount"}</button>;
  };

  // The panel's choices are held and applied in one save when it closes; then the item moves.
  const updateItem = (ing, patch) => {
    if (!onUpdateItem) return;
    onUpdateItem(ing.id, patch);
    const to = patch.storageLocation;
    if (to && to !== ing.storageLocation && INVENTORY_LOCS.includes(to)) showToast(`${ing.name} goes in ${to} from now on`);
  };
  const applyPending = (extra = {}) => {
    const open = editId && ingredients.find(i => i.id === editId);
    const patch = { ...pending, ...extra };
    if (open && Object.keys(patch).length) updateItem(open, patch);
    setPending({});
  };
  const openPanel = id => { applyPending(); setEditId(editId === id ? null : id); };
  // No place (brief §5): ⋯ opens "Kept in"; the choice is saved for good and the row stays
  // here for the rest of this pass, reading "… · goes in <place>".
  const choosePlace = (ing, place) => {
    onUpdateItem?.(ing.id, { storageLocation: place });
    setPlaced?.(p => ({ ...p, [ing.id]: place }));
    showToast(`${ing.name} goes in ${place} from now on`);
    setPlaceFor(null);
  };

  const ItemRow = ({ ing }) => {
    const on    = buying(ing);
    const users = usedByMeal[ing.id] || [];
    const subs  = [multiMeal[ing.id] ? `×${multiMeal[ing.id]} meals` : users.length === 1 ? `for ${users[0]}` : null,
      noPlace && placed[ing.id] ? `goes in ${placed[ing.id]}` : null,
      ing.nextBuy ? `${ing.nextBuy.toLowerCase()} from next week` : null].filter(Boolean);   // Buy changed this week (brief §5, 11/25)
    const open  = editId === ing.id;
    return (
      <div className="inv-item">
        <div className={on ? "inv-row" : "inv-row is-off"} onClick={() => setOrdering(ing, !on)}>
          <Check checked={on} onChange={v => setOrdering(ing, v)} label={`Buy ${ing.name}`} />
          <span className="cf-text"><span className="cf-name">{ing.name}</span>{subs.length > 0 && <span className="cf-sub">{subs.join(" · ")}</span>}</span>
          <span className="cf-trail" onClick={e => e.stopPropagation()}>
            {on && <Amount ing={ing} />}
            {onUpdateItem && (noPlace
              ? <button type="button" className={placeFor === ing.id ? "cf-more is-open" : "cf-more"} aria-label={`Kept in, ${ing.name}`} onClick={() => setPlaceFor(ing.id)}>⋯</button>
              : <MoreButton open={open} name={ing.name} onClick={() => openPanel(ing.id)} />)}
          </span>
        </div>
        {open && (
          <div className="cf-panel">
            <ItemEditPanel ing={ing.realBuy ? { ...ing, ...ing.realBuy } : ing} onUpdate={patch => updateItem(ing, patch)} pending={pending} setPending={setPending}
              onClose={extra => { applyPending(extra); setEditId(null); }} onDetails={onOpenItem ? extra => { applyPending(extra); onOpenItem(ing.id); } : null} />
          </div>
        )}
      </div>
    );
  };
  const Section = ({ label, children }) => (
    <section className="cf-group">
      <div className="ui-section-label cf-label">{label}</div>
      <div className="cf-card">{children}</div>
    </section>
  );
  const placeIng = placeFor && ingredients.find(i => i.id === placeFor);
  const empty = !alwaysHere.length && !weeklyHere.length && !mealHere.length && !slowHere.length;

  return (
    <div className="cf inv">
      {alwaysHere.length > 0 && <Section label="Always buy">{alwaysHere.map(i => <ItemRow key={i.id} ing={i} />)}</Section>}
      {weeklyHere.length > 0 && <Section label="Weekly staples">{weeklyHere.map(i => <ItemRow key={i.id} ing={i} />)}</Section>}
      {mealHere.length > 0 && <Section label="For this week's meals">{mealHere.map(i => <ItemRow key={i.id} ing={i} />)}</Section>}
      {slowHere.length > 0 && (
        <Section label="Slow staples">
          {/* Collapsed to one line of names (11/12, the Skipped-in-Inventory pattern). */}
          <button type="button" className="cf-skipped" aria-expanded={!!slowOpen} onClick={() => setSlowOpen(!slowOpen)}>
            <span className="cf-skipped-names">{slowOpen ? `${slowHere.length} item${slowHere.length === 1 ? "" : "s"}` : slowHere.map(i => i.name).join(", ")}</span>
            <span className={slowOpen ? "cf-skipped-chev is-open" : "cf-skipped-chev"} aria-hidden="true"><Icon name="chevron" size={18} /></span>
          </button>
          {slowOpen && slowHere.map(i => <ItemRow key={i.id} ing={i} />)}
        </Section>
      )}
      {empty && <div className="inv-empty">No items stored here</div>}
      {placeIng && <PickListSheet title="Kept in" options={INVENTORY_LOCS} value={placed[placeIng.id] || null} onChange={v => choosePlace(placeIng, v)} onClose={() => setPlaceFor(null)} />}
    </div>
  );
}

export { PlanInventory };
