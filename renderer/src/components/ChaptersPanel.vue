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
  Trash2
} from 'lucide-vue-next'
import { NButton, NDropdown, NForm, NFormItem, NInput, NModal, NSelect, NTooltip, useDialog, useMessage } from 'naive-ui'
import RichChapterEditor from '@/components/RichChapterEditor.vue'
import { ensureEditorHtmlContent, getChapterCharacterCount, getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { pickRelevantInspirationEntries } from '@/features/inspiration/relevance'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { useAppStore } from '@/stores/app'
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
const isGeneratingInspiration = ref(false) // AI 生成章节灵感时的加载状态
const isGeneratingOutlineChain = ref(false)
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
// 解析章节目标字数：支持"万"单位和普通数字格式
const currentTargetWordCount = computed(() => {
  const wordTarget = appStore.selectedChapter?.wordTarget ?? ''
  const wanMatch = wordTarget.match(/(\d+(?:\.\d+)?)\s*万/)
  if (wanMatch) {
    return Math.round(Number(wanMatch[1]) * 10000)
  }

  const digitMatch = wordTarget.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)
  return digitMatch ? Math.round(Number(digitMatch[1])) : 0
})
// 当前章节的写作进度百分比（0-100），无目标字数时为 0
const currentProgressPercent = computed(() => {
  if (!currentTargetWordCount.value) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round((currentWordCount.value / currentTargetWordCount.value) * 100)))
})
// 当前章节摘要文本，为空时显示占位提示
const currentSummaryText = computed(() => appStore.selectedChapter?.summary?.trim() || '待补充章节摘要')
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
    const result = await window.characterArc.generateAi({
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
    })

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
  chapterForm.wordTarget = chapter.wordTarget
  editorVisible.value = true
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
    'progress',
    `章节回写：${chapter.title}`,
    [
      `- 已将当前章节摘要同步回大纲节点。`,
      `- 章节状态：${currentChapterStatusLabel.value}`,
      `- 关联大纲节点：${outline.title}`
    ].join('\n')
  )
  appStore.appendWorkflowDocumentEntry(
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
    const result = await window.characterArc.generateAi({
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
    })

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
      'task_plan',
      `后续剧情链：${chapter.title}`,
      [
        `- 已基于当前章节生成 ${entries.length} 个后续剧情节点。`,
        ...entries.map((entry, index) => `- 节点${index + 1}：${entry.title ?? `后续节点 ${index + 1}`}`)
      ].join('\n')
    )
    appStore.appendWorkflowDocumentEntry(
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

  appStore.updateChapter(chapter.id, {
    outlineItemId: chapterForm.outlineItemId,
    volumeId: chapterForm.volumeId,
    title: chapterForm.title,
    summary: chapterForm.summary,
    status: chapterForm.status,
    wordTarget: chapterForm.wordTarget
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

watch(isCompactStudio, (compact) => {
  if (!compact) {
    compactSidebarVisible.value = false
    compactInsightsVisible.value = false
  }
})

onMounted(() => {
  syncViewportWidth()
  window.addEventListener('resize', syncViewportWidth)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewportWidth)
  if (saveTimer) {
    window.clearTimeout(saveTimer)
  }
})
</script>

<template>
  <section class="chapters-layout" :class="{ 'reading-mode': readingMode, 'compact-mode': isCompactStudio && !readingMode }">
    <div class="chapters-shell" :class="{ 'reading-mode': readingMode }">
      <aside v-if="!readingMode && !isCompactStudio" class="chapter-sidebar">
        <div class="chapter-side-head">
          <div class="chapter-side-head-main">
            <n-tooltip trigger="hover">
              <template #trigger>
                <button class="tool-badge neutral chapter-back-button" @click="appStore.backToWorkbench()">
                  <ChevronLeft :size="16" />
                </button>
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
              <div>
                <strong>{{ formatVolumeLabel(group.volume, group.index, 'compact') }}</strong>
                <p>{{ group.items.length }} 个章节 · {{ group.volume.wordTarget }}</p>
              </div>
              <n-tooltip trigger="hover">
                <template #trigger>
                  <button class="mini-icon" @click="appStore.createChapter(group.volume.id)">
                    <Plus :size="15" />
                  </button>
                </template>
                在本卷中新增章节
              </n-tooltip>
            </div>

            <div class="chapter-items">
              <button
                v-for="chapter in group.items"
                :key="chapter.id"
                class="chapter-pill"
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
                <span class="chapter-pill-grip" @click.stop>
                  <GripVertical :size="14" />
                </span>
                <span class="chapter-pill-main">
                  <span class="chapter-pill-heading">
                    <span class="chapter-pill-label">{{ chapter.title }}</span>
                    <span v-if="appStore.selectedChapterId === chapter.id" class="chapter-pill-current">当前章节</span>
                  </span>
                  <span class="chapter-pill-meta">
                    <span>{{ chapter.wordTarget }}</span>
                    <span class="chapter-pill-dot"></span>
                    <span>{{ chapterStatusOptions.find((option) => option.value === chapter.status)?.label ?? '草稿中' }}</span>
                  </span>
                </span>
                <n-dropdown :options="chapterMenuOptions" placement="bottom-end" @select="(key) => handleChapterMenuSelect(key, chapter)">
                  <span class="chapter-pill-action" @click.stop>
                    <MoreVertical :size="14" />
                  </span>
                </n-dropdown>
              </button>
            </div>
          </section>
        </div>
      </aside>

      <section class="editor-shell" :class="{ 'reading-mode': readingMode }">
        <div class="editor-topbar">
          <div class="editor-context">
            <div class="editor-context-main">
              <strong>{{ readingMode ? currentChapterTitle : currentVolumeLabel }}</strong>
              <span v-if="readingMode">全书第 {{ selectedChapterIndex }} 章</span>
              <span v-else class="save-status-inline" :title="saveStatusText">{{ saveStatusCompactText }}</span>
              <span v-if="readingMode">{{ readingWordCountLabel }}</span>
              <span v-else class="progress-inline">
                {{ currentWordCount }} / {{ currentTargetWordCount || '自由字数' }} · {{ currentProgressPercent }}%
              </span>
              <span class="meta-chip" :class="currentChapterStatusTone">{{ currentChapterStatusLabel }}</span>
              <span v-if="!isCondensedTopbar || readingMode" class="meta-chip neutral">目标 {{ currentTargetWordCount || '自由字数' }}</span>
              <span v-if="!isCondensedTopbar || readingMode" class="meta-chip ghost">本卷第 {{ selectedChapterIndexInVolume }} 章</span>
              <span v-if="!isCondensedTopbar || readingMode" class="meta-chip ghost">全书第 {{ selectedChapterIndex }} 章</span>
            </div>
          </div>

          <div class="editor-floating-actions">
            <div v-if="isCompactStudio && !readingMode" class="compact-utility-cluster">
              <button class="tool-badge neutral compact-back-button" @click="appStore.backToWorkbench()">
                <span class="compact-back-icon">
                  <ChevronLeft :size="14" />
                </span>
                <span class="compact-back-label">返回</span>
              </button>

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
                <button class="tool-badge neutral" :class="{ active: readingMode }" @click="toggleReadingMode">
                  <BookOpen :size="16" />
                </button>
              </template>
              {{ readingMode ? '返回编辑模式' : '进入阅读模式' }}
            </n-tooltip>
            <template v-if="readingMode">
              <n-tooltip trigger="hover">
                <template #trigger>
                  <button class="tool-badge neutral" :disabled="!previousChapter" @click="openAdjacentChapter(-1)">
                    <ChevronLeft :size="16" />
                  </button>
                </template>
                上一章
              </n-tooltip>
              <n-tooltip trigger="hover">
                <template #trigger>
                  <button class="tool-badge neutral" :disabled="!nextChapter" @click="openAdjacentChapter(1)">
                    <ChevronRight :size="16" />
                  </button>
                </template>
                下一章
              </n-tooltip>
            </template>
            <template v-else>
            <div class="editor-action-group">
              <n-tooltip trigger="hover">
                <template #trigger>
                  <button class="tool-badge" @click="saveCurrentVersion">
                    <Save :size="16" />
                  </button>
                </template>
                手动保存版本
              </n-tooltip>
              <n-tooltip trigger="hover">
                <template #trigger>
                  <button class="tool-badge neutral" @click="openVersionHistory">
                    <History :size="16" />
                  </button>
                </template>
                历史版本
              </n-tooltip>
              <n-tooltip trigger="hover">
                <template #trigger>
                  <button class="tool-badge neutral" @click="openChapterMetaEditor(appStore.selectedChapter)">
                    <FilePenLine :size="16" />
                  </button>
                </template>
                编辑章节信息
              </n-tooltip>
            </div>

            <div class="editor-action-group emphasis">
              <n-tooltip trigger="hover">
                <template #trigger>
                  <button
                    class="tool-badge neutral assistant-toggle"
                    :class="{ active: appStore.aiVisible }"
                    @click="appStore.toggleAi()"
                  >
                    <span class="assistant-toggle-icons" aria-hidden="true">
                      <Bot :size="16" />
                    </span>
                    <span class="assistant-toggle-copy">
                      <span class="assistant-toggle-label">AI 助手</span>
                      <span class="assistant-toggle-state">
                        <span class="assistant-toggle-indicator" :class="{ active: appStore.aiVisible }"></span>
                        {{ appStore.aiVisible ? '已打开' : '已关闭' }}
                      </span>
                    </span>
                  </button>
                </template>
                {{ appStore.aiVisible ? '关闭 AI 助手窗口' : '打开 AI 助手窗口' }}
              </n-tooltip>
            </div>

            <div class="editor-action-group danger">
              <n-tooltip trigger="hover">
                <template #trigger>
                  <button
                    class="tool-badge neutral danger"
                    :disabled="appStore.chapters.length <= 1"
                    @click="requestDeleteChapter"
                  >
                    <Trash2 :size="16" />
                  </button>
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
                  <span class="meta-chip" :class="currentChapterStatusTone">{{ currentChapterStatusLabel }}</span>
                  <span class="meta-chip neutral">{{ currentVolumeLabel }}</span>
                  <span class="meta-chip ghost">本卷第 {{ selectedChapterIndexInVolume }} 章</span>
                  <span class="meta-chip ghost">{{ readingProgressLabel }}</span>
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
                <button class="reading-nav" :disabled="!previousChapter" @click="openAdjacentChapter(-1)">
                  <ChevronLeft :size="16" />
                  <span>{{ previousChapter?.title || '已经是第一章' }}</span>
                </button>
                <button class="reading-nav primary" :disabled="!nextChapter" @click="openAdjacentChapter(1)">
                  <span>{{ nextChapter?.title || '已经是最后一章' }}</span>
                  <ChevronRight :size="16" />
                </button>
              </div>
            </template>

            <template v-else>
            <div class="editor-manuscript-head">
              <div class="editor-meta-stack">
                <div class="manuscript-heading">
                  <span class="manuscript-overline">Chapter {{ selectedChapterIndexInVolume }}</span>
                  <input
                    class="chapter-title"
                    :value="appStore.selectedChapter?.title"
                    @input="appStore.updateChapterTitle(($event.target as HTMLInputElement).value)"
                  />
                </div>
                <div v-if="linkedOutlineItem" class="outline-origin-card">
                  <div class="outline-origin-head">
                    <span class="outline-origin-kicker">来源大纲节点</span>
                    <div class="outline-origin-head-actions">
                      <button v-if="canSyncOutlineBack" class="outline-origin-link secondary" @click="syncChapterBackToOutline()">
                        同步回大纲
                      </button>
                      <button
                        v-if="linkedOutlineItem"
                        class="outline-origin-link secondary"
                        :disabled="isGeneratingOutlineChain"
                        @click="generateNextOutlineChain()"
                      >
                        {{ isGeneratingOutlineChain ? '生成中...' : '生成后续剧情链' }}
                      </button>
                      <button class="outline-origin-link secondary" @click="openChapterMetaEditor(appStore.selectedChapter)">
                        调整绑定
                      </button>
                      <button class="outline-origin-link" @click="jumpBackToOutline()">
                        回到大纲
                      </button>
                    </div>
                  </div>
                  <div class="outline-origin-meta">
                    <span class="outline-origin-title">{{ linkedOutlineItem.title }}</span>
                    <span class="outline-origin-status" :class="linkedOutlineStatusMeta.tone">
                      {{ linkedOutlineStatusMeta.label }}
                    </span>
                    <span class="outline-origin-status ghost">目标 {{ linkedOutlineItem.wordTarget }}</span>
                  </div>
                  <p class="outline-origin-summary">
                    <strong>核心冲突：</strong>{{ linkedOutlineItem.conflict }}
                    <br />
                    <strong>剧情推进：</strong>{{ linkedOutlineItem.summary }}
                  </p>
                  <p class="outline-origin-hint">同步回大纲会更新该节点的剧情摘要，并根据当前章节状态推进到“写作中 / 已完成”。</p>
                </div>
              </div>
            </div>

            <div class="manuscript-divider"></div>

            <div class="editor-body" :class="{ compact: isCompactStudio }">
              <div class="editor-column">
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

              <aside v-if="!isCompactStudio" class="editor-insights">
                <div class="editor-insights-rail arc-scrollbar">
                  <div class="summary-card">
                    <span class="summary-card-label">本章定位</span>
                    <p>{{ currentSummaryText }}</p>
                  </div>

                  <div class="inspiration-card">
                    <div class="inspiration-card-head">
                      <div class="inspiration-card-copy">
                        <span class="summary-card-label">章节灵感</span>
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
                  </div>
                </div>
              </aside>
            </div>

            <div class="editor-status">
              <div class="editor-status-group">
                <span class="status-metric">{{ currentWordCount }} 字</span>
                <span class="status-metric">{{ currentChapterVersions.length }} 个历史版本</span>
                <span class="status-metric">全书第 {{ selectedChapterIndex }} 章</span>
              </div>
              <span class="status-pill">
                <PenTool :size="12" />
                {{ saveStatusText }}
              </span>
            </div>
            </template>
          </div>
        </div>
      </section>
    </div>

    <div v-if="filteredChapterGroups.length === 0" class="arc-empty-state">
      没有匹配“{{ props.searchQuery }}”的章节内容。
    </div>

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
              <div>
                <strong>{{ formatVolumeLabel(group.volume, group.index, 'compact') }}</strong>
                <p>{{ group.items.length }} 个章节 · {{ group.volume.wordTarget }}</p>
              </div>
              <n-tooltip trigger="hover">
                <template #trigger>
                  <button class="mini-icon" @click="appStore.createChapter(group.volume.id)">
                    <Plus :size="15" />
                  </button>
                </template>
                在本卷中新增章节
              </n-tooltip>
            </div>

            <div class="chapter-items">
              <button
                v-for="chapter in group.items"
                :key="`compact-item-${chapter.id}`"
                class="chapter-pill"
                :class="{ active: appStore.selectedChapterId === chapter.id }"
                @click="selectChapterFromCompact(chapter.id)"
              >
                <span class="chapter-pill-main">
                  <span class="chapter-pill-heading">
                    <span class="chapter-pill-label">{{ chapter.title }}</span>
                    <span v-if="appStore.selectedChapterId === chapter.id" class="chapter-pill-current">当前章节</span>
                  </span>
                  <span class="chapter-pill-meta">
                    <span>{{ chapter.wordTarget }}</span>
                    <span class="chapter-pill-dot"></span>
                    <span>{{ chapterStatusOptions.find((option) => option.value === chapter.status)?.label ?? '草稿中' }}</span>
                  </span>
                </span>
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
        <div class="summary-card">
          <span class="summary-card-label">本章定位</span>
          <p>{{ currentSummaryText }}</p>
        </div>

        <div class="inspiration-card">
          <div class="inspiration-card-head">
            <div class="inspiration-card-copy">
              <span class="summary-card-label">章节灵感</span>
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
        </div>
      </div>
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
            <span class="meta-chip neutral">{{ version.wordTarget }}</span>
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
          <n-input
            v-model:value="chapterForm.summary"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            placeholder="用 1 到 2 句话概括这一章的核心事件和推进点..."
          />
        </n-form-item>
        <n-form-item label="章节状态">
          <n-select v-model:value="chapterForm.status" :options="chapterStatusOptions" />
        </n-form-item>
        <n-form-item label="预估字数">
          <n-input v-model:value="chapterForm.wordTarget" placeholder="例如：预估 3200字" />
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitChapterMeta">保存修改</n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.chapters-layout {
  --chapter-border: rgba(226, 232, 240, 0.92);
  --chapter-border-strong: rgba(203, 213, 225, 0.96);
  --chapter-surface: rgba(255, 255, 255, 0.92);
  --chapter-surface-muted: rgba(245, 247, 250, 0.92);
  --chapter-surface-soft: rgba(248, 250, 252, 0.96);
  --chapter-muted: #667085;
  --chapter-ink: #18212f;
  --chapter-accent-soft: color-mix(in srgb, var(--arc-primary) 8%, white);
  --chapter-editor-width: 880px;
  display: flex;
  min-height: 0;
  max-width: none;
  width: 100%;
  margin: 0 auto;
}

.assistant-toggle {
  width: auto;
  min-width: 152px;
  gap: 10px;
  padding: 8px 12px;
}

.assistant-toggle-icons {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: inherit;
  flex-shrink: 0;
}

.assistant-toggle-copy {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
}

.assistant-toggle-label {
  color: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}

.assistant-toggle-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  color: #7a7f87;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  padding: 3px 7px;
}

