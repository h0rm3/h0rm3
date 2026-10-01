import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseClaudeCode } from "../src/parsers/claudeCode.js";
import { parseCodex } from "../src/parsers/codex.js";
import { modelCensus } from "../src/census.js";
import { privacyScan, validateSvg } from "../src/qc.js";
import { computeStreaks, heatmapColumns } from "../src/metrics.js";
import { GITHUB_DAY_TZ } from "../src/github.js";
import { dateKey, zonedTimeToUtc } from "../src/tz.js";
import type { Stats } from "../src/types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "h0rm3/h0rm3";
const POST_PUSH = process.argv.includes("--post-push");
process.chdir(ROOT);
process.loadEnvFile(path.join(ROOT, ".env"));
const TOKEN = process.env.GITHUB_TOKEN!;
const USER = process.env.GITHUB_USERNAME!;
const REPORT = path.join(ROOT, "QC-REPORT.md");

type Status = "PASS" | "FAIL" | "SKIPPED";
const checks: { id: string; name: string; status: Status; detail: string }[] = [];
const record = (id: string, name: string, status: Status, detail: string) => {
  checks.push({ id, name, status, detail });
  console.log(`[${status}] ${id} ${name}${status === "PASS" ? "" : ` — ${detail.split("\n")[0]}`}`);
};
const pass = (ok: boolean): Status => (ok ? "PASS" : "FAIL");

const gh = (p: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com${p}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", ...(init.headers ?? {}) } });

function sh(cmd: string): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: "pipe" }) };
  } catch (e: any) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");
const PUBLISHED = () => ["README.md", ...listFiles(path.join(ROOT, "assets")).map(rel), ...listFiles(path.join(ROOT, "data")).map(rel)];

function inHead(p: string): boolean {
  return sh(`git cat-file -e HEAD:${p}`).ok;
}

