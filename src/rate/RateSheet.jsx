// The rate sheet, "How did <meal> go?" (brief §2; board "Graduation"). Opened from Home's
// "Meals to rate" (steps through them, "1 of 2"), a past day's Rate pill, or the plate sheet's
// Rate on any past dish. "2 of 3" by the title in a run; "First try · All details ›" under it. Who eats it per person (people out that night shown, not asked), How
// often (not on a Hand-picked meal), Time needed, All details ›. Answers save as they're tapped;
// the outcome button (New: Add to rotation · Keep as new · Move to hand-picked; others: Next on
// every meal of a run but the last, then Done)
// also sets meal.ratedAt. Close (top right) keeps what was tapped and never sets ratedAt (11/25).
import { useState } from "react";
import { todayLocalISO } from "../app/globals.js";
import { BlockButton, Clocks, OutlineButton, Section, Segmented, Sheet } from "../ui/kit.jsx";
import { showToast } from "../ui/toast.js";
import { CADENCE_OPTIONS, EFFORT_OPTIONS, PREF_OPTIONS, mealHistoryIndex, monthDay, withField } from "../library/libraryModel.js";
import "./rate.css";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dateWords = iso => `${WD[new Date(iso + "T12:00:00").getDay()]} ${monthDay(iso)}`;

/** `items`: [{ mealId, iso, out, why }]; `why` is the subline ("First try" / "Missing …"), none from Rate any time. */
export function RateSheet({ db, persistDB, items, onClose, onOpenMeal }) {
  const [at, setAt] = useState(0);
  const item = items[at];
  const meal = item && (db.meals || []).find(m => m.id === item.mealId);
  if (!meal) return null;
  const today = todayLocalISO();
  const family = (db.settings?.familyContacts || []).map(f => f.name);
  const out = new Set(item.out || []);
  const cooked = mealHistoryIndex(db, today).count(meal.name) + (item.iso === today ? 1 : 0);
  const meta = [dateWords(item.iso), `cooked ${cooked} time${cooked === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  const isNew = meal.rotation === "experimental";

  const save = fn => persistDB({ ...db, meals: db.meals.map(m => (m.id === meal.id ? fn(m) : m)) });
  const prefOf = name => (meal.preferences || []).find(p => p.person === name)?.pref;
  const setPref = (name, v) => save(m => ({ ...m, preferences: [...(m.preferences || []).filter(p => p.person !== name), { person: name, pref: v }] }));
  const finish = (rotation, words) => {
    save(m => ({ ...(rotation ? withField(m, "rotation", rotation) : m), ratedAt: today }));
    if (words) showToast(`${meal.name} ${words}`);
    if (at + 1 < items.length) setAt(at + 1); else onClose();
  };

  const last = at + 1 >= items.length;
  // The footer tray (brief §2, 11/25): the thumb spot (dark, right) never changes rotation.
  const footer = isNew ? (
    <div className="rate-foot">
      <button type="button" className="rate-text-button" onClick={() => finish("manual", "moved to hand-picked")}>Move to hand-picked</button>
      <div className="rate-pair">
        <OutlineButton onClick={() => finish("in", "added to rotation")}>Add to rotation</OutlineButton>
        <BlockButton onClick={() => finish(null, null)}>Keep as new</BlockButton>
      </div>
    </div>
  ) : <BlockButton onClick={() => finish(null, null)}>{last ? "Done" : "Next"}</BlockButton>;

  return (
    <Sheet tall title={`How did ${meal.name} go?`} doneLabel="Close" onClose={onClose} footer={footer}
      headerExtra={items.length > 1 ? <span className="rate-step">{at + 1} of {items.length}</span> : null}
      sub={<>{meta}{(item.why || onOpenMeal) && (
        <span className="rate-why">
          {item.why && <span className="rate-why-text">{item.why}</span>}
          {item.why && onOpenMeal && <span aria-hidden="true">&nbsp;·&nbsp;</span>}
          {onOpenMeal && <button type="button" className="rate-details" onClick={() => { onClose(); onOpenMeal(meal.id); }}>All details ›</button>}
        </span>
      )}</>}>
      <div className="rate" key={meal.id}>
        <Section label="Who eats it">
          <div className="rate-card">
            {family.map(name => (out.has(name) ? (
              <div key={name} className="rate-person is-out"><span className="rate-name">{name}</span><span className="rate-out">Out that night</span></div>
            ) : (
              <div key={name} className="rate-person">
                <span className={prefOf(name) ? "rate-name" : "rate-name is-unset"}>{name}</span>
                <Segmented label={name} value={prefOf(name)} onChange={v => setPref(name, v)} options={PREF_OPTIONS} />
              </div>
            )))}
          </div>
        </Section>
        {meal.rotation !== "manual" && (
          <Section label="How often">
            <Segmented label="How often" value={meal.cadence} onChange={v => save(m => withField(m, "cadence", v))} options={CADENCE_OPTIONS} />
          </Section>
        )}
        <Section label="Time needed">
          <Segmented label="Time needed" value={meal.effort} onChange={v => save(m => withField(m, "effort", v))}
            options={EFFORT_OPTIONS.map(o => ({ value: o.value, label: <span className="lib-with-clocks"><Clocks n={o.n} />{o.label}</span> }))} />
        </Section>
      </div>
    </Sheet>
  );
}
