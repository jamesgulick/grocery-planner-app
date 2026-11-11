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
