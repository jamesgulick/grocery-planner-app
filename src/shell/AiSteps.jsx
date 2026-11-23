// AI round trips read as two numbered steps (standing rules, 11/23): ① Send to AI ›
// ② Re-import, two outlined pills joined by a chevron. Before sending, step 1 is lit (green
// outline, filled number) and step 2 is grey; after sending, step 1 is grey with a ✓ and step
// 2 is lit, and the status nearby reads "Sent 5:41pm". The sent time is kept on the device
// (sendToAI.js trips), so step 2 is still lit after a restart. Used by Calendar sync (Data sheet,
// Plan › Week), Grab's meal tab and the meal page's Fill in with AI.
import { useEffect, useState } from "react";
import { TRIPS_EVENT, tripSentAt } from "../app/sendToAI.js";

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
