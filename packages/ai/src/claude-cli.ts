import { spawn } from "node:child_process";
import type { SceneDocument } from "@vsim/core";
import type { EditOperation } from "./operations.js";
import { toolUseToOperation, toolsReference } from "./tools.js";
import { summarizeScene } from "./summary.js";

/**
 * Alternative copilot backend that drives the LLM through the `claude` CLI in headless
 * print mode (`claude -p`). This lets the copilot run via a Claude Code login, with no
 * ANTHROPIC_API_KEY. The model is asked for a JSON list of edits which map onto the same
 * EditOperation vocabulary the SDK backend uses.
 */

const INSTRUCTIONS = `You are the editing copilot for vsim, a deterministic 3D animation framework. Translate the request into precise edits to the scene.

Conventions: the coordinate system is Y-up; colors are linear RGB with each component in 0..1; time is measured in FRAMES (integer indices), not seconds; meshes reference materials by id (create the material before a mesh uses it); reuse the ids already present in the scene. For outdoor scenes use set_environment (gradient sky) + a large ground plane + a hemisphere light; for different camera angles add named cameras (add_camera, with lookAtNodeId to track) and cut between them with set_shot. When asked to build a whole scene, compose it from these tools; otherwise change only what the request asks for.`;

function runClaude(prompt: string, model?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json"];
    if (model) args.push("--model", model);
    const child = spawn("claude", args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        e.code === "ENOENT"
          ? new Error("`claude` CLI not found. Install Claude Code, or set ANTHROPIC_API_KEY to use the SDK backend.")
          : e,
      ),
    );
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exited with code ${code}: ${err.trim()}`));
      try {
        const env = JSON.parse(out);
        if (env.is_error) return reject(new Error(`claude error: ${env.result ?? "unknown"}`));
        resolve(typeof env.result === "string" ? env.result : "");
      } catch {
        reject(new Error(`could not parse claude output: ${out.slice(0, 200)}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Extract a JSON object from model text, tolerating ```json fences or surrounding prose. */
function extractJson(text: string): { operations?: { tool: string; input?: unknown }[]; summary?: string } {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error(`expected a JSON object, got: ${text.slice(0, 200)}`);
  }
}

export async function editViaClaudeCli(
  doc: SceneDocument,
  prompt: string,
  model?: string,
  history?: string,
): Promise<{ operations: EditOperation[]; summary: string }> {
  const fullPrompt = [
    INSTRUCTIONS,
    "",
    "Available edit tools:",
    toolsReference(),
    "",
    "Scene summary:",
    summarizeScene(doc),
    "",
    "Full document (JSON):",
    JSON.stringify(doc),
    "",
    ...(history && history.trim()
      ? ["Earlier in this session you already made these changes:", history.trim(), ""]
      : []),
    `Request: ${prompt}`,
    "",
    "Respond with ONLY a JSON object (no markdown, no commentary) of the form:",
    '{"operations": [{"tool": "<tool name>", "input": { ... }}], "summary": "<one sentence>"}',
    "Use the exact tool names listed above.",
  ].join("\n");

  const raw = await runClaude(fullPrompt, model);
  const parsed = extractJson(raw);
  const operations: EditOperation[] = [];
  for (const entry of parsed.operations ?? []) {
    const op = toolUseToOperation(entry.tool, entry.input ?? {});
    if (op) operations.push(op);
  }
  return { operations, summary: typeof parsed.summary === "string" ? parsed.summary : "" };
}
