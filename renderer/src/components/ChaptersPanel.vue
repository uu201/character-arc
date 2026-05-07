<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ArrowUpRight,
  Bot,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  GripVertical,
  History,
  Lightbulb,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  Plus,
  Save,
  Sparkles,
  Trash2
} from 'lucide-vue-next'
import { NButton, NCheckbox, NDropdown, NForm, NFormItem, NInput, NModal, NSelect, NTag, NTooltip, useDialog, useMessage } from 'naive-ui'
import RichChapterEditor from '@/components/RichChapterEditor.vue'
import { ensureEditorHtmlContent, getChapterCharacterCount, getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { DEFAULT_CHAPTER_WORD_TARGET, formatChapterWordTargetLabel, normalizeChapterWordTarget, parseChapterWordTarget } from '@/features/chapters/wordTarget'
import { pickRelevantInspirationEntries } from '@/features/inspiration/relevance'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { getResolvedChapterAssistantTemplates } from '@/features/ai/chapterAssistantOptions'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { buildChapterAssistantContext, buildChapterFirstDraftContext } from '@/features/ai/chapterAssistantContext'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import type { ChapterDraft, ChapterVersion } from '@/types/app'
import type { DropdownOption, SelectOption } from 'naive-ui'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词
}>()

// AI 批量生成灵感时的返回结构类型
type InspirationPackResult = {
  entries?: Array<{
    type?: string
    title?: string
    content?: string
    tags?: string[]
  }>
}

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))
const saveState = ref<'typing' | 'idle'>('idle') // 输入状态指示：typing 表示用户正在编辑
const editorVisible = ref(false) // 控制章节信息编辑弹窗
const versionHistoryVisible = ref(false) // 控制历史版本弹窗
const chapterDraftModalVisible = ref(false)
const isGeneratingInspiration = ref(false) // AI 生成章节灵感时的加载状态
const isGeneratingOutlineChain = ref(false)
const isGeneratingChapterDraft = ref(false)
const isStoppingChapterDraft = ref(false)
const isGeneratingSummary = ref(false) // AI 自动生成章节摘要时的加载状态
const isDetectingThreads = ref(false) // AI 识别伏笔时的加载状态
const detectedThreads = ref<Array<{ title: string; description: string; tags: string[]; selected: boolean }>>([])
const threadDetectChapterId = ref<string | null>(null)
const threadDetectVisible = ref(false)
const chapterDraftStreamId = ref<string | null>(null)
const chapterDraftStreamingContent = ref('')
const chapterDraftExecutionLabel = ref('')
let removeChapterDraftStreamListener: (() => void) | null = null
const sceneResolveCallback = ref<((text: string) => void) | null>(null)
const sceneRejectCallback = ref<((err: Error) => void) | null>(null)
const readingMode = ref(false) // 是否处于阅读模式
const compactSidebarVisible = ref(false) // 紧凑模式下章节目录抽屉的显示状态
const compactInsightsVisible = ref(false) // 紧凑模式下章节参考抽屉的显示状态
const draggingChapterId = ref<string | null>(null) // 正在拖拽的章节 ID
const dragTargetChapterId = ref<string | null>(null) // 拖拽目标位置的章节 ID
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth) // 当前视口宽度，用于响应式布局判断
// 章节编辑表单
const chapterForm = reactive({
  outlineItemId: '',
  volumeId: '',
  title: '',
  summary: '',
  status: 'draft' as ChapterDraft['status'],
  wordTarget: ''
})
let saveTimer: number | null = null // 输入状态延迟重置的定时器

const chapterStatusOptions: SelectOption[] = [ // 章节状态选项列表
  { label: '草稿中', value: 'draft' },
  { label: '待检查', value: 'review' },
  { label: '待润色', value: 'polish' },
  { label: '已定稿', value: 'final' }
]
const chapterMenuOptions: DropdownOption[] = [ // 章节侧边栏的右键菜单
  { key: 'edit', label: '编辑章节信息' },
  { key: 'detect-threads', label: 'AI 识别伏笔' },
  { key: 'delete', label: '删除章节' }
]
// 分卷选项列表，用于章节信息编辑弹窗中的分卷下拉选择器
const volumeOptions = computed<SelectOption[]>(() =>
    appStore.outlineVolumes.map((volume, index) => ({
      label: formatVolumeLabel(volume, index, 'formal'),
      value: volume.id
    }))
)
const outlineBindingOptions = computed<SelectOption[]>(() => {
  const currentChapterId = appStore.selectedChapter?.id
  const targetVolumeId = chapterForm.volumeId || appStore.selectedChapter?.volumeId || ''

  const baseOptions: SelectOption[] = [
    {
      label: '不绑定大纲节点',
      value: ''
    }
  ]

  const scopedItems = appStore.outlineItems.filter((item) => !targetVolumeId || item.volumeId === targetVolumeId)
  const linkedChapterMap = new Map(
      appStore.chapters
          .filter((chapter) => chapter.outlineItemId)
          .map((chapter) => [chapter.outlineItemId, chapter])
  )

  return [
    ...baseOptions,
    ...scopedItems.map((item) => {
      const linkedChapter = linkedChapterMap.get(item.id)
      const occupiedByOtherChapter = linkedChapter && linkedChapter.id !== currentChapterId
      return {
        label: occupiedByOtherChapter ? `${item.title} · 已绑定到「${linkedChapter.title}」` : item.title,
        value: item.id,
        disabled: Boolean(occupiedByOtherChapter)
      }
    })
  ]
})
// 当前章节的字数统计（基于富文本内容计算）
const currentWordCount = computed(() => getChapterCharacterCount(appStore.selectedChapter?.content ?? ''))
// 当前章节的纯文本内容（用于 AI 上下文和灵感关联）
const currentPlainContent = computed(() => getPlainTextFromEditorContent(appStore.selectedChapter?.content ?? '').trim())
// 当前章节状态的中文标签
const currentChapterStatusLabel = computed(() => {
  const status = appStore.selectedChapter?.status ?? 'draft'
  return chapterStatusOptions.find((option) => option.value === status)?.label ?? '草稿中'
})
// 当前章节状态对应的视觉色调（用于状态标签的颜色）
const currentChapterStatusTone = computed(() => {
  switch (appStore.selectedChapter?.status) {
    case 'final':
      return 'success'
    case 'polish':
      return 'accent'
    case 'review':
      return 'warning'
    default:
      return 'neutral'
  }
})
// 当前章节的历史版本列表
const currentChapterVersions = computed(() =>
    appStore.selectedChapter ? appStore.getChapterVersions(appStore.selectedChapter.id) : []
)
// 当前章节在全书中的序号（从 1 开始）
const selectedChapterIndex = computed(() => {
  const currentId = appStore.selectedChapterId
  const index = appStore.chapters.findIndex((chapter) => chapter.id === currentId)
  return index >= 0 ? index + 1 : 1
})
// 当前章节在所属分卷中的序号（从 1 开始）
const selectedChapterIndexInVolume = computed(() => {
  const selectedVolumeId = appStore.selectedChapter?.volumeId
  if (!selectedVolumeId || !appStore.selectedChapterId) {
    return 1
  }

  const chaptersInVolume = appStore.chapters.filter((chapter) => chapter.volumeId === selectedVolumeId)
  const index = chaptersInVolume.findIndex((chapter) => chapter.id === appStore.selectedChapterId)
  return index >= 0 ? index + 1 : 1
})
// 当前章节所属分卷在所有分卷中的索引
const currentVolumeIndex = computed(() =>
    appStore.outlineVolumes.findIndex((volume) => volume.id === appStore.selectedChapterVolume?.id)
)
// 当前分卷的简短标签（如"卷一"）
const currentVolumeLabel = computed(() => {
  if (!appStore.selectedChapterVolume) {
    return '未分卷'
  }

  return formatVolumeLabel(appStore.selectedChapterVolume, Math.max(currentVolumeIndex.value, 0), 'compact')
})
const currentChapterTitle = computed(() => appStore.selectedChapter?.title || '未命名章节')
const chapterCountLabel = computed(() => `${appStore.chapters.length} 个章节`)
const volumeCountLabel = computed(() => `${appStore.outlineVolumes.length} 个分卷`)
const formatChapterStatusLabel = (status: ChapterDraft['status']) =>
  chapterStatusOptions.find((option) => option.value === status)?.label ?? '草稿中'
const resolveChapterStatusTone = (status: ChapterDraft['status']) => {
  switch (status) {
    case 'final':
      return 'success'
    case 'polish':
      return 'accent'
    case 'review':
      return 'warning'
    default:
      return 'neutral'
  }
}
const resolveChapterStatusNaiveType = (status: ChapterDraft['status']): 'default' | 'warning' | 'info' | 'success' => {
  switch (status) {
    case 'final': return 'success'
    case 'polish': return 'info'
    case 'review': return 'warning'
    default: return 'default'
  }
}
const currentTargetWordCount = computed(() => parseChapterWordTarget(appStore.selectedChapter?.wordTarget))
// 当前章节的写作进度百分比（0-100），无目标字数时为 0
const currentProgressPercent = computed(() => {
  if (!currentTargetWordCount.value) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round((currentWordCount.value / currentTargetWordCount.value) * 100)))
})
// 当前章节摘要文本，为空时显示占位提示
const currentSummaryText = computed(() => appStore.selectedChapter?.summary?.trim() || '未编写此章节的核心定位或摘要。')
const linkedOutlineItem = computed(() => {
  const chapter = appStore.selectedChapter
  if (!chapter) {
    return null
  }

  return (
      appStore.outlineItems.find((item) => item.id === chapter.outlineItemId) ??
      appStore.outlineItems.find((item) => item.title.trim() === chapter.title.trim()) ??
      null
  )
})
const linkedOutlineStatusMeta = computed(() => {
  switch (linkedOutlineItem.value?.status) {
    case 'idea':
      return { label: '点子', tone: 'ghost' }
    case 'drafting':
      return { label: '写作中', tone: 'primary' }
    case 'done':
      return { label: '已完成', tone: 'success' }
    case 'planned':
      return { label: '已规划', tone: 'neutral' }
    default:
      return { label: '未绑定大纲节点', tone: 'ghost' }
  }
})
const canSyncOutlineBack = computed(() => Boolean(linkedOutlineItem.value && appStore.selectedChapter))
const chapterDraftStreamingWordCount = computed(() => chapterDraftStreamingContent.value.trim().length)
const chapterDraftProgressPercent = computed(() => {
  if (!isGeneratingChapterDraft.value) {
    return 0
  }

  if (!chapterDraftStreamingContent.value.trim()) {
    return 12
  }

  const target = Math.max(currentTargetWordCount.value, 1)
  const estimated = Math.round((chapterDraftStreamingWordCount.value / target) * 100)
  return Math.min(95, Math.max(18, estimated))
})
const chapterDraftProgressText = computed(() => {
  if (!isGeneratingChapterDraft.value) {
    return ''
  }

  if (!chapterDraftStreamingContent.value.trim()) {
    return '正在整理大纲、文风和角色关系上下文...'
  }

  return `正在生成初稿，当前约 ${chapterDraftStreamingWordCount.value} 字 / 目标 ${formatChapterWordTargetLabel(currentTargetWordCount.value)}`
})
// 章节灵感的焦点类型：用于 AI 生成灵感时指定方向
const chapterInspirationFocuses = ['场景火花', '剧情转折', '人物动机'] as const
// 从全局灵感池中选取与当前章节最相关的灵感卡片（最多 4 张）
const chapterInspirationEntries = computed(() =>
    pickRelevantInspirationEntries(
        appStore.inspirationEntries,
        {
          title: appStore.selectedChapter?.title,
          summary: appStore.selectedChapter?.summary,
          content: currentPlainContent.value
        },
        4
    )
)
// 保存状态的完整文本描述（用于底部状态栏）
const saveStatusText = computed(() => {
  if (saveState.value === 'typing') {
    return '正在整理草稿...'
  }

  if (appStore.isPersistencePending) {
    return appStore.isLiveAutoSave ? '自动保存排队中...' : `已加入自动保存队列（${appStore.autoSaveIntervalLabel}）`
  }

  return '已保存草稿'
})
// 保存状态的简短文本（用于顶部工具栏）
const saveStatusCompactText = computed(() => {
  if (saveState.value === 'typing') {
    return '整理中'
  }

  if (appStore.isPersistencePending) {
    return appStore.isLiveAutoSave ? '排队保存' : '自动保存中'
  }

  return '已保存'
})
// 响应式断点：视口宽度 <= 1360px 时进入紧凑工作室模式（隐藏侧边栏，使用抽屉替代）
const isCompactStudio = computed(() => viewportWidth.value <= 1360)
// 响应式断点：视口宽度 <= 1180px 时压缩顶部工具栏信息
const isCondensedTopbar = computed(() => viewportWidth.value <= 1180)
const isNarrowStudio = computed(() => viewportWidth.value <= 1040)
const isTinyStudio = computed(() => viewportWidth.value <= 1220)
// 按分卷分组过滤章节列表，搜索时在标题、摘要、状态、字数目标和正文中匹配
const filteredChapterGroups = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() ?? ''
  if (!query) {
    return appStore.chapterVolumeGroups
  }

  return appStore.chapterVolumeGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((chapter) =>
            `${chapter.title} ${chapter.summary} ${chapter.status} ${chapter.wordTarget} ${getPlainTextFromEditorContent(chapter.content)}`
                .toLowerCase()
                .includes(query)
        )
      }))
      .filter((group) => group.items.length > 0)
})
// 可见章节总数（过滤后）
const totalVisibleChapters = computed(() => filteredChapterGroups.value.reduce((count, group) => count + group.items.length, 0))
// 当前章节在全书数组中的索引
const selectedChapterArrayIndex = computed(() => appStore.chapters.findIndex((chapter) => chapter.id === appStore.selectedChapterId))
// 上一章（用于阅读模式翻页和顶部导航）
const previousChapter = computed(() =>
    selectedChapterArrayIndex.value > 0 ? appStore.chapters[selectedChapterArrayIndex.value - 1] : null
)
// 下一章
const nextChapter = computed(() =>
    selectedChapterArrayIndex.value >= 0 && selectedChapterArrayIndex.value < appStore.chapters.length - 1
        ? appStore.chapters[selectedChapterArrayIndex.value + 1]
        : null
)
// 阅读模式下正文的 HTML 内容
const readingContentHtml = computed(() =>
    ensureEditorHtmlContent(appStore.selectedChapter?.content?.trim() ? appStore.selectedChapter.content : '<p>当前章节还没有正文内容。</p>')
)
// 阅读模式下显示的章节字数标签
const readingWordCountLabel = computed(() => `${currentWordCount.value} 字`)
// 阅读模式下显示的进度标签
const readingProgressLabel = computed(() =>
    currentTargetWordCount.value ? `完成度 ${currentProgressPercent.value}%` : '自由字数模式'
)
// 阅读模式下的章节导语（优先使用摘要，否则从正文截取）
const readingLeadText = computed(() => {
  if (appStore.selectedChapter?.summary?.trim()) {
    return appStore.selectedChapter.summary.trim()
  }

  return getChapterPreviewText(appStore.selectedChapter?.content ?? '', '这一章还没有写下摘要，可以先从成稿阅读中检查节奏。').slice(0, 120)
})
const chapterQuickActions = computed(() => getResolvedChapterAssistantTemplates(appStore.currentProject))
const hasChapterSelection = computed(() =>
  Boolean(
    appStore.currentChapterSelection?.chapterId === appStore.selectedChapter?.id
    && appStore.currentChapterSelection.text.trim()
  )
)

