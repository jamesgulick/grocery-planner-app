/**
 * composeWeek — the week-composition meal-recommendation engine.
 *
 * ONE pure function. No React, no localStorage, no ambient state. Built and validated
 * OFFLINE against the tagged corpus, then wired into the app UNCHANGED (Option B — the
 * validated artifact and the shipped artifact are the same code).
 *
 * Authorities:
 *   - SHAPE/TYPES : CONTRACT-composeWeek.md v2.3 (LOCKED)
 *   - BEHAVIOR    : MODEL-week-composition.md
 *   - FACET VALUES: FACET-VOCABULARY.md (validated, never rejected — see validateFacets)
 *
 * The priority stack is STRICT LEXICOGRAPHIC, no cross-tier coefficients:
 *   floor > spacing (form/service) > soon > freshness/cadence > leans > seeded tie-break
 * Tiers are implemented as successive FILTERS over the candidate pool, so a lower tier
 * only ever chooses among candidates the higher tiers left tied. Cadence is bucketed
 * (not a continuous score) precisely so the leans below it can still act.
 *
 * There are NO tunable weights. The numbers in CONSTANTS are fixed thresholds and fixed
 * soft-combination magnitudes — validation tunes them once or twice and leaves them.
 */

/**
 * @typedef {{forWhom: 'followLikes'|'all'|string[], lastsDays: number}} Carries
 * @typedef {{person: string, pref: 'like'|'dislike'}} Preference
 * @typedef {{
 *   id: string, name: string, role: 'main',
 *   carries?: Carries,
 *   form: string[], service: string[], experience: string[], plate: string[],
 *   cadence?: 'weekly'|'biweekly',
 *   rotation: 'in'|'manual'|'experimental',
 *   effort: 'easy'|'medium'|'involved',
 *   preferences: Preference[],
 *   tempAffinity?: 'light'|'neutral'|'comfort',
 *   grillable?: boolean,
 *   noSidesUnlessNeeded?: boolean,
 *   soon?: boolean,
 *   cost?: 'low'|'moderate'|'high'
 * }} MainMeal
 * @typedef {{
 *   id: string, name: string, role: 'side',
 *   carries?: Carries,
 *   form: string[], service: string[], experience: string[], plate: string[],
 *   rotation: 'in'|'manual'|'experimental',
 *   cadence?: 'weekly'|'biweekly',
 *   preferences: Preference[],
 *   pairsWith?: string[], avoidPlate?: string[],
 *   soon?: boolean,
 *   effort: 'easy'|'medium'|'involved',
 *   grillable?: boolean,
 *   tempAffinity?: 'light'|'neutral'|'comfort',
 *   substantial?: boolean,
 *   cost?: 'low'|'moderate'|'high'
 * }} SideMeal
 * @typedef {MainMeal|SideMeal} Meal
 * @typedef {{mealId: string, role: 'main'|'side', carries?: Carries}} PlacedDish
 * @typedef {{weekStartDate: string, days: Record<string, PlacedDish[]>}} HistoryWeek
 * @typedef {{planTail: HistoryWeek[], mealHistory: {archivedAt: string, ids: string[]}[]}} History
 * CONTRACT v2.4 makes the day's time signal a UNION: a day carries EITHER `timeLevel` OR
 * the legacy `time` boolean, never both, so `{ time: false, timeLevel: 'much' }` is
 * unconstructable. `timeLevel` is preferred; `time` is deprecated but still valid, and the
 * legacy arm cannot express 'some' — a v2.3 caller simply never had that level.
 * @typedef {{timeLevel: 'none'|'some'|'much', time?: never}
 *         | {time: boolean, timeLevel?: never}} DayTime
 * @typedef {DayTime & {date: string,
 *            weather: {highF: number, popPercent: number},
 *            presence: Record<string, boolean>}} DaySchedule
 * @typedef {{roster: string[], days: DaySchedule[]}} Schedule
 * @typedef {{seenThisSession: string[], alreadyPlaced: Record<string, PlacedDish[]>}} SessionState
 * @typedef {{grillOpen: boolean, adventurousWeek: boolean, today: string, weekStartDate: string}} Config
 * @typedef {{property: string, severity: 'ok'|'info'|'concern', text: string}} Observation
 * @typedef {{day: string, mealId: string, factor: string,
 *            tier: 'gate'|'floor'|'spacing'|'freshness-cadence'|'lean',   // stack order, highest first
 *            role: 'gate'|'decisive'|'lean',
 *            visibility: 'quiet'|'always', text: string}} RationaleItem
 * @typedef {{week: Record<string, PlacedDish[]>, sessionState: SessionState,
 *            observations: Observation[], rationale: RationaleItem[]}} ComposeWeekOutput
 */

/**
 * Fixed constants. Per the contract these live INSIDE the implementation (they never vary
 * per call, so they are not Config fields). Exported only so the harness can display and
 * A/B them during validation.
 */
