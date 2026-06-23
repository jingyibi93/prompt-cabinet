const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("promptCabinetStorage", {
  loadPrompts: () => ipcRenderer.invoke("prompt-cabinet:load-prompts"),
  savePrompts: (prompts) => ipcRenderer.invoke("prompt-cabinet:save-prompts", prompts),
  getDataPath: () => ipcRenderer.invoke("prompt-cabinet:get-data-path"),
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
});