// 切换阅读模式，同时关闭所有抽屉
function toggleReadingMode(): void {
  compactSidebarVisible.value = false
  compactInsightsVisible.value = false
  readingMode.value = !readingMode.value
}

// 同步视口宽度到响应式状态，用于判断是否进入紧凑模式
function syncViewportWidth(): void {
  viewportWidth.value = window.innerWidth
}

// 打开紧凑模式的章节目录抽屉（同时关闭参考抽屉）
function openCompactSidebar(): void {
  compactInsightsVisible.value = false
  compactSidebarVisible.value = true
}

// 打开紧凑模式的章节参考抽屉（同时关闭目录抽屉）
function openCompactInsights(): void {
  compactSidebarVisible.value = false
  compactInsightsVisible.value = true
}

// 在紧凑模式下选择章节并关闭抽屉
function selectChapterFromCompact(chapterId: string): void {
  appStore.selectChapter(chapterId)
  compactSidebarVisible.value = false
}

// 切换到上一章或下一章（offset: -1 为上一章，1 为下一章）
function openAdjacentChapter(offset: -1 | 1): void {
  const target = offset < 0 ? previousChapter.value : nextChapter.value
  if (!target) {
    return
  }

  appStore.selectChapter(target.id)
}

// 手动保存当前章节的历史版本快照
async function saveCurrentVersion(): Promise<void> {
  const result = await appStore.saveCurrentChapterVersion()
  if (!result.success) {
    message.error(result.error ?? '章节版本保存失败')
    return
  }

  message.success('已生成当前章节的历史版本快照')
}

// 打开历史版本弹窗
function openVersionHistory(): void {
  versionHistoryVisible.value = true
}

// 跳转到灵感模块工作台
function openInspirationWorkbench(): void {
  compactInsightsVisible.value = false
  appStore.setPanel('inspiration')
}

async function queueChapterAssistantQuickAction(actionId: string): Promise<void> {
  const action = chapterQuickActions.value.find((item) => item.id === actionId)
  if (!action) {
    message.warning('当前快捷动作不可用')
    return
  }

  if (action.requiresSelection && !hasChapterSelection.value) {
    message.warning('请先在正文中选中要处理的段落')
    return
  }

  if (action.id === 'humanize-ai') {
    const selectedText = appStore.currentChapterSelection?.text.trim() || ''
    if (!selectedText || !appStore.selectedChapter) {
      message.warning('请先在正文中选中要处理的段落')
      return
    }

    try {
      const projectSkills = await loadEnabledProjectSkillsContext(appStore.currentProject, 'draft')
      const assistantContext = buildChapterAssistantContext({
        project: appStore.currentProject,
        chapter: appStore.selectedChapter,
        chapterVolume: appStore.selectedChapterVolume,
        relatedChapters: appStore.chapters
          .filter((item) => item.volumeId === appStore.selectedChapter?.volumeId)
          .filter((item) => item.id !== appStore.selectedChapter?.id)
          .slice(0, 2)
          .map((item) => ({
            title: item.title,
            summary: item.summary,
            preview: getChapterPreviewText(item.content, '该章节暂无正文')
          })),
        volumeChapterSummaries: appStore.chapters
          .filter((item) => item.volumeId === appStore.selectedChapter?.volumeId && item.id !== appStore.selectedChapter?.id)
          .map((item) => ({
            title: item.title,
            summary: item.summary
          })),
        novelOpenerSummary: appStore.chapters[0] && appStore.chapters[0].id !== appStore.selectedChapter.id
          ? { title: appStore.chapters[0].title, summary: appStore.chapters[0].summary }
          : undefined,
        recentMessages: appStore.messages.slice(-4).map((item) => ({ role: item.role, content: item.content })),
        worldviewEntries: appStore.worldviewEntries,
        characters: appStore.characters,
        organizations: appStore.organizations,
        characterRelationships: appStore.characterRelationships,
        organizationMemberships: appStore.organizationMemberships,
        inspirationEntries: appStore.inspirationEntries,
        outlineItems: appStore.outlineItems,
        plotThreads: appStore.plotThreads,
        workflowDocuments: appStore.workflowDocuments,
        knowledgeDocuments: appStore.knowledgeDocuments,
        selectedText,
        responseMode: action.mode,
        responseLength: action.length,
        quickAction: action.label,
        userPrompt: action.prompt,
        chapterContent: getPlainTextFromEditorContent(appStore.selectedChapter.content ?? ''),
        projectSkills
      })
      const response = await window.characterArc.generateAi(toIpcPayload({
        task: 'chapter-assistant',
        settings: appStore.appSettings,
        context: assistantContext
      }))
      const result = (response.result as { result?: { content?: string } } | undefined)?.result
      const revisedContent = String(result?.content ?? '').trim()
      if (!response.success || !revisedContent) {
        throw new Error(response.error ?? 'AI 未返回可用的去 AI 味结果')
      }

      appStore.handleAssistantCommand({
        type: 'insert-into-chapter',
        kind: 'proposal',
        target: 'chapter-content',
        reason: '这会使用去 AI 味结果替换当前选中的正文片段，请确认后再写入。',
        preview: {
          title: '降低AI感润色',
          summary: '准备使用去 AI 味后的文本替换当前选区。',
          before: selectedText.slice(0, 220),
          after: revisedContent.slice(0, 220)
        },
        destructive: true,
        requiresConfirmation: true,
        content: revisedContent,
        mode: 'replace-selection'
      })
      message.success('已生成降低AI感提议，请确认后执行')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '降低AI感失败')
    }
    return
  }

  appStore.queueAssistantPrompt(action.prompt, action.label)
  message.success(`已把「${action.label}」发送到 AI 助手`)
}

// 将灵感卡片发送给 AI 助手进行扩写或续写，根据 mode 生成不同的 prompt
function sendInspirationToAssistant(entry: { type: string; title: string; content: string; tags: string[] }, mode: 'expand' | 'continue' = 'expand'): void {
  const prompt =
      mode === 'continue'
          ? `请基于这张灵感卡片，紧接当前章节正文继续往后写一段，保持当前人物状态、叙事语气和情节连续性。\n\n灵感类型：${entry.type}\n灵感标题：${entry.title}\n灵感内容：${entry.content}\n灵感标签：${entry.tags.join('、') || '暂无'}`
          : `请基于这张灵感卡片，为当前章节补一段可直接使用的桥段、台词、动作或场景描写，优先让它自然落进本章。\n\n灵感类型：${entry.type}\n灵感标题：${entry.title}\n灵感内容：${entry.content}\n灵感标签：${entry.tags.join('、') || '暂无'}`

  appStore.queueAssistantPrompt(prompt, mode === 'continue' ? '灵感续写' : '灵感扩写')
  message.success(mode === 'continue' ? '灵感已发送给 AI 助手继续续写' : '灵感已发送给 AI 助手继续扩写')
}

// 调用 AI 为当前章节生成指定焦点类型（场景火花/剧情转折/人物动机）的灵感卡片
async function requestChapterInspiration(focusType: (typeof chapterInspirationFocuses)[number]): Promise<void> {
  const chapter = appStore.selectedChapter
  if (!chapter) {
    message.warning('当前没有可关联的章节')
    return
  }

  if (isGeneratingInspiration.value) {
    return
  }

  isGeneratingInspiration.value = true

  try {
    const result = await window.characterArc.generateAi(toIpcPayload({
      task: 'inspiration-pack',
      settings: appStore.appSettings,
      context: {
        projectTitle: appStore.currentProject?.title,
        projectGenre: appStore.currentProject?.genre,
        writingStyleLabel: writingStyle.value.label,
        writingStylePrompt: writingStyle.value.prompt,
        chapterTitle: chapter.title,
        chapterSummary: chapter.summary,
        chapterContent: currentPlainContent.value,
        focusType,
        existingInspirationTitles: appStore.inspirationEntries.map((entry) => entry.title),
        worldviewEntries: appStore.worldviewEntries,
        characters: appStore.characters,
        organizations: appStore.organizations,
        characterRelationships: appStore.characterRelationships,
        organizationMemberships: appStore.organizationMemberships,
        outlineItems: appStore.outlineItems
      }
    }))

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '本章灵感生成失败，请检查模型配置')
    }

    const payload = result.result as InspirationPackResult
    const entries = Array.isArray(payload.entries) ? payload.entries : []
    if (!entries.length) {
      throw new Error('AI 没有返回有效灵感卡片')
    }

    entries.forEach((entry, index) => {
      appStore.createInspirationEntry({
        type: entry.type ?? focusType,
        title: entry.title ?? `${focusType} ${index + 1}`,
        content: entry.content ?? 'AI 未返回有效灵感内容',
        tags: entry.tags ?? [],
        source: 'ai'
      })
    })

    message.success(`已为当前章节生成 ${entries.length} 张${focusType}灵感卡`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '本章灵感生成失败，请稍后重试')
  } finally {
    isGeneratingInspiration.value = false
  }
}

