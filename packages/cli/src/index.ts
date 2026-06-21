#!/usr/bin/env -S npx tsx
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDocument, type PhysicsAdapter, type SceneDocument } from "@vsim/core";
import { renderToVideo, renderStill } from "@vsim/render";

interface Args {
  cmd: string;
  file?: string;
  output: string;
  still?: string;
  frame: number;
  audio?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: argv[0] ?? "", output: "out/out.mp4", frame: 0 };
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t === "-o" || t === "--output") a.output = argv[++i]!;
    else if (t === "--still") a.still = argv[++i]!;
    else if (t === "--frame") a.frame = Number(argv[++i]);
    else if (t === "--audio") a.audio = argv[++i]!;
    else if (!t!.startsWith("-")) a.file = t;
  }
  return a;
}

/** Load a scene document from a .ts/.js module (default/`scene`/`document` export) or .json. */
async function loadScene(file: string): Promise<{ doc: SceneDocument; audio?: string }> {
  const abs = resolve(file);
  if (extname(abs) === ".json") {
    return { doc: parseDocument(JSON.parse(await readFile(abs, "utf8"))) };
  }
  const mod = await import(pathToFileURL(abs).href);
  const exported = mod.default ?? mod.scene ?? mod.document;
  if (!exported) throw new Error(`${file} must export a scene (default export, or \`scene\`/\`document\`).`);
  const doc: SceneDocument = exported.version ? exported : parseDocument(exported);
  return { doc, audio: mod.audioPath };
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd !== "render" || !args.file) {
    console.log("Usage: vsim render <scene.ts|scene.json> [-o out.mp4] [--still frame.png --frame N] [--audio file]");
    process.exit(args.file ? 0 : 1);
  }

  const { doc, audio } = await loadScene(args.file);
  const audioPath = args.audio ?? audio;

  if (args.still) {
    await renderStill(doc, args.frame, args.still);
    console.log(`✓ still frame ${args.frame} → ${args.still}`);
    return;
  }

  const physics = await maybePhysics(doc);
  const t0 = Date.now();
  const res = await renderToVideo(doc, {
    output: args.output,
    physics,
    audioPath,
    audioGain: doc.audio?.gain,
    onProgress: progressBar,
  });
  physics?.dispose();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✓ ${res.frames} frames @ ${res.width}x${res.height} → ${res.output}  (${secs}s)`);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
