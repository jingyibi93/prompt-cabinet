const CODEX_MODEL_ID_PATTERN = /^gpt-(\d+(?:\.\d+)*)(?:-(sol|terra|luna))?$/i;

function normalizeCodexModelId(model) {
  if (typeof model !== "string") return "";

  const trimmed = model.trim();
  if (!trimmed) return "";

  const candidate = trimmed
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^gpt(?=\d)/i, "gpt-");
  const match = candidate.match(CODEX_MODEL_ID_PATTERN);

  if (!match) return trimmed;
  return `gpt-${match[1]}${match[2] ? `-${match[2].toLowerCase()}` : ""}`;
}

module.exports = { normalizeCodexModelId };
