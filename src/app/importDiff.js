// The record-level import check (recipe brief + RULING 16, 2026-11-16). Pure: compares
// records by id, judges scope by purpose, and builds the groups "Load this file?" shows.
//
// What the AI changed = the device's copy of the file it sent → the returned file, when this
// device sent that file (same _meta.exportedAt). Otherwise (another device, a plain import, a
// hand-edited file) = this device → the file, judged with no purpose: every change plain,
// removals amber.
// What changed here since = sent copy → this device now, per record and field; with no
// matching sent copy, a timestamp-only warning when the device changed after the file.
// Scope (16.1, 16.7): calendar = day notes only; recipe = one meal and its new items, sides'
// goes-with, items' buy type, declared merges; enrich = the named meals' dish facts (never
// the judgment fields), new items, goes-with links involving them, declared merges.
// Removals are always amber; a declared merge that verifies is not a removal (16.3).
// A reference to a record that isn't in the file is amber whatever the purpose (16.2).

import { facetWord } from "./vocab.js";

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const stable = v => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
  : JSON.stringify(v ?? null);
const same = (a, b) => stable(a) === stable(b);
const byId = list => new Map((list || []).filter(r => r && r.id).map(r => [r.id, r]));
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Fields that are bookkeeping, not content: never a change.
const IGNORE = new Set(["id", "createdAt", "leftovers", "updatedAt"]);
// Fields an AI may never set on a meal, even empty (16.5, 16.7: household judgments).
export const JUDGMENT_FIELDS = ["preferences", "cadence", "soon", "rotation", "carries", "cost"];

// ── Field words ───────────────────────────────────────────────────────────────
const MEAL_FIELD_LABEL = {
  name: "Name", type: "Type", form: "Style", service: "Style", experience: "Plate and feel", plate: "Plate and feel",
  pairsWith: "Goes with", avoidPlate: "Avoid on the plate", carries: "Leftovers", tempAffinity: "Weather",
  grillable: "Weather", effort: "Time needed", cost: "Cost", ingredients: "Ingredients", link: "Recipe link",
  notes: "Notes", preferences: "Who eats it", cadence: "How often", soon: "Wanted soon", rotation: "Rotation",
  noSidesUnlessNeeded: "No sides needed", substantial: "Can be someone's dinner",
};
const ITEM_FIELD_LABEL = { name: "Name", tier: "Buy", stapleType: "Buy", storageLocation: "Kept in", defaultQuantity: "Usual amount", optional: "Optional" };
const EFFORT = { easy: "Little", medium: "Some", involved: "Lots" };
const CADENCE = { weekly: "Weekly", biweekly: "Every 2 weeks", occasional: "Occasional" };
const ROTATION = { in: "In rotation", experimental: "New", manual: "Hand-picked" };
export const buyWords = i => (i.tier === "always" ? "Always buy" : i.tier === "staple" ? (i.stapleType === "slow" ? "Slow staple" : "Weekly staple") : "As needed");
const placeWords = i => (i.storageLocation && i.storageLocation !== "Unassigned" ? i.storageLocation : "No place");

function mealValue(m, f, ctx) {
  const v = m[f];
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return "Not set";
  switch (f) {
    case "type": return cap(v);
    case "form": case "service": case "experience": case "plate": case "avoidPlate": return v.map(facetWord).join(" · ");
    case "pairsWith": return v.map(id => ctx.mealName(id)).join(" · ");
    case "ingredients": return `${v.length} item${v.length === 1 ? "" : "s"}`;
    case "effort": return EFFORT[v] || v;
    case "cost": return cap(v);
    case "cadence": return CADENCE[v] || v;
    case "rotation": return ROTATION[v] || v;
    case "tempAffinity": return cap(v);
    case "grillable": case "soon": case "noSidesUnlessNeeded": case "substantial": return v ? "On" : "Off";
    case "carries": return `${Array.isArray(v.forWhom) ? v.forWhom.join(", ") || "Nobody" : v.forWhom === "all" ? "Everyone" : "Who likes it"} · lasts ${v.lastsDays} day${v.lastsDays === 1 ? "" : "s"}`;
    case "preferences": return v.map(p => `${p.person} ${p.pref === "dislikes" ? "won't eat" : "likes"}`).join(" · ");
    default: return String(v);
  }
}

