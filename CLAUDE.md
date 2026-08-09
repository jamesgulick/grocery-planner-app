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
- **Most signals are soft leans; a few are hard gates.** In the meal suggester,
  weights change how *likely* a meal is; only a small set of rules make a meal
  ineligible. Preserve this distinction when editing suggestion logic.
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
  settings.
- **`vite.config.js`** sets `base: "./"` so built asset paths are relative — the
  site works at a project subpath (`username.github.io/repo/`) without hardcoding
  the repo name. Don't change this to an absolute base unless you also fix the paths.
- **Data persistence:** browser `localStorage` under the key `grocery_db`. There is
  no backend. JSON export/import (Manage tab) moves data between devices.

### File map

```
src/grocery-app.jsx   ← the entire app: state, logic, all components, styles
src/main.jsx          ← mounts <App/> to #root
src/index.css         ← base styles
index.html            ← Vite entry
vite.config.js        ← React plugin + relative base
.github/workflows/deploy.yml  ← Pages CI
```

## The app's workflow

Six-step weekly flow, tracked by the `PLAN_STEPS` constant and a `step` index:

```
Welcome → Meals → Inventory → Confirm → Sparky → Reconcile
```

- **Meals** — per-day cards: weighted meal suggestions, day "pills" (easy / grill /
  special), a per-day "who's away" toggle that filters disliked meals, day-notes,
  and a live weather forecast.
- **Inventory** — walk storage locations; check off what's in stock (drops from the
  list). Multi-meal ingredients get a badge.
- **Confirm** — a "used across multiple meals" check on top, then the tunable
  shopping list (per-item quantity overrides, drop-toggles).
- **Sparky** — copy the list (batched) to hand to an external cart-building
  assistant, plus a shared-item quantity-check prompt.
- **Reconcile** — upload a placed order; local matching flags missing items,
  quantities over one, and optional items over a price threshold.

### Draft & step migration

Plan progress is stored in `db.planDraft` with a `step` index and a `_stepsVer`
stamp. The step flow has been renumbered across versions, so there is **migration
logic** that remaps old step indices on load. If you change `PLAN_STEPS`, you must
update the migration mapping and bump the version stamp, or in-progress drafts will
land on the wrong screen. This has caused real bugs — treat step renumbering with
care.

## Key subsystems (all in `grocery-app.jsx`)

- **`getMealSuggestions(...)`** — the weighted suggester. Hard gates: only `dinner`
  type; not disliked by an at-home member; not "involved" on an `easy` day; grillable
  only on `grill` days. Soft weights: recency down-weight, temperature affinity,
  grill boost, favorite score. Takes a `forecast` argument (see below).
- **`derivePills(days, effortMap, forecast)`** — auto-derives day pills ONCE at plan
  start (easy from the effort map, grill from the forecast). After that the user's
  edits win; never re-derive over them.
- **`multiMealCounts(mealPlan, meals)`** — returns `{ingredientId: count}` for
  ingredients used by 2+ planned meals. Meal→ingredient links are **presence-only
  (no quantities)**, so this flags overlap but can't compute whether one package
  suffices — that judgment stays with the user. The "shared across meals" checklist
  deliberately includes in-stock and in-cart items, because "I already have it" is
  exactly when people under-buy a multi-meal ingredient.
- **Live weather** — `fetchLiveForecast()` calls the free Open-Meteo API (no key,
  CORS-enabled) for the current shopping week, cached 6h in localStorage. On any
  failure it returns `{}`, which every consumer treats as neutral. Configure
  location via `FORECAST_LAT` / `FORECAST_LON` near the top of the file. In
  `PlanMeals`, the forecast is React state fetched on mount, gated by a
  `forecastLoaded` flag so the one-shot pill derivation waits for it.

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
- **Some identifiers carry historical names** (e.g. `awayHome`, `memberOk`) from a
  refactor that genericized personal data. They're just variable names.

## Privacy / sanitization (important)

This repo is **public**. The app was sanitized before publishing: no real names,
phone numbers, addresses, or personal calendar data. When editing:

- Do NOT add real personal data (names, numbers, home address, private notes) to the
  source or seed data. Use generic placeholders.
- `FORECAST_LAT` / `FORECAST_LON` are a neutral placeholder. If setting a real
  location, prefer a nearby town-center coordinate over an exact home address — the
  weather is identical and it's public.
- The deployed site's JS is publicly readable (static host), so treat anything in
  the code as public regardless of any future repo-visibility change.

## Typical tasks

- **Add/adjust a meal-suggestion rule:** edit `getMealSuggestions`; keep the
  gate-vs-weight distinction.
- **Change the step flow:** edit `PLAN_STEPS` AND the draft-migration mapping + version
  stamp together.
- **Change weather location:** edit `FORECAST_LAT` / `FORECAST_LON`.
- **Ship a change:** `npm run build` to confirm it compiles, commit, push to `main`;
  the workflow redeploys Pages automatically (1–3 min).
