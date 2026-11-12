// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { CONSTANTS as ENGINE } from "../engine/composeWeek.js";
import { DEFAULT_PANTRY_IGNORE, analyseLine, analyseRecipe, cleanName, ignoreTermFor } from "../ingredientMatch.js";
import { mealNameProblem } from "../mealRename.js";
import React, { useState } from "react";
import { EFFORTS, FAMILY_NAMES, MEAL_TYPES, TEMP_AFFINITY_OPTIONS, toSentenceCase } from "../app/globals.js";
import { C, S } from "../app/styles.js";
import { FieldGroup, PillSelect, SearchBar } from "../components/common.jsx";

// ── ENGINE FACETS (SPEC-engine-facet-editor) ─────────────────────────────────
// The fields composeWeek reads that the rest of the editor doesn't cover. Facet values
// are the controlled vocabulary (FACET-VOCABULARY.md, live values only); adding a value
// is a deliberate act there, never free text here. A value a meal already carries that
// isn't listed is shown struck through so it can be removed, never dropped silently.
const FACET_VOCAB = {
  form:       ["casserole","component","stew","plated-entree","finger-food","pasta","sandwich","soup","salad","sauce","bowl","custard-pie"],
  service:    ["home-cooked","takeout","choose-your-own","dine-out"],
  experience: ["hearty","light","picnicky","pubfood","fancy"],
  plate:      ["meaty","starchy","cheesy","bread-based","vegetable-forward","fried","brothy","creamy","salty","seafood","rich","deli-salad","chilled","eggy"],
};
const ROTATION_OPTIONS = ["in","manual","experimental"];
const ROTATION_HELP = {
  in: "In rotation: the engine picks it.",
  manual: "Only when you place it, or while it's flagged soon.",
  experimental: "Untried: placed on an adventurous week, or when flagged soon.",
};
const CADENCE_OPTIONS = ["none","weekly","biweekly"];
const COST_OPTIONS    = ["none","low","moderate","high"];
const CARRY_DAYS      = [1,2,3,4,5,6,7];

