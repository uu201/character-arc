<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlignLeft, BookOpen, Check, ChevronDown, ChevronRight, Eraser, Folder, FocusIcon, History, Maximize2, Menu, MessageSquareQuote, Minus, Minimize2, MoreHorizontal, Plus, RefreshCw, ShieldAlert, Sparkles, Type, Wand2, X } from 'lucide-vue-next'
import { NAlert, NDropdown, NTag, useMessage } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import SimpleChapterEditor from './SimpleChapterEditor.vue'
import type { ChapterRecoverySnapshot } from './SimpleChapterEditor.vue'
import ChapterVersionDialog from './ChapterVersionDialog.vue'
import EditorFindBar from './EditorFindBar.vue'
import EditorContextMenu from './EditorContextMenu.vue'
import ChapterReferencePanel from './ChapterReferencePanel.vue'
import { getChapterCharacterCount } from '@/features/chapters/editorContent'
import { useChapterVersionAutosave } from '@/features/chapters/useChapterVersionAutosave'
import { editorFontOptions, getEditorFontOption, isEditorFont } from '@/features/chapters/editorTypography'
import { formatChapterWordTargetLabel, parseChapterWordTarget } from '@/features/chapters/wordTarget'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import { useAppStore } from '@/stores/app'
import type { ChapterRevisionAttrs } from '@/features/chapters/revisionMark'

const { aiOpen, focusMode, referenceOpen, showSidebarToggle, revisionContext = {} } = defineProps<{
  aiOpen: boolean
  focusMode: boolean
  referenceOpen: boolean
  showSidebarToggle?: boolean
  revisionContext?: Record<string, {
    turnIndex: number
    prompt: string
    changeIndex: number
    changeTotal: number
  }>
}>()

const emit = defineEmits<{
  toggleAi: []
  toggleFocus: []
  toggleReference: []
  toggleSidebar: []
  selectionAction: [action: string, text: string]
  generateDraft: []
}>()

const appStore = useAppStore()
const message = useMessage()

const FONT_LEVELS = [14, 15, 16, 17, 18, 20, 22]
const fontIdx = ref(3)
const fontSize = computed(() => FONT_LEVELS[fontIdx.value])
const versionDialogVisible = ref(false)

const currentEditorFont = computed(() => getEditorFontOption(appStore.appSettings.editorFont))
const editorFontMenuOptions = computed<DropdownOption[]>(() =>
  editorFontOptions.map((option) => ({
    key: option.id,
    label: () => h(
      'span',
      {
        style: {
          display: 'inline-flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '24px',
          width: '170px',
          fontFamily: option.fontFamily
        }
      },
      [
        h('span', option.label),
        h('span', { style: { color: 'var(--arc-text-hint)', fontSize: '12px' } }, '“引号”')
      ]
    ),
    icon: () => h(Check, {
      size: 14,
      style: { opacity: option.id === currentEditorFont.value.id ? '1' : '0' }
    })
  }))
)

function selectEditorFont(key: string | number): void {
  if (isEditorFont(key)) {
    appStore.updateAppSetting('editorFont', key)
  }
}

function stepFont(delta: number): void {
  const next = Math.max(0, Math.min(FONT_LEVELS.length - 1, fontIdx.value + delta))
  fontIdx.value = next
}

const currentChapter = computed(() => appStore.selectedChapter)

useChapterVersionAutosave({
  getSnapshot: () => {
    const chapter = currentChapter.value
    if (!chapter) return null
    return {
      chapterId: chapter.id,
      signature: JSON.stringify([
        chapter.title,
        chapter.summary,
        chapter.status,
        chapter.wordTarget,
        chapter.content
      ])
    }
  },
  saveVersion: async (chapterId) => {
    const result = await appStore.saveCurrentChapterVersion(chapterId)
    if (!result.success) throw new Error(result.error ?? '自动保存历史版本失败')
  }
})

const toolbarMoreOptions = computed<DropdownOption[]>(() => [
  {
    key: 'format',
    label: '一键排版',
    icon: () => h(AlignLeft, { size: 14 }),
    disabled: !currentChapter.value
  },
  {
    key: 'focus',
    label: '专注模式 (F11)',
    icon: () => h(FocusIcon, { size: 14 })
  },
  {
    key: 'history',
    label: '历史版本',
    icon: () => h(History, { size: 14 }),
    disabled: !currentChapter.value
  }
])

