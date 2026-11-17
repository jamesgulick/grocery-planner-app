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
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
    }
  }
  downloadPayload(payload, db, persistDB);
  return "downloaded";
}
const withoutPurpose = ({ purpose, ...rest }) => rest;
