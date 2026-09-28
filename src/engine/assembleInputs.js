/**
 * assembleInputs — app state → composeWeek's five inputs (REFACTOR B3), plus the
 * hardening wrapper around the call.
 *
 * composeWeek (./composeWeek.js) is the validated pure core and ships UNCHANGED. It
 * assumes fully-formed contract-v2.5 inputs. Everything that turns the app's stored
 * shapes into those inputs — and everything that guards against malformed data — lives
 * here, AROUND the core, so the core never has to change.
 *
 * Pure: no React, no localStorage, no ambient date. Node-runnable for offline checks.
 *
 * Every input problem is reported, never swallowed: each builder returns `notes`
 * ({property, severity, text} — the same shape as an engine Observation), and
 * runComposeWeek prepends them to the engine's own observations.
 */

// ── Dates (ISO YYYY-MM-DD, calendar arithmetic in UTC so no timezone can shift a day) ──

export const DAY_ABBRS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parseISO = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const addDaysISO = (iso, n) => new Date(parseISO(iso) + n * 86400000).toISOString().slice(0, 10);
export const abbrOfISO = (iso) => DAY_ABBRS[new Date(parseISO(iso)).getUTCDay()];

/** The 7 dates of a plan's week, keyed by day abbr. A week runs from its weekStartDate. */
export function weekDates(weekStartDate) {
  const out = {};
  for (let i = 0; i < 7; i++) { const iso = addDaysISO(weekStartDate, i); out[abbrOfISO(iso)] = iso; }
  return out;
}

// ── Time to cook (B1) ─────────────────────────────────────────────────────────────

export const TIME_LEVELS = ['none', 'some', 'much'];
/** UI default only — the engine reads the level, never the weekday. */
export const seedTimeLevel = (day) => (day === 'Sat' || day === 'Sun') ? 'much' : (day === 'Mon' || day === 'Tue') ? 'none' : 'some';

// ── Presence (B2) ─────────────────────────────────────────────────────────────────
// Who is home for dinner, per day × per person, for every roster member. Most specific
// layer wins: (1) presence[day][name], an explicit per-night toggle; (2) an away period
// ({name, from, to}, ISO, either end open) covering the date; (3) otherwise present.

export const inAwayRange = (ranges, name, dateISO) =>
  !!dateISO && (ranges || []).some((r) => r.name === name && (!r.from || dateISO >= r.from) && (!r.to || dateISO <= r.to));

export const presentOn = (presence, ranges, name, day, dateISO) => {
  const o = presence?.[day]?.[name];
  if (typeof o === 'boolean') return o;
  return !inAwayRange(ranges, name, dateISO);
};

// ── Meals ─────────────────────────────────────────────────────────────────────────

const ROTATIONS = ['in', 'manual', 'experimental'];
const EFFORTS = ['easy', 'medium', 'involved'];
const CADENCES = ['weekly', 'biweekly'];
const TEMPS = ['light', 'neutral', 'comfort'];
const COSTS = ['low', 'moderate', 'high'];
const PREF = { likes: 'like', like: 'like', dislikes: 'dislike', dislike: 'dislike' };

const strArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
const nameKey = (s) => String(s || '').trim().toLowerCase();

function normCarries(c) {
  if (!c || typeof c !== 'object') return undefined;
  const okWho = c.forWhom === 'followLikes' || c.forWhom === 'all'
    || (Array.isArray(c.forWhom) && c.forWhom.every((x) => typeof x === 'string'));
  const okDays = Number.isFinite(c.lastsDays) && c.lastsDays > 0;
  return okWho && okDays ? { forWhom: c.forWhom, lastsDays: c.lastsDays } : null; // null = present but malformed
}

/**
 * App meal records → contract `Meal[]`.
 *
 * The app's `type` is the single source of role (side → 'side'; dinner/takeout/batch/
 * remix → 'main'). Engine fields are read from the record (flat, contract names; a
 * corpus-style `facets` object is also accepted). Missing engine fields get the
 * contract's "absent" meaning; a meal with no `rotation` is treated as `in`.
 */
