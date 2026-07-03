<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Minimize } from 'lucide-vue-next'
import ChapterTreeSidebar from './ChapterTreeSidebar.vue'
import ChapterEditorPane from './ChapterEditorPane.vue'
import ChapterAiPanelV2 from './ChapterAiPanelV2.vue'
import ChapterFirstDraftConfigDialog from './ChapterFirstDraftConfigDialog.vue'
import type { FirstDraftConfig } from './useChapterFirstDraft'
import type { SurfaceDefinition } from '@shared/assistant-runtime'
import { useAssistant } from '@/composables/useAssistant'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const { selectedProjectId, selectedChapter } = storeToRefs(appStore)

// 章节 AI 助手实例：上移到此处，不依赖 ChapterAiPanelV2 是否挂载
const CHAPTER_SURFACE: SurfaceDefinition = {
  id: 'chapter-panel',
  scope: 'chapter',
  autoCommit: false,
  maxSteps: 6
}

const assistant = useAssistant({
  projectId: () => selectedProjectId.value,
  surface: CHAPTER_SURFACE,
  scopeRef: () => selectedChapter.value ? `chapter:${selectedChapter.value.id}` : undefined
})

const COMPACT_BREAKPOINT = 1180
const COMPACT_BREAKPOINT_AI_OPEN = 1440
const DEFAULT_AI_WIDTH = 380
const MIN_AI_WIDTH = 280
const MAX_AI_WIDTH = 600

const aiOpen = ref(true)
const focusMode = ref(false)
const sidebarDrawerVisible = ref(false)
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const aiPanelWidth = ref(DEFAULT_AI_WIDTH)
const isDraggingPanel = ref(false)
const draftConfigVisible = ref(false)

const isCompact = computed(() => {
  const threshold = aiOpen.value ? COMPACT_BREAKPOINT_AI_OPEN : COMPACT_BREAKPOINT
  return viewportWidth.value <= threshold
})

const effectiveAiWidth = computed(() => {
  if (isCompact.value) return Math.min(aiPanelWidth.value, 320)
  return aiPanelWidth.value
})

const gridStyle = computed(() => {
  if (focusMode.value) {
    return { gridTemplateColumns: aiOpen.value ? `1fr 4px ${effectiveAiWidth.value}px` : '1fr' }
  }
  if (isCompact.value) {
    return { gridTemplateColumns: aiOpen.value ? `1fr 4px ${effectiveAiWidth.value}px` : '1fr' }
  }
  return { gridTemplateColumns: aiOpen.value ? `280px 1fr 4px ${effectiveAiWidth.value}px` : '280px 1fr' }
})

const aiPanelRef = ref<InstanceType<typeof ChapterAiPanelV2> | null>(null)

function toggleAi(): void {
  aiOpen.value = !aiOpen.value
}

function toggleFocus(): void {
  focusMode.value = !focusMode.value
}

function toggleSidebar(): void {
  sidebarDrawerVisible.value = !sidebarDrawerVisible.value
}

function handleSelectionAction(action: string, text: string): void {
  aiOpen.value = true
  // 先把选区文本同步到 store，让 AI 面板的 hasSelection 能感知到
  const chapterId = appStore.selectedChapter?.id
  if (chapterId && text) {
    appStore.updateChapterSelection({ chapterId, text })
  }
  // 把完整文本传给 AI 面板（不截断），面板的 sendPromptWithAction 会利用 store 选区拼接上下文
  nextTick(() => {
    aiPanelRef.value?.sendPromptWithAction(action, text)
  })
}

function handleGenerateDraft(): void {
  draftConfigVisible.value = true
}

function handleDraftConfigConfirm(config: FirstDraftConfig): void {
  draftConfigVisible.value = false
  aiOpen.value = true
  nextTick(() => {
    aiPanelRef.value?.triggerDraft(config)
  })
}

function startPanelDrag(e: MouseEvent): void {
  e.preventDefault()
  isDraggingPanel.value = true
  const startX = e.clientX
  const startWidth = aiPanelWidth.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  function onMove(ev: MouseEvent): void {
    const delta = startX - ev.clientX
    const newWidth = Math.max(MIN_AI_WIDTH, Math.min(MAX_AI_WIDTH, startWidth + delta))
    aiPanelWidth.value = newWidth
  }

  function onEnd(): void {
    isDraggingPanel.value = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem('arc-ai-panel-width', String(aiPanelWidth.value))
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd)
}

