import { SceneRuntime, type Engine, type FrameState, type PhysicsAdapter, type SceneDocument } from "@vsim/core";
import { ThreeEngine } from "@vsim/engine-three";

export interface PlayerOptions {
  /** Canvas for the default ThreeEngine. Optional if you inject your own `engine`. */
  canvas?: HTMLCanvasElement;
  /**
   * Renderer to drive. Defaults to a ThreeEngine bound to `canvas`. Inject another Engine to
   * preview with a different backend — or to drive the player headlessly (e.g. the parity test
   * runs it with the SoftwareEngine to prove scrubbing matches the offline render frame-for-frame).
   */
  engine?: Engine;
  /** Optional physics backend (e.g. a browser RapierPhysics). */
  physics?: PhysicsAdapter;
  autoplay?: boolean;
  loop?: boolean;
}

/**
 * Real-time browser preview. Drives the SAME SceneRuntime + Engine the headless renderer
 * uses, so what you scrub here is what you export. Forward stepping is deterministic;
 * seeking backwards replays from the start (required for reproducible physics).
 */
export class Player {
  readonly engine: Engine;
  readonly runtime: SceneRuntime;
  private doc: SceneDocument;
  private frame = 0;
  private rendered = false;
  private playing = false;
  private raf = 0;
  private lastTime = 0;
  private acc = 0;
  private last?: FrameState;

  /** Called whenever a frame is presented. */
  onFrame?: (frame: number, total: number) => void;

  constructor(doc: SceneDocument, private opts: PlayerOptions) {
    this.doc = doc;
    this.engine = opts.engine ?? new ThreeEngine(doc.meta.width, doc.meta.height, { canvas: opts.canvas });
    this.runtime = new SceneRuntime(doc, { physics: opts.physics });
  }

  get totalFrames(): number {
    return this.doc.meta.durationFrames;
  }
  get currentFrame(): number {
    return this.frame;
  }
  get isPlaying(): boolean {
    return this.playing;
  }

  async init(): Promise<void> {
    await this.runtime.init();
    await this.engine.init(this.doc);
    this.present(0);
    if (this.opts.autoplay) this.play();
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastTime = performance.now();
    this.acc = 0;
    const loop = (now: number) => {
      if (!this.playing) return;
      this.advance((now - this.lastTime) / 1000);
      this.lastTime = now;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause(): void {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  toggle(): void {
    this.playing ? this.pause() : this.play();
  }

  /** Seek to an absolute frame. Backwards seeks replay from 0 (deterministic). */
  async seek(frame: number): Promise<void> {
    const target = Math.max(0, Math.min(this.totalFrames - 1, Math.round(frame)));
    if (target < this.frame) {
      await this.runtime.reset();
      this.frame = 0;
      this.rendered = false;
      for (let f = 0; f < target; f++) this.runtime.computeFrameState(f);
    } else {
      for (let f = this.frame + 1; f < target; f++) this.runtime.computeFrameState(f);
    }
    this.present(target);
  }

  private advance(dtSeconds: number): void {
    const spf = 1 / this.doc.meta.fps;
    this.acc += dtSeconds;
    let f = this.frame;
    while (this.acc >= spf && f < this.totalFrames - 1) {
      f++;
      this.acc -= spf;
    }
    if (f !== this.frame || !this.rendered) this.present(f);
    if (f >= this.totalFrames - 1) {
      if (this.opts.loop) void this.seek(0);
      else this.pause();
    }
  }

  private present(frame: number): void {
    this.last = this.runtime.computeFrameState(frame);
    this.frame = frame;
    this.rendered = true;
    this.engine.renderFrame(this.last);
    this.onFrame?.(frame, this.totalFrames);
  }

  dispose(): void {
    this.pause();
    this.engine.dispose();
    this.opts.physics?.dispose();
  }
}

export function createPlayer(doc: SceneDocument, opts: PlayerOptions): Player {
  return new Player(doc, opts);
}
