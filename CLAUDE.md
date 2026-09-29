# CLAUDE.md — Project Context for Claude Code

This file orients Claude Code (and any contributor) to this project. Read it before
making changes.

## How to work on this project (READ FIRST)

The owner values **deliberation before implementation**. Match that. When given a
change request — especially a feature idea — do not jump straight to code. First:

1. **Name the real need.** The stated solution and the underlying need often differ.
   Ask what problem this actually solves before deciding how to build it.
2. **Surface load-bearing assumptions** and check them before they anchor the design.
3. **Check whether an existing capability already covers it.** The cheapest feature
   is the one you don't build. Look before adding.
4. **Name the simplest version and what it trades away.** Offer that first.

This is genuine early interrogation, not a checklist to recite and not foot-dragging
when a change is small, clear, or reversible — in those cases, just do it. Calibrate:
a one-line fix or an obvious mechanical edit doesn't need a design discussion; a new
feature or a change to the suggestion logic or the step flow does.

**Prefer asking a clarifying question over guessing** when the request is ambiguous
or when more than one reasonable interpretation exists. One good question up front
beats a wrong implementation.

**Flag bugs, don't silently fix them.** If you notice an unrelated problem while
working, surface it and let the owner decide — don't quietly change behavior they
didn't ask about.

**Always build before you ship.** Run `npm run build` (or at least load the page via
`npm run dev`) to confirm it compiles before committing. A broken build must never
reach `main`, because `main` auto-deploys to the live site. The bundler does NOT
catch every error — see "cross-component scope errors" below — so a clean build is
necessary but not sufficient; sanity-check runtime behavior for anything non-trivial.

## What this is

A single-file React grocery-planning web app for coordinating weekly grocery pickup
orders. It began life inside a Claude artifact sandbox and was migrated to a
standalone Vite + React project hosted on GitHub Pages. Almost all of the app lives
in one file: **`src/grocery-app.jsx`**. `src/main.jsx` only mounts it.

## Core design philosophy

- **"The user makes the decisions; the app does the cross-checking."** The app
  nudges but never gates the user's judgment.
- **Meal suggestions come from the week-composition engine, `composeWeek`, which is
  NOT app code to tweak.** It composes a week under a strict priority stack — the
  *floor* (everyone present has something acceptable, counting leftovers) > spacing >
  freshness/cadence > soft leans > seeded tie-break — and the app only assembles its
  inputs and renders its outputs. Its behavior is owned by `MODEL-week-composition.md`
  (design chat) and its shape by `CONTRACT-composeWeek.md` (contract chat); both are
  working docs kept off the repo. A `dislike` means "will not eat" and is a fact the
  floor works around (it adds a side or relies on leftovers); it never gates a meal
  off the week. Behavior questions go to the design chat, shape questions to the
  contract chat — don't change engine behavior from the app side.
- **Flag bugs, don't silently fix them.** If you notice an unrelated bug, surface it
  rather than quietly changing behavior.
- **Interrogate before building.** For a new feature: name the real need, check
  whether an existing capability already covers it, and name the simplest version
  before writing code. The cheapest feature is the one not built.

## Tech stack & structure

- **Vite + React 18.** Dev server: `npm run dev`. Production build: `npm run build`
  (outputs to `dist/`).