.assistant-toggle-indicator {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.92);
  box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.14);
}

.assistant-toggle-indicator.active {
  background: #1f4ea3;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 18%, transparent);
}

.chapters-shell {
  display: grid;
  grid-template-columns: 304px minmax(0, 1fr);
  gap: 0;
  min-height: 0;
  height: 100%;
  flex: 1;
  align-items: stretch;
  border: 1px solid var(--chapter-border-strong);
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(247, 250, 253, 0.96));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.88),
    0 24px 60px rgba(15, 23, 42, 0.07);
  overflow: hidden;
}

.chapter-sidebar {
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--chapter-border-strong);
  background:
    linear-gradient(180deg, rgba(245, 248, 252, 0.96), rgba(240, 244, 249, 0.98));
  padding: 16px;
}

.chapter-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px;
  margin-bottom: 12px;
}

.chapter-side-head-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.chapter-side-head strong {
  display: block;
  color: var(--chapter-ink);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}

.chapter-back-button {
  flex-shrink: 0;
  border-color: rgba(218, 226, 239, 0.96);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 250, 253, 0.98));
  color: #4f5f79;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    0 10px 22px rgba(15, 23, 42, 0.05);
}

.chapter-back-button:hover {
  color: #1f4ea3;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    0 14px 28px rgba(59, 130, 246, 0.1);
}

