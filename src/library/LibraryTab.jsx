// Library (boards "Library lists", "Scrolling pattern"; Decisions 11/15–16). A title row,
// "Library", with the data and gear icons on its right as on Home (11/16, reversing 'no
// title'); then the Meals | Items toggle, search, and the filter chips with the sort button.
// The whole header stays on scroll; group labels stick under it.
// Meals: To finish → New → Mains → Sides. Items: To finish → by place (Inventory order), by
// buy type, or one list. To finish and New stay on top whatever the sort. A stable amber dot
// on Meals / Items while that tab has anything to finish (none on the Library tab itself).
// A search with no results offers Add "<text>", which opens Grab with the name filled in.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { todayLocalISO, toSentenceCase } from "../app/globals.js";
import { Chip, Group, HeaderButtons, Row, SearchField, Segmented, SortMenu, TopBar } from "../ui/kit.jsx";
import { sendToAI } from "../app/sendToAI.js";
import { ItemPage } from "./ItemPage.jsx";
import { MealPage } from "./MealPage.jsx";
import {
  ITEM_SORTS, MEAL_SORTS, isSide, itemGroups, itemsToFinish, mealGroups, mealHistoryIndex, mealsToFinish,
} from "./libraryModel.js";

const MEAL_FILTERS = [{ value: "mains", label: "Mains" }, { value: "sides", label: "Sides" }];
const ITEM_FILTERS = [{ value: "always", label: "Always" }, { value: "staples", label: "Staples" }, { value: "meals", label: "For meals" }];

// Pages open as a stack (11/16): the back link names the screen you came from and returns to
// it at its scroll position ("‹ Corn on the cob" after Item › Used in › meal). Tapping the
// Library tab (`resetKey` changes) always returns to the list's top.
export function LibraryTab({ db, persistDB, view, setView, headerIcons, resetKey, openRequest, onGrab }) {
  const today = todayLocalISO();
  const [stack, setStack] = useState([]);           // [{ kind: "meal" | "item", id, scroll }]
  const page = stack[stack.length - 1] || null;
  const restoreTo = useRef(0);                      // where to scroll once the screen shows
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
  // Each screen shows at its own scroll position: a new page at the top, a screen you come
  // back to where you left it. Runs after the page's own scroll-to-top.
  useEffect(() => { window.scrollTo(0, restoreTo.current); }, [stack.length, page?.id]);
  useEffect(() => { if (resetKey) { scrollRef.current = 0; restoreTo.current = 0; setStack([]); } }, [resetKey]);
  // A page opened from elsewhere (Grab › Add details) opens on top of the list.
  useEffect(() => { if (openRequest) { restoreTo.current = 0; scrollRef.current = 0; setStack([{ kind: openRequest.kind, id: openRequest.id }]); } }, [openRequest]);
  const openPage = p => {
    const y = window.scrollY;   // read now: the next screen scrolls to its top before React runs the updater
    if (!stack.length) scrollRef.current = y;
    restoreTo.current = 0;
    setStack(st => [...st.slice(0, -1), ...(st.length ? [{ ...st[st.length - 1], scroll: y }] : []), p]);
  };
  const back = () => {
    const prev = stack[stack.length - 2];
    restoreTo.current = prev ? prev.scroll || 0 : scrollRef.current;
    setStack(st => st.slice(0, -1));
  };
  const nameOf = p => (p.kind === "meal" ? (db.meals || []).find(m => m.id === p.id)?.name : (db.ingredients || []).find(i => i.id === p.id)?.name) || "Back";
  const backLabel = stack.length > 1 ? nameOf(stack[stack.length - 2]) : "Library";

  if (page?.kind === "meal") return <MealPage db={db} persistDB={persistDB} mealId={page.id} onBack={back} backLabel={backLabel} />;
  if (page?.kind === "item") return <ItemPage db={db} persistDB={persistDB} itemId={page.id} onBack={back} backLabel={backLabel} onOpenMeal={id => openPage({ kind: "meal", id })} />;

  const meals = db.meals || [], items = db.ingredients || [];
  const hist = mealHistoryIndex(db, today);
  const groups = view === "meals" ? mealGroups(meals, hist, s) : itemGroups(items, s);
  // A search with no results offers Add "<text>": the Grab sheet, with the name filled in.
  const addNew = () => { onGrab?.({ kind: view === "meals" ? "meal" : "item", name: s.q.trim() }); set({ q: "" }); };

  return (
    <div className="lib">
      <div className="lib-head" ref={headRef}>
        <TopBar title="Library"><HeaderButtons>{headerIcons}</HeaderButtons></TopBar>
        <Segmented label="Meals or items" value={view} onChange={setView} options={[
          { value: "meals", label: "Meals", dot: mealsToFinish(meals, hist) },
          { value: "items", label: "Items", dot: itemsToFinish(items) },
        ]} />
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
          <div className="ui-section-label lib-sticky lib-sticky-row" style={{ top: headH }}>
            <span>{`${g.label} · ${g.rows.length}`}</span>
            {/* To finish › Send to AI: fills in every meal in the group in one round trip (11/15). */}
            {view === "meals" && g.key === "finish" && (
              <button type="button" className="lib-ai-pill" onClick={() => sendToAI(db, persistDB, { purpose: "enrich", meals: g.rows.map(r => r.meal.id) })}>Send to AI</button>
            )}
          </div>
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