function selectToolbarMoreAction(key: string | number): void {
  if (key === 'format') {
    formatCurrentChapter()
  } else if (key === 'focus') {
    emit('toggleFocus')
  } else if (key === 'history') {
    versionDialogVisible.value = true
  }
}

const currentVolume = computed(() => appStore.selectedChapterVolume)
const currentVolumeIndex = computed(() =>
  appStore.outlineVolumes.findIndex((v) => v.id === currentVolume.value?.id)
)
const volumeLabel = computed(() =>
  currentVolume.value
    ? formatVolumeLabel(currentVolume.value, Math.max(currentVolumeIndex.value, 0), 'compact')
    : '未分卷'
)

const wordCount = computed(() => {
  const chapter = currentChapter.value
  if (!chapter) return 0
  return chapter.contentLoaded === false
    ? Math.max(0, Number(chapter.contentLength ?? 0))
    : getChapterCharacterCount(chapter.content ?? '')
})
const targetWords = computed(() => parseChapterWordTarget(currentChapter.value?.wordTarget))
const progressPercent = computed(() => {
  if (!targetWords.value) return 0
  return Math.min(100, Math.round((wordCount.value / targetWords.value) * 100))
})

const saveStatusText = computed(() => {
  if (appStore.persistenceError) return '保存失败'
  if (appStore.isPersisting) return '正在保存'
  if (appStore.isPersistencePending) return '等待自动保存'
  return '已保存'
})

const chapterIndex = computed(() => {
  const i = appStore.chapters.findIndex((c) => c.id === currentChapter.value?.id)
  return i >= 0 ? i + 1 : 1
})

const postGenerationIssues = computed(() => {
  const chapterId = currentChapter.value?.id ?? ''
  return chapterId ? appStore.getChapterPostGenerationIssues(chapterId) : null
})

const postGenerationIssueType = computed(() =>
  postGenerationIssues.value?.issues.some((issue) => issue.severity === 'error') ? 'error' : 'warning'
)

function dismissPostGenerationIssues(): void {
  const chapterId = currentChapter.value?.id ?? ''
  if (!chapterId) {
    return
  }
  appStore.dismissChapterPostGenerationIssues(chapterId)
}

const selToolbarVisible = ref(false)
const selToolbarTop = ref(0)
const selToolbarLeft = ref(0)
// 在 selectionchange 时缓存选区文本——mousedown 时浏览器会清除 window.getSelection()，
// click 时用这个缓存值兜底，避免 handleSelAction 读到空选区。
let cachedSelectionText = ''
const scrollRef = ref<HTMLDivElement | null>(null)
const editorRef = ref<InstanceType<typeof SimpleChapterEditor> | null>(null)
const findBarRef = ref<InstanceType<typeof EditorFindBar> | null>(null)
const findBarVisible = ref(false)
const findInitialTerm = ref('')
const recoverySnapshot = ref<ChapterRecoverySnapshot | null>(null)
const revisionPopup = ref<{
  revision: ChapterRevisionAttrs
  x: number
  y: number
} | null>(null)
const revisionCardRef = ref<HTMLElement | null>(null)
const REVISION_COLORS = ['#FFE58F', '#BAE7FF', '#B7EB8F', '#D3ADF7', '#FFD591', '#87E8DE']
let stopRevisionDrag: (() => void) | null = null
// editorRef.value.editor 通过模板 ref 自动 unwrap 为 Editor | undefined
const tiptapEditor = computed(() => (editorRef.value as any)?.editor ?? null)
const activeRevisionContext = computed(() => {
  const revisionId = revisionPopup.value?.revision.id
  return revisionId ? revisionContext[revisionId] : undefined
})

function applyManualRevision(color: string): void {
  editorRef.value?.applyManualRevision(color)
  selToolbarVisible.value = false
}

function clearSelectedRevision(): void {
  editorRef.value?.clearSelectedRevision()
  selToolbarVisible.value = false
}

