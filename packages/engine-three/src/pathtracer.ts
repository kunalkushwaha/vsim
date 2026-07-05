import * as THREE from "three";
import type { Engine, FrameState, SceneDocument, MeshData } from "@vsim/core";
import { ThreeEngine } from "./index.js";

export interface PathTracerEngineOptions {
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  renderer?: THREE.WebGLRenderer;
  /** Path-tracing samples per frame. More = cleaner; 32–128 is a reasonable still range. */
  samples?: number;
}

/**
 * EXPERIMENTAL (R4.3): browser path tracing behind the standard Engine interface, powered by
 * three-gpu-pathtracer. Reuses ThreeEngine's scene-graph sync (the same FrameState → three
 * translation the preview uses), then progressively path-traces the synced scene each frame.
 *
 * Requires a real WebGL2 context — browser only. Verify visually via `pnpm studio`; in
 * headless/Node environments construction fails fast with a clear error. Not part of the
 * deterministic path (GPU sampling varies by hardware) — this is the zero-server photoreal
 * option, mirroring the Cycles tradeoff.
 */
export class PathTracerEngine implements Engine {
  readonly width: number;
  readonly height: number;
  private inner: ThreeEngine;
  private samples: number;
  private tracer?: { setScene(s: THREE.Scene, c: THREE.Camera): void; renderSample(): void };

  constructor(width: number, height: number, opts: PathTracerEngineOptions = {}) {
    if (!opts.renderer && typeof document === "undefined" && !opts.canvas) {
      throw new Error("PathTracerEngine needs a browser WebGL2 context (canvas or renderer) — use SoftwareEngine or the Cycles pipeline headless.");
    }
    this.width = width;
    this.height = height;
    this.inner = new ThreeEngine(width, height, opts);
    this.samples = opts.samples ?? 48;
  }

  async init(doc: SceneDocument): Promise<void> {
    this.inner.init(doc);
    const mod = await import("three-gpu-pathtracer");
    // The tracer sizes itself from the renderer's drawing buffer.
    this.tracer = new mod.WebGLPathTracer(this.inner.renderer);
  }

  loadMesh(nodeId: string, data: MeshData): void {
    this.inner.loadMesh(nodeId, data);
  }

  renderFrame(state: FrameState): void {
    // Sync the scene graph (transforms/skinning/lights/camera) through the shared translation…
    this.inner.renderFrame(state);
    if (!this.tracer) return;
    // …then path-trace what was synced. setScene resets accumulation for the new frame.
    this.tracer.setScene(this.inner.scene, this.inner.camera);
    for (let s = 0; s < this.samples; s++) this.tracer.renderSample();
  }

  readPixels(): Uint8ClampedArray {
    return this.inner.readPixels();
  }

  dispose(): void {
    this.inner.dispose();
  }
}
