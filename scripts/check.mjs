// `npm run check` — run before every merge to main.
//
// Always: lint (the scope and use-before-declaration errors `vite build` lets
// through) and a production build.
// When the untracked engine/ workspace is on disk: the engine stays byte-for-byte
// what was validated (SHA-256 against engine/engine-hashes.txt), the validation
// harness passes, and any golden tests in engine/golden/ pass. A clean clone
// without the workspace runs lint + build only, and says so.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const run = (label, cmd, args) => {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`\n✖ check failed at: ${label}`); process.exit(r.status || 1); }
};

run("lint", "npx", ["eslint", "src"]);

// Tokens only (polish Phase 1.6, widened in Phase 2): tokens.css is the one stylesheet in
// the new UI layer (src/ui, src/home, src/shell) that may hold a raw colour.
console.log("\n▶ ui stylesheets use tokens");
{
  const dirs = ["src/ui", "src/home", "src/shell"].filter(d => existsSync(d));
  const bad = dirs.flatMap(d => readdirSync(d).filter(f => f.endsWith(".css") && !(d === "src/ui" && f === "tokens.css")).map(f => `${d}/${f}`))
    .flatMap(p => readFileSync(p, "utf8").split(/\r?\n/)
      .map((l, i) => /#[0-9a-fA-F]{3,8}\b/.test(l.replace(/\/\*.*?\*\//g, "")) ? `  ${p}:${i + 1}: ${l.trim()}` : null).filter(Boolean));
  if (bad.length) { console.error("✖ raw colour outside tokens.css:\n" + bad.join("\n")); process.exit(1); }
  console.log("  ✓ only tokens.css holds raw colours");
}
run("build", "npx", ["vite", "build"]);

if (!existsSync("engine")) {
  console.log("\n(engine/ workspace not present: engine hash, harness and golden tests skipped)");
  process.exit(0);
}

console.log("\n▶ engine unchanged");
const hashFile = "engine/engine-hashes.txt";
if (!existsSync(hashFile)) { console.error(`✖ ${hashFile} missing`); process.exit(1); }
let drift = false;
for (const line of readFileSync(hashFile, "utf8").split(/\r?\n/).filter(Boolean)) {
  const [want, raw] = line.trim().split(/\s+/);
  const file = raw.replace(/^\*/, "");   // sha256sum's binary-mode marker
  const got = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (got !== want) { console.error(`✖ ${file} differs from the validated engine`); drift = true; }
  else console.log(`  ✓ ${file}`);
}
if (drift) process.exit(1);

run("engine harness", "node", ["engine/harness/run.js"]);

const goldenDir = "engine/golden";
if (existsSync(goldenDir)) {
  for (const f of readdirSync(goldenDir).filter(f => /\.test\.m?js$/.test(f)).sort())
    run(`golden: ${f}`, "node", [`${goldenDir}/${f}`]);
}
console.log("\n✓ check passed");
