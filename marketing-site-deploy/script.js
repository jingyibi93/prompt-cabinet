const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reducedMotion && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );

  document.querySelectorAll(".reveal, .feature-card, .workflow article").forEach((element) => observer.observe(element));
} else {
  document.querySelectorAll(".reveal, .feature-card, .workflow article").forEach((element) => element.classList.add("is-visible"));
}

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  });
});

const demoVideos = document.querySelectorAll(".feature-demo-video");

if ("IntersectionObserver" in window) {
  const demoObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    },
    { threshold: 0.2 },
  );
  demoVideos.forEach((video) => demoObserver.observe(video));
} else {
  demoVideos.forEach((video) => video.play().catch(() => {}));
}

const translations = {
  zh: {
    navFeatures: "功能", navPrivacy: "隐私", navDownload: "下载", headerDownload: "下载",
    heroEyebrow: "Prompt 更好，工作更快。", heroDownloadMac: "下载 Mac Beta", heroDownloadWindows: "下载 Windows Beta", heroInstall: "安装说明",
    compatibility: "适用于 Apple 芯片 Mac · Windows x64 · Beta 0.1.0-beta.3",
    languageSupport: "支持中文与英文",
    manifestoTitle: "一个喜欢的 Prompt，<br />值得被好好使用。",
    manifestoCopy: "从某一刻的灵感，到下一次真正派上用场。<br />Prompt Cabinet 让每一个好想法，都留在触手可及的地方。",
    heroTitle: "把喜欢的Prompt<br /><span>放在手边。</span>",
    heroCopy: "收集、整理、分析，再在需要的地方一键调用。<br />你的 Prompt，不该散落在聊天记录里。",
    organizeTitle: "不是收藏。<br />是成为资产。", organizeCopy: "自动补全标题、分类、标签和使用场景。下一次需要时，你知道该去哪里找。",
    rewriteTitle: "不止保存。<br />还能继续变好。", rewriteCopy: "从已有 Prompt 开始改写、精炼和复用。每一次调整，都成为下一次更快抵达结果的起点。",
    captureTitle: "看到喜欢的Prompt，<br />立即收下。", captureCopy: "在浏览器、聊天工具或任何工作流里，复制即可捕捉。灵感不需要等待整理的时机。",
    insertTitle: "需要时，<br />直接调用。", insertCopy: "在任何输入框中选取并插入你的最佳 Prompt。少一次翻找，多一次专注。",
    analysisTitle: "接入 API，<br />让整理更便捷。", analysisCopy: "选择你信任的模型，将原始 Prompt 快速提炼为标题、分类、标签、适用场景与可复用的结构化资产。模型、密钥和调用时机，都由你决定。",
    analysisPointOne: "结构化提炼", analysisPointTwo: "可选模型", analysisPointThree: "你的 API Key",
    importCaption: "批量导入", exportCaption: "批量导出", privacyTitle: "你的 Prompt，<br />首先属于你。",
    privacyCopy: "批量导入已有的积累，或一键导出完整资料库。你的 Prompt 默认保存在自己的电脑中，始终可控、可迁移。",
    privacyPointOne: "✓ 本地 JSON 存储", privacyPointTwo: "✓ 批量导入导出", privacyPointThree: "✓ 随时完整带走",
    installLabel: "三步开始", installTitle: "下载以后，<br />很快就能用。",
    installCopy: "当前 Beta 同时提供 Mac（Apple 芯片）和 Windows x64 版本。下面的图示主要展示 Mac 的安装流程；Windows 版下载后直接运行安装包即可。",
    installStepOneTitle: "选择对应安装包", installStepOneCopy: "Mac 点击 `.dmg`，Windows 点击 `.exe`。根据你的设备下载对应版本即可。",
    installStepTwoTitle: "Mac：拖入“应用程序”", installStepTwoCopy: "在安装窗口中，将左侧的 Prompt Cabinet 图标拖到右侧的 Applications 文件夹。",
    installDmgCaption: "把 Prompt Cabinet 拖入 Applications", installStepThreeTitle: "首次启动：右键选择“打开”",
    installStepThreeCopy: "打开“应用程序”，右键 Prompt Cabinet，选择“打开”。如仍被阻止，请前往“系统设置 > 隐私与安全性”选择“仍要打开”。",
    securitySettingsCaption: "系统设置 → 隐私与安全性 → 仍要打开", securityDialogCaption: "安全提示中再次点击“仍要打开”",
    insertNoteTitle: "第一次使用 Insert", insertNoteCopy: "按系统提示前往“系统设置 → 隐私与安全性 → 辅助功能”，打开 Prompt Cabinet 的权限，然后回到目标输入框再次点击 Insert。",
    accessibilityCaption: "系统设置 → 隐私与安全性 → 辅助功能 → 打开 Prompt Cabinet",
    downloadTitle: "给喜欢的 Prompt，<br />一个长久的位置。", downloadCopy: "免费 Beta 现已开放下载。Mac 和 Windows 都已提供。", downloadMacButton: "下载 Mac Beta", downloadWindowsButton: "下载 Windows Beta",
    githubStar: "觉得好用？去 GitHub 给 Prompt Cabinet 一个 Star", footerCopy: "Made for people who think with prompts.",
    documentTitle: "Prompt Cabinet — 你的桌面 Prompt 资料库", documentDescription: "Prompt Cabinet 是一款本地优先的桌面 Prompt 资料库。收集、整理、分析并随时调用你喜欢的 Prompt。",
  },
  en: {
    navFeatures: "Features", navPrivacy: "Your data", navDownload: "Download", headerDownload: "Download",
    heroEyebrow: "BETTER PROMPTS. FASTER WORK.", heroDownloadMac: "Download Mac Beta", heroDownloadWindows: "Download Windows Beta", heroInstall: "Installation guide",
    compatibility: "Apple silicon Macs · Windows x64 · Beta 0.1.0-beta.3",
    languageSupport: "Available in Chinese and English",
    manifestoTitle: "A Prompt you love<br />deserves to be used well.",
    manifestoCopy: "From a passing idea to the moment it matters.<br />Prompt Cabinet keeps every good thought within reach.",
    heroTitle: "Keep your favorite Prompts<br /><span>close at hand.</span>",
    heroCopy: "Collect, organize, analyze, then use them exactly where you need them.<br />Your Prompts should not be lost in chat history.",
    organizeTitle: "Not just saved.<br />Structured as assets.", organizeCopy: "Complete titles, categories, tags, and context automatically—so you know exactly where to find a Prompt next time.",
    rewriteTitle: "Beyond saving.<br />Make every Prompt better.", rewriteCopy: "Rewrite, refine, and reuse from an existing Prompt. Every improvement becomes a faster way to reach your next result.",
    captureTitle: "See a Prompt you love.<br />Capture it instantly.", captureCopy: "Copy from a browser, chat, or any workflow to capture it at once. Inspiration does not have to wait for a tidy moment.",
    insertTitle: "When you need it,<br />use it right away.", insertCopy: "Choose and insert your best Prompt into any input field. Less searching, more focus.",
    analysisTitle: "Connect your API,<br />organize with intelligence.", analysisCopy: "Use a model you trust to turn raw Prompts into structured, reusable assets with titles, categories, tags, and context. You choose the model, key, and moment of use.",
    analysisPointOne: "Structured extraction", analysisPointTwo: "Model of choice", analysisPointThree: "Your API key",
    importCaption: "Bulk import", exportCaption: "Bulk export", privacyTitle: "Your Prompts,<br />belong to you first.",
    privacyCopy: "Bring in what you have collected, or export your full library in one click. Your Prompts stay on your own computer—portable and always in your control.",
    privacyPointOne: "✓ Local JSON storage", privacyPointTwo: "✓ Bulk import & export", privacyPointThree: "✓ Take your full library anywhere",
    installLabel: "GET STARTED IN THREE STEPS", installTitle: "Download it,<br />then get to work.",
    installCopy: "This Beta is available for Apple silicon Macs and Windows x64. The steps below show the Mac flow; Windows installs by running the downloaded installer.",
    installStepOneTitle: "Choose the right installer", installStepOneCopy: "Download the `.dmg` for Mac or the `.exe` for Windows, depending on your machine.",
    installStepTwoTitle: "Mac: move it to Applications", installStepTwoCopy: "In the installer window, drag the Prompt Cabinet icon on the left to the Applications folder on the right.",
    installDmgCaption: "Drag Prompt Cabinet into Applications", installStepThreeTitle: "First launch: Control-click and choose Open",
    installStepThreeCopy: "Open Applications, Control-click Prompt Cabinet, then choose Open. If macOS still blocks it, go to System Settings > Privacy & Security and choose Open Anyway.",
    securitySettingsCaption: "System Settings → Privacy & Security → Open Anyway", securityDialogCaption: "Choose “Open Anyway” again in the security dialog",
    insertNoteTitle: "First time using Insert", insertNoteCopy: "Follow the prompt to System Settings → Privacy & Security → Accessibility, enable Prompt Cabinet, then return to the input field and select Insert again.",
    accessibilityCaption: "System Settings → Privacy & Security → Accessibility → Enable Prompt Cabinet",
    downloadTitle: "Give your favorite Prompts<br />a place that lasts.", downloadCopy: "The free Beta is ready to download. Both Mac and Windows builds are available.", downloadMacButton: "Download Mac Beta", downloadWindowsButton: "Download Windows Beta",
    githubStar: "Enjoying Prompt Cabinet? Give it a Star on GitHub", footerCopy: "Made for people who think with Prompts.",
    documentTitle: "Prompt Cabinet — Your desktop Prompt library", documentDescription: "A local-first desktop Prompt library for collecting, organizing, analyzing, and using your favorite Prompts.",
  },
};

