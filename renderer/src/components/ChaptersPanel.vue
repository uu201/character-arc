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
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import type { ChapterDraft, ChapterVersion } from '@/types/app'
import type { DropdownOption, SelectOption } from 'naive-ui'

const props = defineProps<{
  searchQuery?: string
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const saveState = ref<'typing' | 'idle'>('idle')
const editorVisible = ref(false)
const versionHistoryVisible = ref(false)
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
const currentWordCount = computed(() => {
  const content = appStore.selectedChapter?.content.trim() ?? ''
  return content ? content.length : 0
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
const chapterCountLabel = computed(() => `${appStore.chapters.length} 个章节`)
const volumeCountLabel = computed(() => `${appStore.outlineVolumes.length} 个分卷`)
const versionCountLabel = computed(() => `${currentChapterVersions.value.length} 个版本`)
const saveStatusText = computed(() => {
  if (saveState.value === 'typing') {
    return '正在整理草稿...'
  }

  if (appStore.isPersistencePending) {
    return appStore.isLiveAutoSave ? '自动保存排队中...' : `已加入自动保存队列（${appStore.autoSaveIntervalLabel}）`
  }

  return '已保存草稿'
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
        `${chapter.title} ${chapter.summary} ${chapter.status} ${chapter.wordTarget} ${chapter.content}`.toLowerCase().includes(query)
      )
    }))
    .filter((group) => group.items.length > 0)
})
const totalVisibleChapters = computed(() => filteredChapterGroups.value.reduce((count, group) => count + group.items.length, 0))

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
  <section class="chapters-layout">
    <div class="section-head">
      <div class="section-copy">
        <span class="section-kicker">Chapter Studio</span>
        <h2>章节创作</h2>
        <p>按卷查看章节进度，在同一张稿纸上完成写作、版本管理和 AI 辅助。</p>
      </div>
      <div class="section-glance">
        <span class="glance-pill">{{ chapterCountLabel }}</span>
        <span class="glance-pill soft">{{ volumeCountLabel }}</span>
        <span class="glance-pill soft">{{ versionCountLabel }}</span>
      </div>
    </div>

    <div class="chapters-shell">
      <aside class="chapter-sidebar">
        <div class="chapter-side-head">
          <div>
            <span class="chapter-side-eyebrow">章节目录</span>
            <strong>按卷管理你的正文草稿</strong>
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

      <section class="editor-shell">
        <div class="editor-topbar">
          <div class="editor-context">
            <span class="editor-kicker">MANUSCRIPT DESK</span>
            <div class="editor-context-main">
              <strong>{{ currentVolumeLabel }}</strong>
              <span>{{ saveStatusText }}</span>
            </div>
          </div>

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
        </div>

        <div class="editor-manuscript">
          <div class="editor-manuscript-head">
            <div class="editor-meta-stack">
              <div class="chapter-meta-strip">
                <span class="meta-chip" :class="currentChapterStatusTone">{{ currentChapterStatusLabel }}</span>
                <span class="meta-chip neutral">{{ appStore.selectedChapter?.wordTarget }}</span>
                <span class="meta-chip neutral">{{ currentVolumeLabel }}</span>
                <span class="meta-chip ghost">本卷第 {{ selectedChapterIndexInVolume }} 章</span>
              </div>

              <input
                class="chapter-title"
                :value="appStore.selectedChapter?.title"
                @input="appStore.updateChapterTitle(($event.target as HTMLInputElement).value)"
              />
            </div>

            <div class="summary-card">
              <span class="summary-card-label">本章定位</span>
              <p>{{ appStore.selectedChapter?.summary || '待补充章节摘要' }}</p>
            </div>
          </div>

          <div class="editor-body">
            <textarea
              class="chapter-editor"
              :value="appStore.selectedChapter?.content"
              placeholder="从这里开始创作..."
              @input="appStore.updateChapterContent(($event.target as HTMLTextAreaElement).value)"
              @click="syncEditorSelection"
              @keyup="syncEditorSelection"
              @select="syncEditorSelection"
            ></textarea>
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
  --chapter-border: rgba(226, 232, 240, 0.72);
  --chapter-surface: rgba(255, 255, 255, 0.88);
  --chapter-muted: #6b7280;
  max-width: 1320px;
  margin: 0 auto;
}

.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 28px;
  gap: 18px;
  flex-wrap: wrap;
}

.section-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-kicker {
  color: color-mix(in srgb, var(--arc-primary) 72%, white);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.22em;
}

.section-head h2 {
  margin: 0;
  font-size: clamp(30px, 3.4vw, 38px);
  font-weight: 650;
  letter-spacing: -0.04em;
}

.section-head p {
  margin: 0;
  color: #86868b;
  font-size: 15px;
}

.section-glance {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.glance-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 14%, white);
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 9%, white);
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 700;
  padding: 9px 14px;
}

.glance-pill.soft {
  border-color: rgba(226, 232, 240, 0.92);
  background: rgba(255, 255, 255, 0.88);
  color: #64748b;
}

.assistant-toggle {
  width: auto;
  min-width: 52px;
  gap: 6px;
  padding-inline: 12px;
}

.chapters-shell {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: clamp(18px, 2vw, 24px);
  min-height: clamp(560px, 64vh, 720px);
  align-items: stretch;
}