/** One line for a field change: "Time needed · Some → Lots", "Goes with + Naan − Rice". */
function changeLine(a, b, f, ctx, isItem) {
  if (isItem) {
    if (f === "tier" || f === "stapleType") return `${buyWords(a)} → ${buyWords(b)}`;
    if (f === "storageLocation") return `Kept in · ${placeWords(a)} → ${placeWords(b)}`;
    return `${ITEM_FIELD_LABEL[f] || f} · ${a[f] || "Not set"} → ${b[f] || "Not set"}`;
  }
  const label = MEAL_FIELD_LABEL[f] || f;
  if (f === "pairsWith" || f === "ingredients") {
    const x = new Set(a[f] || []), y = new Set(b[f] || []);
    const name = f === "pairsWith" ? ctx.mealName : ctx.itemName;
    const plus = [...y].filter(id => !x.has(id)).map(id => `+ ${name(id)}`);
    const minus = [...x].filter(id => !y.has(id)).map(id => `− ${name(id)}`);
    return `${label} ${[...plus, ...minus].join(" ")}`;
  }
  return `${label} · ${mealValue(a, f, ctx)} → ${mealValue(b, f, ctx)}`;
}

const changedFields = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter(f => !IGNORE.has(f) && !same(a[f], b[f]))
  // tier and stapleType read as one Buy change
  .filter((f, _, all) => !(f === "stapleType" && all.includes("tier")));

// "Changed here" reads field · new value ("Leftovers · Who likes it · lasts 3 days").
const staleLine = (c, f, ctx) => (f === "pairsWith" || f === "ingredients" ? changeLine(c.before, c.after, f, ctx, false) : `${MEAL_FIELD_LABEL[f] || f} · ${mealValue(c.after, f, ctx)}`);

/** Records by id: { added, removed, changed: [{ before, after, fields }] }. */
export function diffRecords(before = [], after = []) {
  const a = byId(before), b = byId(after);
  return {
    added: (after || []).filter(r => r && r.id && !a.has(r.id)),
    removed: (before || []).filter(r => r && r.id && !b.has(r.id)),
    changed: (after || []).filter(r => r && a.has(r.id)).map(r => ({ before: a.get(r.id), after: r, fields: changedFields(a.get(r.id), r) })).filter(c => c.fields.length),
  };
}

// Everything outside meals and items, as area lines.
const PLAN_FIELDS_CALENDAR = ["dayNotes"];
function areaChanges(before, after) {
  const out = [];
  for (const k of ["current", "next"]) {
    const p = before?.plans?.[k], q = after?.plans?.[k];
    if (!p && !q) continue;
    if (!p || !q) { out.push({ area: "plans", label: "Plans", line: q ? "a plan added" : "a plan removed" }); continue; }
    const fields = [...new Set([...Object.keys(p), ...Object.keys(q)])].filter(f => !same(p[f], q[f]));
    for (const f of fields) out.push({ area: PLAN_FIELDS_CALENDAR.includes(f) ? "calendar" : "plans", field: f, label: f === "dayNotes" ? "Calendar notes" : f === "presence" ? "Who's home" : f === "timeLevels" ? "Time" : f === "mealPlan" || f === "plates" ? "Planned meals" : "Plans", line: "changed" });
  }
  const s1 = { ...(before?.settings || {}) }, s2 = { ...(after?.settings || {}) };
  if (!same(s1.awayRanges, s2.awayRanges)) out.push({ area: "settings", label: "Away dates", line: "changed" });
  delete s1.awayRanges; delete s2.awayRanges;
  if (!same(s1, s2)) out.push({ area: "settings", label: "Settings", line: "changed" });
  if (!same(before?.mealHistory, after?.mealHistory) || !same(before?.planTail, after?.planTail)) out.push({ area: "history", label: "Past weeks", line: "changed" });
  // one line per label
  const seen = new Set();
  return out.filter(o => (seen.has(o.label) ? false : seen.add(o.label)));
}