export function toEngineMeals(dbMeals) {
  const notes = [];
  const meals = [];
  const untagged = [];
  const ids = new Set((dbMeals || []).map((m) => m && m.id));

  for (const m of dbMeals || []) {
    if (!m || typeof m.id !== 'string' || !m.id || typeof m.name !== 'string' || !m.name.trim()) {
      notes.push({ property: 'input', severity: 'concern', text: `Skipped a meal record with no id or name` });
      continue;
    }
    const f = m.facets || {};
    const role = m.type === 'side' ? 'side' : 'main';
    if (!ROTATIONS.includes(m.rotation)) untagged.push(m.name);

    const meal = {
      id: m.id,
      name: m.name.trim(),
      role,
      form: strArray(m.form ?? f.form),
      service: strArray(m.service ?? f.service),
      experience: strArray(m.experience ?? f.experience),
      plate: strArray(m.plate ?? f.plate),
      rotation: ROTATIONS.includes(m.rotation) ? m.rotation : 'in',
      effort: EFFORTS.includes(m.effort) ? m.effort : 'medium',
      preferences: (m.preferences || [])
        .filter((p) => p && typeof p.person === 'string' && PREF[p.pref])
        .map((p) => ({ person: p.person, pref: PREF[p.pref] })),
    };
    if (CADENCES.includes(m.cadence)) meal.cadence = m.cadence;
    if (TEMPS.includes(m.tempAffinity)) meal.tempAffinity = m.tempAffinity;
    if (typeof m.grillable === 'boolean') meal.grillable = m.grillable;
    if (COSTS.includes(m.cost)) meal.cost = m.cost;
    if (m.soon === true) meal.soon = true;

    const carries = normCarries(m.carries);
    if (carries) meal.carries = carries;
    else if (carries === null) notes.push({ property: 'input', severity: 'concern', text: `"${meal.name}": leftovers data is malformed and was ignored` });

    if (role === 'main') {
      if (m.noSidesUnlessNeeded === true) meal.noSidesUnlessNeeded = true;
    } else {
      const pairs = strArray(m.pairsWith);
      const dangling = pairs.filter((id) => !ids.has(id));
      if (dangling.length) notes.push({ property: 'input', severity: 'info', text: `"${meal.name}" pairs with ${dangling.length} meal(s) no longer in the DB (ignored)` });
      if (pairs.length - dangling.length) meal.pairsWith = pairs.filter((id) => ids.has(id));
      const avoid = strArray(m.avoidPlate);
      if (avoid.length) meal.avoidPlate = avoid;
      if (m.substantial === true) meal.substantial = true;
    }
    meals.push(meal);
  }

  if (untagged.length) {
    notes.push({
      property: 'input', severity: 'info',
      text: `${untagged.length} meal(s) have no engine tags yet and are treated as in-rotation with a blank profile: ${untagged.slice(0, 5).join(', ')}${untagged.length > 5 ? ', …' : ''}`,
    });
  }
  return { meals, notes };
}

/** name → engine meal, for mapping the app's name-keyed plans onto ids. */
export const indexByName = (meals) => new Map(meals.map((m) => [nameKey(m.name), m]));

// ── Plates (REFACTOR C1) ──────────────────────────────────────────────────────────
// A plan's `mealPlan` stays the day's content (day abbr → meal NAMES) — every screen,
// the export and the family Shortcut read that. `plates` ANNOTATES it, per day:
//
//   plates[day] = { mainId, leftovers: string[],
//                   dishes: [{ name, mealId, role, carries?, source, why: Reason[] }] }
//   Reason = { factor, tier, role, visibility, text } — the engine's rationale items for
//   that dish at placement (C2 shows `always` ones by default, all of them in learn mode).
//
// dishes[i] describes mealPlan[day][i]. `carries` is SNAPSHOTTED when the dish is
// placed — that snapshot, never the meal's current tags, is what later weeks read as
// as-served leftovers (model requirement 3; integration rulings 3 and 6). `source` is
// "engine" (a composed main), "floor-fill" (a side covering someone who won't eat the
// main), "accompaniment" (a side that goes with the main) or "manual" (placed by hand).
// A day that has not been touched since plates existed has no entry: it is treated as
// pre-integration (no carries).

/** One stored meal record → the dish fields a plate snapshots (role, carries). */
export function placedFromMeal(dbMeal) {
  if (!dbMeal) return null;
  const [m] = toEngineMeals([dbMeal]).meals;
  if (!m) return null;
  const out = { mealId: m.id, role: m.role };
  if (m.carries) out.carries = { ...m.carries };
  return out;
}

const sameList = (a, b) => (a || []).length === (b || []).length && (a || []).every((x, i) => x === (b || [])[i]);

