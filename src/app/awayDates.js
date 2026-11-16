// Away dates (board "Away dates", Round 20; decided 11/16). Pure helpers for the list and
// the load-time tidy. A stretch is { id, name, from, to }: ISO dates; `to` null = open-ended.
// Older data may have a blank `from` ("Until <date>"); new stretches always have one.
import { addDaysISO } from "./globals.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = iso => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d }; };
const md = iso => { const { m, d } = parts(iso); return `${MONTHS[m - 1]} ${d}`; };

// Ended stretches drop off two weeks after they end (decided 11/16): who was home is worked
// out live, and only rating and the Last week tab look back, both within about 2 weeks.
export const AWAY_KEEP_ENDED_DAYS = 14;

export const isEnded = (r, today) => !!r.to && r.to < today;

/** "Nov 22 – 24", "Nov 29 – Dec 2", "From Jan 18 · open-ended", "Until Dec 3", "Open-ended". */
export function stretchDates(r, today) {
  let s;
  if (r.from && r.to) {
    const a = parts(r.from), b = parts(r.to);
    s = r.from === r.to ? md(r.from)
      : a.y === b.y && a.m === b.m ? `${md(r.from)} – ${b.d}` : `${md(r.from)} – ${md(r.to)}`;
  } else if (r.from) s = `From ${md(r.from)} · open-ended`;
  else if (r.to) s = `Until ${md(r.to)}`;
  else s = "Open-ended";
  return isEnded(r, today) ? `${s} · ended` : s;
}

/** Current and upcoming first, by start date (a blank start counts as earliest); then ended. */
export function sortStretches(ranges, today) {
  const key = r => r.from || "";
  const live = ranges.filter(r => !isEnded(r, today)).sort((a, b) => key(a).localeCompare(key(b)) || a.name.localeCompare(b.name));
  const ended = ranges.filter(r => isEnded(r, today)).sort((a, b) => b.to.localeCompare(a.to));
  return [...live, ...ended];
}

export const upcomingCount = (ranges, today) => ranges.filter(r => !isEnded(r, today)).length;

/** The ranges without those that ended more than AWAY_KEEP_ENDED_DAYS ago (same array if none). */
export function pruneEnded(ranges, today) {
  const cutoff = addDaysISO(today, -AWAY_KEEP_ENDED_DAYS);
  const kept = (ranges || []).filter(r => !r.to || r.to >= cutoff);
  return kept.length === (ranges || []).length ? ranges : kept;
}
