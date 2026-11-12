// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { dayKeyForDate, isExtraDay } from "../engine/assembleInputs.js";
import { useState } from "react";
import { copyToClipboard } from "../app/clipboard.js";
import { buildFridgeReportHTML } from "../app/fridgeReport.js";
import { DAYS_ALL, addDaysISO, dateLabel, planDays, todayLocalISO } from "../app/globals.js";
import { getActivePlan, resolvePlanForDate } from "../app/plans.js";
import { C, S } from "../app/styles.js";
import { WeekSelector } from "../components/common.jsx";

// ── TONIGHT TAB ────────────────────────────────────────────────────────────────

function TonightTab({ db, persistDB }) {

  // TONIGHT/TOMORROW are DATE-anchored (SPEC-active-plan-app-wide.md): always
  // the real today/tomorrow, resolved by which plan's week actually contains
  // that date — normally current, but resolved rather than assumed so this
  // still works right at the current/next boundary. Ignores the WeekSelector
  // below entirely; toggling it must never change these two cards.
  const todayISO    = todayLocalISO();
  const tomorrowISO = addDaysISO(todayISO, 1);
  const tonightPlan  = resolvePlanForDate(db, todayISO);
  const tomorrowPlan = resolvePlanForDate(db, tomorrowISO);
  const mealOnDate = (plan, dateISO) => {
    // A dated plan answers only for its own dates: a date outside it (e.g. today, when the
    // week starts tomorrow) is "not planned", never the same weekday from another week.
    // Only an undated legacy plan falls back to matching the weekday name.
    const abbr = plan?.weekStartDate ? dayKeyForDate(plan, dateISO) : DAYS_ALL[new Date(dateISO + "T00:00:00").getDay()];
    if (!abbr) return null;
    const mp = plan?.mealPlan || plan?.meals || {};
    return (mp[abbr] || []).join(", ") || null;
  };
  const todayMeal    = mealOnDate(tonightPlan, todayISO);
  const tomorrowMeal = mealOnDate(tomorrowPlan, tomorrowISO);

  // The MEAL SCHEDULE card (below) is the OTHER anchor — it follows
  // db.activePlan via the WeekSelector, a deliberately different anchor than
  // Tonight/Tomorrow above. When today is in current but the selector is on
  // next, these two sections correctly show different weeks at once; the
  // date labels make that self-explaining.
  const activePlan  = getActivePlan(db);
  const planMeals   = activePlan?.mealPlan || activePlan?.meals || {};
  const { days, daysFull } = planDays(activePlan, db.settings?.shoppingDay);
  // Same rule for the schedule's "today" marker: none when today isn't in the shown week.
  const todayAbbr      = activePlan?.weekStartDate ? dayKeyForDate(activePlan, todayISO) : DAYS_ALL[new Date().getDay()];
  const scheduleTodayIdx = days.indexOf(todayAbbr);

  const buildMessage = () => `Tonight's dinner (${dateLabel(todayISO)}): ${todayMeal||"Not planned yet"}`;

  const [tonightCopied, setTonightCopied] = useState(null);
  const sendTonight = () => {
    const msg = buildMessage();
    copyToClipboard(msg);
    setTonightCopied(msg);
    setTimeout(() => setTonightCopied(null), 4000);
  };

  const openFridgeReport = () => {
    const html = buildFridgeReportHTML(db);
    const url  = URL.createObjectURL(new Blob([html], { type:"text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return (
    <div>
      <div style={S.body}>
        <div style={{ ...S.card, background:C.primary, color:"#E8F5EE" }}>
          <div style={{ fontSize:11, fontWeight:700, opacity:0.7, marginBottom:4, letterSpacing:"0.06em", textTransform:"uppercase" }}>Tonight · {dateLabel(todayISO)}</div>
          <div style={{ fontSize:22, fontWeight:600 }}>{todayMeal || "Not planned yet"}</div>
        </div>

        <div style={S.card}>
          <div style={S.sectionLabel}>Tomorrow · {dateLabel(tomorrowISO)}</div>
          <div style={{ fontSize:18, fontWeight:600, color:C.muted }}>{tomorrowMeal || "Not planned yet"}</div>
        </div>

        {!tonightPlan && (
          <div style={{ ...S.card, background:C.warningLight, border:`1px solid #F0D080` }}>
            <div style={{ fontSize:13, color:C.warning }}>No meal plan yet for today. Complete the Plan flow to set up your week.</div>
          </div>
        )}
      </div>

      {/* Semantic divider (SPEC-active-plan-app-wide.md Layer 3): everything
          above is real/now (date-anchored); everything below follows
          whichever week the selector shows. */}
      <WeekSelector db={db} persistDB={persistDB} />

      <div style={S.body}>
      <div style={S.card}>
        <div style={S.sectionLabel}>Meal schedule</div>
        {days.map((d,i) => {
          const m       = (planMeals[d]||[]).join(", ");
          const isToday = i===scheduleTodayIdx;
          return (
            <div key={d} style={{ display:"flex", padding:"9px 0", borderBottom:`1px solid ${C.border}`, gap:10 }}>
              <div style={{ fontSize:12, fontWeight:700, color:isToday?C.primary:C.faint, width:36 }}>{isExtraDay(d) ? "+" + daysFull[i].replace("Extra ", "").slice(0, 3) : d}</div>
              <div style={{ flex:1, fontSize:14, fontWeight:isToday?700:400, color:isToday?C.primary:C.text }}>{m||"—"}</div>
              {isToday && <div style={{ fontSize:11, color:C.accent, fontWeight:700 }}>today</div>}
            </div>
          );
        })}
      </div>

      <div style={S.card}>
        <div style={S.sectionLabel}>Fridge report</div>
        <div style={{ fontSize:12, color:C.faint, marginBottom:10 }}>A print-ready page of this week's dinners — leftovers, cascades, and notes included.</div>
        <button style={{ ...S.btn, ...S.btnP, marginBottom:0 }} onClick={openFridgeReport}>🖨️ Generate fridge report</button>
      </div>

      <div style={S.card}>
        <div style={S.sectionLabel}>Tell the family</div>
        <button style={{ ...S.btn, ...S.btnP, marginBottom:tonightCopied ? 8 : 0 }} onClick={sendTonight}>{tonightCopied ? "✓ Copied tonight's dinner" : "📋 Copy tonight's dinner"}</button>
        {tonightCopied && (
          <div>
            <div style={{ fontSize:12, color:C.verified, fontWeight:600, marginBottom:4 }}>✓ Copied — paste into Messages</div>
            <textarea readOnly value={tonightCopied} onFocus={e => e.target.select()} style={{ ...S.input, height:60, fontSize:12, resize:"none", marginBottom:0, fontFamily:"inherit" }} />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export { TonightTab };
