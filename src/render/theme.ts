/** Single source of truth for every SVG card: colors, fonts, sizes, padding. */
export const COLORS = {
  bg: "#0d1117",
  border: "#30363d",
  text: "#c9d1d9",
  muted: "#8b949e",
  accent: "#a371f7",
  grid: "#21262d",
};

/** Segment colors for the languages bar; cycles if needed. */
export const PALETTE = ["#a371f7", "#58a6ff", "#3fb950", "#f0883e", "#f85149", "#d29922", "#39c5cf", "#db61a2", "#8b949e"];

/** GitHub-calendar style levels (none + 4 quartiles) in the purple accent ramp of GitHub's dark Primer palette. */
export const HEAT_LEVELS = ["#161b22", "#3c1e70", "#6e40c9", "#8957e5", "#a371f7"];

export const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif";
export const FULL_W = 820;
export const HALF_W = 400;
export const HALF_H = 170;
export const PAD = 20;
export const TITLE_Y = 30;
export const TITLE_SIZE = 15;
export const BODY_SIZE = 12;
export const SMALL_SIZE = 10;

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const n2 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

export function text(
  x: number,
  y: number,
  content: string,
  opts: { size?: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end" } = {},
): string {
  const { size = BODY_SIZE, weight = 400, fill = COLORS.text, anchor = "start" } = opts;
  return `<text x="${n2(x)}" y="${n2(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(content)}</text>`;
}

export function rect(x: number, y: number, w: number, h: number, fill: string, rx = 0): string {
  return `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}"${rx ? ` rx="${rx}"` : ""} fill="${fill}"/>`;
}

export function line(x1: number, y1: number, x2: number, y2: number, stroke: string, dash = false): string {
  return `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${stroke}"${dash ? ' stroke-dasharray="2,3"' : ""}/>`;
}

/** Card frame: background, border, title (left) and optional subtitle (right). */
export function card(width: number, height: number, title: string, body: string[], subtitle?: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="${COLORS.bg}" stroke="${COLORS.border}"/>`,
    text(PAD, TITLE_Y, title, { size: TITLE_SIZE, weight: 600, fill: COLORS.accent }),
    subtitle ? text(width - PAD, TITLE_Y, subtitle, { size: SMALL_SIZE + 1, fill: COLORS.muted, anchor: "end" }) : "",
    ...body,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("\n") + "\n";
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