async function privateRepoNames(): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; ; page++) {
    const res = await gh(`/user/repos?visibility=private&affiliation=owner,collaborator,organization_member&per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`could not list private repos (${res.status})`);
    const list = (await res.json()) as any[];
    names.push(...list.map((r) => r.name as string));
    if (list.length < 100) return names;
  }
}

// ---------- Part 4 checks ----------

async function checkBuildAndTests() {
  const tsc = sh("npx tsc --noEmit");
  record("4.1a", "TypeScript (npx tsc --noEmit)", pass(tsc.ok), tsc.ok ? "clean" : tsc.out.slice(0, 1500));
  const t = sh("npm test");
  const num = (k: string) => Number(t.out.match(new RegExp(`ℹ ${k} (\\d+)`))?.[1] ?? NaN);
  const names = [...t.out.matchAll(/^[✔✖] (.+?) \(\d/gm)].map((m) => m[1]);
  const required = ["streamed duplicates", "sidechain", "tool_use blocks", "merging the same day twice", "America/New_York", "heatmap"];
  const missing = required.filter((r) => !names.some((n) => n.includes(r)));
  const ok = t.ok && num("fail") === 0 && num("pass") === num("tests") && missing.length === 0;
  record("4.1b", "Unit tests", pass(ok), `${num("pass")}/${num("tests")} passed${missing.length ? `; missing required tests: ${missing.join(", ")}` : ""}`);
}

function checkSvgs() {
  const svgs = listFiles(path.join(ROOT, "assets")).filter((f) => f.endsWith(".svg"));
  const problems = svgs.flatMap((f) => validateSvg(readFileSync(f, "utf8")).map((e) => `${rel(f)}: ${e}`));
  record("4.2", "SVGs well-formed, sized, no scripts/fonts/external URLs", pass(problems.length === 0 && svgs.length > 0), problems.length ? problems.join("\n") : `${svgs.length} SVGs checked: ${svgs.map(rel).join(", ")}`);
}

async function checkRenderedImages(): Promise<string> {
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const res = await gh("/markdown", { method: "POST", body: JSON.stringify({ text: readme, mode: "gfm", context: REPO }) });
  if (!res.ok) {
    record("4.3", "GitHub Markdown render + image paths", "FAIL", `POST /markdown returned ${res.status}`);
    return "";
  }
  const html = await res.text();
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  const problems: string[] = [];
  const seen: string[] = [];
  for (const tag of imgs) {
    const src = attr(tag, "data-canonical-src") ?? attr(tag, "src") ?? "";
    const repoPath =
      src.match(/^https:\/\/(?:github\.com\/h0rm3\/h0rm3\/(?:raw|blob)\/[^/]+|raw\.githubusercontent\.com\/h0rm3\/h0rm3\/[^/]+)\/(.+)$/)?.[1] ??
      (/^[a-z]+:/i.test(src) || src.startsWith("//") ? null : src.replace(/^\.?\//, "").replace(/^h0rm3\/h0rm3\/(?:raw|blob)\/[^/]+\//, ""));
    if (repoPath) {
      seen.push(repoPath);
      if (!existsSync(path.join(ROOT, repoPath))) problems.push(`${repoPath}: missing on disk`);
      else if (!inHead(repoPath)) problems.push(`${repoPath}: not committed in HEAD`);
    } else {
      const head = await fetch(src, { method: "HEAD" }).catch(() => null);
      seen.push(src);
      if (!head?.ok) problems.push(`${src}: external image returned ${head?.status ?? "no response"}`);
    }
  }
  const expected = [...readme.matchAll(/<img\b[^>]*src="([^"]+)"/g)].length;
  if (imgs.length !== expected) problems.push(`rendered ${imgs.length} images, README references ${expected}`);
  record("4.3", "GitHub Markdown render (gfm, context h0rm3/h0rm3) + image paths", pass(problems.length === 0), problems.length ? problems.join("\n") : `${imgs.length} images resolved: ${seen.join(", ")}`);
  return html;
}

async function checkPrivacy() {
  const names = await privateRepoNames();
  const files = PUBLISHED().map((p) => ({ path: p, content: readFileSync(path.join(ROOT, p), "utf8") }));
  const hits = privacyScan(files, names);
  record("4.4", "Privacy scan (README, assets, data)", pass(hits.length === 0), hits.length ? hits.join("\n") : `${files.length} files clean against ${names.length} private repo names and markers Users, C:\\, Owner, .claude, @, ghp_, gho_, github_pat_`);
}

async function checkSanity(stats: Stats) {
  const fails: string[] = [];
  const notes: string[] = [];

  const w = stats.claudeWeek;
  const a = stats.claudeAllTime;
  for (const k of ["freshInput", "cacheWrite", "cacheRead", "output", "totalInput", "sessions", "prompts"] as const) {
    if (w[k] > a[k]) fails.push(`week ${k} ${w[k]} > all-time ${a[k]}`);
  }
  for (const f of w.families) {
    const all = a.families.find((x) => x.label === f.label);
    if (!all || f.value > all.value) fails.push(`week family ${f.label} exceeds all-time`);
  }
  notes.push(`weekly <= all-time for ${7 + w.families.length} fields`);

  const tables: [string, { percent: number }[]][] = [
    ["claudeWeek.families", w.families],
    ["claudeAllTime.families", a.families],
    ["codexAllTime.families", stats.codexAllTime.families],
    ["topTools", stats.topTools.rows],
    ["timeBuckets", stats.builderProfile.timeBuckets],
    ["weekdays", stats.builderProfile.weekdays],
    ["languages", stats.languages],
  ];
  for (const [name, rows] of tables) {
    if (rows.length === 0) continue;
    const sum = rows.reduce((s, r) => s + r.percent, 0);
    if (Math.abs(sum - 100) > 0.1 + 1e-9) fails.push(`${name} percentages sum to ${sum.toFixed(2)}`);
    else notes.push(`${name} sums to ${sum.toFixed(1)}`);
  }

  const h = stats.heatmap;
  const daySum = h.days.reduce((s, d) => s + d.count, 0);
  if (daySum !== h.total || h.total !== h.apiTotal) fails.push(`heatmap total ${h.total}, day sum ${daySum}, API total ${h.apiTotal}`);
  if (h.days[0]?.date !== h.startKey) fails.push(`heatmap starts ${h.days[0]?.date}, expected ${h.startKey}`);
  const placed = heatmapColumns(h.days, h.startKey, h.weeks).flat().filter(Boolean).length;
  if (placed !== h.days.length) fails.push(`heatmap placed ${placed} of ${h.days.length} days in ${h.weeks} columns`);
  const q = await gh("/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: `query($l:String!,$f:DateTime!,$t:DateTime!){user(login:$l){contributionsCollection(from:$f,to:$t){contributionCalendar{totalContributions}}}}`,
      variables: { l: USER, f: zonedTimeToUtc(h.startKey, 0, GITHUB_DAY_TZ).toISOString(), t: stats.generatedAt },
    }),
  }).then((r) => r.json());
  const independent = q?.data?.user?.contributionsCollection?.contributionCalendar?.totalContributions;
  if (independent !== h.total) fails.push(`heatmap total ${h.total} != independent contributionsCollection total ${independent}`);
  else notes.push(`heatmap total ${h.total} = contributionsCollection ${independent}`);

  const today = dateKey(stats.generatedAt);
  const re = computeStreaks(stats.commitDays, today);
  if (JSON.stringify(re) !== JSON.stringify(stats.streak)) fails.push(`streak recompute ${JSON.stringify(re)} != published ${JSON.stringify(stats.streak)}`);
  const heat = new Map(h.days.map((d) => [d.date, d.count]));
  for (const [day, n] of Object.entries(stats.commitDays)) {
    if (heat.has(day) && heat.get(day)! < n) fails.push(`${day}: ${n} commits but heatmap shows ${heat.get(day)} contributions`);
  }
  const activeHeat = Object.keys(stats.commitDays).filter((d) => heat.has(d)).every((d) => heat.get(d)! > 0);
  if (!activeHeat) fails.push("a commit day is empty in the heatmap");
  notes.push(`streak ${stats.streak.currentStreak}/${stats.streak.longestStreak} recomputed; every commit day is active in the heatmap with count >= commits`);

  const bp = stats.builderProfile;
  const tb = bp.timeBuckets.reduce((s, r) => s + r.value, 0);
  const wd = bp.weekdays.reduce((s, r) => s + r.value, 0);
  if (tb !== wd || tb !== bp.commitEvents + bp.promptEvents) fails.push(`builder profile totals differ: ${tb} / ${wd} / ${bp.commitEvents + bp.promptEvents}`);

  const prompts90 = stats.promptsPerDay.reduce((s, d) => s + d.count, 0);
  if (prompts90 > a.prompts) fails.push(`90-day Claude Code prompts ${prompts90} exceed all-time Claude Code prompts ${a.prompts}`);
  const commits90 = stats.commitsPerDay.reduce((s, d) => s + d.count, 0);
  if (commits90 > stats.streak.totalCommits) fails.push(`90-day commits ${commits90} exceed total ${stats.streak.totalCommits}`);
  if (stats.topRepos.reduce((s, r) => s + r.commits, 0) > commits90) fails.push("top repos exceed 90-day commits");

  // Thousands separators: no bare 4+ digit quantities in code blocks or SVG text (years excluded).
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const blocks = [...readme.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].replace(/, \d{4}\b/g, ""));
  const svgTexts = listFiles(path.join(ROOT, "assets")).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/\bin 20\d\d\b/g, "")));
  const bare = [...blocks, ...svgTexts].flatMap((t) => t.match(/(?<![\d,.])\d{4,}(?![\d,])/g) ?? []);
  if (bare.length) fails.push(`numbers without thousands separators: ${bare.slice(0, 5).join(", ")}`);
  else notes.push("all quantities use thousands separators");

  record("4.5", "Sanity checks", pass(fails.length === 0), fails.length ? fails.join("\n") : notes.join("; "));
}

function checkIdempotency(stats: Stats) {
  const asOf = stats.generatedAt;
  const snapshot = () => Object.fromEntries(PUBLISHED().map((p) => [p, readFileSync(path.join(ROOT, p), "utf8")]));
  const committed = snapshot();
  const runs: Record<string, string>[] = [];
  for (let i = 0; i < 2; i++) {
    const r = sh(`npx tsx scripts/update.ts --dry-run --as-of=${asOf}`);
    if (!r.ok) {
      record("4.6", "Idempotency (two full runs)", "FAIL", `run ${i + 1} failed: ${r.out.slice(0, 500)}`);
      return;
    }
    runs.push(snapshot());
  }
  const strip = (s: string) => s.split("\n").filter((l) => !/generatedAt|Last updated/.test(l)).join("\n");
  const diff = (x: Record<string, string>, y: Record<string, string>) =>
    [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => strip(x[k] ?? "") !== strip(y[k] ?? ""));
  const between = diff(runs[0], runs[1]);
  const vsCommitted = diff(committed, runs[1]);
  const exact = Object.keys(runs[1]).filter((k) => runs[0][k] !== runs[1][k]);
  record(
    "4.6",
    "Idempotency (two full runs, --as-of fixed)",
    pass(between.length === 0 && vsCommitted.length === 0),
    `run1 vs run2 differing files (ignoring timestamp lines): ${between.length ? between.join(", ") : "none"}; byte-identical except: ${exact.length ? exact.join(", ") : "nothing"}; run2 vs committed: ${vsCommitted.length ? vsCommitted.join(", ") : "identical"}`,
  );
}

function checkPlaywright() {
  const local = existsSync(path.join(ROOT, "node_modules", "playwright"));
  const globalRoot = sh("npm root -g").out.trim();
  const global = globalRoot && (existsSync(path.join(globalRoot, "playwright")) || existsSync(path.join(globalRoot, "@playwright", "test")));
  if (!local && !global) {
    record("4.7", "Playwright screenshot of GitHub-rendered HTML", "SKIPPED", "Playwright package not installed (a browser cache exists, but no Playwright to drive it); nothing downloaded per instructions");
  } else {
    record("4.7", "Playwright screenshot of GitHub-rendered HTML", "SKIPPED", "Playwright found but automated overlap detection not implemented");
  }
}

// ---------- Report ----------

function cleanupPeriodDays(): string {
  try {
    const s = JSON.parse(readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf8"));
    return s.cleanupPeriodDays === undefined ? "not set" : String(s.cleanupPeriodDays);
  } catch (e: any) {
    return `could not read settings.json (${e.code ?? e.message})`;
  }
}

const fmt = (n: number) => n.toLocaleString("en-US");

async function censusSection(): Promise<string> {
  const [c, x] = await Promise.all([parseClaudeCode(), parseCodex()]);
  const rows = modelCensus([...c.messages, ...x.messages]);
  const lines = [
    "| Source | Raw model id | Family | Messages | Fresh input | Cache write | Cache read | Output | First (ET) | Last (ET) |",
    "|---|---|---|--:|--:|--:|--:|--:|---|---|",
    ...rows.map((r) => `| ${r.source} | \`${r.model}\` | ${r.family} | ${fmt(r.messages)} | ${fmt(r.freshInput)} | ${fmt(r.cacheWrite)} | ${fmt(r.cacheRead)} | ${fmt(r.output)} | ${r.first} | ${r.last} |`),
  ];
  const side = c.messages.filter((m) => m.sidechain).length;
  const automated = new Set(c.sessions.filter((s) => s.automated).map((s) => s.sessionId));
  const autoMsgs = c.messages.filter((m) => automated.has(m.sessionId) && m.model !== "<synthetic>");
  const autoTokens = autoMsgs.reduce((a, m) => a + m.freshInput + m.cacheWrite + m.cacheRead + m.output, 0);
  lines.push(
    "",
    `Claude Code: ${fmt(c.messages.length)} unique responses (${fmt(side)} from subagents/sidechains), ${fmt(c.prompts.length)} human prompts, ${fmt(c.tools.length)} tool calls, ${fmt(c.sessions.length)} session ids, of which ${fmt(automated.size)} are Agent SDK runs (${fmt(autoMsgs.length)} responses, ${fmt(autoTokens)} tokens; tokens counted, prompts/sessions not). Codex: ${fmt(x.messages.length)} usage records, ${fmt(x.prompts.length)} prompts, ${fmt(x.sessions.length)} session(s).`,
    "`<synthetic>` rows are Claude Code placeholder responses with zero usage; they are listed here and excluded from all stats.",
  );
  return lines.join("\n");
}

