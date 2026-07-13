<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowLeft, ChevronDown, ChevronsDownUp, FilePlus, FileText, FolderPlus, MoreVertical, Plus, Search } from 'lucide-vue-next'
import { NButton, NDropdown, NForm, NFormItem, NInput, NModal, NSelect, NTag, NTooltip, useDialog, useMessage } from 'naive-ui'
import ChapterMetaDialog from './ChapterMetaDialog.vue'
import { useAppStore } from '@/stores/app'
import { formatVolumeLabel, normalizeVolumeWordTarget } from '@/features/workspace/outlineVolumes'
import { getChapterCharacterCount, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import type { ChapterDraft, OutlineItem, OutlineVolume } from '@/types/app'
import type { DropdownOption, SelectOption } from 'naive-ui'
import { toIpcPayload } from '@/utils/ipcPayload'

const emit = defineEmits<{
  navigate: []
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

const keyword = ref('')
const collapsed = reactive<Record<string, boolean>>({})

const metaDialogVisible = ref(false)
const metaDialogChapter = ref<ChapterDraft | null>(null)
const volumeDialogVisible = ref(false)
const editingVolumeId = ref<string | null>(null)
const createDialogVisible = ref(false)
const createForm = reactive({
  volumeId: '',
  outlineItemId: '',
  title: ''
})
const volumeForm = reactive({
  bindVolumeId: '',
  title: '',
  wordTarget: '',
  summary: ''
})

const chapterMenuOptions: DropdownOption[] = [
  { key: 'edit', label: '编辑章节信息' },
  { key: 'export-txt', label: '导出 TXT' },
  { key: 'delete', label: '删除章节' }
]

const volumeMenuOptions = computed<DropdownOption[]>(() => [
  { key: 'edit', label: '编辑分卷信息' },
  { key: 'delete', label: '删除分卷', disabled: appStore.outlineVolumes.length <= 1 }
])

const filteredGroups = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return appStore.chapterVolumeGroups
  return appStore.chapterVolumeGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((c) =>
        `${c.title} ${c.summary} ${c.status}`.toLowerCase().includes(query)
      )
    }))
    .filter((group) => group.items.length > 0)
})

const totalVisible = computed(() =>
  filteredGroups.value.reduce((n, g) => n + g.items.length, 0)
)

const totalWords = computed(() =>
  appStore.chapters.reduce((n, c) => n + getChapterCharacterCount(c.content), 0)
)

const allCollapsed = computed(() =>
  appStore.outlineVolumes.length > 0 && appStore.outlineVolumes.every((v) => collapsed[v.id])
)

const createVolumeOptions = computed<SelectOption[]>(() =>
  appStore.outlineVolumes.map((volume, index) => ({
    label: formatVolumeLabel(volume, index, 'formal'),
    value: volume.id
  }))
)

const bindVolumeOptions = computed<SelectOption[]>(() => [
  { label: '新建一条分卷信息', value: '' },
  ...createVolumeOptions.value
])

const createOutlineOptions = computed<SelectOption[]>(() => {
  const targetVolumeId = createForm.volumeId
  if (!targetVolumeId) return []
  const items = appStore.outlineItems.filter((item) => !targetVolumeId || item.volumeId === targetVolumeId)
  return items.map((item) => {
    const linkedCount = appStore.chapters.filter((chapter) => chapter.outlineItemId === item.id).length
    return {
      label: linkedCount > 0 ? `${item.title} · 已关联 ${linkedCount} 章，可继续绑定` : item.title,
      value: item.id
    }
  })
})

const selectedCreateOutline = computed<OutlineItem | null>(() =>
  appStore.outlineItems.find((item) => item.id === createForm.outlineItemId && item.volumeId === createForm.volumeId) ?? null
)

