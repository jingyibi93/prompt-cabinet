import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import mammoth from "mammoth/mammoth.browser";
import {
  analyzePromptWithApi,
  classifyPromptsWithApi,
  defaultApiSettings,
  loadApiSettings,
  matchImagesWithApi,
  normalizeCodexModelId,
  saveApiSettings,
  testApiConnection,
} from "./apiClient";
import { analyzePrompt, categories as builtInCategories, cleanPromptTags, isChinesePrompt } from "./promptEngine";
import { loadPrompts, normalizeImportedPrompts, savePrompts } from "./storage";
import {
  LanguageProvider,
  useLanguage,
  type AnalysisLanguageSetting,
  type UiLanguageSetting,
} from "./i18n";
import type { ApiSettings, AppUpdateInfo, PromptCategory, PromptItem, QuickShortcutSettings, RewriteSegment } from "./types";

type View = "dashboard" | "add" | "library" | "detail" | "edit" | "settings";
type WorkspaceScope = "all" | "category";
type SettingsSection = "analyze" | "shortcuts" | "language" | "updates";
type CustomCategory = {
  name: PromptCategory;
  color: string;
};
type BulkImportImage = {
  id: string;
  name: string;
  dataUrl: string;
};
type BulkImportProgress = {
  current: number;
  total: number;
};
type BulkImportItem = {
  id: string;
  sourceName: string;
  title: string;
  titleGenerated?: boolean;
  titleEdited?: boolean;
  titleAnalyzed?: boolean;
  originalPrompt: string;
  category: PromptCategory;
  categoryEdited?: boolean;
  categoryAiAnalyzed?: boolean;
  tags: string[];
  inputNeeded: string[];
  previewImage?: string;
  imageId: string;
  included: boolean;
};

const tagTone = ["mint", "peach", "rose", "stone"];
const CUSTOM_CATEGORIES_KEY = "prompt-cabinet-custom-categories";
const HIDDEN_CATEGORIES_KEY = "prompt-cabinet-hidden-categories";
const ONBOARDING_COMPLETE_KEY = "prompt-cabinet-onboarding-complete-v1";
const QUICK_ADD_INBOX_TARGET = "__prompt-cabinet-quick-inbox__";
const QUICK_BROWSE_INBOX = "Inbox";
type QuickMode = "capture" | "insert";
const defaultQuickShortcutSettings: QuickShortcutSettings = {
  openQuickAdd: "CommandOrControl+Alt+P",
  runAction: "CommandOrControl+S",
  captureMode: "CommandOrControl+1",
  insertMode: "CommandOrControl+2",
  previousCategory: "CommandOrControl+Left",
  nextCategory: "CommandOrControl+Right",
  previousPrompt: "CommandOrControl+Up",
  nextPrompt: "CommandOrControl+Down",
  insertSelected: "CommandOrControl+Enter",
  closeQuickAdd: "Escape",
};
const categoryColorSwatches = ["#dcece2", "#f2dfd2", "#f0dde3", "#e0e4e6", "#dbe7f5", "#eadff5", "#f0e7d8", "#dce9ea"];
const builtInCategoryColors: Record<string, string> = {
  Design: "#dcece2",
  Writing: "#f2dfd2",
  Research: "#f0dde3",
  Coding: "#e0e4e6",
  Image: "#dcece2",
  Video: "#f2dfd2",
  Career: "#f0dde3",
  Product: "#e0e4e6",
};

function isQuickAddMode() {
  return new URLSearchParams(window.location.search).get("quick") === "1";
}

function isQuickPreviewMode() {
  return new URLSearchParams(window.location.search).get("quickPreview") === "1";
}

function loadCustomCategories(): CustomCategory[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const categories = parsed
      .map((item, index) => {
        if (isRecord(item)) {
          const name = normalizeCustomCategoryName(String(item.name ?? ""));
          if (!name) return undefined;
          return {
            name,
            color: normalizeCategoryColor(String(item.color ?? "")) || categoryColorSwatches[index % categoryColorSwatches.length],
          };
        }
        const name = normalizeCustomCategoryName(String(item));
        if (!name) return undefined;
        return {
          name,
          color: categoryColorSwatches[index % categoryColorSwatches.length],
        };
      })
      .filter((item): item is CustomCategory => Boolean(item));
    return mergeCustomCategories(categories);
  } catch {
    return [];
  }
}

function loadHiddenCategories(): PromptCategory[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_CATEGORIES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return mergeCategoryNames(parsed.map((item) => normalizeCustomCategoryName(String(item))).filter(Boolean));
  } catch {
    return [];
  }
}

function loadOnboardingComplete() {
  return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "1";
}

