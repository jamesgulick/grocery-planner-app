// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { extraDaysOf, seedTimeLevel } from "../engine/assembleInputs.js";

// ── Globals ────────────────────────────────────────────────────────────────────

const DAYS_ALL   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAYS_FULL  = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
// Semantic role flags (SPEC-family-roles.md) — resolved by name, never by
// position/initials, at every call site. isPartner: per-day presence via the
// home/away pill. canBeAway: persistent presence via the config toggle.
// isSelf: the app's own user; a small tiebreaker bonus when present.
const FAMILY     = [
  { name:"Partner", phone:"", isPartner:true },
  { name:"Kid 1",   phone:"" },
  { name:"Kid 2",   phone:"" },
  { name:"Kid 3",   phone:"", canBeAway:true },
  { name:"Me",      phone:"", isSelf:true },
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
// Day-fit affinity: how a meal matches the day's feel. Drives soft suggestion
// nudges (comfort on cold days, light on hot). Separate from grillable (a hard
// gate on bad-grill weather). See the meal-suggestion weighting.
const TEMP_AFFINITY_OPTIONS = ["comfort","neutral","light"];
const MEAL_TYPES       = ["dinner","side","remix","batch","takeout"];
const FAMILY_NAMES     = ["Partner","Kid 1","Kid 2","Kid 3","Me"];
// Preview builds share an origin — and so localStorage — with the live app:
// VITE_PREVIEW=1 (the hotfix preview, /preview/) and VITE_PREVIEW=v2 (the polish
// v2 preview, /v2/). Each gets its own key suffix so a preview can never write the
// live DB or the other preview's; the live DB is only ever READ, to seed it.
const PREVIEW_SLOT     = import.meta.env.VITE_PREVIEW === "v2" ? "v2" : import.meta.env.VITE_PREVIEW ? "preview" : null;
const IS_PREVIEW       = !!PREVIEW_SLOT;
const KEY_SUFFIX       = IS_PREVIEW ? "_" + PREVIEW_SLOT : "";
const LIVE_DB_KEY      = "grocery_db";
const DB_KEY           = LIVE_DB_KEY + KEY_SUFFIX;
const RECOVERY_KEY     = "grocery_recovery" + KEY_SUFFIX;
const SHORTCUT_GET     = "shortcuts://run-shortcut?name=Get%20My%20Grocery%20Data";
const SHORTCUT_SAVE    = "shortcuts://run-shortcut?name=Save%20My%20Grocery%20Data";
const PLAN_STEPS       = ["Welcome","Meals","Inventory","Confirm","Order"];   // labels only; renaming one needs no step migration (renumbering does)

// Per-day time to cook (REFACTOR B1) — replaces the old binary `easy` pill and the
// hidden "shopping day + Mon + Tue are easy" rule. Only "much" unlocks involved
// meals. The weekday seed (seedTimeLevel, imported) is a UI default the owner
// overrides; the engine reads the level, never the weekday.
const seedTimeLevels = () => Object.fromEntries(DAYS_ALL.map(d => [d, seedTimeLevel(d)]));

const isPC = () => !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const toSentenceCase = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

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
// day the week starts on, produce the 7-day days/daysFull pair.
function buildWeekFromStartIndex(startIdx) {
  const days = [], daysFull = [];
  for (let i = 0; i < 7; i++) {
    const idx = (startIdx + i) % 7;
    days.push(DAYS_ALL[idx]);
    daysFull.push(DAYS_FULL[idx]);
  }
  return { days, daysFull };
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

// A plan's full day list: its seven weekday-keyed days, then any EXTRA days (X1, X2 —
// shopping a day or two later than usual; see weekDates in assembleInputs), labelled
// "Extra <weekday>". Every surface that walks a plan's days goes through this, so an
// extra day shows up everywhere a normal one does. No plan yet → the shoppingDay week.
function planDays(plan, shoppingDay) {
  if (!plan?.weekStartDate) return getWeekFromDay(shoppingDay || "Wednesday");
  const { days, daysFull } = getWeekFromDate(plan.weekStartDate);
  const out = { days: [...days], daysFull: [...daysFull] };
  for (let n = 1; n <= extraDaysOf(plan); n++) {
    const iso = addDaysISO(plan.weekStartDate, 6 + n);
    out.days.push(`X${n}`);
    out.daysFull.push(`Extra ${DAYS_FULL[new Date(iso + "T00:00:00").getDay()]}`);
  }
  return out;
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

// "Wednesday 8/19" — full weekday + numeric M/D, for a single REAL day (the
// date-anchored Tonight/Tomorrow cards). Unlike weekLabel, which names a week.
function dateLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${d.toLocaleDateString("en-US", { weekday:"long" })} ${d.getMonth()+1}/${d.getDate()}`;
}

// Today's LOCAL calendar date as YYYY-MM-DD. NOT new Date().toISOString() —
// that reads the UTC date, which has already rolled to tomorrow once local
// time crosses midnight UTC (e.g. after 8pm EDT). Anything resolving "what
// day is today" for date-anchored UI (Tonight/Tomorrow, past-dated checks)
// must use this, or it shows tomorrow's data in the evening.
function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export { DAYS_ALL, DAYS_FULL, DB_KEY, DEFAULT_SUBTYPE, EFFORTS, FAMILY, FAMILY_NAMES, INVENTORY_LOCS, IS_PREVIEW, KEY_SUFFIX, LIVE_DB_KEY, MEAL_TYPES, PLAN_STEPS, PREVIEW_SLOT, RECOVERY_KEY, STORAGE_LOCATIONS, TEMP_AFFINITY_OPTIONS, TIERS, TIER_SUBTYPES, addDaysISO, dateLabel, extractJSON, formatSavedAt, nextDateForShoppingDay, planDays, seedTimeLevels, tierOptions, tierValueOf, toSentenceCase, todayLocalISO, weekLabel };
