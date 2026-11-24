// The app shell (App, header, tabs). The rest of the app lives in modules under
// src/app, src/components, src/plan, src/manage and src/tonight (polish Phase 1.5).
import React, { useEffect, useRef, useState } from "react";
import { buildExportDB, buildPublished, downloadBackup, previewImportOk, stripExportNodes } from "./app/exportData.js";
import { IS_PREVIEW, PREVIEW_SLOT, extractJSON, formatSavedAt, todayLocalISO } from "./app/globals.js";
import { pruneEnded } from "./app/awayDates.js";
import { autoRetirePlans, landingPlanKey, migrateDB, planCount, startPlan } from "./app/plans.js";
import { prepareImport } from "./app/dataIO.js";
import { DEFAULT_DB } from "./app/seed.js";
import { clearRecovery, getStorageHealth, loadDB, loadRecovery, saveDB, saveRecovery, seedPreviewFromLive } from "./app/storage.js";
import { C, S } from "./app/styles.js";
import { formatAsOf } from "./manage/ManageConfig.jsx";
import { LibraryTab } from "./library/LibraryTab.jsx";
import "./library/library.css";
import { PlanTab } from "./plan/PlanTab.jsx";
import { HomeScreen } from "./home/HomeScreen.jsx";
import { DataSheet } from "./shell/DataSheet.jsx";
import { ImportCheck } from "./shell/ImportCheck.jsx";
import { SettingsSheet } from "./shell/SettingsSheet.jsx";
import { GrabSheet } from "./shell/GrabSheet.jsx";
import { clearPending, loadPending } from "./app/sendToAI.js";
import { HeaderButtons, IconButton, PillButton, Segmented, TabBar, TabBarSpacer, TopBar } from "./ui/kit.jsx";
import { ToastHost } from "./ui/Toast.jsx";
import { registerLatestDB } from "./app/latestDB.js";
import "./ui/ui.css";
import "./shell/shell.css";

// ── App shell ──────────────────────────────────────────────────────────────────

