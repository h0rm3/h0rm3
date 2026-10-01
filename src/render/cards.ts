import type { Stats } from "../types.js";
import { cardShell, COLORS, PALETTE, text } from "./theme.js";

export function renderLanguagesSvg(languages: Stats["languages"]): string {
  const width = 400;
  const height = 165;
  const barX = 20;
  const barY = 44;
  const barHeight = 18;
  const barWidth = width - 40;

  let x = barX;
  const segments = languages
    .map((lang, i) => {
      const w = (lang.percent / 100) * barWidth;
      const rect = `<rect x="${x.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barHeight}" fill="${PALETTE[i % PALETTE.length]}"/>`;
      x += w;
      return rect;
    })
    .join("\n  ");

  // Fixed card height regardless of how many languages pass the threshold: grow columns, not height.
  const legendY0 = barY + barHeight + 20;
  const legendAvailableHeight = height - 10 - legendY0;
  const rowHeight = 14;
  const maxRowsPerColumn = Math.max(1, Math.floor(legendAvailableHeight / rowHeight));
  const cols = Math.max(2, Math.ceil(languages.length / maxRowsPerColumn));
  const colWidth = (width - 40) / cols;

  const legend = languages
    .map((lang, i) => {
      const col = Math.floor(i / maxRowsPerColumn);
      const row = i % maxRowsPerColumn;
      const lx = barX + col * colWidth;
      const ly = legendY0 + row * rowHeight;
      const color = PALETTE[i % PALETTE.length];
      return `<rect x="${lx}" y="${ly - 8}" width="8" height="8" rx="2" fill="${color}"/>${text(lx + 13, ly, `${lang.name} ${lang.percent.toFixed(1)}%`, { size: 10 })}`;
    })
    .join("\n  ");

  const body = `
  <clipPath id="bar-clip"><rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="5"/></clipPath>
  <g clip-path="url(#bar-clip)">
  ${segments}
  </g>
  ${legend}`;

  return cardShell(width, height, "Languages", body);
}

export function renderStreakSvg(streak: Stats["streak"]): string {
  const width = 400;
  const height = 165;
  const colWidth = width / 3;
  const stats: [string, number][] = [
    ["Total Commits", streak.totalCommits],
    ["Current Streak", streak.currentStreak],
    ["Longest Streak", streak.longestStreak],
  ];

  const body = stats
    .map(([label, value], i) => {
      const cx = colWidth * i + colWidth / 2;
      const divider = i > 0 ? `<line x1="${(colWidth * i).toFixed(2)}" y1="50" x2="${(colWidth * i).toFixed(2)}" y2="135" stroke="${COLORS.border}"/>` : "";
      return `${divider}
  ${text(cx, 100, String(value), { size: 30, weight: 700, fill: COLORS.accent, anchor: "middle" })}
  ${text(cx, 122, label, { size: 11, anchor: "middle" })}`;
    })
    .join("\n  ");

  return cardShell(width, height, "Commit Streak", body);
}

export function renderCommitsSvg(commitsPerDay: Stats["commitsPerDay"]): string {
  const width = 760;
  const height = 220;
  const padLeft = 40;
  const padRight = 20;
  const padTop = 50;
  const padBottom = 30;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const counts = commitsPerDay.map((d) => d.count);
  const maxCount = Math.max(1, ...counts);
  const n = commitsPerDay.length;

  const xFor = (i: number) => padLeft + (n > 1 ? (i / (n - 1)) * plotWidth : 0);
  const yFor = (count: number) => padTop + plotHeight - (count / maxCount) * plotHeight;

  const linePoints = commitsPerDay.map((d, i) => `${xFor(i).toFixed(2)},${yFor(d.count).toFixed(2)}`);
  const linePath = `M${linePoints.join(" L")}`;
  const areaPath = `M${xFor(0).toFixed(2)},${(padTop + plotHeight).toFixed(2)} L${linePoints.join(" L")} L${xFor(n - 1).toFixed(2)},${(padTop + plotHeight).toFixed(2)} Z`;

  const yTicks = [0, Math.ceil(maxCount / 2), maxCount];
  const yAxis = yTicks
    .map((v) => {
      const y = yFor(v);
      return `<line x1="${padLeft}" y1="${y.toFixed(2)}" x2="${width - padRight}" y2="${y.toFixed(2)}" stroke="${COLORS.border}" stroke-dasharray="2,2"/>${text(padLeft - 8, y + 4, String(v), { size: 11, anchor: "end" })}`;
    })
    .join("\n  ");

  const xLabelStep = 15;
  const xAxis = commitsPerDay
    .map((d, i) => (i % xLabelStep === 0 || i === n - 1 ? { d, i } : null))
    .filter((v): v is { d: (typeof commitsPerDay)[number]; i: number } => v !== null)
    .map(({ d, i }) => {
      const label = new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return text(xFor(i), height - 8, label, { size: 11, anchor: "middle" });
    })
    .join("\n  ");

  const body = `
  ${yAxis}
  <path d="${areaPath}" fill="${COLORS.accent}" fill-opacity="0.15"/>
  <path d="${linePath}" fill="none" stroke="${COLORS.accent}" stroke-width="2"/>
  ${xAxis}`;

  return cardShell(width, height, "Commits (Last 90 Days)", body);
}
