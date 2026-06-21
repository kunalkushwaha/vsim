#!/usr/bin/env node
// Determinism lint: the deterministic runtime packages must not use wall-clock time or
// global randomness — use @vsim/core's seeded Rng and frame-based time instead. (The player
// package is exempt: it intentionally uses wall-clock time for live preview.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RUNTIME_PKGS = ["core", "engine-software", "physics-rapier", "authoring", "assets", "render"];
const BANNED = [/Math\.random\b/, /\bDate\.now\b/, /performance\.now\b/];

const violations = [];
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return; // skip comments
        for (const re of BANNED) if (re.test(line)) violations.push(`${p}:${i + 1}  ${t}`);
      });
    }
  }
}

for (const pkg of RUNTIME_PKGS) walk(`packages/${pkg}/src`);

if (violations.length) {
  console.error("✗ determinism lint failed — non-deterministic API in runtime code:");
  for (const v of violations) console.error("  " + v);
  console.error("\nUse `new Rng(seed)` from @vsim/core and frame-based time instead.");
  process.exit(1);
}
console.log(`✓ determinism lint passed (${RUNTIME_PKGS.length} runtime packages clean)`);
