// Home (polish Phase 2, canvas "Home A · Tonight-first", decisions 11/12–11/13): today's date
// as the screen title, Tonight, then "Coming up": a rolling 7 days from tomorrow that runs past
// the end of the week. Each week in it starts with a pale-green week row (Not planned · Plan /
// Up next: <step> · Continue + step bar / Ordered · pickup <day>), followed by its planned days
// (away info by name, plate concerns in amber, verbatim). Then Fridge report / Share with
// family. No time icons, no app name, no instructional copy.
import { useMemo, useState } from "react";
import { addDaysISO, checkWeek, dayKeyForDate, extraDaysOf, presentOn, weekDates } from "../engine/assembleInputs.js";
import { evaluateWeek } from "../engine/composeWeek.js";
import { copyToClipboard } from "../app/clipboard.js";
import { buildFridgeReportHTML } from "../app/fridgeReport.js";
import { planDays, todayLocalISO, weekLabel } from "../app/globals.js";
import { draftPlanText } from "../app/shareText.js";
import { Group, Icon, IconButton, PillButton, Section } from "../ui/kit.jsx";
import "./home.css";

const ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const abbrOf = iso => ABBR[new Date(iso + "T00:00:00").getDay()];
// The five planning steps as Home's step bar names them. Index = the plan's step index
// (PLAN_STEPS), where step 0 (today's Welcome) is where the Week setup step will live.
const STEP_BAR = ["Week", "Meals", "Inventory", "Confirm", "Order"];
const LIST_DAYS = 7;

const hasMeals = plan => Object.values(plan?.mealPlan || {}).some(m => (m || []).length);

// Main first (the plate's main if it has one), then the sides.
function dishesFor(plan, key) {
  const names = plan?.mealPlan?.[key] || [];
  const plates = plan?.plates?.[key]?.dishes || [];
  const mainIdx = Math.max(0, plates.findIndex(d => d?.role === "main"));
  return names.length ? { main: names[mainIdx] || names[0], sides: names.filter((_, i) => i !== mainIdx) } : null;
}

// Away by full name. Someone out 2+ days in a row is named once, on the first day
// ("Kid 3 out Sun–Mon"); the days inside the stretch show only other people.
function awayLines(rows, plan, db) {
  const roster = (db.settings?.familyContacts || []).map(f => f.name);
  const ranges = db.settings?.awayRanges || [];
  const out = Object.fromEntries(rows.map(r => [r.iso, []]));
  for (const name of roster) {
    let run = [];
    const flush = () => {
      if (!run.length) return;
      out[run[0].iso].push(run.length > 1 ? `${name} out ${abbrOf(run[0].iso)}–${abbrOf(run[run.length - 1].iso)}` : `${name} out`);
      run = [];
    };
    for (const r of rows) {
      if (!presentOn(plan.presence, ranges, name, r.key, r.iso)) run.push(r); else flush();
    }
    flush();
  }
  return out;
}

// The weeks that own each date. A plan's week runs from its weekStartDate through its
// extra days; where two overlap, the later-starting week wins. A date no plan covers
// belongs to an unplanned week: it starts where the previous week ended, or on the
// "Plans start on" weekday, and stops where the next plan starts.
function weekFinder(plans, shoppingDay) {
  const weeks = ["current", "next"].filter(k => plans[k]?.weekStartDate).map(k => ({
    key: k, plan: plans[k], start: plans[k].weekStartDate, end: addDaysISO(plans[k].weekStartDate, 7 + extraDaysOf(plans[k])),
  }));
  const startIdx = Math.max(0, FULL.indexOf(shoppingDay || "Wednesday"));
  return iso => {
    const owner = weeks.filter(w => w.start <= iso && iso < w.end).sort((a, b) => b.start.localeCompare(a.start))[0];
    if (owner) return owner;
    const back = (new Date(iso + "T00:00:00").getDay() - startIdx + 7) % 7;
    const prevEnd = weeks.map(w => w.end).filter(e => e <= iso).sort().pop();
    let start = addDaysISO(iso, -back);
    if (prevEnd && prevEnd > start) start = prevEnd;
    const laterStart = weeks.map(w => w.start).filter(st => st > iso).sort()[0];
    let end = addDaysISO(start, 7);
    if (laterStart && laterStart < end) end = laterStart;
    const w = { key: null, plan: null, start, end };
    weeks.push(w);
    return w;
  };
}

