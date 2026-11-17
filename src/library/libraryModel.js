// The Library's reading of the data (phase 2 milestone 3; boards "Library lists", "Meal page,
// all fields"; Decisions 11/14–11/15). Pure: no React, no storage. Groups, sorts, the
// To-finish rules, the words each row shows, and the record edits the meal and item pages
// make (pairings, deletes), so the pages stay about layout.
import { addDaysISO, extraDaysOf, weekDates } from "../engine/assembleInputs.js";
import { INVENTORY_LOCS } from "../app/globals.js";
import { mapBothPlans } from "../app/plans.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const key = s => String(s || "").trim().toLowerCase();
const dateOf = iso => new Date(iso + "T12:00:00");
export const monthDay = iso => { const d = dateOf(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
export const dayShort = iso => { const d = dateOf(iso); return `${WD[d.getDay()]} ${d.getDate()}`; };

// ── Words ─────────────────────────────────────────────────────────────────────
// FACET_VOCAB values in plain words (Decisions 11/15: 'Plated entrée', 'Custard or pie',
// 'Pub food', 'Bread-based'). A value not listed reads as itself, capitalised.
import { facetWord } from "../app/vocab.js";
export { facetWord };

// Main | Side (Ruling 18, 11/16). Main is stored as "dinner", as before.
export const TYPE_OPTIONS = [{ value: "dinner", label: "Main" }, { value: "side", label: "Side" }];
export const typeWord = t => (TYPE_OPTIONS.find(o => o.value === t) || TYPE_OPTIONS[0]).label;
export const ROTATION_OPTIONS = [
  { value: "experimental", label: "New" }, { value: "in", label: "In rotation" }, { value: "manual", label: "Hand-picked" },
];
// Scale order: the stronger end on the left (Decisions 11/14).
// "occasional" is stored (11/16, app-side only; the engine sees weekly and biweekly). Absent = Not set.
export const CADENCE_OPTIONS = [
  { value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Every 2 weeks" }, { value: "occasional", label: "Occasional" },
];
export const cadenceWord = c => (CADENCE_OPTIONS.find(o => o.value === c) || { label: "Not set" }).label;
export const EFFORT_OPTIONS = [
  { value: "easy", label: "Little", n: 1 }, { value: "medium", label: "Some", n: 2 }, { value: "involved", label: "Lots", n: 3 },
];
export const COST_OPTIONS = [
  { value: "none", label: "None" }, { value: "low", label: "Low" }, { value: "moderate", label: "Moderate" }, { value: "high", label: "High" },
];
export const FEEL_OPTIONS = [
  { value: "comfort", label: "Comfort" }, { value: "neutral", label: "Neutral" }, { value: "light", label: "Light" },
];
export const PREF_OPTIONS = [
  { value: "likes", label: "Likes" }, { value: "fine", label: "Fine" }, { value: "dislikes", label: "Won't eat" },
];

// Buy: tier + stapleType shown as one four-way choice, in Inventory's words.
export const BUY_OPTIONS = [
  { value: "always", label: "Always buy" }, { value: "weekly", label: "Weekly staple" },
  { value: "slow", label: "Slow staple" }, { value: "meals", label: "For meals" },
];
export const buyOf = i => (i.tier === "always" ? "always" : i.tier === "staple" ? (i.stapleType === "slow" ? "slow" : "weekly") : "meals");
export const buyWord = i => BUY_OPTIONS.find(o => o.value === buyOf(i)).label;
export const buyPatch = v => (v === "always" ? { tier: "always", stapleType: undefined }
  : v === "weekly" ? { tier: "staple", stapleType: "weekly" }
  : v === "slow" ? { tier: "staple", stapleType: "slow" }
  : { tier: "specialty", stapleType: undefined });

export const isSide = m => m.type === "side";
export const placeOf = i => (i.storageLocation && i.storageLocation !== "Unassigned" ? i.storageLocation : null);

// ── History: last made, cooked count, planned ────────────────────────────────
/**
 * Per meal name (trimmed, lower-cased): `last` (the last date on or before today), `count`
 * (days served), `planned` (the next planned date from today on). Day-level dates come
 * from the day tail and the current/next plans; archived weeks with no day tail
 * (`mealHistory`) count once each, by archive date, for names no day mentions.
 */
export function mealHistoryIndex(db, today) {
  const last = {}, count = {}, planned = {};
  const plans = db.plans || {};
  const weeks = [...(db.planTail || []), plans.current, plans.next].filter(w => w && w.weekStartDate);
  for (const w of weeks) {
    const dates = weekDates(w.weekStartDate, extraDaysOf(w));
    for (const [abbr, names] of Object.entries(w.mealPlan || {})) {
      const iso = dates[abbr];
      if (!iso) continue;
      for (const n of new Set((names || []).map(key))) {
        if (!n) continue;
        if (iso < today) { count[n] = (count[n] || 0) + 1; if (!last[n] || iso > last[n]) last[n] = iso; }
        else if (!planned[n] || iso < planned[n]) planned[n] = iso;
      }
    }
  }
  const seen = new Set([...Object.keys(last), ...Object.keys(planned)]);
  for (const h of db.mealHistory || []) {
    const iso = typeof h?.archivedAt === "string" ? h.archivedAt.slice(0, 10) : null;
    if (!iso) continue;
    for (const n of new Set((h.meals || []).map(key))) {
      if (!n || seen.has(n)) continue;
      count[n] = (count[n] || 0) + 1;
      if (!last[n] || iso > last[n]) last[n] = iso;
    }
  }
  return { last: n => last[key(n)] || null, count: n => count[key(n)] || 0, planned: n => planned[key(n)] || null };
}

// ── To finish ─────────────────────────────────────────────────────────────────
// Finish-the-entry gaps (Decisions 11/14–11/16): only for a meal in rotation or planned.
// A main with no Style; a planned meal with nothing to buy, except a meal not cooked at home
// (RULING 17.1; Remix is gone, Ruling 18). An empty Goes with is never a gap (11/16).
export const notHomeCooked = m => (m.service || []).some(s => s !== "home-cooked");
export const styleMissing = m => !(m.form || []).length && !(m.service || []).length;
export function mealGaps(m, hist) {
  const planned = hist.planned(m.name);
  if (m.rotation !== "in" && m.rotation !== undefined && !planned) return {};
  const g = {};
  if (!isSide(m) && styleMissing(m)) g.style = true;
  if (planned && !(m.ingredients || []).length && !notHomeCooked(m)) g.nothingToBuy = planned;
  return g;
}
export function gapLine(g) {
  if (g.nothingToBuy) return `Nothing to buy for ${dayShort(g.nothingToBuy)}`;
  if (g.style) return "Style not set";
  return null;
}
export const itemToFinish = i => !placeOf(i);

// ── Search ────────────────────────────────────────────────────────────────────
// Meals match name, type, notes and style/plate tags (as today's mealMatches); items, name.
export function mealMatches(m, q) {
  const t = key(q);
  if (!t) return true;
  const hay = [m.name, m.type, typeWord(m.type), m.notes, ...(m.form || []), ...(m.service || []), ...(m.experience || []), ...(m.plate || [])];
  return hay.some(v => typeof v === "string" && (v.toLowerCase().includes(t) || facetWord(v).toLowerCase().includes(t)));
}
export const itemMatches = (i, q) => !key(q) || key(i.name).includes(key(q));

// ── Lists ─────────────────────────────────────────────────────────────────────
export const MEAL_SORTS = [
  { value: "az", label: "A–Z" }, { value: "recent", label: "Recently made" },
  { value: "longest", label: "Longest ago" }, { value: "added", label: "Recently added" },
];
export const ITEM_SORTS = [
  { value: "place", label: "By place" }, { value: "buy", label: "By buy type" },
  { value: "az", label: "A–Z" }, { value: "added", label: "Recently added" },
];
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
const byAdded = (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || byName(a, b);

/** Meal row subline: "Weekly · last Oct 22", or with a time sort "last Oct 22 · Weekly". */
export function mealSubline(m, hist, sort) {
  const often = m.rotation === "manual" ? "Hand-picked" : cadenceWord(m.cadence);
  const l = hist.last(m.name);
  const when = l ? `last ${monthDay(l)}` : null;
  if (sort === "recent" || sort === "longest") return [when || "never made", often].join(" · ");
  return when ? `${often} · ${when}` : often;
}

/** Meals grouped: To finish → New → Mains → Sides; each meal once, in the first group it fits. */
export function mealGroups(meals, hist, { q, filter, sort }) {
  const shown = meals.filter(m => mealMatches(m, q) && (!filter || (filter === "sides") === isSide(m)));
  const order = sort === "added" ? byAdded
    : sort === "recent" || sort === "longest" ? (a, b) => {
      const x = hist.last(a.name) || "", y = hist.last(b.name) || "";
      if (x === y) return byName(a, b);
      return sort === "recent" ? (y || "").localeCompare(x || "") : (x || "").localeCompare(y || "");
    } : byName;
  const groups = [
    { key: "finish", label: "To finish", rows: [] }, { key: "new", label: "New", rows: [] },
    { key: "mains", label: "Mains", rows: [] }, { key: "sides", label: "Sides", rows: [] },
  ];
  for (const m of shown) {
    const gap = gapLine(mealGaps(m, hist));
    if (gap) groups[0].rows.push({ meal: m, line: gap, problem: true });
    else if (m.rotation === "experimental") groups[1].rows.push({ meal: m, line: m.soon ? "Wanted soon" : mealSubline(m, hist, sort) });
    else groups[isSide(m) ? 3 : 2].rows.push({ meal: m, line: mealSubline(m, hist, sort) });
  }
  for (const g of groups) g.rows.sort((a, b) => order(a.meal, b.meal));
  return groups.filter(g => g.rows.length);
}

export const itemSubline = i => [buyWord(i), i.defaultQuantity].filter(Boolean).join(" · ");

/** Items grouped: To finish (no storage place) → by place (Inventory order) or buy type, or one list. */
export function itemGroups(items, { q, filter, sort }) {
  const fits = i => !filter || (filter === "always" ? buyOf(i) === "always" : filter === "staples" ? ["weekly", "slow"].includes(buyOf(i)) : buyOf(i) === "meals");
  const shown = items.filter(i => itemMatches(i, q) && fits(i));
  const order = sort === "added" ? byAdded : byName;
  const finish = { key: "finish", label: "To finish", rows: [] };
  const rest = new Map();
  const labelFor = i => (sort === "place" ? placeOf(i) : sort === "buy" ? buyWord(i) : sort === "added" ? "Recently added" : "All items");
  const groupOrder = sort === "place" ? INVENTORY_LOCS : sort === "buy" ? BUY_OPTIONS.map(o => o.label) : null;
  for (const i of shown) {
    if (itemToFinish(i)) { finish.rows.push({ item: i, line: "No storage place · not in Inventory", problem: true }); continue; }
    const l = labelFor(i);
    if (!rest.has(l)) rest.set(l, { key: l, label: l, rows: [] });
    rest.get(l).rows.push({ item: i, line: itemSubline(i) });
  }
  const groups = [...rest.values()];
  if (groupOrder) groups.sort((a, b) => { const x = groupOrder.indexOf(a.label), y = groupOrder.indexOf(b.label); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
  for (const g of [finish, ...groups]) g.rows.sort((a, b) => order(a.item, b.item));
  return [finish, ...groups].filter(g => g.rows.length);
}

export const mealsToFinish = (meals, hist) => meals.some(m => gapLine(mealGaps(m, hist)));
export const itemsToFinish = items => items.some(itemToFinish);

// ── Meal page words ───────────────────────────────────────────────────────────
export function whoEatsWords(m, family) {
  const prefs = (m.preferences || []).filter(p => p.pref === "likes" || p.pref === "dislikes");
  if (!prefs.length) return m.rotation === "experimental" ? null : "Everyone fine";
  const order = family.map(f => f.name);
  const sorted = [...prefs].sort((a, b) => order.indexOf(a.person) - order.indexOf(b.person));
  const parts = sorted.map(p => ({ text: `${p.person} ${p.pref === "likes" ? "likes" : "won't eat"}`, strong: p.pref === "dislikes" }));
  if (prefs.length < family.length) parts.push({ text: "others fine" });
  return parts;
}
export function leftoversWords(m) {
  const c = m.carries;
  if (!c) return m.rotation === "experimental" ? null : "None";
  const who = Array.isArray(c.forWhom) ? (c.forWhom.length ? c.forWhom.join(", ") : "Nobody chosen") : c.forWhom === "all" ? "Everyone" : "Whoever likes it";
  return `${who} · lasts ${c.lastsDays} day${c.lastsDays === 1 ? "" : "s"}`;
}
export const weatherWords = m => [FEEL_OPTIONS.find(o => o.value === (m.tempAffinity || "neutral")).label, m.grillable ? "grillable" : "not grillable"].join(" · ");
export function timeCostWords(m) {
  const e = EFFORT_OPTIONS.find(o => o.value === m.effort);
  if (!e) return null;
  const c = COST_OPTIONS.find(o => o.value === m.cost);
  return [`${e.value === "involved" ? "Lots of" : e.label} time`, c && c.value !== "none" ? `${c.label} cost` : null].filter(Boolean).join(" · ");
}
export const linkWords = url => String(url || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

// ── Edits ─────────────────────────────────────────────────────────────────────
/** Set one optional field: undefined/false/"" removes it, so an untouched record stays as it was. */
export function withField(m, k, v) {
  const n = { ...m };
  if (v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && !v.length)) delete n[k];
  else n[k] = v;
  if (k === "carries") {   // the legacy leftovers field (card badge, fridge report) follows carries
    if (n.carries && (!n.leftovers || n.leftovers === "none")) n.leftovers = "yes";
    if (!n.carries && n.leftovers === "yes") n.leftovers = "none";
  }
  return n;
}

/** The pairing ids shown for a meal: a side's own pairsWith; for a main, the sides naming it. */
export const pairIdsOf = (m, meals) => (isSide(m) ? (m.pairsWith || []) : meals.filter(s => isSide(s) && (s.pairsWith || []).includes(m.id)).map(s => s.id));

/** Meals with `m`'s pairings set to `ids`; for a main, written onto the sides (one save). */
export function withPairs(meals, m, ids) {
  const want = new Set(ids);
  if (isSide(m)) return meals.map(x => (x.id === m.id ? withField(x, "pairsWith", [...want]) : x));
  return meals.map(s => {
    if (!isSide(s) || s.id === m.id) return s;
    const has = (s.pairsWith || []).includes(m.id);
    if (has === want.has(s.id)) return s;
    return withField(s, "pairsWith", has ? s.pairsWith.filter(x => x !== m.id) : [...(s.pairsWith || []), m.id]);
  });
}

/** What deleting a meal touches (the speed bump): planned days, linked meals, items only it uses. */
export function mealDeleteImpact(db, m, today) {
  const plans = db.plans || {};
  const planned = [];
  for (const p of [plans.current, plans.next].filter(Boolean)) {
    const dates = weekDates(p.weekStartDate, extraDaysOf(p));
    for (const [abbr, names] of Object.entries(p.mealPlan || {}))
      if ((names || []).some(n => key(n) === key(m.name)) && dates[abbr] && dates[abbr] >= today) planned.push(dates[abbr]);
  }
  const linked = pairIdsOf(m, db.meals || []);
  const onlyIt = (m.ingredients || []).filter(id => !(db.meals || []).some(x => x.id !== m.id && (x.ingredients || []).includes(id)));
  const names = ids => ids.map(id => (db.ingredients || []).find(i => i.id === id)?.name).filter(Boolean);
  return { planned: planned.sort(), linked: linked.length, onlyItems: names(onlyIt) };
}
/** The DB without meal `id`; its id leaves every side's pairsWith so no link dangles (as before). */
export const withoutMeal = (db, id) => ({
  ...db,
  meals: (db.meals || []).filter(m => m.id !== id).map(m => ((m.pairsWith || []).includes(id) ? withField(m, "pairsWith", m.pairsWith.filter(x => x !== id)) : m)),
});

/** What deleting an item touches: the meals it's removed from, and the plans listing it. */
export function itemDeleteImpact(db, i) {
  const meals = (db.meals || []).filter(m => (m.ingredients || []).includes(i.id)).map(m => m.name);
  const plans = db.plans || {};
  const onLists = [plans.current, plans.next].filter(p => p && (p.items || []).some(x => x.ingredientId === i.id)).map(p => p.weekStartDate);
  return { meals, onLists };
}
/** The DB without item `id`: off every meal and every plan's list (as before). */
export function withoutItem(db, id) {
  const base = {
    ...db,
    ingredients: (db.ingredients || []).filter(i => i.id !== id),
    meals: (db.meals || []).map(m => ((m.ingredients || []).includes(id) ? { ...m, ingredients: m.ingredients.filter(x => x !== id) } : m)),
  };
  return mapBothPlans(base, p => ({ ...p, items: (p.items || []).filter(x => x.ingredientId !== id) }));
}

export const weekOfWords = iso => `Week of ${monthDay(iso)}`;
export { addDaysISO };
