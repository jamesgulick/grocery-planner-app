// The Meals step: the week view (phase 2 stage 4b, SPEC-plan-flow-v2 §4; boards "Week view ·
// DETAILED", "Week view · COMPACT", "Plate sheet", "Replace sheet", "Move sheet", "Rationale B";
// Decisions 11/12–11/14).
//   Header (at the top of the scrolling list, 11/28: only the title, dates and pickup row and
//     step bar stay pinned): the Week check pill, Suggest all, the share icon, the view toggle.
//   Days: a date header ABOVE the plate (day, clocks, who's out, forecast and grill ok, labels,
//     the note), then a white tile (mains bold, "+ sides", leftovers, plate concerns in amber)
//     or a dashed open tile (Open → pick, Suggest → the engine's pick). Compact: one-line
//     headers and a drag handle; a drag swaps whole nights, and only the meal card moves (11/24).
//   Sheets: the plate sheet (one night: dishes with ↻ / ×, + Add main / side, Move, Clear),
//     Replace (Suggested · 3 from the engine's ranking, then Browse), Move (pick dishes, then
//     Swap or Add on another day) and Week check (concerns with fixes, nothing-to-buy lines,
//     notes).
// Engine calls are the ones the Meals step always made (compose one day, fill empty days,
// suggest sides, the ranked shortlist, reconcilePlates, checkWeek); only the screens are new.
// Engine text is shown verbatim (11/15). `seenThisSession` stays component-local by design.
import { MAX_EXTRA_DAYS, MIN_EXTRA_DAYS, abbrOfISO, assembleComposeInputs, checkWeek, isExtraDay, mealRecency, platesFromCompose, presentOn, reasonsOf, runComposeWeek, seedTimeLevel } from "../engine/assembleInputs.js";
import { composeWeek, evaluateWeek } from "../engine/composeWeek.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { copyToClipboard } from "../app/clipboard.js";
import { draftPlanText } from "../app/shareText.js";
import { addDaysISO, todayLocalISO, weekLabel } from "../app/globals.js";
import { engineGrillOk } from "../app/pills.js";
import { fetchLiveForecast } from "../app/weather.js";
import { absenceLines } from "../app/absence.js";
import { mealMatches } from "../manage/MealEditor.jsx";
import { notHomeCooked } from "../library/libraryModel.js";
import { CheckRow, Clocks, Group, Icon, RowAction, RowChevron, SearchField, Sheet, Switch } from "../ui/kit.jsx";
import { showToast } from "../ui/toast.js";
import { dayTitle, forecastWords } from "./WeekStep.jsx";
import { DaySheet } from "./DaySheet.jsx";
import { rateQueue } from "../rate/rating.js";
import { RateSheet } from "../rate/RateSheet.jsx";
import "../rate/rate.css";
import "./weekview.css";

// Carried-leftover notes arrive one per person ("Partner is covered by Chili carried from
// 2026-09-26"). Display-only: the people held by the same dish on the same night share one line.
function groupLeftoverNotes(texts) {
  const groups = new Map(), loose = [];
  for (const t of texts || []) {
    const m = /^(.+?) is covered by (.+) carried from (\d{4}-\d{2}-\d{2})$/.exec(t);
    if (!m) { loose.push(t); continue; }
    const key = `${m[2]}|${m[3]}`;
    if (!groups.has(key)) groups.set(key, { dish: m[2], from: m[3], people: [] });
    groups.get(key).people.push(m[1]);
  }
  const names = xs => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  return [...[...groups.values()].map(g => `${names(g.people)}: ${g.dish} leftovers (from ${abbrOfISO(g.from)})`), ...loose];
}

const LEVEL_N = { none: 1, some: 2, much: 3 };
const LONG_WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const longTitle = iso => { const d = new Date(iso + "T12:00:00"); return `${LONG_WD[d.getDay()]} ${d.getDate()}`; };
const SHORTLIST_SIZE = 3;