// A week row's state. Not planned: no meals yet. Ordered: Finish plan was pressed. A week
// already under way shows a plain row. Otherwise planning is in progress, and the step
// reached is the first unfinished one.
function weekState(w, today) {
  if (!w.plan || !hasMeals(w.plan)) return { kind: "unplanned" };
  if (w.plan.orderedAt) return { kind: "ordered" };
  if (w.start <= today) return { kind: "running" };
  const reached = Math.min(Math.max(w.plan.maxStep ?? w.plan.step ?? 1, 1), STEP_BAR.length - 1);
  return { kind: "progress", next: reached };
}

function WeekRow({ week, state, today, onOpen, onContinue }) {
  const status = state.kind === "unplanned" ? "Not planned"
    : state.kind === "progress" ? `Up next: ${STEP_BAR[state.next]}`
    : state.kind === "ordered" && week.start > today ? `Ordered · pickup ${abbrOf(week.start)}`
    : null;
  return (
    <div className="home-week">
      <div className="home-week-top">
        <button type="button" className="home-week-open" onClick={onOpen}>
          <span className="home-week-title">{weekLabel(week.start)} <span className="home-week-chev" aria-hidden="true">›</span></span>
          {status && <span className="home-sub">{status}</span>}
        </button>
        {state.kind === "unplanned" && <PillButton inline onClick={onOpen}>Plan</PillButton>}
        {state.kind === "progress" && <PillButton inline onClick={onContinue}>Continue</PillButton>}
      </div>
      {state.kind === "progress" && (
        <ol className="home-steps" aria-label={`Step ${state.next + 1} of ${STEP_BAR.length}`}>
          {STEP_BAR.map((label, i) => (
            <li key={label} className={i < state.next ? "is-done" : i === state.next ? "is-next" : undefined}>
              <span className="home-steps-bar" />{label}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function HomeScreen({ db, dataDot, onOpenData, onOpenSettings, onOpenPlan }) {
  const today = todayLocalISO();
  const plans = db.plans || {};
  const shoppingDay = db.settings?.shoppingDay;

  // Tonight's week, then the list: tomorrow onward for LIST_DAYS days, grouped by week.
  const { tonightWeek, groups } = useMemo(() => {
    const find = weekFinder(plans, shoppingDay);
    const tonightWeek = find(today);
    const groups = [];
    for (let n = 1; n <= LIST_DAYS; n++) {
      const iso = addDaysISO(today, n);
      const w = find(iso);
      if (groups[groups.length - 1]?.week !== w) groups.push({ week: w, rows: [] });
      if (w.plan) groups[groups.length - 1].rows.push({ iso, key: dayKeyForDate(w.plan, iso) });
    }
    return { tonightWeek, groups };
  }, [plans, shoppingDay, today]);

  // Plate concerns, shown in amber on their day's row, word for word.
  const concerns = useMemo(() => {
    const out = {};
    for (const planKey of ["current", "next"]) {
      const plan = plans[planKey];
      if (!plan?.weekStartDate || !hasMeals(plan)) continue;
      try {
        const days = Object.keys(weekDates(plan.weekStartDate, extraDaysOf(plan)));
        const { observations } = checkWeek(evaluateWeek, { db, planKey, plan, forecastByDate: {}, today, days });
        const byDay = {};
        for (const o of observations || []) if (o.severity === "concern" && o.day) (byDay[o.day] = byDay[o.day] || []).push(o.text);
        out[planKey] = byDay;
      } catch { /* the week check is a nicety on Home: no concerns rather than no Home */ }
    }
    return out;
  }, [db, plans, today]);

  // Plan / the week title: open that week (a week with no plan slot yet starts one).
  // Continue: the first unfinished step.
  const openWeek = w => onOpenPlan(w.key || "start-next");
  const continueWeek = (w, state) => onOpenPlan(w.key, state.next);

  const tPlan = tonightWeek.plan && hasMeals(tonightWeek.plan) ? tonightWeek.plan : null;
  const todayKey = tPlan ? dayKeyForDate(tPlan, today) : null;
  const tonight = todayKey ? dishesFor(tPlan, todayKey) : null;
  const tonightNote = todayKey ? (tPlan.dayNotes?.[todayKey] || "").trim() : "";
  const tonightConcerns = todayKey ? (concerns[tonightWeek.key]?.[todayKey] || []) : [];
  const dateTitle = new Date(today + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  const sharePlan = tPlan || groups.map(g => g.week.plan).find(p => p && hasMeals(p)) || null;
  const openFridgeReport = () => {
    const url = URL.createObjectURL(new Blob([buildFridgeReportHTML(db)], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const [shared, setShared] = useState(false);
  const shareWithFamily = async () => {
    if (!sharePlan) return;
    const { days, daysFull } = planDays(sharePlan, shoppingDay);
    const text = draftPlanText(days, daysFull, sharePlan.mealPlan);
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e?.name === "AbortError") return; }
    copyToClipboard(text);
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  };

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-titles">
          <h1 className="ui-screen-title">{dateTitle}</h1>
        </div>
        <div className="ui-icons">
          <IconButton icon="data" label={dataDot ? "Import and export: backup overdue" : "Import and export"} dot={dataDot} onClick={onOpenData} />
          <IconButton icon="gear" label="Settings" onClick={onOpenSettings} />
        </div>
      </header>

      <main className="home-main">
        {db._isSeed && (
          <Group>
            <div className="home-firstrun">
              <span>Showing example data.</span>
              <PillButton inline onClick={onOpenData}>Import your file</PillButton>
            </div>
          </Group>
        )}

        <Section label="Tonight">
          {tPlan ? (
            <button type="button" className="home-tonight" onClick={() => onOpenPlan(tonightWeek.key)}>
              <span className={tonight ? "home-tonight-main" : "home-tonight-none"}>{tonight?.main || "Nothing planned"}</span>
              {tonight?.sides.length > 0 && <span className="home-sub">+ {tonight.sides.join(", ")}</span>}
              {tonightNote && <span className="home-sub">{tonightNote}</span>}
              {tonightConcerns.map((t, i) => <span key={i} className="home-concern">{t}</span>)}
            </button>
          ) : (
            <div className="home-tonight"><span className="home-tonight-none">Nothing planned</span></div>
          )}
        </Section>

        <Section label="Coming up">
          <Group>
            {groups.map(({ week, rows }) => {
              const state = weekState(week, today);
              const showDays = state.kind !== "unplanned";
              const away = showDays ? awayLines(rows, week.plan, db) : {};
              return (
                <div key={week.start} className="home-week-group">
                  <WeekRow week={week} state={state} today={today} onOpen={() => openWeek(week)} onContinue={() => continueWeek(week, state)} />
                  {showDays && rows.map(({ key, iso }) => {
                    const d = dishesFor(week.plan, key);
                    const note = d ? "" : (week.plan.dayNotes?.[key] || "").trim();
                    return (
                      <button key={iso} type="button" className="ui-row home-day" onClick={() => onOpenPlan(week.key)}>
                        <span className="home-day-abbr">{abbrOf(iso)}</span>
                        <span className="home-day-body">
                          <span className={d ? "home-day-main" : "home-day-main home-day-empty"}>{d?.main || note || "—"}</span>
                          {d?.sides.length > 0 && <span className="home-sub">+ {d.sides.join(", ")}</span>}
                          {(away[iso] || []).length > 0 && <span className="home-sub">{away[iso].join(" · ")}</span>}
                          {(concerns[week.key]?.[key] || []).map((t, i) => <span key={i} className="home-concern">{t}</span>)}
                        </span>
                        <span className="ui-chevron"><Icon name="chevron" size={18} /></span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </Group>
        </Section>

        <div className="home-share">
          <button type="button" className="ui-tile-button" onClick={openFridgeReport}><Icon name="print" size={18} />Fridge report</button>
          <button type="button" className="ui-tile-button" onClick={shareWithFamily} disabled={!sharePlan}><Icon name="share" size={18} />{shared ? "Copied" : "Share with family"}</button>
        </div>
      </main>
    </div>
  );
}
