"use strict";
const electron = require("electron");
const version = "1.0.0";
const packageJson = {
  version
};
function toIpcPayload(value) {
  return JSON.parse(JSON.stringify(value));
}
electron.contextBridge.exposeInMainWorld("characterArc", {
  /** 当前操作系统平台标识（如 'win32'、'darwin'） */
  platform: process.platform,
  /** 应用版本号 */
  version: packageJson.version,
  // ── 工作区持久化 ──
  /** 从 SQLite 加载当前项目的完整工作区快照 */
  loadWorkspace: () => electron.ipcRenderer.invoke("characterarc:load-workspace"),
  /** 将完整工作区快照写入 SQLite（全量覆盖写） */
  saveWorkspace: (payload) => electron.ipcRenderer.invoke("characterarc:save-workspace", toIpcPayload(payload)),
  // ── 文件操作 ──
  /** 打开系统文件选择对话框，选取项目封面图片 */
  pickCoverImage: () => electron.ipcRenderer.invoke("characterarc:pick-cover-image"),
  /** 将当前项目导出为 JSON 文件 */
  exportJson: (payload) => electron.ipcRenderer.invoke("characterarc:export-json", toIpcPayload(payload)),
  /** 将当前项目导出为纯文本文件 */
  exportText: (payload) => electron.ipcRenderer.invoke("characterarc:export-text", toIpcPayload(payload)),
  /** 从 JSON 文件导入项目数据 */
  importJson: () => electron.ipcRenderer.invoke("characterarc:import-json"),
  /** 导入参考小说并执行拆书分析 */
  importReferenceNovelAnalysis: (payload) => electron.ipcRenderer.invoke("characterarc:import-reference-novel-analysis", toIpcPayload(payload)),
  /** 扫描当前项目目录下的 .project-skills/ */
  scanProjectSkills: () => electron.ipcRenderer.invoke("characterarc:project-skills-scan"),
  /** 读取当前项目已安装 skills 的正文内容（供 AI 内部使用） */
  getProjectSkillsContext: () => electron.ipcRenderer.invoke("characterarc:project-skills-context"),
  // ── AI 任务 ──
  /** 发送一次非流式 AI 生成请求，返回完整结果 */
  generateAi: (payload) => electron.ipcRenderer.invoke("characterarc:ai-generate", toIpcPayload(payload)),
  /** 发起流式 AI 请求，返回 streamId 用于后续事件监听和停止 */
  startAiStream: (payload) => electron.ipcRenderer.invoke("characterarc:ai-stream-start", toIpcPayload(payload)),
  /** 通过 streamId 中断正在进行的流式 AI 请求 */
  stopAiStream: (streamId) => electron.ipcRenderer.invoke("characterarc:ai-stream-stop", streamId),
  /** 监听流式 AI 的增量文本事件，返回取消监听的清理函数 */
  onAiStreamEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("characterarc:ai-stream-event", listener);
    return () => {
      electron.ipcRenderer.removeListener("characterarc:ai-stream-event", listener);
    };
  },
  /** 测试 AI 连接是否通畅，发送探测请求验证鉴权和网络 */
  testAiConnection: (settings) => electron.ipcRenderer.invoke("characterarc:ai-test-connection", toIpcPayload(settings)),
  /** 获取 AI 供应商的可用模型列表 */
  fetchModels: (settings) => electron.ipcRenderer.invoke("characterarc:ai-fetch-models", toIpcPayload(settings)),
  // ── 缩放控制 ──
  /** 设置渲染进程页面缩放比例 */
  setZoomFactor: (factor) => electron.ipcRenderer.invoke("characterarc:set-zoom-factor", factor),
  /** 获取当前渲染进程页面缩放比例 */
  getZoomFactor: () => electron.ipcRenderer.invoke("characterarc:get-zoom-factor"),
  // ── 助手窗口管理 ──
  /** 打开浮动 AI 助手窗口 */
  openAssistantWindow: () => electron.ipcRenderer.invoke("characterarc:assistant-window-open"),
  /** 关闭浮动 AI 助手窗口 */
  closeAssistantWindow: () => electron.ipcRenderer.invoke("characterarc:assistant-window-close"),
  /** 查询助手窗口是否打开 */
  getAssistantWindowState: () => electron.ipcRenderer.invoke("characterarc:assistant-window-state"),
  /** 主窗口向助手窗口推送当前选中的项目/章节上下文 */
  publishAssistantContext: (payload) => electron.ipcRenderer.invoke("characterarc:assistant-context-publish", toIpcPayload(payload)),
  /** 助手窗口拉取最新的上下文信息 */
  getAssistantContext: () => electron.ipcRenderer.invoke("characterarc:assistant-context-get"),
  /** 主窗口向助手窗口发送用户提示词请求 */
  publishAssistantPrompt: (payload) => electron.ipcRenderer.invoke("characterarc:assistant-prompt-publish", toIpcPayload(payload)),
  /** 助手窗口拉取最新的提示词请求 */
  getAssistantPrompt: () => electron.ipcRenderer.invoke("characterarc:assistant-prompt-get"),
  /** 标记某条提示词请求已消费，避免重复处理 */
  clearAssistantPrompt: (promptId) => electron.ipcRenderer.invoke("characterarc:assistant-prompt-clear", promptId),
  /** 主窗口向助手窗口广播工作区数据同步 */
  publishWorkspaceSync: (payload) => electron.ipcRenderer.invoke("characterarc:workspace-sync-publish", toIpcPayload(payload)),
  /** 主窗口向助手窗口发送命令（如插入正文等） */
  publishAssistantCommand: (payload) => electron.ipcRenderer.invoke("characterarc:assistant-command-publish", toIpcPayload(payload)),
  // ── 事件监听（返回清理函数，组件卸载时调用以移除监听） ──
  /** 监听助手窗口可见性变化事件 */
  onAssistantWindowVisibility: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("characterarc:assistant-window-visibility", listener);
    return () => {
      electron.ipcRenderer.removeListener("characterarc:assistant-window-visibility", listener);
    };
  },
  /** 监听主窗口推送的上下文更新事件 */
  onAssistantContext: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("characterarc:assistant-context", listener);
    return () => {
      electron.ipcRenderer.removeListener("characterarc:assistant-context", listener);
    };
  },
  /** 监听主窗口推送的提示词请求事件 */
  onAssistantPrompt: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("characterarc:assistant-prompt", listener);
    return () => {
      electron.ipcRenderer.removeListener("characterarc:assistant-prompt", listener);
    };
  },
  /** 监听工作区数据同步事件（用于助手窗口实时获取主窗口的最新数据） */
  onWorkspaceSync: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("characterarc:workspace-sync-event", listener);
    return () => {
      electron.ipcRenderer.removeListener("characterarc:workspace-sync-event", listener);
    };
  },
  /** 监听参考小说拆书分析进度 */
  onReferenceImportProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("characterarc:reference-import-progress", listener);
    return () => {
      electron.ipcRenderer.removeListener("characterarc:reference-import-progress", listener);
    };
  },
  /** 监听主窗口发送的命令事件（如将 AI 结果插入正文） */
  onAssistantCommand: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("characterarc:assistant-command", listener);
    return () => {
      electron.ipcRenderer.removeListener("characterarc:assistant-command", listener);
    };
  }
});
