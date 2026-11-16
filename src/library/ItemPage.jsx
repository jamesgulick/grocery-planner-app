// The item page (board "Library lists", item page; Decisions 11/15): name with ✎ (rename in
// place); subline place · buy type. Buy (one four-way choice in Inventory's words, replacing
// tier + stapleType), Usual amount (typed sheet), Kept in (the place list), Used in · N (meal
// rows that open their pages), then Delete item (speed bump: the meals it leaves, any list).
// A Buy change from here doesn't touch this week's list; re-filing from Inventory or Confirm
// still goes through the plan's updateItem, which carries the on/off state across.
import { useState } from "react";
import { INVENTORY_LOCS } from "../app/globals.js";
import { DeleteButton, FieldLabel, Group, Row } from "../ui/kit.jsx";
import { DeleteSheet, PickListSheet, TextSheet } from "./LibrarySheets.jsx";
import { PageHeader, SectionCard } from "./MealPage.jsx";
import { BUY_OPTIONS, buyOf, buyPatch, buyWord, isSide, itemDeleteImpact, placeOf, weekOfWords, withField, withoutItem } from "./libraryModel.js";

const key = s => String(s || "").trim().toLowerCase();

export function ItemPage({ db, persistDB, itemId, onBack, backLabel, onOpenMeal }) {
  const item = (db.ingredients || []).find(i => i.id === itemId);
  const [sheet, setSheet] = useState(null);
  if (!item) return null;

  const update = patch => persistDB({
    ...db,
    ingredients: db.ingredients.map(i => {
      if (i.id !== item.id) return i;
      let n = i;
      for (const [k, v] of Object.entries(patch)) n = withField(n, k, v);
      return n;
    }),
  });
  const usedIn = (db.meals || []).filter(m => (m.ingredients || []).includes(item.id)).sort((a, b) => a.name.localeCompare(b.name));
  const place = placeOf(item);
  const sub = [place || "No storage place", buyWord(item)].join(" · ");
  const close = () => setSheet(null);

  let open = null;
  if (sheet === "amount") open = <TextSheet title="Usual amount" value={item.defaultQuantity} onSave={v => persistDB({ ...db, ingredients: db.ingredients.map(i => (i.id === item.id ? { ...i, defaultQuantity: v } : i)) })} onClose={close} />;
  if (sheet === "place") open = <PickListSheet title="Kept in" options={INVENTORY_LOCS} value={place} onChange={v => update({ storageLocation: v })} onClose={close} />;
  if (sheet === "delete") {
    const impact = itemDeleteImpact(db, item);
    const lines = [
      impact.meals.length ? ["Removed from", impact.meals.join(", ")] : null,
      impact.onLists.length ? ["On a list", impact.onLists.map(weekOfWords).join(", ")] : null,
    ].filter(Boolean);
    open = <DeleteSheet name={item.name} lines={lines} onClose={close} onDelete={() => { persistDB(withoutItem(db, item.id)); onBack(); }} />;
  }

  return (
    <div className="lib-page">
      <PageHeader name={item.name} sub={sub} onBack={onBack} backLabel={backLabel}
        renameProblem={n => {
          if (!key(n)) return "Give the item a name.";
          const clash = db.ingredients.find(i => i.id !== item.id && key(i.name) === key(n));
          return clash ? `"${clash.name.trim()}" is already an item. Pick a different name.` : null;
        }}
        onRename={n => persistDB({ ...db, ingredients: db.ingredients.map(i => (i.id === item.id ? { ...i, name: n } : i)) })} />

      <div className="lib-group lib-group-flat">
        <div className="lib-section">
          <FieldLabel>Buy</FieldLabel>
          <Group>
            {BUY_OPTIONS.map(o => (
              <Row key={o.value} title={o.label} chevron={false} onClick={() => update(buyPatch(o.value))}
                trailing={buyOf(item) === o.value ? <span className="shell-check" aria-label="Selected">✓</span> : null} />
            ))}
          </Group>
        </div>
        <SectionCard label="Usual amount" onClick={() => setSheet("amount")} value={item.defaultQuantity || null} />
        <SectionCard label="Kept in" onClick={() => setSheet("place")} problem={!place} value={place || "No storage place"} />
        {usedIn.length > 0 && (
          <div className="lib-section">
            <FieldLabel>{`Used in · ${usedIn.length}`}</FieldLabel>
            <Group>{usedIn.map(m => <Row key={m.id} title={m.name} strong={!isSide(m)} value={isSide(m) ? "Side" : null} onClick={() => onOpenMeal(m.id)} />)}</Group>
          </div>
        )}
        <DeleteButton onClick={() => setSheet("delete")}>Delete item</DeleteButton>
      </div>
      {open}
    </div>
  );
}
