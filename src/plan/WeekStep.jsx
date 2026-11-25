// The Week step (phase 2, spec SPEC-plan-flow-v2 §3; boards "Plan, week: calendar", "Week 2/3
// Who's home", "Plan, week: time"; Decisions 11/12–11/16). Three sub-steps, each building on
// the last; the segmented control for them lives in the frame's header.
//   Calendar:   the Calendar sync row, then every day: day + forecast, the note (edited in
//               place, wraps in full), labels with "+ label".
//   Who's home: notes read-only, then a chip per person (option D, 11/16): home = green; out
//               this night = solid grey outline, struck; out from Away dates = dashed grey,
//               struck; home despite Away dates = green with a dashed edge. A tap sets that
//               night only.
//   Time:       "Try something new", then per day Little · Some · Lots with the clocks.
// The app never writes notes on its own (spec §3.2, decided 11/16).
import { useEffect, useRef, useState } from "react";
import { inAwayRange } from "../engine/assembleInputs.js";
import { absenceLines } from "../app/absence.js";
import { fetchLiveForecast } from "../app/weather.js";
import { SyncRow } from "../shell/SyncRow.jsx";
import { Clocks, Group, Row, Segmented, Switch } from "../ui/kit.jsx";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayTitle = iso => { const d = new Date(iso + "T12:00:00"); return `${WD[d.getDay()]} ${d.getDate()}`; };
// The day's high, plus the chance of precipitation by type when it's above zero (11/24):
// "58°", "52° · 20% rain", "33° · 60% snow". No forecast, nothing.
export const forecastWords = fc => (!fc ? null : fc.pop > 0 ? `${fc.hi}° · ${fc.pop}% ${fc.kind || "rain"}` : `${fc.hi}°`);
export const TIME_OPTIONS = [
  { value: "none", label: "Little", n: 1 }, { value: "some", label: "Some", n: 2 }, { value: "much", label: "Lots", n: 3 },
];
const TIME_N = Object.fromEntries(TIME_OPTIONS.map(o => [o.value, o.n]));

// A day note, edited in place; saved when you leave the field.
function NoteField({ value, onSave }) {
  const [text, setText] = useState(value || "");
  const ref = useRef(null);
  useEffect(() => { setText(value || ""); }, [value]);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }, [text]);
  return (
    <textarea ref={ref} rows={1} className="wk-note" aria-label="Note" placeholder="Add a note" value={text}
      onChange={e => setText(e.target.value)} onBlur={() => { if (text !== (value || "")) onSave(text); }} />
  );
}

function Labels({ pills, onChange }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const add = () => { const l = text.trim(); if (l && !pills.some(p => p.label === l)) onChange([...pills, { label: l, source: "manual" }]); setText(""); setAdding(false); };
  return (
    <div className="wk-labels">
      {pills.map(p => (
        <span key={p.label} className="wk-label">{p.label}
          <button type="button" aria-label={`Remove ${p.label}`} onClick={() => onChange(pills.filter(x => x.label !== p.label))}>×</button>
        </span>
      ))}
      {adding
        ? <input autoFocus className="wk-label-input" aria-label="Label" value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") add(); if (e.key === "Escape") { setText(""); setAdding(false); } }} onBlur={add} />
        : <button type="button" className="wk-label-add" onClick={() => setAdding(true)}>+ label</button>}
    </div>
  );
}

