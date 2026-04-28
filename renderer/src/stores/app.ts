import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { getThemePreset } from '@/theme/presets'
import type {
  AssistantPromptRequest,
  AppSettings,
  ChapterDraft,
  ChapterVersion,
  ChatMessage,
  CharacterCard,
  OutlineItem,
  PanelName,
  ProjectSummary,
  ThemeName,
  WorldviewEntry
} from '@/types/app'

interface StoredState {
  theme: ThemeName
  selectedProjectId: string
  projects: ProjectSummary[]
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  outlineItems: OutlineItem[]
  chapters: ChapterDraft[]
  chapterVersions: ChapterVersion[]
  appSettings: AppSettings
}

const defaultProjects: ProjectSummary[] = [
  {
    id: 'project-1',
    title: '赛博飞升指南',
    genre: '科幻 / 赛博朋克',
    wordCount: '12.5万字',
    lastEdited: '10分钟前编辑',
    cover: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)'
  }
]

const defaultWorldview: WorldviewEntry[] = [
  {
    id: 'world-1',
    type: '地理',
    title: '时代背景',
    content:
      '2077年，第四次企业战争结束后，全球能源被三大寡头公司垄断。下层阶级只能生存在终日下着酸雨的贫民窟，依靠走私二手义体和黑市芯片维持生活。意识上传技术初现端倪，被称为“赛博飞升”。'
  },
  {
    id: 'world-2',
    type: '法则',
    title: '核心规则：义体排异',
    content:
      '过度植入机械义体会导致神经系统崩溃，引发赛博精神病。唯一能延缓排异反应的药物“神经阻断剂”被公司严格控制，成为比货币更硬通的资源。'
  },
  {
    id: 'world-3',
    type: '物种',
    title: '地理环境：夜城（Night City）',
    content:
      '建在填海造陆上的超级都市，分为上层的云端区和底层的霓虹区。云端区拥有人造阳光，霓虹区则充满全息广告、酸雨和九龙城寨式建筑群。'
  }
]

const defaultCharacters: CharacterCard[] = [
  {
    id: 'char-1',
    name: '李雷',
    role: '男主',
    avatar: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
    description:
      '常年在底层的义体回收站工作，性格谨慎冷漠，但内心存有底线。右臂是拼装的二手军用义体，隐藏着某种未知的黑客后门。',
    tags: [
      { label: '底层回收者' },
      { label: '机械右臂', tone: 'danger' }
    ]
  },
  {
    id: 'char-2',
    name: '艾达',
    role: 'Ada',
    avatar: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
    description:
      '荒坂科技前高级研究员，脑内植入了极其危险的记忆锁，掌握着意识上传的核心代码，目前正被全城通缉。',
    tags: [
      { label: '公司叛逃者' },
      { label: '携带机密', tone: 'success' }
    ]
  },
  {
    id: 'char-3',
    name: '“老鬼”',
    role: '',
    avatar: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    description:
      '经营着一家地下诊所，为帮派分子和边缘人提供廉价手术和阻断剂。他是李雷为数不多可以信任的熟人。',
    tags: [
      { label: '黑市医生' },
      { label: '中立', tone: 'warning' }
    ]
  }
]

const defaultOutline: OutlineItem[] = [
  {
    id: 'outline-1',
    title: '第1章：义体回收站的雨夜',
    wordTarget: '3000字',
    conflict: '平凡生活被打破。',
    summary:
      '李雷在回收站关门时，救下了头部受重伤且被追杀的公司女高管艾达。发现她脑内的军用级接口，李雷面临交出她还是藏匿她的抉择。'
  },
  {
    id: 'outline-2',
    title: '第2章：走私芯片',
    wordTarget: '预估 3000字',
    conflict: '公司杀手搜查贫民窟。',
    summary:
      '李雷利用回收站的铅板密室躲避了第一波搜查，并请老鬼来为艾达稳定伤情。老鬼警告李雷惹上了大麻烦。'
  }
]

