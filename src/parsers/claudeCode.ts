import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import type { AiPrompt, AiTurn } from "../types.js";
import { modelFamily } from "../normalize.js";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

async function findSessionFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "subagents") continue; // sub-agent transcripts, not primary sessions
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSessionFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(full);
    }
  }
  return files;
}

function hasHumanText(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) {
    return content.some((block) => block?.type === "text" && typeof block.text === "string" && block.text.trim().length > 0);
  }
  return false;
}

async function parseFile(file: string, turnsById: Map<string, AiTurn>, prompts: AiPrompt[]): Promise<void> {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.isSidechain) continue;

    if (rec.type === "assistant" && rec.message?.usage && rec.message.model !== "<synthetic>") {
      const id = rec.message.id as string;
      const usage = rec.message.usage;
      turnsById.set(id, {
        source: "claude-code",
        timestamp: rec.timestamp,
        model: rec.message.model,
        family: modelFamily(rec.message.model ?? ""),
        sessionId: rec.sessionId,
        freshInputTokens: usage.input_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
      });
    } else if (rec.type === "user" && hasHumanText(rec.message?.content)) {
      prompts.push({
        source: "claude-code",
        timestamp: rec.timestamp,
        sessionId: rec.sessionId,
      });
    }
  }
}

export async function parseClaudeCode(): Promise<{ turns: AiTurn[]; prompts: AiPrompt[] }> {
  const files = await findSessionFiles(PROJECTS_DIR);
  const turnsById = new Map<string, AiTurn>(); // dedupe streamed duplicates by message id, last write wins
  const prompts: AiPrompt[] = [];
  for (const file of files) {
    await parseFile(file, turnsById, prompts);
  }
  return { turns: [...turnsById.values()], prompts };
}
