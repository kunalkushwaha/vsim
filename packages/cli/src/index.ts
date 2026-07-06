#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDocument, type PhysicsAdapter, type SceneDocument } from "@vsim/core";
import { renderToVideo, renderStill } from "@vsim/render";

/**
 * Import a scene module. TypeScript scenes are compiled on the fly via tsx's
 * programmatic API so the published CLI works under plain `node` (the dev loop
 * already runs everything through tsx). `.js`/`.mjs` scenes import directly.
 */
// Loosely typed (like a dynamic import) — scene modules export arbitrary shapes.
async function importScene(abs: string): Promise<any> {
  const url = pathToFileURL(abs).href;
  if (/\.tsx?$/.test(abs)) {
    const { tsImport } = await import("tsx/esm/api");
    return tsImport(url, import.meta.url);
  }
  return import(url);
}

interface Args {
  cmd: string;
  file?: string;
  output: string;
  still?: string;
  frame: number;
  workers?: number;
  audio?: string;
  font?: string;
  name?: string;
  prompt?: string;
  render?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: argv[0] ?? "", output: "out/out.mp4", frame: 0 };
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t === "-o" || t === "--output") a.output = argv[++i]!;
    else if (t === "--still") a.still = argv[++i]!;
    else if (t === "--workers") a.workers = Number(argv[++i]);
    else if (t === "--frame") a.frame = Number(argv[++i]);
    else if (t === "--audio") a.audio = argv[++i]!;
    else if (t === "--font") a.font = argv[++i]!;
    else if (t === "--name") a.name = argv[++i]!;
    else if (t === "--prompt" || t === "-p") a.prompt = argv[++i]!;
    else if (t === "--render") a.render = argv[++i]!;
    else if (!t!.startsWith("-")) a.file = t;
  }
  return a;
}

/** Load a scene document from a .ts/.js module (default/`scene`/`document` export) or .json. */
async function loadScene(file: string): Promise<{ doc: SceneDocument; audio?: string; font?: string }> {
  const abs = resolve(file);
  if (extname(abs) === ".json") {
    return { doc: parseDocument(JSON.parse(await readFile(abs, "utf8"))) };
  }
  const mod = await importScene(abs);
  let exported = mod.default ?? mod.scene ?? mod.document;
  // Scenes that load assets (e.g. a glTF rig) export a Promise — await it.
  if (exported && typeof exported.then === "function") exported = await exported;
  if (!exported) throw new Error(`${file} must export a scene (default export, or \`scene\`/\`document\`).`);
  const doc: SceneDocument = exported.version ? exported : parseDocument(exported);
  return { doc, audio: mod.audioPath, font: mod.fontPath };
}

/**
 * Register a custom overlay font (TTF/OTF) with the text rasterizer. Scenes are imported in
 * an isolated tsx module graph, so a scene calling setFont() itself would hit a different
 * instance — the CLI (which shares the renderer's graph) must do it. `--font` wins over the
 * scene's exported `fontPath`.
 */
async function applyFont(path: string | undefined): Promise<void> {
  if (!path) return;
  const { setFont } = await import("@vsim/text");
  setFont(await readFile(resolve(path)));
}

/** Lazily create a Rapier physics adapter only if the scene needs one. */
async function maybePhysics(doc: SceneDocument): Promise<PhysicsAdapter | undefined> {
  if (!doc.physics || doc.physics.bodies.length === 0) return undefined;
  try {
    const { RapierPhysics } = await import("@vsim/physics-rapier");
    return new RapierPhysics();
  } catch (e) {
    console.warn("⚠ Scene has physics but @vsim/physics-rapier is unavailable; rendering without it.");
    return undefined;
  }
}

function progressBar(frame: number, total: number): void {
  const w = 28;
  const filled = Math.round((frame / total) * w);
  const bar = "█".repeat(filled) + "░".repeat(w - filled);
  process.stderr.write(`\r  rendering [${bar}] ${frame}/${total}`);
  if (frame === total) process.stderr.write("\n");
}

