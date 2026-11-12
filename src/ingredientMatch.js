// Ingredient text matching — one matcher for every place the app turns pasted or typed
// text into ingredient items (recipe paste in the meal editor).
// Pure and node-testable. Matches on WORDS, not raw text: case, punctuation, plurals,
// quantities, units and preparation words are normalised away before comparing.

// Seed for settings.pantryIgnore: terms skipped by recipe paste (never ticked into a
// recipe, never created as items). Owned by the user from then on.
export const DEFAULT_PANTRY_IGNORE = ["water", "salt", "pepper", "black pepper", "oil", "cooking spray", "ice"];

const UNITS = new Set(("tablespoon tbsp tbs teaspoon tsp cup ounce oz lb pound clove can jar package pkg box bag bunch pinch dash "
  + "gram g kg ml liter litre quart pint inch piece slice stick head stalk sprig container bottle carton handful").split(" "));
// Preparation, sizes and filler: dropped from the line before matching and from new names.
const PREP = new Set(("chopped minced diced sliced thinly thickly finely roughly coarsely loosely packed cut into cube cubed grated "
  + "shredded melted softened beaten cooked uncooked rinsed cooled drained divided optional plus more garnish serving serve "
  + "taste according direction immediately cold warm hot room temperature large small medium freshly peeled seeded trimmed "
  + "halved quartered crushed toasted").split(" "));
// Filler: dropped everywhere, item names included ("Cream of chicken soup").
const FILLER = new Set("of the a an to for with about".split(" "));
// Descriptors: present in many item names, but neither has to appear for a match.
const DESC = new Set("fresh frozen canned mild loaf sleeve whole dried ground".split(" "));

