<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { html as diffToHtml } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css'
import { Check, ChevronDown, ChevronRight, GitCompare, Info, Lock, X } from 'lucide-vue-next'
import { NButton, NModal, NScrollbar, NTag } from 'naive-ui'
import type { GlobalAssistantProposalDiffFile } from '@/composables/useGlobalAssistant'

type FileDecision = 'pending' | 'accepted' | 'rejected'
type ChapterCompareParagraphState = 'unchanged' | 'removed' | 'added'
type ChapterCompareParagraph = {
  id: string
  text: string
  state: ChapterCompareParagraphState
}

const props = defineProps<{
  show: boolean
  summary: string
  patch: string
  files: GlobalAssistantProposalDiffFile[]
  reviewMode?: 'default' | 'chapter'
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
const isChapterReview = computed(() =>
  props.reviewMode === 'chapter' && actionableFiles.value.length > 0 && actionableFiles.value.every((file) => file.kind === 'chapter')
)

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
const applyableCount = computed(() => actionableFiles.value.filter((f) => f.canApply).length)
const rejectedCount = computed(() => actionableFiles.value.filter((f) => decisions.value[f.id] === 'rejected').length)
const pendingCount = computed(() => actionableFiles.value.filter((f) => decisions.value[f.id] !== 'accepted' && decisions.value[f.id] !== 'rejected').length)
const currentDecision = computed(() => activeFile.value ? getDecision(activeFile.value.id) : 'pending')
const chapterActionLabel = computed(() => resolveChapterActionLabel(activeFile.value?.reason ?? ''))
const chapterReasonText = computed(() => resolveChapterReasonText(activeFile.value?.reason ?? props.summary))
const chapterCompareParagraphs = computed<{ before: ChapterCompareParagraph[]; after: ChapterCompareParagraph[] }>(() => {
  const file = activeFile.value
  if (!file) return { before: [], after: [] }

  const oldParagraphs = splitParagraphs(file.oldText)
  const newParagraphs = splitParagraphs(file.newText)
  if (oldParagraphs.length === 0 && newParagraphs.length === 0) return { before: [], after: [] }

  let start = 0
  while (
    start < oldParagraphs.length &&
    start < newParagraphs.length &&
    normalizeParagraph(oldParagraphs[start]) === normalizeParagraph(newParagraphs[start])
  ) {
    start += 1
  }

  let oldEnd = oldParagraphs.length - 1
  let newEnd = newParagraphs.length - 1
  while (
    oldEnd >= start &&
    newEnd >= start &&
    normalizeParagraph(oldParagraphs[oldEnd]) === normalizeParagraph(newParagraphs[newEnd])
  ) {
    oldEnd -= 1
    newEnd -= 1
  }

  const before: ChapterCompareParagraph[] = [
    ...oldParagraphs.slice(0, start).map((text, index) => ({ id: `before-prefix-${index}`, text, state: 'unchanged' as const })),
    ...oldParagraphs.slice(start, oldEnd + 1).map((text, index) => ({ id: `before-removed-${index}`, text, state: 'removed' as const })),
    ...oldParagraphs.slice(oldEnd + 1).map((text, index) => ({ id: `before-suffix-${index}`, text, state: 'unchanged' as const }))
  ]
  const after: ChapterCompareParagraph[] = [
    ...newParagraphs.slice(0, start).map((text, index) => ({ id: `after-prefix-${index}`, text, state: 'unchanged' as const })),
    ...newParagraphs.slice(start, newEnd + 1).map((text, index) => ({ id: `after-added-${index}`, text, state: 'added' as const })),
    ...newParagraphs.slice(newEnd + 1).map((text, index) => ({ id: `after-suffix-${index}`, text, state: 'unchanged' as const }))
  ]

  return { before, after }
})

function normalizeParagraph(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function resolveChapterActionLabel(reason: string): string {
  if (reason.includes('替换正文') || reason === 'replace') return '替换正文'
  if (reason.includes('插入正文') || reason === 'insert') return '插入正文'
  if (reason.includes('追加正文') || reason === 'append') return '追加正文'
  return '正文修订'
}

function resolveChapterReasonText(reason: string): string {
  return reason.replace(/^(替换正文|插入正文|追加正文|正文修订)\s*·\s*/, '').trim() || '请审查 AI 准备写回的正文修改。'
}

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

function acceptCurrent(): void {
  if (!activeFile.value?.canApply) return
  decisions.value[activeFile.value.id] = 'accepted'
}

function rejectCurrent(): void {
  if (!activeFile.value) return
  decisions.value[activeFile.value.id] = 'rejected'
}

function acceptAllAndApply(): void {
  acceptAll()
  emit('applyAll')
}

function applyAccepted(): void {
  if (acceptedIds.value.length === 0) return
  if (acceptedIds.value.length === applyableCount.value) {
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
  if (val) {
    decisions.value = {}
    outputFormat.value = isChapterReview.value ? 'line-by-line' : 'side-by-side'
  }
})
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="ga-diff-modal"
    :bordered="false"
    :closable="false"
    :mask-closable="false"
    :segmented="{ content: true }"
    @update:show="emit('update:show', $event)"
  >
    <template #header>
      <div class="ga-diff-title">
        <span class="ga-diff-title__icon"><GitCompare :size="17" /></span>
        <div class="ga-diff-title__copy">
          <span>{{ isChapterReview ? 'AI 正文修订审阅' : '写回变更审查' }}</span>
          <small v-if="isChapterReview">{{ chapterActionLabel }} · 待确认</small>
        </div>
      </div>
    </template>

    <template #header-extra>
      <button class="ga-diff-close" type="button" @click="close">
        <X :size="16" />
      </button>
    </template>

    <div v-if="isChapterReview" class="ga-diff-review ga-diff-review--chapter">
      <aside class="ga-diff-rail chapter-diff-rail">
        <div class="ga-diff-rail-header chapter-diff-rail-header">
          <div class="ga-diff-summary">
            <strong>{{ actionableFiles.length }} 项正文修改</strong>
            <span>逐项确认后再写回章节</span>
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
          <div class="chapter-change-list">
            <div
              v-for="(file, index) in actionableFiles"
              :key="file.id"
              class="chapter-change-card"
              :class="{
                active: activeFile?.id === file.id,
                accepted: getDecision(file.id) === 'accepted',
                rejected: getDecision(file.id) === 'rejected'
              }"
              @click="activeFileId = file.id"
            >
              <div class="chapter-change-card__index">{{ index + 1 }}</div>
              <div class="chapter-change-card__body">
                <strong>{{ file.title }}</strong>
                <span>{{ resolveChapterActionLabel(file.reason) }}</span>
                <p>{{ resolveChapterReasonText(file.reason) }}</p>
              </div>
              <div class="chapter-change-card__state" :class="getDecision(file.id)">
                <Check v-if="getDecision(file.id) === 'accepted'" :size="14" />
                <X v-else-if="getDecision(file.id) === 'rejected'" :size="14" />
              </div>
            </div>
          </div>
        </NScrollbar>
      </aside>

      <main class="ga-diff-main chapter-diff-main">
        <div class="ga-diff-toolbar chapter-diff-toolbar">
          <div class="ga-diff-current chapter-diff-current">
            <strong>{{ activeFile?.title || '暂无正文修改' }}</strong>
            <span v-if="activeFile && !activeFile.canApply"><Lock :size="12" /> 需要先匹配目标或人工确认</span>
            <span v-else>{{ chapterReasonText }}</span>
          </div>
          <span class="chapter-compare-badge">原文对照</span>
        </div>

        <div v-if="activeFile" class="chapter-prose-scroll arc-scrollbar">
          <div class="chapter-compare">
            <article class="chapter-compare__pane">
              <div class="chapter-compare__label">原文</div>
              <p
                v-for="paragraph in chapterCompareParagraphs.before"
                :key="paragraph.id"
                class="chapter-compare__paragraph"
                :class="`chapter-compare__paragraph--${paragraph.state}`"
              >
                {{ paragraph.text }}
              </p>
            </article>
            <article class="chapter-compare__pane chapter-compare__pane--after">
              <div class="chapter-compare__label">修改后</div>
              <p
                v-for="paragraph in chapterCompareParagraphs.after"
                :key="paragraph.id"
                class="chapter-compare__paragraph"
                :class="`chapter-compare__paragraph--${paragraph.state}`"
              >
                {{ paragraph.text }}
              </p>
            </article>
          </div>
        </div>

        <div v-else class="ga-diff-empty">
          当前没有可审查的章节修改。
        </div>
      </main>
    </div>

    <div v-else class="ga-diff-review">
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
      <div v-if="isChapterReview" class="ga-diff-footer chapter-diff-footer">
        <div class="ga-diff-footer__hint">
          当前项
          <strong
            :class="{
              'hint-accepted': currentDecision === 'accepted',
              'hint-rejected': currentDecision === 'rejected',
              'hint-pending': currentDecision === 'pending'
            }"
          >
            {{ currentDecision === 'accepted' ? '已确认' : currentDecision === 'rejected' ? '已忽略' : '待审查' }}
          </strong>
          · 已确认 <strong class="hint-accepted">{{ acceptedIds.length }}</strong> / {{ applyableCount }} 项
        </div>
        <div class="ga-diff-footer__actions">
          <NButton size="small" secondary type="success" :disabled="!activeFile?.canApply" @click="acceptCurrent">
            确认当前项
          </NButton>
          <NButton size="small" secondary type="error" :disabled="!activeFile" @click="rejectCurrent">
            忽略当前项
          </NButton>
          <NButton tertiary size="small" @click="emit('regenerate')">重新生成</NButton>
          <NButton quaternary size="small" @click="emit('clear')">忽略提案</NButton>
          <NButton type="primary" :disabled="acceptedIds.length === 0" @click="applyAccepted">
            写回已确认项 ({{ acceptedIds.length }})
          </NButton>
          <NButton type="primary" :disabled="applyableCount === 0" @click="acceptAllAndApply">
            全部确认并写回
          </NButton>
        </div>
      </div>

      <div v-else class="ga-diff-footer">
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

