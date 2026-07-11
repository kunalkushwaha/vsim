#!/usr/bin/env node
import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
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
  anim?: boolean;
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
    else if (t === "--anim") a.anim = true;
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


/**
 * AI character designer: prompt → CreatureDoc (validated species table) → make-animal.py
 * compiles a rigged GLB → a TURNTABLE review (the designer sees its own creature from three
 * angles and may revise) → registration: library GLB + manifest entry + the generated
 * EXTRA_CHARACTERS cast table. The committed creatures/<id>.creature.json regenerates the
 * same GLB forever — the cast is self-expanding, but every step stays validated.
 */
async function runCreature(args: Args): Promise<void> {
  if (!args.prompt) {
    console.log('Usage: vsim creature --prompt "<species description>" [--review N]');
    process.exit(1);
  }
  const { generateCreature, reviewCreature, creatureGeometry } = await import("@vsim/film3d");
  const { scene } = await import("@vsim/authoring");
  const { loadGltfRig } = await import("@vsim/assets");
  const { spawn } = await import("node:child_process");

  console.log(`✎ designing a creature for "${args.prompt}" …`);
  let { doc, attempts } = await generateCreature(args.prompt, {});
  console.log(`✓ CreatureDoc "${doc.name}" (${doc.id}) — attempt ${attempts}`);

  const dir = resolve("out", "creature", doc.id);
  await mkdir(dir, { recursive: true });
  const glb = join(dir, `${doc.id}.glb`);
  const compile = async () => {
    const geo = join(dir, "geometry.json");
    await writeFile(geo, JSON.stringify(creatureGeometry(doc)));
    await new Promise<void>((res, rej) => {
      const p = spawn("python3", [resolve("scripts/blender/make-animal.py"), "--", geo, glb], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (c) => (c === 0 ? res() : rej(new Error(`make-animal failed: ${err.slice(-400)}`))));
    });
  };
  const turntable = async (round: number) => {
    const rig = await loadGltfRig(glb, 30);
    const stills = [];
    for (const angle of [30, 150, 270]) {
      const a = (angle * Math.PI) / 180, d = 3.4;
      const sdoc = scene({ fps: 30, duration: 30, width: 640, height: 360, background: [0.07, 0.075, 0.09] })
        .sky([0.09, 0.1, 0.13], [0.05, 0.055, 0.07])
        .material("floor", { color: [0.16, 0.165, 0.19], roughness: 0.9 })
        .material("tint", { color: doc.tint, roughness: 0.6 })
        .light({ type: "hemisphere", intensity: 0.5, skyColor: [0.5, 0.52, 0.6], groundColor: [0.12, 0.12, 0.14] })
        .light({ type: "directional", intensity: 1.1, color: [1, 0.98, 0.94], direction: [-0.5, -0.8, -0.4] })
        .mesh("ground", { geometry: { kind: "plane", size: [20, 20] }, material: "floor" })
        .character("c", rig, { clip: "walk", loop: true, material: doc.parts.some((p: { color?: unknown }) => p.color) ? undefined : "tint", scale: [doc.scale, doc.scale, doc.scale] })
        .camera({ position: [Math.sin(a) * d, doc.eye * 0.9 + 0.4, Math.cos(a) * d], lookAt: [0, doc.eye * 0.6, 0], fov: 40 })
        .build();
      const path = join(dir, `round-${round}-a${angle}.png`);
      await renderStill(sdoc, 8, path, {});
      stills.push({ label: `turntable ${angle}° (mid-walk)`, path });
    }
    return stills;
  };

  const rounds = args.review ?? 1;
  for (let round = 1; round <= rounds; round++) {
    await compile();
    const stills = await turntable(round);
    console.log(`✎ reviewing the turntable (round ${round}) …`);
    const review = await reviewCreature(doc, stills, {});
    if (!review.revised) { console.log("✓ the designer kept the creature"); break; }
    doc = review.doc;
    console.log(`✓ revised after review → "${doc.name}"`);
    if (round === rounds) await compile();
  }

  // Register: committed doc + library GLB + manifest + the generated cast table.
  await mkdir(resolve("creatures"), { recursive: true });
  await writeFile(resolve("creatures", `${doc.id}.creature.json`), JSON.stringify(doc, null, 2));
  await copyFile(glb, resolve("packages/assets/library", `${doc.id}.glb`));
  const manPath = resolve("packages/assets/library/manifest.json");
  const man = JSON.parse(await readFile(manPath, "utf8"));
  man.characters = man.characters.filter((c: { id: string }) => c.id !== doc.id);
  man.characters.push({
    id: doc.id, name: `${doc.name} (AI-designed)`, file: `${doc.id}.glb`,
    description: `${doc.description} AI-authored CreatureDoc (creatures/${doc.id}.creature.json) compiled by scripts/blender/make-animal.py — vsim's own MIT asset.`,
    defaultClip: "idle", clips: ["walk", "run", "idle"], scale: 1, rotation: [0, 0, 0], faces: "-z",
    credit: "AI-designed via `vsim creature`; generated by make-animal.py — vsim's own asset (MIT).",
  });
  await writeFile(manPath, JSON.stringify(man, null, 2) + "\n");
  const extraPath = resolve("packages/film3d/src/characters.extra.ts");
  let extra = await readFile(extraPath, "utf8");
  if (!extra.includes(`  ${doc.id}: {`)) {
    // Palette-colored creatures carry their colors in the glb texture — a cast tint would
    // flatten them (the fox keeps its tint ON PURPOSE: its sample texture reads gray).
    const tintLine = doc.parts.some((p: { color?: unknown }) => p.color) ? "" : `\n    tint: [${doc.tint.join(", ")}] as const,`;
    const entry = `  ${doc.id}: {\n    clips: ["walk", "run", "idle"],\n    idle: { clip: "idle" },\n    walk: { clip: "walk" },\n    run: { clip: "run" },\n    faces: [0, -1] as const,\n    scale: ${doc.scale},\n    runAt: ${doc.runAt},\n    eye: ${doc.eye},${tintLine}\n  },\n`;
    extra = extra.replace("} as const;", entry + "} as const;");
    await writeFile(extraPath, extra);
  }
  console.log(`✓ registered: library/${doc.id}.glb + manifest + cast table ("${doc.id}" is now castable)`);
}