export const CONSTANTS = {
  // --- weather ---
  // Widened on review evidence (James, 9/13). At 82/55 the neutral dead zone spanned
  // 56-81F — most of the year — so `tempAffinity` was inert almost always: chili (comfort)
  // drew no objection at 74F and egg salad (light) none at 66F, both of which James marked
  // wrong. Narrowing the dead zone to 69-71F makes both fire. Only the 11 meals tagged
  // light/comfort are affected at all; the 36 tagged neutral never lean either way.
  // NOTE these numbers no longer read as "hot" and "cold" in plain English — they are
  // "warmer / cooler than a neutral evening". See engine/README.md.
  HOT_F: 72,
  COLD_F: 68,
  GRILL_MIN_F: 70,
  GRILL_MAX_POP: 35,

  // --- spacing (tier 2) ---
  // How many days apart two dishes must be before a shared `form` / rare `service` value
  // stops counting as a clash. 1 = strictly adjacent days.
  // Set to 2 on harness evidence: at 1, `smorgasbord` (the modal form, 12/48) alternates
  // every other night, and James's three-pork critique — Pork loin and Pork ribs two days
  // apart, both form:plated-entree — goes unnoticed. At 2 both resolve and the pool is
  // still large enough that no week needs its spacing relaxed. Tunable.
  // Widened 2 -> 3 on review evidence: lasagna (Wed) and ziti casserole (Sat) share
  // form:casserole and landed 3 days apart, which James flagged as two dishes that clash in
  // one week. At 2 the window could not see them.
  SPACING_ADJACENCY_DAYS: 3,
  // Breaks a floor-fill tie toward the side that does not clash with the plate. Must stay
  // below 1.0 so it can never outweigh covering an additional person.
  FLOOR_FILL_CLASH_DEMERIT: 0.25,
  // How many times one tag must be the SOLE cause of a block before it is worth naming.
  SOLE_CAUSE_REPORT_MIN: 2,

  // --- FORWARD-CARRY SEQUENCING (James, 9/13 — "the sequencing that most makes a week
  // feel like mine"). Placement used to be purely reactive: a dislike-night was cheap
  // because a floor-fill side could always patch it afterwards. These two leans make it
  // ANTICIPATORY, and they work as a pair —
  //   the demerit makes a dislike-night expensive UNLESS an earlier carry already covers
  //   that person, and the lean makes carriers want to land early. Together they produce
  //   carrier-first, dislike-after: tortellini Wednesday, meatloaf Thursday.
  LEAN_DISLIKE_NIGHT_UNBACKED: -1.25,  // per person left uncovered with no carry behind them
  LEAN_CARRIER_EARLY: 0.75,            // a carry that reaches someone who eats it later
  CARRIER_LOOKAHEAD_DAYS: 4,           // how far ahead a carry is credited with reaching

  // --- CONSECUTIVE-INVOLVED FATIGUE. Effort-load was week-level with no adjacency; two
  // hard nights back to back is worse than the same two spread out. Soft, never a gate.
  LEAN_INVOLVED_BACK_TO_BACK: -1.0,

  // --- THREE TIME LEVELS (office / WFH / weekend-ish). `involved` unlocks only on a
  // much-time day: "even though I WFH Wednesday, I still don't have as much time as the
  // weekend." The three levels behave distinctly, mirroring the three effort values.
  LEAN_EASY_ON_NO_TIME: 0.5,
  LEAN_EASY_ON_SOME_TIME: 0.25,
  LEAN_MEDIUM_ON_NO_TIME: -0.25,
  // EFFORT-SYMMETRY RULING (model, 9/26). A much-time day UNLOCKED involved meals but never
  // FAVOURED them, so "I have time for a project" opened a door nobody walked through:
  // involved mains won ~23% of weekend slots and 6 of 9 were effectively unreachable, losing
  // to a cadence-tagged easy/medium meal's pull on the one night they were even eligible.
  // The gate was only half the mechanism; this is the other half.
  //
  // FLAT, and the SAME magnitude as the easy-lean — the model requires both. Scaling by
  // effort would add a gradient the easy side doesn't have and break the symmetry that
  // justifies the lean. It mirrors LEAN_EASY_ON_NO_TIME specifically (the model pairs
  // easy-lean↔no-time with involved-lean↔much-time); the 0.25 `some` value is an
  // intermediate of the three-level build, not the canonical easy-lean.
  // RULING 4 (model, 9/27) SUPERSEDES the 9/26 "same magnitude as the easy-lean" clause.
  // Measurement supplied the justification to differ: at the symmetric 0.5 the lean reached
  // only 29% of weekend slots and left three cooking projects never placing across 26 weeks.
  // The two leans do different JOBS — the easy-lean nudges among meals that would place
  // anyway; the involved-lean is the ONLY thing making 7-of-9 blank involved mains reachable.
  // James: "if there is a slot available to spend more time cooking, I should take advantage
  // of that opportunity." Raised to 1.0; the easy-lean is unchanged at 0.5.
  LEAN_INVOLVED_ON_MUCH_TIME: 1.0,

  // --- COST (James, 9/13). A meal property, orthogonal to service — NOT a night-type.
  // Absent = sunk into the weekly groceries, which is most meals. Cost-pressure SPACES the
  // bought meals, it never minimises them: the week must still yield James's rest nights,
  // so cost, effort and freshness must not conspire into an all-cooking week. A balancing
  // force, not a suppressor — hence a demerit that only bites once several tagged-cost
  // meals are already close together, and no quota matrix anywhere.
  COST_LOOKBACK_DAYS: 7,
  // CALIBRATED TO FREQUENCY, NOT SPEND (James, 9/13): "one bought meal a week is common,
  // two is occasional, three is unusual." So pressure keys on the COUNT of bought meals in
  // the window, and cost only modulates how hard it pushes. Keying on accumulated spend
  // was wrong: a single dine-out weighed 2 and tripped the old threshold on its own, which
  // pushed back on something James says is ordinary.
  COST_COMMON_COUNT: 1,            // the first bought meal of the window is never pushed back
  LEAN_COST_SECOND_BOUGHT: -0.4,   // occasional — noticeable, easily overcome
  LEAN_COST_THIRD_BOUGHT: -1.25,   // unusual — real resistance
  // Relative dearness, applied as a multiplier on the leans above (moderate = 1x). `low`
  // is CHEAP, NOT FREE: a pizza night is still money spent, so it both counts toward the
  // week's tally and takes a (small) share of the push when it is the second or third.
  //
  // MEASURED, not guessed (James, 9/13): roughly $50 a pizza night, $100 takeout, $200
  // dining out — which normalises to 0.5 : 1 : 2 against takeout. If those prices drift,
  // this is the one line to change, and the ratio is what matters, not the absolute scale.
  COST_WEIGHT: { low: 0.5, moderate: 1, high: 2 },
  // `service` spacing fires only on values OTHER than these. 40/48 meals are home-cooked;
  // a literal same-service rule would forbid two cooked nights in a row.
  SERVICE_SPACING_EXEMPT: ['home-cooked'],

  // --- freshness / cadence (tier 4), bucketed ---
  CADENCE_WEEKLY_DUE_DAYS: 7,
  CADENCE_WEEKLY_MIN_GAP_DAYS: 5,
  CADENCE_BIWEEKLY_DUE_DAYS: 14,
  CADENCE_BIWEEKLY_MIN_GAP_DAYS: 10,
  // Blank cadence = OCCASIONAL, but not forgotten (James, 9/20). No recurrence pull, just
  // ordinary anti-repeat — and this window is the ONLY variety mechanism a blank meal has,
  // since nothing cycles it the way a pull cycles a tagged meal.
  //
  // 21 -> 14 because the window is a FLOOR, not the felt interval: a meal becomes eligible
  // at the floor and then still has to win a slot, which adds ~12-14 days of queueing. At
  // 21 the felt median was 46 days, which reads as forgotten rather than occasional. At 14
  // it is ~25 days, with nothing repeating inside a fortnight. (Measured both on today's
  // corpus and on a mostly-blank one; the queueing overhead grows as more meals are
  // tagged, so this number should be re-checked after any large retag.)
  UNTAGGED_ANTI_REPEAT_DAYS: 14,
  // A blank meal unseen this long is drifting toward forgotten — surfaced so James can
  // give it a cadence or place it by hand. Roughly twice the expected felt interval.
  NEGLECTED_AFTER_DAYS: 56,

  // --- soft leans (tier 5), combined by a FIXED rule: a sum of small fixed nudges ---
  LEAN_LIKE: 1.0,             // binary (a present liker exists), never a summed headcount
  LEAN_EASY_ON_BUSY_DAY: 0.5,
  LEAN_WEATHER_FIT: 0.75,
  LEAN_WEATHER_MISFIT: -0.75,
  LEAN_SIDE_PAIRS_WITH: 3.0,  // accompaniment scoring only
  LEAN_SIDE_LIKED_BY_GAPPED: 0.5,
  // CADENCE FIX (James, 9/13): too-soon stays HARD, due-ness becomes SOFT. Previously
  // due-ness was a bucket rank, and because the bucket filter keeps only the best rank, a
  // due meal eliminated every untagged one — 0 of 3 cadence-less mains were ever placed
  // across 84 dinners, and no experimental meal could ever surface. The model's own words:
  // cadence is "tie-break-ish", untagged is the "deep-rotation default" with NO pull —
  // which must mean neutral, not always-loses. So the bucket now only says too-soon vs
  // eligible, and the recurrence PULL lives down here as a nudge.
  // RULING 3 (model, 9/27): the weekly-due pull must EXCEED LEAN_LIKE so a due meal
  // outranks a merely-liked one. A PRECEDENCE fix, not an interval mandate — "weekly"
  // remains a (block, pull) pair, not a 7-day scheduler. 1.25 is the minimum value that
  // clears LEAN_LIKE (1.0) WITHOUT raising the band: it ties the existing largest leans,
  // so LEAN_BAND stays 1.25 rather than widening to re-absorb the increase.
  // ⚠ GUARDRAIL (James): this balance breaks above ~7 weekly-tagged mains all pulling to
  // recur every 7 days — that crowds the week and kills variety. Currently 6. Watch it.
  LEAN_CADENCE_WEEKLY_DUE: 1.25,
  LEAN_CADENCE_BIWEEKLY_DUE: 0.5,   // biweekly is the softer pull of the two
  // How far below the best soft score a candidate may sit and still be drawn from. This is
  // what makes the bottom tier genuinely SOFT and gives the seeded tie-break real work.
  //
  // GOVERNED, NOT GUESSED (model ruling, 9/26): the band = THE LARGEST SINGLE SOFT LEAN in
  // the stack. Rationale — no ONE signal should eliminate a candidate by itself (that is the
  // filter behaviour being removed), but TWO converging signals should. That boundary is
  // exactly the largest single lean.
  //
  // Today that is 1.25 (LEAN_DISLIKE_NIGHT_UNBACKED and LEAN_COST_THIRD_BOUGHT tie), down
  // from the interim 1.5 which absorbed every individual lean and left weekly meals at a
  // 15d median against a 7d claim.
  //
  // "Largest single lean" means BASE magnitudes, not maximum realized. Two leans deliberately
  // escalate past the band — weekly-due reaches 4.0 when badly overdue, cost-third reaches
  // 2.5 on a high-cost meal — and the model states that an overdue meal's pull "grows so it
  // can climb out of the LEAN_BAND". Reading it as maxima would set the band at 4.0, wider
  // than the value the ruling was correcting.
  //
  // ⚠ RECALCULATE THIS if any lean magnitude changes. It is derived, not independent.
  LEAN_BAND: 1.25,
  // Cap on the escalating recurrence pull, in multiples of the due interval.
  CADENCE_OVERDUE_MAX: 4,

  // --- plate composition ---
  MAX_ACCOMPANIMENT_SIDES: 2,
  MAX_ACCOMPANIMENT_SIDES_INVOLVED_MAIN: 1,
  // An involved main consumes the day's cooking capacity: only easy sides get suggested.
  INVOLVED_MAIN_SIDE_EFFORTS: ['easy'],
  // INTERPRETATION (flagged for review): the model says "takeout suppresses sides — no
  // sides generate". Taken literally that could drop the floor on a takeout night, and the
  // floor is the one thing never sacrificed. So accompaniment is always suppressed on a
  // takeout/dine-out night, but a floor-fill side may still be added when someone present
  // is genuinely uncovered. Flip this to true for the strict literal reading.
  SUPPRESS_SIDES_ON_TAKEOUT_EVEN_FOR_FLOOR: false,
  SERVICE_REST_NIGHT: ['takeout', 'dine-out'],
  // RULED (model RULING 5 / contract v2.5, 9/27) — do NOT "fix" this into sibling
  // suppression. `avoidPlate` suppresses an accompaniment against the COMMITTED plate
  // (the main plus any floor-fills), and sibling accompaniments do NOT suppress each
  // other: two mutually-`avoidPlate` accompaniments may both be surfaced for James to
  // choose between. That is surfaced-not-gated — the flag exists to stop the ENGINE
  // building an ugly plate on its own authority, not to narrow James's options.
  //   The behaviour falls out of the pass structure: `eligibleForAccompaniment()` is
  // evaluated ONCE, before any accompaniment is pushed, so `plateTraits()` sees the main
  // and the floor-fills and never a sibling. This was originally an unintended batch-vs-
  // sequential divergence from the v2.4 wording; James ruled the output correct and the
  // contract was amended to match. Setting this false narrows the check to the main alone.
  AVOID_PLATE_CHECKS_WHOLE_PLATE: true,
  // Accompaniment requires a real affinity signal (`pairsWith`), never a bare like-lean.
  // Attraction is SPECIFIC — without this, almost every side clears a positive lean and
  // the plate becomes the "menu of five deletable sides" the model warns against.
  ACCOMPANIMENT_REQUIRES_AFFINITY: true,

  // THE TWO-JOBS SPLIT (James, 9/10) — cadence-freshness applies to ACCOMPANIMENT sides
  // and is IGNORED for FLOOR-FILL. A repeated NICETY goes stale and nothing forces it, so
  // don't re-suggest caesar salad the night after it appeared. A side summoned by NEED is
  // different: never withhold someone's only acceptable option because they had it
  // recently — floor beats freshness. (Note this was a separate decision, not something
  // v2.3's shared `cadence` field implied on its own.)
  //   'hard' — drop cadence-too-soon candidates before affinity ranking
  //   'soft' — surface them carrying a staleness label; a strong affinity can still win
  //   'off'  — the pre-9/10 behaviour (cadence was only a 0.25 lean)
  // SOFT is the default (James, 9/12): surfaced-not-gated. A stale nicety is offered with
  // "served N days ago" attached so James can delete it knowingly, rather than silently
  // withheld. NOT LOCKED — a tuning knob for output review.
  ACCOMPANIMENT_CADENCE_MODE: 'soft',
  // 'soft' mode demerit. NOTE (harness finding): its MAGNITUDE is currently inert. With
  // ACCOMPANIMENT_REQUIRES_AFFINITY the candidate filter is affinity-PRESENCE, not score,
  // and a slot almost never has two affinity candidates contesting it — so a lone
  // too-soon side wins its slot whatever it scores. -2.0 and -3.5 produce identical
  // weeks. Magnitude starts to matter once more sides carry overlapping `pairsWith`.
  LEAN_SIDE_CADENCE_TOO_SOON: -2.0,

  // --- observations ---
  THIN_HISTORY_WEEKS: 3,      // below this many prior weeks, cadence/freshness is degraded
  EFFORT_LOAD_CONCERN: 3,     // involved mains in one week before it reads as heavy
  COMBINATORIALITY_THIN_POOL: 6, // median eligible mains/day below this = thin rotation
};

const DAY_MS = 86400000;

/* ------------------------------------------------------------------ date helpers */
function toMs(iso) { const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, m - 1, d); }
function isoOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
/** days from `a` to `b` (positive when b is later) */
function daysBetween(a, b) { return Math.round((toMs(b) - toMs(a)) / DAY_MS); }
function addDays(iso, n) { return isoOf(toMs(iso) + n * DAY_MS); }

/* ------------------------------------------------------------------ seeded RNG
 * Randomness is the LOWEST layer (tie-break only). It is seeded from the call's own data
 * so the function stays pure and the harness stays reproducible — rerolls still vary,
 * because a rerolled meal lands in seenThisSession and is filtered out before the draw. */
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ small utils */
const uniq = (xs) => [...new Set(xs)];
const intersects = (a = [], b = []) => (a || []).some((x) => (b || []).includes(x));
function prefOf(meal, person) {
  const p = (meal.preferences || []).find((x) => x.person === person);
  return p ? p.pref : undefined;
}
const dislikes = (meal, person) => prefOf(meal, person) === 'dislike';
const likes = (meal, person) => prefOf(meal, person) === 'like';
/** A dish feeds a person unless they have declared they will not eat it. Absent = acceptable. */
const feeds = (meal, person) => !dislikes(meal, person);

