// Build a static docs site from the existing markdown — landing page (T-046) + docs site (T-042).
// Zero framework: `marked` renders the markdown we already keep in docs/, wrapped in a shared
// shell. Output lands in site/ (gitignored); deploy by serving that folder.
//   node scripts/build-docs-site.mjs   (or: pnpm docs:site)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "site");

marked.setOptions({ gfm: true });

/** Docs pages, in sidebar order. `home` is generated; the rest render a markdown file. */
const PAGES = [
  { slug: "index", title: "Home", nav: "Home", home: true },
  { slug: "quickstart", title: "Quickstart", nav: "Quickstart", src: "docs/quickstart.md" },
  { slug: "scene-document", title: "Scene Document", nav: "Scene Document", src: "docs/scene-document.md" },
  { slug: "determinism", title: "Determinism", nav: "Determinism", src: "docs/determinism.md" },
  {
    slug: "adr-0001",
    title: "Decision: Render Backend & Determinism",
    nav: "ADR: Render Backend",
    src: "docs/decisions/0001-render-backend-and-determinism.md",
  },
];

const GITHUB = "https://github.com/kunalkushwaha/vsim";

const STYLE = `
:root { --bg:#0a0d14; --panel:#0f131c; --line:#1d2330; --fg:#e6e9f0; --muted:#9aa4b8; --accent:#e9694a; --accent2:#5cc0f0; }
* { box-sizing:border-box; }
html,body { margin:0; padding:0; }
body { background:var(--bg); color:var(--fg); font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
a { color:var(--accent2); text-decoration:none; }
a:hover { text-decoration:underline; }
code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:0.88em; background:#161b27; padding:0.12em 0.38em; border-radius:4px; }
pre { background:#0c1019; border:1px solid var(--line); border-radius:10px; padding:16px; overflow:auto; }
pre code { background:none; padding:0; }
table { border-collapse:collapse; width:100%; margin:1em 0; }
th,td { border:1px solid var(--line); padding:8px 12px; text-align:left; }
th { background:#141a26; }
blockquote { border-left:3px solid var(--accent); margin:1em 0; padding:0.2em 1em; color:var(--muted); }
hr { border:none; border-top:1px solid var(--line); margin:2em 0; }
.topbar { display:flex; align-items:center; justify-content:space-between; padding:14px 24px; border-bottom:1px solid var(--line); position:sticky; top:0; background:rgba(10,13,20,0.9); backdrop-filter:blur(6px); z-index:10; }
.brand { font-weight:700; font-size:18px; letter-spacing:0.3px; }
.brand span { color:var(--accent); }
.layout { display:grid; grid-template-columns:240px 1fr; max-width:1180px; margin:0 auto; }
.sidebar { border-right:1px solid var(--line); padding:24px 16px; }
.sidebar a { display:block; color:var(--muted); padding:7px 10px; border-radius:7px; font-size:14px; }
.sidebar a:hover { background:var(--panel); text-decoration:none; }
.sidebar a.active { color:var(--fg); background:var(--panel); border-left:2px solid var(--accent); }
.content { padding:32px 40px; min-width:0; }
.content h1 { font-size:30px; } .content h2 { margin-top:1.8em; border-bottom:1px solid var(--line); padding-bottom:0.3em; }
.hero { padding:64px 40px 40px; max-width:920px; margin:0 auto; }
.hero h1 { font-size:46px; line-height:1.1; margin:0 0 8px; }
.hero .accent { color:var(--accent); }
.hero .tag { color:var(--muted); font-size:19px; max-width:680px; }
.cta { margin:28px 0; display:flex; gap:12px; flex-wrap:wrap; }
.btn { display:inline-block; padding:11px 20px; border-radius:9px; font-weight:600; }
.btn.primary { background:var(--accent); color:#1a0e0a; }
.btn.ghost { border:1px solid var(--line); color:var(--fg); }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin:28px 0; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; }
.card h3 { margin:0 0 6px; font-size:16px; }
.card p { margin:0; color:var(--muted); font-size:14px; }
.foot { color:var(--muted); font-size:13px; padding:32px 40px; border-top:1px solid var(--line); text-align:center; }
@media (max-width:760px){ .layout{ grid-template-columns:1fr; } .sidebar{ border-right:none; border-bottom:1px solid var(--line); } }
`;

