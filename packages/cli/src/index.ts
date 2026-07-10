#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, dirname, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDocument, type PhysicsAdapter, type SceneDocument } from "@vsim/core";
import { renderToVideo, renderStill } from "@vsim/render";
import type { Film3DDoc } from "@vsim/film3d";

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
  template?: string;
  review?: number;
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
    else if (t === "--template") a.template = argv[++i]!;
    else if (t === "--render") a.render = argv[++i]!;
    else if (t === "--review") a.review = Number(argv[++i]);
    else if (!t!.startsWith("-")) a.file = t;
  }
  return a;
}

/**
 * Build a film's voice-over via the shared narration pipeline (timed lines → espeak-ng TTS →
 * one WAV): the muxable audio for any Film3DDoc whose beats carry `narration`. Derived output
 * (goes to out/, keyed by film name); returns undefined for silent films or when TTS is
 * unavailable — a missing narrator should soften the film, not fail the render.
 */
async function buildFilm3DNarration(doc: Film3DDoc, name: string): Promise<string | undefined> {
  const { narrationScript } = await import("@vsim/film3d");
  // ELEVENLABS_API_KEY upgrades the narrator to a production voice; espeak stays the
  // offline default AND the fallback, so a bad key or blocked network softens the voice,
  // never fails the render. (VSIM_NARRATOR=espeak forces the deterministic voice.)
  const wantEleven = !!process.env.ELEVENLABS_API_KEY && process.env.VSIM_NARRATOR !== "espeak";
  const dir = resolve("out", "narration", name);
  // @ts-expect-error — untyped .mjs tool module (the same engine that voices the 2D films)
  const { narrate } = await import("@vsim/motion/tools/narrate.mjs");
  for (const engine of wantEleven ? (["elevenlabs", "espeak"] as const) : (["espeak"] as const)) {
    const script = narrationScript(doc, { engine });
    if (!script) return undefined;
    await mkdir(dir, { recursive: true });
    const spec = join(dir, "narration.json");
    await writeFile(spec, JSON.stringify(script, null, 2));
    try {
      await narrate(spec, dir);
      return join(dir, "narration.wav");
    } catch (e) {
      console.warn(`⚠ ${engine} narration failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  return undefined;
}

/** Load a scene document from a .ts/.js module (default/`scene`/`document` export) or .json. */
async function loadScene(file: string): Promise<{ doc: SceneDocument; audio?: string; font?: string }> {
  const abs = resolve(file);
  if (extname(abs) === ".json") {
    const raw = JSON.parse(await readFile(abs, "utf8"));
    // A Film3DDoc screenplay compiles down to a SceneDocument first (shared sniff).
    const { isFilm3D, parseFilm3D, compileFilm3D } = await import("@vsim/film3d");
    if (isFilm3D(raw)) {
      const res = parseFilm3D(raw);
      if (res.errors) throw new Error(`invalid Film3DDoc:\n  ${res.errors.join("\n  ")}`);
      const audio = await buildFilm3DNarration(res.doc, basename(abs).replace(/\.film3d\.json$/, ""));
      return { doc: await compileFilm3D(res.doc), audio };
    }
    return { doc: parseDocument(raw) };
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
    console.log('Usage: vsim film --prompt "<topic>" [--template explainer|3d] [-o out.mp4] [--name slug] [--review N]');
    process.exit(1);
  }
  const name = (args.name ?? args.prompt).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
  const output = args.output === "out/out.mp4" ? `out/${name}.mp4` : args.output;

  if (args.template === "3d") {
    // 3D path: prompt → Film3DDoc screenplay → dailies review → SceneDocument → the normal pipeline.
    const { generateFilm3D, reviewFilm3D, compileFilm3D, pickReviewStills } = await import("@vsim/film3d");
    console.log(`✎ directing the 3D film for "${args.prompt}" …`);
    let { doc, attempts } = await generateFilm3D(args.prompt, {});
    console.log(`✓ Film3DDoc "${doc.title}" — ${doc.beats.length} beats, ${doc.beats[doc.beats.length - 1]!.end}s (attempt ${attempts})`);

    // The render–look–revise loop: render one still per shot, let the director watch the
    // dailies and revise the screenplay. KEEP (or an invalid revision) ends the loop.
    const rounds = args.review ?? 2;
    let previous: { sec: number; label: string; path: string }[] | undefined;
    for (let round = 1; round <= rounds; round++) {
      const dir = resolve("out", "review", name, `round-${round}`);
      await mkdir(dir, { recursive: true });
      // Keep the pre-review draft so the director's changes stay diffable.
      await writeFile(join(dir, "draft.film3d.json"), JSON.stringify(doc, null, 2));
      const compiled = await compileFilm3D(doc);
      const stills = [];
      for (const s of pickReviewStills(doc)) {
        const path = join(dir, `t${s.sec.toFixed(1).replace(".", "_")}.png`);
        await renderStill(compiled, Math.round(s.sec * doc.fps), path, {});
        stills.push({ ...s, path });
      }
      console.log(`✎ reviewing the dailies (round ${round}: ${stills.length} stills) …`);
      const review = await reviewFilm3D(doc, stills, { previous });
      previous = stills;
      if (!review.revised) {
        console.log("✓ the director kept the cut");
        break;
      }
      doc = review.doc;
      console.log(`✓ revised after review → "${doc.title}", ${doc.beats.length} beats`);
    }

    await mkdir(resolve("films"), { recursive: true });
    const file = resolve("films", `${name}.film3d.json`);
    await writeFile(file, JSON.stringify(doc, null, 2));
    console.log(`✓ screenplay → ${file}`);
    const audio = await buildFilm3DNarration(doc, name);
    await renderDoc(await compileFilm3D(doc), { ...args, output }, audio);
    return;
  }

  // Default 2D explainer path. Plain .mjs, no build step — loosely typed like a dynamic plugin.
  // @ts-expect-error — untyped .mjs tool module
  const gen: any = await import("@vsim/motion/tools/film-gen.mjs");
  console.log(`✎ writing the screenplay for "${args.prompt}" …`);
  const { doc, attempts } = await gen.generateFilmDoc(args.prompt, {});
  const dir = gen.writeFilm(doc, name);
  const secs = doc.beats[doc.beats.length - 1].end;
  console.log(`✓ FilmDoc "${doc.title}" — ${doc.beats.length} beats, ${secs}s (attempt ${attempts}) → ${dir}`);
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
      '  vsim film --prompt "<topic>" [--template explainer|3d] [-o out.mp4]   AI writes a screenplay → deterministic video (2D explainer, or a 3D film via --template 3d)\n' +
      '  vsim edit <scene.ts|scene.json> --prompt "..." [-o out.scene.json] [--render out.mp4]   (uses ANTHROPIC_API_KEY, or the claude CLI)',
  );
  process.exit(args.cmd ? 1 : 1);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