/**
 * Can this dish hold someone's FLOOR?
 *
 * MODEL (⚑ ruling, side-matrix pass): "the engine draws FLOOR-FILL only from `substantial`
 * sides (a salad never 'rescues' a gapped person)." CONTRACT v2.4 `SideMeal.substantial`:
 * "Floor-fill draws ONLY from substantial sides… absent reads as not-substantial."
 *
 * So the test is `=== true`, NOT `!== false`: an untagged side is accompaniment-only. A main
 * is by definition a meal and is never gated by this.
 *
 * This governs three places that all ask the same question — whether a dish can feed a
 * gapped person: the floor-fill pool, the repairable-gap test during main selection, and
 * whether a side's leftovers count as coverage later.
 */
const canHoldFloor = (meal) => meal.role !== 'side' || meal.substantial === true;

/**
 * Is this dish in the RESERVE TANK — captured but never yet cooked?
 *
 * MODEL: "absent on an `experimental` meal = UNKNOWN, handled by the reserve tank, never
 * auto-placed to hold a floor — so 'unknown' never contaminates floor math", and
 * "Experimental meals are excluded from floor-guarantee reasoning (the engine never leans
 * on one to hold anyone's floor)."
 *
 * The distinction this encodes: a blank preference on an ORDINARY meal means "opinions
 * exist, nobody objected" and clears the floor; a blank preference on an experimental meal
 * means "nobody has tried it", which is not evidence of anything. Without this, a dish with
 * ZERO preferences reads as feeding EVERYONE and wins the floor tier against real meals
 * that have real, recorded gaps.
 */
const inReserve = (meal) => meal.rotation === 'experimental';

/** Does this week already hold an experimental main — drawn this call or hand-placed? */
function reserveAlreadyPlaced(ctx) {
  return Object.values(ctx.week).some((dishes) => dishes.some((d) => {
    const m = ctx.mealsById.get(d.mealId);
    return m && m.role === 'main' && inReserve(m);
  }));
}

/** Which tier-role a filter earned: it chose (decisive), narrowed (gate), or did nothing (lean). */
function tierRole(before, after) {
  if (before > 1 && after === 1) return 'decisive';
  if (after < before) return 'gate';
  return 'lean';
}

/* ================================================================== main entry */

/**
 * @param {Meal[]} meals
 * @param {History} history
 * @param {Schedule} schedule
 * @param {SessionState} sessionState
 * @param {Config} config
 * @returns {ComposeWeekOutput}
 */
export function composeWeek(meals, history, schedule, sessionState, config) {
  /** @type {Observation[]} */ const observations = [];
  /** @type {RationaleItem[]} */ const rationale = [];

  const ctx = buildContext(meals, history, schedule, sessionState, config, observations);

  // Days are composed in date order so each day can see what the previous ones landed on
  // (spacing and leftover carry-back both read forward from earlier placements).
  for (const day of ctx.days) {
    composeDay(day, ctx, rationale, observations);
  }

  emitWeekObservations(ctx, observations);

  return {
    week: ctx.week,
    sessionState: {
      seenThisSession: uniq([...(sessionState.seenThisSession || []), ...ctx.shownThisCall]),
      alreadyPlaced: ctx.week,
    },
    observations,
    rationale,
  };
}

/* ================================================================== context */

function buildContext(meals, history, schedule, sessionState, config, observations) {
  const mealsById = new Map(meals.map((m) => [m.id, m]));
  const roster = schedule.roster || [];
  const days = [...(schedule.days || [])].sort((a, b) => (a.date < b.date ? -1 : 1));

  // --- presence, validated at the boundary (name-keyed map vs roster) ------------
  for (const d of days) {
    const keys = Object.keys(d.presence || {});
    const missing = roster.filter((n) => !keys.includes(n));
    const extra = keys.filter((k) => !roster.includes(k));
    if (missing.length) {
      observations.push({
        property: 'presence',
        severity: 'concern',
        text: `Day ${d.date} presence keys don't match roster: missing ${missing.join(', ')} (presumed present)`,
      });
    }
    if (extra.length) {
      observations.push({
        property: 'presence',
        severity: 'concern',
        text: `Day ${d.date} presence has names not on the roster: ${extra.join(', ')} (ignored)`,
      });
    }
  }

  // --- the week under composition: pre-placed days are frozen context -------------
  /** @type {Record<string, PlacedDish[]>} */
  const week = {};
  for (const d of days) {
    const pre = (sessionState.alreadyPlaced || {})[d.date];
    week[d.date] = pre ? pre.map((p) => ({ ...p })) : [];
  }

  // --- continuous timeline: prior weeks' tail + this week's own placements --------
  // The week is the OUTPUT unit, never the lookback horizon. planTail supplies day-level
  // detail (roles + as-served carries) that carry-back needs; mealHistory is the coarse
  // name-level recency fallback for cadence.
  /** @type {{date: string, dishes: PlacedDish[]}[]} */
  const priorDays = [];
  for (const w of history.planTail || []) {
    for (const [date, dishes] of Object.entries(w.days || {})) {
      priorDays.push({ date, dishes: dishes || [] });
    }
  }
  priorDays.sort((a, b) => (a.date < b.date ? -1 : 1));

  /** last served date per mealId, finest resolution available */
  const lastServed = new Map();
  const fromPlanTail = new Set();   // ids with a precise day-level date; mealHistory must not overwrite these
  for (const { date, dishes } of priorDays) {
    for (const dish of dishes) {
      const cur = lastServed.get(dish.mealId);
      if (!cur || cur < date) lastServed.set(dish.mealId, date);
      fromPlanTail.add(dish.mealId);
    }
  }
  // mealHistory is the COARSE fallback and must never override planTail's precise date.
  //
  // Its `archivedAt` is the WEEK's end date stamped on every meal in that week, so it always
  // reads at-or-later than the truth. Taking the later of the two therefore systematically
  // overstated recency and could hard-exclude a meal that was genuinely due: Pizza night,
  // actually served 09-22, inherited its week's archivedAt of 09-26, so on 09-29 it looked
  // 3 days old against a 5-day weekly block instead of 7 days old and due. James flagged
  // that night in review ("I'd replace leftovers with a pizza nite") without knowing why.
  //
  // The model is explicit about the division: planTail is the day-level source, mealHistory
  // is "lightweight recency for cadence + long anti-repeat". So it fills gaps only — a meal
  // already dated from planTail keeps that date.
  for (const arc of history.mealHistory || []) {
    for (const id of arc.ids || []) {
      if (fromPlanTail.has(id)) continue;
      const cur = lastServed.get(id);
      if (!cur || cur < arc.archivedAt) lastServed.set(id, arc.archivedAt);
    }
  }

  const ctx = {
    meals, mealsById, roster, days, week, config, schedule,
    priorDays, lastServed,
    historyWeeks: (history.planTail || []).length,
    seen: new Set(sessionState.seenThisSession || []),
    shownThisCall: [],
    usedIds: new Set(),
    poolStats: [],
    spacingRelaxedDays: [],
    spacingBlocks: {},
    soleCauseBlocks: {},
    floorGapDays: [],
  };

  // Anything already on the plan — including anything James hand-picked — is out of the
  // candidate pool entirely (hard anti-repeat).
  for (const d of days) for (const dish of week[d.date]) ctx.usedIds.add(dish.mealId);

  ctx.presentOn = (person, date) => {
    const d = days.find((x) => x.date === date);
    if (!d || !d.presence) return true;             // fail-safe toward protecting the floor
    return d.presence[person] === undefined ? true : !!d.presence[person];
  };
  ctx.presentPeople = (date) => roster.filter((p) => ctx.presentOn(p, date));

  return ctx;
}

/* ================================================================== carry-back */

/**
 * Who is fed on `date` by leftovers carried forward from an earlier placement.
 * Weather gates COOKING, not EATING — a leftover never re-checks weather. Leftovers do
 * not re-carry, so only original placements generate coverage. Thin/absent history fails
 * SAFE: with nothing to read, the fridge is assumed empty.
 * @returns {Map<string, {mealId: string, servedOn: string}>} person -> covering dish
 */
function leftoverCoverage(date, ctx) {
  /** @type {Map<string, {mealId: string, servedOn: string}>} */
  const cover = new Map();
  const scan = [
    ...ctx.priorDays,
    ...ctx.days.map((d) => ({ date: d.date, dishes: ctx.week[d.date] || [] })),
  ];
  for (const { date: servedOn, dishes } of scan) {
    const gap = daysBetween(servedOn, date);
    if (gap <= 0) continue;                          // the serving day is fed by the dish itself
    for (const dish of dishes) {
      if (!dish.carries) continue;                   // presence of `carries` IS "makes leftovers"
      if (gap > dish.carries.lastsDays) continue;
      const meal = ctx.mealsById.get(dish.mealId);
      // A non-substantial side's leftovers never hold a floor — same rule as floor-fill,
      // applied to the carry that reaches forward. See canHoldFloor.
      if (meal && !canHoldFloor(meal)) continue;
      for (const person of resolveForWhom(dish.carries, meal, ctx.roster)) {
        if (!ctx.presentOn(person, date)) continue;  // carries only count on days they're home
        if (meal && dislikes(meal, person)) continue; // dislike = will not eat, even as a fallback
        // When two live carries both cover the same person, name the FRESHEST, not the
        // first scanned. The scan walks prior weeks before the current one, so oldest-wins
        // used to attribute coverage to a stale carry: James read "Partner is covered by
        // Mexican nite carried from 09-25" on a night when Sunday's potato leek soup also
        // covered her, and reasonably suspected he had mistagged the soup. He hadn't — the
        // attribution was wrong. Coverage is identical either way, so this changes only the
        // rationale text; but the rationale exists to be trusted, and a stale attribution
        // sends James to fix data that isn't broken.
        const held = cover.get(person);
        if (!held || servedOn > held.servedOn) cover.set(person, { mealId: dish.mealId, servedOn });
      }
    }
  }
  return cover;
}

/**
 * `forWhom` is a live MODE, not a snapshot. followLikes re-reads preferences every call,
 * so adding "Kid 2 likes lasagna" later auto-extends the carry with no re-tagging.
 */
function resolveForWhom(carries, meal, roster) {
  if (Array.isArray(carries.forWhom)) return carries.forWhom;
  if (carries.forWhom === 'all') return roster;
  if (!meal) return [];
  return (meal.preferences || []).filter((p) => p.pref === 'like').map((p) => p.person);
}

/* ================================================================== per-day */