// Every reference that points at nothing: an ingredient no item has, a goes-with no meal has.
export function danglingRefs(db) {
  const items = new Set((db.ingredients || []).map(i => i.id)), meals = new Set((db.meals || []).map(m => m.id));
  const out = [];
  for (const m of db.meals || []) {
    const lostI = (m.ingredients || []).filter(id => !items.has(id)).length;
    const lostM = (m.pairsWith || []).filter(id => !meals.has(id)).length;
    if (lostI) out.push({ name: m.name, line: `${lostI} ingredient${lostI === 1 ? "" : "s"} not in the file` });
    if (lostM) out.push({ name: m.name, line: `Goes with ${lostM} meal${lostM === 1 ? "" : "s"} not in the file` });
  }
  return out;
}

// A declared merge holds when the kept item exists, the old one is gone, and nothing in the
// file still refers to the old id (16.3). Items only; never one on a plan's list.
function verifyMerge(m, after, beforeItems) {
  const from = beforeItems.get(m.from), into = (after.ingredients || []).find(i => i.id === m.into);
  if (!from || !into || (after.ingredients || []).some(i => i.id === m.from)) return null;
  const text = JSON.stringify({ meals: after.meals, plans: after.plans });
  if (text.includes(`"${m.from}"`)) return null;
  return { from, into };
}

/**
 * checkImport({ device, incoming, meta, sent }) → the check's model:
 * { purpose, matched, purposeLine, stale: { rows, timestampOnly }, newMeals, filledIn,
 *   newItems, changed, outside, removedCount, notes, areaRows }
 * Each row: { id?, name, line, strong?, problem?, kind: "meal"|"item"|"area", meal?, peek? }.
 */
