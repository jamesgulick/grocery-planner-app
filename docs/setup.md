# Setup: make it yours

You can use the hosted copy as is (your data stays in your browser). To change the household, location or storage places, fork the repo and run your own copy on GitHub Pages. It's free and takes about ten minutes.

## 1. Fork and publish

1. **Fork** this repository to your GitHub account.
2. In your fork, open **Settings › Pages** and set **Source** to **GitHub Actions**.
3. Push any commit to `main` (or run the workflow from the **Actions** tab). The app publishes at `https://<your-username>.github.io/<repo-name>/`.
4. On your phone, open that address and use **Add to Home Screen**, so it opens like an app.

The repo must stay **public** for GitHub Pages to serve it on the free plan, so everything in it is public. Your own data never goes in the repo: it lives only in your browser and your backup file.

## 2. Your household

Edit `FAMILY` in `src/app/globals.js`: one entry per person, by first name or a nickname. Mark the person who does the planning with `isSelf: true`.

```js
const FAMILY = [
  { name: "Sam" },
  { name: "Alex" },
  { name: "Me", isSelf: true },
];
```

The names are public in your fork, so use whatever you're comfortable showing. Short names fit best: each person gets a chip on the Who's home row.

## 3. Weather

The forecast (from the free Open-Meteo API, no key needed) drives the weather shown on each day and nudges the planner toward lighter meals on warm days and the grill on dry ones. In `src/app/weather.js`:

- set `FORECAST_LAT` / `FORECAST_LON` to your town (a town centre is plenty — no need for your street);
- change `timezone=` and, if you prefer Celsius, `temperature_unit=` in the forecast URL.

## 4. Storage places

Inventory walks your storage places in order. Edit `STORAGE_LOCATIONS` in `src/app/globals.js` to match your kitchen (keep `"Unassigned"` first).

## 5. In the app

- **Settings › Planning › Usual shopping day** — your pickup day. Plans run from one shopping day to the next.
- **Settings › Away dates** — someone away for a stretch.
- **Library** — add your meals and items, or start from the example data and edit.
- **Data › Back up** regularly; the data icon shows a dot when a backup is due.

## Run it locally

```bash
npm install
npm run dev
```