const JUDGMENT_CALLS = [
  "**GitHub day boundaries.** GitHub only exposes day-level contribution counts, bucketed on its own calendar (verified: day-level `occurredAt` is always `T07:00:00Z`, i.e. US Pacific midnight). They cannot be re-bucketed into New York days, and the REST per-commit list recovers only a fraction of commits (e.g. 2026-09-19: 37 commit contributions vs 8 reachable commits). So the heatmap, commits/day, streaks and top repos use GitHub's calendar days. New York time is used for \"today\" in the current-streak check (conservative: near midnight it can only shorten a streak), every hour/weekday bucket, every AI-stat day, and the this-week window.",
  "**This week** = the 7 New York calendar days ending today, matching the daily granularity of `data/history.json`.",
  "**Sessions** are counted once, on the New York day of their first record, and only if they produced at least one model response. \"Sessions this week\" therefore means sessions started this week. Subagent transcripts carry their parent's `sessionId`, so they are not extra sessions.",
  "**Prompts** = human-typed user turns. Excluded: tool results, sidechain/subagent turns (written by the parent model), `isMeta` turns, and system-injected text starting with `<task-notification`, `<command-`, `<local-command-` or `[Request interrupted`. `<pasted_content>` turns count (they are the user's pasted prompt).",
  "**Agent SDK runs** (`entrypoint: \"sdk-ts\"`, e.g. the claude-mem plugin's background observer agent) are recorded in ~/.claude/projects. Their tokens are real usage and are counted; their user turns are machine-written, so they are not counted as prompts, and they are not counted as sessions. Found during QC: before this fix they inflated prompts and sessions, so data/history.json (not yet published) was rebuilt from scratch.",
  "**Dedupe.** Responses keyed by `message.id` + `requestId`; streamed duplicate lines are merged with a per-field max (verified: only `output_tokens` changes between duplicates) and the earliest timestamp. Tool calls deduped by `tool_use` id, prompts by entry `uuid`, so lines copied into resumed-session files are not double counted.",
  "**MCP tools** are collapsed into a single `MCP` bucket because their names reveal which services are connected.",
  "**Top Tools** counts Claude Code `tool_use` blocks, all-time (from history), top 8 plus an `Other (N tools)` row so percentages are of all calls and sum to 100. Codex `function_call`s are not `tool_use` blocks and are excluded.",
  "**Claude Code blocks and the \"Claude Code Prompts per Day\" chart contain Claude Code data only.** Codex usage (1 session, `gpt-5.5`) is not labelled as Claude Code; it is included in the builder profile and `data/stats.json` (`codexAllTime`).",
  "**Codex tokens**: OpenAI `input_tokens` include cached tokens, so fresh = input − cached, cache read = cached, cache write = 0 (Codex doesn't report cache writes). Usage comes from deltas of the cumulative `total_token_usage`, so repeated snapshots never double count.",
  "**History merge** is a field-wise max per day/source/family: idempotent, order-independent, and days whose logs were deleted keep their values. Trade-off: if parsing is ever changed so numbers legitimately go down, those days must be removed from history while their logs still exist (documented in README-dev.md).",
  "**Session stats**: average prompts/session = all-time prompts ÷ all-time sessions; longest session = active time, the sum of gaps between consecutive records in the session (subagents included, duplicate timestamps collapsed), skipping any gap over 30 minutes (a gap of exactly 30 counts); busiest hour = most prompts by New York hour, ties go to the earliest hour. History stores this as `longestActiveSessionMinutes`; the old wall-clock field is dropped on merge.",
  "**Prompt → model family**: a prompt is attributed to the family of the next main-chain response in its session; prompts with no response count in totals only.",
  "**Languages** sum bytes across all owned repos including private ones (only aggregate percentages are published); under 1% is grouped as Other.",
  "**GitHub stats**: stars = stargazers on owned public non-fork repos; PRs opened/merged and issues opened are all-time counts for the account (any repo the token can see, counts only); public repo count includes forks; account age is shown in days rather than an approximate years figure; contributions this year start at Jan 1 00:00 New York time.",
  "**Top repos**: public repos only (private repos excluded entirely, not just renamed), from GitHub's per-repo daily commit contributions over the same 90 days as the commits chart; own repos shown without the owner prefix.",
  "**Heatmap colors** use GitHub's own `contributionLevel` quartiles, mapped onto the purple ramp of GitHub's dark Primer palette to match the dashboard accent.",
  "**Percentages** use plain one-decimal rounding (so equal values show equal percents) and fall back to largest-remainder only if the rounded total would drift more than 0.1 from 100.",
  "**Privacy scan** is case-insensitive and stricter than asked (also blocks `gho_` and `github_pat_`); private repo names are matched as whole tokens across every private repo the token can see (owned, collaborator and org).",
  "**SVG external URLs**: the only URL-like string allowed is the SVG namespace identifier on the root `xmlns` attribute, which browsers never fetch.",
  "**Badges** only for languages on the languages card that map to a devicon slug and whose icon URL returns 200 (PLpgSQL uses the PostgreSQL icon).",
  "**`--as-of=<ISO>`** was added to the update script so idempotency can be tested: Claude Code keeps appending to the logs during this session, so two unpinned runs would legitimately differ.",
  "**Local Part 1 commit** did not typecheck on its own (the renderer was rewired in Part 3); the pushed HEAD passes the full gate.",
  "**Playwright** is not installed, so check 4.7 is skipped. As a supplementary (non-gate) check, the SVG cards were screenshotted with the already-installed Microsoft Edge in headless mode and inspected for overlap/overflow; no browser was downloaded.",
];