const defaultChapters: ChapterDraft[] = [
  {
    id: 'chapter-1',
    title: '第1章：义体回收站的雨夜',
    summary: '李雷在雨夜的义体回收站救下被追杀的艾达，平静生活由此被撕开缺口。',
    status: 'draft',
    wordTarget: '预估 3000字',
    content:
      '酸雨敲打在波纹铁皮屋顶上，发出令人烦躁的白噪音。\n\n李雷靠在生锈的工作台旁，机械右臂发出轻微的伺服电机嗡嗡声。今天晚上的收获糟透了，只有几个劣质的神经插槽，还有一条已经被格式化得干干净净的二手脊柱。\n\n就在他准备拉下卷帘门的时候，巷子尽头传来了一阵急促的脚步声。\n\n“救命……” 一个穿着高档公司制服的女人倒在了水洼里，她的后脑勺上，一个军用级的数据接口正在往外冒着蓝色的电火花。'
  },
  {
    id: 'chapter-2',
    title: '第2章：走私芯片',
    summary: '李雷藏起艾达并请老鬼救治，同时躲避公司杀手对贫民窟的搜查。',
    status: 'review',
    wordTarget: '预估 3000字',
    content: ''
  },
  {
    id: 'chapter-3',
    title: '第3章：公司狗的觉醒',
    summary: '李雷逐步意识到艾达带来的秘密不只是麻烦，也可能改变整座夜城。',
    status: 'draft',
    wordTarget: '预估 3200字',
    content: ''
  }
]

const initialMessages: ChatMessage[] = [
  {
    id: 'msg-1',
    role: 'assistant',
    content: '我是你的创作助理。已读取世界观和当前章节内容。需要我帮你润色段落，或者提供剧情建议吗？'
  }
]

const defaultAppSettings: AppSettings = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: 'sk-1234567890abcdef',
  baseUrl: 'https://api.deepseek.com/v1',
  autoSaveInterval: '5m'
}

function loadStoredState(): StoredState {
  return {
    theme: 'ocean',
    selectedProjectId: defaultProjects[0].id,
    projects: defaultProjects,
    worldviewEntries: defaultWorldview,
    characters: defaultCharacters,
    outlineItems: defaultOutline,
    chapters: defaultChapters,
    chapterVersions: [],
    appSettings: defaultAppSettings
  }
}

function normalizeChapterDraft(chapter: ChapterDraft): ChapterDraft {
  return {
    ...chapter,
    summary: chapter.summary?.trim() || '待补充章节摘要',
    status: chapter.status ?? 'draft',
    wordTarget: chapter.wordTarget?.trim() || '预估 3000字'
  }
}

function normalizeChapterVersion(version: ChapterVersion): ChapterVersion {
  return {
    ...version,
    summary: version.summary?.trim() || '待补充章节摘要',
    status: version.status ?? 'draft',
    wordTarget: version.wordTarget?.trim() || '预估 3000字',
    createdAt: version.createdAt || new Date().toISOString()
  }
}

