// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { KEY_SUFFIX, addDaysISO, todayLocalISO } from "./globals.js";

// ── Live weather ────────────────────────────────────────────────────────────────
// Replaces the old hand-baked WEEK_FORECAST with a live fetch from Open-Meteo
// (free, no API key, CORS-enabled — works from a plain browser fetch when the app
// is hosted on a normal origin). Coordinates are a config value; set them to the
// planning household's location. Inside a restricted sandbox the fetch may be
// blocked and resolve to {} — every consumer treats a missing day as neutral, so
// nothing breaks; it simply shows no live data until hosted.
const FORECAST_LAT = 39.44843;            // configure for your location (default: generic US point)
const FORECAST_LON = -75.71768;
const FORECAST_CACHE_KEY = "grocery_forecast_cache" + KEY_SUFFIX;
const FORECAST_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// The forecast is fetched for the PLAN's own dates, keyed by ISO date, so the
// week being planned gets its weather whether it is this week or next. Open-Meteo
// forecasts today + 15 days and serves recent past days too; dates outside that
// window are left out (no forecast = neutral, same as offline).
const FORECAST_AHEAD_DAYS = 15;
const FORECAST_BACK_DAYS  = 7;

const iconForPop = pop => pop >= 50 ? "⛈️" : pop >= 20 ? "🌤️" : "☀️";

// Cache: { "start|end": { fetchedAt, forecast } }, expired ranges pruned on write.
function readForecastCache(range) {
  try {
    const hit = JSON.parse(localStorage.getItem(FORECAST_CACHE_KEY) || "{}")[range];
    if (!hit || Date.now() - hit.fetchedAt > FORECAST_CACHE_TTL_MS) return null;
    return hit.forecast;
  } catch { return null; }
}
function writeForecastCache(range, forecast) {
  try {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(FORECAST_CACHE_KEY) || "{}"); } catch {}
    if (!all || typeof all !== "object" || "weekStart" in all) all = {}; // old single-week shape
    for (const k of Object.keys(all)) if (Date.now() - (all[k]?.fetchedAt || 0) > FORECAST_CACHE_TTL_MS) delete all[k];
    all[range] = { fetchedAt: Date.now(), forecast };
    localStorage.setItem(FORECAST_CACHE_KEY, JSON.stringify(all));
  } catch {}
}

// Fetches the live forecast for the given ISO dates. Returns { iso: { hi, pop, icon } }
// for the dates the API covers, or {} on any failure (offline, blocked, API hiccup) —
// callers treat missing dates as neutral, so {} is safe, not an error.
async function fetchLiveForecast(dates) {
  const today = todayLocalISO();
  const lo = addDaysISO(today, -FORECAST_BACK_DAYS), hi = addDaysISO(today, FORECAST_AHEAD_DAYS);
  const want = [...new Set((dates || []).filter(d => d && d >= lo && d <= hi))].sort();
  if (!want.length) return {};
  const start = want[0], end = want[want.length - 1], range = `${start}|${end}`;
  const cached = readForecastCache(range);
  if (cached) return cached;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${FORECAST_LAT}&longitude=${FORECAST_LON}&daily=temperature_2m_max,precipitation_probability_max&temperature_unit=fahrenheit&timezone=America%2FNew_York&start_date=${start}&end_date=${end}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return {};
    const data = await res.json();
    const days = data?.daily?.time || [];
    const highs = data?.daily?.temperature_2m_max || [];
    const pops  = data?.daily?.precipitation_probability_max || [];
    const forecast = {};
    days.forEach((iso, i) => {
      if (!want.includes(iso) || highs[i] == null) return;
      const pop = Math.round(pops[i] ?? 0);
      forecast[iso] = { hi: Math.round(highs[i]), pop, icon: iconForPop(pop) };
    });
    writeForecastCache(range, forecast);
    return forecast;
  } catch { return {}; }
}

// Per-day calendar notes for the planning week. Placeholder content — replace with
// your own, or wire up to a calendar source. Module-level so the planner and
// new-week setup can read it.
const defaultNotes = { Tue:"Grocery pickup", Wed:"", Thu:"", Fri:"", Sat:"", Sun:"", Mon:"" };

// True if dayNotes still looks like a fresh, never-updated plan: either it
// still matches the seeded defaultNotes, or it's all empty (e.g. cleared).
// Either way the calendar update hasn't been run for this plan yet.
function notesLookUnupdated(dayNotes) {
  const notes = dayNotes || {};
  const keys = Object.keys(defaultNotes);
  const matchesDefault = keys.every(k => (notes[k] || "") === (defaultNotes[k] || ""));
  const allEmpty = keys.every(k => !(notes[k] || "").trim());
  return matchesDefault || allEmpty;
}

export { defaultNotes, fetchLiveForecast, notesLookUnupdated };