function clampRevisionPopupToViewport(): void {
  if (!revisionPopup.value) return
  const margin = 8
  const rect = revisionCardRef.value?.getBoundingClientRect()
  const width = rect?.width ?? Math.min(340, window.innerWidth - margin * 2)
  const height = rect?.height ?? Math.min(260, window.innerHeight - margin * 2)
  revisionPopup.value = {
    ...revisionPopup.value,
    x: Math.max(margin, Math.min(revisionPopup.value.x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(revisionPopup.value.y, window.innerHeight - height - margin))
  }
}

function handleRevisionClick(revision: ChapterRevisionAttrs, x: number, y: number): void {
  revisionPopup.value = {
    revision,
    x: x + 10,
    y: y + 10
  }
  nextTick(clampRevisionPopupToViewport)
}

function startRevisionDrag(event: PointerEvent): void {
  if (!revisionPopup.value || (event.target as HTMLElement | null)?.closest('button')) return
  event.preventDefault()
  stopRevisionDrag?.()
  const startX = event.clientX
  const startY = event.clientY
  const originX = revisionPopup.value.x
  const originY = revisionPopup.value.y

  const move = (moveEvent: PointerEvent): void => {
    if (!revisionPopup.value) return
    revisionPopup.value = {
      ...revisionPopup.value,
      x: originX + moveEvent.clientX - startX,
      y: originY + moveEvent.clientY - startY
    }
    clampRevisionPopupToViewport()
  }
  const stop = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    if (stopRevisionDrag === stop) stopRevisionDrag = null
  }
  stopRevisionDrag = stop
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}

function resolveRevision(): void {
  const id = revisionPopup.value?.revision.id
  if (!id) return
  editorRef.value?.clearRevision(id)
  revisionPopup.value = null
  message.success('已完成精修并清除颜色标注')
}

function formatRevisionTime(value: string): string {
  if (!value) return '时间未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN')
}

function openFindBar(): void {
  const editor = tiptapEditor.value
  let preset = ''
  if (editor) {
    const { from, to } = editor.state.selection
    if (from !== to) {
      const text = editor.state.doc.textBetween(from, to, '\n').trim()
      // 选区单行才预填，多段选区跳过
      if (text && !text.includes('\n')) preset = text
    }
  }
  findInitialTerm.value = preset
  if (findBarVisible.value) {
    // 已打开：强制用选区文本覆盖（如果没选区，则保留原搜索词）
    if (preset) {
      ;(findBarRef.value as any)?.setTerm(preset)
    } else {
      ;(findBarRef.value as any)?.focus()
    }
  } else {
    findBarVisible.value = true
  }
}

const ctxMenuVisible = ref(false)
const ctxMenuX = ref(0)
const ctxMenuY = ref(0)
const ctxMenuHasSelection = ref(false)

function handleEditorContextMenu(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  // 仅在 ProseMirror 编辑区域内拦截
  if (!target?.closest('.ProseMirror')) return
  e.preventDefault()
  const editor = tiptapEditor.value
  const sel = editor?.state.selection
  ctxMenuHasSelection.value = !!sel && sel.from !== sel.to
  ctxMenuX.value = e.clientX
  ctxMenuY.value = e.clientY
  ctxMenuVisible.value = true
}

async function handleCtxAction(id: string): Promise<void> {
  const editor = tiptapEditor.value
  if (!editor) return
  if (id === 'copy') {
    const { from, to } = editor.state.selection
    if (from === to) return
    const text = editor.state.doc.textBetween(from, to, '\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 剪贴板被拒绝时回退到执行命令
      document.execCommand('copy')
    }
  } else if (id === 'cut') {
    const { from, to } = editor.state.selection
    if (from === to) return
    const text = editor.state.doc.textBetween(from, to, '\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      document.execCommand('cut')
      return
    }
    editor.chain().focus().deleteSelection().run()
  } else if (id === 'paste') {
    try {
      const text = await navigator.clipboard.readText()
      if (text) editor.chain().focus().insertContent(text).run()
    } catch {
      document.execCommand('paste')
    }
  } else if (id === 'paste-plain') {
    try {
      const text = await navigator.clipboard.readText()
      if (text) editor.chain().focus().insertContent(text).run()
    } catch {
      /* ignore */
    }
  } else if (id === 'select-all') {
    editor.chain().focus().selectAll().run()
  } else if (id === 'find') {
    openFindBar()
  }
}

