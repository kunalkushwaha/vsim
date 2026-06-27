import Anthropic from "@anthropic-ai/sdk";
import type { SceneDocument } from "@vsim/core";
import { applyOperations, type EditOperation } from "./operations.js";
import { EDIT_TOOLS, toolUseToOperation } from "./tools.js";
import { summarizeScene } from "./summary.js";
import { editViaClaudeCli } from "./claude-cli.js";

/**
 * Which backend drives the LLM call:
 * - `"sdk"`        — the Anthropic SDK (needs ANTHROPIC_API_KEY).
 * - `"claude-cli"` — the `claude` CLI in headless mode (uses a Claude Code login).
 * - `"auto"`       — sdk when an API key/client is available, else claude-cli.
 */
export type Provider = "sdk" | "claude-cli" | "auto";

const SYSTEM_PROMPT = `You are the editing copilot for vsim, a deterministic 3D animation framework. You translate a natural-language request into precise edits to a 3D scene.

Conventions:
- The coordinate system is Y-up. Colors are linear RGB with each component in 0..1.
- Time is measured in FRAMES, not seconds. Animation keyframes use integer frame indices.
- Meshes reference materials by id; create a material with set_material before a mesh uses it.
- Reuse the ids already present in the scene when editing existing objects — do not duplicate them.
- Outdoor scenes: set a gradient sky with set_environment (e.g. skyTop [0.32,0.52,0.92], skyBottom [0.74,0.85,0.97]), add a large plane as ground, and use a hemisphere light for natural fill.
- Different camera angles: add named cameras with add_camera (use lookAtNodeId to track a moving object), then cut between them with set_shot over frame ranges.

Make every change by calling the edit tools. Do not describe a change in prose without also performing it with a tool call. When the request asks to build or describe a whole scene, compose it from these tools (geometry + materials + lights + environment + cameras/shots). Otherwise make only the changes the request asks for; don't redesign the scene. After the edits, give a one-sentence summary of what you changed.`;

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
  /** Which backend to use. Defaults to "auto". */
  provider?: Provider;
  /**
   * Optional transcript of earlier turns in a refine session, so a follow-up like
   * "now make it bigger" can resolve what "it" refers to. Plain text; `CopilotSession`
   * maintains this automatically across `refine` calls.
   */
  history?: string;
}

export interface EditSceneResult {
  /** The edited, validated document (or the original if no edits were proposed). */
  doc: SceneDocument;
  /** The operations the model applied. */
  operations: EditOperation[];
  /** The model's one-line summary of what it changed. */
  summary: string;
  /** Which backend produced the edits. */
  provider: Exclude<Provider, "auto">;
}

function buildUserMessage(doc: SceneDocument, prompt: string, history?: string): string {
  const parts = [
    "Here is the current scene.",
    "",
    "Summary:",
    summarizeScene(doc),
    "",
    "Full document (JSON):",
    JSON.stringify(doc),
    "",
  ];
  if (history && history.trim()) {
    parts.push("Earlier in this session you already made these changes:", history.trim(), "");
  }
  parts.push(`Request: ${prompt}`);
  return parts.join("\n");
}

/**
 * Turn a natural-language prompt into schema-constrained edits to a scene document,
 * using Claude tool-use. The model proposes edit operations; they are applied
 * deterministically and re-validated. The returned document can be rendered exactly like
 * any hand-authored one — the AI never participates in the deterministic render path.
 */
function resolveProvider(opts: EditSceneOptions): Exclude<Provider, "auto"> {
  if (opts.provider && opts.provider !== "auto") return opts.provider;
  return opts.client || opts.apiKey || process.env.ANTHROPIC_API_KEY ? "sdk" : "claude-cli";
}

async function editViaSdk(opts: EditSceneOptions): Promise<{ operations: EditOperation[]; summary: string }> {
  const client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  const response = await client.messages.create({
    model: opts.model ?? "claude-opus-4-8",
    max_tokens: opts.maxTokens ?? 8000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    tools: EDIT_TOOLS,
    messages: [{ role: "user", content: buildUserMessage(opts.doc, opts.prompt, opts.history) }],
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
  return { operations, summary: textParts.join("\n").trim() };
}

export async function editScene(opts: EditSceneOptions): Promise<EditSceneResult> {
  const provider = resolveProvider(opts);
  const { operations, summary } =
    provider === "claude-cli"
      ? await editViaClaudeCli(opts.doc, opts.prompt, opts.model, opts.history)
      : await editViaSdk(opts);

  // skipInvalid: tolerate the occasional malformed op from the model rather than discarding the
  // whole edit — the AI is authoring-time, so resilience matters more than strictness here.
  const doc = operations.length > 0 ? applyOperations(opts.doc, operations, { skipInvalid: true }) : opts.doc;
  return { doc, operations, summary, provider };
}

/**
 * A multi-turn refine session. Holds the evolving document and a running transcript so
 * follow-up prompts ("now make it bigger") resolve against the changes already made. Each
 * `refine` applies the model's edits, advances the document, and records the turn.
 */
export class CopilotSession {
  private current: SceneDocument;
  private readonly turns: { prompt: string; summary: string }[] = [];
  private readonly base: Omit<EditSceneOptions, "doc" | "prompt" | "history">;

  constructor(doc: SceneDocument, base: Omit<EditSceneOptions, "doc" | "prompt" | "history"> = {}) {
    this.current = doc;
    this.base = base;
  }

  /** The document as edited so far. */
  get document(): SceneDocument {
    return this.current;
  }

  /** Apply one natural-language instruction, threading the prior turns as context. */
  async refine(prompt: string): Promise<EditSceneResult> {
    const result = await editScene({ ...this.base, doc: this.current, prompt, history: this.transcript() });
    this.current = result.doc;
    this.turns.push({ prompt, summary: result.summary });
    return result;
  }

  private transcript(): string {
    return this.turns.map((t, i) => `${i + 1}. "${t.prompt}" → ${t.summary}`).join("\n");
  }
}