.chapter-side-badge {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--chapter-border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: #667085;
  font-size: 11px;
  font-weight: 700;
  padding: 5px 10px;
}

.chapter-side-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.chapter-side-summary span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--chapter-border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.84);
  color: #475467;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  padding: 6px 9px;
  text-align: left;
}

.chapter-groups {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 4px;
}

.chapter-group {
  border: 1px solid var(--chapter-border);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.76);
  padding: 9px;
}

.chapter-group-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 4px 10px;
}

.chapter-group-head strong {
  display: block;
  color: var(--chapter-ink);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.chapter-group-head p {
  margin: 4px 0 0;
  color: #7a7f87;
  font-size: 11px;
  font-weight: 700;
}

.mini-icon {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--chapter-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
  color: #60656d;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.mini-icon:hover {
  border-color: var(--chapter-border-strong);
  background: #f7f7f7;
  color: var(--arc-primary);
}

.chapter-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chapter-pill {
  position: relative;
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.4);
  color: #404349;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  padding: 9px 10px;
  text-align: left;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.chapter-pill::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 999px;
  background: transparent;
  opacity: 0;
  transition: opacity 0.18s ease, background 0.18s ease;
}

.chapter-pill:hover {
  border-color: var(--chapter-border);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.04);
  transform: translateY(-1px);
}

