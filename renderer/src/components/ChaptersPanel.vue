<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  Bot,
  FilePenLine,
  Globe2,
  GripVertical,
  History,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  Plus,
  Save,
  Sparkles,
  Trash2
} from 'lucide-vue-next'
import { NButton, NDropdown, NForm, NFormItem, NInput, NModal, NSelect, NTooltip, useDialog, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import type { ChapterDraft, ChapterVersion } from '@/types/app'
import type { DropdownOption, SelectOption } from 'naive-ui'

const props = defineProps<{
  searchQuery?: string
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const saveState = ref<'saved' | 'saving'>('saved')
const editorVisible = ref(false)
const versionHistoryVisible = ref(false)
const draggingChapterId = ref<string | null>(null)
const dragTargetChapterId = ref<string | null>(null)
const chapterForm = reactive({
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

const currentWordCount = computed(() => {
  const content = appStore.selectedChapter?.content.trim() ?? ''
  if (!content) {
    return 0
  }

  return content.length
})
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

const filteredChapters = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() ?? ''
  if (!query) {
    return appStore.chapters
  }

  return appStore.chapters.filter((chapter) =>
    `${chapter.title} ${chapter.summary} ${chapter.status} ${chapter.wordTarget} ${chapter.content}`.toLowerCase().includes(query)
  )
})

function requestAiPolish(): void {
  appStore.queueAssistantPrompt(
    '请基于当前章节内容给出一版更有节奏感、氛围感和画面感的润色稿，优先输出可以直接插入正文的内容。',
    '润色段落'
  )
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

function requestWorldSupport(): void {
  appStore.queueAssistantPrompt(
    '请结合当前章节、已有世界观和角色设定，列出 3 到 5 条与本章最相关的设定提醒，并说明如何自然融入正文。',
    '设定查阅'
  )
}

function syncEditorSelection(event: Event): void {
  const target = event.target as HTMLTextAreaElement | null
  if (!target) {
    return
  }

  appStore.setChapterSelection(target.selectionStart, target.selectionEnd)
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
  return version.content.trim().length
}

function buildVersionPreview(version: ChapterVersion): string {
  const preview = version.content.trim().replace(/\s+/g, ' ')
  return preview ? preview.slice(0, 120) : '该版本暂无正文内容。'
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

  if (!chapterForm.title.trim()) {
    message.warning('请填写章节标题')
    return
  }

  appStore.updateChapter(chapter.id, {
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

  // Native drag-and-drop is enough for this first-stage desktop sorter and avoids adding another dependency.
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

    saveState.value = 'saving'

    // 用一个短防抖模拟真实的自动保存节奏，避免每个按键都刷新状态文字。
    if (saveTimer) {
      window.clearTimeout(saveTimer)
    }

    saveTimer = window.setTimeout(() => {
      saveState.value = 'saved'
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
  <section class="chapters-layout">
    <div class="section-head">
      <div>
        <h2>章节创作</h2>
        <p>专注写作模式，AI 随时为你提供灵感。</p>
      </div>
    </div>

    <div class="chapters-shell">
      <aside class="chapter-sidebar">
        <div class="chapter-side-head">
          <span>卷一：苏醒之日</span>
          <button class="mini-icon" @click="appStore.createChapter()">
            <Plus :size="15" />
          </button>
        </div>

        <div class="chapter-items arc-scrollbar">
          <button
            v-for="chapter in filteredChapters"
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
      </aside>

      <section class="editor-shell">
        <div class="editor-floating-actions">
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
              <button
                class="tool-badge neutral assistant-toggle"
                :class="{ active: appStore.aiVisible }"
                @click="appStore.toggleAi()"
              >
                <Bot :size="16" />
                <PanelRightClose v-if="appStore.aiVisible" :size="14" />
                <PanelRightOpen v-else :size="14" />
              </button>
            </template>
            {{ appStore.aiVisible ? '隐藏 AI 助手' : '显示 AI 助手' }}
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <button class="tool-badge neutral" @click="openChapterMetaEditor(appStore.selectedChapter)">
                <FilePenLine :size="16" />
              </button>
            </template>
            编辑章节信息
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <button class="tool-badge" @click="requestAiPolish">
                <Sparkles :size="16" />
              </button>
            </template>
            AI 润色
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <button class="tool-badge neutral" @click="requestWorldSupport">
                <Globe2 :size="16" />
              </button>
            </template>
            设定查阅
          </n-tooltip>
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

        <input
          class="chapter-title"
          :value="appStore.selectedChapter?.title"
          @input="appStore.updateChapterTitle(($event.target as HTMLInputElement).value)"
        />

        <div class="chapter-meta-strip">
          <span class="meta-chip" :class="currentChapterStatusTone">{{ currentChapterStatusLabel }}</span>
          <span class="meta-chip neutral">{{ appStore.selectedChapter?.wordTarget }}</span>
          <span v-if="appStore.selectedChapter?.summary" class="meta-summary">
            {{ appStore.selectedChapter?.summary }}
          </span>
        </div>

        <textarea
          class="chapter-editor"
          :value="appStore.selectedChapter?.content"
          placeholder="从这里开始创作..."
          @input="appStore.updateChapterContent(($event.target as HTMLTextAreaElement).value)"
          @click="syncEditorSelection"
          @keyup="syncEditorSelection"
          @select="syncEditorSelection"
        ></textarea>

        <div class="editor-status">
          <span>{{ currentWordCount }} 字</span>
          <span class="status-pill">
            <PenTool :size="12" />
            {{ saveState === 'saving' ? '自动保存中...' : '已保存草稿' }}
          </span>
        </div>
      </section>
    </div>

    <div v-if="filteredChapters.length === 0" class="arc-empty-state">
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
            <span class="meta-chip" :class="version.status === 'final' ? 'success' : version.status === 'polish' ? 'accent' : version.status === 'review' ? 'warning' : 'neutral'">
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
  max-width: 1180px;
  margin: 0 auto;
}

.section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  margin-bottom: 32px;
  gap: 16px;
  flex-wrap: wrap;
}

.section-head h2 {
  margin: 0 0 8px;
  font-size: clamp(30px, 3.4vw, 38px);
  font-weight: 650;
  letter-spacing: -0.04em;
}

.section-head p {
  margin: 0;
  color: #86868b;
  font-size: 15px;
}

.assistant-toggle {
  width: auto;
  min-width: 52px;
  gap: 6px;
  padding-inline: 12px;
}

.chapters-shell {
  display: flex;
  gap: clamp(18px, 2vw, 24px);
  min-height: clamp(520px, 60vh, 680px);
}

.chapter-sidebar {
  display: flex;
  width: clamp(200px, 22vw, 248px);
  flex-shrink: 0;
  flex-direction: column;
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 28px;
  background: rgba(245, 245, 247, 0.5);
  padding: 16px;
}

.chapter-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #6b7280;
  font-size: 13px;
  font-weight: 650;
  padding: 0 6px;
  margin-bottom: 16px;
}

.mini-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
}

.mini-icon:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--arc-primary);
}

.chapter-items {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 6px;
}

.chapter-pill {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: none;
  border-radius: 16px;
  background: transparent;
  color: #515154;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 14px 16px;
  text-align: left;
  transition: all 0.22s ease;
}

.chapter-pill:hover {
  background: rgba(0, 0, 0, 0.04);
}

.chapter-pill.dragging {
  opacity: 0.56;
}

.chapter-pill.drop-target {
  outline: 1px dashed color-mix(in srgb, var(--arc-primary) 36%, white);
  background: color-mix(in srgb, var(--arc-primary) 8%, white);
}

.chapter-pill.active {
  background: white;
  color: var(--arc-primary);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.chapter-pill-grip {
  display: inline-flex;
  width: 18px;
  height: 18px;
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
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chapter-pill-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 5px;
}

.chapter-pill-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #9ca3af;
  font-size: 11px;
  font-weight: 600;
}

.chapter-pill-dot {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: #d1d5db;
}

.chapter-pill-action {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: #c4cad4;
  flex-shrink: 0;
}

.chapter-pill:hover .chapter-pill-action {
  background: rgba(0, 0, 0, 0.04);
  color: #6b7280;
}

.editor-shell {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 28px;
  background: white;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04);
  padding: 44px clamp(22px, 3vw, 42px) 24px;
}

.editor-floating-actions {
  position: absolute;
  top: 22px;
  right: 22px;
  display: flex;
  gap: 10px;
}

.tool-badge {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
  color: var(--arc-primary);
  cursor: pointer;
  transition: all 0.22s ease;
}

.tool-badge:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--arc-primary) 16%, white);
}

