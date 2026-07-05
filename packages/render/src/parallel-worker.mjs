// Worker entry for parallel band rendering (R5.3). Plain .mjs so Node can load it directly;
// it registers tsx to import the TypeScript sources in dev (published builds resolve dist).
import { parentPort, workerData } from "node:worker_threads";

const { register } = await import("tsx/esm/api");
register();

const { SceneRuntime, parseDocument } = await import("@vsim/core");
const { SoftwareEngine } = await import("@vsim/engine-software");

const { doc: rawDoc, y0, y1, width, height } = workerData;
const doc = parseDocument(rawDoc);
const engine = new SoftwareEngine(width, height, { region: { y0, y1 } });
const runtime = new SceneRuntime(doc);
await runtime.init();
await engine.init(doc);

// Protocol: main sends a frame index; we render our band and post the band's RGBA rows back
// (transferred, not copied). Frames must arrive in ascending order (the runtime is forward-only).
parentPort.on("message", (frame) => {
  if (frame === null) {
    parentPort.close();
    return;
  }
  engine.renderFrame(runtime.computeFrameState(frame));
  const px = engine.readPixels();
  const band = px.slice(y0 * width * 4, y1 * width * 4);
  parentPort.postMessage({ frame, y0, band }, [band.buffer]);
});
