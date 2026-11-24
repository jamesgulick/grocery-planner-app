// "Load this file?" (board "Import check" 11/14; recipe round trip and fill-in boards 11/15;
// RULING 16, 11/16): the one check before every import replaces this device's data.
//   1. A file meant for another job than this device's last send: one amber line.
//   2. "Changed here since you sent it" (amber), when this device changed after the file left:
//      per record and field when this device sent it, else one line. Then Load reads "Load anyway".
//   3. Counts against this device (a drop amber; "1 new", "2 filled in").
//   4. Recipe / fill-in files: New meal (tap: every field) · Filled in (tap: what was added or
//      changed) · New items · Changed · "Outside this recipe" (amber). Calendar and plain files:
//      What changed by area, as before (calendar: notes are its scope, the rest amber; plain:
//      only removals amber).
//   5. Links to records not in the file (amber); the AI's own notes.
import { useState } from "react";
import { compareImport } from "../app/importCheck.js";
import { checkImport, mealPreview, savedLabel } from "../app/importDiff.js";
import { formatSavedAt } from "../app/globals.js";
import { DEFAULT_SETTINGS } from "../app/seed.js";
import { migrateDB } from "../app/plans.js";
import { clearPending, loadSentCopy, settleTrips } from "../app/sendToAI.js";
import { BlockButton, Group, Row, Section, Sheet } from "../ui/kit.jsx";

const JOB = { calendar: "Calendar sync", recipe: "Recipe", enrich: "Fill in" };

// A record row: name over its change; amber rows get the dot.
function RecordRow({ row, onOpen }) {
  if (row.problem) return (
    <div className="imp-rec is-problem">
      <span className="imp-row-dot" aria-hidden="true" />
      <span className="imp-rec-main"><span className="imp-rec-name">{row.name}</span><span className="imp-rec-line">{row.line}</span></span>
    </div>
  );
  return <Row title={row.name} strong={row.strong} sub={row.line} onClick={onOpen} chevron={!!onOpen} />;
}

function PreviewSheet({ meal, db, onClose }) {
  return (
    <Sheet tall title={meal.name} sub="New meal · in this file" onClose={onClose}>
      {mealPreview(meal, db).map(g => (
        <Section key={g.label} label={g.label}>
          <Group>{g.rows.map(([label, value], k) => <Row key={k} title={label || value} value={label ? value : null} />)}</Group>
        </Section>
      ))}
    </Sheet>
  );
}

function PeekSheet({ row, onClose }) {
  const p = row.peek;
  return (
    <Sheet tall title={row.name} sub="Filled in by this file" onClose={onClose}>
      {p.added.length > 0 && <Section label="Added"><Group>{p.added.map(a => <Row key={a.label} title={a.label} value={a.value} />)}</Group></Section>}
      {p.changed.length > 0 && <Section label="Changed"><Group>{p.changed.map(a => <Row key={a.label} title={a.label} value={a.value} />)}</Group></Section>}
      {p.ingredients.length > 0 && (
        <Section label={`Ingredients · ${p.ingredients.length}${p.guessed ? " · guessed, no recipe" : ""}`}>
          <Group>{p.ingredients.map((n, k) => <Row key={k} title={n} />)}</Group>
        </Section>
      )}
    </Sheet>
  );
}

