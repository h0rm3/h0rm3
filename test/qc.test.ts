import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXml, privacyScan, validateSvg } from "../src/qc.js";
import { renderHeatmap, renderStreak } from "../src/render/cards.js";

const ok = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="0" width="1" height="1" fill="#000"/><text>a &amp; b</text></svg>`;

test("valid SVG passes", () => {
  assert.deepEqual(validateSvg(ok), []);
});

test("generated cards pass the SVG validator", () => {
  assert.deepEqual(validateSvg(renderStreak({ totalCommits: 1234, currentStreak: 1, longestStreak: 2 })), []);
  const days = Array.from({ length: 10 }, (_, i) => ({ date: `2026-01-${String(4 + i).padStart(2, "0")}`, count: i, level: i % 5 }));
  assert.deepEqual(validateSvg(renderHeatmap({ days, total: 45, apiTotal: 45, weeks: 52, startKey: "2025-01-05" })), []);
});

test("well-formedness errors are caught", () => {
  assert.ok(parseXml(`<svg><g></svg>`).errors.length > 0);
  assert.ok(parseXml(`<svg><text>a & b</text></svg>`).errors.length > 0);
  assert.ok(parseXml(`<svg a="1" a="2"></svg>`).errors.length > 0);
  assert.ok(parseXml(`<svg></svg><svg></svg>`).errors.length > 0);
  assert.ok(parseXml(`<svg><rect x=1/></svg>`).errors.length > 0);
});

test("unsafe or unsized SVGs are rejected", () => {
  assert.ok(validateSvg(ok.replace(' viewBox="0 0 10 10"', "")).some((e) => e.includes("viewBox")));
  assert.ok(validateSvg(ok.replace("<text>", "<script>x</script><text>")).some((e) => e.includes("script")));
  assert.ok(validateSvg(ok.replace('fill="#000"', 'fill="url(https://x.example/a)"')).length > 0);
  assert.ok(validateSvg(ok.replace("<rect", '<use href="https://x.example/s.svg#a"/><rect')).length > 0);
  assert.ok(validateSvg(ok.replace("<rect", '<rect onload="alert(1)"')).length > 0);
  assert.ok(validateSvg(ok.replace("<text>", "<style>@font-face{}</style><text>")).length > 0);
});

test("privacy scan flags paths, usernames, emails, tokens and private repo names", () => {
  const scan = (content: string) => privacyScan([{ path: "README.md", content }], ["secret-project"]);
  assert.deepEqual(scan("clean aggregate 1,234"), []);
  assert.ok(scan("C:\\Users\\someone").length > 0);
  assert.ok(scan("owner").length > 0);
  assert.ok(scan("me@example.com").length > 0);
  assert.ok(scan("ghp_abc").length > 0);
  assert.ok(scan("~/.claude/projects").length > 0);
  assert.ok(scan("repo: Secret-Project here").length > 0);
  assert.deepEqual(scan("not-secret-project-x"), []); // whole-token match only
});
