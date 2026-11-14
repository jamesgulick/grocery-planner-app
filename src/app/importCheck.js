// The import check (canvas board "Import check", decided 11/14): what loading a data file
// would change on this device, shown before every import (the data sheet's file and paste,
// the start-session paste). Pure: reads the device DB and the prepared import, writes
// nothing. The calendar rows (Calendar notes · Who's home · Time) always show; anything
// else that differs is listed after them as a problem, because a calendar re-import
// should change only the calendar.
import { abbrOfISO, presentOn, weekDates, extraDaysOf } from "../engine/assembleInputs.js";

const MONTH = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const md = iso => { const [, m, d] = iso.split("-").map(Number); return [MONTH[m - 1], d]; };
// Deep equality that ignores key order (an import refills settings defaults, reordering keys).
const stable = v => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
  : JSON.stringify(v ?? null);
const same = (a, b) => stable(a) === stable(b);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The plans' weeks, oldest first: [{ key, plan, start, end, dates: {dayKey: iso} }].
const weeksOf = db => ["current", "next"]
  .map(key => ({ key, plan: db?.plans?.[key] }))
  .filter(w => w.plan?.weekStartDate)
  .map(w => {
    const dates = weekDates(w.plan.weekStartDate, extraDaysOf(w.plan));
    const isos = Object.values(dates).sort();
    return { ...w, dates, start: isos[0], end: isos[isos.length - 1] };
  })
  .sort((a, b) => (a.start < b.start ? -1 : 1));

// "Nov 11–17", or "Nov 28–Dec 4" across a month.
export const rangeLabel = (start, end) => {
  const [m1, d1] = md(start), [m2, d2] = md(end);
  return m1 === m2 ? `${m1} ${d1}–${d2}` : `${m1} ${d1}–${m2} ${d2}`;
};

// Every planned date in either DB → { iso: { plan, day } } (the later-starting week wins).
const dayIndex = db => {
  const out = {};
  for (const w of weeksOf(db)) for (const [day, iso] of Object.entries(w.dates)) out[iso] = { plan: w.plan, day };
  return out;
};

// Day labels for a list of changed dates: "Wed", or "Wed Nov 19" when a weekday repeats.
const dayLabels = isos => {
  const abbrs = isos.map(abbrOfISO);
  const dup = abbrs.some((a, i) => abbrs.indexOf(a) !== i);
  return isos.map((iso, i) => (dup ? `${abbrs[i]} ${md(iso).join(" ")}` : abbrs[i]));
};
const MAX_LINES = 3;
const capLines = lines => (lines.length <= MAX_LINES ? lines : [...lines.slice(0, MAX_LINES - 1), `+${lines.length - MAX_LINES + 1} more`]);

// Up to three records by name ("Lasagna, Tacos"), else a count.
const MAX_NAMES = 3;
const namesOr = recs => (recs.length <= MAX_NAMES ? recs.map(r => r.name).join(", ") : String(recs.length));

function recordChanges(cur = [], inc = [], noun) {
  const byId = list => new Map(list.map(r => [r.id, r]));
  const c = byId(cur), n = byId(inc);
  const missing = cur.filter(r => !n.has(r.id));
  const added = inc.filter(r => !c.has(r.id));
  const edited = inc.filter(r => c.has(r.id) && !same(c.get(r.id), r));
  const lines = [];
  if (missing.length) lines.push(`${namesOr(missing)} missing`);
  if (added.length) lines.push(`${namesOr(added)} added`);
  if (edited.length) lines.push(`${edited.length} edited`);
  return lines.length ? { label: noun, lines, problem: true } : null;
}

/**
 * compareImport(device, incoming, { savedAt, asOf }) → {
 *   savedAt, counts: [{ label, n, change, problem }], rows: [{ label, lines, problem }],
 *   fresh,  // true when this device holds only the example data: nothing to compare against
 *   older,  // the file's data predates this device's last change
 * }
 * savedAt is the file's own save time (shown); asOf is when its data last changed.
 */
