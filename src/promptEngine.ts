import type { PromptCategory, PromptItem } from "./types";

type CategoryRule = {
  category: PromptCategory;
  keywords: string[];
};

const categoryRules: CategoryRule[] = [
  {
    category: "Design",
    keywords: [
      "design",
      "ui",
      "ux",
      "visual",
      "interface",
      "portfolio",
      "case study",
      "\u4f5c\u54c1\u96c6",
      "\u8bbe\u8ba1",
      "\u89c6\u89c9",
      "\u754c\u9762",
      "\u8bc4\u5ba1",
    ],
  },
  {
    category: "Coding",
    keywords: [
      "codex",
      "code",
      "repo",
      "codebase",
      "bug",
      "debug",
      "react",
      "typescript",
      "\u5f00\u53d1",
      "\u4ee3\u7801",
      "\u7f16\u7a0b",
    ],
  },
  {
    category: "Image",
    keywords: ["image", "midjourney", "poster", "render", "\u751f\u56fe", "\u56fe\u7247", "\u56fe\u50cf", "\u6d77\u62a5"],
  },
  {
    category: "Video",
    keywords: ["video", "runway", "storyboard", "shot", "scene", "\u89c6\u9891", "\u5206\u955c", "\u955c\u5934", "\u811a\u672c"],
  },
  {
    category: "Writing",
    keywords: ["xiaohongshu", "caption", "write", "rewrite", "copy", "article", "email", "tone", "\u5c0f\u7ea2\u4e66", "\u6587\u6848", "\u6807\u9898"],
  },
  {
    category: "Research",
    keywords: ["research", "summarize", "compare", "insight", "market", "competitor", "\u8c03\u7814", "\u603b\u7ed3", "\u7ade\u54c1", "\u6d1e\u5bdf"],
  },
  {
    category: "Career",
    keywords: ["resume", "cv", "interview", "job", "cover letter", "\u7b80\u5386", "\u9762\u8bd5", "\u6c42\u804c", "\u7533\u8bf7"],
  },
  {
    category: "Product",
    keywords: ["prd", "product", "feature", "roadmap", "user story", "\u4ea7\u54c1", "\u9700\u6c42", "\u529f\u80fd"],
  },
];

const platformHints: Array<[string, string[]]> = [
  ["Codex", ["codex", "repo", "codebase", "terminal", "\u5f00\u53d1", "\u4ee3\u7801"]],
  ["Midjourney", ["midjourney", "\u751f\u56fe", "image", "poster", "render"]],
  ["Runway", ["runway", "video", "\u89c6\u9891", "shot", "motion"]],
  ["Claude", ["claude", "long context", "document", "\u957f\u6587\u6863"]],
  ["ChatGPT", ["chatgpt", "gpt", "conversation", "\u5199\u4f5c", "\u5206\u6790"]],
];

export const categories: PromptCategory[] = [
  "Design",
  "Writing",
  "Research",
  "Coding",
  "Image",
  "Video",
  "Career",
  "Product",
];

export function analyzePrompt(
  rawPrompt: string,
  notes: string,
  overrides: { category?: PromptCategory; tags?: string[] } = {},
): PromptItem {
  const text = rawPrompt.trim();
  const source = `${text}\n${notes}`.toLowerCase();
  const category = overrides.category ?? inferCategory(source);
  const platform = inferPlatform(source, category);
  const action = inferAction(source);
  const tags = mergeTags(buildTags(source, category, platform), overrides.tags ?? []);
  const title = buildTitle(text, notes, category);

  return {
    id: crypto.randomUUID(),
    title,
    originalPrompt: text,
    refinedPrompt: text,
    useCase: buildUseCase(category, action),
    inputNeeded: buildInputNeeded(category),
    expectedOutput: buildExpectedOutput(category),
    tags,
    platform,
    notes: notes.trim() || "No source note added yet.",
    category,
    createdAt: new Date().toISOString(),
  };
}

function inferCategory(source: string): PromptCategory {
  if (hasImageGenerationIntent(source)) return "Image";
  if (containsAny(source, ["\u5c0f\u7ea2\u4e66", "xiaohongshu", "caption", "\u6587\u6848", "\u7206\u6b3e\u6587\u6848"])) {
    return "Writing";
  }
  if (containsAny(source, ["\u9002\u5408\u53d1\u5e03", "\u6807\u9898\u5907\u9009", "hashtag", "\u6b63\u6587", "\u8bc4\u8bba\u533a"])) {
    return "Writing";
  }
  if (containsAny(source, ["midjourney", "\u751f\u56fe", "\u56fe\u50cf\u63d0\u793a\u8bcd"])) return "Image";
  if (containsAny(source, ["runway", "\u5206\u955c", "\u77ed\u89c6\u9891"])) return "Video";
  if (hasDesignUiIntent(source)) return "Design";
  if (hasCodingImplementationIntent(source)) return "Coding";
  if (containsAny(source, ["portfolio", "\u4f5c\u54c1\u96c6", "\u8bbe\u8ba1\u8bc4\u5ba1", "ui", "ux"])) return "Design";

  return (
    categoryRules.find((rule) => rule.keywords.some((keyword) => source.includes(keyword.toLowerCase())))
      ?.category ?? "Product"
  );
}

