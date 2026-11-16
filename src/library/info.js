// ⓘ sheets: what a field means to the planner (Decisions 11/14: one icon, one meaning).
// Wording: the design chat's drafts in RULING 17.4 (2026-11-16), checked against the model;
// the architect chat may still fit them to the sheets. The day counts are the engine's
// current constants (5 / 10 / 14 days, 8 weeks, 3 days): if one changes, change the text.
// Each entry is a list of [label, text] lines; a null label is a plain line.

export const INFO = {
  // Type: wording from the walkthrough (Decisions 11/16: "Type keeps its existing ⓘ").
  type: { title: "Type", lines: [
    ["Batch", "made ahead to cover several meals."],
    ["Takeout", "nothing to cook or buy."],
    ["Remix", "built from another meal's leftovers."],
  ] },
  whoEats: { title: "Who eats it", lines: [
    ["Won't eat", "the planner never counts this meal as their dinner. It finds them something else that night (a side that can be someone's dinner, or leftovers), or tells you when it can't."],
    ["Likes", "nudges the meal forward on nights they're home."],
    ["Not set", "counts as fine with it. For a New meal, it means not known yet."],
  ] },
  wantedSoon: { title: "Wanted soon", lines: [
    [null, "Puts the meal into the next plan, even if it's New or Hand-picked. Stays on until you turn it off."],
  ] },
  howOften: { title: "How often", lines: [
    ["Weekly", "pulled back about every week, and never within 5 days."],
    ["Every 2 weeks", "pulled back gently, never within 10 days."],
    ["Occasional", "never pulled, never within 14 days. Week check mentions it when it hasn't been planned in 8 weeks."],
  ] },
  timeNeeded: { title: "Time needed", lines: [
    ["Little", "preferred on busy nights."],
    ["Some", "fine any night."],
    ["Lots", "only planned on days marked as having lots of time, and preferred there."],
  ] },
  cost: { title: "Cost", lines: [
    [null, "Only for meals that cost more than the groceries: takeout, eating out, a splurge. The planner spreads these out, but always lets the first one of the week in."],
    ["None", "the weekly shop covers it."],
  ] },
  rotation: { title: "Rotation", lines: [
    ["In rotation", "the planner can choose it."],
    ["New", "not tried yet. Planned when you ask for an adventurous week or turn on Wanted soon."],
    ["Hand-picked", "only when you pick it, or with Wanted soon."],
  ] },
  style: { title: "Style", lines: [
    [null, "What kind of dish it is, and how the evening works. Meals that share a form aren't planned within 3 days of each other. Neither are two nights that aren't cooked at home."],
  ] },
  plateFeel: { title: "Plate and feel", lines: [
    [null, "Describes the dish. Plate traits decide which sides suit it: a side that avoids “Starchy” isn't suggested beside a starchy main. Feel is description only."],
  ] },
  avoid: { title: "Avoid on the plate", lines: [
    [null, "Not suggested beside a main with these traits. It can still be used to give someone dinner."],
  ] },
  pairs: { title: "Sides that go with it", lines: [
    [null, "The planner suggests only these as extras with this main. Any side that can be someone's dinner can still be added to cover a person who won't eat the main."],
  ] },
  goesWith: { title: "Goes with", lines: [
    [null, "The planner suggests this side as an extra only with these mains. If it can be someone's dinner, it can still be added to cover a person who won't eat the main."],
  ] },
  noSides: { title: "No sides needed", lines: [
    [null, "No extras are suggested. A side can still be added for someone who won't eat it."],
  ] },
  substantial: { title: "Can be someone's dinner", lines: [
    ["On", "can stand in as dinner for someone who won't eat the main."],
    ["Off", "only ever an extra."],
  ] },
  leftovers: { title: "Leftovers", lines: [
    [null, "How long they last and who'll eat them. Those people count as fed on later nights, and the planner puts the meal earlier to cover a night they won't eat the main. Set it only if they'd really eat them."],
  ] },
  weather: { title: "Weather", lines: [
    ["Day feel", "Comfort leans toward cooler evenings, Light toward warmer ones. It's a lean, never a rule."],
    ["Grillable", "only planned on dry, warm days while Grill season is on."],
  ] },
};
