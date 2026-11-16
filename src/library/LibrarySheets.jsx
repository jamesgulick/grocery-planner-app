// The meal and item pages' edit sheets (board "Meal and item edit sheets", approved 11/15).
// Pick sheets (chips, segments, switches, check lists) have Done only: every tap saves and
// tapping again undoes it. Typed sheets (link, notes, usual amount) keep Cancel · Done.
// ⓘ beside field labels opens the explanation sheet.
import { useState } from "react";
import { CheckRow, Chip, Clocks, DeleteButton, Field, FieldLabel, Group, Row, SearchField, Segmented, Sheet, Switch } from "../ui/kit.jsx";
import { INFO } from "./info.js";
import {
  COST_OPTIONS, EFFORT_OPTIONS, FEEL_OPTIONS, PREF_OPTIONS, CADENCE_OPTIONS,
  facetWord, isSide, linkWords,
} from "./libraryModel.js";
import { RecipePaste } from "./RecipePaste.jsx";

export function InfoSheet({ topic, onClose }) {
  const info = INFO[topic];
  if (!info) return null;
  return (
    <Sheet title={info.title} onClose={onClose}>
      <div className="lib-info">
        {info.lines.map(([label, text], k) => <p key={k}>{label && <strong>{label} · </strong>}{text}</p>)}
      </div>
    </Sheet>
  );
}

// A label with ⓘ, and the explanation sheet it opens.
function useInfo() {
  const [topic, setTopic] = useState(null);
  const label = (text, t) => <FieldLabel info={text} onInfo={t ? () => setTopic(t) : undefined}>{text}</FieldLabel>;
  const sheet = topic && <InfoSheet topic={topic} onClose={() => setTopic(null)} />;
  return [label, sheet];
}

const Chips = ({ options, value, onToggle, word = facetWord }) => (
  <div className="ui-chips">{options.map(o => <Chip key={o} on={(value || []).includes(o)} onClick={() => onToggle(o)}>{word(o)}</Chip>)}</div>
);
const toggled = (list, v) => ((list || []).includes(v) ? list.filter(x => x !== v) : [...(list || []), v]);

/** Multi-select tag groups: Style (Form + Service), Plate and feel (Feel + Plate), Avoid. */
export function TagSheet({ title, groups, onClose }) {
  const [label, info] = useInfo();
  return (
    <Sheet title={title} onClose={onClose}>
      {groups.map(g => (
        <Field key={g.label} label={null}>
          {label(g.label, g.info)}
          <Chips options={g.options} value={g.value} onToggle={v => g.onChange(toggled(g.value, v))} />
          {(g.value || []).filter(v => !g.options.includes(v)).length > 0 && (
            <Chips options={(g.value || []).filter(v => !g.options.includes(v))} value={g.value} onToggle={v => g.onChange(toggled(g.value, v))} />
          )}
        </Field>
      ))}
      {info}
    </Sheet>
  );
}

/** Sides that go with it (main) / Goes with (side): search, "Chosen · N", then the rest A–Z. */
export function PairsSheet({ meal, meals, chosen, onChange, onClose }) {
  const [q, setQ] = useState("");
  const candidates = meals.filter(m => m.id !== meal.id && isSide(m) !== isSide(meal));
  const match = m => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase());
  const az = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const on = candidates.filter(m => chosen.includes(m.id) && match(m)).sort(az);
  const off = candidates.filter(m => !chosen.includes(m.id) && match(m)).sort(az);
  const mains = isSide(meal);   // a side picks mains (bold); a main picks sides
  const row = m => <CheckRow key={m.id} on={chosen.includes(m.id)} strong={mains} onClick={() => onChange(toggled(chosen, m.id))}>{m.name}</CheckRow>;
  return (
    <Sheet title={mains ? "Goes with" : "Sides that go with it"} onClose={onClose}>
      <SearchField value={q} onChange={setQ} placeholder={mains ? "Search mains" : "Search sides"} />
      {on.length > 0 && <Field label={`Chosen · ${chosen.length}`}><Group>{on.map(row)}</Group></Field>}
      {off.length > 0 && <Field label={mains ? "Mains" : "Sides"}><Group>{off.map(row)}</Group></Field>}
    </Sheet>
  );
}

