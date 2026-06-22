import Anthropic from "@anthropic-ai/sdk";
import type { SceneDocument } from "@vsim/core";
import { applyOperations, type EditOperation } from "./operations.js";
import { EDIT_TOOLS, toolUseToOperation } from "./tools.js";
import { summarizeScene } from "./summary.js";

const SYSTEM_PROMPT = `You are the editing copilot for vsim, a deterministic 3D animation framework. You translate a natural-language request into precise edits to a 3D scene.

Conventions:
- The coordinate system is Y-up. Colors are linear RGB with each component in 0..1.
- Time is measured in FRAMES, not seconds. Animation keyframes use integer frame indices.
- Meshes reference materials by id; create a material with set_material before a mesh uses it.
- Reuse the ids already present in the scene when editing existing objects — do not duplicate them.

Make every change by calling the edit tools. Do not describe a change in prose without also performing it with a tool call. Make only the changes the request asks for; don't redesign the scene. After the edits, give a one-sentence summary of what you changed.`;

export interface EditSceneOptions {
  /** The scene to edit. */
  doc: SceneDocument;
  /** Natural-language instruction, e.g. "make the cube blue and add a point light". */
  prompt: string;
  /** Provide a pre-configured client, or let one be constructed from `apiKey`/env. */
  client?: Anthropic;
  /** Anthropic API key. Defaults to the ANTHROPIC_API_KEY environment variable. */
  apiKey?: string;
  /** Model id. Defaults to claude-opus-4-8. */
  model?: string;
  maxTokens?: number;
}

export interface EditSceneResult {
  /** The edited, validated document (or the original if no edits were proposed). */
  doc: SceneDocument;
  /** The operations the model applied. */
  operations: EditOperation[];
  /** The model's one-line summary of what it changed. */
  summary: string;
}

function buildUserMessage(doc: SceneDocument, prompt: string): string {
  return [
    "Here is the current scene.",
    "",
    "Summary:",
    summarizeScene(doc),
    "",
    "Full document (JSON):",
    JSON.stringify(doc),
    "",
    `Request: ${prompt}`,
  ].join("\n");
}

/**
 * Turn a natural-language prompt into schema-constrained edits to a scene document,
 * using Claude tool-use. The model proposes edit operations; they are applied
 * deterministically and re-validated. The returned document can be rendered exactly like
 * any hand-authored one — the AI never participates in the deterministic render path.
 */
export async function editScene(opts: EditSceneOptions): Promise<EditSceneResult> {
  const client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  const model = opts.model ?? "claude-opus-4-8";

  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 8000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    tools: EDIT_TOOLS,
    messages: [{ role: "user", content: buildUserMessage(opts.doc, opts.prompt) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The request was declined by the model's safety system.");
  }

  const operations: EditOperation[] = [];
  const textParts: string[] = [];
  for (const block of response.content) {
    if (block.type === "tool_use") {
      const op = toolUseToOperation(block.name, block.input);
      if (op) operations.push(op);
    } else if (block.type === "text") {
      textParts.push(block.text);
    }
  }

  const doc = operations.length > 0 ? applyOperations(opts.doc, operations) : opts.doc;
  return { doc, operations, summary: textParts.join("\n").trim() };
}