// fromClipboard (calendar sync, board "Round 14"): the subline names the source, and the
// footnote says Load also saves a copy.
export function ImportCheck({ device, prepared, onLoad, onCancel, fromClipboard = false, source = null }) {
  const [open, setOpen] = useState(null);   // a row whose preview or peek is showing
  // Defaults filled on the device side too, as prepareImport fills them on the file's.
  const here = device && { ...device, settings: { ...DEFAULT_SETTINGS, ...(device.settings || {}) } };
  const meta = prepared.meta || null;
  const legacy = compareImport(here, prepared.db, prepared.summary);
  // Compare like with like: the sent copy and the file are brought to this app's data shape
  // first, so a field a data update dropped doesn't read as a change.
  const sentRaw = loadSentCopy();
  const sent = sentRaw && { ...sentRaw, db: migrateDB(sentRaw.db) };
  const r = here && !legacy.fresh ? checkImport({ device: here, incoming: migrateDB(prepared.db), meta, sent }) : null;
  const records = r && (r.purpose === "recipe" || r.purpose === "enrich");
  const stale = r && (r.stale.rows.length > 0 || r.stale.timestampOnly);

  // Subline: "Recipe · saved Nov 15, 10:31pm" (the job when this device sent it).
  const savedIso = meta?.exportedAt || legacy.savedAt;
  const job = r?.purpose === "enrich" ? `Fill in ${r.mealsFilled} meal${r.mealsFilled === 1 ? "" : "s"}` : JOB[r?.purpose];
  const sub = [source || (fromClipboard ? "From clipboard" : null), job ? `${job} · saved ${savedLabel(savedIso)}` : savedIso ? `Saved ${formatSavedAt(savedIso)}` : "Saved: unknown"].filter(Boolean).join(" · ");

  // Counts: records files say "1 new" / "2 filled in" beside any drop.
  const counts = legacy.counts.map(c => {
    if (!records) return c;
    if (c.label === "Meals") {
      const parts = [r.mealsRemoved ? `${r.mealsRemoved} fewer` : null, r.mealsNew ? `${r.mealsNew} new` : null, r.purpose === "enrich" && r.mealsFilled ? `${r.mealsFilled} filled in` : null].filter(Boolean);
      return { ...c, change: parts.join(" · ") || "same", problem: r.mealsRemoved > 0 };
    }
    if (c.label === "Items") {
      const parts = [r.itemsRemoved ? `${r.itemsRemoved} fewer` : null, r.itemsNew ? `${r.itemsNew} new` : null].filter(Boolean);
      return { ...c, change: parts.join(" · ") || "same", problem: r.itemsRemoved > 0 };
    }
    return c;
  });

  // Area rows for calendar and plain files. Calendar: notes are its scope (RULING 16.1, 11/16:
  // Who's home and Time changes are amber). Plain: every change shown, only removals amber.
  const changedLine = l => l !== "no change";
  const areaRows = !records && !legacy.fresh ? legacy.rows.map(row => {
    if (r?.purpose === "calendar") return { ...row, problem: row.label !== "Calendar notes" && row.lines.some(changedLine) };
    if (r && !r.purpose) return { ...row, problem: row.lines.some(l => /missing/.test(l)) };
    return row;
  }) : [];

  const group = (label, rows, opener, counted = true) => rows.length > 0 && (
    <Section label={counted ? `${label} · ${rows.length}` : label}>
      <div className="ui-group">{rows.map((row, k) => <RecordRow key={k} row={row} onOpen={opener && row.meal ? () => setOpen(row) : undefined} />)}</div>
    </Section>
  );

  return (
    <Sheet tall title="Load this file?" sub={sub} onClose={onCancel} doneLabel="Cancel"
      footer={<BlockButton onClick={() => { clearPending(); settleTrips(); onLoad(); }}>{stale ? "Load anyway" : "Load"}</BlockButton>}>
      {r?.purposeLine && <div className="ui-group"><RecordRow row={{ name: "Different job", line: r.purposeLine, problem: true }} /></div>}
      {stale && (
        <Section label="Changed here since you sent it">
          <div className="ui-group">
            {r.stale.timestampOnly
              ? <RecordRow row={{ name: "This device", line: `This device changed after that file was ${meta?.request ? "sent" : "saved"}. Loading drops those changes.`, problem: true }} />
              : r.stale.rows.map((row, k) => <RecordRow key={k} row={{ ...row, problem: true }} />)}
          </div>
        </Section>
      )}
      <div className="imp-counts">
        {counts.map(c => (
          <div key={c.label} className="imp-count">
            <span className="imp-count-n">{c.n}</span>
            <span className="imp-count-label">{c.label}</span>
            {Array.isArray(c.change)
              ? <span className={`imp-count-change${c.problem ? " is-problem" : ""}`}>{c.change.map((t, i) => <span key={i}>{t}</span>)}</span>
              : c.change && <span className={`imp-count-change${c.problem ? " is-problem" : ""}`}>{c.change}</span>}
          </div>
        ))}
      </div>
      {records && <>
        {group(r.newMeals.length > 1 ? "New meals" : "New meal", r.newMeals, true, r.newMeals.length > 1)}
        {group("Filled in", r.filledIn, true)}
        {group("New items", r.newItems)}
        {group("Changed", r.changed)}
        {group(r.outsideLabel, r.outside, false, false)}
      </>}
      {areaRows.length > 0 && (
        <Section label="What changed">
          <div className="ui-group">
            {areaRows.map(row => (
              <div key={row.label} className={`imp-row${row.problem ? " is-problem" : ""}`}>
                {row.problem && <span className="imp-row-dot" aria-hidden="true" />}
                <span className="imp-row-label">{row.label}</span>
                <span className="imp-row-value">{row.lines.map((t, i) => <span key={i}>{t}</span>)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {r && group("Missing links", r.dangling.map(d => ({ ...d, problem: true })), false, false)}
      {r?.notes?.length > 0 && <Section label="Notes"><Group>{r.notes.map((n, k) => <Row key={k} title={n} />)}</Group></Section>}
      <div className="ui-meta imp-replaces">{stale ? "Loading drops the changes made here" : "Replaces what's on this device"}{fromClipboard && " · Saves a copy"}</div>
      {open && (open.peek ? <PeekSheet row={open} onClose={() => setOpen(null)} /> : <PreviewSheet meal={open.meal} db={prepared.db} onClose={() => setOpen(null)} />)}
    </Sheet>
  );
}
