// Meal renames. Plans and history name their meals by NAME (a plan's mealPlan, its
// plates' dish names, the day tail, the archived-week list), so a rename has to reach
// every one of them or the meal falls out of its own history: its ingredients leave the
// list, its recency goes blank, and past weeks call it unknown. Pure and node-testable.
//
// Every place that stores a meal's name is listed here. A new name-keyed field must be
// added to renameMeal too; engine/merge/meal-rename-test.mjs checks that the engine's
// inputs, the recency map and the planned-meals list come out the same after a rename.

const key = (s) => String(s || '').trim().toLowerCase();

/** Why `name` can't be used for meal `id` (null when it can). Names compare trimmed and case-blind. */
export function mealNameProblem(meals, id, name) {
  const k = key(name);
  if (!k) return 'Give the meal a name.';
  const clash = (meals || []).find((m) => m.id !== id && key(m.name) === k);
  return clash ? `"${clash.name.trim()}" is already a meal. Pick a different name.` : null;
}

const swapNames = (names, oldK, newName) =>
  Array.isArray(names) && names.some((n) => key(n) === oldK)
    ? names.map((n) => (key(n) === oldK ? newName : n))
    : names;

const renameMealPlan = (mealPlan, oldK, newName) => {
  if (!mealPlan) return mealPlan;
  let changed = false;
  const out = {};
  for (const [day, names] of Object.entries(mealPlan)) {
    out[day] = swapNames(names, oldK, newName);
    if (out[day] !== names) changed = true;
  }
  return changed ? out : mealPlan;
};

// A dish is this meal when its id says so, or (for a dish saved without an id) its name.
const renamePlates = (plates, id, oldK, newName) => {
  if (!plates) return plates;
  let changed = false;
  const out = {};
  for (const [day, plate] of Object.entries(plates)) {
    const hit = (plate?.dishes || []).some((d) => d.mealId === id || (!d.mealId && key(d.name) === oldK));
    if (!hit) { out[day] = plate; continue; }
    changed = true;
    out[day] = { ...plate, dishes: plate.dishes.map((d) => (d.mealId === id || (!d.mealId && key(d.name) === oldK) ? { ...d, name: newName } : d)) };
  }
  return changed ? out : plates;
};

const renameWeek = (w, id, oldK, newName) => {
  if (!w) return w;
  const mealPlan = renameMealPlan(w.mealPlan, oldK, newName);
  const plates = renamePlates(w.plates, id, oldK, newName);
  return mealPlan === w.mealPlan && plates === w.plates ? w : { ...w, mealPlan, plates };
};

/**
 * The db with meal `id` called `newName` everywhere it is named: the meal record, both
 * plans (mealPlan + plates), the day tail and the archived-week list. Returns the db
 * unchanged when the name is the same; throws if mealNameProblem objects (the editors
 * check first, so this is a guard). What was already sent or published — the outbox,
 * the family list, the calendar — is a record of what went out and keeps the old name.
 */
export function renameMeal(db, id, newName) {
  const meal = (db.meals || []).find((m) => m.id === id);
  if (!meal) return db;
  const name = String(newName || '').trim();
  if (name === meal.name) return db;
  const problem = mealNameProblem(db.meals, id, name);
  if (problem) throw new Error(problem);
  const oldK = key(meal.name);
  const plans = db.plans
    ? Object.fromEntries(Object.entries(db.plans).map(([slot, p]) => [slot, renameWeek(p, id, oldK, name)]))
    : db.plans;
  return {
    ...db,
    meals: db.meals.map((m) => (m.id === id ? { ...m, name } : m)),
    plans,
    planTail: (db.planTail || []).map((w) => renameWeek(w, id, oldK, name)),
    mealHistory: (db.mealHistory || []).map((h) => {
      const meals = swapNames(h.meals, oldK, name), ids = swapNames(h.ids, oldK, name);
      return meals === h.meals && ids === h.ids ? h : { ...h, meals, ...(h.ids ? { ids } : {}) };
    }),
  };
}
