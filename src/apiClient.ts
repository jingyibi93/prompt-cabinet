import type { AnalysisLanguageSetting } from "./i18n";
import type { AnalyzeResult, ApiSettings } from "./types";

const SETTINGS_KEY = "prompt-cabinet-api-settings";

export const defaultApiSettings: ApiSettings = {
  enabled: false,
  provider: "mock",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
};

export async function loadApiSettings(): Promise<ApiSettings> {
  if (window.promptCabinetApi) {
    return normalizeSettings(await window.promptCabinetApi.loadSettings());
  }

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return defaultApiSettings;
  }
}

export async function saveApiSettings(settings: ApiSettings): Promise<ApiSettings> {
  const normalized = normalizeSettings(settings);
  if (window.promptCabinetApi) {
    return normalizeSettings(await window.promptCabinetApi.saveSettings(normalized));
  }

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function testApiConnection(settings: ApiSettings) {
  if (!window.promptCabinetApi) {
    return { ok: false, message: "Enhanced Analyze is available in the desktop app only." };
  }
  return window.promptCabinetApi.testConnection(normalizeSettings(settings));
}

export async function analyzePromptWithApi(
  rawPrompt: string,
  notes: string,
  settings: ApiSettings,
  outputLanguage: AnalysisLanguageSetting = "auto",
): Promise<AnalyzeResult> {
  if (!window.promptCabinetApi) {
    throw new Error("Enhanced Analyze is available in the desktop app only.");
  }
  return window.promptCabinetApi.analyzePrompt({
    rawPrompt,
    notes,
    settings: normalizeSettings(settings),
    outputLanguage,
  });
}

function normalizeSettings(value: Partial<ApiSettings>): ApiSettings {
  const provider = getProvider(value);
  return {
    ...defaultApiSettings,
    ...value,
    provider,
    baseUrl: value.baseUrl?.trim() || defaultApiSettings.baseUrl,
    apiKey: value.apiKey?.trim() || "",
    model: value.model?.trim() || "",
    enabled: provider !== "mock" && Boolean(value.enabled ?? true),
  };
}

function getProvider(value: Partial<ApiSettings>): ApiSettings["provider"] {
  if (value.provider === "mock" || value.provider === "openai-compatible" || value.provider === "codex-local") {
    return value.provider;
  }
  return value.enabled ? "openai-compatible" : "mock";
}
