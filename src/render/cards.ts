import type { HeatmapDay, Stats } from "../types.js";
import { heatmapColumns } from "../metrics.js";
import {
  COLORS,
  FULL_W,
  HALF_H,
  HALF_W,
  HEAT_LEVELS,
  PAD,
  PALETTE,
  SMALL_SIZE,
  card,
  fmt,
  line,
  rect,
  text,
  truncate,
} from "./theme.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(8, 10))}`;

export function renderLanguages(rows: Stats["languages"]): string {
  const barY = 46;
  const barH = 16;
  const barW = HALF_W - 2 * PAD;
  let x = PAD;
  const segments = rows.map((r, i) => {
    const w = (r.percent / 100) * barW;
    const s = rect(x, barY, w, barH, PALETTE[i % PALETTE.length]);
    x += w;
    return s;
  });

  // Fixed card height: more languages means more columns, never a taller card.
  const legendY = barY + barH + 22;
  const rowH = 16;
  const rowsPerCol = Math.max(1, Math.floor((HALF_H - PAD - legendY + rowH) / rowH));
  const cols = Math.max(2, Math.ceil(rows.length / rowsPerCol));
  const colW = barW / cols;
  const legend = rows.flatMap((r, i) => {
    const lx = PAD + Math.floor(i / rowsPerCol) * colW;
    const ly = legendY + (i % rowsPerCol) * rowH;
    return [rect(lx, ly - 8, 8, 8, PALETTE[i % PALETTE.length], 2), text(lx + 13, ly, `${r.label} ${r.percent.toFixed(1)}%`, { size: SMALL_SIZE + 1 })];
  });

  const body = rows.length
    ? [`<clipPath id="lang-bar"><rect x="${PAD}" y="${barY}" width="${barW}" height="${barH}" rx="4"/></clipPath>`, `<g clip-path="url(#lang-bar)">`, ...segments, `</g>`, ...legend]
    : [text(PAD, 70, "No language data", { fill: COLORS.muted })];
  return card(HALF_W, HALF_H, "Languages", body);
}

export function renderStreak(streak: Stats["streak"]): string {
  const colW = HALF_W / 3;
  const items: [string, number, string][] = [
    ["Total Commits", streak.totalCommits, "all time"],
    ["Current Streak", streak.currentStreak, streak.currentStreak === 1 ? "day" : "days"],
    ["Longest Streak", streak.longestStreak, streak.longestStreak === 1 ? "day" : "days"],
  ];
  const body = items.flatMap(([label, value, unit], i) => {
    const cx = colW * i + colW / 2;
    return [
      i > 0 ? line(colW * i, 52, colW * i, 142, COLORS.border) : "",
      text(cx, 98, fmt(value), { size: 30, weight: 700, fill: COLORS.accent, anchor: "middle" }),
      text(cx, 120, label, { anchor: "middle" }),
      text(cx, 136, unit, { size: SMALL_SIZE, fill: COLORS.muted, anchor: "middle" }),
    ];
  });
  return card(HALF_W, HALF_H, "Commit Streak", body.filter(Boolean));
}

export function renderHeatmap(h: Stats["heatmap"]): string {
  const cell = 11;
  const step = 14;
  const labelW = 30;
  const gridW = h.weeks * step - (step - cell);
  const x0 = PAD + Math.floor((FULL_W - 2 * PAD - labelW - gridW) / 2) + labelW;
  const y0 = 66;
  const cols = heatmapColumns(h.days, h.startKey, h.weeks);

  const cells: string[] = [];
  const months: string[] = [];
  let lastMonth = "";
  let lastLabelCol = -10;
  cols.forEach((col, w) => {
    col.forEach((d: HeatmapDay | null, row) => {
      if (d) cells.push(rect(x0 + w * step, y0 + row * step, cell, cell, HEAT_LEVELS[d.level] ?? HEAT_LEVELS[0], 2));
    });
    const first = col.find((d) => d !== null);
    const month = first ? first.date.slice(0, 7) : "";
    if (month && month !== lastMonth) {
      if (w - lastLabelCol >= 3) {
        months.push(text(x0 + w * step, y0 - 8, MONTHS[Number(month.slice(5, 7)) - 1], { size: SMALL_SIZE, fill: COLORS.muted }));
        lastLabelCol = w;
      }
      lastMonth = month;
    }
  });

  const dayLabels = [
    [1, "Mon"],
    [3, "Wed"],
    [5, "Fri"],
  ].map(([row, label]) => text(x0 - 6, y0 + (row as number) * step + 9, label as string, { size: SMALL_SIZE, fill: COLORS.muted, anchor: "end" }));

  const legendY = y0 + 7 * step + 16;
  const legendX = x0 + gridW - HEAT_LEVELS.length * step;
  const legend = [
    text(legendX - 6, legendY + 9, "Less", { size: SMALL_SIZE, fill: COLORS.muted, anchor: "end" }),
    ...HEAT_LEVELS.map((c, i) => rect(legendX + i * step, legendY, cell, cell, c, 2)),
    text(legendX + HEAT_LEVELS.length * step + 3, legendY + 9, "More", { size: SMALL_SIZE, fill: COLORS.muted }),
  ];
  const height = legendY + cell + PAD;
  return card(FULL_W, height, "Contributions", [...months, ...dayLabels, ...cells, ...legend], `${fmt(h.total)} contributions in the last 52 weeks`);
}

