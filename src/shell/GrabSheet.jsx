// Grab (quick capture; board "Grab sheet" 11/13, recipe round trip 11/15). Opened by the + in
// the tab bar over any screen, by a Library search with no results, or by a link carrying
// ?name= and &link= (an iOS Share Shortcut).
//   Meal: Name · Link · Recipe (text, with Paste) · Main | Side.
//     [Save] filled (needs a name) · [Send to AI] › [Re-import], the Calendar sync pair
//     (Send needs a link or recipe text; the AI names the meal, so no name is needed) ·
//     "Add details" text (saves, then opens the meal page). A saved meal is New with Wanted
//     soon on. Grab stays open after Send to AI (the app survives the trip, 11/16); Re-import
//     opens the file picker, then "Load this file?", and loading closes Grab.
//   Item: Name · Where it lives · How often (Always · Weekly · Slow; none = For meals).
//     [Add details] | [Save] side by side.
import { useState } from "react";
import { INVENTORY_LOCS, toSentenceCase } from "../app/globals.js";
import { sendToAI } from "../app/sendToAI.js";
import { BlockButton, Chip, Field, OutlineButton, Segmented, Sheet } from "../ui/kit.jsx";
import { ReimportPill } from "./ReimportPill.jsx";
import { StepChevron, StepPill, sentLabel, stepStates, useTrip } from "./AiSteps.jsx";
import { showToast } from "../ui/toast.js";

const newId = p => p + Date.now() + Math.random().toString(36).slice(2, 6);

async function clipboardText() {
  try {
    if (navigator.clipboard?.read) {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t === "text/plain") || item.types.find(t => t.startsWith("text/"));
        if (type) return await (await item.getType(type)).text();
      }
      return "";
    }
    return (await navigator.clipboard?.readText?.()) || "";
  } catch { return ""; }
}

export function GrabSheet({ db, persistDB, init = {}, onClose, onOpenPage }) {
  const [kind, setKind] = useState(init.kind || "meal");
  const [name, setName] = useState(init.name || "");
  const [link, setLink] = useState(init.link || "");
  const [text, setText] = useState(init.text || "");
  const [role, setRole] = useState(init.role || "main");
  const [place, setPlace] = useState(null);
  const [often, setOften] = useState(null);   // always | weekly | slow | null (For meals)
  const clean = toSentenceCase(name.trim());

  const saveMeal = () => {
    const id = newId("m");
    const meal = { id, createdAt: new Date().toISOString(), name: clean, type: role === "side" ? "side" : "dinner", rotation: "experimental", soon: true,
      leftovers: "none", preferences: [], notes: "", ingredients: [], ...(link.trim() ? { link: link.trim() } : {}) };
    persistDB({ ...db, meals: [...(db.meals || []), meal] });
    showToast(`Grabbed ${clean}`);
    return id;
  };
  const saveItem = () => {
    const id = newId("i");
    const buy = often === "always" ? { tier: "always" } : often ? { tier: "staple", stapleType: often } : { tier: "specialty" };
    persistDB({ ...db, ingredients: [...(db.ingredients || []), { id, createdAt: new Date().toISOString(), name: clean, storageLocation: place || "Unassigned", ...buy, defaultQuantity: "" }] });
    showToast(`Grabbed ${clean}`);
    return id;
  };
  const send = async () => {
    await sendToAI(db, persistDB, { purpose: "recipe", name: clean, link: link.trim(), text: text.trim(), role });   // the bar says "Prompt copied"
  };

  const nameTaken = kind === "meal" && clean && (db.meals || []).some(m => m.name.trim().toLowerCase() === clean.toLowerCase());
  const canSave = !!clean && !nameTaken;
  const canSend = !!(link.trim() || text.trim());
  const sentAt = useTrip("recipe");
  const [s1, s2] = stepStates(sentAt);

  return (
    <Sheet title={kind === "meal" ? "Grab a meal" : "Grab an item"} onClose={onClose} doneLabel="Cancel"
      footer={kind === "meal" ? (
        <div className="grab-footer">
          <BlockButton onClick={() => { if (canSave) { saveMeal(); onClose(); } }} disabled={!canSave}>Save</BlockButton>
          <div className="grab-ai">
            <StepPill n={1} state={s1} onClick={() => canSend && send()} disabled={!canSend}>Send to AI</StepPill>
            <StepChevron />
            <ReimportPill db={db} persistDB={persistDB} onLoaded={onClose} step={s2} />
          </div>
          {sentAt && <div className="trip-sent">{sentLabel(sentAt)}</div>}
          <button type="button" className="ui-link grab-details" disabled={!canSave} onClick={() => { const id = saveMeal(); onClose(); onOpenPage({ kind: "meal", id }); }}>Add details</button>
        </div>
      ) : (
        <div className="grab-footer grab-footer-row">
          <OutlineButton onClick={() => { if (canSave) { const id = saveItem(); onClose(); onOpenPage({ kind: "item", id }); } }} disabled={!canSave}>Add details</OutlineButton>
          <BlockButton onClick={() => { if (canSave) { saveItem(); onClose(); } }} disabled={!canSave}>Save</BlockButton>
        </div>
      )}>
      <Segmented label="Meal or item" value={kind} onChange={setKind} options={[{ value: "meal", label: "Meal" }, { value: "item", label: "Item" }]} />
      <Field label="Name">
        <input className="ui-input" aria-label="Name" value={name} onChange={e => setName(e.target.value)} />
        {nameTaken && <div className="ui-problem">{`"${clean}" is already a meal`}</div>}
      </Field>
      {kind === "meal" ? <>
        <Field label="Link">
          <input className="ui-input" aria-label="Link" inputMode="url" autoCapitalize="off" value={link} onChange={e => setLink(e.target.value)} />
        </Field>
        <div className="ui-field">
          <div className="grab-label-row">
            <span className="ui-section-label">Recipe</span>
            <button type="button" className="ui-link" onClick={async () => { const t = await clipboardText(); if (t) setText(t); }}>Paste</button>
          </div>
          <textarea className="ui-textarea grab-recipe" aria-label="Recipe" value={text} onChange={e => setText(e.target.value)} />
        </div>
        <Segmented label="Main or side" value={role} onChange={setRole} options={[{ value: "main", label: "Main" }, { value: "side", label: "Side" }]} />
      </> : <>
        <Field label="Where it lives">
          <div className="ui-chips">{INVENTORY_LOCS.map(l => <Chip key={l} on={place === l} onClick={() => setPlace(place === l ? null : l)}>{l}</Chip>)}</div>
        </Field>
        <Field label="How often">
          <Segmented label="How often" value={often} onChange={v => setOften(often === v ? null : v)}
            options={[{ value: "always", label: "Always" }, { value: "weekly", label: "Weekly" }, { value: "slow", label: "Slow" }]} />
        </Field>
      </>}
    </Sheet>
  );
}
