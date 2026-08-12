import React, { useState, useEffect, useRef } from "react";

// ── Globals ────────────────────────────────────────────────────────────────────

const DAYS_ALL   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAYS_FULL  = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const FAMILY     = [
  { name:"D", phone:"" },
  { name:"H",   phone:"" },
  { name:"N",   phone:"" },
  { name:"C",   phone:"" },
];
const STORAGE_LOCATIONS = ["Unassigned","Pantry","Fridge","Freezer","Garage","Cabinet","Seasonings","Medicine Cabinet","Other"];
// Locations walked during the plan-flow inventory step (everything real, i.e.
// excluding the "Unassigned" placeholder). Derived so it never drifts from the
// master list above.
const INVENTORY_LOCS = STORAGE_LOCATIONS.filter(l => l !== "Unassigned");
const TIERS   = ["always","staple","specialty"];
// Subtypes per tier. To add a subtype to any tier, add it here — the Items table
// dropdown and labels derive from this, no hard-coded combinations.
const TIER_SUBTYPES = { staple: ["weekly","slow"] };
const DEFAULT_SUBTYPE = tier => (TIER_SUBTYPES[tier] || [])[0] || null;

// Expand tiers into selectable tier(+subtype) options for inline editors.
// e.g. always · staple/weekly · staple/slow · specialty
function tierOptions() {
  const out = [];
  TIERS.forEach(tier => {
    const subs = TIER_SUBTYPES[tier];
    if (subs && subs.length) subs.forEach(sub => out.push({ tier, subtype:sub, value:`${tier}:${sub}`, label:`${tier} · ${sub}` }));
    else out.push({ tier, subtype:null, value:tier, label:tier });
  });
  return out;
}
// Map an item to its current tierOptions value, applying the default subtype.
const tierValueOf = ing => {
  const subs = TIER_SUBTYPES[ing.tier];
  return subs && subs.length ? `${ing.tier}:${ing.stapleType || subs[0]}` : ing.tier;
};
const EFFORTS = ["easy","medium","involved"];
const WEATHER_OPTIONS  = ["any","hot","cold","grill"];
const LEFTOVER_OPTIONS = ["none","yes"];
// Day-fit affinity: how a meal matches the day's feel. Drives soft suggestion
// nudges (comfort on cold days, light on hot). Separate from grillable (a hard
// gate on bad-grill weather). See the meal-suggestion weighting.
const TEMP_AFFINITY_OPTIONS = ["comfort","neutral","light"];
const MEAL_TYPES       = ["dinner","side","remix","batch","takeout"];
const FAMILY_NAMES     = ["D","H","N","C","J"];
const DB_KEY           = "grocery_db";
const RECOVERY_KEY     = "grocery_recovery";
const SHORTCUT_GET     = "shortcuts://run-shortcut?name=Get%20My%20Grocery%20Data";
const SHORTCUT_SAVE    = "shortcuts://run-shortcut?name=Save%20My%20Grocery%20Data";
const PLAN_STEPS       = ["Welcome","Meals","Inventory","Confirm","Sparky"];

const isPC = () => !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const toSentenceCase = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

// Header info, now emitted as a JSON node (not prepended text) so the exported
// file is 100% valid JSON — the mid-week Shortcut can parse it directly, and
// you still see the summary at the top of the file during data exchange.
const exportMeta = db => {
  const now = new Date();
  const et = now.toLocaleString("en-US", { timeZone:"America/New_York", weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
  return {
    app:            "GroceryDB",
    summary:        `${(db.meals||[]).length} meals | ${(db.ingredients||[]).length} items | ${et} ET`,
    mealCount:      (db.meals||[]).length,
    itemCount:      (db.ingredients||[]).length,
    exportedAt:     now.toISOString(),
    // Carried through so a re-import can show real provenance (as-of time,
    // seed-vs-real) instead of re-deriving it from the fresh export moment.
    dataChangedAt:  db.dataChangedAt || null,
    lastExportedAt: db.lastExportedAt || null,
  };
};

// Assemble the object written on export: a _meta node first (human-readable
// summary), a fresh published menu for the Shortcut, then the full db. Pure
// JSON, no prepended text.
const buildExportDB = db => ({ _meta: exportMeta(db), ...db, published: buildPublished(db) });

// On import, drop export-only nodes so they don't go stale in stored state.
// They're regenerated fresh on every export.
// Pull a JSON array out of a model reply, tolerating markdown fences, prose
// preambles, and stray text. Returns [] rather than throwing, so one bad reply
// degrades the feature instead of killing the whole cross-check.
const parseJSONArray = text => {
  if (!text) return [];
  let s = String(text).trim();
  // Strip ```json ... ``` fences if present.
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = s.indexOf("[");
  const end   = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try { const v = JSON.parse(s.slice(start, end + 1)); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
};

const stripExportNodes = ({ _meta, published, ...rest }) => rest;

// A backup (download or copy) stamps lastExportedAt with the SAME instant
// embedded in the artifact's own _meta, so the file/clipboard content is
// self-consistent with what the app now believes just happened. Shared by
// the Manage > Config export section and the header's contextual backup
// action (SPEC-data-provenance.md).
const buildBackupPayload = db => {
  const now = new Date().toISOString();
  const fresh = buildExportDB({ ...db, lastExportedAt: now });
  return { now, text: JSON.stringify(fresh, null, 2) };
};

// Writes an actual .json file via Blob + a temporary <a download>, then
// stamps lastExportedAt as a background write (backing up isn't itself a
// change to the grocery data).
const downloadBackup = (db, persistDB) => {
  const { now, text } = buildBackupPayload(db);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "grocery_db.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  persistDB({ ...db, lastExportedAt: now }, { background: true });
};

// Build the "published" menu the mid-week Shortcut reads. This is a generic,
// extensible framework: the app emits a flat list of SENDABLE ITEMS, each with
// a menu `label` and a ready-to-send `body`. The Shortcut is a dumb picker —
// you choose recipient(s) yourself and one or more items by label; it joins the
// chosen bodies into one multi-line message and sends. No dates, no "today",
// no recipient data, no formatting logic on the Shortcut side.
//
// A day is just one kind of item. "Whole week" is another. Future items
// (leftovers, shopping reminder, pickup time, ...) slot in here with zero
// Shortcut changes — they're all label+body.
//
// Shape (db.published):
// {
//   v: 2,
//   publishedAt: "...Z",
//   items: [ { key, label, body }, ... ]
// }
const buildPublished = db => {
  const settings    = db.settings || DEFAULT_SETTINGS;

  // Always the CURRENT plan (the week actually being shopped/lived), never
  // "next" — the family shouldn't be told about a week that isn't happening
  // yet, even while the owner is mid-edit on next week's draft. The live
  // mealPlan (keyed by day abbr -> meal NAMES) is preferred over the last
  // committed meals snapshot, falling back to empty.
  const plan       = getCurrentPlan(db);
  // Day-ordering follows the current plan's own date; shoppingDay is only the
  // no-plan-yet fallback (see SPEC-date-drives-ordering.md).
  const { days, daysFull } = plan?.weekStartDate
    ? getWeekFromDate(plan.weekStartDate)
    : getWeekFromDay(settings.shoppingDay || "Wednesday");
  const draftMeals = plan?.mealPlan;
  const planMeals  = (draftMeals && Object.values(draftMeals).some(a => (a||[]).length))
    ? draftMeals
    : (plan?.meals || {});

  const mealText = abbr => {
    const m = planMeals[abbr] || [];
    return m.length ? m.join(", ") : "Not planned";
  };

  // Outbox is the quick family-facing dinner list — no notes (day or meal).
  // Note specifics live in the fridge printout / JSON index, not here.
  const dayLine = (abbr, full) => `${full}: ${mealText(abbr)}`;

  // One item per day.
  const dayItems = days.map((abbr, i) => ({
    key:   abbr.toLowerCase(),
    label: daysFull[i],
    body:  dayLine(abbr, daysFull[i]),
  }));

  // Pre-baked "Whole week": every day's line joined.
  const weekItem = {
    key:   "week",
    label: "Whole week",
    body:  days.map((abbr, i) => dayLine(abbr, daysFull[i])).join("\n"),
  };

  return {
    v: 2,
    publishedAt: new Date().toISOString(),
    items: [...dayItems, weekItem],
  };
};

const formatSavedAt = iso => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }) + " at " + d.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" });
};

const extractJSON = text => {
  // Find ALL valid top-level JSON objects and return the largest one
  // (largest = most complete, handles stacked copies in iCloud note)
  const candidates = [];
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf("{", pos);
    if (start === -1) break;
    let depth = 0, end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) break;
    const candidate = text.substring(start, end + 1);
    try { JSON.parse(candidate); candidates.push(candidate); } catch(e) {}
    pos = start + 1;
  }
  if (!candidates.length) throw new Error("No valid JSON found");
  // Return the largest valid JSON block
  return candidates.reduce((a, b) => a.length >= b.length ? a : b);
};

// Shared ordering builder: given the index (into DAYS_ALL/DAYS_FULL) of the
// day the week starts on, produce the 7-day days/daysFull/effortMap triple.
function buildWeekFromStartIndex(startIdx) {
  const days = [], daysFull = [], effortMap = {};
  for (let i = 0; i < 7; i++) {
    const idx = (startIdx + i) % 7;
    days.push(DAYS_ALL[idx]);
    daysFull.push(DAYS_FULL[idx]);
    effortMap[DAYS_ALL[idx]] = (i === 0 || DAYS_ALL[idx] === "Mon" || DAYS_ALL[idx] === "Tue") ? "easy" : "medium";
  }
  return { days, daysFull, effortMap };
}

// Fallback ordering source, used only when no active plan (and thus no
// weekStartDate) exists yet — e.g. the very first load. See getWeekFromDate,
// which is the real ordering source once a plan exists.
function getWeekFromDay(shoppingDay) {
  const abbr    = { Sunday:"Sun", Monday:"Mon", Tuesday:"Tue", Wednesday:"Wed", Thursday:"Thu", Friday:"Fri", Saturday:"Sat" };
  const startAbbr = abbr[shoppingDay] || "Wed";
  return buildWeekFromStartIndex(DAYS_ALL.indexOf(startAbbr));
}

// The real ordering source: a plan's weekStartDate already encodes its
// weekday, so order the 7 days starting there. weekStartDate is an ISO
// YYYY-MM-DD string; parsed with an explicit local-midnight time so the
// weekday isn't shifted by UTC parsing.
function getWeekFromDate(weekStartDate) {
  const startIdx = new Date(weekStartDate + "T00:00:00").getDay();
  return buildWeekFromStartIndex(startIdx);
}

// settings.shoppingDay's one remaining job (see SPEC-date-drives-ordering.md):
// seed a brand-new plan's default weekStartDate — the next upcoming date
// (today, if today already matches) that falls on that weekday.
function nextDateForShoppingDay(shoppingDay) {
  const abbr      = { Sunday:"Sun", Monday:"Mon", Tuesday:"Tue", Wednesday:"Wed", Thursday:"Thu", Friday:"Fri", Saturday:"Sat" };
  const targetIdx = DAYS_ALL.indexOf(abbr[shoppingDay] || "Wed");
  const today     = new Date().toISOString().split("T")[0];
  const todayIdx  = new Date(today + "T00:00:00").getDay();
  return addDaysISO(today, (targetIdx - todayIdx + 7) % 7);
}

// Add n days to an ISO YYYY-MM-DD date, returning ISO YYYY-MM-DD.
function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// "Week of Aug 12" — the plan-picker/toggle label derived from weekStartDate.
function weekLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return `Week of ${d.toLocaleDateString("en-US", { month:"short", day:"numeric" })}`;
}

// ── Seed data ──────────────────────────────────────────────────────────────────

const SEED_TS = "2020-01-01T00:00:00.000Z";

const SEED_INGREDIENTS = [
  { id:"i001", createdAt:SEED_TS, name:"Tuna (canned)", walmartName:"Chicken of the Sea Tuna", walmartVerified:true, storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"3 cans" },
  { id:"i003", createdAt:SEED_TS, name:"Egg noodles", walmartName:"No Yolks Egg Noodles", storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"1 bag" },
  { id:"i004", createdAt:SEED_TS, name:"Shredded cheddar", walmartName:"Kraft Shredded Cheddar", walmartVerified:true, storageLocation:"Fridge", tier:"staple", stapleType:"weekly", optional:false, defaultQuantity:"1 bag" },
  { id:"i005", createdAt:SEED_TS, name:"Chicken strips (Tyson)", walmartName:"Tyson Southern Style Chicken Breast Tenderloins, 25 oz (Frozen, Fully Cooked)", walmartVerified:true, storageLocation:"Freezer", tier:"always", optional:false, defaultQuantity:"2 bags" },
  { id:"i006", createdAt:SEED_TS, name:"Tortillas (lo carb)", walmartName:"Mission Carb Balance Flour Tortillas, Soft Taco Size, 8 Count", walmartVerified:true, storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"1 pack" },
  { id:"i007", createdAt:SEED_TS, name:"Enchilada sauce", walmartName:"Old El Paso Enchilada Sauce", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"2 cans" },
  { id:"i008", createdAt:SEED_TS, name:"Salsa", walmartName:"Tostitos Chunky Salsa", walmartVerified:true, storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"1 jar" },
  { id:"i009", createdAt:SEED_TS, name:"Sour cream", walmartName:"Daisy Sour Cream", walmartVerified:true, storageLocation:"Garage", tier:"staple", optional:false, defaultQuantity:"1 tub" },
  { id:"i010", createdAt:SEED_TS, name:"Rice", walmartName:"Carolina Jasmine Rice, Thai Fragrant Long Grain Rice, Gluten Free, 2 lb Bag", walmartVerified:true, storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"1 bag" },
  { id:"i011", createdAt:SEED_TS, name:"Pasta sauce (red)", walmartName:"RAGU Simply Traditional Pasta Sauce, 24 oz", walmartVerified:true, storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"2 jars" },
  { id:"i012", createdAt:SEED_TS, name:"Lasagna noodles", walmartName:"Barilla Lasagna Noodles", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1 box" },
  { id:"i013", createdAt:SEED_TS, name:"Ricotta cheese", walmartName:"Galbani Whole Milk Ricotta", walmartVerified:true, storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1 container" },
  { id:"i014", createdAt:SEED_TS, name:"Mozzarella shredded", walmartName:"Sargento Shredded Mozzarella", walmartVerified:true, storageLocation:"Garage", tier:"staple", optional:false, defaultQuantity:"1 bag" },
  { id:"i015", createdAt:SEED_TS, name:"Ground beef", walmartName:"Marketside Organic Grass-Fed Ground Beef, 85% Lean/15% Fat, 1 lb", walmartVerified:true, storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"2 lbs" },
  { id:"i016", createdAt:SEED_TS, name:"Tater tots", walmartName:"Ore-Ida Tater Tots", walmartVerified:true, storageLocation:"Freezer", tier:"staple", optional:false, defaultQuantity:"1 bag" },
  { id:"i017", createdAt:SEED_TS, name:"Kale, bagged", walmartName:"Fresh Green Kale, 16 oz", walmartVerified:true, storageLocation:"Garage", tier:"always", optional:false, defaultQuantity:"1 bunch" },
  { id:"i018", createdAt:SEED_TS, name:"Eggs", walmartName:"Marketside Organic Cage-Free Brown Large Eggs, 18 Count", walmartVerified:true, storageLocation:"Fridge", tier:"always", optional:false, defaultQuantity:"1 dozen" },
  { id:"i020", createdAt:SEED_TS, name:"Bread (647)", walmartName:"Schmidt Old Tyme 647 Low Calorie Keto Friendly Italian Bread 18 oz", walmartVerified:true, storageLocation:"Pantry", tier:"always", optional:false, defaultQuantity:"1 loaf" },
  { id:"i021", createdAt:SEED_TS, name:"Butter", walmartName:"Great Value Sweet Cream Salted Butter, 16 oz, 4 Sticks", walmartVerified:true, storageLocation:"Garage", tier:"staple", optional:false, defaultQuantity:"1 lb" },
  { id:"i022", createdAt:SEED_TS, name:"Crescent rolls", walmartName:"Pillsbury Crescent Rolls, Original Refrigerated Canned Pastry Dough, Value 2-Pack, 16 Rolls, 16 oz", walmartVerified:true, storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1 can" },
  { id:"i023", createdAt:SEED_TS, name:"Chicken breast (fresh)", walmartName:"Perdue, No Antibiotics Ever, Fresh Boneless Skinless Chicken Breast value pack, 2.5-4 lb. Tray", walmartVerified:true, storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"2 lbs" },
  { id:"i024", createdAt:SEED_TS, name:"Bacon", walmartName:"Oscar Mayer Bacon", walmartVerified:true, storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"1 pack" },
  { id:"i1781748937379", createdAt:SEED_TS, name:"Peas, frozen", storageLocation:"Freezer", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781750536287", createdAt:SEED_TS, name:"Potatoes", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"" },
  { id:"i1781781802965", createdAt:SEED_TS, name:"Cream of chicken soup", walmartName:"Cream of chicken soup", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781781814061", createdAt:SEED_TS, name:"Block cheddar", walmartName:"Block cheddar", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781781828141", createdAt:SEED_TS, name:"Bread crumbs", walmartName:"Bread crumbs", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"" },
  { id:"i17819586307302gn", createdAt:SEED_TS, name:"Extra virgin olive oil", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i178195863073072o", createdAt:SEED_TS, name:"Dishwasher pods", storageLocation:"Other", tier:"always", optional:false, defaultQuantity:"1" },
  { id:"i17819586307301i1", createdAt:SEED_TS, name:"Seasoned salt", storageLocation:"Cabinet", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730lbd", createdAt:SEED_TS, name:"Mixed salad greens", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730z93", createdAt:SEED_TS, name:"American cheese sliced", storageLocation:"Fridge", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i17819586307307vh", createdAt:SEED_TS, name:"Deli turkey breast", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730bmo", createdAt:SEED_TS, name:"Bananas", storageLocation:"Pantry", tier:"always", optional:false, defaultQuantity:"6" },
  { id:"i1781958630730zms", createdAt:SEED_TS, name:"Dish soap", storageLocation:"Other", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730rlq", createdAt:SEED_TS, name:"Bfree protein tortilla wraps", storageLocation:"Fridge", tier:"always", optional:false, defaultQuantity:"1" },
  { id:"i17819586307308jj", createdAt:SEED_TS, name:"Tuna (evoo)", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730me6", createdAt:SEED_TS, name:"Green pepper", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"3" },
  { id:"i1781958630730qfr", createdAt:SEED_TS, name:"Tortilla chips", storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730dzj", createdAt:SEED_TS, name:"Fettuccine ", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730jkl", createdAt:SEED_TS, name:"Alfredo ", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730t2h", createdAt:SEED_TS, name:"Riced cauliflower frozen", storageLocation:"Freezer", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730x8t", createdAt:SEED_TS, name:"Egglife egg white wrap, plain", storageLocation:"Fridge", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i17819586307303b0", createdAt:SEED_TS, name:"Frozen cheese pizza", storageLocation:"Freezer", tier:"staple", optional:false, defaultQuantity:"2" },
  { id:"i1781958630730phc", createdAt:SEED_TS, name:"Sliced bread, regular", storageLocation:"Pantry", tier:"always", optional:false, defaultQuantity:"2" },
  { id:"i1781958630730dxh", createdAt:SEED_TS, name:"Caesar salad kit", storageLocation:"Fridge", tier:"always", optional:false, defaultQuantity:"2" },
  { id:"i1781958630730tva", createdAt:SEED_TS, name:"Cottage cheese", storageLocation:"Fridge", tier:"always", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730qco", createdAt:SEED_TS, name:"Plain Greek yogurt", storageLocation:"Fridge", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i178195863073057h", createdAt:SEED_TS, name:"Fresh spinach", storageLocation:"Fridge", tier:"always", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730x1o", createdAt:SEED_TS, name:"Diet iced tea", storageLocation:"Garage", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730z49", createdAt:SEED_TS, name:"Ice cream, peanut butter cup", storageLocation:"Freezer", tier:"always", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730r4q", createdAt:SEED_TS, name:"Boneless chicken thighs", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730r1b", createdAt:SEED_TS, name:"Fresh avocados", storageLocation:"Other", tier:"always", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730nms", createdAt:SEED_TS, name:"Beef stew meat", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730zca", createdAt:SEED_TS, name:"Flat iron steak", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781958630730g1o", createdAt:SEED_TS, name:"Cherry tomatoes", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819598605325kj", createdAt:SEED_TS, name:"Tylenol (acetaminophen)", storageLocation:"Medicine Cabinet", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532unb", createdAt:SEED_TS, name:"Hot dogs", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532iwr", createdAt:SEED_TS, name:"Stevia", storageLocation:"Cabinet", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532x9z", createdAt:SEED_TS, name:"Power crunch, mint chocoloate protein  bars", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819598605324q3", createdAt:SEED_TS, name:"Peanut butter, jif", storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532uzu", createdAt:SEED_TS, name:"Toilet paper", storageLocation:"Other", tier:"always", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532vm6", createdAt:SEED_TS, name:"Goldfish", storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"2" },
  { id:"i1781959860532ws5", createdAt:SEED_TS, name:"Whipped cream ", storageLocation:"Garage", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532y9t", createdAt:SEED_TS, name:"Tortillas, regular", storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532skr", createdAt:SEED_TS, name:"647 hamburger rolls", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532y09", createdAt:SEED_TS, name:"Whole milk", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532qub", createdAt:SEED_TS, name:"Almond milk", storageLocation:"Garage", tier:"always", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532ica", createdAt:SEED_TS, name:"Garlic bread", storageLocation:"Freezer", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532ven", createdAt:SEED_TS, name:"Chex mix", storageLocation:"Pantry", tier:"always", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532hsz", createdAt:SEED_TS, name:"Gum", storageLocation:"Other", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532gt6", createdAt:SEED_TS, name:"Laundry detergent", storageLocation:"Other", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532ase", createdAt:SEED_TS, name:"Smarties", storageLocation:"Cabinet", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532j6m", createdAt:SEED_TS, name:"Rotini, plain", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532jk1", createdAt:SEED_TS, name:"Onion soup mix", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532rtb", createdAt:SEED_TS, name:"Chicken bouillon", storageLocation:"Cabinet", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i178195986053219m", createdAt:SEED_TS, name:"Hot dog buns", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819598605320w7", createdAt:SEED_TS, name:"Pesto", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i17819598605327es", createdAt:SEED_TS, name:"Strawberry jelly", storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532c4g", createdAt:SEED_TS, name:"Hummus", storageLocation:"Fridge", tier:"always", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532g0a", createdAt:SEED_TS, name:"Frozen meatballs", storageLocation:"Freezer", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532m96", createdAt:SEED_TS, name:"Baby carrots", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959860532n0i", createdAt:SEED_TS, name:"Tylenol sinus", storageLocation:"Medicine Cabinet", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i17819598605320ay", createdAt:SEED_TS, name:"Cetaphil bar soap", storageLocation:"Medicine Cabinet", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819599423992nq", createdAt:SEED_TS, name:"Tomato soup", storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"2" },
  { id:"i1781959942399e61", createdAt:SEED_TS, name:"Tortellini", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959942399ro1", createdAt:SEED_TS, name:"Grated parmesan", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781959942399mj0", createdAt:SEED_TS, name:"Angel hair pasta", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1781959942399xkt", createdAt:SEED_TS, name:"Onion powder", storageLocation:"Seasonings", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1781960097710pvh", createdAt:SEED_TS, name:"Frozen sliced strawberries", storageLocation:"Freezer", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819612095086b9", createdAt:SEED_TS, name:"Chili sauce", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961209508dyr", createdAt:SEED_TS, name:"Curry powder", storageLocation:"Seasonings", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1781961209508cra", createdAt:SEED_TS, name:"Rotel tomatoes", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961209508w15", createdAt:SEED_TS, name:"Garlic naan", storageLocation:"Freezer", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961209508ml9", createdAt:SEED_TS, name:"Elbow pasta", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819612095087l0", createdAt:SEED_TS, name:"Canned black beans", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819612095083sd", createdAt:SEED_TS, name:"Canned chili beans", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961209508d8i", createdAt:SEED_TS, name:"Chicken broth", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"2" },
  { id:"i1781961209508xs5", createdAt:SEED_TS, name:"Plain naan", storageLocation:"Freezer", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961209508xhr", createdAt:SEED_TS, name:"Pickles", storageLocation:"Fridge", tier:"staple", stapleType:"slow", optional:true, defaultQuantity:"1" },
  { id:"i1781961209508njt", createdAt:SEED_TS, name:"Ham steaks", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961209509ss8", createdAt:SEED_TS, name:"Dijon mustard", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961209509hy1", createdAt:SEED_TS, name:"Mushrooms", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961209509xys", createdAt:SEED_TS, name:"Yellow onions", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i17819613878722iz", createdAt:SEED_TS, name:"Deli sliced ham", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819613878724hb", createdAt:SEED_TS, name:"Vegetarian baked beans", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819613878726an", createdAt:SEED_TS, name:"Ketchup", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1781961387873xsp", createdAt:SEED_TS, name:"Barbecue sauce", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1781961387873bkt", createdAt:SEED_TS, name:"Mayonnaise", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i178196156080816o", createdAt:SEED_TS, name:"Taco seasoning mix", storageLocation:"Cabinet", tier:"specialty", optional:false, defaultQuantity:"2" },
  { id:"i1781961560808zai", createdAt:SEED_TS, name:"Diced chicken breast, frozen", storageLocation:"Freezer", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819615608086lr", createdAt:SEED_TS, name:"Frozen chopped spinach", storageLocation:"Freezer", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961560808fn6", createdAt:SEED_TS, name:"Soy sauce", storageLocation:"Cabinet", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1781961560808734", createdAt:SEED_TS, name:"Italian dressing mix", storageLocation:"Pantry", tier:"specialty", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1781961560808fw1", createdAt:SEED_TS, name:"Marinated artichoke hearts", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961560808mzm", createdAt:SEED_TS, name:"Provolone cheese", storageLocation:"Fridge", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781961560808yg7", createdAt:SEED_TS, name:"Fresh slicing tomatoes", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i17819616984862wb", createdAt:SEED_TS, name:"Sourdough bread sliced", storageLocation:"Pantry", tier:"specialty", optional:true, defaultQuantity:"1" },
  { id:"i17819616984860zu", createdAt:SEED_TS, name:"Coleslaw mix", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961698486eq2", createdAt:SEED_TS, name:"Frozen deep dish pie shells", storageLocation:"Freezer", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961698486fc4", createdAt:SEED_TS, name:"Buttermilk pancake waffle mix", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961815068mh3", createdAt:SEED_TS, name:"Orange juice", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961815068u7g", createdAt:SEED_TS, name:"Breakfast sausage links", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781961815068cbm", createdAt:SEED_TS, name:"Scrapple", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i178196192976850n", createdAt:SEED_TS, name:"Ice cream, double dunker", storageLocation:"Freezer", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781962070435hji", createdAt:SEED_TS, name:"Italian seasoning", storageLocation:"Seasonings", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1781962070435ei0", createdAt:SEED_TS, name:"Tri-color rotini pasta", storageLocation:"Pantry", tier:"staple", optional:false, defaultQuantity:"1" },
  { id:"i1781962070435vo0", createdAt:SEED_TS, name:"Vegetable oil", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1" },
  { id:"i1782060907056", createdAt:SEED_TS, name:"Italian bread", storageLocation:"Freezer", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1782060995346", createdAt:SEED_TS, name:"Italian sausage", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1782061148399", createdAt:SEED_TS, name:"Hamburger rolls, regular", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1782061680835", createdAt:SEED_TS, name:"Garlic powder", storageLocation:"Seasonings", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"" },
  { id:"i1782162217949", createdAt:SEED_TS, name:"Red pepper flakes", storageLocation:"Seasonings", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"" },
  { id:"i1782162229018", createdAt:SEED_TS, name:"Root beer", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1782164260781", createdAt:SEED_TS, name:"Flour", storageLocation:"Cabinet", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"" },
  { id:"i1782165334504", createdAt:SEED_TS, name:"Garlic cloves", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"" },
  { id:"i1782165394556", createdAt:SEED_TS, name:"Jalapenos", storageLocation:"Fridge", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"1 jar" },
  { id:"i1782166436549", createdAt:SEED_TS, name:"Burger patties", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"Packof 4" },
  { id:"i1782783951124", createdAt:SEED_TS, name:"Paprika", storageLocation:"Seasonings", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"" },
  { id:"i1782784082892", createdAt:SEED_TS, name:"Canned clams", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1782784666802", createdAt:SEED_TS, name:"Kaiser rolls", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783171604267", createdAt:SEED_TS, name:"Worcestershire", storageLocation:"Cabinet", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783171637797", createdAt:SEED_TS, name:"Corn starch", storageLocation:"Cabinet", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783172830425", createdAt:SEED_TS, name:"Arborio rice", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783173306833", createdAt:SEED_TS, name:"Leeks", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783173338967", createdAt:SEED_TS, name:"Thyme", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783173349016", createdAt:SEED_TS, name:"Raw cashews", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783173377588", createdAt:SEED_TS, name:"Olive oil, mild", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:true, defaultQuantity:"" },
  { id:"i1783173398508", createdAt:SEED_TS, name:"Vegetable broth", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783173614327", createdAt:SEED_TS, name:"Southwest seasoning, homemade", storageLocation:"Cabinet", tier:"specialty", optional:true, defaultQuantity:"" },
  { id:"i1783173854535", createdAt:SEED_TS, name:"Pork loin", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783173910229", createdAt:SEED_TS, name:"Penne", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783174079685", createdAt:SEED_TS, name:"Ravioli", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783182654608", createdAt:SEED_TS, name:"Feta cheese", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783183985376", createdAt:SEED_TS, name:"Beef broth", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783184043704", createdAt:SEED_TS, name:"Stewed tomatoes", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783190765964", createdAt:SEED_TS, name:"Tomato paste", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783190994435", createdAt:SEED_TS, name:"Chili powder", storageLocation:"Seasonings", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783191135052", createdAt:SEED_TS, name:"Pancake syrup", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783191142005", createdAt:SEED_TS, name:"Maple syrup", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783191153571", createdAt:SEED_TS, name:"Horseradish", storageLocation:"Fridge", tier:"specialty", optional:true, defaultQuantity:"" },
  { id:"i1783191183588", createdAt:SEED_TS, name:"Pancake mix", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783191284449", createdAt:SEED_TS, name:"Apple cider vinegar", storageLocation:"Pantry", tier:"staple", stapleType:"slow", optional:false, defaultQuantity:"" },
  { id:"i1783191311022", createdAt:SEED_TS, name:"Muenster cheese", storageLocation:"Fridge", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783259544927rbt", createdAt:SEED_TS, name:"Baked beans", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"1" },
  { id:"i1783508027957", createdAt:SEED_TS, name:"Claritin", storageLocation:"Medicine Cabinet", tier:"always", optional:false, defaultQuantity:"" },
  { id:"i1783940079640", createdAt:SEED_TS, name:"Stuffing mix", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" },
  { id:"i1783940138871", createdAt:SEED_TS, name:"Pork ribs", storageLocation:"Garage", tier:"specialty", optional:false, defaultQuantity:"" },
];

const SEED_MEALS = [
  { id:"m001", createdAt:SEED_TS, name:"Tuna casserole", effort:"easy", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"H","pref":"likes"},{"person":"N","pref":"likes"}], notes:"Made on shopping day", ingredients:["i001","i003","i022","i1781781802965","i1781781814061","i1781781828141"] },
  { id:"m002", createdAt:SEED_TS, name:"Pizza night", effort:"easy", type:"takeout", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"}], notes:"Takeout", ingredients:["i1782162217949","i1782162229018"] },
  { id:"m003", createdAt:SEED_TS, name:"Mexican nite", effort:"medium", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"N","pref":"likes"},{"person":"H","pref":"likes"}], notes:"", ingredients:["i006","i007","i008","i009","i010","i004","i1781958630730me6","i1781961209509xys","i1781958630730qfr","i1781959860532y9t","i1781958630730rlq","i015","i178196156080816o","i1782165334504","i1781961560808zai","i1782165394556","i1781959860532rtb"] },
  { id:"m004", createdAt:SEED_TS, name:"Lasagna", effort:"involved", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"H","pref":"likes"},{"person":"N","pref":"likes"},{"person":"C","pref":"likes"}], notes:"375° / Sauce, noodles, ricotta, meat", ingredients:["i012","i013","i014","i011","i015"] },
  { id:"m005", createdAt:SEED_TS, name:"Chicken tenders and tater tots", effort:"easy", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"none", preferences:[{"person":"N","pref":"likes"}], notes:"", ingredients:["i005","i016"] },
  { id:"m006", createdAt:SEED_TS, name:"Grilled burgers", effort:"medium", type:"dinner", weather:"grill", tempAffinity:"light", grillable:true, leftovers:"none", preferences:[{"person":"D","pref":"likes"}], notes:"", ingredients:["i1782166436549","i1781959860532skr","i1782061148399","i1781958630730z93","i1781961209508njt","i1781959860532unb","i178195986053219m","i1781961560808yg7","i1781961387873bkt","i17819613878726an","i016","i17819613878724hb"] },
  { id:"m007", createdAt:SEED_TS, name:"Chili", effort:"medium", type:"dinner", weather:"cold", tempAffinity:"comfort", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"H","pref":"likes"}], notes:"Cold days only", ingredients:["i015","i1781961209508cra","i17819612095083sd","i17819612095087l0","i1783190994435","i1781959860532jk1"] },
  { id:"m008", createdAt:SEED_TS, name:"Breakfast for dinner", effort:"involved", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"H","pref":"likes"},{"person":"N","pref":"likes"},{"person":"C","pref":"likes"},{"person":"D","pref":"likes"}], notes:"", ingredients:["i018","i024","i1781961815068mh3","i1781961815068cbm","i1781961815068u7g","i17819613878726an","i1783191135052","i1783191142005","i1783191153571","i1781961698486fc4","i1783191183588"] },
  { id:"m009", createdAt:SEED_TS, name:"Pasta salad", effort:"easy", type:"batch", weather:"hot", tempAffinity:"light", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"C","pref":"likes"}], notes:"Summer batch", ingredients:["i1781962070435ei0","i1781961560808734","i1781962070435vo0","i1783191284449","i1781958630730g1o","i1783191311022","i1781958630730r1b"] },
  { id:"m010", createdAt:SEED_TS, name:"Sloppy Joes", effort:"easy", type:"dinner", weather:"any", tempAffinity:"light", grillable:false, leftovers:"yes", preferences:[{"person":"H","pref":"likes"}], notes:"", ingredients:["i015","i1781959860532skr","i1782061148399","i1781958630730me6","i1781961209509hy1","i17819612095086b9","i021","i1781961209509xys","i1781958630730z93"] },
  { id:"m1782060781421", createdAt:SEED_TS, name:"Pasta", effort:"medium", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"N","pref":"dislikes"}], notes:"Tortellini optional", ingredients:["i1781959942399mj0","i1781958630730dzj","i011","i1781958630730jkl","i17819598605320w7","i1781959942399e61","i1782060907056","i1781959860532ica","i1781959942399ro1","i021","i1781959860532g0a","i1782060995346","i014","i1781958630730dxh"] },
  { id:"m1782061514605", createdAt:SEED_TS, name:"Grilled cheese", effort:"easy", type:"dinner", weather:"cold", tempAffinity:"neutral", grillable:false, leftovers:"none", preferences:[{"person":"N","pref":"likes"},{"person":"H","pref":"likes"},{"person":"D","pref":"likes"}], notes:"Sometimes need fancier ingredients especially if panini style ", ingredients:["i020","i1781958630730phc","i17819616984862wb","i1781961560808mzm","i1781958630730z93","i1781959860532vm6","i021","i17819613878722iz","i1781961560808yg7","i1781961387873bkt","i1781961209509ss8","i1782061680835","i17819599423992nq","i1781959860532y09"] },
  { id:"m17821640325107i2", createdAt:SEED_TS, name:"Mac and cheese", effort:"medium", type:"side", weather:"any", tempAffinity:"comfort", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"H","pref":"likes"}], notes:"", ingredients:["i1781961209508ml9","i004","i1781959860532y09","i021","i1782164260781"] },
  { id:"m1782166086124", createdAt:SEED_TS, name:"Salsa chicken", effort:"medium", type:"batch", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"J","pref":"likes"}], notes:"Used for Mexican nite and lunches ", ingredients:["i023","i008"] },
  { id:"m17827675827371hn", createdAt:SEED_TS, name:"Clam sauce", effort:"medium", type:"side", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"none", preferences:[], notes:"Grandpa's favorite", ingredients:["i1782784082892","i1782165334504","i021","i17819586307302gn","i1781961209509xys"] },
  { id:"m1782767830082rim", createdAt:SEED_TS, name:"Takeout", effort:"easy", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[], notes:"", ingredients:[] },
  { id:"m1782767886262ohe", createdAt:SEED_TS, name:"Leftovers", effort:"easy", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[], notes:"", ingredients:[] },
  { id:"m1782768093424gry", createdAt:SEED_TS, name:"Egg salad sandwiches", effort:"medium", type:"dinner", weather:"any", tempAffinity:"light", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"}], notes:"", ingredients:["i1781959860532skr","i1782061148399","i018","i1781961387873bkt","i1781961209509ss8","i1781958630730rlq","i006"] },
  { id:"m1782784615682zw7", createdAt:SEED_TS, name:"Pulled pork, amish", effort:"easy", type:"dinner", weather:"any", tempAffinity:"light", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"H","pref":"likes"},{"person":"J","pref":"likes"}], notes:"", ingredients:["i1782784666802","i1781959860532skr","i1782061148399","i17819616984860zu","i1781961387873xsp","i016"] },
  { id:"m1783171508765", createdAt:SEED_TS, name:"Homemade hamburger helper", effort:"medium", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"H","pref":"likes"},{"person":"N","pref":"likes"}], notes:"", ingredients:["i1781959860532j6m","i015","i178196156080816o","i1781959860532jk1","i17819586307301i1","i1783171604267","i1781961560808fn6","i1781959860532y09","i1783171637797"] },
  { id:"m1783172587000", createdAt:SEED_TS, name:"Meatloaf", effort:"medium", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"H","pref":"likes"},{"person":"D","pref":"dislikes"},{"person":"N","pref":"dislikes"}], notes:"", ingredients:["i015","i1781781828141","i17819613878726an","i1783171604267","i018","i1781961209509xys"] },
  { id:"m1783172726173", createdAt:SEED_TS, name:"Oven chicken risotto", effort:"involved", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[], notes:"", ingredients:["i023","i1781961209509xys","i021","i1781961209508d8i","i1783172830425"] },
  { id:"m1783173277303", createdAt:SEED_TS, name:"Potato leek soup", effort:"involved", type:"dinner", weather:"cold", tempAffinity:"comfort", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"H","pref":"likes"}], notes:"", ingredients:["i1783173306833","i1781961209509xys","i1781750536287","i1783173338967","i1783173349016","i1783173377588","i1783173398508"] },
  { id:"m1783173486136", createdAt:SEED_TS, name:"Southwest chicken and rice casserole", effort:"involved", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"H","pref":"likes"}], notes:"", ingredients:["i1781750536287","i021","i1781961387873bkt","i023","i010","i1783173614327"] },
  { id:"m1783173815992", createdAt:SEED_TS, name:"Pork loin", effort:"medium", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:true, leftovers:"yes", preferences:[{"person":"H","pref":"likes"},{"person":"N","pref":"likes"}], notes:"Leftovers can be used in fried rice", ingredients:["i1783173854535"] },
  { id:"m1783173876441", createdAt:SEED_TS, name:"Ziti casserole", effort:"easy", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"N","pref":"likes"}], notes:"", ingredients:["i1783173910229","i011","i013","i1782061680835","i1781962070435hji","i014"] },
  { id:"m1783174023437", createdAt:SEED_TS, name:"Spinach artichoke casserole", effort:"involved", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"C","pref":"likes"},{"person":"D","pref":"likes"}], notes:"Can vary the pasta and/or omit the artichokes ", ingredients:["i1783174079685","i1781959942399e61","i17819615608086lr","i1781961560808fw1","i17819598605320w7","i1781958630730jkl","i014"] },
  { id:"m1783182426614", createdAt:SEED_TS, name:"Pulled pork hotpockets / triangles", effort:"easy", type:"dinner", weather:"any", tempAffinity:"light", grillable:false, leftovers:"yes", preferences:[], notes:"Prereq: pulled pork ", ingredients:["i004","i022","i1782061680835","i1781961387873xsp","i021"] },
  { id:"m1783182562557", createdAt:SEED_TS, name:"Quiche", effort:"medium", type:"dinner", weather:"any", tempAffinity:"light", grillable:false, leftovers:"yes", preferences:[{"person":"H","pref":"likes"}], notes:"Can vary ingredients ", ingredients:["i018","i1781961698486eq2","i1781959860532y09","i004","i1783182654608","i178195863073057h","i1781961209509xys"] },
  { id:"m1783183935796", createdAt:SEED_TS, name:"Beef stew", effort:"involved", type:"dinner", weather:"hot", tempAffinity:"comfort", grillable:false, leftovers:"yes", preferences:[{"person":"H","pref":"likes"},{"person":"N","pref":"likes"}], notes:"", ingredients:["i1781958630730nms","i1782164260781","i17819586307301i1","i1783183985376","i1781750536287","i1781961209509xys","i1781959860532m96","i1783184043704"] },
  { id:"m1783184065720", createdAt:SEED_TS, name:"French onion soup", effort:"involved", type:"dinner", weather:"cold", tempAffinity:"comfort", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"H","pref":"likes"}], notes:"", ingredients:["i1781961209509xys","i1783183985376","i1783173338967","i014","i1782060907056"] },
  { id:"m1783190601467", createdAt:SEED_TS, name:"Chicken curry", effort:"medium", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"yes", preferences:[{"person":"H","pref":"likes"},{"person":"N","pref":"likes"},{"person":"C","pref":"likes"}], notes:"", ingredients:["i023","i010","i1781961209508dyr","i1781959860532rtb","i1781961209508d8i","i1781961209509xys","i1781750536287","i021","i1781961209508w15","i1781961209508xs5","i1781748937379","i1783190765964"] },
  { id:"m1783256404221", createdAt:SEED_TS, name:"Breakfast meats", effort:"medium", type:"side", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"none", preferences:[{"person":"H","pref":"likes"}], notes:"Good with other meals like quiche", ingredients:["i1781961815068cbm","i1781961815068u7g","i1781961209508njt"] },
  { id:"m17839066302436gz", createdAt:SEED_TS, name:"Pork ribs", effort:"medium", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:true, leftovers:"yes", preferences:[{"person":"H","pref":"likes"},{"person":"N","pref":"likes"},{"person":"J","pref":"likes"}], notes:"", ingredients:["i1781961387873xsp","i1783940138871","i1783259544927rbt"] },
  { id:"m1783937479786u25", createdAt:SEED_TS, name:"Stuffing", effort:"easy", type:"side", weather:"any", tempAffinity:"comfort", grillable:false, leftovers:"yes", preferences:[{"person":"D","pref":"likes"},{"person":"H","pref":"likes"},{"person":"N","pref":"likes"}], notes:"", ingredients:["i1783940079640","i021"] },
];