/**
 * Keep `plates` in step with a change to `mealPlan`. Days whose name list is unchanged
 * keep their plate as-is. A changed day is rebuilt: a dish keeps its entry if the same
 * name was already on that day (so its snapshot and reason survive a neighbour's edit);
 * `annotations[day]` (from a fill) supplies entries for engine-placed dishes; anything
 * else is a fresh "manual" entry snapshotted now. Leftover notes survive only while the
 * day's main is unchanged — they were worked out for that main.
 */
export function reconcilePlates(prevMealPlan = {}, nextMealPlan = {}, prevPlates = {}, dbMeals = [], annotations = {}) {
  const byName = new Map((dbMeals || []).map((m) => [nameKey(m.name), m]));
  const out = {};
  for (const [day, names] of Object.entries(nextMealPlan || {})) {
    if (!(names || []).length) continue;
    const prev = prevPlates[day];
    const ann = annotations[day];
    // Unchanged day: keep its plate — or keep it UNPLATED. A day placed before plates
    // existed must not acquire a snapshot just because a neighbour changed (ruling 3).
    if (!ann && sameList(prevMealPlan[day], names)) { if (prev) out[day] = prev; continue; }
    const pool = [...(prev?.dishes || [])];
    const dishes = names.map((n) => {
      const a = ann?.dishes?.find((d) => nameKey(d.name) === nameKey(n));
      if (a) return a;
      const k = pool.findIndex((d) => nameKey(d.name) === nameKey(n));
      if (k >= 0) return pool.splice(k, 1)[0];
      const base = placedFromMeal(byName.get(nameKey(n)));
      return { name: n, ...(base || { mealId: null, role: 'main' }), source: 'manual', why: [] };
    });
    const mainId = dishes.find((d) => d.role === 'main')?.mealId || null;
    const leftovers = ann ? (ann.leftovers || []) : (prev && prev.mainId === mainId ? prev.leftovers || [] : []);
    out[day] = { mainId, leftovers, dishes };
  }
  return out;
}

/**
 * composeWeek output → plate annotations for reconcilePlates, one per day that got
 * dishes. `dateOfDay` maps day abbr → ISO date. Each dish records why it is there (the
 * engine's rationale items for that day+meal, minus the day/meal keys); a side is "floor-fill" when the engine
 * placed it to cover someone who won't eat the main, else "accompaniment". A day's
 * carried-in leftovers (who is covered by what) become its `leftovers` notes.
 */
export function platesFromCompose(out, dateOfDay, dbMeals = []) {
  const byId = new Map((dbMeals || []).map((m) => [m.id, m]));
  const ann = {};
  for (const [abbr, iso] of Object.entries(dateOfDay || {})) {
    const placed = [...((out.week || {})[iso] || [])].sort((a, b) => (a.role === 'main' ? 0 : 1) - (b.role === 'main' ? 0 : 1));
    if (!placed.length) continue;
    const rat = (out.rationale || []).filter((r) => r.day === iso);
    ann[abbr] = {
      dishes: placed.map((p) => {
        const m = byId.get(p.mealId);
        if (!m) return null;
        const mine = rat.filter((r) => r.mealId === p.mealId);
        const carries = p.carries || placedFromMeal(m)?.carries;
        return {
          name: m.name, mealId: p.mealId, role: p.role,
          ...(carries ? { carries: { ...carries } } : {}),
          source: p.role === 'main' ? 'engine' : mine.some((r) => r.factor === 'floor-fill') ? 'floor-fill' : 'accompaniment',
          why: mine.map(({ factor, tier, role, visibility, text }) => ({ factor, tier, role, visibility, text })),
        };
      }).filter(Boolean),
      leftovers: rat.filter((r) => r.factor === 'carried-leftover-fill').map((r) => r.text),
    };
  }
  return ann;
}

/** A dish's reasons as Reason objects (plates from before C2 stored plain strings). */
export const reasonsOf = (dish) => (dish?.why || []).map((w) => (typeof w === 'string' ? { text: w, visibility: 'quiet' } : w));

