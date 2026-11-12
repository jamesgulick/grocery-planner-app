// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { useState } from "react";
import { C, S } from "../app/styles.js";

// ── Help / how it works ────────────────────────────────────────────────────────
// Compact in-app reference. Deliberately covers MECHANISM and CONSEQUENCES only —
// what a choice does and what follows from it. Design rationale lives in the
// external reference doc, so this stays short enough to keep accurate.

const HELP_SECTIONS = [
  { t:"What gets auto-suggested", body:[
    "Only meals with type **dinner**. Sides, remix, batch, and takeout are never suggested — you add them by hand.",
    "Also excluded: meals Partner dislikes on days she's home, involved meals on **easy** days, and grillable meals on days without a **grill** pill.",
    "Everything else stays possible. Weights only change how *likely* a meal is, never whether it can appear.",
  ]},
  { t:"Day pills", body:[
    "**easy** — excludes involved meals.",
    "**grill** — lets grillable meals appear (they're gated out otherwise) and boosts them.",
    "**special** — favors higher-effort and well-liked meals.",
    "Custom labels (e.g. \"Kid's bday\") are visual only — no effect on suggestions.",
    "Pills auto-fill once per plan from the effort map and forecast (grill = 70°F+ and ≤35% rain). After that your edits always win — removing a pill sticks.",
  ]},
  { t:"Why isn't a meal showing up?", body:[
    "It's not type **dinner** → only dinners auto-suggest.",
    "It's grillable but the day has no **grill** pill → grillables are gated to grill days.",
    "It's involved and the day is **easy** → involved meals are excluded there.",
    "Partner dislikes it and she's home that day.",
    "You had it recently → recent meals are heavily down-weighted (not banned).",
  ]},
  { t:"Meal attributes", body:[
    "**Day feel** (comfort / neutral / light) nudges toward comfort on cold days, light on hot. A soft lean, never a filter.",
    "**Grillable** is a hard gate — the meal only appears on grill days.",
    "**Likes** are a soft boost; **dislikes** (Partner) are a hard gate on days she's home.",
    "**Leftovers** means the meal *produces* extra. A meal *made from* leftovers is type **remix**.",
  ]},
  { t:"Meal list order", body:[
    "Picking a meal for a day: mains first and sides at the bottom, except when you're replacing a side. Each row says when you last had it (or that it's already planned).",
    "Sort by **longest since** (meals you haven't had in a while rise to the top) or **most recent**.",
    "Search matches tags too: type \"pasta\", \"meaty\" or \"soup\" to find meals tagged that way.",
  ]},
  { t:"Marking things you already have", body:[
    "**Inventory step**: checking an item marks it in-stock and drops it from the list. This is the reliable way.",
  ]},
  { t:"Weekly refresh", body:[
    "The forecast is fetched **live** (Open-Meteo) for the dates of the week you are planning, up to about two weeks ahead — nothing to refresh by hand.",
    "Day notes auto-fill from defaults when a plan starts, so a plan never begins blank.",
    "Calendar events come in by importing an updated DB export — edit the exported JSON, then import it back.",
  ]},
  { t:"Family messages & data", body:[
    "All comms buttons **copy** the message — iOS blocks app-launching links from in here. Paste into Messages yourself.",
    "**Start next week's plan** creates a separate next plan — it doesn't touch the current one. A plan auto-retires (its meals archived to history for the recency down-weight) once its week's start date passes, and the next plan then becomes current.",
    "Each plan's cart is independent — starting a next plan doesn't carry the cart over.",
    "Import accepts .json or .txt — it validates on content, not the file extension.",
  ]},
];

// Renders **bold** spans in the help body text.
const HelpText = ({ children }) => (
  <span>{String(children).split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} style={{ color:C.text }}>{part.slice(2,-2)}</strong>
      : <span key={i}>{part}</span>
  )}</span>
);

function ManageHelp() {
  const [open, setOpen] = useState(null);
  return (
    <div style={S.body}>
      <div style={S.card}>
        <div style={S.sectionLabel}>How it works</div>
        <div style={{ fontSize:13, color:C.muted, lineHeight:1.5 }}>
          What each choice does and what follows from it. Tap a topic to expand.
        </div>
      </div>
      <div style={S.cardFlat}>
        {HELP_SECTIONS.map((s, i) => {
          const isOpen = open === i;
          return (
            <div key={s.t} style={{ borderTop: i ? `1px solid ${C.border}` : "none" }}>
              <button style={{ width:"100%", background:"none", border:"none", padding:"12px 16px", textAlign:"left", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", fontSize:14, fontWeight:600, color:C.text }}
                onClick={() => setOpen(isOpen ? null : i)}>
                <span>{s.t}</span>
                <span style={{ color:C.faint, fontSize:16 }}>{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div style={{ padding:"0 16px 12px" }}>
                  {s.body.map((line, j) => (
                    <div key={j} style={{ fontSize:13, color:C.muted, lineHeight:1.55, marginBottom:8, paddingLeft:10, borderLeft:`2px solid ${C.border}` }}>
                      <HelpText>{line}</HelpText>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize:11, color:C.faint, textAlign:"center", padding:"4px 16px 20px" }}>
        A fuller reference (data model, exact weights, sync details) lives in grocery-app-reference.md
      </div>
    </div>
  );
}

export { ManageHelp };