function inferPlatform(source: string, category: PromptCategory) {
  if (category === "Writing" || category === "Research" || category === "Career" || category === "Product") {
    return "ChatGPT";
  }
  if (category === "Coding") return "Codex";
  if (category === "Image") return "Midjourney";
  if (category === "Video") return "Runway";
  return (
    platformHints.find(([, words]) => words.some((word) => source.includes(word.toLowerCase())))?.[0] ??
    "ChatGPT"
  );
}

function mergeTags(primary: string[], manual: string[]) {
  const cleanManual = manual.map((tag) => tag.trim()).filter(Boolean);
  return Array.from(new Set([...primary, ...cleanManual])).slice(0, 8);
}

function inferAction(source: string) {
  if (containsAny(source, ["rewrite", "improve", "\u4f18\u5316", "\u6539\u5199", "\u6da6\u8272"])) return "Improve";
  if (containsAny(source, ["analyze", "review", "critique", "\u5206\u6790", "\u8bc4\u5ba1"])) return "Analyze";
  if (containsAny(source, ["generate", "create", "\u751f\u6210", "\u521b\u5efa", "\u8bbe\u8ba1"])) return "Create";
  if (containsAny(source, ["summarize", "\u603b\u7ed3"])) return "Summarize";
  return "Refine";
}

function buildTitle(text: string, notes: string, category: PromptCategory) {
  const source = `${text}\n${notes}`.toLowerCase();

  if (containsAny(source, ["\u5c0f\u7ea2\u4e66", "xiaohongshu"])) return "\u5c0f\u7ea2\u4e66\u6587\u6848";
  if (containsAny(source, ["caption", "\u6587\u6848", "\u7206\u6b3e"])) return "\u793e\u5a92\u6587\u6848";
  if (containsAny(source, ["pixel-art", "pixel art", "pixel", "sprite"])) return "\u50cf\u7d20\u98ce\u751f\u56fe";
  if (hasImageGenerationIntent(source)) return "\u56fe\u50cf\u751f\u6210";
  if (containsAny(source, ["\u80f6\u56ca", "capsule"])) return "\u80f6\u56ca\u98ce UI";
  if (containsAny(source, ["\u65b0\u62df\u6001", "neumorphism", "soft ui"])) return "\u65b0\u62df\u6001 UI";
  if (containsAny(source, ["\u4f5c\u54c1\u96c6", "portfolio", "case study"])) return "\u4f5c\u54c1\u96c6\u6848\u4f8b";
  if (containsAny(source, ["midjourney", "\u751f\u56fe", "image"])) return "\u56fe\u50cf\u751f\u6210";
  if (containsAny(source, ["runway", "\u89c6\u9891", "storyboard", "\u5206\u955c"])) return "\u89c6\u9891\u5206\u955c";
  if (containsAny(source, ["codex", "repo", "\u4ee3\u7801", "\u5f00\u53d1", "debug"])) return "\u4ee3\u7801\u5f00\u53d1";
  if (containsAny(source, ["\u7b80\u5386", "\u9762\u8bd5", "\u6c42\u804c", "resume", "interview"])) return "\u6c42\u804c\u6750\u6599";
  if (containsAny(source, ["\u7ade\u54c1", "\u8c03\u7814", "research", "compare"])) return "\u7814\u7a76\u5206\u6790";
  if (containsAny(source, ["prd", "\u9700\u6c42", "\u4ea7\u54c1", "feature"])) return "\u4ea7\u54c1\u9700\u6c42";

  const noteTitle = normalizeTitleCandidate(notes);
  if (noteTitle) return noteTitle;

  const compactFirstLine = text
    .split(/\r?\n/)
    .find(Boolean)
    ?.replace(/^[-*\d.\s]+/, "");
  const firstLineTitle = normalizeTitleCandidate(compactFirstLine ?? "");
  if (firstLineTitle) return firstLineTitle;

  const fallback: Record<PromptCategory, string> = {
    Design: "\u8bbe\u8ba1\u5de5\u4f5c\u6d41",
    Writing: "\u5199\u4f5c\u4f18\u5316",
    Research: "\u7814\u7a76\u6574\u7406",
    Coding: "\u4ee3\u7801\u5f00\u53d1",
    Image: "\u56fe\u50cf\u751f\u6210",
    Video: "\u89c6\u9891\u521b\u4f5c",
    Career: "\u804c\u4e1a\u7533\u8bf7",
    Product: "\u4ea7\u54c1\u89c4\u5212",
  };
  return fallback[category];
}

