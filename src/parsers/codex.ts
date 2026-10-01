import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import type { AiPrompt, AiTurn } from "../types.js";
import { modelFamily } from "../normalize.js";

const SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

async function findSessionFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSessionFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(full);
    }
  }
  return files;
}

async function parseFile(file: string, turns: AiTurn[], prompts: AiPrompt[]): Promise<void> {
  let sessionId = path.basename(file, ".jsonl");
  let model = "unknown";
  let prevUsage = { input: 0, cached: 0, output: 0 };

  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    if (rec.type === "session_meta" && rec.payload?.session_id) {
      sessionId = rec.payload.session_id;
    } else if (rec.type === "turn_context" && rec.payload?.model) {
      model = rec.payload.model;
    } else if (rec.type === "event_msg") {
      const payload = rec.payload;
      if (payload?.type === "user_message") {
        prompts.push({ source: "codex", timestamp: rec.timestamp, sessionId });
      } else if (payload?.type === "token_count" && payload.info?.total_token_usage) {
        const cur = {
          input: payload.info.total_token_usage.input_tokens ?? 0,
          cached: payload.info.total_token_usage.cached_input_tokens ?? 0,
          output: payload.info.total_token_usage.output_tokens ?? 0,
        };
        const delta = {
          input: Math.max(0, cur.input - prevUsage.input),
          cached: Math.max(0, cur.cached - prevUsage.cached),
          output: Math.max(0, cur.output - prevUsage.output),
        };
        prevUsage = cur;
        if (delta.input > 0 || delta.output > 0) {
          turns.push({
            source: "codex",
            timestamp: rec.timestamp,
            model,
            family: modelFamily(model),
            sessionId,
            freshInputTokens: Math.max(0, delta.input - delta.cached),
            cacheCreationTokens: 0,
            cacheReadTokens: delta.cached,
            outputTokens: delta.output,
          });
        }
      }
    }
  }
}

export async function parseCodex(): Promise<{ turns: AiTurn[]; prompts: AiPrompt[] }> {
  const files = await findSessionFiles(SESSIONS_DIR);
  const turns: AiTurn[] = [];
  const prompts: AiPrompt[] = [];
  for (const file of files) {
    await parseFile(file, turns, prompts);
  }
  return { turns, prompts };
}
