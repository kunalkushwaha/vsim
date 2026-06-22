// One-shot: stamp publish metadata + publishConfig onto every @vsim/* package.
// Local main/types/exports keep pointing at ./src (build-free dev loop);
// publishConfig swaps them to ./dist only inside the published tarball.
// Run once with: node scripts/prepare-publish.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/kunalkushwaha/vsim";

const DESC = {
  core: "Scene document schema, deterministic clock, seeded RNG & animation evaluation — the engine-agnostic core of vsim.",
  "engine-software": "Pure-TypeScript reference rasterizer for vsim — the deterministic render oracle, runs anywhere without a GPU.",
  "engine-three": "Three.js renderer adapter for vsim (GPU, high fidelity).",
  "physics-rapier": "Deterministic Rapier physics adapter for vsim.",
  render: "Headless frame capture → ffmpeg → MP4 (with audio mux) for vsim.",
  authoring: "Declarative builder API for vsim — author scene documents in code.",
  player: "Browser real-time preview component for vsim scenes.",
  assets: "glTF/GLB asset pipeline (load + export) for vsim.",
  cli: "vsim command-line — render a code scene to a deterministic MP4.",
};

const KEYWORDS = ["3d", "animation", "video", "webgl", "three.js", "deterministic", "rendering", "remotion", "vsim"];

const pkgsDir = resolve(root, "packages");
for (const name of readdirSync(pkgsDir)) {
  const file = resolve(pkgsDir, name, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  pkg.description = DESC[name] ?? pkg.description;
  pkg.license = "MIT";
  pkg.author = "Kunal Kushwaha";
  pkg.homepage = `${REPO}#readme`;
  pkg.repository = { type: "git", url: `git+${REPO}.git`, directory: `packages/${name}` };
  pkg.bugs = { url: `${REPO}/issues` };
  pkg.keywords = KEYWORDS;
  pkg.engines = { node: ">=20" };
  pkg.files = ["dist", "README.md"];
  pkg.sideEffects = false;

  const publishConfig = {
    access: "public",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  };
  if (pkg.bin) publishConfig.bin = { vsim: "./dist/index.js" };
  pkg.publishConfig = publishConfig;

  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`patched ${pkg.name}`);
}