const TABS = [
  { id:"home",    label:"Home",    icon:"home" },
  { id:"plan",    label:"Plan",    icon:"plan" },
  { id:"library", label:"Library", icon:"library" },
];

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError:false, error:null }; }
  static getDerivedStateFromError(error) { return { hasError:true, error }; }
  componentDidCatch(error, info) { console.error("[ErrorBoundary]", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding:24, fontFamily:"system-ui", color:C.text }}>
          <div style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>Something went wrong</div>
          <div style={{ fontSize:13, color:C.muted, marginBottom:16 }}>{String(this.state.error)}</div>
          <button style={{ ...S.btn, ...S.btnP }} onClick={() => { this.setState({ hasError:false, error:null }); window.location.reload(); }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Header data-status severity ladder (SPEC-data-provenance.md) ───────────────
// Priority: urgent (storage broken) shows ALONE; caution (seed data, or
// backup overdue) shows alongside the calm info line; calm is the base state
// with no action. Only one caution at a time -- seed wins over
// backup-overdue, since you can't be overdue backing up data that was never
// real to begin with. No dismiss controls: a state clears itself the moment
// its underlying condition resolves (storage recovers, a real import lands,
// a backup happens).
const BACKUP_OVERDUE_DAYS = 4;
function computeDataStatus(db, storageOk) {
  const changed  = db.dataChangedAt  ? new Date(db.dataChangedAt)  : null;
  const exported = db.lastExportedAt ? new Date(db.lastExportedAt) : null;
  const asOf     = formatAsOf(db.dataChangedAt);
  const calm     = asOf ? `Your data · as of ${asOf}` : "Your data";

  if (!storageOk) {
    return { severity:"urgent", calm, message:"⚠ Storage isn't saving — export now.", action:"export", actionLabel:"Export now" };
  }
  if (db._isSeed) {
    return { severity:"caution", calm:null, message:"⚠ Example data — import your file to begin.", action:"import", actionLabel:"Import" };
  }

  const hasChangesSinceBackup = !!changed && (!exported || changed.getTime() > exported.getTime());
  const backupIsStale = !exported || (Date.now() - exported.getTime() > BACKUP_OVERDUE_DAYS * 24*60*60*1000);
  if (hasChangesSinceBackup && backupIsStale) {
    let backupMsg = "you haven't backed up yet";
    if (exported) {
      const days = Math.floor((Date.now() - exported.getTime()) / (24*60*60*1000));
      backupMsg = `last backup ${days <= 0 ? "today" : days + " day" + (days===1?"":"s") + " ago"}`;
    }
    return { severity:"caution", calm, message:`You've made changes; ${backupMsg}.`, action:"backup", actionLabel:"Back up" };
  }

  return { severity:"calm", calm: asOf ? `Your data · as of ${asOf} · storage OK` : "Your data · storage OK", message:null, action:null, actionLabel:null };
}

export default function App() {
  const [db, setDB]               = useState(null);
  const [tab, setTab]             = useState("home");
  const [tabTaps, setTabTaps]     = useState(0);         // a bottom-tab tap returns that tab to its top (11/16)
  const [grab, setGrab]           = useState(null);      // Grab sheet: { kind, name, link, text, role } while open
  // A request sent before this app load and still waiting for its file (an iOS reload, brief §9).
  const [pendingAtStart, setPendingAtStart] = useState(() => !!loadPending());
  const [libOpen, setLibOpen]     = useState(null);      // a Library page to open: { kind, id, n }
  // An iOS Share Shortcut opens the app with ?name= and/or &link=: Grab opens prefilled.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.has("name") || q.has("link")) {
        setGrab({ kind: "meal", name: q.get("name") || "", link: q.get("link") || "" });
        window.history.replaceState(null, "", window.location.pathname + window.location.hash);
      }
    } catch { /* no URL params */ }
  }, []);
  const openLibraryPage = p => { setTab("library"); setLibraryView(p.kind === "item" ? "items" : "meals"); setLibOpen({ ...p, n: Date.now() }); };
  const [sheet, setSheet]         = useState(null);       // "data" | "settings" | null
  const [libraryView, setLibraryView] = useState("meals"); // Library: Meals | Items
  const [loading, setLoading]     = useState(true);
  const [showOpenSession, setShowOpenSession]   = useState(false);
  const [sessionImport, setSessionImport]       = useState("");
  const [sessionPendingConfirm, setSessionPendingConfirm] = useState(null); // parsed db awaiting accept
  const [sessionError, setSessionError]         = useState("");
  const [saveOk, setSaveOk]                     = useState(true);
  const [recovery, setRecovery]                 = useState(null); // { savedAt, db } awaiting restore
  const dbRef = useRef(null);
  registerLatestDB(() => dbRef.current);   // Undo restores onto this (src/app/latestDB.js)

  useEffect(() => {
    (async () => {
      const loaded = await loadDB();
      // Auto-retire runs once per load, never mid-session: promotes plans.next
      // to current if its weekStartDate has arrived. Persist immediately if it
      // fired, so a reload doesn't re-archive the same outgoing week.
      let retired = autoRetirePlans(loaded);
      // Away stretches that ended over two weeks ago drop off (decided 11/16), in the same
      // background save.
      const ranges = retired?.settings?.awayRanges;
      const kept = ranges && pruneEnded(ranges, todayLocalISO());
      if (kept && kept !== ranges) retired = { ...retired, settings: { ...retired.settings, awayRanges: kept } };
      if (retired !== loaded) {
        persistDB(retired, { background: true });
      } else {
        setDB(loaded);
        dbRef.current = loaded;
      }
      setLoading(false);
      setSaveOk(getStorageHealth() !== "unavailable");
      const restoredReal = getStorageHealth() === "ok" && loaded !== DEFAULT_DB;

      // Check for a recovery snapshot newer than what loaded. If found, offer a
      // one-tap restore instead of prompting for a re-import.
      const snap = await loadRecovery();
      const snapNewer = snap && (!loaded.savedAt || new Date(snap.savedAt) > new Date(loaded.savedAt));
      const snapHasMore = snap && (!restoredReal || snap.db.ingredients.length !== loaded.ingredients.length || snap.db.meals.length !== loaded.meals.length);
      if (snap && snapNewer && snapHasMore) {
        setRecovery(snap);
      } else if (!restoredReal) {
        // Nothing to recover and no real local data — fall back to import prompt.
        setShowOpenSession(true);
      }
    })();
  }, []);

  // Write a recovery snapshot whenever the app is backgrounded or hidden — this
  // is the safety net for closing before exporting. Synchronous-ish, no async
  // clipboard/Shortcut work that iOS would kill mid-close.
  useEffect(() => {
    const snapshot = () => { if (dbRef.current) saveRecovery(dbRef.current); };
    const onVis = () => { if (document.visibilityState === "hidden") snapshot(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", snapshot);
    window.addEventListener("blur", snapshot);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", snapshot);
      window.removeEventListener("blur", snapshot);
    };
  }, []);

  // dataChangedAt is the single source of truth for "when did the user's
  // actual grocery data last change" (SPEC-data-provenance.md). Every call
  // stamps it EXCEPT writes that aren't the user's edits (RULING 16.4), which pass
  // { background: true }: auto-retire, imports and restores (which keep the file's own
  // time), moving between plan steps, backup stamps, Order's sent marks, Confirm's
  // order snapshot.
  const persistDB = (next, opts = {}) => {
    // migrateDB is idempotent, so this is a cheap no-op for an already-current
    // db and a safety net for anything entering via recovery/import that might
    // still carry the legacy single-slot plan shape.
    const stamped = {
      ...migrateDB(next),
      savedAt: new Date().toISOString(),
      ...(opts.background ? {} : { dataChangedAt: new Date().toISOString() }),
    };
    setDB(stamped);
    dbRef.current = stamped;
    saveDB(stamped).then(ok => setSaveOk(ok)).catch(() => setSaveOk(false));
  };

  const acceptRecovery = () => {
    persistDB(recovery.db, { background: true }); // a restore isn't an edit; the snapshot keeps its own time
    clearRecovery();
    setRecovery(null);
  };
  const dismissRecovery = () => {
    clearRecovery();
    setRecovery(null);
    const restoredReal = getStorageHealth() === "ok" && dbRef.current && dbRef.current !== DEFAULT_DB;
    if (!restoredReal) setShowOpenSession(true);
  };

  const acceptSessionImport = () => {
    try {
      const prepared = prepareImport(JSON.parse(extractJSON(sessionImport)));
      if (!prepared) return;
      setSessionPendingConfirm(prepared);
      setSessionError("");
    } catch(e) {
      setSessionError("Could not read that data: " + e.message);
    }
  };

  const confirmSessionImport = () => {
    // Real external data replacing what's here — not the seed set.
    persistDB(sessionPendingConfirm.db, { background: true });
    setSessionPendingConfirm(null);
    setSessionImport("");
    setShowOpenSession(false);
  };

  if (loading || !db) {
    return (
      <div style={{ ...S.app, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh" }}>
        <div style={{ textAlign:"center", color:C.muted }}>
          <div style={{ fontSize:32, marginBottom:12 }}>🛒</div>
          <div style={{ fontSize:14 }}>Loading...</div>
        </div>
      </div>
    );
  }

  const dataStatus = computeDataStatus(db, saveOk);
  const dataDot = dataStatus.severity === "urgent" || dataStatus.action === "backup";
  const headerIcons = <>
    <IconButton icon="data" label={dataDot ? "Import and export: backup overdue" : "Import and export"} dot={dataDot} onClick={() => setSheet("data")} />
    <IconButton icon="gear" label="Settings" onClick={() => setSheet("settings")} />
  </>;
  // Home → Plan: open that week on its Meals step (shell only: the week view and plate sheet
  // come later), or on `atStep` (Continue: the first unfinished step). "start-next" lands on
  // Plan's Welcome, where next week is started.
  // From Home: open a week's plan (at a step), or start one for an unplanned week (`start`).
  const openPlan = (key, atStep, start) => {
    const plans = db.plans || {};
    if (!key || !plans[key]) {
      const next = start && startPlan(db, start);
      if (next) persistDB(next);
      setTab("plan"); return;
    }
    const p = plans[key];
    const step = atStep != null ? atStep : (p.maxStep ?? p.step ?? 0) >= 1 ? 1 : (p.step ?? 0);
    persistDB({ ...db, activePlan:key, plans:{ ...plans, [key]:{ ...p, step } } }, { background:true });
    setTab("plan");
  };
  const runStatusAction = () => {
    if (dataStatus.action === "export" || dataStatus.action === "backup") downloadBackup(db, persistDB);
    else if (dataStatus.action === "import") setSheet("data");
  };

  return (
    <ErrorBoundary>
      <div className="shell-app" style={S.app}>
        {IS_PREVIEW && (
          <div style={{ background:"#7A4DFF", color:"#fff", fontSize:12, fontWeight:700, padding:"6px 12px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
            <span>{PREVIEW_SLOT === "v2" ? "V2 PREVIEW" : "PREVIEW"} — separate data; your live app is untouched</span>
            <button
              style={{ background:"rgba(255,255,255,0.2)", color:"#fff", border:"1px solid rgba(255,255,255,0.5)", borderRadius:6, fontSize:11, fontWeight:700, padding:"3px 8px", cursor:"pointer" }}
              onClick={() => { if (window.confirm("Discard preview data and re-copy your live data?") && seedPreviewFromLive(true)) window.location.reload(); }}
              title="Discard preview data and re-copy your live data (live data is only read)"
            >Reset from live</button>
          </div>
        )}
        {/* Polish Phase 2 shell. The header status line and backup banner are gone: backup
            state is the dot on the data icon (and the data sheet). The one loud bar left is
            storage failing, because data is being lost while it shows. */}
        {dataStatus.severity === "urgent" && (
          <div className="ui-banner" role="alert">
            <span className="ui-banner-dot" aria-hidden="true" />
            <span>Storage isn't saving. Export your data now.</span>
            <PillButton inline onClick={() => downloadBackup(db, persistDB)}>Export</PillButton>
          </div>
        )}

        {/* Recovery modal — offer to restore the snapshot taken when the app
            was last backgrounded, so closing before export isn't data loss. */}
        {recovery && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:301, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"#fff", borderRadius:"18px 18px 0 0", padding:20, paddingBottom:"calc(20px + env(safe-area-inset-bottom, 0px))", width:"100%", maxWidth:480 }}>
              <div style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>Restore unsaved work?</div>
              <div style={{ fontSize:13, color:C.muted, marginBottom:14, lineHeight:1.5 }}>
                The app saved a snapshot when you last closed it{recovery.savedAt ? ` (${formatSavedAt(recovery.savedAt)})` : ""}. It has more data than what just loaded — looks like changes you didn't export.
              </div>
              <div style={{ background:C.primaryLight, borderRadius:10, padding:"12px 14px", marginBottom:16 }}>
                <div style={{ display:"flex", justifyContent:"space-around", textAlign:"center" }}>
                  <div><div style={{ fontSize:26, fontWeight:800, color:C.primary }}>{recovery.db.meals.length}</div><div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>MEALS</div></div>
                  <div><div style={{ fontSize:26, fontWeight:800, color:C.primary }}>{recovery.db.ingredients.length}</div><div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>ITEMS</div></div>
                  <div><div style={{ fontSize:26, fontWeight:800, color:C.primary }}>{planCount(recovery.db.plans)}</div><div style={{ fontSize:11, color:C.muted, fontWeight:700 }}>PLANS</div></div>
                </div>
              </div>
              <button style={{ ...S.btn, ...S.btnP }} onClick={acceptRecovery}>Restore this</button>
              <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={dismissRecovery}>Discard — use what loaded</button>
            </div>
          </div>
        )}

        {/* Open session modal — pull latest from iCloud. A pasted file goes through the
            one import check before it replaces anything. */}
        {showOpenSession && sessionPendingConfirm && (
          <ImportCheck device={db} prepared={sessionPendingConfirm} onLoad={confirmSessionImport} onCancel={() => setSessionPendingConfirm(null)} />
        )}
        {showOpenSession && !sessionPendingConfirm && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <div style={{ background:"#fff", borderRadius:"18px 18px 0 0", padding:20, paddingBottom:"calc(20px + env(safe-area-inset-bottom, 0px))", width:"100%", maxWidth:480, maxHeight:"85vh", overflowY:"auto" }}>
                <>
                  <div style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>Start session</div>
                  <div style={{ fontSize:13, color:C.muted, marginBottom:14, lineHeight:1.5 }}>Pull your latest data so this device is current. Run the shortcut to copy GroceryDB, then paste below — or skip to use what's already here.</div>
                  <div style={{ fontSize:13, color:C.muted, marginBottom:10, padding:"10px 12px", background:"#EFF4FB", borderRadius:8, border:"1px solid #D3E1F2" }}>
                    📲 Run <b>"Get My Grocery Data"</b> from your Shortcuts app or home screen, then paste below. (In-app launch is blocked by iOS here.)
                  </div>
                  <textarea style={{ ...S.input, height:90, fontSize:11, fontFamily:"monospace", resize:"none" }} placeholder="Paste GroceryDB here..." value={sessionImport} onChange={e => { setSessionImport(e.target.value); setSessionError(""); }} />
                  {sessionError && <div style={{ fontSize:12, color:C.danger, marginBottom:8 }}>{sessionError}</div>}
                  <button style={{ ...S.btn, ...S.btnP }} disabled={!sessionImport.trim()} onClick={acceptSessionImport}>Review &amp; load</button>
                  <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={() => { setShowOpenSession(false); setSessionImport(""); setSessionError(""); }}>Skip — use what's here</button>
                </>
            </div>
          </div>
        )}
        {tab==="home" && <HomeScreen db={db} dataDot={dataDot} onOpenData={() => setSheet("data")} onOpenSettings={() => setSheet("settings")} onOpenPlan={openPlan}
          pending={pendingAtStart ? loadPending() : null}
          onDismissPending={() => { clearPending(); setPendingAtStart(false); }}
          onPendingLoaded={() => setPendingAtStart(false)}
          onOpenPending={p => setGrab({ kind: "meal", name: p.job?.name || "", link: p.job?.link || "", text: p.job?.text || "", role: p.job?.role || "main" })}
          persistDB={persistDB} />}
        {tab==="plan" && <PlanTab key={db.activePlan || "current"} db={db} persistDB={persistDB} headerIcons={headerIcons} onDone={() => setTab("home")} onOpenMeal={id => openLibraryPage({ kind: "meal", id })} />}
        {tab==="library" && <LibraryTab db={db} persistDB={persistDB} view={libraryView} setView={setLibraryView} headerIcons={headerIcons} resetKey={tabTaps} openRequest={libOpen} onGrab={init => setGrab(init)} />}
        <TabBarSpacer />
        <TabBar tabs={TABS} active={tab} onSelect={id => {
          // The Plan tab opens the plan that needs you (spec §3.1).
          if (id === "plan") { const k = landingPlanKey(db); if (k && k !== db.activePlan) persistDB({ ...db, activePlan: k }, { background: true }); }
          setTab(id); setTabTaps(n => n + 1); window.scrollTo(0, 0);
        }} action={{ label: "Grab", onClick: () => setGrab({ kind: "meal" }) }} />
        {sheet === "data" && <DataSheet db={db} persistDB={persistDB} overdue={dataDot} onClose={() => setSheet(null)} />}
        {sheet === "settings" && <SettingsSheet db={db} persistDB={persistDB} onClose={() => setSheet(null)} />}
        {grab && <GrabSheet db={db} persistDB={persistDB} init={grab} onClose={() => setGrab(null)} onOpenPage={openLibraryPage} />}
        <ToastHost />
      </div>
    </ErrorBoundary>
  );
}

// Exported for the golden test only (untracked engine/golden/): the export file and
// the published block the family Shortcut reads must not change during polish.
export { buildExportDB, buildPublished, stripExportNodes, extractJSON };

