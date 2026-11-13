// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { useState } from "react";
import { DEFAULT_SUBTYPE, STORAGE_LOCATIONS, TIERS, TIER_SUBTYPES, tierOptions, tierValueOf, toSentenceCase } from "../app/globals.js";
import { mapBothPlans } from "../app/plans.js";
import { SEED_TS } from "../app/seed.js";
import { C, S, TIER_COLORS } from "../app/styles.js";
import { FieldGroup, PillSelect, SearchBar } from "../components/common.jsx";

// ── Ingredient editor ──────────────────────────────────────────────────────────

function IngredientEditor({ ingredient, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(ingredient || { id:"i"+Date.now(), createdAt:new Date().toISOString(), name:"", storageLocation:"Pantry", tier:"specialty", defaultQuantity:"" });
  const set = (k, v) => setForm(p => ({...p,[k]:v}));
  return (
    <div>
      <div style={{ ...S.card, background:C.primary, color:"#fff", marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:700, opacity:0.7, marginBottom:4 }}>{ingredient?"EDIT ITEM":"NEW ITEM"}</div>
        <div style={{ fontSize:18, fontWeight:700 }}>{form.name||"Untitled"}</div>
      </div>
      <div style={S.card}>
        <FieldGroup label="Name"><input style={S.input} value={form.name} onChange={e => set("name", toSentenceCase(e.target.value))} placeholder="e.g. Pasta sauce (red)" /></FieldGroup>
        <FieldGroup label="Default quantity"><input style={S.input} value={form.defaultQuantity} onChange={e => set("defaultQuantity",e.target.value)} placeholder="e.g. 2 cans, 1 gallon" /></FieldGroup>
      </div>
      <div style={S.card}>
        <FieldGroup label="Where you store it"><PillSelect options={STORAGE_LOCATIONS} value={form.storageLocation} onChange={v => set("storageLocation",v)} /></FieldGroup>
        <FieldGroup label="Tier"><PillSelect options={TIERS} value={form.tier} onChange={v => set("tier",v)} />
          <div style={{ fontSize:12, color:C.faint, marginTop:4 }}>{form.tier==="always"?"Buy every week":form.tier==="staple"?"Keep stocked, add when low":"Only when needed for a meal"}</div>
        </FieldGroup>
        {(TIER_SUBTYPES[form.tier]||[]).length > 0 && (
          <FieldGroup label={`${form.tier.charAt(0).toUpperCase()+form.tier.slice(1)} type`}>
            <PillSelect options={TIER_SUBTYPES[form.tier]} value={form.stapleType || DEFAULT_SUBTYPE(form.tier)} onChange={v => set("stapleType",v)} />
            <div style={{ fontSize:12, color:C.faint, marginTop:4 }}>{(form.stapleType||DEFAULT_SUBTYPE(form.tier))==="weekly"?"Runs out weekly — check closely each shop":"Lasts a while — quick scan, usually fine"}</div>
          </FieldGroup>
        )}
      </div>
      <button style={{ ...S.btn, ...S.btnP }} onClick={() => onSave(form)}>Save item</button>
      <button style={{ ...S.btn, ...S.btnS }} onClick={onCancel}>Cancel</button>
      {ingredient && <div style={{ ...S.btn, ...S.btnD, cursor:"pointer" }} onClick={() => onDelete(ingredient.id)}>Delete item</div>}
    </div>
  );
}

// ── Table row (desktop bulk edit) ──────────────────────────────────────────────

function TableRow({ ing, isAlt, onSave, selected, onToggle, onDelete }) {
  const [editField, setEditField] = useState(null);
  const [val, setVal]             = useState("");

  const startEdit = field => { setEditField(field); setVal(ing[field]||""); };
  const commit    = (field, value) => { onSave({...ing,[field]:value}); setEditField(null); };

  const cell = { padding:"8px 12px", borderBottom:`1px solid ${C.border}`, verticalAlign:"middle", background:isAlt?"#FAFAFA":"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" };
  const editCell = field => (
    editField===field
      ? <input autoFocus style={{ width:"100%", boxSizing:"border-box", padding:"4px 8px", borderRadius:6, border:`1.5px solid ${C.primary}`, fontSize:13, outline:"none" }} value={val} onChange={e => setVal(e.target.value)} onBlur={() => commit(field, field==="name"?toSentenceCase(val):val)} onKeyDown={e => { if(e.key==="Enter") commit(field, field==="name"?toSentenceCase(val):val); if(e.key==="Escape") setEditField(null); }} />
      : <span style={{ cursor:"pointer", borderBottom:`1px dashed ${C.border}` }} onClick={() => startEdit(field)}>{ing[field]||<span style={{ color:C.faint, fontStyle:"italic" }}>tap to set</span>}</span>
  );

  return (
    <tr style={{ background:selected ? "#EEF2FF" : (isAlt ? "#FAFAFA" : "#fff") }}>
      <td style={{ ...cell, textAlign:"center", background:selected?"#EEF2FF":undefined }}>
        <input type="checkbox" checked={!!selected} onChange={onToggle} />
      </td>
      <td style={cell}>{editCell("name")}</td>
      <td style={cell}>{editCell("defaultQuantity")}</td>
      <td style={cell}>
        <select style={{ fontSize:12, border:`1px solid ${C.border}`, borderRadius:6, padding:"3px 6px", background:"#fff", cursor:"pointer" }} value={ing.storageLocation} onChange={e => onSave({...ing,storageLocation:e.target.value})}>
          {STORAGE_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </td>
      <td style={cell}>
        <select style={{ fontSize:12, border:`1px solid ${C.border}`, borderRadius:6, padding:"3px 6px", background:"#fff", cursor:"pointer" }} value={tierValueOf(ing)} onChange={e => {
          const opt = tierOptions().find(o => o.value === e.target.value);
          if (opt) onSave({ ...ing, tier:opt.tier, stapleType:opt.subtype || undefined });
        }}>
          {tierOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td style={{ ...cell, textAlign:"center" }}>
        <div style={{ cursor:"pointer", color:C.danger, fontSize:16, fontWeight:700 }} onClick={onDelete}>×</div>
      </td>
    </tr>
  );
}

function ManageItems({ db, persistDB, initialLoc }) {
  const [search, setSearch]       = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [filterLoc, setFilterLoc]   = useState(initialLoc || "all");
  const [editing, setEditing]     = useState(null);
  const [quickAdd, setQuickAdd]   = useState(false);
  const [quickName, setQuickName] = useState("");
  const [tableView, setTableView] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // { message, onConfirm }

  const filtered = db.ingredients.filter(i => {
    const ms = i.name.toLowerCase().includes(search.toLowerCase());
    const mt = filterTier==="all" || filterTier===i.tier;
    const ml = filterLoc==="all" || i.storageLocation===filterLoc;
    return ms && mt && ml;
  }).sort((a, b) => new Date(b.createdAt||SEED_TS) - new Date(a.createdAt||SEED_TS));

  const saveIng  = form => { persistDB({...db, ingredients:editing==="new"?[...db.ingredients,form]:db.ingredients.map(i=>i.id===form.id?form:i)}); setEditing(null); };
  const deleteIng = id => {
    const ing = db.ingredients.find(i => i.id === id);
    if (!ing) return;
    const usedInMeals = db.meals.filter(m => (m.ingredients||[]).includes(id)).map(m => m.name);
    const msg = usedInMeals.length > 0
      ? `"${ing.name}" is used in ${usedInMeals.join(", ")}. Deleting removes it from those meals too.`
      : `Delete "${ing.name}"?`;
    setConfirmDelete({
      message: msg,
      onConfirm: () => {
        const ingredients = db.ingredients.filter(i => i.id !== id);
        const meals = db.meals.map(m => ({...m, ingredients:(m.ingredients||[]).filter(i => i !== id)}));
        persistDB(mapBothPlans({...db, ingredients, meals}, p => ({...p, items:(p.items||[]).filter(i => i.ingredientId !== id)})));
        setEditing(null);
        setConfirmDelete(null);
      }
    });
  };
  const doQuickAdd = () => {
    if (!quickName.trim()) return;
    const name = toSentenceCase(quickName.trim());
    persistDB({...db, ingredients:[...db.ingredients, { id:"i"+Date.now(), createdAt:new Date().toISOString(), name, storageLocation:"Unassigned", tier:"specialty", defaultQuantity:"" }]});
    setQuickName(""); setQuickAdd(false); setSearch("");
  };

  const toggleSelect = id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll  = () => setSelected(new Set(filtered.map(i => i.id)));
  const selectNone = () => setSelected(new Set());

  const bulkDelete = () => {
    const ids = [...selected];
    const affectedMeals = [...new Set(db.meals.filter(m => (m.ingredients||[]).some(id => ids.includes(id))).map(m => m.name))];
    const msg = affectedMeals.length > 0
      ? `Delete ${ids.length} items? Also removes them from: ${affectedMeals.join(", ")}.`
      : `Delete ${ids.length} selected items?`;
    setConfirmDelete({
      message: msg,
      onConfirm: () => {
        const ingredients = db.ingredients.filter(i => !ids.includes(i.id));
        const meals = db.meals.map(m => ({...m, ingredients:(m.ingredients||[]).filter(id => !ids.includes(id))}));
        persistDB(mapBothPlans({...db, ingredients, meals}, p => ({...p, items:(p.items||[]).filter(i => !ids.includes(i.ingredientId))})));
        setSelected(new Set());
        setConfirmDelete(null);
      }
    });
  };

  if (editing) return (
    <div style={S.body}>
      {confirmDelete && (
        <div style={{ background:C.dangerLight, border:`1px solid ${C.danger}`, borderRadius:10, padding:"12px 14px", marginBottom:10, position:"sticky", top:8, zIndex:30, boxShadow:"0 4px 16px rgba(0,0,0,0.18)" }}>
          <div style={{ fontSize:13, color:C.danger, marginBottom:10, lineHeight:1.5 }}>{confirmDelete.message}</div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ ...S.btnSm, background:C.danger, color:"#fff", cursor:"pointer", flex:1, textAlign:"center" }} onClick={confirmDelete.onConfirm}>Yes, delete</div>
            <div style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted, cursor:"pointer", flex:1, textAlign:"center" }} onClick={() => setConfirmDelete(null)}>Cancel</div>
          </div>
        </div>
      )}
      <IngredientEditor ingredient={editing==="new"?null:editing} onSave={saveIng} onCancel={() => { setEditing(null); setConfirmDelete(null); }} onDelete={deleteIng} />
    </div>
  );

  return (
    <div style={S.body}>
      <div style={{ display:"flex", gap:8, marginBottom:10, alignItems:"center" }}>
        <div style={{ flex:1 }}><SearchBar value={search} onChange={setSearch} placeholder="Search items..." /></div>
        <button style={{ ...S.btnSm, background:tableView?C.primary:C.surface, color:tableView?"#fff":C.muted, border:`1px solid ${C.border}`, flexShrink:0 }} onClick={() => setTableView(v=>!v)}>{tableView?"Card":"Table"}</button>
      </div>

      {quickAdd ? (
        <div style={{ ...S.card, marginBottom:10 }}>
          <div style={{ fontSize:12, color:C.muted, marginBottom:6, fontWeight:600 }}>New item name:</div>
          <div style={{ display:"flex", gap:8 }}>
            <input autoFocus style={{ ...S.input, flex:1, fontSize:14, padding:"8px 10px" }} placeholder={search||"e.g. Aluminum foil"} value={quickName} onChange={e => setQuickName(e.target.value)} onKeyDown={e => { if(e.key==="Enter") doQuickAdd(); if(e.key==="Escape"){setQuickAdd(false);setQuickName("");} }} />
            <button style={{ ...S.btnSm, background:C.primary, color:"#fff" }} onClick={doQuickAdd}>Add</button>
            <button style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted }} onClick={() => {setQuickAdd(false);setQuickName("");}}>×</button>
          </div>
        </div>
      ) : (
        <button style={{ ...S.btn, ...S.btnS, marginBottom:10, fontSize:14 }} onClick={() => {setQuickAdd(true);setQuickName(search);}}>
          {search?`+ Add "${search}" as new item`:"+ Add new item"}
        </button>
      )}

      <div style={{ display:"flex", gap:6, marginBottom:6, flexWrap:"wrap" }}>
        {[["all","All"],...TIERS.map(t=>[t,t])].map(([val,label]) => <button key={val} style={{ ...S.btnSm, background:filterTier===val?C.primary:C.surface, color:filterTier===val?"#fff":C.muted, border:`1px solid ${C.border}` }} onClick={() => setFilterTier(val)}>{label}</button>)}
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
        {["all",...STORAGE_LOCATIONS].map(l => <button key={l} style={{ ...S.btnSm, background:filterLoc===l?C.primary:C.surface, color:filterLoc===l?"#fff":C.muted, border:`1px solid ${C.border}` }} onClick={() => setFilterLoc(l)}>{l}</button>)}
      </div>

      {filtered.length===0 && <div style={{ textAlign:"center", padding:"40px 20px", color:C.faint }}>No items. Tap + to add.</div>}

      {tableView ? (
        <div style={{ marginBottom:80 }}>
          {confirmDelete && (
        <div style={{ background:C.dangerLight, border:`1px solid ${C.danger}`, borderRadius:10, padding:"12px 14px", marginBottom:10 }}>
          <div style={{ fontSize:13, color:C.danger, marginBottom:10, lineHeight:1.5 }}>{confirmDelete.message}</div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ ...S.btnSm, background:C.danger, color:"#fff", cursor:"pointer", flex:1, textAlign:"center" }} onClick={confirmDelete.onConfirm}>Yes, delete</div>
            <div style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted, cursor:"pointer", flex:1, textAlign:"center" }} onClick={() => setConfirmDelete(null)}>Cancel</div>
          </div>
        </div>
      )}
      {selected.size > 0 && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:C.dangerLight, borderRadius:10, padding:"10px 14px", marginBottom:8 }}>
              <span style={{ fontSize:13, color:C.danger, fontWeight:600 }}>{selected.size} item{selected.size > 1 ? "s" : ""} selected</span>
              <div style={{ display:"flex", gap:8 }}>
                <button style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted }} onClick={selectNone}>Clear</button>
                <div style={{ ...S.btnSm, background:C.danger, color:"#fff", cursor:"pointer" }} onClick={bulkDelete}>Delete {selected.size}</div>
              </div>
            </div>
          )}
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, background:C.surface, borderRadius:14, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", tableLayout:"fixed" }}>
            <colgroup>
              <col style={{ width:"5%" }} />
              <col style={{ width:"25%" }} />
              <col style={{ width:"16%" }} />
              <col style={{ width:"20%" }} />
              <col style={{ width:"16%" }} />
              <col style={{ width:"12%" }} />
              <col style={{ width:"6%" }} />
            </colgroup>
            <thead>
              <tr style={{ background:C.primary, color:"#E8F5EE" }}>
                <th style={{ padding:"10px 8px", textAlign:"center" }}>
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={e => e.target.checked ? selectAll() : selectNone()} />
                </th>
                <th style={{ padding:"10px 12px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Name</th>
                <th style={{ padding:"10px 12px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Qty</th>
                <th style={{ padding:"10px 8px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Location</th>
                <th style={{ padding:"10px 8px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Tier</th>
                <th style={{ padding:"10px 8px", textAlign:"center", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Del</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ing, i) => (
                <TableRow key={ing.id} ing={ing} isAlt={i%2===1} selected={selected.has(ing.id)} onToggle={() => toggleSelect(ing.id)} onSave={updated => persistDB({...db, ingredients:db.ingredients.map(x=>x.id===updated.id?updated:x)})} onDelete={() => deleteIng(ing.id)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={S.cardFlat}>
          {filtered.map((ing, i) => {
            const tc       = TIER_COLORS[ing.tier] || {};
            return (
              <div key={ing.id} style={{ ...S.row, ...(i===filtered.length-1?S.rowLast:{}), flexDirection:"column", alignItems:"stretch", gap:5, cursor:"pointer" }} onClick={() => setEditing(ing)}>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ fontWeight:600, fontSize:15 }}>{ing.name}</span>
                  <span style={{ flex:1 }} />
                  <div style={{ color:C.faint, fontSize:16 }}>›</div>
                </div>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                  <span style={S.badge(tc.color,tc.bg)}>{(TIER_SUBTYPES[ing.tier]||[]).length ? `${ing.tier} · ${ing.stapleType||DEFAULT_SUBTYPE(ing.tier)}` : ing.tier}</span>
                  <span style={S.badge(C.muted,"#F3F4F6")}>{ing.storageLocation}</span>
                  {ing.defaultQuantity && <span style={S.badge(C.muted,"#F3F4F6")}>{ing.defaultQuantity}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button style={{ position:"fixed", bottom:"calc(88px + env(safe-area-inset-bottom, 0px))", right:16, background:C.primary, color:"#fff", border:"none", borderRadius:28, padding:"13px 20px", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.25)", zIndex:20 }} onClick={() => setEditing("new")}>+ Item</button>
    </div>
  );
}

export { ManageItems };
