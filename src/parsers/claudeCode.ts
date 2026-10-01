import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import type { AiMessage, AiPrompt, ParsedLogs, SessionSpan, ToolCall } from "../types.js";
import { modelFamily } from "../normalize.js";

export const DEFAULT_CLAUDE_DIR = path.join(os.homedir(), ".claude", "projects");

export async function findJsonl(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await findJsonl(full)));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
  }
  return out.sort();
}

/** System-injected user turns that look like text but were not typed as a prompt. */
const NON_PROMPT_PREFIXES = ["<task-notification", "<command-", "<local-command-", "[Request interrupted"];

export function isHumanPrompt(rec: any): boolean {
  if (rec.type !== "user" || rec.isSidechain || rec.isMeta) return false;
  const c = rec.message?.content;
  const text =
    typeof c === "string"
      ? c
      : Array.isArray(c)
        ? c.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join(" ")
        : "";
  const t = text.trimStart();
  if (!t) return false;
  return !NON_PROMPT_PREFIXES.some((p) => t.startsWith(p));
}

/** MCP tool names reveal which services are connected, so they're collapsed into one bucket. */
export function toolBucket(name: string): string {
  return name.startsWith("mcp__") ? "MCP" : name;
}

const earlier = (a: string, b: string) => (a <= b ? a : b);
const later = (a: string, b: string) => (a >= b ? a : b);

/**
 * Reads every session transcript, including subagent/sidechain transcripts (real usage).
 * `asOf` drops records after that instant so repeated runs can be compared deterministically.
 */
export async function parseClaudeCode(rootDir = DEFAULT_CLAUDE_DIR, asOf?: Date): Promise<ParsedLogs> {
  const files = await findJsonl(rootDir);
  const cutoff = asOf?.toISOString();

  const messages = new Map<string, AiMessage>();
  const tools = new Map<string, ToolCall>();
  const prompts = new Map<string, AiPrompt>();
  const spans = new Map<string, SessionSpan>();

  for (const file of files) {
    const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const ts: string | undefined = rec.timestamp;
      const sessionId: string | undefined = rec.sessionId;
      if (!ts || !sessionId) continue;
      if (cutoff && ts > cutoff) continue;

      // Agent SDK runs (entrypoint "sdk-*") are programmatic: their tokens are real usage, but their
      // user turns are machine-written and they are not interactive sessions.
      const automated = typeof rec.entrypoint === "string" && rec.entrypoint.startsWith("sdk");
      const span = spans.get(sessionId);
      if (span) {
        span.start = earlier(span.start, ts);
        span.end = later(span.end, ts);
        span.automated ||= automated;
      } else {
        spans.set(sessionId, { source: "claude-code", sessionId, start: ts, end: ts, automated });
      }

      if (rec.type === "assistant" && rec.message?.usage && rec.message.id) {
        const u = rec.message.usage;
        const key = `${rec.message.id}|${rec.requestId ?? ""}`;
        const prev = messages.get(key);
        const model = String(rec.message.model ?? "unknown");
        // Streamed duplicates repeat the same response; only output_tokens grows, so per-field max = final.
        messages.set(key, {
          source: "claude-code",
          key,
          timestamp: prev ? earlier(prev.timestamp, ts) : ts,
          model,
          family: modelFamily(model),
          sessionId,
          sidechain: Boolean(rec.isSidechain),
          freshInput: Math.max(prev?.freshInput ?? 0, u.input_tokens ?? 0),
          cacheWrite: Math.max(prev?.cacheWrite ?? 0, u.cache_creation_input_tokens ?? 0),
          cacheRead: Math.max(prev?.cacheRead ?? 0, u.cache_read_input_tokens ?? 0),
          output: Math.max(prev?.output ?? 0, u.output_tokens ?? 0),
        });
        if (Array.isArray(rec.message.content)) {
          for (const b of rec.message.content) {
            if (b?.type === "tool_use" && b.id && b.name && !tools.has(b.id)) {
              tools.set(b.id, { timestamp: ts, name: toolBucket(String(b.name)), sessionId });
            }
          }
        }
      } else if (!automated && isHumanPrompt(rec)) {
        const id = rec.uuid ?? `${sessionId}|${ts}`;
        if (!prompts.has(id)) prompts.set(id, { source: "claude-code", timestamp: ts, sessionId, family: null });
      }
    }
  }

  const msgList = [...messages.values()];
  attributePromptFamilies([...prompts.values()], msgList);
  return { messages: msgList, prompts: [...prompts.values()], tools: [...tools.values()], sessions: [...spans.values()] };
}

/** A prompt belongs to the family of the first main-chain, non-synthetic response at or after it. */
export function attributePromptFamilies(prompts: AiPrompt[], messages: AiMessage[]): void {
  const bySession = new Map<string, AiMessage[]>();
  for (const m of messages) {
    if (m.sidechain || m.model === "<synthetic>") continue;
    const list = bySession.get(m.sessionId) ?? [];
    list.push(m);
    bySession.set(m.sessionId, list);
  }
  for (const list of bySession.values()) list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const p of prompts) {
    const next = bySession.get(p.sessionId)?.find((m) => m.timestamp >= p.timestamp);
    p.family = next ? next.family : null;
  }
}
