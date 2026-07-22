import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  analyzePromptWithApi,
  defaultApiSettings,
  loadApiSettings,
  saveApiSettings,
  testApiConnection,
} from "./apiClient";
import { analyzePrompt, categories as builtInCategories } from "./promptEngine";
import { loadPrompts, normalizeImportedPrompts, savePrompts } from "./storage";
import {
  LanguageProvider,
  useLanguage,
  type AnalysisLanguageSetting,
  type UiLanguageSetting,
} from "./i18n";
import type { ApiSettings, PromptCategory, PromptItem, QuickShortcutSettings, RewriteSegment } from "./types";

type View = "dashboard" | "add" | "library" | "detail" | "edit" | "settings";
type ImportMode = "all" | "category";
type SettingsSection = "analyze" | "shortcuts" | "language";
type CustomCategory = {
  name: PromptCategory;
  color: string;
};

const tagTone = ["mint", "peach", "rose", "stone"];
const CUSTOM_CATEGORIES_KEY = "prompt-cabinet-custom-categories";
const HIDDEN_CATEGORIES_KEY = "prompt-cabinet-hidden-categories";
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

export default function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

function AppContent() {
  const { t } = useLanguage();
  if (isQuickAddMode()) return <QuickAddApp />;

  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [selectedId, setSelectedId] = useState(prompts[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<PromptCategory | "All">("All");
  const [dataCategory, setDataCategory] = useState<PromptCategory>("Design");
  const [openDataMenu, setOpenDataMenu] = useState<"window" | "setting" | "data" | "help" | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("analyze");
  const [apiSettings, setApiSettings] = useState<ApiSettings>(defaultApiSettings);
  const [quickShortcuts, setQuickShortcuts] = useState<QuickShortcutSettings>(defaultQuickShortcutSettings);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(() => loadCustomCategories());
  const [hiddenCategories, setHiddenCategories] = useState<PromptCategory[]>(() => loadHiddenCategories());
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [categoryDraftColor, setCategoryDraftColor] = useState(categoryColorSwatches[0]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importModeRef = useRef<ImportMode>("all");

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
  const categoryPromptCount = savedPrompts.filter((prompt) => prompt.category === dataCategory).length;

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

  function exportPrompts(mode: "all" | "category") {
    const exportedPrompts =
      mode === "category" ? savedPrompts.filter((prompt) => prompt.category === dataCategory) : savedPrompts;
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

  function chooseImportFile(mode: ImportMode) {
    importModeRef.current = mode;
    fileInputRef.current?.click();
  }

  async function importPrompts(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const importedPrompts = normalizeImportedPrompts(parsed).map((prompt) => autoClassifyImportedPrompt(prompt));
      if (!importedPrompts.length) {
        window.alert(t("No valid prompts found in this JSON file.", "这个 JSON 文件中没有有效的 Prompt。"));
        return;
      }

      if (importModeRef.current === "category") {
        const targetCategory = getImportCategory(parsed, dataCategory);
        const categoryPrompts = importedPrompts.map((prompt) =>
          autoClassifyImportedPrompt({ ...prompt, category: targetCategory }, targetCategory),
        );
        const { prompts: mergedPrompts, added, updated } = mergeImportedPrompts(prompts, categoryPrompts);
        setPrompts(mergedPrompts);
        setSelectedId(categoryPrompts[0]?.id ?? mergedPrompts[0]?.id ?? "");
        setCategoryFilter(targetCategory);
        setView("library");
        window.alert(t(`Imported ${categoryPrompts.length} prompts into ${targetCategory}. Added ${added}, updated ${updated}.`, `已导入 ${categoryPrompts.length} 条 Prompt 到 ${getCategoryLabel(targetCategory, t)}，新增 ${added} 条，更新 ${updated} 条。`));
        return;
      }

      const { prompts: mergedPrompts, added, updated } = mergeImportedPrompts(prompts, importedPrompts);
      setPrompts(mergedPrompts);
      setSelectedId(importedPrompts[0]?.id ?? mergedPrompts[0]?.id ?? "");
      setCategoryFilter("All");
      setView("library");
      window.alert(t(`Imported ${importedPrompts.length} prompts. Added ${added}, updated ${updated}.`, `已导入 ${importedPrompts.length} 条 Prompt，新增 ${added} 条，更新 ${updated} 条。`));
    } catch {
      window.alert(t("Could not import this JSON file. Please check the file format.", "无法导入这个 JSON 文件，请检查文件格式。"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
                <div className="popover-section">
                  <div className="popover-section-heading">
                    <strong>{t("Full Library", "完整资料库")}</strong>
                    <span>{t("All saved prompts across every category.", "所有分类中已保存的 Prompt。")}</span>
                  </div>
                  <div className="popover-split">
                    <button
                      className="popover-action"
                      onClick={() => {
                        chooseImportFile("all");
                        setOpenDataMenu(null);
                      }}
                    >
                      {t("Import All", "导入全部")}
                    </button>
                    <button
                      className="popover-action"
                      onClick={() => {
                        exportPrompts("all");
                        setOpenDataMenu(null);
                      }}
                      disabled={!prompts.length}
                    >
                      {t("Export All", "导出全部")}
                    </button>
                  </div>
                </div>

                <div className="popover-section">
                  <div className="popover-section-heading">
                    <strong>{t("Selected Category", "选中分类")}</strong>
                    <span>{t("Only prompts filed under the category below.", "仅处理下方分类中的 Prompt。")}</span>
                  </div>
                  <label>
                    {t("Category", "分类")}
                    <select
                      value={dataCategory}
                      onChange={(event) => setDataCategory(event.target.value as PromptCategory)}
                    >
                      {allCategories.map((category) => (
                        <option value={category} key={category}>
                          {getCategoryLabel(category, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="popover-split">
                    <button
                      className="popover-action"
                      onClick={() => {
                        chooseImportFile("category");
                        setOpenDataMenu(null);
                      }}
                    >
                      {t("Import Into Selected", "导入到选中分类")}
                    </button>
                    <button
                      className="popover-action"
                      onClick={() => {
                        exportPrompts("category");
                        setOpenDataMenu(null);
                      }}
                      disabled={!categoryPromptCount}
                    >
                      {t("Export Selected", "导出选中分类")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="data-menu">
            <button
              className={openDataMenu === "help" ? "active" : ""}
              onClick={() => setOpenDataMenu((current) => (current === "help" ? null : "help"))}
            >
              {t("Help", "帮助")}
            </button>
            {openDataMenu === "help" && (
              <div className="data-popover help-popover lift-card">
                <strong>{t("Operation Guide", "操作指南")}</strong>
                <p>{t("Use Quick Add Capture to save clipboard prompts into Inbox or a category.", "使用快速面板的收集模式，将剪贴板 Prompt 保存到临时收藏夹或分类。")}</p>
                <p>{t("Use Quick Add Insert to place a saved prompt in the active text field.", "使用调用模式，将已保存的 Prompt 插入当前输入框。")}</p>
                <p>{t("Organize Inbox items by editing their category, tags, and refined prompt.", "通过编辑分类、标签和 Prompt 来整理临时收藏夹。")}</p>
                <p>{t("Import and export full libraries or one selected category from Setting.", "在设置中导入或导出完整资料库或单个分类。")}</p>
              </div>
            )}
          </div>
        </nav>
        <input
          ref={fileInputRef}
          className="hidden-file-input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void importPrompts(event.target.files?.[0])}
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
    const text = getQuickPromptText(selectedPrompt);
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

function getQuickBrowsePrompts(prompts: PromptItem[], category: string) {
  if (category === QUICK_BROWSE_INBOX) return prompts.filter((prompt) => prompt.status === "inbox");
  return prompts.filter((prompt) => prompt.status !== "inbox" && prompt.category === category);
}

function getQuickPromptText(prompt: PromptItem) {
  return prompt.status === "inbox" ? prompt.originalPrompt : prompt.refinedPrompt || prompt.originalPrompt;
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
          tags: mergeUnique(apiResult.tags, customCategory ? [customCategory] : []),
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
                placeholder={t("Optional, for example gpt-5.4", "可选，例如 gpt-5.4")}
              />
            </label>
            <div className="settings-note">
              {t("Local Codex requires Codex to be installed and signed in on this computer. It uses your Codex/ChatGPT account quota.", "本地 Codex 需要这台电脑已安装并登录 Codex，并会使用你的 Codex/ChatGPT 账户额度。")}
            </div>
          </>
        )}

        {activeMode === "openai-compatible" && (
          <>
            <label>
              Base URL
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

function getImportCategory(input: unknown, fallback: PromptCategory): PromptCategory {
  if (isRecord(input) && typeof input.category === "string") {
    const normalizedCategory =
      input.category === "Portfolio" ? "Design" : input.category === "Codex" ? "Coding" : input.category;
    return normalizedCategory.trim() || fallback;
  }
  return fallback;
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
    tags: mergeUnique(analyzed.tags, prompt.tags),
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
        tags: mergeUnique(prompt.tags, previous.tags),
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
        <InfoItem label={t("Input Needed", "所需输入")} value={prompt.inputNeeded.join(", ")} />
        <InfoItem label={t("Platform", "平台")} value={prompt.platform} />
        <InfoItem label={t("Expected Output", "预期输出")} value={prompt.expectedOutput} />
      </section>

      <div className="detail-grid">
        <LiveRewritePreview segments={rewriteSegments} />
        <section className="detail-section lift-card featured custom-prompt-section">
          <div className="custom-prompt-heading">
            <h2>{t("Custom Prompt", "自定义 Prompt")}</h2>
            <div className="custom-prompt-actions">
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

function getPromptRewriteSegments(prompt: PromptItem) {
  const refinedPrompt = prompt.refinedPrompt || prompt.originalPrompt;
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
) {
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

function LiveRewritePreview({ segments }: { segments: RewriteSegment[] }) {
  const { t } = useLanguage();
  return (
    <section className="detail-section lift-card live-rewrite-section">
      <div className="live-rewrite-heading">
        <h2>{t("Original Prompt", "原始 Prompt")}</h2>
        <div className="rewrite-legend" aria-label="Rewrite color legend">
          <span><i className="legend-dot added" />{t("Added", "新增")}</span>
          <span><i className="legend-dot removed" />{t("Removed", "删除")}</span>
        </div>
      </div>
      <DiffText segments={segments} label="Original prompt with live custom changes" />
    </section>
  );
}

function DiffText({ segments, label }: { segments: RewriteSegment[]; label: string }) {
  return (
    <div className="diff-text live-rewrite-text" aria-label={label}>
      {segments.map((segment, index) => (
        <span className={segment.status === "same" ? undefined : `diff-token ${segment.status}`} key={`${label}-${index}`}>
          {segment.value}
        </span>
      ))}
    </div>
  );
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