/** Render `doc` to video (or a still). Shared by `render` and `edit --render`. */
async function renderDoc(doc: SceneDocument, args: Args, audioPath?: string, fontPath?: string): Promise<void> {
  const physics = await maybePhysics(doc);
  const font = args.font ?? fontPath;
  await applyFont(font);
  try {
    if (args.still) {
      await renderStill(doc, args.frame, args.still, { physics });
      console.log(`✓ still frame ${args.frame} → ${args.still}`);
      return;
    }
    const output = args.render ?? args.output;
    const t0 = Date.now();
    const res = await renderToVideo(doc, {
      output,
      physics,
      workers: args.workers,
      fontPath: font,
      audioPath,
      audioGain: doc.audio?.gain,
      onProgress: progressBar,
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✓ ${res.frames} frames @ ${res.width}x${res.height} → ${res.output}  (${secs}s)`);
  } finally {
    physics?.dispose();
  }
}

async function runRender(args: Args): Promise<void> {
  const { doc, audio, font } = await loadScene(args.file!);
  await renderDoc(doc, args, args.audio ?? audio, font);
}

/** AI copilot: turn a natural-language prompt into edits on a scene document. */
async function runEdit(args: Args): Promise<void> {
  if (!args.file || !args.prompt) {
    console.log('Usage: vsim edit <scene.ts|scene.json> --prompt "..." [-o out.scene.json] [--render out.mp4]');
    process.exit(1);
  }
  const { editScene } = await import("@vsim/ai");
  const { doc: input } = await loadScene(args.file);

  process.stderr.write("  thinking…\n");
  const { doc, operations, summary, provider } = await editScene({ doc: input, prompt: args.prompt });

  if (operations.length === 0) {
    console.log(`✗ The copilot (${provider}) proposed no edits.`);
    return;
  }

  const out = args.output === "out/out.mp4" ? "out/edited.scene.json" : args.output;
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(doc, null, 2));

  console.log(`✓ ${operations.length} edit(s) via ${provider} → ${out}`);
  if (summary) console.log(`  ${summary}`);
  for (const op of operations) console.log(`    • ${op.op}${"id" in op && op.id ? ` ${op.id}` : "nodeId" in op ? ` ${op.nodeId}` : ""}`);

  if (args.render) await renderDoc(doc, args);
}

/**
 * AI film director (the 2D web-rendering path): prompt → FilmDoc, a schema-validated
 * screenplay the AI cannot make invalid → deterministic explainer MP4 via @vsim/motion.
 */
async function runFilm(args: Args): Promise<void> {
  if (!args.prompt) {
    console.log('Usage: vsim film --prompt "<topic>" [-o out.mp4] [--name slug]');
    process.exit(1);
  }
  // Plain .mjs, no build step — loosely typed like a dynamic plugin.
  // @ts-expect-error — untyped .mjs tool module
  const gen: any = await import("@vsim/motion/tools/film-gen.mjs");
  console.log(`✎ writing the screenplay for "${args.prompt}" …`);
  const { doc, attempts } = await gen.generateFilmDoc(args.prompt, {});
  const name = (args.name ?? args.prompt).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
  const dir = gen.writeFilm(doc, name);
  const secs = doc.beats[doc.beats.length - 1].end;
  console.log(`✓ FilmDoc "${doc.title}" — ${doc.beats.length} beats, ${secs}s (attempt ${attempts}) → ${dir}`);
  const output = args.output === "out/out.mp4" ? `out/${name}.mp4` : args.output;
  await gen.recordFilm(dir, output);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === "edit") return runEdit(args);
  if (args.cmd === "film") return runFilm(args);
  if (args.cmd === "render" && args.file) return runRender(args);
  console.log(
    "Usage:\n" +
      "  vsim render <scene.ts|scene.json> [-o out.mp4] [--workers N] [--still frame.png --frame N] [--audio file]\n" +
      '  vsim film --prompt "<topic>" [-o out.mp4]        AI writes a FilmDoc screenplay → deterministic 2D explainer video\n' +
      '  vsim edit <scene.ts|scene.json> --prompt "..." [-o out.scene.json] [--render out.mp4]   (uses ANTHROPIC_API_KEY, or the claude CLI)',
  );
  process.exit(args.cmd ? 1 : 1);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
