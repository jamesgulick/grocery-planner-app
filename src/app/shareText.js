// The week's plan as text for the family: the Meals step's "Copy draft plan". Home's "Share
// with family" uses homePlanText below: the same message, for every planned week Home shows.
export const draftPlanText = (days, daysFull, mealPlan) => {
  const lines = days.map((d, i) => `${daysFull[i]}: ${(mealPlan?.[d] || []).join(", ") || "—"}`);
  return "🍽️ Draft dinner plan for the week (still tentative!):\n\n"
    + lines.join("\n\n")
    + "\n\n✏️ Let me know if you have other suggestions or preferences";
};

// Home's "Share with family" (brief §7, 11/25): what Home shows, tonight onward. One week reads
// like the draft above; with two, each week's days follow its "Week of" line.
export const homePlanText = weeks => {
  const lines = w => w.days.map(d => `${d.day}: ${d.dishes.join(", ") || "—"}`).join("\n\n");
  const body = weeks.length === 1 ? lines(weeks[0]) : weeks.map(w => `${w.label}\n\n${lines(w)}`).join("\n\n\n");
  return "🍽️ Draft dinner plan for the week (still tentative!):\n\n" + body
    + "\n\n✏️ Let me know if you have other suggestions or preferences";
};
