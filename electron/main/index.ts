import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell } from 'electron'
import { basename, join } from 'node:path'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  generateAiTask,
  streamAiTask,
  testAiConnection,
  type AiTaskPayload
} from './ai'

import { fetchModels, type FetchedModel } from './aiTransport'
import {
  extractReferenceNovelContext,
  type ReferenceNovelLocalContext,
  type ReferenceStyleMetric
} from './referenceAnalysis'
import type { ReferenceStyleAnalysisResult, ReferenceStyleChunkResult } from './aiShared'

type KnowledgeDocumentSourceType = 'reference-summary' | 'reference-chunk' | 'workflow-document' | 'canon-fact' | 'chapter-summary'

type WorkspaceKnowledgeDocument = {
  id: string
  projectId: string
  title: string
  sourceType: KnowledgeDocumentSourceType
  sourceLabel: string
  content: string
  summary: string
  keywords: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

type WorkspaceAiRunKnowledgeItem = {
  documentId: string
  title: string
  sourceType: KnowledgeDocumentSourceType
  sourceLabel: string
  snippet: string
  keywords: string[]
}

type WorkspaceAiRunStatus = 'running' | 'success' | 'error' | 'canceled'

type WorkspaceAiRunRecord = {
  id: string
  projectId: string
  chapterId?: string
  task: string
  provider: string
  model: string
  status: WorkspaceAiRunStatus
  startedAt: string
  finishedAt?: string
  durationMs?: number
  usedKnowledge: WorkspaceAiRunKnowledgeItem[]
  repairTriggered: boolean
  error: string
  responsePreview: string
}

// ── 窗口尺寸常量 ──
const APP_DEFAULT_WIDTH = 1480     // 主窗口默认宽度
const APP_DEFAULT_HEIGHT = 920     // 主窗口默认高度
const APP_MIN_WIDTH = 1120         // 主窗口最小宽度
const APP_MIN_HEIGHT = 720         // 主窗口最小高度
const ASSISTANT_WINDOW_WIDTH = 580 // 助手窗口宽度
const ASSISTANT_WINDOW_HEIGHT = 820
const ASSISTANT_WINDOW_MIN_WIDTH = 460
const ASSISTANT_WINDOW_MIN_HEIGHT = 620
const WORKSPACE_DB = 'workspace.db'    // SQLite 数据库文件名
const WORKSPACE_FILE = 'workspace.json' // 旧版 JSON 工作区文件名（迁移用）
// 当前活跃的流式 AI 请求映射表，streamId → AbortController
const activeAiStreams = new Map<string, AbortController>()
let mainWindow: BrowserWindow | null = null
let assistantWindow: BrowserWindow | null = null

/** 窗口类型标识，区分主窗口和助手窗口 */
type AppWindowKind = 'main' | 'assistant'

/** 主窗口向助手窗口推送的上下文载荷 */
type AssistantContextPayload = {
  selectedProjectId?: string
  selectedChapterId?: string
  currentChapterSelection?: {
    chapterId: string
    text: string
  } | null
  activeAgentProposal?: import('../../renderer/src/types/app').AgentProposal | null
  agentConfirmationState?: import('../../renderer/src/types/app').AgentConfirmationState | null
  agentExecutionStep?: import('../../renderer/src/types/app').AgentExecutionStep
  agentIntentState?: import('../../renderer/src/types/app').AgentIntentKind
}

type ReferenceNovelImportRequest = {
  settings: AiTaskPayload['settings']
  projectId?: string
  projectTitle?: string
  projectGenre?: string
  projectPlatform?: string
  preferredTitle?: string
  preferredSource?: string
}

type ReferenceImportProgressPayload = {
  phase: 'extracting' | 'chunking' | 'chunk-analysis' | 'aggregating' | 'saving' | 'done'
  message: string
  current: number
  total: number
  percent: number
  sourceTitle?: string
}

type WorkspaceAiRunEventPayload = {
  projectId: string
  meta: Omit<WorkspaceAiRunRecord, 'projectId'>
}

let latestWorkspaceSnapshot: WorkspacePayload | null = null
let latestAssistantContext: AssistantContextPayload = {}
let latestAssistantPrompt: { id: string; prompt: string; quickAction?: string } | null = null

function updateLatestWorkspaceSnapshot(payload: WorkspacePayload | null): void {
  latestWorkspaceSnapshot = payload
}

function tokenizeKnowledgeText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function buildKnowledgeQuery(task: AiTaskPayload): string {
  return [
    String(task.context.userPrompt ?? ''),
    String(task.context.quickAction ?? ''),
    String(task.context.projectTitle ?? ''),
    String(task.context.projectGenre ?? ''),
    String(task.context.chapterVolumeTitle ?? ''),
    String(task.context.chapterVolumeSummary ?? ''),
    String(task.context.chapterTitle ?? ''),
    String(task.context.chapterSummary ?? ''),
    String(task.context.selectedText ?? ''),
    String(task.context.sceneFocus ?? ''),
    String(task.context.chapterContent ?? '').slice(0, 1200)
  ].filter(Boolean).join('\n')
}

function isProjectKnowledgeSource(sourceType: KnowledgeDocumentSourceType): boolean {
  return sourceType === 'workflow-document'
    || sourceType === 'canon-fact'
    || sourceType === 'chapter-summary'
}

function resolveKnowledgeSourceBaseScore(sourceType: KnowledgeDocumentSourceType): number {
  switch (sourceType) {
    case 'canon-fact':
      return 3.4
    case 'chapter-summary':
      return 2.8
    case 'workflow-document':
      return 2.4
    case 'reference-summary':
      return 1.4
    case 'reference-chunk':
    default:
      return 1
  }
}

function retrieveKnowledgeContext(task: AiTaskPayload): { usedKnowledge: WorkspaceAiRunKnowledgeItem[] } {
  if (task.task !== 'chapter-assistant' && task.task !== 'chapter-first-draft' && task.task !== 'assistant-action-proposal') {
    return { usedKnowledge: [] }
  }

  const projectId = String(task.context.projectId ?? '').trim()
  if (!projectId || !latestWorkspaceSnapshot?.workspaces?.[projectId]) {
    return { usedKnowledge: [] }
  }

  const workspace = latestWorkspaceSnapshot.workspaces[projectId]
  const documents = Array.isArray(workspace.knowledgeDocuments) ? workspace.knowledgeDocuments : []
  if (!documents.length) {
    return { usedKnowledge: [] }
  }

  const queryText = buildKnowledgeQuery(task)
  const queryTokens = Array.from(new Set(tokenizeKnowledgeText(queryText)))
  if (!queryTokens.length) {
    return { usedKnowledge: [] }
  }

  const ranked = documents
    .map((document) => {
      const title = String(document.title ?? '')
      const summary = String(document.summary ?? '')
      const content = String(document.content ?? '')
      const sourceLabel = String(document.sourceLabel ?? '')
      const keywords = Array.isArray(document.keywords)
        ? document.keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
        : []
      const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase())
      const haystack = `${title}\n${summary}\n${content}\n${sourceLabel}`.toLowerCase()
      let score = resolveKnowledgeSourceBaseScore(document.sourceType)

      for (const token of queryTokens) {
        if (lowerKeywords.some((keyword) => keyword === token)) score += 4
        else if (lowerKeywords.some((keyword) => keyword.includes(token) || token.includes(keyword))) score += 2.5
        if (title.toLowerCase().includes(token)) score += 2
        if (sourceLabel.toLowerCase().includes(token)) score += 1.5
        if (summary.toLowerCase().includes(token)) score += 1.2
        if (haystack.includes(token)) score += 0.6
      }

      return {
        score,
        document,
        keywords,
        projectSource: isProjectKnowledgeSource(document.sourceType)
      }
    })
    .filter((entry) => entry.score > 2)
    .sort((a, b) => b.score - a.score)

  const selectedIds = new Set<string>()
  const selected = [
    ...ranked.filter((entry) => entry.projectSource).slice(0, 3),
    ...ranked.filter((entry) => !entry.projectSource).slice(0, 2)
  ].filter((entry) => {
    if (selectedIds.has(entry.document.id)) {
      return false
    }
    selectedIds.add(entry.document.id)
    return true
  })

  for (const entry of ranked) {
    if (selected.length >= 5) {
      break
    }
    if (selectedIds.has(entry.document.id)) {
      continue
    }
    selected.push(entry)
    selectedIds.add(entry.document.id)
  }

  return {
    usedKnowledge: selected
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ document, keywords }) => ({
        documentId: document.id,
        title: document.title,
        sourceType: document.sourceType,
        sourceLabel: document.sourceLabel,
        snippet: (document.summary || document.content || '').trim().slice(0, 220),
        keywords: keywords.slice(0, 8)
      }))
  }
}

function appendAiRunToLatestSnapshot(payload: WorkspaceAiRunEventPayload): void {
  if (!latestWorkspaceSnapshot?.workspaces?.[payload.projectId]) {
    return
  }

  const workspace = latestWorkspaceSnapshot.workspaces[payload.projectId]
  workspace.aiRuns = [...(workspace.aiRuns ?? []), payload.meta].slice(-200)
}

function emitAiRunEvent(payload: WorkspaceAiRunEventPayload): void {
  appendAiRunToLatestSnapshot(payload)
  broadcastWindowEvent('characterarc:ai-run-event', payload)
}


function getMainWindowMetrics() {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const compactScreen = workAreaSize.width <= 1366 || workAreaSize.height <= 820
  const minWidth = Math.min(APP_MIN_WIDTH, workAreaSize.width)
  const minHeight = Math.min(APP_MIN_HEIGHT, workAreaSize.height)
  const width = Math.min(Math.max(Math.round(workAreaSize.width * 0.9), minWidth), APP_DEFAULT_WIDTH)
  const height = Math.min(Math.max(Math.round(workAreaSize.height * 0.9), minHeight), APP_DEFAULT_HEIGHT)

  return {
    width,
    height,
    minWidth,
    minHeight,
    compactScreen
  }
}

/** 根据窗口类型返回 URL 查询参数，助手窗口附带 ?window=assistant 标识 */
function getWindowSearch(kind: AppWindowKind): string {
  return kind === 'assistant' ? '?window=assistant' : ''
}

/** 解析窗口图标路径：优先使用打包后的 resources 目录，开发模式回退到项目根目录的 resources。 */
function resolveWindowIconPath(): string | undefined {
  const packagedIconPath = join(process.resourcesPath, 'icon.png')
  if (existsSync(packagedIconPath)) {
    return packagedIconPath
  }

  const localIconPath = join(process.cwd(), 'resources/icon.png')
  if (existsSync(localIconPath)) {
    return localIconPath
  }

  return undefined
}

