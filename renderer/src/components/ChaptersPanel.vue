<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
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
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { useAppStore } from '@/stores/app'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import type { ChapterDraft, ChapterVersion } from '@/types/app'
import type { DropdownOption, SelectOption } from 'naive-ui'

const props = defineProps<{
  searchQuery?: string
}>()

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
const saveState = ref<'typing' | 'idle'>('idle')
const editorVisible = ref(false)
const versionHistoryVisible = ref(false)
const isGeneratingInspiration = ref(false)
const readingMode = ref(false)
const draggingChapterId = ref<string | null>(null)
const dragTargetChapterId = ref<string | null>(null)
const chapterForm = reactive({
  volumeId: '',
  title: '',
  summary: '',
  status: 'draft' as ChapterDraft['status'],
  wordTarget: ''
})
let saveTimer: number | null = null

const chapterStatusOptions: SelectOption[] = [
  { label: '草稿中', value: 'draft' },
  { label: '待检查', value: 'review' },
  { label: '待润色', value: 'polish' },
  { label: '已定稿', value: 'final' }
]
const chapterMenuOptions: DropdownOption[] = [
  { key: 'edit', label: '编辑章节信息' },
  { key: 'delete', label: '删除章节' }
]
const volumeOptions = computed<SelectOption[]>(() =>
  appStore.outlineVolumes.map((volume, index) => ({
    label: formatVolumeLabel(volume, index, 'formal'),
    value: volume.id
  }))
)
const currentWordCount = computed(() => getChapterCharacterCount(appStore.selectedChapter?.content ?? ''))
const currentPlainContent = computed(() => getPlainTextFromEditorContent(appStore.selectedChapter?.content ?? '').trim())
const currentChapterStatusLabel = computed(() => {
  const status = appStore.selectedChapter?.status ?? 'draft'
  return chapterStatusOptions.find((option) => option.value === status)?.label ?? '草稿中'
})
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
const currentChapterVersions = computed(() =>
  appStore.selectedChapter ? appStore.getChapterVersions(appStore.selectedChapter.id) : []
)
const selectedChapterIndex = computed(() => {
  const currentId = appStore.selectedChapterId
  const index = appStore.chapters.findIndex((chapter) => chapter.id === currentId)
  return index >= 0 ? index + 1 : 1
})
const selectedChapterIndexInVolume = computed(() => {
  const selectedVolumeId = appStore.selectedChapter?.volumeId
  if (!selectedVolumeId || !appStore.selectedChapterId) {
    return 1
  }

  const chaptersInVolume = appStore.chapters.filter((chapter) => chapter.volumeId === selectedVolumeId)
  const index = chaptersInVolume.findIndex((chapter) => chapter.id === appStore.selectedChapterId)
  return index >= 0 ? index + 1 : 1
})
const currentVolumeIndex = computed(() =>
  appStore.outlineVolumes.findIndex((volume) => volume.id === appStore.selectedChapterVolume?.id)
)
const currentVolumeLabel = computed(() => {
  if (!appStore.selectedChapterVolume) {
    return '未分卷'
  }

  return formatVolumeLabel(appStore.selectedChapterVolume, Math.max(currentVolumeIndex.value, 0), 'compact')
})
const currentChapterTitle = computed(() => appStore.selectedChapter?.title || '未命名章节')
const chapterCountLabel = computed(() => `${appStore.chapters.length} 个章节`)
const volumeCountLabel = computed(() => `${appStore.outlineVolumes.length} 个分卷`)
const currentTargetWordCount = computed(() => {
  const wordTarget = appStore.selectedChapter?.wordTarget ?? ''
  const wanMatch = wordTarget.match(/(\d+(?:\.\d+)?)\s*万/)
  if (wanMatch) {
    return Math.round(Number(wanMatch[1]) * 10000)
  }

  const digitMatch = wordTarget.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)
  return digitMatch ? Math.round(Number(digitMatch[1])) : 0
})
const currentProgressPercent = computed(() => {
  if (!currentTargetWordCount.value) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round((currentWordCount.value / currentTargetWordCount.value) * 100)))
})
const currentSummaryText = computed(() => appStore.selectedChapter?.summary?.trim() || '待补充章节摘要')
const chapterInspirationFocuses = ['场景火花', '剧情转折', '人物动机'] as const
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
const saveStatusText = computed(() => {
  if (saveState.value === 'typing') {
    return '正在整理草稿...'
  }

  if (appStore.isPersistencePending) {
    return appStore.isLiveAutoSave ? '自动保存排队中...' : `已加入自动保存队列（${appStore.autoSaveIntervalLabel}）`
  }

  return '已保存草稿'
})
const saveStatusCompactText = computed(() => {
  if (saveState.value === 'typing') {
    return '整理中'
  }

  if (appStore.isPersistencePending) {
    return appStore.isLiveAutoSave ? '排队保存' : '自动保存中'
  }

  return '已保存'
})
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
const totalVisibleChapters = computed(() => filteredChapterGroups.value.reduce((count, group) => count + group.items.length, 0))
const selectedChapterArrayIndex = computed(() => appStore.chapters.findIndex((chapter) => chapter.id === appStore.selectedChapterId))
const previousChapter = computed(() =>
  selectedChapterArrayIndex.value > 0 ? appStore.chapters[selectedChapterArrayIndex.value - 1] : null
)
const nextChapter = computed(() =>
  selectedChapterArrayIndex.value >= 0 && selectedChapterArrayIndex.value < appStore.chapters.length - 1
    ? appStore.chapters[selectedChapterArrayIndex.value + 1]
    : null
)
const readingContentHtml = computed(() =>
  ensureEditorHtmlContent(appStore.selectedChapter?.content?.trim() ? appStore.selectedChapter.content : '<p>当前章节还没有正文内容。</p>')
)
const readingWordCountLabel = computed(() => `${currentWordCount.value} 字`)
const readingProgressLabel = computed(() =>
  currentTargetWordCount.value ? `完成度 ${currentProgressPercent.value}%` : '自由字数模式'
)
const readingLeadText = computed(() => {
  if (appStore.selectedChapter?.summary?.trim()) {
    return appStore.selectedChapter.summary.trim()
  }

  return getChapterPreviewText(appStore.selectedChapter?.content ?? '', '这一章还没有写下摘要，可以先从成稿阅读中检查节奏。').slice(0, 120)
})