export function checkImport({ device, incoming, meta = null, sent = null }) {
  const filePurpose = meta?.request?.purpose || null;
  const matched = !!(sent && meta?.exportedAt && sent.exportedAt === meta.exportedAt);
  const purpose = matched ? sent.purpose : null;   // scope comes from the device's own record
  let purposeLine = null;
  if (filePurpose && (!matched || filePurpose !== sent.purpose)) {
    const P = { calendar: "Calendar", recipe: "Recipe", enrich: "Fill in" };
    const what = P[filePurpose] || filePurpose;
    purposeLine = sent && sent.purpose !== filePurpose
      ? `This file is for ${what}; the last send from here was ${sent.purpose ? P[sent.purpose] || sent.purpose : "a plain send"}`
      : `This file is for ${what}; this device has no record of sending it`;
  }
  const base = matched ? sent.db : device;

  const names = db => ({ meal: byId(db?.meals), item: byId(db?.ingredients) });
  const nb = names(base), ni = names(incoming);
  const ctx = {
    mealName: id => (ni.meal.get(id) || nb.meal.get(id))?.name || "a missing meal",
    itemName: id => (ni.item.get(id) || nb.item.get(id))?.name || "a missing item",
  };

  // What changed here since the file left (stale guard, 16.4).
  const stale = { rows: [], timestampOnly: false };
  if (matched) {
    const md = diffRecords(sent.db.meals, device.meals), id = diffRecords(sent.db.ingredients, device.ingredients);
    for (const r of md.added) stale.rows.push({ name: r.name, line: "Added here" });
    for (const r of md.removed) stale.rows.push({ name: r.name, line: "Deleted here" });
    for (const c of md.changed) stale.rows.push({ name: c.after.name, line: c.fields.map(f => staleLine(c, f, ctx)).join("; ") });
    for (const r of id.added) stale.rows.push({ name: r.name, line: "Added here" });
    for (const r of id.removed) stale.rows.push({ name: r.name, line: "Deleted here" });
    for (const c of id.changed) stale.rows.push({ name: c.after.name, line: c.fields.map(f => changeLine(c.before, c.after, f, ctx, true)).join("; ") });
    for (const a of areaChanges(sent.db, device)) stale.rows.push({ name: a.label, line: "Changed here" });
  } else if (meta?.exportedAt && device?.dataChangedAt && new Date(device.dataChangedAt) > new Date(meta.exportedAt)) {
    stale.timestampOnly = true;
  }

  const meals = diffRecords(base?.meals, incoming.meals), items = diffRecords(base?.ingredients, incoming.ingredients);
  const response = meta?.response || {};
  const noteFor = id => (response.notes || []).filter(n => n && n.id === id).map(n => n.text);
  const generalNotes = (response.notes || []).filter(n => n && !n.id && n.text).map(n => n.text);

  // Declared merges (16.3).
  const merges = [];
  for (const m of response.merges || []) { const v = verifyMerge(m, incoming, nb.item); if (v) merges.push(v); }
  const mergedFrom = new Set(merges.map(m => m.from.id));

  const named = new Set(purpose === "enrich" ? (meta?.request?.meals || []) : []);
  const inScopeMealChange = (c, f) => {
    if (purpose === "recipe") return isSideRec(c.after) && f === "pairsWith";
    if (purpose === "enrich") {
      if (named.has(c.after.id)) return !JUDGMENT_FIELDS.includes(f) && f !== "name";
      return f === "pairsWith" && pairsInvolveNamed(c.before, c.after, named);
    }
    return null;   // calendar: nothing; no purpose: plain
  };
  const inScopeItemChange = f => (purpose === "recipe" || purpose === "enrich") && (f === "tier" || f === "stapleType");

  const out = { purpose, matched, purposeLine, stale, newMeals: [], filledIn: [], newItems: [], changed: [], outside: [], notes: generalNotes, dangling: danglingRefs(incoming) };
  const outsideLabel = purpose === "recipe" ? "Outside this recipe" : purpose === "enrich" ? "Outside this fill-in" : purpose === "calendar" ? "Outside the calendar" : null;
  out.outsideLabel = outsideLabel;
  const scoped = purpose === "recipe" || purpose === "enrich" || purpose === "calendar";

  // New meals: in scope for recipe; anything else with a purpose is outside.
  for (const m of meals.added) {
    const row = { id: m.id, kind: "meal", name: m.name, strong: !isSideRec(m), meal: m,
      line: [(m.type === "side" ? "Side" : "Main"), m.effort ? `${EFFORT[m.effort]} time` : null, `${(m.ingredients || []).length} ingredient${(m.ingredients || []).length === 1 ? "" : "s"}`, ...noteFor(m.id)].filter(Boolean).join(" · ") };
    if (!scoped || purpose === "recipe") out.newMeals.push(row);
    else out.outside.push({ ...row, problem: true, line: "Added" });
  }
  for (const m of meals.removed) out[scoped ? "outside" : "changed"].push({ name: m.name, line: "Removed", problem: true, kind: "meal" });
  for (const c of meals.changed) {
    if (purpose === "enrich" && named.has(c.after.id)) {
      const ok = c.fields.filter(f => inScopeMealChange(c, f));
      const bad = c.fields.filter(f => !inScopeMealChange(c, f));
      if (ok.length) {
        const added = ok.filter(f => mealValue(c.before, f, ctx) === "Not set");
        const altered = ok.filter(f => !added.includes(f));
        const ingN = (c.after.ingredients || []).length;
        const guessed = noteFor(c.after.id).some(t => /guess/i.test(t));
        out.filledIn.push({ id: c.after.id, kind: "meal", name: c.after.name, strong: !isSideRec(c.after), meal: c.after,
          line: [...new Set(added.map(f => (f === "ingredients" ? `${ingN} ingredient${ingN === 1 ? "" : "s"}${guessed ? ", guessed" : ""}` : MEAL_FIELD_LABEL[f])))].join(" · ") || "Changed",
          peek: { added: added.map(f => ({ label: MEAL_FIELD_LABEL[f], value: mealValue(c.after, f, ctx) })), changed: altered.map(f => ({ label: MEAL_FIELD_LABEL[f], value: `${mealValue(c.before, f, ctx)} → ${mealValue(c.after, f, ctx)}` })),
            ingredients: (c.after.ingredients || []).map(ctx.itemName), guessed } });
        for (const f of altered) out.changed.push({ name: c.after.name, strong: !isSideRec(c.after), line: changeLine(c.before, c.after, f, ctx, false), kind: "meal" });
      }
      for (const f of bad) out.outside.push({ name: c.after.name, line: changeLine(c.before, c.after, f, ctx, false), problem: true, kind: "meal" });
      continue;
    }
    for (const f of c.fields) {
      const ok = inScopeMealChange(c, f);
      const row = { name: c.after.name, strong: !isSideRec(c.after), line: changeLine(c.before, c.after, f, ctx, false), kind: "meal" };
      if (!scoped) out.changed.push(row);
      else if (ok) out.changed.push(row);
      else out.outside.push({ ...row, problem: true });
    }
  }
  for (const i of items.added) {
    const row = { name: i.name, line: `${placeWords(i)} · ${buyWords(i)}`, kind: "item" };
    if (!scoped || purpose !== "calendar") out.newItems.push(row);
    else out.outside.push({ ...row, problem: true, line: "Added" });
  }
  for (const i of items.removed) {
    if (mergedFrom.has(i.id)) continue;
    out[scoped ? "outside" : "changed"].push({ name: i.name, line: "Removed", problem: true, kind: "item" });
  }
  for (const m of merges) {
    const row = { name: m.into.name, line: `Merged: ${m.from.name} → ${m.into.name}`, kind: "item" };
    if (purpose === "calendar") out.outside.push({ ...row, problem: true }); else out.changed.push(row);
  }
  for (const c of items.changed) {
    for (const f of c.fields) {
      const row = { name: c.after.name, line: changeLine(c.before, c.after, f, ctx, true), kind: "item" };
      if (!scoped || inScopeItemChange(f)) out.changed.push(row); else out.outside.push({ ...row, problem: true });
    }
  }
  // Plans, settings, history: the calendar's notes are its scope; everything else is outside.
  out.areaRows = [];
  for (const a of areaChanges(base, incoming)) {
    const inScope = purpose === "calendar" && a.area === "calendar";
    if (!scoped) out.areaRows.push({ name: a.label, line: a.line, kind: "area" });
    else if (inScope) out.areaRows.push({ name: a.label, line: a.line, kind: "area" });
    else out.outside.push({ name: a.label, line: a.line, problem: true, kind: "area" });
  }
  out.mealsNew = meals.added.length; out.mealsFilled = out.filledIn.length; out.itemsNew = items.added.length;
  out.mealsRemoved = meals.removed.length; out.itemsRemoved = items.removed.filter(i => !mergedFrom.has(i.id)).length;
  return out;
}