.ga-diff-title__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.2;
}

.ga-diff-title__copy small {
  color: var(--arc-text-hint, #9ca3af);
  font-size: 11px;
  font-weight: 500;
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
  grid-template-columns: 280px minmax(0, 1fr);
  height: min(64vh, 680px, calc(100vh - 168px));
  min-width: 0;
  min-height: min(380px, calc(100vh - 168px));
  overflow: hidden;
  background: var(--arc-bg-surface, #ffffff);
}

.ga-diff-review--chapter {
  grid-template-columns: 286px minmax(0, 1fr);
  background: var(--arc-bg-weak, #f9fafb);
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

/* ─── Chapter review list ─── */
.chapter-diff-rail {
  background: color-mix(in srgb, var(--arc-bg-weak, #f9fafb) 88%, var(--arc-bg-surface, #ffffff));
}

.chapter-change-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.chapter-change-card {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 24px;
  gap: 8px;
  min-height: 92px;
  padding: 10px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 8px;
  background: var(--arc-bg-surface, #ffffff);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.chapter-change-card:hover {
  border-color: var(--arc-border-strong, #cbd5e1);
}

.chapter-change-card.active {
  border-color: color-mix(in srgb, var(--arc-primary, #2563eb) 52%, var(--arc-border, #e5e7eb));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary, #2563eb) 8%, transparent);
}

.chapter-change-card.accepted {
  border-color: color-mix(in srgb, var(--arc-success, #16a34a) 38%, var(--arc-border, #e5e7eb));
  background: color-mix(in srgb, var(--arc-success, #16a34a) 4%, var(--arc-bg-surface, #ffffff));
}

.chapter-change-card.rejected {
  border-color: color-mix(in srgb, var(--arc-danger, #dc2626) 18%, var(--arc-border, #e5e7eb));
  opacity: 0.58;
}

.chapter-change-card__index {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--arc-bg-weak, #f9fafb);
  color: var(--arc-text-secondary, #4b5563);
  font-size: 12px;
  font-weight: 700;
}

.chapter-change-card__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.chapter-change-card__body strong,
.chapter-change-card__body span,
.chapter-change-card__body p {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chapter-change-card__body strong {
  color: var(--arc-text-primary, #1f2937);
  font-size: 12.5px;
  line-height: 1.35;
  white-space: nowrap;
}

.chapter-change-card__body span {
  color: var(--arc-primary, #2563eb);
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
}

.chapter-change-card__body p {
  display: -webkit-box;
  margin: 0;
  color: var(--arc-text-secondary, #4b5563);
  font-size: 12px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.chapter-change-card__state {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  color: transparent;
}

.chapter-change-card__state.accepted {
  background: color-mix(in srgb, var(--arc-success, #16a34a) 10%, transparent);
  color: var(--arc-success, #16a34a);
}

.chapter-change-card__state.rejected {
  background: color-mix(in srgb, var(--arc-danger, #dc2626) 8%, transparent);
  color: var(--arc-danger, #dc2626);
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
  flex-shrink: 0;
  min-width: 0;
  padding: 12px 14px;
  border-bottom: 1px solid var(--arc-border, #e5e7eb);
}

.ga-diff-current {
  display: flex;
  flex: 1;
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
  min-width: 0;
  color: var(--arc-text-hint, #9ca3af);
  font-size: 12px;
  overflow-wrap: anywhere;
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
  min-width: 0;
  overflow: auto;
  padding: 12px;
  background: var(--arc-bg-weak, #f9fafb);
}

.chapter-diff-main {
  background: var(--arc-bg-surface, #ffffff);
}

.chapter-diff-toolbar {
  align-items: center;
  min-height: 64px;
  padding: 13px 16px;
  background: var(--arc-bg-surface, #ffffff);
}

.chapter-diff-current strong {
  font-family: inherit;
  font-size: 14px;
}

.chapter-diff-current span {
  max-width: 760px;
  color: var(--arc-text-secondary, #4b5563);
  line-height: 1.45;
  white-space: normal;
}

.chapter-compare-badge {
  display: inline-flex;
  align-items: center;
  height: 28px;
  flex-shrink: 0;
  padding: 0 10px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 8px;
  background: var(--arc-bg-weak, #f9fafb);
  color: var(--arc-text-secondary, #4b5563);
  font-size: 12px;
  font-weight: 700;
}

.chapter-prose-scroll {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 22px clamp(18px, 4vw, 48px);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--arc-border, #e5e7eb) 55%, transparent) 1px, transparent 1px) left top / 18px 18px,
    var(--arc-bg-weak, #f9fafb);
}

.chapter-compare__pane p {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.78;
  font-size: 14px;
  letter-spacing: 0;
}

.chapter-compare__pane p + p {
  margin-top: 12px;
}

.chapter-compare {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
  min-width: 0;
  width: min(1120px, 100%);
  margin: 0 auto;
}

.chapter-compare__pane {
  min-width: 0;
  padding: 22px 22px 24px;
  border: 1px solid var(--arc-border, #e5e7eb);
  border-radius: 8px;
  background: var(--arc-bg-surface, #ffffff);
  color: var(--arc-text-primary, #1f2937);
  box-shadow: var(--arc-shadow-sm, 0 1px 2px rgba(0,0,0,0.05));
}

.chapter-compare__pane--after {
  border-color: color-mix(in srgb, var(--arc-success, #16a34a) 20%, var(--arc-border, #e5e7eb));
}

.chapter-compare__label {
  margin-bottom: 12px;
  color: var(--arc-text-hint, #9ca3af);
  font-size: 11px;
  font-weight: 700;
}

.chapter-compare__paragraph {
  position: relative;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
}

.chapter-compare__paragraph--unchanged {
  color: var(--arc-text-secondary, #4b5563);
}

.chapter-compare__paragraph--removed {
  border-color: color-mix(in srgb, var(--arc-danger, #dc2626) 24%, var(--arc-border, #e5e7eb));
  background: color-mix(in srgb, var(--arc-danger, #dc2626) 5%, var(--arc-bg-surface, #ffffff));
  color: color-mix(in srgb, var(--arc-danger, #dc2626) 72%, var(--arc-text-primary, #1f2937));
  text-decoration: line-through;
  text-decoration-thickness: 1px;
  text-decoration-color: color-mix(in srgb, var(--arc-danger, #dc2626) 36%, transparent);
}

.chapter-compare__paragraph--added {
  border-color: color-mix(in srgb, var(--arc-success, #16a34a) 26%, var(--arc-border, #e5e7eb));
  background: color-mix(in srgb, var(--arc-success, #16a34a) 6%, var(--arc-bg-surface, #ffffff));
  color: color-mix(in srgb, var(--arc-success, #16a34a) 65%, var(--arc-text-primary, #1f2937));
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
  min-width: 0;
}

.ga-diff-footer__hint {
  min-width: 0;
  color: var(--arc-text-hint, #9ca3af);
  font-size: 12px;
  overflow-wrap: anywhere;
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
  flex-wrap: wrap;
  justify-content: flex-end;
}

.chapter-diff-footer .ga-diff-footer__actions {
  row-gap: 6px;
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

.ga-diff-body :deep(.d2h-file-name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ga-diff-body :deep(.d2h-diff-table) {
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
  font-size: 12.5px;
}

@media (max-width: 860px) {
  .ga-diff-review {
    grid-template-columns: 1fr;
    height: min(76vh, calc(100vh - 150px));
    min-height: min(420px, calc(100vh - 150px));
  }

  .ga-diff-body :deep(.d2h-files-diff) {
    grid-template-columns: 1fr;
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

  .ga-diff-review--chapter {
    grid-template-columns: 1fr;
  }

  .chapter-change-list {
    padding: 8px;
  }

  .chapter-change-card {
    min-height: 82px;
  }

  .chapter-diff-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .chapter-prose-scroll {
    padding: 14px;
  }

  .chapter-compare__pane {
    padding: 17px 16px 19px;
  }

  .chapter-compare {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
.ga-diff-modal {
  width: min(1040px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow: hidden;
}

.ga-diff-modal.n-card,
.ga-diff-modal .n-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ga-diff-modal .n-card-header,
.ga-diff-modal .n-card__footer {
  flex-shrink: 0;
}

.ga-diff-modal .n-card__content {
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.ga-diff-modal .n-card__footer {
  padding: 12px 16px;
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