- **Deploy:** `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on
  every push to `main`. Pages source must be set to "GitHub Actions" in repo
  settings. **The repo must be PUBLIC for Pages to serve it on the free plan — this
  deploy IS the product. See "THE REPO MUST BE PUBLIC" below before committing anything.**
- **`vite.config.js`** sets `base: "./"` so built asset paths are relative — the
  site works at a project subpath (`username.github.io/repo/`) without hardcoding
  the repo name. Don't change this to an absolute base unless you also fix the paths.
- **Data persistence:** browser `localStorage` under the key `grocery_db`. There is
  no backend. JSON export/import (Manage tab) moves data between devices.
- **Preview deploy:** while the `integration/composeWeek` branch exists, every deploy
  (always run from `main`) also builds that branch into `/preview/`, best-effort — a
  broken preview never blocks production. A push to the branch triggers
  `.github/workflows/preview-trigger.yml`, which dispatches the `main` deploy. The
  preview shares an origin (and so `localStorage`) with the live app, so preview builds
  (`VITE_PREVIEW=1`) suffix every storage key with `_preview`, seed from the live DB
  read-only, and show a PREVIEW banner; the workflow refuses to publish a preview
  build that lacks this isolation.

### File map

```
src/grocery-app.jsx          ← the app: state, UI, all components, styles
src/engine/composeWeek.js    ← the engine: composeWeek + evaluateWeek (validated offline; see below)
src/engine/assembleInputs.js ← app state → engine inputs, plates, week check, hardened call
src/main.jsx                 ← mounts <App/> to #root
src/index.css                ← base styles
index.html                   ← Vite entry
vite.config.js               ← React plugin + relative base
.github/workflows/deploy.yml ← Pages CI (production at /, preview branch at /preview/)
.github/workflows/preview-trigger.yml ← a push to the preview branch re-runs the main deploy
```

The engine's offline validation harness lives in the untracked `engine/` workspace
(`node engine/harness/run.js`, 48 assertions in 7 modes) and runs against
`src/engine/composeWeek.js`. It is a working file: never commit it.

## The app's workflow

Five-step weekly flow, tracked by the `PLAN_STEPS` constant and a `step` index:

```
Welcome → Meals → Inventory → Confirm → Sparky
```

(Receipt reconcile is no longer a step; it was folded out in step-flow v4.)

- **Meals** — each day is a PLATE: a main, then sides labelled "covers" (a
  floor-fill for someone who won't eat the main) or "goes with" (an accompaniment),
  or "side" if placed by hand, with the engine's reason under each. Per day: a
  three-level **time to cook** (none / some / much — only "much" allows involved
  meals; seeded Sat/Sun much, Mon/Tue none, Wed–Fri some), a **Home** row with a
  chip per family member (tap = away that night), day notes, a read-only "grill ok"
  tag, the live forecast, and carried-leftover notes. Actions: **Fill empty days**
  (global; empty days only), **Fill this day**, **⟳** on a main (sides follow; sides
  placed by hand stay) or on a side (swap just it), **Suggest sides** (main with no
  sides). An **Adventurous week** toggle asks the engine to place one untried meal.
  A **Week check** panel shows the engine's observations for the plan as built
  (concerns always, "ok" briefly, the rest folded), and **Show reasoning** (learn
  mode) shows every reason with its tier and role.
- **Inventory** — walk storage locations; check off what's in stock (drops from the
  list). Multi-meal ingredients get a badge.
- **Confirm** — a "used across multiple meals" check on top, then the tunable
  shopping list (per-item quantity overrides, drop-toggles).
- **Sparky** — copy the list (batched) to hand to an external cart-building
  assistant, plus a shared-item quantity-check prompt.

### Plan model, draft & step migration

**Plan state is a two-slot model:** db.plans = { current, next }, with db.activePlan ("current" | "next") naming which slot every week-scoped surface shows. Each plan carries its own meals, dayNotes, mealPlan, and a step index. db.activePlan is the source of truth for which week is displayed; the date only sets the default. The canonical week boundary is weekStartDate — a week runs from its weekStartDate until the next week's start date (weeks can be shorter or longer than 7 days; the later-starting week wins an overlap day). The old weekOf field was eliminated as a redundant shadow of weekStartDate — do not reintroduce it.

Pre-migration DBs carry two older single-slot concepts (db.planDraft live-editing + a baked current week); migration on load remaps them into plans.current / plans.next and is stamped by _planModelVer. The step flow has also been renumbered across versions, so there is separate step-migration logic. If you change PLAN_STEPS, update the step-migration mapping and bump the version stamp together, or in-progress plans land on the wrong screen. This has caused real bugs — treat both the plan model and step renumbering with care.

**Per-plan engine inputs and plates** (all persisted on the plan, so they survive every step transition):
- `mealPlan` — day abbr → meal NAMES. Still the day's content: Inventory, Confirm, Tonight, the fridge report, the export and the family Shortcut all read it. Don't change its shape.
- `plates` — annotates `mealPlan` per day: each dish's meal id, role, `source` (engine / floor-fill / accompaniment / manual), the engine's reasons (`why`), and a **leftovers (`carries`) snapshot taken when the dish was placed**. Never edit it directly: `reconcilePlates` rebuilds it from every `mealPlan` change (unchanged days keep their plate; a day untouched since before plates existed stays unplated). `autoRetirePlans` keeps `plates` in `planTail`, because history reads leftovers ONLY from these snapshots — an unplated past day counts for recency but carries no leftovers.
- `timeLevels` — day abbr → none/some/much. `presence` — per-night overrides only, `{day: {name: bool}}`; the rest comes from `settings.awayRanges` (date-range away periods, open ends allowed, edited in Manage → Config), else present. `presentOn` resolves it.
- `adventurousWeek` — per-plan switch.
- The plan-inputs migration (easy pills → timeLevels, the Partner away map and the away-member toggle → presence / an open-ended away period) is stamped by `_planInputsVer`.

Settings added for the engine: `grillOpen` (grill season, Manage → Config → Cooking), `awayRanges`, `learnMode`. `awayMemberHome` survives, relabelled, and now ONLY decides who gets family texts.

## Key subsystems

- **The engine — `src/engine/composeWeek.js`.** Two pure exports sharing one floor
  implementation:
  - `composeWeek(meals, history, schedule, sessionState, config)` →
    `{ week, sessionState, observations, rationale }` — composes plates for the
    schedule's days around whatever is already placed.
  - `evaluateWeek(meals, history, schedule, plan, config)` → `{ observations, rationale }`
    — cross-checks a week AS BUILT, composing nothing (drives the Week check).
  It was built and validated offline and ships as that validated artifact. **Don't
  edit it to change behavior.** A change needs a design-chat ruling (behavior) or a
  contract version (shape), then: the harness stays green, an old-vs-new comparison
  on the real corpus is recorded, and the change is noted in the commit. `CONSTANTS`
  are fixed values, not tunable weights.
- **`src/engine/assembleInputs.js`** — everything between the app and the engine, pure
  and node-testable: `assembleComposeInputs` (app DB + plan → the five contract inputs;
  emits `timeLevel`, never the deprecated `time`; complete name-keyed presence per day;
  missing forecast → NaN weather, which the engine reads as neutral and non-grillable),
  `runComposeWeek` (never throws; input problems and engine errors come back as
  observations), `reconcilePlates` / `platesFromCompose` (plates), `checkWeek` (the
  week check, via `evaluateWeek` over all seven days), and the shared `presentOn`,
  `seedTimeLevel`, date helpers. The app imports these rather than keeping copies.
- **Meals-step calls (`PlanMeals`).** "Fill empty days" composes the whole week and
  takes only empty days. The per-day actions compose ONE target day: other planned
  days are fixed context, empty days are left out (so the engine doesn't fill them
  first). `composeWeek` only suggests sides for a day with none, so actions wanting
  its sides pass the day with its main alone. `seenThisSession` is deliberately
  component-local — the model resets it per planning sitting — the one piece of
  Meals-step state that must NOT be lifted into the plan.
- **Grill** is not a pill any more: grillability is the engine's (forecast AND
  `grillOpen`); the day card's "grill ok" tag uses the engine's own constants.
  `special` and custom pills are visual labels only.
- **`multiMealCounts(mealPlan, meals)`** — returns `{ingredientId: count}` for
  ingredients used by 2+ planned meals. Meal→ingredient links are **presence-only
  (no quantities)**, so this flags overlap but can't compute whether one package
  suffices — that judgment stays with the user. The "shared across meals" checklist
  deliberately includes in-stock and in-cart items, because "I already have it" is
  exactly when people under-buy a multi-meal ingredient.
- **Live weather** — `fetchLiveForecast()` calls the free Open-Meteo API (no key,
  CORS-enabled) for the current shopping week, cached 6h in localStorage. On any
  failure it returns `{}`, which every consumer treats as neutral. Configure
  location via `FORECAST_LAT` / `FORECAST_LON` near the top of the file. The forecast
  is keyed by day name for the CURRENT shopping week (Tue–Mon); the engine inputs and
  the grill tag match it to plan days by DATE, so a next-week plan never borrows this
  week's weather. (The day-card header still shows it by day name — a known display
  mismatch, flagged and not yet fixed.)

## Conventions & gotchas

- **Whole-file edits, validated before shipping.** Historically this app is
  delivered as a complete file and checked with a bundler before commit. With Vite,
  run `npm run build` (or at least `npm run dev` and load the page) to confirm it
  compiles before committing.
- **Cross-component scope errors don't show at build time.** A variable defined in
  one component and referenced in a sibling that only receives it via props will
  pass the bundler but throw `ReferenceError` at runtime. This exact bug happened
  with `initMaxStep`. When moving code between components, recompute from available
  props rather than assuming a name is in scope.
- **Temporal-dead-zone (use-before-declaration) errors are a RECURRING bug here and
  the bundler does NOT catch them.** This is a large single-file component with many
  hooks; it's easy to reference a `const`/`let` (e.g. a `useState` pair, a computed
  value) *above* the line that declares it. `const`/`let` do not hoist, so this
  throws `Cannot access 'X' before initialization` at runtime — and in minified prod
  builds `X` is a renamed token like `de`, so the message is opaque. It has bitten
  this project at least twice (`initMaxStep`, and the `forecast`/`forecastLoaded`
  state feeding the pill-derivation effect). **When editing a component — especially
  when reordering hooks, moving `useState`/`useEffect` blocks, or porting code —
  verify that every variable a hook or effect reads is DECLARED ABOVE the point of
  use.** A clean `npm run build` does not prove this is correct; it only proves the
  syntax is valid. Sanity-check by actually loading the affected screen.
- **Controlled inputs need stable refs.** An inline `ref={el => ...}` callback gets a
  new identity each render, making React detach/re-attach the node and steal focus
  on every keystroke. Module-level components with a stable `useRef` avoid this (see
  `AutoGrowTextarea`).
- **Legacy sandbox constraints, now mostly moot on a real host but still in code:**
  clipboard uses a hidden-textarea + `execCommand("copy")` pattern (the modern
  Clipboard API was unreliable in the iOS webview); `sms:` / `shortcuts://` links
  were blocked. On GitHub Pages these limits are gone, but the copy pattern is
  harmless and can stay.
