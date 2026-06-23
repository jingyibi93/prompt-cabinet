export type PromptCategory =
  | "Design"
  | "Writing"
  | "Research"
  | "Coding"
  | "Image"
  | "Video"
  | "Career"
  | "Product";

export type PromptItem = {
  id: string;
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
};

export type ApiSettings = {
  enabled: boolean;
  provider: "mock" | "openai-compatible" | "codex-local";
  baseUrl: string;
  apiKey: string;
  model: string;
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