const DEFAULT_SETTINGS = {
  shoppingDay:"Wednesday", pickupTime:"5:00-6:00pm", budgetLimit:250, awayMemberHome:true,
  familyContacts: FAMILY.map(f => ({...f, phone:""})),
};

const DEFAULT_DB = { settings:DEFAULT_SETTINGS, meals:SEED_MEALS, ingredients:SEED_INGREDIENTS, plans:{ current:null, next:null }, activePlan:"current", _planModelVer:1, outbox:null, published:null, mealHistory:[], _isSeed:true, dataChangedAt:null, lastExportedAt:null };

// outbox shape (legacy single-slot, still used by in-app TonightTab queue):
// { message, recipients:[phone...], mode:"group"|"individual", label, queuedAt, sent:false }
//
// published shape (v2) — generic menu the mid-week Shortcut reads. Flat list of
// label+body items; the Shortcut picks recipient(s) and item(s) and sends the
// joined bodies. See buildPublished above for details.
// { v:2, publishedAt, items:[ { key, label, body }, ... ] }

// plan shape (db.plans.current / db.plans.next — see SPEC-two-plan-model.md):
// { step, maxStep, awayHome, mealPlan, checkedIds, dayNotes, dayPills,
//   notesTouched, stapleFlags, quantities, weather, startedAt, _stepsVer,
//   meals, items, cartItems, cartIngredientIds, dismissedShared, notes,
//   weekOf, weekStartDate }
// mealPlan is the live-editing meal grid (day abbr -> meal NAMES); meals is the
// last-committed snapshot of the same shape, written by savePlan. weekStartDate
// (ISO YYYY-MM-DD) drives auto-retire and is distinct from weekOf (legacy,
// "date this plan record was last touched").

// ── Active-plan accessors ────────────────────────────────────────────────────
// db.plans is a two-slot object: { current, next }. db.activePlan ("current" |
// "next") remembers which plan the owner was last EDITING in the Plan tab —
// getActivePlan follows that toggle and is what the Plan-tab flow (Meals,
// Inventory, Confirm, Sparky) reads and writes.
//
// Prep ("mark what's already bought") and Tonight, plus the family Shortcut
// export (buildPublished), are about the week actually being SHOPPED AND LIVED
// — not whichever plan the owner happens to be drafting — so they always read
// getCurrentPlan regardless of db.activePlan. Never route those through
// getActivePlan; they must stay pinned to "current" even mid-edit on "next".
const getActivePlan = db => {
  const key = db.activePlan || "current";
  return db.plans?.[key] || null;
};
const getCurrentPlan = db => db.plans?.current || null;

// Overwrite the plan at the active slot. Plan-tab flow only — Prep/Tonight/the
// family export never write plans.
const writeActivePlan = (db, plan) => {
  const key = db.activePlan || "current";
  return { ...db, plans: { ...(db.plans || { current:null, next:null }), [key]: plan } };
};

// Overwrite plans.current directly, independent of db.activePlan. Prep is the
// one place besides the migration/lifecycle code that writes a plan, and it
// always means "the plan being shopped," not whichever plan is being drafted.
const writeCurrentPlan = (db, plan) => ({ ...db, plans: { ...(db.plans || { current:null, next:null }), current: plan } });

// Plan count that tolerates both the legacy array shape (pre-migration db, e.g.
// an old recovery snapshot or pasted import awaiting confirmation) and the
// current { current, next } object shape.
const planCount = plans => Array.isArray(plans) ? plans.length : Object.values(plans || {}).filter(Boolean).length;

// Apply fn to whichever of current/next are non-null (e.g. scrubbing a deleted
// ingredient's id out of every silo's cart/items, since both must stay clean).
const mapBothPlans = (db, fn) => ({
  ...db,
  plans: {
    current: db.plans?.current ? fn(db.plans.current) : db.plans?.current ?? null,
    next: db.plans?.next ? fn(db.plans.next) : db.plans?.next ?? null,
  },
});

// ── Plan-model migration (legacy single-slot → two-slot current/next) ──────────
// Pre-migration dbs carry TWO single-slot concepts: db.planDraft (live-editing
// state) and db.plans (array, .slice(-1)[0] = the one committed record). This
// merges them into db.plans = { current, next }, with the single existing plan
// becoming "current" (the owner's explicit choice). Idempotent — a db already
// at _planModelVer >= 1 is returned unchanged. mealHistory is untouched.
const PLAN_MODEL_VER = 1;
const migrateDB = db => {
  if (!db) return db;
  let out = db;

  if (out._planModelVer < PLAN_MODEL_VER) {
    const draft     = out.planDraft || null;
    const legacy    = Array.isArray(out.plans) ? out.plans : [];
    const committed = legacy.slice(-1)[0] || null;

    let current = null;
    if (draft || committed) {
      current = {
        step: draft?.step ?? 0,
        maxStep: draft?.maxStep ?? draft?.step ?? 0,
        awayHome: draft?.awayHome || {},
        mealPlan: draft?.mealPlan || committed?.meals || {},
        checkedIds: draft?.checkedIds || [],
        dayNotes: draft?.dayNotes || {},
        dayPills: draft?.dayPills || {},
        notesTouched: draft?.notesTouched || false,
        stapleFlags: draft?.stapleFlags || {},
        quantities: draft?.quantities || {},
        weather: draft?.weather || "hot",
        startedAt: draft?.startedAt || committed?.weekOf || new Date().toISOString(),
        _stepsVer: draft?._stepsVer ?? 4,
        meals: committed?.meals || draft?.mealPlan || {},
        items: committed?.items || [],
        cartItems: committed?.cartItems || [],
        cartIngredientIds: committed?.cartIngredientIds || [],
        dismissedShared: committed?.dismissedShared || [],
        notes: committed?.notes || "",
        weekOf: committed?.weekOf || new Date().toISOString().split("T")[0],
        // Infer from the existing shopping-day anchor: the committed record's
        // weekOf if present, else the draft's start date, else today.
        weekStartDate: committed?.weekOf || (draft?.startedAt ? draft.startedAt.split("T")[0] : new Date().toISOString().split("T")[0]),
      };
    }

    out = {
      ...out,
      plans: { current, next: null },
      activePlan: "current",
      planDraft: undefined,
      _planModelVer: PLAN_MODEL_VER,
    };
  }

  // Data-provenance fields (added later than the rest of the schema): backfill
  // for any db that predates them, so pre-existing REAL data isn't mistaken
  // for seed data and gets a sane freshness baseline instead of "unknown".
  // DEFAULT_DB already sets all three explicitly, so this is a no-op for it.
  if (out._isSeed === undefined)       out = { ...out, _isSeed: false };
  if (out.dataChangedAt === undefined) out = { ...out, dataChangedAt: out.savedAt || null };
  if (out.lastExportedAt === undefined) out = { ...out, lastExportedAt: null };

  return out;
};

// ── Auto-retire (two-plan-model lifecycle) ──────────────────────────────────────
// Runs once per app load, never mid-session. If plans.next exists and its
// weekStartDate has arrived, the outgoing current week is archived to
// mealHistory (same format startFresh has always used — archivedAt + unique
// meal names, filtering placeholders, keeping the last 6 weeks) and next is
// promoted to current. This is the ONLY destructive operation in the two-plan
// model; editing current, editing next, and switching between them never lose
// data. Silent and automatic — no prompt, no confirmation. Returns the SAME db
// reference when nothing retires, so callers can tell "no-op" from "changed"
// without a deep-equal check.
const autoRetirePlans = db => {
  const next = db.plans?.next;
  if (!next || !next.weekStartDate) return db;
  const today = new Date().toISOString().split("T")[0];
  if (next.weekStartDate > today) return db;

  const outgoing = db.plans?.current;
  const outgoingMeals = Object.values(outgoing?.mealPlan || outgoing?.meals || {}).flat()
    .filter(n => n && n !== "Choose your own night" && n !== "Choose your own");
  const prevHistory = db.mealHistory || [];
  const mealHistory = outgoingMeals.length
    ? [...prevHistory, { archivedAt:new Date().toISOString(), meals:[...new Set(outgoingMeals)] }].slice(-6)
    : prevHistory;

  return {
    ...db,
    mealHistory,
    plans: { current: next, next: null },
    activePlan: db.activePlan === "next" ? "current" : (db.activePlan || "current"),
  };
};

// ── Storage ────────────────────────────────────────────────────────────────────
//
// Local persistence is ATTEMPTED on every platform (including mobile), but never
// trusted blindly. Each save does a write-then-read-back verify; if storage is
// unavailable or silently drops the write, we fall back to the session
// export/import flow. storageHealth records the last known result so the UI can
// tell the user honestly whether same-device reopen will work.

let storageHealth = "unknown"; // "ok" | "unavailable" | "unknown"
const getStorageHealth = () => storageHealth;

async function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      storageHealth = "ok";
      console.log("[DB] Loaded:", parsed.meals?.length, "meals,", parsed.ingredients?.length, "items");
      return migrateDB(parsed);
    }
    // Storage reachable but empty (first run, or never saved) — not a failure.
    storageHealth = "ok";
  } catch(e) {
    storageHealth = "unavailable";
    console.log("[DB] Load failed:", e.message);
  }
  return DEFAULT_DB;
}

async function saveDB(db) {
  try {
    const payload = JSON.stringify(db);
    localStorage.setItem(DB_KEY, payload);
    // Verify the write actually stuck — this is what catches silent mobile drops.
    if (localStorage.getItem(DB_KEY) === payload) {
      storageHealth = "ok";
      console.log("[DB] Saved + verified");
      return true;
    }
    storageHealth = "unavailable";
    console.warn("[DB] Save did not verify — relying on session export");
    return false;
  } catch(e) {
    storageHealth = "unavailable";
    console.error("[DB] Save error:", e.message);
    return false;
  }
}

// Recovery snapshot: written on blur/background so a forgotten export becomes a
// one-tap restore on reopen rather than data loss. Kept fire-and-forget and as
// synchronous as the storage API allows, since it runs while the app is closing.
function saveRecovery(db) {
  try {
    const snap = { savedAt:new Date().toISOString(), db };
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(snap));
    console.log("[DB] Recovery snapshot written");
  } catch(e) { console.log("[DB] Recovery write skipped:", e.message); }
}

async function loadRecovery() {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (raw) {
      const snap = JSON.parse(raw);
      if (snap && snap.db && snap.db.meals && snap.db.ingredients) return snap;
    }
  } catch(e) { console.log("[DB] Recovery load skipped:", e.message); }
  return null;
}

async function clearRecovery() {
  try {
    localStorage.removeItem(RECOVERY_KEY);
  } catch(e) { /* non-fatal */ }
}

// ── Meal suggestions ───────────────────────────────────────────────────────────


// ── Weekly baked-in data (Level-1 manual refresh) ───────────────────────────────// These three are updated together each week by asking Claude to refresh the
// calendar + weather. BAKED_WEEK is the Monday the current data covers; the
// in-app reminder self-dates off it and emphasizes when today is past the week.
const BAKED_WEEK = "2026-08-04";   // Shopping day (Tue) of the week the baked-in data covers

// Budget trimming: receipt lines above this price whose matched ingredient is
// flagged OPTIONAL get surfaced in Reconcile as drop candidates. Config knob.
const HIGH_PRICE = 5;

// Output token budget for receipt extraction and matching. Compact pipe-delimited
// formats keep replies small (~20 tokens/item extract, ~5/item match), but a full
// 65+ item order still needs headroom. 1500 truncated a 65-item order; 2500 gives
// margin. If a reply ever shows non-JSON/empty at this value, the SANDBOX rejected
// it — lower it and chunk instead of raising further.
const EXTRACT_TOKENS = 2500;

// Is the baked-in weekly data stale? (today is past the Sunday of BAKED_WEEK)
const isBakedDataStale = () => {
  const start = new Date(BAKED_WEEK + "T00:00:00");
  const end   = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999);
  return new Date() > end;
};
// "7/6" style label for display.
const bakedWeekLabel = () => {
  const d = new Date(BAKED_WEEK + "T00:00:00");
  return `${d.getMonth()+1}/${d.getDate()}`;
};
// ── Live weather ────────────────────────────────────────────────────────────────
// Replaces the old hand-baked WEEK_FORECAST with a live fetch from Open-Meteo
// (free, no API key, CORS-enabled — works from a plain browser fetch when the app
// is hosted on a normal origin). Coordinates are a config value; set them to the
// planning household's location. Inside a restricted sandbox the fetch may be
// blocked and resolve to {} — every consumer treats a missing day as neutral, so
// nothing breaks; it simply shows no live data until hosted.
const FORECAST_LAT = 39.44843;            // configure for your location (default: generic US point)
const FORECAST_LON = -75.71768;
const FORECAST_CACHE_KEY = "grocery_forecast_cache";
const FORECAST_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// The shopping week runs Tue → Mon. Given "today", find this cycle's Tuesday and
// return the 7 dates keyed by day abbr, plus ISO bounds for the API date range.
function getShoppingWeekDates(today = new Date()) {
  const d = new Date(today); d.setHours(0, 0, 0, 0);
  const daysSinceTue = (d.getDay() - 2 + 7) % 7;
  const tue = new Date(d); tue.setDate(d.getDate() - daysSinceTue);
  const abbrs = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];
  const iso = x => x.toISOString().slice(0, 10);
  const dates = {};
  abbrs.forEach((abbr, i) => { const dt = new Date(tue); dt.setDate(tue.getDate() + i); dates[abbr] = iso(dt); });
  return { start: dates.Tue, end: dates.Mon, dates };
}

const iconForPop = pop => pop >= 50 ? "⛈️" : pop >= 20 ? "🌤️" : "☀️";

function readForecastCache(weekStart) {
  try {
    const raw = localStorage.getItem(FORECAST_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached.weekStart !== weekStart) return null;
    if (Date.now() - cached.fetchedAt > FORECAST_CACHE_TTL_MS) return null;
    return cached.forecast;
  } catch { return null; }
}
function writeForecastCache(weekStart, forecast) {
  try { localStorage.setItem(FORECAST_CACHE_KEY, JSON.stringify({ weekStart, fetchedAt: Date.now(), forecast })); } catch {}
}

