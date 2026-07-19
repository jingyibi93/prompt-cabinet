const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("promptCabinetStorage", {
  loadPrompts: () => ipcRenderer.invoke("prompt-cabinet:load-prompts"),
  savePrompts: (prompts) => ipcRenderer.invoke("prompt-cabinet:save-prompts", prompts),
  getDataPath: () => ipcRenderer.invoke("prompt-cabinet:get-data-path"),
  onPromptsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("prompt-cabinet:prompts-changed", listener);
    return () => ipcRenderer.removeListener("prompt-cabinet:prompts-changed", listener);
  },
});

contextBridge.exposeInMainWorld("promptCabinetApi", {
  loadSettings: () => ipcRenderer.invoke("prompt-cabinet:load-api-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("prompt-cabinet:save-api-settings", settings),
  testConnection: (settings) => ipcRenderer.invoke("prompt-cabinet:test-api-connection", settings),
  analyzePrompt: (payload) => ipcRenderer.invoke("prompt-cabinet:analyze-prompt", payload),
});

contextBridge.exposeInMainWorld("promptCabinetWindow", {
  getAlwaysOnTop: () => ipcRenderer.invoke("prompt-cabinet:get-always-on-top"),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("prompt-cabinet:set-always-on-top", enabled),
  loadShortcuts: () => ipcRenderer.invoke("prompt-cabinet:load-shortcuts"),
  saveShortcuts: (shortcuts) => ipcRenderer.invoke("prompt-cabinet:save-shortcuts", shortcuts),
  setQuickAddMode: (mode) => ipcRenderer.invoke("prompt-cabinet:set-quick-add-mode", mode),
  readClipboardText: () => ipcRenderer.invoke("prompt-cabinet:read-clipboard-text"),
  readClipboardImage: () => ipcRenderer.invoke("prompt-cabinet:read-clipboard-image"),
  insertText: (text, language) => ipcRenderer.invoke("prompt-cabinet:insert-text", text, language),
  openQuickAdd: () => ipcRenderer.invoke("prompt-cabinet:open-quick-add"),
  closeCurrentWindow: () => ipcRenderer.invoke("prompt-cabinet:close-current-window"),
  onQuickAddSaveShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("prompt-cabinet:quick-add-save-shortcut", listener);
    return () => ipcRenderer.removeListener("prompt-cabinet:quick-add-save-shortcut", listener);
  },
  onQuickAddModeShortcut: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on("prompt-cabinet:quick-add-mode-shortcut", listener);
    return () => ipcRenderer.removeListener("prompt-cabinet:quick-add-mode-shortcut", listener);
  },
  onQuickAddCommandShortcut: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("prompt-cabinet:quick-add-command-shortcut", listener);
    return () => ipcRenderer.removeListener("prompt-cabinet:quick-add-command-shortcut", listener);
  },
  onQuickAddShortcutsChanged: (callback) => {
    const listener = (_event, shortcuts) => callback(shortcuts);
    ipcRenderer.on("prompt-cabinet:quick-add-shortcuts-changed", listener);
    return () => ipcRenderer.removeListener("prompt-cabinet:quick-add-shortcuts-changed", listener);
  },
});