function PlanMeals({ mealPlan, plates, setMealPlan, restoreMeals, commitMealToPlan, timeLevels, presence, weekStartDate, adventurousWeek, meals, days, daysFull, dayNotes, dayPills, setDayNotes, setDayPills, setPresence, setTimeLevels, db, persistDB, extraDays = 0, canExtend = false, setExtraDays, onOpenMeal, orderedMeals, openDay = null, onPlateClose = null, pastWeek = false }) {
  const allMeals = meals;   // no example-meal fallback: an empty device has no meals here either (11/25)
  const today = todayLocalISO();
  const roster = (db.settings?.familyContacts || []).map(f => f.name);
  const awayRanges = db.settings?.awayRanges || [];
  const dateOfDay = Object.fromEntries(days.map((d, i) => [d, weekStartDate ? addDaysISO(weekStartDate, i) : null]));
  const locked = day => !!dateOfDay[day] && dateOfDay[day] < today;   // past days are read-only
  const isOut = (name, day, iso) => !presentOn(presence, awayRanges, name, day, iso);
  const outLines = absenceLines(days.map(d => ({ key: d, iso: dateOfDay[d] })), roster, isOut, awayRanges);
  const dayShort = day => (dateOfDay[day] ? abbrOfISO(dateOfDay[day]) : day);
  const mealRec = name => (db.meals || []).find(m => m.name.trim() === String(name).trim());
  // Rating (brief §2): a past day whose main is Just tried or Incomplete shows Rate; the plate
  // sheet offers Rate on every past dish (Rate, any time). `pastWeek`: Last week, read-only.
  const toRate = new Map(rateQueue(db, today, new Date().getHours()).map(q => [q.meal.id, q]));
  const outOf = day => roster.filter(n => isOut(n, day, dateOfDay[day]));
  const [rating, setRating] = useState(null);

  // Manual picks sort by when a meal was last on the table (Week 5): "last had 3 weeks ago".
  const recency = useMemo(() => mealRecency({ planTail: db.planTail || [], mealHistory: db.mealHistory || [], plans: db.plans || {}, today }), [db.planTail, db.mealHistory, db.plans, today]);
  const recKey = m => (m.name || "").trim().toLowerCase();
  const recencyValue = m => recency.planned[recKey(m)] ? "~" + recency.planned[recKey(m)] : (recency.last[recKey(m)] || "");
  const recencyLabel = m => {
    const p = recency.planned[recKey(m)];
    if (p) return `planned ${abbrOfISO(p)} ${Number(p.slice(8))}`;
    const l = recency.last[recKey(m)];
    if (!l) return "never had";
    const d = Math.round((Date.parse(today) - Date.parse(l)) / 86400000);
    if (d <= 0) return "last had today";
    if (d === 1) return "last had yesterday";
    if (d < 14) return `last had ${d} days ago`;
    return `last had ${Math.round(d / 7)} weeks ago`;
  };

  // The engine's session state: only seenThisSession is carried (session-local by design).
  const [seenThisSession, setSeenThisSession] = useState([]);
  const [fillNotes, setFillNotes] = useState([]);
  const learnMode = !!db.settings?.learnMode;   // the plate sheet's Reasons switch (11/12)
  const setLearnMode = v => persistDB({ ...db, settings: { ...db.settings, learnMode: v } }, { background: true });
  const compact = !!db.settings?.weekCompact;
  const setCompact = v => persistDB({ ...db, settings: { ...db.settings, weekCompact: v } }, { background: true });

  // Live weather for THIS plan's dates (declared before anything that reads it: no hoisting).
  const [forecastByDate, setForecastByDate] = useState({});
  const planDatesKey = days.map(d => dateOfDay[d] || "").join(",");
  useEffect(() => {
    let cancelled = false;
    setForecastByDate({});
    fetchLiveForecast(Object.values(dateOfDay)).then(f => { if (!cancelled) setForecastByDate(f); });
    return () => { cancelled = true; };
  }, [planDatesKey]);
  const grillOpen = db.settings?.grillOpen !== false;

  // The week check: the engine's observations for the plan as it stands.
  const forecastKey = JSON.stringify(forecastByDate);
  const weekCheck = useMemo(() => {
    const planKey = db.activePlan || "current";
    const plan = { ...(db.plans?.[planKey] || {}), weekStartDate, mealPlan, plates, timeLevels, presence, adventurousWeek };
    if (!weekStartDate) return { planned: 0, observations: [], leftovers: {} };
    return checkWeek(evaluateWeek, { db, planKey, plan, forecastByDate, today, days });
  }, [mealPlan, plates, timeLevels, presence, adventurousWeek, forecastKey, db.meals, db.settings, db.planTail, db.mealHistory, weekStartDate, days.join(",")]);

  const dishesOf = day => (mealPlan[day] || []).map((n, i) => {
    const p = plates?.[day]?.dishes?.[i];
    const d = p && p.name === n ? p : null;
    return { name: n, idx: i, entry: d, mealId: d?.mealId || mealRec(n)?.id, role: d?.role || (mealRec(n)?.type === "side" ? "side" : "main"), source: d?.source || "manual" };
  });

  // ── Engine calls (unchanged from the old Meals step) ─────────────────────────────
  const undoTo = () => { const snap = { mealPlan, plates }; return () => restoreMeals?.(snap); };
  const engineErrs = out => out.observations.filter(o => o.severity === "concern" && (o.property === "engine" || o.property === "input" || o.property === "pool"));
  const suggestAll = () => {
    const open = days.filter(d => !locked(d) && !(mealPlan[d] || []).length);
    if (!open.length) { showToast("No open days"); return; }
    const undo = undoTo();
    const planKey = db.activePlan || "current";
    const plan = { ...(db.plans?.[planKey] || {}), weekStartDate, mealPlan, plates, timeLevels, presence };
    let out;
    try {
      const { args, notes } = assembleComposeInputs({ db, planKey, plan, forecastByDate, seenThisSession, today, days });
      out = runComposeWeek(composeWeek, args, notes);
    } catch (e) {
      out = { week: {}, sessionState: { seenThisSession }, rationale: [], observations: [{ property: "input", severity: "concern", text: `Couldn't prepare the planner's inputs: ${e.message}` }] };
    }
    const annotations = platesFromCompose(out, Object.fromEntries(open.map(d => [d, dateOfDay[d]])), db.meals || []);
    setMealPlan(prev => {
      const next = { ...prev };
      Object.entries(annotations).forEach(([d, a]) => { if (!(prev[d] || []).length) next[d] = a.dishes.map(x => x.name); });
      return next;
    }, annotations);
    const filled = Object.values(annotations).filter(a => a.dishes.length).length;
    if (filled) showToast(`Filled ${filled} day${filled === 1 ? "" : "s"}`, undo);
    setSeenThisSession(out.sessionState?.seenThisSession || seenThisSession);
    setFillNotes(engineErrs(out));
  };

  // One target day: the day with what it keeps, other PLANNED days as fixed context, empty days
  // left out (so the engine doesn't fill them first).
  const composeOneDay = (day, keep, extraSeen = []) => {
    const planKey = db.activePlan || "current";
    const mp = { ...mealPlan, [day]: keep };
    const onlyDays = days.filter(d => d === day || (mp[d] || []).length);
    const plan = { ...(db.plans?.[planKey] || {}), weekStartDate, mealPlan: mp, plates, timeLevels, presence, adventurousWeek };
    const seen = [...new Set([...seenThisSession, ...extraSeen.filter(Boolean)])];
    let out;
    try {
      const { args, notes } = assembleComposeInputs({ db, planKey, plan, forecastByDate, seenThisSession: seen, today, days, onlyDays });
      out = runComposeWeek(composeWeek, args, notes);
    } catch (e) {
      out = { week: {}, sessionState: { seenThisSession: seen }, rationale: [], observations: [{ property: "input", severity: "concern", text: `Couldn't prepare the planner's inputs: ${e.message}` }] };
    }
    setSeenThisSession(out.sessionState?.seenThisSession || seen);
    const ann = platesFromCompose(out, { [day]: dateOfDay[day] }, db.meals || [])[day] || { dishes: [], leftovers: [] };
    return { ann, errs: engineErrs(out) };
  };
  const applyDay = (day, names, newDishes, leftovers) => {
    setFillNotes([]);
    setMealPlan(prev => ({ ...prev, [day]: names }), { [day]: { dishes: newDishes, leftovers: leftovers || [] } });
  };

  // Suggest on an open day: the engine's plate for it alone.
  const fillDay = day => {
    const { ann, errs } = composeOneDay(day, []);
    if (!ann.dishes.length) { setFillNotes(errs); showToast("Nothing fits this day"); return; }
    const undo = undoTo();
    applyDay(day, ann.dishes.map(d => d.name), ann.dishes, ann.leftovers);
    showToast(`${dayShort(day)}: ${(ann.dishes.find(d => d.role === "main") || ann.dishes[0]).name}`, undo);
  };

  // The fix a floor concern offers (Ruling 12): the engine's sides for the day's main, only ones
  // not already on the plate; a day with no main gets a main, keeping its sides.
  const suggestSides = day => {
    const cur = dishesOf(day);
    const main = cur.find(d => d.role === "main");
    if (!main) {
      const { ann, errs } = composeOneDay(day, cur.map(d => d.name));
      const newMain = ann.dishes.find(d => d.role === "main");
      if (!newMain) { setFillNotes(errs); showToast("No main fits this day"); return; }
      const undo = undoTo();
      applyDay(day, [newMain.name, ...cur.map(d => d.name)], [newMain], ann.leftovers);
      showToast(`${dayShort(day)}: ${newMain.name}`, undo);
      return;
    }
    const { ann } = composeOneDay(day, [main.name], cur.filter(d => d.role === "side").map(d => d.mealId));
    const onPlate = new Set(cur.map(d => d.name.trim()));
    const sides = ann.dishes.filter(d => d.role === "side" && !onPlate.has(d.name.trim()));
    if (!sides.length) { showToast(`No more sides for ${main.name.trim()}`); return; }
    const undo = undoTo();
    applyDay(day, [...cur.map(d => d.name), ...sides.map(d => d.name)], sides, ann.leftovers);
    showToast(sides.length === 1 ? `Added ${sides[0].name}` : `Added ${sides.map(s => s.name).join(", ")}`, undo);
  };

  // The ranked shortlist (Week 5): the next mains in the engine's ranking for the day, best
  // first, each with its sides; built by asking again with each pick marked seen, so showing
  // them marks them seen. Sides placed by hand stay with whichever main is taken.
  const nextMainOptions = (day, shown) => {
    const cur = dishesOf(day);
    const main = cur.find(d => d.role === "main");
    const keptSides = cur.filter(d => d.role === "side" && d.source === "manual");
    const extra = [main?.mealId, ...shown].filter(Boolean);
    const already = new Set([...seenThisSession, ...extra]);
    const options = [];
    let exhausted = false, note = null;
    for (let i = 0; i < SHORTLIST_SIZE; i++) {
      const r = composeOneDay(day, keptSides.map(d => d.name), extra);
      const m = r.ann.dishes.find(d => d.role === "main");
      const poolLine = m && reasonsOf(m).find(x => x.factor === "pool-exhausted");
      if (!m || !m.mealId || already.has(m.mealId)) { exhausted = true; note = poolLine?.text || null; break; }
      already.add(m.mealId); extra.push(m.mealId);
      options.push({ main: m, sides: r.ann.dishes.filter(d => d.role === "side" && !keptSides.some(k => k.name === d.name)), leftovers: r.ann.leftovers });
      if (poolLine) { exhausted = true; note = poolLine.text; break; }
    }
    return { options, exhausted, note };
  };
  // Sides the engine would put with this day's main, next ones first (each round marks the
  // last ones seen).
  const nextSideOptions = (day, shown) => {
    const cur = dishesOf(day);
    const main = cur.find(d => d.role === "main");
    if (!main) return { options: [], exhausted: true, note: null };
    const onPlate = new Set(cur.map(d => d.name.trim()));
    const seen = [...cur.filter(d => d.role === "side").map(d => d.mealId), ...shown];
    const options = [];
    for (let round = 0; round < SHORTLIST_SIZE && options.length < SHORTLIST_SIZE; round++) {
      const { ann } = composeOneDay(day, [main.name], seen);
      const fresh = ann.dishes.filter(d => d.role === "side" && d.mealId && !onPlate.has(d.name.trim()) && !seen.includes(d.mealId));
      if (!fresh.length) return { options, exhausted: true, note: null };
      for (const s of fresh) { if (options.length < SHORTLIST_SIZE) options.push({ side: s }); seen.push(s.mealId); }
    }
    return { options, exhausted: false, note: null };
  };

  // ── Edits ──────────────────────────────────────────────────────────────────────
  const addMeal = (day, name, isNew = false) => {
    commitMealToPlan({ ...mealPlan, [day]: [...(mealPlan[day] || []), name] }, isNew ? name : null);
    showToast(mealRec(name)?.type === "side" ? `Added ${name}` : `${dayShort(day)}: ${name}`);
  };
  const replaceMeal = (day, idx, name, isNew = false) => {
    const u = [...(mealPlan[day] || [])]; u[idx] = name;
    commitMealToPlan({ ...mealPlan, [day]: u }, isNew ? name : null);
  };
  // A ranked main for slot idx: the first main brings its sides (dropping the engine's old
  // ones); a second main just swaps its name. An open day takes the whole plate.
  const takeMainOption = (day, idx, o) => {
    const cur = dishesOf(day);
    const firstMainIdx = cur.findIndex(d => d.role === "main");
    if (idx == null || !cur.length) { applyDay(day, [o.main.name, ...cur.map(d => d.name), ...o.sides.map(d => d.name)], [o.main, ...o.sides], o.leftovers); return; }
    if (idx !== firstMainIdx) { applyDay(day, cur.map((d, i) => (i === idx ? o.main.name : d.name)), [o.main], null); return; }
    const kept = cur.filter((d, i) => i === idx || !(d.role === "side" && d.source !== "manual"));
    const names = kept.map(d => (d.idx === idx ? o.main.name : d.name));
    o.sides.forEach(s => { if (!names.includes(s.name)) names.push(s.name); });
    applyDay(day, names, [o.main, ...o.sides], o.leftovers);
  };
  const takeSideOption = (day, idx, s) => {
    const cur = dishesOf(day);
    applyDay(day, idx == null ? [...cur.map(d => d.name), s.name] : cur.map((d, i) => (i === idx ? s.name : d.name)), [s], null);
    if (idx == null) showToast(`Added ${s.name}`);
  };
  const removeMeal = (day, idx) => {
    const name = (mealPlan[day] || [])[idx], undo = undoTo();
    setMealPlan(prev => ({ ...prev, [day]: (prev[day] || []).filter((_, i) => i !== idx) }));
    if (name) showToast(`Removed ${name}`, undo);
  };
  const clearDay = day => {
    const undo = undoTo();
    setMealPlan(prev => ({ ...prev, [day]: [] }));
    showToast(`Cleared ${dayShort(day)}`, undo);
  };
  // Plate entries travel with their dishes on a move (reasons, source), so nothing is relabelled.
  const entriesFor = (day, idxs) => idxs.map(i => dishesOf(day)[i]?.entry).filter(Boolean);
  const swapNights = (a, b) => {
    if (a === b) return;
    const undo = undoTo();
    const ea = entriesFor(a, (mealPlan[a] || []).map((_, i) => i)), eb = entriesFor(b, (mealPlan[b] || []).map((_, i) => i));
    setMealPlan(prev => ({ ...prev, [a]: prev[b] || [], [b]: prev[a] || [] }), { [a]: { dishes: eb, leftovers: [] }, [b]: { dishes: ea, leftovers: [] } });
    const [x, y] = dateOfDay[a] < dateOfDay[b] ? [a, b] : [b, a];
    showToast(`Swapped ${dayShort(x)} and ${dayShort(y)}`, undo);
  };
  // Move (11/14): unchecked dishes always stay; Swap sends the checked ones there and brings
  // everything from that day here; Add sends them and brings nothing back.
  const moveDishes = (from, idxs, to, swap) => {
    const undo = undoTo();
    const src = mealPlan[from] || [], dst = mealPlan[to] || [];
    const moving = idxs.map(i => src[i]), staying = src.filter((_, i) => !idxs.includes(i));
    const nextFrom = swap ? [...staying, ...dst] : staying;
    const nextTo = swap ? moving : [...dst, ...moving];
    const stayIdx = src.map((_, i) => i).filter(i => !idxs.includes(i));
    const ann = {
      [from]: { dishes: [...entriesFor(from, stayIdx), ...(swap ? entriesFor(to, dst.map((_, i) => i)) : [])], leftovers: [] },
      [to]: { dishes: [...(swap ? [] : entriesFor(to, dst.map((_, i) => i))), ...entriesFor(from, idxs)], leftovers: [] },
    };
    setMealPlan(prev => ({ ...prev, [from]: nextFrom, [to]: nextTo }), ann);
    const back = swap && dst.length ? ` · ${dst.join(", ")} → ${dayShort(from)}` : "";
    showToast(`${moving.join(", ")} → ${dayShort(to)}${back}`, undo);
  };

  const share = async () => {
    const text = draftPlanText(days, daysFull, mealPlan);
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e?.name === "AbortError") return; }
    copyToClipboard(text);
    showToast("Copied plan");
  };

  // ── What each day shows ────────────────────────────────────────────────────────
  // Past nights can't be fixed (11/25): no amber on them, and the Week check lists today onward.
  const checkObs = (weekCheck.observations || []).filter(o => !o.day || !locked(o.day));
  const concernsByDay = {};
  for (const o of checkObs) if (o.severity === "concern" && o.day) (concernsByDay[o.day] = concernsByDay[o.day] || []).push(o);
  // Ruling 17.1: a planned home-cooked dish with nothing on its ingredient list (the app's line).
  const nothingToBuy = [];
  for (const day of days.filter(d => !locked(d))) for (const d of dishesOf(day)) {
    const m = mealRec(d.name);
    if (m && !(m.ingredients || []).length && !notHomeCooked(m)) nothingToBuy.push({ day, name: d.name.trim(), id: m.id });
  }
  // A plate changed after ordering (11/12): its dishes differ from the order's snapshot.
  const changedSinceOrder = day => !!orderedMeals && JSON.stringify(orderedMeals[day] || []) !== JSON.stringify(mealPlan[day] || []);

  // ── Sheets ─────────────────────────────────────────────────────────────────────
  // `openDay`: Home's meal taps open that day's sheet over the week view (stage 4e); its Done
  // then returns to Home (onPlateClose).
  const [plateDay, setPlateDay] = useState(openDay);
  const [detail, setDetail] = useState(null);     // { day, stacked }: the day details sheet, alone or on the meals sheet
  const daySheet = detail && (
    <DaySheet day={detail.day} days={days} dates={dateOfDay} family={roster} ranges={awayRanges} forecast={forecastByDate}
      dayNotes={dayNotes} setDayNotes={setDayNotes} dayPills={dayPills} setDayPills={setDayPills} presence={presence} setPresence={setPresence}
      timeLevels={timeLevels} setTimeLevels={setTimeLevels} readOnly={locked(detail.day)} onClose={() => setDetail(null)} />
  );
  const [choose, setChoose] = useState(null);     // { day, idx|null, kind: "main"|"side", title }
  const [moveFrom, setMoveFrom] = useState(null);
  const [removeAsk, setRemoveAsk] = useState(null);   // the last day, while "Remove Thu 3?" is open (audit 11/25)
  const [checkOpen, setCheckOpen] = useState(false);

  // ── Compact: drag a night onto another to swap them (11/12) ───────────────────────
  const [drag, setDrag] = useState(null);   // { from, over, dy, y0 }
  const dragRef = useRef(null);
  // Compact: swipe a day left to reveal Clear (brief §4, board "Plan › Meals rows" C). One day open
  // at a time; a swipe past most of the tile clears at once. Horizontal moves only, so the page
  // still scrolls; the drag handle keeps its own gesture.
  const [swipe, setSwipe] = useState(null);   // { day, dx, open, moving }
  const swipeRef = useRef(null);
  const SWIPE_CLEAR_W = 88;
  const onSwipeDown = (e, day) => {
    swipeRef.current = { day, x0: e.clientX, y0: e.clientY, base: swipe?.day === day && swipe.open ? -SWIPE_CLEAR_W : 0, horiz: null, w: e.currentTarget.getBoundingClientRect().width };
  };
  const onSwipeMove = e => {
    const s = swipeRef.current; if (!s) return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    if (s.horiz == null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      s.horiz = Math.abs(dx) > Math.abs(dy);
      if (s.horiz) e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (s.horiz) { s.pos = Math.min(0, s.base + dx); setSwipe({ day: s.day, dx: s.pos, open: false, moving: true }); }
  };
  const onSwipeUp = () => {
    const s = swipeRef.current; swipeRef.current = null;
    if (!s || !s.horiz) return;
    s.suppress = true; swipeClick.current = s.day;
    if (s.pos < -s.w * 0.6) { setSwipe(null); clearDay(s.day); }
    else if (s.pos < -SWIPE_CLEAR_W / 2) setSwipe({ day: s.day, dx: -SWIPE_CLEAR_W, open: true });
    else setSwipe(null);
  };
  const swipeClick = useRef(null);   // the day whose swipe just ended: its click doesn't open the sheet
  const onHandleDown = (e, day) => {
    if (locked(day)) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no capture: moves still reach the handle */ }
    dragRef.current = { from: day, over: day, y0: e.clientY, dy: 0 };
    setDrag(dragRef.current);
  };
  const onHandleMove = e => {
    const d = dragRef.current;
    if (!d) return;
    const el = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.dataset?.day && x.dataset.day !== d.from);
    const over = el && !locked(el.dataset.day) ? el.dataset.day : d.from;
    dragRef.current = { ...d, dy: e.clientY - d.y0, over };
    setDrag(dragRef.current);
  };
  const onHandleUp = () => {
    const d = dragRef.current;
    dragRef.current = null; setDrag(null);
    if (d && d.over !== d.from) swapNights(d.from, d.over);
  };

  const concernCount = checkObs.filter(o => o.severity === "concern").length + fillNotes.length + nothingToBuy.length;
  const noteCount = checkObs.filter(o => o.severity !== "concern").length;
  const checkWords = [concernCount && `${concernCount} concern${concernCount === 1 ? "" : "s"}`, noteCount && `${noteCount} note${noteCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ");

  const header = (
    <div className="wv-head">
      <button type="button" className="wv-check" onClick={() => setCheckOpen(true)}>
        {concernCount > 0 && <span className="wv-dot" aria-hidden="true" />}
        <span className="wv-check-text"><strong>Week check</strong>{checkWords && <span className="wv-check-sub"> · {checkWords}</span>}</span>
        <RowChevron />
      </button>
      <div className="wv-actions">
        <button type="button" className="wv-suggest-all" onClick={suggestAll}>Suggest all</button>
        <button type="button" className="wv-share" aria-label="Share draft plan with family" onClick={share}><Icon name="share" size={20} /></button>
        <ViewToggle compact={compact} onChange={setCompact} />
      </div>
    </div>
  );

  return (
    <div className={compact ? "wv is-compact" : "wv"}>
      {!pastWeek && header}
      {days.map(day => {
        const iso = dateOfDay[day];
        const dishes = dishesOf(day);
        const mains = dishes.filter(d => d.role === "main"), sides = dishes.filter(d => d.role === "side");
        const fc = forecastByDate[iso];
        const wx = [forecastWords(fc), engineGrillOk(grillOpen, fc) && "grill ok"].filter(Boolean);
        const pills = (dayPills?.[day] || []).filter(p => p.label !== "grill");
        const note = (dayNotes?.[day] || "").trim();
        const level = (timeLevels || {})[day] || seedTimeLevel(iso ? abbrOfISO(iso) : day);
        const concerns = concernsByDay[day] || [];
        const leftovers = groupLeftoverNotes(weekCheck.leftovers?.[day]);
        const past = locked(day);
        const rateMain = past ? mains.map(d => toRate.get(d.mealId)).find(Boolean) : null;
        const changed = !past && dishes.length > 0 && changedSinceOrder(day);
        const isDragged = drag?.from === day, isTarget = drag && drag.over === day && drag.from !== day;
        return (
          <section key={day} data-day={day} className={["wv-day", past && !rateMain && "is-past", isDragged && "is-dragged", isTarget && "is-target"].filter(Boolean).join(" ")}>
            <DayBar onOpen={() => setDetail({ day, stacked: false })}>
              <div className="wv-date-line day-line">
                <span className="day-dow">{iso ? dayTitle(iso) : daysFull[days.indexOf(day)]}</span>
                <Clocks n={LEVEL_N[level] || 2} />
                {wx.map(w => <span key={w} className="day-wx">{w}</span>)}
                {(outLines[day] || []).map(l => <span key={l} className="day-out">{l}</span>)}
                {(compact ? pills.slice(0, 1) : pills).map(p => <span key={p.label} className="wv-label">{p.label}{compact && pills.length > 1 ? ` +${pills.length - 1}` : ""}</span>)}
                {compact && note && <span className="wv-note-inline day-note">{note}</span>}
              </div>
              {!compact && note && <div className="wv-note day-note">{note}</div>}
            </DayBar>
            {dishes.length === 0 ? (
              <div className="wv-open">
                {past ? <span className="wv-open-label">—</span> : <>
                  <button type="button" className="wv-open-label" onClick={() => setChoose({ day, idx: null, kind: "main", title: `Pick for ${dayTitle(iso)}` })}>Open</button>
                  <RowAction onClick={() => fillDay(day)}>Suggest</RowAction>
                </>}
              </div>
            ) : !compact ? (
              // Detailed (brief §4, board "Plan › Meals rows" B + C): one row per dish, full-width lines,
              // main bold, sides regular, the meal's notes under its name (2 lines). Quiet ↻ and × on the
              // right do what the day sheet's do; tapping a name opens the day's meals sheet.
              <div className={concerns.length || changed ? "wv-tile is-rows has-problem" : "wv-tile is-rows"}>
                {[...mains, ...sides].map(d => {
                  const note = (mealRec(d.name)?.notes || "").trim();
                  return (
                    <div key={d.idx} className="wv-row">
                      <button type="button" className="wv-row-body" onClick={() => setPlateDay(day)}>
                        <span className={d.role === "main" ? "wv-row-name is-main" : "wv-row-name"}>{d.name.trim()}</span>
                        {note && <span className="wv-row-note">{note}</span>}
                      </button>
                      {d === mains[0] && rateMain && <RowAction onClick={() => setRating([{ mealId: rateMain.meal.id, iso, out: outOf(day), why: rateMain.why }])}>Rate</RowAction>}
                      {!past && <>
                        <button type="button" className="wv-row-icon" aria-label={`Replace ${d.name.trim()}`} onClick={() => setChoose({ day, idx: d.idx, kind: d.role, title: `Replace ${d.name.trim()}` })}><Icon name="replace" size={20} /></button>
                        <button type="button" className="wv-row-icon" aria-label={`Remove ${d.name.trim()}`} onClick={() => removeMeal(day, d.idx)}><Icon name="close" size={18} /></button>
                      </>}
                    </div>
                  );
                })}
                {(leftovers.length > 0 || concerns.length > 0 || changed) && (
                  <button type="button" className="wv-row-foot" onClick={() => setPlateDay(day)}>
                    {leftovers.map((t, k) => <span key={k} className="wv-sides">{t}</span>)}
                    {concerns.map((o, k) => <span key={k} className="wv-concern">{o.text}</span>)}
                    {changed && <span className="wv-concern">Check ingredients</span>}
                  </button>
                )}
              </div>
            ) : (
              <div className="wv-swipe">
              {!past && swipe?.day === day && <button type="button" className="wv-swipe-clear" tabIndex={swipe?.day === day && swipe.open ? 0 : -1}
                onClick={() => { setSwipe(null); clearDay(day); }}>Clear</button>}
              <div className={concerns.length || changed ? "wv-tile has-problem" : "wv-tile"}
                style={{ transform: `translate(${swipe?.day === day ? swipe.dx : 0}px, ${isDragged ? drag.dy : 0}px)`, transition: swipe?.day === day && swipe.moving ? "none" : undefined }}>
                <button type="button" className="wv-tile-body"
                  onPointerDown={past ? undefined : e => onSwipeDown(e, day)} onPointerMove={past ? undefined : onSwipeMove} onPointerUp={past ? undefined : onSwipeUp} onPointerCancel={past ? undefined : onSwipeUp}
                  onClick={() => {
                    if (swipeClick.current === day) { swipeClick.current = null; return; }
                    if (swipe?.day === day && swipe.open) { setSwipe(null); return; }
                    setPlateDay(day);
                  }}>
                  {(
                    <span className="wv-tile-line"><span className="wv-mains">{mains.map(d => d.name).join(", ") || "—"}</span>{sides.length > 0 && <span className="wv-sides">  + {sides.map(d => d.name).join(", ")}</span>}</span>
                  )}
                  {concerns.map((o, k) => <span key={k} className="wv-concern">{o.text}</span>)}
                  {changed && <span className="wv-concern">Check ingredients</span>}
                </button>
                {rateMain && <RowAction onClick={() => setRating([{ mealId: rateMain.meal.id, iso, out: outOf(day), why: rateMain.why }])}>Rate</RowAction>}
                {compact ? (!past && <span className="wv-handle" role="button" tabIndex={-1} aria-label="Drag to another day"
                  onPointerDown={e => onHandleDown(e, day)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}><Icon name="handle" size={18} /></span>)
                  : <RowChevron />}
              </div>
              </div>
            )}
          </section>
        );
      })}
      {canExtend && weekStartDate && (extraDays < MAX_EXTRA_DAYS || extraDays > MIN_EXTRA_DAYS) && (
        // In date order (11/24): Remove <last day> on the left, the dashed + Add <next day> filling
        // the rest on the right, on the thumb side like Next. Each shows only when allowed.
        <div className="wv-extend">
          {extraDays > MIN_EXTRA_DAYS && (() => {
            const last = days[days.length - 1];   // 5–9 days (RULING 15): down to the 5th day
            return <button type="button" className="wv-remove-day" onClick={() => { if ((mealPlan[last] || []).length) setRemoveAsk(last); else setExtraDays(extraDays - 1); }}>Remove {dayTitle(dateOfDay[last])}</button>;
          })()}
          {extraDays < MAX_EXTRA_DAYS && <button type="button" className="wv-add-day" onClick={() => setExtraDays(extraDays + 1)}>+ Add {dayTitle(addDaysISO(weekStartDate, 7 + extraDays))}</button>}
        </div>
      )}
      {/* Where the next plan starts (board "Pickup day"): "Next: Week of Nov 25 · Wed 25". */}
      {canExtend && weekStartDate && <div className="wv-next-week">Next: {weekLabel(addDaysISO(weekStartDate, 7 + extraDays))} · <Icon name="cart" size={14} /> {dayTitle(addDaysISO(weekStartDate, 7 + extraDays))}</div>}

      {detail && !detail.stacked && daySheet}
      {plateDay && (
        <PlateSheet day={plateDay} iso={dateOfDay[plateDay]} past={locked(plateDay)} dishes={dishesOf(plateDay)} level={(timeLevels || {})[plateDay] || seedTimeLevel(abbrOfISO(dateOfDay[plateDay]))}
          note={(dayNotes?.[plateDay] || "").trim()} concerns={concernsByDay[plateDay] || []} learnMode={learnMode} setLearnMode={setLearnMode}
          onClose={() => { setPlateDay(null); onPlateClose?.(); }} onEdit={() => setDetail({ day: plateDay, stacked: true })} onOpenMeal={onOpenMeal}
          stacked={detail?.stacked && detail.day === plateDay ? daySheet : null}
          onFix={() => suggestSides(plateDay)}
          onReplace={d => setChoose({ day: plateDay, idx: d.idx, kind: d.role, title: `Replace ${d.name.trim()}` })}
          onRemove={d => removeMeal(plateDay, d.idx)}
          onAdd={kind => setChoose({ day: plateDay, idx: null, kind, title: kind === "side" ? "Add a side" : "Add a main" })}
          onMove={() => setMoveFrom(plateDay)}
          onClear={() => { clearDay(plateDay); setPlateDay(null); }}
          onRate={d => setRating([{ mealId: d.mealId, iso: dateOfDay[plateDay], out: outOf(plateDay) }])} />
      )}
      {choose && (
        <ChooseSheet key={`${choose.day}-${choose.idx}-${choose.kind}`} choose={choose} allMeals={allMeals} recencyValue={recencyValue} recencyLabel={recencyLabel}
          present={roster.filter(n => !isOut(n, choose.day, dateOfDay[choose.day]))}
          // A second main is placed by hand only, never composed (11/14): no Suggested for it.
          suggest={choose.kind === "side" ? (dishesOf(choose.day).some(d => d.role === "main") ? shown => nextSideOptions(choose.day, shown) : null)
            : (choose.idx == null && dishesOf(choose.day).some(d => d.role === "main")) ? null : shown => nextMainOptions(choose.day, shown)}
          onTake={o => { if (o.side) takeSideOption(choose.day, choose.idx, o.side); else takeMainOption(choose.day, choose.idx, o); setChoose(null); }}
          onPick={(name, isNew) => { if (choose.idx == null) addMeal(choose.day, name, isNew); else replaceMeal(choose.day, choose.idx, name, isNew); setChoose(null); }}
          onCancel={() => setChoose(null)} />
      )}
      {/* Removing a day with meals (brief §13.14): our own fit sheet, not the browser's confirm. Its
          dishes and note as plain rows; Cancel (white) and Remove (red outline). No helper sentence. */}
      {removeAsk && (
        <Sheet title={`Remove ${dayTitle(dateOfDay[removeAsk])}?`} onClose={() => setRemoveAsk(null)} noDone>
          <Group>
            {dishesOf(removeAsk).map(d => <div key={d.idx} className="ui-row"><span className={d.role === "main" ? "ui-row-main ui-strong" : "ui-row-main"}>{d.name.trim()}</span></div>)}
            {(dayNotes?.[removeAsk] || "").trim() && <div className="ui-row"><span className="ui-row-main">{dayNotes[removeAsk].trim()}</span></div>}
          </Group>
          <div className="data-pair data-erase">
            <button type="button" className="ui-block-button ui-block-plain" onClick={() => setRemoveAsk(null)}>Cancel</button>
            <button type="button" className="ui-block-button ui-block-delete" onClick={() => { setRemoveAsk(null); setExtraDays(extraDays - 1); }}>Remove</button>
          </div>
        </Sheet>
      )}
      {moveFrom && (
        <MoveSheet from={moveFrom} title={`Move from ${longTitle(dateOfDay[moveFrom])}`} dishes={dishesOf(moveFrom)} mealRec={mealRec}
          targets={days.filter(d => d !== moveFrom && !locked(d)).map(d => ({ day: d, label: dayTitle(dateOfDay[d]), dishes: dishesOf(d) }))}
          onGo={(idxs, to, swap) => { moveDishes(moveFrom, idxs, to, swap); setMoveFrom(null); setPlateDay(null); }}
          onCancel={() => setMoveFrom(null)} />
      )}
      {rating && <RateSheet db={db} persistDB={persistDB} items={rating} onClose={() => setRating(null)} onOpenMeal={onOpenMeal} />}
      {checkOpen && (
        <Sheet tall title="Week check" onClose={() => setCheckOpen(false)}>
          <WeekCheckBody observations={checkObs} fillNotes={fillNotes} nothingToBuy={nothingToBuy} dayShort={dayShort}
            hasMain={d => dishesOf(d).some(x => x.role === "main")} onFix={suggestSides} onOpenMeal={onOpenMeal ? id => { setCheckOpen(false); onOpenMeal(id); } : null} />
        </Sheet>
      )}
    </div>
  );
}

// ── Plate sheet (board "Plate sheet"): everything about one night ─────────────────────────
// The Meals day bar: the whole bar opens the day details sheet, with a › at its right edge.
// A locked past day's sheet opens read-only.
function DayBar({ onOpen, children }) {
  return (
    <button type="button" className="wv-date is-tappable" onClick={onOpen}>
      <span className="wv-date-body">{children}</span>
      <RowChevron />
    </button>
  );
}

function PlateSheet({ iso, past, dishes, level, note, concerns, learnMode, setLearnMode, onClose, onEdit, stacked, onOpenMeal, onFix, onReplace, onRemove, onAdd, onMove, onClear, onRate }) {
  const hasMain = dishes.some(d => d.role === "main");
  const sub = (
    <div className="wv-plate-sub">
      <Clocks n={LEVEL_N[level] || 2} />
      {note && <span>{note}</span>}
      {onEdit && !past && <button type="button" className="wv-link" onClick={onEdit}>Edit</button>}
    </div>
  );
  const ordered = [...dishes.filter(d => d.role === "main"), ...dishes.filter(d => d.role === "side")];
  return (
    <Sheet tall title={longTitle(iso)} onClose={onClose}
      headerExtra={<label className="wv-compact">Reasons<Switch small checked={learnMode} onChange={setLearnMode} label="Reasons" /></label>}>
      <div className="wv-sheet">
        {sub}
        {concerns.map((o, k) => (
          <div key={k} className="wv-fix is-plate">
            <span className="wv-dot" aria-hidden="true" />
            <span className="wv-fix-text">{o.text}</span>
            {!past && o.property === "floor" && <RowAction onClick={onFix}>{hasMain ? "Add side" : "Suggest"}</RowAction>}
          </div>
        ))}
        <Group>
          {ordered.map(d => {
            const why = reasonsOf(d.entry).filter(r => learnMode || r.visibility === "always");
            return (
              <div key={d.idx} className="wv-dish">
                <div className="wv-dish-main">
                  {d.mealId && onOpenMeal
                    ? <button type="button" className={d.role === "main" ? "wv-dish-name is-main" : "wv-dish-name"} onClick={() => onOpenMeal(d.mealId)}>{d.name.trim()} <span className="wv-inline-chev">›</span></button>
                    : <span className={d.role === "main" ? "wv-dish-name is-main" : "wv-dish-name"}>{d.name.trim()}</span>}
                  {why.map((r, k) => <span key={k} className="ui-meta">{r.text}</span>)}
                </div>
                {past && d.mealId && onRate && <RowAction onClick={() => onRate(d)}>Rate</RowAction>}
                {!past && <>
                  <button type="button" className="ui-icon-button wv-replace" aria-label={`Replace ${d.name.trim()}`} onClick={() => onReplace(d)}><Icon name="replace" size={20} strong /></button>
                  <button type="button" className="ui-icon-button wv-remove" aria-label={`Remove ${d.name.trim()}`} onClick={() => onRemove(d)}><Icon name="close" size={18} /></button>
                </>}
              </div>
            );
          })}
          {!past && (
            <div className="wv-adds">
              <button type="button" className="wv-link" onClick={() => onAdd("main")}>+ Add main</button>
              <button type="button" className="wv-link" onClick={() => onAdd("side")}>+ Add side</button>
            </div>
          )}
        </Group>
        {!past && (
          <Group>
            <button type="button" className="ui-row" onClick={onMove}><span className="ui-row-main">Move to another day</span><RowChevron /></button>
            <button type="button" className="ui-row" onClick={onClear}><span className="ui-row-main">Clear this day</span></button>
          </Group>
        )}
      </div>
      {stacked}
    </Sheet>
  );
}

// ── Replace sheet (§4.5): Suggested · 3 from the engine's ranking, then Browse ─────────────
function ChooseSheet({ choose, allMeals, recencyValue, recencyLabel, present, suggest, onTake, onPick, onCancel }) {
  const wantSide = choose.kind === "side";
  // Asked for just after the sheet mounts, before it paints: asking the engine updates the Meals
  // step's seen list, which mustn't happen while this sheet is rendering (React warning, 11/25).
  const [sugg, setSugg] = useState(null);
  useLayoutEffect(() => { if (suggest) setSugg(suggest([])); }, []);
  const [q, setQ] = useState("");
  const more = () => {
    const shown = sugg.options.map(o => (o.side ? o.side.mealId : o.main.mealId));
    const next = suggest(shown);
    setSugg({ options: [...sugg.options, ...next.options], exhausted: next.exhausted, note: next.note });
  };
  const list = useMemo(() => {
    const base = (q.trim() ? allMeals.filter(m => mealMatches(m, q)) : allMeals).filter(m => (m.type === "side") === wantSide);
    return [...base].sort((a, b) => {
      const va = recencyValue(a), vb = recencyValue(b);
      return va !== vb ? (va < vb ? -1 : 1) : a.name.localeCompare(b.name);
    });
  }, [q, allMeals, wantSide]);
  const wontEat = m => present.filter(n => (m.preferences || []).some(p => p.person === n && p.pref === "dislikes"));
  const exact = q.trim() && allMeals.some(m => m.name.trim().toLowerCase() === q.trim().toLowerCase());
  return (
    <Sheet tall title={choose.title} onClose={onCancel} onCancel={onCancel} noDone>
      <div className="wv-sheet">
        {sugg && (sugg.options.length > 0 || sugg.note) && (
          <section className="wv-section">
            <div className="ui-section-label">Suggested</div>
            <Group>
              {sugg.options.map(o => {
                const lead = o.side ? o.side : o.main;
                const why = reasonsOf(lead).find(r => r.visibility === "always") || reasonsOf(lead)[0];
                return (
                  <button key={lead.mealId} type="button" className="ui-row wv-pick" onClick={() => onTake(o)}>
                    <span className="ui-row-main">
                      <span className={o.side ? undefined : "ui-strong"}>{lead.name.trim()}</span>
                      {!o.side && o.sides.length > 0 && <span className="ui-meta">+ {o.sides.map(s => s.name.trim()).join(", ")}</span>}
                      {why && <span className="ui-meta">{why.text}</span>}
                    </span>
                  </button>
                );
              })}
            </Group>
            {sugg.note && <div className="ui-meta wv-pool">{sugg.note}</div>}
            {!sugg.exhausted && <button type="button" className="wv-link wv-more" onClick={more}>More suggestions</button>}
          </section>
        )}
        <section className="wv-section">
          <SearchField value={q} onChange={setQ} placeholder={wantSide ? "Search sides" : "Search mains"} />
          <Group>
            {list.map(m => {
              const no = wontEat(m);
              return (
                <button key={m.id} type="button" className="ui-row wv-pick" onClick={() => onPick(m.name, false)}>
                  <span className="ui-row-main">
                    <span className={wantSide ? undefined : "ui-strong"}>{m.name}</span>
                    <span className={no.length ? "ui-meta ui-problem" : "ui-meta"}>{no.length ? `${no.join(" and ")} won't eat it` : recencyLabel(m)}</span>
                  </span>
                </button>
              );
            })}
            {q.trim() && !exact && (
              <button type="button" className="ui-row wv-pick" onClick={() => onPick(q.trim(), true)}><span className="ui-row-main wv-link-text">Add “{q.trim()}”</span></button>
            )}
          </Group>
        </section>
      </div>
    </Sheet>
  );
}

