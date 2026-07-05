// Render every example with vsim, then stitch them into a single showreel MP4.
// Every frame is produced by the framework itself; ffmpeg only concatenates.
//   node scripts/build-showreel.mjs   (or: pnpm showreel)
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";

const CLIPS = [
  { name: "cube", scene: "examples/01-cube/scene.ts" },
  { name: "physics", scene: "examples/02-physics/scene.ts" },
  { name: "character", scene: "examples/05-character/scene.ts" },
  { name: "soccer", scene: "examples/08-soccer/scene.ts" },
  { name: "puppy", scene: "examples/10-puppy/scene.ts" },
  { name: "person", scene: "examples/07-person/scene.ts" },
  { name: "makehuman", scene: "examples/12-makehuman/scene.ts" },
  { name: "clips", scene: "examples/13-clips/scene.ts" },
  { name: "cast", scene: "examples/14-cast/scene.ts" },
  { name: "clothing", scene: "examples/15-clothing/scene.ts" },
  { name: "vrm", scene: "examples/16-vrm/scene.ts" },
  { name: "lipsync", scene: "examples/17-lipsync/scene.ts" },
  { name: "park", scene: "examples/18-park/scene.ts" },
  { name: "dog", scene: "examples/19-dog/scene.ts" },
  { name: "manga", scene: "examples/09-manga/scene.ts" },
  { name: "fox", scene: "examples/06-fox/scene.ts" },
  { name: "gltf", scene: "examples/04-gltf/scene.ts" },
  { name: "beat", scene: "examples/03-beat-sync/scene.ts" },
  { name: "titles", scene: "examples/20-titles/scene.ts" },
  { name: "mouse", scene: "examples/21-mouse/scene.ts" },
  { name: "normalmap", scene: "examples/22-normalmap/scene.ts" },
  { name: "crossfade", scene: "examples/23-crossfade/scene.ts" },
  { name: "campfire", scene: "examples/24-campfire/scene.ts" },
  { name: "weather", scene: "examples/25-weather/scene.ts" },
];

mkdirSync("out", { recursive: true });

// Parallel band rendering (byte-identical to single-threaded); physics scenes fall back automatically.
const workers = String(process.env.VSIM_WORKERS ?? 4);

for (const { name, scene } of CLIPS) {
  console.log(`\n▶ rendering ${name} (${scene})`);
  execFileSync(
    "pnpm",
    ["exec", "tsx", "packages/cli/src/index.ts", "render", scene, "-o", `out/${name}.mp4`, "--workers", workers],
    { stdio: "inherit" },
  );
}

const inputs = CLIPS.flatMap(({ name }) => ["-i", `out/${name}.mp4`]);
const n = CLIPS.length;
// Clips may differ in resolution; normalize each to a common 16:9 canvas (letterboxed if needed)
// before concat — ffmpeg's concat filter requires identical dimensions.
const W = 1280, H = 720;
const scale = CLIPS.map(
  (_, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`,
).join(";");
const filter = `${scale};${CLIPS.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[v]`;

console.log(`\n▶ stitching ${n} clips → out/showreel.mp4`);
execFileSync(
  "ffmpeg",
  ["-y", ...inputs, "-filter_complex", filter, "-map", "[v]", "-pix_fmt", "yuv420p", "out/showreel.mp4"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

if (!existsSync("out/showreel.mp4")) throw new Error("showreel was not produced");
console.log("\n✓ out/showreel.mp4");
