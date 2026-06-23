import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzePromptWithApi,
  defaultApiSettings,
  loadApiSettings,
  saveApiSettings,
  testApiConnection,
} from "./apiClient";
import { analyzePrompt, categories } from "./promptEngine";
import { loadPrompts, normalizeImportedPrompts, savePrompts } from "./storage";
import type { ApiSettings, PromptCategory, PromptItem } from "./types";

type View = "dashboard" | "add" | "library" | "detail" | "edit" | "settings";
type ImportMode = "all" | "category";

const tagTone = ["mint", "peach", "rose", "stone"];

export default function App() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [selectedId, setSelectedId] = useState(prompts[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<PromptCategory | "All">("All");
  const [dataCategory, setDataCategory] = useState<PromptCategory>("Design");
  const [openDataMenu, setOpenDataMenu] = useState<"export" | "import" | null>(null);
  const [apiSettings, setApiSettings] = useState<ApiSettings>(defaultApiSettings);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
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
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    void savePrompts(prompts);
  }, [prompts, storageReady]);

  useEffect(() => {
    let isMounted = true;
    void window.promptCabinetWindow?.getAlwaysOnTop().then((enabled) => {
      if (isMounted) setAlwaysOnTop(Boolean(enabled));
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedId) ?? prompts[0];
  const recentPrompts = useMemo(
    () =>
      [...prompts]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 4),
    [prompts],
  );

  const filteredPrompts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return prompts.filter((prompt) => {
      const matchesCategory = categoryFilter === "All" || prompt.category === categoryFilter;
      const haystack = [
        prompt.title,
        prompt.useCase,
        prompt.platform,
        prompt.tags.join(" "),
        prompt.originalPrompt,
      ]
        .join(" ")
        .toLowerCase();
      return matchesCategory && (!needle || haystack.includes(needle));
    });
  }, [categoryFilter, prompts, query]);
  const categoryPromptCount = prompts.filter((prompt) => prompt.category === dataCategory).length;

  function addPrompt(prompt: PromptItem) {
    setPrompts((current) => [prompt, ...current]);
    setSelectedId(prompt.id);
    setView("detail");
  }

  function updatePrompt(updatedPrompt: PromptItem) {
    setPrompts((current) =>
      current.map((prompt) => (prompt.id === updatedPrompt.id ? updatedPrompt : prompt)),
    );
    setSelectedId(updatedPrompt.id);
    setView("detail");
  }

  function deletePrompt(id: string) {
    const prompt = prompts.find((item) => item.id === id);
    if (!prompt || !window.confirm(`Delete "${prompt.title}" from Prompt Cabinet?`)) return;
    const remaining = prompts.filter((item) => item.id !== id);
    setPrompts(remaining);
    setSelectedId(remaining[0]?.id ?? "");
    setView("library");
  }

  function openDetail(id: string) {
    setSelectedId(id);
    setView("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportPrompts(mode: "all" | "category") {
    const exportedPrompts =
      mode === "category" ? prompts.filter((prompt) => prompt.category === dataCategory) : prompts;
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
        window.alert("No valid prompts found in this JSON file.");
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
        window.alert(`Imported ${categoryPrompts.length} prompts into ${targetCategory}. Added ${added}, updated ${updated}.`);
        return;
      }

      const { prompts: mergedPrompts, added, updated } = mergeImportedPrompts(prompts, importedPrompts);
      setPrompts(mergedPrompts);
      setSelectedId(importedPrompts[0]?.id ?? mergedPrompts[0]?.id ?? "");
      setCategoryFilter("All");
      setView("library");
      window.alert(`Imported ${importedPrompts.length} prompts. Added ${added}, updated ${updated}.`);
    } catch {
      window.alert("Could not import this JSON file. Please check the file format.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function toggleAlwaysOnTop() {
    const nextValue = !alwaysOnTop;
    setAlwaysOnTop(nextValue);
    try {
      const savedValue = await window.promptCabinetWindow?.setAlwaysOnTop(nextValue);
      setAlwaysOnTop(Boolean(savedValue));
    } catch {
      setAlwaysOnTop(!nextValue);
      window.alert("Could not change window pin state in this environment.");
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={() => setView("dashboard")}>
          <span className="brand-mark">PC</span>
          <span>Prompt Cabinet</span>
        </button>
        <nav className="nav-pills" aria-label="Primary navigation">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            Home
          </button>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>
            Library
          </button>
          <button className={view === "add" || view === "edit" ? "active" : ""} onClick={() => setView("add")}>
            New Prompt
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            Settings
          </button>
        </nav>
        <div className="data-actions">
          {window.promptCabinetWindow && (
            <button
              className={alwaysOnTop ? "ghost-button active" : "ghost-button"}
              onClick={() => void toggleAlwaysOnTop()}
              title="Keep Prompt Cabinet above other windows"
            >
              Pin Top
            </button>
          )}
          <div className="data-menu">
            <button
              className="ghost-button"
              onClick={() => setOpenDataMenu((current) => (current === "export" ? null : "export"))}
            >
              Export
            </button>
            {openDataMenu === "export" && (
              <div className="data-popover lift-card">
                <button
                  className="popover-action"
                  onClick={() => {
                    exportPrompts("all");
                    setOpenDataMenu(null);
                  }}
                  disabled={!prompts.length}
                >
                  Export all prompts
                </button>
                <label>
                  Category
                  <select
                    value={dataCategory}
                    onChange={(event) => setDataCategory(event.target.value as PromptCategory)}
                  >
                    {categories.map((category) => (
                      <option value={category} key={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="popover-action"
                  onClick={() => {
                    exportPrompts("category");
                    setOpenDataMenu(null);
                  }}
                  disabled={!categoryPromptCount}
                >
                  Export selected category
                </button>
              </div>
            )}
          </div>
          <div className="data-menu">
            <button
              className="ghost-button"
              onClick={() => setOpenDataMenu((current) => (current === "import" ? null : "import"))}
            >
              Import
            </button>
            {openDataMenu === "import" && (
              <div className="data-popover lift-card">
                <button
                  className="popover-action"
                  onClick={() => {
                    chooseImportFile("all");
                    setOpenDataMenu(null);
                  }}
                >
                  Import full library
                </button>
                <label>
                  Category
                  <select
                    value={dataCategory}
                    onChange={(event) => setDataCategory(event.target.value as PromptCategory)}
                  >
                    {categories.map((category) => (
                      <option value={category} key={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="popover-action"
                  onClick={() => {
                    chooseImportFile("category");
                    setOpenDataMenu(null);
                  }}
                >
                  Import into category
                </button>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importPrompts(event.target.files?.[0])}
          />
        </div>
      </header>

      <main className={`page page-${view}`}>
        {view === "dashboard" && (
          <Dashboard
            recentPrompts={recentPrompts}
            onNew={() => setView("add")}
            onLibrary={(category) => {
              setCategoryFilter(category);
              setView("library");
            }}
            onDetail={openDetail}
          />
        )}
        {view === "add" && <PromptForm mode="add" onSave={addPrompt} apiSettings={apiSettings} />}
        {view === "library" && (
          <Library
            prompts={filteredPrompts}
            query={query}
            categoryFilter={categoryFilter}
            onQuery={setQuery}
            onCategory={setCategoryFilter}
            onDetail={openDetail}
            onEdit={(id) => {
              setSelectedId(id);
              setView("edit");
            }}
            onDelete={deletePrompt}
            totalPrompts={prompts.length}
            onNew={() => setView("add")}
          />
        )}
        {view === "detail" && selectedPrompt && (
          <PromptDetail
            prompt={selectedPrompt}
            onEdit={() => setView("edit")}
            onDelete={() => deletePrompt(selectedPrompt.id)}
          />
        )}
        {view === "edit" && selectedPrompt && (
          <PromptForm mode="edit" initialPrompt={selectedPrompt} onSave={updatePrompt} apiSettings={apiSettings} />
        )}
        {view === "settings" && (
          <ApiSettingsPage
            settings={apiSettings}
            onSave={async (settings) => {
              const saved = await saveApiSettings(settings);
              setApiSettings(saved);
            }}
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({
  recentPrompts,
  onNew,
  onLibrary,
  onDetail,
}: {
  recentPrompts: PromptItem[];
  onNew: () => void;
  onLibrary: (category: PromptCategory) => void;
  onDetail: (id: string) => void;
}) {
  return (
    <>
      <section className="hero-panel">
        <div>
          <p className="eyebrow">AI workbench for reusable prompt knowledge</p>
          <h1>Prompt Cabinet</h1>
          <p className="subtitle">Collect, refine, and reuse your best prompts.</p>
        </div>
        <button className="pressable hero-action" onClick={onNew}>
          New Prompt
        </button>
      </section>

      <section className="section-band">
        <div className="section-heading">
          <h2>Recent Prompts</h2>
          <span>{recentPrompts.length} saved</span>
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
          <h2>Cabinet Categories</h2>
          <span>Browse by workflow</span>
        </div>
        <div className="category-grid">
          {categories.map((category, index) => (
            <button className="category-tile lift-card" key={category} onClick={() => onLibrary(category)}>
              <span className={`dot ${tagTone[index % tagTone.length]}`} />
              <strong>{category}</strong>
              <small>{categoryCopy[category]}</small>
            </button>
          ))}
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
}: {
  mode: "add" | "edit";
  initialPrompt?: PromptItem;
  onSave: (prompt: PromptItem) => void;
  apiSettings: ApiSettings;
}) {
  const [draft, setDraft] = useState<PromptItem>(
    initialPrompt ?? {
      id: "",
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
  const [tagInput, setTagInput] = useState((initialPrompt?.tags ?? []).join(", "));
  const [inputNeededText, setInputNeededText] = useState((initialPrompt?.inputNeeded ?? []).join(", "));
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const hasPrompt = draft.originalPrompt.trim().length > 0;

  async function handleAnalyze() {
    if (!hasPrompt) return;
    setIsAnalyzing(true);
    let analyzed = analyzePrompt(draft.originalPrompt, draft.notes, {
      tags: parseTags(tagInput),
    });
    if (apiSettings.enabled && apiSettings.provider !== "mock") {
      try {
        const apiResult = await analyzePromptWithApi(draft.originalPrompt, draft.notes, apiSettings);
        analyzed = {
          ...analyzed,
          title: apiResult.title,
          category: apiResult.category,
          refinedPrompt: apiResult.refinedPrompt,
          useCase: apiResult.useCase,
          inputNeeded: apiResult.inputNeeded,
          expectedOutput: apiResult.expectedOutput,
          tags: apiResult.tags,
          platform: apiResult.platform,
        };
      } catch (error) {
        window.alert(
          `${getAnalyzeModeLabel(apiSettings)} failed, so Prompt Cabinet used mock analysis instead.\n\n${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }
    setDraft((current) => ({
      ...analyzed,
      id: current.id,
      createdAt: current.createdAt,
      tags: analyzed.tags,
    }));
    setTagInput(analyzed.tags.join(", "));
    setInputNeededText(analyzed.inputNeeded.join(", "));
    setIsAnalyzing(false);
  }

  function handleSave() {
    if (!hasPrompt) return;
    const analyzedFallback = draft.refinedPrompt ? draft : analyzePrompt(draft.originalPrompt, draft.notes, {
      category: draft.category,
      tags: parseTags(tagInput),
    });
    const savedTags = parseTags(tagInput);
    const savedInputs = parseTags(inputNeededText);
    onSave({
      ...analyzedFallback,
      id: draft.id || crypto.randomUUID(),
      title: draft.title.trim() || analyzedFallback.title || "Untitled Prompt",
      originalPrompt: draft.originalPrompt.trim(),
      refinedPrompt: (draft.refinedPrompt || analyzedFallback.refinedPrompt).trim(),
      useCase: (draft.useCase || analyzedFallback.useCase).trim(),
      inputNeeded: savedInputs.length ? savedInputs : analyzedFallback.inputNeeded,
      expectedOutput: (draft.expectedOutput || analyzedFallback.expectedOutput).trim(),
      tags: savedTags.length ? savedTags : analyzedFallback.tags,
      platform: draft.platform.trim() || "ChatGPT",
      notes: draft.notes.trim() || "No source note added yet.",
      category: draft.category,
      createdAt: draft.createdAt || new Date().toISOString(),
    });
  }

  return (
    <section className="add-layout">
      <div className="input-panel neumorph-inset">
        <p className="eyebrow">{mode === "add" ? "Capture" : "Edit"}</p>
        <h1>{mode === "add" ? "Add Prompt" : "Edit Prompt"}</h1>
        <label>
          Raw Prompt
          <textarea
            value={draft.originalPrompt}
            onChange={(event) => setDraft({ ...draft, originalPrompt: event.target.value })}
            placeholder="Paste a useful work prompt here..."
          />
        </label>
        <div className="form-row">
          <label>
            Category
            <select
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value as PromptCategory })}
            >
              {categories.map((category) => (
                <option value={category} key={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tags
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder="research, portfolio, reusable"
            />
          </label>
        </div>
        <label>
          Notes
          <input
            value={draft.notes === "No source note added yet." ? "" : draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            placeholder="Where did it come from? What is it good for?"
          />
        </label>
        <div className="form-actions">
          <button className="pressable" onClick={() => void handleAnalyze()} disabled={!hasPrompt || isAnalyzing}>
            {isAnalyzing ? "Analyzing..." : getAnalyzeButtonLabel(apiSettings)}
          </button>
          <button className="pressable" onClick={handleSave} disabled={!hasPrompt}>
            {mode === "add" ? "Save Prompt" : "Save Changes"}
          </button>
        </div>
      </div>

      <aside className="analysis-panel lift-card">
        <p className="eyebrow">{getAnalysisResultLabel(apiSettings)}</p>
        {draft.refinedPrompt ? (
          <>
            <label>
              Prompt Title
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label>
              Custom Prompt
              <textarea
                className="compact-textarea"
                value={draft.refinedPrompt}
                onChange={(event) => setDraft({ ...draft, refinedPrompt: event.target.value })}
              />
            </label>
            <label>
              Use Case
              <input
                value={draft.useCase}
                onChange={(event) => setDraft({ ...draft, useCase: event.target.value })}
              />
            </label>
            <label>
              Input Needed
              <input value={inputNeededText} onChange={(event) => setInputNeededText(event.target.value)} />
            </label>
            <dl className="mini-details">
              <div>
                <dt>Platform</dt>
                <dd>
                  <input
                    value={draft.platform}
                    onChange={(event) => setDraft({ ...draft, platform: event.target.value })}
                  />
                </dd>
              </div>
              <div>
                <dt>Expected Output</dt>
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
            <h2>Ready to refine</h2>
            <p>Click Analyze Prompt to generate local mock structure. No external API is called.</p>
          </div>
        )}
      </aside>
    </section>
  );
}

function Library({
  prompts,
  query,
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
  categoryFilter: PromptCategory | "All";
  onQuery: (query: string) => void;
  onCategory: (category: PromptCategory | "All") => void;
  onDetail: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  totalPrompts: number;
  onNew: () => void;
}) {
  return (
    <section className="library-page">
      <div className="section-heading library-heading">
        <div>
          <p className="eyebrow">Reuse</p>
          <h1>Prompt Library</h1>
        </div>
        <span>{prompts.length} results</span>
      </div>
      {totalPrompts ? (
        <>
          <div className="toolbar neumorph-inset">
            <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search prompts..." />
            <select value={categoryFilter} onChange={(event) => onCategory(event.target.value as PromptCategory | "All")}>
              <option value="All">All Categories</option>
              {categories.map((category) => (
                <option value={category} key={category}>
                  {category}
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
            <div className="search-empty lift-card">No prompts match your current search.</div>
          )}
        </>
      ) : (
        <EmptyPromptState onNew={onNew} />
      )}
    </section>
  );
}

function EmptyPromptState({ onNew }: { onNew: () => void }) {
  return (
    <div className="prompt-empty-state lift-card">
      <span className="empty-mark" />
      <h2>You haven’t saved any prompts yet.</h2>
      <button className="pressable" onClick={onNew}>
        New Prompt
      </button>
    </div>
  );
}

function ApiSettingsPage({
  settings,
  onSave,
}: {
  settings: ApiSettings;
  onSave: (settings: ApiSettings) => Promise<void>;
}) {
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
    setStatus("Settings saved locally.");
    setIsSaving(false);
  }

  async function handleTest() {
    setIsTesting(true);
    const result = await testApiConnection(draft);
    setStatus(result.ok ? `Connected: ${result.message}` : `Connection failed: ${result.message}`);
    setIsTesting(false);
  }

  return (
    <section className="settings-panel lift-card">
      <div>
        <p className="eyebrow">Local Analyze Settings</p>
        <h1>Analyze Settings</h1>
        <p className="settings-copy">
          Choose how Prompt Cabinet analyzes prompts. Mock Rules works offline, Local Codex uses your signed-in Codex on
          this computer, and OpenAI-Compatible API uses your own provider key.
        </p>
      </div>

      <div className="settings-grid">
        <label className="settings-wide">
          Analyze Mode
          <select value={activeMode} onChange={(event) => updateMode(event.target.value as ApiSettings["provider"])}>
            <option value="mock">Mock Rules</option>
            <option value="codex-local">Local Codex</option>
            <option value="openai-compatible">OpenAI-Compatible API</option>
          </select>
        </label>

        {activeMode === "codex-local" && (
          <>
            <label>
              Codex Model
              <input
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                placeholder="Optional, for example gpt-5.4"
              />
            </label>
            <div className="settings-note">
              Local Codex requires Codex to be installed and signed in on this computer. It does not need an API key in
              Prompt Cabinet, but it can use your Codex/ChatGPT account quota.
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
              Model
              <input
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                placeholder="Enter your provider model"
              />
            </label>
            <label className="settings-wide">
              API Key
              <input
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                placeholder="Stored locally on this computer"
              />
            </label>
          </>
        )}

        {activeMode === "mock" && (
          <div className="settings-note">
            Mock Rules is fully local and does not call any external service. It is fast and free, but less semantic than
            Codex or API analysis.
          </div>
        )}
      </div>

      {!desktopApiAvailable && activeMode !== "mock" && (
        <div className="settings-note">
          Enhanced Analyze is available in the Electron desktop app. Browser mode can save settings, but Analyze will
          use mock logic.
        </div>
      )}

      <div className="form-actions">
        <button className="pressable" onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Settings"}
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
          {isTesting ? "Testing..." : activeMode === "codex-local" ? "Test Codex" : "Test Connection"}
        </button>
      </div>

      {status && <div className="settings-status">{status}</div>}
    </section>
  );
}

function getImportCategory(input: unknown, fallback: PromptCategory): PromptCategory {
  if (isRecord(input) && typeof input.category === "string") {
    const normalizedCategory =
      input.category === "Portfolio" ? "Design" : input.category === "Codex" ? "Coding" : input.category;
    if (categories.includes(normalizedCategory as PromptCategory)) return normalizedCategory as PromptCategory;
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
    const matchIndex = merged.findIndex((existing) => promptsMatch(existing, prompt));
    if (matchIndex >= 0) {
      const previous = merged[matchIndex];
      merged[matchIndex] = {
        ...previous,
        ...prompt,
        id: previous.id || prompt.id,
        createdAt: previous.createdAt || prompt.createdAt,
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

function promptsMatch(a: PromptItem, b: PromptItem) {
  const aFingerprint = getPromptFingerprint(a);
  const bFingerprint = getPromptFingerprint(b);
  return Boolean(a.id && b.id && a.id === b.id) || Boolean(aFingerprint && aFingerprint === bFingerprint);
}

function getPromptFingerprint(prompt: PromptItem) {
  return prompt.originalPrompt.trim().replace(/\s+/g, " ").toLowerCase();
}

function mergeUnique(primary: string[], secondary: string[]) {
  return Array.from(new Set([...primary, ...secondary].map((tag) => tag.trim()).filter(Boolean))).slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function PromptDetail({
  prompt,
  onEdit,
  onDelete,
}: {
  prompt: PromptItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [customPrompt, setCustomPrompt] = useState(prompt.originalPrompt);

  useEffect(() => {
    setCustomPrompt(prompt.originalPrompt);
  }, [prompt.id, prompt.originalPrompt]);

  return (
    <article className="detail-panel">
      <div className="detail-header lift-card">
        <div>
          <p className="eyebrow">{prompt.category}</p>
          <h1>{prompt.title}</h1>
          <p>{prompt.useCase}</p>
        </div>
        <div className="detail-actions">
          <CopyButton text={customPrompt} />
          <button className="ghost-button" onClick={onEdit}>
            Edit
          </button>
          <button className="ghost-button danger-button" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <section className="prompt-info-panel lift-card">
        <InfoItem label="Use Case" value={prompt.useCase} />
        <InfoItem label="Input Needed" value={prompt.inputNeeded.join(", ")} />
        <InfoItem label="Platform" value={prompt.platform} />
        <InfoItem label="Expected Output" value={prompt.expectedOutput} />
      </section>

      <div className="detail-grid">
        <DetailSection title="Original Prompt" body={prompt.originalPrompt} />
        <section className="detail-section lift-card featured custom-prompt-section">
          <h2>Custom Prompt</h2>
          <textarea
            className="custom-prompt-editor"
            value={customPrompt}
            onChange={(event) => setCustomPrompt(event.target.value)}
            aria-label="Custom prompt to copy"
          />
        </section>
        <section className="detail-section lift-card">
          <h2>Tags</h2>
          <TagList tags={prompt.tags} />
        </section>
        <DetailSection title="Notes" body={prompt.notes} />
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
  return (
    <article className="prompt-card lift-card">
      <div>
        <p className="eyebrow">{prompt.platform}</p>
        <h3>{prompt.title}</h3>
        <p>{compact ? prompt.expectedOutput : prompt.useCase}</p>
      </div>
      <TagList tags={prompt.tags.slice(0, compact ? 3 : 4)} />
      <div className="card-actions">
        <button className="ghost-button" onClick={() => onDetail(prompt.id)}>
          View
        </button>
        <CopyButton text={prompt.refinedPrompt} small />
        {onEdit && (
          <button className="ghost-button" onClick={() => onEdit(prompt.id)}>
            Edit
          </button>
        )}
        {onDelete && (
          <button className="ghost-button danger-button" onClick={() => onDelete(prompt.id)}>
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getAnalyzeButtonLabel(settings: ApiSettings) {
  if (!settings.enabled || settings.provider === "mock") return "Analyze Prompt";
  if (settings.provider === "codex-local") return "Analyze with Codex";
  return "Analyze with API";
}

function getAnalysisResultLabel(settings: ApiSettings) {
  if (!settings.enabled || settings.provider === "mock") return "Mock Analysis Result";
  if (settings.provider === "codex-local") return "Codex Analysis Result";
  return "API Analysis Result";
}

function getAnalyzeModeLabel(settings: ApiSettings) {
  if (settings.provider === "codex-local") return "Local Codex Analyze";
  if (settings.provider === "openai-compatible") return "API Analyze";
  return "Mock Analyze";
}

function DetailSection({ title, body, featured = false }: { title: string; body: string; featured?: boolean }) {
  return (
    <section className={`detail-section lift-card ${featured ? "featured" : ""}`}>
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}

function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="tags">
      {tags.map((tag, index) => (
        <span className={`tag ${tagTone[index % tagTone.length]}`} key={tag}>
          {tag}
        </span>
      ))}
    </div>
  );
}

function CopyButton({ text, small = false }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  }

  return (
    <button className={small ? "ghost-button copy-small" : "pressable"} onClick={handleCopy}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const categoryCopy: Record<PromptCategory, string> = {
  Design: "UI/UX, visual, portfolio, critique",
  Writing: "Drafts, edits, and tone control",
  Research: "Summaries, comparisons, and insights",
  Coding: "Code, repos, debug, implementation",
  Image: "Visual prompts and art direction",
  Video: "Scenes, scripts, and storyboards",
  Career: "Applications and interviews",
  Product: "Briefs, specs, and decisions",
};
