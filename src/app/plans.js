// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { extraDaysOf, seedTimeLevel } from "../engine/assembleInputs.js";
import { DAYS_ALL, addDaysISO, todayLocalISO } from "./globals.js";
import { foldRemovedIds } from "../plan/ordering.js";

// outbox shape (written by Tonight's "Queue for Shortcut", cut in polish Phase 1;
// older DBs may still carry one, nothing reads it):
// { message, recipients:[phone...], mode:"group"|"individual", label, queuedAt, sent:false }
//
// published shape (v2) — generic menu the mid-week Shortcut reads. Flat list of
// label+body items; the Shortcut picks recipient(s) and item(s) and sends the
// joined bodies. See buildPublished above for details.
// { v:2, publishedAt, items:[ { key, label, body }, ... ] }

// plan shape (db.plans.current / db.plans.next — see SPEC-two-plan-model.md):
// { step, maxStep, timeLevels, presence, mealPlan, checkedIds, dayNotes, dayPills,
//   notesTouched, stapleFlags, quantities, weather, startedAt, _stepsVer,
//   meals, items, dismissedShared, notes,   (older plans may also carry cartItems /
//   cartIngredientIds, written by the cut Prep tab; nothing reads them)
//   weekStartDate }
// timeLevels: { dayAbbr: "none"|"some"|"much" } (B1). presence: per-night
// overrides only, { dayAbbr: { name: bool } } (B2) — see presentOn.
// mealPlan is the live-editing meal grid (day abbr -> meal NAMES); meals is the
// last-committed snapshot of the same shape, written by savePlan. weekStartDate
// (ISO YYYY-MM-DD) is the single canonical week-start; it drives auto-retire,
// resolvePlanForDate, ordering, and labels. (A legacy `weekOf` field used to
// shadow this and could drift from it when only weekStartDate was edited —
// removed; weekStartDate is now the only date field.)

// ── Active-plan accessors ────────────────────────────────────────────────────
// db.plans is a two-slot object: { current, next }. db.activePlan ("current" |
// "next") is the owner's explicit, STICKY choice of which week the app shows
// — it persists across tabs and sessions until they change it. getActivePlan
// follows that choice.
//
// SPEC-active-plan-app-wide.md (this reverses an earlier rule — read it if
// you're wondering why): every week-scoped surface (Plan, the Tonight
// tab's "MEAL SCHEDULE" card, the fridge report) now follows getActivePlan,
// not just the Plan tab. The two-plan model achieves safety not by PINNING
// execution surfaces to "current" but by LABELING — a persistent <WeekSelector>
// band rendered at the top of each of those surfaces always shows which week
// is on screen, so stickiness never silently misleads.
//
// Two exceptions stay pinned to getCurrentPlan, because they're about the
// week actually being SHOPPED AND LIVED, never whichever plan is being
// drafted: receipt reconcile (always reconciles what was actually ordered)
// and the family Shortcut export (buildPublished — never tell the family
// about a week that isn't happening yet). The Tonight tab's TONIGHT/TOMORROW
// cards are a third, different case — see resolvePlanForDate below: they're
// DATE-anchored, resolved by which plan's week contains today/tomorrow,
// deliberately ignoring both getActivePlan and getCurrentPlan.
const getActivePlan = db => {
  const key = db.activePlan || "current";
  return db.plans?.[key] || null;
};
const getCurrentPlan = db => db.plans?.current || null;

// Overwrite the plan at the active slot (the Plan-tab flow). Reconcile and the
// family export never write plans; they only read getCurrentPlan.
const writeActivePlan = (db, plan) => {
  const key = db.activePlan || "current";
  return { ...db, plans: { ...(db.plans || { current:null, next:null }), [key]: plan } };
};

// Resolves whichever plan (current or next) actually CONTAINS the given
// date's week, independent of db.activePlan. The Tonight tab's TONIGHT/
// TOMORROW cards are date-anchored (SPEC-active-plan-app-wide.md) — they must
// show the real today/tomorrow regardless of which week the WeekSelector is
// on, including the rare case where today and tomorrow straddle the
// current/next boundary. Falls back to current (home base) if neither plan's
// week contains the date, e.g. no plan exists yet.
const resolvePlanForDate = (db, dateISO) => {
  const inWeek = plan => !!plan?.weekStartDate && dateISO >= plan.weekStartDate && dateISO <= addDaysISO(plan.weekStartDate, 6 + extraDaysOf(plan));
  // A week runs from its own weekStartDate until the NEXT week's start date —
  // that start date is a hard boundary, not a rigid 7-day tile. So when a date
  // falls in both windows (overlap from a shifted shopping day), the plan with
  // the LATER weekStartDate wins: check next before current.
  if (inWeek(db.plans?.next)) return db.plans.next;
  if (inWeek(db.plans?.current)) return db.plans.current;
  return db.plans?.current || null;
};