// Fetches the live 7-day forecast for the current shopping week. Returns an object
// keyed by day abbr ({ hi, pop, icon }), or {} on any failure (offline, blocked,
// API hiccup) — callers treat missing days as neutral, so {} is safe, not an error.
async function fetchLiveForecast() {
  const { start, end, dates } = getShoppingWeekDates();
  const cached = readForecastCache(start);
  if (cached) return cached;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${FORECAST_LAT}&longitude=${FORECAST_LON}&daily=temperature_2m_max,precipitation_probability_max&temperature_unit=fahrenheit&timezone=America%2FNew_York&start_date=${start}&end_date=${end}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return {};
    const data = await res.json();
    const days = data?.daily?.time || [];
    const highs = data?.daily?.temperature_2m_max || [];
    const pops  = data?.daily?.precipitation_probability_max || [];
    const byDate = {};
    days.forEach((iso, i) => { byDate[iso] = { hi: Math.round(highs[i]), pop: Math.round(pops[i] ?? 0) }; });
    const forecast = {};
    Object.entries(dates).forEach(([abbr, iso]) => {
      const d = byDate[iso];
      if (d) forecast[abbr] = { ...d, icon: iconForPop(d.pop) };
    });
    writeForecastCache(start, forecast);
    return forecast;
  } catch { return {}; }
}

// Per-day calendar notes for the planning week. Placeholder content — replace with
// your own, or wire up to a calendar source. Module-level so the planner and
// new-week setup can read it.
const defaultNotes = { Tue:"Grocery pickup", Wed:"", Thu:"", Fri:"", Sat:"", Sun:"", Mon:"" };

// Self-dating reminder that the calendar/weather are baked in for a specific
// week. Quiet (muted) while current; emphasized (warning) once past the week,
// nudging a "ask Claude to refresh" edit. Text-only, no mechanism.
function RefreshReminder({ compact }) {
  const stale = isBakedDataStale();
  return (
    <div style={{
      fontSize:12, lineHeight:1.4, borderRadius:8, padding:compact?"7px 10px":"9px 12px",
      marginBottom:10,
      background: stale ? C.warningLight : "#F3F4F6",
      color:      stale ? C.warning : C.faint,
      border:     stale ? `1px solid ${C.warning}` : `1px solid ${C.border}`,
      fontWeight: stale ? 600 : 400,
    }}>
      {stale
        ? `⚠️ Calendar & weather are baked in for week of ${bakedWeekLabel()} — looks like a newer week. Ask Claude to refresh the app.`
        : `Calendar & weather baked in for week of ${bakedWeekLabel()}. Ask Claude to refresh if it's a new week.`}
    </div>
  );
}

// ── Day pills ─────────────────────────────────────────────────────────────────
// A pill is an attribute on a day: { label, source: "auto"|"manual" }.
// Only BUILT-IN labels carry generation effects; custom labels are visual only.
//   easy    → exclude "involved" meals (long-standing behavior, via effortMap)
//   grill   → allow + boost grillable meals (otherwise they're gated out)
//   special → prefer higher-effort / favorite meals
// Auto-derivation runs ONCE at plan start; after that a day's `touched` flag
// means the user's edits always win and regeneration never clobbers them.
const BUILTIN_PILLS = ["easy","grill","special"];
const PILL_STYLE = {
  easy:    { c:"#2F6B4F",      bg:"#EAF3EC" },
  grill:   { c:"#9A3412",      bg:"#FFEDD5" },
  special: { c:"#7C3AED",      bg:"#EDE9FE" },
};

// Is a day grill-suitable? Warm enough and dry enough, from the baked forecast.
const isGrillWeather = fc => !!fc && fc.hi >= 70 && fc.pop <= 35;

// Propose pills for each day from what the app already knows: the effort map
// (shopping day + Mon/Tue are "easy") and this week's baked forecast.
function derivePills(days, effortMap, forecast) {
  const out = {};
  days.forEach(d => {
    const pills = [];
    if ((effortMap || {})[d] === "easy") pills.push({ label:"easy", source:"auto" });
    if (isGrillWeather((forecast || {})[d]))  pills.push({ label:"grill", source:"auto" });
    out[d] = pills;
  });
  return out;
}

const hasPill = (dayPills, day, label) => (dayPills?.[day] || []).some(p => p.label === label);

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