/** A day's names → PlacedDish[]. Carries come ONLY from a matching plate snapshot. */
function placeDay(names, plate, byName, unknown) {
  const out = [];
  const pool = [...(plate?.dishes || [])];
  for (const n of names || []) {
    const k = pool.findIndex((d) => nameKey(d.name) === nameKey(n) && d.mealId);
    if (k >= 0) {
      const d = pool.splice(k, 1)[0];
      const dish = { mealId: d.mealId, role: d.role };
      if (d.carries) dish.carries = { ...d.carries };
      out.push(dish);
      continue;
    }
    const meal = byName.get(nameKey(n));
    if (!meal) { if (n) unknown.add(n); continue; }
    out.push({ mealId: meal.id, role: meal.role });   // pre-integration: no carries
  }
  return out;
}

// ── History ───────────────────────────────────────────────────────────────────────

/**
 * History = planTail (day-level, dated) + mealHistory (name-set recency), kept separate.
 *
 * Leftovers (carries) come ONLY from plate snapshots taken when a dish was placed:
 *  - INTEGRATION RULING 3: a day with no plate predates the new planner. It is mapped
 *    name→id (role from the current type) and feeds cadence/freshness only — carry-back
 *    reads the fridge as empty across that seam.
 *  - INTEGRATION RULING 6: a day placed under the new planner is read from its plate's
 *    snapshot, which is what counts a live week's leftovers when composing the next.
 *
 * `extraWeeks` are plans that precede the target week but haven't been archived yet —
 * e.g. the current week when composing next week. They are the most recent real history.
 */
export function buildHistory({ planTail = [], mealHistory = [], extraWeeks = [], byName, targetWeekStart }) {
  const notes = [];
  const unknown = new Set();
  let unplatedDays = 0;

  const tailWeek = (w) => {
    if (!w || !w.weekStartDate) return null;
    const dates = weekDates(w.weekStartDate);
    const days = {};
    for (const [abbr, names] of Object.entries(w.mealPlan || {})) {
      const iso = dates[abbr];
      if (!iso || (targetWeekStart && iso >= targetWeekStart)) continue;       // never the target week itself
      const plate = (w.plates || {})[abbr];
      if (!plate && (names || []).length) unplatedDays++;
      const placed = placeDay(names, plate, byName, unknown);
      if (placed.length) days[iso] = placed;
    }
    return { weekStartDate: w.weekStartDate, days };
  };

  const planTailOut = [...planTail, ...extraWeeks].map(tailWeek).filter(Boolean);

  const mealHistoryOut = (mealHistory || [])
    .filter((h) => h && typeof h.archivedAt === 'string')
    .map((h) => ({
      archivedAt: h.archivedAt.slice(0, 10),
      ids: [...new Set((h.ids || h.meals || []).map((n) => byName.get(nameKey(n))?.id).filter(Boolean))],
    }));

  if (unplatedDays) {
    notes.push({
      property: 'history', severity: 'info',
      text: `Leftover carry-back is unavailable for ${unplatedDays} past day(s) planned before the new planner (saved without leftovers data); they still count for variety and recency.`,
    });
  }
  if (unknown.size) {
    notes.push({ property: 'history', severity: 'info', text: `Past plans mention ${unknown.size} meal name(s) no longer in the DB (ignored): ${[...unknown].slice(0, 5).join(', ')}` });
  }
  return { history: { planTail: planTailOut, mealHistory: mealHistoryOut }, notes };
}

// ── Schedule ──────────────────────────────────────────────────────────────────────

/**
 * Schedule for one plan week. Presence is emitted as a COMPLETE name-keyed map per day
 * (every roster member, resolved through presentOn), so the engine's boundary check
 * never has to presume anyone present. Emits `timeLevel`, never the deprecated `time`.
 *
 * Weather comes from `forecastByDate` (ISO → {hi, pop}). A day with no forecast gets
 * NaN for both numbers: every engine comparison against NaN is false, so the day reads
 * weather-neutral and grilling is held back — the fail-safe. (null would NOT be safe:
 * it coerces to 0 and would read as a cold day.)
 */
