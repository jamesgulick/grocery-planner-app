# Grocery Planner

A React grocery-planning web app for composing a week of dinners and turning it into
a grocery pickup order. Built with [Vite](https://vitejs.dev/); deploys to GitHub
Pages automatically on push.

## What it does

A five-step weekly workflow: **Welcome → Meals → Inventory → Confirm → Sparky.**

- **Meals** — the week is composed plate by plate: a main, plus suggested sides,
  each labelled with why it's there ("covers" someone who won't eat the main, or
  "goes with" it). For each day you set how much time you have to cook (none /
  some / much — only "much" allows involved meals) and who's home; longer absences
  are date-range away periods. Fill every empty day at once, or work one day at a
  time: fill a day, ⟳ a main (its sides follow), ⟳ a single side, or suggest sides
  for a main. A week check reports the week as you built it — whether everyone has
  something they'll eat each night (counting leftovers), spacing, effort, meals
  drifting out of rotation — quiet by default, with a "Show reasoning" mode that
  explains every pick. Uses a **live weather forecast** (Open-Meteo, no API key)
  and a grill-season switch.
- **Inventory** — walk your storage locations and check off what's in stock.
- **Confirm** — a "used across multiple meals" check on top, then the shopping list
  with per-item quantity tuning and drop-toggles.
- **Sparky** — copy the list (batched) to hand off to a cart-building assistant,
  plus a shared-item quantity-check prompt.

Design principle: **the app nudges, it never gates your judgment.** You can put
anything on any day; the planner cross-checks what you built and suggests, but
never blocks or silently corrects it.

## How suggestions work

Suggestions come from a small, deterministic week-composition engine
(`src/engine/composeWeek.js`), not from random weighted picks. It composes the week
under a fixed priority order:

1. **The floor** — every person who's home has something acceptable to eat each
   night, counting leftovers carried from earlier meals. A "dislike" means "won't eat
   it"; the engine works around it (a side that feeds them, or leftovers) rather than
   banning the meal.
2. **Spacing** — similar meals (same dish form, or back-to-back takeout) aren't
   clustered.
3. **Freshness and cadence** — meals come back on their own rhythm (weekly,
   biweekly, or occasional) without repeating too soon.
4. **Small leans** — effort vs. the day's time, weather, and what people like.

Randomness only breaks ties. A second entry point, `evaluateWeek`, checks a week as
built without changing anything; it drives the week check. The engine is pure (data
in, data out) and is validated offline against real judgments before it ships.
`src/engine/assembleInputs.js` turns app state into its inputs.

## Local development

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install     # install dependencies
npm run dev     # start the dev server (hot reload) at http://localhost:5173
npm run build   # produce a production build in dist/
npm run preview # preview the production build locally
```

The UI lives in **`src/grocery-app.jsx`**; the engine and its input assembly live in
**`src/engine/`**. `src/main.jsx` just mounts the app.

## Deploying to GitHub Pages

This repo ships a GitHub Actions workflow (`.github/workflows/deploy.yml`) that
builds and deploys on every push to `main`. To turn it on:

1. Push this project to a GitHub repository (branch `main`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push any commit (or use the "Run workflow" button on the Actions tab). The site
   publishes at `https://<username>.github.io/<repo-name>/`.

The build uses a relative asset base, so it works at either a project subpath or a
user/organization root without extra config.

The workflow can also publish a work-in-progress branch at `/preview/` alongside
the live site. A preview build keeps its data under separate storage keys (it copies
the live data in once, read-only) and shows a PREVIEW banner, so trying changes
there never touches the live app's data.

## Configuration

- **Location for weather:** edit `FORECAST_LAT` / `FORECAST_LON` near the top of
  `src/grocery-app.jsx`. The default is a neutral placeholder.
- **Data:** stored in the browser's `localStorage` under `grocery_db`. Export/import
  JSON from the Manage tab to move data between devices.
- **Meals & ingredients:** ship as a small seed set; edit them in the Manage tab.
  Meals carry the tags the engine reads (rotation, cadence, effort, dish form,
  plate traits, pairings for sides, leftovers, cost, per-person likes/dislikes).
- **Family, away periods, grill season:** Manage → Config.

## Notes

- Weather uses the free [Open-Meteo](https://open-meteo.com/) API (no key, CORS-
  enabled). If a fetch fails, the app treats every day as weather-neutral and holds
  back grilling — nothing breaks.
- Some in-app conveniences (iOS Shortcuts hooks for iCloud sync) are specific to a
  mobile setup and are optional.

## License

MIT — see [LICENSE](LICENSE).
