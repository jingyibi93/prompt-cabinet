const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const dataFileName = "prompt-cabinet-data.json";
const settingsFileName = "prompt-cabinet-settings.json";
const windowSettingsFileName = "prompt-cabinet-window.json";
const validCategories = ["Design", "Writing", "Research", "Coding", "Image", "Video", "Career", "Product"];
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

async function writePromptData(prompts) {
  const payload = {
    app: "Prompt Cabinet",
    version: 1,
    savedAt: new Date().toISOString(),
    prompts: Array.isArray(prompts) ? prompts : [],
  };
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(getDataFilePath(), JSON.stringify(payload, null, 2), "utf8");
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
  return {
    alwaysOnTop: Boolean(settings?.alwaysOnTop),
  };
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

  const response = await fetch(buildChatCompletionsUrl(normalized.baseUrl), {
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
  const settings = normalizeApiSettings(payload?.settings);
  if (!settings.enabled || settings.provider === "mock") {
    throw new Error("Enhanced Analyze is disabled.");
  }

  const instruction = buildAnalyzeInstruction(rawPrompt, notes);
  const result = settings.provider === "codex-local"
    ? await callLocalCodex(settings, instruction, analyzeOutputSchema)
    : await callChatCompletions(
        settings,
        [
          { role: "system", content: buildAnalyzeSystemPrompt() },
          {
            role: "user",
            content: `Raw Prompt:\n${rawPrompt}\n\nNotes:\n${notes || "Not provided."}`,
          },
        ],
        0.2,
      );

  return normalizeAnalyzeResult(result, rawPrompt);
}

function buildAnalyzeSystemPrompt() {
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
    "Keep title short, clear, and scannable, 2-6 words when possible.",
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

function buildAnalyzeInstruction(rawPrompt, notes) {
  return [
    buildAnalyzeSystemPrompt(),
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
    codex = new Codex();
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

function normalizeAnalyzeResult(result, rawPrompt) {
  const category = normalizeCategory(result?.category, rawPrompt);
  return {
    title: typeof result?.title === "string" && result.title.trim() ? result.title.trim() : "Untitled Prompt",
    category,
    tags: Array.isArray(result?.tags) ? result.tags.map(String).filter(Boolean).slice(0, 8) : [category],
    platform: normalizePlatform(result?.platform, category),
    useCase: typeof result?.useCase === "string" && result.useCase.trim() ? result.useCase.trim() : "Saved prompt for future reuse.",
    inputNeeded: Array.isArray(result?.inputNeeded) ? result.inputNeeded.map(String).filter(Boolean).slice(0, 10) : [],
    expectedOutput: typeof result?.expectedOutput === "string" && result.expectedOutput.trim()
      ? result.expectedOutput.trim()
      : "Reusable prompt output.",
    refinedPrompt: rawPrompt,
  };
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
  const mainWindow = new BrowserWindow({
    width: 1220,
    height: 860,
    x: 80,
    y: 80,
    minWidth: 980,
    minHeight: 680,
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

  mainWindow.setAlwaysOnTop(windowSettings.alwaysOnTop, "floating");
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
  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  ipcMain.handle("prompt-cabinet:load-prompts", readPromptData);
  ipcMain.handle("prompt-cabinet:save-prompts", (_event, prompts) => writePromptData(prompts));
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
    if (window) window.setAlwaysOnTop(nextValue, "floating");
    await writeWindowSettings({ alwaysOnTop: nextValue });
    return nextValue;
  });

  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
