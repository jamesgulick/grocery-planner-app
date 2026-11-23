// Calendar sync (canvas boards "Plan, week: calendar" and "Round 14 — calendar sync: return
// trip from the clipboard"; decided 11/14–16). One row, no section heading (11/16: a group
// with one row gets none): "Calendar sync" with the status as its subline ("Last Nov 14",
// "Prompt copied", "No file copied"; never empty: "Not synced yet" before the first), then
// [Send to AI] › [Re-import]. The same row sits on the plan's Welcome step (phase 1's
// stand-in for the Calendar step) and in the Data sheet.
// - Send to AI shares the export with the fixed prompt and the calendar request (sendToAI.js).
// - Re-import reads the file the AI sent back from the clipboard (copied in the chat) and
//   opens the one import check. Loading it re-exports this device's data as the backup
//   (grocery_db.json, like Back up), so every sync leaves a copy on the phone.
// - Nothing usable on the clipboard: "No file copied", and the second pill becomes
//   [Choose file] (on iOS the picker needs its own tap) until a load or a cancel. A file
//   picked there is on the phone already, so loading it counts as the backup.
// "Last" is the last sync loaded (db.lastSyncAt, app-only).
// 11/23 (standing rules "AI round trips", board "Data sheet"): the title on the left, the status
// on the right ("Last Nov 14", or "Sent 10:31am" once sent), and the two numbered steps under
// it. The sent state is kept on the device, so step 2 is still lit after a restart. `inCard`:
// the row sits inside a card of rows (the Data sheet) instead of being its own card.
import { useEffect, useRef, useState } from "react";
import { prepareImport, readFileText } from "../app/dataIO.js";
import { downloadBackup } from "../app/exportData.js";
import { sendToAI } from "../app/sendToAI.js";
import { ImportCheck } from "./ImportCheck.jsx";
import { StepChevron, StepPill, sentLabel, stepStates, useTrip } from "./AiSteps.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = iso => { const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

// The clipboard's text, or "" when there is none or the read is refused.
export async function clipboardText() {
  try {
    if (navigator.clipboard?.read) {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t === "text/plain") || item.types.find(t => t.startsWith("text/"));
        if (type) return await (await item.getType(type)).text();
      }
      return "";
    }
    return (await navigator.clipboard?.readText?.()) || "";
  } catch { return ""; }
}

// A planner file from text: { prepared } (prepared is null when the preview guard was
// declined), or null when the text isn't one.
export function planFile(text) {
  try { return { prepared: prepareImport(JSON.parse(text)) }; }
  catch { return null; }
}

export function SyncRow({ db, persistDB, inCard = false }) {
  const sentAt = useTrip("calendar");
  const [noFile, setNoFile]   = useState(false);
  const [pending, setPending] = useState(null); // { prepared, fromClipboard }
  const [error, setError]     = useState("");
  const fileRef = useRef(null);

  // A cancelled picker puts [Re-import] back (React has no onCancel for inputs).
  useEffect(() => {
    const el = fileRef.current;
    const reset = () => setNoFile(false);
    el?.addEventListener("cancel", reset);
    return () => el?.removeEventListener("cancel", reset);
  }, []);

  const send = async () => {
    setNoFile(false); setError("");
    await sendToAI(db, persistDB, { purpose: "calendar" });
  };

  const fromClipboard = async () => {
    setError("");
    const text = await clipboardText();
    const file = text ? planFile(text) : null;
    if (!file) { setNoFile(true); return; }
    if (file.prepared) setPending({ prepared: file.prepared, fromClipboard: true });
  };

  const fromFile = async f => {
    setError("");
    try {
      const prepared = prepareImport(JSON.parse(await readFileText(f)));
      if (prepared) setPending({ prepared, fromClipboard: false });
      else setNoFile(false);
    } catch (e) { setNoFile(false); setError(`Couldn't import that file: ${e.message}`); }
  };

  const load = () => {
    const now = new Date().toISOString();
    const next = { ...pending.prepared.db, lastSyncAt: now };
    if (pending.fromClipboard) downloadBackup(next, persistDB);            // saves the copy, stamps lastExportedAt
    else persistDB({ ...next, lastExportedAt: now }, { background: true }); // the picked file is the copy
    setPending(null); setNoFile(false);
  };

  const [s1, s2] = stepStates(sentAt);
  const status = noFile ? "No file copied" : sentAt ? sentLabel(sentAt) : db.lastSyncAt ? `Last ${shortDate(db.lastSyncAt)}` : "Not synced yet";

  return (
    <div className="sync-wrap">
      <div className={inCard ? "trip" : "trip trip-card"}>
        <div className="trip-head"><span className="trip-title">Calendar sync</span><span className="trip-status">{status}</span></div>
        <div className="trip-steps">
          <StepPill n={1} state={s1} onClick={send}>Send to AI</StepPill>
          <StepChevron />
          {noFile
            ? <StepPill n={2} state={s2} onClick={() => fileRef.current?.click()}>Choose file</StepPill>
            : <StepPill n={2} state={s2} onClick={fromClipboard}>Re-import</StepPill>}
        </div>
        <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain,text/*" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) fromFile(f); else setNoFile(false); }} />
      </div>
      {error && <div className="ui-problem">{error}</div>}
      {pending && (
        <ImportCheck device={db} prepared={pending.prepared} fromClipboard={pending.fromClipboard}
          onLoad={load} onCancel={() => { setPending(null); setNoFile(false); }} />
      )}
    </div>
  );
}
