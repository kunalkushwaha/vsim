import type * as THREE from "three";
import { ThreeEngine, type ThreeEngineOptions } from "./index.js";

/**
 * EXPERIMENTAL (R5.4): construct a ThreeEngine backed by three's WebGPURenderer instead of
 * WebGL. Browser-only (requires navigator.gpu); await this factory — WebGPU initialization is
 * asynchronous. The returned engine drives the live preview; `readPixels()` is NOT supported on
 * this backend (WebGPU readback is async), so offline export keeps using SoftwareEngine.
 * Verify visually via `pnpm studio`.
 */
export async function createWebGpuEngine(
  width: number,
  height: number,
  opts: Omit<ThreeEngineOptions, "renderer"> = {},
): Promise<ThreeEngine> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    throw new Error("createWebGpuEngine: WebGPU (navigator.gpu) is not available — use the default WebGL ThreeEngine.");
  }
  const { WebGPURenderer } = await import("three/webgpu");
  const renderer = new WebGPURenderer({ canvas: opts.canvas as HTMLCanvasElement, antialias: true });
  await renderer.init();
  renderer.setSize(width, height, false);
  // The renderer surfaces ThreeEngine touches (render/setSize/shadowMap/toneMapping/colorspace)
  // are API-compatible across three's WebGL and WebGPU backends.
  const engine = new ThreeEngine(width, height, { ...opts, renderer: renderer as unknown as THREE.WebGLRenderer });
  const unsupported = () => {
    throw new Error("readPixels() is not supported on the WebGPU backend (async readback) — preview-only.");
  };
  engine.readPixels = unsupported;
  return engine;
}
