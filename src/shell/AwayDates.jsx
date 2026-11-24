// Settings › Away dates (board "Away dates", Round 20; decided 11/16).
// List: one row per stretch, name over dates; current and upcoming first by start date,
// ended ones dimmed with "· ended"; "+ Add away dates" (outlined) below.
// Add/edit sheet (typed: Cancel · Done): Who (several people when adding, one stretch saved
// per person; one when editing) · From (always a date, default today) · Until (an
// Open-ended switch; off shows a date that defaults to From and keeps the last date set).
// Until before From is amber and disables Done. Editing adds a red "Delete away dates".
// One-night absences stay on the per-night Who's home chips; the calendar sync never sets these.
import { useState } from "react";
import { todayLocalISO } from "../app/globals.js";
import { isEnded, sortStretches, stretchDates } from "../app/awayDates.js";
import { Chip, DeleteButton, Field, Group, OutlineButton, Row, Sheet, Switch } from "../ui/kit.jsx";
import { showToast } from "../ui/toast.js";

const newId = () => "r" + Date.now() + Math.random().toString(36).slice(2, 6);

function StretchEditor({ stretch, family, onCancel, onSave, onDelete }) {
  const today = todayLocalISO();
  const editing = !!stretch;
  const [who, setWho]       = useState(editing ? [stretch.name] : []);
  const [from, setFrom]     = useState(stretch?.from || today);
  const [open, setOpen]     = useState(editing ? !stretch.to : false);
  const [until, setUntil]   = useState(stretch?.to || stretch?.from || today);
  const [untilSet, setUntilSet] = useState(!!stretch?.to);   // until follows From until it's set
  const untilShown = untilSet ? until : from;
  const backwards = !open && !!from && untilShown < from;
  const canSave = who.length > 0 && !!from && !backwards;

  const toggle = name => setWho(cur => editing ? [name] : cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]);
  const save = () => { if (canSave) onSave({ who, from, to: open ? null : untilShown }); };

  return (
    <Sheet tall title={editing ? "Away dates" : "Add away dates"} onClose={onCancel} onCancel={onCancel} onDone={save} doneDisabled={!canSave}>
      <Field label="Who">
        <div className="ui-chips">
          {family.map(f => <Chip key={f.name} on={who.includes(f.name)} onClick={() => toggle(f.name)}>{f.name}</Chip>)}
        </div>
      </Field>
      <Field label="From">
        <input type="date" className="ui-input" aria-label="From" value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
      </Field>
      <Field label="Until">
        <Group><Row title="Open-ended" trailing={<Switch checked={open} onChange={setOpen} label="Open-ended" />} /></Group>
        {!open && (
          <input type="date" className="ui-input" aria-label="Until" value={untilShown}
            onChange={e => { if (e.target.value) { setUntil(e.target.value); setUntilSet(true); } }} />
        )}
        {backwards && <div className="ui-problem">Until is before From</div>}
      </Field>
      {editing && <DeleteButton onClick={onDelete}>Delete away dates</DeleteButton>}
    </Sheet>
  );
}

export function AwayDates({ db, persistDB, onClose, onBack }) {
  const today = todayLocalISO();
  const settings = db.settings || {};
  const family = settings.familyContacts || [];
  const ranges = settings.awayRanges || [];
  const [editing, setEditing] = useState(null);   // null | "new" | a stretch
  const write = next => persistDB({ ...db, settings: { ...settings, awayRanges: next } });

  if (editing) {
    const stretch = editing === "new" ? null : editing;
    return (
      <StretchEditor stretch={stretch} family={family}
        onCancel={() => setEditing(null)}
        onDelete={() => { write(ranges.filter(r => r.id !== stretch.id)); setEditing(null); showToast("Away dates deleted"); }}
        onSave={({ who, from, to }) => {
          if (stretch) write(ranges.map(r => (r.id === stretch.id ? { ...r, name: who[0], from, to } : r)));
          else {
            write([...ranges, ...who.map(name => ({ id: newId(), name, from, to }))]);
            showToast(`Added for ${who.join(", ")}`);
          }
          setEditing(null);
        }} />
    );
  }

  const list = sortStretches(ranges, today);
  return (
    <Sheet tall title="Away dates" onClose={onClose} onBack={onBack} backLabel="Settings">
      {list.length > 0 && (
        <Group>
          {list.map(r => <Row key={r.id} title={r.name} sub={stretchDates(r, today)} dim={isEnded(r, today)} onClick={() => setEditing(r)} />)}
        </Group>
      )}
      <OutlineButton onClick={() => setEditing("new")}>+ Add away dates</OutlineButton>
    </Sheet>
  );
}