function toggleReadingMode(): void {
  readingMode.value = !readingMode.value
}

function openAdjacentChapter(offset: -1 | 1): void {
  const target = offset < 0 ? previousChapter.value : nextChapter.value
  if (!target) {
    return
  }

  appStore.selectChapter(target.id)
}

async function saveCurrentVersion(): Promise<void> {
  const result = await appStore.saveCurrentChapterVersion()
  if (!result.success) {
    message.error(result.error ?? '章节版本保存失败')
    return
  }

  message.success('已生成当前章节的历史版本快照')
}

function openVersionHistory(): void {
  versionHistoryVisible.value = true
}

function openInspirationWorkbench(): void {
  appStore.setPanel('inspiration')
}

function sendInspirationToAssistant(entry: { type: string; title: string; content: string; tags: string[] }, mode: 'expand' | 'continue' = 'expand'): void {
  const prompt =
    mode === 'continue'
      ? `请基于这张灵感卡片，紧接当前章节正文继续往后写一段，保持当前人物状态、叙事语气和情节连续性。\n\n灵感类型：${entry.type}\n灵感标题：${entry.title}\n灵感内容：${entry.content}\n灵感标签：${entry.tags.join('、') || '暂无'}`
      : `请基于这张灵感卡片，为当前章节补一段可直接使用的桥段、台词、动作或场景描写，优先让它自然落进本章。\n\n灵感类型：${entry.type}\n灵感标题：${entry.title}\n灵感内容：${entry.content}\n灵感标签：${entry.tags.join('、') || '暂无'}`

  appStore.queueAssistantPrompt(prompt, mode === 'continue' ? '灵感续写' : '灵感扩写')
  message.success(mode === 'continue' ? '灵感已发送给 AI 助手继续续写' : '灵感已发送给 AI 助手继续扩写')
}

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

function openChapterMetaEditor(chapter?: ChapterDraft | null): void {
  if (!chapter) {
    return
  }

  chapterForm.volumeId = chapter.volumeId
  chapterForm.title = chapter.title
  chapterForm.summary = chapter.summary
  chapterForm.status = chapter.status
  chapterForm.wordTarget = chapter.wordTarget
  editorVisible.value = true
}

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

function getVersionWordCount(version: ChapterVersion): number {
  return getChapterCharacterCount(version.content)
}

