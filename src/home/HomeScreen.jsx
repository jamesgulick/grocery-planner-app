// Home (polish Phase 2, canvas "Home A · Tonight-first", decisions 11/12–11/13): today's date
// as the screen title, Tonight, then the coming days (no heading since 11/18): a rolling 7 days from tomorrow that runs past
// the end of the week, and on to the end of a planned week it reaches (11/13: show all of next
// week's meals). Each week in it starts with a pale-green week row (Not planned · Plan /
// Up next: <step> · Continue + step bar / Ordered · pickup <day> <date>), followed by its planned days
// (away info by name, plate concerns in amber, verbatim). Then Fridge report / Share with
// family. No time icons, no app name, no instructional copy.
// Pickup (brief §6, RULING 15; 11/18): one cart, on the upcoming pickup day (src/app/pickup.js),
// whichever plan's nights that day falls in, and even before the plan it shops for exists. It
// sits under the day name, or right after "Tonight" when the pickup is today; tapping it opens
// the Pickup sheet. No words with it. The week row says the pickup with its date.
import { useMemo, useState } from "react";
import { addDaysISO, checkWeek, dayKeyForDate, extraDaysOf, pickupDateOf, presentOn, weekDates } from "../engine/assembleInputs.js";
import { evaluateWeek } from "../engine/composeWeek.js";
import { copyToClipboard } from "../app/clipboard.js";
import { buildFridgeReportHTML } from "../app/fridgeReport.js";
import { planDays, todayLocalISO, weekLabel } from "../app/globals.js";
import { upcomingPickup } from "../app/pickup.js";
import { draftPlanText } from "../app/shareText.js";
import { ActionBar, Group, Icon, IconButton, PillButton, RowChevron } from "../ui/kit.jsx";
import { PickupSheet } from "./PickupSheet.jsx";
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
// "Usual shopping day" weekday, and stops where the next plan starts.
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

// The pickup in words, by the date (11/18): "pickup Tue 24", "pickup today", "picked up Tue 17".
// Always with the date number: the list can show the same weekday twice.
const pickupWords = (iso, today) => iso === today ? "pickup today"
  : `${iso < today ? "picked up" : "pickup"} ${abbrOf(iso)} ${new Date(iso + "T00:00:00").getDate()}`;

function WeekRow({ week, state, today, pickup, onOpen, onContinue }) {
  const withPickup = s => pickup ? `${s} · ${pickupWords(pickup, today)}` : s;
  const status = state.kind === "unplanned" ? withPickup("Not planned")
    : state.kind === "progress" ? `Up next: ${STEP_BAR[state.next]}`
    : state.kind === "ordered" ? withPickup("Ordered")
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

export function HomeScreen({ db, dataDot, onOpenData, onOpenSettings, onOpenPlan, persistDB }) {
  const today = todayLocalISO();
  const plans = db.plans || {};
  const shoppingDay = db.settings?.shoppingDay;

  // The one upcoming pickup, and its cart (src/app/pickup.js).
  const upcoming = useMemo(() => upcomingPickup(db, today), [db, today]);
  const [pickupOpen, setPickupOpen] = useState(false);
  const cart = iso => iso === upcoming.date ? (
    <span role="button" tabIndex={0} className="home-cart" aria-label="Pickup"
      onClick={e => { e.stopPropagation(); setPickupOpen(true); }}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setPickupOpen(true); } }}>
      <Icon name="cart" size={18} />
    </span>
  ) : null;

  // Tonight's week, then the list: tomorrow onward for LIST_DAYS days, grouped by week.
  const { tonightWeek, groups } = useMemo(() => {
    const find = weekFinder(plans, shoppingDay);
    const tonightWeek = find(today);
    const groups = [];
    let iso = addDaysISO(today, 1);
    const last = addDaysISO(today, LIST_DAYS);
    for (;;) {
      const w = find(iso);
      if (groups[groups.length - 1]?.week !== w) groups.push({ week: w, rows: [] });
      if (w.plan) groups[groups.length - 1].rows.push({ iso, key: dayKeyForDate(w.plan, iso) });
      iso = addDaysISO(iso, 1);
      // Past the rolling window, keep going only to the end of a planned week already begun.
      if (iso > last && !(w.plan && iso < w.end && find(iso) === w)) break;
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

        {/* Tonight (board "Tonight band", option G, 11/17): a dark green band across the top of the
            card reads "Tonight", with the cart after it on pickup day; it stays when nothing is planned. */}
        <section className="home-tonight-card" aria-label="Tonight">
          <div className="home-tonight-band"><span>Tonight</span>{cart(today)}</div>
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
        </section>

        {/* No "Coming up" heading (11/18): the Tonight band and each green week row say what they are. */}
        <section aria-label="Coming up">
          <Group>
            {groups.map(({ week, rows }) => {
              const state = weekState(week, today);
              const showDays = state.kind !== "unplanned";
              const away = showDays ? awayLines(rows, week.plan, db) : {};
              return (
                <div key={week.start} className="home-week-group">
                  <WeekRow week={week} state={state} today={today}
                    pickup={week.plan ? pickupDateOf(week.plan) : !upcoming.key && week.start === upcoming.start ? upcoming.date : null}
                    onOpen={() => openWeek(week)} onContinue={() => continueWeek(week, state)} />
                  {showDays && rows.map(({ key, iso }) => {
                    const d = dishesFor(week.plan, key);
                    const note = d ? "" : (week.plan.dayNotes?.[key] || "").trim();
                    return (
                      <button key={iso} type="button" className="ui-row home-day" onClick={() => onOpenPlan(week.key)}>
                        <span className="home-day-abbr">{abbrOf(iso)}{cart(iso)}</span>
                        <span className="home-day-body">
                          <span className={d ? "home-day-main" : "home-day-main home-day-empty"}>{d?.main || note || "—"}</span>
                          {d?.sides.length > 0 && <span className="home-sub">+ {d.sides.join(", ")}</span>}
                          {(away[iso] || []).length > 0 && <span className="home-sub">{away[iso].join(" · ")}</span>}
                          {(concerns[week.key]?.[key] || []).map((t, i) => <span key={i} className="home-concern">{t}</span>)}
                        </span>
                        <RowChevron top />
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </Group>
        </section>

        <div className="home-share-spacer" aria-hidden="true" />
      </main>

      {pickupOpen && (
        <PickupSheet plan={upcoming.plan} shoppingDay={shoppingDay} onClose={() => setPickupOpen(false)}
          onPick={iso => {
            if (!upcoming.key) {   // no plan for it yet: keep the day until there is one
              persistDB({ ...db, pendingPickup: { start: upcoming.start, date: iso } });
              return;
            }
            const rest = { ...plans[upcoming.key] }; delete rest.pickupDate;
            const plan = iso === rest.weekStartDate ? rest : { ...rest, pickupDate: iso };   // absent = the first day
            persistDB({ ...db, plans: { ...plans, [upcoming.key]: plan } });
          }} />
      )}

      <ActionBar>
        <div className="home-share">
          <button type="button" className="ui-tile-button" onClick={openFridgeReport}><Icon name="print" size={18} />Fridge report</button>
          <button type="button" className="ui-tile-button" onClick={shareWithFamily} disabled={!sharePlan}><Icon name="share" size={18} />{shared ? "Copied" : "Share with family"}</button>
        </div>
      </ActionBar>
    </div>
  );
}
