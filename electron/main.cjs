const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard, globalShortcut, net, screen, shell, systemPreferences } = require("electron");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const dataFileName = "prompt-cabinet-data.json";
const settingsFileName = "prompt-cabinet-settings.json";
const windowSettingsFileName = "prompt-cabinet-window.json";
const appBundleId = "com.promptcabinet.app";
const updateRepository = "jingyibi93/prompt-cabinet";
const updateReleasePrefix = `https://github.com/${updateRepository}/releases/`;
const validCategories = ["Design", "Writing", "Research", "Coding", "Image", "Video", "Career", "Product"];
const defaultQuickShortcutSettings = Object.freeze({
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
});
if (!app.isPackaged) app.setName("Prompt Cabinet Dev");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow;
let mainWindowNormalBounds;
let mainWindowPinInterval;
let mainWindowPinEnabled = false;
let quickAddWindow;
let quickPreviewWindow;
let quickPreviewImage = "";
let mainWindowHiddenForQuickAdd = false;
let quickAddFloatInterval;
let quickShortcutSettings = { ...defaultQuickShortcutSettings };
let registeredOpenQuickAddShortcut = "";
let quickAddMode = "capture";
const quickAddCompactHeight = 58;
const quickPreviewWidth = 190;
const quickPreviewHeight = 102;

if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", () => {
  showMainWindow();
});

const analyzeOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "category",
    "tags",
    "platform",
    "useCase",
    "inputNeeded",
    "expectedOutput",
    "refinedPrompt",
  ],
  properties: {
    title: { type: "string" },
    category: { type: "string", enum: validCategories },
    tags: { type: "array", items: { type: "string" } },
    platform: { type: "string" },
    useCase: { type: "string" },
    inputNeeded: { type: "array", items: { type: "string" } },
    expectedOutput: { type: "string" },
    refinedPrompt: { type: "string" },
  },
};
const connectionOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "message"],
  properties: {
    ok: { type: "boolean" },
    message: { type: "string" },
  },
};
const imageMatchOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["imageId", "promptId", "confidence"],
        properties: {
          imageId: { type: "string" },
          promptId: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
};

function buildPromptClassificationOutputSchema(categories) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["classifications"],
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "title", "category", "tags", "inputNeeded"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            category: { type: "string", enum: categories },
            tags: { type: "array", items: { type: "string" } },
            inputNeeded: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  };
}

function getDataFilePath() {
  return path.join(app.getPath("userData"), dataFileName);
}

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), settingsFileName);
}

function getWindowSettingsFilePath() {
  return path.join(app.getPath("userData"), windowSettingsFileName);
}

async function readPromptData() {
  try {
    const raw = await fs.readFile(getDataFilePath(), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return { prompts: [] };
    throw error;
  }
}

async function writePromptData(prompts, sourceWebContentsId) {
  const payload = {
    app: "Prompt Cabinet",
    version: 1,
    savedAt: new Date().toISOString(),
    prompts: Array.isArray(prompts) ? prompts : [],
  };
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(getDataFilePath(), JSON.stringify(payload, null, 2), "utf8");
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed() && window.webContents.id !== sourceWebContentsId) {
      window.webContents.send("prompt-cabinet:prompts-changed");
    }
  });
  return payload;
}

async function readApiSettings() {
  try {
    const raw = await fs.readFile(getSettingsFilePath(), "utf8");
    return normalizeApiSettings(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === "ENOENT") return normalizeApiSettings({});
    throw error;
  }
}

async function writeApiSettings(settings) {
  const normalized = normalizeApiSettings(settings);
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(getSettingsFilePath(), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

async function readWindowSettings() {
  try {
    const raw = await fs.readFile(getWindowSettingsFilePath(), "utf8");
    return normalizeWindowSettings(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === "ENOENT") return normalizeWindowSettings({});
    throw error;
  }
}

async function writeWindowSettings(settings) {
  const normalized = normalizeWindowSettings(settings);
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(getWindowSettingsFilePath(), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function normalizeWindowSettings(settings) {
  const bounds = settings?.normalBounds;
  const normalBounds = bounds
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    ? {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(980, Math.round(bounds.width)),
        height: Math.max(680, Math.round(bounds.height)),
      }
    : undefined;
  return {
    alwaysOnTop: Boolean(settings?.alwaysOnTop),
    normalBounds,
    shortcuts: normalizeQuickShortcutSettings(settings?.shortcuts),
  };
}

function getPinnedSideBounds(window) {
  const display = screen.getDisplayMatching(window.getBounds());
  const { x, y, width, height } = display.workArea;
  const sideWidth = Math.min(480, Math.max(420, Math.round(width * 0.32)));
  const edgeGap = 12;
  return {
    x: x + width - sideWidth - edgeGap,
    y: y + edgeGap,
    width: sideWidth,
    height: Math.max(560, height - edgeGap * 2),
  };
}

function keepMainWindowPinned(window) {
  if (!window || window.isDestroyed()) return;
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
  }
  window.setAlwaysOnTop(true, "screen-saver", 1);
  if (window.isVisible()) window.moveTop();
}

function startMainWindowPinGuard(window) {
  stopMainWindowPinGuard();
  keepMainWindowPinned(window);
  mainWindowPinInterval = setInterval(() => {
    if (!window || window.isDestroyed()) {
      stopMainWindowPinGuard();
      return;
    }
    keepMainWindowPinned(window);
  }, 750);
}

function stopMainWindowPinGuard() {
  if (!mainWindowPinInterval) return;
  clearInterval(mainWindowPinInterval);
  mainWindowPinInterval = undefined;
}

function applyMainWindowPinMode(window, enabled, normalBounds) {
  if (!window || window.isDestroyed()) return;
  mainWindowPinEnabled = enabled;
  if (enabled) {
    window.setMinimumSize(420, 560);
    window.setBounds(getPinnedSideBounds(window), true);
    startMainWindowPinGuard(window);
    return;
  }
  stopMainWindowPinGuard();
  window.setAlwaysOnTop(false);
  if (process.platform === "darwin") window.setVisibleOnAllWorkspaces(false);
  window.setMinimumSize(980, 680);
  if (normalBounds) window.setBounds(normalBounds, true);
}

function normalizeQuickShortcutSettings(shortcuts) {
  const normalized = Object.fromEntries(
    Object.entries(defaultQuickShortcutSettings).map(([key, fallback]) => [
      key,
      typeof shortcuts?.[key] === "string" && shortcuts[key].trim() ? shortcuts[key].trim() : fallback,
    ]),
  );
  const legacyNavigationShortcuts = {
    previousCategory: "Alt+Left",
    nextCategory: "Alt+Right",
    previousPrompt: "Alt+Up",
    nextPrompt: "Alt+Down",
  };
  Object.entries(legacyNavigationShortcuts).forEach(([key, legacyShortcut]) => {
    if (normalized[key] === legacyShortcut) normalized[key] = defaultQuickShortcutSettings[key];
  });
  if (normalized.runAction === "CommandOrControl+V") normalized.runAction = defaultQuickShortcutSettings.runAction;
  if (normalized.insertSelected === "Enter") normalized.insertSelected = defaultQuickShortcutSettings.insertSelected;
  return normalized;
}

function normalizeApiSettings(settings) {
  const provider = getProvider(settings);
  return {
    enabled: provider !== "mock" && Boolean(settings?.enabled ?? true),
    provider,
    baseUrl: typeof settings?.baseUrl === "string" && settings.baseUrl.trim()
      ? settings.baseUrl.trim()
      : "https://api.openai.com/v1",
    apiKey: typeof settings?.apiKey === "string" ? settings.apiKey.trim() : "",
    model: typeof settings?.model === "string" ? settings.model.trim() : "",
  };
}

function getProvider(settings) {
  if (settings?.provider === "mock" || settings?.provider === "openai-compatible" || settings?.provider === "codex-local") {
    return settings.provider;
  }
  return settings?.enabled ? "openai-compatible" : "mock";
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  try {
    const response = await net.fetch(`https://api.github.com/repos/${updateRepository}/releases?per_page=30`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Prompt-Cabinet",
      },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
    const payload = await response.json();
    const releases = Array.isArray(payload) ? payload : [];
    const candidates = releases
      .filter((release) => !release?.draft && typeof release?.tag_name === "string" && typeof release?.html_url === "string")
      .map((release) => ({
        version: normalizeReleaseVersion(release.tag_name),
        name: typeof release.name === "string" && release.name.trim() ? release.name.trim() : release.tag_name,
        url: release.html_url,
        publishedAt: typeof release.published_at === "string" ? release.published_at : "",
      }))
      .filter((release) => Boolean(release.version));
    const latest = candidates.sort((left, right) => compareVersions(right.version, left.version))[0];
    if (!latest) throw new Error("No downloadable releases were found.");
    const updateAvailable = compareVersions(latest.version, currentVersion) > 0;
    return {
      status: updateAvailable ? "update-available" : "up-to-date",
      currentVersion,
      latestVersion: latest.version,
      releaseName: latest.name,
      releaseUrl: latest.url,
      publishedAt: latest.publishedAt,
    };
  } catch (error) {
    return {
      status: "unavailable",
      currentVersion,
      message: error instanceof Error ? error.message : "Unable to check for updates.",
    };
  }
}

function normalizeReleaseVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function compareVersions(left, right) {
  const parse = (value) => {
    const match = normalizeReleaseVersion(value).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match) return undefined;
    return { core: match.slice(1, 4).map(Number), prerelease: match[4] ?? "" };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease || !b.prerelease) return a.prerelease === b.prerelease ? 0 : a.prerelease ? -1 : 1;
  const aParts = a.prerelease.split(".");
  const bParts = b.prerelease.split(".");
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const aPart = aParts[index] ?? "";
    const bPart = bParts[index] ?? "";
    if (aPart === bPart) continue;
    const aNumber = /^\d+$/.test(aPart);
    const bNumber = /^\d+$/.test(bPart);
    if (aNumber && bNumber) return Number(aPart) > Number(bPart) ? 1 : -1;
    if (aNumber !== bNumber) return aNumber ? -1 : 1;
    return aPart.localeCompare(bPart);
  }
  return 0;
}

async function openUpdateDownload(_event, releaseUrl) {
  if (typeof releaseUrl !== "string" || !releaseUrl.startsWith(updateReleasePrefix)) return false;
  await shell.openExternal(releaseUrl);
  return true;
}

function buildChatCompletionsUrls(baseUrl) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  if (cleanBase.endsWith("/chat/completions")) return [cleanBase];

  const directUrl = `${cleanBase}/chat/completions`;
  try {
    const parsed = new URL(cleanBase);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      return [directUrl, `${cleanBase}/v1/chat/completions`];
    }
  } catch {
    // Keep the direct request so the provider returns a useful URL error.
  }
  return [directUrl];
}