.tool-badge.active {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}

.tool-badge.neutral {
  background: #f9fafb;
  color: #6b7280;
}

.tool-badge.neutral.active {
  background: color-mix(in srgb, var(--arc-primary) 8%, white);
  color: var(--arc-primary);
}

.tool-badge:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tool-badge:disabled:hover {
  transform: none;
  background: #f9fafb;
}

.tool-badge.danger:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}

.helper-card {
  margin-bottom: 18px;
  border: 1px solid rgba(229, 231, 235, 0.92);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.98));
  padding: 16px 18px;
}

.helper-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.helper-head strong {
  font-size: 14px;
}

.helper-head span {
  color: #86868b;
  font-size: 12px;
  line-height: 1.6;
}

.helper-label {
  display: block;
  margin-bottom: 8px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
}

.helper-input {
  width: 100%;
  border: 1px solid rgba(209, 213, 219, 0.72);
  border-radius: 14px;
  background: white;
  outline: none;
  padding: 12px 14px;
  margin-bottom: 12px;
}

.helper-input:focus {
  border-color: color-mix(in srgb, var(--arc-primary) 24%, white);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.helper-copy {
  margin: 0;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.75;
}

.chapter-title {
  width: 100%;
  border: none;
  background: transparent;
  color: #1d1d1f;
  font-size: clamp(30px, 4vw, 42px);
  font-weight: 650;
  letter-spacing: -0.04em;
  margin-bottom: 20px;
  outline: none;
}

.chapter-title:hover {
  color: var(--arc-primary);
}

.chapter-meta-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
}

