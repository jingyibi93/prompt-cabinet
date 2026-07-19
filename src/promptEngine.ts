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
  overrides: { category?: PromptCategory; tags?: string[]; language?: "auto" | "zh" | "en" } = {},
): PromptItem {
  const text = rawPrompt.trim();
  const source = `${text}\n${notes}`.toLowerCase();
  const useChinese = overrides.language === "zh" || (overrides.language !== "en" && isChinesePrompt(text));
  const category = overrides.category ?? inferCategory(source);
  const platform = inferPlatform(source, category);
  const action = inferAction(source, useChinese);
  const tags = mergeTags(buildTags(source, category, platform, useChinese), overrides.tags ?? []);
  const title = buildTitle(text, notes, category, useChinese);

  return {
    id: crypto.randomUUID(),
    title,
    originalPrompt: text,
    refinedPrompt: text,
    useCase: buildUseCase(category, action, useChinese),
    inputNeeded: buildInputNeeded(`${text}\n${notes}`, category, useChinese),
    expectedOutput: buildExpectedOutput(category, useChinese),
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
  const seen = new Set<string>();
  const merged: string[] = [];
  [...primary, ...manual].forEach((tag) => {
    const cleanTag = tag.trim();
    const key = cleanTag.toLowerCase();
    if (!cleanTag || seen.has(key)) return;
    seen.add(key);
    merged.push(cleanTag);
  });
  return merged.slice(0, 8);
}

function inferAction(source: string, useChinese: boolean) {
  if (containsAny(source, ["rewrite", "improve", "\u4f18\u5316", "\u6539\u5199", "\u6da6\u8272"])) return useChinese ? "优化" : "Improve";
  if (containsAny(source, ["analyze", "review", "critique", "\u5206\u6790", "\u8bc4\u5ba1"])) return useChinese ? "分析" : "Analyze";
  if (containsAny(source, ["generate", "create", "\u751f\u6210", "\u521b\u5efa", "\u8bbe\u8ba1"])) return useChinese ? "创建" : "Create";
  if (containsAny(source, ["summarize", "\u603b\u7ed3"])) return useChinese ? "总结" : "Summarize";
  return useChinese ? "整理" : "Refine";
}

function buildTitle(text: string, notes: string, category: PromptCategory, useChinese: boolean) {
  const source = `${text}\n${notes}`.toLowerCase();

  if (containsAny(source, ["\u5c0f\u7ea2\u4e66", "xiaohongshu"])) return useChinese ? "\u5c0f\u7ea2\u4e66\u6587\u6848" : "Xiaohongshu Copy";
  if (containsAny(source, ["caption", "\u6587\u6848", "\u7206\u6b3e"])) return useChinese ? "\u793e\u5a92\u6587\u6848" : "Social Media Copy";
  if (category === "Image" || hasImageGenerationIntent(source)) {
    const specificImageTitle = buildSpecificImageTitle(source, useChinese);
    if (specificImageTitle) return specificImageTitle;
  }
  if (hasImageGenerationIntent(source)) return useChinese ? "\u56fe\u50cf\u751f\u6210" : "Image Generation";
  if (containsAny(source, ["\u80f6\u56ca", "capsule"])) return useChinese ? "\u80f6\u56ca\u98ce UI" : "Capsule UI";
  if (containsAny(source, ["\u65b0\u62df\u6001", "neumorphism", "soft ui"])) return useChinese ? "\u65b0\u62df\u6001 UI" : "Neumorphic UI";
  if (containsAny(source, ["\u4f5c\u54c1\u96c6", "portfolio", "case study"])) return useChinese ? "\u4f5c\u54c1\u96c6\u6848\u4f8b" : "Portfolio Case Study";
  if (containsAny(source, ["midjourney", "\u751f\u56fe", "image"])) return useChinese ? "\u56fe\u50cf\u751f\u6210" : "Image Generation";
  if (containsAny(source, ["runway", "\u89c6\u9891", "storyboard", "\u5206\u955c"])) return useChinese ? "\u89c6\u9891\u5206\u955c" : "Video Storyboard";
  if (containsAny(source, ["codex", "repo", "\u4ee3\u7801", "\u5f00\u53d1", "debug"])) return useChinese ? "\u4ee3\u7801\u5f00\u53d1" : "Code Development";
  if (containsAny(source, ["\u7b80\u5386", "\u9762\u8bd5", "\u6c42\u804c", "resume", "interview"])) return useChinese ? "\u6c42\u804c\u6750\u6599" : "Career Materials";
  if (containsAny(source, ["\u7ade\u54c1", "\u8c03\u7814", "research", "compare"])) return useChinese ? "\u7814\u7a76\u5206\u6790" : "Research Analysis";
  if (containsAny(source, ["prd", "\u9700\u6c42", "\u4ea7\u54c1", "feature"])) return useChinese ? "\u4ea7\u54c1\u9700\u6c42" : "Product Requirements";

  const noteTitle = normalizeTitleCandidate(notes);
  if (noteTitle && (useChinese || !isChinesePrompt(noteTitle))) return noteTitle;

  const compactFirstLine = text
    .split(/\r?\n/)
    .find(Boolean)
    ?.replace(/^[-*\d.\s]+/, "");
  const firstLineTitle = normalizeTitleCandidate(compactFirstLine ?? "");
  if (firstLineTitle && (useChinese || !isChinesePrompt(firstLineTitle))) return firstLineTitle;

  const fallback: Record<PromptCategory, string> = useChinese ? {
    Design: "\u8bbe\u8ba1\u5de5\u4f5c\u6d41",
    Writing: "\u5199\u4f5c\u4f18\u5316",
    Research: "\u7814\u7a76\u6574\u7406",
    Coding: "\u4ee3\u7801\u5f00\u53d1",
    Image: "\u56fe\u50cf\u751f\u6210",
    Video: "\u89c6\u9891\u521b\u4f5c",
    Career: "\u804c\u4e1a\u7533\u8bf7",
    Product: "\u4ea7\u54c1\u89c4\u5212",
  } : {
    Design: "Design Workflow",
    Writing: "Writing Refinement",
    Research: "Research Organizer",
    Coding: "Code Development",
    Image: "Image Generation",
    Video: "Video Creation",
    Career: "Career Application",
    Product: "Product Planning",
  };
  return fallback[category] ?? `${category} Prompt`;
}

function buildSpecificImageTitle(source: string, useChinese: boolean) {
  const styles: Array<[string, string]> = [];
  const addStyle = (english: string, chinese: string) => {
    if (!styles.some(([value]) => value === english)) styles.push([english, chinese]);
  };

  if (containsAny(source, ["rough black linear outline", "rough black outline", "rough outline", "\u7c97\u7ebf\u6761", "\u7c97\u8f6e\u5ed3"])) addStyle("Rough-Outline", "\u7c97\u7ebf\u6761");
  if (containsAny(source, ["pixel-art", "pixel art", "pixel", "sprite", "\u50cf\u7d20\u98ce", "\u50cf\u7d20\u827a\u672f"])) addStyle("Pixel Art", "\u50cf\u7d20\u98ce");
  if (containsAny(source, ["cartoon", "comic style", "\u5361\u901a", "\u6f2b\u753b\u98ce"])) addStyle("Cartoon", "\u5361\u901a");
  if (containsAny(source, ["watercolor", "\u6c34\u5f69"])) addStyle("Watercolor", "\u6c34\u5f69");
  if (containsAny(source, ["line art", "line drawing", "\u7ebf\u7a3f", "\u7ebf\u63cf"])) addStyle("Line-Art", "\u7ebf\u63cf");
  if (containsAny(source, ["flat color", "flat-colour", "\u6241\u5e73\u8272\u5f69", "\u6241\u5e73\u5316"])) addStyle("Flat-Color", "\u6241\u5e73\u8272\u5f69");
  if (containsAny(source, ["minimalist", "minimal detail", "minimal style", "\u6781\u7b80", "\u7b80\u7ea6"])) addStyle("Minimal", "\u6781\u7b80");
  if (containsAny(source, ["3d render", "3d illustration", "three-dimensional", "\u4e09\u7ef4\u6e32\u67d3", "3d \u6e32\u67d3"])) addStyle("3D", "3D");
  if (containsAny(source, ["photorealistic", "photo-realistic", "\u5199\u5b9e", "\u8d85\u5199\u5b9e"])) addStyle("Photorealistic", "\u5199\u5b9e");
  if (containsAny(source, ["retro", "vintage", "\u590d\u53e4"])) addStyle("Retro", "\u590d\u53e4");
  if (containsAny(source, ["cinematic", "\u7535\u5f71\u611f", "\u7535\u5f71\u7ea7"])) addStyle("Cinematic", "\u7535\u5f71\u611f");

  const subjects: Array<{ keywords: string[]; english: string; chinese: string }> = [
    { keywords: ["character", "mascot", "\u89d2\u8272", "\u4eba\u7269", "\u5409\u7965\u7269"], english: "Character", chinese: "\u89d2\u8272" },
    { keywords: ["portrait", "headshot", "\u8096\u50cf", "\u5934\u50cf"], english: "Portrait", chinese: "\u8096\u50cf" },
    { keywords: ["food", "dish", "meal", "\u98df\u7269", "\u83dc\u54c1", "\u7f8e\u98df"], english: "Food Illustration", chinese: "\u7f8e\u98df\u63d2\u753b" },
    { keywords: ["product", "packaging", "\u4ea7\u54c1", "\u5305\u88c5"], english: "Product Visual", chinese: "\u4ea7\u54c1\u89c6\u89c9" },
    { keywords: ["logo", "brand mark", "\u6807\u5fd7", "\u54c1\u724c\u6807\u8bc6"], english: "Logo", chinese: "\u6807\u5fd7" },
    { keywords: ["icon", "app icon", "\u56fe\u6807"], english: "Icon", chinese: "\u56fe\u6807" },
    { keywords: ["poster", "key visual", "\u6d77\u62a5", "\u4e3b\u89c6\u89c9"], english: "Poster", chinese: "\u6d77\u62a5" },
    { keywords: ["sticker", "emoji", "\u8d34\u7eb8", "\u8868\u60c5\u5305"], english: "Sticker", chinese: "\u8d34\u7eb8" },
    { keywords: ["landscape", "scenery", "\u98ce\u666f", "\u666f\u89c2"], english: "Landscape", chinese: "\u98ce\u666f" },
    { keywords: ["interior", "room", "\u5ba4\u5185", "\u623f\u95f4"], english: "Interior", chinese: "\u5ba4\u5185\u573a\u666f" },
    { keywords: ["architecture", "building", "\u5efa\u7b51"], english: "Architecture", chinese: "\u5efa\u7b51" },
    { keywords: ["illustration", "drawing", "\u63d2\u753b", "\u7ed8\u753b"], english: "Illustration", chinese: "\u63d2\u753b" },
  ];
  const subject = subjects.find((candidate) => containsAny(source, candidate.keywords));
  if (!styles.length && !subject) return "";

  const selectedStyles = styles.slice(0, subject ? 2 : 3);
  if (useChinese) return `${selectedStyles.map(([, chinese]) => chinese).join("")}${subject?.chinese ?? "\u56fe\u50cf"}`;
  return [...selectedStyles.map(([english]) => english), subject?.english ?? "Visual"].join(" ");
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

function buildTags(source: string, category: PromptCategory, platform: string, useChinese: boolean) {
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
  const localizedTags = useChinese ? tags.map((tag) => chineseTagMap[tag] ?? tag) : tags;
  return localizedTags.slice(0, 8);
}

function buildUseCase(category: PromptCategory, action: string, useChinese: boolean) {
  if (useChinese) {
    const map: Record<PromptCategory, string> = {
      Design: "将界面、体验、视觉风格、作品集或设计评审内容整理为清晰的设计方向。",
      Writing: "以可复用的语气和结构起草、改写或润色工作与社交媒体文案。",
      Research: "将分散资料整理为结构化摘要、对比和洞察。",
      Coding: "用明确的实现背景、任务范围和验证步骤指导开发工作。",
      Image: "生成包含主体、风格、构图、比例和视觉约束的图像提示词。",
      Video: "将视频概念整理为场景、镜头、节奏说明和可执行脚本。",
      Career: "准备求职材料、面试回答或职业定位内容。",
      Product: "梳理产品想法、需求、用户问题和可用于决策的成果。",
    };
    return `${action}流程：${map[category] ?? "整理并复用这条自定义工作流提示词。"}`;
  }
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
  return `${action} workflow: ${map[category] ?? "Capture and reuse this custom workflow prompt."}`;
}

function buildInputNeeded(rawPrompt: string, category: PromptCategory, useChinese: boolean) {
  const source = rawPrompt.toLowerCase();
  const inputs: string[] = [];
  const add = (english: string, chinese: string) => {
    const value = useChinese ? chinese : english;
    if (!inputs.includes(value)) inputs.push(value);
  };

  if (/upload(?:ed)? (?:image|photo|picture)|provided (?:image|photo|picture)|input image|上传(?:的)?(?:图片|图像|照片)|提供(?:的)?(?:图片|图像|照片)/i.test(source)) add("Uploaded image", "上传的图片");
  if (/reference (?:image|photo|picture)|参考(?:图片|图像|照片)|基于.{0,8}(?:图片|图像|照片)/i.test(source)) add("Reference image", "参考图片");
  if (/screenshots?|screen captures?|截图|屏幕截图/i.test(source)) add("Screenshot", "截图");
  if (/source text|original text|draft text|text to (?:rewrite|edit|translate|summarize)|provided (?:copy|content|text)|原始(?:文本|文案)|待(?:改写|编辑|翻译|总结)文本|提供(?:的)?(?:文案|内容|文本)/i.test(source)) {
    add("Source text", "源文本");
  }
  if (/source (?:document|file)|upload(?:ed)? (?:document|file|pdf)|provided (?:document|file|pdf)|\bpdf\b|上传(?:的)?(?:文档|文件)|提供(?:的)?(?:文档|文件)|源文档/i.test(source)) {
    add("Source document", "源文档");
  }
  if (/\burl\b|website link|page link|webpage link|网页链接|网址|链接地址/i.test(source)) add("URL", "网址");
  if (/dataset|data set|\bcsv\b|spreadsheet|数据集|数据表|电子表格/i.test(source)) add("Dataset", "数据集");
  if (/repository|codebase|repo context|项目仓库|代码仓库|代码库/i.test(source)) add("Repository or codebase", "代码仓库或代码库");
  if (/brand guidelines?|brand assets?|style guide|logo files?|品牌指南|品牌素材|视觉规范|标志文件/i.test(source)) add("Brand assets or guidelines", "品牌素材或规范");
  if (/product (?:details|information|specifications)|产品(?:详情|信息|规格)/i.test(source)) add("Product details", "产品信息");

  const placeholderPattern = /\{\{\s*([^{}\n]{1,40}?)\s*\}\}|<\s*([^<>\n]{1,40}?)\s*>|\[\s*([A-Z][A-Z0-9 _-]{1,39})\s*\]/g;
  for (const match of rawPrompt.matchAll(placeholderPattern)) {
    const placeholder = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (placeholder && !inputs.some((item) => item.toLowerCase() === placeholder.toLowerCase())) {
      inputs.push(placeholder);
    }
  }

  if (inputs.length) return inputs.slice(0, 8);

  const fallback: Record<PromptCategory, [string, string][]> = {
    Design: [["Design brief", "设计需求"]],
    Writing: [["Source topic or draft", "主题或原始草稿"]],
    Research: [["Research question and sources", "研究问题与资料来源"]],
    Coding: [["Repository context and task", "项目背景与开发任务"]],
    Image: [["Subject or reference material", "主体或参考素材"]],
    Video: [["Video concept or source material", "视频概念或源素材"]],
    Career: [["Target role and experience", "目标岗位与个人经历"]],
    Product: [["User problem or product idea", "用户问题或产品构想"]],
  };
  return fallback[category].map(([english, chinese]) => (useChinese ? chinese : english));
}

function buildExpectedOutput(category: PromptCategory, useChinese: boolean) {
  if (useChinese) {
    const map: Record<PromptCategory, string> = {
      Design: "清晰的设计方向、评审意见、布局方案或可用于作品集的叙述。",
      Writing: "语气明确、结构清晰，并包含后续选项的完整文案。",
      Research: "包含关键发现、证据和影响的结构化研究摘要。",
      Coding: "范围清晰的实现方案、代码成果或包含验证说明的开发简报。",
      Image: "包含风格、主体、构图、比例和限制条件的可执行图像提示词。",
      Video: "包含场景、节奏和视觉方向的精简分镜或脚本。",
      Career: "基于真实经历、针对目标定制的求职材料或回答。",
      Product: "包含用户价值、需求、风险和决策信息的产品简报。",
    };
    return map[category] ?? "按自定义分类整理完成的可复用提示词成果。";
  }
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
  return map[category] ?? "A reusable prompt organized for this custom category.";
}

const chineseTagMap: Record<string, string> = {
  Xiaohongshu: "小红书",
  Copywriting: "文案",
  Caption: "社媒文案",
  Hashtags: "标签",
  Engagement: "互动",
  Growth: "增长",
  "UI Design": "界面设计",
  Neumorphism: "新拟态",
  "Soft UI": "柔和界面",
  Interaction: "交互",
  Portfolio: "作品集",
  "Image Prompt": "图像提示词",
  "Pixel Art": "像素艺术",
  "Food Illustration": "美食插画",
  "Game Asset": "游戏素材",
  Icon: "图标",
  "Video Prompt": "视频提示词",
  Storyboard: "分镜",
  Development: "开发",
  Debug: "调试",
  Frontend: "前端",
  Strategy: "策略",
  Summary: "总结",
  Tone: "语气",
  Template: "模板",
  Research: "调研",
  Review: "评审",
  Design: "设计",
  Writing: "写作",
  Coding: "编程",
  Image: "图像",
  Video: "视频",
  Career: "职业",
  Product: "产品",
};

export function isChinesePrompt(value: string) {
  return (value.match(/[\u3400-\u9fff]/g) ?? []).length >= 4;
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
