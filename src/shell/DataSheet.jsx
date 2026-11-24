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
import { endDateFor, extraDaysOf } from "../engine/assembleInputs.js";
import { DeleteButton, Group, Icon, PillButton, Row, Sheet } from "../ui/kit.jsx";
import { ImportCheck } from "./ImportCheck.jsx";
import { SyncRow, clipboardText, planFile } from "./SyncRow.jsx";

const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = d => `${MON[d.getMonth()]} ${d.getDate()}`;
// "Nov 11–17", or "Nov 28–Dec 4" across a month.
const planRange = p => {
  const a = new Date(p.weekStartDate + "T12:00:00"), b = new Date(endDateFor(p.weekStartDate, extraDaysOf(p)) + "T12:00:00");
  return a.getMonth() === b.getMonth() ? `${shortDate(a)}–${b.getDate()}` : `${shortDate(a)}–${shortDate(b)}`;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function DataSheet({ db, persistDB, overdue, onClose }) {
  const [page, setPage]       = useState("main");   // main | paste | confirm | erase
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

  // Status (board "Data sheet"): "Last backup · Nov 4" ("· Today"; overdue adds "· 9 days ago"),
  // then the counts.
  const exported = db.lastExportedAt;
  const ago = exported ? daysSince(exported) : null;
  const when = !exported ? null : ago <= 0 ? "Today" : shortDate(new Date(exported));
  const status = !exported ? "Not backed up yet"
    : `Last backup · ${when}${overdue && ago > 0 ? ` · ${plural(ago, "day")} ago` : ""}`;
  const plans = [db.plans?.current, db.plans?.next].filter(p => p?.weekStartDate);
  const counts = `${plural((db.meals || []).length, "meal")} · ${plural((db.ingredients || []).length, "item")} · ${plural(plans.length, "plan")}`;

  if (page === "paste") return (
    <Sheet title="Paste data" onClose={onClose} onBack={() => setPage("main")}>
      <textarea className="ui-textarea" aria-label="Data" value={paste} onChange={e => { setPaste(e.target.value); setResult(null); }} />
      {result && !result.ok && <div className="ui-problem">{result.text}</div>}
      <PillButton onClick={fromPaste} disabled={!paste.trim()}>Import</PillButton>
    </Sheet>
  );

  // Erase this device: the speed bump lists what goes. The device then shows the example
  // data with "Import your file" (Home), as on a first visit.
  if (page === "erase") return (
    <Sheet title="Erase this device?" onClose={onClose} noDone>
      <Group>
        <Row title="Meals" value={(db.meals || []).length} />
        <Row title="Items" value={(db.ingredients || []).length} />
        <Row title="Plans" value={plans.length ? plans.map(planRange).join(", ") : "None"} />
        <Row title="Last backup" value={when || "Never"} />
      </Group>
      <div className="lib-cant-undo">Can't be undone</div>
      <div className="data-pair data-erase">
        <button type="button" className="ui-block-button ui-block-plain" onClick={() => setPage("main")}>Cancel</button>
        <button type="button" className="ui-block-button ui-block-delete ui-block-delete-filled" onClick={() => { persistDB(DEFAULT_DB); onClose(); showToast("Erased"); }}><Icon name="trash" size={20} />Erase</button>
      </div>
    </Sheet>
  );

  return (
    <Sheet title="Data" onClose={onClose}>
      <Group>
        <div className={overdue ? "shell-status is-overdue" : "shell-status"}>
          {overdue && <span className="shell-status-dot" aria-hidden="true" />}
          <span className="shell-status-text"><span className={overdue ? "ui-problem" : undefined}>{status}</span><span className="ui-meta">{counts}</span></span>
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
        <Row icon="down" title="Paste data" sub="From the clipboard" onClick={pasteData} chevron={false} />
      </Group>
      <DeleteButton onClick={() => setPage("erase")}>Erase this device</DeleteButton>
    </Sheet>
  );
}