/** 加载渲染进程页面，开发模式下打开 DevTools，生产模式下加载打包后的 index.html */
function loadRendererWindow(window: BrowserWindow, kind: AppWindowKind): void {
  const search = getWindowSearch(kind)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${search}`)
    if (kind === 'main') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
    return
  }

  const rendererHtml = join(__dirname, '../../out/renderer/index.html')
  console.log('[renderer] loadFile →', rendererHtml)
  void window.loadFile(rendererHtml, search ? { search } : undefined)
}

/** 向指定窗口发送 IPC 事件，窗口已销毁时静默跳过 */
function sendWindowEvent(window: BrowserWindow | null, channel: string, payload: unknown): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return
  }

  window.webContents.send(channel, payload)
}

/** 向所有窗口广播 IPC 事件，可排除指定 webContentsId 的窗口（避免发送给消息来源窗口） */
function broadcastWindowEvent(channel: string, payload: unknown, exceptWebContentsId?: number): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      continue
    }

    if (exceptWebContentsId && window.webContents.id === exceptWebContentsId) {
      continue
    }

    window.webContents.send(channel, payload)
  }
}

/** 广播助手窗口可见性变化事件到所有渲染进程窗口 */
function emitAssistantWindowVisibility(visible: boolean): void {
  broadcastWindowEvent('characterarc:assistant-window-visibility', {
    visible
  })
}

/** 创建主窗口：自适应屏幕尺寸、配置标题栏样式、设置安全的 preload 脚本 */
function createMainWindow(): BrowserWindow {
  const { width, height, minWidth, minHeight, compactScreen } = getMainWindowMetrics()
  const windowIcon = resolveWindowIconPath()
  const window = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    icon: windowIcon,
    autoHideMenuBar: true,
    title: `弧光 v${app.getVersion()}`,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    // Keep native caption buttons while giving the renderer a compact title-bar area to style around.
    titleBarOverlay:
      process.platform === 'win32'
        ? {
            color: '#f5f5f7',
            symbolColor: '#1d1d1f'
          }
        : false,
    backgroundColor: '#f5f5f7',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => {
    if (compactScreen) {
      window.center()
    }
    window.show()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.on('closed', () => {
    if (assistantWindow && !assistantWindow.isDestroyed()) {
      assistantWindow.close()
    }

    if (mainWindow === window) {
      mainWindow = null
    }
  })

  loadRendererWindow(window, 'main')
  mainWindow = window
  return window
}

/**
 * 创建或聚焦助手窗口。
 * 若已存在则恢复显示并同步上下文；否则新建窗口，自动定位到主窗口右侧。
 */
function createAssistantWindow(): BrowserWindow {
  if (assistantWindow && !assistantWindow.isDestroyed()) {
    if (assistantWindow.isMinimized()) {
      assistantWindow.restore()
    }
    assistantWindow.show()
    assistantWindow.focus()
    emitAssistantWindowVisibility(true)
    sendWindowEvent(assistantWindow, 'characterarc:assistant-context', latestAssistantContext)
    return assistantWindow
  }

  const parentBounds = mainWindow?.getBounds()
  const assistantX = parentBounds ? parentBounds.x + parentBounds.width - ASSISTANT_WINDOW_WIDTH - 32 : undefined
  const assistantY = parentBounds ? parentBounds.y + 44 : undefined
  const windowIcon = resolveWindowIconPath()

  const window = new BrowserWindow({
    width: ASSISTANT_WINDOW_WIDTH,
    height: ASSISTANT_WINDOW_HEIGHT,
    minWidth: ASSISTANT_WINDOW_MIN_WIDTH,
    minHeight: ASSISTANT_WINDOW_MIN_HEIGHT,
    icon: windowIcon,
    x: assistantX,
    y: assistantY,
    parent: mainWindow ?? undefined,
    autoHideMenuBar: true,
    title: `character-arc v${app.getVersion()} - AI 创作助理`,
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? {
            color: nativeTheme.shouldUseDarkColors ? '#0e0e12' : '#f4f7fb',
            symbolColor: nativeTheme.shouldUseDarkColors ? '#f4f4f5' : '#1d1d1f'
          }
        : false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e0e12' : '#f4f7fb',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => {
    window.show()
    window.focus()
    emitAssistantWindowVisibility(true)
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.once('did-finish-load', () => {
    sendWindowEvent(window, 'characterarc:assistant-context', latestAssistantContext)
    if (latestAssistantPrompt) {
      sendWindowEvent(window, 'characterarc:assistant-prompt', latestAssistantPrompt)
    }
  })

  window.on('closed', () => {
    if (assistantWindow === window) {
      assistantWindow = null
    }
    emitAssistantWindowVisibility(false)
  })

  loadRendererWindow(window, 'assistant')
  assistantWindow = window
  return window
}

/** 获取工作区数据目录路径：{userData}/data/ */
function getWorkspaceDirPath(): string {
  return join(app.getPath('userData'), 'data')
}

/** 获取旧版 JSON 工作区文件路径（仅用于迁移） */
function getWorkspaceFilePath(): string {
  return join(getWorkspaceDirPath(), WORKSPACE_FILE)
}

/** 获取 SQLite 数据库文件路径 */
function getWorkspaceDbPath(): string {
  return join(getWorkspaceDirPath(), WORKSPACE_DB)
}

function getProjectSkillsDirPath(): string {
  return join(process.cwd(), '.project-skills')
}

type ProjectSkillStageId = 'reference' | 'premise' | 'setting' | 'outline' | 'draft'

type ProjectSkillScanEntry = {
  id: string
  name: string
  version: string
  path: string
  description: string
  category: 'market' | 'analysis' | 'writing' | 'polish' | 'cover' | 'tool'
  compatibility: 'native' | 'partial' | 'external-only'
  compatibilityNote: string
  source: string
  referencesCount: number
  enabled: boolean
  stageIds: ProjectSkillStageId[]
}

function stripYamlScalar(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

function parseSkillFrontmatter(content: string): {
  name: string
  version: string
  description: string
  source: string
} {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const frontmatter = frontmatterMatch?.[1] ?? ''
  const lines = frontmatter.split(/\r?\n/)
  let name = ''
  let version = ''
  let description = ''
  let source = ''

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!fieldMatch) {
      continue
    }

    const [, field, rawValue] = fieldMatch
    const value = stripYamlScalar(rawValue)

    if (field === 'description' && (value === '|' || value === '>')) {
      const block: string[] = []
      index += 1
      while (index < lines.length) {
        const blockLine = lines[index]
        if (blockLine && !/^\s+/.test(blockLine)) {
          index -= 1
          break
        }

        const trimmed = blockLine.trim()
        if (trimmed) {
          block.push(trimmed)
        }
        index += 1
      }

      description = block.join(' ').trim()
      continue
    }

    if (field === 'name') {
      name = value
      continue
    }

    if (field === 'version') {
      version = value
      continue
    }

    if (field === 'description') {
      description = value
    }
  }

  const sourceMatch = frontmatter.match(/^\s*source:\s*(.+)$/m)
  if (sourceMatch?.[1]) {
    source = stripYamlScalar(sourceMatch[1])
  }

  return {
    name,
    version,
    description,
    source
  }
}

function inferProjectSkillMeta(skillId: string): Omit<ProjectSkillScanEntry, 'id' | 'name' | 'version' | 'path' | 'description' | 'source' | 'referencesCount'> {
  switch (skillId) {
    case 'story-long-scan':
    case 'story-short-scan':
      return {
        category: 'market',
        compatibility: 'native',
        compatibilityNote: '适合当前项目的选题与参考阶段，可作为平台趋势与题材风向输入。',
        enabled: true,
        stageIds: ['reference']
      }
    case 'story-long-analyze':
    case 'story-short-analyze':
      return {
        category: 'analysis',
        compatibility: 'native',
        compatibilityNote: '适合拆书、对标分析和参考作品提炼，可直接参与参考阶段流程文件生成。',
        enabled: true,
        stageIds: ['reference']
      }
    case 'story-long-write':
    case 'story-short-write':
      return {
        category: 'writing',
        compatibility: 'native',
        compatibilityNote: '适合立项、设定、大纲和正文阶段，作为当前项目的核心写作规则来源。',
        enabled: true,
        stageIds: ['premise', 'setting', 'outline', 'draft']
      }
    case 'story-deslop':
      return {
        category: 'polish',
        compatibility: 'native',
        compatibilityNote: '适合正文润色与去 AI 味，仅建议在写作阶段启用。',
        enabled: true,
        stageIds: ['draft']
      }
    case 'story-cover':
      return {
        category: 'cover',
        compatibility: 'external-only',
        compatibilityNote: '当前项目还没有封面生成工作台，此 skill 会作为资料保留，但不会接入正文链路。',
        enabled: false,
        stageIds: []
      }
    case 'browser-cdp':
      return {
        category: 'tool',
        compatibility: 'external-only',
        compatibilityNote: '当前项目没有浏览器 CDP 执行能力，此 skill 会作为外部工具说明保留。',
        enabled: false,
        stageIds: []
      }
    default:
      return {
        category: 'writing',
        compatibility: 'partial',
        compatibilityNote: '已识别为通用 skill，可手动决定是否启用并绑定到对应阶段。',
        enabled: false,
        stageIds: []
      }
  }
}

async function countFilesInDir(root: string): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true })
  let total = 0

  for (const entry of entries) {
    if (entry.isDirectory()) {
      total += await countFilesInDir(join(root, entry.name))
      continue
    }

    total += 1
  }

  return total
}

async function buildProjectSkillScanEntry(root: string, entryName: string): Promise<ProjectSkillScanEntry | null> {
  const skillDir = join(root, entryName)
  const skillPath = join(skillDir, 'SKILL.md')

  try {
    const content = await readFile(skillPath, 'utf-8')
    const frontmatter = parseSkillFrontmatter(content)
    const compatibilityMeta = inferProjectSkillMeta(entryName)
    const referencesDir = join(skillDir, 'references')
    const referencesCount = existsSync(referencesDir) ? await countFilesInDir(referencesDir) : 0

    return {
      id: entryName,
      name: frontmatter.name || entryName,
      version: frontmatter.version || '',
      path: `.project-skills/${entryName}`,
      description: frontmatter.description || '',
      category: compatibilityMeta.category,
      compatibility: compatibilityMeta.compatibility,
      compatibilityNote: compatibilityMeta.compatibilityNote,
      source: frontmatter.source || '',
      referencesCount,
      enabled: compatibilityMeta.enabled,
      stageIds: compatibilityMeta.stageIds
    }
  } catch {
    return null
  }
}

async function readProjectSkillsFromDisk(): Promise<Array<{
  id: string
  name: string
  version: string
  path: string
  description: string
  category: 'market' | 'analysis' | 'writing' | 'polish' | 'cover' | 'tool'
  compatibility: 'native' | 'partial' | 'external-only'
  compatibilityNote: string
  source: string
  referencesCount: number
  enabled: boolean
  stageIds: ProjectSkillStageId[]
}>> {
  const root = getProjectSkillsDirPath()
  const entries = await readdir(root, { withFileTypes: true })
  const skills: ProjectSkillScanEntry[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const skill = await buildProjectSkillScanEntry(root, entry.name)
    if (skill) {
      skills.push(skill)
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}

async function readProjectSkillContextsFromDisk(): Promise<Array<{
  id: string
  name: string
  description: string
  content: string
}>> {
  const root = getProjectSkillsDirPath()
  const entries = await readdir(root, { withFileTypes: true })
  const skills: Array<{
    id: string
    name: string
    description: string
    content: string
  }> = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const skillPath = join(root, entry.name, 'SKILL.md')
    try {
      const content = await readFile(skillPath, 'utf-8')
      const frontmatter = parseSkillFrontmatter(content)
      skills.push({
        id: entry.name,
        name: frontmatter.name || entry.name,
        description: frontmatter.description || '',
        content
      })
    } catch {
      // Ignore invalid skill directories.
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}

async function listSkillDirectories(root: string): Promise<string[]> {
  if (existsSync(join(root, 'SKILL.md'))) {
    return [root]
  }

  if (!existsSync(root)) {
    return []
  }

  const entries = await readdir(root, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md')))
    .map((entry) => join(root, entry.name))
}

async function resolveSkillPackageImportDirs(selectedPath: string): Promise<string[]> {
  const nestedSkillsRoot = join(selectedPath, 'skills')
  const nestedSkillDirs = await listSkillDirectories(nestedSkillsRoot)
  if (nestedSkillDirs.length > 0) {
    return nestedSkillDirs
  }

  return listSkillDirectories(selectedPath)
}

async function importProjectSkillsFromDirectory(selectedPath: string): Promise<string[]> {
  const sourceDirs = await resolveSkillPackageImportDirs(selectedPath)
  if (!sourceDirs.length) {
    return []
  }

  const targetRoot = getProjectSkillsDirPath()
  await mkdir(targetRoot, { recursive: true })
  const importedNames: string[] = []

  for (const sourceDir of sourceDirs) {
    const targetDir = join(targetRoot, basename(sourceDir))
    await cp(sourceDir, targetDir, { recursive: true, force: true })
    importedNames.push(basename(sourceDir))
  }

  return importedNames.sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

// 数据库连接单例，应用生命周期内只打开一次
let workspaceDb: DatabaseSync | null = null

/** 确保工作区数据目录存在，不存在时递归创建 */
async function ensureWorkspaceDir(): Promise<void> {
  await mkdir(getWorkspaceDirPath(), { recursive: true })
}

/**
 * 初始化或复用 SQLite 数据库连接。
 * 首次调用时创建数据库、建表、执行 schema 迁移、迁移旧版 JSON 工作区。
 * 后续调用直接返回缓存的连接。
 */
async function ensureWorkspaceDb(): Promise<DatabaseSync> {
  if (workspaceDb) {
    return workspaceDb
  }

  await ensureWorkspaceDir()
  workspaceDb = new DatabaseSync(getWorkspaceDbPath())
  workspaceDb.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      genre TEXT NOT NULL,
      novel_length TEXT NOT NULL DEFAULT 'long',
      word_count TEXT NOT NULL,
      last_edited TEXT NOT NULL,
      cover TEXT NOT NULL,
      target_platform TEXT NOT NULL DEFAULT '',
      reference_works_json TEXT NOT NULL DEFAULT '[]',
      writing_style_preset_id TEXT NOT NULL DEFAULT 'cinematic-cool',
      writing_style_prompt TEXT NOT NULL DEFAULT '',
      novel_workflow_stages_json TEXT NOT NULL DEFAULT '[]',
      project_skills_json TEXT NOT NULL DEFAULT '[]',
      chapter_assistant_templates_json TEXT NOT NULL DEFAULT '[]'
    ) STRICT;

    CREATE TABLE IF NOT EXISTS worldview_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      description TEXT NOT NULL,
      avatar TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      motto TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS character_relationships (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      from_character_id TEXT NOT NULL,
      to_character_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      intensity INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS organization_memberships (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      role TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS inspiration_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      source TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS outline_volumes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      word_target TEXT NOT NULL,
      summary TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS outline_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      volume_id TEXT NOT NULL,
      title TEXT NOT NULL,
      word_target TEXT NOT NULL,
      conflict TEXT NOT NULL,
      summary TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
      FOREIGN KEY (volume_id) REFERENCES outline_volumes (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      volume_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      word_target TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
      FOREIGN KEY (volume_id) REFERENCES outline_volumes (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS chapter_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      word_target TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_label TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL DEFAULT '',
      task TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER,
      used_knowledge_json TEXT NOT NULL DEFAULT '[]',
      repair_triggered INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      response_preview TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS workflow_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      volume_id TEXT NOT NULL DEFAULT 'volume-legacy-default',
      doc_key TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
      FOREIGN KEY (volume_id) REFERENCES outline_volumes (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      theme TEXT NOT NULL,
      selected_project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key TEXT NOT NULL,
      base_url TEXT NOT NULL,
      auto_save_interval TEXT NOT NULL,
      ui_scale REAL NOT NULL DEFAULT 1
    ) STRICT;
  `)

  const worldviewColumns = workspaceDb.prepare(`PRAGMA table_info(worldview_entries)`).all() as Array<{ name: string }>
  const worldviewColumnNames = new Set(worldviewColumns.map((column) => column.name))

  if (!worldviewColumnNames.has('created_at')) {
    workspaceDb.exec(`ALTER TABLE worldview_entries ADD COLUMN created_at TEXT NOT NULL DEFAULT '';`)
  }

  if (!worldviewColumnNames.has('updated_at')) {
    workspaceDb.exec(`ALTER TABLE worldview_entries ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';`)
  }

  workspaceDb.exec(`
    UPDATE worldview_entries
    SET created_at = COALESCE(NULLIF(created_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at = COALESCE(NULLIF(updated_at, ''), created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE created_at = '' OR updated_at = '';
  `)

  ensureAppSettingsColumns(workspaceDb)
  ensureChapterColumns(workspaceDb)
  ensureProjectColumns(workspaceDb)
  ensureProjectScopedColumns(workspaceDb)
  ensureVolumeColumns(workspaceDb)
  ensureWorkflowDocumentColumns(workspaceDb)

  await migrateLegacyWorkspaceFile(workspaceDb)
  return workspaceDb
}