// Presence (REFACTOR B2): who is home, per day × per person, for every roster member.
// presentOn (imported from ./engine/assembleInputs.js) resolves a per-night toggle,
// then a settings.awayRanges period, then defaults to present.

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
const PLAN_INPUTS_VER = 1;   // timeLevels + presence (see the plan-inputs block below)
const PLAN_ORDER_VER = 1;    // checked = buying: removedIds folded away (polish Phase 1b)
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
        removedIds: draft?.removedIds || [],
        addedItems: draft?.addedItems || [],
        dayNotes: draft?.dayNotes || {},
        dayPills: draft?.dayPills || {},
        notesTouched: draft?.notesTouched || false,
        stapleFlags: draft?.stapleFlags || {},
        quantities: draft?.quantities || {},
        weather: draft?.weather || "hot",
        startedAt: draft?.startedAt || new Date().toISOString(),
        _stepsVer: draft?._stepsVer ?? 4,
        meals: committed?.meals || draft?.mealPlan || {},
        items: committed?.items || [],
        cartItems: committed?.cartItems || [],
        cartIngredientIds: committed?.cartIngredientIds || [],
        dismissedShared: committed?.dismissedShared || [],
        notes: committed?.notes || "",
        // Use the committed record's own weekStartDate directly if it has one;
        // otherwise today (local, not UTC) — never infer from the legacy
        // weekOf field.
        weekStartDate: committed?.weekStartDate || todayLocalISO(),
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

  // Family-roles migration (SPEC-family-roles.md): backfill semantic role
  // flags (isPartner/canBeAway/isSelf) onto familyContacts BY POSITION,
  // matching what the old hardcoded index-0/index-3 behavior always meant.
  // Only runs when no member carries any role flag yet, so it never
  // clobbers real per-member data. Self-heals old exports/localStorage.
  if (out.settings && Array.isArray(out.settings.familyContacts) && out.settings.familyContacts.length) {
    const contacts = out.settings.familyContacts;
    const hasRoles = contacts.some(f => f.isPartner || f.canBeAway || f.isSelf);
    if (!hasRoles) {
      let migrated = contacts.map((f, i) => ({
        ...f,
        ...(i === 0 ? { isPartner: true } : {}),
        ...(i === 3 ? { canBeAway: true } : {}),
      }));
      if (!migrated.some(f => f.isSelf)) {
        migrated = [...migrated, { name: "Me", phone: "", isSelf: true }];
      }
      out = { ...out, settings: { ...out.settings, familyContacts: migrated } };
    }
  }

  // Plan-inputs migration (REFACTOR B1 + B2). Runs after the role backfill above,
  // which it reads. Idempotent via _planInputsVer.
  //   B1: the binary `easy` pill → per-day timeLevels. A day that carried an easy
  //       pill becomes "none"; every other day gets the weekday seed. Easy pills
  //       are dropped (no longer a built-in).
  //   B2: the Partner-only per-day awayHome map → per-night presence overrides;
  //       the persistent away-member toggle, when off, → an open-ended away
  //       period, so planning sees the same absence it did before. The toggle
  //       itself stayed to decide who got family texts, until polish Phase 1 cut the
  //       text queue; old DBs may still carry it, nothing reads it after this migration.
  if ((out._planInputsVer || 0) < PLAN_INPUTS_VER) {
    const contacts   = out.settings?.familyContacts || [];
    const partner    = contacts.find(f => f.isPartner);
    const awayMember = contacts.find(f => f.canBeAway);
    const upgradePlan = p => {
      if (!p) return p;
      const pills = p.dayPills || {};
      const hasEasy = d => (pills[d] || []).some(x => x.label === "easy");
      const timeLevels = p.timeLevels || Object.fromEntries(DAYS_ALL.map(d => [d, hasEasy(d) ? "none" : seedTimeLevel(d)]));
      const dayPills = Object.fromEntries(Object.entries(pills).map(([d, ps]) => [d, (ps || []).filter(x => x.label !== "easy")]));
      const presence = { ...(p.presence || {}) };
      if (partner) Object.entries(p.awayHome || {}).forEach(([d, home]) => {
        if (home === false) presence[d] = { ...(presence[d] || {}), [partner.name]: false };
      });
      const { awayHome, ...rest } = p;
      return { ...rest, timeLevels, dayPills, presence };
    };
    // Keyed off the version stamp, not "awayRanges missing": an import merges
    // DEFAULT_SETTINGS (awayRanges: []) in before this runs.
    let settings = out.settings;
    if (settings) {
      let ranges = Array.isArray(settings.awayRanges) ? settings.awayRanges : [];
      if (awayMember && settings.awayMemberHome === false && !ranges.some(r => r.name === awayMember.name)) {
        ranges = [...ranges, { id: "r" + Date.now(), name: awayMember.name, from: null, to: null }];
      }
      settings = { ...settings, awayRanges: ranges };
    }
    const plans = out.plans && !Array.isArray(out.plans)
      ? { current: upgradePlan(out.plans.current), next: upgradePlan(out.plans.next) }
      : out.plans;
    out = { ...out, settings, plans, _planInputsVer: PLAN_INPUTS_VER };
  }

  // Checked = buying (polish Phase 1b, SPEC §3b). The Confirm step's separate drop list
  // (removedIds) is retired: Confirm now writes the same per-item decision Inventory does.
  // Any drops still on a plan fold into that decision (see foldRemovedIds). Idempotent
  // via _planOrderVer; an older export imported later is folded the same way.
  if ((out._planOrderVer || 0) < PLAN_ORDER_VER) {
    const plans = out.plans && !Array.isArray(out.plans)
      ? { current: foldRemovedIds(out.plans.current, out.ingredients), next: foldRemovedIds(out.plans.next, out.ingredients) }
      : out.plans;
    out = { ...out, plans, _planOrderVer: PLAN_ORDER_VER };
  }

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
  const today = todayLocalISO();
  if (next.weekStartDate > today) return db;

  const outgoing = db.plans?.current;
  const outgoingMeals = Object.values(outgoing?.mealPlan || outgoing?.meals || {}).flat()
    .filter(n => n && n !== "Choose your own night" && n !== "Choose your own");
  const prevHistory = db.mealHistory || [];
  const mealHistory = outgoingMeals.length
    ? [...prevHistory, { archivedAt:new Date().toISOString(), meals:[...new Set(outgoingMeals)] }].slice(-6)
    : prevHistory;

  // Day-level tail, parallel to mealHistory above but preserving day-of-week
  // positioning and served dates (needed later for leftover carry-back across
  // the week boundary). See SPEC-retain-plan-tail.md.
  const outgoingTail = outgoing && (outgoing.mealPlan || outgoing.meals)
    ? {
        archivedAt: new Date().toISOString(),
        weekStartDate: outgoing.weekStartDate || null,
        mealPlan: outgoing.mealPlan || outgoing.meals || {},
        // Extra days (X1, X2) are dated from this, so history keeps their dates right.
        ...(extraDaysOf(outgoing) ? { extraDays: extraDaysOf(outgoing) } : {}),
        // Plate annotations (C1) carry the as-served leftovers snapshots history needs.
        ...(outgoing.plates ? { plates: outgoing.plates } : {}),
      }
    : null;
  const prevTails = db.planTail || [];
  const planTail = outgoingTail
    ? [...prevTails, outgoingTail].slice(-6)
    : prevTails;

  // Promoting a finished future-week plan into "the week you're now in" means
  // its meal plan — not its shopping progress — is what the owner needs to
  // see, so the step pointers reset to Meals (matching how a fresh plan is
  // seeded, see startFresh/startNextWeek) while every other field, including
  // the plan's own weekStartDate, carries over untouched.
  const promoted = {
    ...next,
    step: 1,
    maxStep: 1,
    weekStartDate: next.weekStartDate || today,
  };

  return {
    ...db,
    mealHistory,
    planTail,
    plans: { current: promoted, next: null },
    activePlan: db.activePlan === "next" ? "current" : (db.activePlan || "current"),
  };
};

export { autoRetirePlans, getActivePlan, getCurrentPlan, mapBothPlans, migrateDB, planCount, resolvePlanForDate, writeActivePlan };