// ── Move sheet (11/14): pick dishes, then ⇄ Swap or → Add on another day ───────────────────
function MoveSheet({ title, dishes, mealRec, targets, onGo, onCancel }) {
  const [on, setOn] = useState(() => dishes.map(d => d.idx));
  const mains = dishes.filter(d => d.role === "main");
  // A side "goes with" a main when it's linked to it (pairsWith), or it's an accompaniment on a
  // night with only one main. Unchecking a main unchecks those; sides covering a person stay.
  const goesWith = (side, main) => (mealRec(side.name)?.pairsWith || []).includes(main.mealId) || (side.source === "accompaniment" && mains.length === 1);
  const toggle = d => setOn(cur => {
    if (cur.includes(d.idx)) {
      const drop = new Set([d.idx]);
      if (d.role === "main") dishes.filter(s => s.role === "side" && goesWith(s, d)).forEach(s => drop.add(s.idx));
      return cur.filter(i => !drop.has(i));
    }
    return [...cur, d.idx];
  });
  const n = dishes.length, k = on.length;
  const label = k === n ? `Moving all ${n}` : `Moving ${k} · Keeping ${n - k}`;
  const ordered = [...mains, ...dishes.filter(d => d.role === "side")];
  const idxs = dishes.map(d => d.idx).filter(i => on.includes(i));
  return (
    <Sheet tall title={title} onClose={onCancel} onCancel={onCancel} noDone>
      <div className="wv-sheet">
        <section className="wv-section">
          <div className="ui-section-label">{label}</div>
          <Group>
            {ordered.map(d => <CheckRow key={d.idx} on={on.includes(d.idx)} strong={d.role === "main"} onClick={() => toggle(d)}>{d.name.trim()}</CheckRow>)}
          </Group>
        </section>
        <section className="wv-section">
          <div className="ui-section-label">To</div>
          <Group>
            {targets.map(t => {
              const tm = t.dishes.filter(d => d.role === "main"), ts = t.dishes.filter(d => d.role === "side");
              return (
                <div key={t.day} className="wv-target">
                  <span className="wv-target-day">{t.label}</span>
                  <span className="wv-target-dishes">
                    {t.dishes.length ? <><span className="ui-strong">{tm.map(d => d.name.trim()).join(", ")}</span>{ts.length > 0 && <span className="ui-meta">+ {ts.map(d => d.name.trim()).join(", ")}</span>}</> : <span className="ui-meta">Open</span>}
                  </span>
                  <span className="wv-target-actions">
                    <button type="button" className="wv-mini" disabled={!k} onClick={() => onGo(idxs, t.day, true)}>⇄ Swap</button>
                    <button type="button" className="wv-mini" disabled={!k} onClick={() => onGo(idxs, t.day, false)}>→ Add</button>
                  </span>
                </div>
              );
            })}
          </Group>
        </section>
      </div>
    </Sheet>
  );
}