function handleSelectionChange(): void {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    selToolbarVisible.value = false
    cachedSelectionText = ''
    return
  }
  const range = sel.getRangeAt(0)
  const scrollEl = scrollRef.value
  if (!scrollEl || !scrollEl.contains(range.commonAncestorContainer)) {
    selToolbarVisible.value = false
    cachedSelectionText = ''
    return
  }
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    selToolbarVisible.value = false
    cachedSelectionText = ''
    return
  }
  // 在工具栏显示前缓存选区文本，mousedown 时浏览器会清除 window.getSelection()
  cachedSelectionText = sel.toString().trim()
  const scrollRect = scrollEl.getBoundingClientRect()
  const toolbarH = 36
  const gap = 6
  let top = rect.top - toolbarH - gap
  if (top < scrollRect.top) top = rect.bottom + gap
  const toolbarW = Math.max(120, Math.min(530, scrollRect.width - 8, window.innerWidth - 16))
  let left = rect.left + rect.width / 2
  const minLeft = scrollRect.left + toolbarW / 2 + 4
  const maxLeft = scrollRect.right - toolbarW / 2 - 4
  if (left < minLeft) left = minLeft
  else if (left > maxLeft) left = maxLeft
  selToolbarTop.value = top
  selToolbarLeft.value = left
  selToolbarVisible.value = true
}

function handleSelAction(action: string): void {
  // 优先读实时选区，若浏览器已因 mousedown 清除则用缓存值兜底
  const sel = window.getSelection()
  const text = sel?.toString().trim() || cachedSelectionText
  cachedSelectionText = ''
  if (!text) return
  selToolbarVisible.value = false
  emit('selectionAction', action, text)
}

function handleMouseDown(e: MouseEvent): void {
  const toolbar = document.querySelector('.arc-sel-toolbar')
  if (toolbar?.contains(e.target as Node)) return
  const revisionCard = document.querySelector('.arc-revision-card')
  if (revisionCard?.contains(e.target as Node)) return
  selToolbarVisible.value = false
  revisionPopup.value = null
}

function handleGlobalKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && revisionPopup.value) {
    revisionPopup.value = null
    return
  }
  const commandKey = e.ctrlKey || e.metaKey
  if (commandKey && e.key.toLowerCase() === 'f') {
    const scrollEl = scrollRef.value
    if (!scrollEl) return
    // 仅当焦点在当前编辑器区域内时才拦截
    const active = document.activeElement
    const inEditor = scrollEl.contains(active) || findBarVisible.value
    if (!inEditor) return
    e.preventDefault()
    openFindBar()
    return
  }
  if (commandKey && e.altKey && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    emit('toggleAi')
    return
  }
  if (commandKey && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void appStore.saveCurrentChapterVersion().then((result) => {
      if (!result.success) {
        message.error(result.error ?? '保存版本失败')
      } else if (result.created === false) {
        message.success('工作区已保存，历史版本无变化')
      } else {
        message.success('工作区和历史版本已保存')
      }
    })
  }
}

function restoreRecovery(): void {
  editorRef.value?.restoreRecovery()
  recoverySnapshot.value = null
  message.success('已恢复异常退出前的本地草稿')
}

function discardRecovery(): void {
  editorRef.value?.discardRecovery()
  recoverySnapshot.value = null
}

function formatCurrentChapter(): void {
  const result = editorRef.value?.formatDocument()
  if (result === 'empty' || !result) {
    message.warning('当前章节还没有可排版的正文')
    return
  }
  if (result === 'unchanged') {
    message.info('当前正文已符合：首行缩进 2 字，段间空 1 行')
    return
  }
  message.success('一键排版完成：首行缩进 2 字，段间空 1 行')
}

watch(
  () => currentChapter.value?.id,
  () => {
    stopRevisionDrag?.()
    revisionPopup.value = null
    selToolbarVisible.value = false
  }
)

onMounted(() => {
  document.addEventListener('selectionchange', handleSelectionChange)
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('resize', clampRevisionPopupToViewport)
})
onBeforeUnmount(() => {
  stopRevisionDrag?.()
  document.removeEventListener('selectionchange', handleSelectionChange)
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('resize', clampRevisionPopupToViewport)
})
</script>

