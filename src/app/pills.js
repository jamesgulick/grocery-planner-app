// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { CONSTANTS as ENGINE } from "../engine/composeWeek.js";

// ── Day pills ─────────────────────────────────────────────────────────────────
// A pill is an attribute on a day: { label, source: "auto"|"manual" }.
// Built-in labels are visual only now; custom labels likewise.
//   special → a plain label to guide manual selection (no generation effect)
// Grill is NOT a pill you set any more (INTEGRATION RULING 4): the engine decides
// grillability itself from the day's forecast AND the grill-season toggle. The day
// card shows that derived state read-only, using the engine's own thresholds.
// Time to cook is not a pill either — see TIME_LEVELS (per-day timeLevels).
const BUILTIN_PILLS = ["special"];
const PILL_STYLE = {
  grill:   { c:"#9A3412",      bg:"#FFEDD5" },
  special: { c:"#7C3AED",      bg:"#EDE9FE" },
};

// Would the engine allow grilling on a day with this forecast? Same rule as
// composeWeek's capability gate (season open AND warm AND dry).
const engineGrillOk = (grillOpen, fc) => !!grillOpen && !!fc && fc.hi >= ENGINE.GRILL_MIN_F && fc.pop <= ENGINE.GRILL_MAX_POP;

// Count how many of THIS WEEK's planned meals use each ingredient. The app stores
// meal→ingredient links as presence only (no amounts), so this can flag overlap
// ("used in 3 meals") but not compute whether one package suffices — James judges
// that. Returns { ingredientId: count } for ingredients used by 2+ planned meals.
function multiMealCounts(mealPlan, meals) {
  const plannedNames = new Set(Object.values(mealPlan || {}).flat());
  const counts = {};
  meals.filter(m => plannedNames.has(m.name)).forEach(m => {
    (m.ingredients || []).forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  });
  const multi = {};
  Object.entries(counts).forEach(([id, n]) => { if (n >= 2) multi[id] = n; });
  return multi;
}

export { BUILTIN_PILLS, PILL_STYLE, engineGrillOk, multiMealCounts };
