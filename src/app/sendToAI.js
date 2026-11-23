// Send to AI (brief §9; RULING 16, 2026-11-16). Every job uses one fixed prompt; what to do
// travels inside the file:
//   _meta.request = { purpose, instructions, ...details }   purpose: "calendar" | "recipe" |
//                                                            "enrich" | none (Data sheet)
//   _meta.vocab   = the app's controlled values (vocab.js)
// `instructions` is the user's own text from Settings › Instructions for AI for that job; the
// code never names a skill or a product. The calendar path also keeps writing
// _meta.syncInstructions (the export does) until the calendar skill reads _meta.request.
//
// At each send the device keeps ONE copy of the file it sent (overwritten each time), with
// the purpose and the file's exportedAt. The import check uses it to tell what the AI changed
// (sent copy → returned file) from what changed here since (sent copy → device now), and to
// judge the file's scope by the device's own record of the send, never by the file alone.
import { copyToClipboard } from "./clipboard.js";
import { showToast } from "../ui/toast.js";
import { buildBackupPayload, downloadPayload, exportFileName } from "./exportData.js";
import { KEY_SUFFIX } from "./globals.js";
import { exportVocab } from "./vocab.js";

export const SEND_PROMPT = "Follow the request in the _meta node of the attached grocery planner file and send back the whole file.";

const SENT_KEY = "grocery_sent" + KEY_SUFFIX;
// The request waiting for its file (brief §9 "Grab's return trip"): { purpose, at, job } — what
// was typed (recipe: name, link, text, role; enrich: meals). Kept apart from the sent copy so
// Home can read it cheaply. Cleared when a file is loaded or the Home bar is dismissed.
const PENDING_KEY = "grocery_pending" + KEY_SUFFIX;

export function loadPending() {
  try { const raw = localStorage.getItem(PENDING_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* nothing to clear */ }
}
function savePending(record) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(record)); } catch { /* the bar is a safety net only */ }
}

// AI round trips (standing rules, 11/23): each trip shows ① Send to AI › ② Re-import, and
// step 2 stays lit after a restart. The device keeps when each trip was sent, by key:
// "calendar", "recipe", "enrich:<meal id>". Any file loaded settles them all (as it settles
// the pending request). Surfaces listen for TRIPS_EVENT to stay in step with each other.
const TRIPS_KEY = "grocery_trips" + KEY_SUFFIX;
export const TRIPS_EVENT = "grocery-trips";
function loadTrips() {
  try { const raw = localStorage.getItem(TRIPS_KEY); return raw ? JSON.parse(raw) || {} : {}; } catch { return {}; }
}
function saveTrips(trips) {
  try { if (Object.keys(trips).length) localStorage.setItem(TRIPS_KEY, JSON.stringify(trips)); else localStorage.removeItem(TRIPS_KEY); } catch { /* the steps fall back to unsent */ }
  try { window.dispatchEvent(new Event(TRIPS_EVENT)); } catch { /* no window */ }
}
/** When the trip with this key was sent (ISO), or null. */
export function tripSentAt(key) { return loadTrips()[key] || null; }
/** A file was loaded: every trip is back to step 1. */
export function settleTrips() { if (Object.keys(loadTrips()).length) saveTrips({}); }
const tripKeys = job => !job ? [] : job.purpose === "enrich" ? (job.meals || []).map(id => `enrich:${id}`) : [job.purpose];
function markTrips(job, at) {
  const keys = tripKeys(job);
  if (keys.length) saveTrips({ ...loadTrips(), ...Object.fromEntries(keys.map(k => [k, at])) });
}

/** The last send from this device: { purpose, exportedAt, at, db, job } or null. */
export function loadSentCopy() {
  try { const raw = localStorage.getItem(SENT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveSentCopy(record) {
  try { localStorage.setItem(SENT_KEY, JSON.stringify(record)); } catch { /* storage full: the check falls back to timestamps */ }
}

/**
 * Send the file to an AI chat. `job` is { purpose, ...details } (recipe: link, text, name,
 * role; enrich: meals) or null for a plain send. Copies the prompt, keeps the sent copy, and
 * opens the share sheet with the file (or downloads it where sharing a file isn't possible).
 * Returns "shared" | "cancelled" | "downloaded". Call straight from a tap.
 */
export async function sendToAI(db, persistDB, job = null) {
  copyToClipboard(SEND_PROMPT);
  showToast("Prompt copied");   // the confirmation bar, as the share sheet opens (11/17)
  const request = job ? { purpose: job.purpose, instructions: db.settings?.aiInstructions?.[job.purpose] || "", ...withoutPurpose(job) } : null;
  const extraMeta = { ...(request ? { request } : {}), vocab: exportVocab() };
  const payload = buildBackupPayload(db, extraMeta);
  const { text, exportedAt } = payload;
  const at = new Date().toISOString();
  saveSentCopy({ purpose: request?.purpose || null, exportedAt, at, db, job: job ? withoutPurpose(job) : null });
  if (job?.purpose === "recipe" || job?.purpose === "enrich") savePending({ purpose: job.purpose, at, job: withoutPurpose(job) });
  const file = new File([text], exportFileName(), { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: SEND_PROMPT });
      markTrips(job, at);
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
    }
  }
  downloadPayload(payload, db, persistDB);
  markTrips(job, at);
  return "downloaded";
}
const withoutPurpose = ({ purpose, ...rest }) => rest;
