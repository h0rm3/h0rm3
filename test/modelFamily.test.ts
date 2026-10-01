import { test } from "node:test";
import assert from "node:assert/strict";
import { modelFamily } from "../src/normalize.js";

test("matches known families by substring, case-insensitively", () => {
  assert.equal(modelFamily("claude-opus-4-5"), "Opus");
  assert.equal(modelFamily("claude-sonnet-5"), "Sonnet");
  assert.equal(modelFamily("claude-haiku-4-5-20251001"), "Haiku");
  assert.equal(modelFamily("claude-fable-5-1"), "Fable");
  assert.equal(modelFamily("CLAUDE-SONNET-5"), "Sonnet");
});

test("GPT and Codex models both normalize to GPT", () => {
  assert.equal(modelFamily("gpt-5.5"), "GPT");
  assert.equal(modelFamily("gpt-4o"), "GPT");
  assert.equal(modelFamily("o3-mini"), "GPT");
});

test("unknown model id falls back to the raw id itself", () => {
  assert.equal(modelFamily("some-future-model-9"), "some-future-model-9");
});
