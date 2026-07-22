import type { AnalyzeResult, ApiSettings, PromptCategory, PromptItem, QuickShortcutSettings, RewriteSegment } from "./types";
import { analyzePrompt, isChinesePrompt } from "./promptEngine";

const STORAGE_KEY = "prompt-cabinet-items";

declare global {
  interface Window {
    promptCabinetStorage?: {
      loadPrompts: () => Promise<unknown>;
      savePrompts: (prompts: PromptItem[]) => Promise<unknown>;
      getDataPath: () => Promise<string>;
      onPromptsChanged?: (callback: () => void) => () => void;
    };
    promptCabinetApi?: {
      loadSettings: () => Promise<ApiSettings>;
      saveSettings: (settings: ApiSettings) => Promise<ApiSettings>;
      testConnection: (settings: ApiSettings) => Promise<{ ok: boolean; message: string }>;
      analyzePrompt: (payload: {
        rawPrompt: string;
        notes: string;
        settings: ApiSettings;
        outputLanguage?: "auto" | "zh" | "en";
      }) => Promise<AnalyzeResult>;
    };
    promptCabinetWindow?: {
      getAlwaysOnTop: () => Promise<boolean>;
      setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
      loadShortcuts: () => Promise<QuickShortcutSettings>;
      saveShortcuts: (shortcuts: QuickShortcutSettings) => Promise<QuickShortcutSettings>;
      setQuickAddMode: (mode: "capture" | "insert") => Promise<"capture" | "insert">;
      readClipboardText: () => Promise<string>;
      readClipboardImage: () => Promise<string>;
      insertText: (text: string, language?: "zh" | "en") => Promise<{ ok: boolean; copied: boolean; needsAccessibility: boolean }>;
      openQuickAdd: () => Promise<void>;
      closeCurrentWindow: () => Promise<void>;
      onQuickAddSaveShortcut: (callback: () => void) => () => void;
      onQuickAddModeShortcut: (callback: (mode: "capture" | "insert") => void) => () => void;
      onQuickAddCommandShortcut: (callback: (command: keyof QuickShortcutSettings) => void) => () => void;
      onQuickAddShortcutsChanged: (callback: (shortcuts: QuickShortcutSettings) => void) => () => void;
    };
  }
}

export async function loadPrompts(): Promise<PromptItem[]> {
  if (window.promptCabinetStorage) {
    const data = await window.promptCabinetStorage.loadPrompts();
    return normalizeImportedPrompts(data);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return normalizeImportedPrompts(parsed);
  } catch {
    return [];
  }
}

export function normalizeImportedPrompts(input: unknown): PromptItem[] {
  const rawPrompts = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.prompts)
      ? input.prompts
      : [];

  return rawPrompts.filter(isPromptLike).map(normalizePrompt);
}

function normalizePrompt(prompt: PromptItem): PromptItem {
  const normalized: PromptItem = {
    ...prompt,
    id: prompt.id || crypto.randomUUID(),
    status: prompt.status === "inbox" ? "inbox" : "saved",
    title: prompt.title || "Untitled Prompt",
    originalPrompt: prompt.originalPrompt || "",
    refinedPrompt: prompt.refinedPrompt || prompt.originalPrompt || "",
    useCase: prompt.useCase || "Saved prompt for future reuse.",
    inputNeeded: Array.isArray(prompt.inputNeeded) ? prompt.inputNeeded : [],
    expectedOutput: prompt.expectedOutput || "Reusable prompt output.",
    platform: prompt.platform || "ChatGPT",
    notes: prompt.notes || "No source note added yet.",
    createdAt: prompt.createdAt || new Date().toISOString(),
    updatedAt: typeof prompt.updatedAt === "string" && prompt.updatedAt.trim() ? prompt.updatedAt : undefined,
    previewImage:
      typeof prompt.previewImage === "string" && prompt.previewImage.startsWith("data:image/")
        ? prompt.previewImage
        : undefined,
    rewriteHistory: normalizeRewriteHistory(prompt.rewriteHistory, prompt.originalPrompt || "", prompt.refinedPrompt || prompt.originalPrompt || ""),
    category: normalizeCategory(prompt.category),
    tags: Array.isArray(prompt.tags)
      ? normalizeTags(prompt.tags.map((tag) => (tag === "Portfolio" ? "Design" : tag === "Codex" ? "Coding" : tag)))
      : [],
  };
  return localizeLegacyMockAnalysis(normalized);
}

