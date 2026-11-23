// The meal page (boards "Meal page, all fields", "Meal page", "Scrolling pattern"; Decisions
// 11/14–11/15). Every schema field, organised in five groups that each stick on scroll:
//   Planning: Wanted soon · Who eats it · How often · Time needed and cost · Rotation
//   The plate: Type · Style · Plate and feel · mains: No sides needed + Sides that go with it
//              (hidden, not cleared, while No sides needed is on) · sides: Goes with ·
//              Avoid on the plate · Can be someone's dinner
//   Cooking: Leftovers · Weather     Shopping: Ingredients (+ Paste a recipe) · Recipe link
//   Notes, then Delete meal (speed bump).
// Compact rows (11/16, "Meal page density" B): each group is one card of rows, label + ⓘ left,
// a short value right; a tap opens that row's sheet, which saves as you go. Switches sit in their
// row; Type and Rotation keep their segmented control under the label. A problem row has an
// amber value and its group's card gets the amber outline. Back names the previous screen. The large title collapses into the bar on scroll;
// ✎ renames in place (renameMeal: plans and history follow, the record stays the same).
// Finish-the-entry gaps are amber only for a meal in rotation or planned; learn-over-time
// fields read "Not set" quietly.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { todayLocalISO } from "../app/globals.js";
import { mealNameProblem, renameMeal } from "../mealRename.js";
import { FACET_VOCAB } from "../app/vocab.js";
import { Clocks, DeleteButton, FieldLabel, Icon, Segmented, Switch } from "../ui/kit.jsx";
import { sendToAI } from "../app/sendToAI.js";
import { StepChevron, StepPill, sentLabel, stepStates, useTrip } from "../shell/AiSteps.jsx";
import { ReimportPill } from "../shell/ReimportPill.jsx";
import {
  DeleteSheet, HowOftenSheet, InfoSheet, IngredientsSheet, LeftoversSheet, PairsSheet,
  TagSheet, TextSheet, TimeCostSheet, WeatherSheet, WhoEatsSheet,
} from "./LibrarySheets.jsx";
import { showToast } from "../ui/toast.js";
import {
  EFFORT_OPTIONS, ROTATION_OPTIONS, TYPE_OPTIONS, cadenceWord, dayShort, facetWord, isSide,
  mealDeleteImpact, mealGaps, mealHistoryIndex, monthDay, pairIdsOf,
  weatherWords, withField, withPairs, withoutMeal,
} from "./libraryModel.js";

