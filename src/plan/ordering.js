// "Checked = buying" (polish Phase 1b, SPEC §3b): ONE buy-or-not decision per item for
// the week, which Inventory and Confirm both read and write. Pure; no React.
//
// The stored fields keep the meanings they always had; only the controls changed:
//   always            buying = not in checkedIds          (in checkedIds = skipped)
//   staple            buying = stapleFlags[id] === true    (false = an explicit no;
//                     and not in checkedIds                  absent = untouched default)
//   meal / kept       buying = not in checkedIds          (in checkedIds = have it)
//   specialty
// `st` = { checkedIds, stapleFlags, mealIngIds:Set, keptIds }.

// Is this item on the list at all this week (whether or not it's being bought)?
export const isRelevant = (ing, st) =>
  ing.tier === "always" || ing.tier === "staple" ||
  (ing.tier === "specialty" && (st.mealIngIds.has(ing.id) || (st.keptIds || []).includes(ing.id)));

export const isOrdering = (ing, st) => {
  if (!isRelevant(ing, st)) return false;
  const skipped = st.checkedIds.includes(ing.id);
  if (ing.tier === "staple") return st.stapleFlags[ing.id] === true && !skipped;
  return !skipped;
};

// An explicit "not buying" decision, as opposed to a staple nobody looked at. This is
// what the Confirm step's "Skipped in Inventory" group holds (decided 11/11: untouched
// staples are not skips).
export const isExplicitNo = (ing, st) => {
  if (!isRelevant(ing, st) || isOrdering(ing, st)) return false;
  if (ing.tier === "staple") return st.stapleFlags[ing.id] === false || st.checkedIds.includes(ing.id);
  return true;
};

// The state change that makes `ing` ordered (on) or not (off). Returns new
// { checkedIds, stapleFlags }, both always, so a caller saves them together.
export const orderingPatch = (ing, on, st) => {
  let checkedIds = st.checkedIds.filter(x => x !== ing.id);
  const stapleFlags = { ...st.stapleFlags };
  if (ing.tier === "staple") stapleFlags[ing.id] = !!on;
  else if (!on) checkedIds = [...checkedIds, ing.id];
  return { checkedIds, stapleFlags };
};

// One-time fold of the retired Confirm-step drop list (`removedIds`) into the decision
// above: a dropped staple becomes an explicit no, anything else joins checkedIds.
export const foldRemovedIds = (plan, ingredients) => {
  const removed = plan?.removedIds || [];
  if (!plan || !("removedIds" in plan)) return plan;
  const { removedIds, ...rest } = plan;
  if (!removed.length) return rest;
  const tierOf = Object.fromEntries((ingredients || []).map(i => [i.id, i.tier]));
  let checkedIds = [...(plan.checkedIds || [])];
  const stapleFlags = { ...(plan.stapleFlags || {}) };
  for (const id of removed) {
    if (tierOf[id] === "staple") stapleFlags[id] = false;
    else if (!checkedIds.includes(id)) checkedIds.push(id);
  }
  return { ...rest, checkedIds, stapleFlags };
};