function getMealSuggestions(awayHome, meals, days, effortMap, alreadyPlanned = [], recentMeals = [], seenThisSession = [], dayPills = {}, forecast = {}) {
  const pool = meals.map(m => ({
    ...m,
    memberOk: !(m.preferences||[]).some(p => p.person === "D" && p.pref === "dislikes"),
  }));
  const recent = new Set(recentMeals);   // archived recent weeks → soft weight
  const seen   = new Set(seenThisSession); // this session's rerolls → skip if possible
  const plan = {};
  const used = new Set(alreadyPlanned);

  // Favorite weight from existing preferences: likes minus dislikes across the
  // family (household consensus). the user's own like adds a small extra tiebreaker,
  // since his preference is the deliberate thumb on the scale.
  const favScore = m => {
    const prefs = m.preferences || [];
    const likes    = prefs.filter(p => p.pref === "likes").length;
    const dislikes = prefs.filter(p => p.pref === "dislikes").length;
    const jamesLike = prefs.some(p => p.person === "J" && p.pref === "likes") ? 0.5 : 0;
    return (likes - dislikes) + jamesLike;
  };

  for (const day of days.filter(d => !plan[d])) {
    const effort        = (effortMap && effortMap[day]) || "medium";
    const memberPresent = awayHome[day] !== false;
    // Per-day conditions (replaces the old week-level weather value): each day's
    // own forecast drives the temperature nudge, and its own grill pill decides
    // whether grillable meals are allowed.
    const fc        = forecast[day];
    const dayIsHot  = !!fc && fc.hi >= 82;
    const dayIsCold = !!fc && fc.hi <= 55;
    const grillOk   = hasPill(dayPills, day, "grill");
    const isSpecial = hasPill(dayPills, day, "special");
    const easyPill  = hasPill(dayPills, day, "easy") || effort === "easy";
    const candidates    = pool.filter(m => {
      if (used.has(m.name)) return false;
      // Only main dinners are auto-suggested. Sides, batch, and takeout are
      // excluded — they're chosen manually, not proposed as a night's meal.
      if ((m.type || "dinner") !== "dinner") return false;
      if (memberPresent && !m.memberOk) return false;
      if (easyPill && m.effort === "involved") return false;
      // GRILLABLE = conditional HARD gate, now PER DAY: grillable meals only
      // appear on days flagged as grill days (warm + dry, auto-derived from the
      // forecast, or set manually).
      if (m.grillable && !grillOk) return false;
      return true;
    });
    if (candidates.length > 0) {
      // Reroll freshness: if we have options not yet surfaced this session, use
      // only those (so consecutive rerolls show new meals). Fall back to all
      // candidates once the pool is exhausted, so nothing hard-bans.
      const unseen = candidates.filter(m => !seen.has(m.name));
      const tier   = unseen.length > 0 ? unseen : candidates;

      // WEIGHTED pick (not flat random). Each meal gets a weight from soft nudges;
      // nothing is excluded here — weights only change how likely a meal is.
      //  • recency: meals served in recent archived weeks are down-weighted (soft,
      //    so they still can appear, but much less often — this replaces the old
      //    hard "fresh tier" that collapsed and let recent meals back in at full
      //    weight once history grew large)
      //  • temperature: comfort floats up on cold days, sinks on hot; light the reverse
      //  • grill day: grillable meals get a boost
      //  • favorite: household likes-minus-dislikes (+ user's tiebreaker)
      const weightFor = m => {
        let w = 1;
        if (recent.has(m.name)) w *= 0.15;   // strong soft penalty for recent meals
        const aff = m.tempAffinity || "neutral";
        if (dayIsCold) { if (aff === "comfort") w *= 2.2; if (aff === "light") w *= 0.4; }
        if (dayIsHot)  { if (aff === "light")   w *= 2.2; if (aff === "comfort") w *= 0.4; }
        if (grillOk && m.grillable) w *= 1.8;
        // "special" nudges toward higher-effort and well-liked meals.
        if (isSpecial) { if (m.effort === "involved") w *= 1.8; w *= 1 + Math.max(0, favScore(m)) * 0.2; }
        w *= 1 + Math.max(0, favScore(m)) * 0.25;   // favorites lean up, never below base
        return w;
      };
      const weights = tier.map(weightFor);
      const total   = weights.reduce((s, x) => s + x, 0);
      let r = Math.random() * total;
      let pick = tier[0];
      for (let i = 0; i < tier.length; i++) { r -= weights[i]; if (r <= 0) { pick = tier[i]; break; } }
      plan[day] = pick.name;
      used.add(pick.name);
    } else {
      plan[day] = "Choose your own night";
    }
  }
  return plan;
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const C = {
  bg:"#F7F6F3", surface:"#FFFFFF", primary:"#1A3A2A", primaryLight:"#E8F5EE",
  accent:"#5AC987", accentMuted:"#7EC8A0", text:"#1A1A1A", muted:"#666",
  faint:"#999", border:"#E8E8E8", danger:"#B33333", dangerLight:"#FEE9E9",
  warning:"#B35F00", warningLight:"#FFF3E0", verified:"#1A7A3A",
};

const TIER_COLORS = {
  always:    { bg:"#E8F5EE", color:"#1A5C30" },
  staple:    { bg:"#EEF2FF", color:"#3730A3" },
  specialty: { bg:"#F3F4F6", color:"#374151" },
};

const EFFORT_COLORS = {
  easy:     { bg:"#E8F5EE",      color:"#1A5C30"  },
  medium:   { bg:C.warningLight, color:C.warning  },
  involved: { bg:C.dangerLight,  color:C.danger   },
};

const S = {
  app:         { fontFamily:"'Inter',system-ui,sans-serif", background:C.bg, minHeight:"100vh", maxWidth:"100%", margin:"0 auto", color:C.text, paddingBottom:80 },
  header:      { background:C.primary, color:"#E8F5EE", padding:"12px 16px 0", position:"sticky", top:0, zIndex:10 },
  headerTop:   { display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 },
  headerTitle: { fontSize:16, fontWeight:700 },
  statusAction: { background:"rgba(255,255,255,0.92)", border:"none", color:C.primary, fontSize:11, fontWeight:700, padding:"5px 10px", borderRadius:8, cursor:"pointer", whiteSpace:"nowrap" },
  statusActionSubtle: { background:"transparent", border:"1px solid rgba(232,245,238,0.3)", color:C.accentMuted, fontSize:11, fontWeight:600, padding:"3px 9px", borderRadius:7, cursor:"pointer", whiteSpace:"nowrap" },
  tabs:        { display:"flex" },
  tab: a => ({ flex:1, padding:"9px 2px", textAlign:"center", fontSize:11, fontWeight:700, color:a?"#fff":C.accentMuted, borderBottom:a?"2px solid #fff":"2px solid transparent", cursor:"pointer", background:"none", border:"none" }),
  body:        { padding:"16px 16px 20px" },
  card:        { background:C.surface, borderRadius:14, padding:"14px 16px", marginBottom:10, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" },
  cardFlat:    { background:C.surface, borderRadius:14, marginBottom:10, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" },
  sectionLabel:{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:C.accentMuted, marginBottom:6 },
  h2:          { fontSize:20, fontWeight:700, marginBottom:4 },
  sub:         { fontSize:14, color:C.muted, lineHeight:1.5, marginBottom:12 },
  row:         { display:"flex", alignItems:"center", padding:"11px 16px", borderBottom:`1px solid ${C.border}`, gap:10 },
  rowLast:     { borderBottom:"none" },
  label:       { fontSize:13, fontWeight:600, color:C.muted, marginBottom:4, display:"block" },
  input:       { width:"100%", padding:"11px 13px", borderRadius:10, border:`1.5px solid ${C.border}`, fontSize:15, background:"#FAFAFA", boxSizing:"border-box", outline:"none", color:C.text },
  select:      { width:"100%", padding:"11px 13px", borderRadius:10, border:`1.5px solid ${C.border}`, fontSize:15, background:"#FAFAFA", boxSizing:"border-box", outline:"none", color:C.text },
  btn:         { display:"block", width:"100%", padding:"13px 16px", borderRadius:12, border:"none", fontSize:15, fontWeight:600, cursor:"pointer", textAlign:"center", marginBottom:8, touchAction:"manipulation", WebkitTapHighlightColor:"rgba(0,0,0,0.1)" },
  btnP:        { background:C.primary, color:"#fff" },
  btnS:        { background:C.primaryLight, color:C.primary },
  btnD:        { background:C.dangerLight, color:C.danger },
  btnSm:       { padding:"7px 12px", borderRadius:8, border:"none", fontSize:13, fontWeight:600, cursor:"pointer" },
  badge:  (color, bg) => ({ display:"inline-block", fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:20, background:bg, color, marginRight:4 }),
  toggle: on  => ({ width:46, height:26, borderRadius:13, background:on?C.primary:"#DDD", position:"relative", cursor:"pointer", flexShrink:0, border:"none", transition:"background 0.2s" }),
  toggleDot: on => ({ position:"absolute", top:3, left:on?23:3, width:20, height:20, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.2)" }),
  checkBox: on => ({ width:24, height:24, borderRadius:6, border:on?"none":`2px solid ${C.border}`, background:on?C.primary:"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:"#fff", fontSize:13, cursor:"pointer", transition:"all 0.15s" }),
  pill: a  => ({ padding:"6px 14px", borderRadius:20, border:`1.5px solid ${a?C.primary:C.border}`, background:a?C.primaryLight:"#fff", color:a?C.primary:C.muted, fontSize:13, fontWeight:600, cursor:"pointer" }),
  mealCard: effort => ({ background:effort==="easy"?"#F0FAF4":"#fff", border:effort==="easy"?`1.5px solid #B8E8CA`:`1.5px solid ${C.border}`, borderRadius:12, padding:"12px 14px", marginBottom:10 }),
  tag: (color, bg) => ({ display:"inline-block", fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:20, background:bg||C.primaryLight, color:color||C.primary, marginLeft:4 }),
};

// ── Shared micro-components ────────────────────────────────────────────────────

function Toggle({ value, onChange }) {
  return (
    <button style={S.toggle(value)} onClick={() => onChange(!value)}>
      <div style={S.toggleDot(value)} />
    </button>
  );
}

function SearchBar({ value, onChange, placeholder }) {
  return (
    <div style={{ display:"flex", alignItems:"center", background:C.surface, borderRadius:12, padding:"10px 14px", marginBottom:10, border:`1.5px solid ${C.border}`, gap:8 }}>
      <span style={{ color:C.faint }}>🔍</span>
      <input style={{ flex:1, border:"none", outline:"none", fontSize:15, background:"transparent", color:C.text }} placeholder={placeholder||"Search..."} value={value} onChange={e => onChange(e.target.value)} />
      {value && <button onClick={() => onChange("")} style={{ background:"none", border:"none", color:C.faint, cursor:"pointer" }}>✕</button>}
    </div>
  );
}

function FieldGroup({ label, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

function PillSelect({ options, value, onChange }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>
      {options.map(o => <button key={o} style={S.pill(value===o)} onClick={() => onChange(o)}>{o}</button>)}
    </div>
  );
}

// ── PREP TAB ───────────────────────────────────────────────────────────────────

function PrepTab({ db, persistDB }) {
  // Always plans.current — the week actually being shopped — regardless of
  // which plan is active in the Plan tab. See getCurrentPlan's doc comment.
  const currentPlan       = getCurrentPlan(db);
  const cartItems         = currentPlan?.cartItems || [];
  const cartIngredientIds = currentPlan?.cartIngredientIds || [];
  const [newItem, setNewItem]         = useState("");
  const [cartSearch, setCartSearch]   = useState("");

  const freshPlanBase = () => ({ weekOf:new Date().toISOString().split("T")[0], weekStartDate:new Date().toISOString().split("T")[0], notes:"", meals:{}, items:[], cartItems:[], cartIngredientIds:[] });

  const updatePlan = updates => {
    const base = currentPlan || freshPlanBase();
    persistDB(writeCurrentPlan(db, { ...base, ...updates }));
  };

  // Quick-add a brand-new ingredient from Prep search and mark it in-cart in one
  // step. Uses sensible defaults (Unassigned location, specialty tier) — James
  // refines location/tier later in Manage. Creating the ingredient AND updating
  // the plan's cartIngredientIds must happen in a single persist so neither is lost.
  const addNewIngredient = rawName => {
    const name = rawName.trim();
    if (!name) return;
    const newIng = { id:"i"+Date.now()+Math.random().toString(36).slice(2,5), createdAt:new Date().toISOString(), name:name.charAt(0).toUpperCase()+name.slice(1), storageLocation:"Unassigned", tier:"specialty", optional:false, defaultQuantity:"" };
    const base = currentPlan || freshPlanBase();
    const updatedPlan = { ...base, cartIngredientIds:[...new Set([...(base.cartIngredientIds||[]), newIng.id])] };
    persistDB(writeCurrentPlan({ ...db, ingredients:[...db.ingredients, newIng] }, updatedPlan));
    setCartSearch("");
  };

  const [addNote, setAddNote] = useState(null);
  const addItem = () => {
    const q = newItem.trim();
    if (!q) return;
    // Try to match the typed text to a real ingredient, so it populates
    // cartIngredientIds (which the Inventory + List steps actually honor) rather
    // than free-text cartItems (which nothing reads). Match: exact name, then
    // substring either direction, preferring the shortest (closest) name.
    const ql = q.toLowerCase();
    const matches = db.ingredients.filter(i => {
      const n = i.name.toLowerCase();
      return n === ql || n.includes(ql) || ql.includes(n);
    }).sort((a, b) => a.name.length - b.name.length);
    const hit = matches.find(i => !cartIngredientIds.includes(i.id));
    if (hit) {
      updatePlan({ cartIngredientIds: [...new Set([...cartIngredientIds, hit.id])] });
      setAddNote({ ok:true, text:`✓ "${hit.name}" marked in cart — it'll drop off your list` });
    } else if (matches.length && matches.every(i => cartIngredientIds.includes(i.id))) {
      setAddNote({ ok:true, text:`"${matches[0].name}" is already in the cart` });
    } else {
      // No ingredient matches — keep as a free-text note, but say so honestly.
      updatePlan({ cartItems: [...cartItems, q] });
      setAddNote({ ok:false, text:`Added "${q}" as a note only — no matching item, so it won't change your list` });
    }
    setNewItem("");
    setTimeout(() => setAddNote(null), 4000);
  };

  return (
    <div style={S.body}>
      <div style={S.card}>
        <div style={S.sectionLabel}>This week</div>
        <div style={S.h2}>Prep</div>
        <div style={S.sub}>Mark what you've already bought so it drops off the shopping list.</div>
        {db.plans?.next && <div style={{ fontSize:12, color:C.muted, marginTop:6 }}>Always shows the current (shopping) week, even while next week's plan is being drafted.</div>}
      </div>

      <div style={S.card}>
        <div style={S.sectionLabel}>Already in cart</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:10 }}>Tap what you've already bought — like reading off your Walmart cart. These drop off the shopping list.</div>

        <input style={{ ...S.input, marginBottom:8 }} placeholder="Search ingredients to mark..." value={cartSearch} onChange={e => setCartSearch(e.target.value)} />
        {cartSearch.trim() && (
          <div style={{ maxHeight:260, overflowY:"auto", border:`1px solid ${C.border}`, borderRadius:8, marginBottom:10 }}>
            {db.ingredients
              .filter(i => i.name.toLowerCase().includes(cartSearch.toLowerCase()))
              .sort((a,b) => a.name.localeCompare(b.name))
              .slice(0, 40)
              .map(i => {
                const on = cartIngredientIds.includes(i.id);
                return (
                  <button key={i.id} style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", background:on?C.primaryLight:"#fff", border:"none", borderBottom:`1px solid ${C.border}`, padding:"10px 12px", cursor:"pointer", fontSize:14 }}
                    onClick={() => updatePlan({ cartIngredientIds: on ? cartIngredientIds.filter(x => x !== i.id) : [...new Set([...cartIngredientIds, i.id])] })}>
                    <span style={{ width:18, color:on?C.verified:C.faint, fontWeight:700 }}>{on ? "✓" : "＋"}</span>
                    <span style={{ flex:1 }}>{i.name}</span>
                    <span style={{ fontSize:11, color:C.faint }}>{i.storageLocation}</span>
                  </button>
                );
              })}
            {db.ingredients.filter(i => i.name.toLowerCase().includes(cartSearch.toLowerCase())).length === 0 && (
              <div style={{ padding:"12px", fontSize:13, color:C.faint, textAlign:"center" }}>No matching ingredient</div>
            )}
            {!db.ingredients.some(i => i.name.toLowerCase() === cartSearch.trim().toLowerCase()) && (
              <button style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", background:"#F0F7F2", border:"none", borderTop:`1px solid ${C.border}`, padding:"10px 12px", cursor:"pointer", fontSize:14, color:C.primary, fontWeight:600 }}
                onClick={() => addNewIngredient(cartSearch)}>
                <span style={{ width:18, fontWeight:700 }}>＋</span>
                <span style={{ flex:1 }}>Add "{cartSearch.trim()}" as new ingredient</span>
              </button>
            )}
          </div>
        )}

        {(cartIngredientIds.length > 0 || cartItems.length > 0) && (
          <div style={{ marginTop:6 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6, fontWeight:600 }}>{cartIngredientIds.length + cartItems.length} items already in cart</div>
            {cartIngredientIds.map(id => {
              const ing = db.ingredients.find(i => i.id === id);
              if (!ing) return null;
              return (
                <div key={id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ color:C.verified }}>✓</span>
                  <div style={{ flex:1, fontSize:14 }}>{ing.name}</div>
                  <button style={{ background:"none", border:"none", color:C.faint, cursor:"pointer", fontSize:18 }} onClick={() => updatePlan({ cartIngredientIds:cartIngredientIds.filter(i => i !== id) })}>×</button>
                </div>
              );
            })}
            {cartItems.map((item, idx) => (
              <div key={idx} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.muted }}>·</span>
                <div style={{ flex:1, fontSize:14 }}>{item}</div>
                <button style={{ background:"none", border:"none", color:C.faint, cursor:"pointer", fontSize:18 }} onClick={() => updatePlan({ cartItems:cartItems.filter((_, i) => i !== idx) })}>×</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display:"flex", gap:8, marginTop:10 }}>
          <input style={{ ...S.input, flex:1 }} placeholder="Type an item to mark it in cart..." value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if(e.key === "Enter") addItem(); }} />
          <button style={{ ...S.btn, ...S.btnP, width:"auto", padding:"11px 16px", marginBottom:0 }} onClick={addItem}>Add</button>
        </div>
        {addNote && <div style={{ fontSize:12, marginTop:6, color: addNote.ok ? C.verified : C.warning }}>{addNote.text}</div>}
      </div>
    </div>
  );
}

// ── PLAN TAB ───────────────────────────────────────────────────────────────────

function PlanTab({ db, persistDB }) {
  // The plan the owner is currently EDITING — follows db.activePlan (current or
  // next), unlike Prep/Tonight which are pinned to current. This plan object
  // doubles as both the live-editing draft and the committed record (they were
  // merged by the two-plan-model migration).
  const draft = getActivePlan(db);
  // Day-ordering follows THIS plan's own weekStartDate, recomputed every
  // render so editing the date (see the date input in PlanWelcome) reorders
  // the days live. Falls back to the shoppingDay default only when there's no
  // active plan yet (very first load, before any plan exists).
  const { days, daysFull, effortMap } = draft?.weekStartDate
    ? getWeekFromDate(draft.weekStartDate)
    : getWeekFromDay(db.settings?.shoppingDay || "Wednesday");

  // Step-flow migrations, applied in sequence so a draft from ANY prior version
  // lands correctly:
  //   pre-v2 → v2: old 8-step (Welcome·Partner·Meals·Inventory·List·Messages·Print·
  //     Reconcile) → 6-step (Welcome·Meals·Inventory·List·Print·Reconcile). Partner
  //     folded into Meals, Messages removed. Map: 0→0,1→1,2→1,3→2,4→3,5→4,6→4,7→5.
  //   v2 → v3: List split into Confirm+Sparky, Print removed. Flow becomes
  //     Welcome·Meals·Inventory·Confirm·Sparky·Reconcile. Map: 0→0,1→1,2→2,3→3,
  //     4→4(Print→Sparky),5→5.
  //   v3 → v4: Reconcile step removed. Flow becomes Welcome·Meals·Inventory·
  //     Confirm·Sparky (5 steps, indices 0–4). Any step 5 clamps to 4 (Sparky).
  const migrateV2 = s => [0,1,1,2,3,4,4,5][s] ?? 0;
  const migrateV3 = s => [0,1,2,3,4,5][s] ?? 0;   // old Print(4) folds onto Sparky(4)
  const migrateV4 = s => s === 5 ? 4 : s;         // old Reconcile(5) folds onto Sparky(4)
  const ver = draft?._stepsVer || (draft?._stepsV2 ? 2 : 1);
  const migrateStep = s => {
    let x = s;
    if (ver < 2) x = migrateV2(x);
    if (ver < 3) x = migrateV3(x);
    if (ver < 4) x = migrateV4(x);
    return x;
  };
  const needsMigrate = draft && ver < 4;
  const initStep    = draft ? (needsMigrate ? migrateStep(draft.step) : draft.step) : 0;
  const initMaxStep = draft ? (needsMigrate ? migrateStep(draft.maxStep ?? draft.step) : (draft.maxStep ?? draft.step)) : 0;

  // Initialize from saved draft if present, else fresh defaults.
  const [step, setStep]               = useState(initStep);
  const [maxStep, setMaxStep]         = useState(initMaxStep);
  const [awayHome, setAwayHome]   = useState(draft?.awayHome || Object.fromEntries(days.map(d => [d, true])));
  const [mealPlan, setMealPlan]       = useState(draft?.mealPlan || Object.fromEntries(days.map(d => [d, []])));
  const [checkedIds, setCheckedIds]   = useState(draft?.checkedIds || []);
  const [dayNotes, setDayNotes]       = useState(draft?.dayNotes || {});
  const [dayPills, setDayPills]       = useState(draft?.dayPills || {});
  const [stapleFlags, setStapleFlags] = useState(draft?.stapleFlags || {});
  const [quantities, setQuantities]   = useState(draft?.quantities || {});
  const [weather, setWeather]         = useState(draft?.weather || "hot");

  const meals       = db.meals || [];
  const ingredients = db.ingredients || [];

  // Persist the current editing state into the active plan slot. Spreads the
  // existing plan first so committed fields (meals, items, cart*,
  // dismissedShared, weekOf, weekStartDate) survive — only draft-editing fields
  // are updated here. Accepts a patch so callers can save the new value
  // synchronously (React state updates are async). opts forwards to persistDB
  // (e.g. { background: true } for the weather-driven pill auto-derive, which
  // must not look like a user edit — see SPEC-data-provenance.md).
  const saveDraft = (patch = {}, opts = {}) => {
    const next = {
      ...draft,
      step, maxStep, awayHome, mealPlan, checkedIds, dayNotes, dayPills, stapleFlags, quantities, weather,
      _stepsVer: 4,
      startedAt: draft?.startedAt || new Date().toISOString(),
      ...patch,
    };
    persistDB(writeActivePlan(db, next), opts);
  };

  const clearDraft = () => persistDB(writeActivePlan(db, null));

  // Navigate to any step. maxStep only ever grows, so once you've visited a step
  // it stays unlocked even after you jump backward.
  const goToStep = s => {
    const newMax = Math.max(maxStep, s);
    setStep(s);
    setMaxStep(newMax);
    saveDraft({ step: s, maxStep: newMax });
  };

  // Wrapped setters: update local state AND persist the draft in one shot.
  const setAwayHomeP  = v => { const nv = typeof v === "function" ? v(awayHome)  : v; setAwayHome(nv);  saveDraft({ awayHome: nv }); };
  const setMealPlanP    = v => { const nv = typeof v === "function" ? v(mealPlan)    : v; setMealPlan(nv);    saveDraft({ mealPlan: nv }); };
  const setCheckedIdsP  = v => { const nv = typeof v === "function" ? v(checkedIds)  : v; setCheckedIds(nv);  saveDraft({ checkedIds: nv }); };
  const setDayNotesP    = v => { const nv = typeof v === "function" ? v(dayNotes)    : v; setDayNotes(nv);    saveDraft({ dayNotes: nv }); };
  const setDayPillsP    = (v, opts) => { const nv = typeof v === "function" ? v(dayPills)    : v; setDayPills(nv);    saveDraft({ dayPills: nv }, opts); };
  const setStapleFlagsP = v => { const nv = typeof v === "function" ? v(stapleFlags) : v; setStapleFlags(nv); saveDraft({ stapleFlags: nv }); };
  const setQuantitiesP  = v => { const nv = typeof v === "function" ? v(quantities)  : v; setQuantities(nv);  saveDraft({ quantities: nv }); };
  const setWeatherP     = v => { const nv = typeof v === "function" ? v(weather)     : v; setWeather(nv);     saveDraft({ weather: nv }); };

  // Single-write committer for placing a meal on the planner. If the name is new,
  // it creates a stub meal record. Meals + mealPlan + draft are written in ONE
  // persistDB so the two mutations can't clobber each other's stale-closure db.
  // Spreads ...draft first so committed fields (cart*, items, dismissedShared,
  // weekOf, weekStartDate) and dayPills survive — only the listed fields change.
  const commitMealToPlan = (newMealPlan, maybeNewName) => {
    setMealPlan(newMealPlan);
    let meals = db.meals || [];
    const nm = (maybeNewName||"").trim();
    if (nm && !meals.some(m => m.name.toLowerCase() === nm.toLowerCase())) {
      meals = [...meals, { id:"m"+Date.now()+Math.random().toString(36).slice(2,5), createdAt:new Date().toISOString(), name:nm, effort:"medium", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"none", preferences:[], notes:"", ingredients:[] }];
    }
    const nextDraft = { ...draft, step, maxStep, awayHome, mealPlan:newMealPlan, checkedIds, dayNotes, stapleFlags, quantities, weather, startedAt: draft?.startedAt || new Date().toISOString() };
    persistDB(writeActivePlan({ ...db, meals }, nextDraft));
  };

  // Bootstrap the very FIRST plan. Only reachable from the blank Welcome screen
  // ("Start planning", shown when there's no current plan at all yet — see
  // PlanWelcome's !onResume branch) or the rare case of a plan record that
  // exists but never advanced past step 0. Once a real current plan exists,
  // startNextWeek (below) is how a new week begins — this never runs again
  // after the first plan, so the archive-before-clear step below is a safety
  // net for that edge case rather than the everyday path.
  const startFresh = () => {
    const freshAway = Object.fromEntries(days.map(d => [d, true]));
    const freshMeals  = Object.fromEntries(days.map(d => [d, []]));
    setAwayHome(freshAway);
    setMealPlan(freshMeals);
    setCheckedIds([]);
    setDayNotes({});
    setStapleFlags({});
    setQuantities({});
    setWeather("hot");
    setStep(1);
    setMaxStep(1);

    const outgoingMeals = Object.values(draft?.mealPlan || draft?.meals || {}).flat()
      .filter(n => n && n !== "Choose your own night" && n !== "Choose your own");
    const prevHistory = db.mealHistory || [];
    const mealHistory = outgoingMeals.length
      ? [...prevHistory, { archivedAt:new Date().toISOString(), meals:[...new Set(outgoingMeals)] }].slice(-6)
      : prevHistory;

    // Seed the new plan's start date from the "Default plan start day" setting
    // — the next upcoming date on that weekday — not just today. The owner can
    // override immediately via the date input on the resume card.
    const seedDate = nextDateForShoppingDay(db.settings?.shoppingDay || "Wednesday");
    const freshPlan = {
      weekOf: seedDate, weekStartDate: seedDate, notes:"", meals:{}, items:[],
      cartItems: draft?.cartItems || [], cartIngredientIds: draft?.cartIngredientIds || [], dismissedShared: [],
      // Auto-populate day notes from this week's baked-in schedule so a new plan
      // never starts blank. notesTouched tracks manual edits so a later refresh
      // can tell "never edited" from "deliberately changed".
      step:1, maxStep:1, awayHome:freshAway, mealPlan:freshMeals, checkedIds:[], dayNotes:{ ...defaultNotes }, dayPills:{}, notesTouched:false, _stepsVer:4, stapleFlags:{}, quantities:{}, weather:"hot", startedAt:new Date().toISOString(),
    };

    persistDB(writeActivePlan({ ...db, mealHistory }, freshPlan));
  };

  // Create plans.next as a fresh, empty plan — the everyday "begin a new week"
  // action once a current plan already exists. Never touches plans.current:
  // the two are independent silos (no meal carry-over, no shared cart — the
  // owner re-adds anything manually). weekStartDate defaults to 7 days after
  // current's own anchor; the owner can edit it afterward (shopping day can
  // shift). Guarded to only run when next is null — the UI hides the button
  // otherwise. Auto-retire (on a later app load) is what promotes this to
  // current once its date arrives; this function never does that itself.
  const startNextWeek = () => {
    if (db.plans?.next) return;
    const freshAway  = Object.fromEntries(days.map(d => [d, true]));
    const freshMeals = Object.fromEntries(days.map(d => [d, []]));
    const anchor     = draft?.weekStartDate || new Date().toISOString().split("T")[0];
    const nextStart  = addDaysISO(anchor, 7);
    const freshPlan = {
      weekOf: nextStart, weekStartDate: nextStart, notes:"", meals:{}, items:[],
      cartItems:[], cartIngredientIds:[], dismissedShared:[],
      step:1, maxStep:1, awayHome:freshAway, mealPlan:freshMeals, checkedIds:[], dayNotes:{ ...defaultNotes }, dayPills:{}, notesTouched:false, _stepsVer:4, stapleFlags:{}, quantities:{}, weather:"hot", startedAt:new Date().toISOString(),
    };
    persistDB({ ...db, plans: { ...db.plans, next: freshPlan }, activePlan: "next" });
  };

  // Exit the planning flow WITHOUT destroying anything. The draft IS the living
  // plan — it persists so exports keep publishing the week's meals and you can
  // resume to tweak. Retirement is date-driven (autoRetirePlans, on a later app
  // load), not triggered by finishing — this just returns to the welcome screen.
  const finishPlan = () => {
    // Return to Welcome. Don't read the raw draft's stored step here — after a
    // mode split/migration the raw value can be out of range; just reset cleanly.
    setStep(0);
    setMaxStep(prev => prev);
  };

  const hasDraft = !!draft && (draft.maxStep ?? draft.step) > 0;

  // Current/Next toggle. Only shown once both plans exist — before that,
  // there's nothing to switch between, and "Start next week" (on Welcome) is
  // the only way to create one. Switching persists db.activePlan; PlanTab is
  // rendered with key={db.activePlan} (see the tab-switch site in App) so a
  // switch fully remounts this component instead of leaving stale local
  // editing state (step/mealPlan/etc.) pointed at the plan you switched away
  // from — those hooks are only ever seeded once, at mount.
  const PlanSilosToggle = () => {
    if (!db.plans?.next) return null;
    const activeKey = db.activePlan || "current";
    return (
      <div style={{ display:"flex", gap:6, padding:"10px 12px", background:C.primary }}>
        {["current","next"].map(k => (
          <button key={k} onClick={() => k !== activeKey && persistDB({ ...db, activePlan:k })}
            style={{ flex:1, padding:"8px 10px", borderRadius:8, border:"none", fontWeight:700, fontSize:12, cursor:"pointer",
              background: activeKey===k ? C.accent : "rgba(255,255,255,0.14)",
              color: activeKey===k ? "#fff" : "#B8E8CA" }}>
            <div>{k==="current" ? "Current week" : "Next week"}</div>
            <div style={{ fontWeight:500, opacity:0.85, fontSize:11 }}>{weekLabel(db.plans[k]?.weekStartDate)}</div>
          </button>
        ))}
      </div>
    );
  };

  // Tappable step navigation. Gates on maxStep (furthest reached), so any step
  // you've visited stays freely tappable — backward OR forward — even after you
  // jump around. Steps you haven't reached yet stay locked.
  const StepNav = () => (
    <div style={{ background:"#2D5A3D", padding:"8px 10px", display:"flex", gap:4, overflowX:"auto", position:"sticky", top:52, zIndex:9 }}>
      {PLAN_STEPS.map((label, i) => {
        const active     = i === step;
        const visited    = i < step;
        const accessible = i <= maxStep;
        return (
          <button key={i} onClick={() => accessible && i !== step && goToStep(i)}
            style={{ flexShrink:0, padding:"5px 11px", borderRadius:20, border:"none", fontSize:11, fontWeight:700,
              cursor: accessible && i !== step ? "pointer" : "default",
              background: active ? C.accent : accessible ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)",
              color: active ? "#fff" : accessible ? "#B8E8CA" : "rgba(255,255,255,0.4)" }}>
            {accessible && !active ? "✓ " : ""}{label}
          </button>
        );
      })}
    </div>
  );

  if (step === 0) {
    return (
      <div>
        <PlanSilosToggle />
        {hasDraft && <StepNav />}
        <div style={S.body}>
          <PlanWelcome
            onStart={startFresh}
            onStartNext={startNextWeek}
            onResume={hasDraft ? () => goToStep(initMaxStep) : null}
            draft={draft}
            persistDB={persistDB}
            db={db}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PlanSilosToggle />
      <StepNav />
      <div style={S.body}>
        {step === 1 && <PlanMeals   mealPlan={mealPlan} setMealPlan={setMealPlanP} commitMealToPlan={commitMealToPlan} awayHome={awayHome} setAwayHome={setAwayHomeP} meals={meals} onNext={() => goToStep(2)} days={days} daysFull={daysFull} effortMap={effortMap} dayNotes={dayNotes} setDayNotes={setDayNotesP} dayPills={dayPills} setDayPills={setDayPillsP} db={db} persistDB={persistDB} />}
        {step === 2 && <PlanInventory checkedIds={checkedIds} setCheckedIds={setCheckedIdsP} stapleFlags={stapleFlags} setStapleFlags={setStapleFlagsP} quantities={quantities} setQuantities={setQuantitiesP} mealPlan={mealPlan} meals={meals} ingredients={ingredients} onNext={() => goToStep(3)} days={days} cartIngredientIds={draft?.cartIngredientIds || []} onChangeItemTier={(id, tier, subtype) => persistDB({ ...db, ingredients: db.ingredients.map(i => i.id === id ? { ...i, tier, stapleType: subtype || undefined } : i) })} />}
        {step === 3 && <PlanConfirm mode="confirm" checkedIds={checkedIds} stapleFlags={stapleFlags} quantities={quantities} setQuantities={setQuantitiesP} mealPlan={mealPlan} meals={meals} ingredients={ingredients} onNext={() => goToStep(4)} db={db} persistDB={persistDB} days={days} daysFull={daysFull} />}
        {step === 4 && <PlanConfirm mode="sparky" checkedIds={checkedIds} stapleFlags={stapleFlags} quantities={quantities} setQuantities={setQuantitiesP} mealPlan={mealPlan} meals={meals} ingredients={ingredients} onFinish={finishPlan} db={db} persistDB={persistDB} days={days} daysFull={daysFull} />}
        {step > 1 && (
          <button style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 16px", fontSize:14, color:C.muted, cursor:"pointer", width:"100%", marginTop:4 }} onClick={() => goToStep(step - 1)}>
            ← Back
          </button>
        )}
        <button style={{ background:"none", border:"none", fontSize:13, color:C.faint, cursor:"pointer", width:"100%", marginTop:8, padding:6 }} onClick={() => setStep(0)}>
          Save &amp; exit to start — your progress is kept
        </button>
      </div>
    </div>
  );
}

function PlanWelcome({ onStart, onStartNext, onResume, draft, persistDB, db }) {
  const [showImport, setShowImport]   = useState(false);
  const [importText, setImportText]   = useState("");
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState(null);

  // Resolve the resume-step label from the draft's own version stamp — initMaxStep
  // lives in PlanTab, not here, so migrate locally. Mirrors PlanTab's migration.
  const _mV2 = s => [0,1,1,2,3,4,4,5][s] ?? 0;
  const _mV3 = s => [0,1,2,3,4,5][s] ?? 0;
  const _mV4 = s => s === 5 ? 4 : s;
  const _ver = draft?._stepsVer || (draft?._stepsV2 ? 2 : 1);
  const _rawStep = draft?.maxStep ?? draft?.step ?? 0;
  const _resumeStep = draft ? _mV4(_ver < 2 ? _mV3(_mV2(_rawStep)) : _ver < 3 ? _mV3(_rawStep) : _rawStep) : 0;
  const draftStepName  = draft ? PLAN_STEPS[_resumeStep] : null;
  const draftMealCount = draft ? Object.values(draft.mealPlan || {}).flat().length : 0;
  const draftStarted   = draft?.startedAt ? new Date(draft.startedAt).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}) : null;

  return (
    <div>
      <div style={{ ...S.card, background:C.primary, color:"#E8F5EE" }}>
        <div style={{ fontSize:28, marginBottom:8 }}>🛒</div>
        <div style={{ fontSize:22, fontWeight:700, marginBottom:6 }}>Weekly Grocery Planner</div>
        <div style={{ fontSize:14, opacity:0.8, lineHeight:1.5 }}>Middletown DE</div>
      </div>

      <RefreshReminder />

      {onResume && draft && (
        <div style={{ ...S.card, border:`2px solid ${C.accent}`, background:C.primaryLight }}>
          <div style={S.sectionLabel}>{db.activePlan === "next" ? "Next week's plan" : "Current plan"}</div>
          <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Left off at: {draftStepName}</div>
          <div style={{ fontSize:13, color:C.muted, marginBottom:8 }}>
            {draftStarted && <span>Started {draftStarted}</span>}
            {draftStarted && draftMealCount > 0 && <span> · </span>}
            {draftMealCount > 0 && <span>{draftMealCount} meal{draftMealCount!==1?"s":""} planned</span>}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, fontSize:12, color:C.muted }}>
            <span style={{ fontWeight:700 }}>{weekLabel(draft.weekStartDate)}</span>
            {/* This date drives day-ordering for the whole plan (see getWeekFromDate), so it's editable rather than fixed to the settings default — shopping day shifts week to week. */}
            <input type="date" value={draft.weekStartDate || ""} onChange={e => e.target.value && persistDB(writeActivePlan(db, { ...draft, weekStartDate:e.target.value }))}
              style={{ fontSize:12, border:`1px solid ${C.border}`, borderRadius:6, padding:"3px 5px", color:C.muted }} />
          </div>
          <button style={{ ...S.btn, ...S.btnP, marginBottom:0 }} onClick={onResume}>Open / edit plan</button>
          {!db.plans?.next && (
            <button style={{ ...S.btn, ...S.btnS, marginTop:8, marginBottom:0 }} onClick={onStartNext}>
              Start next week's plan →
            </button>
          )}
        </div>
      )}

      {db && (() => {
        const ings       = db.ingredients || [];
        const meals      = db.meals || [];
        const plan       = getActivePlan(db);
        const always     = ings.filter(i => i.tier === "always").length;
        const staple     = ings.filter(i => i.tier === "staple").length;
        const specialty  = ings.filter(i => i.tier === "specialty").length;
        const unassigned = ings.filter(i => i.storageLocation === "Unassigned").length;
        const mealsWithIngs = meals.filter(m => m.ingredients?.length > 0).length;
        const inCart     = (plan?.cartIngredientIds?.length || 0) + (plan?.cartItems?.length || 0);
        return (
          <div style={S.card}>
            <div style={S.sectionLabel}>This week at a glance</div>
            <div style={{ display:"flex", gap:0, marginBottom:10 }}>
              {[
                { label:"Always", value:always,    color:C.accent,   bg:"#E8F5EE" },
                { label:"Staple", value:staple,     color:"#3730A3",  bg:"#EEF2FF" },
                { label:"Specialty", value:specialty, color:C.muted,  bg:"#F3F4F6" },
                { label:"Unassigned", value:unassigned, color:C.warning, bg:C.warningLight },
              ].map((item, i, arr) => (
                <div key={item.label} style={{ flex:1, textAlign:"center", padding:"10px 4px", background:item.bg, borderRadius:i===0?"8px 0 0 8px":i===arr.length-1?"0 8px 8px 0":"0", borderRight:i<arr.length-1?`1px solid ${C.border}`:"none" }}>
                  <div style={{ fontSize:22, fontWeight:800, color:item.color, lineHeight:1 }}>{item.value}</div>
                  <div style={{ fontSize:10, fontWeight:700, color:item.color, opacity:0.8, marginTop:3, textTransform:"uppercase", letterSpacing:"0.04em" }}>{item.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:16, fontSize:13, color:C.muted }}>
              <span>🍽 {mealsWithIngs}/{meals.length} meals linked</span>
              {inCart > 0 && <span>🛒 {inCart} already in cart</span>}
              {unassigned > 0 && <span style={{ color:C.warning }}>⚠️ {unassigned} need location</span>}
            </div>
          </div>
        );
      })()}


      {!showImport ? (
        <div style={{ textAlign:"center", marginBottom:8 }}>
          <button style={{ background:"none", border:"none", color:C.accentMuted, fontSize:13, cursor:"pointer", textDecoration:"underline" }} onClick={() => setShowImport(true)}>
            📥 Import from iCloud Drive
          </button>
        </div>
      ) : (
        <div style={{ ...S.card, marginBottom:8 }}>
          <div style={S.sectionLabel}>Import from iCloud Drive</div>
          {importSuccess ? (
            <div style={{ background:C.primaryLight, borderRadius:10, padding:"12px 14px", textAlign:"center" }}>
              <div style={{ fontSize:18, marginBottom:4 }}>✅</div>
              <div style={{ fontWeight:700, color:C.primary, fontSize:14 }}>{importSuccess.meals} meals · {importSuccess.items} items imported</div>
              <button style={{ ...S.btn, ...S.btnP, marginTop:10, marginBottom:0 }} onClick={() => { setShowImport(false); setImportSuccess(null); }}>Done</button>
            </div>
          ) : (
            <>
              <textarea style={{ ...S.input, height:80, fontSize:11, fontFamily:"monospace", resize:"none", marginBottom:6 }} placeholder="Paste JSON here..." value={importText} onChange={e => { setImportText(e.target.value); setImportError(""); }} />
              {importError && <div style={{ fontSize:12, color:C.danger, marginBottom:6 }}>{importError}</div>}
              <div style={{ display:"flex", gap:8 }}>
                <button style={{ ...S.btn, ...S.btnP, flex:1, marginBottom:0 }} disabled={!importText.trim()} onClick={() => {
                  try {
                    const parsed = JSON.parse(extractJSON(importText));
                    if (!parsed.meals || !parsed.ingredients) throw new Error("Invalid format");
                    persistDB(parsed);
                    setImportText("");
                    setImportSuccess({ meals:parsed.meals.length, items:parsed.ingredients.length });
                  } catch(e) { setImportError("Could not parse: " + e.message); }
                }}>Import</button>
                <button style={{ ...S.btn, ...S.btnS, flex:1, marginBottom:0 }} onClick={() => { setShowImport(false); setImportText(""); setImportError(""); }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {!onResume && <button style={{ ...S.btn, ...S.btnP }} onClick={onStart}>Start planning</button>}
    </div>
  );
}

// Copy text to the clipboard using the path that actually works in the iOS
// webview (hidden textarea + execCommand), with the modern API as a bonus.
// Returns true on success. Used by all family-comms buttons — sms: links are
// blocked in this webview, so we copy the message for the user to paste.
function copyToClipboard(text) {
  let ok = false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    ok = document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (e) { ok = false; }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
  return ok;
}

// Auto-growing textarea with a STABLE ref. Defined at module level so its ref
// callback identity never changes between renders — an inline `ref={el => ...}`
// makes React detach/re-attach the element every render, which steals focus after
// each keystroke (the day-notes "one letter at a time" bug).
function AutoGrowTextarea({ value, onChange, placeholder, style }) {
  const ref = useRef(null);
  const fit = el => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } };
  // Resize when the value changes from outside (e.g. reset-notes), not on keystroke.
  useEffect(() => { fit(ref.current); }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      style={style}
      placeholder={placeholder}
      value={value}
      onChange={e => { fit(e.target); onChange(e.target.value); }}
    />
  );
}

function PlanMeals({ mealPlan, setMealPlan, commitMealToPlan, awayHome, setAwayHome, meals, onNext, days, daysFull, effortMap, dayNotes, setDayNotes, dayPills, setDayPills, db, persistDB }) {
  const [editing, setEditing] = useState(null);
  const [moving,  setMoving]  = useState(null);
  const [search,  setSearch]  = useState("");
  const [loading, setLoading] = useState(false);
  const allMeals   = meals.length > 0 ? meals : SEED_MEALS;

  // When browsing (empty search box), order intentionally to aid discovery:
  //   sides (A–Z) → mains/dinners (least-recently-used first) → remix/batch/takeout.
  // When typing, keep the plain filtered list so matches are predictable.
  // Recency comes from mealHistory (archived weeks); a meal never served sorts
  // as "least recent" so fresh options rise to the top of the mains group.
  const lastUsedIndex = (() => {
    const hist = db?.mealHistory || [];
    const idx = {};                       // meal name → weeks-ago of last use (0 = most recent week)
    hist.slice().reverse().forEach((h, ago) => {
      (h.meals || []).forEach(n => { if (idx[n] === undefined) idx[n] = ago; });
    });
    return idx;
  })();
  const typeRank = m => {
    const t = m.type || "dinner";
    if (t === "side")   return 0;
    if (t === "dinner") return 1;
    return 2;                             // remix / batch / takeout last
  };
  const browseSorted = [...allMeals].sort((a, b) => {
    const ra = typeRank(a), rb = typeRank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return a.name.localeCompare(b.name);            // sides: A–Z
    if (ra === 1) {                                               // mains: least-recently-used first
      const ua = lastUsedIndex[a.name] ?? 999;                   // never-used → most "stale" → top
      const ub = lastUsedIndex[b.name] ?? 999;
      if (ua !== ub) return ub - ua;                             // higher weeks-ago first
      return a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);                         // tail group: A–Z
  });
  const filtered   = search.trim()
    ? allMeals.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
    : browseSorted;
  const totalMeals = Object.values(mealPlan).flat().length;

  const [seenSuggestions, setSeenSuggestions] = useState([]);
  // Live weather: fetch once on mount (cached 6h). Falls back to {} when blocked
  // or offline, which every consumer treats as neutral. See fetchLiveForecast.
  // NOTE: declared BEFORE the pill-derive effect below, which reads them — const
  // has no hoisting, so using them earlier throws a temporal-dead-zone ReferenceError.
  const [forecast, setForecast] = useState({});
  const [forecastLoaded, setForecastLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchLiveForecast().then(f => { if (!cancelled) { setForecast(f); setForecastLoaded(true); } });
    return () => { cancelled = true; };
  }, []);
  // Auto-derive pills ONCE if this plan has none yet. Gated on forecastLoaded so a
  // slow/blocked weather fetch can't cause this plan to miss its one shot at
  // auto-flagging grill days. After that, the user's edits always win.
  useEffect(() => {
    if (!forecastLoaded) return;
    const anySet = days.some(d => (dayPills?.[d] || []).length > 0);
    // background:true — this is an automatic weather-driven write, not a user
    // edit, so it must not bump dataChangedAt (see SPEC-data-provenance.md).
    if (!anySet) setDayPills(derivePills(days, effortMap, forecast), { background: true });
  }, [forecastLoaded]);
  // Notes safety net (carried over from the old Partner step): if this step opens
  // with every day note blank, fill from the baked schedule once. Fires only when
  // ALL are empty, so it never clobbers edits. New plans seed notes in startFresh;
  // this covers in-progress drafts that predate that.
  useEffect(() => {
    const allEmpty = days.every(d => !((dayNotes||{})[d] || "").trim());
    if (allEmpty) setDayNotes(prev => { const next = { ...prev }; days.forEach(d => { next[d] = defaultNotes[d] || ""; }); return next; });
  }, []);
  const [pillEditDay, setPillEditDay] = useState(null);
  const [newPillLabel, setNewPillLabel] = useState("");
  const togglePill = (day, label) => setDayPills(prev => {
    const cur = prev?.[day] || [];
    const has = cur.some(p => p.label === label);
    return { ...prev, [day]: has ? cur.filter(p => p.label !== label) : [...cur, { label, source:"manual" }] };
  });
  const removePill = (day, label) => setDayPills(prev => ({ ...prev, [day]: (prev?.[day]||[]).filter(p => p.label !== label) }));
  const addCustomPill = day => {
    const l = newPillLabel.trim();
    if (!l) return;
    setDayPills(prev => ({ ...prev, [day]: [...(prev?.[day]||[]), { label:l, source:"manual" }] }));
    setNewPillLabel("");
  };

  const regenerate = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 400));
    const alreadyPlanned = Object.values(mealPlan).flat();
    // Soft variety: meals served in the last 3 archived weeks get deprioritized.
    const recentMeals = (db.mealHistory || []).slice(-3).flatMap(h => h.meals || []);
    // #3: also skip meals already surfaced in THIS session's rerolls, so each
    // regenerate shows fresh options instead of re-landing on the same few.
    // Once we'd have nothing new to show, reset the seen set and start over.
    const eligibleCount = allMeals.filter(m => !alreadyPlanned.includes(m.name)).length;
    let seen = seenSuggestions;
    if (seen.length >= eligibleCount) seen = [];   // exhausted the pool → reset
    const suggestions = getMealSuggestions(awayHome, allMeals, days, effortMap, alreadyPlanned, recentMeals, seen, dayPills, forecast);
    const freshlySuggested = days.map(d => suggestions[d]).filter(Boolean);
    setSeenSuggestions([...new Set([...seen, ...freshlySuggested])]);
    setMealPlan(prev => {
      const next = { ...prev };
      days.forEach(d => { if (!prev[d] || !prev[d].length) next[d] = suggestions[d] ? [suggestions[d]] : []; });
      return next;
    });
    setLoading(false);
  };

  const [draftSms, setDraftSms] = useState(null);
  const [draftCopied, setDraftCopied] = useState(false);
  const textDraftPlan = () => {
    const lines = days.map((d, i) => {
      const m = (mealPlan[d] || []).join(", ");
      return `${daysFull[i]}: ${m || "—"}`;
    });
    const msg = "🍽️ Draft dinner plan for the week (still tentative!):\n\n"
      + lines.join("\n\n")
      + "\n\n✏️ Let me know if you have other suggestions or preferences";
    // sms: is blocked in this webview — copy the message for pasting instead.
    const copied = copyToClipboard(msg);
    setDraftCopied(true);
    setTimeout(() => setDraftCopied(false), 2500);
    setDraftSms(msg);
  };

  // Add a meal to a day. For an existing meal, pass isNew=false; for a freshly
  // typed name, isNew=true so a stub record gets created in the same write.
  const addMeal = (day, name, isNew=false) => {
    const next = { ...mealPlan, [day]:[...(mealPlan[day]||[]), name] };
    commitMealToPlan(next, isNew ? name : null);
    setEditing(null); setSearch("");
  };
  const replaceMeal = (day, mealIdx, name, isNew=false) => {
    const u = [...(mealPlan[day]||[])]; u[mealIdx] = name;
    commitMealToPlan({ ...mealPlan, [day]:u }, isNew ? name : null);
    setEditing(null); setSearch("");
  };
  const removeMeal = (day, idx) => setMealPlan(prev => ({ ...prev, [day]:(prev[day]||[]).filter((_,i)=>i!==idx) }));
  const moveMeal = (fromDay, mIdx, toDay) => {
    setMealPlan(prev => {
      const meal = (prev[fromDay]||[])[mIdx];
      return { ...prev, [fromDay]:(prev[fromDay]||[]).filter((_,i)=>i!==mIdx), [toDay]:[...(prev[toDay]||[]),meal] };
    });
    setMoving(null);
  };

  const MealSearch = ({ day, mealIdx }) => (
    <div style={{ marginTop:8 }}>
      <input style={{ ...S.input, marginBottom:8 }} placeholder="Search meals..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
      <div style={{ maxHeight:180, overflowY:"auto" }}>
        {filtered.map(m => (
          <div key={m.id} style={{ padding:"10px 4px", borderBottom:`1px solid ${C.border}`, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between" }}
            onClick={() => {
              if (mealIdx !== undefined) replaceMeal(day, mealIdx, m.name, false);
              else addMeal(day, m.name, false);
            }}>
            <span>{m.name}</span>
            <span style={{ display:"flex", gap:4, alignItems:"center" }}>
              {m.type === "side"    && <span style={S.tag(C.accent,  C.primaryLight)}>side</span>}
              {m.type === "remix"   && <span style={S.tag("#7C3AED", "#EDE9FE")}>remix</span>}
              {m.type === "batch"   && <span style={S.tag(C.muted,   "#F3F4F6")}>batch</span>}
              {m.type === "takeout" && <span style={S.tag(C.muted,   "#F3F4F6")}>takeout</span>}
              {(m.preferences||[]).some(p => p.person==="D"&&p.pref==="dislikes") && <span style={S.tag(C.danger, C.dangerLight)}>not Partner</span>}
            </span>
          </div>
        ))}
        {search && (
          <div style={{ padding:"10px 4px", fontSize:14, cursor:"pointer", color:C.primary, fontWeight:600 }}
            onClick={() => { if (mealIdx!==undefined) replaceMeal(day, mealIdx, search, true); else addMeal(day, search, true); }}>
            + Use "{search}" <span style={{ fontWeight:500, color:C.faint }}>— adds to Meals list</span>
          </div>
        )}
      </div>
      <button style={{ ...S.btn, ...S.btnD, marginTop:4, marginBottom:0 }} onClick={() => { setEditing(null); setSearch(""); }}>Cancel</button>
    </div>
  );

  return (
    <div>
      <div style={S.card}>
        <div style={S.sectionLabel}>Step 2 - Meal Plan</div>
        <div style={S.h2}>This week's dinners</div>
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:12, color:C.faint, lineHeight:1.5 }}>
            Each day uses its own forecast and pills. Grill days are auto-detected from the weather; tap a day's pills to adjust.
          </div>
        </div>
        <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={regenerate} disabled={loading}>{loading?"Thinking...":"Regenerate empty days"}</button>
      </div>
      {totalMeals === 0 && <button style={{ ...S.btn, ...S.btnP }} onClick={regenerate}>Generate meal plan</button>}
      {days.map((day, i) => {
        const dayMeals      = mealPlan[day] || [];
        const pills         = dayPills?.[day] || [];
        const isEasy        = pills.some(p => p.label === "easy");
        const memberAway    = !awayHome[day];
        const isEditingNew  = editing?.day === day && editing?.mealIdx == null;
        const editingPills  = pillEditDay === day;
        return (
          <div key={day} style={S.mealCard(isEasy)}>
            <div style={{ fontSize:11, fontWeight:700, color:C.accentMuted, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:4 }}>
              {daysFull[i]}
              {forecast[day] && <span style={{ marginLeft:8, fontWeight:600, color:C.muted, textTransform:"none", letterSpacing:0 }}>{forecast[day].icon} {forecast[day].hi}° · {forecast[day].pop}% rain</span>}
              <span onClick={() => setAwayHome(prev => ({ ...prev, [day]: !(prev[day] !== false) }))}
                style={{ marginLeft:8, cursor:"pointer", ...S.tag(memberAway ? C.warning : C.faint, memberAway ? C.warningLight : "#F1F1F1") }}>
                {memberAway ? "Partner away" : "Partner home"}
              </span>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4, alignItems:"center", marginBottom:6 }}>
              {pills.map(p => {
                const st = PILL_STYLE[p.label] || { c:C.muted, bg:"#F3F4F6" };
                return (
                  <span key={p.label} style={{ ...S.tag(st.c, st.bg), display:"inline-flex", alignItems:"center", gap:4 }}>
                    {p.label}
                    {editingPills && <span style={{ cursor:"pointer", fontWeight:700 }} onClick={() => removePill(day, p.label)}>×</span>}
                  </span>
                );
              })}
              <button style={{ background:"none", border:"none", color:C.faint, fontSize:11, cursor:"pointer", textDecoration:"underline", padding:0 }}
                onClick={() => { setPillEditDay(editingPills ? null : day); setNewPillLabel(""); }}>
                {editingPills ? "done" : "+ pills"}
              </button>
            </div>
            {editingPills && (
              <div style={{ background:"#F9FAFB", border:`1px solid ${C.border}`, borderRadius:8, padding:8, marginBottom:8 }}>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
                  {BUILTIN_PILLS.map(l => {
                    const on = pills.some(p => p.label === l);
                    const st = PILL_STYLE[l];
                    return <button key={l} style={{ ...S.btnSm, background:on?st.bg:"#FFF", color:on?st.c:C.muted, border:`1px solid ${on?st.c:C.border}`, fontWeight:on?700:500 }} onClick={() => togglePill(day, l)}>{l}</button>;
                  })}
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <input style={{ ...S.input, flex:1, marginBottom:0, fontSize:12 }} placeholder="Custom label (e.g. Kid's bday)" value={newPillLabel}
                    onChange={e => setNewPillLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addCustomPill(day); }} />
                  <button style={{ ...S.btnSm, background:C.primary, color:"#fff" }} onClick={() => addCustomPill(day)}>Add</button>
                </div>
                <div style={{ fontSize:10, color:C.faint, marginTop:6 }}>easy / grill / special affect suggestions. Custom labels are visual only.</div>
              </div>
            )}
            <input
              style={{ fontSize:12, border:"none", borderBottom:`1px dashed ${C.border}`, outline:"none", background:"transparent", color:(dayNotes||{})[day]?C.warning:C.faint, width:"100%", padding:"2px 0", marginBottom:6, fontStyle:(dayNotes||{})[day]?"normal":"italic" }}
              placeholder="📝 Note for this day (e.g. business trip — takeout)"
              value={(dayNotes||{})[day]||""}
              onChange={e => setDayNotes(prev => ({ ...prev, [day]:e.target.value }))}
            />
            {dayMeals.map((meal, mealIdx) => {
              const isMoving   = moving?.day===day && moving?.mealIdx===mealIdx;
              const isChanging = editing?.day===day && editing?.mealIdx===mealIdx;
              return (
                <div key={mealIdx} style={{ marginTop:6 }}>
                  {isMoving ? (
                    <div>
                      <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Move to:</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {days.filter(d=>d!==day).map(d => <button key={d} style={{ ...S.btnSm, background:C.primaryLight, color:C.primary }} onClick={() => moveMeal(day,mealIdx,d)}>{d}</button>)}
                        <button style={{ ...S.btnSm, background:C.dangerLight, color:C.danger }} onClick={() => setMoving(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : isChanging ? (
                    <MealSearch day={day} mealIdx={mealIdx} />
                  ) : (
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ flex:1, fontWeight:600, fontSize:15 }}>{meal}</div>
                      <button style={{ ...S.btnSm, background:"none", border:`1px solid ${C.border}`, color:C.muted, fontSize:11 }} onClick={() => setMoving({day,mealIdx})}>Move</button>
                      <button style={{ ...S.btnSm, background:"none", border:`1px solid ${C.border}`, color:C.muted, fontSize:11 }} onClick={() => setEditing({day,mealIdx})}>Change</button>
                      <button style={{ background:"none", border:"none", color:C.faint, fontSize:18, cursor:"pointer", padding:"0 4px" }} onClick={() => removeMeal(day,mealIdx)}>×</button>
                    </div>
                  )}
                </div>
              );
            })}
            {isEditingNew ? <MealSearch day={day} /> : (
              <button style={{ background:"none", border:`1.5px dashed ${C.border}`, borderRadius:8, padding:"6px 12px", fontSize:13, cursor:"pointer", color:C.faint, marginTop:8, width:"100%" }} onClick={() => setEditing({day, mealIdx:null})}>
                + Add meal
              </button>
            )}
          </div>
        );
      })}
      {totalMeals > 0 && (
        <div style={{ marginBottom:10 }}>
          <button style={{ ...S.btn, ...S.btnS, marginBottom:draftSms?8:0 }} onClick={textDraftPlan}>{draftCopied ? "✓ Copied — paste into Messages" : "📋 Copy draft plan for family"}</button>
          {draftSms && (
            <div style={{ fontSize:12, color:C.muted }}>
              <div style={{ marginBottom:6, color:C.verified, fontWeight:600 }}>✓ Copied — paste into Messages:</div>
              <textarea readOnly value={draftSms} onFocus={e => e.target.select()} style={{ ...S.input, height:120, fontSize:12, resize:"none", marginBottom:0, fontFamily:"inherit" }} />
            </div>
          )}
        </div>
      )}
      <button style={{ ...S.btn, ...S.btnP }} onClick={onNext} disabled={totalMeals===0}>Looks good</button>
    </div>
  );
}

