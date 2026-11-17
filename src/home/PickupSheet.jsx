// The Pickup sheet (brief §6, RULING 15; boards "Round 15" and "Pickup dates", 11/17): the
// day the groceries arrive. A sideways-scrolling strip of fixed chips runs from 3 days before the
// plan's first day (never before today) through its last day, with "Start" / "End" under those
// two; never past the end, since that pickup would belong to the next plan. It opens with the
// picked day centred and keeps its scroll after a tap. Changing the pickup never changes which
// days the plan covers, so it stays editable after the plan has started. The usual shopping day
// is shown for reference; it is changed only in Settings › Shopping.
import { useEffect, useRef } from "react";
import { addDaysISO, extraDaysOf, pickupDateOf } from "../engine/assembleInputs.js";
import { todayLocalISO, weekLabel } from "../app/globals.js";
import { Group, Row, Sheet } from "../ui/kit.jsx";
import { showToast } from "../ui/toast.js";

const ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BEFORE = 3;
const dayName = iso => { const d = new Date(iso + "T00:00:00"); return `${ABBR[d.getDay()]} ${d.getDate()}`; };

export function PickupSheet({ plan, shoppingDay, onPick, onClose }) {
  const start = plan.weekStartDate;
  const end = addDaysISO(start, 6 + extraDaysOf(plan));
  const picked = pickupDateOf(plan);
  const today = todayLocalISO();
  let first = addDaysISO(start, -BEFORE);
  if (first < today) first = today;
  if (picked < first) first = picked;   // a pickup already past stays on the strip
  const days = [];
  for (let iso = first; iso <= end; iso = addDaysISO(iso, 1)) days.push(iso);

  // Centre the picked day once, on open; after that the strip keeps wherever it was scrolled.
  const stripRef = useRef(null);
  useEffect(() => {
    const strip = stripRef.current, chip = strip?.querySelector('[aria-pressed="true"]');
    if (chip) strip.scrollLeft = chip.offsetLeft + chip.offsetWidth / 2 - strip.clientWidth / 2;
  }, []);

  const pick = iso => {
    if (iso === picked) return;
    onPick(iso);
    showToast(iso === start ? `Pickup ${dayName(iso)}, the plan's first day` : `Pickup ${dayName(iso)} · plan still ${dayName(start)} – ${dayName(end)}`);
  };

  return (
    <Sheet title="Pickup" sub={weekLabel(start)} onClose={onClose}>
      <div className="pickup-strip" ref={stripRef} role="group" aria-label="Pickup day">
        {days.map((iso, i) => {
          const d = new Date(iso + "T00:00:00");
          const top = d.getDate() === 1 && i > 0 ? MONTH[d.getMonth()] : ABBR[d.getDay()];
          return (
            <button key={iso} type="button" className="pickup-chip" aria-pressed={iso === picked} onClick={() => pick(iso)}>
              <span>{top}</span>
              <span className="pickup-date">{d.getDate()}</span>
              <span className="pickup-mark">{iso === start ? "Start" : iso === end ? "End" : ""}</span>
            </button>
          );
        })}
      </div>
      <Group><Row title="Usual shopping day" value={shoppingDay || "Wednesday"} /></Group>
    </Sheet>
  );
}