function composeDay(day, ctx, rationale, observations) {
  const placed = ctx.week[day.date];
  let main = placed.find((p) => p.role === 'main');

  if (!main) {
    const picked = selectMain(day, ctx, rationale, observations);
    if (picked) {
      main = toPlacedDish(picked, 'main');
      placed.push(main);
      ctx.usedIds.add(picked.id);
      ctx.shownThisCall.push(picked.id);
    } else {
      observations.push({
        property: 'pool',
        severity: 'concern',
        text: `No eligible main for ${day.date} — every candidate was gated out (effort, grill, rotation or already used)`,
      });
      return;
    }
  }

  const mainMeal = ctx.mealsById.get(main.mealId);
  if (!mainMeal) return;

  const hasSides = placed.some((p) => p.role === 'side');
  if (!hasSides) {
    for (const side of selectSides(day, mainMeal, ctx, rationale)) {
      placed.push(toPlacedDish(side, 'side'));
      ctx.usedIds.add(side.id);
      ctx.shownThisCall.push(side.id);
    }
  }

  crossCheckDay(day, mainMeal, ctx, observations);

  // Floor is the objective: report the realized day, never silently absorb a gap.
  const gaps = gapsOnDay(day.date, ctx);
  if (gaps.length) {
    ctx.floorGapDays.push(day.date);
    observations.push({
      property: 'floor',
      severity: 'concern',
      text: `${gaps.join(' and ')} ${gaps.length > 1 ? 'have' : 'has'} nothing acceptable on ${day.date}`,
    });
  }

  // A carried-in leftover surfaces ONLY when it is actively holding someone's floor —
  // measured against the MAIN, not the whole plate. If someone is off tonight's main, the
  // leftover is what holds them, and that is the reasoning worth showing; an accompaniment
  // side that happens to also feed them is incidental and must not hide the chain.
  const cover = leftoverCoverage(day.date, ctx);
  for (const [person, src] of cover) {
    if (feeds(mainMeal, person)) continue;
    const m = ctx.mealsById.get(src.mealId);
    rationale.push({
      day: day.date, mealId: src.mealId,
      factor: 'carried-leftover-fill', tier: 'floor', role: 'decisive', visibility: 'always',
      text: `${person} is covered by ${m ? m.name : src.mealId} carried from ${src.servedOn}`,
    });
  }
}

/**
 * Cross-check the REALIZED day — generated or hand-placed alike. "A fully hand-built week
 * still has a shape worth cross-checking," and `manual` gates SELECTION, not REASONING: a
 * hand-placed meal is still effort-checked, spacing-checked and floor-checked.
 *
 * Deliberately NOT checked for a hand-placed meal: `grillable` (a hand-placement overrides
 * weather-gating), `tempAffinity` and `cadence` — those are pure auto-suggestion signals
 * and go inert once James has chosen the meal himself.
 */
function crossCheckDay(day, main, ctx, observations) {
  if (main.effort === 'involved' && timeLevelOf(day) !== 'much') {
    observations.push({
      property: 'effort-fit',
      severity: 'concern',
      text: `${main.name} is involved but ${day.date} isn't marked as a day with time to cook`,
    });
  }
  if (spacingClash(main, day.date, ctx)) {
    const shared = [];
    for (let off = -CONSTANTS.SPACING_ADJACENCY_DAYS; off <= CONSTANTS.SPACING_ADJACENCY_DAYS; off++) {
      if (off === 0) continue;
      const d = addDays(day.date, off);
      const prior = ctx.priorDays.find((p) => p.date === d);
      for (const dish of (ctx.week[d] || (prior ? prior.dishes : []))) {
        if (dish.role !== 'main') continue;
        const nb = ctx.mealsById.get(dish.mealId);
        if (!nb) continue;
        for (const v of (main.form || [])) if ((nb.form || []).includes(v)) shared.push(`${v} (${nb.name})`);
        for (const v of (main.service || [])) {
          if (CONSTANTS.SERVICE_SPACING_EXEMPT.includes(v)) continue;
          if ((nb.service || []).includes(v)) shared.push(`${v} (${nb.name})`);
        }
      }
    }
    observations.push({
      property: 'style-spacing',
      severity: 'concern',
      text: `${main.name} on ${day.date} clusters with an adjacent night: ${uniq(shared).join(', ')}`,
    });
  }
}

function toPlacedDish(meal, role) {
  /** @type {PlacedDish} */
  const dish = { mealId: meal.id, role };
  if (meal.carries) dish.carries = { ...meal.carries };   // frozen as-served
  return dish;
}

/**
 * Present people with nothing acceptable on `date`, counting the plate and leftovers.
 *
 * Only a dish that can HOLD a floor counts (canHoldFloor): a non-`substantial` side feeds
 * nobody, whoever placed it. INTEGRATION RULING 10 (9/29) — a fix: this used to count any
 * non-disliked dish, so a salad could read as "covering" someone and composeWeek's floor
 * observation disagreed with evaluateWeek's. Behaviour-neutral on the corpus (0 of 182
 * composed nights changed, 26 weeks) because floor-fill already draws only substantial sides.
 */
function gapsOnDay(date, ctx) {
  const cover = leftoverCoverage(date, ctx);
  const dishes = ctx.week[date] || [];
  return ctx.presentPeople(date).filter((person) => {
    if (cover.has(person)) return false;
    return !dishes.some((p) => {
      const m = ctx.mealsById.get(p.mealId);
      return m && canHoldFloor(m) && feeds(m, person);
    });
  });
}

/* ================================================================== main selection */

function weatherPermitsGrill(day, config) {
  return !!config.grillOpen
    && day.weather.highF >= CONSTANTS.GRILL_MIN_F
    && day.weather.popPercent <= CONSTANTS.GRILL_MAX_POP;
}

/**
 * THREE TIME LEVELS — `none` (office) | `some` (WFH) | `much` (weekend-ish).
 *
 * Reads `day.timeLevel` when the caller supplies it and otherwise derives from the locked
 * `time: boolean`, so a v2.3 Schedule keeps working unchanged: true -> much, false -> none.
 * (Contract catch-up is v2.4's job; this is the model behaviour.)
 *
 * Day-of-week defaults — Sat/Sun much, Mon/Tue none, Wed-Fri some — are deliberately NOT
 * here: that is UI seeding, so James only overrides exceptions. The engine reads the flag.
 */
export function timeLevelOf(day) {
  if (day.timeLevel === 'none' || day.timeLevel === 'some' || day.timeLevel === 'much') {
    return day.timeLevel;
  }
  return day.time ? 'much' : 'none';
}

/**
 * Rotation pool eligibility. `manual` is never auto-drawn; `soon` bypasses adventurousWeek.
 * MODEL RULING 13 (10/06): `soon` overrides WHATEVER holds a meal out of the auto-pool, so
 * it also lifts the `manual` exclusion (the external trigger has fired). The meal stays
 * `manual`; it is drawable only while the flag is set.
 */
function rotationEligible(meal, config) {
  if (meal.rotation === 'manual') return !!meal.soon;
  if (meal.rotation === 'experimental') return !!config.adventurousWeek || !!meal.soon;
  return true;
}

function selectMain(day, ctx, rationale, observations) {
  const { config } = ctx;

  // --- hard gates (structural only) ---------------------------------------------
  let pool = ctx.meals.filter((m) => m.role === 'main'
    && rotationEligible(m, config)
    && !ctx.usedIds.has(m.id));

  const muchTime = timeLevelOf(day) === 'much';
  const gatedInvolved = pool.filter((m) => m.effort === 'involved' && !muchTime).length;
  pool = pool.filter((m) => !(m.effort === 'involved' && !muchTime));

  const gatedGrill = pool.filter((m) => m.grillable && !weatherPermitsGrill(day, config)).length;
  pool = pool.filter((m) => !(m.grillable && !weatherPermitsGrill(day, config)));

  if (!pool.length) return null;

  // --- within-session anti-repeat: HARD until the pool is exhausted, then honest --
  let poolExhausted = false;
  const unseen = pool.filter((m) => !ctx.seen.has(m.id));
  if (unseen.length) pool = unseen;
  else poolExhausted = true;

  ctx.poolStats.push({ date: day.date, eligible: pool.length });

  const trace = [];
  const record = (label, next, extra) => {
    trace.push({ label, before: pool.length, after: next.length, ...extra });
    pool = next;
  };

  // --- TIER 1: the floor ---------------------------------------------------------
  // A main is floor-acceptable when every present person it doesn't feed is either
  // covered by leftovers or repairable by an available side. Sides are the repair
  // mechanism, so this rarely eliminates — which is correct: the engine injects HELP,
  // it does not rank mains by headcount (that was the deleted favScore model).
  const cover = leftoverCoverage(day.date, ctx);
  const present = ctx.presentPeople(day.date);
  const scored = pool.map((m) => {
    const gaps = present.filter((p) => !feeds(m, p) && !cover.has(p));
    const irreparable = gaps.filter((p) => !someSideCovers(p, m, day, ctx));
    return { meal: m, gaps, irreparable };
  });
  // An experimental main sits OUTSIDE the floor system (see `inReserve`): its coverage is
  // unknown, so it neither sets the bar nor is judged against it. It is not credited with
  // feeding people nobody has asked, and it is not eliminated for the same unknowns — it
  // simply passes through, to be decided by the tiers below. Ranking it here in EITHER
  // direction would be reading meaning into a blank.
  const rated = scored.filter((s) => !inReserve(s.meal));
  const minIrreparable = rated.length ? Math.min(...rated.map((s) => s.irreparable.length)) : 0;
  record('floor', scored.filter((s) => inReserve(s.meal) || s.irreparable.length === minIrreparable)
    .map((s) => s.meal), { minIrreparable });
  const floorInfo = new Map(scored.map((s) => [s.meal.id, s]));

  // --- TIER 2: spacing (form + rare service values), HARD with honest degradation --
  // Record WHAT spacing held back, and on which tag — the over-tagging diagnostic. A value
  // that blocks a lot while discriminating little is a tag worth reconsidering.
  const blocked = [];
  const spaced = pool.filter((m) => {
    const why = spacingClashDetail(m, day.date, ctx);
    if (!why.length) return true;
    blocked.push({ meal: m, why });
    // Count each value ONCE per blocked meal, not once per clashing neighbour — the useful
    // number is "how many placements did this tag cost", and a meal clashing with two
    // casseroles in the window still only lost one slot to `casserole`.
    const values = new Set(why.map((w) => w.value));
    for (const value of values) {
      ctx.spacingBlocks[value] = (ctx.spacingBlocks[value] || 0) + 1;
    }
    // THE ACTIONABLE CASE. A tally of busy tags is not something James can act on — the
    // answer to "casserole blocked 14 times" is not "retag 14 meals". What IS actionable is
    // a tag that was the SOLE reason a particular meal was held back: drop that one tag
    // from that one meal and those placements come back. Where a meal was blocked on two
    // values at once, removing either changes nothing, so it is not worth reporting.
    // `not-home-cooked` is excluded: it is the service-spacing RULE, not a tagging choice.
    // "Drop Pizza night's takeout tag" is not an edit James could sensibly make.
    const [only] = [...values];
    if (values.size === 1 && only !== 'not-home-cooked') {
      const key = `${m.name}|${only}`;
      const rec = ctx.soleCauseBlocks[key] || { name: m.name, value: only, n: 0, forms: (m.form || []).length };
      rec.n++;
      ctx.soleCauseBlocks[key] = rec;
    }
    return false;
  });
  let spacingRelaxed = false;
  if (spaced.length) record('spacing', spaced);
  else { spacingRelaxed = true; ctx.spacingRelaxedDays.push(day.date); record('spacing', pool); }

  // --- TIER 3: EAGER placement — `soon`, and the reserve on an adventurous week -----
  // MODEL RULING 6 (9/27): flipping `adventurousWeek` is a PLACEMENT signal, not a
  // permission — "the same shape as `soon`". Eligibility alone let the one experimental
  // main (involved, no preferences, no cadence) join the pool and lose every single time,
  // which is the cadence-starvation failure again: granting eligibility a meal can never
  // cash in. So the reserve is promoted into the eager tier, exactly as `soon` is.
  //
  // Capped at ONE placement per week, because both the model and contract v2.5 say "place
  // AN experimental meal" — James flips ONE switch, where `soon` is flagged per meal, so
  // promoting the whole class on one flip would compose an all-experimental week once the
  // reserve grows. `reserveAlreadyPlaced` counts a hand-placed experimental too: the week
  // already has its adventure. A `soon` experimental is unaffected — `m.soon` stands on
  // its own and, per the model, bypasses `adventurousWeek` entirely.
  const adventurous = config.adventurousWeek && !reserveAlreadyPlaced(ctx);
  const eager = pool.filter((m) => m.soon || (adventurous && inReserve(m)));
  if (eager.length) record('eager', eager);

  // --- TIER 4: freshness / cadence, BUCKETED so the leans below can still act ------
  const buckets = pool.map((m) => ({ meal: m, bucket: cadenceBucket(m, day.date, ctx) }));
  const bestBucket = Math.max(...buckets.map((b) => b.bucket.rank));
  record('freshness-cadence', buckets.filter((b) => b.bucket.rank === bestBucket).map((b) => b.meal),
    { bucket: buckets.find((b) => b.bucket.rank === bestBucket).bucket.label });
  const bucketInfo = new Map(buckets.map((b) => [b.meal.id, b.bucket]));

  // --- TIER 5: soft leans, combined by a FIXED rule (a sum of small fixed nudges) --
  // The soft tier keeps a BAND near the top, not the strict argmax. A tier that eliminates
  // is not soft: with winner-take-all here, any meal carrying one more nudge than another
  // wins every time, which is what starved every cadence-less meal even after due-ness was
  // demoted out of the bucket. The band is what finally lets randomness be a real layer
  // rather than a tie-break that never fires.
  const leaned = pool.map((m) => ({ meal: m, ...leanScore(m, day, ctx) }));
  const bestLean = Math.max(...leaned.map((l) => l.score));
  record('lean', leaned.filter((l) => l.score >= bestLean - CONSTANTS.LEAN_BAND).map((l) => l.meal),
    { score: bestLean });
  const leanInfo = new Map(leaned.map((l) => [l.meal.id, l]));

  // --- randomness LAST: seeded tie-break among equals -----------------------------
  const rng = mulberry32(hashString(`${config.weekStartDate}|${day.date}|${ctx.seen.size}|main`));
  const chosen = pool[Math.floor(rng() * pool.length)];

  emitMainRationale(chosen, day, ctx, trace, {
    floor: floorInfo.get(chosen.id),
    bucket: bucketInfo.get(chosen.id),
    lean: leanInfo.get(chosen.id),
    poolExhausted, spacingRelaxed, gatedInvolved, gatedGrill, blocked,
  }, rationale);

  return chosen;
}

