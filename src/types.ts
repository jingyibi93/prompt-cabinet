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

export type AppUpdateInfo = {
  status: "update-available" | "up-to-date" | "unavailable";
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseUrl?: string;
  publishedAt?: string;
  message?: string;
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

export type ImagePromptMatch = {
  imageId: string;
  promptId: string;
  confidence: number;
};

export type ImagePromptMatchResult = {
  matches: ImagePromptMatch[];
};

export type PromptClassification = {
  id: string;
  title: string;
  category: PromptCategory;
  tags: string[];
  inputNeeded: string[];
};

export type PromptClassificationResult = {
  classifications: PromptClassification[];
};
