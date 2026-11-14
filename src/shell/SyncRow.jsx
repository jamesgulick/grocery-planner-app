// Calendar sync row (canvas board "Plan, week: calendar"; decided 11/14): one white card,
// "Sync · last 11/10" then two outlined pills, [Send to Claude] › [Re-import]. The same row
// sits on the plan's Welcome step (phase 1's stand-in for the Calendar step) and in the
// Data sheet. Send to Claude shares the export with the fixed prompt; Re-import reads the
// file Claude sent back and opens the one import check before anything is replaced.
// "last" is the last Re-import that was loaded (db.lastSyncAt, app-only). Loading a
// Re-import also stamps the backup time: the file came from this phone (decided 11/14).
import { useRef, useState } from "react";
import { prepareImport, readFileText } from "../app/dataIO.js";
import { sendToClaude } from "../app/sendToClaude.js";
import { ImportCheck } from "./ImportCheck.jsx";

const shortDate = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

export function SyncRow({ db, persistDB }) {
  const [sent, setSent]       = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError]     = useState("");
  const fileRef = useRef(null);

  const reimport = async file => {
    setError("");
    try {
      const prepared = prepareImport(JSON.parse(await readFileText(file)));
      if (prepared) setPending(prepared);
    } catch (e) { setError(`Couldn't import that file: ${e.message}`); }
  };

  const status = sent === "shared" ? "prompt copied"
    : sent === "downloaded" ? "prompt copied · file downloaded"
    : db.lastSyncAt ? `last ${shortDate(db.lastSyncAt)}` : "";

  return (
    <>
      <section className="sync" aria-label="Calendar sync">
        <span className="sync-label">Sync{status && <span className="sync-status"> · {status}</span>}</span>
        <button type="button" className="sync-pill" onClick={async () => setSent(await sendToClaude(db, persistDB))}>Send to Claude</button>
        <span className="sync-chev" aria-hidden="true">›</span>
        <button type="button" className="sync-pill" onClick={() => fileRef.current?.click()}>Re-import</button>
        <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain,text/*" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) reimport(f); }} />
      </section>
      {error && <div className="ui-problem">{error}</div>}
      {pending && (
        <ImportCheck device={db} prepared={pending}
          onLoad={() => {
            // The file just picked is now a copy of this device: the sync counts as a backup.
            const now = new Date().toISOString();
            persistDB({ ...pending.db, lastSyncAt: now, lastExportedAt: now, dataChangedAt: now }, { background: true });
            setPending(null); setSent(null);
          }}
          onCancel={() => setPending(null)} />
      )}
    </>
  );
}
