# Build Spec: Prep — Replace Single-Add With Bulk Paste-and-Match

Designed collaboratively; this is the contract. Implement against `src/grocery-app.jsx`.
Validate at runtime.

## Why

The Prep screen has TWO overlapping "mark in cart" inputs that both ultimately mark an
ingredient in `cartIngredientIds`, with an unclear division of labor:
- **Input 1** (~line 1298, "Search ingredients to mark..."): interactive search — type,
  see filtered matches, TAP to toggle each in/out of cart. Can only mark real ingredients.
- **Input 2** (~line 1354, "Type an item to mark it in cart..."): type + Enter/Add;
  auto-matches to one ingredient. On NO match it silently writes free-text `cartItems` —
  the DEAD field nothing reads (a known trap).

Decision: give each a distinct job. Keep Input 1 as the single-item interactive path.
**Replace Input 2's single-add with a BULK paste-and-match** — paste a whole list, mark all
matches at once. Eliminates the redundancy AND the dead-field trap.

## The change

**Input 2 becomes a bulk paste box** (textarea, e.g. "Paste a list — one item per line — to
mark them in cart"):
1. On submit, split the pasted text into lines. **Strip list formatting** per line: leading
   numbering (`1.`, `1)`), bullets (`-`, `*`, `•`), and surrounding whitespace. Ignore blank
   lines.
2. For EACH cleaned line, run the SAME match logic the current `addItem` uses (~lines
   1266–1273: exact name → substring either direction → prefer shortest). Collect the
   ingredient hits.
3. **Mark all matched ingredient IDs** into `cartIngredientIds` in one update
   (`[...new Set([...cartIngredientIds, ...matchedIds])]`).
4. **Unmatched lines:** do NOT write to `cartItems` (drop that dead-field fallback entirely).
   Instead show a **transient summary** below the box, e.g.:
   `Marked 7 · Couldn't match 2: "tortillas", "star fruit"`.
   The owner can retype an unmatched item into Input 1 (search) to resolve it manually.
5. The summary is TRANSIENT — it reflects the last paste; it clears on the next paste or when
   leaving the step. Do not persist it.

**Remove** the old single-add behavior of Input 2 (the `addItem` free-text `cartItems`
fallback path) — Input 1 covers single items, and nothing should write the dead `cartItems`
field anymore.

## Notes

- Reuse the existing match logic; don't reinvent it. (It lives in the current `addItem`.)
- Items already in cart: skip/no-op (don't double-add); can optionally note "already in cart"
  in the count.
- This does NOT touch `cartItems` reads elsewhere except to STOP writing it here. (If
  `cartItems` is now written nowhere, that's fine — it can be fully retired in a later cleanup;
  out of scope here.)

## Out of scope (backlog separately)

- **Tappable-chip resolution** for unmatched lines (tap an unmatched item to pre-fill Input
  1's search / a picker). Deferred — start with the transient text summary; revisit if the
  manual-retype friction proves annoying in real use.

## Validation checklist

- Pasting a multi-line list (with mixed `1.`/`-`/plain formatting) marks all matching
  ingredients in `cartIngredientIds` in one action; they drop off the shopping list.
- Numbering/bullets are stripped; blank lines ignored.
- Unmatched lines are reported in a transient summary and are NOT written to `cartItems`.
- No path from the Prep screen writes the dead `cartItems` field anymore.
- Input 1 (search-and-tap) is unchanged and still works for single items.
- Summary clears on next paste / leaving the step.
- Builds clean; paste a real list live and confirm the matched items leave the shopping list.
