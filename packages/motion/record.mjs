// Deterministic HTML→MP4 recorder: the piece that turns a web page into a film.
//
// Contract: the page exposes `window.__film = { fps, frames, seek(f) }` where seek is a pure
// function of the frame index (see src/timeline.mjs). We frame-step seek(f), screenshot each
// frame, and pipe PNGs to ffmpeg. Same DOM + same frame index ⇒ same pixels — so recordings
// are byte-reproducible and golden-frame testable, exactly like vsim's 3D renderer.
//
//   node packages/motion/record.mjs <page.html> <out.mp4> [--width 1280] [--height 720]
//        [--frames a..b] [--scale 1] [--dump-frames dir]
//
// Uses playwright-core + the preinstalled Chromium (PLAYWRIGHT_BROWSERS_PATH); no downloads.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

function chromePath() {
  if (process.env.VSIM_CHROMIUM && existsSync(process.env.VSIM_CHROMIUM)) return process.env.VSIM_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (existsSync(root)) {
    // Any installed chromium-* build works; prefer the newest.
    const dirs = readdirSync(root).filter((d) => d.startsWith("chromium-")).sort().reverse();
    for (const d of dirs) {
      const p = join(root, d, "chrome-linux", "chrome");
      if (existsSync(p)) return p;
    }
  }
  return undefined; // fall back to playwright-core's own resolution
}

/**
 * Frame-step a film page. `onStart(meta)` fires once (spawn your encoder here), then
 * `onFrame(png, f)` per frame in ascending order.
 * @param {string} pagePath
 * @param {{width?: number, height?: number, scale?: number, from?: number, to?: number}} opts
 * @param {{onStart?: (meta: {fps: number, frames: number, from: number, to: number}) => void | Promise<void>,
 *          onFrame: (png: Buffer, frame: number) => void | Promise<void>}} handlers
 */
export async function recordFrames(pagePath, opts, handlers) {
  const { width = 1280, height = 720, scale = 1 } = opts ?? {};
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ["--allow-file-access-from-files", "--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"],
  });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.goto(pathToFileURL(resolve(pagePath)).href);
    await page.waitForFunction(() => /** @type {any} */ (window).__film !== undefined, undefined, { timeout: 10000 });
    const film = await page.evaluate(() => {
      const f = /** @type {any} */ (window).__film;
      return { fps: f.fps, frames: f.frames };
    });
    const from = Math.max(0, opts?.from ?? 0);
    const to = Math.min(film.frames, opts?.to ?? film.frames);
    const meta = { fps: film.fps, frames: film.frames, from, to };
    await handlers.onStart?.(meta);
    for (let f = from; f <= to; f++) {
      await page.evaluate((n) => /** @type {any} */ (window).__film.seek(n), f);
      const png = await page.screenshot({ type: "png", animations: "disabled" });
      await handlers.onFrame(png, f);
    }
    return meta;
  } finally {
    await browser.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const pos = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1] ?? "").startsWith("--"));
  const flag = (/** @type {string} */ name, /** @type {string | undefined} */ fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const [pageArg, outArg] = pos;
  const dump = flag("dump-frames", undefined);
  if (!pageArg || (!outArg && !dump)) {
    console.log("Usage: node packages/motion/record.mjs <page.html> <out.mp4> [--width 1280] [--height 720] [--frames a..b] [--scale 1] [--dump-frames dir]");
    process.exit(1);
  }
  const width = Number(flag("width", "1280"));
  const height = Number(flag("height", "720"));
  const scale = Number(flag("scale", "1"));
  const range = flag("frames", undefined);
  const [from, to] = range ? range.split("..").map(Number) : [undefined, undefined];

  if (dump) await mkdir(resolve(dump), { recursive: true });
  if (outArg) await mkdir(dirname(resolve(outArg)), { recursive: true });

  /** @type {import("node:child_process").ChildProcessByStdio<import("node:stream").Writable, null, null> | undefined} */
  let ffmpeg;
  let count = 0;
  const t0 = Date.now();

  const meta = await recordFrames(pageArg, { width, height, scale, from, to }, {
    onStart: (m) => {
      if (!outArg) return;
      ffmpeg = spawn("ffmpeg", [
        "-y", "-f", "image2pipe", "-framerate", String(m.fps), "-i", "-",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        resolve(outArg),
      ], { stdio: ["pipe", "ignore", "inherit"] });
    },
    onFrame: async (png, f) => {
      if (dump) await writeFile(join(resolve(dump), `f_${String(f).padStart(5, "0")}.png`), png);
      if (ffmpeg) await new Promise((res, rej) => ffmpeg.stdin.write(png, (e) => (e ? rej(e) : res(undefined))));
      process.stderr.write(`\r  recording frame ${f} (${++count})`);
    },
  });
  process.stderr.write("\n");

  if (ffmpeg) {
    ffmpeg.stdin.end();
    const code = await new Promise((r) => ffmpeg.on("exit", r));
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✓ ${meta.to - meta.from + 1} frames @ ${width}x${height}, ${meta.fps} fps → ${outArg}  (${secs}s)`);
  } else {
    console.log(`✓ ${meta.to - meta.from + 1} frames → ${dump}`);
  }
}

// Only run the CLI when invoked directly (tests import recordFrames instead).
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
