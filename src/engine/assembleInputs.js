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

/** A day's stored names → PlacedDish[], with the given carries policy. */
function placeNames(names, byName, withCarries, unknown) {
  const out = [];
  for (const n of names || []) {
    const meal = byName.get(nameKey(n));
    if (!meal) { if (n) unknown.add(n); continue; }
    const dish = { mealId: meal.id, role: meal.role };
    if (withCarries && meal.carries) dish.carries = { ...meal.carries };
    out.push(dish);
  }
  return out;
}

// ── History ───────────────────────────────────────────────────────────────────────

/**
 * History = planTail (day-level, dated) + mealHistory (name-set recency), kept separate.
 *
 * INTEGRATION RULING 3 (9/28): carries are recorded AS SERVED and never re-derived. The
 * app's pre-integration tail is name-keyed with no carries, so those weeks are mapped
 * name→id (role from the current type) and feed cadence/freshness ONLY — carry-back reads
 * the fridge as empty across that seam. A tail week that already carries dated PlacedDish
 * `days` (stored at commit, post-integration) is passed through as-served.
 *
 * `extraWeeks` are plans that precede the target week but haven't been archived yet —
 * e.g. the current week when composing next week. They are the most recent real history.
 */
export function buildHistory({ planTail = [], mealHistory = [], extraWeeks = [], byName, targetWeekStart }) {
  const notes = [];
  const unknown = new Set();
  let nameOnlyWeeks = 0;

  const tailWeek = (w, isExtra) => {
    if (!w || !w.weekStartDate) return null;
    if (w.days && typeof w.days === 'object') {
      return { weekStartDate: w.weekStartDate, days: w.days };                  // as-served, pass through
    }
    const dates = weekDates(w.weekStartDate);
    const days = {};
    for (const [abbr, names] of Object.entries(w.mealPlan || {})) {
      const iso = dates[abbr];
      if (!iso || (targetWeekStart && iso >= targetWeekStart)) continue;       // never the target week itself
      const placed = placeNames(names, byName, isExtra, unknown);
      if (placed.length) days[iso] = placed;
    }
    if (!isExtra) nameOnlyWeeks++;
    return { weekStartDate: w.weekStartDate, days };
  };

  const planTailOut = [
    ...planTail.map((w) => tailWeek(w, false)),
    ...extraWeeks.map((w) => tailWeek(w, true)),
  ].filter(Boolean);

  const mealHistoryOut = (mealHistory || [])
    .filter((h) => h && typeof h.archivedAt === 'string')
    .map((h) => ({
      archivedAt: h.archivedAt.slice(0, 10),
      ids: [...new Set((h.ids || h.meals || []).map((n) => byName.get(nameKey(n))?.id).filter(Boolean))],
    }));

  if (nameOnlyWeeks) {
    notes.push({
      property: 'history', severity: 'info',
      text: `Leftover carry-back is unavailable for ${nameOnlyWeeks} week(s) from before the new planner (they were saved without leftovers data); those weeks still count for variety and recency.`,
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
 * alreadyPlaced = what's on the target week's days now (hand-placed or accepted). These
 * are being served THIS week, so their current tags are their as-served tags: carries
 * are snapshotted. seenThisSession is carried unchanged (session-local by design).
 */
export function buildSessionState({ mealPlan = {}, weekStartDate, byName, seenThisSession = [] }) {
  const dates = weekDates(weekStartDate);
  const unknown = new Set();
  const alreadyPlaced = {};
  for (const [abbr, names] of Object.entries(mealPlan)) {
    const iso = dates[abbr];
    if (!iso) continue;
    const placed = placeNames(names, byName, true, unknown);
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
export function assembleComposeInputs({ db, planKey, plan, forecastByDate = {}, seenThisSession = [], today, days }) {
  const settings = db.settings || {};
  const target = plan || db.plans?.[planKey];
  if (!target || !target.weekStartDate) throw new Error('assembleComposeInputs: no plan with a weekStartDate');

  const m = toEngineMeals(db.meals);
  const byName = indexByName(m.meals);
  const order = days || Object.keys(weekDates(target.weekStartDate));

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
  const ss = buildSessionState({ mealPlan: target.mealPlan, weekStartDate: target.weekStartDate, byName, seenThisSession });
  const config = buildConfig({ grillOpen: settings.grillOpen, adventurousWeek: target.adventurousWeek, today, weekStartDate: target.weekStartDate });

  return {
    args: [m.meals, h.history, s.schedule, ss.sessionState, config],
    notes: [...m.notes, ...h.notes, ...s.notes, ...ss.notes],
    byName,
  };
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