<template>
  <main class="editor-pane">
    <header v-if="!focusMode" class="ep-header">
      <button v-if="showSidebarToggle" class="toolbtn sidebar-toggle" @click="emit('toggleSidebar')">
        <Menu :size="14" />
      </button>
      <div class="breadcrumb">
        <Folder :size="13" />
        <span>{{ volumeLabel }}</span>
        <ChevronRight :size="12" />
        <span class="crumb-current">{{ currentChapter?.title || '未命名章节' }}</span>
      </div>

      <div class="ep-actions">
        <span class="save-indicator">
          <span
            class="dot"
            :class="{
              pending: appStore.isPersistencePending && !appStore.persistenceError,
              failed: Boolean(appStore.persistenceError)
            }"
          />
          {{ saveStatusText }}
        </span>
        <span class="divider" />

        <n-dropdown
          trigger="click"
          placement="bottom-end"
          :options="editorFontMenuOptions"
          @select="selectEditorFont"
        >
          <button class="toolbtn font-picker-tool" :title="`正文字体：${currentEditorFont.label}`">
            <Type :size="13" />
            <span class="font-picker-label">{{ currentEditorFont.shortLabel }}</span>
            <ChevronDown :size="11" />
          </button>
        </n-dropdown>

        <div class="font-stepper">
          <button @click="stepFont(-1)"><Minus :size="11" /></button>
          <span class="level">{{ fontSize }}px</span>
          <button @click="stepFont(1)"><Plus :size="11" /></button>
        </div>

        <button class="toolbtn draft-action" :disabled="!currentChapter" @click="emit('generateDraft')">
          <Wand2 :size="13" />
          <span>生成初稿</span>
        </button>

        <button
          class="toolbtn reference-tool"
          :class="{ active: referenceOpen }"
          :disabled="!currentChapter"
          title="查看本章关联的世界观、人物和组织设定"
          @click="emit('toggleReference')"
        >
          <BookOpen :size="13" />
          <span>设定参考</span>
        </button>

        <n-dropdown
          trigger="click"
          placement="bottom-end"
          :options="toolbarMoreOptions"
          @select="selectToolbarMoreAction"
        >
          <button class="toolbtn more-tool" title="更多章节工具">
            <MoreHorizontal :size="15" />
            <span>更多</span>
          </button>
        </n-dropdown>

        <button class="toolbtn ai-action" :class="{ primary: !aiOpen, active: aiOpen }" @click="emit('toggleAi')">
          <Sparkles :size="13" />
          <span>AI 助理</span>
        </button>
      </div>
    </header>

    <button
      v-if="focusMode"
      type="button"
      class="focus-reference-toggle"
      :class="{ active: referenceOpen }"
      :aria-label="referenceOpen ? '关闭设定参考' : '打开设定参考'"
      :title="referenceOpen ? '关闭设定参考' : '设定参考'"
      @click="emit('toggleReference')"
    >
      <BookOpen :size="15" />
    </button>

    <div ref="scrollRef" class="ep-scroll arc-scrollbar" @contextmenu="handleEditorContextMenu">
      <div class="ep-canvas" :style="{ fontSize: fontSize + 'px' }">
        <div v-if="!currentChapter" class="ep-empty">
          请在左侧选择一个章节，或新建一个章节开始写作
        </div>
        <template v-else>
          <input
            class="ep-title"
            :value="currentChapter.title"
            placeholder="章节标题"
            @change="(e) => appStore.updateChapterTitle((e.target as HTMLInputElement).value)"
          />

          <div class="ep-meta-row">
            <n-tag size="small" :bordered="false">{{ wordCount.toLocaleString() }} 字</n-tag>
            <n-tag size="small" :bordered="false">目标 {{ formatChapterWordTargetLabel(currentChapter.wordTarget) }}</n-tag>
            <span v-if="currentChapter.summary" class="meta-summary">大纲：{{ currentChapter.summary }}</span>
          </div>

          <n-alert
            v-if="postGenerationIssues?.issues.length"
            :type="postGenerationIssueType"
            :show-icon="false"
            closable
            class="ep-postgen-alert"
            @close="dismissPostGenerationIssues"
          >
            <template #header>
              本章正文已生成，但后处理没有完全完成
            </template>
            <div class="ep-postgen-copy">
              你可以继续写作；如果依赖世界状态连续性或语义检索，建议稍后重试状态回填或重新触发一次生成。
            </div>
            <ul class="ep-postgen-list">
              <li
                v-for="(issue, idx) in postGenerationIssues.issues"
                :key="`${issue.stage}-${idx}-${issue.message}`"
              >
                {{ issue.message }}
              </li>
            </ul>
          </n-alert>

          <div v-if="recoverySnapshot" class="recovery-banner">
            <ShieldAlert :size="16" />
            <div class="recovery-copy">
              <strong>发现未同步的本地草稿</strong>
              <span>保存于 {{ new Date(recoverySnapshot.savedAt).toLocaleString('zh-CN') }}</span>
            </div>
            <button type="button" @click="discardRecovery">忽略</button>
            <button type="button" class="primary" @click="restoreRecovery">恢复草稿</button>
          </div>

          <div v-if="appStore.selectedChapterContentLoading" class="ep-empty">
            正在加载章节正文…
          </div>
          <SimpleChapterEditor
            v-else
            ref="editorRef"
            class="ep-editor"
            :style="{ fontFamily: currentEditorFont.fontFamily }"
            :chapter-id="currentChapter.id"
            :model-value="currentChapter.content ?? ''"
            :insertion-request="appStore.pendingChapterInsertion"
            @update:model-value="(value, chapterId) => appStore.updateChapterContent(value, chapterId)"
            @consume-insertion="appStore.consumeChapterInsertion"
            @selection-change="appStore.updateChapterSelection"
            @recovery-available="recoverySnapshot = $event"
            @revision-click="handleRevisionClick"
          />
        </template>
      </div>
    </div>

    <ChapterReferencePanel v-if="referenceOpen" @close="emit('toggleReference')" />

    <EditorFindBar
      ref="findBarRef"
      :visible="findBarVisible"
      :editor="tiptapEditor"
      :initial-term="findInitialTerm"
      :scroll-container="scrollRef"
      @close="findBarVisible = false"
    />

    <EditorContextMenu
      :visible="ctxMenuVisible"
      :x="ctxMenuX"
      :y="ctxMenuY"
      :has-selection="ctxMenuHasSelection"
      @close="ctxMenuVisible = false"
      @action="handleCtxAction"
    />

    <Teleport to="body">
      <Transition name="arc-sel-fade">
        <div
          v-if="selToolbarVisible"
          class="arc-sel-toolbar"
          :style="{ top: selToolbarTop + 'px', left: selToolbarLeft + 'px' }"
        >
          <button class="arc-sel-btn" @click="handleSelAction('润色')">
            <Wand2 :size="12" /> 润色
          </button>
          <button class="arc-sel-btn" @click="handleSelAction('改写')">
            <RefreshCw :size="12" /> 改写
          </button>
          <button class="arc-sel-btn" @click="handleSelAction('扩写')">
            <Maximize2 :size="12" /> 扩写
          </button>
          <button class="arc-sel-btn" @click="handleSelAction('缩写')">
            <Minimize2 :size="12" /> 缩写
          </button>
          <span class="arc-sel-divider" />
          <button class="arc-sel-btn" @click="handleSelAction('问AI')">
            <MessageSquareQuote :size="12" /> 问 AI
          </button>
          <span class="arc-sel-divider" />
          <span class="arc-revision-palette" title="标注待精修内容">
            <button
              v-for="color in REVISION_COLORS"
              :key="color"
              type="button"
              class="arc-revision-color"
              :style="{ backgroundColor: color }"
              :aria-label="`使用 ${color} 标注`"
              @mousedown.prevent
              @click="applyManualRevision(color)"
            />
          </span>
          <button class="arc-sel-btn arc-sel-btn--icon" title="清除选中内容的标注" @mousedown.prevent @click="clearSelectedRevision">
            <Eraser :size="13" />
          </button>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="revisionPopup"
        ref="revisionCardRef"
        class="arc-revision-card"
        :style="{ left: revisionPopup.x + 'px', top: revisionPopup.y + 'px' }"
      >
        <div class="arc-revision-card__head" @pointerdown="startRevisionDrag">
          <span class="arc-revision-swatch" :style="{ backgroundColor: revisionPopup.revision.color }" />
          <strong>
            {{ revisionPopup.revision.source === 'ai'
              ? activeRevisionContext
                ? `AI 修订 #${activeRevisionContext.turnIndex}`
                : `AI 修订 · ${revisionPopup.revision.turnId?.slice(0, 8) || '来源未知'}`
              : '人工标注' }}
          </strong>
          <button type="button" @click="revisionPopup = null"><X :size="14" /></button>
        </div>
        <div v-if="activeRevisionContext" class="arc-revision-card__change-index">
          本轮修改 {{ activeRevisionContext.changeIndex }} / {{ activeRevisionContext.changeTotal }}
        </div>
        <div v-if="activeRevisionContext?.prompt" class="arc-revision-card__prompt">
          {{ activeRevisionContext.prompt }}
        </div>
        <div v-if="revisionPopup.revision.reason" class="arc-revision-card__reason">
          {{ revisionPopup.revision.reason }}
        </div>
        <div class="arc-revision-card__meta">
          {{ formatRevisionTime(revisionPopup.revision.createdAt) }} · {{ revisionPopup.revision.id.slice(0, 8) }}
        </div>
        <button type="button" class="arc-revision-resolve" @click="resolveRevision">
          <Check :size="13" /> 完成精修并清除标注
        </button>
      </div>
    </Teleport>

    <footer v-if="!focusMode && currentChapter" class="ep-status">
      <div class="stats-group">
        <span>字数 {{ wordCount.toLocaleString() }}</span>
        <span>第 {{ chapterIndex }} / {{ appStore.chapters.length }} 章</span>
      </div>
      <div class="progress-block">
        <span class="progress-label">本章目标 {{ targetWords.toLocaleString() }}</span>
        <div class="progress-bar">
          <div class="fill" :style="{ width: Math.min(100, progressPercent) + '%' }" />
        </div>
        <span class="progress-pct">{{ progressPercent }}%</span>
      </div>
    </footer>

    <ChapterVersionDialog
      v-model:show="versionDialogVisible"
      :chapter="currentChapter ?? null"
    />
  </main>