const languageToggle = document.querySelector("#language-toggle");
const languageParam = new URLSearchParams(window.location.search).get("lang");
const storedLanguage = window.localStorage.getItem("prompt-cabinet-language");
let activeLanguage = languageParam === "en" || (!languageParam && (storedLanguage === "en" || (!storedLanguage && navigator.language.toLowerCase().startsWith("en")))) ? "en" : "zh";

function applyLanguage(language) {
  const copy = translations[language];
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const value = copy[element.dataset.i18n];
    if (typeof value === "string") element.textContent = value;
  });
  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    const value = copy[element.dataset.i18nHtml];
    if (typeof value === "string") element.innerHTML = value;
  });
  document.title = copy.documentTitle;
  document.querySelector('meta[name="description"]').setAttribute("content", copy.documentDescription);
  document.querySelector('meta[property="og:title"]').setAttribute("content", copy.documentTitle);
  document.querySelector('meta[property="og:description"]').setAttribute("content", copy.documentDescription);
  languageToggle.textContent = language === "en" ? "中文" : "EN";
  languageToggle.setAttribute("aria-label", language === "en" ? "切换为中文" : "Switch to English");
}

applyLanguage(activeLanguage);

languageToggle.addEventListener("click", () => {
  activeLanguage = activeLanguage === "en" ? "zh" : "en";
  window.localStorage.setItem("prompt-cabinet-language", activeLanguage);
  const url = new URL(window.location.href);
  if (activeLanguage === "en") url.searchParams.set("lang", "en");
  else url.searchParams.delete("lang");
  window.history.replaceState({}, "", url);
  applyLanguage(activeLanguage);
});