.chapter-pill.dragging {
  opacity: 0.56;
}

.chapter-pill.drop-target {
  outline: 1px dashed color-mix(in srgb, var(--arc-primary) 42%, white);
  background: var(--chapter-accent-soft);
}

.chapter-pill.active {
  border-color: color-mix(in srgb, var(--arc-primary) 14%, var(--chapter-border));
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--arc-primary) 10%, white), rgba(255, 255, 255, 0.98));
  color: #1f4ea3;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    0 12px 26px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}

.chapter-pill.active::before {
  background: var(--arc-primary);
  opacity: 1;
  width: 4px;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}

.chapter-pill-grip {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: #c4cad4;
  flex-shrink: 0;
}

.chapter-pill:hover .chapter-pill-grip {
  color: #9ca3af;
}

.chapter-pill-label {
  display: block;
  overflow: hidden;
  color: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
}

.chapter-pill-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.chapter-pill-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.chapter-pill-meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #7a7f87;
  font-size: 11px;
  font-weight: 700;
}

.chapter-pill-current {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
  border-radius: 999px;
  border: 1px solid rgba(147, 197, 253, 0.92);
  background: linear-gradient(135deg, rgba(239, 246, 255, 0.98), rgba(219, 234, 254, 0.92));
  color: #1d4ed8;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
  padding: 0 8px;
}