</template>

<style scoped>
.editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--arc-bg-body);
  overflow: hidden;
  position: relative;
}

.recovery-banner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  margin: 12px 0 18px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--arc-warning) 34%, var(--arc-border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--arc-warning) 6%, var(--arc-bg-surface));
  color: var(--arc-warning);
}

.recovery-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.recovery-copy strong {
  color: var(--arc-text-primary);
  font-size: 12px;
}

.recovery-copy span {
  color: var(--arc-text-hint);
  font-size: 11px;
}

.recovery-banner button {
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--arc-border);
  border-radius: 5px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 11px;
}

.recovery-banner button.primary {
  border-color: var(--arc-primary);
  background: var(--arc-primary);
  color: white;
}

.ep-header {
  height: 44px;
  flex-shrink: 0;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--arc-bg-surface);
  border-bottom: 1px solid var(--arc-border);
  min-width: 0;
  overflow: hidden;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

.breadcrumb svg {
  flex-shrink: 0;
  color: var(--arc-text-hint);
}

.crumb-current {
  color: var(--arc-text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ep-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  overscroll-behavior-x: contain;
}

.ep-actions::-webkit-scrollbar {
  display: none;
}

.save-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--arc-text-hint);
  flex: 0 0 auto;
  white-space: nowrap;
}

