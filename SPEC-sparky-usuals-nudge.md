# Build Spec: Add "prefer my usuals" nudge to the Sparky prompt

Small change. Implement against `src/grocery-app.jsx`. The two Sparky prompt strings
(~lines 2385–2386, the batched and single variants) instruct the cart-filling assistant.

## Change

Add a brief soft nudge so that when Sparky picks a product for a listed item, it prefers the
owner's usual choice where it can tell (relying on Sparky's own access to Walmart order
history — the app does not supply specifics).

Wording must COMPLEMENT the existing "do not substitute / add the closest option"
constraint, not contradict it — the nudge is about WHICH product variant to pick for a listed
item, not about swapping items. Suggested clause to add to BOTH strings (place it right after
the "add the closest option and tell me" sentence, before the "list back" sentence):

> "When there's a choice of brand or size for an item, prefer my usual pick where you can tell
> from my order history."

Keep it to one sentence. Do not change any other part of the prompts. Do not add any
specific brands/sizes (this is a general nudge, by design).

## Validation

- Both prompt variants (batched and single) include the one-sentence usuals nudge.
- The nudge reads consistently with "don't substitute" (it's about variant choice, not item
  swaps).
- No other prompt text changed. Builds clean.