- **Some identifiers carry historical names** (e.g. `memberOk`, `awayMemberHome`) from a
  refactor that genericized personal data. They're just variable names. (`awayHome`
  now survives only inside the plan-inputs migration that converts it.)
  **Ephemeral component-local state dies across a re-rendered-instance transition, and the bundler does NOT catch it.** PlanConfirm is rendered as TWO instances — mode="confirm" (step 3) and mode="sparky" (step 4). Any state held in a local useState inside that component is discarded when the flow moves between the two instances, because they're different mounts. This has bitten the project at least twice: the removed set (confirm-step removals) and then the added set both vanished on the Confirm→Sparky transition. Any state that must survive that transition has to be lifted to the persisted plan object (as removedIds / added-items were), not kept component-local. When adding state to PlanConfirm, ask: does this need to survive the confirm↔sparky switch? If yes, lift it.

## THE REPO MUST BE PUBLIC — and what that forces (READ BEFORE ANY COMMIT)

**This repo is public, and it has to stay public.** That is not a preference or an
accident of history. The whole point of this project is that James uses the planner as a
real web app on his phone and laptop instead of a Claude artifact, and it is served by
**GitHub Pages from `main`**. On GitHub's free plan **Pages only serves a public repo** —
so making the repo private takes the app offline. (Confirmed the hard way on 2026-09-27:
the repo went private and `jamesgulick.github.io/grocery-planner-app/` immediately went
to 404.) "Just make it private" is therefore never the answer to a privacy problem here.

