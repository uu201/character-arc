import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { generateAiTask, streamAiTask, testAiConnection, type AiTaskPayload } from './ai'

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
}

// 缓存最新的助手上下文和提示词，新窗口打开时可立即同步
let latestAssistantContext: AssistantContextPayload = {}
let latestAssistantPrompt: {
  id: string
  prompt: string
  quickAction?: string
} | null = null

/** 根据屏幕工作区尺寸计算主窗口的宽高和最小尺寸，小屏幕时自动缩小 */
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

  void window.loadFile(join(__dirname, '../../dist/index.html'), search ? { search } : undefined)
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
  const window = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    autoHideMenuBar: true,
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

  const window = new BrowserWindow({
    width: ASSISTANT_WINDOW_WIDTH,
    height: ASSISTANT_WINDOW_HEIGHT,
    minWidth: ASSISTANT_WINDOW_MIN_WIDTH,
    minHeight: ASSISTANT_WINDOW_MIN_HEIGHT,
    x: assistantX,
    y: assistantY,
    parent: mainWindow ?? undefined,
    autoHideMenuBar: true,
    title: 'AI 创作助理',
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? {
            color: '#f4f7fb',
            symbolColor: '#1d1d1f'
          }
        : false,
    backgroundColor: '#f4f7fb',
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
      word_count TEXT NOT NULL,
      last_edited TEXT NOT NULL,
      cover TEXT NOT NULL,
      writing_style_preset_id TEXT NOT NULL DEFAULT 'cinematic-cool',
      writing_style_prompt TEXT NOT NULL DEFAULT ''
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
}

/** 确保 chapters 表包含 summary、status、word_target 列（schema 升级） */
function ensureChapterColumns(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info('chapters')`).all() as Array<{ name: string }>
  const columnNames = new Set(columns.map((column) => column.name))

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
    wordCount: string
    lastEdited: string
    cover: string
    writingStylePresetId: string
    writingStylePrompt: string
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
      }>
      outlineItems: Array<{
        id: string
        volumeId: string
        title: string
        wordTarget: string
        conflict: string
        summary: string
        sortOrder: number
      }>
      chapters: Array<{
        id: string
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
    }
  >
  appSettings: {
    provider: string
    model: string
    apiKey: string
    baseUrl: string
    autoSaveInterval: string
    uiScale: number
  }
}

/** 确保 projects 表包含写作风格相关列（writing_style_preset_id, writing_style_prompt） */
function ensureProjectColumns(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info('projects')`).all() as Array<{ name: string }>
  const columnNames = new Set(columns.map((column) => column.name))

  if (!columnNames.has('writing_style_preset_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN writing_style_preset_id TEXT NOT NULL DEFAULT 'cinematic-cool';`)
  }

  if (!columnNames.has('writing_style_prompt')) {
    db.exec(`ALTER TABLE projects ADD COLUMN writing_style_prompt TEXT NOT NULL DEFAULT '';`)
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
    sortOrder?: number
  }>
  chapters?: Array<{
    id: string
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
    uiScale
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
    wordCount: project.wordCount || '待统计',
    lastEdited: project.lastEdited || '刚刚更新',
    cover: project.cover || 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
    writingStylePresetId: project.writingStylePresetId || 'cinematic-cool',
    writingStylePrompt: project.writingStylePrompt || ''
  }
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
                sortOrder: item.sortOrder ?? index
              }))
            : [],
        chapters:
          project.id === selectedProjectId
            ? (legacyPayload.chapters ?? []).map((chapter) => ({
                ...chapter,
                volumeId: chapter.volumeId || legacyPayload.outlineVolumes?.[0]?.id || 'volume-legacy-default'
              }))
            : [],
        chapterVersions: project.id === selectedProjectId ? legacyPayload.chapterVersions ?? [] : [],
        messages: project.id === selectedProjectId ? legacyPayload.messages ?? [] : []
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
  const projects = db.prepare(`
    SELECT id, title, genre, word_count AS wordCount, last_edited AS lastEdited, cover,
      writing_style_preset_id AS writingStylePresetId,
      writing_style_prompt AS writingStylePrompt
    FROM projects
    ORDER BY rowid ASC
  `).all() as WorkspacePayload['projects']

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
  `).all() as Array<WorkspacePayload['workspaces'][string]['outlineVolumes'][number] & { projectId: string }>

  const outlineItems = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, id, title, word_target AS wordTarget, conflict, summary, sort_order AS sortOrder
    FROM outline_items
    ORDER BY project_id ASC, sort_order ASC
  `).all() as Array<WorkspacePayload['workspaces'][string]['outlineItems'][number] & { projectId: string }>

  const chapters = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, id, title, summary, status, word_target AS wordTarget, content
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

  const settings = db.prepare(`
    SELECT theme, selected_project_id AS selectedProjectId, provider, api_key AS apiKey, base_url AS baseUrl, auto_save_interval AS autoSaveInterval
    , model, ui_scale AS uiScale
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
          .map(({ projectId: _projectId, ...volume }) => volume),
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
          .map(({ projectId: _projectId, ...message }) => message)
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
        uiScale: settings.uiScale
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
      DELETE FROM app_settings;
    `)

    const insertProject = db.prepare(`
      INSERT INTO projects (id, title, genre, word_count, last_edited, cover, writing_style_preset_id, writing_style_prompt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const project of payload.projects) {
      insertProject.run(
        project.id,
        project.title,
        project.genre,
        project.wordCount,
        project.lastEdited,
        project.cover,
        project.writingStylePresetId,
        project.writingStylePrompt
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
      INSERT INTO outline_items (id, project_id, volume_id, title, word_target, conflict, summary, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertChapter = db.prepare(`
      INSERT INTO chapters (id, project_id, volume_id, title, summary, status, word_target, content, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertChapterVersion = db.prepare(`
      INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMessage = db.prepare(`
      INSERT INTO ai_messages (id, project_id, role, content, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `)

    for (const project of payload.projects) {
      const workspace = payload.workspaces[project.id] ?? {
        worldviewEntries: [],
        characters: [],
        inspirationEntries: [],
        outlineVolumes: [],
        outlineItems: [],
        chapters: [],
        chapterVersions: [],
        messages: []
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
          item.sortOrder ?? index
        )
      })

      workspace.chapters.forEach((chapter, index) => {
        insertChapter.run(
          chapter.id,
          project.id,
          chapter.volumeId,
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
    }

    db.prepare(`
      INSERT INTO app_settings (id, theme, selected_project_id, provider, model, api_key, base_url, auto_save_interval, ui_scale)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.theme,
      payload.selectedProjectId,
      normalizeAppSettings(payload.appSettings).provider,
      normalizeAppSettings(payload.appSettings).model,
      normalizeAppSettings(payload.appSettings).apiKey,
      normalizeAppSettings(payload.appSettings).baseUrl,
      normalizeAppSettings(payload.appSettings).autoSaveInterval,
      normalizeAppSettings(payload.appSettings).uiScale
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

/** 执行非流式 AI 生成任务 */
ipcMain.handle('characterarc:ai-generate', async (_event, payload: AiTaskPayload) => {
  try {
    const result = await generateAiTask(payload)
    return {
      success: true,
      result
    }
  } catch (error) {
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
          controller.signal
        )

        if (!event.sender.isDestroyed()) {
          event.sender.send('characterarc:ai-stream-event', {
            streamId,
            type: 'done',
            content: result.content
          })
        }
      } catch (error) {
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
  broadcastWindowEvent('characterarc:workspace-sync-event', payload, event.sender.id)
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

    return {
      success: true,
      payload: workspace
    }
  } catch (error) {
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

/** 将渲染进程的完整工作区快照写入 SQLite（全量覆盖） */
ipcMain.handle('characterarc:save-workspace', async (_event, payload: unknown) => {
  try {
    const db = await ensureWorkspaceDb()
    writeWorkspaceSnapshot(db, normalizeWorkspacePayload(payload as WorkspacePayload | LegacyWorkspacePayload))

    return {
      success: true
    }
  } catch (error) {
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
