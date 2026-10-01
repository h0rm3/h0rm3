# Developer notes

`npm run update` regenerates `README.md`, `assets/*.svg` and `data/*.json` from the GitHub API and
local Claude Code / Codex logs, runs the SVG + privacy guard, then commits and pushes to `main` only
if something changed. Nothing generated is hand-edited.

## Files

```
src/
  tz.ts               America/New_York date keys, hours, and zone<->UTC conversion (all bucketing goes through here)
  types.ts            Shared shapes: parsed logs, history, published Stats
  normalize.ts        Raw model id -> family (Opus/Sonnet/Haiku/Fable/GPT/raw id)
  parsers/
    claudeCode.ts     ~/.claude/projects/**/*.jsonl incl. subagents; dedupe by message id + requestId
    codex.ts          ~/.codex/sessions/**/*.jsonl; usage from cumulative token_count deltas
  history.ts          Per-NY-day aggregates + idempotent max-merge into data/history.json
  metrics.ts          Pure calculations: streaks, buckets, percentages, AI blocks, tools, heatmap layout
  github.ts           REST + GraphQL fetches (languages, commits, contributions, profile stats)
  stats.ts            Assembles the published Stats object (aggregate numbers only)
  badges.ts           Language -> devicon badge, only if the icon URL resolves
  census.ts           Per-raw-model census for the local QC report
  qc.ts               XML well-formedness, SVG safety and privacy checks
  render/
    theme.ts          Every color, font, size and padding used by the SVG cards
    cards.ts          All SVG cards
    readme.ts         Fills templates/README.template.md
scripts/
  update.ts           Orchestrator (--dry-run, --as-of=<ISO> for deterministic re-runs)
  qc.ts               Full QC gate; writes QC-REPORT.md (gitignored)
  install-task.ps1    Optional Windows Task Scheduler job (not installed automatically)
templates/README.template.md   Layout; code fills the {{PLACEHOLDERS}}
data/history.json              Daily AI aggregates that survive Claude Code's log cleanup
data/stats.json                Everything shown in the README, from the latest run
test/*.test.ts                 node:test unit tests
```

## Running it

```
npm install
cp .env.example .env    # GITHUB_TOKEN (scopes: repo, read:user) and GITHUB_USERNAME
npm run update:dry       # generate files only
npm run qc               # full QC gate + QC-REPORT.md
npm run update           # generate, guard, commit, push
npm test
```

## History

Claude Code deletes transcripts older than `cleanupPeriodDays`. Each run aggregates the logs per New
York day and merges them into `data/history.json` with a field-wise max, so days whose logs were
deleted keep their numbers and re-running never double counts. All-time numbers are summed from
history. If you ever change parsing so that numbers legitimately go *down*, delete the affected days
from `data/history.json` while their logs still exist, then re-run.

## Adding an AI tool source

1. Add `src/parsers/yourTool.ts` returning `ParsedLogs` (messages, prompts, tools, sessions). Read the
   real logs first; don't guess field names.
2. Add the source name to `Source` in `src/types.ts` and aggregate it in `scripts/update.ts`
   (`aggregateDays("your-tool", logs)`).
3. Add family substrings to `src/normalize.ts` if needed, and decide where it should be displayed.

Cursor has no locally readable token/usage data, so it is not a source.

## Changing colors

Edit `COLORS`, `PALETTE` and `HEAT_LEVELS` in `src/render/theme.ts`, then `npm run update:dry`.
