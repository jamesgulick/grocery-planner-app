// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { MAX_EXTRA_DAYS, TIME_LEVELS, abbrOfISO, assembleComposeInputs, checkWeek, isExtraDay, mealRecency, platesFromCompose, presentOn, reasonsOf, runComposeWeek, seedTimeLevel } from "../engine/assembleInputs.js";
import { composeWeek, evaluateWeek } from "../engine/composeWeek.js";
import { useEffect, useMemo, useState } from "react";
import { copyToClipboard } from "../app/clipboard.js";
import { draftPlanText } from "../app/shareText.js";
import { DAYS_FULL, addDaysISO, todayLocalISO } from "../app/globals.js";
import { BUILTIN_PILLS, PILL_STYLE, engineGrillOk } from "../app/pills.js";
import { SEED_MEALS } from "../app/seed.js";
import { C, S } from "../app/styles.js";
import { defaultNotes, fetchLiveForecast } from "../app/weather.js";
import { AutoGrowTextarea, Toggle } from "../components/common.jsx";
import { mealMatches } from "../manage/MealEditor.jsx";

// Carried-leftover notes arrive one per person ("Partner is covered by Chili carried from
// 2026-09-26"). Display-only: group the people held by the same dish on the same night
// into one line. Anything not in that exact form is shown as the engine wrote it.
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
  return [...[...groups.values()].map(g => prettyDates(`${names(g.people)}: ${g.dish} leftovers (from ${g.from})`)), ...loose.map(prettyDates)];
}

// Engine text names dates as ISO ("carried from 2026-09-26"); show them as "Sat 9/26".
const prettyDates = text => String(text || "").replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,
  (iso, y, m, d) => `${abbrOfISO(iso)} ${Number(m)}/${Number(d)}`);

// WEEK CHECK panel (REFACTOR C2). The engine rates each observation; this maps severity
// to presentation, quiet by default: concerns always shown, "ok" as a short check line,
// info folded away behind a count. Learn mode ("Show reasoning") turns on the full
// per-dish rationale on the day cards.
function WeekCheckPanel({ check, total, showInfo, setShowInfo, learnMode, setLearnMode, onFix, fixLabel }) {
  const obs      = check?.observations || [];
  const concerns = obs.filter(o => o.severity === "concern");
  const oks      = obs.filter(o => o.severity === "ok");
  const infos    = obs.filter(o => o.severity === "info");
  const line = (bg, color) => ({ fontSize:12, lineHeight:1.45, padding:"6px 8px", marginTop:4, borderRadius:6, background:bg, color });
  return (
    <div style={S.card}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, flexWrap:"wrap" }}>
        <div style={{ ...S.sectionLabel, marginBottom:0 }}>Week check · {check?.planned || 0} of {total} days planned</div>
        <button style={{ ...S.btnSm, padding:"2px 10px", fontSize:11, background:learnMode?C.primaryLight:"#FFF", color:learnMode?C.primary:C.muted, border:`1px solid ${learnMode?C.primary:C.border}`, fontWeight:learnMode?700:500 }}
          onClick={() => setLearnMode(!learnMode)} title="Show why each meal and side is where it is">{learnMode ? "✓ Show reasoning" : "Show reasoning"}</button>
      </div>
      {concerns.map((o, k) => (
        <div key={"c"+k} style={{ ...line(C.warningLight, C.warning), display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
          <span>⚠ {prettyDates(o.text)}</span>
          {o.day && onFix && (
            <button style={{ ...S.btnSm, flex:"0 0 auto", fontSize:11, padding:"3px 8px", background:"#FFF", color:C.warning, border:`1px solid ${C.warning}` }} onClick={() => onFix(o.day)}>{fixLabel(o.day)}</button>
          )}
        </div>
      ))}
      {oks.map((o, k) => <div key={"o"+k} style={line("#F0FAF4", C.primary)}>✓ {prettyDates(o.text)}</div>)}
      {infos.length > 0 && (
        <button style={{ background:"none", border:"none", color:C.muted, fontSize:12, cursor:"pointer", padding:"6px 0 0", textAlign:"left" }} onClick={() => setShowInfo(!showInfo)}>
          {showInfo ? "▾" : "▸"} {infos.length} more {infos.length === 1 ? "note" : "notes"} about this week
        </button>
      )}
      {showInfo && infos.map((o, k) => <div key={"i"+k} style={line("#F9FAFB", C.muted)}>ℹ {prettyDates(o.text)}</div>)}
    </div>
  );
}

// A side's job on the plate, labelled distinctly (REFACTOR C1): a FLOOR-FILL side is
// there because someone present won't eat the main; an ACCOMPANIMENT goes with the
// main. A side placed by hand just says "side". The engine's own sentence for why it
// is there is shown under the name.
function sideBadge(dish) {
  if (!dish || dish.role !== "side") return null;
  if (dish.source === "floor-fill")    return <span style={S.tag(C.warning, C.warningLight)} title="Covers someone who won't eat the main">covers</span>;
  if (dish.source === "accompaniment") return <span style={S.tag(C.primary, C.primaryLight)} title="Goes with the main">goes with</span>;
  return <span style={S.tag(C.muted, "#F3F4F6")}>side</span>;
}

// Time per day, as shown (canvas 11/12: "Time", Little / Some / Lots). Display only: the
// stored value and the engine's timeLevel stay none / some / much.
const TIME_LABEL = { none:"Little", some:"Some", much:"Lots" };

