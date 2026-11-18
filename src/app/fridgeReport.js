// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { extraDaysOf, isExtraDay, weekDates } from "../engine/assembleInputs.js";
import { planDays } from "./globals.js";
import { getActivePlan } from "./plans.js";

// ── Fridge report ────────────────────────────────────────────────────────────
// Ported from the standalone build-plan-page.js generator, with three changes:
// the title/footer are sanitized for the public repo (no surname), day order
// comes from getWeekFromDate (this app's real ordering source) instead of the
// generator's shoppingDay-based weekOrder, and a "next week" teaser section is
// appended when plans.next has any planned meals. Built as a plain string —
// unlike the standalone script, the app already has the data in hand, so there's
// no need to embed a DB blob and re-render client-side.
const FRIDGE_REPORT_DOW_FULL = { Sun:"Sunday", Mon:"Monday", Tue:"Tuesday", Wed:"Wednesday", Thu:"Thursday", Fri:"Friday", Sat:"Saturday" };

function fridgeReportEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c]));
}

function fridgeReportFmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length <= 10 ? "T00:00:00" : ""));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric", year:"numeric" });
}

// "Nov 16" for a day heading; "11/16" for a leftovers row.
function fridgeReportMonthDay(iso) {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
}
function fridgeReportNumDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? "" : (d.getMonth() + 1) + "/" + d.getDate();
}

function fridgeReportMealIndex(meals) {
  const ix = {};
  (meals || []).forEach(m => { if (m && m.name) ix[m.name.trim().toLowerCase()] = m; });
  return ix;
}

function fridgeReportBuildDay(dow, iso, names, dayNote, ix) {
  const defs = names.map(n => ix[String(n).trim().toLowerCase()]);

  const title = !names.length
    ? '<span class="meal-tbd">Not planned yet</span>'
    : names.map(fridgeReportEsc).join('<span class="sep">/</span>');

  let rows = "";
  defs.forEach(m => {
    if (!m) return;
    if (m.cascadesInto) {
      rows += '<div class="row cascade"><span class="ic">&rarr;</span><span>Becomes ' + fridgeReportEsc(m.cascadesInto) + '</span></div>';
    }
    const note = (m.notes || "").trim();
    if (note) {
      const who = names.length > 1 ? fridgeReportEsc(m.name) + ': ' : '';
      rows += '<div class="row pnote"><span class="ic">&#9998;</span><span>' + who + fridgeReportEsc(note) + '</span></div>';
    }
  });

  const date = iso ? '<span class="dowdate"> &middot; ' + fridgeReportEsc(fridgeReportMonthDay(iso)) + '</span>' : '';
  const here = dayNote ? '<div class="here">' + fridgeReportEsc(dayNote) + '</div>' : '';

  return '' +
    '<section class="day">' +
      '<div class="dayhead"><span class="dow">' + fridgeReportEsc(FRIDGE_REPORT_DOW_FULL[dow] || dow) + date + '</span>' + here + '</div>' +
      '<div class="meals">' + title + '</div>' +
      (rows ? '<div class="meta">' + rows + '</div>' : '') +
    '</section>';
}

// ── Leftovers lists ──────────────────────────────────────────────────────────
// Two pen-and-paper lists at the end of the report: last week's and this week's
// meals, one row per planned day (date order), each with a checkbox, the main in
// bold, its sides, and two blank lines to write on. Nothing here is tracked: it's
// checked off and crossed out by hand on the printout.

