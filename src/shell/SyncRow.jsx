// Calendar sync (canvas boards "Plan, week: calendar" and "Round 14 — calendar sync: return
// trip from the clipboard"; decided 11/14–15). The section label "Calendar sync" over one
// white card: the status ("Last 11/14", "Prompt copied", "No file copied"), then
// [Send to AI] › [Re-import]. The same row sits on the plan's Welcome step (phase 1's
// stand-in for the Calendar step) and in the Data sheet.
// - Send to AI shares the export with the fixed prompt (sendToClaude.js).
// - Re-import reads the file the AI sent back from the clipboard (copied in the chat) and
//   opens the one import check. Loading it re-exports this device's data as the backup
//   (grocery_db.json, like Back up), so every sync leaves a copy on the phone.
// - Nothing usable on the clipboard: "No file copied", and the second pill becomes
//   [Choose file] (on iOS the picker needs its own tap) until a load or a cancel. A file
//   picked there is on the phone already, so loading it counts as the backup.
// "Last" is the last sync loaded (db.lastSyncAt, app-only).
import { useEffect, useRef, useState } from "react";
import { prepareImport, readFileText } from "../app/dataIO.js";
import { downloadBackup } from "../app/exportData.js";
import { sendToClaude } from "../app/sendToClaude.js";
import { Section } from "../ui/kit.jsx";
import { ImportCheck } from "./ImportCheck.jsx";

const shortDate = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

// The clipboard's text, or "" when there is none or the read is refused.
async function clipboardText() {
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
function planFile(text) {
  try { return { prepared: prepareImport(JSON.parse(text)) }; }
  catch { return null; }
}

export function SyncRow({ db, persistDB }) {
  const [sent, setSent]       = useState(false);
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
    setSent((await sendToClaude(db, persistDB)) !== "cancelled");
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
    setPending(null); setSent(false); setNoFile(false);
  };

  const status = noFile ? "No file copied" : sent ? "Prompt copied" : db.lastSyncAt ? `Last ${shortDate(db.lastSyncAt)}` : "";

  return (
    <Section label="Calendar sync">
      <div className="sync">
        <span className="sync-status">{status}</span>
        <button type="button" className="sync-pill" onClick={send}>Send to AI</button>
        <span className="sync-chev" aria-hidden="true">›</span>
        {noFile
          ? <button type="button" className="sync-pill" onClick={() => fileRef.current?.click()}>Choose file</button>
          : <button type="button" className="sync-pill" onClick={fromClipboard}>Re-import</button>}
        <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain,text/*" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) fromFile(f); else setNoFile(false); }} />
      </div>
      {error && <div className="ui-problem">{error}</div>}
      {pending && (
        <ImportCheck device={db} prepared={pending.prepared} fromClipboard={pending.fromClipboard}
          onLoad={load} onCancel={() => { setPending(null); setNoFile(false); }} />
      )}
    </Section>
  );
}
