/** Substring match, in priority order, on the lowercased raw model id. */
const KNOWN_FAMILIES: [needle: string, family: string][] = [
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
  ["fable", "Fable"],
  ["gpt", "GPT"],
  ["codex", "GPT"],
  ["o1", "GPT"],
  ["o3", "GPT"],
  ["o4", "GPT"],
];

/** Falls back to the raw model id itself when no known family substring matches. */
export function modelFamily(rawModel: string): string {
  const lower = rawModel.toLowerCase();
  for (const [needle, family] of KNOWN_FAMILIES) {
    if (lower.includes(needle)) return family;
  }
  return rawModel;
}
