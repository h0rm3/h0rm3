import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import type { AiMessage, AiPrompt, ParsedLogs, SessionSpan } from "../types.js";
import { modelFamily } from "../normalize.js";
import { attributePromptFamilies, findJsonl } from "./claudeCode.js";

export const DEFAULT_CODEX_DIR = path.join(os.homedir(), ".codex", "sessions");

/**
 * Codex logs cumulative `total_token_usage` snapshots; each positive delta becomes one usage record.
 * OpenAI input_tokens include cached tokens, so fresh = input - cached. Codex reports no cache writes.
 */
export async function parseCodex(rootDir = DEFAULT_CODEX_DIR, asOf?: Date): Promise<ParsedLogs> {
  const files = await findJsonl(rootDir);
  const cutoff = asOf?.toISOString();
  const messages: AiMessage[] = [];
  const prompts = new Map<string, AiPrompt>();
  const sessions: SessionSpan[] = [];

  for (const file of files) {
    let sessionId = path.basename(file, ".jsonl");
    let model = "unknown";
    let prev = { input: 0, cached: 0, output: 0 };
    const span = { start: "", end: "" };

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
      if (!ts || (cutoff && ts > cutoff)) continue;
      if (!span.start || ts < span.start) span.start = ts;
      if (!span.end || ts > span.end) span.end = ts;

      if (rec.type === "session_meta" && rec.payload?.session_id) {
        sessionId = rec.payload.session_id;
      } else if (rec.type === "turn_context" && rec.payload?.model) {
        model = String(rec.payload.model);
      } else if (rec.type === "event_msg" && rec.payload?.type === "user_message") {
        const key = `${sessionId}|${ts}`;
        if (!prompts.has(key)) prompts.set(key, { source: "codex", timestamp: ts, sessionId, family: null });
      } else if (rec.type === "event_msg" && rec.payload?.type === "token_count" && rec.payload.info?.total_token_usage) {
        const t = rec.payload.info.total_token_usage;
        const cur = { input: t.input_tokens ?? 0, cached: t.cached_input_tokens ?? 0, output: t.output_tokens ?? 0 };
        const d = {
          input: Math.max(0, cur.input - prev.input),
          cached: Math.max(0, cur.cached - prev.cached),
          output: Math.max(0, cur.output - prev.output),
        };
        prev = cur;
        if (d.input > 0 || d.output > 0) {
          messages.push({
            source: "codex",
            key: `${sessionId}|${ts}|${messages.length}`,
            timestamp: ts,
            model,
            family: modelFamily(model),
            sessionId,
            sidechain: false,
            freshInput: Math.max(0, d.input - d.cached),
            cacheWrite: 0,
            cacheRead: d.cached,
            output: d.output,
          });
        }
      }
    }
    if (span.start) sessions.push({ source: "codex", sessionId, start: span.start, end: span.end });
  }

  const promptList = [...prompts.values()];
  attributePromptFamilies(promptList, messages);
  return { messages, prompts: promptList, tools: [], sessions };
}