function PlanInventory({ checkedIds, setCheckedIds, stapleFlags, setStapleFlags, quantities, setQuantities, mealPlan, meals, ingredients, onNext, days, cartIngredientIds = [], onChangeItemTier }) {
  const [locIdx, setLocIdx] = useState(0);
  const [moverId, setMoverId] = useState(null); // id of item whose tier picker is open
  const LOCS    = INVENTORY_LOCS;
  const loc     = LOCS[locIdx];
  const prompts = { Pantry:"Open your pantry.", Fridge:"Open the fridge.", Freezer:"Open the freezer.", Garage:"Check the garage freezer / storage.", Cabinet:"Check the spice cabinet.", "Medicine Cabinet":"Check the medicine cabinet.", Other:"Check other storage." };

  const plannedNames   = Object.values(mealPlan).flat();
  const plannedMealIds = meals.filter(m => plannedNames.includes(m.name)).map(m => m.id);
  const mealIngIds     = new Set(meals.filter(m => plannedMealIds.includes(m.id)).flatMap(m => m.ingredients||[]));
  const inPrep         = new Set(cartIngredientIds);
  const locIngs        = ingredients.filter(i => i.storageLocation === loc);
  const alwaysHere     = locIngs.filter(i => i.tier === "always");
  // Staples split by consumption rate. Unset stapleType defaults to "weekly"
  // (the careful-check bias), so older items and saved DBs keep working.
  const stapleAll      = locIngs.filter(i => i.tier === "staple");
  const weeklyHere     = stapleAll.filter(i => (i.stapleType || "weekly") === "weekly");
  // Slow staples normally coast on a quick scan — UNLESS one is needed for a meal
  // planned this week, in which case it earns the same rigor as a weekly staple.
  const slowAll        = stapleAll.filter(i => (i.stapleType || "weekly") === "slow");
  const slowNeededHere = slowAll.filter(i => mealIngIds.has(i.id));
  const slowHere       = slowAll.filter(i => !mealIngIds.has(i.id));
  // Specialty items show if a planned meal needs them — OR if they've been marked
  // "in cart" during prep (so an off-plan purchase like whole milk still appears
  // here, flagged as In cart, rather than vanishing from the inventory view).
  const mealHere       = locIngs.filter(i => i.tier === "specialty" && (mealIngIds.has(i.id) || inPrep.has(i.id)));

  const toggleChecked = id => setCheckedIds(prev => prev.includes(id) ? prev.filter(x => x!==id) : [...prev, id]);
  const multiMeal = multiMealCounts(mealPlan, meals);

  // ingredient id -> names of planned meals that use it (for context on promoted rows)
  const usedByMeal = {};
  meals.filter(m => plannedMealIds.includes(m.id)).forEach(m => {
    (m.ingredients||[]).forEach(id => { (usedByMeal[id] = usedByMeal[id] || []).push(m.name); });
  });

  // Inline per-week quantity editor. Shows the override if set, else the item's
  // defaultQuantity as the starting value. Writes only to the plan's quantities
  // map — never touches the item's defaultQuantity.
  const QtyEdit = ({ ing }) => {
    const override = quantities[ing.id];
    const effective = override !== undefined ? override : (ing.defaultQuantity || "");
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(effective);
    const isCustom = override !== undefined && override !== (ing.defaultQuantity || "");
    if (editing) {
      const commit = () => {
        const v = val.trim();
        setQuantities(prev => {
          const next = { ...prev };
          if (v === "" || v === (ing.defaultQuantity || "")) delete next[ing.id];
          else next[ing.id] = v;
          return next;
        });
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

  // Subtle per-item affordance to fix a misfiled item's tier without leaving the
  // flow. Collapsed to a small link; tap to reveal the full tier picker, which
  // persists the change so the item re-sections live and stays fixed everywhere.
  const TierMover = ({ ing }) => {
    const open = moverId === ing.id;
    if (!onChangeItemTier) return null;
    if (!open) return (
      <button style={{ background:"none", border:"none", color:C.faint, fontSize:11, cursor:"pointer", padding:"2px 4px", whiteSpace:"nowrap" }} onClick={() => setMoverId(ing.id)}>⋯ move</button>
    );
    return (
      <div style={{ display:"flex", flexWrap:"wrap", gap:4, justifyContent:"flex-end", maxWidth:200 }}>
        {tierOptions().map(o => {
          const active = tierValueOf(ing) === o.value;
          return (
            <button key={o.value} style={{ ...S.btnSm, padding:"3px 7px", fontSize:10, background:active?C.primary:"#F3F4F6", color:active?"#fff":C.muted }}
              onClick={() => { onChangeItemTier(ing.id, o.tier, o.subtype); setMoverId(null); }}>{o.label}</button>
          );
        })}
        <button style={{ ...S.btnSm, padding:"3px 7px", fontSize:10, background:"none", color:C.faint }} onClick={() => setMoverId(null)}>✕</button>
      </div>
    );
  };

  const StapleRow = ({ ing, accent }) => {
    const flagged = inPrep.has(ing.id);
    // 1 meal -> name context line; 2+ meals -> the ×N badge above (never both)
    const usedBy  = !multiMeal[ing.id] && (usedByMeal[ing.id] || []).length === 1 ? usedByMeal[ing.id] : [];
    return (
      <div key={ing.id} style={{ display:"flex", alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${C.border}`, gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:500 }}>{ing.name}{multiMeal[ing.id] && <span style={{ marginLeft:6, fontSize:11, fontWeight:700, color:"#B45309", background:"#FEF3C7", borderRadius:5, padding:"1px 5px" }}>×{multiMeal[ing.id]} meals</span>}</div>
          {usedBy.length > 0 && <div style={{ fontSize:11, color:accent, fontWeight:600 }}>for {usedBy.join(", ")}</div>}
          {flagged
            ? <div style={{ fontSize:11, color:C.verified, fontWeight:600 }}>✓ In cart</div>
            : <div style={{ fontSize:11, color:stapleFlags[ing.id]?accent:C.faint }}>{stapleFlags[ing.id]?"Adding to list":"Have enough"}</div>}
        </div>
        <QtyEdit ing={ing} />
        <TierMover ing={ing} />
        {moverId !== ing.id && <Toggle value={!!stapleFlags[ing.id]} onChange={v => setStapleFlags(prev => ({...prev,[ing.id]:v}))} />}
      </div>
    );
  };

  return (
    <div>
      <div style={S.card}>
        <div style={S.sectionLabel}>Step 3 - Inventory - {loc}</div>
        <div style={S.h2}>{loc}</div>
        <div style={S.sub}>{prompts[loc] || `Check ${loc}.`}</div>
      </div>

      {(alwaysHere.length > 0 || weeklyHere.length > 0 || slowNeededHere.length > 0 || slowHere.length > 0 || mealHere.length > 0) ? (
        <div style={{ ...S.card, padding:"0 16px" }}>
          {alwaysHere.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:C.accent, padding:"10px 0 4px", textTransform:"uppercase", letterSpacing:"0.06em" }}>Always buy — tap to skip for this week</div>
              {alwaysHere.map(ing => {
                const skipped = checkedIds.includes(ing.id);
                return (
                  <div key={ing.id} style={{ display:"flex", alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${C.border}`, gap:8, opacity:skipped?0.5:1, transition:"opacity 0.2s" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:500, textDecoration:skipped?"line-through":"none", color:skipped?C.muted:"inherit" }}>{ing.name}{multiMeal[ing.id] && <span style={{ marginLeft:6, fontSize:11, fontWeight:700, color:"#B45309", background:"#FEF3C7", borderRadius:5, padding:"1px 5px" }}>×{multiMeal[ing.id]} meals</span>}</div>
                      {!multiMeal[ing.id] && (usedByMeal[ing.id]||[]).length === 1 && <div style={{ fontSize:11, color:C.accent, fontWeight:600 }}>for {usedByMeal[ing.id][0]}</div>}
                      {inPrep.has(ing.id) && <div style={{ fontSize:11, color:C.verified, fontWeight:600 }}>✓ In cart</div>}
                    </div>
                    {!skipped && <QtyEdit ing={ing} />}
                    <TierMover ing={ing} />
                    {moverId !== ing.id && (
                      <button
                        onClick={() => setCheckedIds(prev => skipped ? prev.filter(id => id !== ing.id) : [...prev, ing.id])}
                        style={{ border:"none", background:"none", cursor:"pointer", fontSize:12, fontWeight:600, padding:"4px 6px", color:skipped?C.faint:C.accent, whiteSpace:"nowrap" }}>
                        {skipped ? "Skipped — tap to add" : "✓ On list"}
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {weeklyHere.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:"#3730A3", padding:"10px 0 4px", textTransform:"uppercase", letterSpacing:"0.06em" }}>Weekly staples — check these closely, they run out fast</div>
              {weeklyHere.map(ing => <StapleRow key={ing.id} ing={ing} accent="#3730A3" />)}
            </>
          )}
          {slowNeededHere.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:C.warning, padding:"14px 0 2px", textTransform:"uppercase", letterSpacing:"0.06em" }}>Slow staples needed this week — check closely</div>
              <div style={{ fontSize:11, color:C.faint, paddingBottom:4 }}>These last a while, but a meal this week uses them — make sure you have enough.</div>
              {slowNeededHere.map(ing => <StapleRow key={ing.id} ing={ing} accent={C.warning} />)}
            </>
          )}
          {slowHere.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, padding:"14px 0 2px", textTransform:"uppercase", letterSpacing:"0.06em" }}>Slow staples — quick scan, usually fine</div>
              <div style={{ fontSize:11, color:C.faint, paddingBottom:4 }}>Only flag if you noticed it low. If you already added it in prep, it's marked below.</div>
              {slowHere.map(ing => <StapleRow key={ing.id} ing={ing} accent={C.primary} />)}
            </>
          )}
          {mealHere.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, padding:"10px 0 4px", textTransform:"uppercase", letterSpacing:"0.06em" }}>Meal ingredients — check if you already have it</div>
              {mealHere.map(ing => {
                const inStock = checkedIds.includes(ing.id);
                return (
                  <div key={ing.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 0", borderBottom:`1px solid ${C.border}`, opacity:inStock?0.4:1, transition:"opacity 0.2s" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, flex:1, minWidth:0, cursor:"pointer" }} onClick={() => toggleChecked(ing.id)}>
                      <div style={S.checkBox(inStock)}>{inStock && "✓"}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:14, textDecoration:inStock?"line-through":"none" }}>{ing.name}{multiMeal[ing.id] && <span style={{ marginLeft:6, fontSize:11, fontWeight:700, color:"#B45309", background:"#FEF3C7", borderRadius:5, padding:"1px 5px" }}>×{multiMeal[ing.id]} meals</span>}</div>
                        {inPrep.has(ing.id)
                          ? <div style={{ fontSize:11, color:C.verified, fontWeight:600 }}>✓ In cart</div>
                          : <div style={{ fontSize:11, color:inStock?C.verified:C.faint }}>{inStock?"Have it — skipping":"Need it — will order"}</div>}
                      </div>
                    </div>
                    <div onClick={e => e.stopPropagation()} style={{ display:"flex", alignItems:"center", gap:8 }}><QtyEdit ing={ing} /><TierMover ing={ing} /></div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      ) : (
        <div style={{ ...S.card, textAlign:"center", color:C.faint, padding:24 }}>No items stored here</div>
      )}

      <div style={{ display:"flex", gap:10 }}>
        {locIdx > 0 && <button style={{ ...S.btn, ...S.btnS, flex:1, marginBottom:0 }} onClick={() => setLocIdx(l=>l-1)}>Back</button>}
        {locIdx < LOCS.length-1
          ? <button style={{ ...S.btn, ...S.btnP, flex:1, marginBottom:0, marginTop:10 }} onClick={() => setLocIdx(l=>l+1)}>Next: {LOCS[locIdx+1]}</button>
          : <button style={{ ...S.btn, ...S.btnP, flex:1, marginBottom:0, marginTop:10 }} onClick={onNext}>Build my list</button>
        }
      </div>
      <div style={{ display:"flex", gap:6, marginTop:12, flexWrap:"wrap" }}>
        {LOCS.map((l, i) => (
          <button key={l} onClick={() => setLocIdx(i)} style={{ padding:"4px 10px", borderRadius:20, border:"none", fontSize:12, fontWeight:600, cursor:"pointer", background:i===locIdx?C.primary:i<locIdx?"#B8E8CA":"#EEE", color:i===locIdx?"#fff":i<locIdx?C.primary:"#888" }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function PlanConfirm({ mode = "confirm", checkedIds, stapleFlags, quantities = {}, setQuantities, mealPlan, meals, ingredients, onNext, onFinish, db, persistDB, days, daysFull }) {
  const [removed, setRemoved]   = useState(new Set());
  const [added, setAdded]       = useState([]);
  const [newItem, setNewItem]   = useState("");
  const [total, setTotal]       = useState("");
  const [view, setView]         = useState("meal");
  const [copied, setCopied]     = useState(false);
  const [batchIdx, setBatchIdx] = useState(0); // which batch is "current" in the stepper
  const [batchCopied, setBatchCopied] = useState(null); // index of the batch just copied
  const [manualBatch, setManualBatch] = useState(null); // { idx, text } when clipboard fails
  const [framed, setFramed] = useState(true); // prepend the Sparky instruction header
  const [reconcileCopied, setReconcileCopied] = useState(false);
  const [sharedSparkyCopied, setSharedSparkyCopied] = useState(false);

  const activePlan         = getActivePlan(db);
  const cartIngredientIds = activePlan?.cartIngredientIds || [];
  const cartItems         = activePlan?.cartItems || [];
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
  const mealNeeded    = dedup(ingredients.filter(i => mealIngIds.has(i.id) && i.tier==="specialty" && !checkedIds.includes(i.id)));
  const allNeeded     = [...alwaysNeeded, ...stapleNeeded, ...mealNeeded];
  // Authoritative set of what's actually being ordered. Every view (by-meal,
  // flat, copy, save) filters against this so they can't disagree. A staple
  // toggled "have enough" is absent here, so it won't show under a meal that
  // uses it — the inventory judgment wins.
  const orderingIds   = new Set(allNeeded.map(i => i.id));
  const activeCount   = allNeeded.filter(i => !removed.has(i.id) && !cartIngredientIds.includes(i.id)).length + added.length;

  // Shared ingredients = EVERY multi-meal item this week, regardless of status.
  // This deliberately INCLUDES in-stock and in-cart items — those are the dangerous
  // ones: "I already have it / already bought it" is exactly the thought that makes
  // you forget one package has to cover 3 meals. Each is tagged with its status so
  // the checklist tells you what to actually verify. Sorted most-shared first.
  const sharedItems = Object.keys(multiMeal)
    .map(id => {
      const ing = ingredients.find(i => i.id === id);
      if (!ing) return null;
      const status = cartIngredientIds.includes(id) ? "in cart"
                   : checkedIds.includes(id)        ? "in stock"
                   : "ordering";
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

  const budget = db.settings?.budgetLimit || 250;
  const isOver = parseFloat(total) > budget;

  // Sparky (Walmart's chatbot) batches inputs into ~10 items per paste, so we
  // chunk into batches of 10 to paste sequentially. Quantity is kept on each
  // line as a reference for you while selecting amounts.
  const BATCH_SIZE = 10;
  const listLines = (() => {
    const lines = [];
    allNeeded.filter(i => !removed.has(i.id) && !cartIngredientIds.includes(i.id)).forEach(i => {
      const q = quantities[i.id] !== undefined ? quantities[i.id] : (i.defaultQuantity || "");
      lines.push(q ? `${i.name} — ${q}` : i.name);
    });
    added.forEach(i => lines.push(i));
    return lines;
  })();
  const batches = [];
  for (let i = 0; i < listLines.length; i += BATCH_SIZE) batches.push(listLines.slice(i, i + BATCH_SIZE));

  // The full Sparky instructions, copied ONCE on their own (Sparky has a
  // character limit, so repeating this on every batch is too verbose). Paste
  // this first, then paste each numbered batch after.
  const introText = batches.length > 1
    ? `I'm going to paste my grocery list in ${batches.length} numbered parts. For each part: add every numbered item to my cart, treat each line as a separate item, and do not skip, merge, or substitute. If you can't find an exact match, add the closest option and tell me — don't silently leave anything out. After the last part, list everything you added across all parts and name any you could not.`
    : `I'm going to paste my grocery list below. Add every numbered item to my cart, treat each line as a separate item, and do not skip, merge, or substitute. If you can't find an exact match, add the closest option and tell me — don't silently leave anything out. After adding, list back what you added and name any you could not.`;

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

  const reconcilePrompt = "Now list back every item you added to my cart, numbered. Then tell me which items from what I pasted you did NOT add, and why.";

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
      : { weekOf:today, weekStartDate:today, notes:"", cartItems:[], cartIngredientIds:[], dismissedShared:[], meals:mealPlan, items:listItems };
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
    const isRemoved = removed.has(ing.id);
    const inCart    = cartIngredientIds.includes(ing.id);
    return (
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 0", borderBottom:`1px solid ${C.border}`, opacity:(isRemoved||inCart)?0.4:1 }}>
        <div style={{ ...S.checkBox(isRemoved||inCart), background:(isRemoved||inCart)?"#CCC":"#fff", border:(isRemoved||inCart)?"none":`2px solid ${C.border}`, color:"#888" }}
          onClick={() => { if(!inCart) setRemoved(prev => { const n=new Set(prev); n.has(ing.id)?n.delete(ing.id):n.add(ing.id); return n; }); }}>
          {(isRemoved||inCart) && "✓"}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, textDecoration:(isRemoved||inCart)?"line-through":"none" }}>{ing.name}</div>
          {inCart && <div style={{ fontSize:11, color:C.verified, fontWeight:600 }}>Already in cart</div>}
        </div>
        {!inCart && !isRemoved && <QtyChip ing={ing} />}
      </div>
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

      {sharedItems.length > 0 && (
        <div style={S.card}>
          <div style={{ fontSize:12, fontWeight:700, color:"#B45309", marginBottom:4 }}>⚠ Used across multiple meals</div>
          <div style={{ fontSize:12, color:C.muted, marginBottom:8, lineHeight:1.4 }}>
            Each feeds several meals — including ones you have or already bought. Easy to under-buy when you've mentally checked it off. Tap any you know are fine (like butter) to cross them off.
          </div>
          <div style={{ background:"#FEF9EF", border:`1px solid #FCE7C3`, borderRadius:8, padding:"8px 10px" }}>
            {sharedItems.map(s => {
              const sc = s.status === "in cart" ? C.verified : s.status === "in stock" ? C.muted : "#B45309";
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

      <div style={S.card}>
        <div style={S.sectionLabel}>Budget</div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:18 }}>$</span>
          <input style={{ ...S.input, flex:1 }} type="number" placeholder={`Enter cart total (limit $${budget})`} value={total} onChange={e => setTotal(e.target.value)} />
        </div>
        {isOver && <div style={{ background:C.dangerLight, borderRadius:8, padding:"10px 12px", marginTop:8, fontSize:13, color:C.danger, fontWeight:600 }}>${(parseFloat(total)-budget).toFixed(2)} over — tap items to remove</div>}
        {total && !isOver && <div style={{ background:C.primaryLight, borderRadius:8, padding:"10px 12px", marginTop:8, fontSize:13, color:C.primary, fontWeight:600 }}>Under budget by ${(budget-parseFloat(total)).toFixed(2)}</div>}
      </div>

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
        </>
      ) : (
        <div style={{ ...S.card, padding:"0 16px" }}>
          <div style={{ fontSize:11, color:C.faint, padding:"10px 0 6px", borderBottom:`1px solid ${C.border}` }}>All {activeCount} items in one list · tap a quantity to adjust for this week</div>
          {allNeeded.map(i => {
            const isRemoved = removed.has(i.id);
            const inCart = cartIngredientIds.includes(i.id);
            const tc = TIER_COLORS[i.tier] || {};
            return (
              <div key={i.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 0", borderBottom:`1px solid ${C.border}`, opacity:(isRemoved||inCart)?0.4:1 }}>
                <div style={{ ...S.checkBox(isRemoved||inCart), background:(isRemoved||inCart)?"#CCC":"#fff", border:(isRemoved||inCart)?"none":`2px solid ${C.border}`, color:"#888" }}
                  onClick={() => { if(!inCart) setRemoved(prev => { const n=new Set(prev); n.has(i.id)?n.delete(i.id):n.add(i.id); return n; }); }}>
                  {(isRemoved||inCart) && "✓"}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, textDecoration:(isRemoved||inCart)?"line-through":"none" }}>{i.name}</div>
                  <span style={S.badge(tc.color, tc.bg)}>{i.tier}</span>
                  {multiMeal[i.id] && <span style={{ fontSize:11, fontWeight:700, color:"#B45309", background:"#FEF3C7", borderRadius:5, padding:"1px 5px", marginLeft:4 }}>×{multiMeal[i.id]} meals</span>}
                  {inCart && <span style={{ fontSize:11, color:C.verified, fontWeight:600, marginLeft:4 }}>in cart</span>}
                </div>
                {!inCart && !isRemoved && <QtyChip ing={i} />}
              </div>
            );
          })}
          {added.map((item, idx) => (
            <div key={idx} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 0", borderBottom:`1px solid ${C.border}` }}>
              <div style={{ ...S.checkBox(false), border:`2px solid ${C.border}`, color:"#888" }} />
              <div style={{ flex:1, fontSize:14 }}>{item} <span style={{ fontSize:11, color:C.faint }}>(added)</span></div>
            </div>
          ))}
          {allNeeded.length===0 && added.length===0 && <div style={{ textAlign:"center", color:C.faint, padding:24 }}>No items — add ingredients to meals in Manage tab</div>}
        </div>
      )}

      <div style={S.card}>
        <div style={S.sectionLabel}>Add item</div>
        <div style={{ display:"flex", gap:8 }}>
          <input style={{ ...S.input, flex:1 }} placeholder="Type item name..." value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if(e.key==="Enter"&&newItem.trim()){ setAdded(prev=>[...prev,newItem.trim()]); setNewItem(""); } }} />
          <button style={{ ...S.btn, ...S.btnP, width:"auto", padding:"11px 16px", marginBottom:0 }} onClick={() => { if(newItem.trim()){ setAdded(prev=>[...prev,newItem.trim()]); setNewItem(""); } }}>Add</button>
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

        <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${C.border}` }}>
          <div style={{ fontSize:12, color:C.muted, marginBottom:6, lineHeight:1.4 }}>After pasting {batches.length > 1 ? "all batches" : "the list"}, send this to catch anything Sparky missed:</div>
          <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={() => { const ok = copyText(reconcilePrompt); setReconcileCopied(true); setTimeout(()=>setReconcileCopied(false),2000); if(!ok) setManualBatch({ idx:-1, text:reconcilePrompt }); }}>
            {reconcileCopied ? "✓ Copied!" : "Copy “what did you miss?” prompt"}
          </button>
        </div>

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


// ── MANAGE TAB ─────────────────────────────────────────────────────────────────

function ManageTab({ db, persistDB, initialSub }) {
  // ManageTab is unmounted/remounted on every tab switch (App only renders it
  // while tab==="manage"), so a caller can land the user on a specific
  // sub-tab (e.g. the header's Import action → Config) just by setting this
  // prop before switching tab — no lifted state needed.
  const [sub, setSub] = useState(initialSub || "meals");
  const SUBS = [{id:"meals",label:"Meals"},{id:"items",label:"Items"},{id:"upload",label:"Upload"},{id:"config",label:"Config"},{id:"help",label:"Help"}];
  return (
    <div>
      <div style={{ background:C.primary, padding:"0 16px", position:"sticky", top:52, zIndex:8 }}>
        <div style={{ display:"flex" }}>
          {SUBS.map(s => <button key={s.id} style={S.tab(sub===s.id)} onClick={() => setSub(s.id)}>{s.label}</button>)}
        </div>
      </div>
      {sub==="meals"  && <ManageMeals  db={db} persistDB={persistDB} />}
      {sub==="items"  && <ManageItems  db={db} persistDB={persistDB} />}
      {sub==="upload" && <ManageUpload db={db} persistDB={persistDB} />}
      {sub==="config" && <ManageConfig db={db} persistDB={persistDB} />}
      {sub==="help"   && <ManageHelp />}
    </div>
  );
}

// ── Help / how it works ────────────────────────────────────────────────────────
// Compact in-app reference. Deliberately covers MECHANISM and CONSEQUENCES only —
// what a choice does and what follows from it. Design rationale lives in the
// external reference doc, so this stays short enough to keep accurate.

const HELP_SECTIONS = [
  { t:"What gets auto-suggested", body:[
    "Only meals with type **dinner**. Sides, remix, batch, and takeout are never suggested — you add them by hand.",
    "Also excluded: meals Partner dislikes on days she's home, involved meals on **easy** days, and grillable meals on days without a **grill** pill.",
    "Everything else stays possible. Weights only change how *likely* a meal is, never whether it can appear.",
  ]},
  { t:"Day pills", body:[
    "**easy** — excludes involved meals.",
    "**grill** — lets grillable meals appear (they're gated out otherwise) and boosts them.",
    "**special** — favors higher-effort and well-liked meals.",
    "Custom labels (e.g. \"Kid's bday\") are visual only — no effect on suggestions.",
    "Pills auto-fill once per plan from the effort map and forecast (grill = 70°F+ and ≤35% rain). After that your edits always win — removing a pill sticks.",
  ]},
  { t:"Why isn't a meal showing up?", body:[
    "It's not type **dinner** → only dinners auto-suggest.",
    "It's grillable but the day has no **grill** pill → grillables are gated to grill days.",
    "It's involved and the day is **easy** → involved meals are excluded there.",
    "Partner dislikes it and she's home that day.",
    "You had it recently → recent meals are heavily down-weighted (not banned).",
  ]},
  { t:"Meal attributes", body:[
    "**Day feel** (comfort / neutral / light) nudges toward comfort on cold days, light on hot. A soft lean, never a filter.",
    "**Grillable** is a hard gate — the meal only appears on grill days.",
    "**Likes** are a soft boost; **dislikes** (Partner) are a hard gate on days she's home.",
    "**Leftovers** means the meal *produces* extra. A meal *made from* leftovers is type **remix**.",
  ]},
  { t:"Meal list order", body:[
    "Browsing (empty search): sides A–Z, then mains you've cooked least recently, then remix/batch/takeout.",
    "Typing: plain filtered list, so matches stay predictable.",
  ]},
  { t:"Uploading an order to Prep (\"already in cart\")", body:[
    "This reads your placed Walmart order and marks any **matching known ingredients** as already-in-cart, so they drop off the shopping list you're about to make.",
    "Matching is local: an order item matches one of your ingredients only if they share a **distinctive** word (not just a category like \"pasta\" or \"cheese\").",
    "Order items with no matching ingredient — paper towels, medicine, snacks you don't track — are simply **ignored**. They're not added to your ingredient list.",
    "The summary shows how many of your ingredients were marked in cart out of the total items on the order.",
  ]},
  { t:"Marking things you already have", body:[
    "**Inventory step**: checking an item marks it in-stock and drops it from the list. This is the reliable way.",
    "**Prep \"already in cart\" box**: matches your text to a real ingredient. If it matches, the item leaves your list. If not, it's kept as a note only — read the confirmation to see which happened.",
  ]},
  { t:"Reconcile", body:[
    "Reads your placed order with AI, then matches to your list **locally** by word overlap.",
    "Flags: items missing from the order, quantities over 1, and optional items over $5.",
    "Local matching can occasionally miss a real match, showing a false \"missing\" flag. A quick glance is cheaper than the whole check failing.",
  ]},
  { t:"Weekly refresh", body:[
    "Calendar notes and the forecast are baked in per week. The reminder turns amber once the week passes — that's the cue to ask Claude to refresh.",
    "Day notes auto-fill when a new plan starts, so a plan never begins blank.",
  ]},
  { t:"Family messages & data", body:[
    "All comms buttons **copy** the message — iOS blocks app-launching links from in here. Paste into Messages yourself.",
    "**Start new week** archives meals to history (which powers the recency down-weight), clears the plan, and keeps the Walmart cart.",
    "Import accepts .json or .txt — it validates on content, not the file extension.",
  ]},
];

// Renders **bold** spans in the help body text.
const HelpText = ({ children }) => (
  <span>{String(children).split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} style={{ color:C.text }}>{part.slice(2,-2)}</strong>
      : <span key={i}>{part}</span>
  )}</span>
);

function ManageHelp() {
  const [open, setOpen] = useState(null);
  return (
    <div style={S.body}>
      <div style={S.card}>
        <div style={S.sectionLabel}>How it works</div>
        <div style={{ fontSize:13, color:C.muted, lineHeight:1.5 }}>
          What each choice does and what follows from it. Tap a topic to expand.
        </div>
      </div>
      <div style={S.cardFlat}>
        {HELP_SECTIONS.map((s, i) => {
          const isOpen = open === i;
          return (
            <div key={s.t} style={{ borderTop: i ? `1px solid ${C.border}` : "none" }}>
              <button style={{ width:"100%", background:"none", border:"none", padding:"12px 2px", textAlign:"left", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", fontSize:14, fontWeight:600, color:C.text }}
                onClick={() => setOpen(isOpen ? null : i)}>
                <span>{s.t}</span>
                <span style={{ color:C.faint, fontSize:16 }}>{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div style={{ paddingBottom:12 }}>
                  {s.body.map((line, j) => (
                    <div key={j} style={{ fontSize:13, color:C.muted, lineHeight:1.55, marginBottom:8, paddingLeft:10, borderLeft:`2px solid ${C.border}` }}>
                      <HelpText>{line}</HelpText>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize:11, color:C.faint, textAlign:"center", padding:"4px 16px 20px" }}>
        A fuller reference (data model, exact weights, sync details) lives in grocery-app-reference.md
      </div>
    </div>
  );
}

// ── Meal editor ────────────────────────────────────────────────────────────────

function MealEditor({ meal, ingredients, onSave, onCancel, onDelete, onAddIngredient, initialName }) {
  const [form, setForm] = useState(meal || { id:"m"+Date.now(), createdAt:new Date().toISOString(), name:toSentenceCase(initialName||""), effort:"medium", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"none", preferences:[], notes:"", ingredients:[] });
  const [ingSearch, setIngSearch]   = useState("");
  const [quickAdd, setQuickAdd]     = useState(false);
  const [quickName, setQuickName]   = useState("");
  const set = (k, v) => setForm(p => ({...p, [k]:v}));

  const toggleIng = id => {
    const adding = !form.ingredients.includes(id);
    set("ingredients", adding ? [...form.ingredients, id] : form.ingredients.filter(i=>i!==id));
    // On add, clear the search so the field is ready for the next item with
    // fewer taps. On uncheck, leave the search intact.
    if (adding) setIngSearch("");
  };
  const getPref   = person => form.preferences.find(x => x.person===person)?.pref || null;
  const togglePref = (person, pref) => {
    const existing = form.preferences.find(p => p.person===person);
    if (existing && existing.pref===pref) set("preferences", form.preferences.filter(p=>p.person!==person));
    else set("preferences", [...form.preferences.filter(p=>p.person!==person), {person,pref}]);
  };

  const sortedIngs = [...ingredients].sort((a, b) => {
    const as=form.ingredients.includes(a.id), bs=form.ingredients.includes(b.id);
    if(as&&!bs) return -1; if(!as&&bs) return 1; return a.name.localeCompare(b.name);
  }).filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase()));

  const doQuickAdd = () => {
    if (!quickName.trim()) return;
    const name   = toSentenceCase(quickName.trim());
    const newIng = { id:"i"+Date.now(), createdAt:new Date().toISOString(), name, storageLocation:"Unassigned", tier:"specialty", optional:false, defaultQuantity:"" };
    onAddIngredient(newIng);
    set("ingredients", [...form.ingredients, newIng.id]);
    setQuickName(""); setQuickAdd(false); setIngSearch("");
  };

  return (
    <div>
      <div style={{ ...S.card, background:C.primary, color:"#fff", marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:700, opacity:0.7, marginBottom:4 }}>{meal?"EDIT MEAL":"NEW MEAL"}</div>
        <div style={{ fontSize:18, fontWeight:700 }}>{form.name||"Untitled"}</div>
      </div>
      <div style={S.card}>
        <FieldGroup label="Meal name"><input style={S.input} value={form.name} onChange={e => set("name", toSentenceCase(e.target.value))} placeholder="e.g. Mexican nite" /></FieldGroup>
        <FieldGroup label="Type"><PillSelect options={MEAL_TYPES} value={form.type} onChange={v => set("type",v)} /></FieldGroup>
        <FieldGroup label="Effort"><PillSelect options={EFFORTS} value={form.effort} onChange={v => set("effort",v)} /></FieldGroup>
        <FieldGroup label="Weather"><PillSelect options={WEATHER_OPTIONS} value={form.weather} onChange={v => set("weather",v)} /></FieldGroup>
        <FieldGroup label="Day feel (affinity)"><PillSelect options={TEMP_AFFINITY_OPTIONS} value={form.tempAffinity || "neutral"} onChange={v => set("tempAffinity",v)} /></FieldGroup>
        <FieldGroup label="Grillable">
          <div style={{ display:"flex", gap:8 }}>
            <button style={{ ...S.btnSm, background:form.grillable?C.primaryLight:"#F3F4F6", color:form.grillable?C.primary:C.muted, fontWeight:form.grillable?700:500 }} onClick={() => set("grillable",true)}>Yes</button>
            <button style={{ ...S.btnSm, background:!form.grillable?C.dangerLight:"#F3F4F6", color:!form.grillable?C.danger:C.muted, fontWeight:!form.grillable?700:500 }} onClick={() => set("grillable",false)}>No</button>
          </div>
        </FieldGroup>
        <FieldGroup label="Leftovers"><PillSelect options={LEFTOVER_OPTIONS} value={form.leftovers} onChange={v => set("leftovers",v)} /></FieldGroup>
        <FieldGroup label="Notes"><input style={S.input} value={form.notes} onChange={e => set("notes",e.target.value)} placeholder="Cooking notes..." /></FieldGroup>
      </div>
      <div style={S.card}>
        <div style={S.sectionLabel}>Family preferences</div>
        {FAMILY_NAMES.map(person => (
          <div key={person} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
            <div style={{ fontWeight:600, fontSize:14 }}>{person}</div>
            <div style={{ display:"flex", gap:6 }}>
              {["likes","dislikes"].map(pref => (
                <button key={pref} style={{ ...S.btnSm, background:getPref(person)===pref?(pref==="likes"?C.primaryLight:C.dangerLight):"#F3F4F6", color:getPref(person)===pref?(pref==="likes"?C.primary:C.danger):C.muted, fontWeight:getPref(person)===pref?700:500 }} onClick={() => togglePref(person,pref)}>
                  {pref==="likes"?"👍 Likes":"👎 Dislikes"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={S.card}>
        <div style={S.sectionLabel}>Ingredients ({form.ingredients.length} selected)</div>
        <SearchBar value={ingSearch} onChange={setIngSearch} placeholder="Search ingredients..." />
        <div style={{ maxHeight:280, overflowY:"auto" }}>
          {sortedIngs.map(ing => {
            const sel = form.ingredients.includes(ing.id);
            return (
              <div key={ing.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
                <div style={{ width:22, height:22, borderRadius:6, border:sel?"none":`2px solid ${C.border}`, background:sel?C.primary:"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:"#fff", fontSize:13, cursor:"pointer" }} onClick={() => toggleIng(ing.id)}>
                  {sel && "✓"}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:500 }}>{ing.name}</div>
                  <div style={{ fontSize:11, color:C.faint }}>{ing.storageLocation} · {ing.tier}</div>
                </div>
              </div>
            );
          })}
          {quickAdd ? (
            <div style={{ padding:"10px 0", borderTop:`1px solid ${C.border}` }}>
              <div style={{ fontSize:12, color:C.muted, marginBottom:6, fontWeight:600 }}>New ingredient:</div>
              <div style={{ display:"flex", gap:8 }}>
                <input autoFocus style={{ ...S.input, flex:1, fontSize:14, padding:"8px 10px" }} placeholder={ingSearch||"e.g. Cream cheese"} value={quickName} onChange={e => setQuickName(e.target.value)} onKeyDown={e => { if(e.key==="Enter") doQuickAdd(); if(e.key==="Escape"){setQuickAdd(false);setQuickName("");} }} />
                <button style={{ ...S.btnSm, background:C.primary, color:"#fff" }} onClick={doQuickAdd}>Add</button>
                <button style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted }} onClick={() => {setQuickAdd(false);setQuickName("");}}>×</button>
              </div>
              <div style={{ fontSize:11, color:C.faint, marginTop:4 }}>Saves as Unassigned — set location in Items tab</div>
            </div>
          ) : (
            <div style={{ padding:"12px 4px", display:"flex", alignItems:"center", gap:8, cursor:"pointer", color:C.primary, fontWeight:600, fontSize:14 }} onClick={() => {setQuickAdd(true);setQuickName(ingSearch);}}>
              <div style={{ width:22, height:22, borderRadius:6, border:`2px dashed ${C.primary}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>+</div>
              {ingSearch ? `Add "${ingSearch}" as new` : "Add new ingredient..."}
            </div>
          )}
        </div>
      </div>
      <button style={{ ...S.btn, ...S.btnP }} onClick={() => onSave(form)}>Save meal</button>
      <button style={{ ...S.btn, ...S.btnS }} onClick={onCancel}>Cancel</button>
      {meal && <div style={{ ...S.btn, ...S.btnD, cursor:"pointer" }} onClick={() => onDelete(meal.id)}>Delete meal</div>}
    </div>
  );
}

function ManageMeals({ db, persistDB }) {
  const [search, setSearch]   = useState("");
  const [filter, setFilter]   = useState("all");
  const [editing, setEditing] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [newMealName, setNewMealName] = useState("");
  const [viewMode, setViewMode] = useState("cards");   // cards | table
  const setMealField = (id, field, value) => persistDB({ ...db, meals: db.meals.map(m => m.id===id ? { ...m, [field]:value } : m) });

  const filtered = db.meals.filter(m => (filter==="all"||m.type===filter) && m.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => new Date(b.createdAt||SEED_TS) - new Date(a.createdAt||SEED_TS));

  const saveMeal = form => { persistDB({...db, meals:editing==="new"?[...db.meals,form]:db.meals.map(m=>m.id===form.id?form:m)}); setEditing(null); };
  const deleteMeal = id => {
    const meal = db.meals.find(m => m.id === id);
    setConfirmDelete({
      message: `Delete "${meal?.name}"?`,
      onConfirm: () => { persistDB({...db, meals:db.meals.filter(m=>m.id!==id)}); setEditing(null); setConfirmDelete(null); }
    });
  };
  const saveMealName = (id, name) => { persistDB({...db, meals:db.meals.map(m=>m.id===id?{...m,name}:m)}); setInlineEdit(null); };
  const addIngredient = newIng => persistDB({...db, ingredients:[...db.ingredients, newIng]});

  if (editing) return (
    <div style={S.body}>
      {confirmDelete && (
        <div style={{ background:C.dangerLight, border:`1px solid ${C.danger}`, borderRadius:10, padding:"12px 14px", marginBottom:10, position:"sticky", top:8, zIndex:30, boxShadow:"0 4px 16px rgba(0,0,0,0.18)" }}>
          <div style={{ fontSize:13, color:C.danger, marginBottom:10 }}>{confirmDelete.message}</div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ ...S.btnSm, background:C.danger, color:"#fff", cursor:"pointer", flex:1, textAlign:"center" }} onClick={confirmDelete.onConfirm}>Yes, delete</div>
            <div style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted, cursor:"pointer", flex:1, textAlign:"center" }} onClick={() => setConfirmDelete(null)}>Cancel</div>
          </div>
        </div>
      )}
      <MealEditor meal={editing==="new"?null:editing} initialName={editing==="new"?newMealName:""} ingredients={db.ingredients} onSave={saveMeal} onCancel={() => { setEditing(null); setConfirmDelete(null); setNewMealName(""); }} onDelete={deleteMeal} onAddIngredient={addIngredient} />
    </div>
  );

  return (
    <div style={S.body}>
      <SearchBar value={search} onChange={setSearch} placeholder="Search meals..." />
      <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
        {["all",...MEAL_TYPES].map(t => <button key={t} style={{ ...S.btnSm, background:filter===t?C.primary:C.surface, color:filter===t?"#fff":C.muted, border:`1px solid ${C.border}` }} onClick={() => setFilter(t)}>{t}</button>)}
        <span style={{ flex:1 }} />
        <button style={{ ...S.btnSm, background:viewMode==="table"?C.accent:C.surface, color:viewMode==="table"?"#fff":C.muted, border:`1px solid ${C.border}` }} onClick={() => setViewMode(viewMode==="table"?"cards":"table")}>{viewMode==="table"?"▤ cards":"▦ table"}</button>
      </div>
      {filtered.length===0 && (
        search.trim()
          ? <div style={{ textAlign:"center", padding:"32px 20px" }}>
              <div style={{ color:C.faint, marginBottom:12 }}>No meals match "{search}".</div>
              <button style={{ ...S.btn, ...S.btnP, display:"inline-block", width:"auto", padding:"11px 18px", marginBottom:0, cursor:"pointer" }}
                onClick={() => { setNewMealName(search); setEditing("new"); }}>
                + Add "{toSentenceCase(search)}" as a new meal
              </button>
            </div>
          : <div style={{ textAlign:"center", padding:"40px 20px", color:C.faint }}>No meals. Tap + to add.</div>
      )}
      {viewMode==="table" && filtered.length>0 && (
        <div style={{ ...S.cardFlat, padding:0, overflow:"hidden" }}>
          <div style={{ display:"flex", padding:"8px 10px", background:"#F3F4F6", fontSize:10, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.04em" }}>
            <div style={{ flex:1 }}>Meal</div>
            <div style={{ width:78, textAlign:"center" }}>Feel</div>
            <div style={{ width:44, textAlign:"center" }}>Grill</div>
            <div style={{ width:60, textAlign:"center" }}>Type</div>
          </div>
          {filtered.map((meal, i) => {
            const aff = meal.tempAffinity || "neutral";
            const affColor = aff==="comfort" ? {c:"#B45309",b:"#FEF3C7"} : aff==="light" ? {c:"#0369A1",b:"#E0F2FE"} : {c:C.muted,b:"#F3F4F6"};
            const cycleAff = () => { const order=["comfort","neutral","light"]; setMealField(meal.id,"tempAffinity",order[(order.indexOf(aff)+1)%3]); };
            const cycleType = () => { const i2=MEAL_TYPES.indexOf(meal.type||"dinner"); setMealField(meal.id,"type",MEAL_TYPES[(i2+1)%MEAL_TYPES.length]); };
            return (
              <div key={meal.id} style={{ display:"flex", alignItems:"center", padding:"7px 10px", borderTop:`1px solid ${C.border}`, fontSize:13 }}>
                <div style={{ flex:1, fontWeight:600, paddingRight:6 }} onClick={() => setEditing(meal)}>{meal.name}</div>
                <div style={{ width:78, textAlign:"center" }}>
                  <button onClick={cycleAff} style={{ ...S.badge(affColor.c,affColor.b), border:"none", cursor:"pointer", width:70 }}>{aff}</button>
                </div>
                <div style={{ width:44, textAlign:"center" }}>
                  <button onClick={() => setMealField(meal.id,"grillable",!meal.grillable)} style={{ border:"none", cursor:"pointer", borderRadius:6, padding:"3px 0", width:36, fontSize:12, fontWeight:700, background:meal.grillable?"#FFEDD5":"#F3F4F6", color:meal.grillable?"#9A3412":C.faint }}>{meal.grillable?"yes":"—"}</button>
                </div>
                <div style={{ width:60, textAlign:"center" }}>
                  <button onClick={cycleType} style={{ ...S.badge(meal.type==="dinner"?C.muted:C.primary, meal.type==="dinner"?"#F3F4F6":C.primaryLight), border:"none", cursor:"pointer", width:56 }}>{meal.type||"dinner"}</button>
                </div>
              </div>
            );
          })}
          <div style={{ padding:"8px 10px", fontSize:11, color:C.faint, borderTop:`1px solid ${C.border}` }}>Tap a tag to cycle it · tap the name to open full editor</div>
        </div>
      )}
      {viewMode==="cards" && (
      <div style={S.cardFlat}>
        {filtered.map((meal, i) => {
          const ec       = EFFORT_COLORS[meal.effort] || {};
          const dislikes = (meal.preferences||[]).filter(p=>p.pref==="dislikes").map(p=>p.person);
          const likes    = (meal.preferences||[]).filter(p=>p.pref==="likes").map(p=>p.person);
          const isInline = inlineEdit?.id===meal.id;
          return (
            <div key={meal.id} style={{ ...S.row, ...(i===filtered.length-1?S.rowLast:{}), cursor:"default" }}>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:3 }}>
                  {isInline ? (
                    <input autoFocus style={{ ...S.input, flex:1, fontSize:15, fontWeight:600, padding:"6px 10px" }} value={inlineEdit.value} onChange={e => setInlineEdit(p=>({...p,value:toSentenceCase(e.target.value)}))} onBlur={() => saveMealName(meal.id,inlineEdit.value)} onKeyDown={e => { if(e.key==="Enter") saveMealName(meal.id,inlineEdit.value); if(e.key==="Escape") setInlineEdit(null); }} />
                  ) : (
                    <>
                      <span style={{ fontWeight:600, fontSize:15 }}>{meal.name}</span>
                      <button style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, padding:"1px 3px", color:C.faint }} onClick={() => setInlineEdit({id:meal.id,value:meal.name})}>✏️</button>
                      <span style={{ flex:1 }} />
                    </>
                  )}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                  <span style={S.badge(ec.color,ec.bg)}>{meal.effort}</span>
                  {meal.tempAffinity==="comfort" && <span style={S.badge("#B45309","#FEF3C7")}>comfort</span>}
                  {meal.tempAffinity==="light"   && <span style={S.badge("#0369A1","#E0F2FE")}>light</span>}
                  {meal.grillable && <span style={S.badge("#9A3412","#FFEDD5")}>grill</span>}
                  {meal.leftovers!=="none" && <span style={S.badge("#374151","#F3F4F6")}>leftovers</span>}
                  {meal.type!=="dinner"    && <span style={S.badge(C.primary,C.primaryLight)}>{meal.type}</span>}
                  {dislikes.length>0 && <span style={S.badge(C.danger,C.dangerLight)}>👎 {dislikes.join(", ")}</span>}
                  {likes.length>0    && <span style={S.badge(C.verified,"#E8F5EE")}>👍 {likes.join(", ")}</span>}
                </div>
                {meal.ingredients?.length>0 && <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>{meal.ingredients.length} ingredients</div>}
              </div>
              <button style={{ background:"none", border:"none", cursor:"pointer", color:C.faint, fontSize:18, padding:"4px" }} onClick={() => setEditing(meal)}>›</button>
            </div>
          );
        })}
      </div>
      )}
      <button style={{ position:"fixed", bottom:80, right:16, background:C.primary, color:"#fff", border:"none", borderRadius:28, padding:"13px 20px", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.25)", zIndex:20 }} onClick={() => { setNewMealName(""); setEditing("new"); }}>+ Meal</button>
    </div>
  );
}