// 删除当前章节前弹出二次确认（至少保留一个章节）
function requestDeleteChapter(): void {
  const chapter = appStore.selectedChapter
  if (!chapter || appStore.chapters.length <= 1) {
    return
  }

  dialog.warning({
    title: '确认删除章节',
    content: `确定要删除“${chapter.title}”吗？删除后当前章节草稿将无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteChapter(chapter.id)
    }
  })
}

// 打开章节信息编辑弹窗，将当前章节数据填入表单
function openChapterMetaEditor(chapter?: ChapterDraft | null): void {
  if (!chapter) {
    return
  }

  chapterForm.volumeId = chapter.volumeId
  chapterForm.outlineItemId = chapter.outlineItemId
  chapterForm.title = chapter.title
  chapterForm.summary = chapter.summary
  chapterForm.status = chapter.status
  chapterForm.wordTarget = normalizeChapterWordTarget(chapter.wordTarget)
  editorVisible.value = true
}

function handleChapterWordTargetInput(value: string): void {
  chapterForm.wordTarget = value.replace(/\D/g, '').slice(0, 6)
}

function mapChapterStatusToOutlineStatus(status: ChapterDraft['status']) {
  switch (status) {
    case 'final':
      return 'done' as const
    case 'polish':
    case 'review':
    case 'draft':
    default:
      return 'drafting' as const
  }
}

function syncChapterBackToOutline(): void {
  const chapter = appStore.selectedChapter
  const outline = linkedOutlineItem.value
  if (!chapter || !outline) {
    return
  }

  appStore.updateOutlineItem(outline.id, {
    summary: chapter.summary?.trim() || outline.summary,
    status: mapChapterStatusToOutlineStatus(chapter.status)
  })
  appStore.appendWorkflowDocumentEntry(
      chapter.volumeId,
      'progress',
      `章节回写：${chapter.title}`,
      [
        `- 已将当前章节摘要同步回大纲节点。`,
        `- 章节状态：${currentChapterStatusLabel.value}`,
        `- 关联大纲节点：${outline.title}`
      ].join('\n')
  )
  appStore.appendWorkflowDocumentEntry(
      chapter.volumeId,
      'findings',
      `章节推进结论：${chapter.title}`,
      `- 当前章节已回写到大纲，节点状态调整为：${mapChapterStatusToOutlineStatus(chapter.status)}。`
  )
  message.success('已把当前章节摘要与推进状态同步回大纲节点')
}

function jumpBackToOutline(): void {
  appStore.backToWorkbench()
  appStore.setPanel('outline')
}

async function generateNextOutlineChain(): Promise<void> {
  const chapter = appStore.selectedChapter
  const outline = linkedOutlineItem.value
  const volume = appStore.selectedChapterVolume
  if (!chapter || !outline || !volume) {
    message.warning('当前章节还没有稳定绑定到大纲节点')
    return
  }

  if (isGeneratingOutlineChain.value) {
    return
  }

  isGeneratingOutlineChain.value = true

  try {
    const result = await window.characterArc.generateAi(toIpcPayload({
      task: 'outline-chain',
      settings: appStore.appSettings,
      context: {
        projectTitle: appStore.currentProject?.title,
        projectGenre: appStore.currentProject?.genre,
        writingStyleLabel: writingStyle.value.label,
        writingStylePrompt: writingStyle.value.prompt,
        chapterVolumeTitle: volume.title,
        chapterVolumeSummary: volume.summary,
        chapterTitle: chapter.title,
        chapterSummary: chapter.summary,
        chapterStatus: chapter.status,
        chapterContent: currentPlainContent.value,
        currentOutlineItem: {
          title: outline.title,
          conflict: outline.conflict,
          summary: outline.summary,
          status: outline.status
        },
        currentVolumeOutlineItems: appStore.outlineItems
            .filter((item) => item.volumeId === volume.id)
            .map((item) => ({
              title: item.title,
              conflict: item.conflict,
              summary: item.summary,
              status: item.status
            })),
        worldviewTitles: appStore.worldviewEntries.map((entry) => entry.title),
        characters: appStore.characters.map((character) => ({
          name: character.name,
          role: character.role,
          description: character.description
        })),
        projectSkills: await loadEnabledProjectSkillsContext(appStore.currentProject, 'draft'),
        userPrompt: '请紧接当前章节之后，连续规划下一段剧情链。'
      }
    }))

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '后续剧情链生成失败，请检查模型配置')
    }

    const payload = result.result as {
      entries?: Array<{
        title?: string
        wordTarget?: string
        conflict?: string
        summary?: string
      }>
    }
    const entries = Array.isArray(payload.entries) ? payload.entries : []
    if (!entries.length) {
      throw new Error('AI 没有返回有效的后续剧情链')
    }

    appStore.createOutlineItemsAfter(
        outline.id,
        entries.map((entry) => ({
          volumeId: volume.id,
          title: entry.title,
          wordTarget: entry.wordTarget,
          conflict: entry.conflict,
          summary: entry.summary,
          status: 'planned' as const
        }))
    )
    appStore.appendWorkflowDocumentEntry(
        volume.id,
        'task_plan',
        `后续剧情链：${chapter.title}`,
        [
          `- 已基于当前章节生成 ${entries.length} 个后续剧情节点。`,
          ...entries.map((entry, index) => `- 节点${index + 1}：${entry.title ?? `后续节点 ${index + 1}`}`)
        ].join('\n')
    )
    appStore.appendWorkflowDocumentEntry(
        volume.id,
        'pending_hooks',
        `新剧情链钩子：${chapter.title}`,
        entries.map((entry) => `- ${entry.title ?? '后续节点'}：${entry.conflict ?? '待补充核心冲突'}`).join('\n')
    )
    message.success(`已在当前节点后补充 ${entries.length} 个后续剧情节点`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '后续剧情链生成失败，请稍后重试')
  } finally {
    isGeneratingOutlineChain.value = false
  }
}

async function streamOneScene(sceneContext: Record<string, unknown>, displayAccumulated: string): Promise<string> {
  chapterDraftStreamingContent.value = displayAccumulated ? displayAccumulated + '\n\n' : ''

  const result = await window.characterArc.startAiStream(toIpcPayload({
    task: 'chapter-first-draft',
    settings: appStore.appSettings,
    context: sceneContext
  }))

  const streamId = (result.result as { streamId?: string } | undefined)?.streamId
  if (!result.success || !streamId) {
    throw new Error(result.error ?? 'AI 初稿生成启动失败')
  }

  chapterDraftStreamId.value = streamId

  return new Promise<string>((resolve, reject) => {
    sceneResolveCallback.value = resolve
    sceneRejectCallback.value = reject
  })
}

async function generateChapterFirstDraft(): Promise<void> {
  const chapter = appStore.selectedChapter
  const project = appStore.currentProject
  const chapterVolume = appStore.selectedChapterVolume
  if (!chapter || !project || !chapterVolume) {
    message.warning('当前没有可生成初稿的章节')
    return
  }

  if (isGeneratingChapterDraft.value) {
    return
  }

  isGeneratingChapterDraft.value = true
  isStoppingChapterDraft.value = false
  chapterDraftStreamingContent.value = ''
  chapterDraftExecutionLabel.value = '正在整理本章上下文'
  chapterDraftModalVisible.value = true
  try {
    const targetWordCount = parseChapterWordTarget(chapter.wordTarget)
    const relatedChapters = appStore.chapters
      .filter((item) => item.id !== chapter.id)
      .slice(-4)
      .map((item) => ({
        title: item.title,
        summary: item.summary,
        preview: getChapterPreviewText(item.content, '该章节暂无正文')
      }))

    const relatedTitles = new Set(relatedChapters.map((r) => r.title))
    const volumeChapterSummaries = appStore.chapters
      .filter((c) => c.volumeId === chapter.volumeId && c.id !== chapter.id && !relatedTitles.has(c.title))
      .map((c) => ({ title: c.title, summary: c.summary }))

    const firstChapter = appStore.chapters[0]
    const novelOpenerSummary =
      firstChapter && firstChapter.id !== chapter.id && !relatedTitles.has(firstChapter.title)
        ? { title: firstChapter.title, summary: firstChapter.summary }
        : undefined

    const currentChapterContent = currentPlainContent.value
    const baseContext = buildChapterFirstDraftContext({
      project,
      chapter,
      chapterVolume,
      relatedChapters,
      volumeChapterSummaries,
      novelOpenerSummary,
      worldviewEntries: appStore.worldviewEntries,
      characters: appStore.characters,
      organizations: appStore.organizations,
      characterRelationships: appStore.characterRelationships,
      organizationMemberships: appStore.organizationMemberships,
      inspirationEntries: appStore.inspirationEntries,
      outlineItems: appStore.outlineItems.filter((item) => item.volumeId === chapter.volumeId),
      plotThreads: appStore.plotThreads,
      chapterContent: currentChapterContent,
      targetWordCount,
      userPrompt: `请生成这一章的完整初稿，目标字数约 ${targetWordCount} 字（参考值，优先保证情节自然完整）。如果当前正文为空，就从零起稿；如果当前正文不为空，也按整章重写处理，而不是续写。`,
      projectSkills: await loadEnabledProjectSkillsContext(project, 'draft')
    })

    // 一次性流式：不再做 scene plan + per-scene 循环，让模型按完整章节统一规划场景与节奏
    chapterDraftExecutionLabel.value = `正在生成本章初稿（目标约 ${targetWordCount} 字）…`
    const fullText = await streamOneScene(baseContext, '')

    if (fullText) {
      chapterDraftExecutionLabel.value = '正在覆盖当前章节'
      appStore.updateChapterContent(ensureEditorHtmlContent(fullText))
      message.success(`AI 已覆盖当前章节，目标约 ${formatChapterWordTargetLabel(currentTargetWordCount.value)}`)
    } else {
      message.warning('AI 没有返回可用的初稿内容')
    }
    resetChapterDraftStreamingState()
  } catch (error) {
    const isCanceled = error instanceof Error && error.message === 'canceled'
    if (isCanceled) {
      message.info('已停止 AI 初稿生成，当前章节内容保持不变')
    } else {
      message.error(error instanceof Error ? error.message : 'AI 初稿生成失败')
    }
    chapterDraftStreamingContent.value = ''
    resetChapterDraftStreamingState()
  }
}

async function stopChapterFirstDraft(): Promise<void> {
  if (!chapterDraftStreamId.value || isStoppingChapterDraft.value) {
    return
  }

  isStoppingChapterDraft.value = true
  const result = await window.characterArc.stopAiStream(chapterDraftStreamId.value)
  if (!result.success) {
    isStoppingChapterDraft.value = false
    message.error(result.error ?? '停止 AI 初稿失败')
  }
}

function resetChapterDraftStreamingState(): void {
  chapterDraftStreamId.value = null
  chapterDraftExecutionLabel.value = ''
  isGeneratingChapterDraft.value = false
  isStoppingChapterDraft.value = false
}

async function generateChapterSummary(): Promise<void> {
  const chapter = appStore.selectedChapter
  if (!chapter || isGeneratingSummary.value) return
  const plainContent = getPlainTextFromEditorContent(chapter.content ?? '').trim()
  if (!plainContent) {
    message.warning('当前章节没有正文内容，无法生成摘要')
    return
  }

  isGeneratingSummary.value = true
  try {
    const result = await window.characterArc.generateAi(toIpcPayload({
      task: 'chapter-summarize',
      settings: appStore.appSettings,
      context: {
        chapterTitle: chapter.title,
        chapterContent: plainContent
      }
    }))

    if (!result.success) {
      throw new Error(result.error ?? 'AI 摘要生成失败')
    }

    const summaryText = String(
      result.result && typeof result.result === 'object'
        ? (result.result as Record<string, unknown>).content ?? ''
        : ''
    ).trim()

    if (summaryText) {
      appStore.updateChapter(chapter.id, { summary: summaryText })
      chapterForm.summary = summaryText
      message.success('已生成章节摘要')
    } else {
      message.warning('AI 返回了空摘要，请稍后重试')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 摘要生成失败')
  } finally {
    isGeneratingSummary.value = false
  }
}

function closeChapterDraftModal(): void {
  if (isGeneratingChapterDraft.value) {
    return
  }

  chapterDraftModalVisible.value = false
  chapterDraftStreamingContent.value = ''
}

async function detectPlotThreads(chapter: ChapterDraft): Promise<void> {
  if (isDetectingThreads.value) return

  const plainText = getPlainTextFromEditorContent(chapter.content ?? '').trim()
  if (!plainText) {
    message.warning('章节暂无正文内容，无法识别伏笔')
    return
  }

  isDetectingThreads.value = true
  threadDetectChapterId.value = chapter.id
  const loadingMsg = message.loading('正在分析正文，识别潜在伏笔…', { duration: 0 })

  try {
    const existingThreads = appStore.plotThreads
      .filter((t) => t.status === 'open')
      .map((t) => t.title)

    const result = await window.characterArc.generateAi(toIpcPayload({
      task: 'plot-thread-detect',
      settings: appStore.appSettings,
      context: {
        chapterTitle: chapter.title || '未命名章节',
        chapterContent: plainText.slice(0, 6000),
        existingThreads
      }
    }))

    loadingMsg.destroy()

    if (!result.success) {
      throw new Error(result.error ?? 'AI 识别伏笔失败')
    }

    const entries = Array.isArray(
      (result.result as Record<string, unknown>)?.entries
    )
      ? ((result.result as Record<string, unknown>).entries as Array<Record<string, unknown>>)
      : []

    if (entries.length === 0) {
      message.info('AI 未在本章识别到明确伏笔')
      return
    }

    detectedThreads.value = entries.map((e) => ({
      title: String(e.title ?? '未命名伏笔'),
      description: String(e.description ?? '暂无描述'),
      tags: Array.isArray(e.tags) ? (e.tags as string[]).map(String) : [],
      selected: true
    }))

    threadDetectVisible.value = true
  } catch (error) {
    loadingMsg.destroy()
    message.error(error instanceof Error ? error.message : 'AI 识别伏笔失败，请稍后重试')
    console.error('[detect-threads]', error)
  } finally {
    isDetectingThreads.value = false
  }
}

function confirmAddThreads(): void {
  const chapterId = threadDetectChapterId.value ?? ''
  const toAdd = detectedThreads.value.filter((t) => t.selected)

  if (!toAdd.length) {
    message.warning('请至少选择一条线索')
    return
  }

  toAdd.forEach((t) => {
    appStore.createPlotThread({
      title: t.title,
      description: t.description,
      openedInChapterId: chapterId,
      status: 'open',
      tags: t.tags
    })
  })

  message.success(`已添加 ${toAdd.length} 条剧情线索`)
  threadDetectVisible.value = false
}

function handleChapterDraftStreamEvent(payload: CharacterArcAiStreamEvent): void {
  if (payload.streamId !== chapterDraftStreamId.value) {
    return
  }

  if (payload.type === 'chunk') {
    chapterDraftStreamingContent.value += payload.delta
    return
  }

  if (payload.type === 'done') {
    if (sceneResolveCallback.value) {
      const resolve = sceneResolveCallback.value
      sceneResolveCallback.value = null
      sceneRejectCallback.value = null
      resolve((payload.content ?? '').trim())
      return
    }
    const finalReply = (payload.content ?? chapterDraftStreamingContent.value).trim()
    if (finalReply) {
      chapterDraftExecutionLabel.value = '正在覆盖当前章节'
      appStore.updateChapterContent(ensureEditorHtmlContent(finalReply))
      message.success(`AI 已覆盖当前章节，目标约 ${formatChapterWordTargetLabel(currentTargetWordCount.value)}`)
    } else {
      message.warning('AI 没有返回可用的初稿内容')
    }
    resetChapterDraftStreamingState()
    return
  }

  if (payload.type === 'canceled') {
    if (sceneRejectCallback.value) {
      const reject = sceneRejectCallback.value
      sceneResolveCallback.value = null
      sceneRejectCallback.value = null
      reject(new Error('canceled'))
      return
    }
    message.info('已停止 AI 初稿生成，当前章节内容保持不变')
    resetChapterDraftStreamingState()
    return
  }

  if (payload.type === 'error') {
    if (sceneRejectCallback.value) {
      const reject = sceneRejectCallback.value
      sceneResolveCallback.value = null
      sceneRejectCallback.value = null
      reject(new Error(payload.error || 'AI 初稿生成失败'))
      return
    }
    message.error(payload.error || 'AI 初稿生成失败')
    resetChapterDraftStreamingState()
  }
}

// 格式化版本创建时间为中文简短格式
function formatVersionTime(createdAt: string): string {
  const value = new Date(createdAt)
  if (Number.isNaN(value.getTime())) {
    return '未知时间'
  }

  return value.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 计算历史版本的字数
function getVersionWordCount(version: ChapterVersion): number {
  return getChapterCharacterCount(version.content)
}

// 生成历史版本的正文预览（截取前 120 字符）
function buildVersionPreview(version: ChapterVersion): string {
  return getChapterPreviewText(version.content, '该版本暂无正文内容。').slice(0, 120)
}

// 恢复历史版本：弹出确认后将版本快照内容覆盖当前章节
function restoreVersion(version: ChapterVersion): void {
  dialog.warning({
    title: '恢复历史版本',
    content: `确定恢复 ${formatVersionTime(version.createdAt)} 的章节快照吗？当前草稿内容将被该版本覆盖。`,
    positiveText: '确认恢复',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: async () => {
      const result = await appStore.restoreChapterVersion(version.id)
      if (!result.success) {
        message.error(result.error ?? '历史版本恢复失败')
        return
      }

      versionHistoryVisible.value = false
      message.success('历史版本已恢复到当前章节')
    }
  })
}

// 提交章节信息编辑表单
function submitChapterMeta(): void {
  const chapter = appStore.selectedChapter
  if (!chapter) {
    return
  }

  if (!chapterForm.volumeId) {
    message.warning('请选择所属分卷')
    return
  }

  if (!chapterForm.title.trim()) {
    message.warning('请填写章节标题')
    return
  }

  if (!chapterForm.wordTarget.trim()) {
    chapterForm.wordTarget = DEFAULT_CHAPTER_WORD_TARGET
  }

  appStore.updateChapter(chapter.id, {
    outlineItemId: chapterForm.outlineItemId,
    volumeId: chapterForm.volumeId,
    title: chapterForm.title,
    summary: chapterForm.summary,
    status: chapterForm.status,
    wordTarget: normalizeChapterWordTarget(chapterForm.wordTarget)
  })
  editorVisible.value = false
  message.success('章节信息已更新')
}

// 处理章节侧边栏的下拉菜单操作：编辑章节信息或删除章节
function handleChapterMenuSelect(action: string | number, chapter: ChapterDraft): void {
  if (action === 'edit') {
    openChapterMetaEditor(chapter)
    return
  }

  if (action === 'detect-threads') {
    void detectPlotThreads(chapter)
    return
  }

  dialog.warning({
    title: '确认删除章节',
    content: `确定要删除“${chapter.title}”吗？删除后当前章节草稿将无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteChapter(chapter.id)
    }
  })
}

