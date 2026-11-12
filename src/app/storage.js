// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { DB_KEY, IS_PREVIEW, LIVE_DB_KEY, RECOVERY_KEY } from "./globals.js";
import { migrateDB } from "./plans.js";
import { DEFAULT_DB } from "./seed.js";

// ── Storage ────────────────────────────────────────────────────────────────────
//
// Local persistence is ATTEMPTED on every platform (including mobile), but never
// trusted blindly. Each save does a write-then-read-back verify; if storage is
// unavailable or silently drops the write, we fall back to the session
// export/import flow. storageHealth records the last known result so the UI can
// tell the user honestly whether same-device reopen will work.

let storageHealth = "unknown"; // "ok" | "unavailable" | "unknown"
const getStorageHealth = () => storageHealth;

// Preview only: copy the live DB into the preview key (read-only on the live side).
// `force` overwrites an existing preview DB; otherwise only seeds an empty one.
function seedPreviewFromLive(force = false) {
  if (!IS_PREVIEW) return false;
  try {
    if (!force && localStorage.getItem(DB_KEY)) return false;
    const live = localStorage.getItem(LIVE_DB_KEY);
    if (!live) return false;
    localStorage.setItem(DB_KEY, live);
    localStorage.removeItem(RECOVERY_KEY);
    return true;
  } catch { return false; }
}

async function loadDB() {
  seedPreviewFromLive();
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      storageHealth = "ok";
      console.log("[DB] Loaded:", parsed.meals?.length, "meals,", parsed.ingredients?.length, "items");
      return migrateDB(parsed);
    }
    // Storage reachable but empty (first run, or never saved) — not a failure.
    storageHealth = "ok";
  } catch(e) {
    storageHealth = "unavailable";
    console.log("[DB] Load failed:", e.message);
  }
  return DEFAULT_DB;
}

async function saveDB(db) {
  try {
    const payload = JSON.stringify(db);
    localStorage.setItem(DB_KEY, payload);
    // Verify the write actually stuck — this is what catches silent mobile drops.
    if (localStorage.getItem(DB_KEY) === payload) {
      storageHealth = "ok";
      console.log("[DB] Saved + verified");
      return true;
    }
    storageHealth = "unavailable";
    console.warn("[DB] Save did not verify — relying on session export");
    return false;
  } catch(e) {
    storageHealth = "unavailable";
    console.error("[DB] Save error:", e.message);
    return false;
  }
}

// Recovery snapshot: written on blur/background so a forgotten export becomes a
// one-tap restore on reopen rather than data loss. Kept fire-and-forget and as
// synchronous as the storage API allows, since it runs while the app is closing.
function saveRecovery(db) {
  try {
    const snap = { savedAt:new Date().toISOString(), db };
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(snap));
    console.log("[DB] Recovery snapshot written");
  } catch(e) { console.log("[DB] Recovery write skipped:", e.message); }
}

async function loadRecovery() {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (raw) {
      const snap = JSON.parse(raw);
      if (snap && snap.db && snap.db.meals && snap.db.ingredients) return snap;
    }
  } catch(e) { console.log("[DB] Recovery load skipped:", e.message); }
  return null;
}

async function clearRecovery() {
  try {
    localStorage.removeItem(RECOVERY_KEY);
  } catch(e) { /* non-fatal */ }
}

export { clearRecovery, getStorageHealth, loadDB, loadRecovery, saveDB, saveRecovery, seedPreviewFromLive };