export function buildSchedule({ weekStartDate, days, timeLevels = {}, presence = {}, awayRanges = [], roster = [], forecastByDate = {} }) {
  const notes = [];
  const dates = weekDates(weekStartDate);
  const noForecast = [];
  const out = days.map((abbr) => {
    const date = dates[abbr];
    const fc = forecastByDate[date];
    const hasFc = fc && Number.isFinite(fc.hi) && Number.isFinite(fc.pop);
    if (!hasFc) noForecast.push(abbr);
    const level = TIME_LEVELS.includes(timeLevels[abbr]) ? timeLevels[abbr] : seedTimeLevel(abbr);
    return {
      date,
      timeLevel: level,
      weather: hasFc ? { highF: fc.hi, popPercent: fc.pop } : { highF: NaN, popPercent: NaN },
      presence: Object.fromEntries(roster.map((name) => [name, presentOn(presence, awayRanges, name, abbr, date)])),
    };
  });
  if (noForecast.length) {
    notes.push({
      property: 'weather', severity: 'info',
      text: `No forecast for ${noForecast.join(', ')} — weather leans are off and grillable meals are held back those days.`,
    });
  }
  if (!roster.length) notes.push({ property: 'input', severity: 'concern', text: 'No family roster — nobody is checked for having something to eat.' });
  return { schedule: { roster: [...roster], days: out }, notes };
}

// ── Session state + config ──────────────────────────────────────────────────────────

/**
 * alreadyPlaced = what's on the target week's days now (hand-placed or accepted). Carries
 * come from the day's plate snapshot; a dish with no plate yet (placed before the new
 * planner) carries its meal's current tags, since this is the week being served now
 * (integration ruling 6). seenThisSession is carried unchanged (session-local by design).
 */
export function buildSessionState({ mealPlan = {}, plates = {}, weekStartDate, byName, seenThisSession = [] }) {
  const dates = weekDates(weekStartDate);
  const unknown = new Set();
  const alreadyPlaced = {};
  for (const [abbr, names] of Object.entries(mealPlan)) {
    const iso = dates[abbr];
    if (!iso) continue;
    const plate = plates[abbr];
    const placed = plate
      ? placeDay(names, plate, byName, unknown)
      : (names || []).map((n) => byName.get(nameKey(n)) || (n && unknown.add(n), null)).filter(Boolean)
          .map((m) => ({ mealId: m.id, role: m.role, ...(m.carries ? { carries: { ...m.carries } } : {}) }));
    if (placed.length) alreadyPlaced[iso] = placed;
  }
  const notes = unknown.size
    ? [{ property: 'input', severity: 'info', text: `This week has ${unknown.size} entry(ies) that aren't meals in the DB, so the engine can't see them: ${[...unknown].join(', ')}` }]
    : [];
  return { sessionState: { seenThisSession: [...seenThisSession], alreadyPlaced }, notes };
}

export const buildConfig = ({ grillOpen, adventurousWeek, today, weekStartDate }) => ({
  grillOpen: grillOpen !== false,
  adventurousWeek: !!adventurousWeek,
  today,
  weekStartDate,
});

// ── One call from app state ─────────────────────────────────────────────────────────

/**
 * Everything composeWeek needs for the plan in slot `planKey` ("current" | "next"),
 * from the app DB. `plan` may be the live-editing copy (PlanTab's state) rather than the
 * stored one. `today` is passed in (local date) — nothing here reads the clock.
 */
export function assembleComposeInputs({ db, planKey, plan, forecastByDate = {}, seenThisSession = [], today, days, onlyDays }) {
  const settings = db.settings || {};
  const target = plan || db.plans?.[planKey];
  if (!target || !target.weekStartDate) throw new Error('assembleComposeInputs: no plan with a weekStartDate');

  const m = toEngineMeals(db.meals);
  const byName = indexByName(m.meals);
  // onlyDays restricts the schedule (the week CHECK passes just the planned days, so the
  // engine never invents plates for empty ones).
  const order = (days || Object.keys(weekDates(target.weekStartDate))).filter((d) => !onlyDays || onlyDays.includes(d));

  // Any other plan that starts BEFORE the target is still-unarchived recent history.
  const other = planKey === 'next' ? db.plans?.current : null;
  const extraWeeks = other && other.weekStartDate && other.weekStartDate < target.weekStartDate ? [other] : [];

  const h = buildHistory({ planTail: db.planTail || [], mealHistory: db.mealHistory || [], extraWeeks, byName, targetWeekStart: target.weekStartDate });
  const s = buildSchedule({
    weekStartDate: target.weekStartDate, days: order,
    timeLevels: target.timeLevels, presence: target.presence,
    awayRanges: settings.awayRanges, roster: (settings.familyContacts || []).map((f) => f.name),
    forecastByDate,
  });
  const ss = buildSessionState({ mealPlan: target.mealPlan, plates: target.plates, weekStartDate: target.weekStartDate, byName, seenThisSession });
  const config = buildConfig({ grillOpen: settings.grillOpen, adventurousWeek: target.adventurousWeek, today, weekStartDate: target.weekStartDate });

  return {
    args: [m.meals, h.history, s.schedule, ss.sessionState, config],
    notes: [...m.notes, ...h.notes, ...s.notes, ...ss.notes],
    byName,
  };
}

