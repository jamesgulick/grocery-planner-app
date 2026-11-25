// AI round trips read as two numbered steps (standing rules, 11/23): ① Send to AI ›
// ② Re-import, two outlined pills joined by a chevron. Before sending, step 1 is lit (green
// outline, filled number) and step 2 is grey; after sending, step 1 is grey with a ✓ and step
// 2 is lit, and the status nearby reads "Sent 5:41pm". The sent time is kept on the device
// (sendToAI.js trips), so step 2 is still lit after a restart. Used by Calendar sync (Data sheet,
// Plan › Week), Grab's meal tab and the meal page's Fill in with AI.
import { useEffect, useState } from "react";
import { TRIPS_EVENT, tripSentAt } from "../app/sendToAI.js";
import { InfoButton, Sheet } from "../ui/kit.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** When the trip with this key was sent (ISO) or null, kept current across surfaces. */
export function useTrip(key) {
  const [at, setAt] = useState(() => tripSentAt(key));
  useEffect(() => {
    const read = () => setAt(tripSentAt(key));
    read();
    window.addEventListener(TRIPS_EVENT, read);
    return () => window.removeEventListener(TRIPS_EVENT, read);
  }, [key]);
  return at;
}

/** "Sent 5:41pm" today, else "Sent Nov 14". */
export function sentLabel(iso) {
  const d = new Date(iso);
  if (d.toDateString() !== new Date().toDateString()) return `Sent ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const h = d.getHours();
  return `Sent ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** One step: n is 1 or 2; state is "lit", "done" (✓) or "idle" (grey). */
export function StepPill({ n, state, onClick, disabled, children }) {
  return (
    <button type="button" className={`step-pill is-${state}`} onClick={onClick} disabled={disabled}>
      <span className="step-num" aria-hidden="true">{state === "done" ? "✓" : n}</span>{children}
    </button>
  );
}

export const StepChevron = () => <span className="step-chev" aria-hidden="true">›</span>;

/** The states of the two steps for a trip sent at `sentAt` (or not). */
export const stepStates = sentAt => sentAt ? ["done", "lit"] : ["lit", "idle"];

// Every AI trip has a title with an ⓘ (11/24; brief, standing rules, "AI round trips").
// The ⓘ opens a fit sheet: what this trip does, then "How it works", the same for all three.
const TRIP_INFO = {
  "Calendar sync": "Fills each day's note from your calendar. Nothing else in the file changes.",
  "Fill in with AI": "Fills in this meal's empty details (style, plate, time, ingredients) from its recipe link, or from its name if there's no link. Details you've already set stay as they are.",
  "Add with AI": "Turns the link or recipe text into a new meal with its details and ingredients, matched to items you already have.",
  "To finish": "Sends every meal in To finish to your AI chat to fill in their details.",
};
const HOW_IT_WORKS = "① Send to AI saves your data file and opens the share sheet. Pick your AI chat and send the file; a short prompt is already copied, and your Instructions for AI (Settings) tell it which skill to use. ② When it sends the file back, open it and tap Re-import. You see every change before anything loads, and nothing in the app changes until you load it.";

/** A trip's title with its ⓘ. `className`: the title's style (the card title, or Grab's small one). */
// `label`: the text shown, when it isn't just the title (Library: "To finish · 3").
export function TripTitle({ title, label = title, className = "trip-title" }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="trip-name">
      <span className={className}>{label}</span>
      <InfoButton label={title} onClick={() => setOpen(true)} />
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)}>
          <div className="trip-info">
            <p>{TRIP_INFO[title]}</p>
            <div className="trip-info-label">How it works</div>
            <p>{HOW_IT_WORKS}</p>
          </div>
        </Sheet>
      )}
    </span>
  );
}
