// The upcoming pickup (brief §6, 11/18: "the cart marks the shopping day, whatever the
// plan boundaries"). Exactly one pickup is upcoming: the first plan, by start, whose pickup is
// today or later; failing that, the pickup of the plan not created yet. That plan's start is
// what "start next week" will give it (the day after the latest plan, or the usual shopping
// day when there is no plan), and its pickup defaults to the last usual shopping day on or
// before that start (never before today). A day picked for it early is kept as
// db.pendingPickup = { start, date } and becomes the plan's pickupDate when it is created.
import { extraDaysOf, pickupDateOf } from "../engine/assembleInputs.js";
import { addDaysISO, nextDateForShoppingDay } from "./globals.js";

const FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The start the next plan created will get (startNextWeek / startFresh). */
export function expectedNextStart(plans, shoppingDay) {
  const last = ["current", "next"].map(k => plans?.[k]).filter(p => p?.weekStartDate)
    .sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate))[0];
  return last ? addDaysISO(last.weekStartDate, 7 + extraDaysOf(last)) : nextDateForShoppingDay(shoppingDay || "Wednesday");
}

/** The last usual shopping day on or before `start`, never before today. */
export function usualPickupFor(start, shoppingDay, today) {
  const idx = Math.max(0, FULL.indexOf(shoppingDay || "Wednesday"));
  const back = (new Date(start + "T00:00:00").getDay() - idx + 7) % 7;
  const d = addDaysISO(start, -back);
  return d < today ? today : d;
}

/** The pickup a plan created with this start should carry: the early pick, else the usual day. */
export function pickupForNewPlan(db, start, today) {
  const pend = db.pendingPickup;
  const date = pend?.start === start && pend.date >= today ? pend.date : usualPickupFor(start, db.settings?.shoppingDay, today);
  return date === start ? {} : { pickupDate: date };
}

/**
 * The one upcoming pickup: { key, plan, date, start }. `key` is "current" / "next" for an
 * existing plan, or null for the plan not created yet, whose `plan` is a stand-in
 * ({ weekStartDate, pickupDate }) for the Pickup sheet.
 */
export function upcomingPickup(db, today) {
  const plans = db.plans || {};
  const existing = ["current", "next"].filter(k => plans[k]?.weekStartDate)
    .map(k => ({ key: k, plan: plans[k], start: plans[k].weekStartDate, date: pickupDateOf(plans[k]) }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const up = existing.find(p => p.date >= today);
  if (up) return up;
  const start = expectedNextStart(plans, db.settings?.shoppingDay);
  const { pickupDate } = pickupForNewPlan(db, start, today);
  const date = pickupDate || start;
  return { key: null, plan: { weekStartDate: start, ...(pickupDate ? { pickupDate } : {}) }, date, start };
}
