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
import RichChapterEditor from '@/components/RichChapterEditor.vue'
import { getChapterCharacterCount, getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
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
const currentWordCount = computed(() => getChapterCharacterCount(appStore.selectedChapter?.content ?? ''))
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
const selectedVolumeChapterCount = computed(() => {
  const selectedVolumeId = appStore.selectedChapter?.volumeId
  return selectedVolumeId ? appStore.chapters.filter((chapter) => chapter.volumeId === selectedVolumeId).length : 0
})
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
        `${chapter.title} ${chapter.summary} ${chapter.status} ${chapter.wordTarget} ${getPlainTextFromEditorContent(chapter.content)}`
          .toLowerCase()
          .includes(query)
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

        <div class="chapter-side-spotlight">
          <span class="spotlight-label">当前写作焦点</span>
          <strong>{{ appStore.selectedChapter?.title || '未命名章节' }}</strong>
          <p>{{ currentSummaryText }}</p>
          <div class="spotlight-meta">
            <span>{{ currentVolumeLabel }}</span>
            <span>本卷 {{ selectedVolumeChapterCount }} 章</span>
          </div>
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

        <div class="editor-ribbon">
          <div class="editor-ribbon-main">
            <span class="ribbon-chip strong">{{ currentVolumeLabel }}</span>
            <span class="ribbon-chip">{{ currentChapterStatusLabel }}</span>
            <span class="ribbon-chip">{{ appStore.selectedChapter?.wordTarget }}</span>
            <span class="ribbon-chip">本卷第 {{ selectedChapterIndexInVolume }} 章</span>
            <span class="ribbon-chip">全书第 {{ selectedChapterIndex }} 章</span>
          </div>
          <div class="editor-progress">
            <div class="editor-progress-meta">
              <span>当前字数 {{ currentWordCount }}</span>
              <span v-if="currentTargetWordCount">目标 {{ currentTargetWordCount }}</span>
              <strong>{{ currentProgressPercent }}%</strong>
            </div>
            <div class="editor-progress-track">
              <span :style="{ width: `${currentProgressPercent}%` }"></span>
            </div>
          </div>
        </div>

        <div class="editor-stage">
          <div class="editor-manuscript">
            <div class="editor-manuscript-head">
              <div class="editor-meta-stack">
                <div class="chapter-meta-strip">
                  <span class="meta-chip" :class="currentChapterStatusTone">{{ currentChapterStatusLabel }}</span>
                  <span class="meta-chip neutral">{{ appStore.selectedChapter?.wordTarget }}</span>
                  <span class="meta-chip neutral">{{ currentVolumeLabel }}</span>
                  <span class="meta-chip ghost">本卷第 {{ selectedChapterIndexInVolume }} 章</span>
                </div>

                <div class="manuscript-heading">
                  <span class="manuscript-overline">Chapter {{ selectedChapterIndexInVolume }}</span>
                  <input
                    class="chapter-title"
                    :value="appStore.selectedChapter?.title"
                    @input="appStore.updateChapterTitle(($event.target as HTMLInputElement).value)"
                  />
                </div>
              </div>

              <div class="summary-card">
                <span class="summary-card-label">本章定位</span>
                <p>{{ currentSummaryText }}</p>
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
  --chapter-border: #d4d4d8;
  --chapter-border-strong: #c7c7cf;
  --chapter-surface: #ffffff;
  --chapter-surface-muted: #f3f3f3;
  --chapter-surface-soft: #fafafa;
  --chapter-muted: #5f6368;
  --chapter-accent-soft: #eaf2ff;
  max-width: none;
  width: 100%;
  margin: 0 auto;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 2px;
}

.section-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-kicker {
  color: #7a7f87;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.section-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0;
}

.section-head p {
  margin: 0;
  color: #7a7f87;
  font-size: 13px;
}

.section-glance {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.glance-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  background: var(--chapter-surface);
  color: #404349;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
}

.glance-pill.soft {
  background: var(--chapter-surface-soft);
  color: #60656d;
}

.assistant-toggle {
  width: auto;
  min-width: 52px;
  gap: 6px;
  padding-inline: 12px;
}

.chapters-shell {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 0;
  min-height: clamp(600px, 68vh, 780px);
  align-items: stretch;
  border: 1px solid var(--chapter-border-strong);
  border-radius: 8px;
  background: var(--chapter-surface);
  overflow: hidden;
}

.chapter-sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--chapter-border-strong);
  background: var(--chapter-surface-muted);
  padding: 14px;
}

.chapter-side-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 0;
  margin-bottom: 10px;
}

.chapter-side-head strong {
  display: block;
  margin-top: 2px;
  color: #1f2937;
  font-size: 14px;
  font-weight: 600;
}

.chapter-side-eyebrow {
  color: #7a7f87;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.chapter-side-badge {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  background: var(--chapter-surface);
  color: #60656d;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
}

.chapter-side-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 10px;
}

.chapter-side-summary span {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  background: var(--chapter-surface);
  color: #5f6368;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  padding: 6px;
  text-align: center;
}

.chapter-side-spotlight {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  background: var(--chapter-surface);
  padding: 12px;
  margin-bottom: 12px;
  box-shadow: none;
}

