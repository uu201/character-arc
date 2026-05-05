import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { FAST_PERSIST_DELAY_MS, formatAutoSaveIntervalLabel, isLiveAutoSaveInterval, resolveAutoSaveDelayMs } from '@/features/settings/autoSave'
import { createDefaultWorkflowDocuments } from '@/features/novelWorkflow/documents'
import { createDefaultNovelWorkflowStages } from '@/features/novelWorkflow/stages'
import { DEFAULT_CHAPTER_WORD_TARGET, normalizeChapterWordTarget } from '@/features/chapters/wordTarget'
import { formatProjectWordCount } from '@/features/projects/wordCount'
import {
  buildVolumeGroups,
  createOutlineVolume as createWorkspaceVolume
} from '@/features/workspace/outlineVolumes'
import { getThemePreset } from '@/theme/presets'
import { createEmptyWorkspace } from '@/features/workspace/projectWorkspace'
import {
  buildStarterChapter,
  buildWorkspaceMapFromLegacy,
  defaultProjects,
  loadStoredState,
  normalizeAppSettings,
  normalizeChapterAssistantTemplates,
  normalizeProjectSummary,
  normalizeChapterDraft,
  normalizeChapterVersion,
  normalizeProjectWorkspaceData,
  getChapterSequenceInVolume,
  getOutlineSequenceInVolume,
  getWorkspacePrimaryVolumeId,
  insertIntoVolumeSection,
  toSerializable,
  type LegacyStoredState,
  type StoredState
} from '@/features/workspace/storeHelpers'
import { characterArcWindowKind, isAssistantWindow } from '@/utils/windowKind'
import { toIpcPayload } from '@/utils/ipcPayload'
import type {
  AssistantPromptRequest,
  AppSettings,
  ChapterDraft,
  ChapterInsertionMode,
  ChapterInsertionRequest,
  ChapterSelectionState,
  ChapterVersion,
  ChatMessage,
  CharacterCard,
  CharacterRelationship,
  InspirationEntry,
  ImportConflictMode,
  ImportExportModuleType,
  KnowledgeDocument,
  AiRunRecord,
  NovelLength,
  OrganizationEntry,
  OrganizationMembership,
  OutlineItem,
  OutlineVolume,
  PanelName,
  PlotThread,
  ProjectImportPayload,
  ProjectSummary,
  ProjectWorkspaceData,
  ThemeName,
  WorldviewEntry
} from '@/types/app'

/** 创建项目向导的载荷结构，包含项目基础信息和可选的各类业务数据 */
interface ProjectWorkspacePayload {
  project: {
    title: string
    genre: string
    novelLength: NovelLength
    wordCount?: string
    cover?: string
    writingStylePresetId?: string
    writingStylePrompt?: string
    chapterAssistantTemplates?: ProjectSummary['chapterAssistantTemplates']
    novelWorkflowStages?: ProjectSummary['novelWorkflowStages']
    projectSkills?: ProjectSummary['projectSkills']
    targetPlatform?: string
    referenceWorks?: ProjectSummary['referenceWorks']
  }
  worldviewEntries?: WorldviewEntry[]
  characters?: CharacterCard[]
  organizations?: OrganizationEntry[]
  characterRelationships?: CharacterRelationship[]
  organizationMemberships?: OrganizationMembership[]
  inspirationEntries?: InspirationEntry[]
  outlineVolumes?: OutlineVolume[]
  outlineItems?: OutlineItem[]
  chapters?: ChapterDraft[]
  chapterVersions?: ChapterVersion[]
  messages?: ChatMessage[]
}

/** 将日期字符串转换为 ISO 时间戳，无效值时使用当前时间 */
function toIsoTimestamp(value?: string): string {
  const parsed = value ? new Date(value) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return new Date().toISOString()
}