/** Is there any eligible side that this gapped person would actually eat? */
function someSideCovers(person, main, day, ctx) {
  return ctx.meals.some((s) => s.role === 'side'
    && canHoldFloor(s)
    && rotationEligible(s, ctx.config)
    && !ctx.usedIds.has(s.id)
    && !(s.grillable && !weatherPermitsGrill(day, ctx.config))
    && !intersects(s.avoidPlate, main.plate)
    && feeds(s, person));
}

/**
 * Spacing is a HARD rule against the adjacent days, degrading to soft (with a rationale
 * item) only when the pool genuinely cannot satisfy it — the same honesty pattern as the
 * pool-exhaustion marker. `form` clashes on any shared value; `service` clashes only on
 * its rare values, since 40/48 meals are home-cooked.
 */
/**
 * WHY a meal clashes, not merely whether — returned as a list so the reason survives into
 * the rationale and observation streams.
 *
 * James dropped the multi-form rule (9/13) on the condition that the model SHOW its clash
 * detail, so over-tagging stays visible during ordinary planning. A meal carrying three
 * form values collides with more of the pool than one carrying a single value, and the
 * only way to judge whether a tag earns its place is to see what it actually blocked.
 *
 * @returns {{value: string, facet: 'form'|'service', against: string}[]}
 */
function spacingClashDetail(meal, date, ctx) {
  const n = CONSTANTS.SPACING_ADJACENCY_DAYS;
  const neighbours = [];
  for (let off = -n; off <= n; off++) {
    if (off === 0) continue;
    const d = addDays(date, off);
    const prior = ctx.priorDays.find((p) => p.date === d);
    const dishes = ctx.week[d] || (prior ? prior.dishes : []);
    for (const dish of dishes) {
      if (dish.role !== 'main') continue;
      const m = ctx.mealsById.get(dish.mealId);
      if (m) neighbours.push(m);
    }
  }
  const notHomeCooked = (m) => (m.service || []).some((s) => !CONSTANTS.SERVICE_SPACING_EXEMPT.includes(s));
  const out = [];
  for (const nb of neighbours) {
    for (const v of (meal.form || [])) {
      if ((nb.form || []).includes(v)) out.push({ value: v, facet: 'form', against: nb.name });
    }
    // Every non-home-cooked service value is ONE spacing class (James, 9/13): takeout,
    // dine-out and choose-your-own repel each other, not just themselves. Matching on
    // identical values let Chili's takeout and Dinner out sit two days apart unremarked —
    // `smorgasbord` had been separating them by accident until it was removed. This is the
    // job the model assigned to the takeout style: "cadence spaces a specific meal from
    // itself; the style spaces takeout-as-a-category."
    if (notHomeCooked(meal) && notHomeCooked(nb)) {
      out.push({ value: 'not-home-cooked', facet: 'service', against: nb.name });
    }
  }
  return out;
}

/** Boolean form of the above, for the places that only need yes/no. */
function spacingClash(meal, date, ctx) {
  return spacingClashDetail(meal, date, ctx).length > 0;
}

/**
 * Cadence is a recurrence PULL, not an anti-repeat window: `weekly` WANTS to come back at
 * ~7 days. Untagged is the deep-rotation default with no pull at all. Buckets (not a
 * continuous score) keep the stack lexicographic while leaving room for the leans below.
 */
function cadenceBucket(meal, date, ctx) {
  const last = ctx.lastServed.get(meal.id);
  const since = last ? daysBetween(last, date) : Infinity;
  const C = CONSTANTS;
  if (meal.cadence === 'weekly') {
    if (since < C.CADENCE_WEEKLY_MIN_GAP_DAYS) return { rank: 0, label: 'too-soon', since };
    if (since >= C.CADENCE_WEEKLY_DUE_DAYS) return { rank: 1, label: 'weekly-due', since };
    return { rank: 1, label: 'ok', since };
  }
  if (meal.cadence === 'biweekly') {
    if (since < C.CADENCE_BIWEEKLY_MIN_GAP_DAYS) return { rank: 0, label: 'too-soon', since };
    if (since >= C.CADENCE_BIWEEKLY_DUE_DAYS) return { rank: 1, label: 'biweekly-due', since };
    return { rank: 1, label: 'ok', since };
  }
  if (since < C.UNTAGGED_ANTI_REPEAT_DAYS) return { rank: 0, label: 'too-soon', since };
  return { rank: 1, label: 'ok', since };
}

/** Was the night before this one an involved main? Reads the week and the prior-week tail. */
function previousMainWasInvolved(date, ctx) {
  const prev = addDays(date, -1);
  const prior = ctx.priorDays.find((p) => p.date === prev);
  const dishes = ctx.week[prev] || (prior ? prior.dishes : []);
  return dishes.some((d) => {
    if (d.role !== 'main') return false;
    const m = ctx.mealsById.get(d.mealId);
    return m && m.effort === 'involved';
  });
}

/**
 * Who this meal's leftovers would feed on a LATER night that they are not already covered
 * for. This is the forward half of carry sequencing: it lets the engine prefer putting a
 * carrier down BEFORE the night that will need it, rather than discovering the gap after.
 * Only counts people actually present on the day the carry would reach.
 */
function carryReachesLater(meal, date, ctx) {
  if (!meal.carries) return [];
  if (!canHoldFloor(meal)) return [];
  const eaters = resolveForWhom(meal.carries, meal, ctx.roster)
    .filter((p) => !dislikes(meal, p));
  if (!eaters.length) return [];

  const horizon = Math.min(meal.carries.lastsDays, CONSTANTS.CARRIER_LOOKAHEAD_DAYS);
  const reached = new Set();
  for (let off = 1; off <= horizon; off++) {
    const later = addDays(date, off);
    if (!ctx.days.some((d) => d.date === later)) continue;   // outside the planned week
    const already = leftoverCoverage(later, ctx);
    for (const p of eaters) {
      if (!ctx.presentOn(p, later)) continue;
      if (already.has(p)) continue;                          // something else already holds them
      reached.add(p);
    }
  }
  return [...reached];
}

/**
 * Cost pressure. Absent `cost` means the meal is sunk into the weekly groceries — the
 * default and most meals — so it never accrues pressure and never takes a demerit.
 * Pressure only builds once several tagged-cost meals sit close together, and it applies
 * to further EXPENSIVE ones: the point is to space the bought meals, never to suppress
 * them into an all-cooking week.
 */
function costPressure(meal, date, ctx) {
  // An untagged meal is sunk into the weekly groceries and is outside this system entirely.
  if (!meal.cost) return null;
  const C = CONSTANTS;
  const scan = [
    ...ctx.priorDays,
    ...ctx.days.map((d) => ({ date: d.date, dishes: ctx.week[d.date] || [] })),
  ];

  // How many bought meals already sit in the window — a COUNT, not a spend total.
  let priorBought = 0;
  for (const { date: served, dishes } of scan) {
    const gap = daysBetween(served, date);
    if (gap <= 0 || gap > C.COST_LOOKBACK_DAYS) continue;
    for (const dish of dishes) {
      const m = ctx.mealsById.get(dish.mealId);
      if (m && m.cost) priorBought++;
    }
  }

  // Which bought meal of the week this one would be. The first is COMMON and is never
  // pushed back — whatever it costs. That is the rest-night guard, and it is stronger than
  // the old exemption for cheap meals: James always gets his break from cooking, and it no
  // longer has to be the pizza.
  const ordinal = priorBought + 1;
  if (ordinal <= C.COST_COMMON_COUNT) return null;

  const base = ordinal === 2 ? C.LEAN_COST_SECOND_BOUGHT : C.LEAN_COST_THIRD_BOUGHT;
  const dearness = (C.COST_WEIGHT[meal.cost] || 0) / (C.COST_WEIGHT.moderate || 1);
  const score = base * dearness;
  if (!score) return null;

  const nth = ordinal === 2 ? 'second' : `${ordinal}th`;
  return {
    score,
    text: `would be the ${nth} bought meal in ${C.COST_LOOKBACK_DAYS} days, and it is ${meal.cost}-cost`,
  };
}

