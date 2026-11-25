// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { MAX_EXTRA_DAYS, endDateFor, extraDaysOf, reconcilePlates, weekDates } from "../engine/assembleInputs.js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PLAN_STEPS, nextDateForShoppingDay, planDays, seedTimeLevels, weekLabel } from "../app/globals.js";
import { PLAN_STEPS_VER, getActivePlan, startPlan, writeActivePlan } from "../app/plans.js";
import { ActionBar, BlockButton, HeaderButtons, Segmented } from "../ui/kit.jsx";
import { PlanConfirm } from "./PlanConfirm.jsx";
import { PlanInventory } from "./PlanInventory.jsx";
import { LocTabs } from "./LocTabs.jsx";
import { inventoryLocs } from "./inventoryModel.js";
import { PlanMeals } from "./PlanMeals.jsx";
import { ItemPage } from "../library/ItemPage.jsx";
import { orderingPatch } from "./ordering.js";
import { buyOf, buyPatch, buyWord } from "../library/libraryModel.js";
import { WeekStep } from "./WeekStep.jsx";
import "./plan.css";
import { latestDB } from "../app/latestDB.js";
import { showToast } from "../ui/toast.js";

// ── PLAN TAB ───────────────────────────────────────────────────────────────────

// Phase 2 (SPEC-plan-flow-v2, stage 4a): Week · Meals · Inventory · Confirm · Order under one
// frame. Welcome and "save & exit" are gone; Home's week rows and the empty state start plans.
function PlanTab({ db, persistDB, headerIcons, onDone, onOpenMeal }) {
  // The plan the owner is currently EDITING — follows db.activePlan (current or
  // next), unlike Tonight's cards, which are pinned to today. This plan object
  // doubles as both the live-editing draft and the committed record (they were
  // merged by the two-plan-model migration).
  const draft = getActivePlan(db);
  // Day-ordering follows THIS plan's own weekStartDate, recomputed every
  // render so a changed start date reorders
  // the days live. Falls back to the shoppingDay default only when there's no
  // active plan yet (very first load, before any plan exists).
  const { days, daysFull } = planDays(draft, db.settings?.shoppingDay);

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
  //   v4 → v5 (phase 2): Welcome(0) becomes Week(0); no index moves, so no remap.
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
  const [timeLevels, setTimeLevels]   = useState(draft?.timeLevels || seedTimeLevels());
  const [presence, setPresence]       = useState(draft?.presence || {});
  const [mealPlan, setMealPlan]       = useState(draft?.mealPlan || Object.fromEntries(days.map(d => [d, []])));
  // Plate annotations for mealPlan (REFACTOR C1): role, reason and leftovers snapshot
  // per dish. Persisted on the plan so they survive every step transition; always
  // rebuilt from mealPlan via reconcilePlates, never edited on their own.
  const [plates, setPlates]           = useState(draft?.plates || {});
  const [checkedIds, setCheckedIds]   = useState(draft?.checkedIds || []);
  const [addedOff, setAddedOff]       = useState(draft?.addedOff || []);  // items added on Confirm, then unchecked (kept, dimmed)
  const [addedItems, setAddedItems]   = useState(draft?.addedItems || []);
  const [dayNotes, setDayNotes]       = useState(draft?.dayNotes || {});
  const [dayPills, setDayPills]       = useState(draft?.dayPills || {});
  const [stapleFlags, setStapleFlags] = useState(draft?.stapleFlags || {});
  const [quantities, setQuantities]   = useState(draft?.quantities || {});
  const [weather, setWeather]         = useState(draft?.weather || "hot");

  const meals       = db.meals || [];
  const ingredients = db.ingredients || [];

  // Persist the current editing state into the active plan slot. Spreads the
  // existing plan first so committed fields (meals, items, cart*,
  // dismissedShared, weekStartDate) survive — only draft-editing fields
  // are updated here. Accepts a patch so callers can save the new value
  // synchronously (React state updates are async). opts forwards to persistDB
  // (e.g. { background: true } for the weather-driven pill auto-derive, which
  // must not look like a user edit — see SPEC-data-provenance.md).
  const saveDraft = (patch = {}, opts = {}) => {
    const next = {
      ...draft,
      step, maxStep, timeLevels, presence, mealPlan, plates, checkedIds, addedOff, addedItems, dayNotes, dayPills, stapleFlags, quantities, weather,
      _stepsVer: PLAN_STEPS_VER,
      startedAt: draft?.startedAt || new Date().toISOString(),
      ...patch,
    };
    persistDB(writeActivePlan(db, next), opts);
  };

  // RE-FILING AN ITEM ("⋯ edit" on Inventory and Confirm) never moves its row during the week
  // (brief §5, 11/25): the item is saved with its new Buy type, but this plan keeps
  // using the type it had (buyThisWeek: id → the earlier BUY_OPTIONS value), so its section,
  // its checkbox and Confirm's grouping stay as they were and its subline reads "· <type> from
  // next week". The next plan, built without it, uses the new type. Item and plan, ONE save.
  // keptIds: As needed items added from Confirm's search that no planned meal needs.
  const keptIds = draft?.keptIds || [];
  // addedIds: Library items in Confirm's "Added" group, in the order added from Confirm's
  // search. Display only: whether each is bought is the usual decision (checkedIds /
  // stapleFlags, and keptIds for As needed).
  const addedIds = draft?.addedIds || [];
  const buyThisWeek = draft?.buyThisWeek || {};
  // This plan's view of the items: a re-filed item keeps this week's type; nextBuy names the new one.
  const planIngs = ingredients.map(i => buyThisWeek[i.id] && buyThisWeek[i.id] !== buyOf(i)
    ? { ...i, ...buyPatch(buyThisWeek[i.id]), nextBuy: buyWord(i), realBuy: { tier: i.tier, stapleType: i.stapleType } } : i);
  // `draftExtra` / `opts`: plan fields (a step change) saved in the SAME write, for leaving
  // Confirm with a held panel choice; two saves in one tap would each start from this render's db.
  const updateItem = (id, patch, draftExtra = null, opts = {}) => {
    const ing = ingredients.find(i => i.id === id);
    if (!ing) return;
    const nextIngredients = ingredients.map(i => i.id === id ? { ...i, ...patch } : i);
    const was = buyThisWeek[id] || buyOf(ing), now = buyOf({ ...ing, ...patch });
    const changed = now !== buyOf(ing);
    if (!changed && !draftExtra) { persistDB({ ...db, ingredients: nextIngredients }); return; }
    const nBuy = { ...buyThisWeek };
    if (now === was) delete nBuy[id]; else nBuy[id] = was;
    persistDB(writeActivePlan({ ...db, ingredients: nextIngredients }, {
      ...draft, step, maxStep, timeLevels, presence, mealPlan, plates, checkedIds, addedOff, addedItems, dayNotes, dayPills, stapleFlags, quantities, weather,
      ...(changed ? { buyThisWeek: nBuy } : {}),
      _stepsVer: PLAN_STEPS_VER, startedAt: draft?.startedAt || new Date().toISOString(), ...(draftExtra || {}),
    }), opts);
  };

  const clearDraft = () => persistDB(writeActivePlan(db, null));

  // Navigate to any step. maxStep only ever grows, so once you've visited a step
  // it stays unlocked even after you jump backward.
  // `extra`: fields saved in the same write (Confirm's order snapshot).
  const goToStep = (s, extra = {}) => {
    const newMax = Math.max(maxStep, s);
    setStep(s);
    setMaxStep(newMax);
    // Leaving Confirm with an item panel open: its held Buy / place choice goes in this write.
    const held = step === 3 && s !== 3 ? heldItem.current?.() : null;
    if (held) { updateItem(held.id, held.patch, { step: s, maxStep: newMax, ...extra }, { background: true }); return; }
    saveDraft({ step: s, maxStep: newMax, ...extra }, { background: true }); // moving between steps isn't an edit (RULING 16.4)
  };

  // Wrapped setters: update local state AND persist the draft in one shot.
  const setTimeLevelsP  = v => { const nv = typeof v === "function" ? v(timeLevels)  : v; setTimeLevels(nv);  saveDraft({ timeLevels: nv }); };
  const setPresenceP    = v => { const nv = typeof v === "function" ? v(presence)    : v; setPresence(nv);    saveDraft({ presence: nv }); };
  // annotations: plate entries for engine-placed dishes (see platesFromCompose).
  const setMealPlanP    = (v, annotations) => {
    const nv = typeof v === "function" ? v(mealPlan) : v;
    const np = reconcilePlates(mealPlan, nv, plates, db.meals || [], annotations);
    setMealPlan(nv); setPlates(np); saveDraft({ mealPlan: nv, plates: np });
  };
  // Undo on the Meals step: put the days and plates back exactly as they were (plates too, so
  // the engine's reasons and leftovers snapshots come back), onto the db as it is now.
  const restoreMeals = snap => {
    setMealPlan(snap.mealPlan); setPlates(snap.plates);
    const cur = latestDB(), p = cur && getActivePlan(cur);
    if (p) persistDB(writeActivePlan(cur, { ...p, mealPlan: snap.mealPlan, plates: snap.plates }));
  };
  const setCheckedIdsP  = v => { const nv = typeof v === "function" ? v(checkedIds)  : v; setCheckedIds(nv);  saveDraft({ checkedIds: nv }); };
  const setAddedOffP    = v => { const nv = typeof v === "function" ? v(addedOff)    : v; setAddedOff(nv);    saveDraft({ addedOff: nv }); };
  // Checked = buying (Phase 1b): Inventory and Confirm both set the one decision per item;
  // checkedIds and stapleFlags change together in a single save.
  const setOrdering = (ing, on) => {
    const next = orderingPatch(ing, on, { checkedIds, stapleFlags });
    setCheckedIds(next.checkedIds); setStapleFlags(next.stapleFlags);
    saveDraft({ checkedIds: next.checkedIds, stapleFlags: next.stapleFlags });
  };
  // Confirm's search: put a Library item on this week's order, in "Added", in one save.
  const addFromLibrary = ing => {
    const planned = Object.values(mealPlan).flat();
    const mealNeeds = meals.some(m => planned.includes(m.name) && (m.ingredients || []).includes(ing.id));
    const next = orderingPatch(ing, true, { checkedIds, stapleFlags });
    const nKept = ing.tier === "specialty" && !mealNeeds && !keptIds.includes(ing.id) ? [...keptIds, ing.id] : keptIds;
    setCheckedIds(next.checkedIds); setStapleFlags(next.stapleFlags);
    saveDraft({ checkedIds: next.checkedIds, stapleFlags: next.stapleFlags, keptIds: nKept, addedIds: addedIds.includes(ing.id) ? addedIds : [...addedIds, ing.id] });
  };
  const setAddedItemsP  = v => { const nv = typeof v === "function" ? v(addedItems)  : v; setAddedItems(nv);  saveDraft({ addedItems: nv }); };
  // opts { background: true } for the Meals step's blank-notes fill, which isn't an edit.
  const setDayNotesP    = (v, opts) => { const nv = typeof v === "function" ? v(dayNotes) : v; setDayNotes(nv); saveDraft({ dayNotes: nv }, opts); };
  const setDayPillsP    = v => { const nv = typeof v === "function" ? v(dayPills)    : v; setDayPills(nv);    saveDraft({ dayPills: nv }); };
  const setStapleFlagsP = v => { const nv = typeof v === "function" ? v(stapleFlags) : v; setStapleFlags(nv); saveDraft({ stapleFlags: nv }); };
  const setQuantitiesP  = v => { const nv = typeof v === "function" ? v(quantities)  : v; setQuantities(nv);  saveDraft({ quantities: nv }); };
  const setWeatherP     = v => { const nv = typeof v === "function" ? v(weather)     : v; setWeather(nv);     saveDraft({ weather: nv }); };

  // EXTRA DAYS (shopping a day or two later than usual). Only the LATEST week can grow
  // or shrink — this plan is "next", or there is no next week yet — so a week boundary
  // never moves once a following week exists. Removing an extra day drops everything
  // stored under its key, in the same single save.
  const extraDays    = extraDaysOf(draft);
  const canExtend    = !!draft?.weekStartDate && ((db.activePlan || "current") === "next" || !db.plans?.next?.weekStartDate);
  const setExtraDays = n => {
    const target = Math.max(0, Math.min(MAX_EXTRA_DAYS, n));
    if (!canExtend || target === extraDays) return;
    const endDate = endDateFor(draft.weekStartDate, target);
    if (target > extraDays) { saveDraft({ endDate }); return; }
    const gone = []; for (let k = target + 1; k <= extraDays; k++) gone.push(`X${k}`);
    const drop = o => { const c = { ...(o || {}) }; gone.forEach(k => delete c[k]); return c; };
    const nm = drop(mealPlan), np = reconcilePlates(mealPlan, nm, plates, db.meals || []);
    const nn = drop(dayNotes), nt = drop(timeLevels), npr = drop(presence), nd = drop(dayPills);
    setMealPlan(nm); setPlates(np); setDayNotes(nn); setTimeLevels(nt); setPresence(npr); setDayPills(nd);
    saveDraft({ endDate, mealPlan: nm, plates: np, dayNotes: nn, timeLevels: nt, presence: npr, dayPills: nd });
  };

  // Single-write committer for placing a meal on the planner. If the name is new,
  // it creates a stub meal record. Meals + mealPlan + draft are written in ONE
  // persistDB so the two mutations can't clobber each other's stale-closure db.
  // Spreads ...draft first so committed fields (cart*, items, dismissedShared,
  // weekStartDate) and dayPills survive — only the listed fields change.
  const commitMealToPlan = (newMealPlan, maybeNewName) => {
    setMealPlan(newMealPlan);
    let meals = db.meals || [];
    const nm = (maybeNewName||"").trim();
    if (nm && !meals.some(m => m.name.toLowerCase() === nm.toLowerCase())) {
      meals = [...meals, { id:"m"+Date.now()+Math.random().toString(36).slice(2,5), createdAt:new Date().toISOString(), name:nm, effort:"medium", type:"dinner", tempAffinity:"neutral", grillable:false, leftovers:"none", preferences:[], notes:"", ingredients:[] }];
    }
    const nextPlates = reconcilePlates(mealPlan, newMealPlan, plates, meals);
    setPlates(nextPlates);
    const nextDraft = { ...draft, step, maxStep, timeLevels, presence, mealPlan:newMealPlan, plates:nextPlates, checkedIds, addedOff, addedItems, dayNotes, stapleFlags, quantities, weather, startedAt: draft?.startedAt || new Date().toISOString() };
    persistDB(writeActivePlan({ ...db, meals }, nextDraft));
  };

  // Finish plan (Order's Next): the plan is ordered (Home reads "Ordered · pickup …"; set once,
  // later edits don't clear it, decided 11/12), then back to Home.
  // Confirm's order snapshot is saved in the same write.
  const finishPlan = (snapshot = {}) => { saveDraft({ ...snapshot, ...(draft?.orderedAt ? {} : { orderedAt: new Date().toISOString() }) }); showToast(`${weekLabel(draft?.weekStartDate)} planned`); onDone?.(); };

  // Week sub-steps (Calendar › Who's home › Time), remembered on the plan in the background.
  const [weekSub, setWeekSub] = useState(Math.min(draft?.weekSub || 0, 2));
  const [weekSubMax, setWeekSubMax] = useState(Math.max(draft?.weekSubMax || 0, draft?.weekSub || 0, maxStep > 0 ? 2 : 0));
  const goSub = s => {
    const m = Math.max(weekSubMax, s);
    setWeekSub(s); setWeekSubMax(m); setStep(0);
    const held = step === 3 ? heldItem.current?.() : null;
    if (held) { updateItem(held.id, held.patch, { step: 0, weekSub: s, weekSubMax: m }, { background: true }); return; }
    saveDraft({ step: 0, weekSub: s, weekSubMax: m }, { background: true });
  };
  // Inventory walks the storage places: the header's tabs and the footer drive it. locMax: the
  // furthest place reached (done places get a ✓). placed: items given a place on the No place
  // tab during this pass; they stay there until you leave Inventory (brief §5).
  const [locIdx, setLocIdx] = useState(0);
  const [locMax, setLocMax] = useState(maxStep > 2 ? 99 : 0);
  const goLoc = i => { setLocIdx(i); setLocMax(m => Math.max(m, i)); };
  const [placed, setPlaced] = useState({});
  useEffect(() => { if (step !== 2) setPlaced({}); }, [step]);
  // Scroll position (11/24): anything that changes what's shown starts at the top: opening Plan,
  // switching week (this component remounts), Calendar / Who's home / Time, steps, Inventory's
  // places. Edits on the same screen never move it.
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [step, weekSub, locIdx]);
  // The item panel's "All details ›" (Inventory, Confirm) opens the item page here, inside Plan,
  // so "‹ Inventory" / "‹ Confirm" comes back to the same place and scroll position with the
  // panel closed (brief §5, 11/24).
  const [itemPage, setItemPage] = useState(null);
  const itemReturnY = useRef(null);
  const openItem = back => id => { itemReturnY.current = window.scrollY; setItemPage({ id, back }); };
  useLayoutEffect(() => {
    if (itemPage) window.scrollTo(0, 0);
    else if (itemReturnY.current != null) { window.scrollTo(0, itemReturnY.current); itemReturnY.current = null; }
  }, [itemPage]);
  // Confirm registers its order snapshot here; Next / Finish plan save it with the step change.
  const beforeNext = useRef(null);
  // Confirm registers its open panel's held choice here ({ id, patch } or null).
  const heldItem = useRef(null);
  // The week view puts its controls (Week check, Suggest all, Compact) in the sticky header.
  const [headSlot, setHeadSlot] = useState(null);
  // The sticky header's height, for group labels that stick under it (Confirm, 11/16 pattern).
  const headObs = useRef(null);
  const headRef = useCallback(el => {
    headObs.current?.disconnect(); headObs.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const set = () => document.documentElement.style.setProperty("--plan-head-h", el.offsetHeight + "px");
    set();
    headObs.current = new ResizeObserver(set);
    headObs.current.observe(el);
  }, []);

  // ── The frame (spec §2): title, step bar, the step's own header control; the step;
  // a Prev / Next bar fixed above the tab bar. ──────────────────────────────────────
  if (!draft) {
    const start = nextDateForShoppingDay(db.settings?.shoppingDay || "Wednesday");
    return (
      <div className="plan">
        <header className="plan-head">
          <div className="plan-title-row"><h1 className="ui-screen-title">{weekLabel(start)}</h1><HeaderButtons>{headerIcons}</HeaderButtons></div>
          <StepBar step={-1} maxStep={-1} />
        </header>
        <div className="plan-empty"><BlockButton onClick={() => { const next = startPlan(db, start); if (next) persistDB(next); }}>Plan this week</BlockButton></div>
      </div>
    );
  }

  if (itemPage && (db.ingredients || []).some(i => i.id === itemPage.id)) {
    return <ItemPage db={db} persistDB={persistDB} itemId={itemPage.id} onBack={() => setItemPage(null)} backLabel={itemPage.back} onOpenMeal={onOpenMeal} />;
  }

  const dates = weekDates(draft.weekStartDate, extraDaysOf(draft));
  const SUBS = ["Calendar", "Who's home", "Time"];
  const LOCS = inventoryLocs(planIngs, mealPlan, meals, placed);
  const locAt = Math.min(locIdx, LOCS.length - 1);
  const nav = (() => {
    if (step === 0) return {
      prev: weekSub > 0 ? { label: `‹ ${SUBS[weekSub - 1]}`, go: () => goSub(weekSub - 1) } : null,
      next: weekSub < 2 ? { label: `Next: ${SUBS[weekSub + 1]} ›`, go: () => goSub(weekSub + 1) } : { label: "Next: Meals ›", go: () => goToStep(1) },
    };
    if (step === 1) return { prev: { label: "‹ Week", go: () => goToStep(0) }, next: { label: "Next: Inventory ›", go: () => { setLocIdx(0); goToStep(2); } } };
    if (step === 2) return {
      prev: locAt > 0 ? { label: `‹ ${LOCS[locAt - 1]}`, go: () => goLoc(locAt - 1) } : { label: "‹ Meals", go: () => goToStep(1) },
      next: locAt < LOCS.length - 1 ? { label: `Next: ${LOCS[locAt + 1]} ›`, go: () => goLoc(locAt + 1) } : { label: "Next: Confirm ›", go: () => goToStep(3) },
    };
    if (step === 3) return { prev: { label: "‹ Inventory", go: () => { goLoc(LOCS.length - 1); goToStep(2); } }, next: { label: "Next: Order ›", go: () => goToStep(4, beforeNext.current?.() || {}) } };
    return { prev: { label: "‹ Confirm", go: () => goToStep(3) }, next: { label: "Finish plan", go: () => finishPlan(beforeNext.current?.() || {}) } };
  })();

  return (
    <div className="plan">
      <header className="plan-head" ref={headRef}>
        <div className="plan-title-row"><h1 className="ui-screen-title">{weekLabel(draft.weekStartDate)}</h1><HeaderButtons>{headerIcons}</HeaderButtons></div>
        <StepBar step={step} maxStep={maxStep} onGo={i => (i === 0 ? goSub(weekSub) : goToStep(i))} />
        {step === 0 && (
          <Segmented label="Week setup" value={weekSub} onChange={goSub}
            options={SUBS.map((l, i) => ({ value: i, label: <span className="plan-sub">{i <= weekSubMax && i !== weekSub && <span className="plan-sub-done" aria-label="done">✓</span>}{l}</span> }))} />
        )}
        {step === 2 && <LocTabs locs={LOCS} value={locAt} doneUpTo={locMax} onChange={goLoc} />}
        {(step === 1 || step === 3) && <div ref={setHeadSlot} />}
      </header>
      <div className="plan-body">
        {step === 0 && <WeekStep sub={weekSub} db={db} persistDB={persistDB} days={days} dates={dates} dayNotes={dayNotes} setDayNotes={setDayNotesP}
          dayPills={dayPills} setDayPills={setDayPillsP} presence={presence} setPresence={setPresenceP} timeLevels={timeLevels} setTimeLevels={setTimeLevelsP}
          adventurous={!!draft.adventurousWeek} setAdventurous={v => saveDraft({ adventurousWeek: v })} />}
        {step === 1 && <PlanMeals mealPlan={mealPlan} plates={plates} setMealPlan={setMealPlanP} restoreMeals={restoreMeals} commitMealToPlan={commitMealToPlan} timeLevels={timeLevels} presence={presence}
          weekStartDate={draft.weekStartDate} adventurousWeek={!!draft.adventurousWeek} meals={meals} days={days} daysFull={daysFull} dayNotes={dayNotes} dayPills={dayPills}
          setDayNotes={setDayNotesP} setDayPills={setDayPillsP} setPresence={setPresenceP} setTimeLevels={setTimeLevelsP}
          db={db} persistDB={persistDB} extraDays={extraDays} canExtend={canExtend} setExtraDays={setExtraDays} headSlot={headSlot}
          onOpenMeal={onOpenMeal} orderedMeals={draft.orderedAt ? draft.meals : null} />}
        <div>
          {step === 2 && <PlanInventory onOpenItem={openItem("Inventory")} loc={LOCS[locAt]} placed={placed} setPlaced={setPlaced} checkedIds={checkedIds} setCheckedIds={setCheckedIdsP} stapleFlags={stapleFlags} setOrdering={setOrdering} quantities={quantities} setQuantities={setQuantitiesP} mealPlan={mealPlan} meals={meals} ingredients={planIngs} onNext={() => goToStep(3)} days={days} onUpdateItem={updateItem} keptIds={keptIds} />}
          {step === 3 && <PlanConfirm headSlot={headSlot} onOpenMeal={onOpenMeal} onOpenItem={openItem("Confirm")} registerHeld={fn => { heldItem.current = fn; }} inFlow registerNext={fn => { beforeNext.current = fn; }} mode="confirm" onUpdateItem={updateItem} keptIds={keptIds} addedIds={addedIds} onAddFromLibrary={addFromLibrary} checkedIds={checkedIds} setOrdering={setOrdering} addedOff={addedOff} setAddedOff={setAddedOffP} addedItems={addedItems} setAddedItems={setAddedItemsP} stapleFlags={stapleFlags} quantities={quantities} setQuantities={setQuantitiesP} mealPlan={mealPlan} meals={meals} ingredients={planIngs} onNext={() => goToStep(4)} db={db} persistDB={persistDB} days={days} daysFull={daysFull} />}
          {step === 4 && <PlanConfirm inFlow registerNext={fn => { beforeNext.current = fn; }} mode="sparky" onUpdateItem={updateItem} keptIds={keptIds} addedIds={addedIds} checkedIds={checkedIds} setOrdering={setOrdering} addedOff={addedOff} setAddedOff={setAddedOffP} addedItems={addedItems} setAddedItems={setAddedItemsP} stapleFlags={stapleFlags} quantities={quantities} setQuantities={setQuantitiesP} mealPlan={mealPlan} meals={meals} ingredients={planIngs} onFinish={finishPlan} db={db} persistDB={persistDB} days={days} daysFull={daysFull} />}
        </div>
      </div>
      <ActionBar>
        <div className="plan-nav">
          {nav.prev && <button type="button" className="plan-prev" onClick={nav.prev.go}>{nav.prev.label}</button>}
          <BlockButton onClick={nav.next.go}>{nav.next.label}</BlockButton>
        </div>
      </ActionBar>
      <div className="plan-nav-spacer" aria-hidden="true" />
    </div>
  );
}

// The 5-part step bar (Week · Meals · Inventory · Confirm · Order): done parts filled, the
// current one bold; a reached step is a tap target.
function StepBar({ step, maxStep, onGo }) {
  return (
    <ol className="plan-steps" aria-label="Plan steps">
      {PLAN_STEPS.map((label, i) => (
        <li key={label} aria-current={i === step ? "step" : undefined} className={i <= Math.max(step, maxStep) && step >= 0 ? "is-reached" : undefined}>
          <button type="button" disabled={!onGo || i > maxStep || i === step} onClick={() => onGo?.(i)}>
            <span className="plan-step-bar" aria-hidden="true" /><span className="plan-step-label">{label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export { PlanTab };