// ── Week check sheet (board "Rationale B"): concerns with their fixes, the app's nothing-to-buy
// lines, then Notes. Engine text verbatim. ──────────────────────────────────────────────────
function WeekCheckBody({ observations, fillNotes, nothingToBuy, dayShort, hasMain, onFix, onOpenMeal }) {
  const concerns = [...fillNotes, ...observations.filter(o => o.severity === "concern")];
  const notes = observations.filter(o => o.severity !== "concern");
  return (
    <div className="wv-sheet">
      {concerns.map((o, k) => (
        <div key={"c" + k} className="wv-fix">
          <span className="wv-dot" aria-hidden="true" />
          <span className="wv-fix-text">{o.text}</span>
          {o.day && o.property === "floor" && <RowAction onClick={() => onFix(o.day)}>{hasMain(o.day) ? "Add side" : "Suggest"}</RowAction>}
        </div>
      ))}
      {nothingToBuy.map((x, k) => (
        <div key={"n" + k} className="wv-fix">
          <span className="wv-dot" aria-hidden="true" />
          <span className="wv-fix-text">{x.name} on {dayShort(x.day)}: nothing to buy</span>
          {onOpenMeal && <RowAction onClick={() => onOpenMeal(x.id)}>Open</RowAction>}
        </div>
      ))}
      {notes.length > 0 && (
        <section className="wv-section">
          <div className="ui-section-label">Notes</div>
          <Group>{notes.map((o, k) => <div key={k} className="ui-row ui-row-plain"><span className="ui-row-main">{o.text}</span></div>)}</Group>
        </section>
      )}
      {!concerns.length && !nothingToBuy.length && !notes.length && <div className="ui-meta">No concerns</div>}
    </div>
  );
}

export { PlanMeals };

// Detailed · Compact as a two-icon toggle in the segmented style (board "Plan › Meals button
// weights", option D, 11/25): white thumb on the grey track.
function ViewToggle({ compact, onChange }) {
  const seg = (on, label, icon, v) => (
    <button type="button" className="wv-view-seg" aria-pressed={on} aria-label={label} onClick={() => onChange(v)}>{icon}</button>
  );
  return (
    <span className="wv-view" role="group" aria-label="View">
      {seg(!compact, "Detailed", <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><rect x="2" y="2" width="12" height="5" rx="1.5" /><rect x="2" y="9" width="12" height="5" rx="1.5" /></svg>, false)}
      {seg(compact, "Compact", <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M2 3.5h12M2 8h12M2 12.5h12" /></svg>, true)}
    </span>
  );
}