export function WeekStep({ sub, db, persistDB, days, dates, dayNotes, setDayNotes, dayPills, setDayPills, presence, setPresence, timeLevels, setTimeLevels, adventurous, setAdventurous }) {
  const family = (db.settings?.familyContacts || []).map(f => f.name);
  const ranges = db.settings?.awayRanges || [];
  const [forecast, setForecast] = useState({});
  const datesKey = days.map(d => dates[d]).join(",");
  useEffect(() => { let off = false; fetchLiveForecast(days.map(d => dates[d])).then(f => { if (!off) setForecast(f); }); return () => { off = true; }; }, [datesKey]);

  // Who's home: an override for that night, else Away dates.
  const override = (day, name) => presence?.[day]?.[name];
  const away = (name, iso) => inAwayRange(ranges, name, iso);
  const isOut = (name, day, iso) => { const o = day ? override(day, name) : undefined; return typeof o === "boolean" ? !o : away(name, iso); };
  const toggle = (day, name) => {
    const iso = dates[day], o = override(day, name), byAway = away(name, iso);
    const home = typeof o === "boolean" ? o : !byAway;
    const want = !home;
    // Setting a night back to what Away dates say removes the override.
    const next = { ...(presence || {}) }, dayMap = { ...(next[day] || {}) };
    if (want === !byAway) delete dayMap[name]; else dayMap[name] = want;
    if (Object.keys(dayMap).length) next[day] = dayMap; else delete next[day];
    setPresence(next);
  };
  const lines = absenceLines(days.map(d => ({ key: d, iso: dates[d] })), family, isOut, ranges);
  const outs = day => lines[day].map(l => <span key={l} className="day-out">{l}</span>);
  const visiblePills = day => (dayPills?.[day] || []).filter(p => p.label !== "grill");

  if (sub === 0) return (
    <div className="wk">
      <SyncRow db={db} persistDB={persistDB} />
      <Group>
        {days.map(day => (
          <div key={day} className="wk-day">
            <div className="wk-day-head day-line"><span className="day-dow">{dayTitle(dates[day])}</span>{forecastWords(forecast[dates[day]]) && <span className="day-wx">{forecastWords(forecast[dates[day]])}</span>}</div>
            <NoteField value={dayNotes?.[day]} onSave={t => setDayNotes(prev => ({ ...prev, [day]: t }))} />
            <Labels pills={visiblePills(day)} onChange={ps => setDayPills(prev => ({ ...prev, [day]: [...(prev?.[day] || []).filter(p => p.label === "grill"), ...ps] }))} />
          </div>
        ))}
      </Group>
    </div>
  );

  if (sub === 1) return (
    <div className="wk">
      <Group>
        {days.map(day => (
          <div key={day} className="wk-day">
            <div className="wk-day-head day-line"><span className="day-dow">{dayTitle(dates[day])}</span>{outs(day)}</div>
            {(dayNotes?.[day] || "").trim() && <div className="wk-note-read">{dayNotes[day]}</div>}
            <div className="wk-chips">
              {family.map(name => {
                const o = override(day, name), byAway = away(name, dates[day]);
                const home = typeof o === "boolean" ? o : !byAway;
                const cls = home ? (byAway ? "wk-chip is-home is-despite" : "wk-chip is-home") : (byAway && typeof o !== "boolean" ? "wk-chip is-out is-away" : "wk-chip is-out");
                return <button key={name} type="button" className={cls} aria-pressed={home} onClick={() => toggle(day, name)}>{name}</button>;
              })}
            </div>
          </div>
        ))}
      </Group>
    </div>
  );

  return (
    <div className="wk">
      <Group><Row title="Try something new" trailing={<Switch checked={!!adventurous} onChange={setAdventurous} label="Try something new" />} /></Group>
      <Group>
        {days.map(day => (
          <div key={day} className="wk-day">
            <div className="wk-day-head day-line">
              <span className="day-dow">{dayTitle(dates[day])}</span>
              {TIME_N[timeLevels?.[day]] && <Clocks n={TIME_N[timeLevels[day]]} />}
              {outs(day)}
            </div>
            {(dayNotes?.[day] || "").trim() && <div className="wk-note-read">{dayNotes[day]}</div>}
            <Segmented label="Time" value={timeLevels?.[day]} onChange={v => setTimeLevels(prev => ({ ...prev, [day]: v }))}
              options={TIME_OPTIONS.map(o => ({ value: o.value, label: <span className="wk-time"><Clocks n={o.n} />{o.label}</span> }))} />
          </div>
        ))}
      </Group>
    </div>
  );
}
