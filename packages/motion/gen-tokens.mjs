// tokens.json → tokens.css (CSS custom properties). Run: pnpm --filter @vsim/motion gen:tokens
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (/** @type {string} */ p) => fileURLToPath(new URL(p, import.meta.url));
const t = JSON.parse(readFileSync(here("./tokens.json"), "utf8"));

const lines = [":root {"];
for (const [k, v] of Object.entries(t.color)) lines.push(`  --color-${k}: ${v};`);
for (const [k, v] of Object.entries(t.stroke)) lines.push(`  --stroke-${k}: ${v}px;`);
for (const [k, v] of Object.entries(t.radius)) lines.push(`  --radius-${k}: ${v}px;`);
for (const [k, v] of Object.entries(t.type)) lines.push(`  --type-${k}: ${v}px;`);
lines.push(`  --font: ${t.font};`);
lines.push("}");

writeFileSync(here("./tokens.css"), `/* GENERATED from tokens.json — do not edit by hand. */\n${lines.join("\n")}\n`);
console.log("✓ tokens.css");
