import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type UiLanguageSetting = "auto" | "zh" | "en";
export type AnalysisLanguageSetting = "auto" | "zh" | "en";
export type ResolvedLanguage = "zh" | "en";

const UI_LANGUAGE_KEY = "prompt-cabinet-ui-language";
const ANALYSIS_LANGUAGE_KEY = "prompt-cabinet-analysis-language";

type LanguageContextValue = {
  uiLanguage: UiLanguageSetting;
  resolvedLanguage: ResolvedLanguage;
  analysisLanguage: AnalysisLanguageSetting;
  setUiLanguage: (language: UiLanguageSetting) => void;
  setAnalysisLanguage: (language: AnalysisLanguageSetting) => void;
  t: (english: string, chinese: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readUiLanguage(): UiLanguageSetting {
  const value = localStorage.getItem(UI_LANGUAGE_KEY);
  return value === "zh" || value === "en" ? value : "auto";
}

export function readAnalysisLanguage(): AnalysisLanguageSetting {
  const value = localStorage.getItem(ANALYSIS_LANGUAGE_KEY);
  return value === "zh" || value === "en" ? value : "auto";
}

function resolveLanguage(setting: UiLanguageSetting): ResolvedLanguage {
  if (setting !== "auto") return setting;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [uiLanguage, setUiLanguageState] = useState<UiLanguageSetting>(readUiLanguage);
  const [analysisLanguage, setAnalysisLanguageState] = useState<AnalysisLanguageSetting>(readAnalysisLanguage);
  const resolvedLanguage = resolveLanguage(uiLanguage);

  useEffect(() => {
    function syncLanguageSettings(event: StorageEvent) {
      if (event.key === UI_LANGUAGE_KEY) setUiLanguageState(readUiLanguage());
      if (event.key === ANALYSIS_LANGUAGE_KEY) setAnalysisLanguageState(readAnalysisLanguage());
    }
    window.addEventListener("storage", syncLanguageSettings);
    return () => window.removeEventListener("storage", syncLanguageSettings);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      uiLanguage,
      resolvedLanguage,
      analysisLanguage,
      setUiLanguage: (language) => {
        localStorage.setItem(UI_LANGUAGE_KEY, language);
        setUiLanguageState(language);
      },
      setAnalysisLanguage: (language) => {
        localStorage.setItem(ANALYSIS_LANGUAGE_KEY, language);
        setAnalysisLanguageState(language);
      },
      t: (english, chinese) => (resolvedLanguage === "zh" ? chinese : english),
    }),
    [analysisLanguage, resolvedLanguage, uiLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider.");
  return context;
}

export function resolveAnalysisLanguage(setting: AnalysisLanguageSetting, prompt: string): ResolvedLanguage {
  if (setting !== "auto") return setting;
  return (prompt.match(/[\u3400-\u9fff]/g) ?? []).length >= 4 ? "zh" : "en";
}