/** Leftovers: Lasts (days) first, always shown; Who eats them once it lasts 1+ days. */
export function LeftoversSheet({ meal, family, onChange, onClose }) {
  const [label, info] = useInfo();
  const c = meal.carries;
  const mode = !c ? null : Array.isArray(c.forWhom) ? "people" : c.forWhom;
  const days = [{ value: "0", label: "None" }, ...[1, 2, 3, 4, 5, 6, 7].map(n => ({ value: String(n), label: String(n) }))];
  const setDays = v => onChange(v === "0" ? undefined : { forWhom: c ? c.forWhom : "followLikes", lastsDays: Number(v) });
  const setMode = v => onChange({ ...c, forWhom: v === "people" ? (Array.isArray(c.forWhom) ? c.forWhom : []) : v });
  return (
    <Sheet title="Leftovers" onClose={onClose}>
      <div className="ui-field">{label("Lasts (days)", "leftovers")}
        <Segmented label="Lasts (days)" value={c ? String(c.lastsDays) : "0"} onChange={setDays} options={days} />
      </div>
      {c && <div className="ui-field">{label("Who eats them", "leftovers")}
        <Segmented label="Who eats them" value={mode} onChange={setMode}
          options={[{ value: "followLikes", label: "Who likes it" }, { value: "all", label: "Everyone" }, { value: "people", label: "Chosen" }]} />
      </div>}
      {mode === "people" && (
        <Field label="People">
          <div className="ui-chips">{family.map(f => <Chip key={f.name} on={c.forWhom.includes(f.name)} onClick={() => onChange({ ...c, forWhom: toggled(c.forWhom, f.name) })}>{f.name}</Chip>)}</div>
        </Field>
      )}
      {info}
    </Sheet>
  );
}

export function WeatherSheet({ meal, onField, onClose }) {
  const [label, info] = useInfo();
  return (
    <Sheet title="Weather" onClose={onClose}>
      <div className="ui-field">{label("Day feel", "weather")}
        <Segmented label="Day feel" value={meal.tempAffinity || "neutral"} onChange={v => onField("tempAffinity", v)} options={FEEL_OPTIONS} />
      </div>
      <Group><Row title="Grillable" trailing={<Switch checked={!!meal.grillable} onChange={v => onField("grillable", v)} label="Grillable" />} /></Group>
      {info}
    </Sheet>
  );
}


export function TimeCostSheet({ meal, onField, onClose }) {
  const [label, info] = useInfo();
  return (
    <Sheet title="Time needed and cost" onClose={onClose}>
      <div className="ui-field">{label("Time needed", "timeNeeded")}
        <Segmented label="Time needed" value={meal.effort} onChange={v => onField("effort", v)}
          options={EFFORT_OPTIONS.map(o => ({ value: o.value, label: <span className="lib-with-clocks"><Clocks n={o.n} />{o.label}</span> }))} />
      </div>
      <div className="ui-field">{label("Cost", "cost")}
        <Segmented label="Cost" value={meal.cost || "none"} onChange={v => onField("cost", v === "none" ? undefined : v)} options={COST_OPTIONS} />
      </div>
      {info}
    </Sheet>
  );
}

export function WhoEatsSheet({ meal, family, onChange, onClose }) {
  const [topic, setTopic] = useState(null);
  const info = topic && <InfoSheet topic={topic} onClose={() => setTopic(null)} />;
  const prefOf = name => (meal.preferences || []).find(p => p.person === name)?.pref || "fine";
  const set = (name, v) => {
    const rest = (meal.preferences || []).filter(p => p.person !== name);
    onChange(v === "fine" ? rest : [...rest, { person: name, pref: v }]);
  };
  return (
    <Sheet title="Who eats it" onClose={onClose} onInfo={() => setTopic("whoEats")}>
      {family.map(f => (
        <div key={f.name} className="ui-field lib-person">
          <div className="lib-person-name">{f.name}</div>
          <Segmented label={f.name} value={prefOf(f.name)} onChange={v => set(f.name, v)} options={PREF_OPTIONS} />
        </div>
      ))}
      {info}
    </Sheet>
  );
}

export function HowOftenSheet({ meal, onField, onClose }) {
  const [topic, setTopic] = useState(null);
  return (
    <Sheet title="How often" onClose={onClose} onInfo={() => setTopic("howOften")}>
      <Segmented label="How often" value={meal.cadence} onChange={v => onField("cadence", v)} options={CADENCE_OPTIONS} />
      {topic && <InfoSheet topic={topic} onClose={() => setTopic(null)} />}
    </Sheet>
  );
}

