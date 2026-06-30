<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { html as diffToHtml } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css'
import { Check, ChevronDown, ChevronRight, GitCompare, Info, Lock, X } from 'lucide-vue-next'
import { NButton, NModal, NScrollbar, NTag } from 'naive-ui'
import type { GlobalAssistantProposalDiffFile } from '@/composables/useGlobalAssistant'

type FileDecision = 'pending' | 'accepted' | 'rejected'

const props = defineProps<{
  show: boolean
  summary: string
  patch: string
  files: GlobalAssistantProposalDiffFile[]
  stats: {
    total: number
    creatable: number
    updatable: number
    blocked: number
  }
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  applyFile: [fileId: string]
  applyAll: []
  regenerate: []
  clear: []
}>()

const outputFormat = ref<'side-by-side' | 'line-by-line'>('side-by-side')
const activeFileId = ref('')
const decisions = ref<Record<string, FileDecision>>({})
const notesExpanded = ref(false)

const actionableFiles = computed(() => props.files.filter((f) => f.action !== 'note'))
const noteFiles = computed(() => props.files.filter((f) => f.action === 'note'))

const activeFile = computed(() =>
  actionableFiles.value.find((file) => file.id === activeFileId.value) ?? actionableFiles.value[0] ?? null
)

const activePatch = computed(() => {
  if (!activeFile.value) return props.patch
  const chunks = props.patch.split(/\ndiff --git /)
  const normalizedChunks = chunks.map((chunk, index) => index === 0 ? chunk : `diff --git ${chunk}`)
  return normalizedChunks.find((chunk) => chunk.includes(`b/${activeFile.value?.path}`)) ?? props.patch
})

const renderedDiff = computed(() => {
  if (!activePatch.value.trim()) return ''
  return diffToHtml(activePatch.value, {
    drawFileList: false,
    matching: 'words',
    outputFormat: outputFormat.value,
    renderNothingWhenEmpty: false
  })
})

const acceptedIds = computed(() => actionableFiles.value.filter((f) => f.canApply && decisions.value[f.id] === 'accepted').map((f) => f.id))
const rejectedCount = computed(() => actionableFiles.value.filter((f) => decisions.value[f.id] === 'rejected').length)
const pendingCount = computed(() => actionableFiles.value.filter((f) => decisions.value[f.id] !== 'accepted' && decisions.value[f.id] !== 'rejected').length)

function getDecision(fileId: string): FileDecision {
  return decisions.value[fileId] ?? 'pending'
}

function acceptFile(fileId: string): void {
  const file = props.files.find((f) => f.id === fileId)
  if (!file?.canApply) return
  decisions.value[fileId] = decisions.value[fileId] === 'accepted' ? 'pending' : 'accepted'
}

function rejectFile(fileId: string): void {
  decisions.value[fileId] = decisions.value[fileId] === 'rejected' ? 'pending' : 'rejected'
}

function acceptAll(): void {
  for (const file of actionableFiles.value) {
    if (file.canApply) decisions.value[file.id] = 'accepted'
  }
}

function rejectAll(): void {
  for (const file of actionableFiles.value) {
    decisions.value[file.id] = 'rejected'
  }
}

function applyAccepted(): void {
  if (acceptedIds.value.length === 0) return
  if (acceptedIds.value.length === actionableFiles.value.filter((f) => f.canApply).length) {
    emit('applyAll')
  } else {
    for (const id of acceptedIds.value) {
      emit('applyFile', id)
    }
  }
}

function close(): void {
  emit('update:show', false)
}

watch(
  () => props.files,
  (files) => {
    const actionable = files.filter((f) => f.action !== 'note')
    if (!actionable.some((file) => file.id === activeFileId.value)) {
      activeFileId.value = actionable[0]?.id ?? ''
    }
    const validIds = new Set(files.map((f) => f.id))
    for (const id of Object.keys(decisions.value)) {
      if (!validIds.has(id)) delete decisions.value[id]
    }
  },
  { immediate: true }
)