function normalizeTitleCandidate(value: string) {
  const candidate = value
    .replace(/[#:*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!candidate || candidate === "No source note added yet.") return "";
  if (candidate.toLowerCase().includes("where did it come from")) return "";
  if (candidate.length <= 14) return candidate;
  return "";
}

function buildTags(source: string, category: PromptCategory, platform: string) {
  const tags: string[] = [];
  const add = (tag: string) => {
    if (!tags.includes(tag)) tags.push(tag);
  };

  const uiSignals = countMatches(source, ["ui", "ux", "interface", "\u754c\u9762", "\u9875\u9762", "\u6309\u94ae", "\u5361\u7247", "\u5bfc\u822a"]);
  const visualStyleSignals = countMatches(source, ["neumorphism", "soft ui", "\u65b0\u62df\u6001", "\u9634\u5f71", "\u5706\u89d2", "\u4f4e\u5bf9\u6bd4", "\u6d45\u7070", "\u67d4\u548c"]);
  const interactionSignals = countMatches(source, ["hover", "active", "\u6309\u538b", "\u4e0a\u6d6e", "\u4ea4\u4e92", "\u72b6\u6001"]);

  if (category === "Writing") {
    if (containsAny(source, ["\u5c0f\u7ea2\u4e66", "xiaohongshu"])) add("Xiaohongshu");
    add("Copywriting");
    if (containsAny(source, ["caption", "\u6587\u6848", "\u6807\u9898"])) add("Caption");
    if (containsAny(source, ["hashtag", "\u6807\u7b7e"])) add("Hashtags");
    if (containsAny(source, ["\u8bc4\u8bba", "\u4e92\u52a8"])) add("Engagement");
    if (containsAny(source, ["\u7206\u6b3e", "\u6536\u85cf", "\u8f6c\u53d1"])) add("Growth");
  } else if (category === "Design") {
    if (uiSignals > 0 || visualStyleSignals > 1) add("UI Design");
    if (visualStyleSignals > 0) add("Neumorphism");
    if (containsAny(source, ["soft ui", "\u67d4\u548c", "\u4f4e\u5bf9\u6bd4", "\u6d45\u7070"])) add("Soft UI");
    if (interactionSignals > 0) add("Interaction");
    if (containsAny(source, ["\u4f5c\u54c1\u96c6", "portfolio"])) add("Portfolio");
  } else if (category === "Image") {
    add("Image Prompt");
    if (containsAny(source, ["pixel-art", "pixel art", "pixel", "sprite"])) add("Pixel Art");
    if (containsAny(source, ["food", "snack", "\u98df\u7269", "\u7f8e\u98df"])) add("Food Illustration");
    if (containsAny(source, ["game asset", "game ui asset", "inventory icon", "sprite"])) add("Game Asset");
    if (containsAny(source, ["icon", "sticker", "emoji"])) add("Icon");
    if (containsAny(source, ["midjourney"])) add("Midjourney");
  } else if (category === "Video") {
    add("Video Prompt");
    if (containsAny(source, ["runway"])) add("Runway");
    if (containsAny(source, ["storyboard", "\u5206\u955c"])) add("Storyboard");
  } else if (category === "Coding") {
    add("Development");
    if (containsAny(source, ["debug", "bug"])) add("Debug");
    if (containsAny(source, ["react", "typescript"])) add("Frontend");
  }

  if (containsAny(source, ["strategy", "\u7b56\u7565"])) add("Strategy");
  if (containsAny(source, ["summary", "summarize", "\u603b\u7ed3"])) add("Summary");
  if (containsAny(source, ["tone", "\u8bed\u6c14"])) add("Tone");
  if (containsAny(source, ["template", "\u6a21\u677f"])) add("Template");
  if (containsAny(source, ["research", "\u8c03\u7814"])) add("Research");
  if (containsAny(source, ["critique", "review", "\u8bc4\u5ba1"])) add("Review");

  add(category);
  add(platform);
  return tags.slice(0, 8);
}

function buildUseCase(category: PromptCategory, action: string) {
  const map: Record<PromptCategory, string> = {
    Design: "Shape UI, UX, visual, portfolio, or design critique material into clearer direction.",
    Writing: "Draft, rewrite, or polish work communication with a reusable tone and structure.",
    Research: "Turn scattered information into structured summaries, comparisons, and insights.",
    Coding: "Guide coding or app-building work with clear implementation context and verification steps.",
    Image: "Generate image prompts with subject, style, composition, ratio, and visual constraints.",
    Video: "Shape video concepts into scenes, shots, pacing notes, and production-ready scripts.",
    Career: "Prepare application materials, interview answers, or career positioning drafts.",
    Product: "Clarify product ideas, requirements, user needs, and decision-ready outputs.",
  };
  return `${action} workflow: ${map[category]}`;
}

function buildInputNeeded(category: PromptCategory) {
  const common = ["Goal", "Audience", "Context", "Constraints"];
  const byCategory: Record<PromptCategory, string[]> = {
    Design: ["Design context", "Reference style", "Success criteria"],
    Writing: ["Draft text", "Desired tone", "Length"],
    Research: ["Research question", "Source material", "Comparison criteria"],
    Coding: ["Repository context", "Task scope", "Acceptance checks"],
    Image: ["Input image or subject", "Visual style", "Composition", "Aspect ratio"],
    Video: ["Concept", "Scene list", "Duration"],
    Career: ["Target role", "Experience evidence", "Company context"],
    Product: ["User problem", "Feature idea", "Success criteria"],
  };
  return [...common, ...byCategory[category]];
}

function buildExpectedOutput(category: PromptCategory) {
  const map: Record<PromptCategory, string> = {
    Design: "A clear design direction, critique, layout plan, or portfolio-ready narrative.",
    Writing: "A polished piece of writing with clear tone, structure, and next-step options.",
    Research: "A structured research summary with key findings, evidence, and implications.",
    Coding: "A scoped implementation plan, code output, or app-building brief with verification notes.",
    Image: "A production-ready image-generation prompt with style, subject, composition, ratio, and constraints.",
    Video: "A concise storyboard or script with scenes, rhythm, and visual direction.",
    Career: "A tailored career document or response grounded in real experience.",
    Product: "A product-ready brief with user value, requirements, risks, and decisions.",
  };
  return map[category];
}

function containsAny(source: string, keywords: string[]) {
  return keywords.some((keyword) => source.includes(keyword.toLowerCase()));
}

function hasDesignUiIntent(source: string) {
  const uiSignals = countMatches(source, [
    "ui",
    "ux",
    "visual",
    "interface",
    "neumorphism",
    "soft ui",
    "light gray",
    "rounded cards",
    "soft shadows",
    "low contrast",
    "calm interface",
    "floating panels",
    "hover",
    "active",
    "button",
    "card",
    "search box",
    "input",
    "navigation",
    "layout",
    "responsive",
    "\u9875\u9762",
    "\u80cc\u666f",
    "\u5bfc\u822a",
    "\u4e3b\u5185\u5bb9",
    "\u8f85\u52a9\u4fe1\u606f",
    "\u6309\u94ae",
    "\u5361\u7247",
    "\u641c\u7d22\u6846",
    "\u8f93\u5165\u6846",
    "\u56fe\u6807",
    "\u89c6\u89c9",
    "\u65b0\u62df\u6001",
    "\u5706\u89d2",
    "\u9634\u5f71",
    "\u4f4e\u5bf9\u6bd4",
    "\u54cd\u5e94\u5f0f",
  ]);
  return uiSignals >= 2;
}

function hasCodingImplementationIntent(source: string) {
  if (containsAny(source, ["codex", "repo", "codebase", "debug", "bug", "\u4ee3\u7801\u5f00\u53d1"])) return true;
  const codeSignals = countMatches(source, ["react", "typescript", "vite", "api", "function", "component", "\u4ee3\u7801", "\u5f00\u53d1", "\u7f16\u7a0b"]);
  return codeSignals >= 2 && !hasDesignUiIntent(source);
}

function hasImageGenerationIntent(source: string) {
  const outputSignals = countMatches(source, [
    "uploaded image",
    "final image",
    "image ratio",
    "artwork",
    "illustration",
    "pixel-art",
    "pixel art",
    "sprite",
    "sticker",
    "icon-style",
    "generate image",
    "\u751f\u56fe",
    "\u56fe\u50cf\u751f\u6210",
  ]);
  const constraintSignals = countMatches(source, [
    "1:1",
    "aspect ratio",
    "composition",
    "background",
    "palette",
    "color rules",
    "style direction",
    "pixel rules",
  ]);
  return outputSignals >= 1 && constraintSignals >= 1;
}

function countMatches(source: string, keywords: string[]) {
  return keywords.filter((keyword) => source.includes(keyword.toLowerCase())).length;
}
