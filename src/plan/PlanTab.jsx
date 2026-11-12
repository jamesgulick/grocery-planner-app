// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { MAX_EXTRA_DAYS, extraDaysOf, reconcilePlates } from "../engine/assembleInputs.js";
import { useState } from "react";
import { DAYS_ALL, PLAN_STEPS, addDaysISO, nextDateForShoppingDay, planDays, seedTimeLevels, weekLabel } from "../app/globals.js";
import { getActivePlan, writeActivePlan } from "../app/plans.js";
import { C, S } from "../app/styles.js";
import { defaultNotes } from "../app/weather.js";
import { RefreshReminder, WeekSelector } from "../components/common.jsx";
import { PlanConfirm } from "./PlanConfirm.jsx";
import { PlanInventory } from "./PlanInventory.jsx";
import { PlanMeals } from "./PlanMeals.jsx";

// ── PLAN TAB ───────────────────────────────────────────────────────────────────

function PlanTab({ db, persistDB, onGoToImport, onGoToUnassigned }) {
  // The plan the owner is currently EDITING — follows db.activePlan (current or
  // next), unlike Tonight's cards, which are pinned to today. This plan object
  // doubles as both the live-editing draft and the committed record (they were
  // merged by the two-plan-model migration).
  const draft = getActivePlan(db);
  // Day-ordering follows THIS plan's own weekStartDate, recomputed every
  // render so editing the date (see the date input in PlanWelcome) reorders
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
  const [removedIds, setRemovedIds]   = useState(draft?.removedIds || []);
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
      step, maxStep, timeLevels, presence, mealPlan, plates, checkedIds, removedIds, addedItems, dayNotes, dayPills, stapleFlags, quantities, weather,
      _stepsVer: 4,
      startedAt: draft?.startedAt || new Date().toISOString(),
      ...patch,
    };
    persistDB(writeActivePlan(db, next), opts);
  };

  // RE-FILING AN ITEM ("⋯ edit" on Inventory and Confirm) never changes whether it's on
  // this week's list. Each frequency has its own on-list rule (always: not skipped;
  // staple: flagged; specialty: a planned meal needs it, or it's in keptIds), so a tier
  // change carries the item's current on/off state across to the new tier's rule.
  // keptIds holds specialty items chosen to buy that no planned meal needs. The item
  // and the plan are written in ONE save, so neither write can clobber the other.
  const keptIds = draft?.keptIds || [];
  const updateItem = (id, patch) => {
    const ing = ingredients.find(i => i.id === id);
    if (!ing) return;
    const nextIngredients = ingredients.map(i => i.id === id ? { ...i, ...patch } : i);
    if (!patch.tier || patch.tier === ing.tier) { persistDB({ ...db, ingredients: nextIngredients }); return; }
    const planned = Object.values(mealPlan).flat();
    const mealNeeds = meals.some(m => planned.includes(m.name) && (m.ingredients || []).includes(id));
    const skipped = checkedIds.includes(id);
    const wasOn = ing.tier === "always" ? !skipped
      : ing.tier === "staple" ? !!stapleFlags[id] && !skipped
      : (mealNeeds || keptIds.includes(id)) && !skipped;
    let nChecked = checkedIds.filter(x => x !== id), nFlags = { ...stapleFlags }, nKept = keptIds.filter(x => x !== id);
    delete nFlags[id];
    if (patch.tier === "always" && !wasOn) nChecked.push(id);
    if (patch.tier === "staple" && wasOn) nFlags[id] = true;
    if (patch.tier === "specialty") {
      if (wasOn && !mealNeeds) nKept.push(id);
      if (!wasOn && mealNeeds) nChecked.push(id);
    }
    setCheckedIds(nChecked); setStapleFlags(nFlags);
    const next = {
      ...draft,
      step, maxStep, timeLevels, presence, mealPlan, plates, checkedIds: nChecked, removedIds, addedItems, dayNotes, dayPills, stapleFlags: nFlags, quantities, weather,
      keptIds: nKept, _stepsVer: 4, startedAt: draft?.startedAt || new Date().toISOString(),
    };
    persistDB(writeActivePlan({ ...db, ingredients: nextIngredients }, next));
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
  const setTimeLevelsP  = v => { const nv = typeof v === "function" ? v(timeLevels)  : v; setTimeLevels(nv);  saveDraft({ timeLevels: nv }); };
  const setPresenceP    = v => { const nv = typeof v === "function" ? v(presence)    : v; setPresence(nv);    saveDraft({ presence: nv }); };
  // annotations: plate entries for engine-placed dishes (see platesFromCompose).
  const setMealPlanP    = (v, annotations) => {
    const nv = typeof v === "function" ? v(mealPlan) : v;
    const np = reconcilePlates(mealPlan, nv, plates, db.meals || [], annotations);
    setMealPlan(nv); setPlates(np); saveDraft({ mealPlan: nv, plates: np });
  };
  const setCheckedIdsP  = v => { const nv = typeof v === "function" ? v(checkedIds)  : v; setCheckedIds(nv);  saveDraft({ checkedIds: nv }); };
  const setRemovedIdsP  = v => { const nv = typeof v === "function" ? v(removedIds)  : v; setRemovedIds(nv);  saveDraft({ removedIds: nv }); };
  const setAddedItemsP  = v => { const nv = typeof v === "function" ? v(addedItems)  : v; setAddedItems(nv);  saveDraft({ addedItems: nv }); };
  const setDayNotesP    = v => { const nv = typeof v === "function" ? v(dayNotes)    : v; setDayNotes(nv);    saveDraft({ dayNotes: nv }); };
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
    if (target > extraDays) { saveDraft({ extraDays: target }); return; }
    const gone = []; for (let k = target + 1; k <= extraDays; k++) gone.push(`X${k}`);
    const drop = o => { const c = { ...(o || {}) }; gone.forEach(k => delete c[k]); return c; };
    const nm = drop(mealPlan), np = reconcilePlates(mealPlan, nm, plates, db.meals || []);
    const nn = drop(dayNotes), nt = drop(timeLevels), npr = drop(presence), nd = drop(dayPills);
    setMealPlan(nm); setPlates(np); setDayNotes(nn); setTimeLevels(nt); setPresence(npr); setDayPills(nd);
    saveDraft({ extraDays: target, mealPlan: nm, plates: np, dayNotes: nn, timeLevels: nt, presence: npr, dayPills: nd });
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
      meals = [...meals, { id:"m"+Date.now()+Math.random().toString(36).slice(2,5), createdAt:new Date().toISOString(), name:nm, effort:"medium", type:"dinner", weather:"any", tempAffinity:"neutral", grillable:false, leftovers:"none", preferences:[], notes:"", ingredients:[] }];
    }
    const nextPlates = reconcilePlates(mealPlan, newMealPlan, plates, meals);
    setPlates(nextPlates);
    const nextDraft = { ...draft, step, maxStep, timeLevels, presence, mealPlan:newMealPlan, plates:nextPlates, checkedIds, removedIds, addedItems, dayNotes, stapleFlags, quantities, weather, startedAt: draft?.startedAt || new Date().toISOString() };
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
    const freshLevels = seedTimeLevels();
    const freshMeals  = Object.fromEntries(days.map(d => [d, []]));
    setTimeLevels(freshLevels);
    setPresence({});
    setPlates({});
    setMealPlan(freshMeals);
    setCheckedIds([]);
    setRemovedIds([]);
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
      weekStartDate: seedDate, notes:"", meals:{}, items:[],
      dismissedShared: [],
      // Auto-populate day notes from this week's baked-in schedule so a new plan
      // never starts blank. notesTouched tracks manual edits so a later refresh
      // can tell "never edited" from "deliberately changed".
      step:1, maxStep:1, timeLevels:freshLevels, presence:{}, mealPlan:freshMeals, plates:{}, checkedIds:[], removedIds:[], addedItems:[], dayNotes:{ ...defaultNotes }, dayPills:{}, notesTouched:false, _stepsVer:4, stapleFlags:{}, quantities:{}, weather:"hot", startedAt:new Date().toISOString(),
    };

    persistDB(writeActivePlan({ ...db, mealHistory }, freshPlan));
  };

  // Create plans.next as a fresh, empty plan — the everyday "begin a new week"
  // action once a current plan already exists. Never touches plans.current:
  // the two are independent silos (no meal carry-over, no shared cart — the
  // owner re-adds anything manually). weekStartDate defaults to 7 days after
  // current's own anchor; the owner can edit it afterward (shopping day can
  // shift). Auto-retire (on a later app load) is what promotes this to
  // current once its date arrives; this function never does that itself.
  // Guarded against next already existing — the caller (PlanWelcome) swaps in
  // a "switch to it?" offer instead of calling this when that's the case
  // (SPEC-active-plan-app-wide.md edge-case warnings), but this stays as a
  // defensive backstop rather than silently overwriting.
  const startNextWeek = () => {
    if (db.plans?.next) return;
    const freshMeals = Object.fromEntries(DAYS_ALL.map(d => [d, []]));
    const anchor     = draft?.weekStartDate || new Date().toISOString().split("T")[0];
    const nextStart  = addDaysISO(anchor, 7 + extraDaysOf(draft));   // after any extra days
    const freshPlan = {
      weekStartDate: nextStart, notes:"", meals:{}, items:[],
      dismissedShared:[],
      step:1, maxStep:1, timeLevels:seedTimeLevels(), presence:{}, mealPlan:freshMeals, plates:{}, checkedIds:[], removedIds:[], addedItems:[], dayNotes:{ ...defaultNotes }, dayPills:{}, notesTouched:false, _stepsVer:4, stapleFlags:{}, quantities:{}, weather:"hot", startedAt:new Date().toISOString(),
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

  // Switching activePlan (via <WeekSelector>, below) persists db.activePlan;
  // PlanTab is rendered with key={db.activePlan} (see the tab-switch site in
  // App) so a switch fully remounts this component instead of leaving stale
  // local editing state (step/mealPlan/etc.) pointed at the plan you switched
  // away from — those hooks are only ever seeded once, at mount.

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
        <WeekSelector db={db} persistDB={persistDB} />
        {hasDraft && <StepNav />}
        <div style={S.body}>
          <PlanWelcome
            onStart={startFresh}
            onStartNext={startNextWeek}
            onResume={hasDraft ? () => goToStep(initMaxStep) : null}
            draft={draft}
            persistDB={persistDB}
            db={db}
            onGoToImport={onGoToImport}
            onGoToUnassigned={onGoToUnassigned}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <WeekSelector db={db} persistDB={persistDB} />
      <StepNav />
      <div style={S.body}>
        {step === 1 && <PlanMeals   mealPlan={mealPlan} plates={plates} setMealPlan={setMealPlanP} commitMealToPlan={commitMealToPlan} timeLevels={timeLevels} setTimeLevels={setTimeLevelsP} presence={presence} setPresence={setPresenceP} weekStartDate={draft?.weekStartDate} adventurousWeek={!!draft?.adventurousWeek} setAdventurousWeek={v => saveDraft({ adventurousWeek: v })} meals={meals} onNext={() => goToStep(2)} days={days} daysFull={daysFull} dayNotes={dayNotes} setDayNotes={setDayNotesP} dayPills={dayPills} setDayPills={setDayPillsP} db={db} persistDB={persistDB} extraDays={extraDays} canExtend={canExtend} setExtraDays={setExtraDays} />}
        {step === 2 && <PlanInventory checkedIds={checkedIds} setCheckedIds={setCheckedIdsP} stapleFlags={stapleFlags} setStapleFlags={setStapleFlagsP} quantities={quantities} setQuantities={setQuantitiesP} mealPlan={mealPlan} meals={meals} ingredients={ingredients} onNext={() => goToStep(3)} days={days} onUpdateItem={updateItem} keptIds={keptIds} />}
        {step === 3 && <PlanConfirm mode="confirm" onUpdateItem={updateItem} keptIds={keptIds} checkedIds={checkedIds} removedIds={removedIds} setRemovedIds={setRemovedIdsP} addedItems={addedItems} setAddedItems={setAddedItemsP} stapleFlags={stapleFlags} quantities={quantities} setQuantities={setQuantitiesP} mealPlan={mealPlan} meals={meals} ingredients={ingredients} onNext={() => goToStep(4)} db={db} persistDB={persistDB} days={days} daysFull={daysFull} />}
        {step === 4 && <PlanConfirm mode="sparky" onUpdateItem={updateItem} keptIds={keptIds} checkedIds={checkedIds} removedIds={removedIds} setRemovedIds={setRemovedIdsP} addedItems={addedItems} setAddedItems={setAddedItemsP} stapleFlags={stapleFlags} quantities={quantities} setQuantities={setQuantitiesP} mealPlan={mealPlan} meals={meals} ingredients={ingredients} onFinish={finishPlan} db={db} persistDB={persistDB} days={days} daysFull={daysFull} />}
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

function PlanWelcome({ onStart, onStartNext, onResume, draft, persistDB, db, onGoToImport, onGoToUnassigned }) {
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
        <div style={{ fontSize:14, opacity:0.8, lineHeight:1.5 }}>Plan the week's dinners, then the grocery order</div>
      </div>

      <RefreshReminder dayNotes={draft?.dayNotes} />

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
          {/* Edge case (SPEC-active-plan-app-wide.md): next already exists but
              this card is showing current — instead of a silent no-op, offer
              to switch to it. Not shown when db.activePlan is already "next"
              (this card would then BE next's own draft). */}
          {db.plans?.next && db.activePlan !== "next" && (
            <button style={{ ...S.btn, ...S.btnS, marginTop:8, marginBottom:0 }} onClick={() => persistDB({ ...db, activePlan:"next" })}>
              Next week already exists — switch to it? →
            </button>
          )}
        </div>
      )}

      {/* The one actionable line from the old "at a glance" counts card: items
          with no storage location never come up on the Inventory walk. */}
      {db && (() => {
        const unassigned = (db.ingredients || []).filter(i => i.storageLocation === "Unassigned").length;
        if (!unassigned) return null;
        return (
          <button style={{ display:"block", width:"100%", textAlign:"left", fontSize:13, fontWeight:600, color:C.warning, background:C.warningLight, border:"none", borderRadius:8, padding:"10px 12px", marginBottom:12, cursor:onGoToUnassigned?"pointer":"default" }}
            onClick={onGoToUnassigned} disabled={!onGoToUnassigned}>
            ⚠️ {unassigned} item{unassigned === 1 ? "" : "s"} need{unassigned === 1 ? "s" : ""} a location ›
          </button>
        );
      })()}

      {onGoToImport && (
        <div style={{ textAlign:"center", marginBottom:8 }}>
          <button style={{ background:"none", border:"none", color:C.accentMuted, fontSize:13, cursor:"pointer", textDecoration:"underline" }} onClick={onGoToImport}>
            📥 Import → Config
          </button>
        </div>
      )}

      {!onResume && <button style={{ ...S.btn, ...S.btnP }} onClick={onStart}>Start planning</button>}
    </div>
  );
}

export { PlanTab };