/** 确保 app_settings 表包含 model 和 ui_scale 列（schema 升级） */
function ensureAppSettingsColumns(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info('app_settings')`).all() as Array<{ name: string }>
  const columnNames = new Set(columns.map((column) => column.name))

  if (!columnNames.has('model')) {
    db.exec(`ALTER TABLE app_settings ADD COLUMN model TEXT NOT NULL DEFAULT 'deepseek-chat';`)
  }

  if (!columnNames.has('ui_scale')) {
    db.exec(`ALTER TABLE app_settings ADD COLUMN ui_scale REAL NOT NULL DEFAULT 1;`)
  }

  if (!columnNames.has('dark_mode')) {
    db.exec(`ALTER TABLE app_settings ADD COLUMN dark_mode INTEGER NOT NULL DEFAULT 0;`)
  }
}

/** 确保 chapters 表包含 summary、status、word_target 列（schema 升级） */
function ensureChapterColumns(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info('chapters')`).all() as Array<{ name: string }>
  const columnNames = new Set(columns.map((column) => column.name))

  if (!columnNames.has('outline_item_id')) {
    db.exec(`ALTER TABLE chapters ADD COLUMN outline_item_id TEXT NOT NULL DEFAULT '';`)
  }

  if (!columnNames.has('summary')) {
    db.exec(`ALTER TABLE chapters ADD COLUMN summary TEXT NOT NULL DEFAULT '待补充章节摘要';`)
  }

  if (!columnNames.has('status')) {
    db.exec(`ALTER TABLE chapters ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';`)
  }

  if (!columnNames.has('word_target')) {
    db.exec(`ALTER TABLE chapters ADD COLUMN word_target TEXT NOT NULL DEFAULT '预估 3000字';`)
  }
}

/** 确保所有项目级表包含 project_id 列，将旧版单项目数据迁移到选中项目下 */
function ensureProjectScopedColumns(db: DatabaseSync): void {
  const defaultProjectId =
    (db.prepare(`SELECT selected_project_id AS projectId FROM app_settings WHERE id = 1`).get() as { projectId?: string } | undefined)
      ?.projectId ||
    (db.prepare(`SELECT id FROM projects ORDER BY rowid ASC LIMIT 1`).get() as { id?: string } | undefined)?.id ||
    'project-1'

  const projectScopedTables = ['worldview_entries', 'characters', 'organizations', 'character_relationships', 'organization_memberships', 'inspiration_entries', 'outline_volumes', 'outline_items', 'chapters', 'chapter_versions', 'ai_messages']
  for (const tableName of projectScopedTables) {
    const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all() as Array<{ name: string }>
    const columnNames = new Set(columns.map((column) => column.name))

    if (!columnNames.has('project_id')) {
      // Legacy single-project data is migrated into the selected project workspace during schema upgrade.
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN project_id TEXT NOT NULL DEFAULT '${defaultProjectId}';`)
    }
  }
}

/** 确保 outline_items 和 chapters 表包含 volume_id 列（分卷功能升级） */
function ensureVolumeColumns(db: DatabaseSync): void {
  const defaultVolumeId = 'volume-legacy-default'

  for (const tableName of ['outline_items', 'chapters']) {
    const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all() as Array<{ name: string }>
    const columnNames = new Set(columns.map((column) => column.name))

    if (!columnNames.has('volume_id')) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN volume_id TEXT NOT NULL DEFAULT '${defaultVolumeId}';`)
    }
  }

  const outlineColumns = db.prepare(`PRAGMA table_info('outline_items')`).all() as Array<{ name: string }>
  const outlineColumnNames = new Set(outlineColumns.map((column) => column.name))
  if (!outlineColumnNames.has('status')) {
    db.exec(`ALTER TABLE outline_items ADD COLUMN status TEXT NOT NULL DEFAULT 'planned';`)
  }
}

/** 确保 workflow_documents 表包含 volume_id 列，并将旧项目级流程文件迁移到每个项目的首个分卷 */
function ensureWorkflowDocumentColumns(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info('workflow_documents')`).all() as Array<{ name: string }>
  const columnNames = new Set(columns.map((column) => column.name))

  if (!columnNames.has('project_id')) {
    const defaultProjectId =
      (db.prepare(`SELECT selected_project_id AS projectId FROM app_settings WHERE id = 1`).get() as { projectId?: string } | undefined)
        ?.projectId ||
      (db.prepare(`SELECT id FROM projects ORDER BY rowid ASC LIMIT 1`).get() as { id?: string } | undefined)?.id ||
      'project-1'
    db.exec(`ALTER TABLE workflow_documents ADD COLUMN project_id TEXT NOT NULL DEFAULT '${defaultProjectId}';`)
  }

  if (!columnNames.has('volume_id')) {
    db.exec(`ALTER TABLE workflow_documents ADD COLUMN volume_id TEXT NOT NULL DEFAULT '';`)
  }

  db.exec(`
    UPDATE workflow_documents
    SET volume_id = COALESCE(
      (
        SELECT id
        FROM outline_volumes
        WHERE outline_volumes.project_id = workflow_documents.project_id
        ORDER BY sort_order ASC, rowid ASC
        LIMIT 1
      ),
      'volume-legacy-default'
    )
    WHERE COALESCE(volume_id, '') = '';
  `)
}

/**
 * 将旧版 workspace.json 文件迁移到 SQLite 数据库。
 * 仅在数据库中没有任何项目时执行，避免重复迁移。
 */
async function migrateLegacyWorkspaceFile(db: DatabaseSync): Promise<void> {
  const hasProject = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined

  if (hasProject) {
    return
  }

  try {
    const legacyRaw = await readFile(getWorkspaceFilePath(), 'utf-8')
    const legacyPayload = JSON.parse(legacyRaw)
    writeWorkspaceSnapshot(db, normalizeWorkspacePayload(legacyPayload as LegacyWorkspacePayload))
  } catch {
    // Ignore missing or invalid legacy files and let the renderer fall back to defaults.
  }
}

type WorkspacePayload = {
  theme: string
  selectedProjectId: string
  projects: Array<{
    id: string
    title: string
    genre: string
    novelLength: 'short' | 'long'
    wordCount: string
    lastEdited: string
    cover: string
    targetPlatform: string
    referenceWorks: Array<{
      id: string
      title: string
      source: string
      notes: string
      fileName?: string
      analysis?: {
        createdAt: string
        fileName: string
        fileType: 'txt' | 'md' | 'docx'
        characterCount: number
        chapterCount: number
        excerpt: string
        topKeywords: string[]
        metrics: ReferenceStyleMetric[]
        overview: string
        sentenceStyle: string
        dialogueRatio: string
        pacingControl: string
        emotionExpression: string
        narrativePerspective: string
        styleRules: string[]
        plotOutline: string
        reusableStylePrompt: string
        avoidRules: string[]
      }
    }>
    writingStylePresetId: string
    writingStylePrompt: string
    novelWorkflowStages: Array<{
      id: 'reference' | 'premise' | 'setting' | 'outline' | 'draft'
      status: 'todo' | 'doing' | 'done'
    }>
    projectSkills: Array<{
      id: string
      name: string
      path: string
      description: string
      enabled: boolean
      stageIds: Array<'reference' | 'premise' | 'setting' | 'outline' | 'draft'>
    }>
    chapterAssistantTemplates: Array<{
      id: string
      label: string
      group: 'write' | 'rewrite' | 'planning' | 'reference'
      prompt: string
      mode: 'freeform' | 'polish' | 'continue' | 'suggest' | 'reference'
      length: 'short' | 'medium' | 'long'
      task: 'chat' | 'outline-draft'
      requiresSelection: boolean
    }>
  }>
  workspaces: Record<
    string,
    {
      worldviewEntries: Array<{
        id: string
        type: string
        title: string
        content: string
        sortOrder: number
        createdAt: string
        updatedAt: string
      }>
      characters: Array<{
        id: string
        name: string
        role: string
        description: string
        avatar: string
        tags: Array<{ label: string; tone?: string }>
      }>
      organizations: Array<{
        id: string
        name: string
        type: string
        description: string
        motto: string
        color: string
        sortOrder: number
        createdAt: string
        updatedAt: string
      }>
      characterRelationships: Array<{
        id: string
        fromCharacterId: string
        toCharacterId: string
        type: string
        description: string
        intensity: number
        createdAt: string
        updatedAt: string
      }>
      organizationMemberships: Array<{
        id: string
        characterId: string
        organizationId: string
        role: string
        notes: string
        createdAt: string
        updatedAt: string
      }>
      inspirationEntries: Array<{
        id: string
        type: string
        title: string
        content: string
        tags: string[]
        source: 'ai' | 'manual'
        sortOrder: number
        createdAt: string
        updatedAt: string
      }>
      outlineVolumes: Array<{
        id: string
        title: string
        wordTarget: string
        summary: string
        workflowDocuments?: Array<{
          key: 'task_plan' | 'findings' | 'progress' | 'current_status' | 'novel_setting' | 'character_relationships' | 'pending_hooks' | 'resource_ledger'
          title: string
          content: string
          updatedAt: string
        }>
      }>
      outlineItems: Array<{
        id: string
        volumeId: string
        title: string
        wordTarget: string
        conflict: string
        summary: string
        status: 'idea' | 'planned' | 'drafting' | 'done'
        sortOrder: number
      }>
      chapters: Array<{
        id: string
        outlineItemId: string
        volumeId: string
        title: string
        summary: string
        status: 'draft' | 'review' | 'polish' | 'final'
        wordTarget: string
        content: string
      }>
      chapterVersions: Array<{
        id: string
        chapterId: string
        title: string
        summary: string
        status: 'draft' | 'review' | 'polish' | 'final'
        wordTarget: string
        content: string
        createdAt: string
      }>
      messages: Array<{
        id: string
        role: 'user' | 'assistant'
        content: string
      }>
      knowledgeDocuments: Array<Omit<WorkspaceKnowledgeDocument, 'projectId'>>
      aiRuns: Array<Omit<WorkspaceAiRunRecord, 'projectId'>>
      workflowDocuments: Array<{
        key: 'task_plan' | 'findings' | 'progress' | 'current_status' | 'novel_setting' | 'character_relationships' | 'pending_hooks' | 'resource_ledger'
        title: string
        content: string
        updatedAt: string
      }>
    }
  >
  appSettings: {
    provider: string
    model: string
    apiKey: string
    baseUrl: string
    autoSaveInterval: string
    uiScale: number
    darkMode: boolean
  }
}

/** 确保 projects 表包含写作风格相关列（writing_style_preset_id, writing_style_prompt） */
function ensureProjectColumns(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info('projects')`).all() as Array<{ name: string }>
  const columnNames = new Set(columns.map((column) => column.name))

  if (!columnNames.has('novel_length')) {
    db.exec(`ALTER TABLE projects ADD COLUMN novel_length TEXT NOT NULL DEFAULT 'long';`)
  }

  if (!columnNames.has('writing_style_preset_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN writing_style_preset_id TEXT NOT NULL DEFAULT 'cinematic-cool';`)
  }

  if (!columnNames.has('writing_style_prompt')) {
    db.exec(`ALTER TABLE projects ADD COLUMN writing_style_prompt TEXT NOT NULL DEFAULT '';`)
  }

  if (!columnNames.has('chapter_assistant_templates_json')) {
    db.exec(`ALTER TABLE projects ADD COLUMN chapter_assistant_templates_json TEXT NOT NULL DEFAULT '[]';`)
  }

  if (!columnNames.has('novel_workflow_stages_json')) {
    db.exec(`ALTER TABLE projects ADD COLUMN novel_workflow_stages_json TEXT NOT NULL DEFAULT '[]';`)
  }

  if (!columnNames.has('project_skills_json')) {
    db.exec(`ALTER TABLE projects ADD COLUMN project_skills_json TEXT NOT NULL DEFAULT '[]';`)
  }

  if (!columnNames.has('target_platform')) {
    db.exec(`ALTER TABLE projects ADD COLUMN target_platform TEXT NOT NULL DEFAULT '';`)
  }

  if (!columnNames.has('reference_works_json')) {
    db.exec(`ALTER TABLE projects ADD COLUMN reference_works_json TEXT NOT NULL DEFAULT '[]';`)
  }
}

type LegacyWorkspacePayload = Omit<WorkspacePayload, 'workspaces'> & {
  worldviewEntries?: Array<{
    id: string
    type: string
    title: string
    content: string
    sortOrder?: number
    createdAt?: string
    updatedAt?: string
  }>
  characters?: Array<{
    id: string
    name: string
    role: string
    description: string
    avatar: string
    tags: Array<{ label: string; tone?: string }>
  }>
  organizations?: Array<{
    id: string
    name: string
    type: string
    description: string
    motto: string
    color: string
    sortOrder?: number
    createdAt?: string
    updatedAt?: string
  }>
  characterRelationships?: Array<{
    id: string
    fromCharacterId: string
    toCharacterId: string
    type: string
    description: string
    intensity?: number
    createdAt?: string
    updatedAt?: string
  }>
  organizationMemberships?: Array<{
    id: string
    characterId: string
    organizationId: string
    role: string
    notes?: string
    createdAt?: string
    updatedAt?: string
  }>
  inspirationEntries?: Array<{
    id: string
    type: string
    title: string
    content: string
    tags: string[]
    source?: 'ai' | 'manual'
    sortOrder?: number
    createdAt?: string
    updatedAt?: string
  }>
  outlineVolumes?: Array<{
    id: string
    title: string
    wordTarget: string
    summary: string
  }>
  outlineItems?: Array<{
    id: string
    volumeId?: string
    title: string
    wordTarget: string
    conflict: string
    summary: string
    status?: 'idea' | 'planned' | 'drafting' | 'done'
    sortOrder?: number
  }>
  chapters?: Array<{
    id: string
    outlineItemId?: string
    volumeId?: string
    title: string
    summary: string
    status: 'draft' | 'review' | 'polish' | 'final'
    wordTarget: string
    content: string
  }>
  chapterVersions?: Array<{
    id: string
    chapterId: string
    title: string
    summary: string
    status: 'draft' | 'review' | 'polish' | 'final'
    wordTarget: string
    content: string
    createdAt: string
  }>
  messages?: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
  }>
}

