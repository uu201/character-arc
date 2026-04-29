"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("characterArc", {
  platform: process.platform,
  version: "0.1.0",
  loadWorkspace: () => electron.ipcRenderer.invoke("characterarc:load-workspace"),
  saveWorkspace: (payload) => electron.ipcRenderer.invoke("characterarc:save-workspace", payload),
  pickCoverImage: () => electron.ipcRenderer.invoke("characterarc:pick-cover-image"),
  generateAi: (payload) => electron.ipcRenderer.invoke("characterarc:ai-generate", payload),
  startAiStream: (payload) => electron.ipcRenderer.invoke("characterarc:ai-stream-start", payload),
  stopAiStream: (streamId) => electron.ipcRenderer.invoke("characterarc:ai-stream-stop", streamId),
  onAiStreamEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("characterarc:ai-stream-event", listener);
    return () => {
      electron.ipcRenderer.removeListener("characterarc:ai-stream-event", listener);
    };
  },
  testAiConnection: (settings) => electron.ipcRenderer.invoke("characterarc:ai-test-connection", settings),
  exportJson: (payload) => electron.ipcRenderer.invoke("characterarc:export-json", payload),
  exportText: (payload) => electron.ipcRenderer.invoke("characterarc:export-text", payload),
  setZoomFactor: (factor) => electron.ipcRenderer.invoke("characterarc:set-zoom-factor", factor),
  getZoomFactor: () => electron.ipcRenderer.invoke("characterarc:get-zoom-factor"),
  importJson: () => electron.ipcRenderer.invoke("characterarc:import-json")
});