Because it cannot be made private, the repo's contents are the only control there is:

### RULE: only files the running app requires may be committed.

Before any `git add`, commit, or push, ask of every file: **does the running app need
this to build and serve?** If no, it does not go in the repo — add it to `.gitignore`
instead and leave it on disk as a working file.

**Belongs in the repo:** `src/`, `index.html`, `package.json`, `package-lock.json`,
`vite.config.js`, `.github/workflows/` (deploy + preview trigger), `.gitignore`,
`.gitattributes`, `LICENSE`, `README.md`, this file. The engine ships as
`src/engine/composeWeek.js` and `src/engine/assembleInputs.js`; its harness, adapter
and merge scripts stay in the untracked `engine/` workspace.

**Never, whatever a past instruction said:** the tagged corpus (`meal-tags.json`),
scenario fixtures (`scenarios.json`), the validation harness, design and model docs
(`MODEL-*.md`, `CONTRACT-*.md`, `HANDOFF.md`, `SPEC-*.md`, `*-BRIEF-*.md`), exported
DBs, or anything else that exists to support design, tagging or validation rather than to
run the app. These carry real family names and real per-person food preferences. They are
working files. **They live on disk, untracked.**

### Check CONTENTS, not just the diff.

A clean, purely-additive merge can still publish personal data. On 2026-09-27 an engine
branch was merged and pushed after verifying the build passed and that no file under
`src/` had changed — which put `meal-tags.json` (52 meals of likes/dislikes for five
real people) onto the public default branch. Additive is not the same as safe. Open the
data files.

