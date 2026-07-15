import { contextBridge, ipcRenderer } from 'electron'
import packageJson from '../../package.json'
import { IPC_CHANNELS, type SaveAppSettingsRequest } from '@shared/ipc-types'

function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 通过 contextBridge 将主进程 IPC 方法安全地暴露给渲染进程
// 所有方法通过 window.characterArc 对象调用，主进程和助手窗口共享同一接口
contextBridge.exposeInMainWorld('characterArc', {
  /** 当前操作系统平台标识（如 'win32'、'darwin'） */
  platform: process.platform,
  /** 应用版本号 */
  version: packageJson.version,

  // ── 工作区持久化 ──
  /** 从 SQLite 加载当前项目的完整工作区快照 */
  loadWorkspace: () => ipcRenderer.invoke('characterarc:load-workspace'),
  /** 将完整工作区快照写入 SQLite（全量覆盖写） */
  saveWorkspace: (payload: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_WORKSPACE, toIpcPayload(payload)),
  /** 仅更新 app_settings 行，避免全量序列化工作区 */
  saveAppSettings: (payload: SaveAppSettingsRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_APP_SETTINGS, toIpcPayload(payload)),

  // ── 文件操作 ──
  /** 打开系统文件选择对话框，选取项目封面图片 */
  pickCoverImage: () => ipcRenderer.invoke('characterarc:pick-cover-image'),
  /** 将当前项目导出为 JSON 文件 */
  exportJson: (payload: unknown) => ipcRenderer.invoke('characterarc:export-json', toIpcPayload(payload)),
  /** 将当前项目导出为 .carc 项目归档包 */
  exportProjectArchive: (payload: unknown) => ipcRenderer.invoke('characterarc:export-project-archive', toIpcPayload(payload)),
  /** 选择并预览 .carc 项目归档包 */
  inspectProjectArchive: () => ipcRenderer.invoke('characterarc:inspect-project-archive'),
  /** 按指定模式导入 .carc 项目归档包 */
  importProjectArchive: (payload: unknown) => ipcRenderer.invoke('characterarc:import-project-archive', toIpcPayload(payload)),
  /** 将当前项目导出为纯文本文件 */
  exportText: (payload: unknown) => ipcRenderer.invoke('characterarc:export-text', toIpcPayload(payload)),
  /** 将单个章节导出为 TXT */
  exportChapterTxt: (payload: unknown) => ipcRenderer.invoke('characterarc:export-chapter-txt', toIpcPayload(payload)),
  /** 将单个章节导出为 DOCX */
  exportChapterDocx: (payload: unknown) => ipcRenderer.invoke('characterarc:export-chapter-docx', toIpcPayload(payload)),
  /** 从 JSON 文件导入项目数据 */
  importJson: () => ipcRenderer.invoke('characterarc:import-json'),
  /** 读取 Excel/CSV 大纲文件并返回二维表数据 */
  importOutlineSpreadsheet: () => ipcRenderer.invoke('characterarc:import-outline-spreadsheet'),
  /** 下载标准大纲 Excel 模板 */
  exportOutlineTemplate: () => ipcRenderer.invoke('characterarc:export-outline-template'),
  /** 将当前项目大纲导出为 Excel */
  exportOutlineSpreadsheet: (payload: unknown) => ipcRenderer.invoke('characterarc:export-outline-spreadsheet', toIpcPayload(payload)),
  /** 导入参考小说并执行拆书分析 */
  importReferenceNovelAnalysis: (payload: unknown) => ipcRenderer.invoke('characterarc:import-reference-novel-analysis', toIpcPayload(payload)),
  /** 批量导入多本参考小说并发拆书分析 */
  importReferenceNovelBatch: (payload: unknown) => ipcRenderer.invoke('characterarc:import-reference-novel-batch', toIpcPayload(payload)),
  /** 打开文件选择对话框，返回选中的文件列表（不立即开始拆书） */
  pickReferenceNovelFiles: () => ipcRenderer.invoke('characterarc:pick-reference-novel-files'),
  /** 取消单本或全部正在进行的批量拆书任务 */
  cancelReferenceNovelBook: (bookId?: string) => ipcRenderer.invoke('characterarc:cancel-reference-novel-book', bookId ?? ''),
  /** 读取已保存的参考小说原文（用于风格指纹提取等） */
  readReferenceNovelText: (refId: string) => ipcRenderer.invoke('characterarc:read-reference-novel-text', refId),
  /** 加载当前项目可用的 skills（软件内置 + 项目扩展） */
  scanProjectSkills: (projectId: string) => ipcRenderer.invoke('characterarc:project-skills-scan', projectId),
  /** 从本地目录导入一组项目扩展 skills 到应用数据目录 */
  importProjectSkillsPackage: (projectId: string) => ipcRenderer.invoke('characterarc:project-skills-import', projectId),
  /** 读取当前项目可用 skills 的正文内容（供 AI 内部使用） */
  getProjectSkillsContext: (projectId: string) => ipcRenderer.invoke('characterarc:project-skills-context', projectId),

  // ── AI 任务 ──
  /** 发送一次非流式 AI 生成请求，返回完整结果 */
  generateAi: (payload: unknown) => ipcRenderer.invoke('characterarc:ai-generate', toIpcPayload(payload)),
  /** 取消一个正在进行的非流式 AI 任务（按 clientTaskId） */
  cancelAiTask: (clientTaskId: string) => ipcRenderer.invoke('characterarc:ai-cancel', clientTaskId),
  /** 发起流式 AI 请求，返回 streamId 用于后续事件监听和停止 */
  startAiStream: (payload: unknown) => ipcRenderer.invoke('characterarc:ai-stream-start', toIpcPayload(payload)),
  /** 通过 streamId 中断正在进行的流式 AI 请求 */
  stopAiStream: (streamId: string) => ipcRenderer.invoke('characterarc:ai-stream-stop', streamId),
  /** 发起 Agent 流式请求（带工具调用），返回 streamId */
  startAiAgentStream: (payload: unknown) => ipcRenderer.invoke('characterarc:ai-agent-stream-start', toIpcPayload(payload)),
  /** 从 DB 重新读取单个章节内容（agent 编辑后刷新用） */
  readChapterFromDb: (projectId: string, chapterId: string) => ipcRenderer.invoke('characterarc:ai-read-chapter', { projectId, chapterId }),
  /** 从 DB 读取章节版本（agent 编辑撤销用） */
  readChapterVersionFromDb: (projectId: string, versionId: string) => ipcRenderer.invoke('characterarc:ai-read-chapter-version', { projectId, versionId }),
  /** 提交章节编辑提案（diff review 确认写回） */
  commitChapterEdit: (projectId: string, chapterId: string, oldContent: string, newContent: string) => ipcRenderer.invoke('characterarc:commit-chapter-edit', { projectId, chapterId, oldContent, newContent }),
  /** 监听流式 AI 的增量文本事件，返回取消监听的清理函数 */
  onAiStreamEvent: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:ai-stream-event', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:ai-stream-event', listener)
    }
  },
  /** 监听 AI 运行记录事件 */
  onAiRunEvent: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:ai-run-event', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:ai-run-event', listener)
    }
  },
  /** 监听章节轻检告警事件（章节生成后的异步后处理流水线产出） */
  onChapterStateWarnings: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:chapter-state-warnings', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:chapter-state-warnings', listener)
    }
  },
  /** 监听章节生成后处理问题事件（状态提取/语义索引/流水线故障） */
  onChapterPostGenerationIssues: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:chapter-post-generation-issues', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:chapter-post-generation-issues', listener)
    }
  },
  /** 测试 AI 连接是否通畅，发送探测请求验证鉴权和网络 */
  testAiConnection: (settings: unknown) => ipcRenderer.invoke('characterarc:ai-test-connection', toIpcPayload(settings)),
  /** 获取 AI 供应商的可用模型列表 */
  fetchModels: (settings: unknown) => ipcRenderer.invoke('characterarc:ai-fetch-models', toIpcPayload(settings)),
  /** 获取图片生成接口的可用模型列表 */
  fetchImageModels: (settings: unknown) => ipcRenderer.invoke('characterarc:ai-fetch-image-models', toIpcPayload(settings)),
  /** 生成封面图片 */
  generateImage: (payload: unknown) => ipcRenderer.invoke('characterarc:ai-generate-image', toIpcPayload(payload)),
  /** 读取当前项目的结构化世界状态（角色状态、伏笔、关系、时间线、世界规则、倒计时） */
  readStoryState: (projectId: string) => ipcRenderer.invoke('characterarc:ai-read-story-state', projectId),
  /** 螺旋式深度生成（3圈：骨架→展开→校验） */
  spiralBootstrap: (payload: unknown) => ipcRenderer.invoke('characterarc:ai-spiral-bootstrap', toIpcPayload(payload)),
  /** 取消正在进行的螺旋生成 */
  cancelSpiralBootstrap: () => ipcRenderer.invoke('characterarc:ai-spiral-cancel'),
  /** 监听螺旋生成进度事件 */
  onSpiralProgress: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:ai-spiral-progress', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:ai-spiral-progress', listener)
    }
  },
  /** 触发"从已有章节补录项目状态库"任务，返回汇总结果 */
  backfillProjectState: (payload: unknown) => ipcRenderer.invoke('characterarc:ai-backfill-state', toIpcPayload(payload)),
  /** 监听状态补录进度事件 */
  onBackfillStateProgress: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:ai-backfill-state-progress', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:ai-backfill-state-progress', listener)
    }
  },
  /** 保存封面图片到本地文件 */
  saveCoverImage: (payload: unknown) => ipcRenderer.invoke('characterarc:save-cover-image', toIpcPayload(payload)),

  // ── 缩放控制 ──
  /** 设置渲染进程页面缩放比例 */
  setZoomFactor: (factor: number) => ipcRenderer.invoke('characterarc:set-zoom-factor', factor),
  /** 获取当前渲染进程页面缩放比例 */
  getZoomFactor: () => ipcRenderer.invoke('characterarc:get-zoom-factor'),
  /** 动态更新 Windows 原生标题栏 Overlay 颜色（随深色/浅色模式切换） */
  setTitleBarOverlay: (options: { color: string; symbolColor: string }) =>
    ipcRenderer.invoke('characterarc:set-titlebar-overlay', options),

  // ── 工作区同步 ──
  /** 广播工作区数据同步 */
  publishWorkspaceSync: (payload: unknown) => ipcRenderer.invoke('characterarc:workspace-sync-publish', toIpcPayload(payload)),

  // ── 事件监听（返回清理函数，组件卸载时调用以移除监听） ──
  /** 监听工作区数据同步事件 */
  onWorkspaceSync: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:workspace-sync-event', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:workspace-sync-event', listener)
    }
  },
  /** 监听参考小说拆书分析进度 */
  onReferenceImportProgress: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:reference-import-progress', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:reference-import-progress', listener)
    }
  },
  /** 监听项目备份导入进度 */
  onProjectArchiveImportProgress: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('characterarc:project-archive-import-progress', listener)
    return () => {
      ipcRenderer.removeListener('characterarc:project-archive-import-progress', listener)
    }
  },

  // ── AI 助手会话 ──
  listSessions: (projectId: string) => ipcRenderer.invoke('characterarc:session-list', projectId),
  loadSession: (sessionId: string) => ipcRenderer.invoke('characterarc:session-load', sessionId),
  saveSession: (payload: {
    id: string
    projectId: string
    title: string
    messages: unknown[]
    proposal?: unknown | null
    lastProposalPrompt?: string
    lastAssistantReply?: string
  }) =>
    ipcRenderer.invoke('characterarc:session-save', toIpcPayload(payload)),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('characterarc:session-delete', sessionId),

  // ── 检查更新 & 公告 ──
  checkUpdate: () => ipcRenderer.invoke('characterarc:check-update'),
  fetchAnnouncements: () => ipcRenderer.invoke('characterarc:fetch-announcements'),
  openExternalUrl: (url: string) => ipcRenderer.invoke('characterarc:open-external-url', url),

  // ── 番茄风向标 ──
  /** 抓取番茄风向标榜单数据（主进程带本地缓存，force=true 时强制刷新） */
  fetchFanqieTrends: (path: string, force = false) =>
    ipcRenderer.invoke('characterarc:fanqie-trends-fetch', { path, force }),

  // ── Assistant Runtime v2 ──
  /**
   * 全新一代 AI 助手运行时。命名空间 `characterarc:assistant:*`，
   * 与旧的 `ai:*` 通道并存。Phase 1 阶段：Session/Stage 类可用，
   * Turn 类需 Phase 2 后端注入 executionPlan + committer 才能真正响应。
   */
  assistant: {
    // Session
    sessionList: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:session:list', toIpcPayload(payload)),
    sessionCreate: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:session:create', toIpcPayload(payload)),
    sessionDelete: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:session:delete', toIpcPayload(payload)),
    sessionLoad: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:session:load', toIpcPayload(payload)),
    sessionRename: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:session:rename', toIpcPayload(payload)),
    // Turn
    turnSend: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:turn:send', toIpcPayload(payload)),
    turnCancel: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:turn:cancel', toIpcPayload(payload)),
    // Stage
    stageList: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:stage:list', toIpcPayload(payload)),
    stageAccept: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:stage:accept', toIpcPayload(payload)),
    stageReject: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:stage:reject', toIpcPayload(payload)),
    stageCommit: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:stage:commit', toIpcPayload(payload)),
    stageBindTarget: (payload: unknown) =>
      ipcRenderer.invoke('characterarc:assistant:stage:bind-target', toIpcPayload(payload)),
    /** 订阅主进程推送的 TurnEvent 流。返回 unsubscribe 函数。 */
    onEvent: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('characterarc:assistant:event:stream', listener)
      return () => {
        ipcRenderer.removeListener('characterarc:assistant:event:stream', listener)
      }
    }
  }
})
