// Data sheet (polish Phase 2; canvas board "Data / Settings sheets", to review): backup
// status, "Back up · export file", import from a file or by paste, and reset kept apart,
// confirm-first, in plain text. Replaces the header status line and the backup banner.
import { useRef, useState } from "react";
import { prepareImport, readFileText } from "../app/dataIO.js";
import { downloadBackup } from "../app/exportData.js";
import { extractJSON } from "../app/globals.js";
import { DEFAULT_DB } from "../app/seed.js";
import { BlockButton, Group, PillButton, Row, Section, Sheet } from "../ui/kit.jsx";

const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

export function DataSheet({ db, persistDB, overdue, onClose }) {
  const [page, setPage]       = useState("main");   // main | paste | reset
  const [paste, setPaste]     = useState("");
  const [result, setResult]   = useState(null);     // { ok, text }
  const fileRef = useRef(null);

  const apply = imp => {
    const prepared = prepareImport(imp);
    if (!prepared) return false;
    persistDB(prepared.db);
    const { meals, items } = prepared.summary;
    setResult({ ok: true, text: `Imported ${meals} meals and ${items} items.` });
    return true;
  };
  const fromFile = async file => {
    try { apply(JSON.parse(await readFileText(file))); }
    catch (e) { setResult({ ok: false, text: `Couldn't import that file: ${e.message}` }); }
  };
  const fromPaste = () => {
    try { if (apply(JSON.parse(extractJSON(paste)))) { setPaste(""); setPage("main"); } }
    catch (e) { setResult({ ok: false, text: `Couldn't read that: ${e.message}` }); }
  };

  const exported = db.lastExportedAt;
  const status = !exported ? "Not backed up yet"
    : daysSince(exported) <= 0 ? "Backed up today"
    : `Last backup ${daysSince(exported)} day${daysSince(exported) === 1 ? "" : "s"} ago`;

  if (page === "paste") return (
    <Sheet title="Paste data" onClose={onClose} onBack={() => setPage("main")}>
      <textarea className="ui-textarea" aria-label="Data" value={paste} onChange={e => { setPaste(e.target.value); setResult(null); }} />
      {result && !result.ok && <div className="ui-problem">{result.text}</div>}
      <PillButton onClick={fromPaste} disabled={!paste.trim()}>Import</PillButton>
    </Sheet>
  );

  if (page === "reset") return (
    <Sheet title="Reset to example data?" onClose={onClose} onBack={() => setPage("main")} doneLabel="Cancel">
      <div className="ui-meta">Your meals, items and plans on this device are replaced by the example data. Back up first if you might want them.</div>
      <Group><Row title="Reset to example data" onClick={() => { persistDB(DEFAULT_DB); onClose(); }} chevron={false} /></Group>
    </Sheet>
  );

  return (
    <Sheet title="Your data" onClose={onClose}>
      <Group>
        <div className="shell-status">
          <span className={overdue ? "ui-problem" : "ui-meta"}>{overdue && <span className="ui-problem-dot" aria-hidden="true" />}{status}</span>
          {overdue && <span className="ui-meta"> · changes since</span>}
        </div>
        <div className="shell-status-action"><BlockButton onClick={() => downloadBackup(db, persistDB)}>Back up · export file</BlockButton></div>
      </Group>
      <Section>
        <Group>
          <Row title="Import from file" onClick={() => fileRef.current?.click()} />
          <Row title="Paste data instead" onClick={() => { setResult(null); setPage("paste"); }} />
        </Group>
        <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain,text/*" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) fromFile(f); }} />
        {result && <div className={result.ok ? "ui-meta" : "ui-problem"}>{result.text}</div>}
      </Section>
      <Group><Row title="Reset to example data…" onClick={() => setPage("reset")} chevron={false} /></Group>
    </Sheet>
  );
}
