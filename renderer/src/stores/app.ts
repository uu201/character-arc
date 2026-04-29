import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { FAST_PERSIST_DELAY_MS, formatAutoSaveIntervalLabel, isLiveAutoSaveInterval, resolveAutoSaveDelayMs } from '@/features/settings/autoSave'
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
  OutlineItem,
  OutlineVolume,
  PanelName,
  ProjectSummary,
  ProjectWorkspaceData,
  ThemeName,
  WorldviewEntry
} from '@/types/app'

interface ProjectWorkspacePayload {
  project: {
    title: string
    genre: string
    wordCount: string
    cover?: string
  }
  worldviewEntries?: WorldviewEntry[]
  characters?: CharacterCard[]
  outlineVolumes?: OutlineVolume[]
  outlineItems?: OutlineItem[]
  chapters?: ChapterDraft[]
  chapterVersions?: ChapterVersion[]
  messages?: ChatMessage[]
}

function toIsoTimestamp(value?: string): string {
  const parsed = value ? new Date(value) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return new Date().toISOString()
}

function reindexWorldviewEntries(entries: WorldviewEntry[]): WorldviewEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    sortOrder: index
  }))
}

function reindexOutlineItems(items: OutlineItem[]): OutlineItem[] {
  return items.map((item, index) => ({
    ...item,
    sortOrder: index
  }))
}


