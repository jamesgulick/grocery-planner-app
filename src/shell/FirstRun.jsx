// First run (brief §8, board "Data and first run"): on an empty device Home shows a "This device"
// card, "0 meals · 0 items · 0 plans", with [Load a file] (filled), [Paste data] (outlined) and
// "Start with example data" (a text link). Loading goes through the same import check, which
// marks the counts "new" and says "This device is empty". Paste reads the clipboard first and
// falls back to a text box, as the data sheet's Paste data does.
import { useRef, useState } from "react";
import { prepareImport, readFileText } from "../app/dataIO.js";
import { extractJSON } from "../app/globals.js";
import { DEFAULT_DB } from "../app/seed.js";
import { BlockButton, OutlineButton, PillButton, Section, Sheet } from "../ui/kit.jsx";
import { showToast } from "../ui/toast.js";
import { ImportCheck } from "./ImportCheck.jsx";
import { clipboardText, planFile } from "./SyncRow.jsx";

/** An empty device: no meals, no items, no plans (a fresh install, or after Erase). */
export const isEmptyDevice = db => !(db?.meals || []).length && !(db?.ingredients || []).length
  && !db?.plans?.current?.weekStartDate && !db?.plans?.next?.weekStartDate;

export function FirstRunCard({ db, persistDB }) {
  const fileRef = useRef(null);
  const [pending, setPending] = useState(null);   // { prepared, source }
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const review = (imp, source = null) => {
    const prepared = prepareImport(imp);
    if (prepared) { setPending({ prepared, source }); setPasting(false); setError(""); }
  };
  const fromFile = async file => {
    try { review(JSON.parse(await readFileText(file))); }
    catch (e) { setError(`Couldn't import that file: ${e.message}`); }
  };
  const pasteData = async () => {
    setError("");
    const clip = await clipboardText();
    const file = clip ? planFile(clip) : null;
    if (file?.prepared) setPending({ prepared: file.prepared, source: "From paste" });
    else if (!file) { setText(""); setPasting(true); }
  };

  return (
    <Section label="This device">
      <div className="firstrun-card">
        <span className="firstrun-counts">0 meals · 0 items · 0 plans</span>
        <BlockButton onClick={() => fileRef.current?.click()}>Load a file</BlockButton>
        <OutlineButton onClick={pasteData}>Paste data</OutlineButton>
        <button type="button" className="firstrun-example" onClick={() => persistDB(DEFAULT_DB, { background: true })}>Start with example data</button>
        {error && <div className="ui-problem">{error}</div>}
      </div>
      <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain,text/*" hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) fromFile(f); }} />
      {pasting && (
        <Sheet tall title="Paste data" onClose={() => setPasting(false)}>
          <textarea className="ui-textarea" aria-label="Data" value={text} onChange={e => { setText(e.target.value); setError(""); }} />
          {error && <div className="ui-problem">{error}</div>}
          <PillButton disabled={!text.trim()} onClick={() => {
            try { review(JSON.parse(extractJSON(text)), "From paste"); }
            catch (e) { setError(`Couldn't read that: ${e.message}`); }
          }}>Import</PillButton>
        </Sheet>
      )}
      {pending && (
        <ImportCheck device={db} prepared={pending.prepared} source={pending.source} onCancel={() => setPending(null)}
          onLoad={() => { persistDB(pending.prepared.db, { background: true }); setPending(null); showToast("Loaded"); }} />
      )}
    </Section>
  );
}