async function callChatCompletions(settings, messages, temperature = 0.2) {
  const normalized = normalizeApiSettings(settings);
  if (!normalized.apiKey) throw new Error("Missing API key.");
  if (!normalized.model) throw new Error("Missing model.");

  const requestBody = JSON.stringify({
    model: normalized.model,
    messages,
    temperature,
    response_format: { type: "json_object" },
  });
  let response;
  let text = "";
  try {
    // Electron's network stack follows the operating system proxy settings.
    for (const endpoint of buildChatCompletionsUrls(normalized.baseUrl)) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await net.fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${normalized.apiKey}`,
          },
          body: requestBody,
        });
        text = await response.text();
        if (!isTransientApiStatus(response.status) || attempt === 2) break;
        await wait(650 * (attempt + 1));
      }
      if (response.status !== 404 && response.status !== 405) break;
    }
  } catch (error) {
    const cause = error?.cause;
    const detail = cause?.code || cause?.message || error?.message || "Unknown network error";
    throw new Error(`Could not reach the API endpoint using the system network settings: ${detail}`);
  }

  if (!response?.ok) {
    throw new Error(`API request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("API response did not include message content.");
  return JSON.parse(content);
}

function isTransientApiStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

async function testApiConnection(_event, settings) {
  const normalized = normalizeApiSettings(settings);
  if (!normalized.enabled || normalized.provider === "mock") {
    return { ok: true, message: "Mock Rules is active." };
  }

  try {
    const result = normalized.provider === "codex-local"
      ? await callLocalCodex(
          normalized,
          'Return only this JSON: {"ok":true,"message":"Local Codex connected"}',
          connectionOutputSchema,
        )
      : await callChatCompletions(
          normalized,
          [
            {
              role: "system",
              content: "Return JSON only.",
            },
            {
              role: "user",
              content: 'Return {"ok":true,"message":"connected"}',
            },
          ],
          0,
        );
    return {
      ok: Boolean(result.ok),
      message: result.message || "Connected.",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Connection failed.",
    };
  }
}

async function analyzePromptWithApi(_event, payload) {
  const rawPrompt = typeof payload?.rawPrompt === "string" ? payload.rawPrompt : "";
  const notes = typeof payload?.notes === "string" ? payload.notes : "";
  const outputLanguage = payload?.outputLanguage === "zh" || payload?.outputLanguage === "en"
    ? payload.outputLanguage
    : "auto";
  const settings = normalizeApiSettings(payload?.settings);
  if (!settings.enabled || settings.provider === "mock") {
    throw new Error("Enhanced Analyze is disabled.");
  }

  const instruction = buildAnalyzeInstruction(rawPrompt, notes, outputLanguage);
  const result = settings.provider === "codex-local"
    ? await callLocalCodex(settings, instruction, analyzeOutputSchema)
    : await callChatCompletions(
        settings,
        [
          { role: "system", content: buildAnalyzeSystemPrompt(outputLanguage) },
          {
            role: "user",
            content: `Raw Prompt:\n${rawPrompt}\n\nNotes:\n${notes || "Not provided."}`,
          },
        ],
        0.2,
      );

  return normalizeAnalyzeResult(result, rawPrompt, outputLanguage);
}

async function matchImagesWithApi(_event, payload) {
  const settings = normalizeApiSettings(payload?.settings);
  if (!settings.enabled || settings.provider === "mock") {
    throw new Error("Configure Local Codex or a vision-capable API before matching images.");
  }

  const images = Array.isArray(payload?.images)
    ? payload.images
        .filter((image) => typeof image?.id === "string" && typeof image?.dataUrl === "string" && image.dataUrl.startsWith("data:image/"))
        .slice(0, 12)
    : [];
  const prompts = Array.isArray(payload?.prompts)
    ? payload.prompts
        .filter((prompt) => typeof prompt?.id === "string" && typeof prompt?.originalPrompt === "string")
        .slice(0, 36)
    : [];
  if (!images.length || !prompts.length) return { matches: [] };

  const matchingInstruction = [
    "Candidate prompts. Match each image to at most one prompt and only when the image is clearly a reference or intended result for that prompt.",
    "Do not guess from a random filename. Use the visual content and prompt semantics.",
    "Return JSON only in this shape: {\"matches\":[{\"imageId\":\"...\",\"promptId\":\"...\",\"confidence\":0.0}]}",
    "Use confidence from 0 to 1. Include only matches with confidence at least 0.55.",
    "",
    ...prompts.map((prompt) => `PROMPT ${prompt.id}\nTitle: ${String(prompt.title || "Untitled").slice(0, 160)}\nText: ${prompt.originalPrompt.slice(0, 900)}`),
  ].join("\n\n");

  if (settings.provider === "codex-local") {
    const result = await matchImagesWithLocalCodex(settings, matchingInstruction, images);
    return normalizeImageMatches(result, images, prompts);
  }

  const content = [
    {
      type: "text",
      text: matchingInstruction,
    },
    ...images.flatMap((image) => [
      { type: "text", text: `IMAGE ${image.id}\nFilename: ${String(image.name || "Untitled image").slice(0, 160)}` },
      { type: "image_url", image_url: { url: image.dataUrl, detail: "low" } },
    ]),
  ];
  const result = await callChatCompletions(
    settings,
    [
      {
        role: "system",
        content: "You are a precise visual librarian. Return valid JSON only, with no explanation.",
      },
      { role: "user", content },
    ],
    0,
  );
  return normalizeImageMatches(result, images, prompts);
}

async function matchImagesWithLocalCodex(settings, instruction, images) {
  const directory = await fs.mkdtemp(path.join(app.getPath("temp"), "prompt-cabinet-image-match-"));
  try {
    const imageInputs = await Promise.all(
      images.map(async (image, index) => [
        { type: "text", text: `IMAGE ${image.id}\nFilename: ${String(image.name || "Untitled image").slice(0, 160)}` },
        { type: "local_image", path: await writeMatchImageToTemp(directory, image, index) },
      ]),
    );
    return await callLocalCodex(settings, [{ type: "text", text: instruction }, ...imageInputs.flat()], imageMatchOutputSchema);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function writeMatchImageToTemp(directory, image, index) {
  const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i.exec(image.dataUrl);
  if (!match) throw new Error(`Unsupported image data for ${image.name || "an image"}.`);
  const extension = match[1].toLowerCase() === "image/jpeg" ? "jpg" : match[1].split("/")[1].toLowerCase();
  const filePath = path.join(directory, `${String(index + 1).padStart(2, "0")}-${sanitizeTempFileName(image.name)}.${extension}`);
  await fs.writeFile(filePath, Buffer.from(match[2], "base64"));
  return filePath;
}

function sanitizeTempFileName(value) {
  const cleaned = String(value || "image")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned || "image").slice(0, 80);
}

function normalizeImageMatches(result, images, prompts) {
  const imageIds = new Set(images.map((image) => image.id));
  const promptIds = new Set(prompts.map((prompt) => prompt.id));
  const claimedImages = new Set();
  const claimedPrompts = new Set();
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  return {
    matches: matches
      .map((match) => ({
        imageId: typeof match?.imageId === "string" ? match.imageId : "",
        promptId: typeof match?.promptId === "string" ? match.promptId : "",
        confidence: Number(match?.confidence),
      }))
      .filter((match) => imageIds.has(match.imageId) && promptIds.has(match.promptId) && Number.isFinite(match.confidence))
      .map((match) => ({ ...match, confidence: Math.max(0, Math.min(1, match.confidence)) }))
      .filter((match) => {
        if (match.confidence < 0.55 || claimedImages.has(match.imageId) || claimedPrompts.has(match.promptId)) return false;
        claimedImages.add(match.imageId);
        claimedPrompts.add(match.promptId);
        return true;
      }),
  };
}

async function classifyPromptsWithApi(_event, payload) {
  const settings = normalizeApiSettings(payload?.settings);
  if (!settings.enabled || settings.provider === "mock") {
    throw new Error("Configure Local Codex or an API before AI classification.");
  }

  const prompts = Array.isArray(payload?.prompts)
    ? payload.prompts
        .filter((prompt) => typeof prompt?.id === "string" && typeof prompt?.originalPrompt === "string")
        .slice(0, 36)
    : [];
  const categories = Array.isArray(payload?.categories)
    ? [...new Set(payload.categories.map((category) => String(category).trim()).filter(Boolean))].slice(0, 24)
    : [];
  const availableCategories = categories.length ? categories : validCategories;
  if (!prompts.length) return { classifications: [] };

  const instruction = [
    "First, name each prompt with a short, specific, searchable title. Then classify it into exactly one of the provided categories.",
    "The title is the most important field: state the main subject or deliverable plus its distinctive style, audience, format, or use case. Never use a category, platform, or generic action as the title.",
    "For example, title a dark crevice advertising visual 'Crevice Lightbox Ad Visual', not 'Image Generation'.",
    "Classify by the prompt's intended reusable outcome, not by isolated keywords or the language it is written in.",
    "Use Image for image-generation instructions and Video for video-generation instructions. Use Design for UI/UX, visual layout, graphic design direction, or design critique.",
    "Return 3-6 concise, content-specific tags in the prompt's dominant language. Tags must describe the actual subject, deliverable, technique, setting, or distinctive constraint in the Raw Prompt. Do not copy generic local guesses, do not use the category or platform as a tag, and do not add unrelated style labels that are not explicitly present. Do not duplicate tags.",
    "Also identify only the actual material the user must supply before this prompt can run. Return the exact replaceable wording from the prompt when clear, and return an empty array when the prompt is self-contained. For example, when a prompt says '参考上传的二维户型图', return that exact phrase rather than a generic category label.",
    "Return JSON only in this shape: {\"classifications\":[{\"id\":\"...\",\"title\":\"...\",\"category\":\"...\",\"tags\":[\"...\"],\"inputNeeded\":[\"...\"]}]}",
    `Available categories: ${availableCategories.join(", ")}`,
    "",
    ...prompts.map((prompt) => `PROMPT ${prompt.id}\nTitle: ${String(prompt.title || "Untitled").slice(0, 160)}\nText: ${prompt.originalPrompt.slice(0, 1400)}`),
  ].join("\n\n");

  const result = settings.provider === "codex-local"
    ? await callLocalCodex(settings, instruction, buildPromptClassificationOutputSchema(availableCategories))
    : await callChatCompletions(
        settings,
        [
          { role: "system", content: "You are a precise prompt librarian. Return valid JSON only, with no explanation." },
          { role: "user", content: instruction },
        ],
        0,
      );
  return normalizePromptClassifications(result, prompts, availableCategories);
}

function normalizePromptClassifications(result, prompts, categories) {
  const promptIds = new Set(prompts.map((prompt) => prompt.id));
  const promptsById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  const validCategoryNames = new Set(categories);
  const seen = new Set();
  const classifications = Array.isArray(result?.classifications) ? result.classifications : [];
  return {
    classifications: classifications
      .map((classification) => ({
        id: typeof classification?.id === "string" ? classification.id : "",
        title: typeof classification?.title === "string" ? classification.title.trim() : "",
        category: typeof classification?.category === "string" ? classification.category.trim() : "",
        tags: Array.isArray(classification?.tags) ? classification.tags.map(String) : [],
        inputNeeded: Array.isArray(classification?.inputNeeded) ? classification.inputNeeded.map(String).map((input) => input.trim()).filter(Boolean).slice(0, 10) : [],
      }))
      .filter((classification) => promptIds.has(classification.id) && validCategoryNames.has(classification.category) && !seen.has(classification.id))
      .map((classification) => {
        seen.add(classification.id);
        const prompt = promptsById.get(classification.id);
        return {
          ...classification,
          title: normalizeAnalysisTitle(classification.title, prompt?.originalPrompt, classification.category),
          tags: normalizeTags(classification.tags, classification.category, "", prompt?.originalPrompt),
        };
      }),
  };
}

function buildAnalyzeSystemPrompt(outputLanguage = "auto") {
  const languageInstruction = outputLanguage === "zh"
    ? "Return title, tags, useCase, inputNeeded, and expectedOutput in Simplified Chinese. Keep category enum values and platform brand names unchanged."
    : outputLanguage === "en"
      ? "Return title, tags, useCase, inputNeeded, and expectedOutput in English. Keep category enum values and platform brand names unchanged."
      : "Use the same dominant language as the Raw Prompt for title, tags, useCase, inputNeeded, and expectedOutput. If the Raw Prompt is Chinese, return these fields in Simplified Chinese. Keep category enum values and platform brand names unchanged.";
  const schemaPrompt = [
    "Analyze this saved work prompt and return JSON only.",
    "Title is the first priority. Write a concise, specific, searchable label that lets a person find this exact prompt later.",
    "Classify the prompt by its domain and intended reuse case, not by the fact that it may ask for runnable code.",
    "Use exactly one category from: Design, Writing, Research, Coding, Image, Video, Career, Product.",
    "Category definitions:",
    "- Design: UI/UX, visual style, page layout, portfolio, design critique, components, navigation, buttons, cards, inputs, responsive visual direction.",
    "- Writing: copywriting, social posts, captions, email, article drafts, tone rewrite.",
    "- Research: summarizing, organizing material, competitive analysis, insights.",
    "- Coding: codebase work, debugging, repository tasks, implementation logic, APIs, tests, refactoring.",
    "- Image: image-generation prompts, art direction, posters, renders, Midjourney-style output.",
    "- Video: scripts, storyboards, shots, short video, Runway-style output.",
    "- Career: resume, job search, interviews, applications.",
    "- Product: PRD, features, roadmap, user stories, requirements.",
    "Prefer the user's main task over examples mentioned inside the prompt.",
    "If a prompt asks for visual UI style, neumorphism, page background, navigation, cards, buttons, inputs, icons, hover states, spacing, layout, or responsive UI, use Design even if it says to output runnable code.",
    "Use Coding only when the main task is code logic, repository implementation, debugging, APIs, tests, or engineering changes.",
    "If the final output is an image-generation prompt, use Image even if words like UI, asset, icon, or game appear.",
    "If the final output is social copy, caption, post, hashtags, or Xiaohongshu content, use Writing.",
    "For platform, use the best target AI/workbench platform, usually ChatGPT, Codex, Midjourney, Runway, Claude, or Figma. Do not use generic surfaces like Web unless the prompt is explicitly for web publishing. Keep platform separate from tags.",
    "Make the title specific to the Raw Prompt's distinctive content, not merely its category, platform, or action.",
    "Build the title from the main subject or deliverable plus one or two meaningful differentiators such as style, audience, format, or use case.",
    "Avoid generic titles such as Image Generation, Writing Prompt, Code Development, Research Analysis, or Product Planning when the Raw Prompt contains more specific details.",
    "For prompts with a placeholder subject, name the reusable visual or workflow style. Example: a cartoon character prompt with rough black outlines should be titled 'Rough-Outline Cartoon Character', not 'Image Generation'.",
    "Keep title short, clear, and scannable, usually 3-7 English words or 4-12 Chinese characters.",
    "For inputNeeded, inspect the Raw Prompt for the actual variable material or information a user must supply before running it.",
    "Return only what the Raw Prompt actually requires, using the exact replaceable phrase from the Raw Prompt whenever it is clear. For example, return 'any thematic object' for that exact phrase, 'original image' when the prompt says to transform or preserve an original/source image, 'uploaded image' only when an image must be supplied, and 'design brief' only when the prompt explicitly depends on a design brief. Return an empty array when no user-supplied variable is required.",
    "Preserve explicit placeholders such as #object, {{object}}, [object], or <object> as the concise variable name without the surrounding markers.",
    "Prioritize explicit dependencies such as an uploaded or reference image, source text, document, URL, dataset, repository, product details, or named placeholders.",
    "For example, if the Raw Prompt says it works from an uploaded image, inputNeeded should contain only a concise item such as 'Uploaded image' unless another user-supplied input is explicitly required.",
    "Do not return a generic category checklist. Do not include fixed style directions, instructions, goals, audience, context, or constraints unless the Raw Prompt clearly leaves them for the user to provide.",
    "Keep each inputNeeded item as a short noun phrase, remove duplicates, and use an empty array when the prompt is fully self-contained.",
    languageInstruction,
    "Do not wrap, rewrite, or instruct the prompt in refinedPrompt. Set refinedPrompt to the original Raw Prompt text exactly, so the user can customize it manually.",
    "Return this JSON shape:",
    JSON.stringify({
      title: "string",
      category: "Design | Writing | Research | Coding | Image | Video | Career | Product",
      tags: ["string"],
      platform: "string",
      useCase: "string",
      inputNeeded: ["string"],
      expectedOutput: "string",
      refinedPrompt: "string",
    }),
  ].join("\n");
  return schemaPrompt;
}

function buildAnalyzeInstruction(rawPrompt, notes, outputLanguage = "auto") {
  return [
    buildAnalyzeSystemPrompt(outputLanguage),
    "",
    "Raw Prompt:",
    rawPrompt,
    "",
    "Notes:",
    notes || "Not provided.",
  ].join("\n");
}

async function callLocalCodex(settings, prompt, outputSchema) {
  let codexSdk;
  try {
    codexSdk = await import("@openai/codex-sdk");
  } catch (error) {
    throw new Error(
      "Local Codex SDK is not installed. Run `npm install @openai/codex-sdk`, then make sure Codex is signed in on this computer.",
    );
  }

  const Codex = codexSdk.Codex || codexSdk.default;
  if (!Codex) throw new Error("Local Codex SDK did not export a Codex client.");

  let codex;
  try {
    const codexPathOverride = getPackagedCodexPathOverride();
    if (app.isPackaged && !codexPathOverride) {
      throw new Error("Packaged Codex binary was not found in app.asar.unpacked. Rebuild the desktop app.");
    }
    codex = new Codex(codexPathOverride ? { codexPathOverride } : {});
  } catch (error) {
    throw new Error(`Could not start Local Codex. ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  const thread = codex.startThread({
    ...(settings.model ? { model: settings.model } : {}),
    sandboxMode: "read-only",
    skipGitRepoCheck: true,
  });
  const result = await thread.run(prompt, { outputSchema });
  const content = extractCodexText(result);
  return parseJsonObject(content);
}

function getPackagedCodexPathOverride() {
  if (!app.isPackaged) return "";
  const target = process.platform === "darwin" && process.arch === "arm64"
    ? { packageName: "codex-darwin-arm64", triple: "aarch64-apple-darwin", binaryName: "codex" }
    : process.platform === "darwin" && process.arch === "x64"
      ? { packageName: "codex-darwin-x64", triple: "x86_64-apple-darwin", binaryName: "codex" }
      : process.platform === "win32" && process.arch === "x64"
        ? { packageName: "codex-win32-x64", triple: "x86_64-pc-windows-msvc", binaryName: "codex.exe" }
        : undefined;
  if (!target) return "";

  const unpackedNodeModules = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules");
  const directCandidate = path.join(
    unpackedNodeModules,
    "@openai",
    target.packageName,
    "vendor",
    target.triple,
    "bin",
    target.binaryName,
  );
  if (fsSync.existsSync(directCandidate)) return directCandidate;

  const pnpmDirectory = path.join(unpackedNodeModules, ".pnpm");
  try {
    const packageDirectory = fsSync.readdirSync(pnpmDirectory).find((name) =>
      name.startsWith("@openai+codex@") && name.endsWith(`-${process.platform}-${process.arch}`),
    );
    if (!packageDirectory) return "";
    const pnpmCandidate = path.join(
      pnpmDirectory,
      packageDirectory,
      "node_modules",
      "@openai",
      "codex",
      "vendor",
      target.triple,
      "bin",
      target.binaryName,
    );
    return fsSync.existsSync(pnpmCandidate) ? pnpmCandidate : "";
  } catch {
    return "";
  }
}

function extractCodexText(result) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return String(result ?? "");

  const candidates = [
    result.finalResponse,
    result.final_response,
    result.response,
    result.content,
    result.text,
    result.message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate;
  }
  return JSON.stringify(result);
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1));
    }
    throw new Error(`Could not parse JSON from Local Codex response: ${content.slice(0, 500)}`);
  }
}

function normalizeAnalyzeResult(result, rawPrompt, outputLanguage = "auto") {
  const category = normalizeCategory(result?.category, rawPrompt);
  const useChinese = outputLanguage === "zh" || (outputLanguage !== "en" && isChinesePromptText(rawPrompt));
  const platform = normalizePlatform(result?.platform, category);
  return {
    title: normalizeAnalysisTitle(result?.title, rawPrompt, category, outputLanguage),
    category,
    tags: normalizeTags(Array.isArray(result?.tags) ? result.tags.map(String) : [], category, platform, rawPrompt),
    platform,
    useCase: typeof result?.useCase === "string" && result.useCase.trim()
      ? result.useCase.trim()
      : useChinese ? "保存并复用这条提示词。" : "Saved prompt for future reuse.",
    inputNeeded: normalizeInputNeeded(result?.inputNeeded, rawPrompt, category, outputLanguage),
    expectedOutput: typeof result?.expectedOutput === "string" && result.expectedOutput.trim()
      ? result.expectedOutput.trim()
      : useChinese ? "可复用的提示词成果。" : "Reusable prompt output.",
    refinedPrompt: rawPrompt,
  };
}

function normalizeInputNeeded(value, rawPrompt, category, outputLanguage = "auto") {
  const inferred = inferPromptInputs(rawPrompt, outputLanguage);
  if (inferred.length) return inferred;

  const useChinese = outputLanguage === "zh" || (outputLanguage !== "en" && isChinesePromptText(rawPrompt));
  const supplied = Array.isArray(value) ? value.map(String).map((input) => input.trim()).filter(Boolean) : [];
  const genericInputs = useChinese
    ? new Set(["设计需求", "主题或原始草稿", "用户问题或产品构想"])
    : new Set(["design brief", "source topic or draft", "user problem or product idea"]);
  const source = String(rawPrompt || "").toLowerCase();
  return supplied
    .filter((input) => !genericInputs.has(input.toLowerCase()) || source.includes(input.toLowerCase()))
    .slice(0, 10);
}

function inferPromptInputs(rawPrompt, outputLanguage = "auto") {
  const text = String(rawPrompt || "");
  const useChinese = outputLanguage === "zh" || (outputLanguage !== "en" && isChinesePromptText(text));
  const inputs = [];
  const add = (value) => {
    if (value && !inputs.some((input) => input.toLowerCase() === value.toLowerCase())) inputs.push(value);
  };
  const placeholderPattern = /#(uploaded image|reference image|original image|source text|source document|design brief)|#([A-Za-z][A-Za-z0-9_/-]{0,39})|\{\{\s*([^{}\n]{1,40}?)\s*\}\}|<\s*([^<>\n]{1,40}?)\s*>|\[\[?\s*([A-Za-z][A-Za-z0-9 _/-]{0,39})\s*\]?\]/gi;
  for (const match of text.matchAll(placeholderPattern)) add((match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "").trim());
  if (/\bany\s+thematic\s+object\b/i.test(text)) {
    add("any thematic object");
  } else if (/(?:任意|任何|一个)?(?:主题|主要|视觉)?对象/i.test(text)) {
    add(useChinese ? "对象" : "object");
  }
  if (/upload(?:ed)?\s+(?:an?\s+)?(?:image|photo|picture)|provided\s+(?:an?\s+)?(?:image|photo|picture)|input image|上传(?:的)?(?:图片|图像|照片)|提供(?:的)?(?:图片|图像|照片)/i.test(text)) {
    add(useChinese ? "上传的图片" : "uploaded image");
  }
  if (/original image|source image|依据(?:原图|原始图)|基于(?:原图|原始图)|以(?:原图|原始图)为|原图(?:转换|重绘|改造)|原始图(?:转换|重绘|改造)/i.test(text)) {
    add(useChinese ? "原图" : "original image");
  }
  if (/reference (?:image|photo|picture)|参考(?:图片|图像|照片)/i.test(text)) add(useChinese ? "参考图片" : "reference image");
  if (/design brief|设计需求/i.test(text)) add(useChinese ? "设计需求" : "design brief");
  return inputs.slice(0, 10);
}

function normalizeAnalysisTitle(value, rawPrompt, category, outputLanguage = "auto") {
  const title = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (title && !isGenericAnalysisTitle(title)) return title.slice(0, 96);
  const useChinese = outputLanguage === "zh" || (outputLanguage !== "en" && isChinesePromptText(rawPrompt));
  return buildSpecificFallbackTitle(rawPrompt, category, useChinese);
}

function isGenericAnalysisTitle(value) {
  const normalized = value.toLowerCase().replace(/[\s._-]+/g, " ").trim();
  return [
    "image generation", "image prompt", "writing prompt", "writing refinement", "code development",
    "research analysis", "product planning", "video creation", "design workflow", "career materials",
    "图像生成", "图像提示词", "写作优化", "代码开发", "研究分析", "产品规划", "视频创作", "设计工作流", "求职材料",
  ].includes(normalized);
}

function buildSpecificFallbackTitle(rawPrompt, category, useChinese) {
  const source = String(rawPrompt || "").toLowerCase();
  if (containsAny(source, ["crevice", "dark crevice", "narrow slit", "bright slit", "occluder", "裂缝", "狭缝", "遮挡物"])) {
    return useChinese ? "裂缝光箱广告视觉" : "Crevice Lightbox Ad Visual";
  }
  if (containsAny(source, ["cinematic", "电影感"]) && containsAny(source, ["3d", "three-dimensional", "三维"]) && containsAny(source, ["advertisement", "commercial", "广告"])) {
    return useChinese ? "电影感3D品牌广告" : "Cinematic 3D Brand Ad";
  }
  if (containsAny(source, ["xiaohongshu", "小红书"])) return useChinese ? "小红书内容文案" : "Xiaohongshu Content Copy";
  if (containsAny(source, ["neumorphism", "soft ui", "新拟态"])) return useChinese ? "新拟态界面设计" : "Neumorphic UI Design";
  if (containsAny(source, ["debug", "bug", "调试", "报错"])) return useChinese ? "代码问题排查" : "Code Issue Diagnosis";
  if (containsAny(source, ["resume", "interview", "简历", "面试"])) return useChinese ? "求职材料优化" : "Career Material Refinement";
  const fallback = useChinese ? {
    Design: "自定义设计工作流", Writing: "自定义写作工作流", Research: "自定义研究工作流", Coding: "自定义开发工作流",
    Image: "自定义图像视觉", Video: "自定义视频创作", Career: "自定义求职工作流", Product: "自定义产品工作流",
  } : {
    Design: "Custom Design Workflow", Writing: "Custom Writing Workflow", Research: "Custom Research Workflow", Coding: "Custom Development Workflow",
    Image: "Custom Visual Prompt", Video: "Custom Video Workflow", Career: "Custom Career Workflow", Product: "Custom Product Workflow",
  };
  return fallback[category] || (useChinese ? "自定义提示词" : "Custom Prompt");
}

function isChinesePromptText(value) {
  return (String(value).match(/[\u3400-\u9fff]/g) ?? []).length >= 4;
}

const genericTagAliases = {
  Design: ["design", "设计", "ui design", "界面设计", "ux design", "用户体验"],
  Writing: ["writing", "写作", "writing prompt", "写作提示词"],
  Research: ["research", "研究", "调研", "research prompt", "研究提示词"],
  Coding: ["coding", "code", "代码", "编程", "development", "开发"],
  Image: ["image", "图片", "图像", "image prompt", "图像提示词", "生图"],
  Video: ["video", "视频", "video prompt", "视频提示词"],
  Career: ["career", "职业", "求职"],
  Product: ["product", "产品", "product prompt", "产品提示词"],
};
const genericPlatformTags = new Set(["chatgpt", "codex", "midjourney", "runway", "claude", "figma", "dalle", "sora"]);

function normalizeTags(tags, fallbackTag = "", platform = "", rawPrompt = "") {
  const seen = new Set();
  const normalized = [];
  const forbidden = new Set([
    "prompt", "提示词", "prompting", "ai", fallbackTag, platform,
    ...(genericTagAliases[fallbackTag] || []),
  ].map((tag) => normalizeTagKey(tag)));
  tags.forEach((tag) => {
    const cleanTag = String(tag).trim().replace(/\s+/g, " ");
    const key = normalizeTagKey(cleanTag);
    if (!key || seen.has(key) || forbidden.has(key) || genericPlatformTags.has(key) || lacksTagEvidence(key, rawPrompt)) return;
    seen.add(key);
    normalized.push(cleanTag);
  });
  return normalized.slice(0, 6);
}

function normalizeTagKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s._-]+/g, "");
}

function lacksTagEvidence(key, rawPrompt) {
  if (!String(rawPrompt || "").trim()) return false;
  const source = String(rawPrompt).toLowerCase();
  if (["neumorphism", "\u65b0\u62df\u6001"].includes(key)) return !containsAny(source, ["neumorphism", "\u65b0\u62df\u6001"]);
  if (["softui", "\u67d4\u548c\u754c\u9762"].includes(key)) return !containsAny(source, ["soft ui", "neumorphism", "\u65b0\u62df\u6001"]);
  return false;
}

function normalizeCategory(category, rawPrompt) {
  const source = String(rawPrompt || "").toLowerCase();
  if (hasImageGenerationIntent(source)) return "Image";
  if (hasWritingIntent(source)) return "Writing";
  if (hasDesignUiIntent(source)) return "Design";
  if (hasCodingImplementationIntent(source)) return "Coding";
  return validCategories.includes(category) ? category : "Product";
}

function normalizePlatform(platform, category) {
  const value = typeof platform === "string" ? platform.trim() : "";
  const genericWeb = /^(web|website|browser|desktop|mobile)$/i.test(value);
  if (category === "Coding") return value && !genericWeb ? value : "Codex";
  if (category === "Image") return value && !genericWeb ? value : "Midjourney";
  if (category === "Video") return value && !genericWeb ? value : "Runway";
  if (category === "Design") return value && !genericWeb ? value : "ChatGPT";
  return value && !genericWeb ? value : "ChatGPT";
}

function hasWritingIntent(source) {
  return containsAny(source, ["xiaohongshu", "caption", "copywriting", "hashtag", "\u5c0f\u7ea2\u4e66", "\u6587\u6848", "\u6807\u9898", "\u6b63\u6587"]);
}

function hasDesignUiIntent(source) {
  const uiSignals = countMatches(source, [
    "ui",
    "ux",
    "visual",
    "interface",
    "neumorphism",
    "soft ui",
    "light gray",
    "rounded cards",
    "soft shadows",
    "low contrast",
    "calm interface",
    "floating panels",
    "hover",
    "active",
    "button",
    "card",
    "search box",
    "input",
    "navigation",
    "layout",
    "responsive",
    "\u9875\u9762",
    "\u80cc\u666f",
    "\u5bfc\u822a",
    "\u4e3b\u5185\u5bb9",
    "\u8f85\u52a9\u4fe1\u606f",
    "\u6309\u94ae",
    "\u5361\u7247",
    "\u641c\u7d22\u6846",
    "\u8f93\u5165\u6846",
    "\u56fe\u6807",
    "\u89c6\u89c9",
    "\u65b0\u62df\u6001",
    "\u5706\u89d2",
    "\u9634\u5f71",
    "\u4f4e\u5bf9\u6bd4",
    "\u54cd\u5e94\u5f0f",
  ]);
  return uiSignals >= 2;
}

function hasCodingImplementationIntent(source) {
  if (containsAny(source, ["codex", "repo", "codebase", "debug", "bug", "\u4ee3\u7801\u5f00\u53d1"])) return true;
  const codeSignals = countMatches(source, ["react", "typescript", "vite", "api", "function", "component", "\u4ee3\u7801", "\u5f00\u53d1", "\u7f16\u7a0b"]);
  return codeSignals >= 2 && !hasDesignUiIntent(source);
}

function hasImageGenerationIntent(source) {
  const outputSignals = countMatches(source, [
    "uploaded image",
    "final image",
    "image ratio",
    "artwork",
    "illustration",
    "pixel-art",
    "pixel art",
    "sprite",
    "sticker",
    "icon-style",
    "generate image",
    "\u751f\u56fe",
    "\u56fe\u50cf\u751f\u6210",
  ]);
  const constraintSignals = countMatches(source, [
    "1:1",
    "aspect ratio",
    "composition",
    "background",
    "palette",
    "color rules",
    "style direction",
    "pixel rules",
  ]);
  return outputSignals >= 1 && constraintSignals >= 1;
}

function containsAny(source, keywords) {
  return keywords.some((keyword) => source.includes(keyword.toLowerCase()));
}

function countMatches(source, keywords) {
  return keywords.filter((keyword) => source.includes(keyword.toLowerCase())).length;
}

async function createWindow() {
  const windowSettings = await readWindowSettings();
  mainWindowNormalBounds = windowSettings.normalBounds ?? { width: 1220, height: 860, x: 80, y: 80 };
  mainWindow = new BrowserWindow({
    ...mainWindowNormalBounds,
    type: process.platform === "darwin" ? "panel" : undefined,
    minimizable: true,
    closable: true,
    minWidth: windowSettings.alwaysOnTop ? 420 : 980,
    minHeight: windowSettings.alwaysOnTop ? 560 : 680,
    show: false,
    title: "Prompt Cabinet",
    backgroundColor: "#eceff1",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMinimizable(true);

  applyMainWindowPinMode(mainWindow, windowSettings.alwaysOnTop, mainWindowNormalBounds);
  mainWindow.once("ready-to-show", () => {
    mainWindow.restore();
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
  });
  mainWindow.webContents.once("did-finish-load", () => {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.moveTop();
  });
  ["show"].forEach((eventName) => {
    mainWindow.on(eventName, () => {
      if (mainWindowPinEnabled) keepMainWindowPinned(mainWindow);
    });
  });
  mainWindow.on("minimize", () => {
    stopMainWindowPinGuard();
  });
  mainWindow.on("restore", () => {
    if (mainWindowPinEnabled) startMainWindowPinGuard(mainWindow);
  });
  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  mainWindow.on("closed", () => {
    stopMainWindowPinGuard();
    mainWindow = undefined;
  });
}

async function createQuickAddWindow() {
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    hideMainWindowForQuickAdd();
    quickAddWindow.restore();
    keepQuickAddFloating(quickAddWindow);
    registerQuickAddShortcuts();
    applyCapsuleWindowShape(quickAddWindow);
    positionQuickAddWindow(quickAddWindow);
    quickAddWindow.show();
    quickAddWindow.moveTop();
    quickAddWindow.focus();
    return;
  }
  quickAddWindow = new BrowserWindow({
    width: 780,
    height: quickAddCompactHeight,
    minWidth: 680,
    minHeight: quickAddCompactHeight,
    resizable: false,
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    title: "Quick Add - Prompt Cabinet",
    backgroundColor: "#00000000",
    transparent: true,
    alwaysOnTop: true,
    fullscreenable: false,
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  quickAddMode = "capture";
  hideMainWindowForQuickAdd();
  keepQuickAddFloating(quickAddWindow);
  startQuickAddFloatGuard(quickAddWindow);
  registerQuickAddShortcuts();
  applyCapsuleWindowShape(quickAddWindow);

  quickAddWindow.once("ready-to-show", () => {
    keepQuickAddFloating(quickAddWindow);
    applyCapsuleWindowShape(quickAddWindow);
    positionQuickAddWindow(quickAddWindow);
    quickAddWindow.show();
    quickAddWindow.moveTop();
    quickAddWindow.focus();
  });
  quickAddWindow.on("blur", () => {
    keepQuickAddFloating(quickAddWindow);
    quickAddWindow.moveTop();
  });
  quickAddWindow.on("show", () => {
    keepQuickAddFloating(quickAddWindow);
    quickAddWindow.moveTop();
  });
  quickAddWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
    query: { quick: "1" },
  });
  quickAddWindow.on("closed", () => {
    closeQuickAddPreviewWindow();
    stopQuickAddFloatGuard();
    unregisterQuickAddShortcuts();
    quickAddWindow = undefined;
    restoreMainWindowAfterQuickAdd();
  });
}

function registerOpenQuickAddShortcut() {
  if (registeredOpenQuickAddShortcut && globalShortcut.isRegistered(registeredOpenQuickAddShortcut)) {
    globalShortcut.unregister(registeredOpenQuickAddShortcut);
  }
  const shortcut = quickShortcutSettings.openQuickAdd;
  const registered = globalShortcut.register(shortcut, () => void createQuickAddWindow());
  registeredOpenQuickAddShortcut = registered ? shortcut : "";
  return registered;
}

function registerQuickAddShortcuts() {
  const shortcuts = getQuickAddGlobalShortcutEntries(quickShortcutSettings);
  shortcuts.forEach(([shortcut, channel, value]) => {
    if (globalShortcut.isRegistered(shortcut)) return;
    globalShortcut.register(shortcut, () => {
      if (!quickAddWindow || quickAddWindow.isDestroyed()) return;
      quickAddWindow.webContents.send(channel, value);
    });
  });
}

function getQuickAddGlobalShortcutEntries(settings, mode = quickAddMode) {
  const shortcuts = [
    [settings.captureMode, "prompt-cabinet:quick-add-mode-shortcut", "capture"],
    [settings.insertMode, "prompt-cabinet:quick-add-mode-shortcut", "insert"],
    [settings.previousCategory, "prompt-cabinet:quick-add-command-shortcut", "previousCategory"],
    [settings.nextCategory, "prompt-cabinet:quick-add-command-shortcut", "nextCategory"],
    [settings.previousPrompt, "prompt-cabinet:quick-add-command-shortcut", "previousPrompt"],
    [settings.nextPrompt, "prompt-cabinet:quick-add-command-shortcut", "nextPrompt"],
    [settings.closeQuickAdd, "prompt-cabinet:quick-add-command-shortcut", "closeQuickAdd"],
  ];
  if (mode === "capture") {
    shortcuts.push([settings.runAction, "prompt-cabinet:quick-add-save-shortcut"]);
  } else {
    shortcuts.push([settings.insertSelected, "prompt-cabinet:quick-add-command-shortcut", "insertSelected"]);
  }
  return shortcuts.filter(([shortcut]) => shortcut.includes("+"));
}

function unregisterQuickAddShortcuts() {
  getQuickAddGlobalShortcutEntries(quickShortcutSettings).forEach(
    ([shortcut]) => {
      if (globalShortcut.isRegistered(shortcut)) globalShortcut.unregister(shortcut);
    },
  );
}

function findUnavailableQuickAddShortcut(settings) {
  const shortcuts = [
    ...getQuickAddGlobalShortcutEntries(settings, "capture"),
    ...getQuickAddGlobalShortcutEntries(settings, "insert"),
  ].filter(([shortcut], index, entries) => entries.findIndex(([candidate]) => candidate === shortcut) === index);
  for (const [shortcut] of shortcuts) {
    const registered = globalShortcut.register(shortcut, () => {});
    if (!registered) return shortcut;
    globalShortcut.unregister(shortcut);
  }
  return "";
}

function keepQuickAddFloating(window) {
  if (!window || window.isDestroyed()) return;
  window.setAlwaysOnTop(true, "screen-saver", 1);
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
}

function startQuickAddFloatGuard(window) {
  stopQuickAddFloatGuard();
  quickAddFloatInterval = setInterval(() => {
    if (!window || window.isDestroyed()) {
      stopQuickAddFloatGuard();
      return;
    }
    keepQuickAddFloating(window);
    if (window.isVisible()) window.moveTop();
  }, 500);
}

function stopQuickAddFloatGuard() {
  if (!quickAddFloatInterval) return;
  clearInterval(quickAddFloatInterval);
  quickAddFloatInterval = undefined;
}

function positionQuickAddWindow(window) {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width } = display.workArea;
  const [windowWidth, windowHeight] = window.getSize();
  window.setPosition(Math.round(x + (width - windowWidth) / 2), y + 18);
  window.setSize(windowWidth, windowHeight);
  positionQuickAddPreviewWindow();
}

function positionQuickAddPreviewWindow() {
  if (!quickPreviewWindow || quickPreviewWindow.isDestroyed() || !quickAddWindow || quickAddWindow.isDestroyed()) return;
  const { x, y } = quickAddWindow.getBounds();
  quickPreviewWindow.setPosition(x + 282, y + quickAddCompactHeight + 6);
}

function closeQuickAddPreviewWindow() {
  quickPreviewImage = "";
  if (!quickPreviewWindow || quickPreviewWindow.isDestroyed()) return;
  quickPreviewWindow.close();
  quickPreviewWindow = undefined;
}

function showQuickAddImagePreview(image) {
  quickPreviewImage = typeof image === "string" && image.startsWith("data:image/") ? image : "";
  if (!quickPreviewImage || !quickAddWindow || quickAddWindow.isDestroyed()) {
    closeQuickAddPreviewWindow();
    return false;
  }

  if (quickPreviewWindow && !quickPreviewWindow.isDestroyed()) {
    quickPreviewWindow.webContents.send("prompt-cabinet:quick-add-image-preview", quickPreviewImage);
    positionQuickAddPreviewWindow();
    quickPreviewWindow.showInactive();
    return true;
  }

  quickPreviewWindow = new BrowserWindow({
    width: quickPreviewWidth,
    height: quickPreviewHeight,
    resizable: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    parent: quickAddWindow,
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  quickPreviewWindow.setIgnoreMouseEvents(true, { forward: true });
  quickPreviewWindow.on("closed", () => {
    quickPreviewWindow = undefined;
  });
  quickPreviewWindow.once("ready-to-show", () => {
    if (!quickPreviewWindow || quickPreviewWindow.isDestroyed()) return;
    positionQuickAddPreviewWindow();
    keepQuickAddFloating(quickPreviewWindow);
    quickPreviewWindow.showInactive();
  });
  quickPreviewWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
    query: { quickPreview: "1" },
  });
  return true;
}

function hideMainWindowForQuickAdd() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  mainWindowHiddenForQuickAdd = true;
  mainWindow.hide();
}

function restoreMainWindowAfterQuickAdd() {
  if (!mainWindowHiddenForQuickAdd) return;
  showMainWindow();
}

function showMainWindow() {
  mainWindowHiddenForQuickAdd = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
}

function applyCapsuleWindowShape(window) {
  if (process.platform !== "win32" && process.platform !== "linux") return;
  const [width, height] = window.getSize();
  const radius = Math.floor(height / 2);
  const rects = [];
  for (let y = 0; y < height; y += 1) {
    const dy = Math.abs(radius - y - 0.5);
    const offset = Math.max(0, Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - dy * dy))));
    rects.push({ x: offset, y, width: width - offset * 2, height: 1 });
  }
  window.setShape(rects);
}

function runSystemCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout ?? "").trim());
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function showAccessibilityGuide(sourceWindow, language = "en") {
  const useChinese = language === "zh";
  const permissionName = app.isPackaged ? "Prompt Cabinet" : "Electron (Prompt Cabinet Dev)";
  const options = {
    type: "info",
    title: useChinese ? "启用自动插入" : "Enable Auto Insert",
    message: useChinese ? "允许 Prompt Cabinet 将 Prompt 插入其他应用" : "Allow Prompt Cabinet to insert prompts into other apps",
    detail: useChinese
      ? [
          "macOS 要求开启辅助功能权限，Prompt Cabinet 才能粘贴到当前输入框。",
          "",
          `1. 在辅助功能列表中找到“${permissionName}”。`,
          "2. 打开它旁边的开关。",
          "3. 完全退出并重新打开 Prompt Cabinet。",
          "4. 返回输入框并再次点击插入。",
          "",
          "如果开关已经打开但仍无法插入，请点击“刷新授权”，再重新开启开关。",
          "",
          "Prompt 也已复制到剪贴板，仍可手动粘贴。",
        ].join("\n")
      : [
          "macOS requires Accessibility permission before Prompt Cabinet can paste into the active text field.",
          "",
          `1. In Accessibility, find “${permissionName}”.`,
          "2. Turn on the switch beside it.",
          "3. Quit and reopen Prompt Cabinet.",
          "4. Return to your text field and click Insert again.",
          "",
          "If the switch is already on, choose Refresh Access and enable it again.",
          "",
          "The prompt has also been copied, so manual paste remains available.",
        ].join("\n"),
    buttons: useChinese ? ["刷新授权", "打开设置", "暂不"] : ["Refresh Access", "Open Settings", "Not Now"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };
  const result = sourceWindow && !sourceWindow.isDestroyed()
    ? await dialog.showMessageBox(sourceWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response === 2) return false;

  if (result.response === 0 && app.isPackaged) {
    try {
      await runSystemCommand("/usr/bin/tccutil", ["reset", "Accessibility", appBundleId]);
    } catch (error) {
      console.warn("Unable to reset Accessibility permission:", error?.message ?? error);
    }
  }

  systemPreferences.isTrustedAccessibilityClient(true);
  await wait(200);
  await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
  return true;
}

function isAccessibilityPermissionError(error) {
  const message = String(error?.message ?? error ?? "");
  return /assistive access|not allowed assistive|(-25211)/i.test(message);
}

function getNativePasteHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "bin", "prompt-cabinet-paste")
    : path.join(__dirname, "bin", "prompt-cabinet-paste");
}

async function insertTextIntoActiveApp(event, value, language = "en") {
  const text = typeof value === "string" ? value : "";
  if (!text.trim()) return { ok: false, copied: false, needsAccessibility: false };

  clipboard.writeText(text);
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (process.platform === "darwin" && !systemPreferences.isTrustedAccessibilityClient(false)) {
    await showAccessibilityGuide(sourceWindow, language);
    return { ok: false, copied: true, needsAccessibility: true };
  }

  unregisterQuickAddShortcuts();
  if (sourceWindow && !sourceWindow.isDestroyed()) sourceWindow.hide();

  try {
    await wait(220);
    if (process.platform === "darwin") {
      await runSystemCommand(getNativePasteHelperPath(), []);
    } else if (process.platform === "win32") {
      await runSystemCommand("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$shell = New-Object -ComObject WScript.Shell; $shell.SendKeys('^v')",
      ]);
    } else {
      await runSystemCommand("xdotool", ["key", "ctrl+v"]);
    }
    return { ok: true, copied: true, needsAccessibility: false };
  } catch (error) {
    console.warn("Prompt insertion fell back to clipboard:", error?.message ?? error);
    const isMac = process.platform === "darwin";
    const needsAccessibility = isMac && isAccessibilityPermissionError(error);
    if (needsAccessibility) {
      await showAccessibilityGuide(undefined, language);
    }
    return { ok: false, copied: true, needsAccessibility };
  } finally {
    await wait(100);
    if (sourceWindow && !sourceWindow.isDestroyed()) {
      keepQuickAddFloating(sourceWindow);
      sourceWindow.showInactive();
      sourceWindow.moveTop();
      registerQuickAddShortcuts();
    }
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  Menu.setApplicationMenu(null);

  ipcMain.handle("prompt-cabinet:load-prompts", readPromptData);
  ipcMain.handle("prompt-cabinet:save-prompts", (event, prompts) => writePromptData(prompts, event.sender.id));
  ipcMain.handle("prompt-cabinet:get-data-path", () => getDataFilePath());
  ipcMain.handle("prompt-cabinet:load-api-settings", readApiSettings);
  ipcMain.handle("prompt-cabinet:save-api-settings", (_event, settings) => writeApiSettings(settings));
  ipcMain.handle("prompt-cabinet:check-for-updates", checkForUpdates);
  ipcMain.handle("prompt-cabinet:open-update-download", openUpdateDownload);
  ipcMain.handle("prompt-cabinet:test-api-connection", testApiConnection);
  ipcMain.handle("prompt-cabinet:analyze-prompt", analyzePromptWithApi);
  ipcMain.handle("prompt-cabinet:match-images", matchImagesWithApi);
  ipcMain.handle("prompt-cabinet:classify-prompts", classifyPromptsWithApi);
  ipcMain.handle("prompt-cabinet:get-always-on-top", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? window.isAlwaysOnTop() : (await readWindowSettings()).alwaysOnTop;
  });
  ipcMain.handle("prompt-cabinet:set-always-on-top", async (event, enabled) => {
    const nextValue = Boolean(enabled);
    const window = BrowserWindow.fromWebContents(event.sender);
    const currentSettings = await readWindowSettings();
    if (window) {
      if (nextValue && !window.isAlwaysOnTop()) mainWindowNormalBounds = window.getBounds();
      const restoreBounds = mainWindowNormalBounds ?? currentSettings.normalBounds;
      applyMainWindowPinMode(window, nextValue, restoreBounds);
    }
    await writeWindowSettings({
      ...currentSettings,
      alwaysOnTop: nextValue,
      normalBounds: mainWindowNormalBounds ?? currentSettings.normalBounds,
    });
    return nextValue;
  });
  ipcMain.handle("prompt-cabinet:load-shortcuts", async () => (await readWindowSettings()).shortcuts);
  ipcMain.handle("prompt-cabinet:set-quick-add-mode", (_event, mode) => {
    const nextMode = mode === "insert" ? "insert" : "capture";
    if (nextMode === quickAddMode) return quickAddMode;
    unregisterQuickAddShortcuts();
    quickAddMode = nextMode;
    if (quickAddWindow && !quickAddWindow.isDestroyed()) registerQuickAddShortcuts();
    return quickAddMode;
  });
  ipcMain.handle("prompt-cabinet:set-quick-add-image-preview", (event, image) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed() || window !== quickAddWindow) return false;
    return showQuickAddImagePreview(image);
  });
  ipcMain.handle("prompt-cabinet:get-quick-add-image-preview", () => quickPreviewImage);
  ipcMain.handle("prompt-cabinet:save-shortcuts", async (_event, shortcuts) => {
    const nextShortcuts = normalizeQuickShortcutSettings(shortcuts);
    if (new Set(Object.values(nextShortcuts)).size !== Object.keys(nextShortcuts).length) {
      throw new Error("Each Quick Add action needs a different shortcut.");
    }
    const previousShortcuts = quickShortcutSettings;
    unregisterQuickAddShortcuts();
    quickShortcutSettings = nextShortcuts;
    if (!registerOpenQuickAddShortcut()) {
      quickShortcutSettings = previousShortcuts;
      registerOpenQuickAddShortcut();
      if (quickAddWindow && !quickAddWindow.isDestroyed()) registerQuickAddShortcuts();
      throw new Error("The Open Quick Add shortcut is already used by another application.");
    }
    const unavailableShortcut = findUnavailableQuickAddShortcut(nextShortcuts);
    if (unavailableShortcut) {
      quickShortcutSettings = previousShortcuts;
      registerOpenQuickAddShortcut();
      if (quickAddWindow && !quickAddWindow.isDestroyed()) registerQuickAddShortcuts();
      throw new Error(`${unavailableShortcut} is already used by another application.`);
    }
    if (quickAddWindow && !quickAddWindow.isDestroyed()) registerQuickAddShortcuts();
    const currentSettings = await readWindowSettings();
    await writeWindowSettings({ ...currentSettings, shortcuts: nextShortcuts });
    if (quickAddWindow && !quickAddWindow.isDestroyed()) {
      quickAddWindow.webContents.send("prompt-cabinet:quick-add-shortcuts-changed", nextShortcuts);
    }
    return nextShortcuts;
  });
  ipcMain.handle("prompt-cabinet:read-clipboard-text", () => clipboard.readText());
  ipcMain.handle("prompt-cabinet:read-clipboard-image", () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? "" : image.toDataURL();
  });
  ipcMain.handle("prompt-cabinet:insert-text", insertTextIntoActiveApp);
  ipcMain.handle("prompt-cabinet:open-quick-add", () => createQuickAddWindow());
  ipcMain.handle("prompt-cabinet:close-current-window", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) window.close();
  });

  const windowSettings = await readWindowSettings();
  quickShortcutSettings = windowSettings.shortcuts;
  registerOpenQuickAddShortcut();
  void createWindow();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