// The page's title bar and big title, shared with the item page.
// `backLabel` names the screen you came from (11/16); long names read "Back".
export function PageHeader({ name, sub, onBack, backLabel = "Library", onRename, renameProblem, renameExtra }) {
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
          ? <button type="button" className="lib-back" onClick={onBack}><span aria-hidden="true">‹</span> {backLabel.length > 16 ? "Back" : backLabel}</button>
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

// A section: label (+ ⓘ) over a white card that opens its sheet. `problem`: a field problem
// on a detail page (brief, field problems): a 1.5px amber outline and amber text.
export function SectionCard({ label, info, onInfo, value, problem, onClick, children }) {
  return (
    <div className="lib-section">
      {label && <FieldLabel info={label} onInfo={info ? () => onInfo(info) : undefined}>{label}</FieldLabel>}
      <button type="button" className={problem ? "lib-card lib-card-problem" : "lib-card"} onClick={onClick}>
        <span className="lib-card-body">
          {children || (value == null ? <span className="lib-notset">Not set</span> : value)}
        </span>
        <svg aria-hidden="true" className="ui-chevron-icon lib-card-chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l6 6-6 6" /></svg>
      </button>
    </div>
  );
}

// Compact rows (11/16, board "Meal page density", option B): each group is one card of rows;
// label + ⓘ on the left, a short value on the right, chevron. A problem row has an amber value
// and its group's card gets the amber outline.
const Info = ({ label, topic, onInfo }) => (topic
  ? <button type="button" className="ui-info" aria-label={"About " + label} onClick={e => { e.stopPropagation(); onInfo(topic); }}><Icon name="info" size={18} /></button>
  : null);
const GroupCard = ({ problem, children }) => <div className={problem ? "lib-gcard lib-card-problem" : "lib-gcard"}>{children}</div>;
// `stacked` (tag rows, 11/16): label, ⓘ and chevron on the first line, the values under it,
// grey and free to wrap. Any other value that doesn't fit beside its label stacks the same way;
// an empty row stays on one line. `dim`: a field that doesn't apply (How often on Hand-picked).
const Chev = () => <svg aria-hidden="true" className="ui-chevron-icon lib-card-chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l6 6-6 6" /></svg>;
function FieldRow({ label, info, onInfo, value, problem, onClick, stacked, dim }) {
  const textRef = useRef(null);
  const [tooLong, setTooLong] = useState(false);
  const key = typeof value === "string" ? value : null;
  useLayoutEffect(() => {
    if (stacked || key === null) return;
    setTooLong(false);
  }, [key, stacked]);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!stacked && !tooLong && el && el.scrollWidth > el.clientWidth + 1) setTooLong(true);
  });
  const stack = value != null && (stacked || tooLong);
  const cls = ["lib-row", stack ? "lib-row-stacked" : "", dim ? "lib-row-dim" : ""].filter(Boolean).join(" ");
  const go = e => { e.stopPropagation(); onClick(); };
  if (stack && !label) return (   // no label (Notes): the text wraps beside the chevron
    <div className={cls + " lib-row-nolabel"} onClick={onClick}>
      <div className={problem ? "lib-row-below lib-row-problem" : "lib-row-below"}>{value}</div>
      <button type="button" className="lib-row-go" aria-label="Open" onClick={go}><Chev /></button>
    </div>
  );
  if (stack) return (
    <div className={cls} onClick={onClick}>
      <div className="lib-row-head">
        {label && <span className="lib-row-label">{label}<Info label={label} topic={info} onInfo={onInfo} /></span>}
        <button type="button" className="lib-row-go" aria-label={label || "Open"} onClick={go}><Chev /></button>
      </div>
      <div className={problem ? "lib-row-below lib-row-problem" : "lib-row-below"}>{value}</div>
    </div>
  );
  return (
    <div className={cls} onClick={onClick}>
      {label && <span className="lib-row-label">{label}<Info label={label} topic={info} onInfo={onInfo} /></span>}
      <button type="button" className={problem ? "lib-row-value lib-row-problem" : "lib-row-value"} aria-label={label || undefined} onClick={go}>
        <span className="lib-row-text" ref={textRef}>{value == null ? <span className="lib-notset">Not set</span> : value}</span>
        <Chev />
      </button>
    </div>
  );
}
const SwitchField = ({ label, info, onInfo, checked, onChange }) => (
  <div className="lib-row lib-row-switch">
    <span className="lib-row-label">{label}<Info label={label} topic={info} onInfo={onInfo} /></span>
    <Switch checked={!!checked} onChange={onChange} label={label} />
  </div>
);
// Type and Rotation keep their segmented control inside the card, under the label.
const StackField = ({ label, info, onInfo, meta, children }) => (
  <div className="lib-row lib-row-stack">
    <span className="lib-row-label">{label}<Info label={label} topic={info} onInfo={onInfo} /></span>
    {children}
    {meta && <span className="ui-meta">{meta}</span>}
  </div>
);