// --- 章节拖拽排序 ---
// 拖拽开始：记录被拖拽的章节 ID 并设置拖拽数据
function handleDragStart(chapterId: string, event: DragEvent): void {
  draggingChapterId.value = chapterId
  dragTargetChapterId.value = chapterId
  event.dataTransfer?.setData('text/plain', chapterId)
  event.dataTransfer?.setDragImage?.(event.currentTarget as Element, 18, 18)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

// 拖拽经过：更新拖拽目标位置
function handleDragOver(chapterId: string, event: DragEvent): void {
  event.preventDefault()
  dragTargetChapterId.value = chapterId
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

// 拖拽放下：调用 store 执行章节排序
function handleDrop(chapterId: string, event: DragEvent): void {
  event.preventDefault()
  const sourceId = draggingChapterId.value || event.dataTransfer?.getData('text/plain')
  if (!sourceId) {
    return
  }

  // Native drag-and-drop keeps the sidebar light while still covering the chapter reorder use case.
  appStore.moveChapter(sourceId, chapterId)
  dragTargetChapterId.value = null
  draggingChapterId.value = null
}

// 重置拖拽状态
function resetDragState(): void {
  draggingChapterId.value = null
  dragTargetChapterId.value = null
}

// 监听章节标题和内容变化，短暂显示"正在整理草稿"状态后交由自动保存队列接管
watch(
    () => [appStore.selectedChapter?.title, appStore.selectedChapter?.content] as const,
    () => {
      if (!appStore.selectedChapter) {
        return
      }

      saveState.value = 'typing'

      // Keep the typing feedback brief, then hand status messaging over to the real autosave queue state.
      if (saveTimer) {
        window.clearTimeout(saveTimer)
      }

      saveTimer = window.setTimeout(() => {
        saveState.value = 'idle'
      }, 420)
    },
    { deep: true }
)

watch(
    () => [
      editorVisible.value,
      appStore.selectedChapter?.id,
      appStore.selectedChapter?.volumeId,
      appStore.selectedChapter?.outlineItemId,
      appStore.selectedChapter?.title,
      appStore.selectedChapter?.summary,
      appStore.selectedChapter?.status,
      appStore.selectedChapter?.wordTarget
    ] as const,
    () => {
      if (!editorVisible.value || !appStore.selectedChapter) {
        return
      }

      chapterForm.volumeId = appStore.selectedChapter.volumeId
      chapterForm.outlineItemId = appStore.selectedChapter.outlineItemId
      chapterForm.title = appStore.selectedChapter.title
      chapterForm.summary = appStore.selectedChapter.summary
      chapterForm.status = appStore.selectedChapter.status
      chapterForm.wordTarget = normalizeChapterWordTarget(appStore.selectedChapter.wordTarget)
    }
)

watch(isCompactStudio, (compact) => {
  if (!compact) {
    compactSidebarVisible.value = false
    compactInsightsVisible.value = false
  }
})

onMounted(() => {
  syncViewportWidth()
  window.addEventListener('resize', syncViewportWidth)
  removeChapterDraftStreamListener = window.characterArc.onAiStreamEvent(handleChapterDraftStreamEvent)
})

onBeforeUnmount(() => {
  if (chapterDraftStreamId.value) {
    void window.characterArc.stopAiStream(chapterDraftStreamId.value)
  }

  removeChapterDraftStreamListener?.()
  removeChapterDraftStreamListener = null
  window.removeEventListener('resize', syncViewportWidth)
  if (saveTimer) {
    window.clearTimeout(saveTimer)
  }
})
</script>

<template>
  <section class="chapters-layout" :class="{ 'reading-mode': readingMode, 'compact-mode': isCompactStudio && !readingMode, 'narrow-mode': isNarrowStudio && !readingMode, 'tiny-mode': isTinyStudio && !readingMode }">
    <div class="chapters-shell" :class="{ 'reading-mode': readingMode }">
      <aside v-if="!readingMode && !isCompactStudio" class="chapter-sidebar">
        <div class="chapter-side-head">
          <div class="sidebar-head-main">
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button size="small" quaternary class="chapter-back-button" @click="appStore.backToWorkbench()">
                  <template #icon><ChevronLeft :size="15" /></template>
                </n-button>
              </template>
              返回工作台
            </n-tooltip>
            <strong>章节目录</strong>
          </div>
          <span class="chapter-side-badge">{{ totalVisibleChapters }} / {{ appStore.chapters.length }}</span>
        </div>

        <div class="chapter-side-summary">
          <span>{{ chapterCountLabel }}</span>
          <span>{{ volumeCountLabel }}</span>
          <span>当前第 {{ selectedChapterIndex }} 章</span>
        </div>

        <div class="chapter-groups arc-scrollbar">
          <section v-for="group in filteredChapterGroups" :key="group.volume.id" class="chapter-group">
            <div class="chapter-group-head">
              <span class="chapter-group-label">{{ formatVolumeLabel(group.volume, group.index, 'compact') }}</span>
              <n-tooltip trigger="hover">
                <template #trigger>
                  <button class="mini-icon" @click="appStore.createChapter(group.volume.id)">
                    <Plus :size="14" />
                  </button>
                </template>
                在本卷中新增章节
              </n-tooltip>
            </div>

            <div class="chapter-items">
              <button
                  v-for="chapter in group.items"
                  :key="chapter.id"
                  class="chapter-card"
                  :class="{
                  active: appStore.selectedChapterId === chapter.id,
                  dragging: draggingChapterId === chapter.id,
                  'drop-target': dragTargetChapterId === chapter.id && draggingChapterId !== chapter.id
                }"
                  draggable="true"
                  @click="appStore.selectChapter(chapter.id)"
                  @dragstart="handleDragStart(chapter.id, $event)"
                  @dragover="handleDragOver(chapter.id, $event)"
                  @drop="handleDrop(chapter.id, $event)"
                  @dragend="resetDragState"
              >
                <div class="chapter-card-top">
                  <span class="chapter-card-num">第 {{ String(appStore.chapters.findIndex(c => c.id === chapter.id) + 1).padStart(3, '0') }} 章</span>
                  <n-dropdown :options="chapterMenuOptions" placement="bottom-end" @select="(key) => handleChapterMenuSelect(key, chapter)">
                    <span class="chapter-card-action" @click.stop>
                      <MoreVertical :size="13" />
                    </span>
                  </n-dropdown>
                </div>
                <div class="chapter-card-title">{{ chapter.title }}</div>
                <div class="chapter-card-footer">
                  <span class="chapter-card-words">{{ getChapterCharacterCount(chapter.content) }} 字</span>
                  <n-tag :type="resolveChapterStatusNaiveType(chapter.status)" size="small" :bordered="false" class="chapter-card-status-tag">
                    {{ formatChapterStatusLabel(chapter.status) }}
                  </n-tag>
                </div>
              </button>
            </div>
          </section>
        </div>
      </aside>

      <section class="editor-shell" :class="{ 'reading-mode': readingMode }">
        <div class="editor-topbar" :class="{ condensed: isCondensedTopbar, narrow: isNarrowStudio, tiny: isTinyStudio }">
          <div class="editor-context">
            <div class="editor-context-main">
              <strong>{{ readingMode ? currentChapterTitle : currentVolumeLabel }}</strong>
              <span v-if="readingMode">全书第 {{ selectedChapterIndex }} 章</span>
              <span v-else class="save-status-inline" :title="saveStatusText">{{ saveStatusCompactText }}</span>
              <span v-if="readingMode">{{ readingWordCountLabel }}</span>
              <span v-if="!readingMode && !isTinyStudio" class="progress-inline">
                {{ currentWordCount }} / {{ currentTargetWordCount || '自由字数' }} · {{ currentProgressPercent }}%
              </span>
              <n-tag v-else-if="!readingMode" size="small" :bordered="false">进度 {{ currentProgressPercent }}%</n-tag>
              <n-tag size="small" :type="resolveChapterStatusNaiveType(appStore.selectedChapter?.status ?? 'draft')" :bordered="false">{{ currentChapterStatusLabel }}</n-tag>
              <n-tag v-if="(!isCondensedTopbar || readingMode) && !isTinyStudio" size="small" :bordered="false">目标 {{ currentTargetWordCount || '自由字数' }}</n-tag>
              <n-tag v-if="(!isCondensedTopbar || readingMode) && !isTinyStudio" size="small" :bordered="false">本卷第 {{ selectedChapterIndexInVolume }} 章</n-tag>
              <n-tag v-if="(!isCondensedTopbar || readingMode) && !isTinyStudio" size="small" :bordered="false">全书第 {{ selectedChapterIndex }} 章</n-tag>
            </div>
          </div>

          <div class="editor-floating-actions">
            <div v-if="isCompactStudio && !readingMode" class="compact-utility-cluster" :class="{ narrow: isNarrowStudio }">
              <n-button size="small" quaternary class="compact-back-button" @click="appStore.backToWorkbench()">
                <template #icon><ChevronLeft :size="14" /></template>
                返回
              </n-button>

              <div class="compact-utility-switcher">
                <button
                    class="compact-utility-tab"
                    :class="{ active: compactSidebarVisible }"
                    @click="openCompactSidebar"
                >
                  <span>章节目录</span>
                </button>
                <button
                    class="compact-utility-tab"
                    :class="{ active: compactInsightsVisible }"
                    @click="openCompactInsights"
                >
                  <span>章节参考</span>
                </button>
              </div>
            </div>
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button size="small" :type="readingMode ? 'primary' : 'default'" :secondary="readingMode" @click="toggleReadingMode">
                  <template #icon><BookOpen :size="15" /></template>
                </n-button>
              </template>
              {{ readingMode ? '返回编辑模式' : '进入阅读模式' }}
            </n-tooltip>
            <template v-if="readingMode">
              <n-tooltip trigger="hover">
                <template #trigger>
                  <n-button size="small" quaternary :disabled="!previousChapter" @click="openAdjacentChapter(-1)">
                    <template #icon><ChevronLeft :size="15" /></template>
                  </n-button>
                </template>
                上一章
              </n-tooltip>
              <n-tooltip trigger="hover">
                <template #trigger>
                  <n-button size="small" quaternary :disabled="!nextChapter" @click="openAdjacentChapter(1)">
                    <template #icon><ChevronRight :size="15" /></template>
                  </n-button>
                </template>
                下一章
              </n-tooltip>
            </template>
            <template v-else>
              <div class="editor-action-group topbar-group topbar-group-primary">
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <n-button size="small" quaternary @click="saveCurrentVersion">
                      <template #icon><Save :size="15" /></template>
                    </n-button>
                  </template>
                  手动保存版本
                </n-tooltip>
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <n-button size="small" quaternary @click="openVersionHistory">
                      <template #icon><History :size="15" /></template>
                    </n-button>
                  </template>
                  历史版本
                </n-tooltip>
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <n-button size="small" quaternary @click="openChapterMetaEditor(appStore.selectedChapter)">
                      <template #icon><FilePenLine :size="15" /></template>
                    </n-button>
                  </template>
                  编辑章节信息
                </n-tooltip>
              </div>

              <div class="editor-action-group emphasis topbar-group topbar-group-assistant">
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <n-button
                        size="small"
                        type="primary"
                        :loading="isGeneratingChapterDraft"
                        :disabled="isGeneratingChapterDraft"
                        @click="generateChapterFirstDraft()"
                    >
                      <template #icon><Sparkles :size="15" /></template>
                      {{ isGeneratingChapterDraft ? '生成中' : 'AI 初稿' }}
                    </n-button>
                  </template>
                  直接流式生成本章初稿，完成后覆盖当前章节全部内容
                </n-tooltip>
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <n-button
                        size="small"
                        secondary
                        :disabled="!hasChapterSelection"
                        @click="queueChapterAssistantQuickAction('humanize-ai')"
                    >
                      降低AI感
                    </n-button>
                  </template>
                  对当前选中的正文片段执行去 AI 味润色，优先吸收已启用的 `story-deslop` 规则
                </n-tooltip>
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <n-button
                        size="small"
                        secondary
                        @click="queueChapterAssistantQuickAction('chapter-analysis')"
                    >
                      章节分析
                    </n-button>
                  </template>
                  让 AI 助手基于当前章节、关系和设定直接给出可执行的改稿诊断
                </n-tooltip>
                <n-tooltip v-if="isGeneratingChapterDraft" trigger="hover">
                  <template #trigger>
                    <n-button
                        size="small"
                        type="warning"
                        secondary
                        :loading="isStoppingChapterDraft"
                        :disabled="isStoppingChapterDraft"
                        @click="stopChapterFirstDraft()"
                    >
                      {{ isStoppingChapterDraft ? '停止中' : '停止生成' }}
                    </n-button>
                  </template>
                  停止本次 AI 初稿生成，保持当前章节原内容不变
                </n-tooltip>
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <n-button
                        size="small"
                        :type="appStore.aiVisible ? 'primary' : 'default'"
                        :secondary="appStore.aiVisible"
                        class="assistant-toggle-btn"
                        @click="appStore.toggleAi()"
                    >
                      <template #icon><Bot :size="15" /></template>
                     AI 助手窗口
                    </n-button>
                  </template>
                  {{ appStore.aiVisible ? '关闭 AI 助手窗口' : '打开浮动 AI 助手窗口' }}
                </n-tooltip>
              </div>

              <div class="editor-action-group danger topbar-group topbar-group-danger">
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <n-button
                        size="small"
                        quaternary
                        type="error"
                        :disabled="appStore.chapters.length <= 1"
                        @click="requestDeleteChapter"
                    >
                      <template #icon><Trash2 :size="15" /></template>
                    </n-button>
                  </template>
                  删除章节
                </n-tooltip>
              </div>
            </template>
          </div>
        </div>

        <div class="editor-stage" :class="{ 'reading-mode': readingMode }">
          <div class="editor-manuscript" :class="{ 'reading-mode': readingMode }">
            <template v-if="readingMode">
              <div class="reading-header">
                <div class="reading-header-meta">
                  <n-tag size="small" :type="resolveChapterStatusNaiveType(appStore.selectedChapter?.status ?? 'draft')" :bordered="false">{{ currentChapterStatusLabel }}</n-tag>
                  <n-tag size="small" :bordered="false">{{ currentVolumeLabel }}</n-tag>
                  <n-tag size="small" :bordered="false">本卷第 {{ selectedChapterIndexInVolume }} 章</n-tag>
                  <n-tag size="small" :bordered="false">{{ readingProgressLabel }}</n-tag>
                </div>

                <div class="reading-heading">
                  <span class="manuscript-overline">Chapter {{ selectedChapterIndex }}</span>
                  <h1>{{ appStore.selectedChapter?.title || '未命名章节' }}</h1>
                  <p>{{ readingLeadText }}</p>
                </div>
              </div>

              <div class="reading-body">
                <article class="reading-paper">
                  <div class="reading-content arc-scrollbar" v-html="readingContentHtml"></div>
                </article>
              </div>

              <div class="reading-footer">
                <n-button quaternary :disabled="!previousChapter" @click="openAdjacentChapter(-1)">
                  <template #icon><ChevronLeft :size="15" /></template>
                  {{ previousChapter?.title || '已经是第一章' }}
                </n-button>
                <n-button type="primary" quaternary :disabled="!nextChapter" @click="openAdjacentChapter(1)">
                  {{ nextChapter?.title || '已经是最后一章' }}
                  <template #icon><ChevronRight :size="15" /></template>
                </n-button>
              </div>
            </template>

            <template v-else>
              <div class="editor-body" :class="{ compact: isCompactStudio }">
                <!-- 加入内部滚动条：editor-column 自身具有 overflow-y: auto -->
                <div class="editor-column arc-scrollbar">
                  <div class="manuscript-paper">
                    <div class="manuscript-heading">
                      <span class="manuscript-overline">Chapter {{ selectedChapterIndexInVolume }}</span>
                      <input
                          class="chapter-title"
                          :value="appStore.selectedChapter?.title"
                          @input="appStore.updateChapterTitle(($event.target as HTMLInputElement).value)"
                          placeholder="未命名章节"
                      />
                    </div>

                    <div class="manuscript-divider"></div>

                    <RichChapterEditor
                        class="chapter-editor-instance"
                        :chapter-id="appStore.selectedChapter?.id ?? ''"
                        :model-value="appStore.selectedChapter?.content ?? ''"
                        :insertion-request="appStore.pendingChapterInsertion"
                        @update:model-value="appStore.updateChapterContent"
                        @consume-insertion="appStore.consumeChapterInsertion"
                        @selection-change="appStore.updateChapterSelection"
                    />
                  </div>
                </div>

                <aside v-if="!isCompactStudio" class="editor-insights">
                  <!-- 侧边栏也能独立内部滚动 -->
                  <div class="editor-insights-rail arc-scrollbar">

                    <div class="side-card outline-origin-card">
                      <div class="side-card-head">
                        <span class="side-card-label">来源大纲节点</span>
                        <n-button v-if="linkedOutlineItem" text type="primary" size="small" @click="jumpBackToOutline()">回到大纲</n-button>
                      </div>
                      <template v-if="linkedOutlineItem">
                        <div class="outline-origin-meta">
                          <span class="outline-origin-title">{{ linkedOutlineItem.title }}</span>
                          <n-tag size="small" :bordered="false">{{ linkedOutlineStatusMeta.label }}</n-tag>
                        </div>
                        <div class="outline-origin-summary-wrap">
                          <p class="outline-origin-summary">
                            <strong>核心冲突：</strong>{{ linkedOutlineItem.conflict || '暂无' }}
                          </p>
                          <p class="outline-origin-summary">
                            <strong>剧情推进：</strong>{{ linkedOutlineItem.summary || '暂无' }}
                          </p>
                        </div>
                        <div class="outline-origin-actions">
                          <n-button v-if="canSyncOutlineBack" size="small" type="primary" block @click="syncChapterBackToOutline()">
                            同步状态与摘要
                          </n-button>
                          <n-button
                              size="small"
                              secondary
                              block
                              :loading="isGeneratingOutlineChain"
                              :disabled="isGeneratingOutlineChain"
                              @click="generateNextOutlineChain()"
                          >
                            生成后续剧情链
                          </n-button>
                        </div>
                      </template>
                      <p v-else class="outline-origin-empty">
                        当前章节还没有绑定大纲节点。你可以先在章节信息中绑定大纲，或回到大纲页创建后再关联。
                      </p>
                    </div>

                    <div class="side-card summary-card">
                      <div class="side-card-head">
                        <span class="side-card-label">本章定位</span>
                      </div>
                      <p>{{ currentSummaryText }}</p>
                    </div>

<!--                    <div class="side-card inspiration-card">
                      <div class="side-card-head">
                        <div class="side-card-head-stack">
                          <span class="side-card-label">章节灵感</span>
                          <strong>当前可用灵感卡</strong>
                        </div>
                        <button class="inspiration-workbench-link" @click="openInspirationWorkbench">
                          <span>灵感池</span>
                          <ArrowUpRight :size="13" />
                        </button>
                      </div>

                      <div class="inspiration-focus-actions">
                        <button
                            v-for="focus in chapterInspirationFocuses"
                            :key="focus"
                            class="inspiration-focus-chip"
                            :disabled="isGeneratingInspiration"
                            @click="requestChapterInspiration(focus)"
                        >
                          <Lightbulb :size="13" />
                          <span>{{ isGeneratingInspiration ? '生成中...' : `生成${focus}` }}</span>
                        </button>
                      </div>

                      <div v-if="chapterInspirationEntries.length" class="inspiration-list">
                        <article v-for="entry in chapterInspirationEntries" :key="entry.id" class="inspiration-item">
                          <div class="inspiration-item-top">
                            <span class="inspiration-type">{{ entry.type }}</span>
                            <span class="inspiration-source" :class="entry.source">{{ entry.source === 'ai' ? 'AI' : '手记' }}</span>
                          </div>
                          <strong>{{ entry.title }}</strong>
                          <p>{{ entry.content }}</p>
                          <div v-if="entry.tags.length" class="inspiration-tag-row">
                            <span v-for="tag in entry.tags" :key="`${entry.id}-${tag}`" class="inspiration-tag">{{ tag }}</span>
                          </div>
                          <div class="inspiration-item-actions">
                            <button class="inspiration-action" @click="sendInspirationToAssistant(entry, 'expand')">扩成桥段</button>
                            <button class="inspiration-action secondary" @click="sendInspirationToAssistant(entry, 'continue')">继续续写</button>
                          </div>
                        </article>
                      </div>

                      <div v-else class="inspiration-empty">
                        <p>当前还没有与本章联动的灵感卡，可以先生成场景、转折或人物动机。</p>
                      </div>
                    </div>-->
                  </div>
                </aside>
              </div>

            <div class="editor-status">
              <div class="editor-status-group">
                <span class="status-metric">{{ currentWordCount }} / {{ formatChapterWordTargetLabel(appStore.selectedChapter?.wordTarget) }}</span>
                <span class="status-metric">{{ currentChapterVersions.length }} 个历史版本</span>
                <span v-if="!isTinyStudio" class="status-metric">全书第 {{ selectedChapterIndex }} 章</span>
              </div>
              <n-tag type="info" size="small" :bordered="false">
                <template #icon><PenTool :size="11" /></template>
                {{ saveStatusText }}
              </n-tag>
              </div>
            </template>
          </div>
        </div>
      </section>
    </div>

    <div v-if="filteredChapterGroups.length === 0" class="arc-empty-state">
      没有匹配“{{ props.searchQuery }}”的章节内容。
    </div>

    <!-- Modals omitted for brevity, keeping exactly as your original ones -->
    <n-modal
        :show="compactSidebarVisible"
        preset="card"
        class="arc-editor-modal compact-panel-modal"
        title="章节目录"
        :bordered="false"
        @close="compactSidebarVisible = false"
    >
      <div class="compact-panel compact-panel-directory">
        <div class="chapter-side-summary compact-panel-summary">
          <span>{{ chapterCountLabel }}</span>
          <span>{{ volumeCountLabel }}</span>
          <span>当前第 {{ selectedChapterIndex }} 章</span>
        </div>

        <div class="chapter-groups compact-panel-groups arc-scrollbar">
          <section v-for="group in filteredChapterGroups" :key="`compact-${group.volume.id}`" class="chapter-group">
            <div class="chapter-group-head">
              <span class="chapter-group-label">{{ formatVolumeLabel(group.volume, group.index, 'compact') }}</span>
            </div>

            <div class="chapter-items">
              <button
                  v-for="chapter in group.items"
                  :key="`compact-item-${chapter.id}`"
                  class="chapter-card"
                  :class="{ active: appStore.selectedChapterId === chapter.id }"
                  @click="selectChapterFromCompact(chapter.id)"
              >
                <div class="chapter-card-top">
                  <span class="chapter-card-num">第 {{ String(appStore.chapters.findIndex(c => c.id === chapter.id) + 1).padStart(3, '0') }} 章</span>
                </div>
                <div class="chapter-card-title">{{ chapter.title }}</div>
                <div class="chapter-card-footer">
                  <span class="chapter-card-words">{{ getChapterCharacterCount(chapter.content) }} 字</span>
                  <n-tag :type="resolveChapterStatusNaiveType(chapter.status)" size="small" :bordered="false" class="chapter-card-status-tag">
                    {{ formatChapterStatusLabel(chapter.status) }}
                  </n-tag>
                </div>
              </button>
            </div>
          </section>
        </div>
      </div>
    </n-modal>

    <n-modal
        :show="compactInsightsVisible"
        preset="card"
        class="arc-editor-modal compact-panel-modal"
        title="章节参考"
        :bordered="false"
        @close="compactInsightsVisible = false"
    >
      <div class="compact-panel compact-panel-insights arc-scrollbar">

        <div class="side-card outline-origin-card">
          <div class="side-card-head">
            <span class="side-card-label">来源大纲节点</span>
            <button v-if="linkedOutlineItem" class="text-link" @click="jumpBackToOutline()">回到大纲</button>
          </div>
          <template v-if="linkedOutlineItem">
            <div class="outline-origin-meta">
              <span class="outline-origin-title">{{ linkedOutlineItem.title }}</span>
              <n-tag size="small" :bordered="false">{{ linkedOutlineStatusMeta.label }}</n-tag>
            </div>
            <div class="outline-origin-summary-wrap">
              <p class="outline-origin-summary">
                <strong>核心冲突：</strong>{{ linkedOutlineItem.conflict || '暂无' }}
              </p>
              <p class="outline-origin-summary">
                <strong>剧情推进：</strong>{{ linkedOutlineItem.summary || '暂无' }}
              </p>
            </div>
            <div class="outline-origin-actions">
              <n-button v-if="canSyncOutlineBack" size="small" type="primary" block @click="syncChapterBackToOutline()">
                同步状态与摘要
              </n-button>
              <n-button
                  size="small"
                  secondary
                  block
                  :loading="isGeneratingOutlineChain"
                  :disabled="isGeneratingOutlineChain"
                  @click="generateNextOutlineChain()"
              >
                生成后续剧情链
              </n-button>
            </div>
          </template>
          <p v-else class="outline-origin-empty">
            当前章节还没有绑定大纲节点。你可以先在章节信息中绑定大纲，或回到大纲页创建后再关联。
          </p>
        </div>

        <div class="side-card summary-card">
          <div class="side-card-head">
            <span class="side-card-label">本章定位</span>
          </div>
          <p>{{ currentSummaryText }}</p>
        </div>

<!--        <div class="side-card inspiration-card">
          <div class="side-card-head">
            <div class="side-card-head-stack">
              <span class="side-card-label">章节灵感</span>
              <strong>当前可用灵感卡</strong>
            </div>
            <button class="inspiration-workbench-link" @click="openInspirationWorkbench">
              <span>灵感池</span>
              <ArrowUpRight :size="13" />
            </button>
          </div>

          <div class="inspiration-focus-actions">
            <button
                v-for="focus in chapterInspirationFocuses"
                :key="`compact-${focus}`"
                class="inspiration-focus-chip"
                :disabled="isGeneratingInspiration"
                @click="requestChapterInspiration(focus)"
            >
              <Lightbulb :size="13" />
              <span>{{ isGeneratingInspiration ? '生成中...' : `生成${focus}` }}</span>
            </button>
          </div>

          <div v-if="chapterInspirationEntries.length" class="inspiration-list">
            <article v-for="entry in chapterInspirationEntries" :key="`compact-entry-${entry.id}`" class="inspiration-item">
              <div class="inspiration-item-top">
                <span class="inspiration-type">{{ entry.type }}</span>
                <span class="inspiration-source" :class="entry.source">{{ entry.source === 'ai' ? 'AI' : '手记' }}</span>
              </div>
              <strong>{{ entry.title }}</strong>
              <p>{{ entry.content }}</p>
              <div v-if="entry.tags.length" class="inspiration-tag-row">
                <span v-for="tag in entry.tags" :key="`compact-${entry.id}-${tag}`" class="inspiration-tag">{{ tag }}</span>
              </div>
              <div class="inspiration-item-actions">
                <button class="inspiration-action" @click="sendInspirationToAssistant(entry, 'expand')">扩成桥段</button>
                <button class="inspiration-action secondary" @click="sendInspirationToAssistant(entry, 'continue')">继续续写</button>
              </div>
            </article>
          </div>

          <div v-else class="inspiration-empty">
            <p>当前还没有与本章联动的灵感卡，可以先生成场景、转折或人物动机。</p>
          </div>
        </div>-->
      </div>
    </n-modal>

    <n-modal
        :show="chapterDraftModalVisible"
        preset="card"
        class="arc-editor-modal arc-draft-modal"
        title="AI 初稿执行中"
        :mask-closable="false"
        :closable="!isGeneratingChapterDraft"
        :bordered="false"
        @close="closeChapterDraftModal"
    >
      <div class="chapter-draft-progress-card modal-mode">
        <div class="chapter-draft-progress-head">
          <div class="chapter-draft-progress-copy-block">
            <span class="chapter-draft-progress-label">AI 初稿执行中</span>
            <strong>{{ chapterDraftExecutionLabel || '等待开始' }}</strong>
          </div>
          <span class="chapter-draft-progress-percent">
            {{ isGeneratingChapterDraft ? `${chapterDraftProgressPercent}%` : '已结束' }}
          </span>
        </div>
        <div class="chapter-draft-progress-track">
          <div class="chapter-draft-progress-fill" :style="{ width: `${chapterDraftProgressPercent}%` }" />
        </div>
        <p class="chapter-draft-progress-copy">
          {{ chapterDraftProgressText || '已停止或完成本次 AI 初稿生成。' }}
        </p>
        <div class="chapter-draft-stream-preview arc-scrollbar">
          <pre>{{ chapterDraftStreamingContent || 'AI 正在准备本章初稿内容...' }}</pre>
        </div>
      </div>

      <template #footer>
        <div class="arc-modal-actions">
          <n-button
              v-if="isGeneratingChapterDraft"
              round
              strong
              secondary
              type="warning"
              :loading="isStoppingChapterDraft"
              @click="stopChapterFirstDraft"
          >
            停止生成
          </n-button>
          <n-button
              v-else
              round
              strong
              type="primary"
              @click="closeChapterDraftModal"
          >
            关闭
          </n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
        :show="versionHistoryVisible"
        preset="card"
        class="arc-editor-modal arc-version-modal"
        title="章节历史版本"
        :bordered="false"
        @close="versionHistoryVisible = false"
    >
      <div v-if="currentChapterVersions.length" class="version-list">
        <article v-for="version in currentChapterVersions" :key="version.id" class="version-card">
          <div class="version-card-head">
            <div>
              <strong>{{ formatVersionTime(version.createdAt) }}</strong>
              <p>{{ version.title }}</p>
            </div>
            <n-button type="primary" secondary round @click="restoreVersion(version)">恢复此版本</n-button>
          </div>

          <div class="version-meta">
            <span
                class="meta-chip"
                :class="
                version.status === 'final'
                  ? 'success'
                  : version.status === 'polish'
                    ? 'accent'
                    : version.status === 'review'
                      ? 'warning'
                      : 'neutral'
              "
            >
              {{ chapterStatusOptions.find((option) => option.value === version.status)?.label ?? '草稿中' }}
            </span>
            <span class="meta-chip neutral">{{ formatChapterWordTargetLabel(version.wordTarget) }}</span>
            <span class="version-words">{{ getVersionWordCount(version) }} 字</span>
          </div>

          <p class="version-summary">{{ version.summary }}</p>
          <p class="version-preview">{{ buildVersionPreview(version) }}</p>
        </article>
      </div>
      <div v-else class="arc-empty-state version-empty">
        当前章节还没有历史版本，点击右上角“手动保存版本”后会在这里看到快照。
      </div>
    </n-modal>

    <n-modal
        :show="editorVisible"
        preset="card"
        class="arc-editor-modal"
        title="编辑章节信息"
        :bordered="false"
        @close="editorVisible = false"
    >
      <n-form label-placement="top">
        <n-form-item label="所属分卷">
          <n-select v-model:value="chapterForm.volumeId" :options="volumeOptions" placeholder="选择这一章所在的分卷" />
        </n-form-item>
        <n-form-item label="绑定大纲节点">
          <n-select
              v-model:value="chapterForm.outlineItemId"
              :options="outlineBindingOptions"
              placeholder="可手动绑定或解绑当前章节对应的大纲节点"
          />
        </n-form-item>
        <n-form-item label="章节标题">
          <n-input v-model:value="chapterForm.title" placeholder="例如：第4章：夜城回响" />
        </n-form-item>
        <n-form-item label="章节摘要">
          <div class="summary-field-wrap">
            <n-input
                v-model:value="chapterForm.summary"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 5 }"
                placeholder="用 1 到 2 句话概括这一章的核心事件和推进点..."
            />
            <n-button
                size="small"
                secondary
                :loading="isGeneratingSummary"
                :disabled="isGeneratingSummary"
                class="summary-ai-btn"
                @click="generateChapterSummary()"
            >
              <template #icon><Sparkles :size="13" /></template>
              AI 生成
            </n-button>
          </div>
        </n-form-item>
        <n-form-item label="章节状态">
          <n-select v-model:value="chapterForm.status" :options="chapterStatusOptions" />
        </n-form-item>
        <n-form-item label="预估字数">
          <n-input
              :value="chapterForm.wordTarget"
              inputmode="numeric"
              placeholder="例如：3000"
              @update:value="handleChapterWordTargetInput"
          />
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitChapterMeta">保存修改</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 伏笔识别审核弹窗 -->
    <n-modal
      v-model:show="threadDetectVisible"
      preset="card"
      title="AI 识别到的潜在伏笔"
      class="arc-editor-modal thread-detect-modal"
      :mask-closable="false"
    >
      <div class="detect-list">
        <div
          v-for="(item, idx) in detectedThreads"
          :key="idx"
          class="detect-item"
          :class="{ selected: item.selected }"
          @click="item.selected = !item.selected"
        >
          <n-checkbox v-model:checked="item.selected" @click.stop />
          <div class="detect-content">
            <div class="detect-title">{{ item.title }}</div>
            <div class="detect-desc">{{ item.description }}</div>
            <div v-if="item.tags.length" class="detect-tags">
              <n-tag v-for="tag in item.tags" :key="tag" size="tiny" :bordered="false">{{ tag }}</n-tag>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="arc-modal-actions">
          <n-button @click="threadDetectVisible = false">取消</n-button>
          <n-button type="primary" @click="confirmAddThreads">
            添加选中（{{ detectedThreads.filter(t => t.selected).length }}）
          </n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
