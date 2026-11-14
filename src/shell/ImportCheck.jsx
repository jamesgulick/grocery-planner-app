// "Load this file?" (canvas board "Import check", decided 11/14): the one check before
// every import replaces this device's data. Counts with their change against this device
// (a drop in amber), the weeks each plan covers, then What changed: the calendar rows,
// and anything else that differs in amber.
import { compareImport } from "../app/importCheck.js";
import { formatSavedAt } from "../app/globals.js";
import { BlockButton, Section, Sheet } from "../ui/kit.jsx";

export function ImportCheck({ device, prepared, onLoad, onCancel }) {
  const { savedAt, counts, rows, older } = compareImport(device, prepared.db, prepared.summary.asOf);
  const allRows = older
    ? [...rows, { label: "Older file", lines: [`this device ${formatSavedAt(device.dataChangedAt)}`], problem: true }]
    : rows;
  return (
    <Sheet title="Load this file?" sub={savedAt ? `Saved ${formatSavedAt(savedAt)}` : "Saved: unknown"}
      onClose={onCancel} doneLabel="Cancel"
      footer={<BlockButton onClick={onLoad}>Load</BlockButton>}>
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
      {allRows.length > 0 && (
        <Section label="What changed">
          <div className="ui-group">
            {allRows.map(r => (
              <div key={r.label} className={`imp-row${r.problem ? " is-problem" : ""}`}>
                {r.problem && <span className="imp-row-dot" aria-hidden="true" />}
                <span className="imp-row-label">{r.label}</span>
                <span className="imp-row-value">{r.lines.map((t, i) => <span key={i}>{t}</span>)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      <div className="ui-meta imp-replaces">Replaces what's on this device</div>
    </Sheet>
  );
}