/** The fixed soft-combination rule. No exposed knob, no tunable coefficients. */
function leanScore(meal, day, ctx) {
  const C = CONSTANTS;
  const parts = [];
  let score = 0;

  // `like` is a gentle own-night nudge, deliberately BINARY — never a summed headcount.
  const liker = ctx.presentPeople(day.date).find((p) => likes(meal, p));
  if (liker) { score += C.LEAN_LIKE; parts.push({ factor: 'like-lean', text: `${liker} likes this` }); }

  // Recurrence PULL — a nudge, never a filter. An untagged meal gets nothing here, which
  // means neutral: it competes on the other leans rather than being eliminated.
  const cad = cadenceBucket(meal, day.date, ctx);
  if (cad.label === 'weekly-due' || cad.label === 'biweekly-due') {
    const weekly = cad.label === 'weekly-due';
    const dueAt = weekly ? C.CADENCE_WEEKLY_DUE_DAYS : C.CADENCE_BIWEEKLY_DUE_DAYS;
    const base = weekly ? C.LEAN_CADENCE_WEEKLY_DUE : C.LEAN_CADENCE_BIWEEKLY_DUE;
    // The pull STRENGTHENS the longer a meal is overdue. A flat nudge sat inside LEAN_BAND,
    // so a due meal had no reliable way to beat an un-nudged one and `weekly` drifted out
    // to ~3-week recurrence. Escalating it means an untagged meal can still win early,
    // while a meal that is genuinely overdue eventually escapes the band and lands.
    const overdue = cad.since === Infinity ? C.CADENCE_OVERDUE_MAX
      : Math.min(C.CADENCE_OVERDUE_MAX, Math.floor(cad.since / dueAt));
    score += base * Math.max(1, overdue);
    parts.push({
      factor: 'cadence-due',
      text: `${meal.cadence} meal, last served ${cad.since === Infinity ? 'outside the record' : `${cad.since} days ago`}`,
    });
  }

  // --- effort against the day's time level (three levels, each behaving distinctly) ---
  const level = timeLevelOf(day);
  if (meal.effort === 'easy' && level === 'none') {
    score += C.LEAN_EASY_ON_NO_TIME;
    parts.push({ factor: 'easy-lean', text: 'easy meal on an office day' });
  } else if (meal.effort === 'easy' && level === 'some') {
    score += C.LEAN_EASY_ON_SOME_TIME;
    parts.push({ factor: 'easy-lean', text: 'easy meal on a work-from-home day' });
  } else if (meal.effort === 'medium' && level === 'none') {
    score += C.LEAN_MEDIUM_ON_NO_TIME;
    parts.push({ factor: 'effort-fit', text: 'medium effort on an office day' });
  } else if (meal.effort === 'involved' && level === 'much') {
    // The other half of the mechanism: a much-time day doesn't just permit a cooking
    // project, it gently prefers one. Mirror of the easy-lean on an office day.
    score += C.LEAN_INVOLVED_ON_MUCH_TIME;
    parts.push({ factor: 'involved-lean', text: 'a day with time to cook something involved' });
  }

  // --- consecutive-involved fatigue: two hard nights running is worse than two spread ---
  if (meal.effort === 'involved' && previousMainWasInvolved(day.date, ctx)) {
    score += C.LEAN_INVOLVED_BACK_TO_BACK;
    parts.push({ factor: 'effort-fatigue', text: 'a second involved meal the night after another' });
  }

  // --- FORWARD-CARRY SEQUENCING (mains only — the main defines the night) ---
  if (meal.role === 'main') {
    const cover = leftoverCoverage(day.date, ctx);
    const unbacked = ctx.presentPeople(day.date)
      .filter((p) => !feeds(meal, p) && !cover.has(p));
    if (unbacked.length) {
      score += C.LEAN_DISLIKE_NIGHT_UNBACKED * unbacked.length;
      parts.push({
        factor: 'dislike-night-unbacked',
        text: `${unbacked.join(' and ')} won't eat this and no earlier carry reaches tonight`,
      });
    }
    const reaches = carryReachesLater(meal, day.date, ctx);
    if (reaches.length) {
      score += C.LEAN_CARRIER_EARLY;
      parts.push({
        factor: 'carrier-early',
        text: `leftovers would reach ${reaches.join(' and ')} on a later night`,
      });
    }
  }

  // --- cost pressure: SPACES the bought meals, never minimises them ---
  const costLean = costPressure(meal, day.date, ctx);
  if (costLean) {
    score += costLean.score;
    parts.push({ factor: 'cost-pressure', text: costLean.text });
  }

  const aff = meal.tempAffinity;
  if (aff && aff !== 'neutral') {
    const hot = day.weather.highF >= C.HOT_F;
    const cold = day.weather.highF <= C.COLD_F;
    if ((hot && aff === 'light') || (cold && aff === 'comfort')) {
      score += C.LEAN_WEATHER_FIT;
      parts.push({ factor: 'weather-lean', text: `${aff} meal fits a ${hot ? 'hot' : 'cold'} day (${day.weather.highF}F)` });
    } else if ((hot && aff === 'comfort') || (cold && aff === 'light')) {
      score += C.LEAN_WEATHER_MISFIT;
      parts.push({ factor: 'weather-lean', text: `${aff} meal is off for a ${hot ? 'hot' : 'cold'} day (${day.weather.highF}F)` });
    }
  }
  return { score, parts };
}

function emitMainRationale(meal, day, ctx, trace, info, rationale) {
  const push = (factor, tier, role, visibility, text) =>
    rationale.push({ day: day.date, mealId: meal.id, factor, tier, role, visibility, text });

  const step = (label) => trace.find((t) => t.label === label) || { before: 1, after: 1 };

  // floor
  const f = step('floor');
  const fi = info.floor;
  if (inReserve(meal)) {
    // Never claim "feeds everyone present" for an untried dish. Its blank preferences are
    // UNKNOWN, not acceptance — the same fact that keeps it out of the floor tier's math
    // (see `inReserve`) must not come back as a coverage claim in the rationale stream.
    push('floor-unknown', 'floor', tierRole(f.before, f.after), 'always',
      "nobody has tried this yet, so who will eat it is unknown — it is not holding anyone's floor");
  } else if (fi && fi.gaps.length) {
    push('floor-gap', 'floor', tierRole(f.before, f.after), 'always',
      `${fi.gaps.join(', ')} won't eat this — needs a side or leftovers to hold the floor`);
  } else {
    push('floor-clear', 'floor', tierRole(f.before, f.after), 'quiet', 'feeds everyone present');
  }
  // (The `smorgasbord` floor-implication was REMOVED 9/13. It fused a floor-COVERAGE claim
  // into a descriptive form value — a category error, since no other form value carries
  // behaviour. The floor already derives "there's something for everyone" per person from
  // preferences: pizza covers everyone iff its preferences say so, and sushi fails Partner by
  // her preference, not by a tag. The ablation had already measured the implication as a
  // no-op. No replacement property was added, by design.)

  // spacing
  const s = step('spacing');
  if (info.spacingRelaxed) {
    push('spacing-relaxed', 'spacing', 'lean', 'always',
      'no unclashing meal was available — this repeats a nearby dish form or service mode');
  } else {
    push('spacing-ok', 'spacing', tierRole(s.before, s.after), 'quiet',
      'no dish-form or service clash with the days either side');
  }

  // What spacing HELD BACK, and on which tag. Quiet by default — the week-level
  // observation carries the aggregate — but this is where the per-night detail lives when
  // James wants to know why a meal he expected never appeared.
  const blocked = info.blocked || [];
  if (blocked.length) {
    const byValue = {};
    for (const b of blocked) {
      for (const w of b.why) {
        if (!byValue[w.value]) byValue[w.value] = new Set();
        byValue[w.value].add(b.meal.name);
      }
    }
    const summary = Object.entries(byValue)
      .sort((a, b) => b[1].size - a[1].size)
      .map(([v, names]) => `${v} (${[...names].slice(0, 3).join(', ')}${names.size > 3 ? `, +${names.size - 3} more` : ''})`)
      .join('; ');
    push('spacing-gate', 'spacing', 'gate', 'quiet',
      `${blocked.length} meal(s) held back by spacing — ${summary}`);
  }

  // eager tier — `soon`, or the reserve tank on an adventurous week (RULING 6)
  if (meal.soon) {
    const so = step('eager');
    push('soon', 'freshness-cadence', tierRole(so.before, so.after), 'always', 'flagged as wanted soon');
  } else if (inReserve(meal)) {
    const so = step('eager');
    push('adventurous', 'freshness-cadence', tierRole(so.before, so.after), 'always',
      "you asked for an adventurous week — this one is from the reserve and hasn't been cooked before");
  }

  // cadence
  const c = step('freshness-cadence');
  const b = info.bucket;
  if (b) {
    const sinceText = b.since === Infinity ? 'not in the recent record' : `last served ${b.since} days ago`;
    push(b.label === 'too-soon' ? 'cadence-too-soon' : (b.label === 'ok' ? 'freshness' : 'cadence-due'),
      'freshness-cadence', tierRole(c.before, c.after), 'quiet', `${b.label} (${sinceText})`);
  }

  // leans
  const l = step('lean');
  for (const part of (info.lean ? info.lean.parts : [])) {
    push(part.factor, 'lean', tierRole(l.before, l.after), 'quiet', part.text);
  }

  // always-visible markers
  if (info.poolExhausted) {
    push('pool-exhausted', 'freshness-cadence', 'decisive', 'always',
      "you've cycled through all eligible meals for this day");
  }
  if (info.gatedInvolved && timeLevelOf(day) !== 'much') {
    // CONTRACT v2.4: hard gates sit ABOVE the stack — they remove candidates before the
    // floor is evaluated — so they carry tier:'gate', not tier:'floor'. Filing them as
    // 'floor' told a learn-mode reader a floor concern drove a pick that was really a
    // capability exclusion. tier:'gate' = what kind of factor; role:'gate' = what it did.
    push('effort-gate', 'gate', 'gate', 'quiet',
      `${info.gatedInvolved} involved meal(s) held back — this day isn't marked as one with time`);
  }
  if (info.gatedGrill) {
    push('grill-gate', 'gate', 'gate', 'quiet',
      `${info.gatedGrill} grillable meal(s) held back — ${ctx.config.grillOpen ? "the day's weather doesn't allow grilling" : 'the grill is closed'}`);
  }
}

/* ================================================================== side selection */

