// Home (polish Phase 2, canvas "Home A · Tonight-first", decisions 11/12): today's date as
// the screen title, "Week of … ›", Tonight, the rest of the week as one list (away info by
// name, plate concerns in amber, verbatim), the Next week row, Fridge report / Share with
// family. No time icons, no app name, no instructional copy.
import { useMemo, useState } from "react";
import { checkWeek, dayKeyForDate, extraDaysOf, presentOn, weekDates } from "../engine/assembleInputs.js";
import { evaluateWeek } from "../engine/composeWeek.js";
import { copyToClipboard } from "../app/clipboard.js";
import { buildFridgeReportHTML } from "../app/fridgeReport.js";
import { planDays, todayLocalISO, weekLabel } from "../app/globals.js";
import { draftPlanText } from "../app/shareText.js";
import { Group, Icon, IconButton, PillButton, Section } from "../ui/kit.jsx";
import "./home.css";

const ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const abbrOf = iso => ABBR[new Date(iso + "T00:00:00").getDay()];

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

export function HomeScreen({ db, dataDot, onOpenData, onOpenSettings, onOpenPlan }) {
  const today = todayLocalISO();
  const plans = db.plans || {};
  const planKey = dayKeyForDate(plans.next, today) ? "next" : dayKeyForDate(plans.current, today) ? "current" : null;
  const plan = planKey ? plans[planKey] : null;
  const nextPlan = planKey === "current" ? plans.next : null;

  const dates = plan ? weekDates(plan.weekStartDate, extraDaysOf(plan)) : {};
  const todayKey = plan ? dayKeyForDate(plan, today) : null;
  const rows = Object.entries(dates).filter(([, iso]) => iso > today).map(([key, iso]) => ({ key, iso }));
  const away = plan ? awayLines(rows, plan, db) : {};

  // Plate concerns, shown in amber on their day's row, word for word.
  const concerns = useMemo(() => {
    if (!plan) return {};
    try {
      const { observations } = checkWeek(evaluateWeek, { db, planKey, plan, forecastByDate: {}, today, days: Object.keys(dates) });
      const byDay = {};
      for (const o of observations || []) if (o.severity === "concern" && o.day) (byDay[o.day] = byDay[o.day] || []).push(o.text);
      return byDay;
    } catch { return {}; }
  }, [db, planKey]);

  const tonight = plan && todayKey ? dishesFor(plan, todayKey) : null;
  const tonightNote = plan && todayKey ? (plan.dayNotes?.[todayKey] || "").trim() : "";
  const dateTitle = new Date(today + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  const nextTotal = nextPlan ? Object.keys(weekDates(nextPlan.weekStartDate, extraDaysOf(nextPlan))).length : 0;
  const nextPlanned = nextPlan ? Object.values(nextPlan.mealPlan || {}).filter(m => (m || []).length).length : 0;

  const openFridgeReport = () => {
    const url = URL.createObjectURL(new Blob([buildFridgeReportHTML(db)], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const [shared, setShared] = useState(false);
  const shareWithFamily = async () => {
    if (!plan) return;
    const { days, daysFull } = planDays(plan, db.settings?.shoppingDay);
    const text = draftPlanText(days, daysFull, plan.mealPlan);
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
          {plan && <button type="button" className="ui-link" onClick={() => onOpenPlan(planKey)}>{weekLabel(plan.weekStartDate)} ›</button>}
        </div>
        <div className="ui-icons">
          <IconButton icon="data" label={dataDot ? "Your data: backup overdue" : "Your data"} dot={dataDot} onClick={onOpenData} />
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
          <button type="button" className="home-tonight" onClick={() => onOpenPlan(planKey)}>
            <span className="home-tonight-main">{tonight?.main || "Not planned yet"}</span>
            {tonight?.sides.length > 0 && <span className="home-sub">+ {tonight.sides.join(", ")}</span>}
            {tonightNote && <span className="home-sub">{tonightNote}</span>}
            {todayKey && (concerns[todayKey] || []).map((t, i) => <span key={i} className="home-concern">{t}</span>)}
          </button>
        </Section>

        {rows.length > 0 && (
          <Section label="Rest of the week">
            <Group>
              {rows.map(({ key, iso }) => {
                const d = dishesFor(plan, key);
                return (
                  <button key={key} type="button" className="ui-row home-day" onClick={() => onOpenPlan(planKey)}>
                    <span className="home-day-abbr">{abbrOf(iso)}</span>
                    <span className="home-day-body">
                      <span className="home-day-main">{d?.main || "—"}</span>
                      {d?.sides.length > 0 && <span className="home-sub">+ {d.sides.join(", ")}</span>}
                      {(away[iso] || []).length > 0 && <span className="home-sub">{away[iso].join(" · ")}</span>}
                      {(concerns[key] || []).map((t, i) => <span key={i} className="home-concern">{t}</span>)}
                    </span>
                    <span className="ui-chevron"><Icon name="chevron" size={18} /></span>
                  </button>
                );
              })}
            </Group>
          </Section>
        )}

        {planKey !== "next" && (
          <Group>
            <div className="home-next">
              <span className="home-next-text">
                <span className="home-next-title">{plan ? "Next week" : "This week"}</span>
                <span className="home-sub">{nextPlan ? `${nextPlanned} of ${nextTotal} days planned` : "Not planned"}</span>
              </span>
              <PillButton inline onClick={() => onOpenPlan(nextPlan ? "next" : plan ? "start-next" : "current")}>Plan</PillButton>
            </div>
          </Group>
        )}

        <div className="home-share">
          <button type="button" className="ui-tile-button" onClick={openFridgeReport}><Icon name="print" size={18} />Fridge report</button>
          <button type="button" className="ui-tile-button" onClick={shareWithFamily} disabled={!plan}><Icon name="share" size={18} />{shared ? "Copied" : "Share with family"}</button>
        </div>
      </main>
    </div>
  );
}
