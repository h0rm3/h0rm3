import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchGitHubData } from "../src/github.js";
import { parseClaudeCode } from "../src/parsers/claudeCode.js";
import { parseCodex } from "../src/parsers/codex.js";
import { buildStats } from "../src/metrics.js";
import { renderLanguagesSvg, renderStreakSvg, renderCommitsSvg } from "../src/render/cards.js";
import { renderReadme } from "../src/render/readme.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");

process.chdir(ROOT);
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // .env is optional if the vars are already in the environment (e.g. CI, scheduled task)
}

const token = process.env.GITHUB_TOKEN;
const username = process.env.GITHUB_USERNAME;
if (!token || !username) {
  console.error("Missing GITHUB_TOKEN or GITHUB_USERNAME (set them in .env — see .env.example)");
  process.exit(1);
}

console.log("Fetching GitHub data...");
const github = await fetchGitHubData(token, username);

console.log("Parsing Claude Code logs...");
const claude = await parseClaudeCode();

console.log("Parsing Codex CLI logs...");
const codex = await parseCodex();

const stats = buildStats({
  turns: [...claude.turns, ...codex.turns],
  prompts: [...claude.prompts, ...codex.prompts],
  commits: github.commits,
  languages: github.languages,
  dailyCommitCounts: github.dailyCommitCounts,
});

mkdirSync(path.join(ROOT, "data"), { recursive: true });
mkdirSync(path.join(ROOT, "assets"), { recursive: true });

writeFileSync(path.join(ROOT, "data", "stats.json"), JSON.stringify(stats, null, 2) + "\n");
writeFileSync(path.join(ROOT, "assets", "languages.svg"), renderLanguagesSvg(stats.languages));
writeFileSync(path.join(ROOT, "assets", "streak.svg"), renderStreakSvg(stats.streak));
writeFileSync(path.join(ROOT, "assets", "commits.svg"), renderCommitsSvg(stats.commitsPerDay));
writeFileSync(path.join(ROOT, "README.md"), renderReadme(stats));

console.log("Wrote data/stats.json, assets/*.svg, README.md");

if (DRY_RUN) {
  console.log("--dry-run: skipping git add/commit/push");
  process.exit(0);
}

execSync("git add README.md assets data/stats.json", { cwd: ROOT, stdio: "inherit" });
const changed = execSync("git status --porcelain -- README.md assets data/stats.json", { cwd: ROOT }).toString().trim();

if (!changed) {
  console.log("No changes to commit");
  process.exit(0);
}

execSync('git commit -m "chore: update stats"', { cwd: ROOT, stdio: "inherit" });
execSync("git push", { cwd: ROOT, stdio: "inherit" });
console.log("Committed and pushed.");
