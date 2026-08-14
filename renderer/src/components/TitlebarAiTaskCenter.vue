<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Activity,
  AlertTriangle,
  Bot,
  BookOpen,
  Brush,
  CheckCircle2,
  Feather,
  FileText,
  Image as ImageIcon,
  Library,
  ListTodo,
  LoaderCircle,
  Sparkles,
  Square,
  X
} from 'lucide-vue-next'
import { NProgress } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import type { AiTaskKind, AiTaskRun } from '@/features/ai/taskRegistry'

const appStore = useAppStore()
const rootRef = ref<HTMLElement | null>(null)
const panelOpen = ref(false)
const nowTick = ref(Date.now())
let tickTimer: number | null = null

const visibleRuns = computed<AiTaskRun[]>(() => [
  ...appStore.runningAiTasks,
  ...appStore.recentAiTasks
])
const runningCount = computed(() => appStore.runningAiTasks.length)
const errorCount = computed(() => appStore.recentAiTasks.filter((run) => run.stage === 'error').length)
const completedCount = computed(() => appStore.recentAiTasks.filter((run) => run.stage === 'done').length)
const attentionCount = computed(() => runningCount.value + errorCount.value)

const buttonTitle = computed(() => {
  const parts: string[] = []
  if (runningCount.value) parts.push(`${runningCount.value} 项运行中`)
  if (errorCount.value) parts.push(`${errorCount.value} 项失败`)
  return parts.length ? `AI 后台任务：${parts.join('，')}` : 'AI 后台任务'
})

const panelSummary = computed(() => {
  if (runningCount.value && errorCount.value) {
    return `${runningCount.value} 项运行中 · ${errorCount.value} 项失败`
  }
  if (runningCount.value) return `${runningCount.value} 项运行中`
  if (errorCount.value) return `${errorCount.value} 项需要处理`
  if (completedCount.value) return '最近完成'
  return '当前没有任务'
})

function startTicker(): void {
  if (tickTimer !== null) return
  tickTimer = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
}

function stopTicker(): void {
  if (tickTimer === null) return
  window.clearInterval(tickTimer)
  tickTimer = null
}

watch(runningCount, (count) => {
  if (count > 0) startTicker()
  else stopTicker()
}, { immediate: true })

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!panelOpen.value || rootRef.value?.contains(event.target as Node)) return
  panelOpen.value = false
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') panelOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  stopTicker()
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})

