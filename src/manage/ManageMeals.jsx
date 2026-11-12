// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { renameMeal } from "../mealRename.js";
import { useState } from "react";
import { MEAL_TYPES, toSentenceCase } from "../app/globals.js";
import { SEED_TS } from "../app/seed.js";
import { C, EFFORT_COLORS, S } from "../app/styles.js";
import { SearchBar } from "../components/common.jsx";
import { MealEditor, mealMatches } from "./MealEditor.jsx";

function ManageMeals({ db, persistDB }) {
  const [search, setSearch]   = useState("");
  const [filter, setFilter]   = useState("all");
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [newMealName, setNewMealName] = useState("");

  const filtered = db.meals.filter(m => (filter==="all"||m.type===filter) && mealMatches(m, search))
    .sort((a, b) => new Date(b.createdAt||SEED_TS) - new Date(a.createdAt||SEED_TS));

  // One write for the meal and every side whose link to it changed (a main's sides are
  // stored on the sides). `sides` is null when the saved meal is itself a side.
  // A renamed meal is renamed everywhere plans and history name it (renameMeal) first.
  const saveMeal = (form, sides) => {
    const base = editing==="new" ? db : renameMeal(db, form.id, form.name);
    const saved = { ...form, name: form.name.trim() };
    let meals = editing==="new" ? [...base.meals, saved] : base.meals.map(m => m.id===form.id ? saved : m);
    if (sides) meals = meals.map(m => {
      if (m.type !== "side" || m.id === form.id) return m;
      const has = (m.pairsWith || []).includes(form.id), want = sides.has(m.id);
      if (has === want) return m;
      if (want) return { ...m, pairsWith: [...(m.pairsWith || []), form.id] };
      const { pairsWith, ...rest } = m;
      const left = pairsWith.filter(x => x !== form.id);
      return left.length ? { ...rest, pairsWith: left } : rest;   // an emptied list goes, as it was before
    });
    persistDB({...base, meals}); setEditing(null);
  };
  const deleteMeal = id => {
    const meal = db.meals.find(m => m.id === id);
    setConfirmDelete({
      message: `Delete "${meal?.name}"?`,
      // Also drop the deleted meal from every side's pairsWith, so no link dangles.
      onConfirm: () => { persistDB({...db, meals:db.meals.filter(m=>m.id!==id).map(m => (m.pairsWith||[]).includes(id) ? { ...m, pairsWith: m.pairsWith.filter(x => x !== id) } : m)}); setEditing(null); setConfirmDelete(null); }
    });
  };
  const addIngredient = newIng => persistDB({...db, ingredients:[...db.ingredients, newIng]});
  const addIngredients = list => persistDB({...db, ingredients:[...db.ingredients, ...list]});
  const setPantryIgnore = list => persistDB({...db, settings:{ ...db.settings, pantryIgnore:list }});

  if (editing) return (
    <div style={S.body}>
      {confirmDelete && (
        <div style={{ background:C.dangerLight, border:`1px solid ${C.danger}`, borderRadius:10, padding:"12px 14px", marginBottom:10, position:"sticky", top:8, zIndex:30, boxShadow:"0 4px 16px rgba(0,0,0,0.18)" }}>
          <div style={{ fontSize:13, color:C.danger, marginBottom:10 }}>{confirmDelete.message}</div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ ...S.btnSm, background:C.danger, color:"#fff", cursor:"pointer", flex:1, textAlign:"center" }} onClick={confirmDelete.onConfirm}>Yes, delete</div>
            <div style={{ ...S.btnSm, background:"#F3F4F6", color:C.muted, cursor:"pointer", flex:1, textAlign:"center" }} onClick={() => setConfirmDelete(null)}>Cancel</div>
          </div>
        </div>
      )}
      <MealEditor meal={editing==="new"?null:editing} allMeals={db.meals} initialName={editing==="new"?newMealName:""} ingredients={db.ingredients} familyContacts={db.settings?.familyContacts} onSave={saveMeal} onCancel={() => { setEditing(null); setConfirmDelete(null); setNewMealName(""); }} onDelete={deleteMeal} onAddIngredient={addIngredient} onAddIngredients={addIngredients} pantryIgnore={db.settings?.pantryIgnore} onSetPantryIgnore={setPantryIgnore} />
    </div>
  );

  return (
    <div style={S.body}>
      <SearchBar value={search} onChange={setSearch} placeholder="Search meals..." />
      <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
        {["all",...MEAL_TYPES].map(t => <button key={t} style={{ ...S.btnSm, background:filter===t?C.primary:C.surface, color:filter===t?"#fff":C.muted, border:`1px solid ${C.border}` }} onClick={() => setFilter(t)}>{t}</button>)}
      </div>
      {filtered.length===0 && (
        search.trim()
          ? <div style={{ textAlign:"center", padding:"32px 20px" }}>
              <div style={{ color:C.faint, marginBottom:12 }}>No meals match "{search}".</div>
              <button style={{ ...S.btn, ...S.btnP, display:"inline-block", width:"auto", padding:"11px 18px", marginBottom:0, cursor:"pointer" }}
                onClick={() => { setNewMealName(search); setEditing("new"); }}>
                + Add "{toSentenceCase(search)}" as a new meal
              </button>
            </div>
          : <div style={{ textAlign:"center", padding:"40px 20px", color:C.faint }}>No meals. Tap + to add.</div>
      )}
      <div style={S.cardFlat}>
        {filtered.map((meal, i) => {
          const ec       = EFFORT_COLORS[meal.effort] || {};
          const dislikes = (meal.preferences||[]).filter(p=>p.pref==="dislikes").map(p=>p.person);
          const likes    = (meal.preferences||[]).filter(p=>p.pref==="likes").map(p=>p.person);
          return (
            <div key={meal.id} style={{ ...S.row, ...(i===filtered.length-1?S.rowLast:{}), cursor:"default" }}>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:3 }}>
                  <span style={{ fontWeight:600, fontSize:15 }}>{meal.name}</span>
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                  <span style={S.badge(ec.color,ec.bg)}>{meal.effort}</span>
                  {meal.tempAffinity==="comfort" && <span style={S.badge("#B45309","#FEF3C7")}>comfort</span>}
                  {meal.tempAffinity==="light"   && <span style={S.badge("#0369A1","#E0F2FE")}>light</span>}
                  {meal.grillable && <span style={S.badge("#9A3412","#FFEDD5")}>grill</span>}
                  {meal.soon && <span style={S.badge("#6D28D9","#EDE9FE")} title="Wanted soon: put forward for the next plan until you turn it off">soon</span>}
                  {meal.leftovers!=="none" && <span style={S.badge("#374151","#F3F4F6")}>leftovers</span>}
                  {meal.type!=="dinner"    && <span style={S.badge(C.primary,C.primaryLight)}>{meal.type}</span>}
                  {dislikes.length>0 && <span style={S.badge(C.danger,C.dangerLight)}>👎 {dislikes.join(", ")}</span>}
                  {likes.length>0    && <span style={S.badge(C.verified,"#E8F5EE")}>👍 {likes.join(", ")}</span>}
                </div>
                {meal.ingredients?.length>0 && <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>{meal.ingredients.length} ingredients</div>}
              </div>
              <button style={{ background:"none", border:"none", cursor:"pointer", color:C.faint, fontSize:18, padding:"4px" }} onClick={() => setEditing(meal)}>›</button>
            </div>
          );
        })}
      </div>
      <button style={{ position:"fixed", bottom:80, right:16, background:C.primary, color:"#fff", border:"none", borderRadius:28, padding:"13px 20px", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.25)", zIndex:20 }} onClick={() => { setNewMealName(""); setEditing("new"); }}>+ Meal</button>
    </div>
  );
}

export { ManageMeals };
