import { describe, it, expect } from "vitest";

/**
 * The experimental GPU backends can't render headless — but their guards must fail FAST and
 * CLEARLY in non-browser environments, and the modules must at least load (catching syntax/
 * export breakage without a GPU).
 */
describe("experimental GPU backends (guards)", () => {
  it("PathTracerEngine refuses to construct without a browser context", async () => {
    const { PathTracerEngine } = await import("./pathtracer.js");
    expect(() => new PathTracerEngine(64, 64)).toThrow(/browser WebGL2/);
  });

  it("createWebGpuEngine refuses where navigator.gpu is missing", async () => {
    const { createWebGpuEngine } = await import("./webgpu.js");
    await expect(createWebGpuEngine(64, 64)).rejects.toThrow(/WebGPU .*not available/);
  });
});