// A plan's planned days in date order: [{ key, iso, names }]. Empty days are left out.
function fridgeReportPlannedDays(plan) {
  if (!plan?.weekStartDate) return [];
  const mp = plan.mealPlan || plan.meals || {};
  return Object.entries(weekDates(plan.weekStartDate, extraDaysOf(plan)))
    .map(([key, iso]) => ({ key, iso, names: (mp[key] || []).map(s => String(s).trim()).filter(Boolean) }))
    .filter(x => x.names.length)
    .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

// "Sides: rice, slaw" in a meal's notes. The list ends at a line break, ";" or ".".
function fridgeReportNoteSides(meal) {
  const m = /\bsides\s*:\s*([^\r\n;.]*)/i.exec(meal?.notes || "");
  return m ? m[1].split(",").map(s => s.trim()).filter(Boolean) : [];
}

// The day's main (the plate's main if it has one, else the first dish that isn't a
// side, else the first dish), then the other dishes and the sides named in the main's note.
function fridgeReportMainAndSides(plan, key, names, ix) {
  const dishes = plan?.plates?.[key]?.dishes || [];
  let mainIdx = dishes.findIndex(d => d?.role === "main");
  if (mainIdx < 0 || mainIdx >= names.length) mainIdx = names.findIndex(n => ix[n.toLowerCase()]?.type !== "side");
  if (mainIdx < 0) mainIdx = 0;
  const main = names[mainIdx];
  const sides = [...names.filter((_, i) => i !== mainIdx), ...fridgeReportNoteSides(ix[main.toLowerCase()])];
  return { main, sides };
}

// The week before the printed one: the latest plan (archived, current or next) that starts earlier.
function fridgeReportPreviousWeek(db, printed) {
  const start = printed?.weekStartDate;
  if (!start) return null;
  return [...(db.planTail || []), db.plans?.current, db.plans?.next]
    .filter(w => w && w !== printed && w.weekStartDate && w.weekStartDate < start)
    .sort((a, b) => (a.weekStartDate < b.weekStartDate ? -1 : a.weekStartDate > b.weekStartDate ? 1 : 0))
    .pop() || null;
}

// A checkbox marks a dish as available in the fridge: this week's are ticked by hand
// as they're cooked; last week's are all available already, so they print ticked.
function fridgeReportLeftoverColumn(title, plan, ix, checked) {
  const rows = fridgeReportPlannedDays(plan).map(({ key, iso, names }) => {
    const { main, sides } = fridgeReportMainAndSides(plan, key, names, ix);
    const dow = new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday:"short" });
    return '' +
      '<div class="lo-day">' +
        '<span class="box' + (checked ? ' checked' : '') + '"></span>' +
        '<span class="lo-date"><span>' + fridgeReportEsc(dow) + '</span><span>' + fridgeReportEsc(fridgeReportNumDate(iso)) + '</span></span>' +
        '<div class="lo-body"><span class="lo-main">' + fridgeReportEsc(main) + '</span>' +
          (sides.length ? '<span class="lo-sides"> &ndash; ' + fridgeReportEsc(sides.join(", ")) + '</span>' : '') +
        '</div>' +
        '<div class="lo-line"></div>' +
      '</div>';
  }).join("");
  return '' +
    '<div class="lo-col">' +
      '<div class="lo-title">' + fridgeReportEsc(title) + '</div>' +
      (rows || '<div class="lo-none">Nothing planned</div>') +
    '</div>';
}

