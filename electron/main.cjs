const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard, globalShortcut, net, screen, shell, systemPreferences } = require("electron");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const dataFileName = "prompt-cabinet-data.json";
const settingsFileName = "prompt-cabinet-settings.json";
const windowSettingsFileName = "prompt-cabinet-window.json";
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
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow;
let mainWindowNormalBounds;
let mainWindowPinInterval;
let mainWindowPinEnabled = false;
let quickAddWindow;
let mainWindowHiddenForQuickAdd = false;
let quickAddFloatInterval;
let quickInsertTargetBundleId = "";
let quickShortcutSettings = { ...defaultQuickShortcutSettings };
let registeredOpenQuickAddShortcut = "";
let quickAddMode = "capture";

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

function buildChatCompletionsUrl(baseUrl) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  if (cleanBase.endsWith("/chat/completions")) return cleanBase;
  return `${cleanBase}/chat/completions`;
}

async function callChatCompletions(settings, messages, temperature = 0.2) {
  const normalized = normalizeApiSettings(settings);
  if (!normalized.apiKey) throw new Error("Missing API key.");
  if (!normalized.model) throw new Error("Missing model.");

  let response;
  try {
    // Electron's network stack follows the operating system proxy settings.
    response = await net.fetch(buildChatCompletionsUrl(normalized.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${normalized.apiKey}`,
      },
      body: JSON.stringify({
        model: normalized.model,
        messages,
        temperature,
        response_format: { type: "json_object" },
      }),
    });
  } catch (error) {
    const cause = error?.cause;
    const detail = cause?.code || cause?.message || error?.message || "Unknown network error";
    throw new Error(`Could not reach the API endpoint using the system network settings: ${detail}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("API response did not include message content.");
  return JSON.parse(content);
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

function buildAnalyzeSystemPrompt(outputLanguage = "auto") {
  const languageInstruction = outputLanguage === "zh"
    ? "Return title, tags, useCase, inputNeeded, and expectedOutput in Simplified Chinese. Keep category enum values and platform brand names unchanged."
    : outputLanguage === "en"
      ? "Return title, tags, useCase, inputNeeded, and expectedOutput in English. Keep category enum values and platform brand names unchanged."
      : "Use the same dominant language as the Raw Prompt for title, tags, useCase, inputNeeded, and expectedOutput. If the Raw Prompt is Chinese, return these fields in Simplified Chinese. Keep category enum values and platform brand names unchanged.";
  const schemaPrompt = [
    "Analyze this saved work prompt and return JSON only.",
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
    "For platform, use the best target AI/workbench platform, usually ChatGPT, Codex, Midjourney, Runway, Claude, or Figma. Do not use generic surfaces like Web unless the prompt is explicitly for web publishing.",
    "Make the title specific to the Raw Prompt's distinctive content, not merely its category, platform, or action.",
    "Build the title from the main subject or deliverable plus one or two meaningful differentiators such as style, audience, format, or use case.",
    "Avoid generic titles such as Image Generation, Writing Prompt, Code Development, Research Analysis, or Product Planning when the Raw Prompt contains more specific details.",
    "For prompts with a placeholder subject, name the reusable visual or workflow style. Example: a cartoon character prompt with rough black outlines should be titled 'Rough-Outline Cartoon Character', not 'Image Generation'.",
    "Keep title short, clear, and scannable, usually 3-7 English words or 4-12 Chinese characters.",
    "For inputNeeded, inspect the Raw Prompt for the actual variable material or information a user must supply before running it.",
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
  const targetTriple = process.platform === "win32" && process.arch === "x64"
    ? "x86_64-pc-windows-msvc"
    : "";
  if (!targetTriple) return "";

  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const candidate = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    targetTriple,
    "bin",
    binaryName,
  );
  return fsSync.existsSync(candidate) ? candidate : "";
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
  return {
    title: typeof result?.title === "string" && result.title.trim() ? result.title.trim() : useChinese ? "未命名提示词" : "Untitled Prompt",
    category,
    tags: normalizeTags(Array.isArray(result?.tags) ? result.tags.map(String) : [category], category),
    platform: normalizePlatform(result?.platform, category),
    useCase: typeof result?.useCase === "string" && result.useCase.trim()
      ? result.useCase.trim()
      : useChinese ? "保存并复用这条提示词。" : "Saved prompt for future reuse.",
    inputNeeded: Array.isArray(result?.inputNeeded) ? result.inputNeeded.map(String).filter(Boolean).slice(0, 10) : [],
    expectedOutput: typeof result?.expectedOutput === "string" && result.expectedOutput.trim()
      ? result.expectedOutput.trim()
      : useChinese ? "可复用的提示词成果。" : "Reusable prompt output.",
    refinedPrompt: rawPrompt,
  };
}

function isChinesePromptText(value) {
  return (String(value).match(/[\u3400-\u9fff]/g) ?? []).length >= 4;
}

function normalizeTags(tags, fallbackTag) {
  const seen = new Set();
  const normalized = [];
  tags.forEach((tag) => {
    const cleanTag = String(tag).trim();
    const key = cleanTag.toLowerCase();
    if (!cleanTag || seen.has(key)) return;
    seen.add(key);
    normalized.push(cleanTag);
  });
  return (normalized.length ? normalized : [fallbackTag]).slice(0, 8);
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
  await rememberQuickInsertTarget();
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
    height: 58,
    minWidth: 680,
    minHeight: 58,
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
    setTimeout(() => void rememberQuickInsertTarget(), 120);
  });
  quickAddWindow.on("show", () => {
    keepQuickAddFloating(quickAddWindow);
    quickAddWindow.moveTop();
  });
  quickAddWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
    query: { quick: "1" },
  });
  quickAddWindow.on("closed", () => {
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
    if (window.isVisible() && !window.isFocused()) void rememberQuickInsertTarget();
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

async function getFrontmostApplication() {
  if (process.platform !== "darwin") return undefined;
  const output = await runSystemCommand("/usr/bin/osascript", [
    "-e",
    'tell application "System Events"',
    "-e",
    "set activeProcess to first application process whose frontmost is true",
    "-e",
    'return (unix id of activeProcess as text) & "|" & (bundle identifier of activeProcess as text)',
    "-e",
    "end tell",
  ]);
  const separatorIndex = output.indexOf("|");
  if (separatorIndex < 1) return undefined;
  return {
    pid: Number(output.slice(0, separatorIndex)),
    bundleId: output.slice(separatorIndex + 1).trim(),
  };
}

async function rememberQuickInsertTarget() {
  if (process.platform !== "darwin") return;
  try {
    const frontmostApp = await getFrontmostApplication();
    if (!frontmostApp?.bundleId || frontmostApp.pid === process.pid) return;
    quickInsertTargetBundleId = frontmostApp.bundleId;
  } catch (error) {
    console.warn("Unable to remember the active app for Quick Insert:", error?.message ?? error);
  }
}

async function activateQuickInsertTarget() {
  if (process.platform !== "darwin" || !quickInsertTargetBundleId) return;
  const targetBundleId = quickInsertTargetBundleId;
  await runSystemCommand("/usr/bin/osascript", [
    "-e",
    "on run argv",
    "-e",
    "set targetBundleId to item 1 of argv",
    "-e",
    'tell application "System Events" to set frontmost of first application process whose bundle identifier is targetBundleId to true',
    "-e",
    "end run",
    targetBundleId,
  ]);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const frontmostApp = await getFrontmostApplication();
    if (frontmostApp?.bundleId === targetBundleId) return;
    await wait(80);
  }
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
          "3. 返回输入框并再次点击插入。",
          "",
          "Prompt 也已复制到剪贴板，仍可手动粘贴。",
        ].join("\n")
      : [
          "macOS requires Accessibility permission before Prompt Cabinet can paste into the active text field.",
          "",
          `1. In Accessibility, find “${permissionName}”.`,
          "2. Turn on the switch beside it.",
          "3. Return to your text field and click Insert again.",
          "",
          "The prompt has also been copied, so manual paste remains available.",
        ].join("\n"),
    buttons: useChinese ? ["打开设置", "暂不"] : ["Open Settings", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const result = sourceWindow && !sourceWindow.isDestroyed()
    ? await dialog.showMessageBox(sourceWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response !== 0) return false;

  systemPreferences.isTrustedAccessibilityClient(true);
  await wait(200);
  await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
  return true;
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
    await wait(120);
    if (process.platform === "darwin") {
      await activateQuickInsertTarget();
      await wait(160);
      await runSystemCommand("/usr/bin/osascript", [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ]);
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
    if (process.platform === "darwin") {
      await showAccessibilityGuide(undefined, language);
    }
    return { ok: false, copied: true, needsAccessibility: process.platform === "darwin" };
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
  ipcMain.handle("prompt-cabinet:test-api-connection", testApiConnection);
  ipcMain.handle("prompt-cabinet:analyze-prompt", analyzePromptWithApi);
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
