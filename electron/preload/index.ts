import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 将主进程 IPC 方法安全地暴露给渲染进程
// 所有方法通过 window.characterArc 对象调用，主进程和助手窗口共享同一接口
contextBridge.exposeInMainWorld('characterArc', {
  /** 当前操作系统平台标识（如 'win32'、'darwin'） */
  platform: process.platform,
  /** 应用版本号 */
  version: '0.1.0',

  // ── 工作区持久化 ──
  /** 从 SQLite 加载当前项目的完整工作区快照 */
  loadWorkspace: () => ipcRenderer.invoke('characterarc:load-workspace'),
  /** 将完整工作区快照写入 SQLite（全量覆盖写） */
  saveWorkspace: (payload: unknown) => ipcRenderer.invoke('characterarc:save-workspace', payload),

  // ── 文件操作 ──
  /** 打开系统文件选择对话框，选取项目封面图片 */
  pickCoverImage: () => ipcRenderer.invoke('characterarc:pick-cover-image'),
  /** 将当前项目导出为 JSON 文件 */
  exportJson: (payload: unknown) => ipcRenderer.invoke('characterarc:export-json', payload),
  /** 将当前项目导出为纯文本文件 */
  exportText: (payload: unknown) => ipcRenderer.invoke('characterarc:export-text', payload),
  /** 从 JSON 文件导入项目数据 */
  importJson: () => ipcRenderer.invoke('characterarc:import-json'),
  /** 扫描当前项目目录下的 .project-skills/ */
  scanProjectSkills: () => ipcRenderer.invoke('characterarc:project-skills-scan'),
  /** 读取当前项目已安装 skills 的正文内容（供 AI 内部使用） */
  getProjectSkillsContext: () => ipcRenderer.invoke('characterarc:project-skills-context'),

  // ── AI 任务 ──
  /** 发送一次非流式 AI 生成请求，返回完整结果 */
  generateAi: (payload: unknown) => ipcRenderer.invoke('characterarc:ai-generate', payload),
  /** 发起流式 AI 请求，返回 streamId 用于后续事件监听和停止 */
  startAiStream: (payload: unknown) => ipcRenderer.invoke('characterarc:ai-stream-start', payload),
  /** 通过 streamId 中断正在进行的流式 AI 请求 */
  stopAiStream: (streamId: string) => ipcRenderer.invoke('characterarc:ai-stream-stop', streamId),
  /** 监听流式 AI 的增量文本事件，返回取消监听的清理函数 */
  onAiStreamEvent: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:ai-stream-event', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:ai-stream-event', listener)
    }
  },
  /** 测试 AI 连接是否通畅，发送探测请求验证鉴权和网络 */
  testAiConnection: (settings: unknown) => ipcRenderer.invoke('characterarc:ai-test-connection', settings),

  // ── 缩放控制 ──
  /** 设置渲染进程页面缩放比例 */
  setZoomFactor: (factor: number) => ipcRenderer.invoke('characterarc:set-zoom-factor', factor),
  /** 获取当前渲染进程页面缩放比例 */
  getZoomFactor: () => ipcRenderer.invoke('characterarc:get-zoom-factor'),

  // ── 助手窗口管理 ──
  /** 打开浮动 AI 助手窗口 */
  openAssistantWindow: () => ipcRenderer.invoke('characterarc:assistant-window-open'),
  /** 关闭浮动 AI 助手窗口 */
  closeAssistantWindow: () => ipcRenderer.invoke('characterarc:assistant-window-close'),
  /** 查询助手窗口是否打开 */
  getAssistantWindowState: () => ipcRenderer.invoke('characterarc:assistant-window-state'),
  /** 主窗口向助手窗口推送当前选中的项目/章节上下文 */
  publishAssistantContext: (payload: unknown) => ipcRenderer.invoke('characterarc:assistant-context-publish', payload),
  /** 助手窗口拉取最新的上下文信息 */
  getAssistantContext: () => ipcRenderer.invoke('characterarc:assistant-context-get'),
  /** 主窗口向助手窗口发送用户提示词请求 */
  publishAssistantPrompt: (payload: unknown) => ipcRenderer.invoke('characterarc:assistant-prompt-publish', payload),
  /** 助手窗口拉取最新的提示词请求 */
  getAssistantPrompt: () => ipcRenderer.invoke('characterarc:assistant-prompt-get'),
  /** 标记某条提示词请求已消费，避免重复处理 */
  clearAssistantPrompt: (promptId: string) => ipcRenderer.invoke('characterarc:assistant-prompt-clear', promptId),
  /** 主窗口向助手窗口广播工作区数据同步 */
  publishWorkspaceSync: (payload: unknown) => ipcRenderer.invoke('characterarc:workspace-sync-publish', payload),
  /** 主窗口向助手窗口发送命令（如插入正文等） */
  publishAssistantCommand: (payload: unknown) => ipcRenderer.invoke('characterarc:assistant-command-publish', payload),

  // ── 事件监听（返回清理函数，组件卸载时调用以移除监听） ──
  /** 监听助手窗口可见性变化事件 */
  onAssistantWindowVisibility: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:assistant-window-visibility', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:assistant-window-visibility', listener)
    }
  },
  /** 监听主窗口推送的上下文更新事件 */
  onAssistantContext: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:assistant-context', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:assistant-context', listener)
    }
  },
  /** 监听主窗口推送的提示词请求事件 */
  onAssistantPrompt: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:assistant-prompt', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:assistant-prompt', listener)
    }
  },
  /** 监听工作区数据同步事件（用于助手窗口实时获取主窗口的最新数据） */
  onWorkspaceSync: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:workspace-sync-event', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:workspace-sync-event', listener)
    }
  },
  /** 监听主窗口发送的命令事件（如将 AI 结果插入正文） */
  onAssistantCommand: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:assistant-command', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:assistant-command', listener)
    }
  }
})
