import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AiBlock, Row, Stats } from "../types.js";
import { TIME_BUCKET_EMOJI, blockBar } from "../metrics.js";
import { TZ } from "../tz.js";
import { fmt } from "./theme.js";

const TEMPLATE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates/README.template.md");

const pct = (p: number) => `${p.toFixed(1)}%`.padStart(6);
const fence = (lines: string[]) => "```\n" + lines.join("\n") + "\n```";

/** label | value + unit (right-aligned) | bar | percent (right-aligned). Bars scale to the largest row. */
function table(rows: Row[], unit: (n: number) => string, labelOf: (r: Row) => string = (r) => r.label): string[] {
  if (rows.length === 0) return [];
  const labels = rows.map(labelOf);
  const values = rows.map((r) => `${fmt(r.value)} ${unit(r.value)}`);
  const lw = Math.max(...labels.map((l) => l.length)) + 2;
  const vw = Math.max(...values.map((v) => v.length));
  const max = Math.max(...rows.map((r) => r.value));
  return rows.map((r, i) => `${labels[i].padEnd(lw)}${values[i].padStart(vw)}  ${blockBar(r.value, max)}  ${pct(r.percent)}`);
}

function aiHeader(b: AiBlock): string[] {
  return [
    `🔤 ${fmt(b.totalInput)} input tokens · ${fmt(b.output)} output tokens`,
    `   ${fmt(b.freshInput)} fresh · ${fmt(b.cacheWrite)} cache write · ${fmt(b.cacheRead)} cache read`,
    `🧠 ${fmt(b.sessions)} ${b.sessions === 1 ? "session" : "sessions"} · ${fmt(b.prompts)} ${b.prompts === 1 ? "prompt" : "prompts"}`,
  ];
}

const tokensUnit = () => "tokens";

function renderWeek(b: AiBlock): string {
  const lines = aiHeader(b);
  lines.push("", ...(b.families.length ? table(b.families, tokensUnit) : ["No Claude Code activity in the last 7 days."]));
  return fence(lines);
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${fmt(h)}h ${m}m` : `${m}m`;
}

function longDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

function renderAllTime(b: Stats["claudeAllTime"]): string {
  const lines = aiHeader(b);
  const extras: string[] = [];
  if (b.avgPromptsPerSession !== null) extras.push(`${b.avgPromptsPerSession.toFixed(1)} prompts/session avg`);
  if (b.longestActiveSessionMinutes !== null) extras.push(`longest session ${duration(b.longestActiveSessionMinutes)} active`);
  if (b.mostActiveHour !== null) extras.push(`busiest hour ${String(b.mostActiveHour).padStart(2, "0")}:00 ET`);
  if (extras.length) lines.push(`⏱️ ${extras.join(" · ")}`);
  if (b.firstDay) lines.push(`📅 since ${longDate(b.firstDay)}`);
  lines.push("", ...(b.families.length ? table(b.families, tokensUnit) : ["No Claude Code activity recorded yet."]));
  return fence(lines);
}

function renderTools(t: Stats["topTools"]): string {
  if (t.rows.length === 0) return fence(["No tool calls recorded yet."]);
  return fence([`🛠️ ${fmt(t.totalCalls)} tool calls, all time`, "", ...table(t.rows, (n) => (n === 1 ? "call" : "calls"))]);
}

function renderHeadline(bp: Stats["builderProfile"]): string {
  const sub = bp.headline.startsWith("I'm") ? " <sub>(commits + AI prompts on record)</sub>" : "";
  return `**${bp.headline}**${sub}`;
}

function renderProfile(bp: Stats["builderProfile"]): string {
  const events = (n: number) => (n === 1 ? "event" : "events");
  const all = [...bp.timeBuckets.map((r) => ({ ...r, label: `${TIME_BUCKET_EMOJI[r.label]} ${r.label}` })), ...bp.weekdays];
  const lines = table(all, events);
  lines.splice(bp.timeBuckets.length, 0, "");
  return fence(lines);
}

function renderBadges(urls: string[]): string {
  return urls
    .map((u) => {
      const slug = u.split("/").at(-2) ?? "";
      return `<img src="${u}" width="40" height="40" alt="${slug}"/>`;
    })
    .join(" ");
}

export function renderReadme(stats: Stats): string {
  const updated = new Date(stats.generatedAt).toLocaleString("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const replacements: Record<string, string> = {
    "{{CLAUDE_WEEK}}": renderWeek(stats.claudeWeek),
    "{{CLAUDE_ALL_TIME}}": renderAllTime(stats.claudeAllTime),
    "{{TOP_TOOLS}}": renderTools(stats.topTools),
    "{{BUILDER_HEADLINE}}": renderHeadline(stats.builderProfile),
    "{{BUILDER_PROFILE}}": renderProfile(stats.builderProfile),
    "{{BADGES}}": renderBadges(stats.badges),
    "{{LAST_UPDATED}}": `Last updated ${updated}`,
  };
  let out = readFileSync(TEMPLATE_PATH, "utf8");
  for (const [k, v] of Object.entries(replacements)) out = out.replaceAll(k, v);
  return out;
}
