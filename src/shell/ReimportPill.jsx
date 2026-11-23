// [Re-import] for a request sent from Grab or from Home's pending bar (brief §9 "Grab's return
// trip", 11/16): the file picker, then "Load this file?". The picked file is on the phone
// already, so loading it counts as the backup (as Calendar sync's Choose file does).
// Loading settles the pending request (ImportCheck does that for every load).
import { useRef, useState } from "react";
import { prepareImport, readFileText } from "../app/dataIO.js";
import { ImportCheck } from "./ImportCheck.jsx";
import { StepPill } from "./AiSteps.jsx";

// `step`: the state of step ② ("lit" | "idle") when it sits in the two AI steps (11/23).
export function ReimportPill({ db, persistDB, onLoaded, className = "sync-pill", step }) {
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const fromFile = async f => {
    setError("");
    try {
      const prepared = prepareImport(JSON.parse(await readFileText(f)));
      if (prepared) setPending(prepared);
    } catch (e) { setError(`Couldn't import that file: ${e.message}`); }
  };
  const load = () => {
    persistDB({ ...pending.db, lastExportedAt: new Date().toISOString() }, { background: true });
    setPending(null);
    onLoaded?.();
  };

  return (
    <>
      {step
        ? <StepPill n={2} state={step} onClick={() => fileRef.current?.click()}>Re-import</StepPill>
        : <button type="button" className={className} onClick={() => fileRef.current?.click()}>Re-import</button>}
      <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain,text/*" hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) fromFile(f); }} />
      {error && <div className="ui-problem reimport-error">{error}</div>}
      {pending && <ImportCheck device={db} prepared={pending} onLoad={load} onCancel={() => setPending(null)} />}
    </>
  );
}