/* =========== 基础与骨架 =========== */
.chapters-layout {
  --chapter-border: var(--arc-border);
  --chapter-border-strong: var(--arc-border-strong);
  --chapter-surface: var(--arc-bg-surface);
  --chapter-surface-muted: var(--arc-bg-weak);
  --chapter-surface-soft: var(--arc-bg-body);
  --chapter-muted: var(--arc-text-hint);
  --chapter-ink: var(--arc-text-primary);
  --chapter-accent-soft: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  --chapter-shell-max-width: 1360px;
  display: flex;
  min-height: 0;
  max-width: none;
  width: 100%;
  margin: 0 auto;
}

.chapters-shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 0;
  min-height: 0;
  height: 100%;
  flex: 1;
  align-items: stretch;
  border: 1px solid var(--chapter-border-strong);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-md);
  overflow: hidden;
  width: min(100%, var(--chapter-shell-max-width));
  margin: 0 auto;
}

/* ★ 核心修复：当进入小屏紧凑模式或阅读模式时，网格必须强制变成 1 列！ */
.chapters-layout.compact-mode .chapters-shell,
.chapters-shell.reading-mode {
  grid-template-columns: minmax(0, 1fr);
}

.chapters-shell.reading-mode {
  background: var(--arc-bg-body);
}