function PlanMeals({ mealPlan, plates, setMealPlan, commitMealToPlan, timeLevels, setTimeLevels, presence, setPresence, weekStartDate, adventurousWeek, setAdventurousWeek, meals, onNext, days, daysFull, dayNotes, setDayNotes, dayPills, setDayPills, db, persistDB, extraDays = 0, canExtend = false, setExtraDays }) {
  const [editing, setEditing] = useState(null);
  const [moving,  setMoving]  = useState(null);
  const [search,  setSearch]  = useState("");
  const [loading, setLoading] = useState(false);
  const allMeals   = meals.length > 0 ? meals : SEED_MEALS;
  // Resolved by role flag, never by hardcoded name — see SPEC-family-roles.md.
  const partner     = (db.settings?.familyContacts || []).find(f => f.isPartner);
  const partnerName = partner?.name || "Partner";

  // Presence (REFACTOR B2): everyone on the roster, every day. A day's date is
  // its offset from weekStartDate (days[] is ordered from that weekday), which
  // is what away periods are matched against.
  const roster     = (db.settings?.familyContacts || []).map(f => f.name);
  const awayRanges = db.settings?.awayRanges || [];
  const dateOfDay  = Object.fromEntries(days.map((d, i) => [d, weekStartDate ? addDaysISO(weekStartDate, i) : null]));
  const isPresentOn = (name, day) => presentOn(presence, awayRanges, name, day, dateOfDay[day]);
  const togglePresence = (day, name) => {
    const here = isPresentOn(name, day);
    setPresence(prev => ({ ...prev, [day]: { ...((prev || {})[day] || {}), [name]: !here } }));
  };

  // Manual pick list (Week 5): recency is the axis memory works on, so every row says
  // when the meal was last on the table (or that it's already planned) and the list sorts
  // by it. Sides sit at the bottom (mains first, each group by recency) unless the pick is
  // replacing a side, the one case where a side is clearly what's wanted; adding a side is
  // usually More sides' job. Built from what was served or planned only (mealRecency).
  const recency = useMemo(() => mealRecency({ planTail: db.planTail || [], mealHistory: db.mealHistory || [], plans: db.plans || {}, today: todayLocalISO() }), [db.planTail, db.mealHistory, db.plans]);
  const [pickSort, setPickSort] = useState("oldest");   // oldest | newest
  const recKey = m => (m.name || "").trim().toLowerCase();
  // Sortable value: "" = never had (the oldest); a planned date sorts after any past one.
  const recencyValue = m => recency.planned[recKey(m)] ? "~" + recency.planned[recKey(m)] : (recency.last[recKey(m)] || "");
  const recencyLabel = m => {
    const p = recency.planned[recKey(m)];
    if (p) return `planned ${abbrOfISO(p)} ${Number(p.slice(5, 7))}/${Number(p.slice(8))}`;
    const l = recency.last[recKey(m)];
    if (!l) return "never had";
    const d = Math.round((Date.parse(todayLocalISO()) - Date.parse(l)) / 86400000);
    if (d <= 0) return "today";
    if (d === 1) return "yesterday";
    if (d < 7) return `${d} days ago`;
    const w = Math.round(d / 7);
    return w === 1 ? "1 week ago" : `${w} weeks ago`;
  };
  const isSideName = n => allMeals.find(x => x.name === n)?.type === "side";
  const pickList = (day, mealIdx) => {
    const cur = mealPlan[day] || [];
    const wantSide = mealIdx !== undefined && isSideName(cur[mealIdx]);
    const base = search.trim() ? allMeals.filter(m => mealMatches(m, search)) : allMeals;
    return [...base].sort((a, b) => {
      const ga = (a.type === "side") === wantSide ? 0 : 1, gb = (b.type === "side") === wantSide ? 0 : 1;
      if (ga !== gb) return ga - gb;
      const va = recencyValue(a), vb = recencyValue(b);
      if (va !== vb) return (va < vb ? -1 : 1) * (pickSort === "oldest" ? 1 : -1);
      return a.name.localeCompare(b.name);
    });
  };
  const totalMeals = Object.values(mealPlan).flat().length;

  // The engine's session state (REFACTOR S1). Only seenThisSession is carried: the
  // caller rebuilds alreadyPlaced from the plan on every call. Session-local BY DESIGN
  // — the model resets session-seen per planning sitting, so this is the one piece of
  // Meals-step state that deliberately is NOT lifted into the persisted plan.
  const [seenThisSession, setSeenThisSession] = useState([]);
  // Problems from the last FILL itself (bad inputs, an engine error). Everything else
  // the engine says about the week comes from the live week check below (REFACTOR C2).
  const [fillNotes, setFillNotes] = useState([]);
  const [showWeekInfo, setShowWeekInfo] = useState(false);
  const learnMode = !!db.settings?.learnMode;
  const setLearnMode = v => persistDB({ ...db, settings: { ...db.settings, learnMode: v } });
  // Live weather for THIS plan's dates (cached 6h), keyed by ISO date. Refetched when
  // the plan's dates change. Falls back to {} when blocked or offline, which every
  // consumer treats as neutral. See fetchLiveForecast.
  // NOTE: declared BEFORE regenerate and the day cards, which read them — const has
  // no hoisting, so using them earlier throws a temporal-dead-zone ReferenceError.
  // dateOfDay (above) must stay declared before this.
  const [forecastByDate, setForecastByDate] = useState({});
  const planDatesKey = days.map(d => dateOfDay[d] || "").join(",");
  useEffect(() => {
    let cancelled = false;
    setForecastByDate({});
    fetchLiveForecast(Object.values(dateOfDay)).then(f => { if (!cancelled) setForecastByDate(f); });
    return () => { cancelled = true; };
  }, [planDatesKey]);
  // Notes safety net (carried over from the old Partner step): if this step opens
  // with every day note blank, fill from the baked schedule once. Fires only when
  // ALL are empty, so it never clobbers edits. New plans seed notes in startFresh;
  // this covers in-progress drafts that predate that.
  useEffect(() => {
    const allEmpty = days.every(d => !((dayNotes||{})[d] || "").trim());
    if (allEmpty) setDayNotes(prev => { const next = { ...prev }; days.forEach(d => { next[d] = defaultNotes[d] || ""; }); return next; });
  }, []);
  const [pillEditDay, setPillEditDay] = useState(null);
  const [newPillLabel, setNewPillLabel] = useState("");
  const togglePill = (day, label) => setDayPills(prev => {
    const cur = prev?.[day] || [];
    const has = cur.some(p => p.label === label);
    return { ...prev, [day]: has ? cur.filter(p => p.label !== label) : [...cur, { label, source:"manual" }] };
  });
  const removePill = (day, label) => setDayPills(prev => ({ ...prev, [day]: (prev?.[day]||[]).filter(p => p.label !== label) }));
  const addCustomPill = day => {
    const l = newPillLabel.trim();
    if (!l) return;
    setDayPills(prev => ({ ...prev, [day]: [...(prev?.[day]||[]), { label:l, source:"manual" }] }));
    setNewPillLabel("");
  };

  const grillOpen = db.settings?.grillOpen !== false;

  // WEEK CHECK (REFACTOR C2): observations for the plan as it stands — hand-placed and
  // recommended together — recomputed whenever anything it reads changes. Declared
  // after forecastByDate/dateOfDay, which it reads (TDZ).
  const forecastKey = JSON.stringify(forecastByDate);
  const weekCheck = useMemo(() => {
    const planKey = db.activePlan || "current";
    const plan = { ...(db.plans?.[planKey] || {}), weekStartDate, mealPlan, plates, timeLevels, presence, adventurousWeek };
    if (!weekStartDate) return { planned: 0, observations: [], leftovers: {} };
    return checkWeek(evaluateWeek, { db, planKey, plan, forecastByDate, today: todayLocalISO(), days });
  }, [mealPlan, plates, timeLevels, presence, adventurousWeek, forecastKey, db.meals, db.settings, db.planTail, db.mealHistory, weekStartDate, days.join(",")]);

  // Fill every EMPTY day with a composed plate (REFACTOR S1 — composeWeek replaces the
  // old weighted-random getMealSuggestions). Days that already have anything on them are
  // never touched: they go to the engine as fixed context (alreadyPlaced), so spacing,
  // leftovers and the floor are worked out around them.
  const regenerate = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 30));   // let "Thinking..." paint
    const planKey = db.activePlan || "current";
    const plan = { ...(db.plans?.[planKey] || {}), weekStartDate, mealPlan, plates, timeLevels, presence };
    let out;
    try {
      const { args, notes } = assembleComposeInputs({ db, planKey, plan, forecastByDate, seenThisSession, today: todayLocalISO(), days });
      out = runComposeWeek(composeWeek, args, notes);
    } catch (e) {
      out = { week: {}, sessionState: { seenThisSession }, rationale: [],
        observations: [{ property: "input", severity: "concern", text: `Couldn't prepare the planner's inputs: ${e.message}` }] };
    }
    // Only empty days take the engine's plate; each placed dish carries its reason and
    // a leftovers snapshot (platesFromCompose → reconcilePlates, REFACTOR C1).
    const emptyDates = Object.fromEntries(days.filter(d => !(mealPlan[d] || []).length).map(d => [d, dateOfDay[d]]));
    const annotations = platesFromCompose(out, emptyDates, db.meals || []);
    setMealPlan(prev => {
      const next = { ...prev };
      Object.entries(annotations).forEach(([d, a]) => { if (!(prev[d] || []).length) next[d] = a.dishes.map(x => x.name); });
      return next;
    }, annotations);
    setSeenThisSession(out.sessionState?.seenThisSession || seenThisSession);
    setFillNotes(out.observations.filter(o => o.severity === "concern" && (o.property === "engine" || o.property === "input" || o.property === "pool")));
    setLoading(false);
  };

  // ── Plate-granular reroll (REFACTOR C3) ──────────────────────────────────────
  // The global fill above touches only empty days; anything already on a day is edited
  // here, one part at a time, so a fill can never clobber a plate James has tuned.
  //
  // Each action composes ONE target day: the day is scheduled with whatever it keeps,
  // every other PLANNED day is fixed context (spacing, leftovers, the floor), and empty
  // days are left out so the engine doesn't fill them first and use up candidates.
  // composeWeek only suggests sides for a day that has none, so actions that want the
  // engine's sides pass the day with its main alone.
  const mealRec   = name => (db.meals || []).find(m => m.name.trim() === String(name).trim());
  const dishesOf  = day => (mealPlan[day] || []).map((n, i) => {
    const p = plates?.[day]?.dishes?.[i];
    const d = p && p.name === n ? p : null;
    return { name: n, mealId: d?.mealId || mealRec(n)?.id, role: d?.role || (mealRec(n)?.type === "side" ? "side" : "main"), source: d?.source || "manual" };
  });
  const composeOneDay = (day, keep, extraSeen = []) => {
    const planKey = db.activePlan || "current";
    const mp = { ...mealPlan, [day]: keep };
    const onlyDays = days.filter(d => d === day || (mp[d] || []).length);
    const plan = { ...(db.plans?.[planKey] || {}), weekStartDate, mealPlan: mp, plates, timeLevels, presence, adventurousWeek };
    const seen = [...new Set([...seenThisSession, ...extraSeen.filter(Boolean)])];
    let out;
    try {
      const { args, notes } = assembleComposeInputs({ db, planKey, plan, forecastByDate, seenThisSession: seen, today: todayLocalISO(), days, onlyDays });
      out = runComposeWeek(composeWeek, args, notes);
    } catch (e) {
      out = { week: {}, sessionState: { seenThisSession: seen }, rationale: [], observations: [{ property: "input", severity: "concern", text: `Couldn't prepare the planner's inputs: ${e.message}` }] };
    }
    setSeenThisSession(out.sessionState?.seenThisSession || seen);
    const errs = out.observations.filter(o => o.severity === "concern" && (o.property === "engine" || o.property === "input" || o.property === "pool"));
    const ann = platesFromCompose(out, { [day]: dateOfDay[day] }, db.meals || [])[day] || { dishes: [], leftovers: [] };
    return { ann, errs };
  };
  // A per-day action that finds nothing to add says so ON that day's card, where the tap
  // was, not in the notes box at the top of the step (usually off-screen). It lasts until
  // the plan changes, so the button it replaces comes back once there's something new.
  const [dayMsg, setDayMsg] = useState(null);   // { day, text }
  useEffect(() => { setDayMsg(null); }, [mealPlan]);
  const dayNote = (day, text) => { setFillNotes([]); setDayMsg({ day, text }); };
  // Apply new names for a day, carrying annotations only for the dishes the engine just
  // placed; kept dishes keep their existing plate entries (reconcilePlates).
  const applyDay = (day, names, newDishes, leftovers) => {
    setFillNotes([]); setDayMsg(null);
    setMealPlan(prev => ({ ...prev, [day]: names }),
      { [day]: { dishes: newDishes, leftovers: leftovers || [] } });
  };

  // Empty day → compose a fresh plate for it alone.
  const fillDay = day => {
    const { ann, errs } = composeOneDay(day, []);
    if (!ann.dishes.length) { setFillNotes(errs.length ? errs : []); if (!errs.length) dayNote(day, "Nothing eligible could be placed on this day."); return; }
    applyDay(day, ann.dishes.map(d => d.name), ann.dishes, ann.leftovers);
  };

  // ⟳ main → a SHORTLIST (Week 5): the next few mains in the engine's own ranking for the
  // day, best first, each with the sides it brings. Built the way reroll always worked,
  // by asking again with each pick marked seen, so showing the options marks them seen
  // and "More" moves on down the same ranking. Seen-scope is the session's, unchanged.
  // When the engine starts handing back meals already seen, the pool is exhausted and the
  // list says so. Sides placed by hand stay with whichever main is taken.
  const SHORTLIST_SIZE = 3;
  const [shortlist, setShortlist] = useState(null);   // { day, options, exhausted, errs }
  // Options are for the plate they were built against: any change to the plan closes them.
  useEffect(() => { setShortlist(null); }, [mealPlan]);
  const nextOptions = (day, shown) => {
    const cur = dishesOf(day);
    const main = cur.find(d => d.role === "main");
    const keptSides = cur.filter(d => d.role === "side" && d.source === "manual");
    const extra = [main?.mealId, ...shown].filter(Boolean);
    const already = new Set([...seenThisSession, ...extra]);
    const options = [];
    let exhausted = false, errs = [];
    for (let i = 0; i < SHORTLIST_SIZE; i++) {
      const r = composeOneDay(day, keptSides.map(d => d.name), extra);
      const m = r.ann.dishes.find(d => d.role === "main");
      if (!m || !m.mealId || already.has(m.mealId)) { exhausted = true; if (!options.length) errs = r.errs; break; }
      already.add(m.mealId); extra.push(m.mealId);
      options.push({ main: m, sides: r.ann.dishes.filter(d => d.role === "side" && !keptSides.some(k => k.name === d.name)), leftovers: r.ann.leftovers, kept: keptSides.map(d => d.name) });
    }
    return { options, exhausted, errs };
  };
  const openShortlist = day => {
    const { options, exhausted, errs } = nextOptions(day, []);
    setFillNotes(errs);
    setShortlist({ day, options, exhausted });
  };
  const moreOptions = () => {
    if (!shortlist) return;
    const { options, exhausted } = nextOptions(shortlist.day, shortlist.options.map(o => o.main.mealId));
    setShortlist({ ...shortlist, options: [...shortlist.options, ...options], exhausted });
  };
  const takeOption = o => {
    applyDay(shortlist.day, [o.main.name, ...o.kept, ...o.sides.map(d => d.name)], [o.main, ...o.sides], o.leftovers);
    setShortlist(null);
  };

  // ⟳ side → swap just that side for another the engine would put with this main.
  const rerollSide = (day, idx) => {
    const cur = dishesOf(day);
    const main = cur.find(d => d.role === "main");
    const side = cur[idx];
    if (!main || !side) return;
    const { ann } = composeOneDay(day, [main.name], [side.mealId]);
    const onPlate = new Set(cur.map(d => d.name.trim()));
    const pick = ann.dishes.find(d => d.role === "side" && !onPlate.has(d.name.trim()));
    if (!pick) { dayNote(day, `No other side fits with ${main.name.trim()}.`); return; }
    const names = cur.map(d => d.name); names[idx] = pick.name;
    applyDay(day, names, [pick], null);
  };

  // Suggest sides: the engine's sides for this day's main, adding only ones not already
  // on the plate. The fix a floor concern offers (RULING 12), so it also works on a day
  // that already has sides (e.g. only a non-substantial one). A day with sides but no
  // main gets a main instead, keeping its sides. REPEATABLE (the model's "ask for more"):
  // the sides already on the plate go in as seen, so each tap brings the next best ones
  // rather than the same ones again.
  const suggestSides = day => {
    const cur = dishesOf(day);
    const main = cur.find(d => d.role === "main");
    if (!main) { suggestMain(day); return; }
    const { ann } = composeOneDay(day, [main.name], cur.filter(d => d.role === "side").map(d => d.mealId));
    const onPlate = new Set(cur.map(d => d.name.trim()));
    const sides = ann.dishes.filter(d => d.role === "side" && !onPlate.has(d.name.trim()));
    if (!sides.length) {
      dayNote(day, cur.length > 1
        ? `No more sides go with ${main.name.trim()}. Use + Add meal to pick one yourself.`
        : `${main.name.trim()} needs no sides: it covers everyone present and nothing is linked to go with it.`);
      return;
    }
    applyDay(day, [...cur.map(d => d.name), ...sides.map(d => d.name)], sides, ann.leftovers);
  };
  const suggestMain = day => {
    const cur = dishesOf(day);
    const { ann, errs } = composeOneDay(day, cur.map(d => d.name));
    const newMain = ann.dishes.find(d => d.role === "main");
    if (!newMain) { if (errs.length) setFillNotes(errs); else dayNote(day, "No main fits this day."); return; }
    applyDay(day, [newMain.name, ...cur.map(d => d.name)], [newMain], ann.leftovers);
  };

  const [draftSms, setDraftSms] = useState(null);
  const [draftCopied, setDraftCopied] = useState(false);
  const textDraftPlan = () => {
    const msg = draftPlanText(days, daysFull, mealPlan);
    // sms: is blocked in this webview — copy the message for pasting instead.
    const copied = copyToClipboard(msg);
    setDraftCopied(true);
    setTimeout(() => setDraftCopied(false), 2500);
    setDraftSms(msg);
  };

  // Add a meal to a day. For an existing meal, pass isNew=false; for a freshly
  // typed name, isNew=true so a stub record gets created in the same write.
  const addMeal = (day, name, isNew=false) => {
    const next = { ...mealPlan, [day]:[...(mealPlan[day]||[]), name] };
    commitMealToPlan(next, isNew ? name : null);
    setEditing(null); setSearch("");
  };
  const replaceMeal = (day, mealIdx, name, isNew=false) => {
    const u = [...(mealPlan[day]||[])]; u[mealIdx] = name;
    commitMealToPlan({ ...mealPlan, [day]:u }, isNew ? name : null);
    setEditing(null); setSearch("");
  };
  const removeMeal = (day, idx) => setMealPlan(prev => ({ ...prev, [day]:(prev[day]||[]).filter((_,i)=>i!==idx) }));
  const moveMeal = (fromDay, mIdx, toDay) => {
    setMealPlan(prev => {
      const meal = (prev[fromDay]||[])[mIdx];
      return { ...prev, [fromDay]:(prev[fromDay]||[]).filter((_,i)=>i!==mIdx), [toDay]:[...(prev[toDay]||[]),meal] };
    });
    setMoving(null);
  };

  const MealSearch = ({ day, mealIdx }) => (
    <div style={{ marginTop:8 }}>
      <input style={{ ...S.input, marginBottom:8 }} placeholder="Search meals or tags (e.g. pasta, meaty)..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
      <div style={{ display:"flex", gap:6, alignItems:"center", fontSize:11, color:C.faint, marginBottom:6 }}>
        Sort:
        {[["oldest","longest since"],["newest","most recent"]].map(([k, l]) => (
          <button key={k} style={{ ...S.pill(pickSort === k), fontSize:11, padding:"2px 8px" }} onClick={() => setPickSort(k)}>{l}</button>
        ))}
      </div>
      <div style={{ maxHeight:220, overflowY:"auto" }}>
        {pickList(day, mealIdx).map(m => (
          <div key={m.id} style={{ padding:"10px 4px", borderBottom:`1px solid ${C.border}`, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between" }}
            onClick={() => {
              if (mealIdx !== undefined) replaceMeal(day, mealIdx, m.name, false);
              else addMeal(day, m.name, false);
            }}>
            <span>{m.name} <span style={{ fontSize:11, color:C.faint, marginLeft:4 }}>{recencyLabel(m)}</span></span>
            <span style={{ display:"flex", gap:4, alignItems:"center" }}>
              {m.type === "side"    && <span style={S.tag(C.accent,  C.primaryLight)}>side</span>}
              {m.type === "remix"   && <span style={S.tag("#7C3AED", "#EDE9FE")}>remix</span>}
              {m.type === "batch"   && <span style={S.tag(C.muted,   "#F3F4F6")}>batch</span>}
              {m.type === "takeout" && <span style={S.tag(C.muted,   "#F3F4F6")}>takeout</span>}
              {partner && (m.preferences||[]).some(p => p.person===partner.name && p.pref==="dislikes") && <span style={S.tag(C.danger, C.dangerLight)}>{partnerName} dislikes</span>}
            </span>
          </div>
        ))}
        {search && (
          <div style={{ padding:"10px 4px", fontSize:14, cursor:"pointer", color:C.primary, fontWeight:600 }}
            onClick={() => { if (mealIdx!==undefined) replaceMeal(day, mealIdx, search, true); else addMeal(day, search, true); }}>
            + Use "{search}" <span style={{ fontWeight:500, color:C.faint }}>— adds to Meals list</span>
          </div>
        )}
      </div>
      <button style={{ ...S.btn, ...S.btnD, marginTop:4, marginBottom:0 }} onClick={() => { setEditing(null); setSearch(""); }}>Cancel</button>
    </div>
  );

  return (
    <div>
      <div style={S.card}>
        <div style={S.sectionLabel}>Step 2 - Meal Plan</div>
        <div style={S.h2}>This week's dinners</div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"8px 0", marginBottom:8, borderTop:`1px solid ${C.border}` }}>
          <div style={{ fontWeight:600, fontSize:14 }}>Try something new</div>
          <Toggle value={!!adventurousWeek} onChange={v => setAdventurousWeek(v)} />
        </div>
        <button style={{ ...S.btn, ...(totalMeals === 0 ? S.btnP : S.btnS), marginBottom:0 }} onClick={regenerate} disabled={loading}>{loading?"Thinking...":"Fill empty days"}</button>
        {fillNotes.map((n, k) => (
          <div key={k} style={{ fontSize:12, lineHeight:1.45, padding:"6px 8px", marginTop:8, borderRadius:6, color:C.warning, background:C.warningLight }}>⚠ {prettyDates(n.text)}</div>
        ))}
      </div>
      <WeekCheckPanel check={weekCheck} total={days.length} onFix={suggestSides} fixLabel={d => (dishesOf(d).some(x => x.role === "main") ? "Suggest a side" : "Suggest a main")} showInfo={showWeekInfo} setShowInfo={setShowWeekInfo} learnMode={learnMode} setLearnMode={setLearnMode} />
      {days.map((day, i) => {
        const dayMeals      = mealPlan[day] || [];
        // Stored "grill" pills are from before grill became engine-derived; not shown.
        const pills         = (dayPills?.[day] || []).filter(p => p.label !== "grill");
        const dayFc         = forecastByDate[dateOfDay[day]];
        const grillOk       = engineGrillOk(grillOpen, dayFc);
        const timeLevel     = (timeLevels || {})[day] || seedTimeLevel(dateOfDay[day] ? abbrOfISO(dateOfDay[day]) : day);
        const isEditingNew  = editing?.day === day && editing?.mealIdx == null;
        const editingPills  = pillEditDay === day;
        // The day as a PLATE (REFACTOR C1): the plate entry for each listed meal, when
        // the day has one (days untouched since before plates existed don't).
        const plate         = plates?.[day];
        const dishAt        = idx => (plate?.dishes?.[idx]?.name === dayMeals[idx] ? plate.dishes[idx] : null);
        const isSide        = idx => (dishAt(idx)?.role || (allMeals.find(m => m.name === dayMeals[idx])?.type === "side" ? "side" : "main")) === "side";
        // A main tagged noSidesUnlessNeeded is complete on its own (sides built in, or
        // takeout): the engine adds a side only to cover someone who won't eat it, so the
        // day shows "no sides needed" and offers "Suggest sides" only for a floor concern.
        const noSidesMain   = idx => !isSide(idx) && allMeals.find(m => m.name === dayMeals[idx])?.noSidesUnlessNeeded === true;
        const floorConcern  = (weekCheck.floorConcernDays || []).includes(day);
        const offerSides    = floorConcern || !dayMeals.some((_, k) => noSidesMain(k));
        const sidesLabel    = !dayMeals.some((_, k) => !isSide(k)) ? "Suggest a main" : dayMeals.some((_, k) => isSide(k)) ? "More sides" : "Suggest sides";
        // Why each dish is here (REFACTOR C2), from the reasons saved when it was placed.
        // A side's headline reason is its floor-fill/affinity sentence. Other reasons the
        // engine marked "always" show by default; learn mode shows every reason.
        const reasons       = idx => reasonsOf(dishAt(idx));
        const headline      = idx => isSide(idx) ? (reasons(idx).find(r => r.factor === "floor-fill" || r.factor === "affinity") || reasons(idx)[0]) : null;
        const extraReasons  = idx => reasons(idx).filter(r => r !== headline(idx) && (learnMode || r.visibility === "always"));
        const dayLeftovers  = weekCheck.leftovers?.[day] || [];
        return (
          <div key={day} style={S.mealCard(timeLevel === "none" ? "easy" : "medium")}>
            <div style={{ fontSize:11, fontWeight:700, color:C.accentMuted, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:4 }}>
              {daysFull[i]}{isExtraDay(day) && dateOfDay[day] && ` · ${Number(dateOfDay[day].slice(5, 7))}/${Number(dateOfDay[day].slice(8))}`}
              {isExtraDay(day) && canExtend && day === `X${extraDays}` && (
                <button title="Remove this extra day" style={{ marginLeft:8, background:"none", border:"none", color:C.faint, fontSize:12, cursor:"pointer", padding:0, textTransform:"none", letterSpacing:0 }}
                  onClick={() => { if (!dayMeals.length || window.confirm(`Remove ${daysFull[i]}? Its meals and notes go with it.`)) setExtraDays(extraDays - 1); }}>× remove</button>
              )}
              {dayFc && <span style={{ marginLeft:8, fontWeight:600, color:C.muted, textTransform:"none", letterSpacing:0 }}>{dayFc.icon} {dayFc.hi}° · {dayFc.pop}% rain</span>}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap", marginBottom:6 }}>
              <span style={{ fontSize:11, color:C.faint, fontWeight:600, marginRight:2 }}>Time</span>
              {TIME_LEVELS.map(l => {
                const on = timeLevel === l;
                return <button key={l} style={{ ...S.btnSm, padding:"2px 10px", fontSize:11, background:on?C.primaryLight:"#FFF", color:on?C.primary:C.muted, border:`1px solid ${on?C.primary:C.border}`, fontWeight:on?700:500 }}
                  onClick={() => setTimeLevels(prev => ({ ...prev, [day]: l }))}>{TIME_LABEL[l]}</button>;
              })}
            </div>
            {roster.length > 0 && (
              <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap", marginBottom:6 }}>
                <span style={{ fontSize:11, color:C.faint, fontWeight:600, marginRight:2 }}>Home</span>
                {roster.map(name => {
                  const here = isPresentOn(name, day);
                  return <span key={name} title={here ? "Tap to mark away tonight" : "Away — tap to mark home tonight"} onClick={() => togglePresence(day, name)}
                    style={{ cursor:"pointer", ...S.tag(here ? C.muted : C.warning, here ? "#F1F1F1" : C.warningLight), textDecoration: here ? "none" : "line-through" }}>{name}</span>;
                })}
              </div>
            )}
            <div style={{ display:"flex", flexWrap:"wrap", gap:4, alignItems:"center", marginBottom:6 }}>
              {grillOk && <span title="Grill weather and grill season open — grillable meals can be suggested" style={S.tag(PILL_STYLE.grill.c, PILL_STYLE.grill.bg)}>🔥 grill ok</span>}
              {pills.map(p => {
                const st = PILL_STYLE[p.label] || { c:C.muted, bg:"#F3F4F6" };
                return (
                  <span key={p.label} style={{ ...S.tag(st.c, st.bg), display:"inline-flex", alignItems:"center", gap:4 }}>
                    {p.label}
                    {editingPills && <span style={{ cursor:"pointer", fontWeight:700 }} onClick={() => removePill(day, p.label)}>×</span>}
                  </span>
                );
              })}
              <button style={{ background:"none", border:"none", color:C.faint, fontSize:11, cursor:"pointer", textDecoration:"underline", padding:0 }}
                onClick={() => { setPillEditDay(editingPills ? null : day); setNewPillLabel(""); }}>
                {editingPills ? "done" : "+ pills"}
              </button>
            </div>
            {editingPills && (
              <div style={{ background:"#F9FAFB", border:`1px solid ${C.border}`, borderRadius:8, padding:8, marginBottom:8 }}>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
                  {BUILTIN_PILLS.map(l => {
                    const on = pills.some(p => p.label === l);
                    const st = PILL_STYLE[l];
                    return <button key={l} style={{ ...S.btnSm, background:on?st.bg:"#FFF", color:on?st.c:C.muted, border:`1px solid ${on?st.c:C.border}`, fontWeight:on?700:500 }} onClick={() => togglePill(day, l)}>{l}</button>;
                  })}
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <input style={{ ...S.input, flex:1, marginBottom:0, fontSize:12 }} placeholder="Custom label (e.g. Kid's bday)" value={newPillLabel}
                    onChange={e => setNewPillLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addCustomPill(day); }} />
                  <button style={{ ...S.btnSm, background:C.primary, color:"#fff" }} onClick={() => addCustomPill(day)}>Add</button>
                </div>
                <div style={{ fontSize:10, color:C.faint, marginTop:6 }}>Labels are visual only. "grill ok" is worked out from the forecast and grill season.</div>
              </div>
            )}
            {/* Wraps and grows so a long note reads in full; newlines are dropped to keep notes one line, as before. */}
            <AutoGrowTextarea
              style={{ display:"block", boxSizing:"border-box", fontSize:12, fontFamily:"inherit", lineHeight:1.4, resize:"none", overflow:"hidden", border:"none", borderBottom:`1px dashed ${C.border}`, outline:"none", background:"transparent", color:(dayNotes||{})[day]?C.warning:C.faint, width:"100%", padding:"2px 0", marginBottom:6, fontStyle:(dayNotes||{})[day]?"normal":"italic" }}
              placeholder="📝 Note for this day (e.g. business trip — takeout)"
              value={(dayNotes||{})[day]||""}
              onChange={v => setDayNotes(prev => ({ ...prev, [day]:v.replace(/[\r\n]+/g, " ") }))}
            />
            {dayMeals.map((meal, mealIdx) => {
              const isMoving   = moving?.day===day && moving?.mealIdx===mealIdx;
              const isChanging = editing?.day===day && editing?.mealIdx===mealIdx;
              return (
                <div key={mealIdx} style={{ marginTop:6 }}>
                  {isMoving ? (
                    <div>
                      <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Move to:</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {days.filter(d=>d!==day).map(d => <button key={d} style={{ ...S.btnSm, background:C.primaryLight, color:C.primary }} onClick={() => moveMeal(day,mealIdx,d)}>{isExtraDay(d) ? "+" + daysFull[days.indexOf(d)].replace("Extra ", "").slice(0, 3) : d}</button>)}
                        <button style={{ ...S.btnSm, background:C.dangerLight, color:C.danger }} onClick={() => setMoving(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : isChanging ? (
                    <MealSearch day={day} mealIdx={mealIdx} />
                  ) : (
                    <div style={{ display:"flex", alignItems:"center", gap:8, ...(isSide(mealIdx) ? { paddingLeft:14 } : {}) }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight: isSide(mealIdx) ? 400 : 600, fontSize: isSide(mealIdx) ? 14 : 15, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                          {meal}
                          {sideBadge(dishAt(mealIdx))}
                          {noSidesMain(mealIdx) && <span style={S.tag(C.muted, "#F3F4F6")} title="Complete on its own. A side is added only to cover someone who won't eat it.">no sides needed</span>}
                        </div>
                        {headline(mealIdx) && <div style={{ fontSize:11, color:C.faint, lineHeight:1.35 }}>{prettyDates(headline(mealIdx).text)}</div>}
                        {extraReasons(mealIdx).map((r, k) => (
                          <div key={k} style={{ fontSize:11, lineHeight:1.35, color: r.visibility === "always" ? C.muted : C.faint }}>
                            {learnMode && r.tier ? <span style={{ fontWeight:600 }}>{r.tier} · {r.role}: </span> : "• "}{prettyDates(r.text)}
                          </div>
                        ))}
                      </div>
                      <button title={isSide(mealIdx) ? "Swap this side for another" : "See other mains for this day (their sides follow)"} style={{ ...S.btnSm, background:"none", border:`1px solid ${C.border}`, color:C.muted, fontSize:12, padding:"4px 8px" }} onClick={() => (isSide(mealIdx) ? rerollSide(day, mealIdx) : (shortlist?.day === day ? setShortlist(null) : openShortlist(day)))}>⟳</button>
                      <button style={{ ...S.btnSm, background:"none", border:`1px solid ${C.border}`, color:C.muted, fontSize:11 }} onClick={() => setMoving({day,mealIdx})}>Move</button>
                      <button style={{ ...S.btnSm, background:"none", border:`1px solid ${C.border}`, color:C.muted, fontSize:11 }} onClick={() => setEditing({day,mealIdx})}>Change</button>
                      <button style={{ background:"none", border:"none", color:C.faint, fontSize:18, cursor:"pointer", padding:"0 4px" }} onClick={() => removeMeal(day,mealIdx)}>×</button>
                    </div>
                  )}
                </div>
              );
            })}
            {shortlist?.day === day && (
              <div style={{ marginTop:8, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", background:"#FAFAFA" }}>
                <div style={{ display:"flex", alignItems:"center", marginBottom:4 }}>
                  <div style={{ flex:1, fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:0.4 }}>Other mains for this day</div>
                  <button style={{ background:"none", border:"none", color:C.faint, fontSize:16, cursor:"pointer", padding:"0 4px" }} title="Keep the current main" onClick={() => setShortlist(null)}>×</button>
                </div>
                {shortlist.options.map((o, k) => {
                  const why = reasonsOf(o.main).find(r => r.visibility === "always") || reasonsOf(o.main)[0];
                  return (
                    <div key={o.main.mealId} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderTop: k ? `1px solid ${C.border}` : "none", cursor:"pointer" }} onClick={() => takeOption(o)}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:14, fontWeight:600 }}>{o.main.name}{k === 0 && <span style={{ ...S.tag(C.primary, C.primaryLight), marginLeft:6 }}>best fit</span>}</div>
                        {o.sides.length > 0 && <div style={{ fontSize:12, color:C.muted }}>with {o.sides.map(d => d.name.trim()).join(", ")}</div>}
                        {why && <div style={{ fontSize:11, color:C.faint, lineHeight:1.35 }}>{prettyDates(why.text)}</div>}
                      </div>
                      <span style={{ fontSize:12, fontWeight:600, color:C.primary }}>Use</span>
                    </div>
                  );
                })}
                {shortlist.exhausted ? (
                  <div style={{ fontSize:11, color:C.muted, fontStyle:"italic", paddingTop:6 }}>
                    {shortlist.options.length ? "That's every main that fits this day this session." : "No other main fits this day this session."} To pick any meal yourself, use Change.
                  </div>
                ) : (
                  <button style={{ background:"none", border:"none", color:C.primary, fontSize:12, fontWeight:600, cursor:"pointer", padding:"6px 0 0" }} onClick={moreOptions}>+ More options</button>
                )}
              </div>
            )}
            {dayLeftovers.length > 0 && (
              <div style={{ marginTop:6 }}>
                {groupLeftoverNotes(dayLeftovers).map((t, k) => (
                  <div key={"l"+k} style={{ fontSize:11, color:C.muted, lineHeight:1.4 }}>🥡 {t}</div>
                ))}
              </div>
            )}
            {dayMsg?.day === day && (
              <div style={{ fontSize:12, lineHeight:1.4, color:C.muted, fontStyle:"italic", padding:"6px 0 0" }}>{dayMsg.text}</div>
            )}
            {!isEditingNew && dayMeals.length > 0 && offerSides && dayMsg?.day !== day && (
              <button style={{ background:"none", border:"none", color:floorConcern ? C.warning : C.primary, fontSize:12, fontWeight:600, cursor:"pointer", padding:"6px 0 0" }} onClick={() => suggestSides(day)}>
                {floorConcern ? "⚠ " : "+ "}{sidesLabel}
              </button>
            )}
            {isEditingNew ? <MealSearch day={day} /> : (
              <div style={{ display:"flex", gap:8, marginTop:8 }}>
                {dayMeals.length === 0 && (
                  <button style={{ background:C.primaryLight, border:`1.5px solid ${C.primaryLight}`, borderRadius:8, padding:"6px 12px", fontSize:13, cursor:"pointer", color:C.primary, fontWeight:600, flex:"0 0 auto" }} onClick={() => fillDay(day)}>⟳ Fill this day</button>
                )}
                <button style={{ background:"none", border:`1.5px dashed ${C.border}`, borderRadius:8, padding:"6px 12px", fontSize:13, cursor:"pointer", color:C.faint, flex:1 }} onClick={() => setEditing({day, mealIdx:null})}>
                  + Add meal
                </button>
              </div>
            )}
          </div>
        );
      })}
      {/* Shopping a day or two later than usual: add days after the week's last day. Only
          the latest week can (see setExtraDays in PlanTab), so a boundary never moves. */}
      {canExtend && extraDays < MAX_EXTRA_DAYS && weekStartDate && (() => {
        const iso = addDaysISO(weekStartDate, 7 + extraDays);
        return (
          <button style={{ background:"none", border:`1.5px dashed ${C.border}`, borderRadius:8, padding:"8px 12px", fontSize:13, cursor:"pointer", color:C.muted, width:"100%", marginBottom:10 }} onClick={() => setExtraDays(extraDays + 1)}>
            + Add an extra day ({DAYS_FULL[new Date(iso + "T00:00:00").getDay()]} {Number(iso.slice(5, 7))}/{Number(iso.slice(8))}) — shopping later than usual
          </button>
        );
      })()}
      {totalMeals > 0 && (
        <div style={{ marginBottom:10 }}>
          <button style={{ ...S.btn, ...S.btnS, marginBottom:draftSms?8:0 }} onClick={textDraftPlan}>{draftCopied ? "✓ Copied — paste into Messages" : "📋 Copy draft plan for family"}</button>
          {draftSms && (
            <div style={{ fontSize:12, color:C.muted }}>
              <div style={{ marginBottom:6, color:C.verified, fontWeight:600 }}>✓ Copied — paste into Messages:</div>
              <textarea readOnly value={draftSms} onFocus={e => e.target.select()} style={{ ...S.input, height:120, fontSize:12, resize:"none", marginBottom:0, fontFamily:"inherit" }} />
            </div>
          )}
        </div>
      )}
      <button style={{ ...S.btn, ...S.btnP }} onClick={onNext} disabled={totalMeals===0}>Looks good</button>
    </div>
  );
}

export { PlanMeals };
