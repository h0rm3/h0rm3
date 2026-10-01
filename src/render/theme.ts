export const COLORS = {
  bg: "#0d1117",
  border: "#30363d",
  text: "#c9d1d9",
  accent: "#a371f7",
};

/** Dark-theme-friendly palette for stacked/segmented charts; cycles if there are more entries than colors. */
export const PALETTE = [
  "#a371f7",
  "#58a6ff",
  "#3fb950",
  "#f0883e",
  "#f85149",
  "#d29922",
  "#39c5cf",
  "#db61a2",
  "#8b949e",
];

const FONT = "-apple-system,Segoe UI,Helvetica,Arial,sans-serif";

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function cardShell(width: number, height: number, title: string, body: string): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="${COLORS.bg}" stroke="${COLORS.border}"/>
  <text x="20" y="30" font-family="${FONT}" font-size="16" font-weight="600" fill="${COLORS.accent}">${escapeXml(title)}</text>
  ${body}
</svg>`;
}

export function text(x: number, y: number, content: string, opts: { size?: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end" } = {}): string {
  const { size = 13, weight = 400, fill = COLORS.text, anchor = "start" } = opts;
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(content)}</text>`;
}