.chapter-pill-dot {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: #d1d5db;
}

.chapter-pill-action {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #9aa0a6;
  flex-shrink: 0;
}

.chapter-pill:hover .chapter-pill-action {
  background: rgba(0, 0, 0, 0.05);
  color: #6b7280;
}

.chapters-shell.reading-mode {
  grid-template-columns: minmax(0, 1fr);
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.96), rgba(244, 247, 252, 0.94) 42%, rgba(236, 241, 247, 0.98));
}

.editor-shell {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.52), rgba(246, 249, 253, 0.94));
  padding: 0;
  overflow: hidden;
}

.editor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--chapter-border);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(246, 249, 253, 0.9));
}

.editor-context {
  display: flex;
  min-width: 0;
  flex: 1;
}

.editor-context-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.editor-context-main strong {
  color: #18212f;
  font-size: 16px;
  font-weight: 700;
}

.editor-context-main span {
  color: #667085;
  font-size: 12px;
  font-weight: 700;
}

.editor-context-main .progress-inline {
  color: #1f4ea3;
}

.save-status-inline {
  display: inline-flex;
  min-width: 56px;
  align-items: center;
  justify-content: center;
}

.editor-floating-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.editor-action-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.62);
}

.editor-action-group.emphasis {
  background: linear-gradient(180deg, rgba(248, 251, 255, 0.94), rgba(241, 246, 253, 0.92));
}

.editor-action-group.danger {
  background: rgba(255, 255, 255, 0.5);
}

.compact-utility-cluster {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.compact-back-button {
  width: auto;
  gap: 8px;
  min-height: 38px;
  border-color: transparent;
  border-radius: 999px;
  background: transparent;
  color: #475467;
  font-weight: 700;
  padding: 0 6px 0 2px;
  flex-shrink: 0;
  box-shadow: none;
}

.compact-back-button:hover {
  color: #1f4ea3;
  background: rgba(239, 246, 255, 0.72);
}

.compact-back-icon {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(218, 226, 239, 0.96);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 253, 0.98));
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
}