function shell(page, bodyHtml) {
  const nav = PAGES.map(
    (p) => `<a href="${p.slug}.html"${p.slug === page.slug ? ' class="active"' : ""}>${p.nav}</a>`,
  ).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title} — vsim</title>
<meta name="description" content="vsim — Remotion for real 3D. Deterministic code → 3D video.">
<style>${STYLE}</style>
</head>
<body>
<div class="topbar">
  <div class="brand">v<span>sim</span></div>
  <nav><a href="quickstart.html">Docs</a> &nbsp; <a href="${GITHUB}">GitHub</a></nav>
</div>
<div class="layout">
  <aside class="sidebar">${nav}</aside>
  <main class="content">${bodyHtml}</main>
</div>
<div class="foot">Built by vsim itself · <a href="${GITHUB}">github.com/kunalkushwaha/vsim</a> · MIT</div>
</body>
</html>`;
}

const INSTALL = `npm i -D @vsim/cli @vsim/authoring
npx vsim render scene.ts -o out.mp4`;

const FEATURES = [
  ["Code → video", "Declarative TS scene builder → MP4 via <code>vsim render</code>."],
  ["Deterministic", "Frame-based time + seeded RNG. Two renders are byte-identical, enforced in CI."],
  ["Physics", "Deterministic Rapier rigid bodies, fixed-step, reproducible."],
  ["Assets & audio", "glTF/GLB load + export; mux audio and drive motion from beat frames."],
  ["Live preview", "A browser player that shares the exact runtime with the renderer."],
  ["No GPU required", "The default renderer is a pure-TypeScript rasterizer that runs anywhere."],
];

function landing() {
  const cards = FEATURES.map(([t, d]) => `<div class="card"><h3>${t}</h3><p>${d}</p></div>`).join("\n");
  return `<section class="hero">
  <h1>Remotion for <span class="accent">real&nbsp;3D</span>.</h1>
  <p class="tag">Write a 3D scene in TypeScript — meshes, physics, glTF models, beat-synced audio —
  run one command, and get a <strong>deterministic</strong> MP4. The same scene also plays live in
  the browser. Preview == final render == N personalized variants, because the runtime is
  byte-for-byte reproducible.</p>
  <div class="cta">
    <a class="btn primary" href="quickstart.html">Get started</a>
    <a class="btn ghost" href="${GITHUB}">View on GitHub</a>
  </div>
  <pre><code>${INSTALL}</code></pre>
  <div class="grid">${cards}</div>
  <p class="tag" style="font-size:15px">No build step here — this whole site (and the showreel) is generated by the framework's own tooling.</p>
</section>`;
}

function build() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const page of PAGES) {
    const body = page.home ? landing() : marked.parse(readFileSync(join(root, page.src), "utf8"));
    const file = join(outDir, `${page.slug}.html`);
    writeFileSync(file, shell(page, body));
    written.push(file);
  }
  return written;
}

// Build + self-check (this script's own test): every page exists and carries expected content.
const written = build();
const index = readFileSync(join(outDir, "index.html"), "utf8");
const quickstart = readFileSync(join(outDir, "quickstart.html"), "utf8");
const checks = [
  [written.length === PAGES.length, `expected ${PAGES.length} pages, wrote ${written.length}`],
  [index.includes("Remotion for"), "landing page missing the pitch headline"],
  [index.includes("vsim render"), "landing page missing the install command"],
  [/<h[12]/.test(quickstart) && quickstart.includes("<pre>"), "quickstart did not render markdown (headings/code)"],
];
const failed = checks.filter(([ok]) => !ok).map(([, msg]) => msg);
if (failed.length) {
  console.error("✗ docs site self-check failed:\n  - " + failed.join("\n  - "));
  process.exit(1);
}
console.log(`✓ docs site built → site/ (${written.length} pages)`);
