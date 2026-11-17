// The Pickup sheet (brief §6, RULING 15; canvas "Round 15"): the day the groceries arrive, from
// 3 days before the plan's first day to 2 after, the first day marked Start. Changing it never
// changes which days the plan covers, so it stays editable after the plan has started. The usual
// shopping day is shown for reference; it is changed only in Settings › Shopping. Days before
// today can't be picked (Home lists today onward, so a past pickup would hide the cart).
import { addDaysISO, pickupDateOf } from "../engine/assembleInputs.js";
import { todayLocalISO, weekLabel } from "../app/globals.js";
import { Group, Row, Sheet } from "../ui/kit.jsx";

const ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BEFORE = 3, AFTER = 2;

export function PickupSheet({ plan, shoppingDay, onPick, onClose }) {
  const start = plan.weekStartDate;
  const picked = pickupDateOf(plan);
  const today = todayLocalISO();
  const days = Array.from({ length: BEFORE + AFTER + 1 }, (_, i) => addDaysISO(start, i - BEFORE));
  return (
    <Sheet title="Pickup" sub={weekLabel(start)} onClose={onClose}>
      <div className="ui-seg pickup-days" role="group" aria-label="Pickup day">
        {days.map(iso => {
          const d = new Date(iso + "T00:00:00");
          return (
            <button key={iso} type="button" aria-pressed={iso === picked} disabled={iso < today && iso !== picked} onClick={() => onPick(iso)}>
              <span>{ABBR[d.getDay()]}</span>
              <span className="pickup-date">{d.getDate()}</span>
              <span className="pickup-start">{iso === start ? "Start" : ""}</span>
            </button>
          );
        })}
      </div>
      <Group><Row title="Usual shopping day" value={shoppingDay || "Wednesday"} /></Group>
    </Sheet>
  );
}
