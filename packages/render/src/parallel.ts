import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { parseDocument, type SceneDocument } from "@vsim/core";

/**
 * Parallel frame rendering (R5.3): N workers each own a full SoftwareEngine + SceneRuntime
 * restricted to a row band (`region`), receive the document ONCE at startup and a frame index
 * per frame, and post back their band's RGBA rows as transferables. Band stitching is proven
 * byte-identical to a single-engine render (engine-software/src/tiling.test.ts), so output is
 * exactly the sequential result — just wall-clock faster on multi-core machines.
 *
 * Physics scenes are rejected: each worker would need its own physics instance and Rapier's
 * WASM state can't be split by rows. Use the sequential path for physics.
 */
export class ParallelRenderer {
  private workers: Worker[] = [];
  private bands: { y0: number; y1: number }[] = [];
  private width = 0;
  private height = 0;

  /** Spawn workers, send each the document + its band. Resolves when all engines are ready. */
  async init(input: unknown, workerCount: number, opts: { fontPath?: string } = {}): Promise<void> {
    const doc: SceneDocument = (input as SceneDocument)?.version ? (input as SceneDocument) : parseDocument(input);
    if (doc.physics?.bodies?.length) {
      throw new Error("ParallelRenderer: physics scenes must use the sequential renderer");
    }
    this.width = doc.meta.width;
    this.height = doc.meta.height;
    const n = Math.max(1, Math.min(workerCount, doc.meta.height));
    const step = Math.ceil(doc.meta.height / n);
    const workerUrl = new URL("./parallel-worker.mjs", import.meta.url);
    for (let b = 0; b < n; b++) {
      const y0 = b * step;
      const y1 = Math.min(doc.meta.height, y0 + step);
      if (y0 >= y1) break;
      this.bands.push({ y0, y1 });
      this.workers.push(
        new Worker(fileURLToPath(workerUrl), {
          workerData: { doc, y0, y1, width: doc.meta.width, height: doc.meta.height, fontPath: opts.fontPath },
        }),
      );
    }
  }

  /** Render one frame across all workers and return the stitched full-frame RGBA. */
  renderFrame(frame: number): Promise<Uint8ClampedArray> {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    return Promise.all(
      this.workers.map(
        (w) =>
          new Promise<void>((resolve, reject) => {
            const onMessage = (msg: { frame: number; y0: number; band: Uint8ClampedArray }) => {
              w.off("message", onMessage);
              w.off("error", onError);
              out.set(new Uint8ClampedArray(msg.band.buffer ?? msg.band), msg.y0 * this.width * 4);
              resolve();
            };
            const onError = (e: Error) => {
              w.off("message", onMessage);
              reject(e);
            };
            w.once("error", onError);
            w.on("message", onMessage);
            w.postMessage(frame);
          }),
      ),
    ).then(() => out);
  }

  async dispose(): Promise<void> {
    for (const w of this.workers) w.postMessage(null);
    await Promise.all(this.workers.map((w) => new Promise((r) => w.once("exit", r))));
    this.workers = [];
  }
}
