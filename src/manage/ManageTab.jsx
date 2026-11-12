// Split verbatim from grocery-app.jsx in polish Phase 1.5; see CLAUDE.md's file map.
import { useState } from "react";
import { C, S } from "../app/styles.js";
import { ManageConfig } from "./ManageConfig.jsx";
import { ManageHelp } from "./ManageHelp.jsx";
import { ManageItems } from "./ManageItems.jsx";
import { ManageMeals } from "./ManageMeals.jsx";

// ── MANAGE TAB ─────────────────────────────────────────────────────────────────

function ManageTab({ db, persistDB, initialSub, initialItemsLoc }) {
  // ManageTab is unmounted/remounted on every tab switch (App only renders it
  // while tab==="manage"), so a caller can land the user on a specific
  // sub-tab (e.g. the header's Import action → Config) just by setting this
  // prop before switching tab — no lifted state needed.
  const [sub, setSub] = useState(initialSub || "meals");
  const SUBS = [{id:"meals",label:"Meals"},{id:"items",label:"Items"},{id:"config",label:"Config"},{id:"help",label:"Help"}];
  return (
    <div>
      <div style={{ background:C.primary, padding:"0 16px", position:"sticky", top:52, zIndex:8 }}>
        <div style={{ display:"flex" }}>
          {SUBS.map(s => <button key={s.id} style={S.tab(sub===s.id)} onClick={() => setSub(s.id)}>{s.label}</button>)}
        </div>
      </div>
      {sub==="meals"  && <ManageMeals  db={db} persistDB={persistDB} />}
      {sub==="items"  && <ManageItems  db={db} persistDB={persistDB} initialLoc={initialItemsLoc} />}
      {sub==="config" && <ManageConfig db={db} persistDB={persistDB} />}
      {sub==="help"   && <ManageHelp />}
    </div>
  );
}

export { ManageTab };
