// The week's plan as text for the family: the Meals step's "Copy draft plan" and Home's
// "Share with family" send the same message.
export const draftPlanText = (days, daysFull, mealPlan) => {
  const lines = days.map((d, i) => `${daysFull[i]}: ${(mealPlan?.[d] || []).join(", ") || "—"}`);
  return "🍽️ Draft dinner plan for the week (still tentative!):\n\n"
    + lines.join("\n\n")
    + "\n\n✏️ Let me know if you have other suggestions or preferences";
};