watch(
  () => createForm.volumeId,
  (volumeId) => {
    const firstOutline = appStore.outlineItems.find((item) => item.volumeId === volumeId)
    createForm.outlineItemId = firstOutline?.id ?? ''
    createForm.title = firstOutline?.title ?? ''
  }
)

watch(
  () => createForm.outlineItemId,
  () => {
    const item = selectedCreateOutline.value
    if (!item) return
    createForm.title = item.title
  }
)

function toggleVolume(id: string): void {
  collapsed[id] = !collapsed[id]
}

function toggleCollapseAll(): void {
  const next = !allCollapsed.value
  for (const v of appStore.outlineVolumes) collapsed[v.id] = next
}

function allowDigitsOnly(value: string): boolean {
  return /^\d*$/.test(value)
}

function openVolumeDialog(volume?: OutlineVolume): void {
  editingVolumeId.value = volume?.id ?? null
  volumeForm.bindVolumeId = ''
  volumeForm.title = volume?.title ?? ''
  volumeForm.wordTarget = normalizeVolumeWordTarget(volume?.wordTarget) || '50000'
  volumeForm.summary = volume?.summary ?? ''
  volumeDialogVisible.value = true
}

function closeVolumeDialog(): void {
  volumeDialogVisible.value = false
}

function handleBindVolumeChange(volumeId: string): void {
  volumeForm.bindVolumeId = volumeId
  if (!volumeId) {
    volumeForm.title = ''
    volumeForm.wordTarget = '50000'
    volumeForm.summary = ''
    return
  }

  const volume = appStore.outlineVolumes.find((item) => item.id === volumeId)
  if (!volume) return
  volumeForm.title = volume.title
  volumeForm.wordTarget = normalizeVolumeWordTarget(volume.wordTarget) || '50000'
  volumeForm.summary = volume.summary
}

function submitVolume(): void {
  if (!volumeForm.title.trim()) {
    message.warning('请填写分卷标题')
    return
  }

  const payload = {
    title: volumeForm.title,
    wordTarget: normalizeVolumeWordTarget(volumeForm.wordTarget),
    summary: volumeForm.summary
  }

  if (editingVolumeId.value) {
    appStore.updateOutlineVolume(editingVolumeId.value, payload)
    message.success('分卷信息已更新')
  } else if (volumeForm.bindVolumeId) {
    appStore.updateOutlineVolume(volumeForm.bindVolumeId, payload)
    collapsed[volumeForm.bindVolumeId] = false
    message.success('已绑定大纲分卷信息')
  } else {
    const volumeId = appStore.createOutlineVolume(payload)
    collapsed[volumeId] = false
    message.success('已新建分卷信息')
  }

  closeVolumeDialog()
}

