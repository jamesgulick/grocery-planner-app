// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { useRef, useState } from "react";
import { copyToClipboard } from "../app/clipboard.js";
import { buildBackupPayload, buildExportDB, downloadBackup, previewImportOk, stripExportNodes } from "../app/exportData.js";
import { extractJSON } from "../app/globals.js";
import { planCount } from "../app/plans.js";
import { DEFAULT_DB, DEFAULT_SETTINGS } from "../app/seed.js";
import { C, S } from "../app/styles.js";
import { FieldGroup, Toggle } from "../components/common.jsx";

// ── Meal editor ────────────────────────────────────────────────────────────────

// Date-range away periods (REFACTOR B2's bulk-set convenience): "Kid 3 at college
// Sep 1 – Dec 15". Either end may be left blank (open). A per-night toggle on
// the Meals day card overrides a period for that one night. Module-level with
// its own state so typing into the date fields keeps focus (see AutoGrowTextarea).
function AwayPeriods({ contacts, ranges, onChange }) {
  const [name, setName] = useState(contacts[0]?.name || "");
  const [from, setFrom] = useState("");
  const [to, setTo]     = useState("");
  const fmt = iso => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
  const describe = r => r.from && r.to ? `${fmt(r.from)} – ${fmt(r.to)}`
    : r.from ? `from ${fmt(r.from)} until further notice`
    : r.to   ? `until ${fmt(r.to)}`
    : "until further notice";
  const invalid = !name || (from && to && to < from);
  const add = () => {
    if (invalid) return;
    onChange([...ranges, { id:"r"+Date.now(), name, from: from || null, to: to || null }]);
    setFrom(""); setTo("");
  };
  return (
    <div style={{ padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
      <div style={{ fontWeight:600 }}>Away periods</div>
      <div style={{ fontSize:12, color:C.faint, marginBottom:8 }}>Who's away for meal planning, by date. Leave a date blank for open-ended.</div>
      {ranges.length === 0 && <div style={{ fontSize:13, color:C.faint, marginBottom:8 }}>None — everyone is home unless marked away on a day.</div>}
      {ranges.map(r => (
        <div key={r.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0" }}>
          <div style={{ flex:1, fontSize:14 }}><span style={{ fontWeight:600 }}>{r.name}</span> <span style={{ color:C.muted }}>{describe(r)}</span></div>
          <button style={{ background:"none", border:"none", color:C.faint, fontSize:18, cursor:"pointer", padding:"0 4px" }} title="Remove" onClick={() => onChange(ranges.filter(x => x.id !== r.id))}>×</button>
        </div>
      ))}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:6 }}>
        <select style={{ ...S.select, flex:"1 1 110px", marginBottom:0 }} value={name} onChange={e => setName(e.target.value)}>
          {contacts.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
        </select>
        <input type="date" aria-label="Away from" style={{ ...S.input, flex:"1 1 130px", marginBottom:0 }} value={from} onChange={e => setFrom(e.target.value)} />
        <input type="date" aria-label="Away until" style={{ ...S.input, flex:"1 1 130px", marginBottom:0 }} value={to} onChange={e => setTo(e.target.value)} />
        <button style={{ ...S.btnSm, background:invalid?"#F3F4F6":C.primary, color:invalid?C.muted:"#fff" }} disabled={invalid} onClick={add}>Add</button>
      </div>
      {from && to && to < from && <div style={{ fontSize:11, color:C.danger, marginTop:4 }}>"Until" is before "from".</div>}
    </div>
  );
}

// ── Manage Config ──────────────────────────────────────────────────────────────

// "Aug 8, 2:14pm" style label for an ISO timestamp, used in the import
// confirmation and nowhere else — the header's own "as of" formatting
// (layer 3) may want the same shape; keep in sync if so.
const formatAsOf = iso => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }).replace(" AM","am").replace(" PM","pm");
};