/* =========== 侧边栏（左侧章节目录） =========== */
.chapter-sidebar {
  display: flex;
  width: 220px;
  flex-shrink: 0;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--arc-border);
  background: var(--arc-bg-sidebar);
  padding: 14px 10px;
}
.chapter-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.chapter-side-head-main { display: flex; min-width: 0; align-items: center; gap: 8px; }
.chapter-side-head strong { color: var(--arc-text-primary); font-size: 13px; font-weight: 700; }
.chapter-back-button { flex-shrink: 0; border-color: var(--arc-border); background: var(--arc-bg-surface); color: var(--arc-text-secondary); }
.chapter-back-button:hover { color: var(--arc-primary); }
.chapter-side-badge { display: inline-flex; align-items: center; border-radius: 4px; background: var(--arc-bg-body); color: var(--arc-text-hint); font-size: 11px; font-weight: 600; padding: 2px 6px; }
.chapter-side-summary { display: none; }
.chapter-groups { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 16px; overflow-y: auto; padding-bottom: 8px; }
.chapter-group {}
.chapter-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px 6px;
}
.chapter-group-label {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini-icon {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: all 0.14s ease;
}
.mini-icon:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border));
  background: var(--arc-bg-surface);
  color: var(--arc-primary);
}
.chapter-items { display: flex; flex-direction: column; gap: 6px; }
.chapter-card {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  cursor: pointer;
  padding: 10px 12px;
  text-align: left;
  transition:
    border-color 0.14s ease,
    background 0.14s ease,
    box-shadow 0.14s ease;
}
.chapter-card::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: transparent;
  transition: background 0.14s ease;
}
.chapter-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-border));
  background: var(--arc-bg-surface);
}
.chapter-card.active {
  border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
  box-shadow: var(--arc-shadow-sm);
}
.chapter-card.active::before {
  background: var(--arc-primary);
}
.chapter-card.dragging { opacity: 0.5; }
.chapter-card.drop-target { border-color: var(--arc-primary); }
.chapter-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.chapter-card-num {
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  opacity: 0.8;
}
.chapter-card.active .chapter-card-num {
  opacity: 1;
}
.chapter-card-action {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--arc-text-hint);
  opacity: 0;
  transition: opacity 0.14s ease, background 0.14s ease;
}
.chapter-card:hover .chapter-card-action { opacity: 1; }
.chapter-card-action:hover { background: var(--arc-bg-body); color: var(--arc-text-primary); }
.chapter-card-title {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--arc-text-primary);
  letter-spacing: -0.01em;
}
.chapter-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.chapter-card-words {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
}
.chapter-card-status {
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  font-weight: 700;
}
.chapter-card-status.neutral {
  background: var(--arc-bg-body);
  color: var(--arc-text-secondary);
}
.chapter-card-status.warning {
  background: color-mix(in srgb, #f59e0b 12%, var(--arc-bg-surface));
  color: #d97706;
}
.chapter-card-status.accent {
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
  color: var(--arc-primary);
}
.chapter-card-status.success {
  background: color-mix(in srgb, #22c55e 10%, var(--arc-bg-surface));
  color: #16a34a;
}

/* =========== 顶部工具栏与外壳结构 =========== */
.editor-shell {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--arc-bg-surface);
}

.editor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--chapter-border);
  background: var(--arc-bg-surface);
  flex-shrink: 0; /* ★ 必须加：保护顶部工具栏在窗口极小时不被挤压 */
}

