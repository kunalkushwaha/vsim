import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { parseDocument, type SceneDocument } from "@vsim/core";
import { CopilotSession, editScene } from "./copilot.js";

function baseDoc(): SceneDocument {
  return parseDocument({
    meta: { durationFrames: 90 },
    materials: [{ id: "cube", color: [0.9, 0.4, 0.4] }],
    nodes: [
      { id: "cube", mesh: { geometry: { kind: "box" } }, position: [0, 0, 0] },
      { id: "__camera", position: [3, 2, 4] },
    ],
    camera: { nodeId: "__camera", fov: 45 },
  });
}

/**
 * A fake Anthropic client that records each request's user message and replies with one
 * scripted tool_use + summary. Passing a `client` forces the SDK backend, so no network or
 * `claude` CLI is touched.
 */
function fakeClient(scripted: { tool: string; input: unknown; summary: string }[]) {
  const seen: string[] = [];
  let turn = 0;
  const client = {
    messages: {
      create: async (req: { messages: { content: string }[] }) => {
        seen.push(req.messages[0]!.content);
        const step = scripted[turn++]!;
        return {
          stop_reason: "tool_use",
          content: [
            { type: "tool_use", name: step.tool, input: step.input },
            { type: "text", text: step.summary },
          ],
        };
      },
    },
  };
  return { client: client as unknown as Anthropic, seen };
}

describe("editScene", () => {
  it("applies the model's tool_use as a real document edit", async () => {
    const { client } = fakeClient([
      { tool: "set_material", input: { id: "cube", color: [0, 0, 1] }, summary: "Made the cube blue." },
    ]);
    const res = await editScene({ doc: baseDoc(), prompt: "make the cube blue", client });
    expect(res.provider).toBe("sdk");
    expect(res.operations).toEqual([{ op: "setMaterial", id: "cube", color: [0, 0, 1] }]);
    expect(res.doc.materials.find((m) => m.id === "cube")?.color).toEqual([0, 0, 1]);
    expect(res.summary).toBe("Made the cube blue.");
  });
});

describe("CopilotSession", () => {
  it("threads prior turns as history so follow-ups have context", async () => {
    const { client, seen } = fakeClient([
      { tool: "set_material", input: { id: "cube", color: [0, 0, 1] }, summary: "Made the cube blue." },
      { tool: "add_light", input: { type: "ambient", intensity: 0.5 }, summary: "Added an ambient light." },
    ]);
    const session = new CopilotSession(baseDoc(), { client });

    await session.refine("make the cube blue");
    await session.refine("now brighten the scene");

    // The first request carries no history; the second restates the first turn.
    expect(seen[0]).not.toContain("Earlier in this session");
    expect(seen[1]).toContain("Earlier in this session");
    expect(seen[1]).toContain("Made the cube blue.");

    // The session document accumulates both edits.
    expect(session.document.materials.find((m) => m.id === "cube")?.color).toEqual([0, 0, 1]);
    expect(session.document.nodes.some((n) => n.light?.type === "ambient")).toBe(true);
  });
});