function formatElapsed(run: AiTaskRun): string {
  const endAt = run.stage === 'running' ? nowTick.value : run.finishedAt ?? nowTick.value
  const seconds = Math.max(0, Math.round((endAt - run.startedAt) / 1000))
  if (seconds < 1) return '刚刚启动'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

function stageLabel(run: AiTaskRun): string {
  switch (run.stage) {
    case 'running': return `运行中 · ${formatElapsed(run)}`
    case 'done': return `已完成 · ${formatElapsed(run)}`
    case 'error': return `失败 · ${formatElapsed(run)}`
    case 'canceled': return `已取消 · ${formatElapsed(run)}`
  }
}

function kindIcon(kind: AiTaskKind) {
  switch (kind) {
    case 'worldview': return BookOpen
    case 'character': return Bot
    case 'outline': return Library
    case 'workflow': return FileText
    case 'inspiration': return Sparkles
    case 'chapter-draft':
    case 'chapter-summary':
    case 'chapter-assistant':
    case 'chapter-post-process': return Feather
    case 'plot-thread': return Library
    case 'cover': return ImageIcon
    case 'reference': return BookOpen
    default: return Brush
  }
}

function handleCancel(run: AiTaskRun): void {
  appStore.cancelAiTask(run.key)
}

function handleDismiss(run: AiTaskRun): void {
  appStore.dismissAiTask(run.key)
}
</script>

<template>
  <div ref="rootRef" class="titlebar-task-center">
    <button
      type="button"
      class="task-center-trigger"
      :class="{
        'is-panel-open': panelOpen,
        'has-running': runningCount > 0,
        'has-error': errorCount > 0,
        'has-completed': completedCount > 0
      }"
      :title="buttonTitle"
      :aria-label="buttonTitle"
      :aria-expanded="panelOpen"
      aria-haspopup="dialog"
      @click="panelOpen = !panelOpen"
    >
      <AlertTriangle v-if="errorCount" :size="13" />
      <LoaderCircle v-else-if="runningCount" :size="13" class="spinning" />
      <CheckCircle2 v-else-if="completedCount" :size="13" />
      <Activity v-else :size="13" />
      <span class="task-center-label">AI后台任务</span>
      <span v-if="attentionCount" class="task-center-badge">{{ attentionCount > 99 ? '99+' : attentionCount }}</span>
    </button>

    <Transition name="task-center-panel">
      <section v-if="panelOpen" class="task-center-panel" role="dialog" aria-label="AI 后台任务">
        <header class="task-center-head">
          <div class="task-center-heading">
            <span class="task-center-heading-icon" aria-hidden="true">
              <ListTodo :size="15" />
            </span>
            <div>
              <strong>AI 后台任务</strong>
              <span>{{ panelSummary }}</span>
            </div>
          </div>
          <button type="button" class="panel-close" title="关闭" aria-label="关闭任务面板" @click="panelOpen = false">
            <X :size="14" />
          </button>
        </header>

        <div v-if="visibleRuns.length" class="task-center-list arc-scrollbar">
          <article
            v-for="run in visibleRuns"
            :key="`${run.key}-${run.startedAt}`"
            class="task-center-item"
            :class="`stage-${run.stage}`"
          >
            <span class="task-kind-icon" aria-hidden="true">
              <component :is="kindIcon(run.kind)" :size="15" />
            </span>

            <div class="task-item-main">
              <div class="task-item-title">
                <strong :title="run.label">{{ run.label }}</strong>
                <span>{{ stageLabel(run) }}</span>
              </div>
              <p v-if="run.description || run.error" :class="{ 'is-error': run.stage === 'error' }">
                {{ run.stage === 'error' ? run.error || run.description : run.description }}
              </p>
              <n-progress
                v-if="run.stage === 'running'"
                class="task-item-progress"
                type="line"
                status="info"
                :processing="!run.progress"
                :percentage="run.progress?.percentage ?? 100"
                :show-indicator="Boolean(run.progress)"
                :height="3"
              />
            </div>

            <div class="task-item-actions">
              <button
                v-if="run.stage === 'running' && run.onCancel"
                type="button"
                class="task-stop"
                title="停止任务"
                @click="handleCancel(run)"
              >
                <Square :size="10" fill="currentColor" />
                <span>停止</span>
              </button>
              <button
                v-else-if="run.stage !== 'running'"
                type="button"
                class="task-dismiss"
                title="移除任务记录"
                aria-label="移除任务记录"
                @click="handleDismiss(run)"
              >
                <X :size="13" />
              </button>
            </div>
          </article>
        </div>

        <div v-else class="task-center-empty">
          <Activity :size="22" aria-hidden="true" />
          <strong>暂无后台任务</strong>
          <span>AI 任务启动后会在这里显示进度</span>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.titlebar-task-center {
  position: relative;
  flex: 0 0 auto;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.task-center-trigger {
  position: relative;
  display: inline-flex;
  height: 26px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  white-space: nowrap;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.task-center-trigger:hover,
.task-center-trigger.is-panel-open {
  border-color: var(--arc-border-strong);
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
}

.task-center-trigger.has-running {
  border-color: color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  color: var(--arc-primary);
}

.task-center-trigger.has-error {
  border-color: color-mix(in srgb, var(--arc-danger) 38%, var(--arc-border));
  color: var(--arc-danger);
}

.task-center-trigger.has-completed:not(.has-running):not(.has-error) {
  color: var(--arc-success);
}

.task-center-trigger:focus-visible,
.panel-close:focus-visible,
.task-stop:focus-visible,
.task-dismiss:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--arc-primary) 55%, transparent);
  outline-offset: 2px;
}