/**
 * AI surface designer: prompt → SurfaceDoc (self-contained HTML artifact, strictly linted)
 * → deterministic bake → the designer reviews its own PNG → registration via the bake
 * script (art.png + manifest + the generated film3d art tables). The committed source.html
 * regenerates the committed art.png forever; films consume only the PNG bytes.
 */
async function runSurface(args: Args): Promise<void> {
  if (!args.prompt) {
    console.log('Usage: vsim surface --prompt "<artwork description>" [--anim]');
    process.exit(1);
  }
  const { generateSurface, reviewSurface } = await import("@vsim/film3d");
  // @ts-expect-error — untyped .mjs tool module (the same pinned Chromium as the 2D recorder)
  const { captureStill, recordFrames } = await import("@vsim/motion/record.mjs");
  const { spawn } = await import("node:child_process");

  console.log(`✎ designing ${args.anim ? "an ANIMATED" : "a"} surface for "${args.prompt}" …`);
  let { doc, attempts } = await generateSurface(args.prompt, { anim: args.anim });
  console.log(`✓ SurfaceDoc "${doc.name}" ${doc.size[0]}x${doc.size[1]}${doc.anim ? ` — ${doc.anim.frames} frames @ ${doc.anim.fps} fps` : ""} — attempt ${attempts}`);

  // Never clobber an existing surface (the model could pick a curated name like
  // "trail-sign"): take the first free -2/-3… suffix instead.
  const { listSurfaces } = await import("@vsim/assets");
  const taken = new Set((await listSurfaces()).map((s) => s.name));
  let name = doc.name;
  for (let n = 2; taken.has(name); n++) name = `${doc.name}-${n}`;
  if (name !== doc.name) console.log(`✎ "${doc.name}" exists — registering as "${name}"`);
  doc = { ...doc, name };
  const dir = resolve("packages/assets/surfaces", name);
  await mkdir(dir, { recursive: true });
  const bake = async (): Promise<string[]> => {
    await writeFile(join(dir, "source.html"), doc.html);
    await writeFile(join(dir, "surface.json"), JSON.stringify({
      name: doc.name, size: doc.size,
      ...(doc.anim ? { type: "anim", fps: doc.anim.fps, frames: doc.anim.frames } : {}),
      license: "generated (vsim, MIT)", prompt: args.prompt,
    }, null, 2) + "\n");
    if (!doc.anim) {
      const png: Buffer = await captureStill(join(dir, "source.html"), { width: doc.size[0], height: doc.size[1] });
      await writeFile(join(dir, "art.png"), png);
      return [join(dir, "art.png")];
    }
    // Animated: bake the whole loop; the page's own __film contract must agree with the doc.
    // Clear stale frames first — a revision with fewer frames must not leave orphans behind.
    await rm(join(dir, "frames"), { recursive: true, force: true });
    await mkdir(join(dir, "frames"), { recursive: true });
    let count = 0;
    const meta = await recordFrames(join(dir, "source.html"), { width: doc.size[0], height: doc.size[1], from: 0, to: doc.anim.frames - 1 }, {
      onFrame: async (png: Buffer, f: number) => {
        await writeFile(join(dir, "frames", `f_${String(f).padStart(3, "0")}.png`), png);
        if (f === 0) await writeFile(join(dir, "art.png"), png);
        count++;
      },
    });
    // meta.frames must match too: a page declaring MORE frames than anim would otherwise
    // bake a silent slice of the loop (count alone can't catch it — the recorder clamps).
    if (count !== doc.anim.frames || meta.fps !== doc.anim.fps || meta.frames !== doc.anim.frames) {
      throw new Error(`the page's window.__film (${meta.fps} fps, ${meta.frames} frames, baked ${count}) disagrees with anim (${doc.anim.fps} fps, ${doc.anim.frames} frames)`);
    }
    // The designer reviews three spaced frames of its own loop.
    const picks = [0, Math.floor(doc.anim.frames / 3), Math.floor((2 * doc.anim.frames) / 3)];
    return picks.map((f) => join(dir, "frames", `f_${String(f).padStart(3, "0")}.png`));
  };
  const proofs = await bake();
  console.log("✎ reviewing the proof …");
  const review = await reviewSurface(doc, proofs.length === 1 ? proofs[0]! : proofs, {});
  if (review.revised && !!review.doc.anim !== !!doc.anim) {
    // A revision may change the ART, not the MODE: --anim must ship an animated asset.
    console.log("✎ the revision changed animated↔static — keeping the original proof");
  } else if (review.revised) {
    // A revision may change the ART, not the identity: files already live under `name`,
    // and the manifest/codegen key off it — a renamed revision would break registration.
    doc = { ...review.doc, name };
    await bake();
    console.log(`✓ revised after review → "${doc.name}"`);
  } else {
    console.log("✓ the designer kept the proof");
  }
  // Registration: the bake script owns the manifest + generated art tables.
  await new Promise<void>((res, rej) => {
    const p = spawn("node", [resolve("scripts/bake-surfaces.mjs")], { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`bake-surfaces failed: ${err.slice(-300)}`))));
  });
  console.log(`✓ registered: surfaces/${doc.name} — stageable as { "kind": "${doc.anim ? "screen" : "sign"}", "art": "${doc.name}" }`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === "edit") return runEdit(args);
  if (args.cmd === "film") return runFilm(args);
  if (args.cmd === "creature") return runCreature(args);
  if (args.cmd === "surface") return runSurface(args);
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
