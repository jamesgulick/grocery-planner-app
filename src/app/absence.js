// How absences read on day headers (Decisions 11/16 "How absences show"), shared by the Week
// step, the week view and Home:
//   - one night out: "Kid 1 out";
//   - out 2+ nights in a row: named once, on the stretch's first day, "Kid 3 out Sun–Tue";
//     if the list starts partway through, the first visible day says "Kid 3 out until Tue";
//     the days in between say nothing about that person;
//   - open-ended away (Away dates with no Until): named on its start day only, "Kid 3 out
//     from Sun", then silent.
// Pure. `days` is the visible list [{ key, iso }] in order; `isOut(name, key, iso)` resolves a
// night (presence overrides, then Away dates); `ranges` are settings.awayRanges.
import { addDaysISO } from "./globals.js";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const wd = iso => WD[new Date(iso + "T12:00:00").getDay()];

export function absenceLines(days, roster, isOut, ranges = []) {
  const out = Object.fromEntries(days.map(d => [d.key, []]));
  for (const name of roster) {
    const openRange = ranges.find(r => r.name === name && r.from && !r.to);
    let i = 0;
    while (i < days.length) {
      if (!isOut(name, days[i].key, days[i].iso)) { i++; continue; }
      let j = i;
      while (j + 1 < days.length && isOut(name, days[j + 1].key, days[j + 1].iso)) j++;
      const first = days[i], last = days[j];
      if (openRange && last.iso >= openRange.from) {
        // open-ended: only its start day speaks (a night out just before it still reads "out")
        const start = days.slice(i, j + 1).find(d => d.iso === openRange.from);
        if (start) out[start.key].push(`${name} out from ${wd(openRange.from)}`);
        else if (first.iso < openRange.from) out[first.key].push(`${name} out`);
      } else if (i === j) {
        out[first.key].push(`${name} out`);
      } else {
        const startedBefore = i === 0 && (ranges.some(r => r.name === name && (!r.from || r.from < first.iso) && (!r.to || r.to >= first.iso))
          && isOut(name, null, addDaysISO(first.iso, -1)));
        out[first.key].push(startedBefore ? `${name} out until ${wd(last.iso)}` : `${name} out ${wd(first.iso)}–${wd(last.iso)}`);
      }
      i = j + 1;
    }
  }
  return out;
}