function ManageConfig({ db, persistDB }) {
  const upd = (k, v) => persistDB({...db, settings:{...db.settings,[k]:v}});
  const fileRef = useRef();
  const [showExport, setShowExport]     = useState(false);
  const [pasteText, setPasteText]       = useState("");
  const [importError, setImportError]   = useState("");
  const [importSuccess, setImportSuccess] = useState(null); // { meals, items, asOf }
  const [copied, setCopied]             = useState(false);
  // Pure-JSON export: _meta summary + fresh published menu + full db, no
  // prepended text header. Valid JSON from byte one so the Shortcut parses it.
  const exportDB   = buildExportDB(db);
  const exportJSON = JSON.stringify(exportDB, null, 2);

  const downloadDB = () => downloadBackup(db, persistDB);

  const copyExport = () => {
    const { now, text } = buildBackupPayload(db);
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    persistDB({ ...db, lastExportedAt: now }, { background: true });
  };

  // Shared by file-import and paste-import: validates, clears _isSeed (this
  // is real external data, not the seed set), and surfaces a specific
  // confirmation (counts + as-of from the imported _meta.dataChangedAt)
  // instead of a bare "Imported!" alert.
  const applyImport = imp => {
    if (!imp.meals || !imp.ingredients) throw new Error("Invalid format");
    if (!previewImportOk(imp)) return false;
    const asOf = imp._meta?.dataChangedAt || null;
    const parsed = {
      ...stripExportNodes(imp),
      settings: { ...DEFAULT_SETTINGS, ...(imp.settings || {}) },
      _isSeed: false,
    };
    persistDB(parsed);
    setImportSuccess({ meals: parsed.meals.length, items: parsed.ingredients.length, asOf });
    return true;
  };

  const importDB = file => {
    const r = new FileReader();
    r.onload = e => {
      try { applyImport(JSON.parse(e.target.result)); }
      catch(err) { alert("Could not import: " + err.message); }
    };
    r.readAsText(file);
  };

  const importFromPaste = () => {
    try {
      if (applyImport(JSON.parse(extractJSON(pasteText)))) { setPasteText(""); setImportError(""); }
    } catch(e) { setImportError("Could not parse: " + e.message); }
  };

  return (
    <div style={S.body}>
      <div style={S.card}>
        <div style={S.sectionLabel}>Cross-device sync — iCloud Drive</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:6 }}>{db.meals.length} meals · {db.ingredients.length} items · {planCount(db.plans)} plans</div>
        <div style={{ fontSize:12, color:C.faint, marginBottom:12 }}>Save to GroceryDB.json in iCloud Drive via shortcut or manual copy</div>

        <button style={{ ...S.btn, background:"#4A90D9", color:"#fff", marginBottom:8 }} onClick={() => window.open("https://www.icloud.com/iclouddrive/","_blank")}>
          ☁️ Open iCloud Drive
        </button>

        <button style={{ ...S.btn, ...S.btnP, marginBottom:8 }} onClick={downloadDB}>
          ⬇️ Download grocery_db.json
        </button>

        <button style={{ ...S.btn, ...S.btnS, marginBottom:8 }} onClick={() => setShowExport(v=>!v)}>
          📤 {showExport?"Hide export":"Export — copy to iCloud Drive"}
        </button>
        {showExport && (
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6, lineHeight:1.5 }}>Select all below (Ctrl+A) and copy, then paste into GroceryDB.json in iCloud Drive — or tap Copy.</div>
            <textarea readOnly value={exportJSON} style={{ ...S.input, height:100, fontSize:11, fontFamily:"monospace", resize:"none", marginBottom:8 }} onFocus={e => e.target.select()} />
            <button style={{ ...S.btn, ...S.btnS, marginBottom:0 }} onClick={copyExport}>{copied ? "✓ Copied" : "📋 Copy to clipboard"}</button>
          </div>
        )}

        <div style={{ fontSize:12, color:C.muted, marginBottom:6, marginTop:4, lineHeight:1.5 }}>To import: open GroceryDB.json in iCloud Drive, copy all, paste below.</div>
        {importSuccess ? (
          <div style={{ background:C.primaryLight, borderRadius:10, padding:"12px 14px", marginBottom:8, textAlign:"center" }}>
            <div style={{ fontWeight:700, color:C.primary }}>✅ Imported your data</div>
            <div style={{ fontSize:13, color:C.muted, marginTop:2 }}>
              {importSuccess.meals} meals · {importSuccess.items} items{importSuccess.asOf ? ` · as of ${formatAsOf(importSuccess.asOf)}` : ""}
            </div>
            <button style={{ background:"none", border:"none", color:C.primary, cursor:"pointer", fontSize:12, marginTop:4, textDecoration:"underline" }} onClick={() => setImportSuccess(null)}>Done</button>
          </div>
        ) : (
          <>
            <textarea style={{ ...S.input, height:80, fontSize:11, fontFamily:"monospace", resize:"none", marginBottom:6 }} placeholder="Paste JSON here to import..." value={pasteText} onChange={e => { setPasteText(e.target.value); setImportError(""); }} />
            {importError && <div style={{ fontSize:12, color:C.danger, marginBottom:6 }}>{importError}</div>}
            <button style={{ ...S.btn, ...S.btnS, marginBottom:8 }} onClick={importFromPaste} disabled={!pasteText.trim()}>📥 Import from paste</button>
          </>
        )}

        <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain,text/*" style={{ display:"none" }} onChange={e => e.target.files[0] && importDB(e.target.files[0])} />
        <button style={{ ...S.btn, ...S.btnS, marginBottom:8 }} onClick={() => fileRef.current.click()}>📥 Import from file</button>
        <button style={{ ...S.btn, ...S.btnD }} onClick={() => { if(window.confirm("Reset to defaults?")) persistDB(DEFAULT_DB); }}>Reset to defaults</button>
      </div>

      <div style={S.card}>
        <div style={S.sectionLabel}>Shopping</div>
        <FieldGroup label="Default plan start day">
          <select style={S.select} value={db.settings.shoppingDay} onChange={e => upd("shoppingDay",e.target.value)}>
            {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <div style={{ fontSize:12, color:C.faint, marginTop:4 }}>Seeds the start date for a brand-new plan. Each plan's own date (editable anytime) is what actually orders its days — not this setting.</div>
        </FieldGroup>
      </div>

      <div style={S.card}>
        <div style={S.sectionLabel}>Cooking</div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0" }}>
          <div><div style={{ fontWeight:600 }}>Grill season open</div><div style={{ fontSize:12, color:C.faint }}>Turn off when you close the grill for the year. Grillable meals need this and grill weather.</div></div>
          <Toggle value={db.settings.grillOpen !== false} onChange={v => upd("grillOpen",v)} />
        </div>
      </div>

      <div style={S.card}>
        <div style={S.sectionLabel}>Family</div>
        <AwayPeriods contacts={db.settings.familyContacts || []} ranges={db.settings.awayRanges || []} onChange={r => upd("awayRanges", r)} />
        {(db.settings.familyContacts||[]).map((f,i,arr) => (
          <div key={f.name} style={{ ...S.row, padding:"10px 0", ...(i===arr.length-1?S.rowLast:{}) }}>
            <div style={{ flex:1 }}><div style={{ fontWeight:600 }}>{f.name}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { ManageConfig, formatAsOf };