/** 标准化应用设置，为缺失字段填入默认值，uiScale 限制在 0.75-1.75 范围 */
function normalizeAppSettings(settings?: Partial<WorkspacePayload['appSettings']> | null): WorkspacePayload['appSettings'] {
  const uiScale =
    settings?.uiScale !== undefined && Number.isFinite(settings.uiScale)
      ? Math.min(1.75, Math.max(0.75, settings.uiScale))
      : 1

  return {
    provider: settings?.provider || 'deepseek',
    model: settings?.model || 'deepseek-chat',
    apiKey: settings?.apiKey || 'sk-1234567890abcdef',
    baseUrl: settings?.baseUrl || 'https://api.deepseek.com/v1',
    autoSaveInterval: settings?.autoSaveInterval || '5m',
    uiScale,
    darkMode: Boolean(settings?.darkMode)
  }
}

/** 为旧版单项目数据创建默认分卷（迁移兜底） */
function createFallbackVolume(title = '故事开端', volumeId = 'volume-legacy-default') {
  return {
    id: volumeId,
    title,
    wordTarget: '目标 5万字',
    summary: '用于承载当前项目的默认分卷。'
  }
}

/** 标准化项目记录，为缺失字段填入默认值 */
function normalizeProjectRecord(project: Partial<WorkspacePayload['projects'][number]> & { id: string }): WorkspacePayload['projects'][number] {
  return {
    id: project.id,
    title: project.title || '未命名作品',
    genre: project.genre || '未分类',
    novelLength: project.novelLength === 'short' ? 'short' : 'long',
    wordCount: project.wordCount || '待统计',
    lastEdited: project.lastEdited || '刚刚更新',
    cover: project.cover || 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
    targetPlatform: project.targetPlatform || '',
    referenceWorks: Array.isArray(project.referenceWorks) ? project.referenceWorks : [],
    writingStylePresetId: project.writingStylePresetId || 'cinematic-cool',
    writingStylePrompt: project.writingStylePrompt || '',
    novelWorkflowStages: Array.isArray(project.novelWorkflowStages) ? project.novelWorkflowStages : [],
    projectSkills: Array.isArray(project.projectSkills) ? project.projectSkills : [],
    chapterAssistantTemplates: Array.isArray(project.chapterAssistantTemplates) ? project.chapterAssistantTemplates : []
  }
}

function buildImportedReferenceKnowledgeDocuments(
  projectId: string,
  title: string,
  localContext: ReferenceNovelLocalContext,
  analysis: ReferenceStyleAnalysisResult,
  importedAt: string
): WorkspaceKnowledgeDocument[] {
  const summaryDocument: WorkspaceKnowledgeDocument = {
    id: `knowledge-reference-summary-${randomUUID()}`,
    projectId,
    title: `${title}｜拆书总纲`,
    sourceType: 'reference-summary',
    sourceLabel: localContext.fileName,
    content: [
      `作品：${title}`,
      `风格总述：${analysis.overview}`,
      `句式特征：${analysis.sentenceStyle}`,
      `对白策略：${analysis.dialogueRatio}`,
      `节奏控制：${analysis.pacingControl}`,
      `情绪表达：${analysis.emotionExpression}`,
      `叙事视角：${analysis.narrativePerspective}`,
      localContext.topKeywords.length ? `关键词：${localContext.topKeywords.join('、')}` : '',
      analysis.styleRules.length ? `风格规则：${analysis.styleRules.join('；')}` : '',
      analysis.avoidRules.length ? `避免照搬：${analysis.avoidRules.join('；')}` : '',
      `剧情骨架：${analysis.plotOutline}`,
      `仿写模板：${analysis.reusableStylePrompt}`
    ]
      .filter(Boolean)
      .join('\n'),
    summary: analysis.overview,
    keywords: Array.from(new Set([...localContext.topKeywords, ...analysis.styleRules])).slice(0, 20),
    metadata: {
      sourceTitle: title,
      fileName: localContext.fileName,
      fileType: localContext.fileType,
      characterCount: localContext.characterCount,
      chapterCount: localContext.chapterCount,
      metrics: localContext.metrics,
      styleRules: analysis.styleRules,
      avoidRules: analysis.avoidRules
    },
    createdAt: importedAt,
    updatedAt: importedAt
  }

  const chunkDocuments = localContext.analysisChunks.map((chunk) => ({
    id: `knowledge-reference-chunk-${randomUUID()}`,
    projectId,
    title: `${title}｜${chunk.label}`,
    sourceType: 'reference-chunk' as const,
    sourceLabel: `${localContext.fileName} / ${chunk.label}`,
    content: chunk.text,
    summary: `${chunk.label}，约 ${chunk.characterCount} 字；关键词：${chunk.topKeywords.join('、') || '待补充'}`,
    keywords: chunk.topKeywords,
    metadata: {
      sourceTitle: title,
      fileName: localContext.fileName,
      fileType: localContext.fileType,
      chunkId: chunk.id,
      chunkLabel: chunk.label,
      chunkOrder: chunk.order,
      characterCount: chunk.characterCount,
      metrics: chunk.metrics
    },
    createdAt: importedAt,
    updatedAt: importedAt
  }))

  return [summaryDocument, ...chunkDocuments]
}

function buildImportedReferenceStylePrompt(title: string, analysis: ReferenceStyleAnalysisResult): string {
  return [
    `以下规则来自参考作品《${title}》的拆书结果，已做去具体化处理，只借鉴文笔和结构骨架，不复用专有设定：`,
    analysis.reusableStylePrompt,
    `补充校准：句式 ${analysis.sentenceStyle}；对白 ${analysis.dialogueRatio}；节奏 ${analysis.pacingControl}；情绪 ${analysis.emotionExpression}；视角 ${analysis.narrativePerspective}。`
  ].join('\n')
}

function buildImportedReferenceFindingsMarkdown(title: string, analysis: ReferenceStyleAnalysisResult, metrics: ReferenceStyleMetric[], keywords: string[]): string {
  const metricLines = metrics.map((metric) => `- ${metric.label}：${metric.value}`).join('\n')
  const styleRuleLines = analysis.styleRules.map((rule) => `- ${rule}`).join('\n')
  const avoidRuleLines = analysis.avoidRules.map((rule) => `- ${rule}`).join('\n')
  return [
    `- 参考作品：${title}`,
    `- 风格总述：${analysis.overview}`,
    ...(keywords.length ? [`- 关键词：${keywords.join('、')}`] : []),
    '',
    '### 局部统计',
    metricLines,
    '',
    '### 可复用风格规则',
    styleRuleLines,
    '',
    '### 去具体化剧情骨架',
    analysis.plotOutline,
    '',
    '### 避免照搬',
    avoidRuleLines
  ].join('\n')
}

function emitReferenceImportProgress(window: BrowserWindow, payload: ReferenceImportProgressPayload): void {
  if (window.isDestroyed()) {
    return
  }

  window.webContents.send('characterarc:reference-import-progress', payload)
}

function formatReferenceChunkSummaries(
  chunkResults: Array<{
    label: string
    characterCount: number
    result: ReferenceStyleChunkResult
  }>
): string {
  return chunkResults
    .map(({ label, characterCount, result }, index) => [
      `【分块 ${index + 1}｜${label}｜约 ${characterCount} 字】`,
      `局部概括：${result.overview}`,
      `句式：${result.sentenceStyle}`,
      `对白：${result.dialogueRatio}`,
      `节奏：${result.pacingControl}`,
      `情绪：${result.emotionExpression}`,
      `桥段功能：${result.plotFunction}`,
      `局部规则：${result.styleRules.join('；')}`
    ].join('\n'))
    .join('\n\n')
}

/**
 * 标准化工作区载荷：兼容新旧两种格式。
 * 新格式包含 workspaces 字段；旧格式的实体直接平铺在顶层，需迁移到 workspaces 结构中。
 */
function normalizeWorkspacePayload(payload: WorkspacePayload | LegacyWorkspacePayload): WorkspacePayload {
  if ('workspaces' in payload && payload.workspaces) {
    return {
      ...payload,
      projects: payload.projects.map((project) => normalizeProjectRecord(project)),
      appSettings: normalizeAppSettings(payload.appSettings)
    }
  }

  const legacyPayload = payload as LegacyWorkspacePayload
  const normalizedTimestamp = new Date().toISOString()
  const projects = legacyPayload.projects?.length ? legacyPayload.projects.map((project) => normalizeProjectRecord(project)) : []
  const selectedProjectId = legacyPayload.selectedProjectId || projects[0]?.id || 'project-1'
  const workspaces = Object.fromEntries(
    projects.map((project) => [
      project.id,
      {
        outlineVolumes:
          project.id === selectedProjectId
            ? legacyPayload.outlineVolumes?.length
              ? legacyPayload.outlineVolumes
              : [createFallbackVolume()]
            : [],
        worldviewEntries:
          project.id === selectedProjectId
            ? (legacyPayload.worldviewEntries ?? []).map((entry, index) => ({
                ...entry,
                sortOrder: entry.sortOrder ?? index,
                createdAt: entry.createdAt || normalizedTimestamp,
                updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
              }))
            : [],
        characters: project.id === selectedProjectId ? legacyPayload.characters ?? [] : [],
        organizations:
          project.id === selectedProjectId
            ? (legacyPayload.organizations ?? []).map((entry, index) => ({
                ...entry,
                sortOrder: entry.sortOrder ?? index,
                createdAt: entry.createdAt || normalizedTimestamp,
                updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
              }))
            : [],
        characterRelationships:
          project.id === selectedProjectId
            ? (legacyPayload.characterRelationships ?? []).map((entry) => ({
                ...entry,
                intensity: Number.isFinite(entry.intensity) ? Math.min(100, Math.max(0, entry.intensity ?? 50)) : 50,
                createdAt: entry.createdAt || normalizedTimestamp,
                updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
              }))
            : [],
        organizationMemberships:
          project.id === selectedProjectId
            ? (legacyPayload.organizationMemberships ?? []).map((entry) => ({
                ...entry,
                notes: entry.notes ?? '',
                createdAt: entry.createdAt || normalizedTimestamp,
                updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
              }))
            : [],
        inspirationEntries:
          project.id === selectedProjectId
            ? (legacyPayload.inspirationEntries ?? []).map((entry, index) => ({
                ...entry,
                tags: Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
                source: (entry.source === 'manual' ? 'manual' : 'ai') as 'ai' | 'manual',
                sortOrder: entry.sortOrder ?? index,
                createdAt: entry.createdAt || normalizedTimestamp,
                updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
              }))
            : [],
        outlineItems:
          project.id === selectedProjectId
            ? (legacyPayload.outlineItems ?? []).map((item, index) => ({
                ...item,
                volumeId: item.volumeId || legacyPayload.outlineVolumes?.[0]?.id || 'volume-legacy-default',
                status: item.status || 'planned',
                sortOrder: item.sortOrder ?? index
              }))
            : [],
        chapters:
          project.id === selectedProjectId
            ? (legacyPayload.chapters ?? []).map((chapter) => ({
                ...chapter,
                outlineItemId: chapter.outlineItemId || '',
                volumeId: chapter.volumeId || legacyPayload.outlineVolumes?.[0]?.id || 'volume-legacy-default'
              }))
            : [],
        chapterVersions: project.id === selectedProjectId ? legacyPayload.chapterVersions ?? [] : [],
        messages: project.id === selectedProjectId ? legacyPayload.messages ?? [] : [],
        knowledgeDocuments: [],
        aiRuns: [],
        workflowDocuments: []
      }
    ])
  )

  return {
    theme: legacyPayload.theme,
    selectedProjectId,
    projects,
    workspaces,
    appSettings: normalizeAppSettings(legacyPayload.appSettings)
  }
}

/**
 * 从 SQLite 读取完整的 workspace 快照。
 * 按 project_id 将各表数据分组到对应项目的 workspace 中，返回标准化的 WorkspacePayload。
 * 数据库为空时返回 null。
 */