/**
 * WEEK CHECK (REFACTOR C2): the week-shape observations for the plan AS IT STANDS —
 * recommended and hand-placed together — without changing it.
 *
 * Only the planned days are scheduled, so empty days are never invented. One engine
 * behaviour to be honest about: composeWeek completes a planned day that has a main
 * but no sides (and picks a main for a day that has only sides), and its floor
 * observation counts what it added. The dishes the check added come back as
 * `assumed[day]` (the UI names them), and — INTEGRATION RULING 7 — any day whose
 * floor depended on one is reported as a floor CONCERN, replacing the engine's "ok".
 * This is the ruled stopgap; the real fix is an engine evaluate-only mode (routed to
 * the contract chat), at which point this adjustment goes away.
 */
export function checkWeek(composeWeek, { db, planKey, plan, forecastByDate = {}, today, days }) {
  const planned = (days || []).filter((d) => (plan?.mealPlan?.[d] || []).length);
  if (!planned.length) return { planned: 0, observations: [], assumed: {}, leftovers: {} };
  const dates = weekDates(plan.weekStartDate);
  const { args, notes } = assembleComposeInputs({ db, planKey, plan, forecastByDate, seenThisSession: [], today, days, onlyDays: planned });
  const out = runComposeWeek(composeWeek, args, notes);
  const byId = new Map(args[0].map((m) => [m.id, m]));
  const assumed = {}, leftovers = {};
  const asBuiltGaps = [];
  for (const d of planned) {
    const iso = dates[d];
    const onPlan = new Set(((args[3].alreadyPlaced || {})[iso] || []).map((p) => p.mealId));
    const extra = ((out.week || {})[iso] || []).filter((p) => !onPlan.has(p.mealId));
    if (extra.length) {
      assumed[d] = extra.map((p) => {
        const mine = (out.rationale || []).filter((r) => r.day === iso && r.mealId === p.mealId);
        const floorFill = mine.find((r) => r.factor === 'floor-fill');
        const name = byId.get(p.mealId)?.name || p.mealId;
        // INTEGRATION RULING 7 (stopgap): the floor must be judged on the plate AS BUILT.
        // When the check had to add a dish to hold someone's floor on a planned day, that
        // day's floor is NOT held as planned — a concern, with the engine's fix offered.
        // Coverage is the engine's own finding (its floor-fill reason, or its having to
        // pick a main); nothing about the floor is computed here.
        if (floorFill) asBuiltGaps.push(`On ${iso} as planned, someone present has nothing they'll eat — adding ${name} would fix it (${floorFill.text}).`);
        else if (p.role === 'main') asBuiltGaps.push(`On ${iso} there's no main yet, so whether everyone is fed depends on one — the check assumed ${name}.`);
        return { name, role: p.role, floorFill: !!floorFill, why: mine.map((r) => r.text) };
      });
    }
    const lo = (out.rationale || []).filter((r) => r.day === iso && r.factor === 'carried-leftover-fill').map((r) => r.text);
    if (lo.length) leftovers[d] = lo;
  }
  let observations = out.observations || [];
  if (asBuiltGaps.length) {
    // The engine's "floor ok" counted dishes that aren't on the plan — drop it.
    observations = [
      ...asBuiltGaps.map((text) => ({ property: 'floor', severity: 'concern', text })),
      ...observations.filter((o) => !(o.property === 'floor' && o.severity === 'ok')),
    ];
  }
  return { planned: planned.length, observations, assumed, leftovers };
}

/**
 * The hardened call. Never throws: an engine error comes back as an empty result with a
 * `concern` observation, and the input notes are prepended to the engine's observations
 * so problems in the data are visible in the same stream.
 */
export function runComposeWeek(composeWeek, args, notes = []) {
  const [, , , sessionState] = args;
  try {
    const out = composeWeek(...args);
    return { ...out, observations: [...notes, ...(out.observations || [])] };
  } catch (e) {
    return {
      week: {},
      sessionState,
      observations: [...notes, { property: 'engine', severity: 'concern', text: `The planner hit an error and changed nothing: ${e && e.message ? e.message : e}` }],
      rationale: [],
    };
  }
}
