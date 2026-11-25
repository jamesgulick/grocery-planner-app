// Rating (brief §2, "Two reasons to be prompted, one action any time", 11/25). Pure: no React,
// no storage. A "cooking" is a past day in the current/next plan or planTail with that dish on
// it; tonight counts from RATE_HOUR. A meal cooked in the last RATE_WINDOW_DAYS prompts when it is
//   Just tried: its first planned date in history is one of those cookings, and meal.ratedAt is
//     not on or after it (ratedAt is app-side only: the engine never sees it); or
//   Incomplete: How often unset (not on a Hand-picked meal), Time needed unset, or someone home
//     on one of those nights with no Who eats it answer (likes, fine or won't eat).
// Mains and sides alike.
import { extraDaysOf, presentOn, weekDates, addDaysISO } from "../engine/assembleInputs.js";

export const RATE_HOUR = 19;          // tonight joins the prompt from 7pm, phone time (fixed)
export const RATE_WINDOW_DAYS = 14;   // "cooked in the last ~2 weeks"

const key = s => String(s || "").trim().toLowerCase();

/** Every planned night by date: { iso, day, names, presence }; a later-starting week wins an overlap day. */
export function plannedNights(db) {
  const plans = db.plans || {};
  const weeks = [...(db.planTail || []), plans.current, plans.next]
    .filter(w => w && w.weekStartDate)
    .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
  const out = {};
  for (const w of weeks) {
    const dates = weekDates(w.weekStartDate, extraDaysOf(w));
    for (const [day, iso] of Object.entries(dates)) out[iso] = { iso, day, names: w.mealPlan?.[day] || [], presence: w.presence || {} };
  }
  return out;
}

/** True when a night counts as cooked: before today, or today from RATE_HOUR. */
export const isCooked = (iso, today, hour) => iso < today || (iso === today && hour >= RATE_HOUR);

/** Who was out on a night (family order). */
export const outOn = (night, family, ranges) => family.filter(n => !presentOn(night.presence, ranges, n, night.day, night.iso));

/** The answered people: any stored Who eats it value, fine included. */
const answered = m => new Set((m.preferences || []).filter(p => p && ["likes", "fine", "dislikes"].includes(p.pref)).map(p => p.person));

/** The gaps judged at the table, as words: "How often", "Time needed", then names. */
export function mealGapsAt(m, homeNames) {
  const gaps = [];
  if (m.rotation !== "manual" && !m.cadence) gaps.push("How often");
  if (!m.effort) gaps.push("Time needed");
  const has = answered(m);
  for (const n of homeNames) if (!has.has(n)) gaps.push(n);
  return gaps;
}

/**
 * The meals to rate, oldest cooking first: { meal, tried, gaps, iso (latest cooking), out (people
 * out that night), why ("First try" / "Missing …") }.
 */
export function rateQueue(db, today, hour) {
  const family = (db.settings?.familyContacts || []).map(f => f.name);
  const ranges = db.settings?.awayRanges || [];
  const nights = Object.values(plannedNights(db));
  // The first date each name was planned: day-level nights, plus archived weeks with no day tail.
  const first = {};
  const note = (n, iso) => { const k = key(n); if (k && (!first[k] || iso < first[k])) first[k] = iso; };
  for (const nt of nights) for (const n of nt.names) note(n, nt.iso);
  for (const h of db.mealHistory || []) {
    const iso = typeof h?.archivedAt === "string" ? h.archivedAt.slice(0, 10) : null;
    if (iso) for (const n of h.meals || []) note(n, iso);
  }
  const since = addDaysISO(today, -RATE_WINDOW_DAYS);
  const recent = nights.filter(nt => nt.iso >= since && isCooked(nt.iso, today, hour)).sort((a, b) => a.iso.localeCompare(b.iso));
  const byName = new Map((db.meals || []).map(m => [key(m.name), m]));
  const per = new Map();   // meal id → { meal, nights }
  for (const nt of recent) for (const n of new Set(nt.names.map(key))) {
    const m = byName.get(n);
    if (!m) continue;
    if (!per.has(m.id)) per.set(m.id, { meal: m, nights: [] });
    per.get(m.id).nights.push(nt);
  }
  const out = [];
  for (const { meal, nights: ns } of per.values()) {
    const f = first[key(meal.name)];
    const tried = ns.some(nt => nt.iso === f) && !(meal.ratedAt && meal.ratedAt >= f);
    const home = family.filter(n => ns.some(nt => presentOn(nt.presence, ranges, n, nt.day, nt.iso)));
    const gaps = mealGapsAt(meal, home);
    if (!tried && !gaps.length) continue;
    const last = ns[ns.length - 1];
    out.push({ meal, tried, gaps, iso: last.iso, out: outOn(last, family, ranges), why: tried ? "First try" : `Missing ${gaps.join(", ")}` });
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso) || a.meal.name.localeCompare(b.meal.name));
}
