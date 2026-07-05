import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  SceneRuntime, parseDocument,
  type Engine, type PhysicsAdapter, type SceneDocument,
} from "@vsim/core";
import { SoftwareEngine } from "@vsim/engine-software";
import { loadGltf } from "@vsim/assets";
import { encodePNG } from "./png.js";
import { ParallelRenderer } from "./parallel.js";

export { encodePNG } from "./png.js";

/** Load any glTF assets referenced by gltf-geometry nodes and inject them into the engine. */
async function loadAssets(doc: SceneDocument, engine: Engine): Promise<void> {
  if (!engine.loadMesh) return;
  const assets = new Map(doc.assets.map((a) => [a.id, a]));
  for (const node of doc.nodes) {
    if (node.mesh?.geometry.kind !== "gltf") continue;
    const asset = assets.get(node.mesh.geometry.assetId);
    if (!asset) throw new Error(`Missing asset '${node.mesh.geometry.assetId}' for node '${node.id}'`);
    engine.loadMesh(node.id, await loadGltf(asset.uri));
  }
}

export interface RenderOptions {
  output: string;
  /** Renderer to use. Defaults to the pure-TS SoftwareEngine. */
  engine?: Engine;
  /**
   * Render frames across N worker threads (band-split SoftwareEngines, byte-identical to
   * sequential). Ignored for physics scenes and when a custom `engine` is supplied.
   */
  workers?: number;
  physics?: PhysicsAdapter;
  /** Path to an audio file to mux in. */
  audioPath?: string;
  audioGain?: number;
  onProgress?: (frame: number, total: number) => void;
  ffmpegPath?: string;
  crf?: number;
}

export interface RenderResult {
  output: string;
  frames: number;
  width: number;
  height: number;
}

function prepare(input: unknown, opts: RenderOptions) {
  const doc: SceneDocument = (input as SceneDocument)?.version
    ? (input as SceneDocument)
    : parseDocument(input);
  const engine = opts.engine ?? new SoftwareEngine(doc.meta.width, doc.meta.height);
  const runtime = new SceneRuntime(doc, { physics: opts.physics });
  return { doc, engine, runtime };
}

/** Render a document to an MP4 by streaming raw RGBA frames into ffmpeg. */
export async function renderToVideo(input: unknown, opts: RenderOptions): Promise<RenderResult> {
  const { doc, engine, runtime } = prepare(input, opts);
  await runtime.init();
  await engine.init(doc);
  await loadAssets(doc, engine);
  await mkdir(dirname(opts.output), { recursive: true });

  const { width, height, fps, durationFrames } = doc.meta;
  const ffmpeg = opts.ffmpegPath ?? "ffmpeg";
  const audio = opts.audioPath;
  const gain = opts.audioGain ?? 1;

  const args = [
    "-y",
    "-f", "rawvideo", "-pixel_format", "rgba",
    "-video_size", `${width}x${height}`, "-framerate", String(fps),
    "-i", "pipe:0",
    ...(audio ? ["-i", audio] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-crf", String(opts.crf ?? 18), "-preset", "medium",
    ...(audio
      ? ["-c:a", "aac", "-b:a", "192k", ...(gain !== 1 ? ["-filter:a", `volume=${gain}`] : []), "-shortest"]
      : []),
    "-movflags", "+faststart",
    opts.output,
  ];

  const proc = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d.toString()));
  const done = new Promise<void>((resolve, reject) => {
    proc.on("error", (e) => reject(new Error(`Failed to start ffmpeg ("${ffmpeg}"): ${e.message}`)));
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-1500)}`)),
    );
  });

  // Parallel path: band-split worker engines (byte-identical to sequential; see parallel.ts).
  // Only for the default software engine and non-physics scenes.
  const useWorkers = (opts.workers ?? 1) > 1 && !opts.engine && !opts.physics && !doc.physics?.bodies?.length;
  if (useWorkers) {
    const par = new ParallelRenderer();
    await par.init(doc, opts.workers!);
    try {
      for (let f = 0; f < durationFrames; f++) {
        await writeChunk(proc.stdin!, Buffer.from(await par.renderFrame(f)));
        opts.onProgress?.(f + 1, durationFrames);
      }
    } finally {
      await par.dispose();
    }
  } else {
    for (let f = 0; f < durationFrames; f++) {
      engine.renderFrame(runtime.computeFrameState(f));
      await writeChunk(proc.stdin!, Buffer.from(engine.readPixels()));
      opts.onProgress?.(f + 1, durationFrames);
    }
  }
  proc.stdin!.end();
  await done;

  engine.dispose();
  return { output: opts.output, frames: durationFrames, width, height };
}

/** Render a single frame to a PNG (handy for debugging & golden image baselines). */
export async function renderStill(input: unknown, frame: number, output: string, opts: Partial<RenderOptions> = {}): Promise<void> {
  const { doc, engine, runtime } = prepare(input, opts as RenderOptions);
  await runtime.init();
  await engine.init(doc);
  await loadAssets(doc, engine);
  await mkdir(dirname(output), { recursive: true });
  // forward-step to the requested frame
  for (let f = 0; f <= frame; f++) engine.renderFrame(runtime.computeFrameState(f));
  await writeFile(output, encodePNG(doc.meta.width, doc.meta.height, engine.readPixels()));
  engine.dispose();
}

function writeChunk(stream: NodeJS.WritableStream, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(buf, (err) => (err ? reject(err) : undefined));
    // resolve on drain to respect backpressure
    if ((stream as any).writableNeedDrain) stream.once("drain", resolve);
    else resolve();
  });
}

export { ParallelRenderer };