.spotlight-label {
  color: #7a7f87;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.chapter-side-spotlight strong {
  color: #202124;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.chapter-side-spotlight p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: #5f6368;
  font-size: 12px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.spotlight-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.spotlight-meta span {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  background: var(--chapter-surface-soft);
  color: #5f6368;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
}

.chapter-groups {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 2px;
}

.chapter-group {
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  background: var(--chapter-surface-soft);
  padding: 8px;
}

.chapter-group-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 8px;
}

.chapter-group-head strong {
  display: block;
  color: #202124;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
}

.chapter-group-head p {
  margin: 4px 0 0;
  color: #7a7f87;
  font-size: 11px;
  font-weight: 600;
}

.mini-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  background: var(--chapter-surface);
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
  gap: 4px;
}

.chapter-pill {
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #404349;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  padding: 10px 12px;
  text-align: left;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.chapter-pill:hover {
  border-color: var(--chapter-border);
  background: #ececec;
}

.chapter-pill.dragging {
  opacity: 0.56;
}

.chapter-pill.drop-target {
  outline: 1px dashed color-mix(in srgb, var(--arc-primary) 42%, white);
  background: var(--chapter-accent-soft);
}

.chapter-pill.active {
  border-color: #b8cdf5;
  background: var(--chapter-accent-soft);
  color: #1f4ea3;
  box-shadow: none;
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
  gap: 4px;
}

.chapter-pill-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #7a7f87;
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
  width: 24px;
  height: 24px;
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

.editor-shell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  background: var(--chapter-surface);
  padding: 0;
  overflow: hidden;
}

.editor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--chapter-border);
  background: var(--chapter-surface-soft);
}

.editor-context {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.editor-kicker {
  color: #7a7f87;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.editor-context-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.editor-context-main strong {
  color: #202124;
  font-size: 14px;
  font-weight: 600;
}

.editor-context-main span {
  color: #6a7078;
  font-size: 12px;
  font-weight: 600;
}

.editor-floating-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.editor-ribbon {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 300px);
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid var(--chapter-border);
  background: var(--chapter-surface);
  padding: 10px 14px;
  margin: 0;
}

.editor-ribbon-main {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ribbon-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  background: var(--chapter-surface-soft);
  color: #5f6368;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 8px;
}

.ribbon-chip.strong {
  background: var(--chapter-accent-soft);
  color: #1f4ea3;
  border-color: #b8cdf5;
}

.editor-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.editor-progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #60656d;
  font-size: 12px;
  font-weight: 600;
}

.editor-progress-meta strong {
  color: #202124;
  font-size: 14px;
  font-weight: 600;
}

.editor-progress-track {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: hidden;
}

.editor-progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--arc-primary);
  box-shadow: none;
}

.editor-stage {
  display: flex;
  min-height: 0;
  flex: 1;
}

.tool-badge {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  background: var(--chapter-surface);
  color: #60656d;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.tool-badge:hover {
  border-color: var(--chapter-border-strong);
  background: #f7f7f7;
}

.tool-badge.active {
  border-color: #b8cdf5;
  background: var(--chapter-accent-soft);
  color: #1f4ea3;
  box-shadow: none;
}

.tool-badge.neutral {
  background: var(--chapter-surface);
  color: #60656d;
}

.tool-badge.neutral.active {
  background: var(--chapter-accent-soft);
  color: #1f4ea3;
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
  background: var(--chapter-surface);
  padding: 14px;
  box-shadow: none;
}

.editor-manuscript-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
  gap: 12px;
  align-items: start;
  margin-bottom: 12px;
}

.editor-meta-stack {
  min-width: 0;
}

.manuscript-heading {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.manuscript-overline {
  color: #7a7f87;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.chapter-title {
  width: 100%;
  border: none;
  background: transparent;
  color: #202124;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: 0;
  margin-bottom: 0;
  outline: none;
}

.chapter-title:hover {
  color: #202124;
}

.chapter-meta-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 8px;
}

.meta-chip.neutral {
  background: var(--chapter-surface-soft);
  color: #5f6368;
}

.meta-chip.ghost {
  background: var(--chapter-surface);
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

.summary-card {
  border: 1px solid var(--chapter-border);
  border-radius: 4px;
  background: var(--chapter-surface-soft);
  padding: 12px;
}

.summary-card-label {
  display: inline-flex;
  margin-bottom: 8px;
  color: #7a7f87;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.summary-card p {
  margin: 0;
  color: #4f545c;
  font-size: 12px;
  line-height: 1.6;
}

.manuscript-divider {
  height: 1px;
  margin: 0 0 12px;
  background: var(--chapter-border);
}

.editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
  padding-top: 0;
}

.editor-column {
  width: 100%;
  margin: 0;
}

.editor-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 10px;
  margin-top: 10px;
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
  border-radius: 4px;
  background: var(--chapter-surface-soft);
  color: #4f545c;
  font-weight: 600;
  padding: 5px 8px;
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

  .editor-ribbon {
    grid-template-columns: minmax(0, 1fr);
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
    padding: 0;
  }

  .editor-ribbon {
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