.meta-chip.neutral {
  background: #f3f4f6;
  color: #6b7280;
}

.meta-chip.warning {
  background: rgba(250, 204, 21, 0.14);
  color: #a16207;
}

.meta-chip.accent {
  background: color-mix(in srgb, var(--arc-primary) 12%, white);
  color: var(--arc-primary);
}

.meta-chip.success {
  background: rgba(34, 197, 94, 0.14);
  color: #15803d;
}

.meta-summary {
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}

.chapter-editor {
  flex: 1;
  width: 100%;
  min-height: clamp(280px, 42vh, 420px);
  border: none;
  resize: none;
  background: transparent;
  color: #333336;
  font-size: clamp(16px, 2vw, 18px);
  line-height: 1.95;
  outline: none;
}

.editor-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  margin-top: 16px;
  border-top: 1px solid rgba(243, 244, 246, 0.9);
  color: #86868b;
  font-size: 12px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  border: 1px solid rgba(229, 231, 235, 0.9);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.9), rgba(255, 255, 255, 0.98));
  padding: 18px 18px 16px;
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

.helper-fade-enter-active,
.helper-fade-leave-active {
  transition: all 0.2s ease;
}

.helper-fade-enter-from,
.helper-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 1080px) {
  .chapters-shell {
    flex-direction: column;
    min-height: auto;
  }

  .chapter-sidebar {
    width: 100%;
  }

  .chapter-items {
    max-height: 220px;
  }

  .editor-shell {
    min-height: 480px;
  }
}

@media (max-width: 720px) {
  .editor-shell {
    padding: 58px 20px 22px;
  }

  .editor-floating-actions {
    top: 16px;
    right: 16px;
  }

  .editor-status {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .chapter-meta-strip {
    align-items: flex-start;
    flex-direction: column;
  }

  .version-card-head {
    flex-direction: column;
  }
}
</style>