let nextIdCounter = 0
/** 生成基于时间戳+自增序号的唯一 ID，保证同毫秒内也不重复 */
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++nextIdCounter}`
}

/** 重新编排世界观条目的 sortOrder，确保连续递增 */
function reindexWorldviewEntries(entries: WorldviewEntry[]): WorldviewEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    sortOrder: index
  }))
}

/** 重新编排大纲节点的 sortOrder */
function reindexOutlineItems(items: OutlineItem[]): OutlineItem[] {
  return items.map((item, index) => ({
    ...item,
    sortOrder: index
  }))
}

/** 重新编排灵感条目的 sortOrder */
function reindexInspirationEntries(entries: InspirationEntry[]): InspirationEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    sortOrder: index
  }))
}

/** 重新编排组织的 sortOrder */
function reindexOrganizations(entries: OrganizationEntry[]): OrganizationEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    sortOrder: index
  }))
}


// ══════════════════════════════════════════════════════════════════
// 全局 Pinia Store：管理整个应用的状态
// 包含项目列表、当前工作区、所有业务实体、视图导航、持久化调度
// ══════════════════════════════════════════════════════════════════
export const useAppStore = defineStore('app', () => {
  const stored = loadStoredState()
  /** 是否已完成初始化水合（从 SQLite 加载数据） */
  const hasHydrated = ref(false)
  /** 持久化错误信息，null 表示无错误 */
  const persistenceError = ref<string | null>(null)
  /** 防抖保存定时器 ID */
  let saveTimer: number | null = null
  /** 工作区同步防抖定时器 ID */
  let workspaceSyncTimer: number | null = null
  /** 下次计划持久化的时间戳 */
  const scheduledPersistAt = ref<number | null>(null)
  /** 当前视图：项目列表 / 新建向导 / 工作台 / 章节写作 */
  const currentView = ref<'projects' | 'wizard' | 'workbench' | 'chapter-studio'>('projects')
  /** 工作台中当前激活的面板 */
  const activePanel = ref<PanelName>('workflow')
  /** 上一次在工作台中查看的面板（非 chapters），用于从章节写作返回时恢复 */
  const lastWorkbenchPanel = ref<Exclude<PanelName, 'chapters'>>('workflow')
  /** AI 助手窗口是否可见 */
  const aiVisible = ref(true)
  /** 当前主题名称 */
  const theme = ref<ThemeName>(stored.theme)
  /** 当前选中的项目 ID */
  const selectedProjectId = ref(stored.selectedProjectId)
  /** 所有项目摘要列表 */
  const projects = ref<ProjectSummary[]>(stored.projects)
  /** 项目 ID → 工作区数据 的映射表 */
  const projectWorkspaces = ref<Record<string, ProjectWorkspaceData>>(stored.workspaces)
  /** 应用全局设置（AI 供应商、模型、自动保存等） */
  const appSettings = ref<AppSettings>(stored.appSettings)
  /** 待处理的助手提示词请求（来自主窗口） */
  const pendingAssistantRequest = ref<AssistantPromptRequest | null>(null)
  /** 待执行的章节正文插入请求 */
  const pendingChapterInsertion = ref<ChapterInsertionRequest | null>(null)
  /** 用户在编辑器中当前选中的文本状态 */
  const currentChapterSelection = ref<ChapterSelectionState | null>(null)
  /** 当前选中的章节 ID */
  const selectedChapterId = ref(stored.workspaces[stored.selectedProjectId]?.chapters[0]?.id ?? '')
  /** 标记是否正在应用远程工作区同步，防止循环同步 */
  let isApplyingRemoteWorkspaceSync = false
  /** 流程面板当前激活的分卷 ID，空字符串时回退到第一个分卷 */
  const activeWorkflowVolumeId = ref<string>('')

  // ── 计算属性：从当前工作区派生各业务实体列表 ──
  /** 当前项目的工作区数据，项目不存在时返回空工作区 */
  const currentWorkspace = computed(
    () => projectWorkspaces.value[selectedProjectId.value] ?? createEmptyWorkspace()
  )
  /** 当前项目的世界观设定列表 */
  const worldviewEntries = computed(() => currentWorkspace.value.worldviewEntries)
  /** 当前项目的角色列表 */
  const characters = computed(() => currentWorkspace.value.characters)
  /** 当前项目的组织列表 */
  const organizations = computed(() => currentWorkspace.value.organizations)
  /** 当前项目的角色关系列表 */
  const characterRelationships = computed(() => currentWorkspace.value.characterRelationships)
  /** 当前项目的组织成员归属列表 */
  const organizationMemberships = computed(() => currentWorkspace.value.organizationMemberships)
  /** 当前项目的灵感卡片列表 */
  const inspirationEntries = computed(() => currentWorkspace.value.inspirationEntries)
  /** 当前项目的大纲节点列表 */
  const outlineItems = computed(() => currentWorkspace.value.outlineItems)
  /** 当前项目的章节列表 */
  const chapters = computed(() => currentWorkspace.value.chapters)
  /** 当前项目的大纲分卷列表 */
  const outlineVolumes = computed(() => currentWorkspace.value.outlineVolumes)
  /** 当前项目的章节历史版本列表 */
  const chapterVersions = computed(() => currentWorkspace.value.chapterVersions)
  /** 当前项目的 AI 聊天消息列表 */
  const messages = computed(() => currentWorkspace.value.messages)
  /** 当前项目的剧情线索列表 */
  const plotThreads = computed(() => currentWorkspace.value.plotThreads)
  /** 当前项目的知识文档列表 */
  const knowledgeDocuments = computed(() => currentWorkspace.value.knowledgeDocuments)
  /** 当前项目的 AI 运行记录列表 */
  const aiRuns = computed(() => currentWorkspace.value.aiRuns)
  /** 流程面板当前激活的分卷（回退到第一个分卷） */
  const activeWorkflowVolume = computed(
    () => outlineVolumes.value.find((v) => v.id === activeWorkflowVolumeId.value) ?? outlineVolumes.value[0]
  )
  /** 当前激活分卷的流程文件（每卷独立维护） */
  const workflowDocuments = computed(
    () => activeWorkflowVolume.value?.workflowDocuments ?? createDefaultWorkflowDocuments()
  )
  /** 自动保存间隔的人类可读标签 */
  const autoSaveIntervalLabel = computed(() => formatAutoSaveIntervalLabel(appSettings.value.autoSaveInterval))
  /** 是否为实时自动保存模式 */
  const isLiveAutoSave = computed(() => isLiveAutoSaveInterval(appSettings.value.autoSaveInterval))
  /** 是否有待持久化的更改 */
  const isPersistencePending = computed(() => scheduledPersistAt.value !== null)
  /** 当前选中的章节对象 */
  const selectedChapter = computed(
    () => chapters.value.find((chapter) => chapter.id === selectedChapterId.value) ?? chapters.value[0]
  )
  /** 当前选中章节所属的分卷 */
  const selectedChapterVolume = computed(
    () => outlineVolumes.value.find((volume) => volume.id === selectedChapter.value?.volumeId) ?? outlineVolumes.value[0]
  )
  /** 按分卷分组的大纲节点 */
  const outlineVolumeGroups = computed(() => buildVolumeGroups(outlineVolumes.value, outlineItems.value))
  /** 按分卷分组的章节 */
  const chapterVolumeGroups = computed(() => buildVolumeGroups(outlineVolumes.value, chapters.value))
  /** 当前主题的 Naive UI 覆盖配置 */
  const currentTheme = computed(() => getThemePreset(theme.value))
  /** 当前选中的项目摘要 */
  const currentProject = computed(
    () => projects.value.find((project) => project.id === selectedProjectId.value) ?? projects.value[0]
  )

  // ── 助手窗口通信 ──
  /** 将当前选中的项目/章节上下文序列化为推送给助手窗口的载荷 */
  function serializeAssistantContext(): CharacterArcAssistantContextPayload {
    return {
      selectedProjectId: selectedProjectId.value,
      selectedChapterId: selectedChapterId.value,
      currentChapterSelection: currentChapterSelection.value
        ? {
            chapterId: currentChapterSelection.value.chapterId,
            text: currentChapterSelection.value.text
          }
        : null
    }
  }

  /** 从主窗口推送的上下文载荷中恢复状态（助手窗口调用） */
  function applyAssistantContext(payload?: CharacterArcAssistantContextPayload | null): void {
    if (!payload?.selectedProjectId) {
      return
    }

    ensureProjectWorkspace(payload.selectedProjectId)
    selectedProjectId.value = payload.selectedProjectId

    if (payload.selectedChapterId) {
      selectedChapterId.value = payload.selectedChapterId
    } else {
      syncSelectedChapter(payload.selectedProjectId)
    }

    if (
      payload.currentChapterSelection &&
      payload.currentChapterSelection.chapterId === selectedChapterId.value &&
      payload.currentChapterSelection.text.trim()
    ) {
      currentChapterSelection.value = {
        chapterId: payload.currentChapterSelection.chapterId,
        text: payload.currentChapterSelection.text.trim()
      }
      return
    }

    currentChapterSelection.value = null
  }

  /** 防抖调度工作区同步到其他窗口（120ms 延迟） */
  function scheduleWorkspaceSync(): void {
    if (!hasHydrated.value || isApplyingRemoteWorkspaceSync) {
      return
    }

    if (workspaceSyncTimer) {
      window.clearTimeout(workspaceSyncTimer)
    }

    workspaceSyncTimer = window.setTimeout(() => {
      void window.characterArc.publishWorkspaceSync(toIpcPayload(serializeWorkspaceState()))
    }, 120)
  }

  /** 向助手窗口推送最新的项目/章节上下文（仅主窗口调用） */
  function publishAssistantContext(): void {
    if (characterArcWindowKind !== 'main') {
      return
    }

    void window.characterArc.publishAssistantContext(toIpcPayload(serializeAssistantContext()))
  }

  /** 查询助手窗口是否打开，同步 aiVisible 状态 */
  async function syncAssistantWindowState(): Promise<void> {
    if (characterArcWindowKind !== 'main') {
      aiVisible.value = true
      return
    }

    const result = await window.characterArc.getAssistantWindowState()
    aiVisible.value = result.success ? Boolean(result.visible) : false
  }

  /** 打开 AI 助手窗口并同步上下文 */
  async function openAssistantWindow(): Promise<void> {
    const result = await window.characterArc.openAssistantWindow()
    if (!result.success) {
      return
    }

    aiVisible.value = true
    publishAssistantContext()
    scheduleWorkspaceSync()
  }

  /** 关闭 AI 助手窗口 */
  async function closeAssistantWindow(): Promise<void> {
    const result = await window.characterArc.closeAssistantWindow()
    if (result.success) {
      aiVisible.value = false
    }
  }

  /** 接收主窗口推送的提示词请求，存入 pendingAssistantRequest */
  function receiveAssistantPrompt(payload?: CharacterArcAssistantPromptPayload | null): void {
    if (!payload?.id || !payload.prompt.trim()) {
      return
    }

    pendingAssistantRequest.value = {
      id: payload.id,
      prompt: payload.prompt,
      quickAction: payload.quickAction
    }
  }

  /** 处理远程工作区同步：应用从其他窗口推送过来的状态更新 */
  function handleRemoteWorkspaceSync(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return
    }

    isApplyingRemoteWorkspaceSync = true
    try {
      applyWorkspaceState(payload as Partial<StoredState>)
    } finally {
      isApplyingRemoteWorkspaceSync = false
    }
  }

  function handleAiRunEvent(payload: CharacterArcAiRunEventPayload): void {
    if (!payload?.projectId || !payload.meta) {
      return
    }

    appendAiRun(payload.projectId, payload.meta)
  }

  /** 处理助手窗口发送的命令（如将 AI 结果插入正文），仅主窗口响应 */
  function handleAssistantCommand(payload: CharacterArcAssistantCommand): void {
    if (characterArcWindowKind !== 'main') {
      return
    }

    if (payload.type === 'insert-into-chapter') {
      insertIntoChapter(payload.content, payload.mode)
    }
  }

  /** 同步选中章节 ID：确保当前选中的章节仍属于指定项目，否则回退到第一章 */
  function syncSelectedChapter(projectId = selectedProjectId.value): void {
    const chapterList = projectWorkspaces.value[projectId]?.chapters ?? []
    const hasCurrentChapter = chapterList.some((chapter) => chapter.id === selectedChapterId.value)
    selectedChapterId.value = hasCurrentChapter ? selectedChapterId.value : (chapterList[0]?.id ?? '')
  }

  /** 确保指定项目的工作区数据存在，不存在时创建空工作区 */
  function ensureProjectWorkspace(projectId: string): void {
    if (projectWorkspaces.value[projectId]) {
      return
    }

    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData(undefined)
    }
  }

  /** 用 updater 函数更新指定项目的工作区数据，自动标准化 */
  function updateProjectWorkspace(projectId: string, updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData): void {
    const baseWorkspace = normalizeProjectWorkspaceData(projectWorkspaces.value[projectId])
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData(updater(baseWorkspace))
    }
  }

  /** 用 updater 函数更新当前项目的工作区数据，并同步章节选择和工作区同步 */
  function updateCurrentWorkspace(updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData): void {
    ensureProjectWorkspace(selectedProjectId.value)
    updateProjectWorkspace(selectedProjectId.value, updater)
    syncProjectWordCount(selectedProjectId.value)
    syncSelectedChapter()
    scheduleWorkspaceSync()
  }

  function syncProjectWordCount(projectId: string): void {
    const workspace = projectWorkspaces.value[projectId]
    if (!workspace) {
      return
    }

    const nextWordCount = formatProjectWordCount(workspace.chapters)
    projects.value = projects.value.map((project) =>
      project.id === projectId
        ? {
            ...project,
            wordCount: nextWordCount
          }
        : project
    )
  }

  /** 从持久化载荷恢复全局状态（主题、项目列表、工作区、设置），兼容旧版格式 */
  function applyWorkspaceState(payload?: Partial<StoredState> | LegacyStoredState | null): void {
    if (!payload) {
      return
    }

    theme.value = payload.theme ?? 'ocean'
    projects.value = payload.projects?.length ? payload.projects.map(normalizeProjectSummary) : defaultProjects

    const fallbackProjectId = projects.value[0]?.id ?? defaultProjects[0].id
    selectedProjectId.value = payload.selectedProjectId ?? fallbackProjectId
    projectWorkspaces.value =
      'workspaces' in payload && payload.workspaces
        ? Object.fromEntries(
            Object.entries(payload.workspaces).map(([projectId, workspace]) => [
              projectId,
              normalizeProjectWorkspaceData(workspace)
            ])
          )
        : buildWorkspaceMapFromLegacy(payload as LegacyStoredState, selectedProjectId.value)

    for (const project of projects.value) {
      ensureProjectWorkspace(project.id)
    }

    appSettings.value = normalizeAppSettings(payload.appSettings)
    syncSelectedChapter()
  }

  /** 将当前全局状态序列化为可持久化的 StoredState 对象 */
  function serializeWorkspaceState(): StoredState {
    return {
      theme: theme.value,
      selectedProjectId: selectedProjectId.value,
      projects: toSerializable(projects.value),
      workspaces: toSerializable(projectWorkspaces.value),
      appSettings: toSerializable(appSettings.value)
    }
  }

  /**
   * Store 初始化入口：从 SQLite 加载工作区 → 同步助手窗口状态 → 助手窗口拉取上下文 → 标记水合完成。
   * 必须在 Vue 挂载前调用。
   */
  async function initialize(): Promise<void> {
    const result = await window.characterArc.loadWorkspace()
    if (result.success && result.payload) {
      applyWorkspaceState(result.payload as Partial<StoredState>)
      persistenceError.value = null
    } else {
      const err = result.error ?? null
      console.error('[workspace] loadWorkspace failed:', err)
      persistenceError.value = err
    }

    await syncAssistantWindowState()

    if (isAssistantWindow) {
      const [contextResult, promptResult] = await Promise.all([
        window.characterArc.getAssistantContext(),
        window.characterArc.getAssistantPrompt()
      ])

      if (contextResult.success) {
        applyAssistantContext(contextResult.payload)
      }

      if (promptResult.success) {
        receiveAssistantPrompt(promptResult.payload ?? null)
      }
    } else {
      publishAssistantContext()
    }

    hasHydrated.value = true
  }

  /** 立即执行一次持久化写入（取消待执行的防抖定时器） */
  async function persistWorkspace(): Promise<void> {
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }

    const result = await window.characterArc.saveWorkspace(toIpcPayload(serializeWorkspaceState()))
    if (!result.success) {
      console.error('[workspace] saveWorkspace failed:', result.error)
    }
    persistenceError.value = result.success ? null : result.error ?? '保存失败'
    if (result.success) {
      scheduledPersistAt.value = null
    }
  }

  /**
   * 调度一次防抖持久化。
   * fast 模式（300ms）用于用户主动操作后的快速保存；
   * autosave 模式使用用户配置的自动保存间隔。
   */
  function schedulePersist(mode: 'fast' | 'autosave' = 'autosave'): void {
    if (!hasHydrated.value) {
      return
    }

    scheduleWorkspaceSync()

    const delay = mode === 'fast' ? FAST_PERSIST_DELAY_MS : resolveAutoSaveDelayMs(appSettings.value.autoSaveInterval)
    scheduledPersistAt.value = Date.now() + delay

    if (saveTimer) {
      window.clearTimeout(saveTimer)
    }

    // Keep one active timer so the latest edit always wins and the interval can be changed on the fly.
    saveTimer = window.setTimeout(() => {
      void persistWorkspace()
    }, delay)
  }

  // ── 项目导入 ──
  /** 为导入的实体生成带时间戳的唯一 ID，避免与现有数据冲突 */
  function buildImportedId(prefix: string, index: number): string {
    return `${prefix}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
  }

  /** 导入完整项目数据：创建新项目、分配独立工作区、切换到工作台 */
  function importProjectData(payload: ProjectImportPayload): void {
    const projectId = uniqueId('project')
    const importedWorkspace = normalizeProjectWorkspaceData({
      worldviewEntries: payload.worldviewEntries,
      characters: payload.characters,
      organizations: payload.organizations,
      characterRelationships: payload.characterRelationships,
      organizationMemberships: payload.organizationMemberships,
      inspirationEntries: payload.inspirationEntries,
      outlineVolumes: payload.outlineVolumes,
      outlineItems: payload.outlineItems,
      chapters: payload.chapters,
      chapterVersions: payload.chapterVersions
    })
    const project: ProjectSummary = {
      id: projectId,
      title: payload.project?.title?.trim() || '导入项目',
      genre: payload.project?.genre?.trim() || '未分类',
      novelLength: payload.project?.novelLength === 'short' ? 'short' : 'long',
      wordCount: formatProjectWordCount(importedWorkspace.chapters),
      lastEdited: '刚刚导入',
      cover: payload.project?.cover || 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)',
      writingStylePresetId: payload.project?.writingStylePresetId?.trim() || 'cinematic-cool',
      writingStylePrompt: payload.project?.writingStylePrompt?.trim() || '',
      chapterAssistantTemplates: normalizeChapterAssistantTemplates(payload.project?.chapterAssistantTemplates),
      novelWorkflowStages: payload.project?.novelWorkflowStages ?? createDefaultNovelWorkflowStages(),
      projectSkills: payload.project?.projectSkills ?? [],
      targetPlatform: payload.project?.targetPlatform?.trim() || '',
      referenceWorks: payload.project?.referenceWorks ?? []
    }

    projects.value = [normalizeProjectSummary(project), ...projects.value]
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: importedWorkspace
    }
    selectedProjectId.value = project.id
    pendingChapterInsertion.value = null
    currentView.value = 'workbench'
    activePanel.value = 'workflow'
    syncSelectedChapter(project.id)
    schedulePersist('fast')
  }

  /**
   * 按模块类型导入数据到当前项目工作区。
   * 支持 overwrite（覆盖）和 copy（追加）两种冲突模式。
   * relations 模块会自动匹配角色姓名，缺失时创建新角色。
   */
  function importModuleData(moduleType: ImportExportModuleType, payload: ProjectImportPayload, mode: ImportConflictMode): void {
    updateCurrentWorkspace((workspace) => {
      // Normalize once so every module import can reuse the same fallback and schema repair path.
      const normalizedImport = normalizeProjectWorkspaceData({
        worldviewEntries: payload.worldviewEntries,
        characters: payload.characters,
        organizations: payload.organizations,
        characterRelationships: payload.characterRelationships,
        organizationMemberships: payload.organizationMemberships,
        inspirationEntries: payload.inspirationEntries,
        outlineVolumes: payload.outlineVolumes,
        outlineItems: payload.outlineItems,
        chapters: payload.chapters,
        chapterVersions: payload.chapterVersions
      })

      if (moduleType === 'characters') {
        if (mode === 'overwrite') {
          return {
            ...workspace,
            characters: normalizedImport.characters
          }
        }

        return {
          ...workspace,
          characters: [
            ...normalizedImport.characters.map((character, index) => ({
              ...character,
              id: buildImportedId('character', index)
            })),
            ...workspace.characters
          ]
        }
      }

      if (moduleType === 'inspiration') {
        if (mode === 'overwrite') {
          return {
            ...workspace,
            inspirationEntries: reindexInspirationEntries(normalizedImport.inspirationEntries)
          }
        }

        return {
          ...workspace,
          inspirationEntries: reindexInspirationEntries([
            ...normalizedImport.inspirationEntries.map((entry, index) => ({
              ...entry,
              id: buildImportedId('inspiration', index)
            })),
            ...workspace.inspirationEntries
          ])
        }
      }

      if (moduleType === 'outline') {
        const volumeIdMap = new Map<string, string>()
        const importedVolumes = normalizedImport.outlineVolumes.map((volume, index) => {
          const nextId = buildImportedId('volume', index)
          volumeIdMap.set(volume.id, nextId)
          return {
            ...volume,
            id: nextId
          }
        })
        const importedItems = normalizedImport.outlineItems.map((item, index) => ({
          ...item,
          id: buildImportedId('outline', index),
          volumeId: volumeIdMap.get(item.volumeId) || item.volumeId
        }))

        if (mode === 'overwrite') {
          return {
            ...workspace,
            outlineVolumes: importedVolumes,
            outlineItems: reindexOutlineItems(importedItems)
          }
        }

        return {
          ...workspace,
          outlineVolumes: [...workspace.outlineVolumes, ...importedVolumes],
          outlineItems: reindexOutlineItems([...workspace.outlineItems, ...importedItems])
        }
      }

      if (moduleType === 'chapters') {
        const volumeIdMap = new Map<string, string>()
        const chapterIdMap = new Map<string, string>()
        const importedVolumes = normalizedImport.outlineVolumes.map((volume, index) => {
          const nextId = buildImportedId('volume', index)
          volumeIdMap.set(volume.id, nextId)
          return {
            ...volume,
            id: nextId
          }
        })
        const importedChapters = normalizedImport.chapters.map((chapter, index) => {
          const nextId = buildImportedId('chapter', index)
          chapterIdMap.set(chapter.id, nextId)
          return normalizeChapterDraft({
            ...chapter,
            id: nextId,
            volumeId: volumeIdMap.get(chapter.volumeId) || chapter.volumeId
          })
        })
        const importedVersions = normalizedImport.chapterVersions.map((version, index) =>
          normalizeChapterVersion({
            ...version,
            id: buildImportedId('chapter-version', index),
            chapterId: chapterIdMap.get(version.chapterId) || version.chapterId
          })
        )

        if (mode === 'overwrite') {
          return {
            ...workspace,
            outlineVolumes: importedVolumes.length ? importedVolumes : workspace.outlineVolumes,
            chapters: importedChapters,
            chapterVersions: importedVersions
          }
        }

        return {
          ...workspace,
          outlineVolumes: importedVolumes.length ? [...workspace.outlineVolumes, ...importedVolumes] : workspace.outlineVolumes,
          chapters: [...workspace.chapters, ...importedChapters],
          chapterVersions: [...workspace.chapterVersions, ...importedVersions]
        }
      }

      if (moduleType === 'relations') {
        const characterNameMap = new Map(workspace.characters.map((character) => [character.name.trim(), character.id]))
        const importedCharacterIdMap = new Map<string, string>()
        const importedCharacters: CharacterCard[] = []

        // Relations and memberships depend on character ids, so we first match by
        // local name and only create missing characters when no stable match exists.
        normalizedImport.characters.forEach((character, index) => {
          const existingId = characterNameMap.get(character.name.trim())
          if (existingId) {
            importedCharacterIdMap.set(character.id, existingId)
            return
          }

          const nextId = buildImportedId('character', index)
          importedCharacterIdMap.set(character.id, nextId)
          importedCharacters.push({
            ...character,
            id: nextId
          })
        })

        const organizationIdMap = new Map<string, string>()
        const importedOrganizations = normalizedImport.organizations.map((organization, index) => {
          const nextId = buildImportedId('organization', index)
          organizationIdMap.set(organization.id, nextId)
          return {
            ...organization,
            id: nextId
          }
        })
        const importedRelationships = normalizedImport.characterRelationships
          .map((relationship, index) => {
            const fromCharacterId = importedCharacterIdMap.get(relationship.fromCharacterId)
            const toCharacterId = importedCharacterIdMap.get(relationship.toCharacterId)
            if (!fromCharacterId || !toCharacterId) {
              return null
            }

            return {
              ...relationship,
              id: buildImportedId('relationship', index),
              fromCharacterId,
              toCharacterId
            }
          })
          .filter((relationship): relationship is CharacterRelationship => Boolean(relationship))
        const importedMemberships = normalizedImport.organizationMemberships
          .map((membership, index) => {
            const characterId = importedCharacterIdMap.get(membership.characterId)
            const organizationId = organizationIdMap.get(membership.organizationId)
            if (!characterId || !organizationId) {
              return null
            }

            return {
              ...membership,
              id: buildImportedId('membership', index),
              characterId,
              organizationId
            }
          })
          .filter((membership): membership is OrganizationMembership => Boolean(membership))

        if (mode === 'overwrite') {
          return {
            ...workspace,
            characters: [...importedCharacters, ...workspace.characters],
            organizations: reindexOrganizations(importedOrganizations),
            characterRelationships: importedRelationships,
            organizationMemberships: importedMemberships
          }
        }

        return {
          ...workspace,
          characters: [...importedCharacters, ...workspace.characters],
          organizations: reindexOrganizations([...importedOrganizations, ...workspace.organizations]),
          characterRelationships: [...importedRelationships, ...workspace.characterRelationships],
          organizationMemberships: [...importedMemberships, ...workspace.organizationMemberships]
        }
      }

      return workspace
    })

    schedulePersist('fast')
  }

  // ── 视图导航 ──
  /** 切换主题并触发快速持久化 */
  function setTheme(nextTheme: ThemeName): void {
    theme.value = nextTheme
    schedulePersist('fast')
  }

  /** 进入章节写作页面 */
  function openChapterStudio(chapterId?: string): void {
    if (chapterId) {
      selectedChapterId.value = chapterId
    } else if (!selectedChapterId.value) {
      syncSelectedChapter()
    }

    pendingChapterInsertion.value = null
    activePanel.value = 'chapters'
    currentView.value = 'chapter-studio'
  }

  /** 从章节写作返回工作台 */
  function backToWorkbench(): void {
    currentView.value = 'workbench'
    if (activePanel.value === 'chapters') {
      activePanel.value = lastWorkbenchPanel.value
    }
  }

  /** 打开指定项目：确保工作区存在、切换选中项目、进入工作台 */
  function openProject(projectId: string): void {
    const project = projects.value.find((item) => item.id === projectId)
    if (!project) {
      return
    }

    ensureProjectWorkspace(projectId)
    selectedProjectId.value = projectId
    pendingChapterInsertion.value = null
    currentView.value = 'workbench'
    activePanel.value = 'workflow'
    lastWorkbenchPanel.value = 'workflow'
    syncSelectedChapter(projectId)
    schedulePersist('fast')
  }

  /** 返回项目列表页 */
  function backToProjects(): void {
    currentView.value = 'projects'
  }

  /** 打开新建项目向导 */
  function openWizard(): void {
    currentView.value = 'wizard'
  }

  /** 关闭向导，返回项目列表 */
  function closeWizard(): void {
    currentView.value = 'projects'
  }

  // ── 项目 CRUD ──
  /** 从向导创建完整项目工作区：分配 ID、设置默认分卷和章节、切换到工作台 */
  function createProjectWorkspace(payload: ProjectWorkspacePayload): void {
    const projectId = uniqueId('project')
    const nextVolumes = payload.outlineVolumes?.length ? payload.outlineVolumes : [createWorkspaceVolume()]
    const nextChapters = payload.chapters?.length ? payload.chapters : [buildStarterChapter(nextVolumes[0].id)]
    const computedWordCount = formatProjectWordCount(nextChapters)

    projects.value.unshift(normalizeProjectSummary({
      id: projectId,
      title: payload.project.title,
      genre: payload.project.genre,
      novelLength: payload.project.novelLength,
      wordCount: computedWordCount,
      lastEdited: '刚刚创建',
      cover: payload.project.cover || 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
      writingStylePresetId: payload.project.writingStylePresetId?.trim() || 'cinematic-cool',
      writingStylePrompt: payload.project.writingStylePrompt?.trim() || '',
      chapterAssistantTemplates: normalizeChapterAssistantTemplates(payload.project.chapterAssistantTemplates),
      novelWorkflowStages: payload.project.novelWorkflowStages ?? createDefaultNovelWorkflowStages(),
      projectSkills: payload.project.projectSkills ?? [],
      targetPlatform: payload.project.targetPlatform?.trim() || '',
      referenceWorks: payload.project.referenceWorks ?? []
    }))

    // A new project gets its own isolated workspace instead of reusing the previous project's draft state.
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData({
        worldviewEntries: payload.worldviewEntries,
        characters: payload.characters,
        organizations: payload.organizations,
        characterRelationships: payload.characterRelationships,
        organizationMemberships: payload.organizationMemberships,
        inspirationEntries: payload.inspirationEntries,
        outlineVolumes: nextVolumes,
        outlineItems: payload.outlineItems,
        chapters: nextChapters,
        chapterVersions: payload.chapterVersions,
        messages: payload.messages
      })
    }
    selectedProjectId.value = projectId
    pendingChapterInsertion.value = null
    aiVisible.value = true
    currentView.value = 'workbench'
    activePanel.value =
      payload.worldviewEntries?.length || payload.inspirationEntries?.length || payload.outlineItems?.length
        ? 'overview'
        : 'chapters'
    syncSelectedChapter(projectId)
    schedulePersist('fast')
  }

  /** 快速创建项目（仅标题/题材/长短篇/字数展示），自动生成默认分卷和首章 */
  function createProject(payload: { title: string; genre: string; novelLength: NovelLength }): void {
    const starterVolume = createWorkspaceVolume()
    createProjectWorkspace({
      project: payload,
      outlineVolumes: [starterVolume],
      chapters: [buildStarterChapter(starterVolume.id)]
    })
  }

  /** 删除项目（至少保留一个项目），自动切换到首个项目 */
  function deleteProject(projectId: string): void {
    if (projects.value.length <= 1) {
      return
    }

    projects.value = projects.value.filter((project) => project.id !== projectId)
    const { [projectId]: _removedWorkspace, ...remainingWorkspaces } = projectWorkspaces.value
    projectWorkspaces.value = remainingWorkspaces

    if (selectedProjectId.value === projectId) {
      selectedProjectId.value = projects.value[0].id
      pendingChapterInsertion.value = null
      currentView.value = 'projects'
      syncSelectedChapter()
    }

    schedulePersist('fast')
  }

  /** 更新项目摘要信息（标题、题材、封面等） */
  function updateProject(projectId: string, payload: Partial<ProjectSummary>): void {
    projects.value = projects.value.map((project) =>
      project.id === projectId
        ? {
            ...project,
            title: payload.title?.trim() || project.title,
            genre: payload.genre?.trim() || project.genre,
            novelLength: payload.novelLength !== undefined ? payload.novelLength : project.novelLength,
            lastEdited: payload.lastEdited?.trim() || '刚刚更新',
            cover: payload.cover || project.cover,
            writingStylePresetId: payload.writingStylePresetId?.trim() || project.writingStylePresetId,
            writingStylePrompt:
              payload.writingStylePrompt !== undefined ? payload.writingStylePrompt.trim() : project.writingStylePrompt,
            chapterAssistantTemplates:
              payload.chapterAssistantTemplates !== undefined
                ? normalizeChapterAssistantTemplates(payload.chapterAssistantTemplates)
                : project.chapterAssistantTemplates,
            novelWorkflowStages:
              payload.novelWorkflowStages !== undefined ? payload.novelWorkflowStages : project.novelWorkflowStages,
            projectSkills: payload.projectSkills !== undefined ? payload.projectSkills : project.projectSkills,
            targetPlatform: payload.targetPlatform !== undefined ? payload.targetPlatform.trim() : project.targetPlatform,
            referenceWorks: payload.referenceWorks !== undefined ? payload.referenceWorks : project.referenceWorks
          }
        : project
    )
    schedulePersist('fast')
  }
  function updateWorkflowDocument(volumeId: string, documentKey: string, content: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map((volume) =>
        volume.id !== volumeId
          ? volume
          : {
              ...volume,
              workflowDocuments: (volume.workflowDocuments ?? []).map((document) =>
                document.key === documentKey
                  ? { ...document, content, updatedAt: new Date().toISOString() }
                  : document
              )
            }
      )
    }))
    schedulePersist('fast')
  }

  function mergeKnowledgeDocuments(projectId: string, documents: KnowledgeDocument[]): void {
    const normalizedDocuments = normalizeProjectWorkspaceData({ knowledgeDocuments: documents }).knowledgeDocuments
      .map((document) => ({
        ...document,
        projectId
      }))

    const getDocumentSourceKey = (document: KnowledgeDocument): string | null => {
      const sourceTitle = String(document.metadata?.sourceTitle ?? '').trim()
      const fileName = String(document.metadata?.fileName ?? '').trim()
      if (sourceTitle && fileName) {
        return `${sourceTitle}::${fileName}`
      }
      if (sourceTitle) {
        return sourceTitle
      }
      return null
    }

    updateProjectWorkspace(projectId, (workspace) => {
      const incomingSourceKeys = new Set(
        normalizedDocuments
          .map((document) => getDocumentSourceKey(document))
          .filter((key): key is string => Boolean(key))
      )

      const preservedDocuments = incomingSourceKeys.size
        ? (workspace.knowledgeDocuments ?? []).filter((document) => {
            const sourceKey = getDocumentSourceKey(document)
            return !sourceKey || !incomingSourceKeys.has(sourceKey)
          })
        : (workspace.knowledgeDocuments ?? [])

      return {
        ...workspace,
        knowledgeDocuments: [...preservedDocuments, ...normalizedDocuments]
      }
    })
    schedulePersist('fast')
  }

  function appendAiRun(projectId: string, record: Omit<AiRunRecord, 'projectId'>): void {
    if (!projectId.trim()) {
      return
    }

    updateProjectWorkspace(projectId, (workspace) => ({
      ...workspace,
      aiRuns: [
        ...(workspace.aiRuns ?? []),
        {
          ...record,
          projectId,
          usedKnowledge: Array.isArray(record.usedKnowledge)
            ? record.usedKnowledge.map((item) => ({
                documentId: String(item.documentId ?? '').trim(),
                title: String(item.title ?? '').trim() || '未命名知识片段',
                sourceType: item.sourceType === 'reference-summary'
                  ? 'reference-summary' as const
                  : 'reference-chunk' as const,
                sourceLabel: String(item.sourceLabel ?? '').trim(),
                snippet: String(item.snippet ?? '').trim(),
                keywords: Array.isArray(item.keywords)
                  ? item.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 8)
                  : []
              }))
            : []
        }
      ].slice(-200)
    }))
    schedulePersist('fast')
  }

  function updateWorkflowDocuments(
    volumeId: string,
    payloads: Array<{ key: string; content: string }>
  ): void {
    if (!payloads.length) {
      return
    }

    const payloadMap = new Map(payloads.map((payload) => [payload.key, payload.content]))
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map((volume) =>
        volume.id !== volumeId
          ? volume
          : {
              ...volume,
              workflowDocuments: (volume.workflowDocuments ?? []).map((document) =>
                payloadMap.has(document.key)
                  ? { ...document, content: payloadMap.get(document.key) ?? document.content, updatedAt: new Date().toISOString() }
                  : document
              )
            }
      )
    }))
    schedulePersist('fast')
  }

  function appendWorkflowDocumentEntry(volumeId: string, documentKey: string, entryTitle: string, body: string): void {
    const normalizedBody = body.trim()
    if (!normalizedBody) {
      return
    }

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map((volume) => {
        if (volume.id !== volumeId) {
          return volume
        }

        return {
          ...volume,
          workflowDocuments: (volume.workflowDocuments ?? []).map((document) => {
            if (document.key !== documentKey) {
              return document
            }

            const header = document.content.split('\n')[0] || `# ${document.title.replace(/\.md$/i, '')}`
            const isPlaceholder = /待 AI 生成|待补充/.test(document.content) && document.content.trim().split('\n').length <= 3
            const nextContent = isPlaceholder
              ? `${header}\n\n## ${entryTitle}\n${normalizedBody}\n`
              : `${document.content.trim()}\n\n## ${entryTitle}\n${normalizedBody}\n`

            return { ...document, content: nextContent, updatedAt: new Date().toISOString() }
          })
        }
      })
    }))
    schedulePersist('fast')
  }

  function setActiveWorkflowVolumeId(id: string): void {
    activeWorkflowVolumeId.value = id
  }

  // ── 世界观 CRUD ──
  /** 创建世界观设定条目，插入到列表头部 */
  function createWorldviewEntry(payload?: Partial<WorldviewEntry>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries([
        {
          id: uniqueId('world'),
          type: payload?.type?.trim() || '地理',
          title: payload?.title?.trim() || `新设定条目 ${workspace.worldviewEntries.length + 1}`,
          content:
            payload?.content?.trim() ||
            '这里是新的世界观设定草稿。你可以继续补充时代背景、法则机制或地理环境细节。',
          sortOrder: payload?.sortOrder ?? 0,
          createdAt,
          updatedAt
        },
        ...workspace.worldviewEntries
      ])
    }))
    schedulePersist('fast')
  }

  function updateWorldviewEntry(entryId: string, payload: Partial<WorldviewEntry>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries(
        workspace.worldviewEntries.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                type: payload.type?.trim() || entry.type,
                title: payload.title?.trim() || entry.title,
                content: payload.content?.trim() || entry.content,
                updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString())
              }
            : entry
        )
      )
    }))
    schedulePersist('fast')
  }

  function deleteWorldviewEntry(entryId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries(workspace.worldviewEntries.filter((entry) => entry.id !== entryId))
    }))
    schedulePersist('fast')
  }

  // ── 角色 CRUD ──
  /** 创建新角色卡，插入到列表头部 */
  function createCharacter(payload?: Partial<CharacterCard>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: [
        {
          id: uniqueId('char'),
          name: payload?.name?.trim() || `新角色 ${workspace.characters.length + 1}`,
          role: payload?.role?.trim() || '待设定',
          avatar: payload?.avatar || 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)',
          description:
            payload?.description?.trim() ||
            '这是一名新加入项目的角色草稿。你可以继续补充身份、背景、动机与冲突。',
          tags:
            payload?.tags?.length
              ? payload.tags
              : [{ label: '待完善', tone: 'warning' }]
        },
        ...workspace.characters
      ]
    }))
    schedulePersist('fast')
  }

  function updateCharacter(characterId: string, payload: Partial<CharacterCard>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              name: payload.name?.trim() || character.name,
              role: payload.role?.trim() ?? character.role,
              avatar: payload.avatar || character.avatar,
              description: payload.description?.trim() || character.description,
              tags: payload.tags?.length ? payload.tags : character.tags
            }
          : character
      )
    }))
    schedulePersist('fast')
  }

  /** 删除角色，同时清理其所有关系和组织归属 */
  function deleteCharacter(characterId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.filter((character) => character.id !== characterId),
      characterRelationships: workspace.characterRelationships.filter(
        (relationship) =>
          relationship.fromCharacterId !== characterId && relationship.toCharacterId !== characterId
      ),
      organizationMemberships: workspace.organizationMemberships.filter(
        (membership) => membership.characterId !== characterId
      )
    }))
    schedulePersist('fast')
  }

  // ── 组织 CRUD ──
  /** 创建新组织，插入到列表头部 */
  function createOrganization(payload?: Partial<OrganizationEntry>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizations: reindexOrganizations([
        {
          id: uniqueId('org'),
          name: payload?.name?.trim() || `新组织 ${workspace.organizations.length + 1}`,
          type: payload?.type?.trim() || '中立势力',
          description:
            payload?.description?.trim() ||
            '这里记录组织定位、资源边界和它在故事中的作用，方便后续接入关系图与章节推进。',
          motto: payload?.motto?.trim() || '待补充组织口号',
          color: payload?.color || 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
          sortOrder: payload?.sortOrder ?? 0,
          createdAt,
          updatedAt
        },
        ...workspace.organizations
      ])
    }))
    schedulePersist('fast')
  }

  function updateOrganization(organizationId: string, payload: Partial<OrganizationEntry>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizations: reindexOrganizations(
        workspace.organizations.map((organization) =>
          organization.id === organizationId
            ? {
                ...organization,
                name: payload.name?.trim() || organization.name,
                type: payload.type?.trim() || organization.type,
                description: payload.description?.trim() || organization.description,
                motto: payload.motto?.trim() || organization.motto,
                color: payload.color || organization.color,
                updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString())
              }
            : organization
        )
      )
    }))
    schedulePersist('fast')
  }

  /** 删除组织，同时清理其所有成员归属关系 */
  function deleteOrganization(organizationId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizations: reindexOrganizations(
        workspace.organizations.filter((organization) => organization.id !== organizationId)
      ),
      organizationMemberships: workspace.organizationMemberships.filter(
        (membership) => membership.organizationId !== organizationId
      )
    }))
    schedulePersist('fast')
  }

  // ── 角色关系 CRUD ──
  /** 创建角色关系，自动选择默认的角色对 */
  function createCharacterRelationship(payload?: Partial<CharacterRelationship>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)
    const fallbackFromCharacterId = payload?.fromCharacterId || characters.value[0]?.id || ''
    const fallbackToCharacterId =
      payload?.toCharacterId ||
      characters.value.find((character) => character.id !== fallbackFromCharacterId)?.id ||
      fallbackFromCharacterId

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characterRelationships: [
        {
          id: uniqueId('relationship'),
          fromCharacterId: fallbackFromCharacterId,
          toCharacterId: fallbackToCharacterId,
          type: payload?.type?.trim() || '待定义关系',
          description:
            payload?.description?.trim() ||
            '补充两人之间的合作、对立、情感张力或利益绑定，后续可直接服务章节冲突编排。',
          intensity:
            payload?.intensity !== undefined && Number.isFinite(payload.intensity)
              ? Math.min(100, Math.max(0, payload.intensity))
              : 50,
          createdAt,
          updatedAt
        },
        ...workspace.characterRelationships
      ]
    }))
    schedulePersist('fast')
  }

  function updateCharacterRelationship(relationshipId: string, payload: Partial<CharacterRelationship>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characterRelationships: workspace.characterRelationships.map((relationship) =>
        relationship.id === relationshipId
          ? {
              ...relationship,
              fromCharacterId: payload.fromCharacterId || relationship.fromCharacterId,
              toCharacterId: payload.toCharacterId || relationship.toCharacterId,
              type: payload.type?.trim() || relationship.type,
              description: payload.description?.trim() || relationship.description,
              intensity:
                payload.intensity !== undefined && Number.isFinite(payload.intensity)
                  ? Math.min(100, Math.max(0, payload.intensity))
                  : relationship.intensity,
              updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString())
            }
          : relationship
      )
    }))
    schedulePersist('fast')
  }

  function deleteCharacterRelationship(relationshipId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characterRelationships: workspace.characterRelationships.filter(
        (relationship) => relationship.id !== relationshipId
      )
    }))
    schedulePersist('fast')
  }

  // ── 组织成员归属 CRUD ──
  /** 创建组织成员归属关系 */
  function createOrganizationMembership(payload?: Partial<OrganizationMembership>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizationMemberships: [
        {
          id: uniqueId('membership'),
          characterId: payload?.characterId || workspace.characters[0]?.id || '',
          organizationId: payload?.organizationId || workspace.organizations[0]?.id || '',
          role: payload?.role?.trim() || '普通成员',
          notes: payload?.notes?.trim() || '待补充归属说明',
          createdAt,
          updatedAt
        },
        ...workspace.organizationMemberships
      ]
    }))
    schedulePersist('fast')
  }

  function updateOrganizationMembership(membershipId: string, payload: Partial<OrganizationMembership>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizationMemberships: workspace.organizationMemberships.map((membership) =>
        membership.id === membershipId
          ? {
              ...membership,
              characterId: payload.characterId || membership.characterId,
              organizationId: payload.organizationId || membership.organizationId,
              role: payload.role?.trim() || membership.role,
              notes: payload.notes?.trim() || membership.notes,
              updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString())
            }
          : membership
      )
    }))
    schedulePersist('fast')
  }

  function deleteOrganizationMembership(membershipId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      organizationMemberships: workspace.organizationMemberships.filter(
        (membership) => membership.id !== membershipId
      )
    }))
    schedulePersist('fast')
  }

  // ── 灵感卡片 CRUD ──
  /** 创建灵感卡片，限制标签最多 8 个 */
  function createInspirationEntry(payload?: Partial<InspirationEntry>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)
    const normalizedTags = Array.isArray(payload?.tags)
      ? payload.tags
          .map((tag) => String(tag).trim())
          .filter(Boolean)
          .slice(0, 8)
      : []

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationEntries: reindexInspirationEntries([
        {
        id: uniqueId('inspiration'),
          type: payload?.type?.trim() || '场景火花',
          title: payload?.title?.trim() || `灵感卡片 ${workspace.inspirationEntries.length + 1}`,
          content:
            payload?.content?.trim() ||
            '这里记录一个可以继续扩写的灵感片段，你可以补充场景、冲突、情绪或关键台词。',
          tags: normalizedTags,
          source: payload?.source === 'ai' ? 'ai' : 'manual',
          sortOrder: payload?.sortOrder ?? 0,
          createdAt,
          updatedAt
        },
        ...workspace.inspirationEntries
      ])
    }))
    schedulePersist('fast')
  }

  function updateInspirationEntry(entryId: string, payload: Partial<InspirationEntry>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationEntries: reindexInspirationEntries(
        workspace.inspirationEntries.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                type: payload.type?.trim() || entry.type,
                title: payload.title?.trim() || entry.title,
                content: payload.content?.trim() || entry.content,
                tags:
                  Array.isArray(payload.tags) && payload.tags.length
                    ? payload.tags
                        .map((tag) => String(tag).trim())
                        .filter(Boolean)
                        .slice(0, 8)
                    : entry.tags,
                source: payload.source ?? entry.source,
                updatedAt: toIsoTimestamp(payload.updatedAt || new Date().toISOString())
              }
            : entry
        )
      )
    }))
    schedulePersist('fast')
  }

  function deleteInspirationEntry(entryId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      inspirationEntries: reindexInspirationEntries(
        workspace.inspirationEntries.filter((entry) => entry.id !== entryId)
      )
    }))
    schedulePersist('fast')
  }

  // ── 剧情线索 CRUD ──
  function createPlotThread(payload?: Partial<PlotThread>): void {
    const now = new Date().toISOString()
    const nextThread: PlotThread = {
      id: uniqueId('thread'),
      title: payload?.title?.trim() || '未命名线索',
      description: payload?.description?.trim() || '',
      openedInChapterId: payload?.openedInChapterId || '',
      status: 'open',
      closedInChapterId: undefined,
      tags: Array.isArray(payload?.tags) ? payload.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      createdAt: now,
      updatedAt: now
    }
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: [...workspace.plotThreads, nextThread]
    }))
    schedulePersist('fast')
  }

  function updatePlotThread(threadId: string, payload: Partial<PlotThread>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: workspace.plotThreads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              ...payload,
              title: payload.title?.trim() || thread.title,
              description: payload.description?.trim() ?? thread.description,
              tags: Array.isArray(payload.tags)
                ? payload.tags.map((t) => String(t).trim()).filter(Boolean)
                : thread.tags,
              updatedAt: new Date().toISOString()
            }
          : thread
      )
    }))
    schedulePersist('fast')
  }

  function deletePlotThread(threadId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      plotThreads: workspace.plotThreads.filter((thread) => thread.id !== threadId)
    }))
    schedulePersist('fast')
  }

  // ── 大纲分卷 CRUD ──
  /** 创建新的大纲分卷，返回新分卷 ID */
  function createOutlineVolume(payload?: Partial<OutlineVolume>): string {
    const nextVolume = createWorkspaceVolume({
      id: uniqueId('volume'),
      title: payload?.title?.trim() || `分卷 ${outlineVolumes.value.length + 1}`,
      wordTarget: payload?.wordTarget?.trim(),
      summary: payload?.summary?.trim()
    })

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: [...workspace.outlineVolumes, nextVolume]
    }))
    schedulePersist('fast')
    return nextVolume.id
  }

  function updateOutlineVolume(volumeId: string, payload: Partial<OutlineVolume>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineVolumes: workspace.outlineVolumes.map((volume) =>
        volume.id === volumeId
          ? {
              ...volume,
              title: payload.title?.trim() || volume.title,
              wordTarget: payload.wordTarget?.trim() || volume.wordTarget,
              summary: payload.summary?.trim() || volume.summary
            }
          : volume
      )
    }))
    schedulePersist('fast')
  }

  // ── 面板与章节导航 ──
  /** 切换工作台面板，chapters 面板会自动进入章节写作模式 */
  function setPanel(panel: PanelName): void {
    if (panel === 'chapters') {
      openChapterStudio()
      return
    }

    lastWorkbenchPanel.value = panel
    activePanel.value = panel
    currentView.value = 'workbench'
  }

  /** 选中章节并进入章节写作模式 */
  function selectChapter(chapterId: string): void {
    selectedChapterId.value = chapterId
    pendingChapterInsertion.value = null
    currentChapterSelection.value = null
    activePanel.value = 'chapters'
    currentView.value = 'chapter-studio'
  }

  // ── 章节 CRUD ──
  /** 创建新章节，插入到当前分卷末尾 */
  function createChapter(volumeId = selectedChapter.value?.volumeId): void {
    let nextChapterId = ''
    updateCurrentWorkspace((workspace) => {
      const targetVolumeId = volumeId || getWorkspacePrimaryVolumeId(workspace)
      const nextIndex = getChapterSequenceInVolume(workspace.chapters, targetVolumeId)
      const nextChapter: ChapterDraft = {
        id: uniqueId('chapter'),
        outlineItemId: '',
        volumeId: targetVolumeId,
        title: `第${nextIndex}章：新章节`,
        summary: '待补充章节摘要',
        status: 'draft',
        wordTarget: DEFAULT_CHAPTER_WORD_TARGET,
        content: ''
      }
      nextChapterId = nextChapter.id

      return {
        ...workspace,
        chapters: insertIntoVolumeSection(workspace.chapters, nextChapter)
      }
    })

    selectedChapterId.value = nextChapterId || selectedChapterId.value
    pendingChapterInsertion.value = null
    currentChapterSelection.value = null
    activePanel.value = 'chapters'
    schedulePersist('fast')
  }

  /** 从大纲节点创建章节，继承标题、摘要和字数目标 */
  function createChapterFromOutlineItem(item: Pick<OutlineItem, 'id' | 'volumeId' | 'title' | 'summary' | 'wordTarget'>): void {
    let nextChapterId = ''
    updateCurrentWorkspace((workspace) => {
      const targetVolumeId = item.volumeId || getWorkspacePrimaryVolumeId(workspace)
      const nextChapter: ChapterDraft = {
        id: uniqueId('chapter'),
        outlineItemId: item.id,
        volumeId: targetVolumeId,
        title: item.title?.trim() || '新章节',
        summary: item.summary?.trim() || '待补充章节摘要',
        status: 'draft',
        wordTarget: normalizeChapterWordTarget(item.wordTarget),
        content: ''
      }
      nextChapterId = nextChapter.id

      return {
        ...workspace,
        chapters: insertIntoVolumeSection(workspace.chapters, nextChapter)
      }
    })

    selectedChapterId.value = nextChapterId || selectedChapterId.value
    pendingChapterInsertion.value = null
    currentChapterSelection.value = null
    activePanel.value = 'chapters'
    currentView.value = 'chapter-studio'
    schedulePersist('fast')
  }

  /** 拖拽移动章节位置 */
  function moveChapter(chapterId: string, targetChapterId: string): void {
    updateCurrentWorkspace((workspace) => {
      const sourceIndex = workspace.chapters.findIndex((chapter) => chapter.id === chapterId)
      const targetIndex = workspace.chapters.findIndex((chapter) => chapter.id === targetChapterId)

      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return workspace
      }

      const nextChapters = [...workspace.chapters]
      const [movedChapter] = nextChapters.splice(sourceIndex, 1)
      nextChapters.splice(targetIndex, 0, movedChapter)
      return {
        ...workspace,
        chapters: nextChapters
      }
    })
    schedulePersist('fast')
  }

  // ── 大纲节点 CRUD ──
  /** 创建大纲节点，插入到当前分卷末尾 */
  function createOutlineItem(payload?: Partial<OutlineItem>): void {
    updateCurrentWorkspace((workspace) => {
      const targetVolumeId = payload?.volumeId || selectedChapter.value?.volumeId || getWorkspacePrimaryVolumeId(workspace)
      const nextIndex = getOutlineSequenceInVolume(workspace.outlineItems, targetVolumeId)
      const nextItem: OutlineItem = {
        id: uniqueId('outline'),
        volumeId: targetVolumeId,
        title: payload?.title?.trim() || `第${nextIndex}章：新剧情节点`,
        wordTarget: payload?.wordTarget?.trim() || '预估 3000字',
        conflict: payload?.conflict?.trim() || '新的冲突正在酝酿。',
        summary:
          payload?.summary?.trim() ||
          '这里是新的剧情大纲节点草稿，可以继续补充剧情推进、角色目标和关键转折。',
        status: payload?.status || 'planned',
        sortOrder: payload?.sortOrder ?? workspace.outlineItems.length
      }

      return {
        ...workspace,
        outlineItems: reindexOutlineItems(insertIntoVolumeSection(workspace.outlineItems, nextItem))
      }
    })
    schedulePersist('fast')
  }

  function createOutlineItemsAfter(anchorOutlineId: string, payloads: Array<Partial<OutlineItem>>): void {
    if (!payloads.length) {
      return
    }

    updateCurrentWorkspace((workspace) => {
      const anchorIndex = workspace.outlineItems.findIndex((item) => item.id === anchorOutlineId)
      if (anchorIndex === -1) {
        return workspace
      }

      const anchorItem = workspace.outlineItems[anchorIndex]
      const insertedItems = payloads.map((payload, index) => ({
        id: uniqueId('outline'),
        volumeId: payload.volumeId || anchorItem.volumeId,
        title: payload.title?.trim() || `第${anchorIndex + index + 2}章：新剧情节点`,
        wordTarget: payload.wordTarget?.trim() || '预估 3000字',
        conflict: payload.conflict?.trim() || '新的冲突正在酝酿。',
        summary:
          payload.summary?.trim() ||
          '这里是新的剧情大纲节点草稿，可以继续补充剧情推进、角色目标和关键转折。',
        status: payload.status || 'planned',
        sortOrder: anchorIndex + index + 1
      }))

      const nextItems = [...workspace.outlineItems]
      nextItems.splice(anchorIndex + 1, 0, ...insertedItems)

      return {
        ...workspace,
        outlineItems: reindexOutlineItems(nextItems)
      }
    })
    schedulePersist('fast')
  }

  function updateOutlineItem(outlineId: string, payload: Partial<OutlineItem>): void {
    updateCurrentWorkspace((workspace) => {
      const currentItem = workspace.outlineItems.find((item) => item.id === outlineId)
      if (!currentItem) {
        return workspace
      }

      const nextItem: OutlineItem = {
        ...currentItem,
        volumeId: payload.volumeId || currentItem.volumeId,
        title: payload.title?.trim() || currentItem.title,
        wordTarget: payload.wordTarget?.trim() || currentItem.wordTarget,
        conflict: payload.conflict?.trim() || currentItem.conflict,
        summary: payload.summary?.trim() || currentItem.summary,
        status: payload.status || currentItem.status
      }

      const remainingItems = workspace.outlineItems.filter((item) => item.id !== outlineId)
      const nextOutlineItems =
        nextItem.volumeId === currentItem.volumeId
          ? workspace.outlineItems.map((item) => (item.id === outlineId ? nextItem : item))
          : insertIntoVolumeSection(remainingItems, nextItem)

      return {
        ...workspace,
        outlineItems: reindexOutlineItems(nextOutlineItems)
      }
    })
    schedulePersist('fast')
  }

  function deleteOutlineItem(outlineId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      outlineItems: reindexOutlineItems(workspace.outlineItems.filter((item) => item.id !== outlineId))
    }))
    schedulePersist('fast')
  }

  /** 拖拽移动大纲节点位置，跨分卷时自动更新 volumeId */
  function moveOutlineItem(outlineId: string, targetOutlineId: string): void {
    updateCurrentWorkspace((workspace) => {
      const sourceIndex = workspace.outlineItems.findIndex((item) => item.id === outlineId)
      const targetIndex = workspace.outlineItems.findIndex((item) => item.id === targetOutlineId)

      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return workspace
      }

      const nextOutlineItems = [...workspace.outlineItems]
      const [movedItem] = nextOutlineItems.splice(sourceIndex, 1)
      const targetItem = workspace.outlineItems[targetIndex]
      nextOutlineItems.splice(targetIndex, 0, {
        ...movedItem,
        volumeId: targetItem?.volumeId || movedItem.volumeId
      })

      return {
        ...workspace,
        outlineItems: reindexOutlineItems(nextOutlineItems)
      }
    })
    schedulePersist('fast')
  }

  /** 删除章节（至少保留一章），自动切换到相邻章节 */
  function deleteChapter(chapterId: string): void {
    if (chapters.value.length <= 1) {
      return
    }

    const targetIndex = chapters.value.findIndex((chapter) => chapter.id === chapterId)
    if (targetIndex === -1) {
      return
    }

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      chapters: workspace.chapters.filter((chapter) => chapter.id !== chapterId),
      chapterVersions: workspace.chapterVersions.filter((version) => version.chapterId !== chapterId)
    }))

    if (selectedChapterId.value === chapterId) {
      const fallback = chapters.value[Math.max(0, targetIndex - 1)] ?? chapters.value[0]
      selectedChapterId.value = fallback?.id ?? ''
      pendingChapterInsertion.value = null
    }
    schedulePersist('fast')
  }

  function updateChapterTitle(value: string): void {
    const chapter = selectedChapter.value
    if (!chapter) {
      return
    }

    updateChapter(chapter.id, { title: value })
    schedulePersist('autosave')
  }

  function updateChapterContent(value: string): void {
    const chapter = selectedChapter.value
    if (!chapter) {
      return
    }

    updateChapter(chapter.id, { content: value })
    schedulePersist('autosave')
  }

  function updateChapterSummary(value: string): void {
    const chapter = selectedChapter.value
    if (!chapter) {
      return
    }

    updateChapter(chapter.id, { summary: value })
    schedulePersist('autosave')
  }

  function updateChapter(chapterId: string, payload: Partial<ChapterDraft>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      chapters: workspace.chapters.map((chapter) =>
        chapter.id === chapterId
          ? normalizeChapterDraft({
              ...chapter,
              outlineItemId: payload.outlineItemId !== undefined ? payload.outlineItemId : chapter.outlineItemId,
              volumeId: payload.volumeId || chapter.volumeId,
              title: payload.title?.trim() || chapter.title,
              summary: payload.summary !== undefined ? payload.summary.trim() || chapter.summary : chapter.summary,
              status: payload.status ?? chapter.status,
              wordTarget:
                payload.wordTarget !== undefined ? normalizeChapterWordTarget(payload.wordTarget) : chapter.wordTarget,
              content: payload.content !== undefined ? payload.content : chapter.content
            })
          : chapter
      )
    }))
  }

  // ── 章节版本管理 ──
  /** 获取指定章节的历史版本列表，按创建时间降序排列 */
  function getChapterVersions(chapterId: string): ChapterVersion[] {
    return chapterVersions.value
      .filter((version) => version.chapterId === chapterId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /** 保存当前章节的快照版本，立即持久化 */
  async function saveCurrentChapterVersion(): Promise<{ success: boolean; version?: ChapterVersion; error?: string }> {
    const chapter = selectedChapter.value
    if (!chapter) {
      return {
        success: false,
        error: '当前没有可保存的章节。'
      }
    }

    const version = normalizeChapterVersion({
      id: uniqueId('chapter-version'),
      chapterId: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      status: chapter.status,
      wordTarget: chapter.wordTarget,
      content: chapter.content,
      createdAt: new Date().toISOString()
    })

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      chapterVersions: [version, ...workspace.chapterVersions]
    }))

    if (hasHydrated.value) {
      await persistWorkspace()
      if (persistenceError.value) {
        return {
          success: false,
          error: persistenceError.value
        }
      }
    }

    return {
      success: true,
      version
    }
  }

  /** 恢复到指定的历史版本，覆盖当前章节内容 */
  async function restoreChapterVersion(versionId: string): Promise<{ success: boolean; error?: string }> {
    const version = chapterVersions.value.find((item) => item.id === versionId)
    if (!version) {
      return {
        success: false,
        error: '未找到对应的历史版本。'
      }
    }

    updateChapter(version.chapterId, {
      title: version.title,
      summary: version.summary,
      status: version.status,
      wordTarget: version.wordTarget,
      content: version.content
    })

    selectedChapterId.value = version.chapterId
    activePanel.value = 'chapters'
    pendingChapterInsertion.value = null

    if (hasHydrated.value) {
      await persistWorkspace()
      if (persistenceError.value) {
        return {
          success: false,
          error: persistenceError.value
        }
      }
    }

    return {
      success: true
    }
  }

  // ── AI 助手交互 ──
  /** 切换 AI 助手窗口的显示/隐藏 */
  function toggleAi(): void {
    if (isAssistantWindow) {
      void closeAssistantWindow()
      return
    }

    if (aiVisible.value) {
      void closeAssistantWindow()
      return
    }

    void openAssistantWindow()
  }

  /** 打开 AI 助手面板，若已打开则刷新上下文 */
  function openAiAssistant(): void {
    if (isAssistantWindow) {
      aiVisible.value = true
      return
    }

    if (aiVisible.value) {
      publishAssistantContext()
      scheduleWorkspaceSync()
      return
    }

    void openAssistantWindow()
  }

  /** 向助手窗口发送提示词请求，若助手窗口未打开则先打开 */
  function queueAssistantPrompt(prompt: string, quickAction?: string): void {
    const request = {
      id: uniqueId('assistant'),
      prompt,
      quickAction
    }

    if (isAssistantWindow) {
      pendingAssistantRequest.value = request
      return
    }

    aiVisible.value = true
    void openAssistantWindow()
    void window.characterArc.publishAssistantPrompt(toIpcPayload(request))
  }

  /** 标记提示词请求已消费，清空待处理状态 */
  function consumeAssistantPrompt(requestId: string): void {
    if (pendingAssistantRequest.value?.id === requestId) {
      pendingAssistantRequest.value = null
    }

    if (isAssistantWindow) {
      void window.characterArc.clearAssistantPrompt(requestId)
    }
  }

  /** 更新单个应用设置项并触发快速持久化 */
  function updateAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    appSettings.value[key] = value
    schedulePersist('fast')
  }

  // ── AI 聊天消息 ──
  /** 添加用户消息到聊天记录 */
  function pushUserMessage(content: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      messages: [
        ...workspace.messages,
        {
          id: uniqueId('msg'),
          role: 'user',
          content
        }
      ]
    }))
    schedulePersist('fast')
  }

  function pushAssistantMessage(content: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      messages: [
        ...workspace.messages,
        {
          id: uniqueId('msg'),
          role: 'assistant',
          content
        }
      ]
    }))
    schedulePersist('fast')
  }

  // ── 章节正文插入 ──
  /** 将 AI 生成的内容插入到当前章节正文，返回是否成功 */
  function insertIntoChapter(content: string, mode: ChapterInsertionMode = 'cursor'): boolean {
    const chapter = selectedChapter.value
    if (!chapter) {
      return false
    }

    const insertion = content.trim()
    if (!insertion) {
      return false
    }

    pendingChapterInsertion.value = {
      id: uniqueId('insert'),
      chapterId: chapter.id,
      content: insertion,
      mode
    }
    return true
  }

  /** 标记章节插入请求已执行完毕 */
  function consumeChapterInsertion(requestId: string): void {
    if (pendingChapterInsertion.value?.id === requestId) {
      pendingChapterInsertion.value = null
    }
  }

  /** 更新编辑器中用户选中的文本状态 */
  function updateChapterSelection(selection: ChapterSelectionState | null): void {
    if (!selection || selection.chapterId !== selectedChapter.value?.id || !selection.text.trim()) {
      currentChapterSelection.value = null
      return
    }

    currentChapterSelection.value = {
      chapterId: selection.chapterId,
      text: selection.text.trim()
    }
  }

  // ── 跨窗口事件监听注册 ──
  // 监听工作区同步事件（来自其他窗口的状态更新）
  window.characterArc.onWorkspaceSync(handleRemoteWorkspaceSync)
  window.characterArc.onAiRunEvent(handleAiRunEvent)
  window.characterArc.onAssistantWindowVisibility((payload) => {
    aiVisible.value = payload.visible
  })

  if (isAssistantWindow) {
    window.characterArc.onAssistantContext((payload) => {
      applyAssistantContext(payload)
    })
    window.characterArc.onAssistantPrompt((payload) => {
      receiveAssistantPrompt(payload)
    })
  } else {
    window.characterArc.onAssistantCommand((payload) => {
      handleAssistantCommand(payload)
    })
  }

  // ── 响应式监听器 ──
  // 切换章节时清空选中文本
  watch(
    () => selectedChapterId.value,
    () => {
      currentChapterSelection.value = null
    }
  )

  // 自动保存间隔变更时，若有待保存内容则重新调度
  watch(
    () => appSettings.value.autoSaveInterval,
    () => {
      if (isPersistencePending.value) {
        schedulePersist('fast')
      }
    }
  )

  // 项目/章节/选中文本变化时，向助手窗口推送最新上下文
  watch(
    [() => selectedProjectId.value, () => selectedChapterId.value, () => currentChapterSelection.value],
    () => {
      publishAssistantContext()
    },
    { deep: true }
  )

  // 视图切换时的助手窗口联动：进入章节写作时同步上下文，离开时关闭助手窗口
  watch(
    () => currentView.value,
    (view) => {
      if (characterArcWindowKind !== 'main') {
        return
      }

      if (view === 'chapter-studio') {
        publishAssistantContext()
        return
      }

      if (aiVisible.value) {
        void closeAssistantWindow()
      }
    },
    { immediate: true }
  )

  return {
    activePanel,
    autoSaveIntervalLabel,
    aiRuns,
    aiVisible,
    appSettings,
    backToProjects,
    backToWorkbench,
    chapterVersions,
    chapters,
    characterRelationships,
    characters,
    inspirationEntries,
    closeWizard,
    createProject,
    createProjectWorkspace,
    createCharacter,
    createCharacterRelationship,
    createInspirationEntry,
    createOrganization,
    createOrganizationMembership,
    createOutlineItem,
    createOutlineItemsAfter,
    createOutlineVolume,
    createPlotThread,
    createWorldviewEntry,
    createChapter,
    createChapterFromOutlineItem,
    chapterVolumeGroups,
    currentTheme,
    currentProject,
    currentChapterSelection,
    currentView,
    hasHydrated,
    initialize,
    isLiveAutoSave,
    isPersistencePending,
    deleteChapter,
    deleteCharacter,
    deleteCharacterRelationship,
    deleteInspirationEntry,
    deleteOrganization,
    deleteOrganizationMembership,
    deleteOutlineItem,
    deletePlotThread,
    deleteProject,
    deleteWorldviewEntry,
    insertIntoChapter,
    importProjectData,
    importModuleData,
    consumeAssistantPrompt,
    getChapterVersions,
    messages,
    moveChapter,
    moveOutlineItem,
    openAiAssistant,
    openChapterStudio,
    openProject,
    openWizard,
    outlineItems,
    organizationMemberships,
    organizations,
    outlineVolumeGroups,
    outlineVolumes,
    pendingAssistantRequest,
    pendingChapterInsertion,
    plotThreads,
    projects,
    pushAssistantMessage,
    pushUserMessage,
    queueAssistantPrompt,
    restoreChapterVersion,
    saveCurrentChapterVersion,
    selectChapter,
    selectedChapter,
    selectedChapterId,
    selectedChapterVolume,
    selectedProjectId,
    setPanel,
    setTheme,
    theme,
    toggleAi,
    consumeChapterInsertion,
    updateAppSetting,
    updateProject,
    activeWorkflowVolumeId,
    activeWorkflowVolume,
    setActiveWorkflowVolumeId,
    mergeKnowledgeDocuments,
    knowledgeDocuments,
    updateWorkflowDocument,
    updateWorkflowDocuments,
    appendWorkflowDocumentEntry,
    workflowDocuments,
    persistWorkspace,
    updateChapter,
    updateChapterContent,
    updateChapterSelection,
    updateChapterSummary,
    updateChapterTitle,
    updateCharacter,
    updateCharacterRelationship,
    updateInspirationEntry,
    updateOrganization,
    updateOrganizationMembership,
    updateOutlineItem,
    updateOutlineVolume,
    updatePlotThread,
    updateWorldviewEntry,
    worldviewEntries,
    persistenceError
  }
})
