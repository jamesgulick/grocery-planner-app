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
import { homePlanText } from "../app/shareText.js";
import { ActionBar, Group, HeaderButtons, Icon, IconButton, PillButton, RowChevron } from "../ui/kit.jsx";
import { ReimportPill } from "../shell/ReimportPill.jsx";
import { PickupSheet } from "./PickupSheet.jsx";
import { FirstRunCard, isEmptyDevice } from "../shell/FirstRun.jsx";
import { rateQueue } from "../rate/rating.js";
import { RateSheet } from "../rate/RateSheet.jsx";
import "../rate/rate.css";
import "./home.css";

const ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const abbrOf = iso => ABBR[new Date(iso + "T00:00:00").getDay()];
// The five planning steps as Home's step bar names them. Index = the plan's step index
// (PLAN_STEPS), where step 0 (today's Welcome) is where the Week setup step will live.
const STEP_BAR = ["Week", "Meals", "Inventory", "Confirm", "Order"];

// × on "Meals to rate" hides it until the app is next opened (brief §2): nothing is stored.
let rateBannerHidden = false;

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
  const reached = Math.min(Math.max(w.plan.maxStep ?? w.plan.step ?? 0, 0), STEP_BAR.length - 1);
  return { kind: "progress", next: reached };
}

// The pickup in words, by the date (11/18): "pickup Tue 24", "pickup today", "picked up Tue 17".
// Always with the date number: the list can show the same weekday twice.
const pickupWords = (iso, today) => iso === today ? "pickup today"
  : `${iso < today ? "picked up" : "pickup"} ${abbrOf(iso)} ${new Date(iso + "T00:00:00").getDate()}`;

