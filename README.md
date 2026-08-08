# Grocery Planner

A single-file React grocery-planning web app for coordinating weekly grocery
pickup orders. Built with [Vite](https://vitejs.dev/); deploys to GitHub Pages
automatically on push.

## What it does

A six-step weekly workflow: **Welcome → Meals → Inventory → Confirm → Sparky →
Reconcile.**

- **Meals** — per-day cards with weighted meal suggestions, day "pills"
  (easy / grill / special), a per-day "who's away" toggle that filters out disliked
  meals, day-notes, and a **live weather forecast** (Open-Meteo, no API key).
- **Inventory** — walk your storage locations and check off what's in stock.
- **Confirm** — a "used across multiple meals" check on top, then the shopping list
  with per-item quantity tuning and drop-toggles.
- **Sparky** — copy the list (batched) to hand off to a cart-building assistant,
  plus a shared-item quantity-check prompt.
- **Reconcile** — upload a placed order; local matching flags missing items,
  quantities over one, and optional items over a price threshold.

Design principle: **the app nudges, it never gates your judgment.** Suggestions are
weighted, not forced; most signals are soft leans, a few are hard gates.

## Local development

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install     # install dependencies
npm run dev     # start the dev server (hot reload) at http://localhost:5173
npm run build   # produce a production build in dist/
npm run preview # preview the production build locally
```

All the app code is in **`src/grocery-app.jsx`** — edit it and the dev server
reloads. `src/main.jsx` just mounts it.

## Deploying to GitHub Pages

This repo ships a GitHub Actions workflow (`.github/workflows/deploy.yml`) that
builds and deploys on every push to `main`. To turn it on:

1. Push this project to a GitHub repository (branch `main`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push any commit (or use the "Run workflow" button on the Actions tab). The site
   publishes at `https://<username>.github.io/<repo-name>/`.

The build uses a relative asset base, so it works at either a project subpath or a
user/organization root without extra config.

## Configuration

- **Location for weather:** edit `FORECAST_LAT` / `FORECAST_LON` near the top of
  `src/grocery-app.jsx`. The default is a neutral placeholder.
- **Data:** stored in the browser's `localStorage` under `grocery_db`. Export/import
  JSON from the Manage tab to move data between devices.
- **Meals & ingredients:** ship as a small seed set; edit them in the Manage tab.

## Notes

- Weather uses the free [Open-Meteo](https://open-meteo.com/) API (no key, CORS-
  enabled). If a fetch fails, the app treats every day as neutral — nothing breaks.
- Some in-app conveniences (iOS Shortcuts hooks for iCloud sync) are specific to a
  mobile setup and are optional.

## License

MIT — see [LICENSE](LICENSE).