.save-indicator .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-success);
}

.save-indicator .dot.pending {
  background: var(--arc-warning);
}

.save-indicator .dot.failed {
  background: var(--arc-danger);
}

.divider {
  width: 1px;
  height: 18px;
  background: var(--arc-border);
  margin: 0 4px;
  flex: 0 0 auto;
}

.font-stepper {
  display: inline-flex;
  align-items: center;
  background: var(--arc-bg-surface-hover);
  border-radius: var(--arc-radius-sm);
  padding: 2px;
  gap: 2px;
  flex: 0 0 auto;
}

.font-picker-tool {
  min-width: 68px;
  justify-content: center;
  white-space: nowrap;
}

.more-tool {
  min-width: 52px;
  justify-content: center;
}

.ai-action {
  position: sticky;
  right: 0;
  z-index: 1;
  box-shadow: -8px 0 10px var(--arc-bg-surface);
}

.font-picker-label {
  min-width: 24px;
  text-align: center;
}

.font-stepper button {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.font-stepper button:hover {
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
}

.font-stepper .level {
  font-size: 11px;
  color: var(--arc-text-secondary);
  padding: 0 4px;
  min-width: 30px;
  text-align: center;
}

.toolbtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--arc-radius-sm);
  border: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: var(--arc-text-secondary);
  background: transparent;
  transition: 0.15s;
  flex: 0 0 auto;
  white-space: nowrap;
}

.toolbtn:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.toolbtn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbtn:disabled:hover {
  background: transparent;
  color: var(--arc-text-secondary);
}

.toolbtn.primary {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.toolbtn.primary:hover {
  background: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-bg-surface));
}

.toolbtn.active {
  background: var(--arc-primary);
  color: white;
}

.toolbtn.active:hover {
  background: var(--arc-primary-hover);
  color: white;
}