function readWorkspaceSnapshot(db: DatabaseSync): WorkspacePayload | null {
  const projectRows = db.prepare(`
    SELECT id, title, genre, novel_length AS novelLength, word_count AS wordCount, last_edited AS lastEdited, cover,
      target_platform AS targetPlatform,
      reference_works_json AS referenceWorksJson,
      writing_style_preset_id AS writingStylePresetId,
      writing_style_prompt AS writingStylePrompt,
      novel_workflow_stages_json AS novelWorkflowStagesJson,
      project_skills_json AS projectSkillsJson,
      chapter_assistant_templates_json AS chapterAssistantTemplatesJson
    FROM projects
    ORDER BY rowid ASC
  `).all() as Array<
    Omit<WorkspacePayload['projects'][number], 'chapterAssistantTemplates' | 'novelWorkflowStages' | 'projectSkills' | 'referenceWorks'> & {
      referenceWorksJson?: string
      chapterAssistantTemplatesJson?: string
      novelWorkflowStagesJson?: string
      projectSkillsJson?: string
    }
  >

  const projects = projectRows.map((project) =>
    normalizeProjectRecord({
      ...project,
      novelWorkflowStages: (() => {
        try {
          return JSON.parse(project.novelWorkflowStagesJson || '[]')
        } catch {
          return []
        }
      })(),
      referenceWorks: (() => {
        try {
          return JSON.parse(project.referenceWorksJson || '[]')
        } catch {
          return []
        }
      })(),
      projectSkills: (() => {
        try {
          return JSON.parse(project.projectSkillsJson || '[]')
        } catch {
          return []
        }
      })(),
      chapterAssistantTemplates: (() => {
        try {
          return JSON.parse(project.chapterAssistantTemplatesJson || '[]')
        } catch {
          return []
        }
      })()
    })
  )

  if (projects.length === 0) {
    return null
  }

  const worldviewEntries = db.prepare(`
    SELECT project_id AS projectId, id, type, title, content, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
    FROM worldview_entries
    ORDER BY project_id ASC, sort_order ASC
  `).all() as Array<WorkspacePayload['workspaces'][string]['worldviewEntries'][number] & { projectId: string }>

  const characters = db.prepare(`
    SELECT project_id AS projectId, id, name, role, description, avatar, tags_json AS tagsJson
    FROM characters
    ORDER BY project_id ASC, rowid ASC
  `).all().map((row) => ({
    projectId: row.projectId as string,
    id: row.id as string,
    name: row.name as string,
    role: row.role as string,
    description: row.description as string,
    avatar: row.avatar as string,
    tags: JSON.parse(row.tagsJson as string) as Array<{ label: string; tone?: string }>
  })) as Array<WorkspacePayload['workspaces'][string]['characters'][number] & { projectId: string }>

  const organizations = db.prepare(`
    SELECT project_id AS projectId, id, name, type, description, motto, color, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
    FROM organizations
    ORDER BY project_id ASC, sort_order ASC
  `).all() as Array<WorkspacePayload['workspaces'][string]['organizations'][number] & { projectId: string }>

  const characterRelationships = db.prepare(`
    SELECT project_id AS projectId, id, from_character_id AS fromCharacterId, to_character_id AS toCharacterId, type, description, intensity, created_at AS createdAt, updated_at AS updatedAt
    FROM character_relationships
    ORDER BY project_id ASC, rowid ASC
  `).all() as Array<WorkspacePayload['workspaces'][string]['characterRelationships'][number] & { projectId: string }>

  const organizationMemberships = db.prepare(`
    SELECT project_id AS projectId, id, character_id AS characterId, organization_id AS organizationId, role, notes, created_at AS createdAt, updated_at AS updatedAt
    FROM organization_memberships
    ORDER BY project_id ASC, rowid ASC
  `).all() as Array<WorkspacePayload['workspaces'][string]['organizationMemberships'][number] & { projectId: string }>

  const inspirationEntries = db.prepare(`
    SELECT project_id AS projectId, id, type, title, content, tags_json AS tagsJson, source, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
    FROM inspiration_entries
    ORDER BY project_id ASC, sort_order ASC
  `).all().map((row) => ({
    projectId: row.projectId as string,
    id: row.id as string,
    type: row.type as string,
    title: row.title as string,
    content: row.content as string,
    tags: JSON.parse(row.tagsJson as string) as string[],
    source: ((row.source as string) === 'manual' ? 'manual' : 'ai') as 'ai' | 'manual',
    sortOrder: row.sortOrder as number,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string
  })) as Array<WorkspacePayload['workspaces'][string]['inspirationEntries'][number] & { projectId: string }>

  const outlineVolumes = db.prepare(`
    SELECT project_id AS projectId, id, title, word_target AS wordTarget, summary
    FROM outline_volumes
    ORDER BY project_id ASC, sort_order ASC
  `).all().map((row) => ({
    projectId: row.projectId as string,
    id: row.id as string,
    title: row.title as string,
    wordTarget: row.wordTarget as string,
    summary: row.summary as string
  })) as Array<WorkspacePayload['workspaces'][string]['outlineVolumes'][number] & { projectId: string }>

  const outlineItems = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, id, title, word_target AS wordTarget, conflict, summary, status, sort_order AS sortOrder
    FROM outline_items
    ORDER BY project_id ASC, sort_order ASC
  `).all() as Array<WorkspacePayload['workspaces'][string]['outlineItems'][number] & { projectId: string }>

  const chapters = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, outline_item_id AS outlineItemId, id, title, summary, status, word_target AS wordTarget, content
    FROM chapters
    ORDER BY project_id ASC, sort_order ASC
  `).all() as Array<WorkspacePayload['workspaces'][string]['chapters'][number] & { projectId: string }>

  const chapterVersions = db.prepare(`
    SELECT project_id AS projectId, id, chapter_id AS chapterId, title, summary, status, word_target AS wordTarget, content, created_at AS createdAt
    FROM chapter_versions
    ORDER BY project_id ASC, created_at DESC, rowid DESC
  `).all() as Array<WorkspacePayload['workspaces'][string]['chapterVersions'][number] & { projectId: string }>

  const messages = db.prepare(`
    SELECT project_id AS projectId, id, role, content
    FROM ai_messages
    ORDER BY project_id ASC, sort_order ASC
  `).all() as Array<WorkspacePayload['workspaces'][string]['messages'][number] & { projectId: string }>

  const knowledgeDocuments = db.prepare(`
    SELECT project_id AS projectId, id, title, source_type AS sourceType, source_label AS sourceLabel, content, summary,
      keywords_json AS keywordsJson, metadata_json AS metadataJson, created_at AS createdAt, updated_at AS updatedAt
    FROM knowledge_documents
    ORDER BY project_id ASC, created_at DESC, rowid DESC
  `).all().map((row) => ({
    projectId: row.projectId as string,
    id: row.id as string,
    title: row.title as string,
    sourceType: row.sourceType as KnowledgeDocumentSourceType,
    sourceLabel: row.sourceLabel as string,
    content: row.content as string,
    summary: row.summary as string,
    keywords: (() => {
      try {
        return JSON.parse(row.keywordsJson as string) as string[]
      } catch {
        return []
      }
    })(),
    metadata: (() => {
      try {
        return JSON.parse(row.metadataJson as string) as Record<string, unknown>
      } catch {
        return {}
      }
    })(),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string
  })) as Array<WorkspacePayload['workspaces'][string]['knowledgeDocuments'][number] & { projectId: string }>

  const aiRuns = db.prepare(`
    SELECT project_id AS projectId, id, chapter_id AS chapterId, task, provider, model, status,
      started_at AS startedAt, finished_at AS finishedAt, duration_ms AS durationMs,
      used_knowledge_json AS usedKnowledgeJson, repair_triggered AS repairTriggered,
      error, response_preview AS responsePreview
    FROM ai_runs
    ORDER BY project_id ASC, sort_order ASC
  `).all().map((row) => ({
    projectId: row.projectId as string,
    id: row.id as string,
    chapterId: (row.chapterId as string) || undefined,
    task: row.task as string,
    provider: row.provider as string,
    model: row.model as string,
    status: row.status as WorkspaceAiRunStatus,
    startedAt: row.startedAt as string,
    finishedAt: (row.finishedAt as string) || undefined,
    durationMs: typeof row.durationMs === 'number' ? row.durationMs : undefined,
    usedKnowledge: (() => {
      try {
        return JSON.parse(row.usedKnowledgeJson as string) as WorkspaceAiRunKnowledgeItem[]
      } catch {
        return []
      }
    })(),
    repairTriggered: Boolean(row.repairTriggered),
    error: row.error as string,
    responsePreview: row.responsePreview as string
  })) as Array<WorkspacePayload['workspaces'][string]['aiRuns'][number] & { projectId: string }>

  const workflowDocuments = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, doc_key AS docKey, title, content, updated_at AS updatedAt
    FROM workflow_documents
    ORDER BY project_id ASC, volume_id ASC, sort_order ASC
  `).all() as Array<
    WorkspacePayload['workspaces'][string]['workflowDocuments'][number] & {
      projectId: string
      volumeId: string
      docKey: WorkspacePayload['workspaces'][string]['workflowDocuments'][number]['key']
    }
  >

  const settings = db.prepare(`
    SELECT theme, selected_project_id AS selectedProjectId, provider, api_key AS apiKey, base_url AS baseUrl, auto_save_interval AS autoSaveInterval
    , model, ui_scale AS uiScale, dark_mode AS darkMode
    FROM app_settings
    WHERE id = 1
  `).get() as
    | {
        theme: string
        selectedProjectId: string
        provider: string
        model: string
        apiKey: string
        baseUrl: string
        autoSaveInterval: string
        uiScale: number
        darkMode: number
      }
    | undefined

  if (!settings) {
    return null
  }

  const workspaces = Object.fromEntries(
    projects.map((project) => [
      project.id,
      {
        worldviewEntries: worldviewEntries
          .filter((entry) => entry.projectId === project.id)
          .map(({ projectId: _projectId, ...entry }) => entry),
        characters: characters
          .filter((character) => character.projectId === project.id)
          .map(({ projectId: _projectId, ...character }) => character),
        organizations: organizations
          .filter((entry) => entry.projectId === project.id)
          .map(({ projectId: _projectId, ...entry }) => entry),
        characterRelationships: characterRelationships
          .filter((entry) => entry.projectId === project.id)
          .map(({ projectId: _projectId, ...entry }) => entry),
        organizationMemberships: organizationMemberships
          .filter((entry) => entry.projectId === project.id)
          .map(({ projectId: _projectId, ...entry }) => entry),
        inspirationEntries: inspirationEntries
          .filter((entry) => entry.projectId === project.id)
          .map(({ projectId: _projectId, ...entry }) => entry),
        outlineVolumes: outlineVolumes
          .filter((volume) => volume.projectId === project.id)
          .map(({ projectId: _projectId, ...volume }) => ({
            ...volume,
            workflowDocuments: workflowDocuments
              .filter((document) => document.projectId === project.id && document.volumeId === volume.id)
              .map(({ projectId: _docProjectId, volumeId: _docVolumeId, docKey: _docKey, ...document }) => ({
                ...document,
                key: _docKey
              }))
          })),
        outlineItems: outlineItems
          .filter((item) => item.projectId === project.id)
          .map(({ projectId: _projectId, ...item }) => item),
        chapters: chapters
          .filter((chapter) => chapter.projectId === project.id)
          .map(({ projectId: _projectId, ...chapter }) => chapter),
        chapterVersions: chapterVersions
          .filter((version) => version.projectId === project.id)
          .map(({ projectId: _projectId, ...version }) => version),
        messages: messages
          .filter((message) => message.projectId === project.id)
          .map(({ projectId: _projectId, ...message }) => message),
        knowledgeDocuments: knowledgeDocuments
          .filter((document) => document.projectId === project.id)
          .map(({ projectId: _projectId, ...document }) => document),
        aiRuns: aiRuns
          .filter((run) => run.projectId === project.id)
          .map(({ projectId: _projectId, ...run }) => run),
        workflowDocuments: []
      }
    ])
  ) as WorkspacePayload['workspaces']

  return {
    theme: settings.theme,
    selectedProjectId: settings.selectedProjectId,
    projects,
    workspaces,
    appSettings: {
      ...normalizeAppSettings({
        provider: settings.provider,
        model: settings.model,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        autoSaveInterval: settings.autoSaveInterval,
        uiScale: settings.uiScale,
        darkMode: Boolean(settings.darkMode)
      })
    }
  }
}

/**
 * 将完整的 workspace 快照写入 SQLite（全量覆盖）。
 * 在事务中执行：先清空所有表，再逐表插入新数据，失败时回滚。
 */
function writeWorkspaceSnapshot(db: DatabaseSync, payload: WorkspacePayload): void {
  db.exec('BEGIN')
  try {
    db.exec(`
      DELETE FROM projects;
      DELETE FROM worldview_entries;
      DELETE FROM characters;
      DELETE FROM organizations;
      DELETE FROM character_relationships;
      DELETE FROM organization_memberships;
      DELETE FROM inspiration_entries;
      DELETE FROM outline_volumes;
      DELETE FROM outline_items;
      DELETE FROM chapter_versions;
      DELETE FROM chapters;
      DELETE FROM ai_messages;
      DELETE FROM knowledge_documents;
      DELETE FROM ai_runs;
      DELETE FROM workflow_documents;
      DELETE FROM app_settings;
    `)

    const insertProject = db.prepare(`
      INSERT INTO projects (id, title, genre, novel_length, word_count, last_edited, cover, target_platform, reference_works_json, writing_style_preset_id, writing_style_prompt, novel_workflow_stages_json, project_skills_json, chapter_assistant_templates_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const project of payload.projects) {
      insertProject.run(
        project.id,
        project.title,
        project.genre,
        project.novelLength,
        project.wordCount,
        project.lastEdited,
        project.cover,
        project.targetPlatform,
        JSON.stringify(project.referenceWorks ?? []),
        project.writingStylePresetId,
        project.writingStylePrompt,
        JSON.stringify(project.novelWorkflowStages ?? []),
        JSON.stringify(project.projectSkills ?? []),
        JSON.stringify(project.chapterAssistantTemplates ?? [])
      )
    }

    const insertWorldview = db.prepare(`
      INSERT INTO worldview_entries (id, project_id, type, title, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertCharacter = db.prepare(`
      INSERT INTO characters (id, project_id, name, role, description, avatar, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const insertOrganization = db.prepare(`
      INSERT INTO organizations (id, project_id, name, type, description, motto, color, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertCharacterRelationship = db.prepare(`
      INSERT INTO character_relationships (id, project_id, from_character_id, to_character_id, type, description, intensity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertOrganizationMembership = db.prepare(`
      INSERT INTO organization_memberships (id, project_id, character_id, organization_id, role, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertInspiration = db.prepare(`
      INSERT INTO inspiration_entries (id, project_id, type, title, content, tags_json, source, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertOutlineVolume = db.prepare(`
      INSERT INTO outline_volumes (id, project_id, title, word_target, summary, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const insertOutline = db.prepare(`
      INSERT INTO outline_items (id, project_id, volume_id, title, word_target, conflict, summary, status, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertChapter = db.prepare(`
      INSERT INTO chapters (id, project_id, volume_id, outline_item_id, title, summary, status, word_target, content, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertChapterVersion = db.prepare(`
      INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertMessage = db.prepare(`
      INSERT INTO ai_messages (id, project_id, role, content, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `)

    const insertKnowledgeDocument = db.prepare(`
      INSERT INTO knowledge_documents (id, project_id, title, source_type, source_label, content, summary, keywords_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertAiRun = db.prepare(`
      INSERT INTO ai_runs (id, project_id, chapter_id, task, provider, model, status, started_at, finished_at, duration_ms, used_knowledge_json, repair_triggered, error, response_preview, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertWorkflowDocument = db.prepare(`
      INSERT INTO workflow_documents (id, project_id, volume_id, doc_key, title, content, updated_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const project of payload.projects) {
      const workspace = payload.workspaces[project.id] ?? {
        worldviewEntries: [],
        characters: [],
        organizations: [],
        characterRelationships: [],
        organizationMemberships: [],
        inspirationEntries: [],
        outlineVolumes: [],
        outlineItems: [],
        chapters: [],
        chapterVersions: [],
        messages: [],
        knowledgeDocuments: [],
        aiRuns: [],
        workflowDocuments: []
      }

      workspace.worldviewEntries.forEach((entry, index) => {
        insertWorldview.run(
          entry.id,
          project.id,
          entry.type,
          entry.title,
          entry.content,
          entry.sortOrder ?? index,
          entry.createdAt,
          entry.updatedAt
        )
      })

      workspace.characters.forEach((character) => {
        insertCharacter.run(
          character.id,
          project.id,
          character.name,
          character.role,
          character.description,
          character.avatar,
          JSON.stringify(character.tags)
        )
      })

      workspace.organizations.forEach((organization, index) => {
        insertOrganization.run(
          organization.id,
          project.id,
          organization.name,
          organization.type,
          organization.description,
          organization.motto,
          organization.color,
          organization.sortOrder ?? index,
          organization.createdAt,
          organization.updatedAt
        )
      })

      workspace.characterRelationships.forEach((relationship) => {
        insertCharacterRelationship.run(
          relationship.id,
          project.id,
          relationship.fromCharacterId,
          relationship.toCharacterId,
          relationship.type,
          relationship.description,
          relationship.intensity,
          relationship.createdAt,
          relationship.updatedAt
        )
      })

      workspace.organizationMemberships.forEach((membership) => {
        insertOrganizationMembership.run(
          membership.id,
          project.id,
          membership.characterId,
          membership.organizationId,
          membership.role,
          membership.notes,
          membership.createdAt,
          membership.updatedAt
        )
      })

      workspace.inspirationEntries.forEach((entry, index) => {
        insertInspiration.run(
          entry.id,
          project.id,
          entry.type,
          entry.title,
          entry.content,
          JSON.stringify(entry.tags),
          entry.source,
          entry.sortOrder ?? index,
          entry.createdAt,
          entry.updatedAt
        )
      })

      workspace.outlineVolumes.forEach((volume, index) => {
        insertOutlineVolume.run(volume.id, project.id, volume.title, volume.wordTarget, volume.summary, index)
      })

      workspace.outlineItems.forEach((item, index) => {
        insertOutline.run(
          item.id,
          project.id,
          item.volumeId,
          item.title,
          item.wordTarget,
          item.conflict,
          item.summary,
          item.status,
          item.sortOrder ?? index
        )
      })

      workspace.chapters.forEach((chapter, index) => {
        insertChapter.run(
          chapter.id,
          project.id,
          chapter.volumeId,
          chapter.outlineItemId,
          chapter.title,
          chapter.summary,
          chapter.status,
          chapter.wordTarget,
          chapter.content,
          index
        )
      })

      workspace.chapterVersions.forEach((version) => {
        insertChapterVersion.run(
          version.id,
          project.id,
          version.chapterId,
          version.title,
          version.summary,
          version.status,
          version.wordTarget,
          version.content,
          version.createdAt
        )
      })


      workspace.messages.forEach((message, index) => {
        insertMessage.run(message.id, project.id, message.role, message.content, index)
      })

      workspace.knowledgeDocuments.forEach((document) => {
        insertKnowledgeDocument.run(
          document.id,
          project.id,
          document.title,
          document.sourceType,
          document.sourceLabel,
          document.content,
          document.summary,
          JSON.stringify(document.keywords ?? []),
          JSON.stringify(document.metadata ?? {}),
          document.createdAt,
          document.updatedAt
        )
      })

      workspace.aiRuns.forEach((run, index) => {
        insertAiRun.run(
          run.id,
          project.id,
          run.chapterId ?? '',
          run.task,
          run.provider,
          run.model,
          run.status,
          run.startedAt,
          run.finishedAt ?? '',
          typeof run.durationMs === 'number' ? Math.max(0, Math.round(run.durationMs)) : null,
          JSON.stringify(run.usedKnowledge ?? []),
          run.repairTriggered ? 1 : 0,
          run.error ?? '',
          run.responsePreview ?? '',
          index
        )
      })

      const volumeWorkflowSources =
        workspace.outlineVolumes.flatMap((volume) =>
          (volume.workflowDocuments ?? []).map((document, index) => ({
            volumeId: volume.id,
            document,
            sortOrder: index
          }))
        ) ||
        []

      const fallbackWorkflowSources =
        volumeWorkflowSources.length === 0 && workspace.outlineVolumes[0]
          ? workspace.workflowDocuments.map((document, index) => ({
              volumeId: workspace.outlineVolumes[0].id,
              document,
              sortOrder: index
            }))
          : []

      ;(volumeWorkflowSources.length > 0 ? volumeWorkflowSources : fallbackWorkflowSources).forEach(
        ({ volumeId, document, sortOrder }) => {
          insertWorkflowDocument.run(
            `${project.id}-${volumeId}-${document.key}`,
            project.id,
            volumeId,
            document.key,
            document.title,
            document.content,
            document.updatedAt,
            sortOrder
          )
        }
      )
    }

    db.prepare(`
      INSERT INTO app_settings (id, theme, selected_project_id, provider, model, api_key, base_url, auto_save_interval, ui_scale, dark_mode)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.theme,
      payload.selectedProjectId,
      normalizeAppSettings(payload.appSettings).provider,
      normalizeAppSettings(payload.appSettings).model,
      normalizeAppSettings(payload.appSettings).apiKey,
      normalizeAppSettings(payload.appSettings).baseUrl,
      normalizeAppSettings(payload.appSettings).autoSaveInterval,
      normalizeAppSettings(payload.appSettings).uiScale,
      normalizeAppSettings(payload.appSettings).darkMode ? 1 : 0
    )

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** 导出文件 schema 版本号 */
const EXPORT_SCHEMA_VERSION = '2.0'
/** 导出文件兼容性说明 */
const EXPORT_COMPATIBILITY_NOTE =
  '2.x 导出文件可直接导入当前版本；1.x 旧导出会按兼容模式解析，并默认按完整项目导入。'

/** 导入模块类型 */
type ImportModuleType = 'project' | 'characters' | 'outline' | 'inspiration' | 'relations' | 'chapters'

/** 导入验证结果：成功时包含解析后的载荷和元信息，失败时包含错误消息 */
type ImportValidationResult =
  | {
      valid: true
      payload: Record<string, unknown>
      meta: {
        schemaVersion: string
        moduleType: ImportModuleType
        compatibilityNote: string
        isLegacy: boolean
      }
    }
  | {
      valid: false
      message: string
    }

/** 校验导入的 workspace 数据结构完整性：检查 project 字段和各集合字段的类型 */
function validateImportedWorkspace(payload: unknown): { valid: true } | { valid: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, message: '导入文件不是有效的项目对象。' }
  }

  const data = payload as Record<string, unknown>
  if (!data.project || typeof data.project !== 'object') {
    return { valid: false, message: '缺少 project 字段，无法识别项目基础信息。' }
  }

  const project = data.project as Record<string, unknown>
  if (typeof project.title !== 'string' || !project.title.trim()) {
    return { valid: false, message: 'project.title 缺失或为空。' }
  }

  const collectionChecks: Array<[string, unknown]> = [
    ['worldviewEntries', data.worldviewEntries],
    ['characters', data.characters],
    ['organizations', data.organizations],
    ['characterRelationships', data.characterRelationships],
    ['organizationMemberships', data.organizationMemberships],
    ['inspirationEntries', data.inspirationEntries],
    ['outlineVolumes', data.outlineVolumes],
    ['outlineItems', data.outlineItems],
    ['chapters', data.chapters],
    ['chapterVersions', data.chapterVersions]
  ]

  for (const [field, value] of collectionChecks) {
    if (value !== undefined && !Array.isArray(value)) {
      return { valid: false, message: `${field} 必须是数组格式。` }
    }
  }

  if (Array.isArray(data.worldviewEntries)) {
    const invalidWorldview = data.worldviewEntries.find((item) => {
      if (!item || typeof item !== 'object') return true
      const worldview = item as Record<string, unknown>
      return (
        typeof worldview.type !== 'string' ||
        typeof worldview.title !== 'string' ||
        typeof worldview.content !== 'string' ||
        (worldview.sortOrder !== undefined && typeof worldview.sortOrder !== 'number') ||
        (worldview.createdAt !== undefined && typeof worldview.createdAt !== 'string') ||
        (worldview.updatedAt !== undefined && typeof worldview.updatedAt !== 'string')
      )
    })

    if (invalidWorldview) {
      return { valid: false, message: 'worldviewEntries 中存在字段缺失或格式错误的设定条目。' }
    }
  }

  if (Array.isArray(data.inspirationEntries)) {
    const invalidInspiration = data.inspirationEntries.find((item) => {
      if (!item || typeof item !== 'object') return true
      const inspiration = item as Record<string, unknown>
      return (
        typeof inspiration.type !== 'string' ||
        typeof inspiration.title !== 'string' ||
        typeof inspiration.content !== 'string' ||
        !Array.isArray(inspiration.tags) ||
        (inspiration.source !== undefined && inspiration.source !== 'ai' && inspiration.source !== 'manual') ||
        (inspiration.sortOrder !== undefined && typeof inspiration.sortOrder !== 'number') ||
        (inspiration.createdAt !== undefined && typeof inspiration.createdAt !== 'string') ||
        (inspiration.updatedAt !== undefined && typeof inspiration.updatedAt !== 'string')
      )
    })

    if (invalidInspiration) {
      return { valid: false, message: 'inspirationEntries 中存在字段缺失或格式错误的灵感条目。' }
    }
  }

  if (Array.isArray(data.organizations)) {
    const invalidOrganization = data.organizations.find((item) => {
      if (!item || typeof item !== 'object') return true
      const organization = item as Record<string, unknown>
      return (
        typeof organization.name !== 'string' ||
        typeof organization.type !== 'string' ||
        typeof organization.description !== 'string' ||
        typeof organization.motto !== 'string' ||
        typeof organization.color !== 'string' ||
        (organization.sortOrder !== undefined && typeof organization.sortOrder !== 'number') ||
        (organization.createdAt !== undefined && typeof organization.createdAt !== 'string') ||
        (organization.updatedAt !== undefined && typeof organization.updatedAt !== 'string')
      )
    })

    if (invalidOrganization) {
      return { valid: false, message: 'organizations 中存在字段缺失或格式错误的组织条目。' }
    }
  }

  if (Array.isArray(data.characterRelationships)) {
    const invalidRelationship = data.characterRelationships.find((item) => {
      if (!item || typeof item !== 'object') return true
      const relationship = item as Record<string, unknown>
      return (
        typeof relationship.fromCharacterId !== 'string' ||
        typeof relationship.toCharacterId !== 'string' ||
        typeof relationship.type !== 'string' ||
        typeof relationship.description !== 'string' ||
        (relationship.intensity !== undefined && typeof relationship.intensity !== 'number') ||
        (relationship.createdAt !== undefined && typeof relationship.createdAt !== 'string') ||
        (relationship.updatedAt !== undefined && typeof relationship.updatedAt !== 'string')
      )
    })

    if (invalidRelationship) {
      return { valid: false, message: 'characterRelationships 中存在字段缺失或格式错误的关系条目。' }
    }
  }

  if (Array.isArray(data.organizationMemberships)) {
    const invalidMembership = data.organizationMemberships.find((item) => {
      if (!item || typeof item !== 'object') return true
      const membership = item as Record<string, unknown>
      return (
        typeof membership.characterId !== 'string' ||
        typeof membership.organizationId !== 'string' ||
        typeof membership.role !== 'string' ||
        (membership.notes !== undefined && typeof membership.notes !== 'string') ||
        (membership.createdAt !== undefined && typeof membership.createdAt !== 'string') ||
        (membership.updatedAt !== undefined && typeof membership.updatedAt !== 'string')
      )
    })

    if (invalidMembership) {
      return { valid: false, message: 'organizationMemberships 中存在字段缺失或格式错误的成员归属条目。' }
    }
  }

  if (Array.isArray(data.outlineVolumes)) {
    const invalidVolume = data.outlineVolumes.find((item) => {
      if (!item || typeof item !== 'object') return true
      const volume = item as Record<string, unknown>
      return (
        typeof volume.title !== 'string' ||
        (volume.wordTarget !== undefined && typeof volume.wordTarget !== 'string') ||
        (volume.summary !== undefined && typeof volume.summary !== 'string')
      )
    })
    if (invalidVolume) {
      return { valid: false, message: 'outlineVolumes 中存在字段缺失或格式错误的分卷项。' }
    }
  }

  if (Array.isArray(data.outlineItems)) {
    const invalidOutlineItem = data.outlineItems.find((item) => {
      if (!item || typeof item !== 'object') return true
      const outlineItem = item as Record<string, unknown>
      return (
        typeof outlineItem.title !== 'string' ||
        (outlineItem.volumeId !== undefined && typeof outlineItem.volumeId !== 'string') ||
        (outlineItem.wordTarget !== undefined && typeof outlineItem.wordTarget !== 'string') ||
        (outlineItem.conflict !== undefined && typeof outlineItem.conflict !== 'string') ||
        (outlineItem.summary !== undefined && typeof outlineItem.summary !== 'string') ||
        (outlineItem.status !== undefined && typeof outlineItem.status !== 'string') ||
        (outlineItem.sortOrder !== undefined && typeof outlineItem.sortOrder !== 'number')
      )
    })
    if (invalidOutlineItem) {
      return { valid: false, message: 'outlineItems 中存在字段缺失或格式错误的大纲节点。' }
    }
  }

  if (Array.isArray(data.chapters)) {
    const invalidChapter = data.chapters.find((item) => {
      if (!item || typeof item !== 'object') return true
      const chapter = item as Record<string, unknown>
      return (
        typeof chapter.title !== 'string' ||
        typeof chapter.content !== 'string' ||
        (chapter.outlineItemId !== undefined && typeof chapter.outlineItemId !== 'string') ||
        (chapter.volumeId !== undefined && typeof chapter.volumeId !== 'string') ||
        (chapter.summary !== undefined && typeof chapter.summary !== 'string') ||
        (chapter.status !== undefined && typeof chapter.status !== 'string') ||
        (chapter.wordTarget !== undefined && typeof chapter.wordTarget !== 'string')
      )
    })
    if (invalidChapter) {
      return { valid: false, message: 'chapters 中存在字段缺失或格式错误的章节项。' }
    }
  }

  if (Array.isArray(data.chapterVersions)) {
    const invalidVersion = data.chapterVersions.find((item) => {
      if (!item || typeof item !== 'object') return true
      const version = item as Record<string, unknown>
      return (
        typeof version.chapterId !== 'string' ||
        typeof version.title !== 'string' ||
        typeof version.content !== 'string' ||
        typeof version.createdAt !== 'string' ||
        (version.summary !== undefined && typeof version.summary !== 'string') ||
        (version.status !== undefined && typeof version.status !== 'string') ||
        (version.wordTarget !== undefined && typeof version.wordTarget !== 'string')
      )
    })
    if (invalidVersion) {
      return { valid: false, message: 'chapterVersions 中存在字段缺失或格式错误的版本项。' }
    }
  }

  return { valid: true }
}

/**
 * 校验导入文件的顶层结构：区分 2.x 信封格式和 1.x 旧版格式。
 * 2.x 格式包含 app/schemaVersion/moduleType/data 信封字段；1.x 格式为裸项目对象。
 */
function validateImportedPayload(payload: unknown): ImportValidationResult {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, message: '导入文件不是有效的 JSON 对象。' }
  }

  const data = payload as Record<string, unknown>
  if (
    data.app === 'CharacterArc' &&
    typeof data.schemaVersion === 'string' &&
    typeof data.moduleType === 'string' &&
    data.data &&
    typeof data.data === 'object'
  ) {
    const moduleType = data.moduleType as ImportModuleType
    const normalizedPayload = data.data as Record<string, unknown>
    // New schema exports wrap the real workspace fragment in a stable envelope so
    // future import compatibility checks can evolve without breaking old files.
    const validation = validateImportedWorkspace({
      project: normalizedPayload.project ?? { title: '导入模块' },
      ...normalizedPayload
    })

    if (!validation.valid) {
      return validation
    }

    return {
      valid: true,
      payload: normalizedPayload,
      meta: {
        schemaVersion: data.schemaVersion,
        moduleType,
        compatibilityNote:
          typeof data.compatibilityNote === 'string' && data.compatibilityNote.trim()
            ? data.compatibilityNote
            : EXPORT_COMPATIBILITY_NOTE,
        isLegacy: false
      }
    }
  }

  const legacyValidation = validateImportedWorkspace(data)
  if (!legacyValidation.valid) {
    return legacyValidation
  }

  // Legacy 1.x exports were raw project objects, so we keep accepting them and
  // surface a compatibility note back to the renderer instead of hard failing.
  return {
    valid: true,
    payload: data,
    meta: {
      schemaVersion: '1.0',
      moduleType: 'project',
      compatibilityNote: '这是旧版 1.x 导出文件，系统已按兼容模式识别为完整项目导入。',
      isLegacy: true
    }
  }
}

/** 根据文件扩展名返回 MIME 类型，用于封面图片的 data URL 生成 */
function resolveImageMime(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'application/octet-stream'
}

type ExportRequest = {
  data: unknown
  title?: string
  defaultPath?: string
}

// ══════════════════════════════════════════════════════════════════
// IPC 处理器注册：渲染进程通过 preload 桥调用这些方法
// ══════════════════════════════════════════════════════════════════

/** 导出项目数据为 JSON 文件，弹出系统保存对话框 */
ipcMain.handle('characterarc:export-json', async (_event, payload: unknown) => {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    return { success: false, canceled: true }
  }

  const request = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)
    ? payload
    : {
        data: payload
      }) as ExportRequest

  const result = await dialog.showSaveDialog(window, {
    title: request.title ?? '导出项目数据',
    defaultPath: request.defaultPath ?? 'characterarc-export.json',
    filters: [
      { name: 'JSON 文件', extensions: ['json'] }
    ]
  })

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true }
  }

  await writeFile(result.filePath, JSON.stringify(request.data, null, 2), 'utf-8')
  return {
    success: true,
    canceled: false,
    filePath: result.filePath
  }
})

/** 导出章节为纯文本文件，按分卷分组、章节分隔 */
ipcMain.handle('characterarc:export-text', async (_event, payload: unknown) => {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    return { success: false, canceled: true }
  }

  const request = (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)
    ? payload
    : {
        data: payload
      }) as ExportRequest

  const result = await dialog.showSaveDialog(window, {
    title: request.title ?? '导出章节文本',
    defaultPath: request.defaultPath ?? 'characterarc-export.txt',
    filters: [
      { name: '文本文档', extensions: ['txt'] }
    ]
  })

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true }
  }

  const data = request.data as {
    project?: { title?: string } | null
    outlineVolumes?: Array<{ id?: string; title?: string }>
    chapters?: Array<{ volumeId?: string; title?: string; content?: string }>
  }
  const volumeTitleMap = new Map((data.outlineVolumes ?? []).map((volume) => [volume.id ?? '', volume.title?.trim() || '未命名分卷']))
  let activeVolumeId = ''

  const text = [
    data.project?.title ? `# ${data.project.title}` : '# CharacterArc 导出',
    '',
    ...(data.chapters ?? []).flatMap((chapter, index) => {
      const shouldPrintVolume = chapter.volumeId && chapter.volumeId !== activeVolumeId
      if (chapter.volumeId) {
        activeVolumeId = chapter.volumeId
      }

      return [
        ...(shouldPrintVolume
          ? [`## ${volumeTitleMap.get(chapter.volumeId ?? '') || '未命名分卷'}`, '']
          : []),
        `第${index + 1}章 ${chapter.title ?? '未命名章节'}`,
        '',
        chapter.content?.trim() || '（暂无正文内容）',
        '',
        ''.padEnd(48, '-'),
        ''
      ]
    })
  ].join('\n')

  await writeFile(result.filePath, text, 'utf-8')
  return {
    success: true,
    canceled: false,
    filePath: result.filePath
  }
})

