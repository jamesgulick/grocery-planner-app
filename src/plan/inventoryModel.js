// Plan › Inventory's places (stage 4c; board "Plan, inventory"; brief §5 "Order risks").
// The walk goes through the real storage places, then a "No place" tab, only when this
// week's list has items with no storage place.
import { INVENTORY_LOCS } from "../app/globals.js";

export const NO_PLACE = "No place";

export const hasPlace = ing => INVENTORY_LOCS.includes(ing.storageLocation);

/** Ids of the ingredients the week's planned meals use. */
export function mealIngredientIds(mealPlan, meals) {
  const planned = new Set(Object.values(mealPlan || {}).flat());
  return new Set(meals.filter(m => planned.has(m.name)).flatMap(m => m.ingredients || []));
}

/** Would Inventory show this item this week? Always and staple items always; an "As needed"
 *  item only when a planned meal needs it. One added or kept with no meal shows in Confirm's
 *  "Added" group instead (brief §5, "As needed, adding and reclassifying"). */
export const onInventory = (ing, mealIngIds) =>
  ing.tier === "always" || ing.tier === "staple" || (ing.tier === "specialty" && mealIngIds.has(ing.id));

/** The tabs: every real place, then "No place" when needed. `placed` holds items given a
 *  place during this pass: they stay on No place until the pass ends (rows don't jump tabs). */
export function inventoryLocs(ingredients, mealPlan, meals, placed = {}) {
  const ids = mealIngredientIds(mealPlan, meals);
  const noPlace = ingredients.some(i => onInventory(i, ids) && (!hasPlace(i) || placed[i.id]));
  return noPlace ? [...INVENTORY_LOCS, NO_PLACE] : INVENTORY_LOCS;
}
