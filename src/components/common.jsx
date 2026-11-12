// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { useEffect, useRef } from "react";
import { todayLocalISO, weekLabel } from "../app/globals.js";
import { C, S } from "../app/styles.js";
import { notesLookUnupdated } from "../app/weather.js";

// Nudges the owner to run the calendar update when the active plan's day
// notes still look untouched. Hidden once the notes have been customized or
// imported. Text-only, no mechanism.
function RefreshReminder({ compact, dayNotes }) {
  if (!notesLookUnupdated(dayNotes)) return null;
  return (
    <div style={{
      fontSize:12, lineHeight:1.4, borderRadius:8, padding:compact?"7px 10px":"9px 12px",
      marginBottom:10,
      background: C.warningLight,
      color:      C.warning,
      border:     `1px solid ${C.warning}`,
      fontWeight: 600,
    }}>
      Notes match default: consider refreshing calendar data.
    </div>
  );
}

// ── Shared micro-components ────────────────────────────────────────────────────

function Toggle({ value, onChange }) {
  return (
    <button style={S.toggle(value)} onClick={() => onChange(!value)}>
      <div style={S.toggleDot(value)} />
    </button>
  );
}

function SearchBar({ value, onChange, placeholder }) {
  return (
    <div style={{ display:"flex", alignItems:"center", background:C.surface, borderRadius:12, padding:"10px 14px", marginBottom:10, border:`1.5px solid ${C.border}`, gap:8 }}>
      <span style={{ color:C.faint }}>🔍</span>
      <input style={{ flex:1, border:"none", outline:"none", fontSize:15, background:"transparent", color:C.text }} placeholder={placeholder||"Search..."} value={value} onChange={e => onChange(e.target.value)} />
      {value && <button onClick={() => onChange("")} style={{ background:"none", border:"none", color:C.faint, cursor:"pointer" }}>✕</button>}
    </div>
  );
}

function FieldGroup({ label, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

function PillSelect({ options, value, onChange }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>
      {options.map(o => <button key={o} style={S.pill(value===o)} onClick={() => onChange(o)}>{o}</button>)}
    </div>
  );
}

// ── WEEK SELECTOR ────────────────────────────────────────────────────────────
// Reusable "Week of XX/XX" label + current/next switcher (SPEC-active-plan-
// app-wide.md). This band IS the safety mechanism for db.activePlan's
// stickiness: since the active week persists across tabs/sessions until the
// owner changes it, this label is what keeps that stickiness from silently
// misleading. Render it at the top of every week-scoped surface (Plan,
// Tonight's MEAL SCHEDULE) so which week is on screen is always visible.
// Renders whenever a current plan exists, even with no next plan to switch
// to — the "Week of XX/XX" label is a load-bearing orientation cue (most
// needed right after a rollover, when next has just gone null) and must stay
// visible on its own, not only when there's a second week to pick between.
function WeekSelector({ db, persistDB }) {
  if (!db.plans?.current && !db.plans?.next) return null;
  const hasNext    = !!db.plans?.next;
  const activeKey  = hasNext ? (db.activePlan || "current") : "current";
  const activePlan = db.plans[activeKey];
  const today      = todayLocalISO();
  const pastDated  = activePlan?.weekStartDate && activePlan.weekStartDate < today;
  const keys       = hasNext ? ["current","next"] : ["current"];
  return (
    <div>
      <div style={{ display:"flex", gap:6, padding:"10px 12px", background:C.primary }}>
        {keys.map(k => (
          <button key={k} onClick={() => hasNext && k !== activeKey && persistDB({ ...db, activePlan:k })}
            style={{ flex:1, padding:"8px 10px", borderRadius:8, border:"none", fontWeight:700, fontSize:12, cursor: hasNext ? "pointer" : "default",
              background: activeKey===k ? C.accent : "rgba(255,255,255,0.14)",
              color: activeKey===k ? "#fff" : "#B8E8CA" }}>
            <div>{k==="current" ? "Current week" : "Next week"}</div>
            <div style={{ fontWeight:500, opacity:0.85, fontSize:11 }}>{weekLabel(db.plans[k]?.weekStartDate)}</div>
          </button>
        ))}
      </div>
      {pastDated && (
        <div style={{ padding:"6px 12px", background:C.warningLight, fontSize:11.5, color:C.warning, textAlign:"center" }}>
          ⚠ This week's start date has passed — it may roll forward on reload.
        </div>
      )}
    </div>
  );
}

// Auto-growing textarea with a STABLE ref. Defined at module level so its ref
// callback identity never changes between renders — an inline `ref={el => ...}`
// makes React detach/re-attach the element every render, which steals focus after
// each keystroke (the day-notes "one letter at a time" bug).
function AutoGrowTextarea({ value, onChange, placeholder, style }) {
  const ref = useRef(null);
  const fit = el => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } };
  // Resize when the value changes from outside (e.g. reset-notes), not on keystroke.
  useEffect(() => { fit(ref.current); }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      style={style}
      placeholder={placeholder}
      value={value}
      onChange={e => { fit(e.target); onChange(e.target.value); }}
    />
  );
}

// The one selection control (polish Phase 1b): checked = buying / keep. A real
// checkbox-role button with a 44px tap target around the 24px box. Stops the click
// so a row that is itself tappable doesn't toggle twice.
function Check({ checked, onChange, label }) {
  return (
    <button type="button" role="checkbox" aria-checked={!!checked} aria-label={label}
      onClick={e => { e.stopPropagation(); onChange(!checked); }}
      style={{ background:"none", border:"none", padding:10, margin:-10, cursor:"pointer", display:"flex", flexShrink:0 }}>
      <span style={S.checkBox(!!checked)}>{checked && "✓"}</span>
    </button>
  );
}

export { AutoGrowTextarea, Check, FieldGroup, PillSelect, RefreshReminder, SearchBar, Toggle, WeekSelector };
