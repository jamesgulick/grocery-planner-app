// The meal page (boards "Meal page, all fields", "Meal page", "Scrolling pattern"; Decisions
// 11/14–11/15). Every schema field, organised in five groups that each stick on scroll:
//   Planning: Wanted soon · Who eats it · How often · Time needed and cost · Rotation
//   The plate: Type · Style · Plate and feel · mains: No sides needed + Sides that go with it
//              (hidden, not cleared, while No sides needed is on) · sides: Goes with ·
//              Avoid on the plate · Can be someone's dinner
//   Cooking: Leftovers · Weather     Shopping: Ingredients (+ Paste a recipe) · Recipe link
//   Notes, then Delete meal (speed bump).
// Sections read as cards; a tap opens that section's sheet, which saves as you go. Switches,
// Type and Rotation are set in place. The large title collapses into the bar on scroll;
// ✎ renames in place (renameMeal: plans and history follow, the record stays the same).
// Finish-the-entry gaps are amber only for a meal in rotation or planned; learn-over-time
// fields read "Not set" quietly.
import { useEffect, useRef, useState } from "react";
import { todayLocalISO } from "../app/globals.js";
import { mealNameProblem, renameMeal } from "../mealRename.js";
import { FACET_VOCAB } from "../manage/MealEditor.jsx";
import { DeleteButton, FieldLabel, Group, Icon, Row, Segmented, Switch } from "../ui/kit.jsx";
import {
  Clocks, DeleteSheet, HowOftenSheet, InfoSheet, IngredientsSheet, LeftoversSheet, PairsSheet,
  TagSheet, TextSheet, TimeCostSheet, WeatherSheet, WhoEatsSheet,
} from "./LibrarySheets.jsx";
import {
  EFFORT_OPTIONS, ROTATION_OPTIONS, TYPE_OPTIONS, cadenceWord, dayShort, facetWord, isSide,
  leftoversWords, linkWords, mealDeleteImpact, mealGaps, mealHistoryIndex, monthDay, pairIdsOf, timeCostWords,
  typeWord, weatherWords, whoEatsWords, withField, withPairs, withoutMeal,
} from "./libraryModel.js";

// The page's title bar and big title, shared with the item page.
export function PageHeader({ name, sub, onBack, onRename, renameProblem, renameExtra }) {
  const titleRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState(null);   // the name being typed, while renaming
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), { rootMargin: "-52px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [draft === null]);
  const problem = draft !== null ? renameProblem(draft) : null;
  const done = () => { if (problem) return; if (draft.trim() !== name) onRename(draft.trim()); setDraft(null); };
  return (
    <>
      <div className="lib-pagebar">
        {draft === null
          ? <button type="button" className="lib-back" onClick={onBack}><span aria-hidden="true">‹</span> Library</button>
          : <button type="button" className="lib-back" onClick={() => setDraft(null)}>Cancel</button>}
        <span className="lib-pagebar-title" data-show={collapsed && draft === null ? "1" : "0"}>{name}</span>
        {draft !== null && <button type="button" className="lib-bar-done" disabled={!!problem} onClick={done}>Done</button>}
      </div>
      <div className="lib-pagehead">
        {draft === null ? (
          <div className="lib-title-row" ref={titleRef}>
            <h1 className="ui-screen-title lib-title">{name}</h1>
            <button type="button" className="lib-pencil" aria-label="Rename" onClick={() => setDraft(name)}><Icon name="pencil" size={20} /></button>
          </div>
        ) : (
          <label className="ui-search lib-rename">
            <input autoFocus value={draft} aria-label="Name" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") done(); }} />
            {draft && <button type="button" className="ui-search-clear" aria-label="Clear" onClick={() => setDraft("")}><Icon name="close" size={16} /></button>}
          </label>
        )}
        {problem && draft && draft.trim() !== name ? <div className="ui-problem">{problem}</div> : sub && <div className="ui-meta lib-sub">{sub}</div>}
        {renameExtra}
      </div>
    </>
  );
}

