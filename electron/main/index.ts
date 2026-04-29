import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { generateAiTask, streamAiTask, testAiConnection, type AiTaskPayload } from './ai'

const APP_DEFAULT_WIDTH = 1480
const APP_DEFAULT_HEIGHT = 920
const APP_MIN_WIDTH = 1120
const APP_MIN_HEIGHT = 720
const WORKSPACE_DB = 'workspace.db'
const WORKSPACE_FILE = 'workspace.json'
const activeAiStreams = new Map<string, AbortController>()

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

function createMainWindow(): void {
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
            symbolColor: '#1d1d1f',
            height: 28
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    void window.loadFile(join(__dirname, '../../dist/index.html'))
  }
}

function getWorkspaceDirPath(): string {
  return join(app.getPath('userData'), 'data')
}

function getWorkspaceFilePath(): string {
  return join(getWorkspaceDirPath(), WORKSPACE_FILE)
}

function getWorkspaceDbPath(): string {
  return join(getWorkspaceDirPath(), WORKSPACE_DB)
}

let workspaceDb: DatabaseSync | null = null

async function ensureWorkspaceDir(): Promise<void> {
  await mkdir(getWorkspaceDirPath(), { recursive: true })
}

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
      cover TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS worldview_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
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

  ensureAppSettingsColumns(workspaceDb)
  ensureChapterColumns(workspaceDb)
  ensureProjectScopedColumns(workspaceDb)
  ensureVolumeColumns(workspaceDb)

  await migrateLegacyWorkspaceFile(workspaceDb)
  return workspaceDb
}

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

function ensureProjectScopedColumns(db: DatabaseSync): void {
  const defaultProjectId =
    (db.prepare(`SELECT selected_project_id AS projectId FROM app_settings WHERE id = 1`).get() as { projectId?: string } | undefined)
      ?.projectId ||
    (db.prepare(`SELECT id FROM projects ORDER BY rowid ASC LIMIT 1`).get() as { id?: string } | undefined)?.id ||
    'project-1'

  const projectScopedTables = ['worldview_entries', 'characters', 'outline_volumes', 'outline_items', 'chapters', 'chapter_versions', 'ai_messages']
  for (const tableName of projectScopedTables) {
    const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all() as Array<{ name: string }>
    const columnNames = new Set(columns.map((column) => column.name))

    if (!columnNames.has('project_id')) {
      // Legacy single-project data is migrated into the selected project workspace during schema upgrade.
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN project_id TEXT NOT NULL DEFAULT '${defaultProjectId}';`)
    }
  }
}

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
  }>
  workspaces: Record<
    string,
    {
      worldviewEntries: Array<{
        id: string
        type: string
        title: string
        content: string
      }>
      characters: Array<{
        id: string
        name: string
        role: string
        description: string
        avatar: string
        tags: Array<{ label: string; tone?: string }>
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

type LegacyWorkspacePayload = Omit<WorkspacePayload, 'workspaces'> & {
  worldviewEntries?: Array<{
    id: string
    type: string
    title: string
    content: string
  }>
  characters?: Array<{
    id: string
    name: string
    role: string
    description: string
    avatar: string
    tags: Array<{ label: string; tone?: string }>
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

function createFallbackVolume(title = '故事开端', volumeId = 'volume-legacy-default') {
  return {
    id: volumeId,
    title,
    wordTarget: '目标 5万字',
    summary: '用于承载当前项目的默认分卷。'
  }
}

function normalizeWorkspacePayload(payload: WorkspacePayload | LegacyWorkspacePayload): WorkspacePayload {
  if ('workspaces' in payload && payload.workspaces) {
    return {
      ...payload,
      appSettings: normalizeAppSettings(payload.appSettings)
    }
  }

  const legacyPayload = payload as LegacyWorkspacePayload
  const projects = legacyPayload.projects?.length ? legacyPayload.projects : []
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
        worldviewEntries: project.id === selectedProjectId ? legacyPayload.worldviewEntries ?? [] : [],
        characters: project.id === selectedProjectId ? legacyPayload.characters ?? [] : [],
        outlineItems:
          project.id === selectedProjectId
            ? (legacyPayload.outlineItems ?? []).map((item) => ({
                ...item,
                volumeId: item.volumeId || legacyPayload.outlineVolumes?.[0]?.id || 'volume-legacy-default'
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

function readWorkspaceSnapshot(db: DatabaseSync): WorkspacePayload | null {
  const projects = db.prepare(`
    SELECT id, title, genre, word_count AS wordCount, last_edited AS lastEdited, cover
    FROM projects
    ORDER BY rowid ASC
  `).all() as WorkspacePayload['projects']

  if (projects.length === 0) {
    return null
  }

  const worldviewEntries = db.prepare(`
    SELECT project_id AS projectId, id, type, title, content
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

  const outlineVolumes = db.prepare(`
    SELECT project_id AS projectId, id, title, word_target AS wordTarget, summary
    FROM outline_volumes
    ORDER BY project_id ASC, sort_order ASC
  `).all() as Array<WorkspacePayload['workspaces'][string]['outlineVolumes'][number] & { projectId: string }>

  const outlineItems = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, id, title, word_target AS wordTarget, conflict, summary
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

function writeWorkspaceSnapshot(db: DatabaseSync, payload: WorkspacePayload): void {
  db.exec('BEGIN')
  try {
    db.exec(`
      DELETE FROM projects;
      DELETE FROM worldview_entries;
      DELETE FROM characters;
      DELETE FROM outline_volumes;
      DELETE FROM outline_items;
      DELETE FROM chapter_versions;
      DELETE FROM chapters;
      DELETE FROM ai_messages;
      DELETE FROM app_settings;
    `)

    const insertProject = db.prepare(`
      INSERT INTO projects (id, title, genre, word_count, last_edited, cover)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const project of payload.projects) {
      insertProject.run(project.id, project.title, project.genre, project.wordCount, project.lastEdited, project.cover)
    }

    const insertWorldview = db.prepare(`
      INSERT INTO worldview_entries (id, project_id, type, title, content, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const insertCharacter = db.prepare(`
      INSERT INTO characters (id, project_id, name, role, description, avatar, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
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
        outlineVolumes: [],
        outlineItems: [],
        chapters: [],
        chapterVersions: [],
        messages: []
      }

      workspace.worldviewEntries.forEach((entry, index) => {
        insertWorldview.run(entry.id, project.id, entry.type, entry.title, entry.content, index)
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

      workspace.outlineVolumes.forEach((volume, index) => {
        insertOutlineVolume.run(volume.id, project.id, volume.title, volume.wordTarget, volume.summary, index)
      })

      workspace.outlineItems.forEach((item, index) => {
        insertOutline.run(item.id, project.id, item.volumeId, item.title, item.wordTarget, item.conflict, item.summary, index)
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
        (outlineItem.summary !== undefined && typeof outlineItem.summary !== 'string')
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

  const validation = validateImportedWorkspace(parsed)
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
    payload: parsed
  }
})

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