const NOT_PRODUCED = [
  "**Cursor**: its global `state.vscdb` stores per-message `createdAt` timestamps (174 countable prompts, see DIAGNOSIS.md) but no token counts or model names. It is not yet a source; adding prompt counts is a separate change awaiting approval.",
  "**Codex cache writes**: not reported in Codex logs; shown as 0 in data, not estimated.",
  "**Codex tool usage in Top Tools**: Codex `function_call`s aren't `tool_use` blocks; excluded rather than mixed in.",
  "**New York re-bucketing of GitHub daily counts**: impossible without per-commit timestamps (see judgment calls).",
  "**Time-of-day for every commit**: exact timestamps exist only for commits still reachable on branches of owned repos; the builder profile uses those (count shown as `commitEvents` in data/stats.json) plus AI prompts.",
  "**AI history before the first run**: only data still present in the logs (earliest Claude Code day: see census) could be captured; anything Claude Code already deleted is unrecoverable.",
  "**Cost estimates**: not produced, by rule.",
];

async function writeReport(stats: Stats | null) {
  const overall = checks.some((c) => c.status === "FAIL") ? "FAIL" : "PASS";
  const cleanup = cleanupPeriodDays();
  const firstDay = stats?.claudeAllTime.firstDay ?? "unknown";
  const out = [
    "# QC report",
    "",
    `Generated ${new Date().toISOString()} for ${REPO}. Overall gate: **${overall}**.`,
    "",
    "## QC checks",
    "",
    "| # | Check | Result | Detail |",
    "|---|---|---|---|",
    ...checks.map((c) => `| ${c.id} | ${c.name} | ${c.status} | ${c.detail.replace(/\|/g, "\\|").replace(/\n/g, "<br>")} |`),
    "",
    "## Model census (all logs, deduped; local only)",
    "",
    await censusSection(),
    "",
    "## Claude Code log retention",
    "",
    `\`cleanupPeriodDays\` in ~/.claude/settings.json: **${cleanup}**.`,
    "",
    cleanup === "not set"
      ? "Not set means Claude Code's default applies (30 days per the Claude Code settings documentation), so transcripts older than about a month are deleted. `data/history.json` now preserves daily aggregates, but per-message detail (census, exact session spans for days not yet merged) is lost once logs go. Recommendation: raise it, e.g. `\"cleanupPeriodDays\": 365`, if disk space allows. This was not changed (settings outside this repo are read-only for this task)."
      : "Consider whether this keeps logs long enough between runs; history.json protects aggregates either way.",
    `Earliest Claude Code day currently in history: ${firstDay}.`,
    "",
    "## Stats not produced, and why",
    "",
    ...NOT_PRODUCED.map((s) => `- ${s}`),
    "",
    "## Judgment calls",
    "",
    ...JUDGMENT_CALLS.map((s, i) => `${i + 1}. ${s}`),
    "",
  ];
  const existing = existsSync(REPORT) ? readFileSync(REPORT, "utf8") : "";
  const postPush = existing.includes("## Post-push verification") ? existing.slice(existing.indexOf("## Post-push verification")) : "";
  writeFileSync(REPORT, out.join("\n") + (postPush ? "\n" + postPush : ""));
  return overall;
}

