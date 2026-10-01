# Developer notes

This repo generates `README.md` (this profile's homepage) from real GitHub + local AI-tool
usage data. Nothing in `README.md` or `assets/*.svg` is hand-edited — running `npm run update`
regenerates and overwrites all of it.

## Files

```
src/
  types.ts            Shared data shapes (Stats, AiTurn, AiPrompt, CommitRecord, ...)
  normalize.ts         Raw model id -> family (Opus/Sonnet/Haiku/Fable/GPT/...)
  dateUtils.ts          Local-timezone date-key helpers shared by github.ts and metrics.ts
  github.ts             GitHub REST + GraphQL: repos, language bytes, commits, daily commit counts
  metrics.ts            All the derived numbers: streaks, time/weekday buckets, AI-week totals
  parsers/
    claudeCode.ts        Reads ~/.claude/projects/**/*.jsonl
    codex.ts              Reads ~/.codex/sessions/**/*.jsonl
  render/
    theme.ts              Shared SVG colors + helpers
    cards.ts               languages.svg / streak.svg / commits.svg generators
    readme.ts               Fills templates/README.template.md with computed stats

scripts/
  update.ts              Orchestrator: fetch -> compute -> render -> write -> git commit/push
  install-task.ps1        Registers the Windows Task Scheduler job

templates/README.template.md   The editable surrounding text; code owns everything between {{PLACEHOLDERS}}
data/stats.json                 Every computed number from the most recent run (history is just git log on this file)
assets/*.svg                     Generated chart/card images, committed so they render on GitHub
test/*.test.ts                    Unit tests (node:test) for the logic most likely to have edge cases
```

## Running it

```
npm install
cp .env.example .env   # fill in GITHUB_TOKEN (scopes: repo, read:user) and GITHUB_USERNAME
npm run update          # regenerates everything and commits+pushes if anything changed
npm run update:dry      # same, but never touches git
npm test
```

## Adding a new AI tool source

1. Add a parser in `src/parsers/yourTool.ts` that returns `{ turns: AiTurn[], prompts: AiPrompt[] }`
   (see `claudeCode.ts` / `codex.ts` for the shape). Read the tool's actual on-disk logs — don't
   guess field names.
2. If the tool has its own model-naming scheme, add substring matches to `KNOWN_FAMILIES` in
   `src/normalize.ts`.
3. In `scripts/update.ts`, import your parser and spread its `turns`/`prompts` into the arrays
   passed to `buildStats()` alongside Claude Code and Codex.
4. Everything downstream (the weekly token table, builder profile, tests) works automatically —
   it only ever consumes the normalized `AiTurn`/`AiPrompt` shape, never a tool-specific one.

Cursor was investigated and skipped: it has no locally-readable token/usage data (only an
unrelated conversation-search SQLite index), so there's nothing to parse there.

## Changing colors

Everything lives in `COLORS` and `PALETTE` at the top of `src/render/theme.ts`. `COLORS` drives
card background/border/text/accent; `PALETTE` is the cycling list of segment colors for the
languages stacked bar. Re-run `npm run update:dry` and open the SVGs to preview.

## Automation

`scripts/install-task.ps1` registers a Windows Task Scheduler job (`h0rm3-profile-stats-update`)
that runs `npm run update` daily at 11:30 PM and again at logon. Install it with:

```
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
```
