# The data file

Everything the app knows is one JSON file, `grocery_db.json`, the same file **Data › Back up** saves and **Import** loads. The name stays the same on every save so shortcuts and sync tools can rely on it.

## Top level

| Key | What it holds |
|---|---|
| `meals` | Your meals (mains and sides). |
| `ingredients` | Your items: `tier` (`always`, `staple`, `specialty` = As needed), `storageLocation`, `defaultQuantity`. |
| `plans` | `current` and `next`: the two planned weeks. |
| `planTail`, `mealHistory` | Recent past days, for "last made", leftovers and rating. |
| `settings` | Household, shopping day, away dates, grill season, Instructions for AI. |
| `_meta` | Export details, and the request when the file is sent to an AI chat. |

Other keys are bookkeeping (schema versions, timestamps) and are best left alone.

## A meal

| Field | Meaning |
|---|---|
| `name` | Unique; plans refer to meals by name. |
| `type` | `dinner` (a main) or `side`. |
| `rotation` | `in` (the planner can choose it), `experimental` (New), `manual` (Hand-picked: only when you pick it). |
| `cadence` | `weekly`, `biweekly`, `occasional`, or absent (not set). |
| `effort` | Time needed: `easy`, `medium`, `involved` (Little / Some / Lots in the app). |
| `preferences` | Per person: `likes`, `fine`, or `dislikes` (won't eat). No entry means not asked yet. |
| `form`, `service`, `experience`, `plate` | Style tags from a fixed vocabulary (the planner uses them for spacing and pairing). |
| `ingredients` | Item ids to buy for it. |
| `notes`, `link` | Free text; the recipe link. |

## A plan

| Field | Meaning |
|---|---|
| `weekStartDate`, `endDate` | First and last day (5 to 9 days). |
| `mealPlan` | Each day's dishes, by meal name. |
| `dayNotes` | Each day's note. Days 1–7 are keyed by weekday (`Mon`…`Sun`); days 8 and 9 by `X1`, `X2`. |
| `presence`, `timeLevels` | Who's home and how much time, per night. |
| `checkedIds`, `stapleFlags`, `quantities` | The order: what you're buying and how much. |

The file format isn't a public API and may change between versions; the app migrates older files when it loads them.