/** Typed: Recipe link, Notes, Usual amount. Cancel · Done; Done saves the trimmed text. */
export function TextSheet({ title, value, multiline, url, onSave, onClose }) {
  const [text, setText] = useState(value || "");
  const href = url && text.trim() ? (/^https?:\/\//i.test(text.trim()) ? text.trim() : "https://" + text.trim()) : null;
  return (
    <Sheet title={title} onClose={onClose} onCancel={onClose} onDone={() => { onSave(text.trim()); onClose(); }}>
      {multiline
        ? <textarea className="ui-textarea" aria-label={title} value={text} onChange={e => setText(e.target.value)} />
        : <input className="ui-input" aria-label={title} value={text} inputMode={url ? "url" : undefined} autoCapitalize={url ? "off" : undefined} onChange={e => setText(e.target.value)} />}
      {href && <a className="ui-pill ui-pill-secondary lib-open-link" href={href} target="_blank" rel="noreferrer">Open link</a>}
    </Sheet>
  );
}
export { linkWords };

/** Ingredients: search, "Chosen · N", the rest A–Z; Add "<text>" when nothing matches; Paste a recipe. */
export function IngredientsSheet({ meal, db, startPasting, onChange, onCreate, onSetPantryIgnore, onClose }) {
  const [q, setQ] = useState("");
  const [pasting, setPasting] = useState(!!startPasting);
  const items = db.ingredients || [];
  const chosen = meal.ingredients || [];
  const t = q.trim().toLowerCase();
  const match = i => !t || i.name.toLowerCase().includes(t);
  const az = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const on = items.filter(i => chosen.includes(i.id) && match(i)).sort(az);
  const off = items.filter(i => !chosen.includes(i.id) && match(i)).sort(az);
  const exact = items.some(i => i.name.trim().toLowerCase() === t);
  const row = i => <CheckRow key={i.id} on={chosen.includes(i.id)} onClick={() => onChange(toggled(chosen, i.id))}>{i.name}</CheckRow>;
  if (pasting) return (
    <Sheet title="Paste a recipe" onClose={onClose} onBack={() => setPasting(false)}>
      <RecipePaste chosen={chosen} meals={db.meals} ingredients={items} pantryIgnore={db.settings?.pantryIgnore}
        onSetPantryIgnore={onSetPantryIgnore} onCancel={() => setPasting(false)}
        onAdd={(ids, created) => { onCreate(created, ids); setPasting(false); }} />
    </Sheet>
  );
  return (
    <Sheet title="Ingredients" onClose={onClose}>
      <SearchField value={q} onChange={setQ} placeholder="Search items" />
      {t && !exact && (
        <Group><Row title={`Add “${q.trim()}”`} onClick={() => { onCreate([{ name: q.trim() }]); setQ(""); }} /></Group>
      )}
      {!t && <button type="button" className="ui-link lib-paste-link" onClick={() => setPasting(true)}>Paste a recipe</button>}
      {on.length > 0 && <Field label={`Chosen · ${chosen.length}`}><Group>{on.map(row)}</Group></Field>}
      {off.length > 0 && <Field label="Items"><Group>{off.map(row)}</Group></Field>}
    </Sheet>
  );
}

/** The delete speed bump: what it touches, "Can't be undone", [Cancel] [Delete]. */
export function DeleteSheet({ name, lines, onDelete, onClose }) {
  return (
    <Sheet title={`Delete ${name}?`} onClose={onClose} doneLabel="Cancel">
      {lines.length > 0 && <Group>{lines.map(([label, value]) => <Row key={label} title={label} sub={value} />)}</Group>}
      <div className="lib-cant-undo">Can't be undone</div>
      <DeleteButton filled onClick={onDelete}>Delete</DeleteButton>
    </Sheet>
  );
}

/** A one-choice list with ✓ (Kept in). Done only. */
export function PickListSheet({ title, options, value, onChange, onClose }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <Group>
        {options.map(o => (
          <Row key={o} title={o} chevron={false} onClick={() => onChange(o)}
            trailing={value === o ? <span className="shell-check" aria-label="Selected">✓</span> : null} />
        ))}
      </Group>
    </Sheet>
  );
}