// Prints whichever week the WeekSelector shows (SPEC-active-plan-app-wide.md)
// — the printable form of the Tonight tab's MEAL SCHEDULE card.
function buildFridgeReportHTML(db) {
  const ix = fridgeReportMealIndex(db.meals);

  const printedPlan = getActivePlan(db);
  const mp    = printedPlan?.mealPlan || printedPlan?.meals || {};
  const notes = printedPlan?.dayNotes || {};
  const { days: order, daysFull: orderFull } = planDays(printedPlan, db.settings?.shoppingDay);

  const dates = printedPlan?.weekStartDate ? weekDates(printedPlan.weekStartDate, extraDaysOf(printedPlan)) : {};
  const daysHTML = order.map((d, i) => {
    const names = (mp[d] || []).map(s => String(s).trim()).filter(Boolean);
    return fridgeReportBuildDay(isExtraDay(d) ? orderFull[i] : d, dates[d], names, (notes[d] || "").trim(), ix);
  }).join("");

  const leftoversHTML =
    '<section class="leftovers">' +
      fridgeReportLeftoverColumn("Last week's leftovers", fridgeReportPreviousWeek(db, printedPlan), ix, true) +
      fridgeReportLeftoverColumn("This week's leftovers", printedPlan, ix) +
    '</section>';

  const weekOf = printedPlan?.weekStartDate || "";
  const weekOfHTML = weekOf ? "Week of " + fridgeReportFmtDate(weekOf) : "";

  // Only tease "next week" when the printed plan IS current and a next plan
  // exists beyond it — if the printed plan is already next, there's nothing
  // further ahead to tease.
  const nextPlan = (printedPlan === db.plans?.current) ? (db.plans?.next || null) : null;
  let teaserHTML = "";
  if (nextPlan) {
    const npMp = nextPlan.mealPlan || nextPlan.meals || {};
    const { days: nextOrder, daysFull: nextFull } = planDays(nextPlan, db.settings?.shoppingDay);
    const items = nextOrder
      .map((d, i) => ({ d: isExtraDay(d) ? nextFull[i] : d, names: (npMp[d] || []).map(s => String(s).trim()).filter(Boolean) }))
      .filter(x => x.names.length);
    if (items.length) {
      teaserHTML =
        '<section class="teaser">' +
          '<div class="teaser-title">Meal ideas for next week</div>' +
          '<ul class="teaser-list">' +
            items.map(x => '<li><b>' + fridgeReportEsc(FRIDGE_REPORT_DOW_FULL[x.d] || x.d) + '</b>: ' + fridgeReportEsc(x.names.join(", ")) + '</li>').join("") +
          '</ul>' +
        '</section>';
    }
  }

  const stamp = "Updated " + new Date().toLocaleDateString(undefined, { month:"short", day:"numeric" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This Week's Meal Plan</title>
<style>
  :root{
    --paper:#fbf7f0; --card:#ffffff; --ink:#211d17; --soft:#4a4339;
    --faint:#7d7264; --line:#d9cfbe; --thread:#4f6327; --thread-ink:#3a4a1d;
    --note:#8a5618; --rule:#c9bda6;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);
    font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
    -webkit-text-size-adjust:100%;}

  .wrap{max-width:680px;margin:0 auto;padding:30px 22px 64px;}

  header{text-align:center;padding-bottom:18px;
    border-bottom:2px solid var(--ink);margin-bottom:6px;}
  .eyebrow{font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;
    font-size:11.5px;letter-spacing:3px;text-transform:uppercase;
    color:var(--note);font-weight:800;margin-bottom:8px;}
  h1{margin:0;font-size:33px;line-height:1.04;font-weight:800;letter-spacing:-.4px;}
  .weekof{margin-top:9px;font-size:14.5px;color:var(--soft);font-style:italic;font-weight:600;}

  .day{padding:20px 2px 18px;border-bottom:1.5px solid var(--line);}
  .day:last-child{border-bottom:none;}
  .dayhead{display:flex;align-items:baseline;gap:10px;margin-bottom:5px;}
  .dow{font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;
    font-size:12.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
    color:var(--note);}
  .dow{white-space:nowrap;flex:0 0 auto;}
  .dowdate{letter-spacing:1px;}
  .here{font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;
    font-size:12px;color:var(--soft);font-style:normal;font-weight:600;
    margin-left:auto;text-align:right;}
  .meals{font-size:22px;font-weight:700;line-height:1.28;}
  .meals .sep{color:var(--faint);font-weight:400;padding:0 4px;}
  .meal-tbd{color:var(--faint);font-style:italic;font-weight:500;font-size:19px;}

  .meta{margin-top:7px;display:flex;flex-direction:column;gap:5px;}
  .row{display:flex;align-items:flex-start;gap:8px;
    font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;font-size:13.5px;
    font-weight:600;line-height:1.45;}
  .row .ic{flex:0 0 auto;font-size:12px;line-height:1.5;}
  .cascade{color:var(--thread-ink);font-weight:700;}
  .cascade .ic{color:var(--thread);}
  .pnote{color:var(--note);}
  .pnote .ic{color:var(--note);}

  .leftovers{margin-top:28px;padding-top:20px;border-top:2px solid var(--ink);
    display:grid;grid-template-columns:1fr 1fr;gap:0 24px;}
  .lo-title{font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;
    font-size:12.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
    color:var(--note);margin-bottom:4px;}
  .lo-day{display:grid;grid-template-columns:14px 40px 1fr;column-gap:8px;
    align-items:start;padding-top:9px;break-inside:avoid;}
  .box{align-self:start;margin-top:3px;width:14px;height:14px;border:1.5px solid var(--ink);
    border-radius:2px;display:flex;align-items:center;justify-content:center;
    font-family:"Segoe UI Symbol","Apple Symbols",system-ui,sans-serif;font-size:12px;
    font-weight:800;line-height:1;color:var(--ink);}
  .box.checked::after{content:"\\2713";}
  .lo-date{display:flex;flex-direction:column;padding-top:2px;
    font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;white-space:nowrap;
    font-size:11px;font-weight:800;letter-spacing:.8px;line-height:1.25;
    text-transform:uppercase;color:var(--soft);}
  .lo-date span + span{font-weight:600;letter-spacing:.3px;}
  .lo-body{line-height:1.3;padding-left:6px;}
  .lo-main{font-size:15.5px;font-weight:700;}
  .lo-sides{font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;
    font-size:12.5px;font-weight:600;color:var(--soft);}
  .lo-line{grid-column:2 / -1;height:16px;border-bottom:1px solid var(--rule);}
  .lo-none{padding-top:10px;color:var(--faint);font-style:italic;font-size:15px;}

  .teaser{margin-top:28px;padding-top:20px;border-top:2px solid var(--ink);}
  .teaser-title{font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;
    font-size:12.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
    color:var(--note);margin-bottom:10px;}
  .teaser-list{margin:0;padding-left:20px;font-size:15px;line-height:1.7;color:var(--soft);}
  .teaser-list li{margin-bottom:4px;}
  .teaser-list b{color:var(--ink);}

  footer{margin-top:34px;text-align:center;
    font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;
    font-size:11.5px;letter-spacing:1px;color:var(--soft);font-weight:600;}

  @media print{
    @page{margin:14mm;}
    html,body{background:#fff;}
    .wrap{max-width:100%;padding:0;}
    .day{break-inside:avoid;}
  }
  @media (prefers-reduced-motion:no-preference){
    .day{animation:rise .5s ease both;}
    .day:nth-child(2){animation-delay:.04s} .day:nth-child(3){animation-delay:.08s}
    .day:nth-child(4){animation-delay:.12s} .day:nth-child(5){animation-delay:.16s}
    .day:nth-child(6){animation-delay:.20s} .day:nth-child(7){animation-delay:.24s}
    @keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="eyebrow">Dinner Plan</div>
      <h1>This Week's Meal Plan</h1>
      <div class="weekof">${weekOfHTML}</div>
    </header>
    <main>${daysHTML}</main>
    ${leftoversHTML}
    ${teaserHTML}
    <footer>
      <span>${stamp}</span>
    </footer>
  </div>
</body>
</html>`;
}

export { buildFridgeReportHTML };