function lineChart(title: string, subtitle: string, data: { date: string; count: number }[]): string {
  const height = 220;
  const left = PAD + 28;
  const right = FULL_W - PAD;
  const top = 50;
  const bottom = height - 30;
  const max = Math.max(1, ...data.map((d) => d.count));
  const n = data.length;
  const xFor = (i: number) => left + (n > 1 ? (i / (n - 1)) * (right - left) : 0);
  const yFor = (v: number) => bottom - (v / max) * (bottom - top);

  const ticks = [...new Set([0, Math.round(max / 2), max])];
  const grid = ticks.flatMap((v) => [line(left, yFor(v), right, yFor(v), COLORS.grid, true), text(left - 8, yFor(v) + 4, fmt(v), { size: SMALL_SIZE, fill: COLORS.muted, anchor: "end" })]);
  const pts = data.map((d, i) => `${xFor(i).toFixed(2)},${yFor(d.count).toFixed(2)}`);
  const area = `<path d="M${xFor(0).toFixed(2)},${bottom} L${pts.join(" L")} L${xFor(n - 1).toFixed(2)},${bottom} Z" fill="${COLORS.accent}" fill-opacity="0.15"/>`;
  const stroke = `<path d="M${pts.join(" L")}" fill="none" stroke="${COLORS.accent}" stroke-width="2" stroke-linejoin="round"/>`;
  const xLabels = data
    .map((d, i) => (i % 15 === 0 || i === n - 1 ? text(xFor(i), height - 10, shortDate(d.date), { size: SMALL_SIZE, fill: COLORS.muted, anchor: i === n - 1 ? "end" : i === 0 ? "start" : "middle" }) : ""))
    .filter(Boolean);
  return card(FULL_W, height, title, [...grid, area, stroke, ...xLabels], subtitle);
}

export function renderCommits(data: Stats["commitsPerDay"]): string {
  const total = data.reduce((a, d) => a + d.count, 0);
  return lineChart("Commits per Day", `${fmt(total)} commits in the last 90 days`, data);
}

export function renderAiActivity(data: Stats["promptsPerDay"]): string {
  const total = data.reduce((a, d) => a + d.count, 0);
  return lineChart("Claude Code Prompts per Day", `${fmt(total)} prompts in the last 90 days`, data);
}

export function renderGitHubStats(g: Stats["github"]): string {
  const rows: [string, string][] = [
    [`Contributions in ${g.year}`, fmt(g.contributionsThisYear)],
    ["Pull requests opened", fmt(g.prsOpened)],
    ["Pull requests merged", fmt(g.prsMerged)],
    ["Issues opened", fmt(g.issuesOpened)],
    ["Stars received", fmt(g.starsReceived)],
    ["Public repos", fmt(g.publicRepos)],
    ["Account age", `${fmt(g.accountAgeDays)} days`],
  ];
  const body = rows.flatMap(([label, value], i) => {
    const y = 56 + i * 16;
    return [text(PAD, y, label), text(HALF_W - PAD, y, value, { weight: 600, anchor: "end" })];
  });
  return card(HALF_W, HALF_H, "GitHub Stats", body);
}

export function renderTopRepos(repos: Stats["topRepos"]): string {
  const max = Math.max(1, ...repos.map((r) => r.commits));
  const barX = 210;
  const barMaxW = 90;
  const body = repos.length
    ? repos.flatMap((r, i) => {
        const y = 58 + i * 22;
        return [
          text(PAD, y, truncate(r.name, 28)),
          rect(barX, y - 9, Math.max(2, (r.commits / max) * barMaxW), 10, COLORS.accent, 2),
          text(HALF_W - PAD, y, `${fmt(r.commits)} ${r.commits === 1 ? "commit" : "commits"}`, { anchor: "end" }),
        ];
      })
    : [text(PAD, 70, "No public commits in the last 90 days", { fill: COLORS.muted })];
  return card(HALF_W, HALF_H, "Top Repos", body, "last 90 days");
}
