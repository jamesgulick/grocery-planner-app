// The day details sheet (brief §7 "Day details sheet", 11/24): one day's note, labels, who's
// home and time in a tall sheet, opened from a Meals day bar or stacked on the meals sheet by
// its Edit link. The Week step's own controls on the same plan data, so a change here shows on
// Calendar / Who's home / Time and back. Every change saves as it's made; it never re-picks
// meals (the Week check flags any conflict). A locked past day opens it read-only (11/24).
import { absenceLines } from "../app/absence.js";
import { seedTimeLevel } from "../engine/assembleInputs.js";
import { Clocks, Section, Segmented, Sheet } from "../ui/kit.jsx";
import { Labels, NoteField, TIME_OPTIONS, WhoChips, forecastWords, setVisiblePills, visiblePillsOf, whoModel } from "./WeekStep.jsx";

const LONG_WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DaySheet({ day, days, dates, family, ranges, forecast, dayNotes, setDayNotes, dayPills, setDayPills, presence, setPresence, timeLevels, setTimeLevels, readOnly, onClose }) {
  const iso = dates[day];
  const d = new Date(iso + "T12:00:00");
  const who = whoModel({ presence, setPresence, ranges, dates });
  // An away stretch is named after the label ("Who's home · Kid 3 out Sun–Tue"): the line the
  // week's headers give on the stretch's first day, found by walking back from this day.
  const lines = absenceLines(days.map(k => ({ key: k, iso: dates[k] })), family, who.isOut, ranges);
  const at = days.indexOf(day);
  const stretches = family.flatMap(name => {
    if (!who.isOut(name, day, iso)) return [];
    let s = at;
    while (s > 0 && who.isOut(name, days[s - 1], dates[days[s - 1]])) s--;
    return lines[days[s]].filter(l => l.startsWith(`${name} out `));
  });
  const level = timeLevels?.[day] || seedTimeLevel(SHORT_WD[d.getDay()]);
  const wx = forecastWords(forecast?.[iso]);
  return (
    <Sheet tall title={`${LONG_WD[d.getDay()]} ${d.getDate()}`} sub={wx ? <span className="day-sheet-wx">{wx}</span> : null} onClose={onClose}>
      <div className="day-sheet">
        <Section label="Note">
          <div className={readOnly ? "day-sheet-card" : "day-sheet-card is-note"}>{readOnly
            ? <div className={(dayNotes?.[day] || "").trim() ? "day-sheet-note" : "day-sheet-note day-sheet-none"}>{(dayNotes?.[day] || "").trim() || "—"}</div>
            : <NoteField value={dayNotes?.[day]} onSave={t => setDayNotes(prev => ({ ...prev, [day]: t }))} />}</div>
        </Section>
        <Section label="Labels">
          <div className="day-sheet-card"><Labels readOnly={readOnly} pills={visiblePillsOf(dayPills, day)} onChange={ps => setVisiblePills(setDayPills, day, ps)} /></div>
        </Section>
        <Section label={["Who's home", ...stretches].join(" · ")}>
          <fieldset className="day-sheet-card day-sheet-fields" disabled={readOnly}><WhoChips day={day} iso={iso} family={family} who={who} /></fieldset>
        </Section>
        <Section label="Time">
          <fieldset className="day-sheet-card day-sheet-fields" disabled={readOnly}><Segmented label="Time" value={level} onChange={v => setTimeLevels(prev => ({ ...prev, [day]: v }))}
            options={TIME_OPTIONS.map(o => ({ value: o.value, label: <span className="wk-time"><Clocks n={o.n} />{o.label}</span> }))} /></fieldset>
        </Section>
      </div>
    </Sheet>
  );
}
