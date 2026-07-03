<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronRight, Folder, FocusIcon, History, Maximize2, Menu, MessageSquareQuote, Minus, Minimize2, Plus, RefreshCw, Sparkles, Wand2 } from 'lucide-vue-next'
import { NAlert, NTag, NTooltip } from 'naive-ui'
import SimpleChapterEditor from './SimpleChapterEditor.vue'
import ChapterVersionDialog from './ChapterVersionDialog.vue'
import EditorFindBar from './EditorFindBar.vue'
import EditorContextMenu from './EditorContextMenu.vue'
import { getChapterCharacterCount } from '@/features/chapters/editorContent'
import { formatChapterWordTargetLabel, parseChapterWordTarget } from '@/features/chapters/wordTarget'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import { useAppStore } from '@/stores/app'

defineProps<{
  aiOpen: boolean
  focusMode: boolean
  showSidebarToggle?: boolean
}>()

const emit = defineEmits<{
  toggleAi: []
  toggleFocus: []
  toggleSidebar: []
  selectionAction: [action: string, text: string]
  generateDraft: []
}>()

const appStore = useAppStore()

const FONT_LEVELS = [14, 15, 16, 17, 18, 20, 22]
const fontIdx = ref(3)
const fontSize = computed(() => FONT_LEVELS[fontIdx.value])
const versionDialogVisible = ref(false)

function stepFont(delta: number): void {
  const next = Math.max(0, Math.min(FONT_LEVELS.length - 1, fontIdx.value + delta))
  fontIdx.value = next
}

const currentChapter = computed(() => appStore.selectedChapter)
const currentVolume = computed(() => appStore.selectedChapterVolume)
const currentVolumeIndex = computed(() =>
  appStore.outlineVolumes.findIndex((v) => v.id === currentVolume.value?.id)
)
const volumeLabel = computed(() =>
  currentVolume.value
    ? formatVolumeLabel(currentVolume.value, Math.max(currentVolumeIndex.value, 0), 'compact')
    : '未分卷'
)

const wordCount = computed(() => getChapterCharacterCount(currentChapter.value?.content ?? ''))
const targetWords = computed(() => parseChapterWordTarget(currentChapter.value?.wordTarget))
const progressPercent = computed(() => {
  if (!targetWords.value) return 0
  return Math.min(100, Math.round((wordCount.value / targetWords.value) * 100))
})

const saveStatusText = computed(() => {
  if (appStore.isPersistencePending) {
    return appStore.isLiveAutoSave ? '排队保存' : '自动保存中'
  }
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
// editorRef.value.editor 通过模板 ref 自动 unwrap 为 Editor | undefined
const tiptapEditor = computed(() => (editorRef.value as any)?.editor ?? null)

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
  const toolbarW = 360
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
  selToolbarVisible.value = false
}

function handleGlobalKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    const scrollEl = scrollRef.value
    if (!scrollEl) return
    // 仅当焦点在当前编辑器区域内时才拦截
    const active = document.activeElement
    const inEditor = scrollEl.contains(active) || findBarVisible.value
    if (!inEditor) return
    e.preventDefault()
    openFindBar()
  }
}

onMounted(() => {
  document.addEventListener('selectionchange', handleSelectionChange)
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('keydown', handleGlobalKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', handleSelectionChange)
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('keydown', handleGlobalKeydown)
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
          <span class="dot" :class="{ pending: appStore.isPersistencePending }" />
          {{ saveStatusText }}
        </span>
        <span class="divider" />

        <div class="font-stepper">
          <button @click="stepFont(-1)"><Minus :size="11" /></button>
          <span class="level">{{ fontSize }}px</span>
          <button @click="stepFont(1)"><Plus :size="11" /></button>
        </div>

        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="toolbtn" @click="emit('toggleFocus')"><FocusIcon :size="13" /></button>
          </template>
          专注模式 (F11)
        </n-tooltip>
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="toolbtn" :disabled="!currentChapter" @click="versionDialogVisible = true">
              <History :size="13" />
            </button>
          </template>
          历史版本
        </n-tooltip>
        <button class="toolbtn" :disabled="!currentChapter" @click="emit('generateDraft')">
          <Wand2 :size="13" />
          <span>生成初稿</span>
        </button>
        <button class="toolbtn" :class="{ primary: !aiOpen, active: aiOpen }" @click="emit('toggleAi')">
          <Sparkles :size="13" />
          <span>AI 助理</span>
        </button>
      </div>
    </header>

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
            @change="(e) => appStore.updateChapter(currentChapter!.id, { title: (e.target as HTMLInputElement).value })"
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

          <SimpleChapterEditor
            ref="editorRef"
            class="ep-editor"
            :chapter-id="currentChapter.id"
            :model-value="currentChapter.content ?? ''"
            :insertion-request="appStore.pendingChapterInsertion"
            @update:model-value="appStore.updateChapterContent"
            @consume-insertion="appStore.consumeChapterInsertion"
            @selection-change="appStore.updateChapterSelection"
          />
        </template>
      </div>
    </div>

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
        </div>
      </Transition>
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
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  min-width: 0;
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
}

.save-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--arc-text-hint);
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

.divider {
  width: 1px;
  height: 18px;
  background: var(--arc-border);
  margin: 0 4px;
}

.font-stepper {
  display: inline-flex;
  align-items: center;
  background: var(--arc-bg-surface-hover);
  border-radius: var(--arc-radius-sm);
  padding: 2px;
  gap: 2px;
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
}

.toolbtn:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
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
</style>
