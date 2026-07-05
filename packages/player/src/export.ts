import { SceneRuntime, parseDocument, type Engine, type SceneDocument } from "@vsim/core";

/**
 * In-browser export (R5.2): the render loop is identical to the server path — only the SINK
 * differs. `renderToSink` drives the deterministic runtime frame by frame and hands raw RGBA to
 * any FrameSink; `webCodecsSink` adapts the browser's VideoEncoder so those frames become
 * encoded chunks (feed them to a muxer like mp4-muxer/webm-muxer for a downloadable file).
 */
export interface FrameSink {
  /** Receive one frame of raw RGBA (width×height×4, row 0 = top). */
  addFrame(rgba: Uint8ClampedArray, frameIndex: number): void | Promise<void>;
  /** Flush and finalize. */
  finish(): void | Promise<void>;
}

export interface RenderToSinkOptions {
  /** The engine to draw with — SoftwareEngine (deterministic pixels) or ThreeEngine (GPU). */
  engine: Engine;
  onProgress?: (frame: number, total: number) => void;
}

/** Drive `doc` through `engine` frame by frame, delivering every frame to `sink`. */
export async function renderToSink(input: unknown, sink: FrameSink, opts: RenderToSinkOptions): Promise<void> {
  const doc: SceneDocument = (input as SceneDocument)?.version ? (input as SceneDocument) : parseDocument(input);
  const runtime = new SceneRuntime(doc);
  await runtime.init();
  await opts.engine.init(doc);
  const total = doc.meta.durationFrames;
  for (let f = 0; f < total; f++) {
    opts.engine.renderFrame(runtime.computeFrameState(f));
    await sink.addFrame(opts.engine.readPixels(), f);
    opts.onProgress?.(f + 1, total);
  }
  await sink.finish();
}

export interface WebCodecsSinkOptions {
  width: number;
  height: number;
  fps: number;
  /** WebCodecs codec string; default is baseline H.264 (broadly supported). */
  codec?: string;
  bitrate?: number;
  /** Receives every encoded chunk — append to an mp4/webm muxer. */
  onChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
  onError?: (e: unknown) => void;
}

/**
 * A FrameSink backed by the browser's VideoEncoder. Keyframe every 2 seconds; timestamps are
 * exact frame times in microseconds, so output timing is as deterministic as the pixels.
 * Throws immediately where WebCodecs is unavailable (non-browser or older browsers).
 */
export function webCodecsSink(opts: WebCodecsSinkOptions): FrameSink {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("webCodecsSink: WebCodecs (VideoEncoder) is not available in this environment");
  }
  const encoder = new VideoEncoder({
    output: opts.onChunk,
    error: (e) => (opts.onError ? opts.onError(e) : console.error("webCodecsSink:", e)),
  });
  encoder.configure({
    codec: opts.codec ?? "avc1.42001f",
    width: opts.width,
    height: opts.height,
    bitrate: opts.bitrate ?? 6_000_000,
    framerate: opts.fps,
  });
  const keyEvery = Math.max(1, Math.round(opts.fps * 2));
  return {
    addFrame(rgba, frameIndex) {
      const frame = new VideoFrame(new Uint8Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)), {
        format: "RGBA",
        codedWidth: opts.width,
        codedHeight: opts.height,
        timestamp: Math.round((frameIndex * 1_000_000) / opts.fps),
        duration: Math.round(1_000_000 / opts.fps),
      });
      encoder.encode(frame, { keyFrame: frameIndex % keyEvery === 0 });
      frame.close();
    },
    async finish() {
      await encoder.flush();
      encoder.close();
    },
  };
}
