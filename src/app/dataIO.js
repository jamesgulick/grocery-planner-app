// Turning an imported data file into the app's DB, shared by every import path (the data
// sheet's file and paste, the start-session paste, and the old Manage → Config): validates it, asks before taking a file
// exported from a preview, drops the export-only nodes, fills settings defaults and marks
// it as real data. Returns { db, summary } to persist, or null when the import was declined.
import { previewImportOk, stripExportNodes } from "./exportData.js";
import { DEFAULT_SETTINGS } from "./seed.js";

export function prepareImport(imp) {
  if (!imp || !imp.meals || !imp.ingredients) throw new Error("Invalid format");
  if (!previewImportOk(imp)) return null;
  const db = {
    ...stripExportNodes(imp),
    settings: { ...DEFAULT_SETTINGS, ...(imp.settings || {}) },
    _isSeed: false,
  };
  return { db, summary: { meals: db.meals.length, items: db.ingredients.length, asOf: imp._meta?.dataChangedAt || null, savedAt: imp.savedAt || null } };
}

export const readFileText = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = e => resolve(e.target.result);
  r.onerror = () => reject(new Error("Could not read the file"));
  r.readAsText(file);
});