// A section: label (+ ⓘ) over a white card that opens its sheet. `problem` turns it amber.
function SectionCard({ label, info, onInfo, value, problem, onClick, children }) {
  return (
    <div className="lib-section">
      {label && <FieldLabel info={label} onInfo={info ? () => onInfo(info) : undefined}>{label}</FieldLabel>}
      <button type="button" className={problem ? "lib-card lib-card-problem" : "lib-card"} onClick={onClick}>
        <span className="lib-card-body">
          {problem && <span className="ui-problem-dot" aria-hidden="true" />}
          {children || (value == null ? <span className="lib-notset">Not set</span> : value)}
        </span>
        <svg aria-hidden="true" className="ui-chevron-icon lib-card-chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l6 6-6 6" /></svg>
      </button>
    </div>
  );
}
const TagList = ({ values }) => <span className="lib-tags">{values.map(v => <span key={v} className="lib-tag">{facetWord(v)}</span>)}</span>;
const SwitchRow = ({ title, checked, onChange, info, onInfo }) => (
  <Group><Row title={<span className="lib-switch-title">{title}{info && <button type="button" className="ui-info" aria-label={"About " + title} onClick={() => onInfo(info)}><Icon name="info" size={18} /></button>}</span>}
    trailing={<Switch checked={!!checked} onChange={onChange} label={title} />} /></Group>
);