function selectSides(day, main, ctx, rationale) {
  const chosen = [];
  const restNight = intersects(main.service, CONSTANTS.SERVICE_REST_NIGHT);

  // What the side's `avoidPlate` is checked against: the main alone, or the plate as
  // composed so far (see CONSTANTS.AVOID_PLATE_CHECKS_WHOLE_PLATE).
  const plateTraits = () => (CONSTANTS.AVOID_PLATE_CHECKS_WHOLE_PLATE
    ? uniq([...(main.plate || []), ...chosen.flatMap((c) => c.plate || [])])
    : (main.plate || []));

  // THE TWO-JOBS SEAM (James, 9/12). Structural gates apply to BOTH passes: rotation,
  // already-on-the-plan, and `grillable` (a capability — you cannot grill in a snowstorm,
  // whoever is hungry). The three NICETIES — avoidPlate, cadence, session-seen — apply to
  // ACCOMPANIMENT only. Each commits the same error if it blocks a floor-fill: starving
  // someone to preserve an aesthetic. Expect the occasional starch-on-starch floor-fill
  // plate (tater tots AND a baked potato for Kid 2) — that is correct, and the rationale
  // says why. Generalises what the model already said of carried-in leftovers: "a leftover
  // is a FALLBACK, not a composed pairing".
  const structurallyEligible = (s) => s.role === 'side'
    && rotationEligible(s, ctx.config)
    && !ctx.usedIds.has(s.id)
    && !chosen.some((c) => c.id === s.id)
    && !(s.grillable && !weatherPermitsGrill(day, ctx.config));

  /** Summoned by NEED — ignores all three niceties, but ONLY substantial sides can feed
   *  a gapped person (MODEL ⚑; CONTRACT v2.4). A caesar salad accompanies, it never rescues. */
  const eligibleForFloor = () => ctx.meals.filter((s) => structurallyEligible(s) && canHoldFloor(s));

  /** Chosen for NICENESS — the full discipline applies. */
  const eligibleForAccompaniment = () => ctx.meals.filter((s) => structurallyEligible(s)
    && !ctx.seen.has(s.id)
    && !intersects(s.avoidPlate, plateTraits()));

  // --- floor-fill: DEMAND-DRIVEN (0..N), a consequence of coverage, not a number ---
  // MODEL: "Do NOT auto-scaffold an experimental main with a backup side TO HOLD THE FLOOR
  // — that produces the weird and effortful combos the model should avoid... if James
  // serves one, that's his adventurous choice." The reserve dip is opt-in, so it gets no
  // floor-repair machinery; the same unknowns that keep it out of the floor tier above
  // keep it from summoning sides here.
  if (!inReserve(main) && !(restNight && CONSTANTS.SUPPRESS_SIDES_ON_TAKEOUT_EVEN_FOR_FLOOR)) {
    const cover = leftoverCoverage(day.date, ctx);
    let gaps = ctx.presentPeople(day.date).filter((p) => !feeds(main, p) && !cover.has(p));
    let guard = 0;
    while (gaps.length && guard++ < 5) {
      const cands = eligibleForFloor()
        .map((s) => {
          const covers = gaps.filter((p) => feeds(s, p));
          const loved = covers.filter((p) => likes(s, p)).length;
          // `avoidPlate` still never FILTERS a floor-fill — nobody goes unfed to protect a
          // plate. But among candidates that all clear the floor it breaks the tie, because
          // ties were previously decided by position in the corpus array: breakfast meats
          // (index 32) beat caesar salad (index 50) on an identical score, and landed next
          // to a tuna casserole twice. Kept well below 1.0 so covering one more person
          // always outranks avoiding a clash.
          const clash = intersects(s.avoidPlate, plateTraits()) ? CONSTANTS.FLOOR_FILL_CLASH_DEMERIT : 0;
          return {
            side: s,
            covers,
            score: covers.length + loved * CONSTANTS.LEAN_SIDE_LIKED_BY_GAPPED - clash,
          };
        })
        .filter((c) => c.covers.length)
        .sort((a, b) => b.score - a.score);
      if (!cands.length) break;
      const pick = cands[0];
      chosen.push(pick.side);
      rationale.push({
        day: day.date, mealId: pick.side.id,
        factor: 'floor-fill', tier: 'floor', role: 'decisive', visibility: 'always',
        text: `covers ${pick.covers.join(' and ')}, who ${pick.covers.length > 1 ? 'do' : 'does'} not eat tonight's main`,
      });
      gaps = gaps.filter((p) => !pick.covers.includes(p));
    }
  }

  // --- accompaniment: RESTRAINED, effort-capped, erring toward fewer ---------------
  // Suppressed for indivisible mains (the dish is sealed; the night is not) and on rest
  // nights — takeout means no cooking, not "takeout plus a vegetable".
  if (main.noSidesUnlessNeeded || restNight) return chosen;

  const involved = main.effort === 'involved';
  const cap = involved ? CONSTANTS.MAX_ACCOMPANIMENT_SIDES_INVOLVED_MAIN : CONSTANTS.MAX_ACCOMPANIMENT_SIDES;
  const room = cap - chosen.length;
  if (room <= 0) return chosen;

  const mode = CONSTANTS.ACCOMPANIMENT_CADENCE_MODE;
  const cands = eligibleForAccompaniment()
    .filter((s) => !involved || CONSTANTS.INVOLVED_MAIN_SIDE_EFFORTS.includes(s.effort))
    // Cadence gates the ACCOMPANIMENT pass only — the floor-fill pass above never
    // consulted it and must not start (floor beats freshness).
    .filter((s) => mode !== 'hard' || cadenceBucket(s, day.date, ctx).rank > 0)
    .map((s) => {
      const parts = [];
      let score = 0;
      const affinity = (s.pairsWith || []).includes(main.id);
      if (affinity) {
        score += CONSTANTS.LEAN_SIDE_PAIRS_WITH;
        parts.push({ factor: 'affinity', text: `pairs well with ${main.name}` });
      }
      const bucket = cadenceBucket(s, day.date, ctx);
      if (mode === 'soft' && bucket.rank === 0) {
        score += CONSTANTS.LEAN_SIDE_CADENCE_TOO_SOON;
        parts.push({
          factor: 'cadence-too-soon',
          text: `served ${bucket.since} days ago — suggested anyway because it pairs so well`,
        });
      }
      // Due-ness is no longer a bucket rank — leanScore carries the recurrence pull now.
      const lean = leanScore(s, day, ctx);
      score += lean.score;
      parts.push(...lean.parts);
      return { side: s, score, parts, bucket, affinity };
    })
    // Attraction is SPECIFIC: a side is only suggested as an accompaniment when the main
    // is one it actually pairs with. Erring toward FEWER — a menu of deletable sides does
    // not feel self-composed.
    .filter((c) => (CONSTANTS.ACCOMPANIMENT_REQUIRES_AFFINITY ? c.affinity : c.score > 0))
    .sort((a, b) => b.score - a.score);

  for (const c of cands.slice(0, room)) {
    chosen.push(c.side);
    for (const part of c.parts) {
      rationale.push({
        day: day.date, mealId: c.side.id,
        factor: part.factor, tier: 'lean', role: 'lean', visibility: 'quiet', text: part.text,
      });
    }
    if (involved) {
      rationale.push({
        day: day.date, mealId: c.side.id,
        factor: 'effort-budget', tier: 'lean', role: 'gate', visibility: 'quiet',
        text: `kept to one easy side — ${main.name} takes the day's cooking capacity`,
      });
    }
  }
  return chosen;
}

/* ================================================================== week observations */

function emitWeekObservations(ctx, observations) {
  const dates = ctx.days.map((d) => d.date);

  // floor summary
  if (!ctx.floorGapDays.length) {
    observations.push({ property: 'floor', severity: 'ok', text: 'Everyone present has something acceptable every night' });
  }

  // effort load — advisory only, never a generation rule
  const efforts = { easy: 0, medium: 0, involved: 0 };
  for (const d of dates) {
    for (const dish of ctx.week[d] || []) {
      if (dish.role !== 'main') continue;
      const m = ctx.mealsById.get(dish.mealId);
      if (m) efforts[m.effort] = (efforts[m.effort] || 0) + 1;
    }
  }
  observations.push({
    property: 'effort-load',
    severity: efforts.involved >= CONSTANTS.EFFORT_LOAD_CONCERN ? 'concern' : 'info',
    text: `Effort across the week: ${efforts.easy} easy, ${efforts.medium} medium, ${efforts.involved} involved`
      + (efforts.involved >= CONSTANTS.EFFORT_LOAD_CONCERN ? ' — heavy on high-effort meals; consider a low-effort swap' : ''),
  });

  // OVER-TAGGING DIAGNOSTIC. Which tag values did the most blocking this week? A value
  // near the top that James does not consider load-bearing for that meal is a tag worth
  // dropping — the multi-form rule was dropped (9/13) in favour of making this legible, on
  // the grounds that `form` does two jobs at once (what a dish IS, and what it spaces
  // against) and only James can say which of a meal's tags is doing the second one.
  const sole = Object.values(ctx.soleCauseBlocks)
    .filter((r) => r.n >= CONSTANTS.SOLE_CAUSE_REPORT_MIN)
    // A meal carrying a SECOND form tag is the tight edit — drop the one tag and the meal
    // still spaces on its other. A meal whose only tag is doing the blocking is a bigger
    // call, so it sorts below and is worded differently.
    .sort((a, b) => (b.forms > 1) - (a.forms > 1) || b.n - a.n)
    .slice(0, 3);
  if (sole.length) {
    observations.push({
      property: 'form-spacing',
      severity: 'info',
      text: 'Tag edits that would change this week: '
        + sole.map((r) => (r.forms > 1
          ? `drop "${r.value}" from ${r.name} (blocked ${r.n}x, and it still spaces on its other form)`
          : `${r.name} blocked ${r.n}x by "${r.value}" — its only form, so dropping it stops it spacing at all`))
          .join('; '),
    });
  } else {
    // Nothing single-tag to pull. Still worth saying so — it means the blocking is
    // structural (common tags on a small pool) rather than something retagging would fix.
    const blocks = Object.entries(ctx.spacingBlocks).sort((a, b) => b[1] - a[1]);
    if (blocks.length) {
      observations.push({
        property: 'form-spacing',
        severity: 'info',
        text: `Spacing held meals back on ${blocks.slice(0, 3).map(([v, n]) => `${v} x${n}`).join(', ')}`
          + ' — no single tag edit would have freed a meal, so this is the pool being tight rather than over-tagging',
      });
    }
  }

  // spacing
  if (ctx.spacingRelaxedDays.length) {
    observations.push({
      property: 'style-spacing', severity: 'info',
      text: `Spacing relaxed on ${ctx.spacingRelaxedDays.join(', ')} — the eligible pool had nothing that avoided a nearby dish form or service mode`,
    });
  }

  // history depth
  if (ctx.historyWeeks < CONSTANTS.THIN_HISTORY_WEEKS) {
    observations.push({
      property: 'history', severity: 'info',
      text: `Limited prior-week data (${ctx.historyWeeks} week${ctx.historyWeeks === 1 ? '' : 's'}); freshness spacing may be reduced`,
    });
  }

  // cadence: weekly meals that wanted a slot and didn't get one
  const placedIds = new Set(dates.flatMap((d) => (ctx.week[d] || []).map((p) => p.mealId)));
  // Mains only: a side's cadence is "how often James reaches for it", not a claim on a
  // night. This is also the mechanism that surfaces a missing rest night — pizza/takeout
  // carry a weekly cadence, so "no takeout this week" arrives here rather than as a quota.
  const weeklyMissed = ctx.meals.filter((m) => m.cadence === 'weekly'
    && m.role === 'main' && m.rotation === 'in' && !placedIds.has(m.id));
  if (weeklyMissed.length) {
    observations.push({
      property: 'cadence', severity: 'info',
      text: `Weekly-cadence meals not placed this week: ${weeklyMissed.map((m) => m.name).join(', ')}`,
    });
  }

  // NEGLECTED BLANKS (James, 9/20). A blank cadence means "occasional, but don't let me
  // forget it" — and nothing in the engine urges a blank meal, so drifting out of rotation
  // is silent by construction. This is the counterpart to the experimental gauge: it names
  // the meals that have quietly stopped appearing, and says what James can do about it.
  //
  // Only blank, auto-pool meals qualify: a `manual` meal is out of rotation by design, an
  // experimental one has its own observation, and a cadence-tagged one that is missing is
  // already reported by the cadence observation above.
  const lastDate = ctx.config.today || ctx.config.weekStartDate;
  const neglected = ctx.meals
    .filter((m) => m.role === 'main' && m.rotation === 'in' && !m.cadence && !placedIds.has(m.id))
    .map((m) => {
      const last = ctx.lastServed.get(m.id);
      return { meal: m, since: last ? daysBetween(last, lastDate) : null };
    })
    .filter((r) => r.since === null || r.since >= CONSTANTS.NEGLECTED_AFTER_DAYS)
    .sort((a, b) => (b.since === null ? Infinity : b.since) - (a.since === null ? Infinity : a.since));

  // Suppressed while history is thin: with nothing to look back on, EVERY meal reads as
  // neglected, which would make the observation noise on a fresh install.
  if (neglected.length && ctx.historyWeeks >= CONSTANTS.THIN_HISTORY_WEEKS) {
    observations.push({
      property: 'neglected',
      severity: 'info',
      text: `Drifting out of rotation — no cadence and not placed lately: `
        // "not in the recent record" rather than "never": the lookback is finite (planTail
        // plus the name-set archive), so an absent meal may simply predate what we can see.
        + neglected.slice(0, 4).map((r) => `${r.meal.name} (${r.since === null ? 'not in the recent record' : `${r.since}d ago`})`).join(', ')
        + (neglected.length > 4 ? `, and ${neglected.length - 4} more` : '')
        + '. Give one a cadence to pull it back, or place it by hand.',
    });
  }

  // the reserve tank's fuel gauge — the anti-forgetting mechanism that closes the capture loop
  const reserve = ctx.meals.filter((m) => m.rotation === 'experimental');
  // A meal placed THIS week is no longer waiting. Listing one the engine just scheduled
  // reads as a nag to do the thing it already did, the same failure as the stale-carry
  // attribution: the stream must describe the realized week, not the corpus.
  const waiting = reserve.filter((m) => !placedIds.has(m.id));
  if (reserve.length) {
    // Asking for an adventurous week and getting nothing experimental is a FAILED REQUEST,
    // not a gentle notice — it is the reserve tank's gauge reading empty when James has his
    // hand on the switch. Severity rises so the UI cannot render it as quiet background.
    // RULING 6 makes this rare by construction: the reserve is now PLACED, not merely
    // admitted, so a shortfall means the tank is genuinely empty or every candidate was
    // gated out (an involved experimental with no much-time day in the week).
    const noneDrawn = ctx.config.adventurousWeek && waiting.length === reserve.length;
    if (noneDrawn) {
      observations.push({
        property: 'experimental',
        severity: 'concern',
        text: `Adventurous week requested, but none of the ${reserve.length} experimental meals could be placed: `
          + `${reserve.map((m) => m.name).join(', ')}`,
      });
    } else if (waiting.length) {
      observations.push({
        property: 'experimental',
        severity: 'info',
        text: `${waiting.length} experimental meal${waiting.length === 1 ? '' : 's'} waiting to be tried: ${waiting.map((m) => m.name).join(', ')}`,
      });
    }
  }

  // combinatoriality — a THINNESS diagnostic ("time to add meals"), never a kill signal
  if (ctx.poolStats.length) {
    const sizes = ctx.poolStats.map((p) => p.eligible).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)];
    observations.push({
      property: 'combinatoriality',
      severity: median < CONSTANTS.COMBINATORIALITY_THIN_POOL ? 'concern' : 'info',
      text: `Median ${median} eligible mains per day (range ${sizes[0]}-${sizes[sizes.length - 1]})`
        + (median < CONSTANTS.COMBINATORIALITY_THIN_POOL
          ? ' — the rotation is thin enough that weeks will start to look alike; worth adding meals'
          : ''),
    });
  }
}

