import type { AnalyzeResult, ApiSettings, PromptCategory, PromptItem } from "./types";

const STORAGE_KEY = "prompt-cabinet-items";
const validCategories: PromptCategory[] = [
  "Design",
  "Writing",
  "Research",
  "Coding",
  "Image",
  "Video",
  "Career",
  "Product",
];

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
      }) => Promise<AnalyzeResult>;
    };
    promptCabinetWindow?: {
      getAlwaysOnTop: () => Promise<boolean>;
      setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
      readClipboardText: () => Promise<string>;
      openQuickAdd: () => Promise<void>;
      closeCurrentWindow: () => Promise<void>;
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
  return {
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
    category: normalizeCategory(prompt.category),
    tags: Array.isArray(prompt.tags)
      ? prompt.tags.map((tag) => (tag === "Portfolio" ? "Design" : tag === "Codex" ? "Coding" : tag))
      : [],
  };
}

function normalizeCategory(category: PromptCategory | "Portfolio" | "Codex"): PromptCategory {
  if (category === "Portfolio") return "Design";
  if (category === "Codex") return "Coding";
  if (!validCategories.includes(category)) return "Product";
  return category;
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