export const useAppStore = defineStore('app', () => {
  const stored = loadStoredState()
  const hasHydrated = ref(false)
  const persistenceError = ref<string | null>(null)
  let saveTimer: number | null = null
  let workspaceSyncTimer: number | null = null
  const scheduledPersistAt = ref<number | null>(null)
  const currentView = ref<'projects' | 'wizard' | 'workbench' | 'chapter-studio'>('projects')
  const activePanel = ref<PanelName>('world')
  const lastWorkbenchPanel = ref<Exclude<PanelName, 'chapters'>>('world')
  const aiVisible = ref(true)
  const theme = ref<ThemeName>(stored.theme)
  const selectedProjectId = ref(stored.selectedProjectId)
  const projects = ref<ProjectSummary[]>(stored.projects)
  const projectWorkspaces = ref<Record<string, ProjectWorkspaceData>>(stored.workspaces)
  const appSettings = ref<AppSettings>(stored.appSettings)
  const pendingAssistantRequest = ref<AssistantPromptRequest | null>(null)
  const pendingChapterInsertion = ref<ChapterInsertionRequest | null>(null)
  const currentChapterSelection = ref<ChapterSelectionState | null>(null)
  const selectedChapterId = ref(stored.workspaces[stored.selectedProjectId]?.chapters[0]?.id ?? '')
  let isApplyingRemoteWorkspaceSync = false

  const currentWorkspace = computed(
    () => projectWorkspaces.value[selectedProjectId.value] ?? createEmptyWorkspace()
  )
  const worldviewEntries = computed(() => currentWorkspace.value.worldviewEntries)
  const characters = computed(() => currentWorkspace.value.characters)
  const outlineItems = computed(() => currentWorkspace.value.outlineItems)
  const chapters = computed(() => currentWorkspace.value.chapters)
  const outlineVolumes = computed(() => currentWorkspace.value.outlineVolumes)
  const chapterVersions = computed(() => currentWorkspace.value.chapterVersions)
  const messages = computed(() => currentWorkspace.value.messages)
  const autoSaveIntervalLabel = computed(() => formatAutoSaveIntervalLabel(appSettings.value.autoSaveInterval))
  const isLiveAutoSave = computed(() => isLiveAutoSaveInterval(appSettings.value.autoSaveInterval))
  const isPersistencePending = computed(() => scheduledPersistAt.value !== null)
  const selectedChapter = computed(
    () => chapters.value.find((chapter) => chapter.id === selectedChapterId.value) ?? chapters.value[0]
  )
  const selectedChapterVolume = computed(
    () => outlineVolumes.value.find((volume) => volume.id === selectedChapter.value?.volumeId) ?? outlineVolumes.value[0]
  )
  const outlineVolumeGroups = computed(() => buildVolumeGroups(outlineVolumes.value, outlineItems.value))
  const chapterVolumeGroups = computed(() => buildVolumeGroups(outlineVolumes.value, chapters.value))
  const currentTheme = computed(() => getThemePreset(theme.value))
  const currentProject = computed(
    () => projects.value.find((project) => project.id === selectedProjectId.value) ?? projects.value[0]
  )

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

  function scheduleWorkspaceSync(): void {
    if (!hasHydrated.value || isApplyingRemoteWorkspaceSync) {
      return
    }

    if (workspaceSyncTimer) {
      window.clearTimeout(workspaceSyncTimer)
    }

    workspaceSyncTimer = window.setTimeout(() => {
      void window.characterArc.publishWorkspaceSync(serializeWorkspaceState())
    }, 120)
  }

  function publishAssistantContext(): void {
    if (characterArcWindowKind !== 'main') {
      return
    }

    void window.characterArc.publishAssistantContext(serializeAssistantContext())
  }

  async function syncAssistantWindowState(): Promise<void> {
    if (characterArcWindowKind !== 'main') {
      aiVisible.value = true
      return
    }

    const result = await window.characterArc.getAssistantWindowState()
    aiVisible.value = result.success ? Boolean(result.visible) : false
  }

  async function openAssistantWindow(): Promise<void> {
    const result = await window.characterArc.openAssistantWindow()
    if (!result.success) {
      return
    }

    aiVisible.value = true
    publishAssistantContext()
    scheduleWorkspaceSync()
  }

  async function closeAssistantWindow(): Promise<void> {
    const result = await window.characterArc.closeAssistantWindow()
    if (result.success) {
      aiVisible.value = false
    }
  }

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

  function handleAssistantCommand(payload: CharacterArcAssistantCommand): void {
    if (characterArcWindowKind !== 'main') {
      return
    }

    if (payload.type === 'insert-into-chapter') {
      insertIntoChapter(payload.content, payload.mode)
    }
  }

  function syncSelectedChapter(projectId = selectedProjectId.value): void {
    const chapterList = projectWorkspaces.value[projectId]?.chapters ?? []
    const hasCurrentChapter = chapterList.some((chapter) => chapter.id === selectedChapterId.value)
    selectedChapterId.value = hasCurrentChapter ? selectedChapterId.value : (chapterList[0]?.id ?? '')
  }

  function ensureProjectWorkspace(projectId: string, fallbackToDemo = false): void {
    if (projectWorkspaces.value[projectId]) {
      return
    }

    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData(undefined, { fallbackToDemo })
    }
  }

  function updateProjectWorkspace(projectId: string, updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData): void {
    const baseWorkspace = normalizeProjectWorkspaceData(projectWorkspaces.value[projectId])
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData(updater(baseWorkspace))
    }
  }

  function updateCurrentWorkspace(updater: (workspace: ProjectWorkspaceData) => ProjectWorkspaceData): void {
    ensureProjectWorkspace(selectedProjectId.value)
    updateProjectWorkspace(selectedProjectId.value, updater)
    syncSelectedChapter()
    scheduleWorkspaceSync()
  }

  function applyWorkspaceState(payload?: Partial<StoredState> | LegacyStoredState | null): void {
    if (!payload) {
      return
    }

    theme.value = payload.theme ?? 'ocean'
    projects.value = payload.projects?.length ? payload.projects : defaultProjects

    const fallbackProjectId = projects.value[0]?.id ?? defaultProjects[0].id
    selectedProjectId.value = payload.selectedProjectId ?? fallbackProjectId
    projectWorkspaces.value =
      'workspaces' in payload && payload.workspaces
        ? Object.fromEntries(
            Object.entries(payload.workspaces).map(([projectId, workspace], index) => [
              projectId,
              normalizeProjectWorkspaceData(workspace, {
                fallbackToDemo: index === 0 && projectId === defaultProjects[0].id
              })
            ])
          )
        : buildWorkspaceMapFromLegacy(payload as LegacyStoredState, selectedProjectId.value)

    for (const [index, project] of projects.value.entries()) {
      ensureProjectWorkspace(project.id, index === 0 && project.id === defaultProjects[0].id)
    }

    appSettings.value = normalizeAppSettings(payload.appSettings)
    syncSelectedChapter()
  }

  function serializeWorkspaceState(): StoredState {
    return {
      theme: theme.value,
      selectedProjectId: selectedProjectId.value,
      projects: toSerializable(projects.value),
      workspaces: toSerializable(projectWorkspaces.value),
      appSettings: toSerializable(appSettings.value)
    }
  }

  async function initialize(): Promise<void> {
    const result = await window.characterArc.loadWorkspace()
    if (result.success && result.payload) {
      applyWorkspaceState(result.payload as Partial<StoredState>)
      persistenceError.value = null
    } else {
      persistenceError.value = result.error ?? null
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

  async function persistWorkspace(): Promise<void> {
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }

    const result = await window.characterArc.saveWorkspace(serializeWorkspaceState())
    persistenceError.value = result.success ? null : result.error ?? '保存失败'
    if (result.success) {
      scheduledPersistAt.value = null
    }
  }

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

  function importProjectData(payload: {
    project?: Partial<ProjectSummary>
    worldviewEntries?: WorldviewEntry[]
    characters?: CharacterCard[]
    outlineVolumes?: OutlineVolume[]
    outlineItems?: OutlineItem[]
    chapters?: ChapterDraft[]
    chapterVersions?: ChapterVersion[]
  }): void {
    const projectId = `project-${Date.now()}`
    const project: ProjectSummary = {
      id: projectId,
      title: payload.project?.title?.trim() || '导入项目',
      genre: payload.project?.genre?.trim() || '未分类',
      wordCount: payload.project?.wordCount?.trim() || '已导入',
      lastEdited: '刚刚导入',
      cover: payload.project?.cover || 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)'
    }

    projects.value = [project, ...projects.value]
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData({
        worldviewEntries: payload.worldviewEntries,
        characters: payload.characters,
        outlineVolumes: payload.outlineVolumes,
        outlineItems: payload.outlineItems,
        chapters: payload.chapters,
        chapterVersions: payload.chapterVersions
      })
    }
    selectedProjectId.value = project.id
    pendingChapterInsertion.value = null
    currentView.value = 'workbench'
    activePanel.value = 'overview'
    syncSelectedChapter(project.id)
    schedulePersist('fast')
  }

  function setTheme(nextTheme: ThemeName): void {
    theme.value = nextTheme
    schedulePersist('fast')
  }

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

  function backToWorkbench(): void {
    currentView.value = 'workbench'
    if (activePanel.value === 'chapters') {
      activePanel.value = lastWorkbenchPanel.value
    }
  }

  function openProject(projectId: string): void {
    const project = projects.value.find((item) => item.id === projectId)
    if (!project) {
      return
    }

    ensureProjectWorkspace(projectId)
    selectedProjectId.value = projectId
    pendingChapterInsertion.value = null
    currentView.value = 'workbench'
    activePanel.value = 'world'
    lastWorkbenchPanel.value = 'world'
    syncSelectedChapter(projectId)
    schedulePersist('fast')
  }

  function backToProjects(): void {
    currentView.value = 'projects'
  }

  function openWizard(): void {
    currentView.value = 'wizard'
  }

  function closeWizard(): void {
    currentView.value = 'projects'
  }

  function createProjectWorkspace(payload: ProjectWorkspacePayload): void {
    const projectId = `project-${Date.now()}`
    const nextVolumes = payload.outlineVolumes?.length ? payload.outlineVolumes : [createWorkspaceVolume()]
    const nextChapters = payload.chapters?.length ? payload.chapters : [buildStarterChapter(nextVolumes[0].id)]

    projects.value.unshift({
      id: projectId,
      title: payload.project.title,
      genre: payload.project.genre,
      wordCount: payload.project.wordCount,
      lastEdited: '刚刚创建',
      cover: payload.project.cover || 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)'
    })

    // A new project gets its own isolated workspace instead of reusing the previous project's draft state.
    projectWorkspaces.value = {
      ...projectWorkspaces.value,
      [projectId]: normalizeProjectWorkspaceData({
        worldviewEntries: payload.worldviewEntries,
        characters: payload.characters,
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
    activePanel.value = payload.worldviewEntries?.length || payload.outlineItems?.length ? 'overview' : 'chapters'
    syncSelectedChapter(projectId)
    schedulePersist('fast')
  }

  function createProject(payload: { title: string; genre: string; wordCount: string }): void {
    const starterVolume = createWorkspaceVolume()
    createProjectWorkspace({
      project: payload,
      outlineVolumes: [starterVolume],
      chapters: [buildStarterChapter(starterVolume.id)]
    })
  }

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

  function updateProject(projectId: string, payload: Partial<ProjectSummary>): void {
    projects.value = projects.value.map((project) =>
      project.id === projectId
        ? {
            ...project,
            title: payload.title?.trim() || project.title,
            genre: payload.genre?.trim() || project.genre,
            wordCount: payload.wordCount?.trim() || project.wordCount,
            lastEdited: payload.lastEdited?.trim() || '刚刚更新',
            cover: payload.cover || project.cover
          }
        : project
    )
    schedulePersist('fast')
  }

  function createWorldviewEntry(payload?: Partial<WorldviewEntry>): void {
    const createdAt = toIsoTimestamp(payload?.createdAt)
    const updatedAt = toIsoTimestamp(payload?.updatedAt || payload?.createdAt)

    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      worldviewEntries: reindexWorldviewEntries([
        {
          id: `world-${Date.now()}`,
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

  function createCharacter(payload?: Partial<CharacterCard>): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: [
        {
          id: `char-${Date.now()}`,
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

  function deleteCharacter(characterId: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      characters: workspace.characters.filter((character) => character.id !== characterId)
    }))
    schedulePersist('fast')
  }

  function createOutlineVolume(payload?: Partial<OutlineVolume>): string {
    const nextVolume = createWorkspaceVolume({
      id: `volume-${Date.now()}`,
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

  function setPanel(panel: PanelName): void {
    if (panel === 'chapters') {
      openChapterStudio()
      return
    }

    lastWorkbenchPanel.value = panel
    activePanel.value = panel
    currentView.value = 'workbench'
  }

  function selectChapter(chapterId: string): void {
    selectedChapterId.value = chapterId
    pendingChapterInsertion.value = null
    currentChapterSelection.value = null
    activePanel.value = 'chapters'
    currentView.value = 'chapter-studio'
  }

  function createChapter(volumeId = selectedChapter.value?.volumeId): void {
    let nextChapterId = ''
    updateCurrentWorkspace((workspace) => {
      const targetVolumeId = volumeId || getWorkspacePrimaryVolumeId(workspace)
      const nextIndex = getChapterSequenceInVolume(workspace.chapters, targetVolumeId)
      const nextChapter: ChapterDraft = {
        id: `chapter-${Date.now()}`,
        volumeId: targetVolumeId,
        title: `第${nextIndex}章：新章节`,
        summary: '待补充章节摘要',
        status: 'draft',
        wordTarget: '预估 3000字',
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

  function createChapterFromOutlineItem(item: Pick<OutlineItem, 'volumeId' | 'title' | 'summary' | 'wordTarget'>): void {
    let nextChapterId = ''
    updateCurrentWorkspace((workspace) => {
      const targetVolumeId = item.volumeId || getWorkspacePrimaryVolumeId(workspace)
      const nextChapter: ChapterDraft = {
        id: `chapter-${Date.now()}`,
        volumeId: targetVolumeId,
        title: item.title?.trim() || '新章节',
        summary: item.summary?.trim() || '待补充章节摘要',
        status: 'draft',
        wordTarget: item.wordTarget?.trim() || '预估 3000字',
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

  function createOutlineItem(payload?: Partial<OutlineItem>): void {
    updateCurrentWorkspace((workspace) => {
      const targetVolumeId = payload?.volumeId || selectedChapter.value?.volumeId || getWorkspacePrimaryVolumeId(workspace)
      const nextIndex = getOutlineSequenceInVolume(workspace.outlineItems, targetVolumeId)
      const nextItem: OutlineItem = {
        id: `outline-${Date.now()}`,
        volumeId: targetVolumeId,
        title: payload?.title?.trim() || `第${nextIndex}章：新剧情节点`,
        wordTarget: payload?.wordTarget?.trim() || '预估 3000字',
        conflict: payload?.conflict?.trim() || '新的冲突正在酝酿。',
        summary:
          payload?.summary?.trim() ||
          '这里是新的剧情大纲节点草稿，可以继续补充剧情推进、角色目标和关键转折。',
        sortOrder: payload?.sortOrder ?? workspace.outlineItems.length
      }

      return {
        ...workspace,
        outlineItems: reindexOutlineItems(insertIntoVolumeSection(workspace.outlineItems, nextItem))
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
        summary: payload.summary?.trim() || currentItem.summary
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
              volumeId: payload.volumeId || chapter.volumeId,
              title: payload.title?.trim() || chapter.title,
              summary: payload.summary !== undefined ? payload.summary.trim() || chapter.summary : chapter.summary,
              status: payload.status ?? chapter.status,
              wordTarget:
                payload.wordTarget !== undefined ? payload.wordTarget.trim() || chapter.wordTarget : chapter.wordTarget,
              content: payload.content !== undefined ? payload.content : chapter.content
            })
          : chapter
      )
    }))
  }

  function getChapterVersions(chapterId: string): ChapterVersion[] {
    return chapterVersions.value
      .filter((version) => version.chapterId === chapterId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async function saveCurrentChapterVersion(): Promise<{ success: boolean; version?: ChapterVersion; error?: string }> {
    const chapter = selectedChapter.value
    if (!chapter) {
      return {
        success: false,
        error: '当前没有可保存的章节。'
      }
    }

    const version = normalizeChapterVersion({
      id: `chapter-version-${Date.now()}`,
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

  function queueAssistantPrompt(prompt: string, quickAction?: string): void {
    const request = {
      id: `assistant-${Date.now()}`,
      prompt,
      quickAction
    }

    if (isAssistantWindow) {
      pendingAssistantRequest.value = request
      return
    }

    aiVisible.value = true
    void openAssistantWindow()
    void window.characterArc.publishAssistantPrompt(request)
  }

  function consumeAssistantPrompt(requestId: string): void {
    if (pendingAssistantRequest.value?.id === requestId) {
      pendingAssistantRequest.value = null
    }

    if (isAssistantWindow) {
      void window.characterArc.clearAssistantPrompt(requestId)
    }
  }

  function updateAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    appSettings.value[key] = value
    schedulePersist('fast')
  }

  function pushUserMessage(content: string): void {
    updateCurrentWorkspace((workspace) => ({
      ...workspace,
      messages: [
        ...workspace.messages,
        {
          id: `msg-${Date.now()}`,
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
          id: `msg-${Date.now()}-assistant`,
          role: 'assistant',
          content
        }
      ]
    }))
    schedulePersist('fast')
  }

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
      id: `insert-${Date.now()}`,
      chapterId: chapter.id,
      content: insertion,
      mode
    }
    return true
  }

  function consumeChapterInsertion(requestId: string): void {
    if (pendingChapterInsertion.value?.id === requestId) {
      pendingChapterInsertion.value = null
    }
  }

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

  window.characterArc.onWorkspaceSync(handleRemoteWorkspaceSync)
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

  watch(
    () => selectedChapterId.value,
    () => {
      currentChapterSelection.value = null
    }
  )

  watch(
    () => appSettings.value.autoSaveInterval,
    () => {
      if (isPersistencePending.value) {
        schedulePersist('fast')
      }
    }
  )

  watch(
    [() => selectedProjectId.value, () => selectedChapterId.value, () => currentChapterSelection.value],
    () => {
      publishAssistantContext()
    },
    { deep: true }
  )

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
    aiVisible,
    appSettings,
    backToProjects,
    backToWorkbench,
    chapterVersions,
    chapters,
    characters,
    closeWizard,
    createProject,
    createProjectWorkspace,
    createCharacter,
    createOutlineItem,
    createOutlineVolume,
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
    deleteOutlineItem,
    deleteProject,
    deleteWorldviewEntry,
    insertIntoChapter,
    importProjectData,
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
    outlineVolumeGroups,
    outlineVolumes,
    pendingAssistantRequest,
    pendingChapterInsertion,
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
    updateChapter,
    updateChapterContent,
    updateChapterSelection,
    updateChapterSummary,
    updateChapterTitle,
    updateCharacter,
    updateOutlineItem,
    updateOutlineVolume,
    updateWorldviewEntry,
    worldviewEntries,
    persistenceError
  }
})