@media (max-width: 900px) {
  .ep-header {
    gap: 6px;
    padding: 0 10px;
  }

  .save-indicator,
  .divider {
    display: none;
  }

  .ep-actions {
    gap: 2px;
  }

  .font-picker-tool {
    min-width: 34px;
    padding-right: 7px;
    padding-left: 7px;
  }

  .font-picker-label {
    display: none;
  }
}

.focus-reference-toggle {
  position: absolute;
  top: 16px;
  right: 132px;
  z-index: 45;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  box-shadow: var(--arc-shadow-sm);
}

.focus-reference-toggle:hover,
.focus-reference-toggle.active {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.ep-scroll {
  position: relative;
  flex: 1;
  overflow-y: auto;
  padding: 48px 0 96px;
  min-height: 0;
}

.ep-canvas {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 56px;
}

.ep-title {
  font-size: 32px;
  font-weight: 700;
  border: none;
  outline: none;
  width: 100%;
  color: var(--arc-text-primary);
  background: transparent;
  letter-spacing: -0.025em;
  margin-bottom: 12px;
  line-height: 1.25;
}

.ep-title::placeholder {
  color: var(--arc-text-hint);
}

.ep-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 32px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--arc-border);
  font-size: 12px;
  color: var(--arc-text-secondary);
  flex-wrap: wrap;
}

.meta-summary {
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.5;
}

.ep-editor {
  background: transparent;
}

.ep-postgen-alert {
  margin-bottom: 20px;
}

.ep-postgen-copy {
  font-size: 12px;
  line-height: 1.65;
}

.ep-postgen-list {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.65;
}

.ep-empty {
  text-align: center;
  padding: 80px 0;
  color: var(--arc-text-hint);
  font-size: 14px;
}

.ep-status {
  height: 32px;
  flex-shrink: 0;
  padding: 0 16px;
  background: var(--arc-bg-surface);
  border-top: 1px solid var(--arc-border);
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 11px;
  color: var(--arc-text-hint);
}

.stats-group {
  display: flex;
  gap: 12px;
}

.progress-block {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}

.progress-label {
  color: var(--arc-text-secondary);
  white-space: nowrap;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--arc-bg-surface-hover);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar .fill {
  height: 100%;
  background: linear-gradient(90deg, var(--arc-success), var(--arc-primary));
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-pct {
  color: var(--arc-text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

</style>

<style>
.arc-sel-toolbar {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: #1D1D1F;
  border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  z-index: 9999;
  transform: translateX(-50%);
  pointer-events: auto;
  max-width: calc(100vw - 16px);
  overflow-x: auto;
}

.arc-sel-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: white;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: 0.15s;
  white-space: nowrap;
}

.arc-sel-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.arc-sel-btn--icon {
  padding-inline: 7px;
}

.arc-revision-palette {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
}

.arc-revision-color {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.58);
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.arc-revision-color:hover {
  transform: scale(1.18);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.2);
}

.arc-sel-divider {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 2px;
  flex-shrink: 0;
}

.arc-sel-fade-enter-active,
.arc-sel-fade-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.arc-sel-fade-enter-from,
.arc-sel-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}

.arc-revision-card {
  position: fixed;
  z-index: 10000;
  width: min(340px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  padding: 12px;
  box-sizing: border-box;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.2);
  overflow: auto;
  overscroll-behavior: contain;
}

.arc-revision-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.arc-revision-card__head:active {
  cursor: grabbing;
}

.arc-revision-card__head strong {
  flex: 1;
  font-size: 13px;
}

.arc-revision-card__head button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
}

.arc-revision-card__head button:hover {
  background: var(--arc-bg-surface-hover);
}

.arc-revision-swatch {
  width: 14px;
  height: 14px;
  border: 1px solid rgba(29, 29, 31, 0.18);
  border-radius: 4px;
}

.arc-revision-card__prompt,
.arc-revision-card__reason {
  padding: 8px 9px;
  border-radius: 6px;
  background: var(--arc-bg-weak);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.arc-revision-card__prompt {
  max-height: min(38vh, 260px);
  overflow: auto;
}

.arc-revision-card__change-index {
  margin-bottom: 6px;
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.arc-revision-card__reason {
  margin-top: 6px;
  color: var(--arc-text-secondary);
}

.arc-revision-card__meta {
  margin: 8px 0;
  color: var(--arc-text-hint);
  font-size: 11px;
}

.arc-revision-resolve {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: var(--arc-primary);
  color: white;
  font-size: 12px;
  cursor: pointer;
}
</style>