.compact-back-label {
  line-height: 1;
}

.compact-utility-switcher {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  border: 1px solid rgba(226, 232, 240, 0.96);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(247, 250, 253, 0.95));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 10px 24px rgba(15, 23, 42, 0.04);
  padding: 4px;
}

.compact-utility-tab {
  display: inline-flex;
  min-width: 92px;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  padding: 0 14px;
  white-space: nowrap;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.compact-utility-tab:hover {
  color: #1f4ea3;
  background: rgba(239, 246, 255, 0.82);
}

.compact-utility-tab.active {
  background: linear-gradient(135deg, rgba(232, 241, 255, 0.96), rgba(244, 248, 255, 0.98));
  color: #1f4ea3;
  box-shadow: 0 8px 18px rgba(59, 130, 246, 0.12);
}

.chapters-layout.compact-mode .chapters-shell {
  grid-template-columns: minmax(0, 1fr);
}

.chapters-layout.compact-mode .editor-topbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  padding: 16px 18px 14px;
}

.chapters-layout.compact-mode .editor-context {
  width: min(100%, 1180px);
  margin: 0 auto;
}

.chapters-layout.compact-mode .editor-context-main {
  gap: 8px;
}

.chapters-layout.compact-mode .editor-floating-actions {
  width: min(100%, 1180px);
  margin: 0 auto;
  justify-content: flex-start;
  gap: 10px;
}

.chapters-layout.compact-mode .editor-action-group {
  flex-wrap: wrap;
  max-width: 100%;
}

.chapters-layout.compact-mode .editor-manuscript {
  padding: 16px;
}

.chapters-layout.compact-mode .editor-manuscript-head,
.chapters-layout.compact-mode .editor-body,
.chapters-layout.compact-mode .editor-status {
  width: min(100%, 1180px);
  margin-inline: auto;
}

.chapters-layout.compact-mode .chapter-editor-instance {
  width: 100%;
  max-width: none;
  margin-right: 0;
}

.chapters-layout.compact-mode .editor-status {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.chapters-layout.compact-mode .chapter-title {
  font-size: clamp(24px, 3vw, 32px);
}

.editor-stage {
  display: flex;
  min-height: 0;
  flex: 1;
}

.editor-stage.reading-mode {
  padding: clamp(18px, 2.8vw, 34px);
}

.tool-badge {
  display: inline-flex;
  min-width: 30px;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--chapter-border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.88);
  color: #60656d;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.03);
  cursor: pointer;
  padding: 0;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.tool-badge:hover {
  border-color: var(--chapter-border-strong);
  background: rgba(255, 255, 255, 0.98);
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06);
}

.tool-badge.active {
  border-color: color-mix(in srgb, var(--arc-primary) 16%, var(--chapter-border));
  background: var(--chapter-accent-soft);
  color: #1f4ea3;
  box-shadow: 0 14px 28px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.tool-badge.neutral {
  background: var(--chapter-surface);
  color: #60656d;
}

.tool-badge.neutral.active {
  background: var(--chapter-accent-soft);
  color: #1f4ea3;
}

.tool-badge.neutral.active .assistant-toggle-state {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, white);
  background: rgba(255, 255, 255, 0.92);
  color: #3c63a9;
}

.tool-badge:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tool-badge:disabled:hover {
  background: var(--chapter-surface);
}

.tool-badge.danger:hover {
  background: #fff1f1;
  color: #dc2626;
}

.editor-manuscript {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  background:
    linear-gradient(180deg, rgba(249, 251, 254, 0.92), rgba(255, 255, 255, 0.98));
  padding: 18px;
}

.editor-manuscript.reading-mode {
  gap: 22px;
  padding: clamp(18px, 2.6vw, 32px);
  background:
    linear-gradient(180deg, rgba(248, 250, 253, 0.92), rgba(241, 245, 250, 0.98));
}

.editor-manuscript-head {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 4px;
}

.editor-meta-stack {
  min-width: 0;
  flex: 1;
}

.manuscript-heading {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.outline-origin-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  border: 1px solid rgba(226, 232, 240, 0.86);
  border-radius: 20px;
  background:
    radial-gradient(circle at right top, rgba(219, 234, 254, 0.28), transparent 42%),
    linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.98));
  padding: 14px 16px;
}