/* ================================================================== evaluate (as built) */

/**
 * @typedef {{observations: Observation[], rationale: RationaleItem[]}} EvaluateWeekOutput
 */

/**
 * CROSS-CHECK A WEEK AS BUILT — contract v2.6–v2.8 `evaluateWeek`, model FLOOR CROSS-CHECK
 * ruling (Ruling 7) and its EVALUATE-ONLY SEMANTICS (integration rulings 8.1–8.3, 9).
 *
 * The second entry point to the same floor logic: it composes NOTHING. No main or side is
 * selected and no floor-fill is injected, so every observation describes `plan` exactly as
 * James built it — an uncovered present person is a floor `concern`, never an `ok` that
 * assumes a side the engine would have added. composeWeek is untouched; this reuses its
 * context, leftover carry-back, per-day cross-check and week summary, and adds only the
 * as-built floor judgement below.
 *
 * Scope is `schedule.days`; a missing `plan` key is an empty day, and `plan` entries for
 * other dates are ignored. Leftovers inside the week come from each PlacedDish.carries in
 * `plan` (snapshotted when placed), earlier ones from `history` — as in composeWeek.
 *
 * @param {Meal[]} meals
 * @param {History} history
 * @param {Schedule} schedule
 * @param {Record<string, PlacedDish[]>} plan  the week as built, day-keyed
 * @param {Config} config
 * @returns {EvaluateWeekOutput}
 */
export function evaluateWeek(meals, history, schedule, plan, config) {
  /** @type {Observation[]} */ const observations = [];
  /** @type {RationaleItem[]} */ const rationale = [];

  const ctx = buildContext(meals, history, schedule, { seenThisSession: [], alreadyPlaced: plan || {} }, config, observations);
  let anyUnknown = false;
  for (const day of ctx.days) {
    if (evaluateDay(day, ctx, rationale, observations)) anyUnknown = true;
  }
  emitWeekObservations(ctx, observations);

  // Ruling 9: unknown coverage is not a gap, but the week summary must not claim more
  // than it knows. (Only evaluateWeek's own output is adjusted; the shared summary is not.)
  if (anyUnknown) {
    for (const o of observations) {
      if (o.property === 'floor' && o.severity === 'ok') {
        o.text = 'Everyone present has something acceptable every night, apart from coverage that is unknown (untried meals)';
      }
    }
  }
  return { observations, rationale };
}

/**
 * One day, as built. Returns true when someone's coverage is unknown.
 *
 * WHO IS FED (the as-built floor):
 *  - a covering leftover (leftoverCoverage — same rules as compose), or
 *  - a dish on the plate that can hold a floor (canHoldFloor: a main, or a `substantial`
 *    side — ruling 8.2: a non-substantial side holds nobody's floor, whoever placed it)
 *    and that they don't dislike, and that isn't untried.
 * An untried (`experimental`) main they haven't declared a dislike of leaves them UNKNOWN,
 * not uncovered — ruling 9: an `info` note plus a `floor-unknown` rationale item, never a
 * floor concern. Anyone else is uncovered: a floor `concern` (Ruling 7).
 *
 * A day with no main is an `info` note. Ruling 8.1 as clarified (9/29): an EMPTY day
 * (nothing placed) is ONLY that note, never a floor concern — "have you filled this day?"
 * and "does what you placed feed everyone?" are different questions. The floor test runs
 * only on a day with something on it (a main and/or sides).
 */
/** "A", "A and B", "A, B and C" */
const nameList = (xs) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function evaluateDay(day, ctx, rationale, observations) {
  const placed = ctx.week[day.date] || [];
  const mealOf = (p) => ctx.mealsById.get(p.mealId);
  const mainDish = placed.find((p) => p.role === 'main');
  const mainMeal = mainDish && mealOf(mainDish);

  if (mainMeal) crossCheckDay(day, mainMeal, ctx, observations);
  else {
    observations.push({
      property: 'unplanned',
      severity: 'info',
      text: placed.length ? `No main planned on ${day.date} (sides only)` : `Nothing planned on ${day.date} yet`,
    });
  }

  const cover = leftoverCoverage(day.date, ctx);
  const gaps = [];
  const unknown = [];
  let untriedMain = null;
  for (const person of placed.length ? ctx.presentPeople(day.date) : []) {
    if (cover.has(person)) continue;
    const knownFed = placed.some((p) => {
      const m = mealOf(p);
      return m && canHoldFloor(m) && !inReserve(m) && feeds(m, person);
    });
    if (knownFed) continue;
    const untried = placed.map(mealOf).find((m) => m && canHoldFloor(m) && inReserve(m) && !dislikes(m, person));
    if (untried) { unknown.push(person); untriedMain = untriedMain || untried; continue; }
    gaps.push(person);
  }

  if (gaps.length) {
    ctx.floorGapDays.push(day.date);
    observations.push({
      property: 'floor',
      severity: 'concern',
      text: `${nameList(gaps)} ${gaps.length > 1 ? 'have' : 'has'} nothing acceptable on ${day.date}`,
    });
  }
  if (unknown.length) {
    observations.push({
      property: 'floor',
      severity: 'info',
      text: `${day.date}: coverage is unknown for ${nameList(unknown)} — ${untriedMain.name} is untried`,
    });
    rationale.push({
      day: day.date, mealId: untriedMain.id,
      factor: 'floor-unknown', tier: 'floor', role: 'lean', visibility: 'always',
      text: `nobody has tried this yet, so whether it feeds ${nameList(unknown)} is unknown`,
    });
  }

  // Carried-in leftovers holding someone who is off the main — the same reasoning compose
  // shows. With no main, every leftover that is covering someone is doing the holding.
  for (const [person, src] of cover) {
    if (mainMeal && feeds(mainMeal, person) && !inReserve(mainMeal)) continue;
    const m = ctx.mealsById.get(src.mealId);
    rationale.push({
      day: day.date, mealId: src.mealId,
      factor: 'carried-leftover-fill', tier: 'floor', role: 'decisive', visibility: 'always',
      text: `${person} is covered by ${m ? m.name : src.mealId} carried from ${src.servedOn}`,
    });
  }
  return unknown.length > 0;
}

/* ================================================================== vocabulary check */

/**
 * Facet values are validated against FACET-VOCABULARY.md at the APPLICATION layer, not
 * hardcoded as closed unions. This reports drift; it never rejects a meal.
 * @returns {Observation[]}
 */
export function validateFacets(meals, vocabulary) {
  /** @type {Observation[]} */ const out = [];
  for (const facet of ['form', 'service', 'experience', 'plate']) {
    const legal = vocabulary[facet] || [];
    const offenders = new Map();
    for (const m of meals) {
      for (const v of m[facet] || []) {
        if (!legal.includes(v)) offenders.set(v, [...(offenders.get(v) || []), m.name]);
      }
    }
    for (const [value, names] of offenders) {
      out.push({
        property: 'vocabulary', severity: 'info',
        text: `${facet}: "${value}" is not in FACET-VOCABULARY.md (used by ${names.length}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? '...' : ''})`,
      });
    }
  }
  return out;
}
