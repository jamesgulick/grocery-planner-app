// Library (boards "Library lists", "Scrolling pattern"; Decisions 11/15). No title: the
// Meals | Items toggle heads the page beside the header icons, then search, then the filter
// chips and the sort button. These controls stay with the header; group labels stick.
// Meals: To finish → New → Mains → Sides. Items: To finish → by place (Inventory order), by
// buy type, or one list. To finish and New stay on top whatever the sort. A stable amber dot
// on Meals / Items while that tab has anything to finish (none on the Library tab itself).
// A search with no results offers Add "<text>": the new meal (New, Wanted soon on) or item
// (no place yet) opens on its page.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { todayLocalISO, toSentenceCase } from "../app/globals.js";
import { Chip, Group, Row, SearchField, Segmented, SortMenu } from "../ui/kit.jsx";
import { ItemPage } from "./ItemPage.jsx";
import { MealPage } from "./MealPage.jsx";
import {
  ITEM_SORTS, MEAL_SORTS, isSide, itemGroups, itemsToFinish, mealGroups, mealHistoryIndex, mealsToFinish,
} from "./libraryModel.js";

const MEAL_FILTERS = [{ value: "mains", label: "Mains" }, { value: "sides", label: "Sides" }];
const ITEM_FILTERS = [{ value: "always", label: "Always" }, { value: "staples", label: "Staples" }, { value: "meals", label: "For meals" }];

export function LibraryTab({ db, persistDB, view, setView, headerIcons }) {
  const today = todayLocalISO();
  const [page, setPage] = useState(null);           // { kind: "meal" | "item", id }
  const [state, setState] = useState({ meals: { q: "", filter: null, sort: "az" }, items: { q: "", filter: null, sort: "place" } });
  const scrollRef = useRef(0);
  const headRef = useRef(null);
  const [headH, setHeadH] = useState(0);
  const s = state[view];
  const set = patch => setState(st => ({ ...st, [view]: { ...st[view], ...patch } }));

  useLayoutEffect(() => {
    const el = headRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeadH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);
  // Coming back from a page puts the list where it was.
  useEffect(() => { if (!page) window.scrollTo(0, scrollRef.current); }, [page]);
  const openPage = p => { scrollRef.current = window.scrollY; setPage(p); };

  if (page?.kind === "meal") return <MealPage db={db} persistDB={persistDB} mealId={page.id} onBack={() => setPage(null)} />;
  if (page?.kind === "item") return <ItemPage db={db} persistDB={persistDB} itemId={page.id} onBack={() => setPage(null)} onOpenMeal={id => setPage({ kind: "meal", id })} />;

  const meals = db.meals || [], items = db.ingredients || [];
  const hist = mealHistoryIndex(db, today);
  const groups = view === "meals" ? mealGroups(meals, hist, s) : itemGroups(items, s);
  const addNew = () => {
    const name = toSentenceCase(s.q.trim());
    const now = new Date().toISOString();
    if (view === "meals") {
      const id = "m" + Date.now() + Math.random().toString(36).slice(2, 5);
      persistDB({ ...db, meals: [...meals, { id, createdAt: now, name, type: "dinner", rotation: "experimental", soon: true, leftovers: "none", preferences: [], notes: "", ingredients: [] }] });
      set({ q: "" }); openPage({ kind: "meal", id });
    } else {
      const id = "i" + Date.now() + Math.random().toString(36).slice(2, 5);
      persistDB({ ...db, ingredients: [...items, { id, createdAt: now, name, storageLocation: "Unassigned", tier: "specialty", defaultQuantity: "" }] });
      set({ q: "" }); openPage({ kind: "item", id });
    }
  };

  return (
    <div className="lib">
      <div className="lib-head" ref={headRef}>
        <div className="lib-head-top">
          <div className="lib-toggle">
            <Segmented label="Library" value={view} onChange={setView} options={[
              { value: "meals", label: "Meals", dot: mealsToFinish(meals, hist) },
              { value: "items", label: "Items", dot: itemsToFinish(items) },
            ]} />
          </div>
          <div className="ui-icons">{headerIcons}</div>
        </div>
        <SearchField value={s.q} onChange={q => set({ q })} placeholder={view === "meals" ? "Search meals" : "Search items"} />
        <div className="lib-filters">
          <div className="ui-chips lib-chips">
            {(view === "meals" ? MEAL_FILTERS : ITEM_FILTERS).map(f => (
              <Chip key={f.value} on={s.filter === f.value} onClick={() => set({ filter: s.filter === f.value ? null : f.value })}>{f.label}</Chip>
            ))}
          </div>
          <SortMenu options={view === "meals" ? MEAL_SORTS : ITEM_SORTS} value={s.sort} onChange={sort => set({ sort })} />
        </div>
      </div>

      {groups.map(g => (
        <section key={g.key} className="lib-list-group">
          <div className="ui-section-label lib-sticky" style={{ top: headH }}>{`${g.label} · ${g.rows.length}`}</div>
          <Group>
            {g.rows.map(r => view === "meals"
              ? <Row key={r.meal.id} title={r.meal.name} strong={!isSide(r.meal)} sub={r.line} problem={r.problem} onClick={() => openPage({ kind: "meal", id: r.meal.id })} />
              : <Row key={r.item.id} title={r.item.name} sub={r.line} problem={r.problem} onClick={() => openPage({ kind: "item", id: r.item.id })} />)}
          </Group>
        </section>
      ))}
      {!groups.length && s.q.trim() && (
        <Group><Row title={`Add “${s.q.trim()}”`} onClick={addNew} /></Group>
      )}
    </div>
  );
}