export default function App() {
  if (isQuickPreviewMode()) return <QuickImagePreviewApp />;
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

function AppContent() {
  const { analysisLanguage, t } = useLanguage();
  if (isQuickAddMode()) return <QuickAddApp />;

  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [selectedId, setSelectedId] = useState(prompts[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<PromptCategory | "All">("All");
  const [dataCategory, setDataCategory] = useState<PromptCategory>("Design");
  const [openDataMenu, setOpenDataMenu] = useState<"window" | "setting" | "data" | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("analyze");
  const [apiSettings, setApiSettings] = useState<ApiSettings>(defaultApiSettings);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [quickShortcuts, setQuickShortcuts] = useState<QuickShortcutSettings>(defaultQuickShortcutSettings);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(() => loadCustomCategories());
  const [hiddenCategories, setHiddenCategories] = useState<PromptCategory[]>(() => loadHiddenCategories());
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [categoryDraftColor, setCategoryDraftColor] = useState(categoryColorSwatches[0]);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [isExportWorkbenchOpen, setIsExportWorkbenchOpen] = useState(false);
  const [isHelpGuideOpen, setIsHelpGuideOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() => !loadOnboardingComplete());
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [bulkImportItems, setBulkImportItems] = useState<BulkImportItem[]>([]);
  const [bulkImportImages, setBulkImportImages] = useState<BulkImportImage[]>([]);
  const [bulkImportNotice, setBulkImportNotice] = useState("");
  const [isReadingBulkFiles, setIsReadingBulkFiles] = useState(false);
  const [isImportingBulkItems, setIsImportingBulkItems] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState<BulkImportProgress | null>(null);
  const [isAiMatchingBulkImages, setIsAiMatchingBulkImages] = useState(false);
  const [isAiClassifyingBulkItems, setIsAiClassifyingBulkItems] = useState(false);
  const bulkImportInputRef = useRef<HTMLInputElement>(null);

  async function checkForUpdates() {
    setIsCheckingUpdates(true);
    try {
      const result = await window.promptCabinetWindow?.checkForUpdates();
      setUpdateInfo(result ?? {
        status: "unavailable",
        currentVersion: "",
        message: t("Update checks are available in the Electron app.", "更新检查仅适用于 Electron 桌面应用。"),
      });
    } catch (error) {
      setUpdateInfo({
        status: "unavailable",
        currentVersion: "",
        message: error instanceof Error ? error.message : t("Unable to check for updates.", "暂时无法检查更新。"),
      });
    } finally {
      setIsCheckingUpdates(false);
    }
  }

  async function openUpdateDownload() {
    if (!updateInfo?.releaseUrl) return;
    await window.promptCabinetWindow?.openUpdateDownload(updateInfo.releaseUrl);
  }

  useEffect(() => {
    void checkForUpdates();
  }, []);

  useEffect(() => {
    if (!openDataMenu) return;

    const closeMenuWhenClickingElsewhere = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".data-menu")) return;
      setOpenDataMenu(null);
    };

    document.addEventListener("pointerdown", closeMenuWhenClickingElsewhere);
    return () => document.removeEventListener("pointerdown", closeMenuWhenClickingElsewhere);
  }, [openDataMenu]);

  useEffect(() => {
    let isMounted = true;
    void loadPrompts().then((loadedPrompts) => {
      if (!isMounted) return;
      setPrompts(loadedPrompts);
      setSelectedId(loadedPrompts[0]?.id ?? "");
      setStorageReady(true);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    void loadApiSettings().then((settings) => {
      if (isMounted) setApiSettings(settings);
    });
    void window.promptCabinetWindow?.loadShortcuts().then((shortcuts) => {
      if (isMounted) setQuickShortcuts(shortcuts);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    void savePrompts(prompts);
  }, [prompts, storageReady]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(customCategories));
  }, [customCategories]);

  useEffect(() => {
    localStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify(hiddenCategories));
  }, [hiddenCategories]);

  useEffect(() => {
    if (!window.promptCabinetStorage?.onPromptsChanged) return undefined;
    return window.promptCabinetStorage.onPromptsChanged(() => {
      void loadPrompts().then((loadedPrompts) => {
        setPrompts(loadedPrompts);
        setSelectedId((currentId) =>
          currentId && loadedPrompts.some((prompt) => prompt.id === currentId)
            ? currentId
            : loadedPrompts[0]?.id ?? "",
        );
      });
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    void window.promptCabinetWindow?.getAlwaysOnTop().then((enabled) => {
      if (!isMounted) return;
      setAlwaysOnTop(Boolean(enabled));
      if (enabled) setView("library");
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedId) ?? prompts[0];
  const savedPrompts = useMemo(() => prompts.filter((prompt) => prompt.status !== "inbox"), [prompts]);
  const inboxPrompts = useMemo(() => prompts.filter((prompt) => prompt.status === "inbox"), [prompts]);
  const allCategories = useMemo(
    () => getVisibleCategories(customCategories, hiddenCategories, prompts),
    [customCategories, hiddenCategories, prompts],
  );
  const customCategoryNames = useMemo(() => customCategories.map((category) => category.name), [customCategories]);
  const categoryColors = useMemo(() => {
    const colors: Record<string, string> = { ...builtInCategoryColors };
    customCategories.forEach((category) => {
      colors[category.name] = category.color;
    });
    return colors;
  }, [customCategories]);
  const recentPrompts = useMemo(() => buildRecentPrompts(savedPrompts, 4), [savedPrompts]);

  const filteredPrompts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return savedPrompts.filter((prompt) => {
      const matchesCategory = categoryFilter === "All" || prompt.category === categoryFilter;
      const haystack = [
        prompt.title,
        prompt.useCase,
        prompt.platform,
        mergeUnique(prompt.tags, []).join(" "),
        prompt.originalPrompt,
      ]
        .join(" ")
        .toLowerCase();
      return matchesCategory && (!needle || haystack.includes(needle));
    });
  }, [categoryFilter, savedPrompts, query]);

  useEffect(() => {
    if (!allCategories.includes(dataCategory)) setDataCategory(allCategories[0] ?? "Product");
    if (categoryFilter !== "All" && !allCategories.includes(categoryFilter)) setCategoryFilter("All");
  }, [allCategories, categoryFilter, dataCategory]);

  function openCustomCategoryDialog() {
    setCategoryDraft("");
    setCategoryDraftColor(categoryColorSwatches[customCategories.length % categoryColorSwatches.length]);
    setIsCategoryDialogOpen(true);
  }

  function closeCustomCategoryDialog() {
    setIsCategoryDialogOpen(false);
    setCategoryDraft("");
    setCategoryDraftColor(categoryColorSwatches[0]);
  }

  function saveCustomCategory() {
    const category = normalizeCustomCategoryName(categoryDraft);
    if (!category) return;
    if (allCategories.some((item) => item.toLowerCase() === category.toLowerCase())) {
      window.alert(t(`"${category}" already exists.`, `“${category}”已存在。`));
      return;
    }
    setCustomCategories((current) => [...current, { name: category, color: categoryDraftColor }]);
    setCategoryFilter(category);
    setDataCategory(category);
    setView("library");
    closeCustomCategoryDialog();
  }

  function deleteCategory(category: PromptCategory) {
    const categoryPromptCount = prompts.filter((prompt) => prompt.category === category).length;
    if (categoryPromptCount > 0) {
      window.alert(t(`"${category}" has ${categoryPromptCount} prompts. Move or delete them before removing this category.`, `“${category}”中有 ${categoryPromptCount} 条 Prompt，请先移动或删除。`));
      return;
    }
    if (!window.confirm(t(`Delete category "${category}"?`, `删除分类“${category}”？`))) {
      return;
    }
    if (customCategoryNames.includes(category)) {
      setCustomCategories((current) => current.filter((item) => item.name !== category));
    } else {
      setHiddenCategories((current) => mergeCategoryNames([...current, category]));
    }
    if (categoryFilter === category) setCategoryFilter("All");
    if (dataCategory === category) setDataCategory(allCategories.find((item) => item !== category) ?? "Product");
  }

  function addPrompt(prompt: PromptItem) {
    setPrompts((current) => [{ ...prompt, status: "saved", updatedAt: prompt.updatedAt ?? prompt.createdAt }, ...current]);
    setSelectedId(prompt.id);
    setView("detail");
  }

  function updatePrompt(updatedPrompt: PromptItem) {
    const updatedAt = new Date().toISOString();
    setPrompts((current) =>
      current.map((prompt) => (prompt.id === updatedPrompt.id ? { ...updatedPrompt, status: "saved", updatedAt } : prompt)),
    );
    setSelectedId(updatedPrompt.id);
    setView("detail");
  }

  function deletePrompt(id: string) {
    const prompt = prompts.find((item) => item.id === id);
    if (!prompt || !window.confirm(t(`Delete "${prompt.title}" from Prompt Cabinet?`, `从 Prompt Cabinet 删除“${prompt.title}”？`))) return;
    const remaining = prompts.filter((item) => item.id !== id);
    setPrompts(remaining);
    setSelectedId(remaining[0]?.id ?? "");
    setView("library");
  }

  function deleteInboxPrompt(id: string) {
    const prompt = prompts.find((item) => item.id === id);
    if (!prompt || !window.confirm(t(`Delete "${prompt.title}" from Inbox?`, `从临时收藏夹删除“${prompt.title}”？`))) return;
    const remaining = prompts.filter((item) => item.id !== id);
    setPrompts(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? "");
  }

  function openDetail(id: string) {
    setSelectedId(id);
    setView("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function downloadPromptExport(exportedPrompts: PromptItem[], mode: WorkspaceScope) {
    const payload = {
      app: "Prompt Cabinet",
      version: 1,
      scope: mode,
      category: mode === "category" ? dataCategory : "All",
      exportedAt: new Date().toISOString(),
      prompts: exportedPrompts,
    };
    const categorySlug = mode === "category" ? `-${dataCategory.toLowerCase()}` : "";
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `prompt-cabinet${categorySlug}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function openBulkImportWorkbench() {
    setBulkImportNotice("");
    setIsBulkImportOpen(true);
  }

  function closeBulkImportWorkbench() {
    setIsBulkImportOpen(false);
    setBulkImportItems([]);
    setBulkImportImages([]);
    setBulkImportNotice("");
    setBulkImportProgress(null);
  }

  function closeExportWorkbench() {
    setIsExportWorkbenchOpen(false);
  }

  async function addBulkImportFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setIsReadingBulkFiles(true);
    setBulkImportNotice("");
    try {
      const parsed = await prepareBulkImportFiles(files);
      const nextImages = mergeBulkImportImages(bulkImportImages, parsed.images);
      const nextItems = autoAssignBulkImages(mergeBulkImportItems(bulkImportItems, parsed.items), nextImages).map(
        autoClassifyBulkImportItem,
      );
      setBulkImportImages(nextImages);
      setBulkImportItems(nextItems);
      const message = [
        parsed.items.length ? t(`Found ${parsed.items.length} prompt candidates.`, `识别到 ${parsed.items.length} 条候选 Prompt。`) : "",
        parsed.images.length ? t(`Added ${parsed.images.length} images.`, `加入 ${parsed.images.length} 张图片。`) : "",
        parsed.skippedCount ? t(`Skipped ${parsed.skippedCount} unsupported files.`, `跳过 ${parsed.skippedCount} 个不支持的文件。`) : "",
      ]
        .filter(Boolean)
        .join(" ");
      setBulkImportNotice(message || t("No prompt content was found in these files.", "这些文件中没有识别到 Prompt 内容。"));
    } catch {
      setBulkImportNotice(t("Some files could not be read. Try text, Markdown, Word, JSON, CSV, or image files.", "部分文件无法读取。请尝试文本、Markdown、Word、JSON、CSV 或图片文件。"));
    } finally {
      setIsReadingBulkFiles(false);
      if (bulkImportInputRef.current) bulkImportInputRef.current.value = "";
    }
  }

  function updateBulkImportItem(id: string, patch: Partial<BulkImportItem>) {
    setBulkImportItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function aiClassifyBulkImportItems() {
    if (!apiSettings.enabled || apiSettings.provider === "mock") {
      setBulkImportNotice(t("Configure Local Codex or an OpenAI-compatible API in Analyze Settings first.", "请先在分析设置中配置本地 Codex 或兼容 OpenAI 的 API。"));
      if (window.confirm(t("AI Smart Categorize needs Local Codex or an API connection. Open Analyze Settings now?", "AI 智能分类需要先连接本地 Codex 或 API。现在前往分析设置吗？"))) {
        setIsBulkImportOpen(false);
        setSettingsSection("analyze");
        setView("settings");
        setOpenDataMenu(null);
      }
      return;
    }
    const candidates = bulkImportItems.filter((item) => item.included && !item.categoryEdited).slice(0, 36);
    if (!candidates.length) {
      setBulkImportNotice(t("There are no auto-classified prompts left to improve.", "没有可供 AI 改进分类的自动分类 Prompt。"));
      return;
    }
    const analyzerName = apiSettings.provider === "codex-local"
      ? t("Local Codex", "本地 Codex")
      : apiSettings.model || t("your configured API", "已配置的 API");
    const confirmed = window.confirm(
      t(
        `Send ${candidates.length} prompt candidates to ${analyzerName} for smarter categorization? This may use your account or API quota.`,
        `将 ${candidates.length} 条候选 Prompt 发送给 ${analyzerName} 进行智能分类吗？这可能会消耗账户或 API 额度。`,
      ),
    );
    if (!confirmed) return;

    setIsAiClassifyingBulkItems(true);
    setBulkImportNotice(t("AI is improving prompt categories...", "AI 正在优化 Prompt 分类..."));
    try {
      const result = await classifyPromptsWithApi(
        candidates.map((item) => ({ id: item.id, title: item.title, originalPrompt: item.originalPrompt })),
        allCategories,
        apiSettings,
      );
      const classificationsById = new Map(result.classifications.map((classification) => [classification.id, classification]));
      setBulkImportItems((current) =>
        current.map((item) => {
          const classification = classificationsById.get(item.id);
          if (!classification || item.categoryEdited) return item;
          const shouldApplyAiTitle = Boolean(classification.title) && !item.titleEdited;
          return {
            ...item,
            title: shouldApplyAiTitle ? classification.title : item.title,
            titleAnalyzed: shouldApplyAiTitle || item.titleAnalyzed,
            category: classification.category,
            categoryAiAnalyzed: true,
            tags: classification.tags.length ? classification.tags : item.tags,
            inputNeeded: classification.inputNeeded.length ? classification.inputNeeded : item.inputNeeded,
          };
        }),
      );
      setBulkImportNotice(
        result.classifications.length
          ? t(`AI improved ${result.classifications.length} prompt classifications and input fields. You can still adjust any row manually.`, `AI 已优化 ${result.classifications.length} 条 Prompt 的分类和所需输入，仍可逐条手动调整。`)
          : t("AI did not return any usable categories. Try again or adjust the rows manually.", "AI 没有返回可用分类，请重试或逐条手动调整。"),
      );
    } catch (error) {
      setBulkImportNotice(
        t(
          `AI classification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          `AI 智能分类失败：${error instanceof Error ? error.message : "未知错误"}`,
        ),
      );
    } finally {
      setIsAiClassifyingBulkItems(false);
    }
  }

  async function aiMatchBulkImportImages() {
    if (!apiSettings.enabled || apiSettings.provider === "mock") {
      setBulkImportNotice(t("Configure Local Codex or an OpenAI-compatible vision API in Analyze Settings first.", "请先在分析设置中配置本地 Codex 或兼容 OpenAI 的视觉 API。"));
      return;
    }
    const linkedImageIds = new Set(bulkImportItems.map((item) => item.imageId).filter(Boolean));
    const unmatchedImages = bulkImportImages.filter((image) => !linkedImageIds.has(image.id)).slice(0, 12);
    const unmatchedPrompts = bulkImportItems.filter((item) => item.included && !item.imageId && !item.previewImage).slice(0, 36);
    if (!unmatchedImages.length || !unmatchedPrompts.length) {
      setBulkImportNotice(t("There are no unmatched images and prompts to compare.", "没有需要比较的未关联图片和 Prompt。"));
      return;
    }
    const confirmed = window.confirm(
      t(
        `Send ${unmatchedImages.length} images and ${unmatchedPrompts.length} prompt candidates to ${apiSettings.model || "your configured API"} for visual matching? This may use API credits.`,
        `将 ${unmatchedImages.length} 张图片和 ${unmatchedPrompts.length} 条候选 Prompt 发送给 ${apiSettings.model || "已配置的 API"} 进行视觉匹配吗？这会消耗 API 额度。`,
      ),
    );
    if (!confirmed) return;

    setIsAiMatchingBulkImages(true);
    setBulkImportNotice(t("AI is comparing the unmatched images...", "AI 正在比较未关联的图片..."));
    try {
      const preparedImages = await Promise.all(
        unmatchedImages.map(async (image) => ({ ...image, dataUrl: await createVisionThumbnail(image.dataUrl) })),
      );
      const result = await matchImagesWithApi(
        preparedImages,
        unmatchedPrompts.map((item) => ({ id: item.id, title: item.title, originalPrompt: item.originalPrompt })),
        apiSettings,
      );
      const confidentMatches = result.matches.filter((match) => match.confidence >= 0.72);
      const matchesByPrompt = new Map(confidentMatches.map((match) => [match.promptId, match.imageId]));
      setBulkImportItems((current) =>
        current.map((item) => (item.imageId || !matchesByPrompt.has(item.id) ? item : { ...item, imageId: matchesByPrompt.get(item.id) ?? "" })),
      );
      const uncertainCount = result.matches.length - confidentMatches.length;
      setBulkImportNotice(
        t(
          `AI matched ${confidentMatches.length} images with high confidence${uncertainCount ? `; ${uncertainCount} lower-confidence matches were left for manual review.` : "."}`,
          `AI 高置信度匹配了 ${confidentMatches.length} 张图片${uncertainCount ? `；另有 ${uncertainCount} 条低置信度结果保留给你手动确认。` : "。"}`,
        ),
      );
    } catch (error) {
      setBulkImportNotice(
        t(
          `AI image matching failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          `AI 图片匹配失败：${error instanceof Error ? error.message : "未知错误"}`,
        ),
      );
    } finally {
      setIsAiMatchingBulkImages(false);
    }
  }

  async function importBulkItems() {
    const selected = bulkImportItems.filter((item) => item.included && item.originalPrompt.trim());
    if (!selected.length) {
      setBulkImportNotice(t("Select at least one prompt to import.", "请至少选择一条 Prompt 导入。"));
      return;
    }
    const imagesById = new Map(bulkImportImages.map((image) => [image.id, image.dataUrl]));
    const shouldUseApi = apiSettings.enabled && apiSettings.provider !== "mock";
    setIsImportingBulkItems(true);
    setBulkImportProgress({ current: 0, total: selected.length });
    setBulkImportNotice(
      shouldUseApi
        ? t(`Analyzing ${selected.length} prompts with your connected API...`, `正在使用已连接的 API 分析 ${selected.length} 条 Prompt...`)
        : t(`Analyzing ${selected.length} prompts locally...`, `正在使用本地规则分析 ${selected.length} 条 Prompt...`),
    );

    const importedPrompts: PromptItem[] = [];
    let apiFallbackCount = 0;
    let apiAnalyzedCount = 0;
    for (const [index, item] of selected.entries()) {
      const basePrompt = autoClassifyImportedPrompt({
        id: item.id,
        status: "saved",
        // File names and first lines are only preview labels. Generate a useful library title on import.
        title: item.titleGenerated && !item.titleEdited && !item.titleAnalyzed ? "Untitled Prompt" : item.title.trim() || "Untitled Prompt",
        originalPrompt: item.originalPrompt.trim(),
        refinedPrompt: item.originalPrompt.trim(),
        useCase: "",
        inputNeeded: item.inputNeeded,
        expectedOutput: "",
        tags: item.tags,
        platform: "ChatGPT",
        notes: `Imported from ${item.sourceName}`,
        category: item.category,
        createdAt: new Date().toISOString(),
        previewImage: imagesById.get(item.imageId) ?? item.previewImage,
      }, item.categoryEdited || item.categoryAiAnalyzed ? item.category : undefined);

      if (shouldUseApi) {
        try {
          const analyzed = await analyzePromptWithApi(basePrompt.originalPrompt, basePrompt.notes, apiSettings, analysisLanguage);
          apiAnalyzedCount += 1;
          importedPrompts.push({
            ...basePrompt,
            title: item.titleEdited ? basePrompt.title : analyzed.title || basePrompt.title,
            category: item.categoryEdited ? basePrompt.category : analyzed.category || basePrompt.category,
            tags: analyzed.tags.length ? analyzed.tags : basePrompt.tags,
            platform: analyzed.platform || basePrompt.platform,
            useCase: analyzed.useCase || basePrompt.useCase,
            inputNeeded: analyzed.inputNeeded.length ? analyzed.inputNeeded : basePrompt.inputNeeded,
            expectedOutput: analyzed.expectedOutput || basePrompt.expectedOutput,
            refinedPrompt: analyzed.refinedPrompt || basePrompt.refinedPrompt,
          });
        } catch {
          apiFallbackCount += 1;
          importedPrompts.push(basePrompt);
        }
      } else {
        importedPrompts.push(basePrompt);
      }
      setBulkImportProgress({ current: index + 1, total: selected.length });
    }

    const { prompts: mergedPrompts, added, updated } = mergeImportedPrompts(prompts, importedPrompts);
    setPrompts(mergedPrompts);
    setSelectedId(importedPrompts[0]?.id ?? mergedPrompts[0]?.id ?? "");
    setCategoryFilter("All");
    setView("library");
    setIsImportingBulkItems(false);
    closeBulkImportWorkbench();
    const analysisMessage = shouldUseApi
      ? t(
        ` API analyzed ${apiAnalyzedCount} prompt(s)${apiFallbackCount ? `; ${apiFallbackCount} used local fallback after an API failure.` : "."}`,
        `其中 ${apiAnalyzedCount} 条已由 API 分析${apiFallbackCount ? `；${apiFallbackCount} 条因 API 失败，已使用本地规则补全。` : "。"}`,
      )
      : t(" All prompts used local rules.", "全部使用本地规则分析。");
    window.alert(t(`Imported ${selected.length} prompts. Added ${added}, updated ${updated}.${analysisMessage}`, `已导入 ${selected.length} 条 Prompt，新增 ${added} 条，更新 ${updated} 条。${analysisMessage}`));
  }

  function exportWorkspacePrompts(selectedIds: string[], mode: WorkspaceScope) {
    const selected = savedPrompts.filter((prompt) => selectedIds.includes(prompt.id));
    const exportedPrompts = mode === "category"
      ? selected.filter((prompt) => prompt.category === dataCategory)
      : savedPrompts;
    if (!exportedPrompts.length) {
      window.alert(
        mode === "category"
          ? t("Select at least one prompt in the chosen category.", "请至少勾选一条所选分类中的 Prompt。")
          : t("There are no saved prompts to export.", "目前没有可导出的已保存 Prompt。"),
      );
      return;
    }
    downloadPromptExport(exportedPrompts, mode);
    closeExportWorkbench();
  }

  async function toggleAlwaysOnTop() {
    const nextValue = !alwaysOnTop;
    setAlwaysOnTop(nextValue);
    if (nextValue) {
      setView("library");
      setOpenDataMenu(null);
    }
    try {
      const savedValue = await window.promptCabinetWindow?.setAlwaysOnTop(nextValue);
      setAlwaysOnTop(Boolean(savedValue));
    } catch {
      setAlwaysOnTop(!nextValue);
      window.alert(t("Could not change window pin state in this environment.", "当前环境无法修改窗口置顶状态。"));
    }
  }

  return (
    <div className={alwaysOnTop ? "app-shell pinned-side-mode" : "app-shell"}>
      <header className="topbar">
        <button className="brand-button" onClick={() => setView("dashboard")}>
          <span className="brand-mark">PC</span>
          <span>Prompt Cabinet</span>
        </button>
        <nav className="nav-pills" aria-label="Primary navigation">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            {t("Home", "首页")}
          </button>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>
            {t("Library", "资料库")}
          </button>
          <div className="data-menu">
            <button
              className={openDataMenu === "window" ? "active" : ""}
              onClick={() => setOpenDataMenu((current) => (current === "window" ? null : "window"))}
            >
              {t("Window", "窗口")}
            </button>
            {openDataMenu === "window" && (
              <div className="data-popover lift-card">
                {window.promptCabinetWindow && (
                  <button
                    className="popover-action"
                    onClick={() => {
                      void window.promptCabinetWindow?.openQuickAdd();
                      setOpenDataMenu(null);
                    }}
                  >
                    {t("Quick Add", "快速面板")}
                  </button>
                )}
                {window.promptCabinetWindow && (
                  <button
                    className={alwaysOnTop ? "popover-action active" : "popover-action"}
                    onClick={() => void toggleAlwaysOnTop()}
                  >
                    {alwaysOnTop ? t("Unpin Window", "取消置顶") : t("Pin Window", "窗口置顶")}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="data-menu">
            <button
              className={view === "settings" || openDataMenu === "setting" || openDataMenu === "data" ? "active" : ""}
              onClick={() => setOpenDataMenu((current) => (current === "setting" ? null : "setting"))}
            >
              {t("Setting", "设置")}
              {updateInfo?.status === "update-available" && <span className="update-dot" aria-label={t("Update available", "有更新可用")} />}
            </button>
            {openDataMenu === "setting" && (
              <div className="data-popover tools-popover lift-card">
                <button
                  className="popover-action"
                  onClick={() => {
                    setSettingsSection("analyze");
                    setView("settings");
                    setOpenDataMenu(null);
                  }}
                >
                  {t("Analyze Settings", "分析设置")}
                </button>
                <button
                  className="popover-action"
                  onClick={() => {
                    setSettingsSection("shortcuts");
                    setView("settings");
                    setOpenDataMenu(null);
                  }}
                >
                  {t("Shortcut Settings", "快捷键设置")}
                </button>
                <button
                  className="popover-action"
                  onClick={() => {
                    setSettingsSection("language");
                    setView("settings");
                    setOpenDataMenu(null);
                  }}
                >
                  {t("Language Settings", "语言设置")}
                </button>
                <button
                  className={updateInfo?.status === "update-available" ? "popover-action update-action" : "popover-action"}
                  onClick={() => {
                    setSettingsSection("updates");
                    setView("settings");
                    setOpenDataMenu(null);
                  }}
                >
                  {updateInfo?.status === "update-available" ? t("Update available", "有更新可用") : t("Check for Updates", "检查更新")}
                  {updateInfo?.status === "update-available" && <span className="update-menu-badge">NEW</span>}
                </button>
                <button className="popover-action" onClick={() => setOpenDataMenu("data")}>
                  {t("Export / Import", "导出 / 导入")}
                </button>
              </div>
            )}
            {openDataMenu === "data" && (
              <div className="data-popover data-management-popover lift-card">
                <div className="popover-panel-heading">
                  <strong>{t("Export / Import", "导出 / 导入")}</strong>
                  <button className="popover-back" onClick={() => setOpenDataMenu("setting")} aria-label="Back to Setting">
                    {t("Back", "返回")}
                  </button>
                </div>
                <button
                  className="popover-action workspace-entry"
                  onClick={() => {
                    openBulkImportWorkbench();
                    setOpenDataMenu(null);
                  }}
                >
                  <span>{t("Import Workspace", "导入工作台")}</span>
                  <small>{t("Preview files, match images, and choose a destination.", "预览文件、匹配图片并选择导入位置。")}</small>
                </button>
                <button
                  className="popover-action workspace-entry"
                  onClick={() => {
                    setIsExportWorkbenchOpen(true);
                    setOpenDataMenu(null);
                  }}
                  disabled={!savedPrompts.length}
                >
                  <span>{t("Export Workspace", "导出工作台")}</span>
                  <small>{t("Preview and select prompts before downloading JSON.", "预览并勾选 Prompt 后再下载 JSON。")}</small>
                </button>
              </div>
            )}
          </div>
          <button
            className={isHelpGuideOpen ? "active" : ""}
            onClick={() => {
              setOpenDataMenu(null);
              setIsHelpGuideOpen(true);
            }}
          >
            {t("Help", "帮助")}
          </button>
        </nav>
        <input
          ref={bulkImportInputRef}
          className="hidden-file-input"
          type="file"
          accept=".txt,.md,.markdown,.docx,.json,.csv,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json,text/csv,image/*"
          multiple
          onChange={(event) => void addBulkImportFiles(event.target.files)}
        />
      </header>

      <main className={`page page-${view}`}>
        {view === "dashboard" && (
          <Dashboard
            recentPrompts={recentPrompts}
            inboxPrompts={inboxPrompts}
            categories={allCategories}
            categoryColors={categoryColors}
            onNew={() => setView("add")}
            onAddCategory={openCustomCategoryDialog}
            onDeleteCategory={deleteCategory}
            onLibrary={(category) => {
              setCategoryFilter(category);
              setView("library");
            }}
            onDetail={openDetail}
            onEdit={(id) => {
              setSelectedId(id);
              setView("edit");
            }}
            onDelete={deleteInboxPrompt}
          />
        )}
        {view === "add" && <PromptForm mode="add" onSave={addPrompt} apiSettings={apiSettings} categories={allCategories} />}
        {view === "library" && (
          <Library
            prompts={filteredPrompts}
            query={query}
            categories={allCategories}
            categoryFilter={categoryFilter}
            onQuery={setQuery}
            onCategory={setCategoryFilter}
            onDetail={openDetail}
            onEdit={(id) => {
              setSelectedId(id);
              setView("edit");
            }}
            onDelete={deletePrompt}
            totalPrompts={savedPrompts.length}
            onNew={() => setView("add")}
          />
        )}
        {view === "detail" && selectedPrompt && (
          <PromptDetail
            prompt={selectedPrompt}
            onSave={updatePrompt}
            onEdit={() => setView("edit")}
            onDelete={() => deletePrompt(selectedPrompt.id)}
          />
        )}
        {view === "edit" && selectedPrompt && (
          <PromptForm
            mode="edit"
            initialPrompt={selectedPrompt}
            onSave={updatePrompt}
            apiSettings={apiSettings}
            categories={allCategories}
          />
        )}
        {view === "settings" && settingsSection === "analyze" && (
          <ApiSettingsPage
            settings={apiSettings}
            onSave={async (settings) => {
              const saved = await saveApiSettings(settings);
              setApiSettings(saved);
            }}
          />
        )}
        {view === "settings" && settingsSection === "shortcuts" && (
          <ShortcutSettingsPage
            settings={quickShortcuts}
            onSave={async (settings) => {
              const saved = await window.promptCabinetWindow?.saveShortcuts(settings);
              if (saved) setQuickShortcuts(saved);
            }}
          />
        )}
        {view === "settings" && settingsSection === "language" && <LanguageSettingsPage />}
        {view === "settings" && settingsSection === "updates" && (
          <UpdateSettingsPage
            updateInfo={updateInfo}
            isChecking={isCheckingUpdates}
            onCheck={() => void checkForUpdates()}
            onDownload={() => void openUpdateDownload()}
          />
        )}
      </main>
      {isCategoryDialogOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeCustomCategoryDialog}>
          <section
            className="category-dialog lift-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div>
              <p className="eyebrow">{t("Category", "分类")}</p>
              <h2 id="category-dialog-title">{t("New Category", "新建分类")}</h2>
            </div>
            <label>
              {t("Name", "名称")}
              <input
                autoFocus
                value={categoryDraft}
                onChange={(event) => setCategoryDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveCustomCategory();
                  if (event.key === "Escape") closeCustomCategoryDialog();
                }}
                placeholder={t("Workflow name", "工作流名称")}
              />
            </label>
            <div className="category-color-field">
              <span>{t("Color", "颜色")}</span>
              <div className="color-swatch-grid">
                {categoryColorSwatches.map((color) => (
                  <button
                    className={categoryDraftColor === color ? "color-swatch selected" : "color-swatch"}
                    key={color}
                    onClick={() => setCategoryDraftColor(color)}
                    style={{ backgroundColor: color }}
                    type="button"
                    aria-label={`Use color ${color}`}
                  />
                ))}
              </div>
            </div>
            <div className="form-actions dialog-actions">
              <button className="ghost-button" onClick={closeCustomCategoryDialog}>
                {t("Cancel", "取消")}
              </button>
              <button className="pressable" onClick={saveCustomCategory} disabled={!normalizeCustomCategoryName(categoryDraft)}>
                {t("Create", "创建")}
              </button>
            </div>
          </section>
        </div>
      )}
      {isBulkImportOpen && (
        <BulkImportWorkbench
          items={bulkImportItems}
          images={bulkImportImages}
          categories={allCategories}
          notice={bulkImportNotice}
          isReading={isReadingBulkFiles}
          onClose={closeBulkImportWorkbench}
          onPickFiles={() => bulkImportInputRef.current?.click()}
          onUpdateItem={updateBulkImportItem}
          onAiClassify={() => void aiClassifyBulkImportItems()}
          onAiMatchImages={() => void aiMatchBulkImportImages()}
          canAiEnhanceImports={apiSettings.enabled && apiSettings.provider !== "mock"}
          isAiMatchingImages={isAiMatchingBulkImages}
          isAiClassifyingItems={isAiClassifyingBulkItems}
          isImporting={isImportingBulkItems}
          progress={bulkImportProgress}
          onImport={() => void importBulkItems()}
        />
      )}
      {isExportWorkbenchOpen && (
        <ExportWorkbench
          prompts={savedPrompts}
          categories={allCategories}
          selectedCategory={dataCategory}
          onSelectedCategoryChange={setDataCategory}
          onClose={closeExportWorkbench}
          onExport={exportWorkspacePrompts}
        />
      )}
      {isHelpGuideOpen && (
        <HelpGuide
          onClose={() => setIsHelpGuideOpen(false)}
          onOpenShortcutSettings={() => {
            setSettingsSection("shortcuts");
            setView("settings");
            setIsHelpGuideOpen(false);
          }}
          onOpenAnalyzeSettings={() => {
            setSettingsSection("analyze");
            setView("settings");
            setIsHelpGuideOpen(false);
          }}
        />
      )}
      {isOnboardingOpen && (
        <OnboardingGuide
          step={onboardingStep}
          onStepChange={setOnboardingStep}
          onComplete={() => {
            localStorage.setItem(ONBOARDING_COMPLETE_KEY, "1");
            setIsOnboardingOpen(false);
          }}
          onOpenShortcutSettings={() => {
            setSettingsSection("shortcuts");
            setView("settings");
            setIsOnboardingOpen(false);
          }}
          onOpenAnalyzeSettings={() => {
            setSettingsSection("analyze");
            setView("settings");
            setIsOnboardingOpen(false);
          }}
        />
      )}
    </div>
  );
}

function BulkImportWorkbench({
  items,
  images,
  categories,
  notice,
  isReading,
  onClose,
  onPickFiles,
  onUpdateItem,
  onAiClassify,
  onAiMatchImages,
  canAiEnhanceImports,
  isAiMatchingImages,
  isAiClassifyingItems,
  isImporting,
  progress,
  onImport,
}: {
  items: BulkImportItem[];
  images: BulkImportImage[];
  categories: PromptCategory[];
  notice: string;
  isReading: boolean;
  onClose: () => void;
  onPickFiles: () => void;
  onUpdateItem: (id: string, patch: Partial<BulkImportItem>) => void;
  onAiClassify: () => void;
  onAiMatchImages: () => void;
  canAiEnhanceImports: boolean;
  isAiMatchingImages: boolean;
  isAiClassifyingItems: boolean;
  isImporting: boolean;
  progress: BulkImportProgress | null;
  onImport: () => void;
}) {
  const { t } = useLanguage();
  const selectedCount = items.filter((item) => item.included).length;
  const [editingCategoryId, setEditingCategoryId] = useState("");

  return (
    <div className="modal-backdrop bulk-import-backdrop" role="presentation" onMouseDown={isImporting ? undefined : onClose}>
      <section
        className="bulk-import-workbench lift-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="bulk-import-header">
          <div>
            <p className="eyebrow">{t("Import workspace", "导入工作台")}</p>
            <h2 id="bulk-import-title">{t("Collect prompt files", "批量收集 Prompt 文件")}</h2>
            <p>{t("Choose the files you want to collect. Connected AI is used when you import.", "选择要收集的文件；点击导入时会根据分析设置使用已连接的 AI。")}</p>
          </div>
          <button className="bulk-import-close" onClick={onClose} disabled={isImporting} aria-label={t("Close", "关闭")} title={t("Close", "关闭")}>
            ×
          </button>
        </header>

        <div className="bulk-import-toolbar">
          <button className="pressable" onClick={onPickFiles} disabled={isReading || isImporting}>
            {isReading ? t("Reading files...", "正在读取文件...") : t("Choose Files", "选择文件")}
          </button>
          {items.length > 0 && (
            <button
              className="ghost-button bulk-import-ai-classify"
              onClick={onAiClassify}
              disabled={isAiClassifyingItems || isImporting}
              title={
                canAiEnhanceImports
                  ? t("Use Local Codex or your API to improve automatic categories", "使用本地 Codex 或 API 优化自动分类")
                  : t("Configure Local Codex or an OpenAI-compatible API in Analyze Settings first", "请先在分析设置中配置本地 Codex 或兼容 OpenAI 的 API")
              }
            >
              {isAiClassifyingItems ? t("AI classifying...", "AI 分类中...") : t("AI Smart Categorize", "AI 智能分类")}
            </button>
          )}
          {items.length > 0 && images.length > 0 && (
            <button
              className="ghost-button bulk-import-ai-match"
              onClick={onAiMatchImages}
              disabled={!canAiEnhanceImports || isAiMatchingImages || isImporting}
              title={
                canAiEnhanceImports
                  ? t("Match only the remaining unlinked images with Local Codex or your vision API", "使用本地 Codex 或视觉 API 匹配剩余未关联图片")
                  : t("Configure Local Codex or an OpenAI-compatible vision API in Analyze Settings first", "请先在分析设置中配置本地 Codex 或兼容 OpenAI 的视觉 API")
              }
            >
              {isAiMatchingImages ? t("AI matching...", "AI 匹配中...") : t("AI Match Unlinked Images", "AI 匹配未关联图片")}
            </button>
          )}
          <span>{t("Text, Markdown, Word, JSON, CSV, and images", "文本、Markdown、Word、JSON、CSV 与图片")}</span>
          <span>{t(`${selectedCount} selected`, `已选择 ${selectedCount} 条`)}</span>
        </div>

        <div className="bulk-import-status-stack" aria-live="polite">
          {notice && <p className="bulk-import-notice">{notice}</p>}
          {isImporting && progress && (
            <div className="bulk-import-progress" role="status">
              <div>
                <strong>{t(`Analyzing ${progress.current} of ${progress.total}`, `正在分析第 ${progress.current} / ${progress.total} 条`)}</strong>
                <span>{t("Keep this window open while import finishes.", "导入完成前请保持此窗口打开。")}</span>
              </div>
              <progress value={progress.current} max={progress.total} />
            </div>
          )}
        </div>

        {!items.length ? (
          <div className="bulk-import-empty">
            <strong>{t("Start with a folder of prompt files", "从一组 Prompt 文件开始")}</strong>
            <span>{t("Text, Markdown, Word, JSON, CSV, and matching images are supported. Files with matching names are linked automatically, for example campaign.docx and campaign.png.", "支持文本、Markdown、Word、JSON、CSV 与同名图片。文件名相同会自动关联，例如 campaign.docx 与 campaign.png。")}</span>
          </div>
        ) : (
          <div className="bulk-import-list" aria-label={t("Prompt candidates", "候选 Prompt")}>
            {items.map((item) => {
              const image = images.find((candidate) => candidate.id === item.imageId);
              return (
                <article className={item.included ? "bulk-import-row included" : "bulk-import-row"} key={item.id}>
                  <label className="bulk-import-toggle">
                    <input
                      type="checkbox"
                      checked={item.included}
                      onChange={(event) => onUpdateItem(item.id, { included: event.target.checked })}
                      aria-label={t(`Include ${item.title || "prompt"}`, `导入 ${item.title || "Prompt"}`)}
                    />
                  </label>
                  <div className="bulk-import-main">
                    <div className="bulk-import-fields">
                      <input
                        value={item.title}
                        onChange={(event) => onUpdateItem(item.id, { title: event.target.value, titleEdited: true })}
                        aria-label={t("Prompt title", "Prompt 标题")}
                        placeholder={t("Prompt title", "Prompt 标题")}
                      />
                      {editingCategoryId === item.id ? (
                        <select
                          className="bulk-import-category-select"
                          value={item.category}
                          onChange={(event) => {
                            onUpdateItem(item.id, { category: event.target.value, categoryEdited: true, categoryAiAnalyzed: false });
                            setEditingCategoryId("");
                          }}
                          onBlur={() => setEditingCategoryId("")}
                          aria-label={t("Category", "分类")}
                          autoFocus
                        >
                          {categories.map((category) => (
                            <option key={category} value={category}>
                              {getCategoryLabel(category, t)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          className="bulk-import-category-chip"
                          onClick={() => setEditingCategoryId(item.id)}
                          title={t("Click to adjust the inferred category", "点击调整自动推断的分类")}
                        >
                          <span>{item.categoryEdited ? t("Edited", "已调整") : item.categoryAiAnalyzed ? "AI" : t("Auto", "自动")}</span>
                          {getCategoryLabel(item.category, t)}
                        </button>
                      )}
                    </div>
                    <p className="bulk-import-source">{item.sourceName}</p>
                    <p className="bulk-import-preview">{item.originalPrompt}</p>
                  </div>
                  <div className="bulk-import-image-control">
                    {image ? <img src={image.dataUrl} alt="" /> : item.previewImage ? <img src={item.previewImage} alt="" /> : <span>{t("No image", "无图片")}</span>}
                    <select
                      value={item.imageId}
                      onChange={(event) => onUpdateItem(item.id, { imageId: event.target.value })}
                      aria-label={t("Reference image", "参考图片")}
                    >
                      <option value="">{item.previewImage ? t("Embedded image", "内嵌图片") : t("No image", "无图片")}</option>
                      {images.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <footer className="bulk-import-footer">
          <span className="bulk-workspace-hint">
            {t("Import analyzes each prompt with your connected AI, or local rules when no AI is connected.", "导入时会用已连接的 AI 分析每条 Prompt；未连接 AI 时使用本地规则。")}
          </span>
          <div className="form-actions">
            <button className="pressable" onClick={onImport} disabled={!selectedCount || isImporting}>
              {isImporting
                ? t("Analyzing and importing...", "正在分析并导入...")
                : t(`Import ${selectedCount} Prompts`, `导入 ${selectedCount} 条 Prompt`)}
            </button>
            <button className="ghost-button" onClick={onClose} disabled={isImporting}>
              {t("Cancel", "取消")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ExportWorkbench({
  prompts,
  categories,
  selectedCategory,
  onSelectedCategoryChange,
  onClose,
  onExport,
}: {
  prompts: PromptItem[];
  categories: PromptCategory[];
  selectedCategory: PromptCategory;
  onSelectedCategoryChange: (category: PromptCategory) => void;
  onClose: () => void;
  onExport: (selectedIds: string[], mode: WorkspaceScope) => void;
}) {
  const { t } = useLanguage();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(prompts.map((prompt) => prompt.id)));
  const selectedCount = selectedIds.size;
  const selectedCategoryCount = prompts.filter((prompt) => prompt.category === selectedCategory && selectedIds.has(prompt.id)).length;

  function togglePrompt(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(prompts.map((prompt) => prompt.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function selectCategory(category: PromptCategory) {
    onSelectedCategoryChange(category);
    setSelectedIds(new Set(prompts.filter((prompt) => prompt.category === category).map((prompt) => prompt.id)));
  }

  return (
    <div className="modal-backdrop bulk-import-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="bulk-import-workbench export-workbench lift-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-workbench-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="bulk-import-header">
          <div>
            <p className="eyebrow">{t("Export workspace", "导出工作台")}</p>
            <h2 id="export-workbench-title">{t("Export saved prompts", "导出已保存的 Prompt")}</h2>
            <p>{t("Review the prompts you want to include before downloading a JSON backup.", "下载 JSON 备份前，先预览并勾选要包含的 Prompt。")}</p>
          </div>
          <button className="bulk-import-close" onClick={onClose} aria-label={t("Close", "关闭")} title={t("Close", "关闭")}>
            ×
          </button>
        </header>

        <div className="bulk-import-toolbar export-workbench-toolbar">
          <button className="ghost-button bulk-import-auto-match" onClick={selectAll} disabled={selectedCount === prompts.length}>
            {t("Select All", "全选")}
          </button>
          <button className="ghost-button bulk-import-auto-match" onClick={clearSelection} disabled={!selectedCount}>
            {t("Clear", "取消全选")}
          </button>
          <span>{t("Images and prompt details are included in the JSON.", "JSON 会包含图片和 Prompt 详细信息。")}</span>
          <span>{t(`${selectedCount} selected`, `已选择 ${selectedCount} 条`)}</span>
        </div>

        <div className="export-workbench-list" aria-label={t("Saved prompts to export", "待导出的已保存 Prompt")}>
          {prompts.map((prompt) => (
            <article className={selectedIds.has(prompt.id) ? "export-workbench-row included" : "export-workbench-row"} key={prompt.id}>
              <label className="bulk-import-toggle">
                <input
                  type="checkbox"
                  checked={selectedIds.has(prompt.id)}
                  onChange={() => togglePrompt(prompt.id)}
                  aria-label={t(`Include ${prompt.title || "prompt"}`, `导出 ${prompt.title || "Prompt"}`)}
                />
              </label>
              {prompt.previewImage ? (
                <img className="export-workbench-image" src={prompt.previewImage} alt="" />
              ) : (
                <span className="export-workbench-image export-workbench-placeholder">{getCategoryLabel(prompt.category, t)}</span>
              )}
              <div className="export-workbench-main">
                <div className="export-workbench-title-row">
                  <strong>{prompt.title || t("Untitled Prompt", "未命名 Prompt")}</strong>
                  <span className="export-workbench-category">{getCategoryLabel(prompt.category, t)}</span>
                </div>
                <p>{(prompt.refinedPrompt || prompt.originalPrompt).replace(/\s+/g, " ")}</p>
                {prompt.tags.length > 0 && <TagList tags={prompt.tags.slice(0, 4)} />}
              </div>
            </article>
          ))}
        </div>

        <footer className="bulk-import-footer export-workbench-footer">
          <span className="bulk-workspace-hint">
            {t("Export all includes every saved prompt. Checked items only affect the selected-category export.", "导出全部会包含资料库中所有 Prompt；勾选仅影响导出选中分类。")}
          </span>
          <div className="form-actions">
            <label className="workspace-category-control">
              <span>{t("Selected Category", "选中分类")}</span>
              <select value={selectedCategory} onChange={(event) => selectCategory(event.target.value)}>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {getCategoryLabel(category, t)}
                  </option>
                ))}
              </select>
            </label>
            <button className="pressable" onClick={() => onExport([...selectedIds], "category")} disabled={!selectedCategoryCount}>
              {t(`Export Selected Category (${selectedCategoryCount})`, `导出选中分类 (${selectedCategoryCount})`)}
            </button>
            <button className="pressable" onClick={() => onExport([...selectedIds], "all")} disabled={!prompts.length}>
              {t(`Export All (${prompts.length})`, `导出全部 (${prompts.length})`)}
            </button>
            <button className="ghost-button" onClick={onClose}>
              {t("Cancel", "取消")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function OnboardingGuide({
  step,
  onStepChange,
  onComplete,
  onOpenShortcutSettings,
  onOpenAnalyzeSettings,
}: {
  step: number;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onOpenShortcutSettings: () => void;
  onOpenAnalyzeSettings: () => void;
}) {
  const { t } = useLanguage();
  const steps = [
    {
      eyebrow: t("Start with Quick Add", "先设置快速面板"),
      title: t("Save and reuse prompts without leaving your work.", "不离开当前工作，也能收集和调用 Prompt。"),
      description: t("Set the shortcut you find easiest to remember. It opens Quick Add, where Capture saves copied text and Insert places a chosen prompt in the active text field.", "设置一个顺手的快捷键，用它打开快速面板。收集模式可保存复制的内容，调用模式可将选中的 Prompt 插入当前输入框。"),
      action: t("Open Shortcut Settings", "打开快捷键设置"),
      onAction: onOpenShortcutSettings,
    },
    {
      eyebrow: t("Choose how prompts are analyzed", "选择 Prompt 的分析方式"),
      title: t("Make every saved prompt easier to find and reuse.", "让每条保存的 Prompt 更容易查找和复用。"),
      description: t("Prompt Cabinet can create a focused title, tags, categories, and input hints. Connect Local Codex or an API for richer analysis, or continue with the local rules.", "Prompt Cabinet 会生成贴合内容的标题、标签、分类与所需输入提示。连接本地 Codex 或 API 可获得更完整的分析；也可以先使用本地规则。"),
      action: t("Open Analyze Settings", "打开分析设置"),
      onAction: onOpenAnalyzeSettings,
    },
    {
      eyebrow: t("One permission for Insert", "首次调用需要一项权限"),
      title: t("Insert is ready when you are.", "需要时再开启快速插入即可。"),
      description: t("The first time you use Insert, macOS will guide you to allow Prompt Cabinet in Accessibility. After enabling it, fully quit and reopen Prompt Cabinet once.", "首次使用调用功能时，macOS 会引导你在“辅助功能”中允许 Prompt Cabinet。开启后，请完全退出并重新打开 Prompt Cabinet 一次。"),
      action: null,
      onAction: undefined,
    },
  ];
  const currentStep = steps[step] ?? steps[0];
  const isLastStep = step === steps.length - 1;

  return (
    <div className="modal-backdrop onboarding-backdrop" role="presentation">
      <section className="onboarding-panel lift-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <header className="onboarding-header">
          <div>
            <p className="eyebrow">{t("Welcome to Prompt Cabinet", "欢迎使用 Prompt Cabinet")}</p>
            <h2 id="onboarding-title">{currentStep.title}</h2>
          </div>
          <span className="onboarding-progress">{t(`Step ${step + 1} of ${steps.length}`, `第 ${step + 1} 步，共 ${steps.length} 步`)}</span>
        </header>

        <div className="onboarding-steps" aria-label={t("Getting started steps", "首次使用步骤")}>
          {steps.map((item, index) => (
            <span className={index === step ? "active" : index < step ? "complete" : ""} key={item.eyebrow} aria-hidden="true" />
          ))}
        </div>

        <section className="onboarding-content">
          <p className="onboarding-eyebrow">{currentStep.eyebrow}</p>
          <p>{currentStep.description}</p>
          {currentStep.action && currentStep.onAction && (
            <button className="ghost-button onboarding-settings-action" onClick={currentStep.onAction}>
              {currentStep.action}
            </button>
          )}
        </section>

        <footer className="onboarding-footer">
          <button className="ghost-button" onClick={onComplete}>
            {t("Skip for now", "稍后设置")}
          </button>
          <div>
            {step > 0 && (
              <button className="ghost-button" onClick={() => onStepChange(step - 1)}>
                {t("Back", "上一步")}
              </button>
            )}
            <button className="pressable" onClick={() => (isLastStep ? onComplete() : onStepChange(step + 1))}>
              {isLastStep ? t("Start using Prompt Cabinet", "开始使用 Prompt Cabinet") : t("Continue", "继续")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function HelpGuide({
  onClose,
  onOpenShortcutSettings,
  onOpenAnalyzeSettings,
}: {
  onClose: () => void;
  onOpenShortcutSettings: () => void;
  onOpenAnalyzeSettings: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="modal-backdrop help-guide-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="help-guide-panel lift-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-guide-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="help-guide-header">
          <div>
            <p className="eyebrow">{t("Prompt Cabinet guide", "Prompt Cabinet 操作指南")}</p>
            <h2 id="help-guide-title">{t("Three ways to keep prompts close at hand.", "围绕三项主要功能使用 Prompt Cabinet。")}</h2>
          </div>
          <button className="bulk-import-close" onClick={onClose} aria-label={t("Close", "关闭")} title={t("Close", "关闭")}>
            ×
          </button>
        </header>

        <div className="help-guide-flow">
          <article className="help-guide-step">
            <span className="help-guide-index">01</span>
            <h3>{t("Capture and Insert", "收集与调用")}</h3>
            <p>{t("Copy a prompt anywhere and save it with Quick Add. When you need it again, switch the same panel to Insert and place the chosen prompt in the active text field.", "在任意应用复制 Prompt，用快速面板收集；需要使用时，在同一面板切换到调用模式，将选中的 Prompt 插入当前输入框。")}</p>
            <div className="help-guide-keys" aria-label={t("Capture shortcuts", "收集快捷键")}>
              <kbd>Cmd/Ctrl + Option/Alt + P</kbd>
              <span>{t("Open Quick Add", "打开快速面板")}</span>
              <kbd>Cmd/Ctrl + S</kbd>
              <span>{t("Save", "保存")}</span>
              <kbd>Cmd/Ctrl + Enter</kbd>
              <span>{t("Insert", "插入")}</span>
            </div>
            <div className="help-guide-note">{t("The first Insert asks for macOS Accessibility permission. Allow Prompt Cabinet, then fully quit and reopen it once.", "首次调用需要在 macOS“辅助功能”中允许 Prompt Cabinet；开启后请完全退出并重新打开应用一次。")}</div>
            <button className="ghost-button help-guide-action" onClick={onOpenShortcutSettings}>
              {t("Open Shortcut Settings", "打开快捷键设置")}
            </button>
          </article>

          <article className="help-guide-step">
            <span className="help-guide-index">02</span>
            <h3>{t("Rewrite and Reuse", "改写与复用")}</h3>
            <p>{t("Open any saved prompt to compare the original and custom versions side by side. Save a rewrite for reuse, restore it to the original, or replace the original when the new version is ready.", "打开已保存的 Prompt，可左右对比原始与自定义版本。修改后可以保存、复原，或在确认后直接替换原始 Prompt。")}</p>
            <div className="help-guide-note">{t("Copy always uses the current custom version. Input fields are highlighted in the original prompt and become #variables when inserted.", "复制始终使用当前自定义版本。原始 Prompt 中所需输入会高亮显示，调用时会变成对应的 #变量。")}</div>
          </article>

          <article className="help-guide-step">
            <span className="help-guide-index">03</span>
            <h3>{t("Import and Export", "导入与导出")}</h3>
            <p>{t("Use Import Workspace to collect text, Markdown, Word, JSON, CSV, and images. Use Export Workspace to create a JSON backup with prompt details and linked images.", "在导入工作台收集文本、Markdown、Word、JSON、CSV 与图片；在导出工作台生成包含 Prompt 详情和关联图片的 JSON 备份。")}</p>
            <div className="help-guide-note">{t("AI smart categorization and image matching are optional. They use your configured Local Codex or API connection.", "AI 智能分类和图片匹配按需使用，会调用你在分析设置中配置的本地 Codex 或 API。")}</div>
            <button className="ghost-button help-guide-action" onClick={onOpenAnalyzeSettings}>
              {t("Open Analyze Settings", "打开分析设置")}
            </button>
          </article>
        </div>
      </section>
    </div>
  );
}

function QuickAddApp() {
  const { analysisLanguage, resolvedLanguage, t } = useLanguage();
  const [quickMode, setQuickMode] = useState<QuickMode>("capture");
  const [shortcutSettings, setShortcutSettings] = useState<QuickShortcutSettings>(defaultQuickShortcutSettings);
  const [rawPrompt, setRawPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const [isInserting, setIsInserting] = useState(false);
  const [insertFeedback, setInsertFeedback] = useState<"inserted" | "copied" | "permission" | null>(null);
  const [quickPrompts, setQuickPrompts] = useState<PromptItem[]>([]);
  const [quickCategories, setQuickCategories] = useState<PromptCategory[]>(() =>
    getQuickAddCategories(loadCustomCategories(), loadHiddenCategories()),
  );
  const [quickTarget, setQuickTarget] = useState<string>(QUICK_ADD_INBOX_TARGET);
  const [browseCategory, setBrowseCategory] = useState<string>(QUICK_BROWSE_INBOX);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const ignoredClipboardPromptRef = useRef("");

  useEffect(() => {
    void window.promptCabinetWindow?.setQuickAddMode(quickMode);
  }, [quickMode]);

  useEffect(() => {
    let isMounted = true;
    async function refreshQuickPrompts() {
      const loadedPrompts = await loadPrompts();
      if (!isMounted) return;
      setQuickPrompts(loadedPrompts);
      setQuickCategories(getQuickAddCategories(loadCustomCategories(), loadHiddenCategories(), loadedPrompts));
    }

    void refreshQuickPrompts();
    void window.promptCabinetWindow?.loadShortcuts().then((shortcuts) => {
      if (isMounted) setShortcutSettings(shortcuts);
    });
    const removePromptsChangedListener = window.promptCabinetStorage?.onPromptsChanged?.(() => {
      void refreshQuickPrompts();
    });
    const removeShortcutsChangedListener = window.promptCabinetWindow?.onQuickAddShortcutsChanged((shortcuts) => {
      setShortcutSettings(shortcuts);
    });
    return () => {
      isMounted = false;
      removePromptsChangedListener?.();
      removeShortcutsChangedListener?.();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function syncClipboard() {
      const text = await window.promptCabinetWindow?.readClipboardText();
      if (!isMounted || !text?.trim()) return;
      const normalizedText = normalizeQuickPrompt(text);
      if (normalizedText === ignoredClipboardPromptRef.current) return;
      ignoredClipboardPromptRef.current = "";
      setSaveFeedback(false);
      setRawPrompt((current) => (current === text ? current : text));
    }

    void syncClipboard();
    const intervalId = window.setInterval(() => void syncClipboard(), 500);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const hasPrompt = rawPrompt.trim().length > 0;
  const cleanPrompt = rawPrompt.trim();
  const capturePreviewText = hasPrompt ? cleanPrompt.replace(/\s+/g, " ") : t("Clipboard is empty", "剪贴板为空");
  const browseCategories = useMemo(() => getQuickBrowseCategories(quickPrompts), [quickPrompts]);
  const browsePrompts = useMemo(
    () => getQuickBrowsePrompts(quickPrompts, browseCategory),
    [browseCategory, quickPrompts],
  );
  const selectedPrompt = browsePrompts.find((prompt) => prompt.id === selectedPromptId) ?? browsePrompts[0];

  useEffect(() => {
    if (!browseCategories.includes(browseCategory)) {
      setBrowseCategory(browseCategories[0] ?? QUICK_BROWSE_INBOX);
    }
  }, [browseCategories, browseCategory]);

  useEffect(() => {
    if (!browsePrompts.some((prompt) => prompt.id === selectedPromptId)) {
      setSelectedPromptId(browsePrompts[0]?.id ?? "");
    }
  }, [browsePrompts, selectedPromptId]);

  function moveQuickTarget(direction: 1 | -1) {
    const quickTargets = [QUICK_ADD_INBOX_TARGET, ...quickCategories];
    if (!quickTargets.length) return;
    setQuickTarget((current) => {
      const currentIndex = Math.max(quickTargets.indexOf(current), 0);
      const nextIndex = (currentIndex + direction + quickTargets.length) % quickTargets.length;
      return quickTargets[nextIndex];
    });
    setSaveFeedback(false);
  }

  function moveBrowseCategory(direction: 1 | -1) {
    if (!browseCategories.length) return;
    const currentIndex = Math.max(browseCategories.indexOf(browseCategory), 0);
    const nextIndex = (currentIndex + direction + browseCategories.length) % browseCategories.length;
    setBrowseCategory(browseCategories[nextIndex]);
    setInsertFeedback(null);
  }

  function moveBrowsePrompt(direction: 1 | -1) {
    if (!browsePrompts.length) return;
    const currentIndex = Math.max(browsePrompts.findIndex((prompt) => prompt.id === selectedPrompt?.id), 0);
    const nextIndex = (currentIndex + direction + browsePrompts.length) % browsePrompts.length;
    setSelectedPromptId(browsePrompts[nextIndex].id);
    setInsertFeedback(null);
  }

  async function saveQuickPrompt() {
    if (!hasPrompt || isSaving) return;
    setIsSaving(true);
    try {
      const capturedPrompt = cleanPrompt;
      const normalizedPrompt = normalizeQuickPrompt(capturedPrompt);
      const savedPrompts = await loadPrompts();
      const alreadySaved = savedPrompts.some((prompt) => normalizeQuickPrompt(prompt.originalPrompt) === normalizedPrompt);
      const savesToInbox = quickTarget === QUICK_ADD_INBOX_TARGET;
      const selectedCategory = savesToInbox ? undefined : quickTarget;

      if (!alreadySaved) {
        const prompt = savesToInbox
          ? createQuickInboxPrompt(capturedPrompt)
          : createQuickFiledPrompt(capturedPrompt, selectedCategory ?? "Product", analysisLanguage);
        await savePrompts([prompt, ...savedPrompts]);
      }

      ignoredClipboardPromptRef.current = normalizedPrompt;
      setRawPrompt("");
      setSaveFeedback(true);
      window.setTimeout(() => setSaveFeedback(false), 900);
    } finally {
      setIsSaving(false);
    }
  }

  async function insertSelectedPrompt() {
    if (!selectedPrompt || isInserting) return;
    const text = preparePromptForQuickInsert(getQuickPromptText(selectedPrompt), selectedPrompt.inputNeeded);
    if (!text.trim()) return;
    setIsInserting(true);
    setInsertFeedback(null);
    ignoredClipboardPromptRef.current = normalizeQuickPrompt(text);
    try {
      const result = await window.promptCabinetWindow?.insertText(text, resolvedLanguage);
      if (result?.ok) setInsertFeedback("inserted");
      else if (result?.needsAccessibility) setInsertFeedback("permission");
      else {
        if (!result?.copied) await navigator.clipboard.writeText(text);
        setInsertFeedback("copied");
      }
      if (!result?.needsAccessibility) window.setTimeout(() => setInsertFeedback(null), 1000);
    } finally {
      setIsInserting(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (matchesShortcutEvent(event, shortcutSettings.captureMode)) {
        event.preventDefault();
        setQuickMode("capture");
        return;
      }

      if (matchesShortcutEvent(event, shortcutSettings.insertMode)) {
        event.preventDefault();
        setQuickMode("insert");
        return;
      }

      if (matchesShortcutEvent(event, shortcutSettings.previousCategory)) {
        event.preventDefault();
        if (quickMode === "capture") moveQuickTarget(-1);
        else moveBrowseCategory(-1);
        return;
      }

      if (matchesShortcutEvent(event, shortcutSettings.nextCategory)) {
        event.preventDefault();
        if (quickMode === "capture") moveQuickTarget(1);
        else moveBrowseCategory(1);
        return;
      }

      if (quickMode === "insert" && matchesShortcutEvent(event, shortcutSettings.previousPrompt)) {
        event.preventDefault();
        moveBrowsePrompt(-1);
        return;
      }

      if (quickMode === "insert" && matchesShortcutEvent(event, shortcutSettings.nextPrompt)) {
        event.preventDefault();
        moveBrowsePrompt(1);
        return;
      }

      if (matchesShortcutEvent(event, shortcutSettings.closeQuickAdd)) {
        event.preventDefault();
        void window.promptCabinetWindow?.closeCurrentWindow();
        return;
      }

      if (quickMode === "insert" && matchesShortcutEvent(event, shortcutSettings.insertSelected)) {
        event.preventDefault();
        void insertSelectedPrompt();
        return;
      }

      if (quickMode === "capture" && matchesShortcutEvent(event, shortcutSettings.runAction)) {
        event.preventDefault();
        void saveQuickPrompt();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    const removeQuickAddSaveShortcutListener = window.promptCabinetWindow?.onQuickAddSaveShortcut(() => {
      if (quickMode === "capture") void saveQuickPrompt();
    });
    const removeQuickAddModeShortcutListener = window.promptCabinetWindow?.onQuickAddModeShortcut((mode) => {
      setQuickMode(mode);
    });
    const removeQuickAddCommandShortcutListener = window.promptCabinetWindow?.onQuickAddCommandShortcut((command) => {
      if (command === "previousCategory") {
        if (quickMode === "capture") moveQuickTarget(-1);
        else moveBrowseCategory(-1);
      } else if (command === "nextCategory") {
        if (quickMode === "capture") moveQuickTarget(1);
        else moveBrowseCategory(1);
      } else if (command === "previousPrompt" && quickMode === "insert") {
        moveBrowsePrompt(-1);
      } else if (command === "nextPrompt" && quickMode === "insert") {
        moveBrowsePrompt(1);
      } else if (command === "insertSelected" && quickMode === "insert") {
        void insertSelectedPrompt();
      } else if (command === "closeQuickAdd") {
        void window.promptCabinetWindow?.closeCurrentWindow();
      }
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      removeQuickAddSaveShortcutListener?.();
      removeQuickAddModeShortcutListener?.();
      removeQuickAddCommandShortcutListener?.();
    };
  }, [
    analysisLanguage,
    browseCategories,
    browseCategory,
    browsePrompts,
    cleanPrompt,
    hasPrompt,
    isInserting,
    isSaving,
    quickCategories,
    quickMode,
    quickTarget,
    resolvedLanguage,
    selectedPrompt,
    shortcutSettings,
  ]);

  const selectedPromptPreview = quickMode === "insert" ? selectedPrompt?.previewImage ?? "" : "";

  useEffect(() => {
    void window.promptCabinetWindow?.setQuickAddImagePreview(selectedPromptPreview);
  }, [selectedPromptPreview]);

  return (
    <div className="quick-shell">
      <section className="quick-panel lift-card">
        <div className={`form-actions quick-actions ${quickMode}`}>
          <div className="quick-mode-switch" aria-label="Quick Add mode">
            <button
              className={quickMode === "capture" ? "active" : ""}
              onClick={() => setQuickMode("capture")}
              title={t("Capture clipboard prompt", "收集剪贴板 Prompt")}
            >
              {t("Capture", "收集")}
            </button>
            <button
              className={quickMode === "insert" ? "active" : ""}
              onClick={() => setQuickMode("insert")}
              title={t("Insert a saved prompt", "调用已保存的 Prompt")}
            >
              {t("Insert", "调用")}
            </button>
          </div>
          {quickMode === "capture" ? (
            <>
              <select
                className="quick-category-select"
                value={quickTarget}
                onChange={(event) => setQuickTarget(event.target.value)}
                title={`Save destination. Use ${formatShortcut(shortcutSettings.previousCategory)} or ${formatShortcut(shortcutSettings.nextCategory)}.`}
              >
                <option value={QUICK_ADD_INBOX_TARGET}>{t("Inbox", "临时收藏夹")}</option>
                {quickCategories.map((category) => (
                  <option value={category} key={category}>
                    {getCategoryLabel(category, t)}
                  </option>
                ))}
              </select>
              <div className={hasPrompt ? "quick-preview" : "quick-preview muted"} title={hasPrompt ? cleanPrompt : ""}>
                {capturePreviewText}
              </div>
              <button
                className="pressable"
                onClick={() => void saveQuickPrompt()}
                disabled={!hasPrompt || isSaving}
                title={`Save prompt with ${formatShortcut(shortcutSettings.runAction)}`}
              >
                {saveFeedback ? t("Saved", "已保存") : isSaving ? t("Saving...", "保存中...") : t("Save", "保存")}
              </button>
            </>
          ) : (
            <>
              <select
                className="quick-category-select"
                value={browseCategory}
                onChange={(event) => {
                  setBrowseCategory(event.target.value);
                  setInsertFeedback(null);
                }}
                title={`Prompt category. Use ${formatShortcut(shortcutSettings.previousCategory)} or ${formatShortcut(shortcutSettings.nextCategory)}.`}
              >
                {browseCategories.map((category) => (
                  <option value={category} key={category}>
                    {category === QUICK_BROWSE_INBOX ? t("Inbox", "临时收藏夹") : getCategoryLabel(category, t)}
                  </option>
                ))}
              </select>
              <select
                className="quick-prompt-select"
                value={selectedPrompt?.id ?? ""}
                onChange={(event) => {
                  setSelectedPromptId(event.target.value);
                  setInsertFeedback(null);
                }}
                disabled={!browsePrompts.length}
                title={selectedPrompt ? getQuickPromptPreview(selectedPrompt) : "No prompts in this category"}
              >
                {!browsePrompts.length && <option value="">{t("No prompts in this category", "此分类暂无 Prompt")}</option>}
                {browsePrompts.map((prompt) => (
                  <option value={prompt.id} key={prompt.id}>
                    {getQuickPromptPreview(prompt)}
                  </option>
                ))}
              </select>
              <button
                className="pressable"
                onClick={() => void insertSelectedPrompt()}
                disabled={!selectedPrompt || isInserting}
                title={`Insert selected prompt with ${formatShortcut(shortcutSettings.insertSelected)}`}
              >
                {insertFeedback === "inserted"
                  ? t("Inserted", "已插入")
                  : insertFeedback === "permission"
                    ? t("Allow Access", "允许访问")
                  : insertFeedback === "copied"
                    ? t("Copied", "已复制")
                    : isInserting
                      ? t("Inserting...", "插入中...")
                      : t("Insert", "插入")}
              </button>
            </>
          )}
          <button
            className="pressable"
            onClick={() => void window.promptCabinetWindow?.closeCurrentWindow()}
            title={`Close with ${formatShortcut(shortcutSettings.closeQuickAdd)}`}
          >
            {t("Close", "关闭")}
          </button>
        </div>
      </section>
    </div>
  );
}

function getQuickBrowseCategories(prompts: PromptItem[]) {
  const hasInboxPrompts = prompts.some((prompt) => prompt.status === "inbox");
  const categories = mergeCategoryNames(
    prompts.filter((prompt) => prompt.status !== "inbox").map((prompt) => prompt.category),
  );
  const browseCategories = [...(hasInboxPrompts ? [QUICK_BROWSE_INBOX] : []), ...categories];
  return browseCategories.length ? browseCategories : [QUICK_BROWSE_INBOX];
}

function QuickImagePreviewApp() {
  const [image, setImage] = useState("");

  useEffect(() => {
    let isMounted = true;
    void window.promptCabinetWindow?.getQuickAddImagePreview().then((nextImage) => {
      if (isMounted) setImage(nextImage);
    });
    const removeListener = window.promptCabinetWindow?.onQuickAddImagePreview(setImage);
    return () => {
      isMounted = false;
      removeListener?.();
    };
  }, []);

  return <div className="quick-image-preview-shell">{image && <img src={image} alt="" />}</div>;
}

function getQuickBrowsePrompts(prompts: PromptItem[], category: string) {
  if (category === QUICK_BROWSE_INBOX) return prompts.filter((prompt) => prompt.status === "inbox");
  return prompts.filter((prompt) => prompt.status !== "inbox" && prompt.category === category);
}

function getQuickPromptText(prompt: PromptItem) {
  return prompt.status === "inbox" ? prompt.originalPrompt : prompt.refinedPrompt || prompt.originalPrompt;
}

function preparePromptForQuickInsert(prompt: string, inputNeeded: string[]) {
  const variables = getPromptInputVariables(prompt, inputNeeded);
  return variables.reduce((prepared, variable) => {
    if (hasPromptPlaceholder(prepared, variable)) return prepared;
    const marker = `#${variable.toLowerCase()}`;
    return getPromptInputPatterns(variable).reduce((next, pattern) => next.replace(pattern, marker), prepared);
  }, prompt);
}

function getPromptInputVariables(prompt: string, storedInputs: string[]) {
  const variables: string[] = [];
  const add = (value: string) => {
    const normalized = normalizePromptVariable(value);
    if (normalized === "object" && variables.includes("any thematic object")) return;
    if (normalized === "any thematic object") {
      const genericObjectIndex = variables.findIndex((variable) => variable === "object");
      if (genericObjectIndex >= 0) variables.splice(genericObjectIndex, 1);
    }
    if (normalized && !variables.some((variable) => variable.toLowerCase() === normalized.toLowerCase())) variables.push(normalized);
  };

  const placeholderPattern = /#(uploaded image|reference image|original image|source text|source document|design brief)|#([A-Za-z][A-Za-z0-9_/-]{0,39})|\{\{\s*([^{}\n]{1,40}?)\s*\}\}|<\s*([^<>\n]{1,40}?)\s*>|\[\[?\s*([A-Za-z][A-Za-z0-9 _/-]{0,39})\s*\]?\]/gi;
  for (const match of prompt.matchAll(placeholderPattern)) add(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "");
  if (/\bany\s+thematic\s+object\b/i.test(prompt)) {
    add("any thematic object");
  } else if (/(?:任意|任何|一个)?(?:主题|主要|视觉)?对象/i.test(prompt)) {
    add(isChinesePrompt(prompt) ? "对象" : "object");
  }
  if (/upload(?:ed)?\s+(?:an?\s+)?(?:image|photo|picture)|provided\s+(?:an?\s+)?(?:image|photo|picture)|input image|上传(?:的)?(?:图片|图像|照片)|提供(?:的)?(?:图片|图像|照片)/i.test(prompt)) {
    add(isChinesePrompt(prompt) ? "上传的图片" : "uploaded image");
  }
  if (/original image|source image|依据(?:原图|原始图)|基于(?:原图|原始图)|以(?:原图|原始图)为|原图(?:转换|重绘|改造)|原始图(?:转换|重绘|改造)/i.test(prompt)) {
    add(isChinesePrompt(prompt) ? "原图" : "original image");
  }
  if (/reference (?:image|photo|picture)|参考(?:图片|图像|照片)/i.test(prompt)) {
    add(isChinesePrompt(prompt) ? "参考图片" : "reference image");
  }
  if (/design brief|设计需求/i.test(prompt)) add(isChinesePrompt(prompt) ? "设计需求" : "design brief");
  storedInputs.forEach((input) => {
    const normalized = normalizePromptVariable(input);
    if (normalized && prompt.toLowerCase().includes(normalized.toLowerCase())) add(normalized);
  });
  return variables;
}

function normalizePromptVariable(value: string) {
  const normalized = value
    .replace(/^\s*(?:#|\{\{|\[\[?|<)/, "")
    .replace(/(?:\}\}|\]\]?|>)\s*$/, "")
    .trim();
  if (!normalized) return "";
  if (/^any thematic object$/i.test(normalized)) return "any thematic object";
  if (/^object$|主题对象|对象/i.test(normalized)) return /[\u3400-\u9fff]/.test(normalized) ? "对象" : "object";
  return normalized.length <= 40 ? normalized : "";
}

function hasPromptPlaceholder(prompt: string, variable: string) {
  const escaped = escapeRegExp(variable);
  return new RegExp(`(?:#${escaped}\\b|\\{\\{\\s*${escaped}\\s*\\}\\}|<\\s*${escaped}\\s*>|\\[\\[?\\s*${escaped}\\s*\\]?\\])`, "i").test(prompt);
}

function getPromptInputDisplayLabel(prompt: string, variable: string) {
  const escaped = escapeRegExp(variable);
  const pattern = new RegExp(`(#${escaped}\\b|\\{\\{\\s*${escaped}\\s*\\}\\}|<\\s*${escaped}\\s*>|\\[\\[?\\s*${escaped}\\s*\\]?\\])`, "i");
  return prompt.match(pattern)?.[0] ?? variable;
}

function getPromptInputPatterns(variable: string) {
  const normalized = variable.toLowerCase();
  if (normalized === "any thematic object") {
    return [/\bany\s+thematic\s+object\b/gi];
  }
  if (normalized === "object" || variable === "对象") {
    return [/\b(?:any\s+)?(?:thematic\s+)?(?:main\s+)?(?:visual\s+)?object\b/gi, /(?:任意|任何|一个)?(?:主题|主要|视觉)?对象/g];
  }
  if (normalized === "uploaded image" || variable === "上传的图片") {
    return [/\b(?:upload(?:ed)?|provided|input)\s+(?:an?\s+)?(?:image|photo|picture)\b/gi, /(?:上传|提供)(?:的)?(?:图片|图像|照片)/g];
  }
  if (normalized === "original image" || variable === "原图") {
    return [/\b(?:original|source)\s+image\b/gi, /原图|原始图/g];
  }
  if (normalized === "reference image" || variable === "参考图片") {
    return [/\breference\s+(?:image|photo|picture)\b/gi, /参考(?:图片|图像|照片)/g];
  }
  if (normalized === "source text" || variable === "源文本") {
    return [/\b(?:source|original|draft)\s+text\b/gi, /(?:原始|源|待处理)(?:文本|文案)/g];
  }
  if (normalized === "source document" || variable === "源文档") {
    return [/\b(?:source|uploaded|provided)\s+(?:document|file|pdf)\b/gi, /(?:源|上传的|提供的)(?:文档|文件)/g];
  }
  if (normalized === "design brief" || variable === "设计需求") {
    return [/\bdesign\s+brief\b/gi, /设计需求/g];
  }
  return variable.trim() ? [new RegExp(escapeRegExp(variable.trim()), "gi")] : [];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getQuickPromptPreview(prompt: PromptItem) {
  const preview = prompt.status === "inbox" ? prompt.originalPrompt.replace(/\s+/g, " ").trim() : prompt.title.trim();
  if (!preview) return "Untitled Prompt";
  return preview.length > 90 ? `${preview.slice(0, 90)}...` : preview;
}

function normalizeQuickPrompt(prompt: string) {
  return prompt.trim().replace(/\r\n/g, "\n");
}

function createQuickInboxPrompt(prompt: string): PromptItem {
  return {
    id: crypto.randomUUID(),
    status: "inbox",
    title: buildInboxTitle(prompt),
    originalPrompt: prompt,
    refinedPrompt: prompt,
    useCase: "Temporary capture. Review, analyze, and file it later.",
    inputNeeded: [],
    expectedOutput: "Saved prompt awaiting organization.",
    tags: ["Inbox"],
    platform: "Unsorted",
    notes: "Quick captured from clipboard.",
    category: "Product",
    createdAt: new Date().toISOString(),
  };
}

function createQuickFiledPrompt(
  prompt: string,
  category: PromptCategory,
  analysisLanguage: AnalysisLanguageSetting = "auto",
): PromptItem {
  const analyzed = analyzePrompt(prompt, "Quick captured from clipboard.", {
    category,
    tags: [category],
    language: analysisLanguage,
  });

  return {
    id: crypto.randomUUID(),
    status: "saved",
    title: analyzed.title,
    originalPrompt: prompt,
    refinedPrompt: analyzed.refinedPrompt,
    useCase: analyzed.useCase,
    inputNeeded: analyzed.inputNeeded,
    expectedOutput: analyzed.expectedOutput,
    tags: mergeUnique(analyzed.tags, [category]),
    platform: analyzed.platform,
    notes: "Quick captured from clipboard.",
    category,
    createdAt: new Date().toISOString(),
  };
}

function getQuickAddCategories(
  customCategories: CustomCategory[],
  hiddenCategories: PromptCategory[],
  prompts: PromptItem[] = [],
) {
  return getVisibleCategories(customCategories, hiddenCategories, prompts).filter(
    (category) => category.toLowerCase() !== "inbox",
  );
}

function buildInboxTitle(prompt: string) {
  const firstLine = prompt
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.replace(/^[-*\d.\s]+/, "")
    .trim();
  if (!firstLine) return "Temporary Prompt";
  return firstLine.length > 28 ? `${firstLine.slice(0, 28)}...` : firstLine;
}

async function compressPromptImage(file: Blob) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width, 1000 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Canvas is unavailable.");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.84);
}

function Dashboard({
  recentPrompts,
  inboxPrompts,
  categories,
  categoryColors,
  onNew,
  onLibrary,
  onAddCategory,
  onDeleteCategory,
  onDetail,
  onEdit,
  onDelete,
}: {
  recentPrompts: PromptItem[];
  inboxPrompts: PromptItem[];
  categories: PromptCategory[];
  categoryColors: Record<string, string>;
  onNew: () => void;
  onLibrary: (category: PromptCategory) => void;
  onAddCategory: () => void;
  onDeleteCategory: (category: PromptCategory) => void;
  onDetail: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      <section className="hero-panel">
        <div>
          <p className="eyebrow">{t("AI workbench for reusable prompt knowledge", "可复用 Prompt 的 AI 工作台")}</p>
          <h1>Prompt Cabinet</h1>
          <p className="subtitle">{t("Collect, refine, and reuse your best prompts.", "收集、优化并复用你最好的 Prompt。")}</p>
        </div>
        <button className="pressable hero-action" onClick={onNew}>
          {t("New Prompt", "新建 Prompt")}
        </button>
      </section>

      {inboxPrompts.length > 0 && (
        <section className="section-band inbox-band">
          <div className="section-heading">
            <div>
              <h2>{t("Inbox", "临时收藏夹")}</h2>
              <span>{t("Review later, then file into a category", "稍后整理并归入分类")}</span>
            </div>
            <span>{t(`${inboxPrompts.length} waiting`, `${inboxPrompts.length} 条待整理`)}</span>
          </div>
          <div className="inbox-list lift-card">
            {inboxPrompts.slice(0, 6).map((prompt) => (
              <article className="inbox-item" key={prompt.id}>
                <button onClick={() => onDetail(prompt.id)}>
                  <strong>{prompt.title}</strong>
                  <span>{prompt.originalPrompt}</span>
                </button>
                <div>
                  <button className="ghost-button" onClick={() => onEdit(prompt.id)}>
                    {t("Organize", "整理")}
                  </button>
                  <button className="ghost-button danger-button" onClick={() => onDelete(prompt.id)}>
                    {t("Delete", "删除")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="section-band">
        <div className="section-heading">
          <h2>{t("Recent Prompts", "最近使用")}</h2>
          <span>{t(`${recentPrompts.length} saved`, `已保存 ${recentPrompts.length} 条`)}</span>
        </div>
        {recentPrompts.length ? (
          <div className="card-grid">
            {recentPrompts.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} onDetail={onDetail} compact />
            ))}
          </div>
        ) : (
          <EmptyPromptState onNew={onNew} />
        )}
      </section>

      <section className="section-band">
        <div className="section-heading">
          <h2>{t("Prompt Categories", "Prompt 分类")}</h2>
          <span>{t("Browse by workflow", "按工作流浏览")}</span>
        </div>
        <div className="category-grid">
          {categories.map((category, index) => (
            <button className="category-tile lift-card" key={category} onClick={() => onLibrary(category)}>
              <span
                className="category-delete-button"
                role="button"
                tabIndex={0}
                aria-label={`Delete ${category}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteCategory(category);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onDeleteCategory(category);
                }}
              >
                ×
              </span>
              <span
                className={`dot ${tagTone[index % tagTone.length]}`}
                style={{ backgroundColor: categoryColors[category] ?? categoryColorSwatches[index % categoryColorSwatches.length] }}
              />
              <strong>{getCategoryLabel(category, t)}</strong>
              <small>{getCategoryCopy(category, t)}</small>
            </button>
          ))}
          <button className="category-tile add-category-tile" onClick={onAddCategory} aria-label="Add category">
            <span className="add-category-mark" aria-hidden="true" />
          </button>
        </div>
      </section>
    </>
  );
}

function PromptForm({
  mode,
  initialPrompt,
  onSave,
  apiSettings,
  categories,
}: {
  mode: "add" | "edit";
  initialPrompt?: PromptItem;
  onSave: (prompt: PromptItem) => void;
  apiSettings: ApiSettings;
  categories: PromptCategory[];
}) {
  const { analysisLanguage, t } = useLanguage();
  const [draft, setDraft] = useState<PromptItem>(
    initialPrompt ?? {
      id: "",
      status: "saved",
      title: "",
      originalPrompt: "",
      refinedPrompt: "",
      useCase: "",
      inputNeeded: [],
      expectedOutput: "",
      tags: [],
      platform: "ChatGPT",
      notes: "",
      category: "Product",
      createdAt: "",
    },
  );
  const [tagInput, setTagInput] = useState(mergeUnique(initialPrompt?.tags ?? [], []).join(", "));
  const [inputNeededText, setInputNeededText] = useState((initialPrompt?.inputNeeded ?? []).join(", "));
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewImageFeedback, setPreviewImageFeedback] = useState(false);
  const previewImageInputRef = useRef<HTMLInputElement>(null);

  const hasPrompt = draft.originalPrompt.trim().length > 0;

  async function handleAnalyze() {
    if (!hasPrompt) return;
    setIsAnalyzing(true);
    const customCategory = builtInCategories.includes(draft.category) ? undefined : draft.category;
    let analyzed = analyzePrompt(draft.originalPrompt, draft.notes, {
      category: customCategory,
      tags: parseTags(tagInput),
      language: analysisLanguage,
    });
    if (apiSettings.enabled && apiSettings.provider !== "mock") {
      try {
        const apiResult = await analyzePromptWithApi(draft.originalPrompt, draft.notes, apiSettings, analysisLanguage);
        analyzed = {
          ...analyzed,
          title: apiResult.title,
          category: customCategory ?? apiResult.category,
          refinedPrompt: apiResult.refinedPrompt,
          useCase: apiResult.useCase,
          inputNeeded: apiResult.inputNeeded,
          expectedOutput: apiResult.expectedOutput,
      tags: apiResult.tags.length ? apiResult.tags : analyzed.tags,
          platform: apiResult.platform,
        };
      } catch (error) {
        window.alert(
          `${getAnalyzeModeLabel(apiSettings, t)} ${t("failed, so Prompt Cabinet used mock analysis instead.", "失败，Prompt Cabinet 已改用本地规则分析。")}\n\n${
            error instanceof Error ? error.message : t("Unknown error", "未知错误")
          }`,
        );
      }
    }
    const analyzedTags = mergeUnique(analyzed.tags, []);
    setDraft((current) => ({
      ...analyzed,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      previewImage: current.previewImage,
      tags: analyzedTags,
    }));
    setTagInput(analyzedTags.join(", "));
    setInputNeededText(analyzed.inputNeeded.join(", "));
    setIsAnalyzing(false);
  }

  async function handlePreviewImage(file?: Blob) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert(t("Please choose an image file.", "请选择图片文件。"));
      return;
    }
    try {
      const previewImage = await compressPromptImage(file);
      setDraft((current) => ({ ...current, previewImage }));
      setPreviewImageFeedback(true);
      window.setTimeout(() => setPreviewImageFeedback(false), 900);
    } catch {
      window.alert(t("Prompt Cabinet could not read this image.", "Prompt Cabinet 无法读取这张图片。"));
    } finally {
      if (previewImageInputRef.current) previewImageInputRef.current.value = "";
    }
  }

  async function pastePreviewImage() {
    try {
      const desktopImage = await window.promptCabinetWindow?.readClipboardImage();
      if (desktopImage) {
        const response = await fetch(desktopImage);
        await handlePreviewImage(await response.blob());
        return;
      }

      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        await handlePreviewImage(await item.getType(imageType));
        return;
      }
      window.alert(t("The clipboard does not contain an image.", "剪贴板中没有图片。"));
    } catch {
      window.alert(t("Prompt Cabinet could not read an image from the clipboard.", "Prompt Cabinet 无法读取剪贴板图片。"));
    }
  }

  useEffect(() => {
    function handleImagePaste(event: globalThis.ClipboardEvent) {
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith("image/"));
      const imageFile = imageItem?.getAsFile();
      if (!imageFile) return;
      event.preventDefault();
      void handlePreviewImage(imageFile);
    }

    window.addEventListener("paste", handleImagePaste);
    return () => window.removeEventListener("paste", handleImagePaste);
  }, []);

  function handleSave() {
    if (!hasPrompt) return;
    const analyzedFallback = draft.refinedPrompt ? draft : analyzePrompt(draft.originalPrompt, draft.notes, {
      category: draft.category,
      tags: parseTags(tagInput),
      language: analysisLanguage,
    });
    const savedTags = parseTags(tagInput);
    const savedInputs = parseTags(inputNeededText);
    onSave({
      ...analyzedFallback,
      id: draft.id || crypto.randomUUID(),
      status: "saved",
      title: draft.title.trim() || analyzedFallback.title || t("Untitled Prompt", "未命名 Prompt"),
      originalPrompt: draft.originalPrompt.trim(),
      refinedPrompt: (draft.refinedPrompt || analyzedFallback.refinedPrompt).trim(),
      useCase: (draft.useCase || analyzedFallback.useCase).trim(),
      inputNeeded: savedInputs.length ? savedInputs : analyzedFallback.inputNeeded,
      expectedOutput: (draft.expectedOutput || analyzedFallback.expectedOutput).trim(),
      tags: savedTags.length ? savedTags : mergeUnique(analyzedFallback.tags, []),
      platform: draft.platform.trim() || "ChatGPT",
      notes: draft.notes.trim() || t("No source note added yet.", "暂无来源备注。"),
      category: draft.category,
      createdAt: draft.createdAt || new Date().toISOString(),
      rewriteHistory: undefined,
    });
  }

  return (
    <section className="add-layout">
      <div className="input-panel neumorph-inset">
        <p className="eyebrow">{mode === "add" ? t("Capture", "收集") : t("Edit", "编辑")}</p>
        <h1>{mode === "add" ? t("Add Prompt", "添加 Prompt") : t("Edit Prompt", "编辑 Prompt")}</h1>
        <label>
          {t("Raw Prompt", "原始 Prompt")}
          <textarea
            value={draft.originalPrompt}
            onChange={(event) => setDraft({ ...draft, originalPrompt: event.target.value })}
            placeholder={t("Paste a useful work prompt here...", "在这里粘贴有用的 Prompt...")}
          />
        </label>
        <div className="form-row">
          <label>
            {t("Category", "分类")}
            <select
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value as PromptCategory })}
            >
              {categories.map((category) => (
                <option value={category} key={category}>
                  {getCategoryLabel(category, t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Tags", "标签")}
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder={t("research, portfolio, reusable", "调研、作品集、可复用")}
            />
          </label>
        </div>
        <div className="visual-preview-field">
          <div className="visual-preview-heading">
            <div>
              <strong>{t("Preview Image", "预览图片")}</strong>
            </div>
            <div className="visual-preview-actions">
              <button className="ghost-button" onClick={() => void pastePreviewImage()}>
                {previewImageFeedback ? t("Pasted", "已粘贴") : t("Paste", "粘贴")}
              </button>
              <button className="ghost-button" onClick={() => previewImageInputRef.current?.click()}>
                {draft.previewImage ? t("Replace", "替换") : t("Choose Image", "选择图片")}
              </button>
              {draft.previewImage && (
                <button
                  className="ghost-button danger-button"
                  onClick={() => setDraft((current) => ({ ...current, previewImage: undefined }))}
                >
                  {t("Remove", "移除")}
                </button>
              )}
            </div>
          </div>
          {draft.previewImage && <img src={draft.previewImage} alt="Prompt card preview" />}
          <input
            ref={previewImageInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void handlePreviewImage(event.target.files?.[0])}
          />
        </div>
        <label>
          {t("Notes", "备注")}
          <input
            value={draft.notes === "No source note added yet." ? "" : draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            placeholder={t("Where did it come from? What is it good for?", "它来自哪里？适合什么场景？")}
          />
        </label>
        <div className="form-actions">
          <button className="pressable" onClick={() => void handleAnalyze()} disabled={!hasPrompt || isAnalyzing}>
            {isAnalyzing ? t("Analyzing...", "分析中...") : getAnalyzeButtonLabel(apiSettings, t)}
          </button>
          <button className="pressable" onClick={handleSave} disabled={!hasPrompt}>
            {mode === "add" ? t("Save Prompt", "保存 Prompt") : t("Save Changes", "保存修改")}
          </button>
        </div>
      </div>

      <aside className="analysis-panel lift-card">
        <p className="eyebrow">{getAnalysisResultLabel(apiSettings, t)}</p>
        {draft.refinedPrompt ? (
          <>
            <label>
              {t("Prompt Title", "Prompt 标题")}
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label>
              {t("Custom Prompt", "自定义 Prompt")}
              <textarea
                className="compact-textarea"
                value={draft.refinedPrompt}
                onChange={(event) => setDraft({ ...draft, refinedPrompt: event.target.value })}
              />
            </label>
            <label>
              {t("Use Case", "使用场景")}
              <input
                value={draft.useCase}
                onChange={(event) => setDraft({ ...draft, useCase: event.target.value })}
              />
            </label>
            <label>
              {t("Input Needed", "所需输入")}
              <input value={inputNeededText} onChange={(event) => setInputNeededText(event.target.value)} />
            </label>
            <dl className="mini-details">
              <div>
                <dt>{t("Platform", "平台")}</dt>
                <dd>
                  <input
                    value={draft.platform}
                    onChange={(event) => setDraft({ ...draft, platform: event.target.value })}
                  />
                </dd>
              </div>
              <div>
                <dt>{t("Expected Output", "预期输出")}</dt>
                <dd>
                  <input
                    value={draft.expectedOutput}
                    onChange={(event) => setDraft({ ...draft, expectedOutput: event.target.value })}
                  />
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-mark" />
            <h2>{t("Ready to refine", "准备分析")}</h2>
            <p>{t("Click Analyze Prompt to generate a structured result.", "点击分析按钮生成结构化结果。")}</p>
          </div>
        )}
      </aside>
    </section>
  );
}

function Library({
  prompts,
  query,
  categories,
  categoryFilter,
  onQuery,
  onCategory,
  onDetail,
  onEdit,
  onDelete,
  totalPrompts,
  onNew,
}: {
  prompts: PromptItem[];
  query: string;
  categories: PromptCategory[];
  categoryFilter: PromptCategory | "All";
  onQuery: (query: string) => void;
  onCategory: (category: PromptCategory | "All") => void;
  onDetail: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  totalPrompts: number;
  onNew: () => void;
}) {
  const { t } = useLanguage();
  return (
    <section className="library-page">
      <div className="section-heading library-heading">
        <div>
          <p className="eyebrow">{t("Reuse", "复用")}</p>
          <h1>{t("Prompt Library", "Prompt 资料库")}</h1>
        </div>
        <span>{t(`${prompts.length} results`, `${prompts.length} 条结果`)}</span>
      </div>
      {totalPrompts ? (
        <>
          <div className="toolbar neumorph-inset">
            <input
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder={t("Search prompts...", "搜索 Prompt...")}
            />
            <select value={categoryFilter} onChange={(event) => onCategory(event.target.value as PromptCategory | "All")}>
              <option value="All">{t("All Categories", "全部分类")}</option>
              {categories.map((category) => (
                <option value={category} key={category}>
                  {getCategoryLabel(category, t)}
                </option>
              ))}
            </select>
          </div>
          {prompts.length ? (
            <div className="card-grid library-grid">
              {prompts.map((prompt) => (
                <PromptCard key={prompt.id} prompt={prompt} onDetail={onDetail} onEdit={onEdit} onDelete={onDelete} />
              ))}
            </div>
          ) : (
            <div className="search-empty lift-card">{t("No prompts match your current search.", "没有符合当前搜索的 Prompt。")}</div>
          )}
        </>
      ) : (
        <EmptyPromptState onNew={onNew} />
      )}
    </section>
  );
}

function EmptyPromptState({ onNew }: { onNew: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="prompt-empty-state lift-card">
      <span className="empty-mark" />
      <h2>{t("You haven’t saved any prompts yet.", "你还没有保存任何 Prompt。")}</h2>
      <button className="pressable" onClick={onNew}>
        {t("New Prompt", "新建 Prompt")}
      </button>
    </div>
  );
}

function UpdateSettingsPage({
  updateInfo,
  isChecking,
  onCheck,
  onDownload,
}: {
  updateInfo: AppUpdateInfo | null;
  isChecking: boolean;
  onCheck: () => void;
  onDownload: () => void;
}) {
  const { t } = useLanguage();
  const updateAvailable = updateInfo?.status === "update-available";
  return (
    <section className="settings-panel lift-card">
      <div>
        <p className="eyebrow">{t("App Updates", "应用更新")}</p>
        <h1>{t("Check for Updates", "检查更新")}</h1>
        <p className="settings-copy">
          {t("Prompt Cabinet checks GitHub Releases for new beta versions. Download the latest DMG and replace the app in Applications; your local prompts stay on this Mac.", "Prompt Cabinet 会检查 GitHub Releases 中的 beta 版本。下载最新 DMG 后覆盖“应用程序”里的旧版本，本机 Prompt 数据会保留。")}
        </p>
      </div>

      <div className={updateAvailable ? "update-card available" : "update-card"}>
        <div>
          <strong>
            {updateAvailable
              ? t(`Version ${updateInfo.latestVersion} is available`, `发现新版本 ${updateInfo.latestVersion}`)
              : updateInfo?.status === "up-to-date"
                ? t("You are up to date", "当前已是最新版本")
                : t("Update status unavailable", "暂时无法获取更新状态")}
          </strong>
          <span>
            {updateInfo?.currentVersion
              ? t(`Current version: ${updateInfo.currentVersion}`, `当前版本：${updateInfo.currentVersion}`)
              : t("Current version unavailable", "暂时无法读取当前版本")}
          </span>
          {updateInfo?.releaseName && <span>{updateInfo.releaseName}</span>}
        </div>
        <div className="form-actions">
          <button className="ghost-button" onClick={onCheck} disabled={isChecking}>
            {isChecking ? t("Checking...", "检查中...") : t("Check Again", "再次检查")}
          </button>
          {updateAvailable && (
            <button className="pressable" onClick={onDownload}>
              {t("Download Update", "下载更新")}
            </button>
          )}
        </div>
      </div>

      {updateInfo?.status === "unavailable" && updateInfo.message && <div className="settings-status">{updateInfo.message}</div>}
    </section>
  );
}

function LanguageSettingsPage() {
  const { uiLanguage, analysisLanguage, setUiLanguage, setAnalysisLanguage, t } = useLanguage();
  return (
    <section className="settings-panel lift-card">
      <div>
        <p className="eyebrow">{t("Language", "语言")}</p>
        <h1>{t("Language Settings", "语言设置")}</h1>
      </div>
      <div className="settings-grid">
        <label>
          {t("Interface Language", "界面语言")}
          <select
            value={uiLanguage}
            onChange={(event) => setUiLanguage(event.target.value as UiLanguageSetting)}
          >
            <option value="auto">{t("Automatic", "自动")}</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          {t("Analysis Output Language", "分析结果语言")}
          <select
            value={analysisLanguage}
            onChange={(event) => setAnalysisLanguage(event.target.value as AnalysisLanguageSetting)}
          >
            <option value="auto">{t("Follow Prompt", "跟随 Prompt")}</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function ShortcutSettingsPage({
  settings,
  onSave,
}: {
  settings: QuickShortcutSettings;
  onSave: (settings: QuickShortcutSettings) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const shortcutFields: Array<{
    key: keyof QuickShortcutSettings;
    label: string;
    description: string;
    allowUnmodified?: boolean;
  }> = [
    { key: "openQuickAdd", label: t("Open Quick Add", "打开快速面板"), description: t("Show the floating capsule from any app.", "从任意应用显示悬浮胶囊。") },
    { key: "runAction", label: t("Save Captured Prompt", "保存收集的 Prompt"), description: t("Save clipboard content while Capture mode is active.", "在收集模式下保存剪贴板内容。") },
    { key: "captureMode", label: t("Capture Mode", "收集模式"), description: t("Switch the capsule to clipboard capture.", "将胶囊切换到剪贴板收集。") },
    { key: "insertMode", label: t("Insert Mode", "调用模式"), description: t("Switch the capsule to prompt insertion.", "将胶囊切换到 Prompt 调用。") },
    {
      key: "previousCategory",
      label: t("Previous Category", "上一个分类"),
      description: t("Move to the previous category in Capture or Insert mode.", "切换到上一个分类。"),
    },
    {
      key: "nextCategory",
      label: t("Next Category", "下一个分类"),
      description: t("Move to the next category in Capture or Insert mode.", "切换到下一个分类。"),
    },
    {
      key: "previousPrompt",
      label: t("Previous Prompt", "上一个 Prompt"),
      description: t("Move to the previous prompt in the selected Insert category.", "切换到当前分类中的上一个 Prompt。"),
    },
    {
      key: "nextPrompt",
      label: t("Next Prompt", "下一个 Prompt"),
      description: t("Move to the next prompt in the selected Insert category.", "切换到当前分类中的下一个 Prompt。"),
    },
    {
      key: "insertSelected",
      label: t("Insert Selected Prompt", "插入选中的 Prompt"),
      description: t("Insert the currently selected Library or Inbox prompt.", "插入当前选中的资料库或临时收藏夹 Prompt。"),
    },
    {
      key: "closeQuickAdd",
      label: t("Close Quick Add", "关闭快速面板"),
      description: t("Close the floating capsule and return to Prompt Cabinet.", "关闭悬浮胶囊并返回 Prompt Cabinet。"),
      allowUnmodified: true,
    },
  ];

  useEffect(() => setDraft(settings), [settings]);

  async function handleSave() {
    if (new Set(Object.values(draft)).size !== Object.keys(draft).length) {
      setStatus(t("Each action needs a different shortcut.", "每个操作需要使用不同的快捷键。"));
      return;
    }
    setIsSaving(true);
    setStatus("");
    try {
      await onSave(draft);
      setStatus(t("Shortcut settings saved and applied.", "快捷键已保存并生效。"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("Could not register these shortcuts.", "无法注册这些快捷键。"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="settings-panel lift-card shortcut-settings-panel">
      <div>
        <p className="eyebrow">{t("Quick Add Controls", "快速面板控制")}</p>
        <h1>{t("Shortcut Settings", "快捷键设置")}</h1>
        <p className="settings-copy">{t("Click a shortcut field, then press the new key combination.", "点击快捷键框，然后按下新的组合键。")}</p>
      </div>

      <div className="shortcut-settings-list">
        {shortcutFields.map((field) => (
          <div className="shortcut-setting-row" key={field.key}>
            <div>
              <strong>{field.label}</strong>
              <span>{field.description}</span>
            </div>
            <button
              className="shortcut-recorder"
              onKeyDown={(event) => {
                event.preventDefault();
                if (event.key === "Escape" && field.key !== "closeQuickAdd") {
                  event.currentTarget.blur();
                  return;
                }
                const shortcut = shortcutFromKeyboardEvent(event, field.allowUnmodified);
                if (!shortcut) {
                  setStatus(t("Use a supported key combination. Global shortcuts require Command/Ctrl or Option/Alt.", "请使用支持的组合键；全局快捷键需要包含 Command/Ctrl 或 Option/Alt。"));
                  return;
                }
                setDraft((current) => ({ ...current, [field.key]: shortcut }));
                setStatus("");
              }}
              title={`Record shortcut for ${field.label}`}
            >
              {formatShortcut(draft[field.key])}
            </button>
          </div>
        ))}
      </div>

      <div className="form-actions">
        <button className="pressable" onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? t("Saving...", "保存中...") : t("Save Shortcuts", "保存快捷键")}
        </button>
        <button
          className="ghost-button"
          onClick={() => {
            setDraft(defaultQuickShortcutSettings);
            setStatus(t("Defaults ready to save.", "默认设置已恢复，等待保存。"));
          }}
        >
          {t("Restore Defaults", "恢复默认")}
        </button>
      </div>

      {status && <div className="settings-status">{status}</div>}
    </section>
  );
}

function ApiSettingsPage({
  settings,
  onSave,
}: {
  settings: ApiSettings;
  onSave: (settings: ApiSettings) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<ApiSettings>(settings);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const desktopApiAvailable = Boolean(window.promptCabinetApi);
  const activeMode: ApiSettings["provider"] = draft.enabled ? draft.provider : "mock";

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function updateMode(provider: ApiSettings["provider"]) {
    setDraft({
      ...draft,
      provider,
      enabled: provider !== "mock",
    });
  }

  async function handleSave() {
    setIsSaving(true);
    await onSave(draft);
    setStatus(t("Settings saved locally.", "设置已保存在本机。"));
    setIsSaving(false);
  }

  async function handleTest() {
    setIsTesting(true);
    const result = await testApiConnection(draft);
    setStatus(result.ok ? `${t("Connected", "连接成功")}: ${result.message}` : `${t("Connection failed", "连接失败")}: ${result.message}`);
    setIsTesting(false);
  }

  return (
    <section className="settings-panel lift-card">
      <div>
        <p className="eyebrow">{t("Local Analyze Settings", "本地分析设置")}</p>
        <h1>{t("Analyze Settings", "分析设置")}</h1>
        <p className="settings-copy">
          {t(
            "Choose how Prompt Cabinet analyzes prompts. Mock Rules works offline, Local Codex uses your signed-in Codex, and OpenAI-Compatible API uses your provider key.",
            "选择 Prompt Cabinet 的分析方式：本地规则可离线运行，本地 Codex 使用当前电脑已登录的 Codex，兼容 OpenAI 的 API 使用你的服务商密钥。",
          )}
        </p>
      </div>

      <div className="settings-grid">
        <label className="settings-wide">
          {t("Analyze Mode", "分析模式")}
          <select value={activeMode} onChange={(event) => updateMode(event.target.value as ApiSettings["provider"])}>
            <option value="mock">{t("Mock Rules", "本地规则")}</option>
            <option value="codex-local">{t("Local Codex", "本地 Codex")}</option>
            <option value="openai-compatible">{t("OpenAI-Compatible API", "兼容 OpenAI 的 API")}</option>
          </select>
        </label>

        {activeMode === "codex-local" && (
          <>
            <label>
              {t("Codex Model", "Codex 模型")}
              <input
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                onBlur={() => setDraft((current) => ({ ...current, model: normalizeCodexModelId(current.model) }))}
                list="codex-model-options"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t("Optional; for example gpt-5.6-sol", "可选，例如 gpt-5.6-sol")}
              />
              <datalist id="codex-model-options">
                <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
                <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
                <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
                <option value="gpt-5.5">GPT-5.5</option>
              </datalist>
            </label>
            <div className="settings-note">
              {t(
                "Use a model ID such as gpt-5.6-sol, or leave this blank to use the current Codex default. Local Codex must be installed and signed in, and uses your Codex/ChatGPT account quota.",
                "请输入模型 ID（例如 gpt-5.6-sol），不要输入展示名称；留空则使用当前 Codex 默认模型。本地 Codex 需要已安装并登录，并会使用你的 Codex/ChatGPT 账户额度。",
              )}
            </div>
          </>
        )}

        {activeMode === "openai-compatible" && (
          <>
            <label>
              {t("Base URL (root or /v1)", "Base URL（根地址或 /v1 均可）")}
              <input
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label>
              {t("Model", "模型")}
              <input
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                placeholder={t("Enter your provider model", "输入服务商模型")}
              />
            </label>
            <label className="settings-wide">
              {t("API Key", "API 密钥")}
              <input
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                placeholder={t("Stored locally on this computer", "仅保存在这台电脑")}
              />
            </label>
          </>
        )}

        {activeMode === "mock" && (
          <div className="settings-note">
            {t("Mock Rules is fully local and does not call external services. It is fast and free, but less semantic than Codex or API analysis.", "本地规则完全离线，不调用外部服务。速度快且免费，但语义理解弱于 Codex 或 API 分析。")}
          </div>
        )}
      </div>

      {!desktopApiAvailable && activeMode !== "mock" && (
        <div className="settings-note">
          {t("Enhanced Analyze is available in the Electron desktop app. Browser mode uses mock logic.", "增强分析仅适用于 Electron 桌面应用，浏览器模式会使用本地规则。")}
        </div>
      )}

      <div className="form-actions">
        <button className="pressable" onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? t("Saving...", "保存中...") : t("Save Settings", "保存设置")}
        </button>
        <button
          className="pressable"
          onClick={() => void handleTest()}
          disabled={
            isTesting ||
            !desktopApiAvailable ||
            activeMode === "mock" ||
            (activeMode === "openai-compatible" && (!draft.apiKey || !draft.model))
          }
        >
          {isTesting ? t("Testing...", "测试中...") : activeMode === "codex-local" ? t("Test Codex", "测试 Codex") : t("Test Connection", "测试连接")}
        </button>
      </div>

      {status && <div className="settings-status">{status}</div>}
    </section>
  );
}

function shortcutFromKeyboardEvent(event: ReactKeyboardEvent<HTMLElement>, allowUnmodified = false) {
  if (!allowUnmodified && !event.metaKey && !event.ctrlKey && !event.altKey) return "";
  const key = getShortcutKey(event);
  if (!key) return "";
  const parts = [
    event.metaKey || event.ctrlKey ? "CommandOrControl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    key,
  ];
  return parts.filter(Boolean).join("+");
}

function matchesShortcutEvent(event: globalThis.KeyboardEvent, shortcut: string) {
  const parts = shortcut.split("+").filter(Boolean);
  const key = parts.at(-1) ?? "";
  const needsCommandOrControl = parts.includes("CommandOrControl");
  const needsAlt = parts.includes("Alt");
  const needsShift = parts.includes("Shift");
  if ((event.metaKey || event.ctrlKey) !== needsCommandOrControl) return false;
  if (event.altKey !== needsAlt || event.shiftKey !== needsShift) return false;
  return getShortcutKey(event).toLowerCase() === key.toLowerCase();
}

function getShortcutKey(event: { code: string; key: string }) {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(event.code)) return event.code;
  if (event.code === "Enter" || event.code === "NumpadEnter") return "Enter";
  if (event.code === "Space") return "Space";
  if (event.code === "ArrowLeft") return "Left";
  if (event.code === "ArrowRight") return "Right";
  if (event.code === "ArrowUp") return "Up";
  if (event.code === "ArrowDown") return "Down";
  if (event.code === "Escape") return "Escape";
  return "";
}

function formatShortcut(shortcut: string) {
  return shortcut
    .replace("CommandOrControl", "Cmd/Ctrl")
    .replace("Alt", "Option/Alt")
    .replace("Escape", "Esc")
    .split("+")
    .join(" + ");
}

async function prepareBulkImportFiles(files: File[]) {
  const imageFiles = files.filter(isImageFile);
  const contentFiles = files.filter((file) => !isImageFile(file));
  const imageResults = await Promise.all(
    imageFiles.map(async (file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      dataUrl: await readFileAsDataUrl(file),
    })),
  );
  const itemResults = await Promise.all(contentFiles.map((file) => readBulkImportFile(file)));
  const items = itemResults.flat();
  const supportedFileCount = imageFiles.length + contentFiles.filter(isBulkImportTextFile).length;
  return {
    images: imageResults,
    items: autoAssignBulkImages(items, imageResults),
    skippedCount: Math.max(0, files.length - supportedFileCount),
  };
}

function mergeBulkImportImages(current: BulkImportImage[], incoming: BulkImportImage[]) {
  const seen = new Set(current.map((image) => `${normalizeFileStem(image.name)}:${image.dataUrl.length}`));
  const merged = [...current];
  incoming.forEach((image) => {
    const key = `${normalizeFileStem(image.name)}:${image.dataUrl.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(image);
  });
  return merged;
}

function mergeBulkImportItems(current: BulkImportItem[], incoming: BulkImportItem[]) {
  const seen = new Set(current.map((item) => getBulkImportFingerprint(item)));
  const merged = [...current];
  incoming.forEach((item) => {
    const key = getBulkImportFingerprint(item);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
}

function getBulkImportFingerprint(item: BulkImportItem) {
  return `${item.sourceName}:${item.originalPrompt.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

function autoAssignBulkImages(items: BulkImportItem[], images: BulkImportImage[]) {
  const usedImageIds = new Set(items.map((item) => item.imageId).filter(Boolean));
  return items.map((item) => {
    if (item.imageId || item.previewImage) return item;
    const candidates = images
      .filter((image) => !usedImageIds.has(image.id))
      .map((image) => ({ image, score: scoreBulkImageMatch(item, image) }))
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    const runnerUp = candidates[1];
    const hasClearWinner = best && best.score >= 0.78 && (!runnerUp || best.score - runnerUp.score >= 0.12);
    if (!hasClearWinner) return item;
    usedImageIds.add(best.image.id);
    return { ...item, imageId: best.image.id };
  });
}

function scoreBulkImageMatch(item: BulkImportItem, image: BulkImportImage) {
  const imageName = image.name;
  return Math.max(
    scoreBulkMatchText(item.title, imageName),
    scoreBulkMatchText(item.sourceName, imageName),
  );
}

function scoreBulkMatchText(left: string, right: string) {
  const leftCompact = normalizeBulkMatchText(left);
  const rightCompact = normalizeBulkMatchText(right);
  if (!leftCompact || !rightCompact) return 0;
  if (leftCompact === rightCompact) return 1;
  if (Math.min(leftCompact.length, rightCompact.length) >= 7 && (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact))) {
    return 0.86;
  }

  const leftWords = getBulkMatchWords(left);
  const rightWords = getBulkMatchWords(right);
  const sharedWords = leftWords.filter((word) => rightWords.includes(word));
  if (sharedWords.length < 2) return 0;
  return sharedWords.length / Math.max(leftWords.length, rightWords.length);
}

function normalizeBulkMatchText(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .toLocaleLowerCase()
    .replace(/\b(prompt|image|img|copy|final|draft|version|v\d+)\b/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function getBulkMatchWords(value: string) {
  return normalizeBulkMatchText(value)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 1);
}

function autoClassifyBulkImportItem(item: BulkImportItem): BulkImportItem {
  if (item.categoryEdited || item.categoryAiAnalyzed) return item;
  const analyzed = analyzePrompt(item.originalPrompt, "", { tags: item.tags });
  return {
    ...item,
    category: analyzed.category,
    tags: mergeUnique(analyzed.tags, item.tags),
  };
}

async function readBulkImportFile(file: File): Promise<BulkImportItem[]> {
  if (!isBulkImportTextFile(file)) return [];
  const extension = getFileExtension(file.name);
  if (extension === "docx") {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return parseBulkText(result.value, file.name);
  }
  const text = await file.text();
  if (extension === "json") return parseBulkJson(text, file.name);
  if (extension === "csv") return parseBulkCsv(text, file.name);
  return parseBulkText(text, file.name);
}

function parseBulkJson(text: string, sourceName: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    const normalized = normalizeImportedPrompts(parsed);
    if (normalized.length) return normalized.map((prompt) => promptToBulkImportItem(prompt, sourceName));
    const rawItems = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.prompts)
        ? parsed.prompts
        : [parsed];
    return rawItems.map((item, index) => genericValueToBulkItem(item, sourceName, index)).filter(Boolean) as BulkImportItem[];
  } catch {
    return [];
  }
}

function parseBulkCsv(text: string, sourceName: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  return rows.slice(1).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""]));
    return genericValueToBulkItem(record, sourceName, index);
  }).filter(Boolean) as BulkImportItem[];
}

function parseBulkText(text: string, sourceName: string) {
  return splitBulkTextBlocks(text)
    .map((block, index) => createBulkTextItem(block, sourceName, index))
    .filter(Boolean) as BulkImportItem[];
}

function splitBulkTextBlocks(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  // Support divider lines and the generous blank-line spacing common in copied prompt collections.
  return normalized.split(/\n\s*(?:-{3,}|_{3,}|\*{3,})\s*\n|\n{3,}/g);
}

function promptToBulkImportItem(prompt: PromptItem, sourceName: string): BulkImportItem {
  return {
    id: crypto.randomUUID(),
    sourceName,
    title: prompt.title,
    originalPrompt: prompt.originalPrompt,
    category: prompt.category || "Product",
    tags: prompt.tags ?? [],
    inputNeeded: prompt.inputNeeded ?? [],
    previewImage: prompt.previewImage,
    imageId: "",
    included: true,
  };
}

function genericValueToBulkItem(value: unknown, sourceName: string, index: number) {
  if (typeof value === "string") return createBulkTextItem(value, sourceName, index);
  if (!isRecord(value)) return undefined;
  const originalPrompt = [value.originalPrompt, value.originalprompt, value.prompt, value.content, value.text]
    .find((item): item is string => typeof item === "string" && item.trim().length > 0)
    ?.trim();
  if (!originalPrompt) return undefined;
  const suppliedTitle = typeof value.title === "string" && value.title.trim() ? value.title.trim() : "";
  const title = suppliedTitle || getBulkTitle(originalPrompt, sourceName, index);
  const tags = Array.isArray(value.tags)
    ? value.tags.map(String).map((tag) => tag.trim()).filter(Boolean)
    : typeof value.tags === "string"
      ? value.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : [];
  const inputNeeded = Array.isArray(value.inputNeeded)
    ? value.inputNeeded.map(String).map((input) => input.trim()).filter(Boolean)
    : typeof value.inputNeeded === "string"
      ? value.inputNeeded.split(",").map((input) => input.trim()).filter(Boolean)
      : [];
  return {
    id: crypto.randomUUID(),
    sourceName,
    title,
    titleGenerated: !suppliedTitle,
    originalPrompt,
    category: typeof value.category === "string" && value.category.trim() ? value.category.trim() : "Product",
    tags,
    inputNeeded,
    previewImage: typeof value.previewImage === "string" && value.previewImage.startsWith("data:image/") ? value.previewImage : undefined,
    imageId: "",
    included: true,
  } satisfies BulkImportItem;
}

function createBulkTextItem(block: string, sourceName: string, index: number) {
  const trimmed = block.trim();
  if (!trimmed) return undefined;
  const heading = trimmed.match(/^#\s+(.+)\n+([\s\S]*)$/);
  const originalPrompt = (heading?.[2] || trimmed).trim();
  if (!originalPrompt) return undefined;
  const headingTitle = heading?.[1].trim() || "";
  return {
    id: crypto.randomUUID(),
    sourceName,
    title: headingTitle || getBulkTitle(originalPrompt, sourceName, index),
    titleGenerated: !headingTitle,
    originalPrompt,
    category: "Product",
    tags: [],
    inputNeeded: [],
    imageId: "",
    included: true,
  } satisfies BulkImportItem;
}

function getBulkTitle(prompt: string, sourceName: string, index: number) {
  const sourceTitle = normalizeFileStem(sourceName).replace(/[-_]+/g, " ").trim();
  if (sourceTitle && index === 0) return sourceTitle;
  const firstLine = prompt.split("\n").find((line) => line.trim())?.trim() ?? "";
  return firstLine.slice(0, 64) || `Imported Prompt ${index + 1}`;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];
    if (character === '"' && inQuotes && nextCharacter === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function isBulkImportTextFile(file: File) {
  return ["txt", "md", "markdown", "docx", "json", "csv"].includes(getFileExtension(file.name));
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "avif", "heic"].includes(getFileExtension(file.name));
}

function getFileExtension(name: string) {
  return name.split(".").at(-1)?.toLowerCase() ?? "";
}

function normalizeFileStem(name: string) {
  return name.replace(/\.[^.]+$/, "").trim().toLowerCase();
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image could not be read")));
    reader.onerror = () => reject(reader.error ?? new Error("Image could not be read"));
    reader.readAsDataURL(file);
  });
}

function createVisionThumbnail(dataUrl: string) {
  return new Promise<string>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
      if (!longestSide || longestSide <= 768) {
        resolve(dataUrl);
        return;
      }
      const scale = 768 / longestSide;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(dataUrl);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function autoClassifyImportedPrompt(prompt: PromptItem, forcedCategory?: PromptCategory): PromptItem {
  const analyzed = analyzePrompt(prompt.originalPrompt, prompt.notes, {
    category: forcedCategory,
    tags: prompt.tags,
  });
  const category = forcedCategory ?? analyzed.category;
  const importedTitle = prompt.title.trim();
  const genericTitle = !importedTitle || importedTitle === "Untitled Prompt";

  return {
    ...prompt,
    status: "saved",
    title: genericTitle ? analyzed.title : importedTitle,
    category,
    tags: cleanPromptTags(mergeUnique(analyzed.tags, prompt.tags), category, analyzed.platform, prompt.originalPrompt),
    platform: prompt.platform.trim() && prompt.platform !== "ChatGPT" ? prompt.platform : analyzed.platform,
    useCase: prompt.useCase.trim() && prompt.useCase !== "Saved prompt for future reuse."
      ? prompt.useCase
      : analyzed.useCase,
    inputNeeded: prompt.inputNeeded.length ? prompt.inputNeeded : analyzed.inputNeeded,
    expectedOutput: prompt.expectedOutput.trim() && prompt.expectedOutput !== "Reusable prompt output."
      ? prompt.expectedOutput
      : analyzed.expectedOutput,
    refinedPrompt: prompt.refinedPrompt.trim() || prompt.originalPrompt,
  };
}

function mergeImportedPrompts(existingPrompts: PromptItem[], importedPrompts: PromptItem[]) {
  const merged = [...existingPrompts];
  let added = 0;
  let updated = 0;

  importedPrompts.forEach((prompt) => {
    const promptFingerprint = getPromptFingerprint(prompt);
    const matchIndex = merged.findIndex((existing) => getPromptFingerprint(existing) === promptFingerprint);
    if (matchIndex >= 0) {
      const previous = merged[matchIndex];
      merged[matchIndex] = {
        ...previous,
        ...prompt,
        id: previous.id,
        createdAt: previous.createdAt,
        // Re-imported AI analysis is newer than the previous automatic tags.
        tags: prompt.tags.length ? prompt.tags : previous.tags,
      };
      updated += 1;
      return;
    }

    merged.unshift(prompt);
    added += 1;
  });

  return { prompts: merged, added, updated };
}

function getPromptFingerprint(prompt: PromptItem) {
  return prompt.originalPrompt.trim().replace(/\s+/g, " ").toLowerCase();
}

function mergeUnique(primary: string[], secondary: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  [...primary, ...secondary].forEach((tag) => {
    const cleanTag = tag.trim();
    const key = cleanTag.toLowerCase();
    if (!cleanTag || seen.has(key)) return;
    seen.add(key);
    merged.push(cleanTag);
  });
  return merged.slice(0, 8);
}

function getVisibleCategories(
  customCategories: CustomCategory[],
  hiddenCategories: PromptCategory[],
  prompts: PromptItem[] = [],
) {
  const categoryNames = mergeCategoryNames([
    ...builtInCategories,
    ...customCategories.map((category) => category.name),
    ...prompts.map((prompt) => prompt.category),
  ]);
  return categoryNames.filter((category) => {
    if (!hiddenCategories.includes(category)) return true;
    return prompts.some((prompt) => prompt.category === category);
  });
}

function mergeCategoryNames(categories: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  categories.forEach((category) => {
    const cleanCategory = normalizeCustomCategoryName(category);
    const key = cleanCategory.toLowerCase();
    if (!cleanCategory || seen.has(key)) return;
    seen.add(key);
    merged.push(cleanCategory);
  });
  return merged;
}

function mergeCustomCategories(categories: CustomCategory[]) {
  const seen = new Set<string>();
  const merged: CustomCategory[] = [];
  categories.forEach((category) => {
    const name = normalizeCustomCategoryName(category.name);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    merged.push({
      name,
      color: normalizeCategoryColor(category.color) || categoryColorSwatches[merged.length % categoryColorSwatches.length],
    });
  });
  return merged;
}

function normalizeCustomCategoryName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 24);
}

function normalizeCategoryColor(value: string) {
  const color = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function PromptDetail({
  prompt,
  onSave,
  onEdit,
  onDelete,
}: {
  prompt: PromptItem;
  onSave: (prompt: PromptItem) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [customPrompt, setCustomPrompt] = useState(prompt.refinedPrompt || prompt.originalPrompt);
  const [rewriteSegments, setRewriteSegments] = useState<RewriteSegment[]>(() => getPromptRewriteSegments(prompt));
  const [saved, setSaved] = useState(false);
  const savedCustomPrompt = prompt.refinedPrompt || prompt.originalPrompt;
  const savedRewriteSegments = getPromptRewriteSegments(prompt);
  const inputVariables = getPromptInputVariables(prompt.originalPrompt, prompt.inputNeeded);
  const displayedInputs = inputVariables.map((variable) => getPromptInputDisplayLabel(prompt.originalPrompt, variable));
  const hasUnsavedChanges =
    customPrompt !== savedCustomPrompt || !areRewriteSegmentsEqual(rewriteSegments, savedRewriteSegments);

  useEffect(() => {
    setCustomPrompt(prompt.refinedPrompt || prompt.originalPrompt);
    setRewriteSegments(getPromptRewriteSegments(prompt));
  }, [prompt.id, prompt.originalPrompt, prompt.refinedPrompt, prompt.rewriteHistory]);

  useEffect(() => {
    setSaved(false);
  }, [prompt.id]);

  function saveCustomPrompt() {
    if (!hasUnsavedChanges) return;
    onSave({
      ...prompt,
      refinedPrompt: customPrompt,
      rewriteHistory: rewriteSegments.some((segment) => segment.status !== "same") ? rewriteSegments : undefined,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1300);
  }

  function restoreOriginalPrompt() {
    setCustomPrompt(prompt.originalPrompt);
    setRewriteSegments(prompt.originalPrompt ? [{ value: prompt.originalPrompt, status: "same" }] : []);
    setSaved(false);
  }

  function replaceOriginalPrompt() {
    const replacement = customPrompt.trim();
    if (!replacement || replacement === prompt.originalPrompt) return;
    const confirmed = window.confirm(
      t(
        "Replace the original prompt with this custom version? The current rewrite comparison will be cleared.",
        "用当前自定义版本替换原始 Prompt 吗？现有的改写对比将被清除。",
      ),
    );
    if (!confirmed) return;

    onSave({
      ...prompt,
      originalPrompt: replacement,
      refinedPrompt: replacement,
      rewriteHistory: undefined,
    });
    setCustomPrompt(replacement);
    setRewriteSegments([{ value: replacement, status: "same" }]);
    setSaved(false);
  }

  function updateCustomPrompt(nextPrompt: string) {
    setRewriteSegments((current) => applyTrackedRewrite(current, customPrompt, nextPrompt, prompt.originalPrompt));
    setCustomPrompt(nextPrompt);
    setSaved(false);
  }

  return (
    <article className="detail-panel">
      <div className="detail-header lift-card">
        <div>
          <p className="eyebrow">{getCategoryLabel(prompt.category, t)}</p>
          <h1>{prompt.title}</h1>
          <p>{prompt.useCase}</p>
        </div>
        <div className="detail-actions">
          <CopyButton text={customPrompt} />
          <button className="ghost-button" onClick={onEdit}>
            {t("Edit", "编辑")}
          </button>
          <button className="ghost-button danger-button" onClick={onDelete}>
            {t("Delete", "删除")}
          </button>
        </div>
      </div>

      <section className="prompt-info-panel lift-card">
        <InfoItem label={t("Use Case", "使用场景")} value={prompt.useCase} />
        <InfoItem label={t("Input Needed", "所需输入")} value={displayedInputs.join(", ") || t("None", "无")} />
        <InfoItem label={t("Platform", "平台")} value={prompt.platform} />
        <InfoItem label={t("Expected Output", "预期输出")} value={prompt.expectedOutput} />
      </section>

      <div className="detail-grid">
        <LiveRewritePreview segments={rewriteSegments} inputVariables={inputVariables} />
        <section className="detail-section lift-card featured custom-prompt-section">
          <div className="custom-prompt-heading">
            <h2>{t("Custom Prompt", "自定义 Prompt")}</h2>
            <div className="custom-prompt-actions">
              <button
                className="ghost-button replace-original-button"
                disabled={!customPrompt.trim() || customPrompt === prompt.originalPrompt}
                onClick={replaceOriginalPrompt}
              >
                {t("Replace Original", "替换原始 Prompt")}
              </button>
              <button className="ghost-button" disabled={!hasUnsavedChanges} onClick={saveCustomPrompt}>
                {saved ? t("Saved", "已保存") : t("Save", "保存")}
              </button>
              <button
                className="ghost-button"
                disabled={customPrompt === prompt.originalPrompt}
                onClick={restoreOriginalPrompt}
              >
                {t("Restore", "复原")}
              </button>
            </div>
          </div>
          <textarea
            className="custom-prompt-editor"
            value={customPrompt}
            onChange={(event) => updateCustomPrompt(event.target.value)}
            aria-label="Custom prompt to copy"
          />
        </section>
        {prompt.previewImage && <PromptReferenceImage image={prompt.previewImage} title={prompt.title} />}
        <section className="detail-section lift-card">
          <h2>{t("Tags", "标签")}</h2>
          <TagList tags={prompt.tags} />
        </section>
        <DetailSection title={t("Notes", "备注")} body={prompt.notes} />
      </div>
    </article>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function PromptCard({
  prompt,
  onDetail,
  onEdit,
  onDelete,
  compact = false,
}: {
  prompt: PromptItem;
  onDetail: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const hasVisualPreview = Boolean(prompt.previewImage);
  return (
    <article className={hasVisualPreview ? "prompt-card visual-prompt-card lift-card" : "prompt-card lift-card"}>
      {hasVisualPreview && (
        <button
          className="visual-card-media"
          onClick={() => onDetail(prompt.id)}
          aria-label={`View ${prompt.title}`}
        >
          <img src={prompt.previewImage} alt="" />
          <span>{t("Prompt", "Prompt")}</span>
        </button>
      )}
      <div className="prompt-card-content">
        <div>
          <p className="eyebrow">{hasVisualPreview ? `${getCategoryLabel(prompt.category, t)} · ${prompt.platform}` : prompt.platform}</p>
          <h3>{prompt.title}</h3>
          {!hasVisualPreview && <p>{compact ? prompt.expectedOutput : prompt.useCase}</p>}
        </div>
        <div className="prompt-card-footer">
          <TagList tags={prompt.tags.slice(0, hasVisualPreview ? 2 : compact ? 3 : 4)} />
          <div className="card-actions">
            <button className="ghost-button card-action-button" onClick={() => onDetail(prompt.id)}>
              {t("View", "查看")}
            </button>
            <CopyButton text={prompt.refinedPrompt} small />
            {onEdit && (
              <button className="ghost-button card-action-button" onClick={() => onEdit(prompt.id)}>
                {t("Edit", "编辑")}
              </button>
            )}
            {onDelete && (
              <button className="ghost-button danger-button" onClick={() => onDelete(prompt.id)}>
                {t("Delete", "删除")}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function parseTags(value: string) {
  return mergeUnique(value.split(","), []);
}

function getPromptActivityTime(prompt: PromptItem) {
  const updatedTime = prompt.updatedAt ? Date.parse(prompt.updatedAt) : Number.NaN;
  if (Number.isFinite(updatedTime)) return updatedTime;
  const createdTime = Date.parse(prompt.createdAt);
  return Number.isFinite(createdTime) ? createdTime : 0;
}

function buildRecentPrompts(prompts: PromptItem[], limit: number) {
  return [...prompts]
    .sort((a, b) => getPromptActivityTime(b) - getPromptActivityTime(a))
    .slice(0, limit);
}

function getAnalyzeButtonLabel(settings: ApiSettings, t: (english: string, chinese: string) => string) {
  if (!settings.enabled || settings.provider === "mock") return t("Analyze Prompt", "分析 Prompt");
  if (settings.provider === "codex-local") return t("Analyze with Codex", "使用 Codex 分析");
  return t("Analyze with API", "使用 API 分析");
}

function getAnalysisResultLabel(settings: ApiSettings, t: (english: string, chinese: string) => string) {
  if (!settings.enabled || settings.provider === "mock") return t("Mock Analysis Result", "本地规则分析结果");
  if (settings.provider === "codex-local") return t("Codex Analysis Result", "Codex 分析结果");
  return t("API Analysis Result", "API 分析结果");
}

function getAnalyzeModeLabel(settings: ApiSettings, t: (english: string, chinese: string) => string) {
  if (settings.provider === "codex-local") return t("Local Codex Analyze", "本地 Codex 分析");
  if (settings.provider === "openai-compatible") return t("API Analyze", "API 分析");
  return t("Mock Analyze", "本地规则分析");
}

function buildSnapshotRewriteSegments(original: string, refined: string): RewriteSegment[] {
  const originalBlocks = splitPromptBlocks(original);
  const refinedBlocks = splitPromptBlocks(refined);
  const originalWords = originalBlocks.map(normalizeDiffToken);
  const refinedWords = refinedBlocks.map(normalizeDiffToken);
  const table = Array.from({ length: originalBlocks.length + 1 }, () => Array(refinedBlocks.length + 1).fill(0));

  for (let originalIndex = originalBlocks.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let refinedIndex = refinedBlocks.length - 1; refinedIndex >= 0; refinedIndex -= 1) {
      table[originalIndex][refinedIndex] =
        originalWords[originalIndex] === refinedWords[refinedIndex]
          ? table[originalIndex + 1][refinedIndex + 1] + 1
          : Math.max(table[originalIndex + 1][refinedIndex], table[originalIndex][refinedIndex + 1]);
    }
  }

  const segments: RewriteSegment[] = [];
  const pendingAdded: string[] = [];
  const pendingRemoved: string[] = [];
  let originalIndex = 0;
  let refinedIndex = 0;

  function flushChanges() {
    if (!pendingAdded.length && !pendingRemoved.length) return;
    if (pendingRemoved.length) {
      segments.push({ value: pendingRemoved.join(""), status: "removed" });
    }
    if (pendingAdded.length) {
      segments.push({ value: pendingAdded.join(""), status: "added" });
    }
    pendingAdded.length = 0;
    pendingRemoved.length = 0;
  }

  while (originalIndex < originalBlocks.length || refinedIndex < refinedBlocks.length) {
    if (
      originalIndex < originalBlocks.length &&
      refinedIndex < refinedBlocks.length &&
      originalWords[originalIndex] === refinedWords[refinedIndex]
    ) {
      flushChanges();
      segments.push({ value: refinedBlocks[refinedIndex], status: "same" });
      originalIndex += 1;
      refinedIndex += 1;
      continue;
    }

    if (
      refinedIndex < refinedBlocks.length &&
      (originalIndex >= originalBlocks.length ||
        table[originalIndex][refinedIndex + 1] >= table[originalIndex + 1][refinedIndex])
    ) {
      pendingAdded.push(refinedBlocks[refinedIndex]);
      refinedIndex += 1;
      continue;
    }

    if (originalIndex < originalBlocks.length) {
      pendingRemoved.push(originalBlocks[originalIndex]);
      originalIndex += 1;
    }
  }

  flushChanges();

  return mergeRewriteSegments(segments);
}

function splitPromptBlocks(value: string) {
  return value.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
}

function normalizeDiffToken(value: string) {
  return value;
}

function getPromptRewriteSegments(prompt: PromptItem): RewriteSegment[] {
  const refinedPrompt = prompt.refinedPrompt || prompt.originalPrompt;
  if (refinedPrompt === prompt.originalPrompt) {
    return prompt.originalPrompt ? [{ value: prompt.originalPrompt, status: "same" }] : [];
  }
  if (isValidRewriteHistory(prompt.rewriteHistory, prompt.originalPrompt, refinedPrompt)) {
    return prompt.rewriteHistory;
  }
  return buildSnapshotRewriteSegments(prompt.originalPrompt, refinedPrompt);
}

function isValidRewriteHistory(
  history: RewriteSegment[] | undefined,
  originalPrompt: string,
  refinedPrompt: string,
): history is RewriteSegment[] {
  if (!history?.length) return false;
  const originalProjection = history
    .filter((segment) => segment.status !== "added")
    .map((segment) => segment.value)
    .join("");
  const refinedProjection = history
    .filter((segment) => segment.status !== "removed")
    .map((segment) => segment.value)
    .join("");
  return originalProjection === originalPrompt && refinedProjection === refinedPrompt;
}

function applyTrackedRewrite(
  history: RewriteSegment[],
  previousPrompt: string,
  nextPrompt: string,
  originalPrompt: string,
): RewriteSegment[] {
  if (nextPrompt === originalPrompt) {
    return originalPrompt ? [{ value: originalPrompt, status: "same" }] : [];
  }
  const validHistory = isValidRewriteHistory(history, originalPrompt, previousPrompt)
    ? history
    : buildSnapshotRewriteSegments(originalPrompt, previousPrompt);
  const previousCharacters = Array.from(previousPrompt);
  const nextCharacters = Array.from(nextPrompt);
  let prefixLength = 0;
  while (
    prefixLength < previousCharacters.length &&
    prefixLength < nextCharacters.length &&
    previousCharacters[prefixLength] === nextCharacters[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousCharacters.length - prefixLength &&
    suffixLength < nextCharacters.length - prefixLength &&
    previousCharacters[previousCharacters.length - 1 - suffixLength] ===
      nextCharacters[nextCharacters.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const deletedCharacterCount = previousCharacters.length - prefixLength - suffixLength;
  const insertedValue = nextCharacters.slice(prefixLength, nextCharacters.length - suffixLength).join("");
  const atoms = validHistory.flatMap((segment) =>
    Array.from(segment.value, (value) => ({ value, status: segment.status } satisfies RewriteSegment)),
  );
  const visibleAtomIndexes: number[] = [];
  atoms.forEach((atom, index) => {
    if (atom.status !== "removed") visibleAtomIndexes.push(index);
  });
  const deletedIndexes = new Set(visibleAtomIndexes.slice(prefixLength, prefixLength + deletedCharacterCount));
  const nextVisibleAtomIndex = visibleAtomIndexes[prefixLength + deletedCharacterCount] ?? atoms.length;
  const updatedAtoms: RewriteSegment[] = [];

  atoms.forEach((atom, index) => {
    if (index === nextVisibleAtomIndex && insertedValue) {
      updatedAtoms.push({ value: insertedValue, status: "added" });
    }
    if (!deletedIndexes.has(index)) {
      updatedAtoms.push(atom);
    } else if (atom.status === "same") {
      updatedAtoms.push({ ...atom, status: "removed" });
    }
  });
  if (nextVisibleAtomIndex === atoms.length && insertedValue) {
    updatedAtoms.push({ value: insertedValue, status: "added" });
  }

  return mergeRewriteSegments(updatedAtoms);
}

function mergeRewriteSegments(segments: RewriteSegment[]) {
  return segments.reduce<RewriteSegment[]>((merged, segment) => {
    if (!segment.value) return merged;
    const previous = merged[merged.length - 1];
    if (previous?.status === segment.status) {
      previous.value += segment.value;
    } else {
      merged.push({ ...segment });
    }
    return merged;
  }, []);
}

function areRewriteSegmentsEqual(first: RewriteSegment[], second: RewriteSegment[]) {
  return (
    first.length === second.length &&
    first.every(
      (segment, index) => segment.status === second[index].status && segment.value === second[index].value,
    )
  );
}

function DetailSection({ title, body, featured = false }: { title: string; body: string; featured?: boolean }) {
  return (
    <section className={`detail-section lift-card ${featured ? "featured" : ""}`}>
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}

function PromptReferenceImage({ image, title }: { image: string; title: string }) {
  const { t } = useLanguage();
  return (
    <section className="detail-section lift-card prompt-reference-image-section">
      <h2>{t("Reference Image", "参考图片")}</h2>
      <div className="prompt-reference-image-frame">
        <img src={image} alt={t(`Reference image for ${title}`, `${title} 的参考图片`)} />
      </div>
    </section>
  );
}

function LiveRewritePreview({ segments, inputVariables }: { segments: RewriteSegment[]; inputVariables: string[] }) {
  const { t } = useLanguage();
  return (
    <section className="detail-section lift-card live-rewrite-section">
      <div className="live-rewrite-heading">
        <h2>{t("Original Prompt", "原始 Prompt")}</h2>
        <div className="rewrite-legend" aria-label="Rewrite color legend">
          <span><i className="legend-dot added" />{t("Added", "新增")}</span>
          <span><i className="legend-dot removed" />{t("Removed", "删除")}</span>
          {inputVariables.length > 0 && <span><i className="legend-dot input" />{t("Input", "所需输入")}</span>}
        </div>
      </div>
      <DiffText segments={segments} label="Original prompt with live custom changes" inputVariables={inputVariables} />
    </section>
  );
}

function DiffText({ segments, label, inputVariables = [] }: { segments: RewriteSegment[]; label: string; inputVariables?: string[] }) {
  return (
    <div className="diff-text live-rewrite-text" aria-label={label}>
      {segments.map((segment, index) => (
        <span className={segment.status === "same" ? undefined : `diff-token ${segment.status}`} key={`${label}-${index}`}>
          <PromptInputHighlights value={segment.value} inputVariables={inputVariables} keyPrefix={`${label}-${index}`} />
        </span>
      ))}
    </div>
  );
}

function PromptInputHighlights({ value, inputVariables, keyPrefix }: { value: string; inputVariables: string[]; keyPrefix: string }) {
  const matches = getPromptInputMatches(value, inputVariables);
  if (!matches.length) return <>{value}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    if (cursor < match.start) parts.push(value.slice(cursor, match.start));
    parts.push(<mark className="input-highlight" key={`${keyPrefix}-input-${index}`}>{value.slice(match.start, match.end)}</mark>);
    cursor = match.end;
  });
  if (cursor < value.length) parts.push(value.slice(cursor));
  return <>{parts}</>;
}

function getPromptInputMatches(value: string, inputVariables: string[]) {
  const ranges: Array<{ start: number; end: number }> = [];
  const addMatches = (pattern: RegExp) => {
    for (const match of value.matchAll(pattern)) {
      if (typeof match.index === "number" && match[0]) ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  };

  addMatches(/#(?:uploaded image|reference image|original image|source text|source document|design brief)|#[A-Za-z][A-Za-z0-9_/-]{0,39}|\{\{\s*[^{}\n]{1,40}?\s*\}\}|<\s*[^<>\n]{1,40}?\s*>|\[\[?\s*[A-Za-z][A-Za-z0-9 _/-]{0,39}\s*\]?\]/gi);
  inputVariables.forEach((variable) => getPromptInputPatterns(variable).forEach(addMatches));

  return ranges
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged.at(-1);
      if (!previous || range.start >= previous.end) merged.push(range);
      return merged;
    }, []);
}

function TagList({ tags }: { tags: string[] }) {
  const uniqueTags = mergeUnique(tags, []);
  return (
    <div className="tags">
      {uniqueTags.map((tag, index) => (
        <span className={`tag ${tagTone[index % tagTone.length]}`} key={tag}>
          {tag}
        </span>
      ))}
    </div>
  );
}

function CopyButton({ text, small = false }: { text: string; small?: boolean }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  }

  return (
    <button className={small ? "ghost-button card-action-button copy-small" : "pressable"} onClick={handleCopy}>
      {copied ? t("Copied", "已复制") : t("Copy", "复制")}
    </button>
  );
}

function getCategoryCopy(category: PromptCategory, t: (english: string, chinese: string) => string) {
  const chineseCopy: Record<string, string> = {
    Design: "界面、视觉、作品集与评审",
    Writing: "草稿、改写与语气控制",
    Research: "摘要、对比与洞察",
    Coding: "代码、仓库、调试与实现",
    Image: "视觉提示词与艺术指导",
    Video: "场景、脚本与分镜",
    Career: "求职材料与面试",
    Product: "简报、规格与决策",
  };
  return t(builtInCategoryCopy[category] ?? "Custom workflow", chineseCopy[category] ?? "自定义工作流");
}

function getCategoryLabel(category: PromptCategory, t: (english: string, chinese: string) => string) {
  const labels: Record<string, string> = {
    Design: "设计",
    Writing: "写作",
    Research: "调研",
    Coding: "编程",
    Image: "图像",
    Video: "视频",
    Career: "职业",
    Product: "产品",
  };
  return labels[category] ? t(category, labels[category]) : category;
}

const builtInCategoryCopy: Record<string, string> = {
  Design: "UI/UX, visual, portfolio, critique",
  Writing: "Drafts, edits, and tone control",
  Research: "Summaries, comparisons, and insights",
  Coding: "Code, repos, debug, implementation",
  Image: "Visual prompts and art direction",
  Video: "Scenes, scripts, and storyboards",
  Career: "Applications and interviews",
  Product: "Briefs, specs, and decisions",
};
