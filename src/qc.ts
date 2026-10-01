/**
 * Offline checks shared by scripts/qc.ts (full gate) and scripts/update.ts (pre-commit guard).
 * Every function returns a list of problems; empty means pass.
 */

const NAME = "[A-Za-z_][\\w.:-]*";
const ATTR = new RegExp(`(${NAME})\\s*=\\s*("[^"<]*"|'[^'<]*')`, "g");
const START_TAG = new RegExp(`^<(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>$`);
const END_TAG = new RegExp(`^</(${NAME})\\s*>$`);
const BAD_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
}

/** Strict well-formedness check for the XML subset an SVG card uses. Returns elements in document order. */
export function parseXml(xml: string): { errors: string[]; elements: XmlElement[] } {
  const errors: string[] = [];
  const elements: XmlElement[] = [];
  const stack: string[] = [];
  let roots = 0;
  let pos = 0;
  const token = /<!--[\s\S]*?-->|<[^>]*>|[^<]+/g;
  for (const m of xml.matchAll(token)) {
    if (m.index !== pos) {
      errors.push(`unparseable content at offset ${pos}`);
      break;
    }
    pos = m.index + m[0].length;
    const t = m[0];
    if (t.startsWith("<!--")) continue;
    if (!t.startsWith("<")) {
      if (BAD_ENTITY.test(t)) errors.push(`unescaped & in text near offset ${m.index}`);
      if (stack.length === 0 && t.trim()) errors.push("text outside the root element");
      continue;
    }
    const end = t.match(END_TAG);
    if (end) {
      const open = stack.pop();
      if (open !== end[1]) errors.push(`mismatched </${end[1]}> (open: ${open ?? "none"})`);
      continue;
    }
    const start = t.match(START_TAG);
    if (!start) {
      errors.push(`malformed tag near offset ${m.index}`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of start[2].matchAll(ATTR)) {
      if (a[1] in attrs) errors.push(`duplicate attribute ${a[1]} on <${start[1]}>`);
      const value = a[2].slice(1, -1);
      if (BAD_ENTITY.test(value)) errors.push(`unescaped & in attribute ${a[1]}`);
      attrs[a[1]] = value;
    }
    if (stack.length === 0) roots++;
    elements.push({ name: start[1], attrs });
    if (!start[3]) stack.push(start[1]);
  }
  if (pos !== xml.length && errors.length === 0) errors.push(`unparseable content at offset ${pos}`);
  if (stack.length) errors.push(`unclosed elements: ${stack.join(", ")}`);
  if (roots !== 1) errors.push(`expected exactly one root element, found ${roots}`);
  return { errors, elements };
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function validateSvg(content: string): string[] {
  const { errors, elements } = parseXml(content);
  const root = elements[0];
  if (!root || root.name !== "svg") errors.push("root element is not <svg>");
  else {
    for (const a of ["width", "height", "viewBox"]) if (!root.attrs[a]) errors.push(`root <svg> missing ${a}`);
    if (root.attrs.xmlns !== SVG_NS) errors.push("root <svg> missing the SVG namespace");
  }
  for (const el of elements) {
    if (/^(script|foreignObject|style|image|iframe|object|embed|a)$/i.test(el.name)) errors.push(`forbidden element <${el.name}>`);
    for (const [k, v] of Object.entries(el.attrs)) {
      if (/^on/i.test(k)) errors.push(`event handler attribute ${k}`);
      if (el.name === "svg" && k === "xmlns") continue; // namespace identifier, not a fetched URL
      if (/(https?:)?\/\/|data:|javascript:/i.test(v)) errors.push(`external URL in ${k} on <${el.name}>`);
      if (/href$/i.test(k) && !v.startsWith("#")) errors.push(`non-local ${k}`);
      if (/url\((?!#)/i.test(v)) errors.push(`external url() in ${k}`);
    }
  }
  if (/@import|@font-face/i.test(content)) errors.push("external font/stylesheet reference");
  return errors;
}

/** Literal markers that must never appear in published output (case-insensitive). */
export const PRIVACY_MARKERS = ["Users", "C:\\", "Owner", ".claude", "@", "ghp_", "gho_", "github_pat_"];

export function privacyScan(files: { path: string; content: string }[], privateRepoNames: string[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const lower = f.content.toLowerCase();
    for (const marker of PRIVACY_MARKERS) {
      const idx = lower.indexOf(marker.toLowerCase());
      if (idx !== -1) hits.push(`${f.path}: contains "${marker}" at offset ${idx}`);
    }
    for (const name of privateRepoNames) {
      const re = new RegExp(`(^|[^A-Za-z0-9_.-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_.-])`, "i");
      if (re.test(f.content)) hits.push(`${f.path}: contains a private repo name`);
    }
  }
  return hits;
}
