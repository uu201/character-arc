import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { FAST_PERSIST_DELAY_MS, formatAutoSaveIntervalLabel, isLiveAutoSaveInterval, resolveAutoSaveDelayMs } from '@/features/settings/autoSave'
import { createDefaultWorkflowDocuments } from '@/features/novelWorkflow/documents'
import { createDefaultNovelWorkflowStages } from '@/features/novelWorkflow/stages'
import { DEFAULT_CHAPTER_WORD_TARGET, normalizeChapterWordTarget } from '@/features/chapters/wordTarget'
import { formatProjectWordCount } from '@/features/projects/wordCount'
import { createProjectEditedAt } from '@/features/projects/lastEdited'
import {
  buildVolumeGroups,
  createOutlineVolume as createWorkspaceVolume
} from '@/features/workspace/outlineVolumes'
import { getThemePreset } from '@/theme/presets'
import { createEmptyWorkspace, normalizeGlobalAssistantProposal, mergeGlobalAssistantProposals } from '@/features/workspace/projectWorkspace'
import { createWorkspacePersistence } from '@/features/workspace/persistence'
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
import { AI_TASK_RETENTION_MS, type AiTaskRun, type AiTaskRunInput } from '@/features/ai/taskRegistry'
import type {
  AssistantEditEvent,
  AssistantToolCall,
  AssistantTurn,
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
  GlobalAssistantProposal,
  GlobalAssistantSession,
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
  ReferenceWorkItem,
  ThemeName,
  WorldviewEntry
} from '@/types/app'

type AssistantFocusPanel = 'world' | 'characters' | 'outline' | 'project-knowledge'

interface AssistantFocusTarget {
  panel: AssistantFocusPanel
  entityId: string
  nonce: number
}

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
    selectedReferenceWorkIds?: ProjectSummary['selectedReferenceWorkIds']
    coverHistory?: ProjectSummary['coverHistory']
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