### Git history is public too.

Deleting a file in a later commit does NOT remove it — it stays readable in history for
as long as the repo is public. Un-publishing something already pushed means rewriting
history (`git filter-repo` + force-push on every ref) and asking GitHub Support to
garbage-collect the unreferenced objects. Far cheaper never to commit it.

## Privacy / sanitization

- Do NOT add real personal data (names, numbers, home address, private notes) to the
  source or seed data. Use generic placeholders. The sanitized roster constants in
  `src/` are the pattern — `SPEC-family-names.md` maps them to `Partner / Kid 1 /
  Kid 2 / Kid 3 / Me`. Real names belong only in James's `localStorage` DB, which is
  never in the repo.
- `FORECAST_LAT` / `FORECAST_LON` are a neutral placeholder. If setting a real
  location, prefer a nearby town-center coordinate over an exact home address — the
  weather is identical and it's public.
- The deployed site's JS is publicly readable (static host), so treat anything in
  the code as public. There is no future repo-visibility change to fall back on — see
  above.
- **Placeholders everywhere, including comments, examples inside comments, and commit
  messages** — all of it is public, and history keeps it. Before committing, run a
  real-name check over the staged diff AND the commit message, and make it BLOCK the
  commit (not merely print), e.g.
  `! git diff --cached | grep -iE "<real names>" && git commit ...`. On 2026-09-29 a
  printed-but-not-blocking check let a name through in a comment and a commit message,
  and the branch had to be rewritten and force-pushed.

## Typical tasks

- **A suggestion looks wrong:** usually a meal's TAGS are wrong, not the engine — check
  its reasons with "Show reasoning" and fix the meal's data. If the engine's behavior
  itself seems wrong, write it up for the design chat; don't patch `composeWeek`.
- **Change what the engine is given** (a new input from app state): edit
  `assembleInputs.js`; the contract says what each input may contain.
- **Change the Meals-step display or actions:** `PlanMeals` in `grocery-app.jsx`; keep
  `mealPlan` names as the day's content and let `reconcilePlates` maintain `plates`.
- **Change the step flow:** edit `PLAN_STEPS` AND the draft-migration mapping + version
  stamp together.
- **Change weather location:** edit `FORECAST_LAT` / `FORECAST_LON`.
- **Ship a change:** `npm run build` to confirm it compiles, commit, push to `main`;
  the workflow redeploys Pages automatically (1–3 min).
