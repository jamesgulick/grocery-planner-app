// Calendar sync row (decided 11/14): [Send to Claude] › [Re-import]. Send to Claude shares
// the export with the fixed prompt; Re-import reads the file Claude sent back and opens the
// one import check before anything is replaced. Both are outlined: equal steps of one
// sequence. Phase 1 shows it on the plan's Welcome step until the Week step replaces it.
import { useRef, useState } from "react";
import { prepareImport, readFileText } from "../app/dataIO.js";
import { sendToClaude } from "../app/sendToClaude.js";
import { BlockButton, Section } from "../ui/kit.jsx";
import { ImportCheck } from "./ImportCheck.jsx";

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

  return (
    <div className="sync">
      <Section label="Calendar">
        <div className="sync-row">
          <BlockButton secondary onClick={async () => setSent(await sendToClaude(db, persistDB))}>Send to Claude</BlockButton>
          <span className="sync-chev" aria-hidden="true">›</span>
          <BlockButton secondary onClick={() => fileRef.current?.click()}>Re-import</BlockButton>
        </div>
        {sent && sent !== "cancelled" && <div className="ui-meta">{sent === "downloaded" ? "Prompt copied · file downloaded" : "Prompt copied"}</div>}
        {error && <div className="ui-problem">{error}</div>}
      </Section>
      <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain,text/*" hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) reimport(f); }} />
      {pending && (
        <ImportCheck device={db} prepared={pending}
          onLoad={() => { persistDB(pending.db); setPending(null); setSent(null); }}
          onCancel={() => setPending(null)} />
      )}
    </div>
  );
}