// `main`: this week's Plan / Continue is Home's one main action (dark fill); otherwise the white
// secondary weight (brief §7 "Plan / Continue button weight", 11/25).
function WeekRow({ week, state, today, pickup, planFrom, main, onOpen, onContinue }) {
  const withPickup = s => pickup ? `${s} · ${pickupWords(pickup, today)}` : s;
  const status = state.kind === "unplanned" ? withPickup("Not planned")
    : state.kind === "progress" ? `Up next: ${STEP_BAR[state.next]}`
    : state.kind === "ordered" ? withPickup("Ordered")
    : null;
  return (
    <div className="home-week">
      <div className="home-week-top">
        {/* A week that can't be started yet (planFrom) has nothing to open: no tap, no › (11/25). */}
        {planFrom ? (
          <div className="home-week-open is-static">
            <span className="home-week-title">{weekLabel(week.start)}</span>
            {status && <span className="home-sub">{status}</span>}
          </div>
        ) : (
          <button type="button" className="home-week-open" onClick={onOpen}>
            <span className="home-week-title">{weekLabel(week.start)} <span className="home-week-chev" aria-hidden="true">›</span></span>
            {status && <span className="home-sub">{status}</span>}
          </button>
        )}
        {/* Both plan slots full (11/25): it can be started once the old week archives, so the
            band says when instead of offering a Plan that can't start it. */}
        {state.kind === "unplanned" && (planFrom
          ? <span className="home-sub home-week-wait">Plan from {abbrOf(planFrom)} {new Date(planFrom + "T00:00:00").getDate()}</span>
          : <PillButton inline outline={!main} onClick={onOpen}>Plan</PillButton>)}
        {state.kind === "progress" && <PillButton inline outline={!main} onClick={onContinue}>Continue</PillButton>}
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

// "Recipe sent 5:41" / "2 meals sent 5:41" (brief §9: the bar after an iOS reload).
const clock = iso => { const d = new Date(iso); return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`; };
function pendingWords(p) {
  if (p.purpose === "enrich") { const n = (p.job?.meals || []).length; return `${n} meal${n === 1 ? "" : "s"} sent ${clock(p.at)}`; }
  return `Recipe sent ${clock(p.at)}`;
}

export function HomeScreen({ db, dataDot, onOpenData, onOpenSettings, onOpenPlan, onOpenWeekView, pending, onDismissPending, onPendingLoaded, onOpenPending, persistDB, onOpenMeal }) {
  const today = todayLocalISO();
  // Meals to rate (brief §2): Just tried or Incomplete, tonight's from 7pm. Rate steps through them.
  const toRate = rateQueue(db, today, new Date().getHours());
  const empty = isEmptyDevice(db);   // first run (brief §8): Tonight, then the "This device" card only
  const [rateHidden, setRateHidden] = useState(rateBannerHidden);
  const [rating, setRating] = useState(null);
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

  // Tonight's week, then the list (brief §7, "Coming up: every planned day, no rolling window",
  // 11/25): every day from tomorrow through the last day of the last planned week, grouped by
  // week, whatever the plans' lengths. With two plan slots that's about two weeks at most.
  const { tonightWeek, groups } = useMemo(() => {
    const find = weekFinder(plans, shoppingDay);
    const tonightWeek = find(today);
    const lastEnd = ["current", "next"].filter(k => plans[k]?.weekStartDate).map(k => find(plans[k].weekStartDate).end).sort().pop();
    const groups = [];
    let iso = addDaysISO(today, 1);
    do {
      const w = find(iso);
      if (groups[groups.length - 1]?.week !== w) groups.push({ week: w, rows: [] });
      if (w.plan) groups[groups.length - 1].rows.push({ iso, key: dayKeyForDate(w.plan, iso) });
      iso = addDaysISO(iso, 1);
    } while (lastEnd && iso < lastEnd);
    // Then the week after the last planned one, its band only (brief §7, 11/25). One at most:
    // none when the list already ends on an unplanned week.
    for (let n = 0; n < 3 && weekState(groups[groups.length - 1].week, today).kind !== "unplanned"; n++) {
      groups.push({ week: find(groups[groups.length - 1].week.end), rows: [] });
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
  // A planned week's title opens its week view (stage 4e); an unplanned one starts or opens the plan.
  const openWeek = w => (w.key && w.plan && hasMeals(w.plan) && onOpenWeekView ? onOpenWeekView(w.key) : onOpenPlan(w.key, undefined, w.start));
  const continueWeek = (w, state) => onOpenPlan(w.key, state.next);

  const tPlan = tonightWeek.plan && hasMeals(tonightWeek.plan) ? tonightWeek.plan : null;
  const todayKey = tPlan ? dayKeyForDate(tPlan, today) : null;
  const tonight = todayKey ? dishesFor(tPlan, todayKey) : null;
  const tonightNote = todayKey ? (tPlan.dayNotes?.[todayKey] || "").trim() : "";
  const tonightConcerns = todayKey ? (concerns[tonightWeek.key]?.[todayKey] || []) : [];
  const dateTitle = new Date(today + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  // The earliest week that still needs you (unplanned or in progress) gets the dark Plan / Continue.
  const mainWeek = groups.findIndex(({ week }) => ["unplanned", "progress"].includes(weekState(week, today).kind));
  // Share with family sends what Home shows: tonight onward, every planned week, by week.
  const shareWeeks = [];
  [...(tPlan ? [{ week: tonightWeek, iso: today, key: todayKey }] : []), ...groups.flatMap(g => g.rows.map(r => ({ week: g.week, ...r })))]
    .filter(r => r.week.plan && hasMeals(r.week.plan) && r.key)
    .forEach(r => {
      let w = shareWeeks[shareWeeks.length - 1];
      if (w?.start !== r.week.start) shareWeeks.push(w = { start: r.week.start, label: weekLabel(r.week.start), days: [] });
      w.days.push({ day: new Date(r.iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" }), dishes: r.week.plan.mealPlan?.[r.key] || [] });
    });
  const sharePlan = shareWeeks.length ? shareWeeks : null;
  const openFridgeReport = () => {
    const url = URL.createObjectURL(new Blob([buildFridgeReportHTML(db)], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const [shared, setShared] = useState(false);
  const shareWithFamily = async () => {
    if (!sharePlan) return;
    const text = homePlanText(sharePlan);
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
        <HeaderButtons>
          <IconButton icon="data" label={dataDot ? "Import and export: backup overdue" : "Import and export"} dot={dataDot} onClick={onOpenData} />
          <IconButton icon="gear" label="Settings" onClick={onOpenSettings} />
        </HeaderButtons>
      </header>

      <main className="home-main">
        {pending && (
          <div className="home-pending">
            {pending.purpose === "recipe"
              ? <button type="button" className="home-pending-text" onClick={() => onOpenPending(pending)}>{pendingWords(pending)}</button>
              : <span className="home-pending-text">{pendingWords(pending)}</span>}
            <ReimportPill db={db} persistDB={persistDB} onLoaded={onPendingLoaded} />
            <button type="button" className="home-pending-x" aria-label="Dismiss" onClick={onDismissPending}><Icon name="close" size={16} /></button>
          </div>
        )}
        {db._isSeed && (
          <Group>
            <div className="home-firstrun">
              <span>Showing example data.</span>
              <PillButton inline onClick={onOpenData}>Import your file</PillButton>
            </div>
          </Group>
        )}

        {toRate.length > 0 && !rateHidden && (
          <div className="home-rate">
            <span className="home-rate-text">
              <span className="home-rate-title">Meals to rate · {toRate.length}</span>
              <span className="home-rate-names">{toRate.map(q => q.meal.name).join(", ")}</span>
            </span>
            <PillButton inline outline onClick={() => setRating(toRate.map(q => ({ mealId: q.meal.id, iso: q.iso, out: q.out, why: q.why })))}>Rate</PillButton>
            <button type="button" className="home-pending-x" aria-label="Dismiss" onClick={() => { rateBannerHidden = true; setRateHidden(true); }}><Icon name="close" size={16} /></button>
          </div>
        )}

        {/* Tonight (board "Tonight band", option G, 11/17): a dark green band across the top of the
            card reads "Tonight", with the cart after it on pickup day; it stays when nothing is planned. */}
        <section className="home-tonight-card" aria-label="Tonight">
          <div className="home-tonight-band"><span>Tonight</span>{cart(today)}</div>
          {tPlan ? (
            <button type="button" className="home-tonight" onClick={() => (onOpenWeekView ? onOpenWeekView(tonightWeek.key, todayKey) : onOpenPlan(tonightWeek.key))}>
              <span className={tonight ? "home-tonight-main" : "home-tonight-none"}>{tonight?.main || "Nothing planned"}</span>
              {tonight?.sides.length > 0 && <span className="home-sub">+ {tonight.sides.join(", ")}</span>}
              {tonightNote && <span className="home-sub">{tonightNote}</span>}
              {tonightConcerns.map((t, i) => <span key={i} className="home-concern">{t}</span>)}
            </button>
          ) : (
            <div className="home-tonight"><span className="home-tonight-none">Nothing planned</span></div>
          )}
        </section>

        {/* No "Coming up" heading (11/18): the Tonight band and each green week row say what they are.
            One card per week, each headed by its green band (board "Week cards", 11/24). */}
        {empty && <FirstRunCard db={db} persistDB={persistDB} />}
        {!empty && <section aria-label="Coming up" className="home-weeks">
            {groups.map(({ week, rows }, gi) => {
              const state = weekState(week, today);
              const showDays = state.kind !== "unplanned";
              const away = showDays ? awayLines(rows, week.plan, db) : {};
              return (
                <Group key={week.start}>
                  <WeekRow week={week} state={state} today={today}
                    planFrom={!week.plan && plans.current && plans.next?.weekStartDate > today ? plans.next.weekStartDate : null}
                    pickup={week.plan ? pickupDateOf(week.plan) : !upcoming.key && week.start === upcoming.start ? upcoming.date : null}
                    main={gi === mainWeek}
                    onOpen={() => openWeek(week)} onContinue={() => continueWeek(week, state)} />
                  {showDays && rows.map(({ key, iso }) => {
                    const d = dishesFor(week.plan, key);
                    const note = d ? "" : (week.plan.dayNotes?.[key] || "").trim();
                    return (
                      <button key={iso} type="button" className="ui-row home-day" onClick={() => (onOpenWeekView ? onOpenWeekView(week.key, key) : onOpenPlan(week.key))}>
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
                </Group>
              );
            })}
        </section>}

        <div className="home-share-spacer" aria-hidden="true" />
      </main>

      {rating && <RateSheet db={db} persistDB={persistDB} items={rating} onClose={() => setRating(null)} onOpenMeal={onOpenMeal} />}
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

      {!empty && <ActionBar>
        <div className="home-share">
          <button type="button" className="ui-tile-button ui-float-pill" onClick={openFridgeReport}><Icon name="print" size={18} />Fridge report</button>
          <button type="button" className="ui-tile-button ui-float-pill" onClick={shareWithFamily} disabled={!sharePlan}><Icon name="share" size={18} />{shared ? "Copied" : "Share with family"}</button>
        </div>
      </ActionBar>}
    </div>
  );
}