function buildVersionPreview(version: ChapterVersion): string {
  return getChapterPreviewText(version.content, '该版本暂无正文内容。').slice(0, 120)
}

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
    volumeId: chapterForm.volumeId,
    title: chapterForm.title,
    summary: chapterForm.summary,
    status: chapterForm.status,
    wordTarget: chapterForm.wordTarget
  })
  editorVisible.value = false
  message.success('章节信息已更新')
}

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

function handleDragStart(chapterId: string, event: DragEvent): void {
  draggingChapterId.value = chapterId
  dragTargetChapterId.value = chapterId
  event.dataTransfer?.setData('text/plain', chapterId)
  event.dataTransfer?.setDragImage?.(event.currentTarget as Element, 18, 18)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function handleDragOver(chapterId: string, event: DragEvent): void {
  event.preventDefault()
  dragTargetChapterId.value = chapterId
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

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

function resetDragState(): void {
  draggingChapterId.value = null
  dragTargetChapterId.value = null
}

watch(
  () => [appStore.selectedChapter?.title, appStore.selectedChapter?.content],
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

onBeforeUnmount(() => {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
  }
})
</script>

<template>
  <section class="chapters-layout" :class="{ 'reading-mode': readingMode }">
    <div class="chapters-shell" :class="{ 'reading-mode': readingMode }">
      <aside v-if="!readingMode" class="chapter-sidebar">
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
                  <span class="chapter-pill-label">{{ chapter.title }}</span>
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
              <span class="meta-chip neutral">目标 {{ currentTargetWordCount || '自由字数' }}</span>
              <span class="meta-chip ghost">本卷第 {{ selectedChapterIndexInVolume }} 章</span>
              <span class="meta-chip ghost">全书第 {{ selectedChapterIndex }} 章</span>
            </div>
          </div>

          <div class="editor-floating-actions">
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
                      <PanelRightClose v-if="appStore.aiVisible" :size="14" />
                      <PanelRightOpen v-else :size="14" />
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
              </div>
            </div>

            <div class="manuscript-divider"></div>

            <div class="editor-body">
              <div class="editor-column">
                <RichChapterEditor
                  :chapter-id="appStore.selectedChapter?.id ?? ''"
                  :model-value="appStore.selectedChapter?.content ?? ''"
                  :insertion-request="appStore.pendingChapterInsertion"
                  @update:model-value="appStore.updateChapterContent"
                  @consume-insertion="appStore.consumeChapterInsertion"
                  @selection-change="appStore.updateChapterSelection"
                />
              </div>

              <aside class="editor-insights">
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
  box-shadow: 0 10px 20px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.chapter-pill.active::before {
  background: var(--arc-primary);
  opacity: 1;
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

.chapter-pill-meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #7a7f87;
  font-size: 11px;
  font-weight: 700;
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

@media (max-width: 1500px) {
  .chapters-shell {
    grid-template-columns: minmax(0, 1fr);
    min-height: auto;
  }

  .chapter-groups {
    max-height: 280px;
  }

  .chapter-sidebar {
    border-right: none;
    border-bottom: 1px solid var(--chapter-border-strong);
  }

  .editor-manuscript-head {
    flex-direction: column;
  }

  .editor-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .editor-insights-rail {
    position: static;
    max-height: none;
    overflow: visible;
  }

  .reading-content {
    min-height: clamp(480px, 65vh, 860px);
  }
}

@media (max-width: 720px) {
  .chapter-side-summary {
    grid-template-columns: 1fr;
  }

  .chapter-group-head,
  .editor-topbar,
  .version-card-head {
    flex-direction: column;
  }

  .editor-shell {
    padding: 0;
  }

  .editor-manuscript {
    padding: 20px 18px;
  }

  .editor-body {
    gap: 14px;
  }

  .editor-action-group {
    width: auto;
    max-width: 100%;
  }

  .editor-status {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .editor-stage.reading-mode,
  .editor-manuscript.reading-mode {
    padding: 14px;
  }

  .reading-content {
    min-height: 56vh;
    padding: 22px 18px 28px;
    font-size: 16px;
    line-height: 1.9;
  }

  .reading-heading h1 {
    font-size: 30px;
  }

  .reading-footer {
    grid-template-columns: 1fr;
  }

  .editor-floating-actions {
    gap: 8px;
    width: 100%;
    justify-content: flex-start;
  }

  .assistant-toggle {
    min-width: 0;
  }
}
</style>
