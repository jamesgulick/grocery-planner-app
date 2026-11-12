// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { IS_PREVIEW, PREVIEW_SLOT, planDays } from "./globals.js";
import { getCurrentPlan } from "./plans.js";
import { DEFAULT_SETTINGS } from "./seed.js";

// Header info, now emitted as a JSON node (not prepended text) so the exported
// file is 100% valid JSON — the mid-week Shortcut can parse it directly, and
// you still see the summary at the top of the file during data exchange.
const exportMeta = db => {
  const now = new Date();
  const et = now.toLocaleString("en-US", { timeZone:"America/New_York", weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
  return {
    app:            "GroceryDB",
    summary:        `${(db.meals||[]).length} meals | ${(db.ingredients||[]).length} items | ${et} ET`,
    mealCount:      (db.meals||[]).length,
    itemCount:      (db.ingredients||[]).length,
    exportedAt:     now.toISOString(),
    // Carried through so a re-import can show real provenance (as-of time,
    // seed-vs-real) instead of re-deriving it from the fresh export moment.
    dataChangedAt:  db.dataChangedAt || null,
    lastExportedAt: db.lastExportedAt || null,
    // A preview build's export is test data; the live app warns before importing it.
    ...(IS_PREVIEW ? { preview: PREVIEW_SLOT } : {}),
  };
};

// The export guard: true when it's fine to import `imp`. The live app asks first
// if the file came from a preview build (its plan may be sandbox data); a
// preview build imports anything without asking.
const previewImportOk = imp => {
  const from = imp?._meta?.preview;
  if (!from || IS_PREVIEW) return true;
  return window.confirm(`This file was exported from the ${from === "v2" ? "v2 preview" : "preview"}, not your live app, so its plan may be test data. Import it anyway?`);
};

// Assemble the object written on export: a _meta node first (human-readable
// summary), a fresh published menu for the Shortcut, then the full db. Pure
// JSON, no prepended text.
const buildExportDB = db => ({ _meta: exportMeta(db), ...db, published: buildPublished(db) });

// On import, drop export-only nodes so they don't go stale in stored state.
// They're regenerated fresh on every export.
const stripExportNodes = ({ _meta, published, ...rest }) => rest;

// A backup (download or copy) stamps lastExportedAt with the SAME instant
// embedded in the artifact's own _meta, so the file/clipboard content is
// self-consistent with what the app now believes just happened. Shared by
// the Manage > Config export section and the header's contextual backup
// action (SPEC-data-provenance.md).
const buildBackupPayload = db => {
  const now = new Date().toISOString();
  const fresh = buildExportDB({ ...db, lastExportedAt: now });
  return { now, text: JSON.stringify(fresh, null, 2) };
};

// Writes an actual .json file via Blob + a temporary <a download>, then
// stamps lastExportedAt as a background write (backing up isn't itself a
// change to the grocery data).
const downloadBackup = (db, persistDB) => {
  const { now, text } = buildBackupPayload(db);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = !IS_PREVIEW ? "grocery_db.json" : PREVIEW_SLOT === "v2" ? "grocery_db-V2-PREVIEW.json" : "grocery_db-PREVIEW.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  persistDB({ ...db, lastExportedAt: now }, { background: true });
};

// Build the "published" menu the mid-week Shortcut reads. This is a generic,
// extensible framework: the app emits a flat list of SENDABLE ITEMS, each with
// a menu `label` and a ready-to-send `body`. The Shortcut is a dumb picker —
// you choose recipient(s) yourself and one or more items by label; it joins the
// chosen bodies into one multi-line message and sends. No dates, no "today",
// no recipient data, no formatting logic on the Shortcut side.
//
// A day is just one kind of item. "Whole week" is another. Future items
// (leftovers, shopping reminder, pickup time, ...) slot in here with zero
// Shortcut changes — they're all label+body.
//
// Shape (db.published):
// {
//   v: 2,
//   publishedAt: "...Z",
//   items: [ { key, label, body }, ... ]
// }
const buildPublished = db => {
  const settings    = db.settings || DEFAULT_SETTINGS;

  // Always the CURRENT plan (the week actually being shopped/lived), never
  // "next" — the family shouldn't be told about a week that isn't happening
  // yet, even while the owner is mid-edit on next week's draft. The live
  // mealPlan (keyed by day abbr -> meal NAMES) is preferred over the last
  // committed meals snapshot, falling back to empty.
  const plan       = getCurrentPlan(db);
  // Day-ordering follows the current plan's own date; shoppingDay is only the
  // no-plan-yet fallback (see SPEC-date-drives-ordering.md).
  const { days, daysFull } = planDays(plan, settings.shoppingDay);
  const draftMeals = plan?.mealPlan;
  const planMeals  = (draftMeals && Object.values(draftMeals).some(a => (a||[]).length))
    ? draftMeals
    : (plan?.meals || {});

  const mealText = abbr => {
    const m = planMeals[abbr] || [];
    return m.length ? m.join(", ") : "Not planned";
  };

  // Outbox is the quick family-facing dinner list — no notes (day or meal).
  // Note specifics live in the fridge printout / JSON index, not here.
  const dayLine = (abbr, full) => `${full}: ${mealText(abbr)}`;

  // One item per day.
  const dayItems = days.map((abbr, i) => ({
    key:   abbr.toLowerCase(),
    label: daysFull[i],
    body:  dayLine(abbr, daysFull[i]),
  }));

  // Pre-baked "Whole week": every day's line joined.
  const weekItem = {
    key:   "week",
    label: "Whole week",
    body:  days.map((abbr, i) => dayLine(abbr, daysFull[i])).join("\n"),
  };

  return {
    v: 2,
    publishedAt: new Date().toISOString(),
    items: [...dayItems, weekItem],
  };
};

export { buildBackupPayload, buildExportDB, buildPublished, downloadBackup, previewImportOk, stripExportNodes };