watch(() => props.show, (val) => {
  if (val) decisions.value = {}
})
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="ga-diff-modal"
    :bordered="false"
    :closable="false"
    :segmented="{ content: true }"
    @update:show="emit('update:show', $event)"
  >
    <template #header>
      <div class="ga-diff-title">
        <span class="ga-diff-title__icon"><GitCompare :size="17" /></span>
        <span>写回变更审查</span>
      </div>
    </template>

    <template #header-extra>
      <button class="ga-diff-close" type="button" @click="close">
        <X :size="16" />
      </button>
    </template>

    <div class="ga-diff-review">
      <aside class="ga-diff-rail">
        <div class="ga-diff-rail-header">
          <div class="ga-diff-summary">
            <strong>{{ actionableFiles.length }} 项变更</strong>
            <span>{{ stats.creatable }} 新增 · {{ stats.updatable }} 更新</span>
          </div>
          <div class="ga-diff-batch">
            <button type="button" class="ga-diff-batch-btn accept" @click="acceptAll">
              <Check :size="13" />
              全部确认
            </button>
            <button type="button" class="ga-diff-batch-btn reject" @click="rejectAll">
              <X :size="12" />
              全部忽略
            </button>
          </div>
        </div>

        <NScrollbar class="ga-diff-file-scroll">
          <div class="ga-diff-file-list">
            <div
              v-for="file in actionableFiles"
              :key="file.id"
              class="ga-diff-file"
              :class="{
                active: activeFile?.id === file.id,
                accepted: getDecision(file.id) === 'accepted',
                rejected: getDecision(file.id) === 'rejected'
              }"
              @click="activeFileId = file.id"
            >
              <div class="ga-diff-file__content">
                <span class="ga-diff-file__top">
                  <strong>{{ file.title }}</strong>
                  <NTag size="small" round :bordered="false" :type="file.action === 'create' ? 'success' : 'info'">
                    {{ file.action === 'create' ? '新增' : '更新' }}
                  </NTag>
                </span>
                <span class="ga-diff-file__path">{{ file.path }}</span>
                <span class="ga-diff-file__reason">{{ file.reason }}</span>
              </div>
              <div v-if="getDecision(file.id) === 'pending'" class="ga-diff-file__actions">
                <button
                  type="button"
                  class="ga-diff-file__action-btn ga-accept-btn"
                  :disabled="!file.canApply"
                  title="确认写回"
                  @click.stop="acceptFile(file.id)"
                >
                  <Check :size="14" />
                </button>
                <button
                  type="button"
                  class="ga-diff-file__action-btn ga-reject-btn"
                  title="忽略"
                  @click.stop="rejectFile(file.id)"
                >
                  <X :size="14" />
                </button>
              </div>
              <div v-else class="ga-diff-file__status" :class="getDecision(file.id)" @click.stop="decisions[file.id] = 'pending'">
                <Check v-if="getDecision(file.id) === 'accepted'" :size="14" />
                <X v-else :size="14" />
              </div>
            </div>
          </div>
        </NScrollbar>
      </aside>

      <main class="ga-diff-main">
        <div class="ga-diff-toolbar">
          <div class="ga-diff-current">
            <strong>{{ activeFile?.path || '暂无变更' }}</strong>
            <span v-if="activeFile && !activeFile.canApply"><Lock :size="12" /> 需要先匹配目标或人工确认</span>
            <span v-else>{{ activeFile?.reason || summary || '请审查 AI 准备写回的全局设定变更。' }}</span>
          </div>
          <div class="ga-diff-toggle">
            <button type="button" :class="{ active: outputFormat === 'side-by-side' }" @click="outputFormat = 'side-by-side'">并排</button>
            <button type="button" :class="{ active: outputFormat === 'line-by-line' }" @click="outputFormat = 'line-by-line'">单列</button>
          </div>
        </div>

        <div v-if="renderedDiff" class="ga-diff-body arc-scrollbar" v-html="renderedDiff" />
        <div v-else class="ga-diff-empty">
          当前没有可审查的写回提案。
        </div>
      </main>
    </div>

    <div v-if="noteFiles.length > 0" class="ga-diff-notes">
      <button type="button" class="ga-diff-notes__toggle" @click="notesExpanded = !notesExpanded">
        <Info :size="14" />
        <span>{{ noteFiles.length }} 条提醒</span>
        <ChevronDown v-if="notesExpanded" :size="14" />
        <ChevronRight v-else :size="14" />
      </button>
      <div v-if="notesExpanded" class="ga-diff-notes__list">
        <div v-for="note in noteFiles" :key="note.id" class="ga-diff-notes__item">
          {{ note.newText }}
        </div>
      </div>
    </div>

    <template #footer>
      <div class="ga-diff-footer">
        <div class="ga-diff-footer__hint">
          已确认 <strong class="hint-accepted">{{ acceptedIds.length }}</strong> 项，已忽略 <strong class="hint-rejected">{{ rejectedCount }}</strong> 项，待审查 <strong class="hint-pending">{{ pendingCount }}</strong> 项
        </div>
        <div class="ga-diff-footer__actions">
          <NButton tertiary size="small" @click="emit('regenerate')">重新生成</NButton>
          <NButton quaternary size="small" @click="emit('clear')">忽略提案</NButton>
          <NButton type="primary" :disabled="acceptedIds.length === 0" @click="applyAccepted">
            写回已确认项 ({{ acceptedIds.length }})
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.ga-diff-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-primary, #1f2937);
  font-weight: 700;
}

