// The app's controlled vocabularies, in one place: the meal page's pick sheets read them, and
// every Send to AI writes them into the file as _meta.vocab (RULING 16.8), so the AI never
// keeps its own copy and nothing drifts when a value is added. Facet values are
// FACET-VOCABULARY.md's live values; add a value there first, then here.
import { INVENTORY_LOCS, MEAL_TYPES } from "./globals.js";

export const FACET_VOCAB = {
  form:       ["casserole", "component", "stew", "plated-entree", "finger-food", "pasta", "sandwich", "soup", "salad", "sauce", "bowl", "custard-pie"],
  service:    ["home-cooked", "takeout", "choose-your-own", "dine-out"],
  experience: ["hearty", "light", "picnicky", "pubfood", "fancy"],
  plate:      ["meaty", "starchy", "cheesy", "bread-based", "vegetable-forward", "fried", "brothy", "creamy", "salty", "seafood", "rich", "deli-salad", "chilled", "eggy"],
};

// FACET_VOCAB values in plain words (Decisions 11/15: 'Plated entrée', 'Custard or pie',
// 'Pub food', 'Bread-based'). A value not listed reads as itself, capitalised.
const FACET_WORDS = {
  "plated-entree": "Plated entrée", "finger-food": "Finger food", "custard-pie": "Custard or pie",
  "home-cooked": "Home-cooked", "choose-your-own": "Choose-your-own", "dine-out": "Dine-out",
  pubfood: "Pub food", "bread-based": "Bread-based", "vegetable-forward": "Vegetable-forward", "deli-salad": "Deli salad",
};
export const facetWord = v => FACET_WORDS[v] || (v ? v[0].toUpperCase() + v.slice(1) : "");

/** What _meta.vocab carries: every value a meal or item field may take. */
export const exportVocab = () => ({
  ...FACET_VOCAB,
  type: MEAL_TYPES,
  effort: ["easy", "medium", "involved"],
  tempAffinity: ["comfort", "neutral", "light"],
  carryDays: [1, 2, 3, 4, 5, 6, 7],
  carryForWhom: ["followLikes", "all", "<names>"],
  cost: ["low", "moderate", "high"],
  cadence: ["weekly", "biweekly", "occasional"],
  rotation: ["in", "experimental", "manual"],
  storageLocation: INVENTORY_LOCS,
  buyType: [
    { label: "Always buy", tier: "always" },
    { label: "Weekly staple", tier: "staple", stapleType: "weekly" },
    { label: "Slow staple", tier: "staple", stapleType: "slow" },
    { label: "As needed", tier: "specialty" },
  ],
});
