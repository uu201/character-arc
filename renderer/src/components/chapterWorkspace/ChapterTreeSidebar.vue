<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, ChevronDown, ChevronsDownUp, FilePlus, FileText, FolderPlus, GripVertical, ListChecks, MoreVertical, Plus, Search } from 'lucide-vue-next'
import { NButton, NCheckbox, NDropdown, NForm, NFormItem, NInput, NModal, NSelect, NSwitch, NTag, NTooltip, useDialog, useMessage } from 'naive-ui'
import ChapterMetaDialog from './ChapterMetaDialog.vue'
import { useAppStore } from '@/stores/app'
import { formatVolumeLabel, normalizeVolumeWordTarget } from '@/features/workspace/outlineVolumes'
import { getChapterCharacterCount, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import type { OutlineDropPosition } from '@/features/workspace/outlineReorder'
import { readCollapsedVolumeIds, writeCollapsedVolumeIds } from '@/features/workspace/volumeCollapseState'
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
const draggingChapterId = ref<string | null>(null)
const dragTargetChapterId = ref<string | null>(null)
const dragTargetPosition = ref<OutlineDropPosition | null>(null)
const dragTargetVolumeId = ref<string | null>(null)
const draggingVolumeId = ref<string | null>(null)
const volumeDragTargetId = ref<string | null>(null)
const volumeDragTargetPosition = ref<OutlineDropPosition | null>(null)

const metaDialogVisible = ref(false)
const metaDialogChapter = ref<ChapterDraft | null>(null)
const volumeDialogVisible = ref(false)
const editingVolumeId = ref<string | null>(null)
const createDialogVisible = ref(false)
const batchDialogVisible = ref(false)
const batchSubmitting = ref(false)
const batchStatus = ref<ChapterDraft['status']>('final')
const batchSyncStoryState = ref(true)
const batchSelectedIds = ref<string[]>([])
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

const chapterStatusOptions: SelectOption[] = [
  { label: '草稿中', value: 'draft' },
  { label: '待检查', value: 'review' },
  { label: '待润色', value: 'polish' },
  { label: '已定稿', value: 'final' }
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

const batchSelectedSet = computed(() => new Set(batchSelectedIds.value))
const batchSelectedChapters = computed(() =>
  appStore.chapters.filter((chapter) => batchSelectedSet.value.has(chapter.id))
)
const batchSyncEligibleIds = computed(() =>
  batchSelectedChapters.value
    .filter((chapter) => getPlainTextFromEditorContent(chapter.content).trim().length >= 50)
    .map((chapter) => chapter.id)
)

type ChapterTreeGroup = (typeof appStore.chapterVolumeGroups)[number]
type ChapterTreeRow =
  | { key: string; kind: 'volume'; group: ChapterTreeGroup }
  | { key: string; kind: 'chapter'; group: ChapterTreeGroup; chapter: ChapterDraft }
  | { key: string; kind: 'add'; group: ChapterTreeGroup }

const TREE_ROW_HEIGHT = 40
const TREE_OVERSCAN = 8
const treeScrollRef = ref<HTMLDivElement | null>(null)
const treeScrollTop = ref(0)
const treeViewportHeight = ref(0)
let treeResizeObserver: ResizeObserver | null = null

const treeRows = computed<ChapterTreeRow[]>(() => {
  const rows: ChapterTreeRow[] = []
  for (const group of filteredGroups.value) {
    rows.push({ key: `volume:${group.volume.id}`, kind: 'volume', group })
    if (isVolumeCollapsed(group.volume.id)) continue
    for (const chapter of group.items) {
      rows.push({ key: `chapter:${chapter.id}`, kind: 'chapter', group, chapter })
    }
    rows.push({ key: `add:${group.volume.id}`, kind: 'add', group })
  }
  return rows
})

const virtualTreeWindow = computed(() => {
  const total = treeRows.value.length
  const start = Math.max(0, Math.floor(treeScrollTop.value / TREE_ROW_HEIGHT) - TREE_OVERSCAN)
  const visibleCount = Math.ceil(treeViewportHeight.value / TREE_ROW_HEIGHT) + TREE_OVERSCAN * 2
  const end = Math.min(total, start + Math.max(visibleCount, TREE_OVERSCAN * 2))
  return {
    rows: treeRows.value.slice(start, end),
    top: start * TREE_ROW_HEIGHT,
    bottom: Math.max(0, (total - end) * TREE_ROW_HEIGHT)
  }
})

function syncTreeViewport(): void {
  const el = treeScrollRef.value
  if (!el) return
  treeScrollTop.value = el.scrollTop
  treeViewportHeight.value = el.clientHeight
}

function handleTreeScroll(event: Event): void {
  treeScrollTop.value = (event.currentTarget as HTMLDivElement).scrollTop
}

const allCollapsed = computed(() =>
  appStore.outlineVolumes.length > 0 && appStore.outlineVolumes.every((v) => collapsed[v.id])
)

function currentVolumeIds(): string[] {
  return appStore.outlineVolumes.map((volume) => volume.id)
}

function loadCollapsedVolumes(): void {
  for (const volumeId of Object.keys(collapsed)) delete collapsed[volumeId]
  const storedIds = readCollapsedVolumeIds(
    window.localStorage,
    'chapter-tree',
    appStore.selectedProjectId,
    currentVolumeIds()
  )
  for (const volumeId of storedIds) collapsed[volumeId] = true
}

function persistCollapsedVolumes(): void {
  writeCollapsedVolumeIds(
    window.localStorage,
    'chapter-tree',
    appStore.selectedProjectId,
    Object.keys(collapsed).filter((volumeId) => collapsed[volumeId]),
    currentVolumeIds()
  )
}

function isVolumeCollapsed(volumeId: string): boolean {
  return !keyword.value.trim() && Boolean(collapsed[volumeId])
}

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

watch(
  () => treeRows.value.length,
  () => {
    requestAnimationFrame(() => {
      const el = treeScrollRef.value
      if (!el) return
      const maxScroll = Math.max(0, treeRows.value.length * TREE_ROW_HEIGHT - el.clientHeight)
      if (el.scrollTop > maxScroll) el.scrollTop = maxScroll
      syncTreeViewport()
    })
  }
)

watch(
  () => appStore.selectedChapterId,
  (chapterId) => {
    requestAnimationFrame(() => {
      const el = treeScrollRef.value
      if (!el) return
      const index = treeRows.value.findIndex((row) => row.kind === 'chapter' && row.chapter.id === chapterId)
      if (index < 0) return
      const top = index * TREE_ROW_HEIGHT
      const bottom = top + TREE_ROW_HEIGHT
      if (top < el.scrollTop) el.scrollTop = top
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    })
  }
)

onMounted(() => {
  syncTreeViewport()
  treeResizeObserver = new ResizeObserver(syncTreeViewport)
  if (treeScrollRef.value) treeResizeObserver.observe(treeScrollRef.value)
})

onBeforeUnmount(() => {
  treeResizeObserver?.disconnect()
})

function toggleVolume(id: string): void {
  collapsed[id] = !collapsed[id]
  persistCollapsedVolumes()
}

function toggleCollapseAll(): void {
  const next = !allCollapsed.value
  for (const v of appStore.outlineVolumes) collapsed[v.id] = next
  persistCollapsedVolumes()
}

watch(
  [
    () => appStore.selectedProjectId,
    () => appStore.outlineVolumes.map((volume) => volume.id).join('|')
  ],
  loadCollapsedVolumes,
  { immediate: true }
)

function setBatchSelection(chapterIds: string[]): void {
  batchSelectedIds.value = [...new Set(chapterIds)]
}

function openBatchStatusDialog(): void {
  batchStatus.value = 'final'
  batchSyncStoryState.value = true
  const currentVolumeId = appStore.selectedChapter?.volumeId ?? appStore.outlineVolumes[0]?.id ?? ''
  const currentVolumePending = appStore.chapters
    .filter((chapter) => chapter.volumeId === currentVolumeId && chapter.status !== 'final')
    .map((chapter) => chapter.id)
  setBatchSelection(currentVolumePending)
  batchDialogVisible.value = true
}

function selectAllPendingChapters(): void {
  setBatchSelection(appStore.chapters.filter((chapter) => chapter.status !== 'final').map((chapter) => chapter.id))
}

function selectCurrentVolumeChapters(): void {
  const currentVolumeId = appStore.selectedChapter?.volumeId ?? appStore.outlineVolumes[0]?.id ?? ''
  setBatchSelection(appStore.chapters.filter((chapter) => chapter.volumeId === currentVolumeId).map((chapter) => chapter.id))
}

function toggleBatchChapter(chapterId: string, checked: boolean): void {
  const next = new Set(batchSelectedIds.value)
  if (checked) next.add(chapterId)
  else next.delete(chapterId)
  batchSelectedIds.value = [...next]
}

function toggleBatchVolume(volumeId: string, checked: boolean): void {
  const next = new Set(batchSelectedIds.value)
  for (const chapter of appStore.chapters) {
    if (chapter.volumeId !== volumeId) continue
    if (checked) next.add(chapter.id)
    else next.delete(chapter.id)
  }
  batchSelectedIds.value = [...next]
}

function isBatchVolumeChecked(volumeId: string): boolean {
  const chapters = appStore.chapters.filter((chapter) => chapter.volumeId === volumeId)
  return chapters.length > 0 && chapters.every((chapter) => batchSelectedSet.value.has(chapter.id))
}

function isBatchVolumeIndeterminate(volumeId: string): boolean {
  const chapters = appStore.chapters.filter((chapter) => chapter.volumeId === volumeId)
  const selectedCount = chapters.filter((chapter) => batchSelectedSet.value.has(chapter.id)).length
  return selectedCount > 0 && selectedCount < chapters.length
}

async function submitBatchStatus(): Promise<void> {
  if (batchSubmitting.value) return
  const selectedChapters = batchSelectedChapters.value
  if (selectedChapters.length === 0) {
    message.warning('请至少选择一个章节。')
    return
  }

  const previousStatuses = new Map(selectedChapters.map((chapter) => [chapter.id, chapter.status]))
  batchSubmitting.value = true
  try {
    const changed = appStore.updateChapterStatuses(batchSelectedIds.value, batchStatus.value)
    await appStore.persistWorkspace()
    if (appStore.persistenceError) {
      for (const status of ['draft', 'review', 'polish', 'final'] as const) {
        const ids = [...previousStatuses.entries()].filter(([, previous]) => previous === status).map(([id]) => id)
        if (ids.length) appStore.updateChapterStatuses(ids, status)
      }
      message.error(`批量修改失败：${appStore.persistenceError}`)
      return
    }

    const shouldSync = batchStatus.value === 'final' && batchSyncStoryState.value
    const eligibleIds = [...batchSyncEligibleIds.value]
    const skippedCount = selectedChapters.length - eligibleIds.length
    batchDialogVisible.value = false
    message.success(changed > 0 ? `已更新 ${changed} 个章节的状态。` : '所选章节已经是目标状态。')

    if (!shouldSync) return
    if (skippedCount > 0) message.warning(`${skippedCount} 个章节正文过短，已跳过故事状态同步。`)
    if (eligibleIds.length === 0) return
    void appStore.startChapterStateSync(eligibleIds).catch((error) => {
      message.error(`故事状态同步启动失败：${error instanceof Error ? error.message : '未知错误'}`)
    })
  } catch (error) {
    message.error(`批量修改失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    batchSubmitting.value = false
  }
}

function readDraggedChapterId(event: DragEvent): string {
  const dataStr = event.dataTransfer?.getData('text/plain') ?? ''
  return dataStr.trim()
}

function readDraggedVolumeId(event: DragEvent): string {
  const dataStr = event.dataTransfer?.getData('text/plain') ?? ''
  return dataStr.trim()
}

function resolveDropPosition(event: DragEvent): OutlineDropPosition {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function autoScrollDragContainer(event: DragEvent): void {
  const container = (event.currentTarget as HTMLElement).closest('.ts-scroll')
  if (!(container instanceof HTMLElement)) {
    return
  }

  const rect = container.getBoundingClientRect()
  const edgeSize = Math.min(56, rect.height / 4)
  const maxStep = 14
  if (event.clientY < rect.top + edgeSize) {
    const intensity = (rect.top + edgeSize - event.clientY) / edgeSize
    container.scrollBy({ top: -Math.ceil(maxStep * intensity) })
  } else if (event.clientY > rect.bottom - edgeSize) {
    const intensity = (event.clientY - (rect.bottom - edgeSize)) / edgeSize
    container.scrollBy({ top: Math.ceil(maxStep * intensity) })
  }
}

function handleChapterDragStart(chapterId: string, event: DragEvent): void {
  draggingChapterId.value = chapterId
  dragTargetChapterId.value = null
  dragTargetPosition.value = null
  dragTargetVolumeId.value = null
  resetVolumeDragState()

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', chapterId)
    const dragImage = (event.currentTarget as HTMLElement).closest('.chapter-row')
    if (dragImage instanceof HTMLElement) {
      event.dataTransfer.setDragImage(dragImage, 24, 18)
    }
  }
}

function handleVolumeDragStart(volumeId: string, event: DragEvent): void {
  draggingVolumeId.value = volumeId
  volumeDragTargetId.value = null
  volumeDragTargetPosition.value = null
  draggingChapterId.value = null
  dragTargetChapterId.value = null
  dragTargetPosition.value = null
  dragTargetVolumeId.value = null

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', volumeId)
    const dragImage = (event.currentTarget as HTMLElement).closest('.volume-head')
    if (dragImage instanceof HTMLElement) {
      event.dataTransfer.setDragImage(dragImage, 24, 14)
    }
  }
}

function handleChapterDragOver(chapterId: string, event: DragEvent): void {
  if (!draggingChapterId.value || draggingChapterId.value === chapterId) {
    return
  }

  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  autoScrollDragContainer(event)
  dragTargetChapterId.value = chapterId
  dragTargetPosition.value = resolveDropPosition(event)
  dragTargetVolumeId.value = null
}

function handleChapterDragLeave(chapterId: string, event: DragEvent): void {
  const currentTarget = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget
  if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
    return
  }
  if (dragTargetChapterId.value === chapterId) {
    dragTargetChapterId.value = null
    dragTargetPosition.value = null
  }
}

function handleChapterDrop(chapterId: string, event: DragEvent): void {
  event.preventDefault()
  const draggedChapterId = readDraggedChapterId(event)

  if (!draggedChapterId || draggedChapterId === chapterId) {
    resetChapterDragState()
    return
  }

  const position = dragTargetChapterId.value === chapterId && dragTargetPosition.value
    ? dragTargetPosition.value
    : resolveDropPosition(event)
  appStore.moveChapter(draggedChapterId, chapterId, position)
  resetChapterDragState()
}

function handleVolumeDragOver(volumeId: string, event: DragEvent): void {
  if (draggingVolumeId.value) {
    if (draggingVolumeId.value === volumeId) {
      return
    }

    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    autoScrollDragContainer(event)
    volumeDragTargetId.value = volumeId
    volumeDragTargetPosition.value = resolveDropPosition(event)
    dragTargetVolumeId.value = null
    return
  }

  if (!draggingChapterId.value) {
    return
  }

  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  autoScrollDragContainer(event)
  dragTargetChapterId.value = null
  dragTargetPosition.value = null
  dragTargetVolumeId.value = volumeId
}

function handleVolumeDragLeave(volumeId: string, event: DragEvent): void {
  const currentTarget = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget
  if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
    return
  }
  if (dragTargetVolumeId.value === volumeId) {
    dragTargetVolumeId.value = null
  }
  if (volumeDragTargetId.value === volumeId) {
    volumeDragTargetId.value = null
    volumeDragTargetPosition.value = null
  }
}

function handleDropOnVolume(volumeId: string, event: DragEvent): void {
  event.preventDefault()
  if (draggingVolumeId.value) {
    const draggedVolumeId = readDraggedVolumeId(event)

    if (!draggedVolumeId || draggedVolumeId === volumeId) {
      resetVolumeDragState()
      return
    }

    const position = volumeDragTargetId.value === volumeId && volumeDragTargetPosition.value
      ? volumeDragTargetPosition.value
      : resolveDropPosition(event)
    appStore.moveOutlineVolume(draggedVolumeId, volumeId, position)
    resetVolumeDragState()
    return
  }

  const draggedChapterId = readDraggedChapterId(event)

  if (!draggedChapterId) {
    resetChapterDragState()
    return
  }

  appStore.moveChaptersToVolumeEnd([draggedChapterId], volumeId)
  resetChapterDragState()
}

function resetChapterDragState(): void {
  draggingChapterId.value = null
  dragTargetChapterId.value = null
  dragTargetPosition.value = null
  dragTargetVolumeId.value = null
}

function resetVolumeDragState(): void {
  draggingVolumeId.value = null
  volumeDragTargetId.value = null
  volumeDragTargetPosition.value = null
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
    persistCollapsedVolumes()
    message.success('已绑定大纲分卷信息')
  } else {
    const volumeId = appStore.createOutlineVolume(payload)
    collapsed[volumeId] = false
    persistCollapsedVolumes()
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
          <button class="icon-btn flex" @click="openBatchStatusDialog"><ListChecks :size="14" /></button>
        </template>
        批量修改章节状态
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

    <div ref="treeScrollRef" class="ts-scroll arc-scrollbar" @scroll="handleTreeScroll">
      <div :style="{ height: virtualTreeWindow.top + 'px' }" aria-hidden="true" />
      <template v-for="row in virtualTreeWindow.rows" :key="row.key">
        <section
          v-if="row.kind === 'volume'"
          class="volume virtual-tree-row"
          :class="{
            collapsed: isVolumeCollapsed(row.group.volume.id),
            'drop-target': dragTargetVolumeId === row.group.volume.id,
            'volume-dragging': draggingVolumeId === row.group.volume.id,
            'volume-drop-before': volumeDragTargetId === row.group.volume.id && volumeDragTargetPosition === 'before',
            'volume-drop-after': volumeDragTargetId === row.group.volume.id && volumeDragTargetPosition === 'after'
          }"
          @dragover="handleVolumeDragOver(row.group.volume.id, $event)"
          @dragleave="handleVolumeDragLeave(row.group.volume.id, $event)"
          @drop="handleDropOnVolume(row.group.volume.id, $event)"
        >
        <button class="volume-head" @click="toggleVolume(row.group.volume.id)">
          <span
            class="volume-grip"
            draggable="true"
            title="拖动分卷排序"
            aria-label="拖动分卷排序"
            @click.stop
            @dragstart.stop="handleVolumeDragStart(row.group.volume.id, $event)"
            @dragend.stop="resetVolumeDragState"
          >
            <GripVertical :size="12" />
          </span>
          <ChevronDown :size="13" class="chevron" />
          <span class="volume-title">{{ formatVolumeLabel(row.group.volume, row.group.index, 'compact') }}</span>
          <span
            v-if="volumeDragTargetId === row.group.volume.id && volumeDragTargetPosition"
            class="volume-drop-label"
          >
            {{ volumeDragTargetPosition === 'before' ? '移到卷前' : '移到卷后' }}
          </span>
          <span v-if="dragTargetVolumeId === row.group.volume.id" class="volume-drop-label">放到卷末</span>
          <span class="volume-meta">{{ row.group.items.length }}</span>
          <n-dropdown :options="volumeMenuOptions" placement="bottom-end" @select="(k) => handleVolumeMenuSelect(k, row.group.volume)">
            <span class="volume-more" @click.stop>
              <MoreVertical :size="12" />
            </span>
          </n-dropdown>
        </button>
        </section>

        <div v-else-if="row.kind === 'chapter'" class="chapter-list virtual-tree-row">
          <button
            class="chapter-row"
            :class="{
              active: appStore.selectedChapterId === row.chapter.id,
              dragging: draggingChapterId === row.chapter.id,
              'drop-before': dragTargetChapterId === row.chapter.id && dragTargetPosition === 'before',
              'drop-after': dragTargetChapterId === row.chapter.id && dragTargetPosition === 'after'
            }"
            @click="appStore.selectChapter(row.chapter.id); emit('navigate')"
            @dragover.stop="draggingVolumeId ? handleVolumeDragOver(row.group.volume.id, $event) : handleChapterDragOver(row.chapter.id, $event)"
            @dragleave.stop="draggingVolumeId ? handleVolumeDragLeave(row.group.volume.id, $event) : handleChapterDragLeave(row.chapter.id, $event)"
            @drop.stop="draggingVolumeId ? handleDropOnVolume(row.group.volume.id, $event) : handleChapterDrop(row.chapter.id, $event)"
          >
            <span
              class="chap-grip"
              draggable="true"
              title="拖动排序"
              aria-label="拖动排序"
              @click.stop
              @dragstart.stop="handleChapterDragStart(row.chapter.id, $event)"
              @dragend.stop="resetChapterDragState"
            >
              <GripVertical :size="13" />
            </span>
            <FileText :size="13" class="chap-icon" />
            <span class="chap-title">{{ row.chapter.title }}</span>
            <n-tag size="tiny" :type="statusType(row.chapter.status)" :bordered="false">
              {{ formatStatus(row.chapter.status) }}
            </n-tag>
            <n-dropdown :options="chapterMenuOptions" placement="bottom-end" @select="(k) => handleMenuSelect(k, row.chapter)">
              <span class="chap-more" @click.stop>
                <MoreVertical :size="12" />
              </span>
            </n-dropdown>
          </button>
        </div>

        <div v-else class="chapter-list virtual-tree-row">
          <button class="chapter-add" @click="openCreateDialog(row.group.volume.id)">
            <Plus :size="12" /> 新增章节
          </button>
        </div>
      </template>
      <div :style="{ height: virtualTreeWindow.bottom + 'px' }" aria-hidden="true" />
    </div>

    <footer class="ts-footer">
      <span>{{ totalVisible }} / {{ appStore.chapters.length }} 章 · {{ totalWords.toLocaleString() }} 字</span>
    </footer>

    <ChapterMetaDialog
      v-model:show="metaDialogVisible"
      :chapter="metaDialogChapter"
    />

    <NModal
      v-model:show="batchDialogVisible"
      preset="card"
      title="批量修改章节状态"
      :style="{ width: 'min(680px, 94vw)' }"
      :bordered="false"
      :mask-closable="!batchSubmitting"
      :closable="!batchSubmitting"
    >
      <div class="batch-status-layout">
        <div class="batch-quick-actions">
          <NButton size="small" secondary @click="selectCurrentVolumeChapters">选择当前卷</NButton>
          <NButton size="small" secondary @click="selectAllPendingChapters">选择全部未定稿</NButton>
          <NButton size="small" tertiary @click="setBatchSelection(appStore.chapters.map((chapter) => chapter.id))">全选</NButton>
          <NButton size="small" tertiary @click="setBatchSelection([])">清空</NButton>
          <span>{{ batchSelectedIds.length }} / {{ appStore.chapters.length }} 章</span>
        </div>

        <div class="batch-chapter-list arc-scrollbar">
          <section v-for="group in appStore.chapterVolumeGroups" :key="group.volume.id" class="batch-volume-group">
            <div class="batch-volume-head">
              <NCheckbox
                :checked="isBatchVolumeChecked(group.volume.id)"
                :indeterminate="isBatchVolumeIndeterminate(group.volume.id)"
                @update:checked="(checked) => toggleBatchVolume(group.volume.id, checked)"
              >
                {{ formatVolumeLabel(group.volume, group.index, 'formal') }}
              </NCheckbox>
              <span>{{ group.items.length }} 章</span>
            </div>
            <div v-for="chapter in group.items" :key="chapter.id" class="batch-chapter-row">
              <NCheckbox
                :checked="batchSelectedSet.has(chapter.id)"
                @update:checked="(checked) => toggleBatchChapter(chapter.id, checked)"
              />
              <span class="batch-chapter-title">{{ chapter.title }}</span>
              <NTag size="tiny" :type="statusType(chapter.status)" :bordered="false">
                {{ formatStatus(chapter.status) }}
              </NTag>
            </div>
          </section>
        </div>

        <NForm label-placement="left" label-width="90">
          <NFormItem label="目标状态">
            <NSelect v-model:value="batchStatus" :options="chapterStatusOptions" />
          </NFormItem>
          <NFormItem v-if="batchStatus === 'final'" label="后台同步">
            <div class="batch-sync-setting">
              <NSwitch v-model:value="batchSyncStoryState" />
              <div>
                <strong>同步故事状态</strong>
                <span>
                  将在右下角后台处理 {{ batchSyncEligibleIds.length }} 章
                  <template v-if="batchSelectedIds.length > batchSyncEligibleIds.length">
                    ，跳过 {{ batchSelectedIds.length - batchSyncEligibleIds.length }} 章正文过短的章节
                  </template>
                </span>
              </div>
            </div>
          </NFormItem>
        </NForm>
      </div>

      <template #footer>
        <div class="create-actions">
          <NButton round strong :disabled="batchSubmitting" @click="batchDialogVisible = false">取消</NButton>
          <NButton type="primary" round strong :loading="batchSubmitting" :disabled="batchSelectedIds.length === 0" @click="submitBatchStatus">
            {{ batchStatus === 'final' && batchSyncStoryState ? '保存并后台同步' : '保存章节状态' }}
          </NButton>
        </div>
      </template>
    </NModal>

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
.batch-status-layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.batch-quick-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.batch-quick-actions > span {
  margin-left: auto;
  color: var(--arc-text-hint);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.batch-chapter-list {
  max-height: min(420px, 48vh);
  overflow-y: auto;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
}

.batch-volume-group + .batch-volume-group {
  border-top: 1px solid var(--arc-border);
}

.batch-volume-head,
.batch-chapter-row {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
}

.batch-volume-head {
  justify-content: space-between;
  background: var(--arc-bg-mix);
  color: var(--arc-text-primary);
  font-size: 13px;
  font-weight: 650;
}

.batch-volume-head > span {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 400;
}

.batch-chapter-row {
  margin: 0;
  border-top: 1px solid color-mix(in srgb, var(--arc-border) 72%, transparent);
  cursor: pointer;
}

.batch-chapter-row:hover {
  background: var(--arc-bg-surface-hover);
}

.batch-chapter-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-sync-setting {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.batch-sync-setting > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.batch-sync-setting strong {
  color: var(--arc-text-primary);
  font-size: 13px;
}

.batch-sync-setting span {
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.5;
}

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
  padding: 4px 0;
  contain: strict;
}

.virtual-tree-row {
  height: 40px;
  min-height: 40px;
  box-sizing: border-box;
}

.volume {
  position: relative;
  margin-bottom: 0;
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
  height: 40px;
}

.volume-head:hover {
  background: var(--arc-bg-surface-hover);
}

.volume.drop-target .volume-head {
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
  color: var(--arc-text-primary);
  box-shadow: inset 2px 0 0 var(--arc-primary);
}

.volume.volume-dragging {
  opacity: 0.48;
}

.volume.volume-drop-before .volume-head,
.volume.volume-drop-after .volume-head {
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  color: var(--arc-text-primary);
}

.volume.volume-drop-before::before,
.volume.volume-drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  z-index: 4;
  height: 2px;
  border-radius: 999px;
  background: var(--arc-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent);
  pointer-events: none;
}

.volume.volume-drop-before::before {
  top: 0;
}

.volume.volume-drop-after::after {
  bottom: 0;
}

.volume-grip {
  display: inline-flex;
  width: 16px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--arc-text-hint);
  cursor: grab;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.volume-grip:hover {
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
}

.volume-grip:active {
  cursor: grabbing;
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

.volume-drop-label {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--arc-primary);
  color: white;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0;
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px 7px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--arc-text-primary);
  border-left: 2px solid transparent;
  text-align: left;
  transition: background 0.15s ease;
  width: 100%;
  height: 40px;
}

.chapter-row:hover {
  background: var(--arc-bg-surface-hover);
}

.chapter-row.dragging {
  opacity: 0.45;
  background: var(--arc-bg-surface-hover);
}

.chapter-row.drop-before,
.chapter-row.drop-after {
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
}

.chapter-row.drop-before::before,
.chapter-row.drop-after::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  height: 2px;
  border-radius: 999px;
  background: var(--arc-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent);
  pointer-events: none;
}

.chapter-row.drop-before::before {
  top: -1px;
}

.chapter-row.drop-after::after {
  bottom: -1px;
}

.chapter-row.active {
  background: var(--arc-primary-soft);
  border-left-color: var(--arc-primary);
  font-weight: 500;
}

.chap-grip {
  display: inline-flex;
  width: 16px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--arc-text-hint);
  cursor: grab;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.chap-grip:hover {
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
}

.chap-grip:active {
  cursor: grabbing;
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
  width: 100%;
  height: 40px;
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
