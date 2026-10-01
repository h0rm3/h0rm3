import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Stats } from "../types.js";
import { TIME_BUCKET_EMOJI } from "../metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(__dirname, "../../templates/README.template.md");

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function renderAiWeekTable(aiWeek: Stats["aiWeek"]): string {
  const lines: string[] = [];
  lines.push(`🔤 ${formatNumber(aiWeek.totalInputTokens)} input tokens · ${formatNumber(aiWeek.outputTokens)} output tokens`);
  lines.push(`🧠 ${formatNumber(aiWeek.sessions)} sessions · ${formatNumber(aiWeek.prompts)} prompts`);

  if (aiWeek.families.length > 0) {
    lines.push("");
    const nameWidth = Math.max(...aiWeek.families.map((f) => f.family.length)) + 2;
    for (const f of aiWeek.families) {
      lines.push(`${f.family.padEnd(nameWidth)}${f.bar}  ${f.percent.toFixed(1).padStart(5)}%  ${formatNumber(f.tokens)} tokens`);
    }
  } else {
    lines.push("", "No AI activity recorded in the last 7 days.");
  }

  return "```\n" + lines.join("\n") + "\n```";
}

function renderBuilderProfileTable(bp: Stats["builderProfile"]): string {
  const lines: string[] = [bp.headline, ""];

  const bucketWidth = Math.max(...bp.timeBuckets.map((b) => b.bucket.length)) + 5; // + emoji & space & padding
  for (const b of bp.timeBuckets) {
    const label = `${TIME_BUCKET_EMOJI[b.bucket]} ${b.bucket}`.padEnd(bucketWidth);
    lines.push(`${label}${b.bar}  ${b.percent.toFixed(1).padStart(5)}%  ${formatNumber(b.count)}`);
  }

  lines.push("");
  const weekdayWidth = Math.max(...bp.weekdays.map((w) => w.weekday.length)) + 2;
  for (const w of bp.weekdays) {
    lines.push(`${w.weekday.padEnd(weekdayWidth)}${w.bar}  ${w.percent.toFixed(1).padStart(5)}%  ${formatNumber(w.count)}`);
  }

  return "```\n" + lines.join("\n") + "\n```";
}

/** GitHub Linguist language name -> devicon slug. Unmapped languages are skipped rather than guessed. */
const DEVICON_SLUGS: Record<string, string> = {
  JavaScript: "javascript",
  TypeScript: "typescript",
  Python: "python",
  Java: "java",
  "C++": "cplusplus",
  C: "c",
  "C#": "csharp",
  Go: "go",
  Rust: "rust",
  Ruby: "ruby",
  PHP: "php",
  Swift: "swift",
  Kotlin: "kotlin",
  HTML: "html5",
  CSS: "css3",
  Shell: "bash",
  PowerShell: "powershell",
  Dockerfile: "docker",
  Vue: "vuejs",
  "Objective-C": "objectivec",
  Scala: "scala",
  Dart: "dart",
  Lua: "lua",
  Perl: "perl",
  Haskell: "haskell",
  R: "r",
  "Jupyter Notebook": "jupyter",
};

function renderTechBadges(languages: Stats["languages"]): string {
  const slugs = languages
    .map((l) => DEVICON_SLUGS[l.name])
    .filter((slug): slug is string => Boolean(slug));
  if (slugs.length === 0) return "";
  return slugs
    .map((slug) => `<img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${slug}/${slug}-plain.svg" width="40" height="40" alt="${slug}"/>`)
    .join(" ");
}

export function renderReadme(stats: Stats): string {
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  const now = new Date(stats.generatedAt);
  const formatted = now.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const lastUpdated = `Last updated ${formatted}`;

  return template
    .replaceAll("{{AI_WEEK_TABLE}}", renderAiWeekTable(stats.aiWeek))
    .replaceAll("{{BUILDER_PROFILE_TABLE}}", renderBuilderProfileTable(stats.builderProfile))
    .replaceAll("{{TECH_BADGES}}", renderTechBadges(stats.languages))
    .replaceAll("{{LAST_UPDATED}}", lastUpdated);
}