function normalizeRewriteHistory(value: unknown, originalPrompt: string, refinedPrompt: string): RewriteSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const segments = value
    .filter(isRecord)
    .map((segment) => ({
      value: typeof segment.value === "string" ? segment.value : "",
      status: segment.status,
    }))
    .filter(
      (segment): segment is RewriteSegment =>
        Boolean(segment.value) && ["same", "added", "removed"].includes(String(segment.status)),
    );
  if (!segments.length) return undefined;

  const originalProjection = segments
    .filter((segment) => segment.status !== "added")
    .map((segment) => segment.value)
    .join("");
  const refinedProjection = segments
    .filter((segment) => segment.status !== "removed")
    .map((segment) => segment.value)
    .join("");
  return originalProjection === originalPrompt && refinedProjection === refinedPrompt ? segments : undefined;
}

function localizeLegacyMockAnalysis(prompt: PromptItem) {
  if (!isChinesePrompt(prompt.originalPrompt)) return prompt;
  const hasLegacyEnglishMetadata =
    /^(Create|Improve|Analyze|Summarize|Refine) workflow:/.test(prompt.useCase) ||
    prompt.inputNeeded.some((item) => ["Goal", "Audience", "Context", "Constraints"].includes(item)) ||
    /^(A clear|A polished|A structured|A scoped|A production-ready|A concise|A tailored|A product-ready)/.test(
      prompt.expectedOutput,
    );
  if (!hasLegacyEnglishMetadata) return prompt;

  const localized = analyzePrompt(prompt.originalPrompt, prompt.notes, { category: prompt.category });
  const legacyAutoTags = new Set([
    "xiaohongshu", "copywriting", "caption", "hashtags", "engagement", "growth", "ui design", "neumorphism",
    "soft ui", "interaction", "portfolio", "image prompt", "pixel art", "food illustration", "game asset", "icon",
    "video prompt", "storyboard", "development", "debug", "frontend", "strategy", "summary", "tone", "template",
    "research", "review", "design", "writing", "coding", "image", "video", "career", "product",
  ]);
  const preservedTags = prompt.tags.filter(
    (tag) => !legacyAutoTags.has(tag.toLowerCase()) && tag.toLowerCase() !== prompt.platform.toLowerCase(),
  );
  return {
    ...prompt,
    useCase: localized.useCase,
    inputNeeded: localized.inputNeeded,
    expectedOutput: localized.expectedOutput,
    tags: normalizeTags([...localized.tags, ...preservedTags]),
  };
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  tags.forEach((tag) => {
    const cleanTag = String(tag).trim();
    const key = cleanTag.toLowerCase();
    if (!cleanTag || seen.has(key)) return;
    seen.add(key);
    normalized.push(cleanTag);
  });
  return normalized.slice(0, 8);
}

function normalizeCategory(category: PromptCategory | "Portfolio" | "Codex"): PromptCategory {
  if (category === "Portfolio") return "Design";
  if (category === "Codex") return "Coding";
  return typeof category === "string" && category.trim() ? category.trim() : "Product";
}

export async function savePrompts(prompts: PromptItem[]) {
  if (window.promptCabinetStorage) {
    await window.promptCabinetStorage.savePrompts(prompts);
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
}

function isPromptLike(value: unknown): value is PromptItem {
  return isRecord(value) && typeof value.originalPrompt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