function normalizeKnowledgeKeywords(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    : []
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
  /** 当前视图：项目列表 / 新建向导 / 工作台 / 章节写作 / 独立能力页 */
  const currentView = ref<'projects' | 'wizard' | 'workbench' | 'chapter-studio' | 'deconstruction-library' | 'skills' | 'cover-workbench'>('projects')
  /** 工作台中当前激活的面板 */
  const activePanel = ref<PanelName>('outline')
  /** 上一次在工作台中查看的面板（非 chapters），用于从章节写作返回时恢复 */
  const lastWorkbenchPanel = ref<Exclude<PanelName, 'chapters'>>('outline')
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
  const coverWorkbenchHistory = ref<import('@/types/app').CoverWorkbenchHistoryItem[]>(stored.coverWorkbenchHistory ?? [])
  /** 待执行的章节正文插入请求 */
  const pendingChapterInsertion = ref<ChapterInsertionRequest | null>(null)
  /** 用户在编辑器中当前选中的文本状态 */
  const currentChapterSelection = ref<ChapterSelectionState | null>(null)
  /** 章节轻检告警：key 为 chapterId，value 为告警 payload。由章节生成后的异步后处理流水线推送。 */
  const chapterStateWarnings = ref<Map<string, CharacterArcChapterStateWarningsPayload>>(new Map())
  /** 章节生成后处理问题：key 为 chapterId，value 为问题 payload。issues 为空时会自动清理旧提示。 */
  const chapterPostGenerationIssues = ref<Map<string, CharacterArcChapterPostGenerationIssuesPayload>>(new Map())
  /** 当前选中的章节 ID */
  const selectedChapterId = ref(stored.workspaces[stored.selectedProjectId]?.chapters[0]?.id ?? '')
  /** 流程面板当前激活的分卷 ID，空字符串时回退到第一个分卷 */
  const activeWorkflowVolumeId = ref<string>('')
  /** 全局助手最近一次写回后的聚焦目标，仅用于当前界面反馈 */
  const assistantFocusTarget = ref<AssistantFocusTarget | null>(null)

  const {
    scheduledPersistAt,
    persistenceError,
    scheduleWorkspaceSync,
    flushWorkspaceSync,
    persistWorkspace,
    schedulePersist,
    scheduleSettingsPersist,
    handleRemoteWorkspaceSync
  } = createWorkspacePersistence({
    hasHydrated,
    serializeWorkspaceState: () => serializeWorkspaceState(),
    getSettingsSnapshot: () => ({
      theme: theme.value,
      selectedProjectId: selectedProjectId.value,
      appSettings: appSettings.value
    }),
    applyRemoteState: (payload) => applyWorkspaceState(payload)
  })

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
  const globalAssistantSessions = computed(() => currentWorkspace.value.globalAssistantSessions)
  const activeGlobalAssistantSessionId = computed(() => currentWorkspace.value.activeGlobalAssistantSessionId)
  const activeGlobalAssistantSession = computed(
    () => globalAssistantSessions.value.find((session) => session.id === activeGlobalAssistantSessionId.value)
      ?? globalAssistantSessions.value[0]
  )
  const messages = computed(() => activeGlobalAssistantSession.value?.messages ?? currentWorkspace.value.messages)
  /** 当前项目的剧情线索列表 */
  const plotThreads = computed(() => currentWorkspace.value.plotThreads)
  /** 全局拆书库知识文档（跨项目共享） */
  const knowledgeDocuments = ref<KnowledgeDocument[]>(stored.knowledgeDocuments ?? [])
  const projectConstraints = computed(() =>
    knowledgeDocuments.value
      .filter((document) => document.sourceType === 'canon-fact' && document.sourceLabel === 'global-constraint')
      .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''))
  )
  /** 全局拆书库参考作品（跨项目共享） */
  const referenceWorks = ref<ReferenceWorkItem[]>(stored.referenceWorks ?? [])
  /** 当前项目的 AI 运行记录列表 */
  const aiRuns = computed(() => currentWorkspace.value.aiRuns)
  /**
   * 全局 AI 任务注册表（按 key 去重，响应式）。
   *
   * 用途：
   *   1. 跨面板保持按钮 loading 状态——切面板不会把 "生成中..." 切没。
   *   2. 给全局进度面板提供数据源，让用户知道 AI 正在跑什么、跑了多久。
   *   3. 天然防重复点击：同 key 任务已在运行时再次点击会被拒绝。
   */
  const aiTaskRuns = ref<Map<string, AiTaskRun>>(new Map())
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

  function resolveWorkflowVolumeId(preferredVolumeId?: string): string {
    const resolved = String(preferredVolumeId ?? '').trim()
    if (resolved) {
      return resolved
    }

    return activeWorkflowVolume.value?.id
      || selectedChapterVolume.value?.id
      || outlineVolumes.value[0]?.id
      || ''
  }

  // ── AI 事件处理 ──

  function handleAiRunEvent(payload: CharacterArcAiRunEventPayload): void {
    if (!payload?.meta) {
      return
    }

    // 项目级 AI 历史只在 projectId 存在时落地；全局任务（如风格指纹提取）跳过这一步，
    // 但下面的 producedKnowledgeDocuments 仍要合并到全局拆书库。
    if (payload.projectId) {
      appendAiRun(payload.projectId, payload.meta)
    }

    // agent loop 通过 knowledge_save_document 工具落库的文档：随 ai-run-event 一起回灌
    const produced = (payload.meta as { producedKnowledgeDocuments?: Array<Partial<KnowledgeDocument>> }).producedKnowledgeDocuments
    if (Array.isArray(produced) && produced.length > 0) {
      const now = new Date().toISOString()
      const documents = produced
        .filter((draft): draft is Partial<KnowledgeDocument> & { title: string; sourceType: KnowledgeDocument['sourceType']; content: string } =>
          Boolean(draft && typeof draft.title === 'string' && draft.title.trim() && typeof draft.content === 'string' && draft.content.trim() && typeof draft.sourceType === 'string')
        )
        .map<KnowledgeDocument>((draft) => ({
          id: String(draft.id ?? '').trim() || uniqueId('knowledge'),
          title: String(draft.title).trim(),
          sourceType: draft.sourceType,
          sourceLabel: String(draft.sourceLabel ?? '').trim(),
          content: String(draft.content),
          summary: String(draft.summary ?? '').trim() || String(draft.content).slice(0, 220),
          keywords: normalizeKnowledgeKeywords(draft.keywords),
          metadata: draft.metadata && typeof draft.metadata === 'object' ? draft.metadata as Record<string, unknown> : {},
          createdAt: String(draft.createdAt ?? '').trim() || now,
          updatedAt: String(draft.updatedAt ?? '').trim() || now
        }))
      if (documents.length > 0) {
        mergeKnowledgeDocuments(documents)
      }
    }

    // global-assistant agent loop 通过 propose_* 工具产生的结构化写回提案：合并进当前会话的 proposal，
    // 复用既有的 Diff 审阅弹窗与写回逻辑，用户确认后才真正写入图鉴/设定。
    const settingMeta = payload.meta as {
      task?: string
      producedSettingProposal?: Partial<GlobalAssistantProposal> | null
    }
    if (settingMeta.task === 'global-assistant' && settingMeta.producedSettingProposal) {
      const incoming = normalizeGlobalAssistantProposal(settingMeta.producedSettingProposal as GlobalAssistantProposal)
      const merged = mergeGlobalAssistantProposals(activeGlobalAssistantSession.value?.proposal ?? null, incoming)
      if (merged) {
        updateAssistantSessionProposal({ proposal: merged })
      }
    }
  }

  function handleChapterStateWarnings(payload: CharacterArcChapterStateWarningsPayload): void {
    if (!payload?.chapterId || !Array.isArray(payload.violations) || !payload.violations.length) {
      return
    }
    const next = new Map(chapterStateWarnings.value)
    next.set(payload.chapterId, payload)
    chapterStateWarnings.value = next
  }

  function getChapterStateWarnings(chapterId: string): CharacterArcChapterStateWarningsPayload | null {
    if (!chapterId) return null
    return chapterStateWarnings.value.get(chapterId) ?? null
  }

  function dismissChapterStateWarnings(chapterId: string): void {
    if (!chapterId || !chapterStateWarnings.value.has(chapterId)) return
    const next = new Map(chapterStateWarnings.value)
    next.delete(chapterId)
    chapterStateWarnings.value = next
  }

  function handleChapterPostGenerationIssues(payload: CharacterArcChapterPostGenerationIssuesPayload): void {
    if (!payload?.chapterId || !Array.isArray(payload.issues)) {
      return
    }
    const next = new Map(chapterPostGenerationIssues.value)
    if (payload.issues.length === 0) {
      next.delete(payload.chapterId)
    } else {
      next.set(payload.chapterId, payload)
    }
    chapterPostGenerationIssues.value = next
  }

  function getChapterPostGenerationIssues(chapterId: string): CharacterArcChapterPostGenerationIssuesPayload | null {
    if (!chapterId) return null
    return chapterPostGenerationIssues.value.get(chapterId) ?? null
  }

  function dismissChapterPostGenerationIssues(chapterId: string): void {
    if (!chapterId || !chapterPostGenerationIssues.value.has(chapterId)) return
    const next = new Map(chapterPostGenerationIssues.value)
    next.delete(chapterId)
    chapterPostGenerationIssues.value = next
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

  function updateCurrentWorkspaceAssistantSession(
    updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData
  ): void {
    const projectId = selectedProjectId.value
    ensureProjectWorkspace(projectId)
    const baseWorkspace = projectWorkspaces.value[projectId] ?? normalizeProjectWorkspaceData(undefined)
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: updater(baseWorkspace)
    }
  }

  /** 用 updater 函数更新当前项目的工作区数据，并同步章节选择和工作区同步 */
  function updateCurrentWorkspace(
    updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData,
    options: { syncWorkspace?: boolean } = {}
  ): void {
    ensureProjectWorkspace(selectedProjectId.value)
    updateProjectWorkspace(selectedProjectId.value, updater)
    syncProjectWordCount(selectedProjectId.value)
    syncSelectedChapter()
    if (options.syncWorkspace !== false) {
      scheduleWorkspaceSync()
    }
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
    projects.value = Array.isArray(payload.projects)
      ? payload.projects.map(normalizeProjectSummary)
      : defaultProjects

    const fallbackProjectId = projects.value[0]?.id ?? ''
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
    coverWorkbenchHistory.value = Array.isArray(payload.coverWorkbenchHistory) ? payload.coverWorkbenchHistory : []
    knowledgeDocuments.value = Array.isArray((payload as Partial<StoredState>).knowledgeDocuments)
      ? (payload as Partial<StoredState>).knowledgeDocuments!
      : []
    referenceWorks.value = Array.isArray((payload as Partial<StoredState>).referenceWorks)
      ? (payload as Partial<StoredState>).referenceWorks!
      : []
    syncSelectedChapter()
  }

  /** 将当前全局状态序列化为可持久化的 StoredState 对象 */
  function serializeWorkspaceState(): StoredState {
    return {
      theme: theme.value,
      selectedProjectId: selectedProjectId.value,
      projects: toSerializable(projects.value),
      workspaces: toSerializable(projectWorkspaces.value),
      knowledgeDocuments: toSerializable(knowledgeDocuments.value),
      referenceWorks: toSerializable(referenceWorks.value),
      appSettings: toSerializable(appSettings.value),
      coverWorkbenchHistory: toSerializable(coverWorkbenchHistory.value)
    }
  }

  /**
   * Store 初始化入口：从 SQLite 加载工作区 → 标记水合完成。
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

    hasHydrated.value = true
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
      lastEdited: createProjectEditedAt(),
      cover: payload.project?.cover || 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)',
      writingStylePresetId: payload.project?.writingStylePresetId?.trim() || 'cinematic-cool',
      writingStylePrompt: payload.project?.writingStylePrompt?.trim() || '',
      chapterAssistantTemplates: normalizeChapterAssistantTemplates(payload.project?.chapterAssistantTemplates),
      novelWorkflowStages: payload.project?.novelWorkflowStages ?? createDefaultNovelWorkflowStages(),
      projectSkills: payload.project?.projectSkills ?? [],
      targetPlatform: payload.project?.targetPlatform?.trim() || '',
      selectedReferenceWorkIds: payload.project?.selectedReferenceWorkIds ?? [],
      coverHistory: payload.project?.coverHistory ?? []
    }

    projects.value = [normalizeProjectSummary(project), ...projects.value]
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: importedWorkspace
    }
    selectedProjectId.value = project.id
    pendingChapterInsertion.value = null
    currentView.value = 'workbench'
    activePanel.value = 'outline'
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
    activePanel.value = 'overview'
    lastWorkbenchPanel.value = 'overview'
    syncSelectedChapter(projectId)
    schedulePersist('fast')
  }

  /** 打开拆书知识库独立页面（全局库，不依赖项目） */
  function openDeconstructionLibrary(): void {
    pendingChapterInsertion.value = null
    currentView.value = 'deconstruction-library'
    schedulePersist('fast')
  }

  /** 打开 Skills 独立页面 */
  function openSkillsPage(projectId?: string): void {
    const resolvedProjectId = String(projectId ?? selectedProjectId.value ?? '').trim()
    const targetProject = projects.value.find((item) => item.id === resolvedProjectId) ?? projects.value[0]

    if (targetProject) {
      ensureProjectWorkspace(targetProject.id)
      selectedProjectId.value = targetProject.id
      syncSelectedChapter(targetProject.id)
    }

    currentView.value = 'skills'
    schedulePersist('fast')
  }

  /** 打开封面工作台独立页面 */
  function openCoverWorkbenchPage(projectId?: string): void {
    const resolvedProjectId = String(projectId ?? selectedProjectId.value ?? '').trim()
    const targetProject = projects.value.find((item) => item.id === resolvedProjectId) ?? projects.value[0]

    if (targetProject) {
      ensureProjectWorkspace(targetProject.id)
      selectedProjectId.value = targetProject.id
      syncSelectedChapter(targetProject.id)
    }

    currentView.value = 'cover-workbench'
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
      lastEdited: createProjectEditedAt(),
      cover: payload.project.cover || 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
      writingStylePresetId: payload.project.writingStylePresetId?.trim() || 'cinematic-cool',
      writingStylePrompt: payload.project.writingStylePrompt?.trim() || '',
      chapterAssistantTemplates: normalizeChapterAssistantTemplates(payload.project.chapterAssistantTemplates),
      novelWorkflowStages: payload.project.novelWorkflowStages ?? createDefaultNovelWorkflowStages(),
      projectSkills: payload.project.projectSkills ?? [],
      targetPlatform: payload.project.targetPlatform?.trim() || '',
      selectedReferenceWorkIds: payload.project.selectedReferenceWorkIds ?? [],
      coverHistory: payload.project.coverHistory ?? []
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

  /** 删除项目；若删除的是当前项目，自动切到剩余首个项目，删空时停留在项目中心空状态 */
  function deleteProject(projectId: string): void {
    if (!projects.value.some((project) => project.id === projectId)) {
      return
    }

    projects.value = projects.value.filter((project) => project.id !== projectId)
    const { [projectId]: _removedWorkspace, ...remainingWorkspaces } = projectWorkspaces.value
    projectWorkspaces.value = remainingWorkspaces

    if (selectedProjectId.value === projectId) {
      selectedProjectId.value = projects.value[0]?.id ?? ''
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
            lastEdited: payload.lastEdited?.trim() || createProjectEditedAt(),
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
            selectedReferenceWorkIds: payload.selectedReferenceWorkIds !== undefined
              ? payload.selectedReferenceWorkIds
              : project.selectedReferenceWorkIds,
            coverHistory: payload.coverHistory !== undefined ? payload.coverHistory : project.coverHistory
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

  function mergeKnowledgeDocuments(documents: KnowledgeDocument[]): void {
    const normalizedDocuments = documents
      .filter((document) => document && typeof document.id === 'string' && document.id.trim())
      .map((document) => ({
        ...document,
        keywords: Array.isArray(document.keywords)
          ? document.keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
          : [],
        metadata: document.metadata && typeof document.metadata === 'object'
          ? document.metadata
          : {},
        createdAt: document.createdAt || new Date().toISOString(),
        updatedAt: document.updatedAt || document.createdAt || new Date().toISOString()
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

    const incomingSourceKeys = new Set(
      normalizedDocuments
        .map((document) => getDocumentSourceKey(document))
        .filter((key): key is string => Boolean(key))
    )

    const preservedDocuments = incomingSourceKeys.size
      ? knowledgeDocuments.value.filter((document) => {
          const sourceKey = getDocumentSourceKey(document)
          return !sourceKey || !incomingSourceKeys.has(sourceKey)
        })
      : knowledgeDocuments.value

    knowledgeDocuments.value = [...preservedDocuments, ...normalizedDocuments]
    schedulePersist('fast')
  }

  function removeKnowledgeDocuments(documentIds: string[]): void {
    const idSet = new Set(documentIds.map((id) => String(id).trim()).filter(Boolean))
    if (!idSet.size) {
      return
    }

    knowledgeDocuments.value = knowledgeDocuments.value.filter((document) => !idSet.has(document.id))
    schedulePersist('fast')
  }

  function upsertProjectConstraint(payload: {
    id?: string
    title: string
    content: string
    summary?: string
    keywords?: string[]
    scope?: string
    weight?: 'core' | 'important' | 'supporting'
    locked?: boolean
  }): void {
    const title = String(payload.title ?? '').trim()
    const content = String(payload.content ?? '').trim()
    if (!title || !content) {
      return
    }

    const now = new Date().toISOString()
    const targetId = String(payload.id ?? '').trim()
    const existing = targetId
      ? knowledgeDocuments.value.find((document) => document.id === targetId)
      : null

    const nextDocument: KnowledgeDocument = {
      id: existing?.id || uniqueId('constraint'),
      title,
      sourceType: 'canon-fact',
      sourceLabel: 'global-constraint',
      content,
      summary: String(payload.summary ?? '').trim() || content.slice(0, 180),
      keywords: Array.isArray(payload.keywords)
        ? payload.keywords.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
        : [],
      metadata: {
        ...(existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
        scope: String(payload.scope ?? '').trim() || String(existing?.metadata?.scope ?? '').trim() || 'project',
        weight: payload.weight ?? existing?.metadata?.weight ?? 'core',
        locked: payload.locked ?? existing?.metadata?.locked ?? true,
        source: 'global-assistant'
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }

    if (existing) {
      knowledgeDocuments.value = knowledgeDocuments.value.map((document) =>
        document.id === existing.id ? nextDocument : document
      )
    } else {
      knowledgeDocuments.value = [...knowledgeDocuments.value, nextDocument]
    }

    schedulePersist('fast')
  }

  function removeProjectConstraint(documentId: string): void {
    const trimmedId = String(documentId ?? '').trim()
    if (!trimmedId) {
      return
    }
    removeKnowledgeDocuments([trimmedId])
  }

  function upsertReferenceWork(work: ReferenceWorkItem): void {
    const existingIndex = referenceWorks.value.findIndex((item) => item.id === work.id)
    if (existingIndex >= 0) {
      const next = [...referenceWorks.value]
      next[existingIndex] = work
      referenceWorks.value = next
    } else {
      referenceWorks.value = [...referenceWorks.value, work]
    }
    schedulePersist('fast')
  }

  function removeReferenceWork(referenceWorkId: string): void {
    const trimmedId = String(referenceWorkId ?? '').trim()
    if (!trimmedId) return
    referenceWorks.value = referenceWorks.value.filter((item) => item.id !== trimmedId)
    for (const project of projects.value) {
      const ids = project.selectedReferenceWorkIds ?? []
      if (ids.includes(trimmedId)) {
        updateProject(project.id, {
          selectedReferenceWorkIds: ids.filter((id) => id !== trimmedId)
        })
      }
    }
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
          usage: record.usage && typeof record.usage === 'object'
            ? {
                promptTokens: Number.isFinite(record.usage.promptTokens) ? Math.max(0, Number(record.usage.promptTokens)) : undefined,
                completionTokens: Number.isFinite(record.usage.completionTokens) ? Math.max(0, Number(record.usage.completionTokens)) : undefined,
                totalTokens: Number.isFinite(record.usage.totalTokens) ? Math.max(0, Number(record.usage.totalTokens)) : undefined,
                reasoningTokens: Number.isFinite(record.usage.reasoningTokens) ? Math.max(0, Number(record.usage.reasoningTokens)) : undefined,
                cachedInputTokens: Number.isFinite(record.usage.cachedInputTokens) ? Math.max(0, Number(record.usage.cachedInputTokens)) : undefined
              }
            : undefined,
          usedKnowledge: Array.isArray(record.usedKnowledge)
            ? record.usedKnowledge.map((item) => {
                const sourceType: AiRunRecord['usedKnowledge'][number]['sourceType'] =
                  item.sourceType === 'reference-summary'
                  || item.sourceType === 'workflow-document'
                  || item.sourceType === 'canon-fact'
                  || item.sourceType === 'chapter-summary'
                    ? item.sourceType
                    : 'reference-chunk'

                return {
                  documentId: String(item.documentId ?? '').trim(),
                  title: String(item.title ?? '').trim() || '未命名知识片段',
                  sourceType,
                  sourceLabel: String(item.sourceLabel ?? '').trim(),
                  snippet: String(item.snippet ?? '').trim(),
                  keywords: Array.isArray(item.keywords)
                    ? item.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 8)
                    : []
                }
              })
            : [],
          toolCalls: Array.isArray(record.toolCalls)
            ? record.toolCalls.map((item) => ({
                tool: String(item.tool ?? '').trim(),
                args: item.args && typeof item.args === 'object' ? item.args as Record<string, unknown> : {},
                durationMs: Number.isFinite(item.durationMs) ? Math.max(0, Number(item.durationMs)) : 0,
                status: (item.status === 'error' ? 'error' : 'ok') as 'ok' | 'error',
                error: String(item.error ?? '').trim() || undefined
              }))
            : undefined
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
  function createWorldviewEntry(payload?: Partial<WorldviewEntry>): string {
    const entryId = uniqueId('world')
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries([
        {
          id: entryId,
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
    return entryId
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
  function createCharacter(payload?: Partial<CharacterCard>): string {
    const characterId = uniqueId('char')
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: [
        {
          id: characterId,
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
    return characterId
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

    if (panel === 'deconstruction') {
      openDeconstructionLibrary()
      return
    }

    lastWorkbenchPanel.value = panel
    activePanel.value = panel
    currentView.value = 'workbench'
  }

  function setAssistantFocusTarget(panel: AssistantFocusPanel, entityId: string): void {
    assistantFocusTarget.value = {
      panel,
      entityId,
      nonce: Date.now()
    }
  }

  function clearAssistantFocusTarget(panel?: AssistantFocusPanel, entityId?: string): void {
    const current = assistantFocusTarget.value
    if (!current) {
      return
    }

    if (panel && current.panel !== panel) {
      return
    }

    if (entityId && current.entityId !== entityId) {
      return
    }

    assistantFocusTarget.value = null
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
  function createOutlineItem(payload?: Partial<OutlineItem>): string {
    const outlineId = uniqueId('outline')
    updateCurrentWorkspace((workspace) => {
      const requestedVolumeId = payload?.volumeId?.trim()
      const targetVolumeId = requestedVolumeId && workspace.outlineVolumes.some((volume) => volume.id === requestedVolumeId)
        ? requestedVolumeId
        : (selectedChapter.value?.volumeId && workspace.outlineVolumes.some((volume) => volume.id === selectedChapter.value?.volumeId)
            ? selectedChapter.value.volumeId
            : getWorkspacePrimaryVolumeId(workspace))
      const nextIndex = getOutlineSequenceInVolume(workspace.outlineItems, targetVolumeId)
      const nextItem: OutlineItem = {
        id: outlineId,
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
    return outlineId
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

    const resolvedOutlineItemId = chapter.outlineItemId
      || outlineItems.value.find((item) =>
        item.volumeId === chapter.volumeId && item.title.trim() === chapter.title.trim()
      )?.id
      || ''

    updateChapter(chapter.id, {
      title: value,
      outlineItemId: resolvedOutlineItemId || chapter.outlineItemId
    })
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

  async function reloadChapterFromDb(chapterId: string): Promise<void> {
    const projectId = currentProject.value?.id
    if (!projectId) return
    const res = await window.characterArc.readChapterFromDb(projectId, chapterId)
    if (!res.success || !res.result) return
    const data = res.result
    updateChapter(chapterId, {
      title: data.title,
      summary: data.summary,
      status: data.status as ChapterDraft['status'],
      wordTarget: data.wordTarget,
      content: data.content
    })
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
    let version = chapterVersions.value.find((item) => item.id === versionId)

    if (!version) {
      const projectId = currentProject.value?.id
      if (projectId) {
        const res = await window.characterArc.readChapterVersionFromDb(projectId, versionId)
        if (res.success && res.result) {
          version = {
            id: res.result.id,
            chapterId: res.result.chapterId,
            title: res.result.title,
            summary: res.result.summary,
            status: res.result.status as ChapterDraft['status'],
            wordTarget: res.result.wordTarget,
            content: res.result.content,
            createdAt: res.result.createdAt
          }
        }
      }
    }

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

  /** 更新单个应用设置项并触发快速持久化（仅写入 app_settings 行） */
  function updateAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    appSettings.value[key] = value
    scheduleSettingsPersist()
  }

  function switchAiProfile(profileId: string): void {
    const profile = appSettings.value.aiProfiles.find(p => p.id === profileId)
    if (!profile) return
    appSettings.value.activeAiProfileId = profileId
    appSettings.value.provider = profile.provider
    appSettings.value.model = profile.model
    appSettings.value.apiKey = profile.apiKey
    appSettings.value.baseUrl = profile.baseUrl
    scheduleSettingsPersist()
  }

  function updateActiveAiProfileModel(model: string): void {
    appSettings.value.model = model
    const profile = appSettings.value.aiProfiles.find(p => p.id === appSettings.value.activeAiProfileId)
    if (profile) profile.model = model
    scheduleSettingsPersist()
  }

  function addAiProfile(profile: import('@/types/app').AiProfile): void {
    appSettings.value.aiProfiles.push(profile)
    scheduleSettingsPersist()
  }

  function deleteAiProfile(profileId: string): void {
    if (profileId === appSettings.value.activeAiProfileId) return
    appSettings.value.aiProfiles = appSettings.value.aiProfiles.filter(p => p.id !== profileId)
    scheduleSettingsPersist()
  }

  function updateAiProfile(profileId: string, updates: Partial<import('@/types/app').AiProfile>): void {
    const profile = appSettings.value.aiProfiles.find(p => p.id === profileId)
    if (!profile) return
    Object.assign(profile, updates)
    if (profileId === appSettings.value.activeAiProfileId) {
      if (updates.provider !== undefined) appSettings.value.provider = updates.provider
      if (updates.model !== undefined) appSettings.value.model = updates.model
      if (updates.apiKey !== undefined) appSettings.value.apiKey = updates.apiKey
      if (updates.baseUrl !== undefined) appSettings.value.baseUrl = updates.baseUrl
    }
    scheduleSettingsPersist()
  }

  function updateCoverWorkbenchHistory(items: import('@/types/app').CoverWorkbenchHistoryItem[]): void {
    coverWorkbenchHistory.value = items
    schedulePersist('fast')
  }

  const MAX_CHAT_MESSAGES = 100
  const STREAMING_ASSISTANT_PERSIST_INTERVAL_MS = 2400
  let lastStreamingAssistantPersistAt = 0

  function scheduleAssistantSessionPersist(mode: 'streaming' | 'final' = 'final'): void {
    if (mode === 'streaming') {
      const now = Date.now()
      if (now - lastStreamingAssistantPersistAt < STREAMING_ASSISTANT_PERSIST_INTERVAL_MS) {
        return
      }
      lastStreamingAssistantPersistAt = now
      schedulePersist('autosave', { syncWorkspace: false })
      return
    }

    lastStreamingAssistantPersistAt = Date.now()
    schedulePersist('fast')
  }

  function resolveSessionTitle(messages: ChatMessage[]): string {
    const firstUserMessage = messages.find((item) => item.role === 'user')?.content.trim()
    if (!firstUserMessage) {
      return '新对话'
    }

    return firstUserMessage.length > 24 ? `${firstUserMessage.slice(0, 24)}...` : firstUserMessage
  }

  function createGlobalAssistantSession(messages: ChatMessage[] = createEmptyWorkspace().messages): GlobalAssistantSession {
    const now = new Date().toISOString()
    const clonedMessages = messages.map((item) => ({ ...item }))
    return {
      id: uniqueId('global-assistant-session'),
      title: resolveSessionTitle(clonedMessages),
      messages: clonedMessages,
      proposal: null,
      lastProposalPrompt: '',
      lastAssistantReply: '',
      createdAt: now,
      updatedAt: now
    }
  }

  function syncActiveGlobalAssistantSession(
    workspace: ProjectWorkspaceData,
    updater: (session: GlobalAssistantSession) => GlobalAssistantSession
  ): ProjectWorkspaceData {
    const sessions = workspace.globalAssistantSessions.length
      ? workspace.globalAssistantSessions
      : [createGlobalAssistantSession(workspace.messages)]
    const activeSession = sessions.find((session) => session.id === workspace.activeGlobalAssistantSessionId) ?? sessions[0]
    const nextActiveSession = updater(activeSession)
    const nextSessions = sessions.map((session) => (
      session.id === nextActiveSession.id ? nextActiveSession : session
    ))

    return {
      ...workspace,
      messages: nextActiveSession.messages,
      globalAssistantSessions: nextSessions,
      activeGlobalAssistantSessionId: nextActiveSession.id
    }
  }

  // ── AI 聊天消息 ──
  /** 添加用户消息到聊天记录 */
  function pushUserMessage(content: string): void {
    updateCurrentWorkspace((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const now = new Date().toISOString()
      const nextMessages: ChatMessage[] = [
        ...session.messages.slice(-MAX_CHAT_MESSAGES + 1),
        {
          id: uniqueId('msg'),
          role: 'user',
          content
        }
      ]

      return {
        ...session,
        title: resolveSessionTitle(nextMessages),
        messages: nextMessages,
        updatedAt: now
      }
    }))
    schedulePersist('fast')
  }

  function pushAssistantMessage(content: string): void {
    updateCurrentWorkspace((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const now = new Date().toISOString()
      const nextMessages: ChatMessage[] = [
        ...session.messages.slice(-MAX_CHAT_MESSAGES + 1),
        {
          id: uniqueId('msg'),
          role: 'assistant',
          content
        }
      ]

      return {
        ...session,
        title: resolveSessionTitle(nextMessages),
        messages: nextMessages,
        updatedAt: now
      }
    }))
    schedulePersist('fast')
  }

  function pushStreamingAssistantMessage(): string {
    const messageId = uniqueId('msg')
    updateCurrentWorkspace((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const now = new Date().toISOString()
      const nextMessages: ChatMessage[] = [
        ...session.messages.slice(-MAX_CHAT_MESSAGES + 1),
        {
          id: messageId,
          role: 'assistant',
          content: ''
        }
      ]

      return {
        ...session,
        title: resolveSessionTitle(nextMessages),
        messages: nextMessages,
        updatedAt: now
      }
    }))
    schedulePersist('fast')
    return messageId
  }

  function updateAssistantMessageContent(
    messageId: string,
    updater: (content: string) => string,
    options: { persistMode?: 'streaming' | 'final' } = {}
  ): void {
    updateCurrentWorkspaceAssistantSession((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const now = new Date().toISOString()
      const nextMessages = session.messages.map((item) => (
        item.id === messageId
          ? { ...item, content: updater(item.content) }
          : item
      ))

      return {
        ...session,
        title: resolveSessionTitle(nextMessages),
        messages: nextMessages,
        updatedAt: now
      }
    }))
    scheduleAssistantSessionPersist(options.persistMode ?? 'streaming')
  }

  function updateAssistantMessageMeta(
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
    options: { persistMode?: 'streaming' | 'final' } = {}
  ): void {
    updateCurrentWorkspaceAssistantSession((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const now = new Date().toISOString()
      const nextMessages = session.messages.map((item) => (
        item.id === messageId ? updater(item) : item
      ))

      return {
        ...session,
        title: resolveSessionTitle(nextMessages),
        messages: nextMessages,
        updatedAt: now
      }
    }))
    scheduleAssistantSessionPersist(options.persistMode ?? 'streaming')
  }

  function appendAssistantToolCall(messageId: string, toolCall: AssistantToolCall): void {
    updateAssistantMessageMeta(messageId, (message) => {
      const nextToolCalls = [...(message.toolCalls ?? []), toolCall]
      const turns = [...(message.turns ?? [])]
      const currentTurn = turns[turns.length - 1]
      const targetTurn: AssistantTurn = currentTurn && !currentTurn.text.trim()
        ? currentTurn
        : { text: '', toolCalls: [], editEvents: [] }

      if (!currentTurn || currentTurn !== targetTurn) {
        turns.push(targetTurn)
      }

      targetTurn.toolCalls = [...targetTurn.toolCalls, toolCall]

      return {
        ...message,
        toolCalls: nextToolCalls,
        turns
      }
    })
  }

  function updateAssistantToolCall(
    messageId: string,
    toolUseId: string,
    updater: (toolCall: AssistantToolCall) => AssistantToolCall
  ): void {
    updateAssistantMessageMeta(messageId, (message) => {
      const nextToolCalls = (message.toolCalls ?? []).map((item) => (
        item.toolUseId === toolUseId ? updater(item) : item
      ))
      const nextTurns = (message.turns ?? []).map((turn) => ({
        ...turn,
        toolCalls: turn.toolCalls.map((item) => (
          item.toolUseId === toolUseId ? updater(item) : item
        ))
      }))

      return {
        ...message,
        toolCalls: nextToolCalls,
        turns: nextTurns
      }
    })
  }

  function appendAssistantEditEvent(messageId: string, event: AssistantEditEvent): void {
    updateAssistantMessageMeta(messageId, (message) => {
      const nextEditEvents = [...(message.editEvents ?? []), event]
      const turns = [...(message.turns ?? [])]
      if (turns.length === 0) {
        turns.push({ text: '', toolCalls: [], editEvents: [] })
      }
      const currentTurn = turns[turns.length - 1]
      currentTurn.editEvents = [...currentTurn.editEvents, event]

      return {
        ...message,
        editEvents: nextEditEvents,
        turns
      }
    })
  }

  function finalizeAssistantStreamingMessage(messageId: string, payload?: {
    isError?: boolean
    isCanceled?: boolean
  }): void {
    updateAssistantMessageMeta(messageId, (message) => ({
      ...message,
      isError: payload?.isError ?? false,
      isCanceled: payload?.isCanceled ?? false,
      toolCalls: (message.toolCalls ?? []).map((item) => (
        item.status === 'running'
          ? { ...item, status: 'error', isError: true, result: item.result || '（连接中断）' }
          : item
      )),
      turns: (message.turns ?? []).map((turn) => ({
        ...turn,
        toolCalls: turn.toolCalls.map((item) => (
          item.status === 'running'
            ? { ...item, status: 'error', isError: true, result: item.result || '（连接中断）' }
            : item
        ))
      }))
    }), { persistMode: 'final' })
  }

  function updateAssistantSessionProposal(payload: {
    proposal?: GlobalAssistantProposal | null
    lastProposalPrompt?: string
    lastAssistantReply?: string
  }): void {
    updateCurrentWorkspace((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => ({
      ...session,
      proposal: payload.proposal === undefined ? session.proposal : payload.proposal,
      lastProposalPrompt: payload.lastProposalPrompt === undefined ? session.lastProposalPrompt : payload.lastProposalPrompt,
      lastAssistantReply: payload.lastAssistantReply === undefined ? session.lastAssistantReply : payload.lastAssistantReply,
      updatedAt: new Date().toISOString()
    })))
    schedulePersist('fast')
    if (payload.proposal !== undefined) {
      void persistWorkspace()
    }
  }

  function clearAssistantMessages(): void {
    updateCurrentWorkspace((workspace) => syncActiveGlobalAssistantSession(workspace, (session) => {
      const messages = createEmptyWorkspace().messages
      return {
        ...session,
        title: resolveSessionTitle(messages),
        messages,
        updatedAt: new Date().toISOString()
      }
    }))
    schedulePersist('fast')
  }

  function createAssistantSession(): void {
    const nextSession = createGlobalAssistantSession([])
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      messages: nextSession.messages,
      globalAssistantSessions: [nextSession, ...workspace.globalAssistantSessions],
      activeGlobalAssistantSessionId: nextSession.id
    }))
    schedulePersist('fast')
  }

  function switchAssistantSession(sessionId: string): void {
    updateCurrentWorkspace((workspace) => {
      const target = workspace.globalAssistantSessions.find((session) => session.id === sessionId)
      if (!target) {
        return workspace
      }

      return {
        ...workspace,
        messages: target.messages,
        activeGlobalAssistantSessionId: target.id
      }
    })
    schedulePersist('fast')
  }

  function deleteAssistantSession(sessionId: string): void {
    updateCurrentWorkspace((workspace) => {
      const nextSessions = workspace.globalAssistantSessions.filter((session) => session.id !== sessionId)
      const fallbackSession = nextSessions.find((session) => session.id === workspace.activeGlobalAssistantSessionId)
        ?? nextSessions[0]
        ?? createGlobalAssistantSession([])

      return {
        ...workspace,
        messages: fallbackSession.messages,
        globalAssistantSessions: nextSessions.length ? nextSessions : [fallbackSession],
        activeGlobalAssistantSessionId: fallbackSession.id
      }
    })
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

  // ══════════════════════════════════════════════════════════════════
  // 全局 AI 任务注册表：跨面板维持按钮 loading，驱动进度面板
  // ══════════════════════════════════════════════════════════════════

  /**
   * 把 Map 当作响应式容器时的常规操作：
   * 替换引用才能触发 Vue 重新收集依赖，否则 computed 不会重算。
   */
  function replaceTaskRuns(updater: (next: Map<string, AiTaskRun>) => void): void {
    const next = new Map(aiTaskRuns.value)
    updater(next)
    aiTaskRuns.value = next
  }

  /** 正在进行中的任务（按启动顺序排列，稳定展示在进度面板顶部） */
  const runningAiTasks = computed<AiTaskRun[]>(() =>
    Array.from(aiTaskRuns.value.values())
      .filter((run) => run.stage === 'running')
      .sort((a, b) => a.startedAt - b.startedAt)
  )

  /** 最近已结束、仍在保留窗口内的任务（方便用户看到成功/失败反馈） */
  const recentAiTasks = computed<AiTaskRun[]>(() =>
    Array.from(aiTaskRuns.value.values())
      .filter((run) => run.stage !== 'running')
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  )

  /** 查询某个任务 key 是否在运行——组件绑定按钮 disabled 和 loading 文本 */
  function isAiTaskRunning(key: string): boolean {
    return aiTaskRuns.value.get(key)?.stage === 'running'
  }

  /** 读取单个任务记录（进度面板或特殊 UI 需要 onCancel 时使用） */
  function getAiTaskRun(key: string): AiTaskRun | undefined {
    return aiTaskRuns.value.get(key)
  }

  /**
   * 执行一次被跟踪的 AI 任务。
   *
   * - 同 key 已在运行时直接拒绝，避免重复请求。
   * - 无论 executor 抛异常还是成功返回，任务都会被标记为结束并在短暂保留后自动清理。
   * - 返回值是 executor 的返回值，方便调用方继续处理结果。
   * - 自动生成 `clientTaskId` 并注入到 executor 的闭包上下文中（通过 `getClientTaskId()`）。
   * - 默认 90s 超时；超时后自动通知主进程 abort 并标记任务失败。
   *
   * @throws 保留 executor 原始错误抛出，让上层可以 try/catch 常规处理。
   */
  async function runTrackedAiTask<T>(input: AiTaskRunInput, executor: () => Promise<T>): Promise<T> {
    if (isAiTaskRunning(input.key)) {
      throw new Error(`AI 任务「${input.label}」正在进行中，请稍候。`)
    }

    // 生成唯一 clientTaskId，用于主进程 abort 通道
    const clientTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // 把 clientTaskId 挂到全局，让 executor 内部构造 payload 时可以取到
    currentClientTaskId = clientTaskId

    const run: AiTaskRun = {
      ...input,
      startedAt: Date.now(),
      stage: 'running'
    }

    replaceTaskRuns((next) => {
      next.set(input.key, run)
    })

    // 超时控制：优先使用任务级覆盖，其次读取用户配置
    const timeoutMs = input.timeoutMs ?? (appSettings.value.aiTimeoutSeconds * 1000)
    let timeoutHandle: number | null = null
    let timedOut = false

    const timeoutPromise = timeoutMs > 0
      ? new Promise<never>((_, reject) => {
          timeoutHandle = window.setTimeout(() => {
            timedOut = true
            // 通知主进程 abort
            window.characterArc.cancelAiTask(clientTaskId).catch(() => {})
            reject(new Error(`AI 任务超时（${Math.round(timeoutMs / 1000)}s），已自动取消。`))
          }, timeoutMs)
        })
      : null

    try {
      const result = timeoutPromise
        ? await Promise.race([executor(), timeoutPromise])
        : await executor()
      finalizeAiTask(input.key, 'done')
      return result
    } catch (error) {
      const msg = timedOut
        ? `AI 任务超时（${Math.round(timeoutMs / 1000)}s），已自动取消。`
        : (error instanceof Error ? error.message : String(error))
      finalizeAiTask(input.key, 'error', msg)
      throw error
    } finally {
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle)
      }
      currentClientTaskId = null
    }
  }

  /**
   * 当前正在执行的 `runTrackedAiTask` 的 clientTaskId。
   * 组件在 executor 闭包里构造 IPC payload 时可以通过 `getClientTaskId()` 取到，
   * 注入到 `payload.clientTaskId` 字段，让主进程能按此 id 做 abort。
   */
  let currentClientTaskId: string | null = null

  /** 获取当前正在执行的任务的 clientTaskId（供 executor 闭包内使用） */
  function getClientTaskId(): string | undefined {
    return currentClientTaskId ?? undefined
  }

  function finalizeAiTask(key: string, stage: 'done' | 'error', error?: string): void {
    const existing = aiTaskRuns.value.get(key)
    if (!existing) {
      return
    }

    const finishedAt = Date.now()
    replaceTaskRuns((next) => {
      next.set(key, { ...existing, stage, finishedAt, error })
    })

    window.setTimeout(() => {
      const current = aiTaskRuns.value.get(key)
      // 只清理那条没被重新启动的任务；新任务会带新的 startedAt
      if (current && current.startedAt === existing.startedAt && current.stage !== 'running') {
        replaceTaskRuns((next) => {
          next.delete(key)
        })
      }
    }, AI_TASK_RETENTION_MS)
  }

  /** 手动清理一条任务记录（进度面板的"关闭"按钮使用） */
  function dismissAiTask(key: string): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || run.stage === 'running') {
      return
    }

    replaceTaskRuns((next) => {
      next.delete(key)
    })
  }

  /** 触发某条任务的取消回调（如果提供了） */
  function cancelAiTask(key: string): void {
    const run = aiTaskRuns.value.get(key)
    if (!run || run.stage !== 'running' || !run.onCancel) {
      return
    }

    try {
      run.onCancel()
    } catch (error) {
      console.error('[aiTasks] cancel handler failed:', error)
    }
  }

  // ── 事件监听注册 ──
  window.characterArc.onWorkspaceSync(handleRemoteWorkspaceSync)
  window.characterArc.onAiRunEvent(handleAiRunEvent)
  window.characterArc.onChapterStateWarnings(handleChapterStateWarnings)
  window.characterArc.onChapterPostGenerationIssues(handleChapterPostGenerationIssues)

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

  return {
    activePanel,
    autoSaveIntervalLabel,
    aiRuns,
    appSettings,
    activeGlobalAssistantSessionId,
    assistantFocusTarget,
    coverWorkbenchHistory,
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
    activeGlobalAssistantSession,
    currentTheme,
    currentProject,
    currentChapterSelection,
    currentView,
    globalAssistantSessions,
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
    consumeChapterInsertion,
    getChapterVersions,
    messages,
    moveChapter,
    moveOutlineItem,
    openChapterStudio,
    openDeconstructionLibrary,
    openProject,
    openCoverWorkbenchPage,
    openSkillsPage,
    openWizard,
    outlineItems,
    organizationMemberships,
    organizations,
    outlineVolumeGroups,
    outlineVolumes,
    pendingChapterInsertion,
    plotThreads,
    projects,
    clearAssistantMessages,
    createAssistantSession,
    deleteAssistantSession,
    pushAssistantMessage,
    pushStreamingAssistantMessage,
    pushUserMessage,
    restoreChapterVersion,
    saveCurrentChapterVersion,
    selectChapter,
    selectedChapter,
    selectedChapterId,
    selectedChapterVolume,
    selectedProjectId,
    setPanel,
    setAssistantFocusTarget,
    switchAssistantSession,
    setTheme,
    theme,
    updateAppSetting,
    switchAiProfile,
    updateActiveAiProfileModel,
    addAiProfile,
    deleteAiProfile,
    updateAiProfile,
    updateAssistantMessageContent,
    updateAssistantMessageMeta,
    appendAssistantToolCall,
    updateAssistantToolCall,
    appendAssistantEditEvent,
    finalizeAssistantStreamingMessage,
    updateAssistantSessionProposal,
    updateCoverWorkbenchHistory,
    updateProject,
    activeWorkflowVolumeId,
    activeWorkflowVolume,
    setActiveWorkflowVolumeId,
    mergeKnowledgeDocuments,
    removeKnowledgeDocuments,
    projectConstraints,
    upsertProjectConstraint,
    removeProjectConstraint,
    referenceWorks,
    upsertReferenceWork,
    removeReferenceWork,
    knowledgeDocuments,
    updateWorkflowDocument,
    updateWorkflowDocuments,
    appendWorkflowDocumentEntry,
    workflowDocuments,
    flushWorkspaceSync,
    persistWorkspace,
    updateChapter,
    updateChapterContent,
    reloadChapterFromDb,
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
    persistenceError,
    clearAssistantFocusTarget,
    // ── AI 任务注册表 ──
    runningAiTasks,
    recentAiTasks,
    isAiTaskRunning,
    getAiTaskRun,
    runTrackedAiTask,
    getClientTaskId,
    dismissAiTask,
    cancelAiTask,
    getChapterStateWarnings,
    dismissChapterStateWarnings,
    getChapterPostGenerationIssues,
    dismissChapterPostGenerationIssues
  }
})