.task-center-badge {
  display: inline-flex;
  min-width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--arc-primary);
  color: #fff;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.task-center-trigger.has-error .task-center-badge {
  background: var(--arc-danger);
}

.task-center-panel {
  position: absolute;
  top: calc(100% + 7px);
  right: 0;
  z-index: 10;
  display: flex;
  width: min(390px, calc(100vw - 24px));
  max-height: min(460px, calc(100vh - 56px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--arc-border-strong);
  border-radius: 7px;
  background: var(--arc-bg-surface);
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18);
}

.task-center-head {
  display: flex;
  min-height: 48px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--arc-border);
  background: color-mix(in srgb, var(--arc-bg-surface) 88%, var(--arc-bg-weak));
}

.task-center-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.task-center-heading-icon {
  display: grid;
  width: 27px;
  height: 27px;
  flex: 0 0 27px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border));
  border-radius: 6px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.task-center-heading > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.task-center-heading strong {
  color: var(--arc-text-primary);
  font-size: 12px;
  line-height: 1.2;
}

.task-center-heading span {
  color: var(--arc-text-hint);
  font-size: 10px;
  line-height: 1.2;
}

.panel-close,
.task-dismiss {
  display: inline-grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
}

.panel-close:hover,
.task-dismiss:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.task-center-list {
  overflow-y: auto;
}

.task-center-item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: start;
  gap: 9px;
  padding: 11px 10px 11px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--arc-border) 72%, transparent);
}

.task-center-item:last-child {
  border-bottom: none;
}

.task-kind-icon {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 5px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}

.stage-done .task-kind-icon {
  background: color-mix(in srgb, var(--arc-success) 10%, transparent);
  color: var(--arc-success);
}

.stage-error .task-kind-icon {
  background: color-mix(in srgb, var(--arc-danger) 10%, transparent);
  color: var(--arc-danger);
}

.stage-canceled .task-kind-icon {
  background: var(--arc-bg-weak);
  color: var(--arc-text-hint);
}

.task-item-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}

.task-item-title {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.task-item-title strong {
  overflow: hidden;
  color: var(--arc-text-primary);
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-item-title span {
  flex: 0 0 auto;
  color: var(--arc-text-hint);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.stage-error .task-item-title span {
  color: var(--arc-danger);
}

.task-item-main p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 11px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.task-item-main p.is-error {
  color: var(--arc-danger);
}

.task-item-progress {
  margin-top: 1px;
}

.task-item-actions {
  display: flex;
  min-height: 26px;
  align-items: center;
}

.task-stop {
  display: inline-flex;
  height: 24px;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: 1px solid var(--arc-border);
  border-radius: 4px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 10px;
}

.task-stop:hover {
  border-color: color-mix(in srgb, var(--arc-danger) 38%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-danger) 5%, var(--arc-bg-surface));
  color: var(--arc-danger);
}

.task-center-empty {
  display: flex;
  min-height: 150px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 24px;
  color: var(--arc-text-hint);
  text-align: center;
}

.task-center-empty strong {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.task-center-empty span {
  font-size: 10px;
}

.spinning {
  animation: task-center-spin 0.9s linear infinite;
}

.task-center-panel-enter-active,
.task-center-panel-leave-active {
  transform-origin: top right;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.task-center-panel-enter-from,
.task-center-panel-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.985);
}

@keyframes task-center-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1260px) {
  .task-center-trigger {
    width: 28px;
    padding: 0;
  }

  .task-center-label {
    display: none;
  }

  .task-center-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    box-shadow: 0 0 0 2px var(--arc-bg-body);
  }
}
</style>