export function MealPage({ db, persistDB, mealId, onBack }) {
  const today = todayLocalISO();
  const meal = (db.meals || []).find(m => m.id === mealId);
  const [sheet, setSheet] = useState(null);   // which section's sheet is open
  const [info, setInfo] = useState(null);
  useEffect(() => { window.scrollTo(0, 0); }, [mealId]);
  if (!meal) return null;

  const family = db.settings?.familyContacts || [];
  const hist = mealHistoryIndex(db, today);
  const gaps = mealGaps(meal, hist);
  const side = isSide(meal);
  const isNew = meal.rotation === "experimental";
  const planned = hist.planned(meal.name);
  const last = hist.last(meal.name);
  const pairIds = pairIdsOf(meal, db.meals);
  const pairNames = pairIds.map(id => db.meals.find(m => m.id === id)?.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const ingNames = (meal.ingredients || []).map(id => db.ingredients.find(i => i.id === id)?.name).filter(Boolean);

  const save = meals => persistDB({ ...db, meals });
  const setField = (k, v) => save(db.meals.map(m => (m.id === meal.id ? withField(m, k, v) : m)));
  const close = () => setSheet(null);

  const whoWords = whoEatsWords(meal, family);
  const sub = [typeWord(meal.type), planned ? `Planned ${dayShort(planned)}` : null].filter(Boolean).join(" · ");
  const effort = EFFORT_OPTIONS.find(o => o.value === meal.effort);
  const cooked = hist.count(meal.name);

  let open = null;
  if (sheet === "who") open = <WhoEatsSheet meal={meal} family={family} onChange={p => setField("preferences", p.length ? p : [])} onClose={close} />;
  if (sheet === "often") open = <HowOftenSheet meal={meal} onField={setField} onClose={close} />;
  if (sheet === "time") open = <TimeCostSheet meal={meal} onField={setField} onClose={close} />;
  if (sheet === "style") open = <TagSheet title="Style" onClose={close} groups={[
    { label: "Form", info: "style", options: FACET_VOCAB.form, value: meal.form, onChange: v => setField("form", v) },
    { label: "Service", info: "style", options: FACET_VOCAB.service, value: meal.service, onChange: v => setField("service", v) },
  ]} />;
  if (sheet === "plate") open = <TagSheet title="Plate and feel" onClose={close} groups={[
    { label: "Feel", info: "plateFeel", options: FACET_VOCAB.experience, value: meal.experience, onChange: v => setField("experience", v) },
    { label: "Plate", info: "plateFeel", options: FACET_VOCAB.plate, value: meal.plate, onChange: v => setField("plate", v) },
  ]} />;
  if (sheet === "avoid") open = <TagSheet title="Avoid on the plate" onClose={close} groups={[
    { label: "Plate", info: "avoid", options: FACET_VOCAB.plate, value: meal.avoidPlate, onChange: v => setField("avoidPlate", v) },
  ]} />;
  if (sheet === "pairs") open = <PairsSheet meal={meal} meals={db.meals} chosen={pairIds} onChange={ids => save(withPairs(db.meals, meal, ids))} onClose={close} />;
  if (sheet === "left") open = <LeftoversSheet meal={meal} family={family} onChange={c => setField("carries", c)} onClose={close} />;
  if (sheet === "weather") open = <WeatherSheet meal={meal} onField={setField} onClose={close} />;
  if (sheet === "link") open = <TextSheet title="Recipe link" url value={meal.link} onSave={v => setField("link", v)} onClose={close} />;
  if (sheet === "notes") open = <TextSheet title="Notes" multiline value={meal.notes} onSave={v => save(db.meals.map(m => (m.id === meal.id ? { ...m, notes: v } : m)))} onClose={close} />;
  if (sheet === "ingredients" || sheet === "paste") open = (
    <IngredientsSheet meal={meal} db={db} startPasting={sheet === "paste"} onClose={close}
      onChange={ids => save(db.meals.map(m => (m.id === meal.id ? { ...m, ingredients: ids } : m)))}
      onSetPantryIgnore={list => persistDB({ ...db, settings: { ...db.settings, pantryIgnore: list } })}
      onCreate={(created, ids) => {
        const made = created.map(c => (c.id ? c : { id: "i" + Date.now() + Math.random().toString(36).slice(2, 7), createdAt: new Date().toISOString(), name: c.name[0].toUpperCase() + c.name.slice(1), storageLocation: "Unassigned", tier: "specialty", defaultQuantity: "" }));
        const next = ids || [...(meal.ingredients || []), ...made.map(i => i.id)];
        persistDB({ ...db, ingredients: [...db.ingredients, ...made], meals: db.meals.map(m => (m.id === meal.id ? { ...m, ingredients: next } : m)) });
      }} />
  );
  if (sheet === "delete") {
    const impact = mealDeleteImpact(db, meal, today);
    const lines = [
      impact.planned.length ? ["Planned", impact.planned.map(dayShort).join(", ")] : null,
      impact.linked ? [side ? "Goes with" : "Sides that go with it", `${impact.linked} ${side ? "main" : "side"}${impact.linked === 1 ? "" : "s"}`] : null,
      impact.onlyItems.length ? ["Ingredients only it uses", impact.onlyItems.join(", ")] : null,
    ].filter(Boolean);
    open = <DeleteSheet name={meal.name} lines={lines} onClose={close} onDelete={() => { persistDB(withoutMeal(db, meal.id)); onBack(); }} />;
  }

  return (
    <div className="lib-page">
      <PageHeader name={meal.name} sub={sub} onBack={onBack}
        renameProblem={n => mealNameProblem(db.meals, meal.id, n)}
        onRename={n => { const base = renameMeal(db, meal.id, n); persistDB({ ...base, meals: base.meals.map(m => (m.id === meal.id ? { ...m, name: n } : m)) }); }} />

      <section className="lib-group">
        <h2 className="lib-group-head">Planning</h2>
        <SwitchRow title="Wanted soon" checked={meal.soon} onChange={v => setField("soon", v || undefined)} info="wantedSoon" onInfo={setInfo} />
        <SectionCard label="Who eats it" info="whoEats" onInfo={setInfo} onClick={() => setSheet("who")}
          value={whoWords && (typeof whoWords === "string" ? whoWords : whoWords.map((p, k) => <span key={k}>{k ? " · " : ""}{p.strong ? <strong>{p.text}</strong> : p.text}</span>))} />
        <SectionCard label="How often" info="howOften" onInfo={setInfo} onClick={() => setSheet("often")}
          value={isNew && !meal.cadence ? null : [meal.rotation === "manual" && !meal.cadence ? "Hand-picked" : cadenceWord(meal.cadence), last ? `last made ${monthDay(last)}` : null].filter(Boolean).join(" · ")} />
        <SectionCard label="Time needed and cost" info="timeNeeded" onInfo={setInfo} onClick={() => setSheet("time")}
          value={timeCostWords(meal) && <span className="lib-with-clocks">{effort && <Clocks n={effort.n} />}{timeCostWords(meal)}</span>} />
        <div className="lib-section">
          <FieldLabel info="Rotation" onInfo={() => setInfo("rotation")}>Rotation</FieldLabel>
          <div className="lib-card lib-card-static">
            <Segmented label="Rotation" value={meal.rotation || "in"} onChange={v => setField("rotation", v)} options={ROTATION_OPTIONS} />
            <div className="ui-meta lib-rot-line">{cooked ? `Cooked ${cooked} time${cooked === 1 ? "" : "s"}${last ? ` · last ${monthDay(last)}` : ""}` : "Not cooked yet"}</div>
          </div>
        </div>
      </section>

      <section className="lib-group">
        <h2 className="lib-group-head">The plate</h2>
        <div className="lib-section">
          <FieldLabel>Type</FieldLabel>
          <Segmented label="Type" value={meal.type || "dinner"} onChange={v => save(db.meals.map(m => (m.id === meal.id ? { ...m, type: v } : m)))} options={TYPE_OPTIONS} />
        </div>
        <SectionCard label="Style" info="style" onInfo={setInfo} onClick={() => setSheet("style")} problem={gaps.style}
          value={gaps.style ? "Not set · can't keep it apart from similar meals" : (meal.form || []).length + (meal.service || []).length ? <TagList values={[...(meal.form || []), ...(meal.service || [])]} /> : null} />
        <SectionCard label="Plate and feel" info="plateFeel" onInfo={setInfo} onClick={() => setSheet("plate")}
          value={(meal.experience || []).length + (meal.plate || []).length ? <TagList values={[...(meal.experience || []), ...(meal.plate || [])]} /> : null} />
        {!side && <>
          <SwitchRow title="No sides needed" checked={meal.noSidesUnlessNeeded} onChange={v => setField("noSidesUnlessNeeded", v || undefined)} info="noSides" onInfo={setInfo} />
          {!meal.noSidesUnlessNeeded && (
            <SectionCard label={`Sides that go with it${pairIds.length ? ` · ${pairIds.length}` : ""}`} info="pairs" onInfo={setInfo} onClick={() => setSheet("pairs")}
              value={pairNames.length ? pairNames.join(", ") : null} />
          )}
        </>}
        {side && <>
          <SectionCard label="Goes with" info="goesWith" onInfo={setInfo} onClick={() => setSheet("pairs")} problem={gaps.goesWith}
            value={gaps.goesWith ? "Not set · never offered as a side" : pairNames.length ? <strong>{pairNames.join(", ")}</strong> : null} />
          <SectionCard label="Avoid on the plate" info="avoid" onInfo={setInfo} onClick={() => setSheet("avoid")}
            value={(meal.avoidPlate || []).length ? <TagList values={meal.avoidPlate} /> : null} />
          <SwitchRow title="Can be someone's dinner" checked={meal.substantial} onChange={v => setField("substantial", v || undefined)} info="substantial" onInfo={setInfo} />
        </>}
      </section>

      <section className="lib-group">
        <h2 className="lib-group-head">Cooking</h2>
        <SectionCard label="Leftovers" info="leftovers" onInfo={setInfo} onClick={() => setSheet("left")} value={leftoversWords(meal)} />
        <SectionCard label="Weather" info="weather" onInfo={setInfo} onClick={() => setSheet("weather")} value={weatherWords(meal)} />
      </section>

      <section className="lib-group">
        <h2 className="lib-group-head">Shopping</h2>
        <SectionCard label="Ingredients" onClick={() => setSheet("ingredients")} problem={!!gaps.nothingToBuy}
          value={gaps.nothingToBuy ? `Nothing to buy for ${dayShort(gaps.nothingToBuy)}`
            : ingNames.length ? <>{ingNames.slice(0, 5).join(", ")}{ingNames.length > 5 && <span className="lib-more"> +{ingNames.length - 5}</span>}</> : null} />
        {!ingNames.length && <button type="button" className="ui-link lib-paste-link" onClick={() => setSheet("paste")}>Paste a recipe</button>}
        <SectionCard label="Recipe link" onClick={() => setSheet("link")} value={meal.link ? linkWords(meal.link) : null} />
      </section>

      <section className="lib-group">
        <h2 className="lib-group-head">Notes</h2>
        <SectionCard onClick={() => setSheet("notes")} value={(meal.notes || "").trim() ? <span className="lib-notes">{meal.notes}</span> : null} />
        <DeleteButton onClick={() => setSheet("delete")}>Delete meal</DeleteButton>
      </section>

      {open}
      {info && <InfoSheet topic={info} onClose={() => setInfo(null)} />}
    </div>
  );
}
