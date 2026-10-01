import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseClaudeCode } from "../src/parsers/claudeCode.js";

const usage = (output: number) => ({ input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: output });

function assistant(o: { id: string; req?: string; ts: string; out: number; session?: string; sidechain?: boolean; tools?: { id: string; name: string }[]; model?: string }) {
  return JSON.stringify({
    type: "assistant",
    timestamp: o.ts,
    sessionId: o.session ?? "s1",
    isSidechain: o.sidechain ?? false,
    requestId: o.req,
    message: {
      id: o.id,
      model: o.model ?? "claude-sonnet-5",
      usage: usage(o.out),
      content: (o.tools ?? []).map((t) => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
    },
  });
}

function user(o: { uuid: string; ts: string; text?: string; sidechain?: boolean; toolResult?: boolean; meta?: boolean }) {
  return JSON.stringify({
    type: "user",
    uuid: o.uuid,
    timestamp: o.ts,
    sessionId: "s1",
    isSidechain: o.sidechain ?? false,
    isMeta: o.meta ?? false,
    message: { role: "user", content: o.toolResult ? [{ type: "tool_result", tool_use_id: "x", content: "ok" }] : [{ type: "text", text: o.text ?? "hello" }] },
  });
}

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "h0rm3-test-"));
  const proj = path.join(root, "proj");
  mkdirSync(path.join(proj, "s1", "subagents"), { recursive: true });
  const main = [
    user({ uuid: "u1", ts: "2026-09-30T14:00:00.000Z", text: "real prompt" }),
    // one response streamed as three lines: same id + requestId, output grows
    assistant({ id: "m1", req: "r1", ts: "2026-09-30T14:00:01.000Z", out: 5 }),
    assistant({ id: "m1", req: "r1", ts: "2026-09-30T14:00:02.000Z", out: 20, tools: [{ id: "t1", name: "Bash" }] }),
    assistant({ id: "m1", req: "r1", ts: "2026-09-30T14:00:03.000Z", out: 42, tools: [{ id: "t2", name: "mcp__server__thing" }] }),
    user({ uuid: "u2", ts: "2026-09-30T14:00:04.000Z", toolResult: true }),
    user({ uuid: "u3", ts: "2026-09-30T14:00:05.000Z", text: "<task-notification>done</task-notification>" }),
    user({ uuid: "u4", ts: "2026-09-30T14:00:06.000Z", text: "<command-name>/model</command-name>" }),
    user({ uuid: "u5", ts: "2026-09-30T14:00:07.000Z", text: "<pasted_content>pasted prompt</pasted_content>" }),
    user({ uuid: "u6", ts: "2026-09-30T14:00:08.000Z", text: "injected", meta: true }),
  ];
  writeFileSync(path.join(proj, "s1.jsonl"), main.join("\n") + "\n");
  // A resumed session copies earlier lines into another file: must not double count.
  writeFileSync(path.join(proj, "s1-copy.jsonl"), [main[0], main[2], main[3]].join("\n") + "\n");
  const sub = [
    user({ uuid: "u7", ts: "2026-09-30T14:01:00.000Z", text: "subagent task prompt", sidechain: true }),
    assistant({ id: "m2", req: "r2", ts: "2026-09-30T14:01:01.000Z", out: 7, sidechain: true, tools: [{ id: "t3", name: "Read" }] }),
    assistant({ id: "m2", req: "r2", ts: "2026-09-30T14:01:02.000Z", out: 9, sidechain: true, tools: [{ id: "t3", name: "Read" }] }),
  ];
  writeFileSync(path.join(proj, "s1", "subagents", "agent-a.jsonl"), sub.join("\n") + "\n");
  return root;
}

test("streamed duplicates and copied lines are counted once, with final output tokens", async () => {
  const logs = await parseClaudeCode(fixture());
  const main = logs.messages.filter((m) => !m.sidechain);
  assert.equal(main.length, 1);
  assert.equal(main[0].output, 42);
  assert.equal(main[0].freshInput, 10);
  assert.equal(main[0].timestamp, "2026-09-30T14:00:01.000Z");
});

test("sidechain / subagent usage is included", async () => {
  const logs = await parseClaudeCode(fixture());
  const side = logs.messages.filter((m) => m.sidechain);
  assert.equal(side.length, 1);
  assert.equal(side[0].output, 9);
  const totalOutput = logs.messages.reduce((a, m) => a + m.output, 0);
  assert.equal(totalOutput, 42 + 9);
});

test("only human prompts count: tool results, sidechain, meta and system-injected turns are excluded", async () => {
  const logs = await parseClaudeCode(fixture());
  assert.equal(logs.prompts.length, 2); // u1 and the pasted-content prompt u5
  assert.equal(logs.prompts[0].family, "Sonnet");
});

test("tool_use blocks are counted once per id, MCP tools collapsed", async () => {
  const logs = await parseClaudeCode(fixture());
  const names = logs.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["Bash", "MCP", "Read"]);
});

test("asOf cutoff drops later records", async () => {
  const logs = await parseClaudeCode(fixture(), new Date("2026-09-30T14:00:30.000Z"));
  assert.equal(logs.messages.filter((m) => m.sidechain).length, 0);
  assert.equal(logs.tools.length, 2);
});
