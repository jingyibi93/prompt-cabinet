export type PromptCategory = string;

export type RewriteSegment = {
  value: string;
  status: "same" | "added" | "removed";
};

export type PromptItem = {
  id: string;
  status?: "inbox" | "saved";
  title: string;
  originalPrompt: string;
  refinedPrompt: string;
  useCase: string;
  inputNeeded: string[];
  expectedOutput: string;
  tags: string[];
  platform: string;
  notes: string;
  category: PromptCategory;
  createdAt: string;
  updatedAt?: string;
  previewImage?: string;
  rewriteHistory?: RewriteSegment[];
};

export type ApiSettings = {
  enabled: boolean;
  provider: "mock" | "openai-compatible" | "codex-local";
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type QuickShortcutSettings = {
  openQuickAdd: string;
  runAction: string;
  captureMode: string;
  insertMode: string;
  previousCategory: string;
  nextCategory: string;
  previousPrompt: string;
  nextPrompt: string;
  insertSelected: string;
  closeQuickAdd: string;
};

export type AnalyzeResult = {
  title: string;
  category: PromptCategory;
  tags: string[];
  platform: string;
  useCase: string;
  inputNeeded: string[];
  expectedOutput: string;
  refinedPrompt: string;
};