export const useAppStore = defineStore('app', () => {
  const stored = loadStoredState()
  const hasHydrated = ref(false)
  const persistenceError = ref<string | null>(null)
  let saveTimer: number | null = null
  const currentView = ref<'projects' | 'wizard' | 'workbench'>('projects')
  const activePanel = ref<PanelName>('world')
  const aiVisible = ref(true)
  const theme = ref<ThemeName>(stored.theme)
  const selectedProjectId = ref(stored.selectedProjectId)
  const projects = ref<ProjectSummary[]>(stored.projects)
  const worldviewEntries = ref<WorldviewEntry[]>(stored.worldviewEntries)
  const characters = ref<CharacterCard[]>(stored.characters)
  const outlineItems = ref<OutlineItem[]>(stored.outlineItems)
  const chapters = ref<ChapterDraft[]>(stored.chapters)
  const chapterVersions = ref<ChapterVersion[]>(stored.chapterVersions)
  const appSettings = ref<AppSettings>(stored.appSettings)
  const messages = ref<ChatMessage[]>(initialMessages)
  const pendingAssistantRequest = ref<AssistantPromptRequest | null>(null)
  const chapterSelection = ref<{ start: number; end: number } | null>(null)
  const selectedChapterId = ref((stored.chapters[0] ?? defaultChapters[0]).id)

  const selectedChapter = computed(
    () => chapters.value.find((chapter) => chapter.id === selectedChapterId.value) ?? chapters.value[0]
  )
  const currentTheme = computed(() => getThemePreset(theme.value))
  const currentProject = computed(
    () => projects.value.find((project) => project.id === selectedProjectId.value) ?? projects.value[0]
  )

  function applyWorkspaceState(payload?: Partial<StoredState> | null): void {
    if (!payload) {
      return
    }

    theme.value = payload.theme ?? 'ocean'
    projects.value = payload.projects?.length ? payload.projects : defaultProjects
    selectedProjectId.value = payload.selectedProjectId ?? projects.value[0].id
    worldviewEntries.value = payload.worldviewEntries?.length ? payload.worldviewEntries : defaultWorldview
    characters.value = payload.characters?.length ? payload.characters : defaultCharacters
    outlineItems.value = payload.outlineItems?.length ? payload.outlineItems : defaultOutline
    chapters.value = (payload.chapters?.length ? payload.chapters : defaultChapters).map(normalizeChapterDraft)
    chapterVersions.value = (payload.chapterVersions ?? []).map(normalizeChapterVersion)
    appSettings.value = payload.appSettings ?? defaultAppSettings
    selectedChapterId.value = chapters.value[0].id
  }

  function serializeWorkspaceState(): StoredState {
    return {
      theme: theme.value,
      selectedProjectId: selectedProjectId.value,
      projects: projects.value,
      worldviewEntries: worldviewEntries.value,
      characters: characters.value,
      outlineItems: outlineItems.value,
      chapters: chapters.value,
      chapterVersions: chapterVersions.value,
      appSettings: appSettings.value
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
    hasHydrated.value = true
  }

  async function persistWorkspace(): Promise<void> {
    const result = await window.characterArc.saveWorkspace(serializeWorkspaceState())
    persistenceError.value = result.success ? null : result.error ?? '保存失败'
  }

  function importProjectData(payload: {
    project?: Partial<ProjectSummary>
    worldviewEntries?: WorldviewEntry[]
    characters?: CharacterCard[]
    outlineItems?: OutlineItem[]
    chapters?: ChapterDraft[]
    chapterVersions?: ChapterVersion[]
  }): void {
    const nextProjectId = `project-${Date.now()}`
    const project: ProjectSummary = {
      id: nextProjectId,
      title: payload.project?.title?.trim() || '导入项目',
      genre: payload.project?.genre?.trim() || '未分类',
      wordCount: payload.project?.wordCount?.trim() || '已导入',
      lastEdited: '刚刚导入',
      cover: payload.project?.cover || 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)'
    }

    // Import replaces the active project workspace content so the result is predictable and easy to verify.
    projects.value = [project, ...projects.value.filter((item) => item.id !== selectedProjectId.value)]
    selectedProjectId.value = project.id
    worldviewEntries.value = payload.worldviewEntries?.length ? payload.worldviewEntries : defaultWorldview
    characters.value = payload.characters?.length ? payload.characters : defaultCharacters
    outlineItems.value = payload.outlineItems?.length ? payload.outlineItems : defaultOutline
    chapters.value = (payload.chapters?.length ? payload.chapters : defaultChapters).map(normalizeChapterDraft)
    chapterVersions.value = (payload.chapterVersions ?? []).map(normalizeChapterVersion)
    selectedChapterId.value = chapters.value[0].id
    currentView.value = 'workbench'
    activePanel.value = 'overview'
  }

  function setTheme(nextTheme: ThemeName): void {
    theme.value = nextTheme
  }

  function openProject(projectId: string): void {
    const project = projects.value.find((item) => item.id === projectId)
    if (!project) {
      return
    }

    selectedProjectId.value = projectId
    currentView.value = 'workbench'
    activePanel.value = 'world'
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

  function createProject(payload: { title: string; genre: string; wordCount: string }): void {
    projects.value.unshift({
      id: `project-${Date.now()}`,
      title: payload.title,
      genre: payload.genre,
      wordCount: payload.wordCount,
      lastEdited: '刚刚创建',
      cover: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)'
    })

    selectedProjectId.value = projects.value[0].id
    currentView.value = 'workbench'
    activePanel.value = 'world'
  }

  function deleteProject(projectId: string): void {
    if (projects.value.length <= 1) {
      return
    }

    projects.value = projects.value.filter((project) => project.id !== projectId)

    if (selectedProjectId.value === projectId) {
      selectedProjectId.value = projects.value[0].id
      currentView.value = 'projects'
    }
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
  }

  function createWorldviewEntry(payload?: Partial<WorldviewEntry>): void {
    worldviewEntries.value.unshift({
      id: `world-${Date.now()}`,
      type: payload?.type?.trim() || '地理',
      title: payload?.title?.trim() || `新设定条目 ${worldviewEntries.value.length + 1}`,
      content:
        payload?.content?.trim() ||
        '这里是新的世界观设定草稿。你可以继续补充时代背景、法则机制或地理环境细节。'
    })
  }

  function updateWorldviewEntry(entryId: string, payload: Partial<WorldviewEntry>): void {
    worldviewEntries.value = worldviewEntries.value.map((entry) =>
      entry.id === entryId
        ? {
            ...entry,
            type: payload.type?.trim() || entry.type,
            title: payload.title?.trim() || entry.title,
            content: payload.content?.trim() || entry.content
          }
        : entry
    )
  }

  function deleteWorldviewEntry(entryId: string): void {
    worldviewEntries.value = worldviewEntries.value.filter((entry) => entry.id !== entryId)
  }

  function createCharacter(payload?: Partial<CharacterCard>): void {
    characters.value.unshift({
      id: `char-${Date.now()}`,
      name: payload?.name?.trim() || `新角色 ${characters.value.length + 1}`,
      role: payload?.role?.trim() || '待设定',
      avatar: payload?.avatar || 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)',
      description:
        payload?.description?.trim() ||
        '这是一名新加入项目的角色草稿。你可以继续补充身份、背景、动机与冲突。',
      tags:
        payload?.tags?.length
          ? payload.tags
          : [{ label: '待完善', tone: 'warning' }]
    })
  }

  function updateCharacter(characterId: string, payload: Partial<CharacterCard>): void {
    characters.value = characters.value.map((character) =>
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
  }

  function deleteCharacter(characterId: string): void {
    characters.value = characters.value.filter((character) => character.id !== characterId)
  }

  function setPanel(panel: PanelName): void {
    activePanel.value = panel
  }

  function selectChapter(chapterId: string): void {
    selectedChapterId.value = chapterId
    chapterSelection.value = null
    activePanel.value = 'chapters'
  }

  function createChapter(): void {
    const nextIndex = chapters.value.length + 1
    const newChapter: ChapterDraft = {
      id: `chapter-${Date.now()}`,
      title: `第${nextIndex}章：新章节`,
      summary: '待补充章节摘要',
      status: 'draft',
      wordTarget: '预估 3000字',
      content: ''
    }

    chapters.value.push(newChapter)
    selectedChapterId.value = newChapter.id
    chapterSelection.value = null
    activePanel.value = 'chapters'
  }

  function moveChapter(chapterId: string, targetChapterId: string): void {
    const sourceIndex = chapters.value.findIndex((chapter) => chapter.id === chapterId)
    const targetIndex = chapters.value.findIndex((chapter) => chapter.id === targetChapterId)

    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
      return
    }

    const nextChapters = [...chapters.value]
    const [movedChapter] = nextChapters.splice(sourceIndex, 1)
    nextChapters.splice(targetIndex, 0, movedChapter)
    chapters.value = nextChapters
  }

  function createOutlineItem(payload?: Partial<OutlineItem>): void {
    outlineItems.value.push({
      id: `outline-${Date.now()}`,
      title: payload?.title?.trim() || `第${outlineItems.value.length + 1}章：新剧情节点`,
      wordTarget: payload?.wordTarget?.trim() || '预估 3000字',
      conflict: payload?.conflict?.trim() || '新的冲突正在酝酿。',
      summary:
        payload?.summary?.trim() ||
        '这里是新的剧情大纲节点草稿，可以继续补充剧情推进、角色目标和关键转折。',
    })
  }

  function updateOutlineItem(outlineId: string, payload: Partial<OutlineItem>): void {
    outlineItems.value = outlineItems.value.map((item) =>
      item.id === outlineId
        ? {
            ...item,
            title: payload.title?.trim() || item.title,
            wordTarget: payload.wordTarget?.trim() || item.wordTarget,
            conflict: payload.conflict?.trim() || item.conflict,
            summary: payload.summary?.trim() || item.summary
          }
        : item
    )
  }

  function deleteOutlineItem(outlineId: string): void {
    outlineItems.value = outlineItems.value.filter((item) => item.id !== outlineId)
  }

  function deleteChapter(chapterId: string): void {
    if (chapters.value.length <= 1) {
      return
    }

    const targetIndex = chapters.value.findIndex((chapter) => chapter.id === chapterId)
    if (targetIndex === -1) {
      return
    }

    chapters.value = chapters.value.filter((chapter) => chapter.id !== chapterId)
    chapterVersions.value = chapterVersions.value.filter((version) => version.chapterId !== chapterId)

    if (selectedChapterId.value === chapterId) {
      const fallback = chapters.value[Math.max(0, targetIndex - 1)] ?? chapters.value[0]
      selectedChapterId.value = fallback.id
      chapterSelection.value = null
    }
  }

  function updateChapterTitle(value: string): void {
    const chapter = selectedChapter.value
    if (!chapter) {
      return
    }

    chapter.title = value
  }

  function updateChapterContent(value: string): void {
    const chapter = selectedChapter.value
    if (!chapter) {
      return
    }

    chapter.content = value
  }

  function updateChapter(chapterId: string, payload: Partial<ChapterDraft>): void {
    chapters.value = chapters.value.map((chapter) =>
      chapter.id === chapterId
        ? normalizeChapterDraft({
            ...chapter,
            title: payload.title?.trim() || chapter.title,
            summary: payload.summary !== undefined ? payload.summary.trim() || chapter.summary : chapter.summary,
            status: payload.status ?? chapter.status,
            wordTarget:
              payload.wordTarget !== undefined ? payload.wordTarget.trim() || chapter.wordTarget : chapter.wordTarget,
            content: payload.content !== undefined ? payload.content : chapter.content
          })
        : chapter
    )
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

    chapterVersions.value = [version, ...chapterVersions.value]

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
    chapterSelection.value = null

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
    aiVisible.value = !aiVisible.value
  }

  function setChapterSelection(start: number, end: number): void {
    chapterSelection.value = {
      start,
      end
    }
  }

  function openAiAssistant(): void {
    aiVisible.value = true
  }

  function queueAssistantPrompt(prompt: string, quickAction?: string): void {
    aiVisible.value = true
    pendingAssistantRequest.value = {
      id: `assistant-${Date.now()}`,
      prompt,
      quickAction
    }
  }

  function consumeAssistantPrompt(requestId: string): void {
    if (pendingAssistantRequest.value?.id === requestId) {
      pendingAssistantRequest.value = null
    }
  }

  function updateAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    appSettings.value[key] = value
  }

  function pushUserMessage(content: string): void {
    messages.value.push({
      id: `msg-${Date.now()}`,
      role: 'user',
      content
    })
  }

  function pushAssistantMessage(content: string): void {
    messages.value.push({
      id: `msg-${Date.now()}-assistant`,
      role: 'assistant',
      content
    })
  }

  function insertIntoChapter(content: string): void {
    const chapter = selectedChapter.value
    if (!chapter) {
      return
    }

    const insertion = content.trim()
    if (!insertion) {
      return
    }

    const selection = chapterSelection.value
    if (!selection) {
      chapter.content = `${chapter.content}\n\n${insertion}`.trim()
      return
    }

    const start = Math.max(0, Math.min(selection.start, chapter.content.length))
    const end = Math.max(start, Math.min(selection.end, chapter.content.length))
    const prefix = chapter.content.slice(0, start)
    const suffix = chapter.content.slice(end)
    chapter.content = `${prefix}${insertion}${suffix}`
    const nextCursor = start + insertion.length
    chapterSelection.value = {
      start: nextCursor,
      end: nextCursor
    }
  }

  watch(
    [theme, selectedProjectId, projects, worldviewEntries, characters, outlineItems, chapters, chapterVersions, appSettings],
    () => {
      if (!hasHydrated.value) {
        return
      }

      // Debounce disk writes so rapid edits don't hammer the file system on every keystroke.
      if (saveTimer) {
        window.clearTimeout(saveTimer)
      }

      saveTimer = window.setTimeout(() => {
        void persistWorkspace()
      }, 250)
    },
    { deep: true, immediate: true }
  )

  return {
    activePanel,
    aiVisible,
    appSettings,
    backToProjects,
    chapterVersions,
    chapters,
    characters,
    closeWizard,
    createProject,
    createCharacter,
    createOutlineItem,
    createWorldviewEntry,
    createChapter,
    currentTheme,
    currentProject,
    currentView,
    hasHydrated,
    initialize,
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
    openAiAssistant,
    openProject,
    openWizard,
    outlineItems,
    pendingAssistantRequest,
    projects,
    pushAssistantMessage,
    pushUserMessage,
    queueAssistantPrompt,
    restoreChapterVersion,
    saveCurrentChapterVersion,
    selectChapter,
    selectedChapter,
    selectedChapterId,
    selectedProjectId,
    setChapterSelection,
    setPanel,
    setTheme,
    theme,
    toggleAi,
    updateAppSetting,
    updateProject,
    updateChapter,
    updateChapterContent,
    updateChapterTitle,
    updateCharacter,
    updateOutlineItem,
    updateWorldviewEntry,
    worldviewEntries,
    persistenceError
  }
})
