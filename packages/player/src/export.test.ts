import { describe, it, expect } from "vitest";
import { SoftwareEngine } from "@vsim/engine-software";
import { renderToSink, webCodecsSink, type FrameSink } from "./export.js";

const DOC = {
  meta: { durationFrames: 5, width: 16, height: 16, background: [0.2, 0.1, 0.4] },
  materials: [{ id: "m", color: [0.9, 0.5, 0.2] }],
  nodes: [
    { id: "cube", mesh: { geometry: { kind: "box" }, materialId: "m" } },
    { id: "amb", light: { type: "ambient", intensity: 0.8 } },
    { id: "__camera", position: [0, 0, 4] },
  ],
  animation: [{ target: { nodeId: "cube", path: "rotation.y" }, keyframes: [{ frame: 0, value: 0 }, { frame: 4, value: 1 }] }],
  camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
};

function collectingSink() {
  const frames: Uint8ClampedArray[] = [];
  let finished = false;
  const sink: FrameSink = {
    addFrame: (rgba) => { frames.push(new Uint8ClampedArray(rgba)); },
    finish: () => { finished = true; },
  };
  return { sink, frames, done: () => finished };
}

describe("renderToSink (in-browser export loop, R5.2)", () => {
  it("delivers every frame as correctly-sized RGBA and finalizes the sink", async () => {
    const { sink, frames, done } = collectingSink();
    const progress: number[] = [];
    await renderToSink(DOC, sink, { engine: new SoftwareEngine(16, 16), onProgress: (f) => progress.push(f) });
    expect(frames.length).toBe(5);
    expect(done()).toBe(true);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    for (const f of frames) expect(f.length).toBe(16 * 16 * 4);
    // The cube rotates, so frames differ; the loop isn't resending one frame.
    expect(Buffer.from(frames[0]!).equals(Buffer.from(frames[4]!))).toBe(false);
  });

  it("is deterministic: two exports produce byte-identical frame streams", async () => {
    const a = collectingSink();
    const b = collectingSink();
    await renderToSink(DOC, a.sink, { engine: new SoftwareEngine(16, 16) });
    await renderToSink(DOC, b.sink, { engine: new SoftwareEngine(16, 16) });
    for (let i = 0; i < 5; i++) expect(Buffer.from(a.frames[i]!).equals(Buffer.from(b.frames[i]!))).toBe(true);
  });
});

describe("webCodecsSink", () => {
  it("fails fast with a clear message where WebCodecs is unavailable (Node)", () => {
    expect(() => webCodecsSink({ width: 16, height: 16, fps: 30, onChunk: () => {} }))
      .toThrow(/WebCodecs .*not available/);
  });
});