// PASTE → REVIEW → CONFIRM. One shape for pasting text into the app (the pattern
// inventory found four paste boxes that each behaved differently). Built for recipe
// paste; the caller supplies how text becomes rows, how a row renders and what
// confirming does. Deliberately no variants until another paste box converts.
function PasteReview({ placeholder, hint, analyse, renderRow, confirmLabel, onConfirm, onCancel }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState(null);
  const update = (i, patch) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  if (!rows) return (
    <div>
      {hint && <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>{hint}</div>}
      <textarea style={{ ...S.input, minHeight:140, fontSize:13, resize:"vertical", marginBottom:8 }} placeholder={placeholder} value={text} onChange={e => setText(e.target.value)} />
      <div style={{ display:"flex", gap:8 }}>
        <button style={{ ...S.btnSm, flex:1, background:text.trim() ? C.primary : "#F3F4F6", color:text.trim() ? "#fff" : C.faint }} disabled={!text.trim()} onClick={() => setRows(analyse(text))}>Review</button>
        <button style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
  const label = confirmLabel(rows);
  return (
    <div>
      <div>{rows.map((r, i) => <React.Fragment key={i}>{renderRow(r, patch => update(i, patch))}</React.Fragment>)}</div>
      <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
        <button style={{ ...S.btnSm, flex:"1 1 160px", background:label ? C.primary : "#F3F4F6", color:label ? "#fff" : C.faint }} disabled={!label} onClick={() => onConfirm(rows)}>{label || "Nothing to add"}</button>
        <button style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted }} onClick={() => setRows(null)}>Back to edit</button>
        <button style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Recipe paste rows (SPEC-recipe-paste). A row is the matcher's result plus what the
// user decides: on (ticked), mode (match/new/ignored/skip), the chosen item or new name.
const recipeRowFrom = (r, existingIds) => {
  const already = r.kind === "match" && existingIds.includes(r.item.id);
  return { ...r, mode: r.kind, already, on: r.kind === "new" || (r.kind === "match" && r.full && !already), menu: false, picking: false, q: "" };
};

function RecipePasteRow({ row, set, ingredients, sideNames, onIgnore, onUnignore }) {
  const text = row.part || row.line;
  const isSide = row.mode === "match" && sideNames.has(row.item.name.trim().toLowerCase());
  const boxable = (row.mode === "match" && !row.already) || row.mode === "new";
  const menuable = row.mode !== "skip" || row.reason !== "heading";
  const picks = row.picking && row.q.trim()
    ? ingredients.filter(i => i.name.toLowerCase().includes(row.q.trim().toLowerCase())).slice(0, 6) : [];
  const link = { background:"none", border:"none", padding:"4px 0", fontSize:12, color:C.primary, cursor:"pointer", textAlign:"left" };
  return (
    <div style={{ padding:"8px 0", borderBottom:`1px solid ${C.border}`, opacity:row.mode === "skip" || row.mode === "ignored" || row.already ? 0.6 : 1 }}>
      <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
        {boxable
          ? <div style={{ ...S.checkBox(row.on), width:20, height:20, marginTop:2 }} onClick={() => set({ on: !row.on })}>{row.on && "✓"}</div>
          : <div style={{ width:20, flexShrink:0 }} />}
        <div style={{ flex:1, minWidth:0, cursor:menuable ? "pointer" : "default" }} onClick={() => menuable && set({ menu: !row.menu, picking: false })}>
          {row.mode === "match" && <div style={{ fontSize:14, fontWeight:500 }}>{row.item.name}
            {!row.full && !row.already && <span style={{ ...S.tag(C.warning, C.warningLight) }}>partial</span>}
            {row.already && <span style={{ fontSize:11, color:C.faint, marginLeft:6 }}>already in this meal</span>}</div>}
          {row.mode === "new" && <div style={{ display:"flex", alignItems:"center", gap:6 }} onClick={e => e.stopPropagation()}>
            <input style={{ ...S.input, marginBottom:0, fontSize:14, padding:"4px 8px" }} value={row.name} onChange={e => set({ name: e.target.value })} />
            <span style={{ ...S.tag(C.accent, C.primaryLight), marginLeft:0, whiteSpace:"nowrap" }}>new item</span></div>}
          {row.mode === "ignored" && <div style={{ fontSize:13, color:C.muted }}>Ignored, on your pantry list</div>}
          {row.mode === "skip" && <div style={{ fontSize:13, color:C.faint }}>{row.reason === "heading" ? "Heading, skipped" : "Skipped"}</div>}
          <div style={{ fontSize:11, color:C.faint, marginTop:2, overflowWrap:"anywhere" }}>{row.line}{row.part ? `  ·  "${row.part}"` : ""}{row.orAlternatives?.length ? `  ·  or ${row.orAlternatives.join(", ")}` : ""}</div>
          {isSide && !row.already && <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>Also a side dish. Ticking it makes it part of this meal's shopping every time.</div>}
          {row.mode === "new" && row.suggestions?.length > 0 && <div style={{ fontSize:12, color:C.muted, marginTop:4 }} onClick={e => e.stopPropagation()}>Did you mean {row.suggestions.map((it, k) => (
            <button key={it.id} style={{ ...link, display:"inline", padding:0, marginRight:6 }} onClick={() => set({ mode:"match", item:it, full:true, on:true })}>{it.name}{k < row.suggestions.length - 1 ? "," : "?"}</button>))}</div>}
        </div>
      </div>
      {row.menu && (
        <div style={{ marginLeft:30, marginTop:4, display:"flex", flexDirection:"column" }}>
          {(row.mode === "match" || row.mode === "new") && <button style={link} onClick={() => set({ picking: !row.picking })}>{row.mode === "match" ? "Choose another item" : "Choose an existing item"}</button>}
          {row.picking && (
            <div>
              <input autoFocus style={{ ...S.input, marginBottom:4, fontSize:13, padding:"6px 8px" }} placeholder="Search items..." value={row.q} onChange={e => set({ q: e.target.value })} />
              {picks.map(it => <button key={it.id} style={{ ...link, display:"block", color:C.text }} onClick={() => set({ mode:"match", item:it, full:true, on:true, picking:false, menu:false, q:"" })}>{it.name}</button>)}
            </div>
          )}
          {row.mode === "match" && <button style={link} onClick={() => set({ mode:"new", name: cleanName(text), suggestions: [], on:true, menu:false })}>Make it a new item</button>}
          {(row.mode === "skip" && row.reason !== "heading") && <button style={link} onClick={() => set({ mode:"new", name: cleanName(text), suggestions: [], on:true, menu:false })}>Add as a new item</button>}
          {row.mode !== "ignored" && ignoreTermFor(text) && <button style={link} onClick={() => onIgnore(ignoreTermFor(text))}>Always ignore "{ignoreTermFor(text)}"</button>}
          {row.mode === "ignored" && <button style={link} onClick={() => onUnignore(row.term)}>Stop ignoring "{row.term}"</button>}
        </div>
      )}
    </div>
  );
}

// Meal search matches descriptors as well as names: the four engine facets (so "pasta",
// "meaty", "soup" find meals tagged that way), the meal type, and the notes.
function mealMatches(m, q) {
  const t = (q || "").trim().toLowerCase();
  if (!t) return true;
  const hay = [m.name, m.type, m.notes, ...(m.form || []), ...(m.service || []), ...(m.experience || []), ...(m.plate || [])];
  return hay.some(v => typeof v === "string" && v.toLowerCase().includes(t));
}

function MultiPick({ options, value, onChange }) {
  const cur = value || [];
  const toggle = o => onChange(cur.includes(o) ? cur.filter(x => x !== o) : [...cur, o]);
  const unknown = cur.filter(v => !options.includes(v));
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>
      {options.map(o => <button key={o} style={S.pill(cur.includes(o))} onClick={() => toggle(o)}>{o}</button>)}
      {unknown.map(v => (
        <button key={v} title="Not in the vocabulary, so the engine ignores it. Tap to remove." style={{ ...S.pill(false), textDecoration:"line-through", color:C.faint }} onClick={() => toggle(v)}>{v} ×</button>
      ))}
    </div>
  );
}

// A searchable checklist of meals (a main's sides, or a side's mains).
function MealChecklist({ meals, selected, onToggle }) {
  const [q, setQ] = useState("");
  const shown = meals.filter(m => m.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (selected.has(b.id) - selected.has(a.id)) || a.name.localeCompare(b.name));
  return (
    <div>
      <SearchBar value={q} onChange={setQ} placeholder="Search..." />
      <div style={{ maxHeight:220, overflowY:"auto" }}>
        {shown.map(m => {
          const sel = selected.has(m.id);
          return (
            <div key={m.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:`1px solid ${C.border}`, cursor:"pointer" }} onClick={() => onToggle(m.id)}>
              <div style={{ width:20, height:20, borderRadius:6, border:sel?"none":`2px solid ${C.border}`, background:sel?C.primary:"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:"#fff", fontSize:12 }}>{sel && "✓"}</div>
              <div style={{ fontSize:14 }}>{m.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Collapsed by default (the editor's everyday view stays as it was); open for a new or
// untagged meal so it is tagged at entry. `pairIds` is the meal's side links either way:
// for a main, the sides whose pairsWith hold it (saved back onto those sides); for a
// side, its own pairsWith.
function EngineFacetsCard({ form, setField, isMain, pairCandidates, pairIds, togglePair, familyMembers, startOpen }) {
  const [open, setOpen] = useState(startOpen);
  const carries = form.carries;
  const carryMode = !carries ? "none" : Array.isArray(carries.forWhom) ? "people" : carries.forWhom;
  const setCarries = c => setField("carries", c);
  const pickMode = mode => {
    if (mode === "none") return setCarries(undefined);
    const lastsDays = carries?.lastsDays || 2;
    setCarries({ forWhom: mode === "people" ? (Array.isArray(carries?.forWhom) ? carries.forWhom : []) : mode, lastsDays });
  };
  const togglePerson = p => {
    const who = Array.isArray(carries?.forWhom) ? carries.forWhom : [];
    setCarries({ ...carries, forWhom: who.includes(p) ? who.filter(x => x !== p) : [...who, p] });
  };
  const summary = [
    form.rotation || "untagged",
    form.soon ? "soon" : null,
    (form.form || []).join("/") || null,
    (form.plate || []).join("/") || null,
    `${pairIds.size} ${isMain ? "side" : "main"}${pairIds.size === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");
  const hint = t => <div style={{ fontSize:11, color:C.faint, marginTop:4 }}>{t}</div>;
  // What the engine does while a field is empty or off. Shown only in that state, and
  // built from the engine's own constants so the numbers can't drift from its behaviour.
  const ifEmpty = (empty, t, lead = "If left empty") => empty && <div style={{ fontSize:11, color:C.muted, marginTop:4, fontStyle:"italic" }}>{lead}: {t}</div>;
  const ifOff = (off, t) => ifEmpty(off, t, "While off");
  const manual = form.rotation === "manual";
  const sidesCap = form.effort === "involved" ? `${ENGINE.MAX_ACCOMPANIMENT_SIDES_INVOLVED_MAIN} easy side (it's an involved meal)` : `${ENGINE.MAX_ACCOMPANIMENT_SIDES} sides`;

  return (
    <div style={S.card}>
      <div style={{ display:"flex", alignItems:"center", cursor:"pointer" }} onClick={() => setOpen(o => !o)}>
        <div style={{ flex:1 }}>
          <div style={S.sectionLabel}>Engine</div>
          {!open && <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{summary}</div>}
        </div>
        <div style={{ color:C.faint, fontSize:14 }}>{open ? "▾" : "▸"}</div>
      </div>
      {open && (
        <div style={{ marginTop:12 }}>
          <FieldGroup label="Rotation">
            <PillSelect options={ROTATION_OPTIONS} value={form.rotation || "in"} onChange={v => setField("rotation", v)} />
            {hint(ROTATION_HELP[form.rotation || "in"])}
            {ifEmpty(!form.rotation, "not set yet, so the engine treats it as in rotation.")}
          </FieldGroup>
          <FieldGroup label="Wanted soon">
            <PillSelect options={["off","on"]} value={form.soon ? "on" : "off"} onChange={v => setField("soon", v === "on" || undefined)} />
            {hint("Puts it forward for the next plan. Cleared by hand: it stays on until you turn it off.")}
            {ifOff(!form.soon, manual ? "a manual meal is used only when you place it." : form.rotation === "experimental" ? "it comes up only on an adventurous week." : "no extra push; it comes up when it fits.")}
          </FieldGroup>
          <FieldGroup label="Cadence">
            <PillSelect options={CADENCE_OPTIONS} value={form.cadence || "none"} onChange={v => setField("cadence", v === "none" ? undefined : v)} />
            {manual ? hint("Ignored while manual.") : form.cadence === "weekly" ? hint(`Wants to come back about weekly; never within ${ENGINE.CADENCE_WEEKLY_MIN_GAP_DAYS} days.`) : form.cadence === "biweekly" ? hint(`Wants to come back about every two weeks; never within ${ENGINE.CADENCE_BIWEEKLY_MIN_GAP_DAYS} days.`) : null}
            {!manual && ifEmpty(!form.cadence, `no pull to come back on a schedule; it just won't repeat within ${ENGINE.UNTAGGED_ANTI_REPEAT_DAYS} days.`)}
          </FieldGroup>
          <FieldGroup label="Form"><MultiPick options={FACET_VOCAB.form} value={form.form} onChange={v => setField("form", v)} />{ifEmpty(!(form.form || []).length, "it is never kept apart from similar meals on nearby nights.")}</FieldGroup>
          <FieldGroup label="Service"><MultiPick options={FACET_VOCAB.service} value={form.service} onChange={v => setField("service", v)} />{ifEmpty(!(form.service || []).length, "treated like home-cooked: not spaced from takeout nights, and sides can be added.")}</FieldGroup>
          <FieldGroup label="Experience"><MultiPick options={FACET_VOCAB.experience} value={form.experience} onChange={v => setField("experience", v)} />{hint("Description only: the engine doesn't use this yet.")}</FieldGroup>
          <FieldGroup label="Plate"><MultiPick options={FACET_VOCAB.plate} value={form.plate} onChange={v => setField("plate", v)} />{ifEmpty(!(form.plate || []).length, isMain ? "no side's \"avoid on the plate\" can rule anything out, so any linked side can go with it." : "it never keeps another side off the plate.")}</FieldGroup>
          <FieldGroup label="Leftovers">
            <PillSelect options={["none","followLikes","all","people"]} value={carryMode} onChange={pickMode} />
            {carryMode !== "none" && hint(carryMode === "followLikes" ? "Whoever likes it eats the leftovers." : carryMode === "all" ? "Everyone eats the leftovers." : "Only the people picked below.")}
            {ifEmpty(carryMode === "none", "the engine won't count on leftovers from this meal to feed anyone on later nights.")}
            {carryMode === "people" && !carries.forWhom.length && hint("Pick at least one person, or the leftovers reach no one.")}
            {carryMode === "people" && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:6 }}>
                {familyMembers.map(p => <button key={p} style={S.pill(carries.forWhom.includes(p))} onClick={() => togglePerson(p)}>{p}</button>)}
              </div>
            )}
            {carries && (
              <div style={{ marginTop:8 }}>
                <div style={{ fontSize:12, color:C.muted }}>Lasts (days)</div>
                <PillSelect options={CARRY_DAYS.map(String)} value={String(carries.lastsDays)} onChange={v => setCarries({ ...carries, lastsDays: Number(v) })} />
              </div>
            )}
            {!carries && form.leftovers && form.leftovers !== "none" && hint("This meal is marked as having leftovers, but the engine doesn't know who eats them. Pick an option above.")}
          </FieldGroup>
          <FieldGroup label="Cost">
            <PillSelect options={COST_OPTIONS} value={form.cost || "none"} onChange={v => setField("cost", v === "none" ? undefined : v)} />
            {ifEmpty(!form.cost, "part of the normal grocery bill; it doesn't count toward keeping a week's spending balanced.")}
          </FieldGroup>
          {isMain ? (
            <>
              <FieldGroup label="No sides needed">
                <PillSelect options={["off","on"]} value={form.noSidesUnlessNeeded ? "on" : "off"} onChange={v => setField("noSidesUnlessNeeded", v === "on" || undefined)} />
                {form.noSidesUnlessNeeded ? hint("Complete on its own. A side is added only to cover someone who won't eat it.") : ifOff(true, `the engine may add up to ${sidesCap} from the sides ticked below.`)}
              </FieldGroup>
              <FieldGroup label={`Sides that go with it (${pairIds.size})`}>
                {ifEmpty(!pairIds.size, "no side is added just to go with it. Someone who won't eat it still gets a covers side they'll eat.")}
                <MealChecklist meals={pairCandidates} selected={pairIds} onToggle={togglePair} />
              </FieldGroup>
            </>
          ) : (
            <>
              <FieldGroup label={`Goes with (${pairIds.size})`}>
                {ifEmpty(!pairIds.size, form.substantial ? "never offered as a goes-with side, but it can still cover someone who won't eat the main." : "never offered as a goes-with side.")}
                {manual && hint("This side is manual: the engine never offers it on its own. Set rotation to \"in\" to have it suggested.")}
                <MealChecklist meals={pairCandidates} selected={pairIds} onToggle={togglePair} />
              </FieldGroup>
              <FieldGroup label="Avoid on the plate">
                <MultiPick options={FACET_VOCAB.plate} value={form.avoidPlate} onChange={v => setField("avoidPlate", v.length ? v : undefined)} />
                {hint("Not offered as a goes-with side when the plate already has any of these.")}
                {ifEmpty(!(form.avoidPlate || []).length, "offered with any main it goes with, whatever else is on the plate.")}
              </FieldGroup>
              <FieldGroup label="Can be someone's dinner">
                <PillSelect options={["off","on"]} value={form.substantial ? "on" : "off"} onChange={v => setField("substantial", v === "on" || undefined)} />
                {form.substantial ? hint("Counts as a covers side for someone who won't eat the main.") : ifOff(true, "it can't cover someone who won't eat the main.")}
              </FieldGroup>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MealEditor({ meal, allMeals, ingredients, onSave, onCancel, onDelete, onAddIngredient, onAddIngredients, pantryIgnore, onSetPantryIgnore, initialName, familyContacts }) {
  const [form, setForm] = useState(meal || { id:"m"+Date.now(), createdAt:new Date().toISOString(), name:toSentenceCase(initialName||""), effort:"medium", type:"dinner", tempAffinity:"neutral", grillable:false, leftovers:"none", rotation:"in", preferences:[], notes:"", ingredients:[] });
  // Real family names live in settings (self included, via role-flag
  // migration — see SPEC-family-roles.md); fall back to the generic constant
  // only when settings hasn't been customized at all.
  const familyMembers = familyContacts && familyContacts.length
    ? familyContacts.map(f => f.name)
    : FAMILY_NAMES;
  const [ingSearch, setIngSearch]   = useState("");
  const [quickAdd, setQuickAdd]     = useState(false);
  const [quickName, setQuickName]   = useState("");
  const set = (k, v) => setForm(p => ({...p, [k]:v}));
  // Engine fields are optional: an "off"/"none" choice removes the key rather than
  // storing a default, so a meal saved without changes stays as it was.
  const setField = (k, v) => setForm(p => { const n = { ...p }; if (v === undefined) delete n[k]; else n[k] = v; return n; });

  // Side links. pairsWith lives on each SIDE (main ids). For a main, the editable set is
  // the sides that name it, written back onto those sides at save; for a side, its own list.
  const isMain   = form.type !== "side";
  const others   = (allMeals || []).filter(m => m.id !== form.id);
  const [mainSides, setMainSides] = useState(() => new Set(others.filter(m => m.type === "side" && (m.pairsWith || []).includes(form.id)).map(m => m.id)));
  const pairIds  = isMain ? mainSides : new Set(form.pairsWith || []);
  const togglePair = id => {
    if (isMain) setMainSides(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    else { const cur = form.pairsWith || []; setField("pairsWith", cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]); }
  };
  const pairCandidates = others.filter(m => isMain ? m.type === "side" : m.type !== "side");
  // Plans and history name meals by name, so a clash would merge two meals' histories.
  const nameProblem = mealNameProblem(allMeals, form.id, form.name);
  const renaming = meal && form.name.trim() !== meal.name;
  const save = () => {
    if (nameProblem) return;
    // The legacy leftovers field still drives the card badge and the fridge report; keep
    // it from contradicting carries (the engine's field): leftovers set → not "none".
    const out = { ...form };
    if (out.carries && (!out.leftovers || out.leftovers === "none")) out.leftovers = "yes";
    if (!out.carries && meal?.carries && out.leftovers === "yes") out.leftovers = "none";   // carries just cleared
    onSave(out, isMain ? mainSides : null);
  };

  const toggleIng = id => {
    const adding = !form.ingredients.includes(id);
    set("ingredients", adding ? [...form.ingredients, id] : form.ingredients.filter(i=>i!==id));
    // On add, clear the search so the field is ready for the next item with
    // fewer taps. On uncheck, leave the search intact.
    if (adding) setIngSearch("");
  };
  const getPref   = person => form.preferences.find(x => x.person===person)?.pref || null;
  const togglePref = (person, pref) => {
    const existing = form.preferences.find(p => p.person===person);
    if (existing && existing.pref===pref) set("preferences", form.preferences.filter(p=>p.person!==person));
    else set("preferences", [...form.preferences.filter(p=>p.person!==person), {person,pref}]);
  };

  const sortedIngs = [...ingredients].sort((a, b) => {
    const as=form.ingredients.includes(a.id), bs=form.ingredients.includes(b.id);
    if(as&&!bs) return -1; if(!as&&bs) return 1; return a.name.localeCompare(b.name);
  }).filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase()));

  // RECIPE PASTE (SPEC-recipe-paste): paste the ingredient list, review every line,
  // confirm once. Changes the form's selection like ticking by hand; new items are
  // created on confirm (as "Add new ingredient…" does) as Unassigned specialty items.
  const [pasting, setPasting] = useState(false);
  const [pasteNote, setPasteNote] = useState(null);
  const ignoreList = pantryIgnore || DEFAULT_PANTRY_IGNORE;
  const sideNames = new Set((allMeals || []).filter(m => m.type === "side").map(m => m.name.trim().toLowerCase()));
  // A row re-analysed against a new ignore list keeps the user's other choices fresh.
  const recheck = (row, list) => {
    const r = analyseLine(row.part || row.line, ingredients, list)[0] || { kind:"skip", reason:"empty" };
    return { ...recipeRowFrom({ ...r, line: row.line, part: row.part }, form.ingredients) };
  };
  const addRecipe = rows => {
    const ids = new Set(form.ingredients);
    const byName = new Map(ingredients.map(i => [i.name.trim().toLowerCase(), i]));
    const created = [];
    for (const r of rows) {
      if (!r.on) continue;
      if (r.mode === "match") ids.add(r.item.id);
      if (r.mode === "new") {
        const name = toSentenceCase((r.name || "").trim());
        if (!name) continue;
        const key = name.toLowerCase();
        const hit = byName.get(key);
        if (hit) { ids.add(hit.id); continue; }
        const ing = { id:"i"+Date.now()+Math.random().toString(36).slice(2,7), createdAt:new Date().toISOString(), name, storageLocation:"Unassigned", tier:"specialty", defaultQuantity:"" };
        byName.set(key, ing); created.push(ing); ids.add(ing.id);
      }
    }
    if (created.length) onAddIngredients(created);
    const added = ids.size - form.ingredients.length;
    set("ingredients", [...ids]);
    setPasting(false);
    setPasteNote(`Added ${added} ingredient${added === 1 ? "" : "s"}${created.length ? `, ${created.length} of them new (Unassigned, set their location in Items)` : ""}. Save the meal to keep them.`);
  };
  const recipeLabel = rows => {
    const ids = new Set(), names = new Set();
    rows.forEach(r => { if (r.on && r.mode === "match") ids.add(r.item.id); if (r.on && r.mode === "new" && (r.name || "").trim()) names.add(r.name.trim().toLowerCase()); });
    const n = ids.size + names.size;
    return n ? `Add ${n} ingredient${n === 1 ? "" : "s"}` : null;
  };

  const doQuickAdd = () => {
    if (!quickName.trim()) return;
    const name   = toSentenceCase(quickName.trim());
    const newIng = { id:"i"+Date.now(), createdAt:new Date().toISOString(), name, storageLocation:"Unassigned", tier:"specialty", defaultQuantity:"" };
    onAddIngredient(newIng);
    set("ingredients", [...form.ingredients, newIng.id]);
    setQuickName(""); setQuickAdd(false); setIngSearch("");
  };

  return (
    <div>
      <div style={{ ...S.card, background:C.primary, color:"#fff", marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:700, opacity:0.7, marginBottom:4 }}>{meal?"EDIT MEAL":"NEW MEAL"}</div>
        <div style={{ fontSize:18, fontWeight:700 }}>{form.name||"Untitled"}</div>
      </div>
      <div style={S.card}>
        <FieldGroup label="Meal name">
          <input style={S.input} value={form.name} onChange={e => set("name", toSentenceCase(e.target.value))} placeholder="e.g. Mexican nite" />
          {form.name.trim() && nameProblem && <div style={{ fontSize:12, color:C.danger, marginTop:4 }}>{nameProblem}</div>}
          {renaming && !nameProblem && <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>Saving renames it in your plans and history too, so its list, leftovers and last-served date stay with it.</div>}
        </FieldGroup>
        <FieldGroup label="Type"><PillSelect options={MEAL_TYPES} value={form.type} onChange={v => set("type",v)} /></FieldGroup>
        <FieldGroup label="Effort"><PillSelect options={EFFORTS} value={form.effort} onChange={v => set("effort",v)} /></FieldGroup>
        <FieldGroup label="Day feel (affinity)"><PillSelect options={TEMP_AFFINITY_OPTIONS} value={form.tempAffinity || "neutral"} onChange={v => set("tempAffinity",v)} /></FieldGroup>
        <FieldGroup label="Grillable">
          <div style={{ display:"flex", gap:8 }}>
            <button style={{ ...S.btnSm, background:form.grillable?C.primaryLight:"#F3F4F6", color:form.grillable?C.primary:C.muted, fontWeight:form.grillable?700:500 }} onClick={() => set("grillable",true)}>Yes</button>
            <button style={{ ...S.btnSm, background:!form.grillable?C.dangerLight:"#F3F4F6", color:!form.grillable?C.danger:C.muted, fontWeight:!form.grillable?700:500 }} onClick={() => set("grillable",false)}>No</button>
          </div>
        </FieldGroup>
        <FieldGroup label="Notes"><input style={S.input} value={form.notes} onChange={e => set("notes",e.target.value)} placeholder="Cooking notes..." /></FieldGroup>
      </div>
      <div style={S.card}>
        <div style={S.sectionLabel}>Family preferences</div>
        <div style={{ fontSize:11, color:C.muted, fontStyle:"italic", marginTop:2 }}>If left empty for someone: the engine counts them as willing to eat it. Only 👎 makes it plan around them; 👍 nudges the meal up a little.</div>
        {familyMembers.map(person => (
          <div key={person} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
            <div style={{ fontWeight:600, fontSize:14 }}>{person}</div>
            <div style={{ display:"flex", gap:6 }}>
              {["likes","dislikes"].map(pref => (
                <button key={pref} style={{ ...S.btnSm, background:getPref(person)===pref?(pref==="likes"?C.primaryLight:C.dangerLight):"#F3F4F6", color:getPref(person)===pref?(pref==="likes"?C.primary:C.danger):C.muted, fontWeight:getPref(person)===pref?700:500 }} onClick={() => togglePref(person,pref)}>
                  {pref==="likes"?"👍 Likes":"👎 Dislikes"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <EngineFacetsCard form={form} setField={setField} isMain={isMain} pairCandidates={pairCandidates} pairIds={pairIds} togglePair={togglePair} familyMembers={familyMembers} startOpen={!meal || !ROTATION_OPTIONS.includes(meal.rotation)} />
      <div style={S.card}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
          <div style={S.sectionLabel}>Ingredients ({form.ingredients.length} selected)</div>
          {!pasting && onAddIngredients && <button style={{ background:"none", border:"none", color:C.primary, fontSize:13, fontWeight:600, cursor:"pointer", padding:"2px 0" }} onClick={() => { setPasting(true); setPasteNote(null); }}>Paste a recipe</button>}
        </div>
        {pasteNote && !pasting && <div style={{ fontSize:12, lineHeight:1.4, margin:"6px 0", padding:"6px 8px", borderRadius:6, background:C.primaryLight, color:C.primary }}>{pasteNote}</div>}
        {pasting ? (
          <PasteReview
            hint="Paste the recipe's ingredient list, one ingredient per line."
            placeholder={"2 cups shredded cheddar cheese\n1 yellow onion, chopped\n…"}
            analyse={text => analyseRecipe(text, ingredients, ignoreList).map(r => recipeRowFrom(r, form.ingredients))}
            confirmLabel={recipeLabel}
            onConfirm={addRecipe}
            onCancel={() => setPasting(false)}
            renderRow={(row, setRow) => (
              <RecipePasteRow row={row} set={setRow} ingredients={ingredients} sideNames={sideNames}
                onIgnore={term => { const list = [...ignoreList, term]; onSetPantryIgnore(list); setRow(recheck(row, list)); }}
                onUnignore={term => { const list = ignoreList.filter(t => t !== term); onSetPantryIgnore(list); setRow(recheck(row, list)); }} />
            )}
          />
        ) : (<>
        <SearchBar value={ingSearch} onChange={setIngSearch} placeholder="Search ingredients..." />
        <div style={{ maxHeight:280, overflowY:"auto" }}>
          {sortedIngs.map(ing => {
            const sel = form.ingredients.includes(ing.id);
            return (
              <div key={ing.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
                <div style={{ width:22, height:22, borderRadius:6, border:sel?"none":`2px solid ${C.border}`, background:sel?C.primary:"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:"#fff", fontSize:13, cursor:"pointer" }} onClick={() => toggleIng(ing.id)}>
                  {sel && "✓"}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:500 }}>{ing.name}</div>
                  <div style={{ fontSize:11, color:C.faint }}>{ing.storageLocation} · {ing.tier}</div>
                </div>
              </div>
            );
          })}
          {quickAdd ? (
            <div style={{ padding:"10px 0", borderTop:`1px solid ${C.border}` }}>
              <div style={{ fontSize:12, color:C.muted, marginBottom:6, fontWeight:600 }}>New ingredient:</div>
              <div style={{ display:"flex", gap:8 }}>
                <input autoFocus style={{ ...S.input, flex:1, fontSize:14, padding:"8px 10px" }} placeholder={ingSearch||"e.g. Cream cheese"} value={quickName} onChange={e => setQuickName(e.target.value)} onKeyDown={e => { if(e.key==="Enter") doQuickAdd(); if(e.key==="Escape"){setQuickAdd(false);setQuickName("");} }} />
                <button style={{ ...S.btnSm, background:C.primary, color:"#fff" }} onClick={doQuickAdd}>Add</button>
                <button style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted }} onClick={() => {setQuickAdd(false);setQuickName("");}}>×</button>
              </div>
              <div style={{ fontSize:11, color:C.faint, marginTop:4 }}>Saves as Unassigned — set location in Items tab</div>
            </div>
          ) : (
            <div style={{ padding:"12px 4px", display:"flex", alignItems:"center", gap:8, cursor:"pointer", color:C.primary, fontWeight:600, fontSize:14 }} onClick={() => {setQuickAdd(true);setQuickName(ingSearch);}}>
              <div style={{ width:22, height:22, borderRadius:6, border:`2px dashed ${C.primary}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>+</div>
              {ingSearch ? `Add "${ingSearch}" as new` : "Add new ingredient..."}
            </div>
          )}
        </div>
        </>)}
      </div>
      <button style={{ ...S.btn, ...S.btnP, ...(nameProblem ? { opacity:0.5, cursor:"default" } : {}) }} disabled={!!nameProblem} onClick={save}>Save meal</button>
      <button style={{ ...S.btn, ...S.btnS }} onClick={onCancel}>Cancel</button>
      {meal && <div style={{ ...S.btn, ...S.btnD, cursor:"pointer" }} onClick={() => onDelete(meal.id)}>Delete meal</div>}
    </div>
  );
}

export { MealEditor, mealMatches };