.ga-diff-title__icon {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  background: var(--arc-primary-soft, #eff6ff);
  color: var(--arc-primary, #2563eb);
}

.ga-diff-close {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--arc-text-hint, #9ca3af);
  cursor: pointer;
}

.ga-diff-close:hover {
  background: var(--arc-bg-surface-hover, #f3f4f6);
  color: var(--arc-text-primary, #1f2937);
}

.ga-diff-review {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  height: min(72vh, 760px);
  min-height: 460px;
  background: var(--arc-bg-surface, #ffffff);
}

/* ─── Left Rail ─── */
.ga-diff-rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--arc-border, #e5e7eb);
  background: var(--arc-bg-weak, #f9fafb);
}

.ga-diff-rail-header {
  padding: 14px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-bottom: 1px solid var(--arc-border, #e5e7eb);
  flex-shrink: 0;
}

.ga-diff-summary {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ga-diff-summary strong {
  font-size: 14px;
  color: var(--arc-text-primary, #1f2937);
}

.ga-diff-summary span {
  font-size: 12px;
  color: var(--arc-text-hint, #9ca3af);
}

.ga-diff-batch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ga-diff-batch-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 7px;
  background: var(--arc-bg-surface, #ffffff);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.ga-diff-batch-btn.accept {
  color: var(--arc-success, #16a34a);
}
.ga-diff-batch-btn.accept:hover {
  background: color-mix(in srgb, var(--arc-success, #16a34a) 6%, var(--arc-bg-surface, #ffffff));
  border-color: var(--arc-success, #16a34a);
}

.ga-diff-batch-btn.reject {
  color: var(--arc-danger, #dc2626);
}
.ga-diff-batch-btn.reject:hover {
  background: color-mix(in srgb, var(--arc-danger, #dc2626) 5%, var(--arc-bg-surface, #ffffff));
  border-color: var(--arc-danger, #dc2626);
}

/* ─── File List ─── */
.ga-diff-file-scroll {
  flex: 1;
  min-height: 0;
}

.ga-diff-file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
}

.ga-diff-file {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 8px;
  background: var(--arc-bg-surface, #ffffff);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
  overflow: hidden;
}

.ga-diff-file:hover {
  border-color: var(--arc-border-strong, #cbd5e1);
}

.ga-diff-file.active {
  border-color: color-mix(in srgb, var(--arc-primary, #2563eb) 50%, var(--arc-border, #e5e7eb));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary, #2563eb) 8%, transparent);
}

.ga-diff-file.accepted {
  border-color: color-mix(in srgb, var(--arc-success, #16a34a) 40%, var(--arc-border, #e5e7eb));
  background: color-mix(in srgb, var(--arc-success, #16a34a) 4%, var(--arc-bg-surface, #ffffff));
}

.ga-diff-file.rejected {
  border-color: color-mix(in srgb, var(--arc-danger, #dc2626) 18%, var(--arc-border, #e5e7eb));
  opacity: 0.55;
}

.ga-diff-file__content {
  flex: 1;
  min-width: 0;
  padding: 10px 10px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ga-diff-file__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ga-diff-file__top strong,
.ga-diff-file__path,
.ga-diff-file__reason {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ga-diff-file__top strong {
  color: var(--arc-text-primary, #1f2937);
  font-size: 12.5px;
}

.ga-diff-file__path {
  color: var(--arc-text-hint, #9ca3af);
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
  font-size: 11px;
}

.ga-diff-file__reason {
  color: var(--arc-text-secondary, #4b5563);
  font-size: 11.5px;
}

/* ─── Per-file action buttons ─── */
.ga-diff-file__actions {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-left: 1px solid var(--arc-border, #e5e7eb);
}

.ga-diff-file__action-btn {
  flex: 1;
  display: grid;
  place-items: center;
  width: 36px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.12s;
}

.ga-diff-file__action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.ga-diff-file__action-btn.ga-accept-btn {
  color: var(--arc-success, #16a34a);
}
.ga-diff-file__action-btn.ga-accept-btn:not(:disabled):hover {
  background: color-mix(in srgb, var(--arc-success, #16a34a) 8%, transparent);
}

.ga-diff-file__action-btn.ga-reject-btn {
  color: var(--arc-danger, #dc2626);
  border-top: 1px solid var(--arc-border, #e5e7eb);
}
.ga-diff-file__action-btn.ga-reject-btn:hover {
  background: color-mix(in srgb, var(--arc-danger, #dc2626) 6%, transparent);
}

/* ─── File status indicator (after decision) ─── */
.ga-diff-file__status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  flex-shrink: 0;
  border-left: 1px solid var(--arc-border, #e5e7eb);
  cursor: pointer;
  transition: background 0.12s;
}

.ga-diff-file__status.accepted {
  color: var(--arc-success, #16a34a);
  background: color-mix(in srgb, var(--arc-success, #16a34a) 6%, transparent);
}

.ga-diff-file__status.rejected {
  color: var(--arc-danger, #dc2626);
  background: color-mix(in srgb, var(--arc-danger, #dc2626) 5%, transparent);
}

.ga-diff-file__status:hover {
  background: var(--arc-bg-surface-hover, #f3f4f6);
}

/* ─── Main panel ─── */
.ga-diff-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.ga-diff-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--arc-border, #e5e7eb);
}

.ga-diff-current {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.ga-diff-current strong {
  overflow: hidden;
  color: var(--arc-text-primary, #1f2937);
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ga-diff-current span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--arc-text-hint, #9ca3af);
  font-size: 12px;
}

.ga-diff-toggle {
  display: inline-flex;
  flex-shrink: 0;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 9px;
  background: var(--arc-bg-weak, #f9fafb);
}

.ga-diff-toggle button {
  min-height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-hint, #9ca3af);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  padding: 0 9px;
}

.ga-diff-toggle button.active {
  background: var(--arc-bg-surface, #ffffff);
  color: var(--arc-primary, #2563eb);
  box-shadow: var(--arc-shadow-sm, 0 1px 2px rgba(0,0,0,0.05));
}

.ga-diff-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  background: var(--arc-bg-weak, #f9fafb);
}

.ga-diff-empty {
  display: grid;
  flex: 1;
  place-items: center;
  color: var(--arc-text-hint, #9ca3af);
  font-size: 13px;
}

/* ─── Notes bar ─── */
.ga-diff-notes {
  border-top: 1px solid var(--arc-border, #e5e7eb);
  background: color-mix(in srgb, var(--arc-warning, #f59e0b) 4%, var(--arc-bg-surface, #ffffff));
}

.ga-diff-notes__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary, #4b5563);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
}

.ga-diff-notes__toggle:hover {
  background: color-mix(in srgb, var(--arc-warning, #f59e0b) 8%, var(--arc-bg-surface, #ffffff));
}

.ga-diff-notes__toggle svg:first-child {
  color: var(--arc-warning, #f59e0b);
}

.ga-diff-notes__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 16px 12px;
}

.ga-diff-notes__item {
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--arc-bg-surface, #ffffff);
  border: 1px solid var(--arc-border, #e5e7eb);
  font-size: 12px;
  line-height: 1.5;
  color: var(--arc-text-secondary, #4b5563);
}

/* ─── Footer ─── */
.ga-diff-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ga-diff-footer__hint {
  color: var(--arc-text-hint, #9ca3af);
  font-size: 12px;
}

.ga-diff-footer__hint .hint-accepted {
  color: var(--arc-success, #16a34a);
}

.ga-diff-footer__hint .hint-rejected {
  color: var(--arc-danger, #dc2626);
}

.ga-diff-footer__hint .hint-pending {
  color: var(--arc-text-primary, #1f2937);
}

.ga-diff-footer__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ─── diff2html overrides ─── */
.ga-diff-body :deep(.d2h-wrapper) {
  color: var(--arc-text-primary, #1f2937);
}

.ga-diff-body :deep(.d2h-file-wrapper) {
  margin-bottom: 0;
  border-color: var(--arc-border, #e5e7eb);
  border-radius: 8px;
  overflow: hidden;
}

.ga-diff-body :deep(.d2h-file-header) {
  border-bottom-color: var(--arc-border, #e5e7eb);
  background: var(--arc-bg-surface, #ffffff);
}

.ga-diff-body :deep(.d2h-code-line),
.ga-diff-body :deep(.d2h-code-side-line) {
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
}

@media (max-width: 860px) {
  .ga-diff-review {
    grid-template-columns: 1fr;
    height: 76vh;
  }

  .ga-diff-rail {
    max-height: 200px;
    border-right: none;
    border-bottom: 1px solid var(--arc-border, #e5e7eb);
  }

  .ga-diff-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .ga-diff-footer__actions {
    justify-content: flex-end;
  }
}
</style>

<style>
.ga-diff-modal {
  width: min(1200px, calc(100vw - 32px));
}

.ga-diff-modal .n-card__content {
  padding: 0;
}

/* ─── diff2html 暗黑模式覆盖：把 light 变量重映射到 diff2html 内置的 dark 变量 ─── */
.dark-mode .ga-diff-body {
  color: var(--d2h-dark-color);
  --d2h-bg-color: var(--d2h-dark-bg-color);
  --d2h-border-color: var(--d2h-dark-border-color);
  --d2h-dim-color: var(--d2h-dark-dim-color);
  --d2h-line-border-color: var(--d2h-dark-line-border-color);
  --d2h-file-header-bg-color: var(--d2h-dark-file-header-bg-color);
  --d2h-file-header-border-color: var(--d2h-dark-file-header-border-color);
  --d2h-empty-placeholder-bg-color: var(--d2h-dark-empty-placeholder-bg-color);
  --d2h-empty-placeholder-border-color: var(--d2h-dark-empty-placeholder-border-color);
  --d2h-selected-color: var(--d2h-dark-selected-color);
  --d2h-ins-bg-color: var(--d2h-dark-ins-bg-color);
  --d2h-ins-border-color: var(--d2h-dark-ins-border-color);
  --d2h-ins-highlight-bg-color: var(--d2h-dark-ins-highlight-bg-color);
  --d2h-ins-label-color: var(--d2h-dark-ins-label-color);
  --d2h-del-bg-color: var(--d2h-dark-del-bg-color);
  --d2h-del-border-color: var(--d2h-dark-del-border-color);
  --d2h-del-highlight-bg-color: var(--d2h-dark-del-highlight-bg-color);
  --d2h-del-label-color: var(--d2h-dark-del-label-color);
  --d2h-change-del-color: var(--d2h-dark-change-del-color);
  --d2h-change-ins-color: var(--d2h-dark-change-ins-color);
  --d2h-info-bg-color: var(--d2h-dark-info-bg-color);
  --d2h-info-border-color: var(--d2h-dark-info-border-color);
  --d2h-change-label-color: var(--d2h-dark-change-label-color);
}
</style>
