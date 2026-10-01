import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchGitHubData } from "../src/github.js";
import { parseClaudeCode } from "../src/parsers/claudeCode.js";
import { parseCodex } from "../src/parsers/codex.js";
import { aggregateDays, mergeHistory, parseHistory } from "../src/history.js";
import { buildStats } from "../src/stats.js";
import { resolveBadges } from "../src/badges.js";
import { renderAiActivity, renderCommits, renderGitHubStats, renderHeatmap, renderLanguages, renderStreak, renderTopRepos } from "../src/render/cards.js";
import { renderReadme } from "../src/render/readme.js";
import { privacyScan, validateSvg } from "../src/qc.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const asOfArg = process.argv.find((a) => a.startsWith("--as-of="))?.slice("--as-of=".length);
const asOf = asOfArg ? new Date(asOfArg) : undefined;
if (asOf && Number.isNaN(asOf.getTime())) throw new Error(`Invalid --as-of value`);
const now = asOf ?? new Date();

process.chdir(ROOT);
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // vars may already be in the environment
}
const token = process.env.GITHUB_TOKEN;
const username = process.env.GITHUB_USERNAME;
if (!token || !username) {
  console.error("Missing GITHUB_TOKEN or GITHUB_USERNAME (see .env.example)");
  process.exit(1);
}

console.log("Fetching GitHub data...");
const github = await fetchGitHubData(token, username, now);

console.log("Parsing Claude Code and Codex logs...");
const [claude, codex] = await Promise.all([parseClaudeCode(undefined, asOf), parseCodex(undefined, asOf)]);

const historyPath = path.join(ROOT, "data", "history.json");
const history = mergeHistory(parseHistory(existsSync(historyPath) ? readFileSync(historyPath, "utf8") : null), {
  "claude-code": aggregateDays("claude-code", claude),
  codex: aggregateDays("codex", codex),
});

const stats = buildStats({
  now,
  history,
  github,
  commits: github.commits,
  badges: await resolveBadges(languageLabels()),
});

function languageLabels(): string[] {
  const total = Object.values(github.languages).reduce((a, b) => a + b, 0);
  return Object.entries(github.languages)
    .filter(([, b]) => total > 0 && (b / total) * 100 >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
}

const outputs: Record<string, string> = {
  "data/history.json": JSON.stringify(history, null, 2) + "\n",
  "data/stats.json": JSON.stringify(stats, null, 2) + "\n",
  "assets/languages.svg": renderLanguages(stats.languages),
  "assets/streak.svg": renderStreak(stats.streak),
  "assets/heatmap.svg": renderHeatmap(stats.heatmap),
  "assets/commits.svg": renderCommits(stats.commitsPerDay),
  "assets/ai-activity.svg": renderAiActivity(stats.promptsPerDay),
  "assets/github-stats.svg": renderGitHubStats(stats.github),
  "assets/top-repos.svg": renderTopRepos(stats.topRepos),
  "README.md": renderReadme(stats),
};

mkdirSync(path.join(ROOT, "data"), { recursive: true });
mkdirSync(path.join(ROOT, "assets"), { recursive: true });
for (const [rel, content] of Object.entries(outputs)) writeFileSync(path.join(ROOT, rel), content);
console.log(`Wrote ${Object.keys(outputs).length} files`);

// Guard: never publish malformed/unsafe SVGs or anything that trips the privacy scan.
const problems = [
  ...Object.entries(outputs)
    .filter(([rel]) => rel.endsWith(".svg"))
    .flatMap(([rel, c]) => validateSvg(c).map((e) => `${rel}: ${e}`)),
  ...privacyScan(Object.entries(outputs).map(([p, content]) => ({ path: p, content })), github.privateRepoNames),
];
if (problems.length) {
  console.error("Refusing to publish:\n" + problems.map((p) => "  - " + p).join("\n"));
  process.exit(2);
}

if (DRY_RUN) {
  console.log("--dry-run: not committing");
  process.exit(0);
}

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
if (git("rev-parse", "--abbrev-ref", "HEAD").trim() !== "main") {
  console.error("Not on main; refusing to commit/push");
  process.exit(3);
}
const published = Object.keys(outputs);
git("add", "--", ...published);
if (!git("status", "--porcelain", "--", ...published).trim()) {
  console.log("No changes to commit");
  process.exit(0);
}
git("commit", "-m", "chore: update stats", "--", ...published);
git("push", "origin", "main");
console.log("Committed and pushed.");