.outline-origin-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.outline-origin-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.outline-origin-kicker {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.outline-origin-link {
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 999px;
  background: white;
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
  cursor: pointer;
}

.outline-origin-link.secondary {
  border-color: rgba(191, 219, 254, 0.78);
  background: rgba(239, 246, 255, 0.94);
  color: #1d4ed8;
}

.outline-origin-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.outline-origin-title {
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 700;
}

.outline-origin-status {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  padding: 5px 9px;
}

.outline-origin-status.ghost {
  background: rgba(241, 245, 249, 0.96);
  color: var(--arc-text-hint);
}

.outline-origin-status.neutral {
  background: rgba(219, 234, 254, 0.9);
  color: #1d4ed8;
}

.outline-origin-status.primary {
  background: rgba(219, 234, 254, 0.98);
  color: #2563eb;
}

.outline-origin-status.success {
  background: rgba(220, 252, 231, 0.96);
  color: #15803d;
}

.outline-origin-summary {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.75;
}

.outline-origin-hint {
  margin: 0;
  color: var(--arc-text-hint);
  font-size: 11px;
  line-height: 1.7;
}

.manuscript-overline {
  color: #667085;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.chapter-title {
  width: 100%;
  border: none;
  background: transparent;
  color: #111827;
  font-size: clamp(28px, 3vw, 36px);
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 0;
  outline: none;
}

.chapter-title:hover {
  color: #202124;
}

.chapter-meta-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--chapter-border);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
}

.meta-chip.neutral {
  background: rgba(255, 255, 255, 0.88);
  color: #5f6368;
}

.meta-chip.ghost {
  background: rgba(244, 247, 252, 0.94);
  color: #5f6368;
}

.meta-chip.warning {
  background: #fff7da;
  color: #a16207;
}

.meta-chip.accent {
  background: var(--chapter-accent-soft);
  border-color: #b8cdf5;
  color: #1f4ea3;
}

.meta-chip.success {
  background: #ebf8ef;
  color: #15803d;
}

.reading-header {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 920px;
  margin: 0 auto;
}

.reading-header-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.reading-heading {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.reading-heading h1 {
  margin: 0;
  color: #111827;
  font-size: clamp(32px, 4vw, 44px);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.15;
}

.reading-heading p {
  max-width: 720px;
  margin: 0;
  color: #5f6b7a;
  font-size: 14px;
  line-height: 1.9;
}

.reading-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.reading-paper {
  width: min(100%, 920px);
  min-height: 100%;
  margin: 0 auto;
  border: 1px solid rgba(222, 228, 236, 0.96);
  border-radius: 30px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(252, 253, 255, 0.98));
  box-shadow:
    0 28px 60px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
  overflow: hidden;
}

.reading-content {
  min-height: clamp(520px, 72vh, 980px);
  max-height: 100%;
  overflow-y: auto;
  color: #2d3748;
  font-family: 'Georgia', 'Songti SC', 'Noto Serif SC', serif;
  font-size: clamp(18px, 1.2vw, 20px);
  line-height: 2;
  padding: clamp(30px, 4vw, 52px) clamp(24px, 5vw, 76px);
}

.reading-content :deep(h2),
.reading-content :deep(h3) {
  color: #18212f;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.35;
  margin: 1.4em 0 0.72em;
}

.reading-content :deep(h2) {
  font-size: 28px;
}

.reading-content :deep(h3) {
  font-size: 22px;
}

.reading-content :deep(p) {
  margin: 0 0 1.2em;
  text-align: justify;
  text-indent: 2em;
}

.reading-content :deep(ul),
.reading-content :deep(ol) {
  margin: 0 0 1.2em;
  padding-left: 1.6em;
}

.reading-content :deep(li) {
  margin-bottom: 0.55em;
}

.reading-content :deep(blockquote) {
  margin: 0 0 1.4em;
  border-left: 3px solid rgba(148, 163, 184, 0.7);
  color: #475569;
  padding-left: 16px;
}

.reading-footer {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  width: min(100%, 920px);
  margin: 0 auto;
}

.reading-nav {
  display: inline-flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(222, 228, 236, 0.96);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.88);
  color: #475467;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  padding: 14px 16px;
  text-align: left;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease,
    background 0.2s ease;
}

.reading-nav span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reading-nav:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, white);
  background: rgba(255, 255, 255, 0.96);
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.06);
}

.reading-nav.primary {
  background: linear-gradient(135deg, color-mix(in srgb, var(--arc-primary) 10%, white), rgba(255, 255, 255, 0.98));
  color: #1f4ea3;
}

.reading-nav:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.summary-card {
  border: 1px solid var(--chapter-border);
  border-radius: 18px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.9), rgba(247, 250, 253, 0.96));
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.04);
  padding: 14px;
}

.summary-card-label {
  display: inline-flex;
  margin-bottom: 8px;
  color: #667085;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.summary-card p {
  margin: 0;
  color: #4f545c;
  font-size: 13px;
  line-height: 1.75;
}