export function compareImport(device, incoming, { savedAt = null, asOf = null } = {}) {
  const fresh = !device || device._isSeed;
  const incWeeks = weeksOf(incoming);
  const countChange = (a, b) => {
    if (fresh) return { change: null, problem: false };
    const d = b - a;
    return { change: d === 0 ? "same" : d < 0 ? `${-d} fewer` : `${d} more`, problem: d < 0 };
  };
  const devPlans = weeksOf(device).length;
  const counts = [
    { label: "Meals", n: (incoming.meals || []).length, ...countChange((device?.meals || []).length, (incoming.meals || []).length) },
    { label: "Items", n: (incoming.ingredients || []).length, ...countChange((device?.ingredients || []).length, (incoming.ingredients || []).length) },
    { label: "Plans", n: incWeeks.length, change: incWeeks.map(w => rangeLabel(w.start, w.end)), problem: !fresh && incWeeks.length < devPlans },
  ];
  if (fresh) return { savedAt, counts, rows: [], fresh };

  const di = dayIndex(device), ni = dayIndex(incoming);
  const dates = [...new Set([...Object.keys(di), ...Object.keys(ni)])].sort();
  const field = (idx, iso, f) => { const e = idx[iso]; return e ? e.plan?.[f]?.[e.day] : undefined; };

  // Calendar notes: dates whose note differs.
  const noteDays = dates.filter(iso => (field(di, iso, "dayNotes") || "").trim() !== (field(ni, iso, "dayNotes") || "").trim());
  // Who's home: each person whose home/out resolves differently that night.
  const roster = (incoming.settings?.familyContacts || []).map(f => f.name).filter(Boolean);
  const homeChanges = [];
  const homeOn = (db, idx, name, iso) => presentOn(idx[iso]?.plan?.presence, db.settings?.awayRanges, name, idx[iso]?.day, iso);
  dates.filter(iso => ni[iso]).forEach(iso => {
    const changed = roster
      .filter(name => homeOn(device, di, name, iso) !== homeOn(incoming, ni, name, iso))
      .map(name => `${name} ${homeOn(incoming, ni, name, iso) ? "home" : "out"}`);
    if (changed.length) homeChanges.push({ iso, changed });
  });
  const homeLabels = dayLabels(homeChanges.map(h => h.iso));
  const homeLines = homeChanges.map((h, i) => `${homeLabels[i]}: ${h.changed.join(", ")}`);
  // Away dates are part of who's home (a calendar sync may add one): neutral, never amber.
  if (!same(device.settings?.awayRanges, incoming.settings?.awayRanges)) homeLines.push("away dates changed");
  // Time: dates whose time to cook differs.
  const timeDays = dates.filter(iso => ni[iso] && di[iso] && (field(di, iso, "timeLevels") || null) !== (field(ni, iso, "timeLevels") || null));
  const timeLabels = dayLabels(timeDays);
  const timeLines = timeDays.map((iso, i) => `${timeLabels[i]}: ${field(ni, iso, "timeLevels") || "not set"}`);

  const rows = [
    { label: "Calendar notes", lines: [noteDays.length ? plural(noteDays.length, "day") : "no change"] },
    { label: "Who's home", lines: homeLines.length ? capLines(homeLines) : ["no change"] },
    { label: "Time", lines: timeLines.length ? capLines(timeLines) : ["no change"] },
  ];

  // Anything outside the calendar: listed only when it differs, as a problem.
  const meals = recordChanges(device.meals, incoming.meals, "Meals");
  const items = recordChanges(device.ingredients, incoming.ingredients, "Items");
  const planned = dates.filter(iso => !same(field(di, iso, "mealPlan") || [], field(ni, iso, "mealPlan") || []));
  const LIST_FIELDS = ["checkedIds", "stapleFlags", "addedItems", "addedOff", "keptIds", "quantities"];
  const listChanged = ["current", "next"].some(k => LIST_FIELDS.some(f => !same(device.plans?.[k]?.[f], incoming.plans?.[k]?.[f])));
  // The caller fills the device's settings defaults as the import does, so a filled-in
  // default is not a change.
  const s1 = { ...(device.settings || {}), awayRanges: null };
  const s2 = { ...(incoming.settings || {}), awayRanges: null };
  const history = !same(device.mealHistory, incoming.mealHistory) || !same(device.planTail, incoming.planTail);
  for (const r of [
    meals, items,
    planned.length ? { label: "Planned meals", lines: [planned.length <= MAX_LINES ? dayLabels(planned).join(", ") : plural(planned.length, "day")], problem: true } : null,
    listChanged ? { label: "Shopping list", lines: ["changed"], problem: true } : null,
    !same(s1, s2) ? { label: "Settings", lines: ["changed"], problem: true } : null,
    history ? { label: "Past weeks", lines: ["changed"], problem: true } : null,
  ]) if (r) rows.push(r);

  const older = !!(asOf && device.dataChangedAt && new Date(asOf) < new Date(device.dataChangedAt));
  return { savedAt, counts, rows, fresh, older };
}