.editor-context { display: flex; min-width: 0; flex: 1; }
.editor-context-main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.editor-context-main strong { color: var(--arc-text-primary); font-size: 16px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
.editor-context-main span { color: var(--arc-text-secondary); font-size: 12px; font-weight: 700; }
.editor-context-main .progress-inline { color: var(--arc-primary); }
.save-status-inline { display: inline-flex; min-width: 56px; align-items: center; justify-content: center; }

.editor-floating-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.editor-action-group { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--arc-border); border-radius: var(--arc-radius-md); background: var(--arc-bg-body); }
.editor-action-group.emphasis { background: var(--arc-bg-body); }
.editor-action-group.danger { background: var(--arc-bg-body); }

/* =========== 工具按钮与胶囊 =========== */
.tool-badge {
  display: inline-flex; min-width: 30px; min-height: 32px; align-items: center; justify-content: center;
  border: 1px solid var(--chapter-border); border-radius: var(--arc-radius-md); background: transparent;
  color: var(--arc-text-secondary); cursor: pointer; padding: 0 8px; transition: all 0.12s ease;
}
.tool-badge:hover { border-color: var(--chapter-border-strong); background: var(--arc-bg-surface); color: var(--arc-text-primary); }
.tool-badge.active { border-color: color-mix(in srgb, var(--arc-primary) 16%, var(--chapter-border)); background: var(--chapter-accent-soft); color: var(--arc-primary); }
.tool-badge.neutral { background: transparent; color: var(--arc-text-secondary); }
.tool-badge.neutral.active { background: var(--chapter-accent-soft); color: var(--arc-primary); }
.tool-badge:disabled { opacity: 0.4; cursor: not-allowed; }
.tool-badge.danger:hover { background: color-mix(in srgb, #dc2626 8%, var(--arc-bg-surface)); color: #dc2626; }

.meta-chip { display: inline-flex; align-items: center; border: 1px solid var(--chapter-border); border-radius: var(--arc-radius-sm); font-size: 11px; font-weight: 600; padding: 2px 7px; }
.meta-chip.neutral { background: var(--arc-bg-body); color: var(--arc-text-secondary); }
.meta-chip.ghost { background: transparent; color: var(--arc-text-hint); border-color: transparent; }
.meta-chip.warning { background: color-mix(in srgb, #f59e0b 12%, var(--arc-bg-surface)); color: #d97706; border-color: transparent; }
.meta-chip.accent { background: var(--chapter-accent-soft); border-color: color-mix(in srgb, var(--arc-primary) 20%, var(--arc-border)); color: var(--arc-primary); }
.meta-chip.success { background: color-mix(in srgb, #22c55e 10%, var(--arc-bg-surface)); color: #16a34a; border-color: transparent; }

.assistant-toggle { min-width: 152px; gap: 10px; padding: 8px 12px; }
.assistant-toggle-icons { display: inline-flex; align-items: center; gap: 6px; }
.assistant-toggle-copy { display: flex; align-items: center; gap: 8px; }
.assistant-toggle-label { font-size: 12px; font-weight: 700; }
.assistant-toggle-state { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--arc-border); border-radius: var(--arc-radius-sm); background: var(--arc-bg-body); color: var(--arc-text-hint); font-size: 10px; font-weight: 600; padding: 3px 7px; }
.assistant-toggle-indicator { width: 6px; height: 6px; border-radius: 999px; background: var(--arc-text-hint); }
.assistant-toggle-indicator.active { background: var(--arc-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 18%, transparent); }

.chapter-draft-progress-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 14px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 16%, var(--arc-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  box-shadow: var(--arc-shadow-sm);
  padding: 16px 18px;
}

.chapter-draft-progress-card.modal-mode {
  margin-bottom: 0;
  border: none;
  box-shadow: none;
  background: transparent;
  padding: 0;
}

.chapter-draft-progress-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.chapter-draft-progress-copy-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chapter-draft-progress-label {
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.chapter-draft-progress-copy-block strong {
  color: var(--arc-text-primary);
  font-size: 15px;
  font-weight: 700;
}

.chapter-draft-progress-percent {
  color: var(--arc-primary);
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
}

.chapter-draft-progress-track {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-bg-surface));
}

.chapter-draft-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--arc-primary);
  transition: width 0.2s ease;
}

.chapter-draft-progress-copy {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
}

.chapter-draft-stream-preview {
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-body);
  padding: 12px 14px;
}

:deep(.arc-draft-modal) {
  width: min(860px, calc(100vw - 32px));
}

:deep(.arc-draft-modal .n-card__content) {
  padding-top: 10px;
}

:deep(.arc-draft-modal .n-card-header__main) {
  font-weight: 700;
}

.chapter-draft-stream-preview pre {
  margin: 0;
  color: var(--arc-text-primary);
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

.compact-utility-switcher { display: inline-flex; align-items: center; border: 1px solid var(--arc-border); border-radius: 8px; background: var(--arc-bg-surface); padding: 4px; }
.compact-utility-tab { min-width: 92px; min-height: 36px; border: none; border-radius: var(--arc-radius-md); background: transparent; color: var(--arc-text-secondary); font-size: 13px; font-weight: 700; padding: 0 14px; cursor: pointer; }
.compact-utility-tab.active { background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface)); color: var(--arc-primary); box-shadow: var(--arc-shadow-sm); }