const isSideRec = m => m && m.type === "side";
const pairsInvolveNamed = (a, b, named) => {
  const x = new Set(a.pairsWith || []), y = new Set(b.pairsWith || []);
  const diff = [...[...y].filter(id => !x.has(id)), ...[...x].filter(id => !y.has(id))];
  return named.has(b.id) || diff.every(id => named.has(id));
};

export const savedLabel = iso => { if (!iso) return null; const d = new Date(iso); const h = d.getHours(); return `${MONTH[d.getMonth()]} ${d.getDate()}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`; };

/** A read-only preview of a meal, in the meal page's groups and order (the check's "every field"). */
export function mealPreview(m, db) {
  const meals = byId(db.meals), items = byId(db.ingredients);
  const ctx = { mealName: id => meals.get(id)?.name || "a missing meal", itemName: id => items.get(id)?.name || "a missing item" };
  const v = f => mealValue(m, f, ctx);
  const side = isSideRec(m);
  const join = (...xs) => xs.filter(x => x && x !== "Not set").join(" · ") || "Not set";
  const pairs = side ? v("pairsWith") : join((db.meals || []).filter(s => isSideRec(s) && (s.pairsWith || []).includes(m.id)).map(s => s.name).join(" · "));
  return [
    { label: "Planning", rows: [["Wanted soon", m.soon ? "On" : "Off"], ["Who eats it", v("preferences")], ["How often", v("cadence")], ["Rotation", v("rotation")]] },
    { label: "The plate", rows: [["Type", v("type")], ["Style", join(v("form"), v("service"))], ["Plate and feel", join(v("experience"), v("plate"))],
      ...(side ? [["Goes with", pairs], ["Avoid on the plate", v("avoidPlate")], ["Can be someone's dinner", m.substantial ? "On" : "Off"]]
        : [["No sides needed", m.noSidesUnlessNeeded ? "On" : "Off"], ["Sides that go with it", pairs]])] },
    { label: "Cooking", rows: [["Leftovers", v("carries")], ["Weather", [m.tempAffinity ? v("tempAffinity") : "Neutral", m.grillable ? "grillable" : "not grillable"].join(" · ")],
      ["Time and cost", join(v("effort"), m.cost ? v("cost") : null)]] },
    { label: "Shopping", rows: [["Ingredients", join((m.ingredients || []).map(ctx.itemName).join(" · "))], ["Recipe link", m.link ? "Set" : "Not set"]] },
    ...(m.notes ? [{ label: "Notes", rows: [["", m.notes]] }] : []),
  ];
}