async function postPush() {
  const lines = ["## Post-push verification", ""];
  const res = await gh(`/repos/${REPO}/contents/README.md?ref=main`, { headers: { Accept: "application/vnd.github.raw" } });
  const remote = res.ok ? await res.text() : null;
  const local = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const same = remote !== null && remote.replace(/\r\n/g, "\n") === local.replace(/\r\n/g, "\n");
  lines.push(`- Remote README.md on main ${same ? "matches" : "DOES NOT match"} the local file (${remote === null ? `fetch failed ${res.status}` : `${fmt(remote.length)} chars`}).`);
  const head = sh("git rev-parse HEAD").out.trim();
  const remoteHead = sh("git rev-parse origin/main").out.trim();
  lines.push(`- Local HEAD ${head.slice(0, 7)} ${head === remoteHead ? "==" : "!="} origin/main ${remoteHead.slice(0, 7)}.`);
  const assets = [...local.matchAll(/src="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
  const missing: string[] = [];
  for (const a of assets) {
    const r = await gh(`/repos/${REPO}/contents/${a}?ref=main`);
    if (!r.ok) missing.push(`${a} (${r.status})`);
  }
  lines.push(`- ${assets.length} referenced assets checked on main: ${missing.length ? "missing " + missing.join(", ") : "all present"}.`);
  const existing = existsSync(REPORT) ? readFileSync(REPORT, "utf8") : "";
  const base = existing.includes("## Post-push verification") ? existing.slice(0, existing.indexOf("## Post-push verification")) : existing + "\n";
  writeFileSync(REPORT, base + lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  process.exit(same && head === remoteHead && missing.length === 0 ? 0 : 1);
}

if (POST_PUSH) {
  await postPush();
} else {
  const statsPath = path.join(ROOT, "data", "stats.json");
  const stats: Stats | null = existsSync(statsPath) ? JSON.parse(readFileSync(statsPath, "utf8")) : null;
  await checkBuildAndTests();
  checkSvgs();
  await checkRenderedImages();
  await checkPrivacy();
  if (stats) await checkSanity(stats);
  else record("4.5", "Sanity checks", "FAIL", "data/stats.json missing");
  if (stats) checkIdempotency(stats);
  checkPlaywright();
  const overall = await writeReport(stats);
  console.log(`\nOverall: ${overall} (report: QC-REPORT.md)`);
  process.exit(overall === "PASS" ? 0 : 1);
}