export function MealPage({ db, persistDB, mealId, onBack, backLabel = "Library" }) {
  const today = todayLocalISO();
  const meal = (db.meals || []).find(m => m.id === mealId);
  const [sheet, setSheet] = useState(null);   // which section's sheet is open
  const [info, setInfo] = useState(null);
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

  // The subline drops the type: Main or side has its own card (11/16).
  const sub = planned ? `Planned ${dayShort(planned)}` : "";
  const effort = EFFORT_OPTIONS.find(o => o.value === meal.effort);
  const cooked = hist.count(meal.name);

  let open = null;
  if (sheet === "who") open = <WhoEatsSheet meal={meal} family={family} onChange={p => setField("preferences", p.length ? p : [])} onClose={close} />;
  if (sheet === "often") open = <HowOftenSheet meal={meal} onField={setField} onClose={close} />;
  if (sheet === "time") open = <TimeCostSheet meal={meal} onField={setField} onClose={close} noCost={side} />;
  if (sheet === "style") open = <TagSheet title="Style" onClose={close} groups={[
    { label: "Form", info: "style", options: FACET_VOCAB.form, value: meal.form, onChange: v => setField("form", v) },
    { label: "Service", info: "style", options: FACET_VOCAB.service, value: meal.service, onChange: v => setField("service", v) },
  ]} />;
  if (sheet === "plate") open = <TagSheet title={side ? "Plate" : "Plate and feel"} onClose={close} groups={[
    ...(side ? [] : [{ label: "Feel", info: "plateFeel", options: FACET_VOCAB.experience, value: meal.experience, onChange: v => setField("experience", v) }]),
    { label: "Plate", info: side ? "plate" : "plateFeel", options: FACET_VOCAB.plate, value: meal.plate, onChange: v => setField("plate", v) },
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
    open = <DeleteSheet name={meal.name} lines={lines} onClose={close} onDelete={() => { persistDB(withoutMeal(db, meal.id)); onBack(); showToast(`Deleted ${meal.name}`); }} />;
  }

  // Short values (11/16: kept short so nothing wraps; the full detail is in each row's sheet).
  const prefs = (meal.preferences || []).filter(p => p.pref === "likes" || p.pref === "dislikes");
  const likeN = prefs.filter(p => p.pref === "likes").length;
  const wont = family.map(f => f.name).filter(n => prefs.some(p => p.person === n && p.pref === "dislikes"));
  const fineN = family.length - likeN - wont.length;
  const whoShort = !prefs.length ? (isNew ? null : "Everyone fine")
    : <>{[likeN ? `${likeN} like` : null, ...wont.map(n => <strong key={n}>{n} won't</strong>), fineN > 0 ? `${fineN} fine` : null]
        .filter(Boolean).map((p, k) => <span key={k}>{k ? " · " : ""}{p}</span>)}</>;
  // How often: the choice only (the last-made date shows once, under Rotation); "Not used" on Hand-picked.
  const handPicked = meal.rotation === "manual";
  const howShort = handPicked ? "Not used" : meal.cadence ? cadenceWord(meal.cadence) : null;
  const cost = meal.cost && meal.cost !== "none" ? meal.cost[0].toUpperCase() + meal.cost.slice(1) : null;
  const timeShort = effort ? <span className="lib-with-clocks"><Clocks n={effort.n} />{[effort.label, side ? null : cost].filter(Boolean).join(" · ")}</span> : null;
  // Tag rows (11/16): every value as plain text joined with " · ", stacked under the label.
  const tags = values => (values.length ? values.map(facetWord).join(" · ") : null);
  const names = list => (list.length ? list.join(" · ") : null);
  const c = meal.carries;
  const leftShort = !c ? (isNew ? null : "None")
    : `${Array.isArray(c.forWhom) ? (c.forWhom.length ? (c.forWhom.length < 3 ? c.forWhom.join(", ") : `${c.forWhom.length} people`) : "Nobody") : c.forWhom === "all" ? "Everyone" : "Who likes it"} · ${c.lastsDays} day${c.lastsDays === 1 ? "" : "s"}`;
  const ingShort = gaps.nothingToBuy ? "Nothing to buy" : ingNames.length ? `${ingNames.length} item${ingNames.length === 1 ? "" : "s"}` : null;
  const notes = (meal.notes || "").trim();

  return (
    <div className="lib-page">
      <PageHeader name={meal.name} sub={sub} onBack={onBack} backLabel={backLabel}
        renameProblem={n => mealNameProblem(db.meals, meal.id, n)}
        onRename={n => { const base = renameMeal(db, meal.id, n); persistDB({ ...base, meals: base.meals.map(m => (m.id === meal.id ? { ...m, name: n } : m)) }); }} />

      {/* Main or side (11/16, Ruling 18): one row, no heading; a small control, not a tab bar. */}
      <section className="lib-group">
        <GroupCard>
          <div className="lib-row lib-row-switch">
            <span className="lib-row-label">Main or side<Info label="Main or side" topic="type" onInfo={setInfo} /></span>
            <div className="lib-type-seg">
              <Segmented label="Main or side" value={side ? "side" : "dinner"} onChange={v => save(db.meals.map(m => (m.id === meal.id ? { ...m, type: v } : m)))} options={TYPE_OPTIONS} />
            </div>
          </div>
        </GroupCard>
      </section>

      <section className="lib-group">
        <h2 className="lib-group-head">Planning</h2>
        <GroupCard>
          <SwitchField label="Wanted soon" info="wantedSoon" onInfo={setInfo} checked={meal.soon} onChange={v => setField("soon", v || undefined)} />
          <FieldRow label="Who eats it" info="whoEats" onInfo={setInfo} value={whoShort} onClick={() => setSheet("who")} />
          <FieldRow label="How often" info="howOften" onInfo={setInfo} value={howShort} dim={handPicked} onClick={() => setSheet("often")} />
          <FieldRow label={side ? "Time needed" : "Time and cost"} info="timeNeeded" onInfo={setInfo} value={timeShort} onClick={() => setSheet("time")} />
          <StackField label="Rotation" info="rotation" onInfo={setInfo}
            meta={cooked ? `Cooked ${cooked} time${cooked === 1 ? "" : "s"}${last ? ` · last ${monthDay(last)}` : ""}` : "Not cooked yet"}>
            <Segmented label="Rotation" value={meal.rotation || "in"} onChange={v => setField("rotation", v)} options={ROTATION_OPTIONS} />
          </StackField>
        </GroupCard>
      </section>

      <section className="lib-group">
        <h2 className="lib-group-head">The plate</h2>
        <GroupCard problem={gaps.style}>
          {/* A side hides Style, Feel, Day feel and Cost (inert for sides, Ruling 18); their values are kept. */}
          {!side && <FieldRow label="Style" info="style" onInfo={setInfo} problem={gaps.style} onClick={() => setSheet("style")} stacked
            value={tags([...(meal.form || []), ...(meal.service || [])])} />}
          <FieldRow label={side ? "Plate" : "Plate and feel"} info={side ? "plate" : "plateFeel"} onInfo={setInfo} onClick={() => setSheet("plate")} stacked
            value={tags(side ? (meal.plate || []) : [...(meal.experience || []), ...(meal.plate || [])])} />
          {!side && <>
            <SwitchField label="No sides needed" info="noSides" onInfo={setInfo} checked={meal.noSidesUnlessNeeded} onChange={v => setField("noSidesUnlessNeeded", v || undefined)} />
            {!meal.noSidesUnlessNeeded && (
              <FieldRow label="Sides that go with it" info="pairs" onInfo={setInfo} onClick={() => setSheet("pairs")} stacked value={names(pairNames)} />
            )}
          </>}
          {side && <>
            <FieldRow label="Goes with" info="goesWith" onInfo={setInfo} onClick={() => setSheet("pairs")} stacked value={names(pairNames)} />
            <FieldRow label="Avoid on the plate" info="avoid" onInfo={setInfo} onClick={() => setSheet("avoid")} stacked value={tags(meal.avoidPlate || [])} />
            <SwitchField label="Can be someone's dinner" info="substantial" onInfo={setInfo} checked={meal.substantial} onChange={v => setField("substantial", v || undefined)} />
          </>}
        </GroupCard>
      </section>

      <section className="lib-group">
        <h2 className="lib-group-head">Cooking</h2>
        <GroupCard>
          <FieldRow label="Leftovers" info="leftovers" onInfo={setInfo} onClick={() => setSheet("left")} value={leftShort} />
          {side
            ? <SwitchField label="Grillable" info="grillable" onInfo={setInfo} checked={meal.grillable} onChange={v => setField("grillable", v)} />
            : <FieldRow label="Weather" info="weather" onInfo={setInfo} onClick={() => setSheet("weather")} value={weatherWords(meal)} />}
        </GroupCard>
      </section>

      <section className="lib-group">
        <h2 className="lib-group-head">Shopping</h2>
        <GroupCard problem={!!gaps.nothingToBuy}>
          <FieldRow label="Ingredients" problem={!!gaps.nothingToBuy} onClick={() => setSheet("ingredients")} value={ingShort} />
          <FieldRow label="Recipe link" onClick={() => setSheet("link")} value={meal.link ? "Set" : null} />
        </GroupCard>
        {!ingNames.length && <button type="button" className="ui-link lib-paste-link" onClick={() => setSheet("paste")}>Paste a recipe</button>}
      </section>

      <section className="lib-group">
        <h2 className="lib-group-head">Notes</h2>
        <GroupCard><FieldRow onClick={() => setSheet("notes")} value={notes ? <span className="lib-row-note">{notes}</span> : null} /></GroupCard>
        {/* Fill in this one meal with AI (board "Fill in existing meals with AI", 11/15), as the
            two AI steps (11/23). */}
        <FillWithAI db={db} persistDB={persistDB} mealId={meal.id} />
        <DeleteButton onClick={() => setSheet("delete")}>Delete meal</DeleteButton>
      </section>

      {open}
      {info && <InfoSheet topic={info} onClose={() => setInfo(null)} />}
    </div>
  );
}

// "Fill in with AI" above Delete: ① Send to AI (this meal) › ② Re-import (the file picker).
function FillWithAI({ db, persistDB, mealId }) {
  const sentAt = useTrip(`enrich:${mealId}`);
  const [s1, s2] = stepStates(sentAt);
  return (
    <div className="trip trip-card">
      <div className="trip-head"><span className="trip-title">Fill in with AI</span>{sentAt && <span className="trip-status">{sentLabel(sentAt)}</span>}</div>
      <div className="trip-steps">
        <StepPill n={1} state={s1} onClick={() => sendToAI(db, persistDB, { purpose: "enrich", meals: [mealId] })}>Send to AI</StepPill>
        <StepChevron />
        <ReimportPill db={db} persistDB={persistDB} step={s2} />
      </div>
    </div>
  );
}
