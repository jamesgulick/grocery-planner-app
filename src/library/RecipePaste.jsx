// "Paste a recipe" inside the meal page's Ingredients sheet. The same matcher and review as
// before (ingredientMatch.js, PasteReview: paste → Review → one "Add N ingredients"),
// moved out of the old meal editor. Kept until the AI round trip has handled about ten
// real recipes (RULING 16.6). New items arrive Unassigned, so they show under To finish.
import { DEFAULT_PANTRY_IGNORE, analyseLine, analyseRecipe } from "../ingredientMatch.js";
import { toSentenceCase } from "../app/globals.js";
import { PasteReview, RecipePasteRow, recipeRowFrom } from "../manage/MealEditor.jsx";

export function RecipePaste({ chosen, meals, ingredients, pantryIgnore, onSetPantryIgnore, onAdd, onCancel }) {
  const ignoreList = pantryIgnore || DEFAULT_PANTRY_IGNORE;
  const sideNames = new Set((meals || []).filter(m => m.type === "side").map(m => m.name.trim().toLowerCase()));
  const recheck = (row, list) => {
    const r = analyseLine(row.part || row.line, ingredients, list)[0] || { kind: "skip", reason: "empty" };
    return { ...recipeRowFrom({ ...r, line: row.line, part: row.part }, chosen) };
  };
  const add = rows => {
    const ids = new Set(chosen);
    const byName = new Map(ingredients.map(i => [i.name.trim().toLowerCase(), i]));
    const created = [];
    for (const r of rows) {
      if (!r.on) continue;
      if (r.mode === "match") ids.add(r.item.id);
      if (r.mode === "new") {
        const name = toSentenceCase((r.name || "").trim());
        if (!name) continue;
        const hit = byName.get(name.toLowerCase());
        if (hit) { ids.add(hit.id); continue; }
        const ing = { id: "i" + Date.now() + Math.random().toString(36).slice(2, 7), createdAt: new Date().toISOString(), name, storageLocation: "Unassigned", tier: "specialty", defaultQuantity: "" };
        byName.set(name.toLowerCase(), ing); created.push(ing); ids.add(ing.id);
      }
    }
    onAdd([...ids], created);
  };
  const label = rows => {
    const ids = new Set(), names = new Set();
    rows.forEach(r => { if (r.on && r.mode === "match") ids.add(r.item.id); if (r.on && r.mode === "new" && (r.name || "").trim()) names.add(r.name.trim().toLowerCase()); });
    const n = ids.size + names.size;
    return n ? `Add ${n} ingredient${n === 1 ? "" : "s"}` : null;
  };
  return (
    <div className="shell-legacy">
      <PasteReview
        placeholder={"2 cups shredded cheddar cheese\n1 yellow onion, chopped\n…"}
        analyse={text => analyseRecipe(text, ingredients, ignoreList).map(r => recipeRowFrom(r, chosen))}
        confirmLabel={label} onConfirm={add} onCancel={onCancel}
        renderRow={(row, setRow) => (
          <RecipePasteRow row={row} set={setRow} ingredients={ingredients} sideNames={sideNames}
            onIgnore={term => { const list = [...ignoreList, term]; onSetPantryIgnore(list); setRow(recheck(row, list)); }}
            onUnignore={term => { const list = ignoreList.filter(t => t !== term); onSetPantryIgnore(list); setRow(recheck(row, list)); }} />
        )} />
    </div>
  );
}