function handleDeleteVolume(volume: OutlineVolume): void {
  if (appStore.outlineVolumes.length <= 1) {
    message.warning('至少需要保留一个分卷')
    return
  }

  const volumeIndex = appStore.outlineVolumes.findIndex((item) => item.id === volume.id)
  const remainingVolumes = appStore.outlineVolumes.filter((item) => item.id !== volume.id)
  const fallbackVolume = remainingVolumes[Math.max(0, volumeIndex - 1)] ?? remainingVolumes[0]
  const chapterCount = appStore.chapters.filter((chapter) => chapter.volumeId === volume.id).length
  const outlineCount = appStore.outlineItems.filter((item) => item.volumeId === volume.id).length
  const fallbackTitle = fallbackVolume?.title ? `「${fallbackVolume.title}」` : '相邻分卷'

  dialog.warning({
    title: '确认删除分卷',
    content: `确定要删除"${volume.title}"吗？该分卷下的 ${chapterCount} 个章节和 ${outlineCount} 个大纲节点会移至${fallbackTitle}，分卷级创作记忆将一并删除。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteOutlineVolume(volume.id)
      message.success('分卷已删除')
    }
  })
}

function handleVolumeMenuSelect(key: string | number, volume: OutlineVolume): void {
  if (key === 'edit') {
    openVolumeDialog(volume)
    return
  }

  if (key === 'delete') {
    handleDeleteVolume(volume)
  }
}

function openCreateDialog(volumeId?: string): void {
  const targetVolumeId = volumeId ?? ''
  const firstOutline = targetVolumeId
    ? appStore.outlineItems.find((item) => item.volumeId === targetVolumeId)
    : null
  createForm.volumeId = targetVolumeId
  createForm.outlineItemId = firstOutline?.id ?? ''
  createForm.title = firstOutline?.title ?? ''
  createDialogVisible.value = true
}

function closeCreateDialog(): void {
  createDialogVisible.value = false
}

function submitCreateChapter(): void {
  if (!createForm.volumeId) {
    message.warning('请先选择所属分卷')
    return
  }
  const item = selectedCreateOutline.value
  if (!item) {
    message.warning('请先选择要绑定的大纲节点')
    return
  }
  if (!createForm.title.trim()) {
    message.warning('请填写章节标题')
    return
  }

  appStore.createChapterFromOutlineItem(item)
  appStore.updateChapter(appStore.selectedChapterId, {
    title: createForm.title.trim()
  })
  appStore.updateOutlineItem(item.id, {
    status: item.status === 'done' ? 'done' : 'drafting'
  })
  message.success('已根据大纲新建章节')
  closeCreateDialog()
  emit('navigate')
}

function formatStatus(status: ChapterDraft['status']): string {
  switch (status) {
    case 'final': return '已定稿'
    case 'polish': return '待润色'
    case 'review': return '待检查'
    default: return '草稿'
  }
}

function statusType(status: ChapterDraft['status']): 'default' | 'info' | 'success' | 'warning' {
  switch (status) {
    case 'final': return 'success'
    case 'polish': return 'info'
    case 'review': return 'warning'
    default: return 'default'
  }
}

function buildChapterExportFileName(chapter: ChapterDraft): string {
  const safeTitle = (chapter.title?.trim() || '未命名章节')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
  return `${safeTitle}.txt`
}

async function handleExportChapterTxt(chapter: ChapterDraft): Promise<void> {
  const result = await window.characterArc.exportChapterTxt(toIpcPayload({
    title: chapter.title,
    content: getPlainTextFromEditorContent(chapter.content ?? ''),
    defaultFileName: buildChapterExportFileName(chapter)
  }))

  if (result.success) {
    message.success(`已导出《${chapter.title || '未命名章节'}》TXT`)
    return
  }

  if (!result.canceled) {
    message.error(result.error ?? '导出章节 TXT 失败')
  }
}

function handleMenuSelect(key: string | number, chapter: ChapterDraft): void {
  if (key === 'edit') {
    metaDialogChapter.value = chapter
    metaDialogVisible.value = true
    return
  }
  if (key === 'export-txt') {
    void handleExportChapterTxt(chapter)
    return
  }
  if (key === 'delete') {
    if (appStore.chapters.length <= 1) return
    dialog.warning({
      title: '确认删除章节',
      content: `确定要删除"${chapter.title}"吗？删除后当前章节草稿将无法恢复。`,
      positiveText: '确认删除',
      negativeText: '取消',
      autoFocus: false,
      closable: false,
      onPositiveClick: () => appStore.deleteChapter(chapter.id)
    })
  }
}
</script>

<template>
  <aside class="tree-sidebar">
    <header class="ts-header">
      <div class="project-name">
        <span class="dot" />
        {{ appStore.currentProject?.title || '未命名项目' }}
      </div>
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn" @click="appStore.backToWorkbench()">
            <ArrowLeft :size="14" />
          </button>
        </template>
        返回工作台
      </n-tooltip>
    </header>

    <div class="ts-toolbar">
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn flex" @click="openVolumeDialog()"><FolderPlus :size="14" /></button>
        </template>
        新建分卷信息
      </n-tooltip>
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn flex" @click="openCreateDialog()"><FilePlus :size="14" /></button>
        </template>
        新建章节
      </n-tooltip>
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <button class="icon-btn flex" @click="toggleCollapseAll">
            <ChevronsDownUp :size="14" />
          </button>
        </template>
        {{ allCollapsed ? '展开全部' : '折叠全部' }}
      </n-tooltip>
    </div>

    <div class="ts-search">
      <Search :size="12" />
      <input v-model="keyword" placeholder="搜索章节..." />
    </div>

    <div class="ts-scroll arc-scrollbar">
      <section
        v-for="group in filteredGroups"
        :key="group.volume.id"
        class="volume"
        :class="{ collapsed: collapsed[group.volume.id] }"
      >
        <button class="volume-head" @click="toggleVolume(group.volume.id)">
          <ChevronDown :size="13" class="chevron" />
          <span class="volume-title">{{ formatVolumeLabel(group.volume, group.index, 'compact') }}</span>
          <span class="volume-meta">{{ group.items.length }}</span>
          <n-dropdown :options="volumeMenuOptions" placement="bottom-end" @select="(k) => handleVolumeMenuSelect(k, group.volume)">
            <span class="volume-more" @click.stop>
              <MoreVertical :size="12" />
            </span>
          </n-dropdown>
        </button>

        <div v-show="!collapsed[group.volume.id]" class="chapter-list">
          <button
            v-for="chapter in group.items"
            :key="chapter.id"
            class="chapter-row"
            :class="{ active: appStore.selectedChapterId === chapter.id }"
            @click="appStore.selectChapter(chapter.id); emit('navigate')"
          >
            <FileText :size="13" class="chap-icon" />
            <span class="chap-title">{{ chapter.title }}</span>
            <n-tag size="tiny" :type="statusType(chapter.status)" :bordered="false">
              {{ formatStatus(chapter.status) }}
            </n-tag>
            <n-dropdown :options="chapterMenuOptions" placement="bottom-end" @select="(k) => handleMenuSelect(k, chapter)">
              <span class="chap-more" @click.stop>
                <MoreVertical :size="12" />
              </span>
            </n-dropdown>
          </button>
          <button class="chapter-add" @click="openCreateDialog(group.volume.id)">
            <Plus :size="12" /> 新增章节
          </button>
        </div>
      </section>
    </div>

    <footer class="ts-footer">
      <span>{{ totalVisible }} / {{ appStore.chapters.length }} 章 · {{ totalWords.toLocaleString() }} 字</span>
    </footer>

    <ChapterMetaDialog
      v-model:show="metaDialogVisible"
      :chapter="metaDialogChapter"
    />

    <NModal
      v-model:show="volumeDialogVisible"
      preset="card"
      :title="editingVolumeId ? '编辑分卷信息' : '新建分卷信息'"
      :style="{ width: 'min(560px, 92vw)' }"
      :bordered="false"
    >
      <NForm label-placement="top">
        <NFormItem v-if="!editingVolumeId" label="绑定大纲分卷信息">
          <NSelect
            :value="volumeForm.bindVolumeId"
            :options="bindVolumeOptions"
            placeholder="选择已有大纲分卷，或保持新建"
            filterable
            @update:value="handleBindVolumeChange"
          />
        </NFormItem>
        <NFormItem label="分卷标题">
          <NInput v-model:value="volumeForm.title" placeholder="例如：霓虹下的老鼠" />
        </NFormItem>
        <NFormItem label="目标字数">
          <NInput v-model:value="volumeForm.wordTarget" placeholder="例如：50000" :allow-input="allowDigitsOnly">
            <template #suffix>字</template>
          </NInput>
        </NFormItem>
        <NFormItem label="分卷摘要">
          <NInput
            v-model:value="volumeForm.summary"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            placeholder="概括这一卷的主线、冲突和情绪走向..."
          />
        </NFormItem>
      </NForm>

      <template #footer>
        <div class="create-actions">
          <NButton round strong @click="closeVolumeDialog">取消</NButton>
          <NButton type="primary" round strong @click="submitVolume">
            {{ editingVolumeId ? '保存分卷信息' : (volumeForm.bindVolumeId ? '绑定分卷信息' : '创建分卷信息') }}
          </NButton>
        </div>
      </template>
    </NModal>

    <NModal
      v-model:show="createDialogVisible"
      preset="card"
      title="新建章节"
      :style="{ width: 'min(520px, 92vw)' }"
      :bordered="false"
    >
      <NForm label-placement="top">
        <NFormItem label="所属分卷">
          <NSelect
            v-model:value="createForm.volumeId"
            :options="createVolumeOptions"
            placeholder="选择这一章所在的分卷"
          />
        </NFormItem>
        <NFormItem label="选择大纲">
          <NSelect
            v-model:value="createForm.outlineItemId"
            :options="createOutlineOptions"
            placeholder="先选择分卷，再选择要写作的大纲节点"
            filterable
          />
        </NFormItem>
        <NFormItem label="章节标题">
          <NInput v-model:value="createForm.title" placeholder="选择大纲后自动带入标题" />
        </NFormItem>
      </NForm>

      <template #footer>
        <div class="create-actions">
          <NButton round strong @click="closeCreateDialog">取消</NButton>
          <NButton type="primary" round strong :disabled="!createForm.volumeId || !selectedCreateOutline" @click="submitCreateChapter">
            创建章节
          </NButton>
        </div>
      </template>
    </NModal>
  </aside>
</template>

<style scoped>
.tree-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--arc-bg-weak);
  border-right: 1px solid var(--arc-border);
  overflow: hidden;
}

.ts-header {
  padding: 12px 12px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--arc-border);
}

.project-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-name .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-success);
  flex-shrink: 0;
}

.icon-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: 0.15s;
}

.icon-btn:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.icon-btn.flex { flex: 1; }

.ts-toolbar {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--arc-border);
}

.ts-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 12px;
  padding: 6px 10px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-sm);
  color: var(--arc-text-hint);
}

.ts-search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--arc-text-primary);
}

.ts-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 12px;
}

.volume {
  margin-bottom: 2px;
}

.volume-head {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 12px 6px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  color: var(--arc-text-secondary);
  letter-spacing: 0.04em;
}

.volume-head:hover {
  background: var(--arc-bg-surface-hover);
}

.volume-head .chevron {
  transition: transform 0.15s;
  flex-shrink: 0;
}

.volume.collapsed .chevron {
  transform: rotate(-90deg);
}

.volume-title {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.volume-meta {
  font-size: 11px;
  color: var(--arc-text-hint);
  font-weight: 500;
}

.volume-more {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--arc-text-hint);
  flex-shrink: 0;
}

.volume-more:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.chapter-list {
  display: flex;
  flex-direction: column;
}

.chapter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 7px 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--arc-text-primary);
  border-left: 2px solid transparent;
  text-align: left;
  transition: background 0.15s ease;
}

.chapter-row:hover {
  background: var(--arc-bg-surface-hover);
}

.chapter-row.active {
  background: var(--arc-primary-soft);
  border-left-color: var(--arc-primary);
  font-weight: 500;
}

.chapter-row .chap-icon {
  color: var(--arc-text-hint);
  flex-shrink: 0;
}

.chapter-row.active .chap-icon {
  color: var(--arc-primary);
}

.chap-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chap-more {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--arc-text-hint);
}

.chap-more:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

.chapter-add {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px 5px 26px;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--arc-text-hint);
  cursor: pointer;
}

.chapter-add:hover {
  color: var(--arc-primary);
  background: var(--arc-bg-surface-hover);
}

.ts-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--arc-border);
  font-size: 11px;
  color: var(--arc-text-hint);
}

.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