const singular = w => {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (/(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
};
// Lower-case words with parentheticals, digits, fractions and punctuation removed.
const rawWords = s => String(s || "").toLowerCase()
  .replace(/\(.*?\)/g, " ").replace(/['’]/g, "").replace(/[^a-z\s]/g, " ")
  .split(/\s+/).filter(Boolean);
const norm = s => rawWords(s).map(singular);

// The part of a pasted line that names the ingredient: list formatting stripped, then
// everything from the first comma on dropped ("4 tomatoes, diced" -> "4 tomatoes").
export const stripListFormatting = line => String(line || "").trim()
  .replace(/^[-*•–—]\s*/, "").replace(/^\d+[.)]\s+/, "").trim();
const head = line => stripListFormatting(line).split(",")[0];
// Content words of a phrase: normalised, minus units and preparation words.
const content = s => norm(s).filter(w => !UNITS.has(w) && !PREP.has(w) && !FILLER.has(w));
// All words of a phrase that could be part of an item's name (prep words kept: "Shredded cheddar").
const named = s => norm(s).filter(w => !UNITS.has(w) && !FILLER.has(w));
const coreOf = ws => ws.filter(w => !DESC.has(w));

// A display name for a new item, from the line's own words: "Mung bean sprouts".
export function cleanName(line) {
  const ws = rawWords(head(line)).filter(w => !UNITS.has(singular(w)) && !PREP.has(singular(w)) && !FILLER.has(w));
  const s = ws.join(" ").replace(/^(and|or)\s+|\s+(and|or)$/g, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function indexItems(ingredients) {
  return (ingredients || []).map(i => {
    const ws = norm(i.name).filter(w => !FILLER.has(w));
    return { item: i, words: ws, core: coreOf(ws), exact: i.name.trim().toLowerCase() };
  }).filter(x => x.core.length);
}

// Best item for a phrase. An item matches when all its core words are in the phrase
// (or, for a short phrase, when the phrase's words are all inside exactly one item's
// name, e.g. "ricotta" -> "Ricotta cheese"). Full match when the item covers at least
// two-thirds of the phrase's core words; otherwise partial ("rice vinegar" -> Rice).
function bestFor(all, words, index) {
  const lineCore = coreOf(words);           // content words: what the line is about
  const lineAll = coreOf(all);              // plus prep words that may be part of a name
  if (!lineCore.length) return null;
  const hits = [];
  for (const x of index) {
    if (x.core.every(w => lineAll.includes(w))) {
      const desc = x.words.filter(w => DESC.has(w) && all.includes(w)).length;
      const denom = new Set([...lineCore, ...x.core]).size;
      hits.push({ x, score: x.core.length * 10 + desc, cover: x.core.length / denom });
    }
  }
  if (hits.length) {
    hits.sort((a, b) => b.score - a.score || a.x.item.name.length - b.x.item.name.length);
    const h = hits[0];
    return { item: h.x.item, full: h.cover >= 2 / 3, alternatives: hits.slice(1, 4).map(o => o.x.item) };
  }
  const within = index.filter(x => lineCore.every(w => x.core.includes(w)));
  if (within.length) {
    within.sort((a, b) => a.item.name.length - b.item.name.length);
    return { item: within[0].item, full: within.length === 1, alternatives: within.slice(1, 4).map(x => x.item) };
  }
  return null;
}

// Is this phrase covered by a pantry-ignore term? Same two-thirds bar as a match.
function ignoredBy(words, ignore) {
  const lineCore = coreOf(words);
  if (!lineCore.length) return null;
  for (const term of ignore || []) {
    const tw = coreOf(norm(term));
    if (tw.length && tw.every(w => lineCore.includes(w)) && tw.length / lineCore.length >= 2 / 3) return term;
  }
  return null;
}

// Possible duplicate for a NEW line: an item sharing most of the words (at least
// two-thirds of the longer word list), so "yellow onion" finds "Yellow onions" but
// "lime juice" doesn't drag in "Orange juice".
function nearMiss(words, index) {
  const lineCore = coreOf(words);
  return index.map(x => {
    const shared = x.core.filter(w => lineCore.includes(w)).length;
    return { item: x.item, r: shared / Math.max(x.core.length, lineCore.length) };
  }).filter(o => o.r >= 2 / 3).sort((a, b) => b.r - a.r).slice(0, 3).map(o => o.item);
}

function analysePhrase(text, index, ignore) {
  const words = content(text);
  // The pantry ignore list comes first: an ignored term is skipped even if it's an item.
  const term = words.length ? ignoredBy(words, ignore) : null;
  if (term) return { kind: "ignored", term };
  const exact = index.find(x => x.exact === text.trim().toLowerCase());
  if (exact) return { kind: "match", item: exact.item, full: true, alternatives: [] };
  if (!words.length) return { kind: "skip", reason: "empty" };
  // "a or b": first alternative that matches wins; the rest are noted.
  const alts = text.split(/\s+or\s+/i).map(s => s.trim()).filter(Boolean);
  if (alts.length > 1) {
    const results = alts.map(a => ({ a, r: analysePhrase(a, index, ignore) }));
    const pick = results.find(x => x.r.kind === "match" && x.r.full) || results.find(x => x.r.kind === "match") || results[0];
    return { ...pick.r, orAlternatives: alts.filter(a => a !== pick.a) };
  }
  const best = bestFor(named(text), words, index);
  if (best) return { kind: "match", item: best.item, full: best.full, alternatives: best.alternatives };
  return { kind: "new", name: cleanName(text), suggestions: nearMiss(words, index) };
}

const isHeading = line => /:\s*$/.test(line) || /^(ingredients?|for the .*)$/i.test(line.trim());

// One pasted recipe line -> one or more results. "Salt and pepper" splits into two only
// when every part is ignored or fully matched; otherwise the line stays whole, so
// "mac and cheese" and "broccoli florets and stems" aren't torn apart.
export function analyseLine(rawLine, ingredients, ignore = DEFAULT_PANTRY_IGNORE, _index) {
  const index = _index || indexItems(ingredients);
  const line = stripListFormatting(rawLine);
  if (!line) return [];
  if (isHeading(line)) return [{ line, kind: "skip", reason: "heading" }];
  const text = head(line);
  const whole = analysePhrase(text, index, ignore);
  if (!(whole.kind === "match" && whole.full) && whole.kind !== "ignored" && /\s(and|&)\s/i.test(text)) {
    const parts = text.split(/\s+(?:and|&)\s+/i).map(s => s.trim()).filter(Boolean);
    const rs = parts.map(p => analysePhrase(p, index, ignore));
    if (parts.length > 1 && rs.every(r => r.kind === "ignored" || (r.kind === "match" && r.full))) {
      return rs.map((r, k) => ({ line, part: parts[k], ...r }));
    }
  }
  return [{ line, ...whole }];
}

export function analyseRecipe(text, ingredients, ignore = DEFAULT_PANTRY_IGNORE) {
  const index = indexItems(ingredients);
  return String(text || "").split(/\r?\n/).flatMap(l => analyseLine(l, ingredients, ignore, index));
}

// The cleaned term "Always ignore" adds for a line: its content words, as written.
export function ignoreTermFor(line) {
  return rawWords(head(stripListFormatting(line))).filter(w => !UNITS.has(singular(w)) && !PREP.has(singular(w))).join(" ");
}

// Single best item for a short typed/pasted phrase: full matches only. (Its caller,
// the Prep tab's cart paste, was cut in polish Phase 1; kept for the next one-line paste.)
export function matchIngredient(text, ingredients) {
  const t = stripListFormatting(text);
  const index = indexItems(ingredients);
  const exact = index.find(x => x.exact === t.toLowerCase());
  if (exact) return exact.item;
  const r = analysePhrase(head(t), index, []);
  return r.kind === "match" && r.full ? r.item : null;
}