function handlePanelDblClick(): void {
  aiPanelWidth.value = DEFAULT_AI_WIDTH
  localStorage.setItem('arc-ai-panel-width', String(DEFAULT_AI_WIDTH))
}

function syncViewport(): void {
  viewportWidth.value = window.innerWidth
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'F11') {
    event.preventDefault()
    toggleFocus()
    return
  }
  if (event.key === 'Escape' && focusMode.value) {
    toggleFocus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', syncViewport)
  const saved = localStorage.getItem('arc-ai-panel-width')
  if (saved) {
    const val = Number(saved)
    if (val >= MIN_AI_WIDTH && val <= MAX_AI_WIDTH) {
      aiPanelWidth.value = val
    }
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', syncViewport)
})
</script>

<template>
  <section
    class="chapter-workspace"
    :class="{ 'ai-open': aiOpen, focus: focusMode, compact: isCompact }"
    :style="gridStyle"
  >
    <ChapterTreeSidebar v-if="!focusMode && !isCompact" class="ws-sidebar" />
    <ChapterEditorPane
      class="ws-editor"
      :ai-open="aiOpen"
      :focus-mode="focusMode"
      :show-sidebar-toggle="!focusMode && isCompact"
      @toggle-ai="toggleAi"
      @toggle-focus="toggleFocus"
      @toggle-sidebar="toggleSidebar"
      @selection-action="handleSelectionAction"
      @generate-draft="handleGenerateDraft"
    />
    <!-- Panel resize handle -->
    <div
      v-if="aiOpen"
      class="panel-resize-handle"
      :class="{ dragging: isDraggingPanel }"
      @mousedown="startPanelDrag"
      @dblclick="handlePanelDblClick"
    />
    <ChapterAiPanelV2 v-if="aiOpen" ref="aiPanelRef" :assistant="assistant" class="ws-ai" @close="aiOpen = false" @generate-draft="handleGenerateDraft" />
    <button v-if="focusMode" class="focus-exit" @click="toggleFocus">
      <Minimize :size="13" />
      <span>退出专注 (Esc)</span>
    </button>

    <Transition name="sidebar-slide">
      <div v-if="isCompact && sidebarDrawerVisible && !focusMode" class="sidebar-overlay">
        <div class="sidebar-backdrop" @click="sidebarDrawerVisible = false" />
        <div class="sidebar-panel">
          <ChapterTreeSidebar @navigate="sidebarDrawerVisible = false" />
        </div>
      </div>
    </Transition>

    <ChapterFirstDraftConfigDialog
      :show="draftConfigVisible"
      @confirm="handleDraftConfigConfirm"
      @cancel="draftConfigVisible = false"
    />
  </section>
</template>

<style scoped>
.chapter-workspace {
  position: relative;
  display: grid;
  height: 100%;
  width: 100%;
  background: var(--arc-bg-body);
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}

.ws-sidebar,
.ws-editor,
.ws-ai {
  min-width: 0;
  min-height: 0;
}

/* ── Panel Resize Handle ── */
.panel-resize-handle {
  width: 4px;
  cursor: col-resize;
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}

.panel-resize-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 0;
  border-radius: 1px;
  background: var(--arc-border-strong);
  transform: translate(-50%, -50%);
  transition: all 0.2s ease;
  opacity: 0;
}

.panel-resize-handle:hover::after {
  height: 32px;
  opacity: 0.6;
}

.panel-resize-handle.dragging::after {
  height: 100%;
  opacity: 1;
  background: var(--arc-primary);
  width: 2px;
}

/* ── Focus Exit ── */
.focus-exit {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 100;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  box-shadow: var(--arc-shadow-sm);
}

.focus-exit:hover {
  color: var(--arc-text-primary);
}

/* ── Sidebar Overlay ── */
.sidebar-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
}

.sidebar-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.18);
}

.sidebar-panel {
  position: relative;
  width: 300px;
  height: 100%;
  box-shadow: var(--arc-shadow-lg);
  z-index: 1;
}

.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: opacity 0.2s ease;
}

.sidebar-slide-enter-active .sidebar-panel,
.sidebar-slide-leave-active .sidebar-panel {
  transition: transform 0.2s ease;
}

.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  opacity: 0;
}

.sidebar-slide-enter-from .sidebar-panel,
.sidebar-slide-leave-to .sidebar-panel {
  transform: translateX(-100%);
}
</style>