/** 从 JSON 文件导入项目数据，弹出系统打开对话框，校验后返回解析结果 */
ipcMain.handle('characterarc:import-json', async () => {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    return { success: false, canceled: true }
  }

  const result = await dialog.showOpenDialog(window, {
    title: '导入项目 JSON',
    properties: ['openFile'],
    filters: [
      { name: 'JSON 文件', extensions: ['json'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true }
  }

  const raw = await readFile(result.filePaths[0], 'utf-8')
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      success: false,
      canceled: false,
      error: '文件不是有效的 JSON 格式。'
    }
  }

  const validation = validateImportedPayload(parsed)
  if (!validation.valid) {
    return {
      success: false,
      canceled: false,
      error: validation.message
    }
  }

  return {
    success: true,
    canceled: false,
    payload: validation.payload,
    meta: validation.meta
  }
})

/** 选择项目封面图片，返回文件路径和 base64 data URL */
ipcMain.handle('characterarc:pick-cover-image', async () => {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    return { success: false, canceled: true }
  }

  const result = await dialog.showOpenDialog(window, {
    title: '选择项目封面',
    properties: ['openFile'],
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true }
  }

  const filePath = result.filePaths[0]
  const bytes = await readFile(filePath)
  const mime = resolveImageMime(filePath)
  return {
    success: true,
    canceled: false,
    filePath,
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}`
  }
})

/** 导入参考小说并完成拆书分析，返回可回填到项目的仿写结果 */
ipcMain.handle('characterarc:import-reference-novel-analysis', async (_event, payload: ReferenceNovelImportRequest) => {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    return { success: false, canceled: true }
  }

  const result = await dialog.showOpenDialog(window, {
    title: '导入参考小说',
    properties: ['openFile'],
    filters: [
      { name: '小说文本', extensions: ['txt', 'md', 'docx'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true }
  }

  try {
    const request = (payload ?? {}) as ReferenceNovelImportRequest
    emitReferenceImportProgress(window, {
      phase: 'extracting',
      message: '正在读取小说正文并提取基础统计...',
      current: 0,
      total: 1,
      percent: 8
    })
    const localContext = await extractReferenceNovelContext(result.filePaths[0])
    const resolvedTitle = request.preferredTitle?.trim() || localContext.title
    const resolvedSource = request.preferredSource?.trim() || localContext.fileType.toUpperCase()
    emitReferenceImportProgress(window, {
      phase: 'chunking',
      message: `已拆出 ${localContext.analysisChunks.length} 个分析分块，准备逐块提炼风格...`,
      current: 0,
      total: Math.max(localContext.analysisChunks.length, 1),
      percent: 16,
      sourceTitle: resolvedTitle
    })
    const chunkResults: Array<{ label: string; characterCount: number; result: ReferenceStyleChunkResult }> = []
    for (const [index, chunk] of localContext.analysisChunks.entries()) {
      emitReferenceImportProgress(window, {
        phase: 'chunk-analysis',
        message: `正在分析第 ${index + 1} / ${localContext.analysisChunks.length} 个分块：${chunk.label}`,
        current: index + 1,
        total: localContext.analysisChunks.length,
        percent: Math.min(82, 16 + Math.round(((index + 1) / Math.max(localContext.analysisChunks.length, 1)) * 58)),
        sourceTitle: resolvedTitle
      })
      chunkResults.push({
        label: chunk.label,
        characterCount: chunk.characterCount,
        result: (await generateAiTask({
          task: 'reference-style-chunk',
          settings: request.settings,
          context: {
            projectTitle: request.projectTitle ?? '',
            projectGenre: request.projectGenre ?? '',
            projectPlatform: request.projectPlatform ?? '',
            sourceTitle: resolvedTitle,
            chunkLabel: chunk.label,
            chunkIndex: index + 1,
            chunkTotal: localContext.analysisChunks.length,
            chunkCharacterCount: chunk.characterCount,
            chunkMetrics: chunk.metrics,
            chunkKeywords: chunk.topKeywords,
            chunkText: chunk.text
          }
        })).result as ReferenceStyleChunkResult
      })
    }
    emitReferenceImportProgress(window, {
      phase: 'aggregating',
      message: '正在汇总所有分块结论，生成可复用仿写模板...',
      current: chunkResults.length,
      total: chunkResults.length,
      percent: 90,
      sourceTitle: resolvedTitle
    })
    const analysis = (await generateAiTask({
      task: 'reference-style-analysis',
      settings: request.settings,
      context: {
        projectTitle: request.projectTitle ?? '',
        projectGenre: request.projectGenre ?? '',
        projectPlatform: request.projectPlatform ?? '',
        sourceTitle: resolvedTitle,
        sourceFileType: localContext.fileType,
        sourceCharacterCount: localContext.characterCount,
        sourceChapterCount: localContext.chapterCount,
        styleMetrics: localContext.metrics,
        topKeywords: localContext.topKeywords,
        sourceExcerpt: localContext.excerpt,
        analysisSample: localContext.analysisSample,
        chunkSummaries: formatReferenceChunkSummaries(chunkResults)
      }
    })).result as ReferenceStyleAnalysisResult

    const importedAt = new Date().toISOString()
    const knowledgeDocuments = request.projectId
      ? buildImportedReferenceKnowledgeDocuments(request.projectId, resolvedTitle, localContext, analysis, importedAt)
      : []
    emitReferenceImportProgress(window, {
      phase: 'saving',
      message: '正在整理结果并回填到项目风格规则与流程文件...',
      current: 1,
      total: 1,
      percent: 96,
      sourceTitle: resolvedTitle
    })
    const referenceWork = {
      id: `ref-${Date.now()}`,
      title: resolvedTitle,
      source: resolvedSource,
      notes: analysis.overview,
      fileName: localContext.fileName,
      analysis: {
        createdAt: importedAt,
        fileName: localContext.fileName,
        fileType: localContext.fileType,
        characterCount: localContext.characterCount,
        chapterCount: localContext.chapterCount,
        excerpt: localContext.excerpt,
        topKeywords: localContext.topKeywords,
        metrics: [
          ...localContext.metrics,
          { label: '分析分块数', value: `${localContext.analysisChunks.length} 块` }
        ],
        overview: analysis.overview,
        sentenceStyle: analysis.sentenceStyle,
        dialogueRatio: analysis.dialogueRatio,
        pacingControl: analysis.pacingControl,
        emotionExpression: analysis.emotionExpression,
        narrativePerspective: analysis.narrativePerspective,
        styleRules: analysis.styleRules,
        plotOutline: analysis.plotOutline,
        reusableStylePrompt: analysis.reusableStylePrompt,
        avoidRules: analysis.avoidRules
      }
    }
    emitReferenceImportProgress(window, {
      phase: 'done',
      message: `《${resolvedTitle}》拆书完成，结果已回填到项目风格规则、参考档案和 findings。`,
      current: 1,
      total: 1,
      percent: 100,
      sourceTitle: resolvedTitle
    })

    return {
      success: true,
      canceled: false,
      result: {
        referenceWork,
        suggestedWritingStylePrompt: buildImportedReferenceStylePrompt(resolvedTitle, analysis),
        findingsMarkdown: buildImportedReferenceFindingsMarkdown(
          resolvedTitle,
          analysis,
          localContext.metrics,
          localContext.topKeywords
        ),
        knowledgeDocuments
      }
    }
  } catch (error) {
    return {
      success: false,
      canceled: false,
      error: error instanceof Error ? error.message : '参考作品拆书失败'
    }
  }
})

/** 执行非流式 AI 生成任务 */
ipcMain.handle('characterarc:ai-generate', async (_event, payload: AiTaskPayload) => {
  const knowledgeContext = retrieveKnowledgeContext(payload)

  try {
    const result = await generateAiTask(payload, knowledgeContext)
    if (result.meta.projectId) {
      emitAiRunEvent({
        projectId: result.meta.projectId,
        meta: {
          id: randomUUID(),
          chapterId: result.meta.chapterId,
          task: result.meta.task,
          provider: result.meta.provider,
          model: result.meta.model,
          status: result.meta.status,
          startedAt: result.meta.startedAt,
          finishedAt: result.meta.finishedAt,
          durationMs: result.meta.durationMs,
          usedKnowledge: result.meta.usedKnowledge,
          repairTriggered: result.meta.repairTriggered,
          error: result.meta.error,
          responsePreview: result.meta.responsePreview
        }
      })
    }

    return {
      success: true,
      result
    }
  } catch (error) {
    const aiRunMeta = error && typeof error === 'object' && 'aiRunMeta' in error
      ? (error as { aiRunMeta?: Omit<WorkspaceAiRunRecord, 'projectId'> & { projectId: string } }).aiRunMeta
      : undefined

    if (aiRunMeta?.projectId) {
      emitAiRunEvent({
        projectId: aiRunMeta.projectId,
        meta: {
          id: randomUUID(),
          chapterId: aiRunMeta.chapterId,
          task: aiRunMeta.task,
          provider: aiRunMeta.provider,
          model: aiRunMeta.model,
          status: aiRunMeta.status,
          startedAt: aiRunMeta.startedAt,
          finishedAt: aiRunMeta.finishedAt,
          durationMs: aiRunMeta.durationMs,
          usedKnowledge: aiRunMeta.usedKnowledge,
          repairTriggered: aiRunMeta.repairTriggered,
          error: aiRunMeta.error,
          responsePreview: aiRunMeta.responsePreview
        }
      })
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI 调用失败'
    }
  }
})


/** 启动流式 AI 任务，通过 SSE 事件实时推送增量文本到渲染进程 */
ipcMain.handle('characterarc:ai-stream-start', async (event, payload: AiTaskPayload) => {
  try {
    const streamId = `stream-${randomUUID()}`
    const controller = new AbortController()
    const knowledgeContext = retrieveKnowledgeContext(payload)
    activeAiStreams.set(streamId, controller)

    let streamedContent = ''
    void (async () => {
      try {
        const result = await streamAiTask(
          payload,
          {
            onTextDelta: (delta) => {
              streamedContent += delta
              if (!event.sender.isDestroyed()) {
                event.sender.send('characterarc:ai-stream-event', {
                  streamId,
                  type: 'chunk',
                  delta
                })
              }
            }
          },
          controller.signal,
          knowledgeContext
        )

        if (result.meta.projectId) {
          emitAiRunEvent({
            projectId: result.meta.projectId,
            meta: {
              id: randomUUID(),
              chapterId: result.meta.chapterId,
              task: result.meta.task,
              provider: result.meta.provider,
              model: result.meta.model,
              status: result.meta.status,
              startedAt: result.meta.startedAt,
              finishedAt: result.meta.finishedAt,
              durationMs: result.meta.durationMs,
              usedKnowledge: result.meta.usedKnowledge,
              repairTriggered: result.meta.repairTriggered,
              error: result.meta.error,
              responsePreview: result.meta.responsePreview
            }
          })
        }

        if (!event.sender.isDestroyed()) {
          event.sender.send('characterarc:ai-stream-event', {
            streamId,
            type: 'done',
            content: (result.result as { content?: string }).content ?? ''
          })
        }
      } catch (error) {
        const aiRunMeta = error && typeof error === 'object' && 'aiRunMeta' in error
          ? (error as { aiRunMeta?: Omit<WorkspaceAiRunRecord, 'projectId'> & { projectId: string } }).aiRunMeta
          : undefined

        if (aiRunMeta?.projectId) {
          emitAiRunEvent({
            projectId: aiRunMeta.projectId,
            meta: {
              id: randomUUID(),
              chapterId: aiRunMeta.chapterId,
              task: aiRunMeta.task,
              provider: aiRunMeta.provider,
              model: aiRunMeta.model,
              status: aiRunMeta.status,
              startedAt: aiRunMeta.startedAt,
              finishedAt: aiRunMeta.finishedAt,
              durationMs: aiRunMeta.durationMs,
              usedKnowledge: aiRunMeta.usedKnowledge,
              repairTriggered: aiRunMeta.repairTriggered,
              error: aiRunMeta.error,
              responsePreview: aiRunMeta.responsePreview
            }
          })
        }

        if (!event.sender.isDestroyed()) {
          event.sender.send('characterarc:ai-stream-event', controller.signal.aborted
            ? {
                streamId,
                type: 'canceled',
                content: streamedContent
              }
            : {
                streamId,
                type: 'error',
                error: error instanceof Error ? error.message : 'AI 流式调用失败'
              }
          )
        }
      } finally {
        activeAiStreams.delete(streamId)
      }
    })()

    return {
      success: true,
      result: {
        streamId
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI 流式调用启动失败'
    }
  }
})

/** 停止指定 streamId 的流式 AI 任务 */
ipcMain.handle('characterarc:ai-stream-stop', async (_event, streamId: unknown) => {
  const key = typeof streamId === 'string' ? streamId : ''
  const controller = activeAiStreams.get(key)
  if (!controller) {
    return {
      success: false,
      error: '当前没有可停止的生成任务'
    }
  }

  controller.abort()
  return {
    success: true
  }
})

/** 测试 AI 连接：发送探测请求验证鉴权和网络 */
ipcMain.handle('characterarc:ai-test-connection', async (_event, settings: unknown) => {
  try {
    const result = await testAiConnection(settings as {
      provider: string
      model: string
      apiKey: string
      baseUrl: string
    })

    return {
      success: true,
      result
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI 连接测试失败'
    }
  }
})

/** 获取 AI 供应商的可用模型列表 */
ipcMain.handle('characterarc:ai-fetch-models', async (_event, settings: unknown) => {
  try {
    const result = await fetchModels(settings as {
      provider: string
      model: string
      apiKey: string
      baseUrl: string
    })

    return {
      success: true,
      result
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '获取模型列表失败'
    }
  }
})

/** 打开/创建 AI 助手窗口 */
ipcMain.handle('characterarc:assistant-window-open', async () => {
  try {
    createAssistantWindow()
    return {
      success: true,
      visible: true
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI 助手窗口打开失败'
    }
  }
})

/** 关闭 AI 助手窗口 */
ipcMain.handle('characterarc:assistant-window-close', async () => {
  try {
    if (assistantWindow && !assistantWindow.isDestroyed()) {
      assistantWindow.close()
    } else {
      emitAssistantWindowVisibility(false)
    }

    return {
      success: true,
      visible: false
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI 助手窗口关闭失败'
    }
  }
})

/** 查询助手窗口是否打开 */
ipcMain.handle('characterarc:assistant-window-state', () => ({
  success: true,
  visible: Boolean(assistantWindow && !assistantWindow.isDestroyed())
}))

/** 主窗口推送助手上下文（当前选中的项目/章节），转发给助手窗口并缓存 */
ipcMain.handle('characterarc:assistant-context-publish', (_event, payload: unknown) => {
  latestAssistantContext = payload && typeof payload === 'object' ? (payload as AssistantContextPayload) : {}
  sendWindowEvent(assistantWindow, 'characterarc:assistant-context', latestAssistantContext)
  return {
    success: true
  }
})

/** 助手窗口拉取最新缓存的上下文 */
ipcMain.handle('characterarc:assistant-context-get', () => ({
  success: true,
  payload: latestAssistantContext
}))

/** 主窗口推送提示词请求给助手窗口并缓存 */
ipcMain.handle('characterarc:assistant-prompt-publish', (_event, payload: unknown) => {
  latestAssistantPrompt =
    payload && typeof payload === 'object' ? (payload as { id: string; prompt: string; quickAction?: string }) : null
  sendWindowEvent(assistantWindow, 'characterarc:assistant-prompt', latestAssistantPrompt)
  return {
    success: true
  }
})

/** 助手窗口拉取最新缓存的提示词请求 */
ipcMain.handle('characterarc:assistant-prompt-get', () => ({
  success: true,
  payload: latestAssistantPrompt
}))

/** 标记提示词请求已消费，清空缓存（避免助手窗口重复处理） */
ipcMain.handle('characterarc:assistant-prompt-clear', (_event, promptId: unknown) => {
  if (typeof promptId === 'string' && latestAssistantPrompt?.id === promptId) {
    latestAssistantPrompt = null
  }

  return {
    success: true
  }
})

/** 主窗口广播工作区数据同步到其他窗口（排除发送者自身） */
ipcMain.handle('characterarc:workspace-sync-publish', (event, payload: unknown) => {
  if (payload && typeof payload === 'object') {
    updateLatestWorkspaceSnapshot(normalizeWorkspacePayload(payload as WorkspacePayload | LegacyWorkspacePayload))
  }
  broadcastWindowEvent('characterarc:workspace-sync-event', payload, event.sender.id)
  return {
    success: true
  }
})

/** 助手窗口请求主窗口追加一条聊天消息 */
ipcMain.handle('characterarc:assistant-message-publish', (_event, payload: unknown) => {
  sendWindowEvent(mainWindow, 'characterarc:assistant-message', payload)
  return {
    success: true
  }
})

/** 助手窗口向主窗口发送命令（如将 AI 结果插入正文） */
ipcMain.handle('characterarc:assistant-command-publish', (_event, payload: unknown) => {
  sendWindowEvent(mainWindow, 'characterarc:assistant-command', payload)
  return {
    success: true
  }
})

/** 助手窗口确认当前 proposal，由主窗口执行 */
ipcMain.handle('characterarc:assistant-proposal-approve', () => {
  sendWindowEvent(mainWindow, 'characterarc:assistant-proposal-approve', null)
  return {
    success: true
  }
})

/** 助手窗口拒绝当前 proposal */
ipcMain.handle('characterarc:assistant-proposal-reject', () => {
  sendWindowEvent(mainWindow, 'characterarc:assistant-proposal-reject', null)
  return {
    success: true
  }
})

/** 助手窗口关闭当前 proposal 卡片 */
ipcMain.handle('characterarc:assistant-proposal-clear', () => {
  sendWindowEvent(mainWindow, 'characterarc:assistant-proposal-clear', null)
  return {
    success: true
  }
})

ipcMain.handle('characterarc:project-skills-scan', async () => {
  try {
    const skills = await readProjectSkillsFromDisk()
    return {
      success: true,
      skills
    }
  } catch {
    return {
      success: true,
      skills: []
    }
  }
})

ipcMain.handle('characterarc:project-skills-import', async () => {
  try {
    const dialogOptions: Electron.OpenDialogOptions = {
      title: '选择要导入的 Skill 包目录',
      properties: ['openDirectory']
    }
    const ownerWindow = mainWindow ?? BrowserWindow.getFocusedWindow()
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || !result.filePaths[0]) {
      return {
        success: true,
        canceled: true,
        importedSkillIds: []
      }
    }

    const importedSkillIds = await importProjectSkillsFromDirectory(result.filePaths[0])
    if (!importedSkillIds.length) {
      return {
        success: false,
        canceled: false,
        error: '所选目录中没有识别到可导入的 SKILL.md。请选择 skill 包根目录、skills 目录，或单个 skill 目录。'
      }
    }

    return {
      success: true,
      canceled: false,
      importedSkillIds
    }
  } catch (error) {
    return {
      success: false,
      canceled: false,
      error: error instanceof Error ? error.message : '项目技能导入失败'
    }
  }
})

ipcMain.handle('characterarc:project-skills-context', async () => {
  try {
    const skills = await readProjectSkillContextsFromDisk()
    return {
      success: true,
      skills
    }
  } catch {
    return {
      success: true,
      skills: []
    }
  }
})

/** 从 SQLite 加载完整工作区快照，返回给渲染进程初始化 Store */
ipcMain.handle('characterarc:load-workspace', async () => {
  try {
    const db = await ensureWorkspaceDb()
    const workspace = readWorkspaceSnapshot(db)

    if (!workspace) {
      return {
        success: false,
        payload: null
      }
    }

    updateLatestWorkspaceSnapshot(workspace)
    nativeTheme.themeSource = workspace.appSettings.darkMode ? 'dark' : 'light'

    return {
      success: true,
      payload: workspace
    }
  } catch (error) {
    console.error('[workspace] loadWorkspace failed:', error)
    return {
      success: false,
      payload: null,
      error: error instanceof Error ? error.message : 'Unknown workspace load error'
    }
  }
})

/** 获取当前窗口的页面缩放比例 */
ipcMain.handle('characterarc:get-zoom-factor', () => {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!window) {
    return {
      success: false,
      error: 'No active window'
    }
  }

  return {
    success: true,
    factor: window.webContents.getZoomFactor()
  }
})

/** 设置页面缩放比例，限制在 0.75-1.75 范围 */
ipcMain.handle('characterarc:set-zoom-factor', (_event, factor: unknown) => {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!window) {
    return {
      success: false,
      error: 'No active window'
    }
  }

  const numericFactor = typeof factor === 'number' ? factor : Number(factor)
  const nextFactor = Number.isFinite(numericFactor) ? Math.min(1.75, Math.max(0.75, numericFactor)) : 1
  window.webContents.setZoomFactor(nextFactor)

  return {
    success: true,
    factor: nextFactor
  }
})

/** 动态更新 Windows 原生标题栏 Overlay 颜色（随深色/浅色模式切换） */
ipcMain.handle('characterarc:set-titlebar-overlay', (_event, options: { color: string; symbolColor: string }) => {
  if (process.platform !== 'win32') return
  if (mainWindow) mainWindow.setTitleBarOverlay(options)
  if (assistantWindow && !assistantWindow.isDestroyed()) assistantWindow.setTitleBarOverlay(options)
})

/** 将渲染进程的完整工作区快照写入 SQLite（全量覆盖） */
ipcMain.handle('characterarc:save-workspace', async (_event, payload: unknown) => {
  try {
    const db = await ensureWorkspaceDb()
    const normalized = normalizeWorkspacePayload(payload as WorkspacePayload | LegacyWorkspacePayload)
    writeWorkspaceSnapshot(db, normalized)
    updateLatestWorkspaceSnapshot(normalized)
    nativeTheme.themeSource = normalized.appSettings.darkMode ? 'dark' : 'light'

    return {
      success: true
    }
  } catch (error) {
    console.error('[workspace] saveWorkspace failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown workspace save error'
    }
  }
})

// ── 应用生命周期 ──
// macOS 上关闭所有窗口后点击 dock 图标时重新创建主窗口
app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