.inspiration-card {
  border: 1px solid color-mix(in srgb, var(--arc-primary) 10%, var(--chapter-border));
  border-radius: 22px;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--arc-primary) 10%, white), transparent 34%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(244, 248, 253, 0.98));
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.05);
  padding: 15px;
}

.inspiration-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.inspiration-card-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.inspiration-card-copy strong {
  color: #18212f;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
}

.inspiration-workbench-link {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #5b6472;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  padding: 8px 11px;
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    background 0.2s ease,
    transform 0.2s ease;
}

.inspiration-workbench-link:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, white);
  color: var(--arc-primary);
  transform: translateY(-1px);
}

.inspiration-focus-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.inspiration-focus-chip {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(219, 234, 254, 0.92);
  border-radius: 999px;
  background: rgba(239, 246, 255, 0.95);
  color: #2563eb;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  padding: 8px 11px;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    opacity 0.18s ease;
}

.inspiration-focus-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(59, 130, 246, 0.09);
}

.inspiration-focus-chip:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.inspiration-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.inspiration-item {
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  padding: 12px;
}

.inspiration-item-top,
.inspiration-tag-row,
.inspiration-item-actions {
  display: flex;
}

.inspiration-item-top {
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.inspiration-type,
.inspiration-source,
.inspiration-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.inspiration-type {
  background: rgba(239, 246, 255, 0.95);
  color: #2563eb;
  padding: 5px 9px;
}

.inspiration-source {
  background: rgba(241, 245, 249, 0.95);
  color: #64748b;
  padding: 5px 8px;
}

.inspiration-source.ai {
  background: rgba(224, 242, 254, 0.96);
  color: #0369a1;
}

.inspiration-item strong {
  display: block;
  color: #18212f;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
}

.inspiration-item p {
  margin: 8px 0 0;
  color: #4f5b67;
  font-size: 13px;
  line-height: 1.75;
}

.inspiration-tag-row {
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.inspiration-tag {
  background: rgba(248, 250, 252, 0.96);
  color: #64748b;
  padding: 4px 8px;
}

.inspiration-item-actions {
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.inspiration-action {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--arc-primary), color-mix(in srgb, var(--arc-primary) 76%, white));
  color: white;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
}

.inspiration-action.secondary {
  background: rgba(241, 245, 249, 0.96);
  color: #475569;
}

.inspiration-empty {
  margin-top: 14px;
  border: 1px dashed rgba(203, 213, 225, 0.95);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.78);
  padding: 14px;
}

.inspiration-empty p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.75;
}

.manuscript-divider {
  height: 1px;
  margin: 0 0 16px;
  background: linear-gradient(90deg, transparent, var(--chapter-border-strong), transparent);
}

.editor-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(248px, 300px);
  align-items: stretch;
  gap: 18px;
  flex: 1;
  min-height: 0;
  padding-top: 0;
}

.editor-body.compact {
  grid-template-columns: minmax(0, 1fr);
}

.editor-column {
  display: flex;
  align-items: stretch;
  min-height: 0;
  min-width: 0;
  margin: 0;
}

.editor-insights {
  min-width: 0;
}

.editor-insights-rail {
  position: sticky;
  top: 0;
  display: flex;
  max-height: calc(100vh - 320px);
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 4px;
}

.editor-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 14px;
  margin-top: 14px;
  border-top: 1px solid var(--chapter-border);
  color: #6a7078;
  font-size: 12px;
}

.editor-status-group {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.status-metric {
  color: #5f6368;
  font-weight: 600;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--chapter-border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: #4f545c;
  font-weight: 700;
  padding: 6px 10px;
}

.arc-version-modal :deep(.n-card__content) {
  max-height: min(72vh, 720px);
  overflow: hidden;
}

.compact-panel-modal :deep(.n-card__content) {
  max-height: min(76vh, 780px);
  overflow: hidden;
}

.compact-panel {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
}

.compact-panel-summary {
  margin-bottom: 0;
}

.compact-panel-groups,
.compact-panel-insights {
  min-height: 0;
  max-height: min(64vh, 680px);
  overflow-y: auto;
  padding-right: 6px;
}

.compact-panel-insights {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.version-list {
  display: flex;
  max-height: min(64vh, 620px);
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 6px;
}

.version-card {
  border: 1px solid var(--chapter-border);
  border-radius: 6px;
  background: var(--chapter-surface);
  padding: 14px;
}

.version-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
}

.version-card-head strong {
  display: block;
  color: #1f2937;
  font-size: 15px;
}

.version-card-head p {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 13px;
}

.version-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.version-words {
  color: #9ca3af;
  font-size: 12px;
  font-weight: 600;
}

.version-summary {
  margin: 0 0 10px;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.75;
}

.version-preview {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.8;
}

.version-empty {
  min-height: 220px;
}

</style>