.chapter-sidebar {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--chapter-border);
  border-radius: 32px;
  background:
    linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.86)),
    radial-gradient(circle at top left, color-mix(in srgb, var(--arc-primary) 8%, white), transparent 36%);
  padding: 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.chapter-side-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 6px 0;
  margin-bottom: 14px;
}

.chapter-side-head strong {
  display: block;
  margin-top: 4px;
  color: #1f2937;
  font-size: 15px;
}

.chapter-side-eyebrow {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.chapter-side-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  padding: 8px 10px;
}

.chapter-side-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}

.chapter-side-summary span {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(226, 232, 240, 0.88);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.7);
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
  padding: 8px;
  text-align: center;
}

.chapter-groups {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 6px;
}

.chapter-group {
  border: 1px solid rgba(226, 232, 240, 0.84);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.72);
  padding: 12px;
}

.chapter-group-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 4px 12px;
}

.chapter-group-head strong {
  display: block;
  color: #111827;
  font-size: 14px;
}

.chapter-group-head p {
  margin: 5px 0 0;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 600;
}

.mini-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  color: #94a3b8;
  box-shadow: 0 8px 18px rgba(148, 163, 184, 0.08);
  cursor: pointer;
  transition: all 0.22s ease;
}

.mini-icon:hover {
  background: white;
  color: var(--arc-primary);
  transform: translateY(-1px);
}

.chapter-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chapter-pill {
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid transparent;
  border-radius: 20px;
  background: transparent;
  color: #515154;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 15px 16px;
  text-align: left;
  transition: all 0.22s ease;
}

.chapter-pill:hover {
  border-color: rgba(226, 232, 240, 0.82);
  background: rgba(255, 255, 255, 0.74);
}

.chapter-pill.dragging {
  opacity: 0.56;
}

.chapter-pill.drop-target {
  outline: 1px dashed color-mix(in srgb, var(--arc-primary) 36%, white);
  background: color-mix(in srgb, var(--arc-primary) 8%, white);
}

.chapter-pill.active {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, white);
  background: white;
  color: var(--arc-primary);
  box-shadow:
    0 14px 32px rgba(15, 23, 42, 0.06),
    0 0 0 1px color-mix(in srgb, var(--arc-primary) 10%, transparent);
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
  gap: 7px;
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
  display: flex;
  min-width: 0;
  flex-direction: column;
  border: 1px solid var(--chapter-border);
  border-radius: 34px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.94)),
    radial-gradient(circle at top left, rgba(255, 248, 240, 0.9), transparent 30%);
  box-shadow:
    0 18px 48px rgba(15, 23, 42, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  padding: 18px;
  overflow: hidden;
}

.editor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 8px 10px 18px;
}

.editor-context {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.editor-kicker {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.editor-context-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.editor-context-main strong {
  color: #111827;
  font-size: 16px;
  font-weight: 700;
}

.editor-context-main span {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.editor-floating-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
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

.editor-manuscript {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border: 1px solid rgba(241, 245, 249, 0.96);
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(252, 252, 251, 1)),
    repeating-linear-gradient(to bottom, transparent 0, transparent 37px, rgba(226, 232, 240, 0.36) 38px);
  padding: clamp(22px, 3vw, 34px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.96);
}

.editor-manuscript-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
  gap: 20px;
  align-items: start;
  margin-bottom: 18px;
}

.editor-meta-stack {
  min-width: 0;
}

.chapter-title {
  width: 100%;
  border: none;
  background: transparent;
  color: #1d1d1f;
  font-size: clamp(30px, 4vw, 42px);
  font-weight: 650;
  letter-spacing: -0.04em;
  margin-bottom: 0;
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

.meta-chip.ghost {
  background: rgba(248, 250, 252, 0.8);
  color: #64748b;
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

.summary-card {
  border: 1px solid rgba(226, 232, 240, 0.88);
  border-radius: 22px;
  background: rgba(248, 250, 252, 0.88);
  padding: 16px 16px 14px;
}

.summary-card-label {
  display: inline-flex;
  margin-bottom: 10px;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.summary-card p {
  margin: 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.8;
}

.editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
  padding-top: 10px;
}

.chapter-editor {
  flex: 1;
  width: 100%;
  min-height: clamp(320px, 46vh, 520px);
  border: none;
  resize: none;
  background: transparent;
  color: #333336;
  font-family: 'Georgia', 'Noto Serif SC', serif;
  font-size: clamp(17px, 2vw, 19px);
  line-height: 2.02;
  letter-spacing: 0.01em;
  outline: none;
  padding-right: clamp(8px, 1.6vw, 18px);
}

.editor-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 18px;
  margin-top: 18px;
  border-top: 1px solid rgba(226, 232, 240, 0.8);
  color: #86868b;
  font-size: 12px;
}

.editor-status-group {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.status-metric {
  color: #64748b;
  font-weight: 700;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  background: rgba(248, 250, 252, 0.92);
  color: #475569;
  font-weight: 700;
  padding: 8px 12px;
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

@media (max-width: 1180px) {
  .chapters-shell {
    grid-template-columns: minmax(0, 1fr);
    min-height: auto;
  }

  .chapter-groups {
    max-height: 320px;
  }

  .editor-manuscript-head {
    grid-template-columns: minmax(0, 1fr);
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
    padding: 14px;
  }

  .editor-manuscript {
    padding: 20px 18px;
  }

  .editor-status {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .editor-floating-actions {
    gap: 8px;
  }
}
</style>