// ── Ingredient editor ──────────────────────────────────────────────────────────

function IngredientEditor({ ingredient, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(ingredient || { id:"i"+Date.now(), createdAt:new Date().toISOString(), name:"", storageLocation:"Pantry", tier:"specialty", optional:false, defaultQuantity:"" });
  const set = (k, v) => setForm(p => ({...p,[k]:v}));
  return (
    <div>
      <div style={{ ...S.card, background:C.primary, color:"#fff", marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:700, opacity:0.7, marginBottom:4 }}>{ingredient?"EDIT ITEM":"NEW ITEM"}</div>
        <div style={{ fontSize:18, fontWeight:700 }}>{form.name||"Untitled"}</div>
      </div>
      <div style={S.card}>
        <FieldGroup label="Name"><input style={S.input} value={form.name} onChange={e => set("name", toSentenceCase(e.target.value))} placeholder="e.g. Pasta sauce (red)" /></FieldGroup>
        <FieldGroup label="Default quantity"><input style={S.input} value={form.defaultQuantity} onChange={e => set("defaultQuantity",e.target.value)} placeholder="e.g. 2 cans, 1 gallon" /></FieldGroup>
      </div>
      <div style={S.card}>
        <FieldGroup label="Where you store it"><PillSelect options={STORAGE_LOCATIONS} value={form.storageLocation} onChange={v => set("storageLocation",v)} /></FieldGroup>
        <FieldGroup label="Tier"><PillSelect options={TIERS} value={form.tier} onChange={v => set("tier",v)} />
          <div style={{ fontSize:12, color:C.faint, marginTop:4 }}>{form.tier==="always"?"Buy every week":form.tier==="staple"?"Keep stocked, add when low":"Only when needed for a meal"}</div>
        </FieldGroup>
        {(TIER_SUBTYPES[form.tier]||[]).length > 0 && (
          <FieldGroup label={`${form.tier.charAt(0).toUpperCase()+form.tier.slice(1)} type`}>
            <PillSelect options={TIER_SUBTYPES[form.tier]} value={form.stapleType || DEFAULT_SUBTYPE(form.tier)} onChange={v => set("stapleType",v)} />
            <div style={{ fontSize:12, color:C.faint, marginTop:4 }}>{(form.stapleType||DEFAULT_SUBTYPE(form.tier))==="weekly"?"Runs out weekly — check closely each shop":"Lasts a while — quick scan, usually fine"}</div>
          </FieldGroup>
        )}
        <FieldGroup label="Optional?">
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <Toggle value={form.optional} onChange={v => set("optional",v)} />
            <span style={{ fontSize:14, color:form.optional?C.muted:C.text }}>{form.optional?"Yes — cut first if over budget":"No"}</span>
          </div>
        </FieldGroup>
      </div>
      <button style={{ ...S.btn, ...S.btnP }} onClick={() => onSave(form)}>Save item</button>
      <button style={{ ...S.btn, ...S.btnS }} onClick={onCancel}>Cancel</button>
      {ingredient && <div style={{ ...S.btn, ...S.btnD, cursor:"pointer" }} onClick={() => onDelete(ingredient.id)}>Delete item</div>}
    </div>
  );
}

// ── Table row (desktop bulk edit) ──────────────────────────────────────────────

function TableRow({ ing, isAlt, onSave, selected, onToggle, onDelete }) {
  const [editField, setEditField] = useState(null);
  const [val, setVal]             = useState("");

  const startEdit = field => { setEditField(field); setVal(ing[field]||""); };
  const commit    = (field, value) => { onSave({...ing,[field]:value}); setEditField(null); };

  const cell = { padding:"8px 12px", borderBottom:`1px solid ${C.border}`, verticalAlign:"middle", background:isAlt?"#FAFAFA":"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" };
  const editCell = field => (
    editField===field
      ? <input autoFocus style={{ width:"100%", boxSizing:"border-box", padding:"4px 8px", borderRadius:6, border:`1.5px solid ${C.primary}`, fontSize:13, outline:"none" }} value={val} onChange={e => setVal(e.target.value)} onBlur={() => commit(field, field==="name"?toSentenceCase(val):val)} onKeyDown={e => { if(e.key==="Enter") commit(field, field==="name"?toSentenceCase(val):val); if(e.key==="Escape") setEditField(null); }} />
      : <span style={{ cursor:"pointer", borderBottom:`1px dashed ${C.border}` }} onClick={() => startEdit(field)}>{ing[field]||<span style={{ color:C.faint, fontStyle:"italic" }}>tap to set</span>}</span>
  );

  return (
    <tr style={{ background:selected ? "#EEF2FF" : (isAlt ? "#FAFAFA" : "#fff") }}>
      <td style={{ ...cell, textAlign:"center", background:selected?"#EEF2FF":undefined }}>
        <input type="checkbox" checked={!!selected} onChange={onToggle} />
      </td>
      <td style={cell}>{editCell("name")}</td>
      <td style={cell}>{editCell("defaultQuantity")}</td>
      <td style={cell}>
        <select style={{ fontSize:12, border:`1px solid ${C.border}`, borderRadius:6, padding:"3px 6px", background:"#fff", cursor:"pointer" }} value={ing.storageLocation} onChange={e => onSave({...ing,storageLocation:e.target.value})}>
          {STORAGE_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </td>
      <td style={cell}>
        <select style={{ fontSize:12, border:`1px solid ${C.border}`, borderRadius:6, padding:"3px 6px", background:"#fff", cursor:"pointer" }} value={tierValueOf(ing)} onChange={e => {
          const opt = tierOptions().find(o => o.value === e.target.value);
          if (opt) onSave({ ...ing, tier:opt.tier, stapleType:opt.subtype || undefined });
        }}>
          {tierOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td style={{ ...cell, textAlign:"center" }}>
        <button style={{ background:"none", border:"none", cursor:"pointer", fontSize:15 }} onClick={() => onSave({...ing,optional:!ing.optional})} title={ing.optional?"Optional":"Required"}>
          {ing.optional?"✓":"—"}
        </button>
      </td>
      <td style={{ ...cell, textAlign:"center" }}>
        <div style={{ cursor:"pointer", color:C.danger, fontSize:16, fontWeight:700 }} onClick={onDelete}>×</div>
      </td>
    </tr>
  );
}

function ManageItems({ db, persistDB }) {
  const [search, setSearch]       = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [filterLoc, setFilterLoc]   = useState("all");
  const [editing, setEditing]     = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null);
  const [quickAdd, setQuickAdd]   = useState(false);
  const [quickName, setQuickName] = useState("");
  const [tableView, setTableView] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // { message, onConfirm }

  const filtered = db.ingredients.filter(i => {
    const ms = i.name.toLowerCase().includes(search.toLowerCase());
    const mt = filterTier==="all" || filterTier===i.tier;
    const ml = filterLoc==="all" || i.storageLocation===filterLoc;
    return ms && mt && ml;
  }).sort((a, b) => new Date(b.createdAt||SEED_TS) - new Date(a.createdAt||SEED_TS));

  const saveIng  = form => { persistDB({...db, ingredients:editing==="new"?[...db.ingredients,form]:db.ingredients.map(i=>i.id===form.id?form:i)}); setEditing(null); };
  const deleteIng = id => {
    const ing = db.ingredients.find(i => i.id === id);
    if (!ing) return;
    const usedInMeals = db.meals.filter(m => (m.ingredients||[]).includes(id)).map(m => m.name);
    const msg = usedInMeals.length > 0
      ? `"${ing.name}" is used in ${usedInMeals.join(", ")}. Deleting removes it from those meals too.`
      : `Delete "${ing.name}"?`;
    setConfirmDelete({
      message: msg,
      onConfirm: () => {
        const ingredients = db.ingredients.filter(i => i.id !== id);
        const meals = db.meals.map(m => ({...m, ingredients:(m.ingredients||[]).filter(i => i !== id)}));
        persistDB(mapBothPlans({...db, ingredients, meals}, p => ({...p, cartIngredientIds:(p.cartIngredientIds||[]).filter(i => i !== id), items:(p.items||[]).filter(i => i.ingredientId !== id)})));
        setEditing(null);
        setConfirmDelete(null);
      }
    });
  };
  const saveInlineIng = (id, field, value) => { persistDB({...db,ingredients:db.ingredients.map(i=>i.id===id?{...i,[field]:value}:i)}); setInlineEdit(null); };
  const doQuickAdd = () => {
    if (!quickName.trim()) return;
    const name = toSentenceCase(quickName.trim());
    persistDB({...db, ingredients:[...db.ingredients, { id:"i"+Date.now(), createdAt:new Date().toISOString(), name, storageLocation:"Unassigned", tier:"specialty", optional:false, defaultQuantity:"" }]});
    setQuickName(""); setQuickAdd(false); setSearch("");
  };

  const toggleSelect = id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll  = () => setSelected(new Set(filtered.map(i => i.id)));
  const selectNone = () => setSelected(new Set());

  const bulkDelete = () => {
    const ids = [...selected];
    const affectedMeals = [...new Set(db.meals.filter(m => (m.ingredients||[]).some(id => ids.includes(id))).map(m => m.name))];
    const msg = affectedMeals.length > 0
      ? `Delete ${ids.length} items? Also removes them from: ${affectedMeals.join(", ")}.`
      : `Delete ${ids.length} selected items?`;
    setConfirmDelete({
      message: msg,
      onConfirm: () => {
        const ingredients = db.ingredients.filter(i => !ids.includes(i.id));
        const meals = db.meals.map(m => ({...m, ingredients:(m.ingredients||[]).filter(id => !ids.includes(id))}));
        persistDB(mapBothPlans({...db, ingredients, meals}, p => ({...p, cartIngredientIds:(p.cartIngredientIds||[]).filter(id => !ids.includes(id)), items:(p.items||[]).filter(i => !ids.includes(i.ingredientId))})));
        setSelected(new Set());
        setConfirmDelete(null);
      }
    });
  };

  if (editing) return (
    <div style={S.body}>
      {confirmDelete && (
        <div style={{ background:C.dangerLight, border:`1px solid ${C.danger}`, borderRadius:10, padding:"12px 14px", marginBottom:10, position:"sticky", top:8, zIndex:30, boxShadow:"0 4px 16px rgba(0,0,0,0.18)" }}>
          <div style={{ fontSize:13, color:C.danger, marginBottom:10, lineHeight:1.5 }}>{confirmDelete.message}</div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ ...S.btnSm, background:C.danger, color:"#fff", cursor:"pointer", flex:1, textAlign:"center" }} onClick={confirmDelete.onConfirm}>Yes, delete</div>
            <div style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted, cursor:"pointer", flex:1, textAlign:"center" }} onClick={() => setConfirmDelete(null)}>Cancel</div>
          </div>
        </div>
      )}
      <IngredientEditor ingredient={editing==="new"?null:editing} onSave={saveIng} onCancel={() => { setEditing(null); setConfirmDelete(null); }} onDelete={deleteIng} />
    </div>
  );

  return (
    <div style={S.body}>
      <div style={{ display:"flex", gap:8, marginBottom:10, alignItems:"center" }}>
        <div style={{ flex:1 }}><SearchBar value={search} onChange={setSearch} placeholder="Search items..." /></div>
        <button style={{ ...S.btnSm, background:tableView?C.primary:C.surface, color:tableView?"#fff":C.muted, border:`1px solid ${C.border}`, flexShrink:0 }} onClick={() => setTableView(v=>!v)}>{tableView?"Card":"Table"}</button>
      </div>

      {quickAdd ? (
        <div style={{ ...S.card, marginBottom:10 }}>
          <div style={{ fontSize:12, color:C.muted, marginBottom:6, fontWeight:600 }}>New item name:</div>
          <div style={{ display:"flex", gap:8 }}>
            <input autoFocus style={{ ...S.input, flex:1, fontSize:14, padding:"8px 10px" }} placeholder={search||"e.g. Aluminum foil"} value={quickName} onChange={e => setQuickName(e.target.value)} onKeyDown={e => { if(e.key==="Enter") doQuickAdd(); if(e.key==="Escape"){setQuickAdd(false);setQuickName("");} }} />
            <button style={{ ...S.btnSm, background:C.primary, color:"#fff" }} onClick={doQuickAdd}>Add</button>
            <button style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted }} onClick={() => {setQuickAdd(false);setQuickName("");}}>×</button>
          </div>
        </div>
      ) : (
        <button style={{ ...S.btn, ...S.btnS, marginBottom:10, fontSize:14 }} onClick={() => {setQuickAdd(true);setQuickName(search);}}>
          {search?`+ Add "${search}" as new item`:"+ Add new item"}
        </button>
      )}

      <div style={{ display:"flex", gap:6, marginBottom:6, flexWrap:"wrap" }}>
        {[["all","All"],...TIERS.map(t=>[t,t])].map(([val,label]) => <button key={val} style={{ ...S.btnSm, background:filterTier===val?C.primary:C.surface, color:filterTier===val?"#fff":C.muted, border:`1px solid ${C.border}` }} onClick={() => setFilterTier(val)}>{label}</button>)}
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
        {["all",...STORAGE_LOCATIONS].map(l => <button key={l} style={{ ...S.btnSm, background:filterLoc===l?C.primary:C.surface, color:filterLoc===l?"#fff":C.muted, border:`1px solid ${C.border}` }} onClick={() => setFilterLoc(l)}>{l}</button>)}
      </div>

      {filtered.length===0 && <div style={{ textAlign:"center", padding:"40px 20px", color:C.faint }}>No items. Tap + to add.</div>}

      {tableView ? (
        <div style={{ marginBottom:80 }}>
          {confirmDelete && (
        <div style={{ background:C.dangerLight, border:`1px solid ${C.danger}`, borderRadius:10, padding:"12px 14px", marginBottom:10 }}>
          <div style={{ fontSize:13, color:C.danger, marginBottom:10, lineHeight:1.5 }}>{confirmDelete.message}</div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ ...S.btnSm, background:C.danger, color:"#fff", cursor:"pointer", flex:1, textAlign:"center" }} onClick={confirmDelete.onConfirm}>Yes, delete</div>
            <div style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted, cursor:"pointer", flex:1, textAlign:"center" }} onClick={() => setConfirmDelete(null)}>Cancel</div>
          </div>
        </div>
      )}
      {selected.size > 0 && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:C.dangerLight, borderRadius:10, padding:"10px 14px", marginBottom:8 }}>
              <span style={{ fontSize:13, color:C.danger, fontWeight:600 }}>{selected.size} item{selected.size > 1 ? "s" : ""} selected</span>
              <div style={{ display:"flex", gap:8 }}>
                <button style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted }} onClick={selectNone}>Clear</button>
                <div style={{ ...S.btnSm, background:C.danger, color:"#fff", cursor:"pointer" }} onClick={bulkDelete}>Delete {selected.size}</div>
              </div>
            </div>
          )}
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, background:C.surface, borderRadius:14, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", tableLayout:"fixed" }}>
            <colgroup>
              <col style={{ width:"5%" }} />
              <col style={{ width:"25%" }} />
              <col style={{ width:"16%" }} />
              <col style={{ width:"20%" }} />
              <col style={{ width:"16%" }} />
              <col style={{ width:"12%" }} />
              <col style={{ width:"6%" }} />
            </colgroup>
            <thead>
              <tr style={{ background:C.primary, color:"#E8F5EE" }}>
                <th style={{ padding:"10px 8px", textAlign:"center" }}>
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={e => e.target.checked ? selectAll() : selectNone()} />
                </th>
                <th style={{ padding:"10px 12px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Name</th>
                <th style={{ padding:"10px 12px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Qty</th>
                <th style={{ padding:"10px 8px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Location</th>
                <th style={{ padding:"10px 8px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Tier</th>
                <th style={{ padding:"10px 8px", textAlign:"center", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Opt?</th>
                <th style={{ padding:"10px 8px", textAlign:"center", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Del</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ing, i) => (
                <TableRow key={ing.id} ing={ing} isAlt={i%2===1} selected={selected.has(ing.id)} onToggle={() => toggleSelect(ing.id)} onSave={updated => persistDB({...db, ingredients:db.ingredients.map(x=>x.id===updated.id?updated:x)})} onDelete={() => deleteIng(ing.id)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={S.cardFlat}>
          {filtered.map((ing, i) => {
            const tc       = TIER_COLORS[ing.tier] || {};
            const isInline = inlineEdit?.id===ing.id && inlineEdit?.field==="name";
            return (
              <div key={ing.id} style={{ ...S.row, ...(i===filtered.length-1?S.rowLast:{}), flexDirection:"column", alignItems:"stretch", gap:5, cursor:"pointer" }} onClick={() => setEditing(ing)}>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  {isInline ? (
                    <input autoFocus style={{ ...S.input, flex:1, fontSize:14, fontWeight:600, padding:"6px 10px" }} value={inlineEdit.value} onChange={e => setInlineEdit(p=>({...p,value:toSentenceCase(e.target.value)}))} onBlur={() => saveInlineIng(ing.id,"name",inlineEdit.value)} onKeyDown={e => { if(e.key==="Enter") saveInlineIng(ing.id,"name",inlineEdit.value); if(e.key==="Escape") setInlineEdit(null); }} onClick={e => e.stopPropagation()} />
                  ) : (
                    <>
                      <span style={{ fontWeight:600, fontSize:15 }}>{ing.name}</span>
                      <button style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, padding:"1px 3px", color:C.faint }} onClick={e => { e.stopPropagation(); setInlineEdit({id:ing.id,field:"name",value:ing.name}); }}>✏️</button>
                      <span style={{ flex:1 }} />
                    </>
                  )}
                  <div style={{ color:C.faint, fontSize:16 }}>›</div>
                </div>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                  <span style={S.badge(tc.color,tc.bg)}>{(TIER_SUBTYPES[ing.tier]||[]).length ? `${ing.tier} · ${ing.stapleType||DEFAULT_SUBTYPE(ing.tier)}` : ing.tier}</span>
                  <span style={S.badge(C.muted,"#F3F4F6")}>{ing.storageLocation}</span>
                  {ing.defaultQuantity && <span style={S.badge(C.muted,"#F3F4F6")}>{ing.defaultQuantity}</span>}
                  {ing.optional && <span style={S.badge(C.muted,"#F3F4F6")}>optional</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button style={{ position:"fixed", bottom:80, right:16, background:C.primary, color:"#fff", border:"none", borderRadius:28, padding:"13px 20px", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.25)", zIndex:20 }} onClick={() => setEditing("new")}>+ Item</button>
    </div>
  );
}

// ── Manage Upload ──────────────────────────────────────────────────────────────

function ManageUpload({ db, persistDB }) {
  const [status, setStatus]         = useState("idle");
  const [phase, setPhase]           = useState("");
  const [summary, setSummary]       = useState(null);
  const [parsedItems, setParsedItems] = useState([]);
  const [decisions, setDecisions]   = useState({});
  const [reviewFilter, setReviewFilter] = useState("all");
  const [editNames, setEditNames] = useState({}); // idx -> edited name
  const fileRef = useRef();

  const analyze = async file => {
    setStatus("analyzing"); setPhase("extracting");
    try {
      const base64 = await new Promise((res,rej) => { const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(file); });
      const isPDF  = file.type==="application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const block  = isPDF ? {type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}} : {type:"image",source:{type:"base64",media_type:file.type,data:base64}};
      const p1 = `This is a Walmart grocery order. Extract every product name and quantity. Return ONLY a JSON array: [{"name":"Tyson Chicken Strips","quantity":"2"}]. No markdown.`;

      const d1 = await (await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1000,messages:[{role:"user",content:[block,{type:"text",text:p1}]}]})})).json();
      if (d1.error) throw new Error("API: " + (d1.error.message || "request rejected"));
      const t1 = d1.content.filter(b=>b.type==="text").map(b=>b.text).join("");
      const s1 = t1.indexOf("["), e1 = t1.lastIndexOf("]");
      if (s1 === -1) throw new Error("No items found in file — try a clearer image or PDF");
      let items;
      try { items = JSON.parse(t1.substring(s1, e1+1)); } catch(pe) { throw new Error("Could not parse item list — response may have been cut off. Try again."); }
      if (!items.length) throw new Error("No items found in file");

      setPhase("matching");
      const ingList  = db.ingredients.map(i=>`${i.id}|||${i.name}`).join("\n");
      const itemList = items.map((it,i)=>`${i}|||${it.name}`).join("\n");
      const p2 = `Match these Walmart items to grocery ingredients by meaning. Only match if clearly the same product. For unmatched items, suggest a short plain name (2-4 words, no brand, no size).\n\nWALMART:\n${itemList}\n\nINGREDIENTS:\n${ingList}\n\nReturn ONLY JSON: [{"idx":0,"matchedId":"i001","cleanName":null},{"idx":1,"matchedId":null,"cleanName":"Toilet paper"}]. No markdown.`;

      const d2 = await (await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1000,messages:[{role:"user",content:p2}]})})).json();
      if (d2.error) throw new Error("API: " + (d2.error.message || "request rejected"));
      const t2      = d2.content.filter(b=>b.type==="text").map(b=>b.text).join("");
      const matches = parseJSONArray(t2);
      const matchMap = {};
      matches.forEach(m => { matchMap[m.idx]=m; });

      const withMatch = items.map((item,idx) => {
        const mid      = matchMap[idx]?.matchedId||null;
        const cleanName = matchMap[idx]?.cleanName||null;
        const ming     = mid ? db.ingredients.find(i=>i.id===mid) : null;
        return {...item, matchedId:mid, matchedName:ming?.name||null, cleanName};
      });
      setParsedItems(withMatch);
      const init = {}, names = {};
      withMatch.forEach((it,i) => { init[i]=it.matchedId?"keep":"add"; if(!it.matchedId) names[i]=it.cleanName||it.name; });
      setDecisions(init);
      setEditNames(names);

      // Reconcile receipt against this week's saved shopping list (ground truth
      // for what we ordered vs. what we intended). Always the plan actually
      // being shopped, never "next".
      const plan       = getCurrentPlan(db);
      const planItems  = (plan?.items || []).filter(li => li.status === "ordering");
      const receiptIds = new Set(withMatch.filter(i => i.matchedId).map(i => i.matchedId));
      const missed     = planItems
        .filter(li => !receiptIds.has(li.ingredientId))
        .map(li => { const ing = db.ingredients.find(x => x.id === li.ingredientId); return { id:li.ingredientId, name:ing?.name || "(unknown item)", quantity:li.quantity || "" }; });
      // Receipt lines with quantity > 1 — flag in case a duplicate slipped in.
      const multiQty   = withMatch
        .map((it, idx) => ({ ...it, idx, qn: parseInt(String(it.quantity).replace(/[^0-9]/g, ""), 10) }))
        .filter(it => it.qn > 1);

      setSummary({
        total:withMatch.length,
        matched:withMatch.filter(i=>i.matchedId).length,
        newCount:withMatch.filter(i=>!i.matchedId).length,
        missed, multiQty,
        hadPlan: planItems.length > 0,
      });
      setPhase(""); setStatus("summary");
    } catch(e) {
      console.error('[Upload]', e);
      setSummary({ error: e.message || 'Unknown error' }); setPhase(""); setStatus("error");
    }
  };

  const apply = () => {
    const ings = [...db.ingredients];
    let added=0, kept=0;
    parsedItems.forEach((item,idx) => {
      const d = decisions[idx];
      if (d==="skip") return;
      if (d==="keep") { kept++; return; }   // already in DB — nothing to change
      if (d==="add") {
        const rawName = (editNames[idx] || item.cleanName || item.name || "").trim();
        const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
        ings.push({ id:"i"+Date.now()+Math.random().toString(36).slice(2,5), createdAt:new Date().toISOString(), name, storageLocation:"Unassigned", tier:"specialty", optional:false, defaultQuantity:item.quantity||"" });
        added++;
      }
    });
    persistDB({...db,ingredients:ings});
    setSummary(prev=>({...prev,applied:{added,kept}}));
    setStatus("done");
  };

  const newCount    = parsedItems.filter((_,i)=>decisions[i]==="add").length;
  const keepCount   = parsedItems.filter((_,i)=>decisions[i]==="keep").length;
  const sortedIdx   = parsedItems.map((_,i)=>i).sort((a,b)=>({keep:0,add:1,skip:2}[decisions[a]]??1)-({keep:0,add:1,skip:2}[decisions[b]]??1));
  const filteredIdx = sortedIdx.filter(idx => {
    if (reviewFilter==="all")     return true;
    if (reviewFilter==="matches") return !!parsedItems[idx].matchedId;
    if (reviewFilter==="new")     return !parsedItems[idx].matchedId && decisions[idx]!=="skip";
    if (reviewFilter==="skipped") return decisions[idx]==="skip";
    return true;
  });

  if (status==="analyzing") return (
    <div style={S.body}>
      <div style={{ ...S.card, textAlign:"center", padding:"40px 20px" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>{phase==="extracting"?"📄":"🔗"}</div>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:6 }}>{phase==="extracting"?"Reading your order...":"Matching to your list..."}</div>
        <div style={{ fontSize:13, color:C.muted }}>{phase==="extracting"?"Extracting item names":"Finding what you already track"}</div>
        <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:16 }}>
          {["extracting","matching"].map(p => <div key={p} style={{ width:8, height:8, borderRadius:"50%", background:phase===p?C.primary:C.border }} />)}
        </div>
      </div>
    </div>
  );

  if (status==="error") return (
    <div style={S.body}>
      <div style={{ ...S.card, textAlign:"center", padding:"32px 20px" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>⚠️</div>
        <div style={{ fontWeight:700, fontSize:16, color:C.danger, marginBottom:8 }}>Upload failed</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:16 }}>{summary?.error}</div>
        <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={() => setStatus("idle")}>Try again</button>
      </div>
    </div>
  );

  if (status==="summary") return (
    <div style={S.body}>
      <div style={{ ...S.card, textAlign:"center", padding:"32px 20px" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
        <div style={{ fontWeight:700, fontSize:20, marginBottom:16 }}>Upload complete</div>
        <div style={{ display:"flex", justifyContent:"center", gap:24, marginBottom:24 }}>
          <div style={{ textAlign:"center" }}><div style={{ fontSize:36, fontWeight:800 }}>{summary.total}</div><div style={{ fontSize:11, color:C.faint, fontWeight:700, textTransform:"uppercase" }}>Found</div></div>
          <div style={{ width:1, background:C.border }} />
          <div style={{ textAlign:"center" }}><div style={{ fontSize:36, fontWeight:800, color:C.primary }}>{summary.matched}</div><div style={{ fontSize:11, color:C.faint, fontWeight:700, textTransform:"uppercase" }}>Matched</div></div>
          <div style={{ width:1, background:C.border }} />
          <div style={{ textAlign:"center" }}><div style={{ fontSize:36, fontWeight:800, color:C.verified }}>{summary.newCount}</div><div style={{ fontSize:11, color:C.faint, fontWeight:700, textTransform:"uppercase" }}>New</div></div>
        </div>
        <button style={{ ...S.btn, ...S.btnP, marginBottom:8 }} onClick={() => setStatus("review")}>Review and approve</button>
        <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={() => setStatus("idle")}>Upload another</button>
      </div>

      {summary.hadPlan && (
        <div style={{ ...S.card, border:`1px solid ${summary.missed.length ? C.danger : C.border}` }}>
          <div style={S.sectionLabel}>Checked against this week's list</div>
          {summary.missed.length === 0 ? (
            <div style={{ fontSize:14, color:C.verified, fontWeight:600 }}>✓ Every item on your list is on the receipt — nothing missed.</div>
          ) : (
            <>
              <div style={{ fontSize:14, color:C.danger, fontWeight:700, marginBottom:6 }}>{summary.missed.length} item{summary.missed.length>1?"s":""} on your list but NOT on the receipt</div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>These may have been forgotten in the order — double-check before you finish. (Based on name matching; an item the scan mis-read may show here even if you did order it.)</div>
              {summary.missed.map(m => (
                <div key={m.id} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:14 }}>{m.name}</span>
                  {m.quantity && <span style={{ fontSize:12, color:C.faint }}>{m.quantity}</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {summary.multiQty && summary.multiQty.length > 0 && (
        <div style={{ ...S.card, border:`1px solid ${C.warning}`, background:C.warningLight }}>
          <div style={{ fontSize:14, color:C.warning, fontWeight:700, marginBottom:6 }}>{summary.multiQty.length} item{summary.multiQty.length>1?"s":""} ordered in quantity &gt; 1</div>
          <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>Make sure none of these are accidental duplicates.</div>
          {summary.multiQty.map(it => (
            <div key={it.idx} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:14 }}>{it.matchedName || it.name}</span>
              <span style={{ fontSize:13, color:C.warning, fontWeight:700 }}>×{it.qn}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (status==="review") return (
    <div style={S.body}>
      <div style={S.card}>
        <div style={S.sectionLabel}>Review imported items</div>
        <div style={{ fontSize:14, color:C.muted, marginBottom:10 }}>{parsedItems.length} items · <span style={{ color:C.primary,fontWeight:700 }}>{keepCount} already tracked</span> · <span style={{ color:C.verified,fontWeight:700 }}>{newCount} new</span></div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[["all","All"],["matches","Matches"],["new","New"],["skipped","Skipped"]].map(([v,l]) => <button key={v} style={{ ...S.btnSm, background:reviewFilter===v?C.primary:"#F3F4F6", color:reviewFilter===v?"#fff":C.muted }} onClick={() => setReviewFilter(v)}>{l}</button>)}
        </div>
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
        <button style={{ ...S.btnSm, flex:1, background:C.primaryLight, color:C.primary }} onClick={() => { const d={...decisions}; parsedItems.forEach((_,i)=>{ if(!parsedItems[i].matchedId) d[i]="add"; }); setDecisions(d); }}>Keep all new</button>
        <button style={{ ...S.btnSm, flex:1, background:"#F3F4F6", color:C.muted }} onClick={() => { const d={...decisions}; parsedItems.forEach((_,i)=>{ if(!parsedItems[i].matchedId) d[i]="skip"; }); setDecisions(d); }}>Skip all new</button>
      </div>
      <div style={S.cardFlat}>
        {filteredIdx.map((idx,i) => {
          const item=parsedItems[idx], d=decisions[idx];
          return (
            <div key={idx} style={{ ...S.row, ...(i===filteredIdx.length-1?S.rowLast:{}), flexDirection:"column", alignItems:"flex-start", gap:6, opacity:d==="skip"?0.45:1 }}>
              <div style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, fontSize:14 }}>{item.name}</div>
                  {item.matchedName && <div style={{ fontSize:12, color:C.primary, marginTop:1 }}>matches: {item.matchedName}</div>}
                  {!item.matchedId && d==="add" && (
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
                      <span style={{ fontSize:11, color:C.verified, flexShrink:0 }}>Save as:</span>
                      <input
                        style={{ fontSize:12, padding:"2px 8px", borderRadius:6, border:`1.5px solid ${C.verified}`, outline:"none", flex:1, color:C.text, background:"#F0FAF4" }}
                        value={editNames[idx]||""}
                        onChange={e => setEditNames(prev => ({...prev,[idx]:e.target.value}))}
                      />
                    </div>
                  )}
                  {item.quantity   && <div style={{ fontSize:12, color:C.faint }}>Qty: {item.quantity}</div>}
                </div>
              </div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {item.matchedId && <button style={{ ...S.btnSm, background:d==="keep"?C.primaryLight:"#F3F4F6", color:d==="keep"?C.primary:C.muted, fontWeight:d==="keep"?700:500 }} onClick={() => setDecisions(p=>({...p,[idx]:"keep"}))}>Keep as is</button>}
                <button style={{ ...S.btnSm, background:d==="add"?"#E8F5EE":"#F3F4F6", color:d==="add"?C.verified:C.muted, fontWeight:d==="add"?700:500 }} onClick={() => setDecisions(p=>({...p,[idx]:"add"}))}>Add as new</button>
                {!item.matchedId && <button style={{ ...S.btnSm, background:d==="skip"?C.dangerLight:"#F3F4F6", color:d==="skip"?C.danger:C.muted, fontWeight:d==="skip"?700:500 }} onClick={() => setDecisions(p=>({...p,[idx]:"skip"}))}>Skip</button>}
              </div>
            </div>
          );
        })}
      </div>
      <button style={{ ...S.btn, ...S.btnP }} onClick={apply}>{newCount>0 ? `Add ${newCount} new item${newCount>1?"s":""}` : "Done reviewing"}</button>
      <button style={{ ...S.btn, ...S.btnS }} onClick={() => setStatus("idle")}>Upload another</button>
    </div>
  );

  if (status==="done") return (
    <div style={S.body}>
      <div style={{ ...S.card, textAlign:"center", padding:"40px 20px" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>✅</div>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Item list updated</div>
        {summary?.applied && <div style={{ fontSize:13, color:C.muted, marginBottom:8 }}>{summary.applied.added} added · {summary.applied.kept} already tracked</div>}
        <button style={{ ...S.btn, ...S.btnS, marginTop:16, marginBottom:0 }} onClick={() => setStatus("idle")}>Upload another</button>
      </div>
    </div>
  );

  return (
    <div style={S.body}>
      <div style={S.card}>
        <div style={S.sectionLabel}>Past order import</div>
        <div style={S.h2}>Upload a Walmart order</div>
        <div style={S.sub}>Upload a screenshot or PDF of a past Walmart order. AI reads item names and adds anything new to your ingredient list.</div>
        <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display:"none" }} onChange={e => e.target.files[0] && analyze(e.target.files[0])} />
        <button style={{ ...S.btn, ...S.btnP, marginBottom:0 }} onClick={() => fileRef.current.click()}>Choose screenshot or PDF</button>
      </div>
      <div style={S.card}>
        <div style={{ fontWeight:700, fontSize:15 }}>Item list</div>
        <div style={{ fontSize:13, color:C.muted, marginTop:2 }}>{db.ingredients.length} items in database</div>
      </div>
    </div>
  );
}

// ── Manage Config ──────────────────────────────────────────────────────────────

// "Aug 8, 2:14pm" style label for an ISO timestamp, used in the import
// confirmation and nowhere else — the header's own "as of" formatting
// (layer 3) may want the same shape; keep in sync if so.
const formatAsOf = iso => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }).replace(" AM","am").replace(" PM","pm");
};

function ManageConfig({ db, persistDB }) {
  const upd = (k, v) => persistDB({...db, settings:{...db.settings,[k]:v}});
  const fileRef = useRef();
  const [showExport, setShowExport]     = useState(false);
  const [pasteText, setPasteText]       = useState("");
  const [importError, setImportError]   = useState("");
  const [importSuccess, setImportSuccess] = useState(null); // { meals, items, asOf }
  const [copied, setCopied]             = useState(false);
  // Pure-JSON export: _meta summary + fresh published menu + full db, no
  // prepended text header. Valid JSON from byte one so the Shortcut parses it.
  const exportDB   = buildExportDB(db);
  const exportJSON = JSON.stringify(exportDB, null, 2);

  const downloadDB = () => downloadBackup(db, persistDB);

  const copyExport = () => {
    const { now, text } = buildBackupPayload(db);
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    persistDB({ ...db, lastExportedAt: now }, { background: true });
  };

  // Shared by file-import and paste-import: validates, clears _isSeed (this
  // is real external data, not the seed set), and surfaces a specific
  // confirmation (counts + as-of from the imported _meta.dataChangedAt)
  // instead of a bare "Imported!" alert.
  const applyImport = imp => {
    if (!imp.meals || !imp.ingredients) throw new Error("Invalid format");
    const asOf = imp._meta?.dataChangedAt || null;
    const parsed = { ...stripExportNodes(imp), _isSeed: false };
    persistDB(parsed);
    setImportSuccess({ meals: parsed.meals.length, items: parsed.ingredients.length, asOf });
  };

  const importDB = file => {
    const r = new FileReader();
    r.onload = e => {
      try { applyImport(JSON.parse(e.target.result)); }
      catch(err) { alert("Could not import: " + err.message); }
    };
    r.readAsText(file);
  };

  const importFromPaste = () => {
    try {
      applyImport(JSON.parse(extractJSON(pasteText)));
      setPasteText(""); setImportError("");
    } catch(e) { setImportError("Could not parse: " + e.message); }
  };

  return (
    <div style={S.body}>
      <div style={S.card}>
        <div style={S.sectionLabel}>Shopping</div>
        <FieldGroup label="Default plan start day">
          <select style={S.select} value={db.settings.shoppingDay} onChange={e => upd("shoppingDay",e.target.value)}>
            {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <div style={{ fontSize:12, color:C.faint, marginTop:4 }}>Seeds the start date for a brand-new plan. Each plan's own date (editable anytime) is what actually orders its days — not this setting.</div>
        </FieldGroup>
        <FieldGroup label="Pickup time">
          <input style={S.input} value={db.settings.pickupTime} onChange={e => upd("pickupTime",e.target.value)} />
        </FieldGroup>
        <FieldGroup label={`Budget limit: $${db.settings.budgetLimit}`}>
          <input type="range" min={100} max={500} step={10} value={db.settings.budgetLimit} onChange={e => upd("budgetLimit",Number(e.target.value))} style={{ width:"100%" }} />
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:C.faint }}><span>$100</span><span style={{ fontWeight:700, color:C.primary }}>${db.settings.budgetLimit}</span><span>$500</span></div>
        </FieldGroup>
      </div>

      <div style={S.card}>
        <div style={S.sectionLabel}>Family</div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
          <div><div style={{ fontWeight:600 }}>Kid 3 is home</div><div style={{ fontSize:12, color:C.faint }}>Toggle off when away (e.g. at college)</div></div>
          <Toggle value={db.settings.awayMemberHome} onChange={v => upd("awayMemberHome",v)} />
        </div>
        {(db.settings.familyContacts||[]).map((f,i,arr) => (
          <div key={f.name} style={{ ...S.row, padding:"10px 0", ...(i===arr.length-1?S.rowLast:{}) }}>
            <div style={{ flex:1 }}><div style={{ fontWeight:600 }}>{f.name}</div><div style={{ fontSize:12, color:C.faint }}>{f.phone||"No number set"}</div></div>
            {f.name==="C" && !db.settings.awayMemberHome && <span style={S.badge(C.muted,"#F3F4F6")}>away</span>}
          </div>
        ))}
      </div>

      <div style={S.card}>
        <div style={S.sectionLabel}>Cross-device sync — iCloud Drive</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:6 }}>{db.meals.length} meals · {db.ingredients.length} items · {planCount(db.plans)} plans</div>
        <div style={{ fontSize:12, color:C.faint, marginBottom:12 }}>Save to GroceryDB.json in iCloud Drive via shortcut or manual copy</div>

        <button style={{ ...S.btn, background:"#4A90D9", color:"#fff", marginBottom:8 }} onClick={() => window.open("https://www.icloud.com/iclouddrive/","_blank")}>
          ☁️ Open iCloud Drive
        </button>

        <button style={{ ...S.btn, ...S.btnP, marginBottom:8 }} onClick={downloadDB}>
          ⬇️ Download grocery_db.json
        </button>

        <button style={{ ...S.btn, ...S.btnS, marginBottom:8 }} onClick={() => setShowExport(v=>!v)}>
          📤 {showExport?"Hide export":"Export — copy to iCloud Drive"}
        </button>
        {showExport && (
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6, lineHeight:1.5 }}>Select all below (Ctrl+A) and copy, then paste into GroceryDB.json in iCloud Drive — or tap Copy.</div>
            <textarea readOnly value={exportJSON} style={{ ...S.input, height:100, fontSize:11, fontFamily:"monospace", resize:"none", marginBottom:8 }} onFocus={e => e.target.select()} />
            <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={copyExport}>{copied ? "✓ Copied" : "📋 Copy to clipboard"}</button>
          </div>
        )}

        <div style={{ fontSize:12, color:C.muted, marginBottom:6, marginTop:4, lineHeight:1.5 }}>To import: open GroceryDB.json in iCloud Drive, copy all, paste below.</div>
        {importSuccess ? (
          <div style={{ background:C.primaryLight, borderRadius:10, padding:"12px 14px", marginBottom:8, textAlign:"center" }}>
            <div style={{ fontWeight:700, color:C.primary }}>✅ Imported your data</div>
            <div style={{ fontSize:13, color:C.muted, marginTop:2 }}>
              {importSuccess.meals} meals · {importSuccess.items} items{importSuccess.asOf ? ` · as of ${formatAsOf(importSuccess.asOf)}` : ""}
            </div>
            <button style={{ background:"none", border:"none", color:C.primary, cursor:"pointer", fontSize:12, marginTop:4, textDecoration:"underline" }} onClick={() => setImportSuccess(null)}>Done</button>
          </div>
        ) : (
          <>
            <textarea style={{ ...S.input, height:80, fontSize:11, fontFamily:"monospace", resize:"none", marginBottom:6 }} placeholder="Paste JSON here to import..." value={pasteText} onChange={e => { setPasteText(e.target.value); setImportError(""); }} />
            {importError && <div style={{ fontSize:12, color:C.danger, marginBottom:6 }}>{importError}</div>}
            <button style={{ ...S.btn, ...S.btnS, marginBottom:8 }} onClick={importFromPaste} disabled={!pasteText.trim()}>📥 Import from paste</button>
          </>
        )}

        <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain,text/*" style={{ display:"none" }} onChange={e => e.target.files[0] && importDB(e.target.files[0])} />
        <button style={{ ...S.btn, ...S.btnS, marginBottom:8 }} onClick={() => fileRef.current.click()}>📥 Import from file</button>
        <button style={{ ...S.btn, ...S.btnD }} onClick={() => { if(window.confirm("Reset to defaults?")) persistDB(DEFAULT_DB); }}>Reset to defaults</button>
      </div>
    </div>
  );
}

// ── TONIGHT TAB ────────────────────────────────────────────────────────────────

function TonightTab({ db, persistDB }) {
  const awayMemberHome    = db.settings?.awayMemberHome !== false;
  const contacts     = db.settings?.familyContacts || DEFAULT_SETTINGS.familyContacts;
  const activeFamily = contacts.filter(f => f.name !== "C" || awayMemberHome);
  const [recipient, setRecipient] = useState("all");
  const [queued, setQueued] = useState(false);

  // Always the current plan — tonight's dinner is about the week actually
  // being lived, never whichever plan is being drafted in the Plan tab.
  const currentPlan = getCurrentPlan(db);
  const planMeals   = currentPlan?.meals || {};
  const { days, daysFull } = currentPlan?.weekStartDate
    ? getWeekFromDate(currentPlan.weekStartDate)
    : getWeekFromDay(db.settings?.shoppingDay || "Wednesday");

  const todayJsDay  = new Date().getDay();
  const todayAbbr   = DAYS_ALL[todayJsDay];
  const todayIdx    = days.indexOf(todayAbbr);
  const activeIdx   = todayIdx >= 0 ? todayIdx : 0;
  const todayMeal   = (planMeals[days[activeIdx]]||[]).join(", ") || null;
  const tomorrowIdx = (activeIdx + 1) % 7;
  const tomorrowMeal = (planMeals[days[tomorrowIdx]]||[]).join(", ") || null;

  const buildMessage = () => `Tonight's dinner (${daysFull[activeIdx]}): ${todayMeal||"Not planned yet"}`;

  const [tonightCopied, setTonightCopied] = useState(null);
  const sendTonight = () => {
    const msg = buildMessage();
    copyToClipboard(msg);
    setTonightCopied(msg);
    setTimeout(() => setTonightCopied(null), 4000);
  };

  // Write a ready-to-send entry into db.outbox. The app resolves recipients
  // (applying the away-member rule) and the message here, so the Shortcut that
  // reads this only has to send it — no parsing or logic on the Shortcut side.
  const queueForShortcut = () => {
    const message = buildMessage();
    let recipients, mode, label;
    if (recipient === "all") {
      recipients = activeFamily.map(f => f.phone).filter(Boolean);
      mode = "group";
      label = "Everyone (" + activeFamily.map(f=>f.name).join(", ") + ")";
    } else {
      const person = activeFamily.find(f => f.name === recipient);
      recipients = person?.phone ? [person.phone] : [];
      mode = "individual";
      label = person?.name || recipient;
    }
    persistDB({ ...db, outbox: { message, recipients, mode, label, queuedAt:new Date().toISOString(), sent:false } });
    setQueued(true);
    setTimeout(() => setQueued(false), 3000);
  };

  return (
    <div style={S.body}>
      <div style={{ ...S.card, background:C.primary, color:"#E8F5EE" }}>
        <div style={{ fontSize:11, fontWeight:700, opacity:0.7, marginBottom:4, letterSpacing:"0.06em", textTransform:"uppercase" }}>Tonight</div>
        <div style={{ fontSize:28, fontWeight:700, marginBottom:4 }}>{daysFull[activeIdx]}</div>
        <div style={{ fontSize:22, fontWeight:600 }}>{todayMeal || "Not planned yet"}</div>
      </div>

      {tomorrowMeal && (
        <div style={S.card}>
          <div style={S.sectionLabel}>Tomorrow — {daysFull[tomorrowIdx]}</div>
          <div style={{ fontSize:18, fontWeight:600, color:C.muted }}>{tomorrowMeal}</div>
        </div>
      )}

      {!currentPlan && (
        <div style={{ ...S.card, background:C.warningLight, border:`1px solid #F0D080` }}>
          <div style={{ fontSize:13, color:C.warning }}>No meal plan yet this week. Complete the Plan flow to set up your week.</div>
        </div>
      )}

      {db.plans?.next && (
        <div style={{ fontSize:12, color:C.faint, textAlign:"center", marginTop:-4, marginBottom:8 }}>Always shows the current week, even while next week's plan is being drafted.</div>
      )}

      <div style={S.card}>
        <div style={S.sectionLabel}>Send to</div>
        {[{name:"all",label:"Everyone (Family Dinner)"}, ...activeFamily].map((opt,i,arr) => (
          <div key={opt.name} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderBottom:i===arr.length-1?"none":`1px solid ${C.border}`, cursor:"pointer" }} onClick={() => setRecipient(opt.name)}>
            <div style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${recipient===opt.name?C.primary:C.border}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {recipient===opt.name && <div style={{ width:10, height:10, borderRadius:"50%", background:C.primary }} />}
            </div>
            <div style={{ fontWeight:600 }}>{opt.label||opt.name}</div>
          </div>
        ))}
        <button style={{ ...S.btn, ...S.btnP, marginTop:14, marginBottom:8 }} onClick={sendTonight}>📋 Copy tonight's dinner</button>
        {tonightCopied && (
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:12, color:C.verified, fontWeight:600, marginBottom:4 }}>✓ Copied — paste into Messages</div>
            <textarea readOnly value={tonightCopied} onFocus={e => e.target.select()} style={{ ...S.input, height:60, fontSize:12, resize:"none", marginBottom:0, fontFamily:"inherit" }} />
          </div>
        )}
        <button style={{ ...S.btn, background:queued?"#2D6A4F":"#4A90D9", color:"#fff", marginBottom:0 }} onClick={queueForShortcut}>
          {queued ? "✓ Queued — run your Shortcut" : "📲 Queue for Shortcut to send"}
        </button>
        {db.outbox && !db.outbox.sent && (
          <div style={{ fontSize:11, color:C.faint, marginTop:8, lineHeight:1.4 }}>
            Outbox ready: {db.outbox.label} · {db.outbox.recipients.length} recipient{db.outbox.recipients.length!==1?"s":""}. Export to iCloud, then run your send Shortcut.
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={S.sectionLabel}>This week</div>
        {days.map((d,i) => {
          const m       = (planMeals[d]||[]).join(", ");
          const isToday = i===activeIdx;
          return (
            <div key={d} style={{ display:"flex", padding:"9px 0", borderBottom:`1px solid ${C.border}`, gap:10 }}>
              <div style={{ fontSize:12, fontWeight:700, color:isToday?C.primary:C.faint, width:36 }}>{d}</div>
              <div style={{ flex:1, fontSize:14, fontWeight:isToday?700:400, color:isToday?C.primary:C.text }}>{m||"—"}</div>
              {isToday && <div style={{ fontSize:11, color:C.accent, fontWeight:700 }}>today</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── App shell ──────────────────────────────────────────────────────────────────

const TABS = [
  { id:"prep",    label:"Prep" },
  { id:"plan",    label:"Plan" },
  { id:"manage",  label:"Manage" },
  { id:"tonight", label:"Tonight" },
];

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError:false, error:null }; }
  static getDerivedStateFromError(error) { return { hasError:true, error }; }
  componentDidCatch(error, info) { console.error("[ErrorBoundary]", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding:24, fontFamily:"system-ui", color:C.text }}>
          <div style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>Something went wrong</div>
          <div style={{ fontSize:13, color:C.muted, marginBottom:16 }}>{String(this.state.error)}</div>
          <button style={{ ...S.btn, ...S.btnP }} onClick={() => { this.setState({ hasError:false, error:null }); window.location.reload(); }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Header data-status severity ladder (SPEC-data-provenance.md) ───────────────
// Priority: urgent (storage broken) shows ALONE; caution (seed data, or
// backup overdue) shows alongside the calm info line; calm is the base state
// with no action. Only one caution at a time -- seed wins over
// backup-overdue, since you can't be overdue backing up data that was never
// real to begin with. No dismiss controls: a state clears itself the moment
// its underlying condition resolves (storage recovers, a real import lands,
// a backup happens).
const BACKUP_OVERDUE_DAYS = 4;
function computeDataStatus(db, storageOk) {
  const changed  = db.dataChangedAt  ? new Date(db.dataChangedAt)  : null;
  const exported = db.lastExportedAt ? new Date(db.lastExportedAt) : null;
  const asOf     = formatAsOf(db.dataChangedAt);
  const calm     = asOf ? `Your data · as of ${asOf}` : "Your data";

  if (!storageOk) {
    return { severity:"urgent", calm, message:"⚠ Storage isn't saving — export now.", action:"export", actionLabel:"Export now" };
  }
  if (db._isSeed) {
    return { severity:"caution", calm, message:"⚠ Example data — import your file to begin.", action:"import", actionLabel:"Import" };
  }

  const hasChangesSinceBackup = !!changed && (!exported || changed.getTime() > exported.getTime());
  const backupIsStale = !exported || (Date.now() - exported.getTime() > BACKUP_OVERDUE_DAYS * 24*60*60*1000);
  if (hasChangesSinceBackup && backupIsStale) {
    let backupMsg = "you haven't backed up yet";
    if (exported) {
      const days = Math.floor((Date.now() - exported.getTime()) / (24*60*60*1000));
      backupMsg = `last backup ${days <= 0 ? "today" : days + " day" + (days===1?"":"s") + " ago"}`;
    }
    return { severity:"caution", calm, message:`You've made changes; ${backupMsg}.`, action:"backup", actionLabel:"Back up" };
  }

  return { severity:"calm", calm: asOf ? `Your data · as of ${asOf} · storage OK` : "Your data · storage OK", message:null, action:null, actionLabel:null };
}

export default function App() {
  const [db, setDB]               = useState(null);
  const [tab, setTab]             = useState("prep");
  const [loading, setLoading]     = useState(true);
  const [showOpenSession, setShowOpenSession]   = useState(false);
  const [sessionImport, setSessionImport]       = useState("");
  const [sessionPendingConfirm, setSessionPendingConfirm] = useState(null); // parsed db awaiting accept
  const [sessionError, setSessionError]         = useState("");
  const [saveOk, setSaveOk]                     = useState(true);
  const [recovery, setRecovery]                 = useState(null); // { savedAt, db } awaiting restore
  const [manageInitialSub, setManageInitialSub] = useState(undefined); // header's Import action lands Manage on Config
  const dbRef = useRef(null);

  useEffect(() => {
    (async () => {
      const loaded = await loadDB();
      // Auto-retire runs once per load, never mid-session: promotes plans.next
      // to current if its weekStartDate has arrived. Persist immediately if it
      // fired, so a reload doesn't re-archive the same outgoing week.
      const retired = autoRetirePlans(loaded);
      if (retired !== loaded) {
        persistDB(retired, { background: true });
      } else {
        setDB(loaded);
        dbRef.current = loaded;
      }
      setLoading(false);
      setSaveOk(getStorageHealth() !== "unavailable");
      const restoredReal = getStorageHealth() === "ok" && loaded !== DEFAULT_DB;

      // Check for a recovery snapshot newer than what loaded. If found, offer a
      // one-tap restore instead of prompting for a re-import.
      const snap = await loadRecovery();
      const snapNewer = snap && (!loaded.savedAt || new Date(snap.savedAt) > new Date(loaded.savedAt));
      const snapHasMore = snap && (!restoredReal || snap.db.ingredients.length !== loaded.ingredients.length || snap.db.meals.length !== loaded.meals.length);
      if (snap && snapNewer && snapHasMore) {
        setRecovery(snap);
      } else if (!restoredReal) {
        // Nothing to recover and no real local data — fall back to import prompt.
        setShowOpenSession(true);
      }
    })();
  }, []);

  // Write a recovery snapshot whenever the app is backgrounded or hidden — this
  // is the safety net for closing before exporting. Synchronous-ish, no async
  // clipboard/Shortcut work that iOS would kill mid-close.
  useEffect(() => {
    const snapshot = () => { if (dbRef.current) saveRecovery(dbRef.current); };
    const onVis = () => { if (document.visibilityState === "hidden") snapshot(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", snapshot);
    window.addEventListener("blur", snapshot);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", snapshot);
      window.removeEventListener("blur", snapshot);
    };
  }, []);

  // dataChangedAt is the single source of truth for "when did the user's
  // actual grocery data last change" (SPEC-data-provenance.md). Every call
  // stamps it EXCEPT the two known background writers — weather-driven pill
  // auto-derivation and auto-retire's next→current promotion — which pass
  // { background: true } so opening the app doesn't itself look like a change.
  const persistDB = (next, opts = {}) => {
    // migrateDB is idempotent, so this is a cheap no-op for an already-current
    // db and a safety net for anything entering via recovery/import that might
    // still carry the legacy single-slot plan shape.
    const stamped = {
      ...migrateDB(next),
      savedAt: new Date().toISOString(),
      ...(opts.background ? {} : { dataChangedAt: new Date().toISOString() }),
    };
    setDB(stamped);
    dbRef.current = stamped;
    saveDB(stamped).then(ok => setSaveOk(ok)).catch(() => setSaveOk(false));
  };

  const acceptRecovery = () => {
    persistDB(recovery.db);
    clearRecovery();
    setRecovery(null);
  };
  const dismissRecovery = () => {
    clearRecovery();
    setRecovery(null);
    const restoredReal = getStorageHealth() === "ok" && dbRef.current && dbRef.current !== DEFAULT_DB;
    if (!restoredReal) setShowOpenSession(true);
  };

  const acceptSessionImport = () => {
    try {
      const parsed = stripExportNodes(JSON.parse(extractJSON(sessionImport)));
      if (!parsed.meals || !parsed.ingredients) throw new Error("Not a valid grocery database");
      setSessionPendingConfirm(parsed);
      setSessionError("");
    } catch(e) {
      setSessionError("Could not read that data: " + e.message);
    }
  };

  const confirmSessionImport = () => {
    // Real external data replacing what's here — not the seed set.
    persistDB({ ...sessionPendingConfirm, _isSeed: false });
    setSessionPendingConfirm(null);
    setSessionImport("");
    setShowOpenSession(false);
  };

  if (loading || !db) {
    return (
      <div style={{ ...S.app, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh" }}>
        <div style={{ textAlign:"center", color:C.muted }}>
          <div style={{ fontSize:32, marginBottom:12 }}>🛒</div>
          <div style={{ fontSize:14 }}>Loading...</div>
        </div>
      </div>
    );
  }

  const dataStatus = computeDataStatus(db, saveOk);
  const runStatusAction = () => {
    if (dataStatus.action === "export" || dataStatus.action === "backup") downloadBackup(db, persistDB);
    else if (dataStatus.action === "import") { setManageInitialSub("config"); setTab("manage"); }
  };

  return (
    <ErrorBoundary>
      <div style={S.app}>
        <div style={S.header}>
          <div style={S.headerTop}>
            <div style={S.headerTitle}>Grocery Planner</div>
            {dataStatus.severity === "calm" && (
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:11, color:C.accentMuted }}>{dataStatus.calm}</span>
                <button style={S.statusActionSubtle} onClick={() => downloadBackup(db, persistDB)} title="Back up your data now">Save</button>
              </div>
            )}
          </div>

          {dataStatus.severity === "urgent" && (
            <div style={{ background:"rgba(211,51,51,0.25)", border:"1px solid rgba(211,51,51,0.5)", borderRadius:8, padding:"8px 10px", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
              <span style={{ fontSize:12, fontWeight:700, color:"#FFB3B3" }}>{dataStatus.message}</span>
              <button style={S.statusAction} onClick={runStatusAction}>{dataStatus.actionLabel}</button>
            </div>
          )}

          {dataStatus.severity === "caution" && (
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:C.accentMuted, marginBottom:4 }}>{dataStatus.calm}</div>
              <div style={{ background:"rgba(240,176,80,0.22)", border:"1px solid rgba(240,176,80,0.5)", borderRadius:8, padding:"8px 10px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
                <span style={{ fontSize:12, fontWeight:700, color:"#F0B050" }}>{dataStatus.message}</span>
                <button style={S.statusAction} onClick={runStatusAction}>{dataStatus.actionLabel}</button>
              </div>
            </div>
          )}

          <div style={S.tabs}>
            {TABS.map(t => <button key={t.id} style={S.tab(tab===t.id)} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </div>
        </div>

        {/* Recovery modal — offer to restore the snapshot taken when the app
            was last backgrounded, so closing before export isn't data loss. */}
        {recovery && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:101, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"#fff", borderRadius:"18px 18px 0 0", padding:20, width:"100%", maxWidth:480 }}>
              <div style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>Restore unsaved work?</div>
              <div style={{ fontSize:13, color:C.muted, marginBottom:14, lineHeight:1.5 }}>
                The app saved a snapshot when you last closed it{recovery.savedAt ? ` (${formatSavedAt(recovery.savedAt)})` : ""}. It has more data than what just loaded — looks like changes you didn't export.
              </div>
              <div style={{ background:C.primaryLight, borderRadius:10, padding:"12px 14px", marginBottom:16 }}>
                <div style={{ display:"flex", justifyContent:"space-around", textAlign:"center" }}>
                  <div><div style={{ fontSize:26, fontWeight:800, color:C.primary }}>{recovery.db.meals.length}</div><div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>MEALS</div></div>
                  <div><div style={{ fontSize:26, fontWeight:800, color:C.primary }}>{recovery.db.ingredients.length}</div><div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>ITEMS</div></div>
                  <div><div style={{ fontSize:26, fontWeight:800, color:C.primary }}>{planCount(recovery.db.plans)}</div><div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>PLANS</div></div>
                </div>
              </div>
              <button style={{ ...S.btn, ...S.btnP }} onClick={acceptRecovery}>Restore this</button>
              <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={dismissRecovery}>Discard — use what loaded</button>
            </div>
          </div>
        )}

        {/* Open session modal — pull latest from iCloud */}
        {showOpenSession && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"#fff", borderRadius:"18px 18px 0 0", padding:20, width:"100%", maxWidth:480, maxHeight:"85vh", overflowY:"auto" }}>
              {sessionPendingConfirm ? (
                <>
                  <div style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>Load this data?</div>
                  <div style={{ background:C.primaryLight, borderRadius:10, padding:"14px 16px", marginBottom:16 }}>
                    <div style={{ display:"flex", justifyContent:"space-around", textAlign:"center" }}>
                      <div><div style={{ fontSize:28, fontWeight:800, color:C.primary }}>{sessionPendingConfirm.meals.length}</div><div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>MEALS</div></div>
                      <div><div style={{ fontSize:28, fontWeight:800, color:C.primary }}>{sessionPendingConfirm.ingredients.length}</div><div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>ITEMS</div></div>
                      <div><div style={{ fontSize:28, fontWeight:800, color:C.primary }}>{planCount(sessionPendingConfirm.plans)}</div><div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>PLANS</div></div>
                    </div>
                    {sessionPendingConfirm.savedAt && <div style={{ fontSize:12, color:C.muted, textAlign:"center", marginTop:10 }}>Saved {formatSavedAt(sessionPendingConfirm.savedAt)}</div>}
                  </div>
                  <div style={{ fontSize:12, color:C.muted, marginBottom:14 }}>This replaces what's currently on this device.</div>
                  <button style={{ ...S.btn, ...S.btnP }} onClick={confirmSessionImport}>Yes, load it</button>
                  <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={() => setSessionPendingConfirm(null)}>Back</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>Start session</div>
                  <div style={{ fontSize:13, color:C.muted, marginBottom:14, lineHeight:1.5 }}>Pull your latest data so this device is current. Run the shortcut to copy GroceryDB, then paste below — or skip to use what's already here.</div>
                  <div style={{ fontSize:13, color:C.muted, marginBottom:10, padding:"10px 12px", background:"#EFF4FB", borderRadius:8, border:"1px solid #D3E1F2" }}>
                    📲 Run <b>"Get My Grocery Data"</b> from your Shortcuts app or home screen, then paste below. (In-app launch is blocked by iOS here.)
                  </div>
                  <textarea style={{ ...S.input, height:90, fontSize:11, fontFamily:"monospace", resize:"none" }} placeholder="Paste GroceryDB here..." value={sessionImport} onChange={e => { setSessionImport(e.target.value); setSessionError(""); }} />
                  {sessionError && <div style={{ fontSize:12, color:C.danger, marginBottom:8 }}>{sessionError}</div>}
                  <button style={{ ...S.btn, ...S.btnP }} disabled={!sessionImport.trim()} onClick={acceptSessionImport}>Review &amp; load</button>
                  <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={() => { setShowOpenSession(false); setSessionImport(""); setSessionError(""); }}>Skip — use what's here</button>
                </>
              )}
            </div>
          </div>
        )}

        {tab==="prep"    && <PrepTab    db={db} persistDB={persistDB} />}
        {tab==="plan"    && <PlanTab    key={db.activePlan || "current"} db={db} persistDB={persistDB} />}
        {tab==="manage"  && <ManageTab  db={db} persistDB={persistDB} initialSub={manageInitialSub} />}
        {tab==="tonight" && <TonightTab db={db} persistDB={persistDB} />}
      </div>
    </ErrorBoundary>
  );
}