/* =========== 编辑器主体与高度约束链 =========== */
.editor-stage {
  display: flex;
  min-height: 0;
  flex: 1; /* ★ 吸收所有剩余高度 */
}

.editor-manuscript {
  display: flex;
  flex-direction: column;
  min-height: 0; /* ★ 传递高度约束 */
  flex: 1;
  background: var(--arc-bg-body);
  padding: 20px 24px;
}

.editor-body {
  display: flex;
  gap: 30px;
  flex: 1; /* ★ 传递高度约束 */
  min-height: 0;
  padding-top: 0;
  align-items: stretch;
}

/* 左侧写字区：垂直排列并居中 */
.editor-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 0;
  min-height: 0; /* ★ 传递高度约束 */
}

/* 纸张容器 */
.manuscript-paper {
  width: 100%;
  max-width: 860px;
  display: flex;
  flex-direction: column;
  flex: 1; /* ★ 替换原有的 height: 100%，弹性占满剩余空间 */
  min-height: 0;
}

/* 标题区：绝对不能缩小 */
.manuscript-heading {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
  flex-shrink: 0; /* ★ 保护标题区不被压缩 */
}

.manuscript-overline { color: var(--arc-text-hint); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }

.chapter-title {
  width: 100%; border: none; background: transparent; color: var(--arc-text-primary);
  font-size: clamp(24px, 3vw, 32px); font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0; outline: none;
}
.chapter-title:hover { color: var(--arc-text-primary); }
.chapter-title::placeholder { color: var(--arc-text-hint); }

.manuscript-divider {
  height: 1px;
  margin: 16px 0 24px;
  background: linear-gradient(90deg, transparent, var(--arc-border), transparent);
  flex-shrink: 0; /* ★ 保护分割线不被压缩 */
}

/* ★ 最核心的编辑器实例：让内部自行产生滚动 */
.chapter-editor-instance {
  width: 100%;
  max-width: none;
  margin-right: 0;
  flex: 1;       /* ★ 吸收纸张容器的剩余空间 */
  min-height: 0; /* ★ 必须加：防止内部内容把组件撑破 */
  display: flex;
  flex-direction: column;
}

/* =========== 右侧侧栏独立滚动 =========== */
.editor-insights {
  width: 320px;
  flex-shrink: 0; /* ★ 保证侧栏宽度不被压榨 */
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor-insights-rail {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto; /* ★ 开启独立内部滚动 */
  padding-right: 4px;
}

.side-card {
  border: 1px solid var(--chapter-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-sm);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}
.side-card-head { display: flex; justify-content: space-between; align-items: flex-start;}
.side-card-label { color: var(--arc-text-hint); font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.outline-origin-title { font-size: 15px; font-weight: 700; color: var(--arc-text-primary); }
.outline-origin-status { font-size: 11px; font-weight: 800; padding: 5px 9px; border-radius: var(--arc-radius-sm); }
.outline-origin-empty { margin: 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.7; }
.outline-origin-summary-wrap { background: var(--arc-bg-body); border-radius: var(--arc-radius-md); padding: 10px; border: 1px solid var(--arc-border); }
.outline-origin-summary { margin: 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.6; }
.summary-card p { margin: 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.7; }
.action-btn { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; border-radius: var(--arc-radius-md); cursor: pointer; font-size: 12px; font-weight: 700; margin-bottom: 6px;}
.action-btn.primary { background: var(--arc-primary); color: white; border: none; }
.action-btn.ghost { background: transparent; border: 1px solid var(--chapter-border); color: var(--arc-text-secondary); }

.text-link { background: transparent; border: none; padding: 0; cursor: pointer; color: var(--arc-primary); font-size: 12px; font-weight: 600; }

.summary-field-wrap { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.summary-ai-btn { align-self: flex-end; }

.inspiration-card.side-card { border-color: color-mix(in srgb, var(--arc-primary) 10%, var(--chapter-border)); background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-surface)); }
.inspiration-workbench-link { display: inline-flex; min-height: 30px; align-items: center; gap: 6px; border: 1px solid var(--arc-border); border-radius: var(--arc-radius-md); background: var(--arc-bg-body); color: var(--arc-text-secondary); font-size: 11px; font-weight: 700; padding: 6px 11px; }
.inspiration-focus-chip { display: inline-flex; min-height: 32px; align-items: center; gap: 6px; border: 1px solid color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border)); border-radius: var(--arc-radius-md); background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface)); color: var(--arc-primary); font-size: 11px; font-weight: 700; padding: 6px 11px; }
.inspiration-item { border: 1px solid var(--arc-border); border-radius: var(--arc-radius-md); background: var(--arc-bg-surface); padding: 12px; margin-bottom: 10px; }
.inspiration-type { background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface)); color: var(--arc-primary); padding: 5px 9px; font-size: 11px; font-weight: 700; border-radius: var(--arc-radius-sm); }
.inspiration-source { background: var(--arc-bg-body); color: var(--arc-text-secondary); padding: 5px 8px; font-size: 11px; font-weight: 700; border-radius: var(--arc-radius-sm); }
.inspiration-item strong { display: block; color: var(--arc-text-primary); font-size: 13px; font-weight: 700; line-height: 1.5; }
.inspiration-item p { margin: 8px 0 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.75; }

@media (max-width: 860px) {
  .chapter-group-head {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .chapter-group-target {
    grid-column: 1 / -1;
    justify-self: flex-start;
  }
}

/* =========== 底部状态栏 =========== */
.editor-status {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: min(100%, 920px);
  margin: 16px auto 0;
  padding: 12px 14px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  box-shadow: var(--arc-shadow-sm);
  color: var(--arc-text-secondary);
  font-size: 12px;
  flex-shrink: 0; /* ★ 保护底部状态栏绝不被压缩 */
}

.editor-status-group { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.status-pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid color-mix(in srgb, var(--arc-primary) 20%, var(--arc-border)); border-radius: var(--arc-radius-sm); background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix)); color: var(--arc-primary); font-weight: 700; padding: 6px 10px; }

/* =========== 紧凑/窄屏 响应式适配 =========== */
@media (max-width: 1180px) {
  .editor-topbar.narrow { flex-wrap: wrap; }
}

@media (max-width: 1040px) {
  .editor-status { width: min(100%, 920px); }

  /* 当顶部很挤时，变为两行 */
  .editor-topbar.narrow, .editor-topbar.tiny {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    height: auto;
  }
  .editor-floating-actions { justify-content: flex-start; }
}

@media (max-width: 820px) {
  .chapters-layout { --chapter-shell-max-width: 100%; }
  .chapters-shell { border-radius: 10px; }

  /* 在手机等极小屏幕下，右侧参考栏掉到下面 */
  .editor-body, .editor-body.compact {
    flex-direction: column;
    gap: 16px;
    overflow-y: auto; /* ★ 极端小屏下，允许全页面统一滚动 */
  }

  /* 取消小屏下正文与侧边栏的高度锁定 */
  .editor-column { flex: 0 0 auto; min-height: 50vh; }
  .editor-insights { width: 100%; flex: 0 0 auto; }
  .editor-insights-rail { overflow-y: visible; max-height: none; }

  .editor-topbar { padding: 12px 14px; gap: 10px; flex-direction: column; align-items: stretch; }
  .editor-manuscript { padding: 12px; }
  .editor-status { grid-template-columns: minmax(0, 1fr); justify-items: start; }
}

/* 弹窗等无关布局的样式保留 */
.arc-version-modal :deep(.n-card__content) { max-height: min(72vh, 720px); overflow: hidden; }
.compact-panel-modal :deep(.n-card__content) { max-height: min(76vh, 780px); overflow: hidden; }
.compact-panel { display: flex; min-height: 0; flex-direction: column; gap: 14px; }
.compact-panel-groups { min-height: 0; max-height: min(64vh, 680px); overflow-y: auto; padding-right: 6px; }
.version-list { display: flex; max-height: min(64vh, 620px); flex-direction: column; gap: 14px; overflow-y: auto; padding-right: 6px; }
.version-card { border: 1px solid var(--chapter-border); border-radius: 6px; background: var(--chapter-surface); padding: 14px; }
.version-card-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }

/* ── 伏笔识别弹窗 ── */
.thread-detect-modal {
  width: min(92vw, 520px);
}

.detect-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detect-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.detect-item.selected {
  border-color: color-mix(in srgb, var(--arc-primary) 40%, var(--arc-border));
  background: var(--arc-primary-soft);
}

.detect-content {
  flex: 1;
  min-width: 0;
}

.detect-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.detect-desc {
  font-size: 12px;
  color: var(--arc-text-secondary);
  margin-top: 3px;
  line-height: 1.5;
}

.detect-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
</style>
