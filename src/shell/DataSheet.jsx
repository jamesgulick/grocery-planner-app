// Data sheet (polish Phase 2; canvas board "Data / Settings sheets", to review): backup
// status, "Back up · export file", import from a file or by paste, and reset kept apart,
// confirm-first, in plain text. Replaces the header status line and the backup banner.
// Layout 11/23 (board "Data sheet"): the status card; Import (outlined) | Back up (filled);
// then one card with no heading: Calendar sync (the two AI steps) and Paste data (from the
// clipboard → "Load this file?", subline "From paste"; the text box when nothing's copied).
import { useRef, useState } from "react";
import { prepareImport, readFileText } from "../app/dataIO.js";
import { downloadBackup, exportFileName } from "../app/exportData.js";
import { showToast } from "../ui/toast.js";
import { extractJSON } from "../app/globals.js";
import { DEFAULT_DB } from "../app/seed.js";
import { Group, Icon, PillButton, Row, Sheet } from "../ui/kit.jsx";
import { ImportCheck } from "./ImportCheck.jsx";
import { SyncRow, clipboardText, planFile } from "./SyncRow.jsx";

const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

export function DataSheet({ db, persistDB, overdue, onClose }) {
  const [page, setPage]       = useState("main");   // main | paste | confirm | reset
  const [paste, setPaste]     = useState("");
  const [result, setResult]   = useState(null);     // { ok, text }
  const [pending, setPending] = useState(null);     // an import read and checked, awaiting "Load it"
  const [source, setSource]   = useState(null);     // the check's subline: "From paste" or none
  const fileRef = useRef(null);

  // An import replaces everything on this device, so it's confirmed first: the import check.
  const review = (imp, from = null) => {
    const prepared = prepareImport(imp);
    if (!prepared) return;
    setPending(prepared); setSource(from);
    setPage("confirm");
  };
  const load = () => {
    persistDB(pending.db, { background: true });
    showToast("Loaded");
    const { meals, items } = pending.summary;
    setResult({ ok: true, text: `Loaded ${meals} meals and ${items} items.` });
    setPending(null); setPaste(""); setPage("main");
  };
  const fromFile = async file => {
    try { review(JSON.parse(await readFileText(file))); }
    catch (e) { setResult({ ok: false, text: `Couldn't import that file: ${e.message}` }); }
  };
  const fromPaste = () => {
    try { review(JSON.parse(extractJSON(paste)), "From paste"); }
    catch (e) { setResult({ ok: false, text: `Couldn't read that: ${e.message}` }); }
  };

  // Paste data: what's on the clipboard, else the text box to paste into.
  const pasteData = async () => {
    setResult(null);
    const text = await clipboardText();
    const file = text ? planFile(text) : null;
    if (file?.prepared) { setPending(file.prepared); setSource("From paste"); setPage("confirm"); }
    else if (!file) { setPaste(""); setPage("paste"); }
  };

  if (page === "confirm" && pending) return (
    <ImportCheck device={db} prepared={pending} source={source} onLoad={load} onCancel={() => { setPending(null); setPage("main"); }} />
  );

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
      <Group><Row title="Reset to example data" onClick={() => { persistDB(DEFAULT_DB); onClose(); showToast("Example data loaded"); }} chevron={false} /></Group>
    </Sheet>
  );

  return (
    <Sheet title="Your data" onClose={onClose}>
      <Group>
        <div className="shell-status">
          <span className={overdue ? "ui-problem" : "ui-meta"}>{overdue && <span className="ui-problem-dot" aria-hidden="true" />}{status}</span>
          {overdue && <span className="ui-meta"> · changes since</span>}
        </div>
      </Group>
      <div className="data-pair">
        <button type="button" className="ui-block-button ui-block-outline" onClick={() => fileRef.current?.click()}><Icon name="down" size={18} />Import</button>
        <button type="button" className="ui-block-button" onClick={() => { downloadBackup(db, persistDB); showToast(`Saved ${exportFileName()}`); }}><Icon name="up" size={18} />Back up</button>
      </div>
      <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain,text/*" hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) fromFile(f); }} />
      {result && <div className={result.ok ? "ui-meta" : "ui-problem"}>{result.text}</div>}
      <Group>
        <SyncRow db={db} persistDB={persistDB} inCard />
        <Row title="Paste data" sub="From the clipboard" onClick={pasteData} />
      </Group>
      <Group><Row title="Reset to example data…" onClick={() => setPage("reset")} chevron={false} /></Group>
    </Sheet>
  );
}
