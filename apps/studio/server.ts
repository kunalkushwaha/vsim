// vsim Studio backend — the first small server in the project (and the seed of the eventual cloud
// layer). Two endpoints the browser editor can't do itself: run the AI copilot (needs an API key or
// the `claude` CLI) and render the scene to MP4 (needs ffmpeg). No framework — Node's http only.
//
//   pnpm studio:server     # → http://localhost:8787  (Vite proxies /api to it)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocument } from "@vsim/core";
import { editScene } from "@vsim/ai";
import { renderToVideo } from "@vsim/render";

const PORT = 8787;

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
const json = (res: ServerResponse, code: number, obj: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

const server = createServer(async (req, res) => {
  try {
    // Natural-language edit → schema-constrained scene-document edits (Claude tool-use).
    if (req.method === "POST" && req.url === "/api/edit") {
      const { doc, prompt } = await readBody(req);
      if (!prompt) return json(res, 400, { error: "missing prompt" });
      const result = await editScene({ doc: parseDocument(doc), prompt }); // provider "auto" → claude CLI if no API key
      console.log(`edit "${prompt}" → ${result.operations.length} op(s) via ${result.provider}`);
      return json(res, 200, { doc: result.doc, summary: result.summary, operations: result.operations, provider: result.provider });
    }
    // Render → MP4. "draft" = the deterministic SoftwareEngine (same as `vsim render`); "photoreal"
    // = the Cycles backend (needs a Blender binary via VSIM_BLENDER).
    if (req.method === "POST" && req.url === "/api/render") {
      const { doc, photoreal } = await readBody(req);
      const dir = await mkdtemp(join(tmpdir(), "vsim-studio-"));
      const out = join(dir, "scene.mp4");
      if (photoreal) {
        const docPath = join(dir, "doc.json");
        await writeFile(docPath, JSON.stringify(doc));
        const { renderCycles } = await import("./cycles-render.mjs");
        await renderCycles(docPath, { output: out, samples: Number(process.env.VSIM_CYCLES_SAMPLES || 32), step: Number(process.env.VSIM_CYCLES_STEP || 4) });
        console.log(`photoreal render → ${out}`);
      } else {
        const r = await renderToVideo(parseDocument(doc), { output: out });
        console.log(`rendered ${r.frames} frames → ${out}`);
      }
      res.writeHead(200, { "content-type": "video/mp4", "content-disposition": 'attachment; filename="scene.mp4"' });
      return res.end(await readFile(out));
    }
    json(res, 404, { error: "not found" });
  } catch (e: any) {
    console.error("studio backend error:", e?.message ?? e);
    json(res, 500, { error: String(e?.message ?? e) });
  }
});
server.listen(PORT, () => console.log(`vsim Studio backend on http://localhost:${PORT}`));
