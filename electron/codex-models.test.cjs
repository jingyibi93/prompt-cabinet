const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCodexModelId } = require("./codex-models.cjs");

test("normalizes GPT-5.6 display labels to Codex model IDs", () => {
  assert.equal(normalizeCodexModelId("gpt-5.6 Sol"), "gpt-5.6-sol");
  assert.equal(normalizeCodexModelId("GPT 5.6 TERRA"), "gpt-5.6-terra");
  assert.equal(normalizeCodexModelId("gpt_5.6_luna"), "gpt-5.6-luna");
});

test("preserves valid GPT aliases and optional default", () => {
  assert.equal(normalizeCodexModelId(" gpt-5.6 "), "gpt-5.6");
  assert.equal(normalizeCodexModelId(""), "");
  assert.equal(normalizeCodexModelId(undefined), "");
});

test("does not rewrite unknown or provider-specific model IDs", () => {
  assert.equal(normalizeCodexModelId("o3"), "o3");
  assert.equal(normalizeCodexModelId("vendor/custom Model"), "vendor/custom Model");
});
