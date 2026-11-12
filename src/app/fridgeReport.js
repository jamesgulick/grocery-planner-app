// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { isExtraDay } from "../engine/assembleInputs.js";
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

function fridgeReportMealIndex(meals) {
  const ix = {};
  (meals || []).forEach(m => { if (m && m.name) ix[m.name.trim().toLowerCase()] = m; });
  return ix;
}

function fridgeReportBuildDay(dow, names, dayNote, ix) {
  const defs = names.map(n => ix[String(n).trim().toLowerCase()]);

  const title = !names.length
    ? '<span class="meal-tbd">Not planned yet</span>'
    : names.map(fridgeReportEsc).join('<span class="sep">/</span>');

  let rows = "";
  const madeExtra = defs.some(m => m && m.leftovers === "yes");
  if (madeExtra) {
    rows += '<div class="row extra"><span class="ic">&#9679;</span><span>Makes extra &mdash; good for leftovers</span></div>';
  }
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

  const here = dayNote ? '<div class="here">' + fridgeReportEsc(dayNote) + '</div>' : '';

  return '' +
    '<section class="day">' +
      '<div class="dayhead"><span class="dow">' + fridgeReportEsc(FRIDGE_REPORT_DOW_FULL[dow] || dow) + '</span>' + here + '</div>' +
      '<div class="meals">' + title + '</div>' +
      (rows ? '<div class="meta">' + rows + '</div>' : '') +
    '</section>';
}

// Prints whichever week the WeekSelector shows (SPEC-active-plan-app-wide.md)
// — the printable form of the Tonight tab's MEAL SCHEDULE card.
function buildFridgeReportHTML(db) {
  const ix = fridgeReportMealIndex(db.meals);

  const printedPlan = getActivePlan(db);
  const mp    = printedPlan?.mealPlan || printedPlan?.meals || {};
  const notes = printedPlan?.dayNotes || {};
  const { days: order, daysFull: orderFull } = planDays(printedPlan, db.settings?.shoppingDay);

  const daysHTML = order.map((d, i) => {
    const names = (mp[d] || []).map(s => String(s).trim()).filter(Boolean);
    return fridgeReportBuildDay(isExtraDay(d) ? orderFull[i] : d, names, (notes[d] || "").trim(), ix);
  }).join("");

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
  .extra{color:var(--thread-ink);}
  .extra .ic{color:var(--thread);}
  .cascade{color:var(--thread-ink);font-weight:700;}
  .cascade .ic{color:var(--thread);}
  .pnote{color:var(--note);}
  .pnote .ic{color:var(--note);}

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
    ${teaserHTML}
    <footer>
      <span>${stamp}</span>
    </footer>
  </div>
</body>
</html>`;
}

export { buildFridgeReportHTML };
