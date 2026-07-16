<script setup lang="ts">
import { computed, h, nextTick, reactive, ref, watch } from 'vue'
import { CheckSquare, ChevronDown, Download, FileDown, FileSpreadsheet, FilePlus2, Files, FolderTree, GripVertical, ListChecks, MoreVertical, Plus, Rows3, Sparkles, Trash2, Upload } from 'lucide-vue-next'
import { NButton, NCheckbox, NDropdown, NForm, NFormItem, NInput, NModal, NSelect, useDialog, useMessage } from 'naive-ui'
import { useEventListener } from '@vueuse/core'
import { getChapterCharacterCount } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { formatVolumeLabel, normalizeVolumeWordTarget } from '@/features/workspace/outlineVolumes'
import type { OutlineDropPosition } from '@/features/workspace/outlineReorder'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { DropdownOption, SelectOption } from 'naive-ui'
import type { OutlineImportNewVolume, OutlineImportPlanEntry, OutlineImportVolumeUpdate, OutlineItem, OutlineItemStatus, OutlineVolume } from '@/types/app'
import AiEnhancePreview from './AiEnhancePreview.vue'
import type { EnhanceFieldDiff } from './AiEnhancePreview.vue'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))
const AI_TASK_EXPAND_VOLUME = 'outline-volume'
const AI_TASK_EXPAND_VOLUME_PREFIX = 'outline-volume:'
// 通过响应式注册表读取 loading 态，切换面板不会丢
const isExpanding = computed(() => appStore.isAiTaskRunning(AI_TASK_EXPAND_VOLUME))
function expandVolumeTaskKey(volumeId: string): string {
  return `${AI_TASK_EXPAND_VOLUME_PREFIX}${volumeId}`
}
function isExpandingVolume(volumeId: string): boolean {
  return appStore.isAiTaskRunning(expandVolumeTaskKey(volumeId))
}
// 是否有任一分卷正在补全（用于禁用其他分卷的补全按钮，避免并发冲突）
const isAnyVolumeExpanding = computed(() =>
  appStore.outlineVolumes.some((volume) => isExpandingVolume(volume.id))
)
const editorVisible = ref(false) // 控制大纲节点编辑弹窗
const volumeEditorVisible = ref(false) // 控制分卷编辑弹窗
const editingOutlineId = ref<string | null>(null) // 当前编辑的大纲节点 ID
const editingVolumeId = ref<string | null>(null) // 当前编辑的分卷 ID
const draggingOutlineId = ref<string | null>(null) // 正在拖拽的大纲节点 ID
const dragTargetOutlineId = ref<string | null>(null) // 拖拽目标位置的大纲节点 ID
const dragTargetPosition = ref<OutlineDropPosition | null>(null)
const dragTargetVolumeId = ref<string | null>(null)
const focusedOutlineId = ref<string>('')
// 多选状态
const selectedOutlineIds = ref<Set<string>>(new Set())
const isMultiSelectMode = computed(() => selectedOutlineIds.value.size > 1)
const isSelectionModeActive = ref(false) // 选择模式开关
// 大纲节点编辑表单
const form = reactive({
  volumeId: '',
  title: '',
  wordTarget: '',
  conflict: '',
  summary: '',
  status: 'planned' as OutlineItemStatus
})
// 分卷编辑表单
const volumeForm = reactive({
  title: '',
  wordTarget: '',
  summary: ''
})
const menuOptions: DropdownOption[] = [ // 大纲节点的右键菜单选项
  { key: 'edit', label: '编辑节点' },
  { key: 'delete', label: '删除节点' }
]
const volumeCollapsed = reactive<Record<string, boolean>>({})
type ImportStrategy = 'skip' | 'overwrite' | 'add'
interface ImportPlanRow {
  key: string
  sourceRow: number
  enabled: boolean
  title: string
  wordTarget: string
  conflict: string
  summary: string
  status: OutlineItemStatus
  statusProvided: boolean
  sourceVolumeTitle: string
  sourceVolumeKey: string
  targetVolumeKey: string
  matchOutlineId: string
  targetDuplicateId: string
  strategy: ImportStrategy
  location: string
  order: number
  error: string
}

const importVisible = ref(false)
const importFileName = ref('')
const importRows = ref<string[][]>([])
const importPreviewReady = ref(false)
const importStep = ref<1 | 2 | 3>(1) // 1: 字段映射, 2: 确认分卷, 3: 确认章节
const importPlan = ref<ImportPlanRow[]>([])
const importNewVolumes = ref<OutlineImportNewVolume[]>([])
const importVolumeUpdates = ref<OutlineImportVolumeUpdate[]>([])
const importVolumesConfirmed = ref<Array<{ key: string; title: string; enabled: boolean; isNew: boolean; existingId?: string; wordTarget?: string; summary?: string }>>([])
const importBatchTarget = ref<string | null>(null)
const importBatchStrategy = ref<ImportStrategy | null>(null)
const importBatchStrategyOptions = [
  { label: '全部跳过', value: 'skip' },
  { label: '重复项覆盖', value: 'overwrite' },
  { label: '全部作为新增', value: 'add' }
]
const showBatchVolumeModal = ref(false)
const showBatchStrategyModal = ref(false)
const exportPreviewVisible = ref(false)
const exportPreviewData = ref<{
  projectTitle: string
  volumeCount: number
  itemCount: number
  rows: Array<{ volume: string; title: string; wordTarget: string; conflict: string; summary: string }>
}>({
  projectTitle: '',
  volumeCount: 0,
  itemCount: 0,
  rows: []
})
const importMapping = reactive({
  volume: null as number | null,
  volumeWordTarget: null as number | null,
  volumeSummary: null as number | null,
  sequence: null as number | null,
  title: null as number | null,
  wordTarget: null as number | null,
  conflict: null as number | null,
  summary: null as number | null,
  status: null as number | null
})
const importHeaders = computed(() => importRows.value[0] ?? [])
const importColumnOptions = computed(() => importHeaders.value.map((header, index) => ({
  label: header || `第 ${index + 1} 列`,
  value: index
})))
const importDataRows = computed(() => importRows.value.slice(1).filter((row) => row.some((cell) => cell.trim())))
const importVolumeOptions = computed(() => {
  if (importStep.value === 3) {
    const confirmed = importVolumesConfirmed.value.filter(v => v.enabled)
    return [
      ...appStore.outlineVolumes.map((volume) => ({ label: volume.title, value: volume.id })),
      ...confirmed.filter((volume) => volume.isNew).map((volume) => ({ label: `新建：${volume.title}`, value: volume.key }))
    ]
  }
  return [
    ...appStore.outlineVolumes.map((volume) => ({ label: volume.title, value: volume.id })),
    ...importNewVolumes.value.map((volume) => ({ label: `新建：${volume.title}`, value: volume.key }))
  ]
})

const filteredImportVolumeOptions = computed(() => {
  return importVolumeOptions.value
})

const filteredImportPlan = computed(() => {
  if (importStep.value !== 3) return importPlan.value
  const enabledVolumeKeys = new Set(importVolumesConfirmed.value.filter(v => v.enabled).map(v => v.key))
  if (enabledVolumeKeys.size === 0) return importPlan.value
  return importPlan.value.filter(item => !item.sourceVolumeKey || enabledVolumeKeys.has(item.sourceVolumeKey))
})

const importSelectedCount = computed(() => filteredImportPlan.value.filter((item) => item.enabled && !item.error).length)
const importEnabledCount = computed(() => filteredImportPlan.value.filter((item) => item.enabled && !item.error && item.strategy !== 'skip').length)
const importStats = computed(() => ({
  add: filteredImportPlan.value.filter((item) => item.enabled && !item.error && item.strategy === 'add').length,
  overwrite: filteredImportPlan.value.filter((item) => item.enabled && !item.error && item.strategy === 'overwrite').length,
  skip: filteredImportPlan.value.filter((item) => !item.enabled || item.strategy === 'skip').length,
  error: filteredImportPlan.value.filter((item) => Boolean(item.error)).length
}))
const unboundOutlineItems = computed(() => {
  const boundIds = new Set(appStore.chapters.map((chapter) => chapter.outlineItemId).filter(Boolean))
  return appStore.outlineItems.filter((item) => !boundIds.has(item.id))
})

const importExportOptions: DropdownOption[] = [
  { key: 'import', label: '导入 Excel', icon: () => h(Upload, { size: 16 }) },
  { key: 'export', label: '导出 Excel', icon: () => h(FileDown, { size: 16 }) },
  { key: 'template', label: '下载模板', icon: () => h(Download, { size: 16 }) }
]

function handleImportExportAction(key: string | number): void {
  if (key === 'import') {
    openOutlineImport()
  } else if (key === 'export') {
    exportOutlineExcel()
  } else if (key === 'template') {
    downloadOutlineTemplate()
  }
}

// 清空选中（ESC 键）
useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && selectedOutlineIds.value.size > 0) {
    selectedOutlineIds.value.clear()
    isSelectionModeActive.value = false
  }
})

// 切换选择模式
function toggleSelectionMode(): void {
  isSelectionModeActive.value = !isSelectionModeActive.value
  if (!isSelectionModeActive.value) {
    selectedOutlineIds.value.clear()
  }
}

// 全选当前可见节点
function selectAllVisible(): void {
  filteredOutlineGroups.value.forEach((group) => {
    group.items.forEach((item) => {
      selectedOutlineIds.value.add(item.id)
    })
  })
}

// 批量删除选中节点
function batchDeleteSelected(): void {
  const count = selectedOutlineIds.value.size
  dialog.warning({
    title: '批量删除',
    content: `确定要删除选中的 ${count} 个大纲节点吗？此操作不可撤销。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      selectedOutlineIds.value.forEach((id) => {
        appStore.deleteOutlineItem(id)
      })
      selectedOutlineIds.value.clear()
      isSelectionModeActive.value = false
      message.success(`已删除 ${count} 个节点`)
    }
  })
}

// 批量更新状态
function batchUpdateStatus(status: string | OutlineItemStatus): void {
  selectedOutlineIds.value.forEach((id) => {
    appStore.updateOutlineItem(id, { status: status as OutlineItemStatus })
  })
  const count = selectedOutlineIds.value.size
  message.success(`已更新 ${count} 个节点的状态`)
  selectedOutlineIds.value.clear()
  isSelectionModeActive.value = false
}

// 批量迁移相关
const migrateModalVisible = ref(false)
const migrateTargetVolumeId = ref<string>('')

function openMigrateModal(): void {
  if (selectedOutlineIds.value.size === 0) {
    return
  }
  migrateTargetVolumeId.value = appStore.outlineVolumes[0]?.id || ''
  migrateModalVisible.value = true
}

function submitMigrate(): void {
  if (!migrateTargetVolumeId.value) {
    message.warning('请选择目标分卷')
    return
  }

  const count = selectedOutlineIds.value.size
  selectedOutlineIds.value.forEach((id) => {
    appStore.updateOutlineItem(id, { volumeId: migrateTargetVolumeId.value })
  })

  message.success(`已迁移 ${count} 个节点`)
  selectedOutlineIds.value.clear()
  isSelectionModeActive.value = false
  migrateModalVisible.value = false
}

const progressStats = computed(() => {
  const items = appStore.outlineItems
  const total = items.length
  const done = items.filter((i) => i.status === 'done').length
  const drafting = items.filter((i) => i.status === 'drafting').length
  const planned = items.filter((i) => i.status === 'planned').length
  const idea = items.filter((i) => i.status === 'idea').length
  return { total, done, drafting, planned, idea }
})
// 分卷选项列表，用于大纲节点编辑弹窗中的分卷下拉选择器
const volumeOptions = computed<SelectOption[]>(() =>
  appStore.outlineVolumes.map((volume, index) => ({
    label: formatVolumeLabel(volume, index, 'formal'),
    value: volume.id
  }))
)
const outlineStatusOptions: SelectOption[] = [
  { label: '点子', value: 'idea' },
  { label: '已规划', value: 'planned' },
  { label: '写作中', value: 'drafting' },
  { label: '已完成', value: 'done' }
]
const statusDropdownOptions: DropdownOption[] = [
  { label: '标记为点子', key: 'idea' },
  { label: '标记为已规划', key: 'planned' },
  { label: '标记为写作中', key: 'drafting' },
  { label: '标记为已完成', key: 'done' }
]
// 按分卷分组过滤大纲节点，搜索时在标题、冲突和剧情描述中匹配
const filteredOutlineGroups = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() ?? ''
  if (!query) {
    return appStore.outlineVolumeGroups
  }

  return appStore.outlineVolumeGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.title} ${item.conflict} ${item.summary}`.toLowerCase().includes(query)
      )
    }))
    .filter((group) => group.items.length > 0)
})
// 可见大纲节点的总数（用于顶部摘要显示）
const totalVisibleItems = computed(() => filteredOutlineGroups.value.reduce((count, group) => count + group.items.length, 0))

function allowDigitsOnly(value: string): boolean {
  return /^\d*$/.test(value)
}

function normalizeOutlineItemWordTarget(value: unknown): string {
  const raw = String(value ?? '').trim()
  const wanMatch = raw.match(/(\d+(?:\.\d+)?)\s*万/)
  const thousandMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:千|[kK])/)
  const numericMatch = raw.match(/\d+(?:\.\d+)?/)
  const numeric = wanMatch
    ? Number(wanMatch[1]) * 10000
    : thousandMatch
      ? Number(thousandMatch[1]) * 1000
      : numericMatch
        ? Number(numericMatch[0])
        : 3000
  return String(Math.min(4000, Math.max(3000, Math.round(numeric))))
}

function compactForAi(value: unknown, maxLength = 260): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function buildAiVolumesContext() {
  return appStore.outlineVolumes.map((volume, index) => ({
    title: volume.title,
    wordTarget: volume.wordTarget,
    summary: compactForAi(volume.summary, 320),
    order: index + 1
  }))
}

function buildAiOutlineContext(volumeId?: string) {
  const items = volumeId
    ? appStore.outlineItems.filter((item) => item.volumeId === volumeId)
    : appStore.outlineItems

  return items.slice(-24).map((item) => ({
    title: item.title,
    volumeTitle: appStore.outlineVolumes.find((volume) => volume.id === item.volumeId)?.title ?? '',
    conflict: compactForAi(item.conflict, 180),
    summary: compactForAi(item.summary, 320),
    status: item.status
  }))
}

function buildAiWorldviewContext() {
  return appStore.worldviewEntries.slice(0, 16).map((entry) => ({
    type: entry.type,
    title: entry.title,
    content: compactForAi(entry.content, 320)
  }))
}

function buildAiCharactersContext() {
  return appStore.characters.slice(0, 16).map((character) => ({
    name: character.name,
    role: character.role,
    description: compactForAi(character.description, 260),
    tags: character.tags.map((tag) => tag.label)
  }))
}

// 打开新建大纲节点弹窗，默认归属到指定分卷
function handleCreateOutline(volumeId = appStore.outlineVolumes[0]?.id): void {
  editingOutlineId.value = null
  form.volumeId = volumeId || appStore.outlineVolumes[0]?.id || ''
  form.title = ''
  form.wordTarget = '3000'
  form.conflict = ''
  form.summary = ''
  form.status = 'planned'
  editorVisible.value = true
}

// 调用 AI 接口自动扩展一个新的分卷，作为大纲的上层结构
async function handleExpandOutline(): Promise<void> {
  if (isExpanding.value) {
    return
  }

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: AI_TASK_EXPAND_VOLUME,
        kind: 'outline',
        label: 'AI 扩写分卷',
        description: '正在规划新的大纲分卷',
        panel: 'outline',
        timeoutMs: 300_000
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'outline-enhance',
          settings: appStore.appSettings,
          context: {
            mode: 'volume',
            currentForm: { title: '', wordTarget: '50000', summary: '' },
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            volumeTitles: appStore.outlineVolumes.map((volume) => volume.title),
            outlineTitles: appStore.outlineItems.map((item) => item.title),
            volumes: buildAiVolumesContext(),
            outlineItems: buildAiOutlineContext(),
            worldviewEntries: buildAiWorldviewContext(),
            characters: buildAiCharactersContext(),
            worldviewTitles: appStore.worldviewEntries.map((entry) => entry.title),
            characterNames: appStore.characters.map((character) => character.name)
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 扩写分卷失败，请检查模型配置')
    }

    const volume = result.result as {
      title?: string
      wordTarget?: string
      summary?: string
    }

    const nextVolumeId = appStore.createOutlineVolume({
      title: volume.title ?? `分卷 ${appStore.outlineVolumes.length + 1}`,
      wordTarget: normalizeVolumeWordTarget(volume.wordTarget) || '50000',
      summary: volume.summary ?? 'AI 未返回有效分卷摘要'
    })
    volumeCollapsed[nextVolumeId] = false
    message.success('AI 已扩展新的分卷')
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 扩写分卷失败，请检查模型配置')
  }
}

async function handleExpandVolumeOutline(volume: OutlineVolume): Promise<void> {
  const taskKey = expandVolumeTaskKey(volume.id)
  if (isAnyVolumeExpanding.value) {
    return
  }

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: taskKey,
        kind: 'outline',
        label: `AI 扩写节点·${volume.title}`,
        description: `正在为《${volume.title}》扩写 3-5 个子节点`,
        panel: 'outline',
        timeoutMs: 300_000
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
            task: 'outline-batch',
            settings: appStore.appSettings,
            context: {
              projectTitle: appStore.currentProject?.title,
              projectGenre: appStore.currentProject?.genre,
              writingStyleLabel: writingStyle.value.label,
              writingStylePrompt: writingStyle.value.prompt,
              chapterVolumeTitle: volume.title,
              chapterVolumeSummary: volume.summary,
              chapterVolumeWordTarget: volume.wordTarget,
              outlineTitles: appStore.outlineItems.map((item) => item.title),
              worldviewTitles: appStore.worldviewEntries.map((entry) => entry.title),
              volumes: buildAiVolumesContext(),
              outlineItems: buildAiOutlineContext(),
              worldviewEntries: buildAiWorldviewContext(),
              characters: appStore.characters.map((character) => ({
                name: character.name,
                role: character.role,
                description: compactForAi(character.description, 260),
                tags: character.tags.map((tag) => tag.label)
              })),
              currentVolumeOutlineItems: appStore.outlineItems
                .filter((item) => item.volumeId === volume.id)
                .map((item) => ({
                  title: item.title,
                  conflict: item.conflict,
                  summary: item.summary,
                  status: item.status
                })),
              userPrompt: '请优先扩写当前分卷从现有节点往后最需要的 3 到 5 个剧情子节点。'
            }
          }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '分卷子节点扩写失败，请检查模型配置')
    }

    const payload = result.result as {
      entries?: Array<{
        title?: string
        wordTarget?: string
        conflict?: string
        summary?: string
      }>
    }
    const entries = Array.isArray(payload.entries) ? payload.entries : []
    if (!entries.length) {
      throw new Error('AI 没有返回有效的大纲节点')
    }

    entries.forEach((entry) => {
      appStore.createOutlineItem({
        volumeId: volume.id,
        title: entry.title,
        wordTarget: normalizeOutlineItemWordTarget(entry.wordTarget),
        conflict: entry.conflict,
        summary: entry.summary,
        status: 'planned'
      })
    })

    appStore.appendWorkflowDocumentEntry(
      volume.id,
      'task_plan',
      `节点扩写：${volume.title}`,
      [
        `- 已为当前分卷扩写 ${entries.length} 个大纲子节点。`,
        ...entries.map((entry, index) => `- 节点${index + 1}：${entry.title ?? `新节点 ${index + 1}`}`)
      ].join('\n')
    )
    appStore.appendWorkflowDocumentEntry(
      volume.id,
      'pending_hooks',
      `节点扩写后待观察钩子：${volume.title}`,
      entries.map((entry) => `- ${entry.title ?? '新节点'}：${entry.conflict ?? '待补充核心冲突'}`).join('\n')
    )

    message.success(`已为 ${volume.title} 扩写 ${entries.length} 个大纲子节点`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '分卷子节点扩写失败，请稍后重试')
  }
}

// 打开大纲节点编辑弹窗
function openEditor(item?: OutlineItem): void {
  editingOutlineId.value = item?.id ?? null
  form.volumeId = item?.volumeId ?? appStore.outlineVolumes[0]?.id ?? ''
  form.title = item?.title ?? ''
  form.wordTarget = item?.wordTarget ?? '3000'
  form.conflict = item?.conflict ?? ''
  form.summary = item?.summary ?? ''
  form.status = item?.status ?? 'planned'
  editorVisible.value = true
}

// 打开分卷编辑弹窗
function openVolumeEditor(volume?: OutlineVolume): void {
  editingVolumeId.value = volume?.id ?? null
  volumeForm.title = volume?.title ?? ''
  volumeForm.wordTarget = normalizeVolumeWordTarget(volume?.wordTarget) || '50000'
  volumeForm.summary = volume?.summary ?? ''
  volumeEditorVisible.value = true
}

// 提交大纲节点表单
function submitOutline(): void {
  if (!form.volumeId) {
    message.warning('请先选择所属分卷')
    return
  }

  if (!form.title.trim() || !form.summary.trim()) {
    message.warning('请完整填写节点标题和剧情描述')
    return
  }

  const payload = { ...form, wordTarget: form.wordTarget.replace(/\D/g, '') }

  if (editingOutlineId.value) {
    appStore.updateOutlineItem(editingOutlineId.value, payload)
    message.success('大纲节点已更新')
  } else {
    appStore.createOutlineItem(payload)
    message.success('已新增大纲节点')
  }

  editorVisible.value = false
}

// 提交分卷表单
function submitVolume(): void {
  if (!volumeForm.title.trim()) {
    message.warning('请填写分卷标题')
    return
  }

  if (editingVolumeId.value) {
    appStore.updateOutlineVolume(editingVolumeId.value, {
      ...volumeForm,
      wordTarget: normalizeVolumeWordTarget(volumeForm.wordTarget)
    })
    message.success('分卷信息已更新')
  } else {
    appStore.createOutlineVolume({
      ...volumeForm,
      wordTarget: normalizeVolumeWordTarget(volumeForm.wordTarget)
    })
    message.success('已新增分卷')
  }

  volumeEditorVisible.value = false
}

function handleDeleteVolume(volume: OutlineVolume): void {
  if (appStore.outlineVolumes.length <= 1) {
    message.warning('至少需要保留一个分卷')
    return
  }

  const volumeIndex = appStore.outlineVolumes.findIndex((item) => item.id === volume.id)
  const remainingVolumes = appStore.outlineVolumes.filter((item) => item.id !== volume.id)
  const fallbackVolume = remainingVolumes[Math.max(0, volumeIndex - 1)] ?? remainingVolumes[0]
  const outlineCount = appStore.outlineItems.filter((item) => item.volumeId === volume.id).length
  const chapterCount = appStore.chapters.filter((chapter) => chapter.volumeId === volume.id).length
  const fallbackTitle = fallbackVolume?.title ? `「${fallbackVolume.title}」` : '相邻分卷'

  dialog.warning({
    title: '确认删除分卷',
    content: `确定要删除"${volume.title}"吗？该分卷下的 ${outlineCount} 个大纲节点和 ${chapterCount} 个章节会移至${fallbackTitle}，分卷级创作记忆将一并删除。`,
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

// 根据大纲节点创建章节草稿，将核心规划字段直接带入新章节
function handleCreateChapterFromOutline(item: OutlineItem): void {
  // Carry the outline node's core planning fields straight into a fresh chapter
  // draft so the writer can continue from structure into prose immediately.
  appStore.createChapterFromOutlineItem(item)
  appStore.updateOutlineItem(item.id, {
    status: item.status === 'done' ? 'done' : 'drafting'
  })
  message.success('已根据大纲节点创建章节草稿')
}

function openLinkedChapter(item: OutlineItem): void {
  const chapter = resolveLinkedChapter(item)
  if (!chapter) {
    handleCreateChapterFromOutline(item)
    return
  }

  appStore.openChapterStudio(chapter.id)
}

function resolveOutlineStatusMeta(status: OutlineItemStatus): { label: string; tone: string } {
  switch (status) {
    case 'idea':
      return { label: '点子', tone: 'ghost' }
    case 'drafting':
      return { label: '写作中', tone: 'primary' }
    case 'done':
      return { label: '已完成', tone: 'success' }
    case 'planned':
    default:
      return { label: '已规划', tone: 'neutral' }
  }
}

function resolveLinkedChapter(item: OutlineItem) {
  return (
    appStore.chapters.find((chapter) => chapter.outlineItemId === item.id) ??
    appStore.chapters.find((chapter) => chapter.title.trim() === item.title.trim()) ??
    null
  )
}

function detectImportColumn(pattern: RegExp): number | null {
  const index = importHeaders.value.findIndex((header) => pattern.test(header.replace(/\s+/g, '')))
  return index >= 0 ? index : null
}

function normalizeImportStatus(value: string): OutlineItemStatus {
  const normalized = value.replace(/\s+/g, '').toLowerCase()
  if (['idea', '点子', '灵感', '构思'].includes(normalized)) return 'idea'
  if (['drafting', '写作中', '草稿', '起草中'].includes(normalized)) return 'drafting'
  if (['done', '已完成', '完成', '完稿'].includes(normalized)) return 'done'
  return 'planned'
}

function getOrderedOutlineItemsForExport(): OutlineItem[] {
  const volumeOrder = new Map(appStore.outlineVolumes.map((volume, index) => [volume.id, index]))
  return [...appStore.outlineItems].sort((left, right) => {
    const leftVolumeOrder = volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER
    const rightVolumeOrder = volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER
    return leftVolumeOrder - rightVolumeOrder || left.sortOrder - right.sortOrder
  })
}

async function openOutlineImport(): Promise<void> {
  const result = await window.characterArc.importOutlineSpreadsheet()
  if (result.canceled) return
  if (!result.success || !result.rows) {
    message.error(result.error ?? '无法读取大纲文件')
    return
  }
  importFileName.value = result.sheetName ? `${result.fileName ?? '大纲文件'} · ${result.sheetName}` : result.fileName ?? '大纲文件'
  importRows.value = result.rows
  importPreviewReady.value = false
  importStep.value = 1
  importPlan.value = []
  importNewVolumes.value = []
  importVolumeUpdates.value = []
  importVolumesConfirmed.value = []
  importMapping.volume = detectImportColumn(/^(分卷|分卷名称|卷名|卷)$/i)
  importMapping.volumeWordTarget = detectImportColumn(/^(分卷目标字数|卷目标字数)$/i)
  importMapping.volumeSummary = detectImportColumn(/^(分卷摘要|卷摘要)$/i)
  importMapping.sequence = detectImportColumn(/^(章节序号|序号|顺序)$/i)
  importMapping.title = detectImportColumn(/^(标题|章节标题|节点标题|章名)$/i)
  importMapping.wordTarget = detectImportColumn(/^(字数|目标字数|预估字数)$/i)
  importMapping.conflict = detectImportColumn(/^(冲突|核心冲突|矛盾)$/i)
  importMapping.summary = detectImportColumn(/^(摘要|剧情摘要|剧情描述|大纲|内容|章节大纲)$/i)
  importMapping.status = detectImportColumn(/^(状态|推进状态|节点状态|章节状态)$/i)
  importVisible.value = true
}

function importCell(row: string[], column: number | null): string {
  return column == null ? '' : String(row[column] ?? '').trim()
}

const IMPORT_PREVIEW_LIMIT = 8
const importPreviewRows = computed(() => {
  let inheritedVolumeTitle = ''
  return importDataRows.value.slice(0, IMPORT_PREVIEW_LIMIT).map((row, index) => {
    const explicitVolumeTitle = importCell(row, importMapping.volume)
    if (explicitVolumeTitle) inheritedVolumeTitle = explicitVolumeTitle
    const titleRaw = importCell(row, importMapping.title)
    const wordTargetRaw = importCell(row, importMapping.wordTarget)
    const conflictRaw = importCell(row, importMapping.conflict)
    const status = normalizeImportStatus(importCell(row, importMapping.status))

    return {
      sequence: importCell(row, importMapping.sequence) || String(index + 1),
      volume: inheritedVolumeTitle || '未指定',
      title: titleRaw || '（未识别标题）',
      wordTarget: wordTargetRaw || '—',
      conflict: conflictRaw || '—',
      status,
      statusLabel: resolveOutlineStatusMeta(status).label
    }
  })
})
const importPreviewCountLabel = computed(() => importDataRows.value.length > IMPORT_PREVIEW_LIMIT
  ? `显示前 ${IMPORT_PREVIEW_LIMIT} 行 · 共 ${importDataRows.value.length} 行`
  : `共 ${importDataRows.value.length} 行`)

function normalizeImportKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function resolveImportDuplicate(item: Pick<ImportPlanRow, 'title' | 'targetVolumeKey'>): OutlineItem | null {
  if (!item.targetVolumeKey || item.targetVolumeKey.startsWith('new-volume:')) return null
  const titleKey = normalizeImportKey(item.title)
  return appStore.outlineItems.find((outline) =>
    outline.volumeId === item.targetVolumeKey && normalizeImportKey(outline.title) === titleKey
  ) ?? null
}

function resolveImportOverwriteId(item: ImportPlanRow): string {
  return item.matchOutlineId || item.targetDuplicateId
}

function hasImportDuplicate(item: ImportPlanRow): boolean {
  return Boolean(resolveImportOverwriteId(item))
}

function hasBatchDuplicate(item: ImportPlanRow): boolean {
  const titleKey = normalizeImportKey(item.title)
  if (!titleKey || !item.targetVolumeKey) return false
  return importPlan.value.some((candidate) =>
    candidate.key !== item.key &&
    candidate.targetVolumeKey === item.targetVolumeKey &&
    normalizeImportKey(candidate.title) === titleKey
  )
}

function refreshImportPlanDuplicateState(): void {
  importPlan.value.forEach((item) => {
    item.targetDuplicateId = resolveImportDuplicate(item)?.id ?? ''
    const overwriteId = resolveImportOverwriteId(item)
    const targetConflict = item.strategy === 'overwrite'
      && Boolean(item.matchOutlineId)
      && Boolean(item.targetDuplicateId)
      && item.matchOutlineId !== item.targetDuplicateId
    item.error = item.title
      ? !item.targetVolumeKey
        ? '请选择目标分卷'
        : targetConflict
          ? '目标分卷已存在同名节点'
          : hasBatchDuplicate(item)
            ? '同一批导入中重复'
            : ''
      : '缺少章节标题'
    if (item.error) {
      item.enabled = false
      if (!targetConflict) item.strategy = 'skip'
      return
    }
    if (item.strategy === 'overwrite' && !overwriteId) {
      item.strategy = 'add'
    }
    if (item.location === 'keep' && item.strategy !== 'overwrite') {
      item.location = 'end'
    }
  })
}

function buildImportPlan(): void {
  if (importMapping.title == null) {
    message.warning('请指定章节标题列')
    return
  }
  const volumeByTitle = new Map(appStore.outlineVolumes.map((volume) => [normalizeImportKey(volume.title), volume]))
  const newVolumeMap = new Map<string, OutlineImportNewVolume>()
  const volumesSet = new Map<string, { key: string; title: string; isNew: boolean; existingId?: string; wordTarget?: string; summary?: string }>()
  const plan: ImportPlanRow[] = []
  let inheritedVolumeTitle = ''
  let inheritedVolumeWordTarget = ''
  let inheritedVolumeSummary = ''

  importDataRows.value.forEach((row, index) => {
    const title = importCell(row, importMapping.title)
    const statusRaw = importCell(row, importMapping.status)
    const explicitVolumeTitle = importCell(row, importMapping.volume)
    const explicitVolumeWordTarget = importCell(row, importMapping.volumeWordTarget)
    const explicitVolumeSummary = importCell(row, importMapping.volumeSummary)
    if (explicitVolumeTitle) {
      inheritedVolumeTitle = explicitVolumeTitle
      inheritedVolumeWordTarget = explicitVolumeWordTarget
      inheritedVolumeSummary = explicitVolumeSummary
    }
    const sourceVolumeTitle = explicitVolumeTitle || inheritedVolumeTitle
    const matchedVolume = volumeByTitle.get(normalizeImportKey(sourceVolumeTitle))
    let sourceVolumeKey = matchedVolume?.id ?? ''
    let targetVolumeKey = sourceVolumeKey

    // 收集分卷信息
    if (sourceVolumeTitle) {
      const normalizedTitle = normalizeImportKey(sourceVolumeTitle)
      if (matchedVolume) {
        // 已存在的分卷
        if (!volumesSet.has(matchedVolume.id)) {
          volumesSet.set(matchedVolume.id, {
            key: matchedVolume.id,
            title: sourceVolumeTitle,
            isNew: false,
            existingId: matchedVolume.id,
            wordTarget: explicitVolumeWordTarget || inheritedVolumeWordTarget,
            summary: explicitVolumeSummary || inheritedVolumeSummary
          })
        }
      } else {
        // 新分卷
        const key = `new-volume:${normalizedTitle}`
        sourceVolumeKey = key
        targetVolumeKey = key
        if (!newVolumeMap.has(key)) {
          newVolumeMap.set(key, {
            key,
            title: sourceVolumeTitle,
            wordTarget: explicitVolumeWordTarget || inheritedVolumeWordTarget,
            summary: explicitVolumeSummary || inheritedVolumeSummary
          })
          volumesSet.set(key, {
            key,
            title: sourceVolumeTitle,
            isNew: true
          })
        }
      }
    }

    const draft: ImportPlanRow = {
      key: `import-row-${index + 2}`,
      sourceRow: index + 2,
      enabled: false,
      title,
      wordTarget: importCell(row, importMapping.wordTarget),
      conflict: importCell(row, importMapping.conflict),
      summary: importCell(row, importMapping.summary),
      status: normalizeImportStatus(statusRaw),
      statusProvided: Boolean(statusRaw),
      sourceVolumeTitle,
      sourceVolumeKey,
      targetVolumeKey,
      matchOutlineId: '',
      targetDuplicateId: '',
      strategy: 'add',
      location: 'end',
      order: Number(importCell(row, importMapping.sequence)) || index + 1,
      error: title ? '' : '缺少章节标题'
    }
    const duplicate = resolveImportDuplicate(draft)
    draft.matchOutlineId = duplicate?.id ?? ''
    draft.targetDuplicateId = duplicate?.id ?? ''
    draft.strategy = duplicate ? 'skip' : 'add'
    draft.location = duplicate ? 'keep' : 'end'
    draft.enabled = !draft.error && !duplicate
    plan.push(draft)
  })

  importNewVolumes.value = [...newVolumeMap.values()]
  importVolumeUpdates.value = Array.from(volumesSet.values())
    .filter((volume) => !volume.isNew && Boolean(volume.existingId))
    .map((volume) => ({
      volumeId: volume.existingId as string,
      title: volume.title,
      wordTarget: volume.wordTarget,
      summary: volume.summary
    }))
  importPlan.value = plan
  refreshImportPlanDuplicateState()

  // 初始化分卷确认列表（默认全部启用）
  importVolumesConfirmed.value = Array.from(volumesSet.values()).map(v => ({
    ...v,
    enabled: true
  }))

  // 进入步骤 2：确认分卷
  importStep.value = 2
  importPreviewReady.value = true
}

function importStrategyOptions(item: ImportPlanRow) {
  return hasImportDuplicate(item)
    ? [
        { label: '跳过', value: 'skip' },
        { label: '覆盖原节点', value: 'overwrite' },
        { label: '作为新节点', value: 'add' }
      ]
    : [
        { label: '不导入', value: 'skip' },
        { label: '新增节点', value: 'add' }
      ]
}

function confirmVolumesAndProceed(): void {
  const enabledVolumes = importVolumesConfirmed.value.filter(v => v.enabled)
  if (enabledVolumes.length === 0) {
    importPlan.value.forEach((item) => {
      item.targetVolumeKey = ''
      item.matchOutlineId = ''
      item.targetDuplicateId = ''
      item.strategy = 'add'
      item.location = 'end'
    })
  }
  refreshImportPlanDuplicateState()

  // 进入步骤 3：确认章节
  importStep.value = 3
}

function backToVolumeConfirm(): void {
  importStep.value = 2
}

function backToFieldMapping(): void {
  importStep.value = 1
  importPreviewReady.value = false
}

function importLocationOptions(item: ImportPlanRow) {
  const overwriteId = resolveImportOverwriteId(item)
  const options = [
    ...(overwriteId && item.strategy === 'overwrite' ? [{ label: '保留原位置', value: 'keep' }] : []),
    { label: '分卷开头', value: 'start' },
    { label: '分卷末尾', value: 'end' }
  ]
  if (item.targetVolumeKey.startsWith('new-volume:')) return options
  const anchors = appStore.outlineItems.filter((outline) =>
    outline.volumeId === item.targetVolumeKey && outline.id !== overwriteId
  )
  return [
    ...options,
    ...anchors.flatMap((outline) => [
      { label: `在「${outline.title}」之前`, value: `before:${outline.id}` },
      { label: `在「${outline.title}」之后`, value: `after:${outline.id}` }
    ])
  ]
}

function setImportEnabled(item: ImportPlanRow, enabled: boolean): void {
  item.enabled = enabled
}

function handleImportStrategyChange(item: ImportPlanRow, strategy?: string | number | null): void {
  if (strategy === 'skip' || strategy === 'overwrite' || strategy === 'add') {
    item.strategy = strategy
  }
  if (item.strategy === 'overwrite' && hasImportDuplicate(item)) item.location = 'keep'
  if (item.strategy === 'add' && item.location === 'keep') item.location = 'end'
  refreshImportPlanDuplicateState()
  if (!item.error && item.strategy !== 'skip') item.enabled = true
}

function handleImportTargetChange(item: ImportPlanRow): void {
  const duplicate = resolveImportDuplicate(item)
  item.targetDuplicateId = duplicate?.id ?? ''
  if (!(item.strategy === 'overwrite' && item.matchOutlineId)) {
    item.strategy = duplicate ? 'skip' : 'add'
    item.location = duplicate ? 'keep' : 'end'
  }
  refreshImportPlanDuplicateState()
  if (!item.error && item.strategy !== 'skip') item.enabled = true
}

function toggleAllImportRows(enabled: boolean): void {
  filteredImportPlan.value.forEach((item) => setImportEnabled(item, enabled && !item.error))
}

function applyImportBatchTarget(): void {
  if (!importBatchTarget.value) return
  filteredImportPlan.value.filter((item) => item.enabled && !item.error).forEach((item) => {
    item.targetVolumeKey = importBatchTarget.value as string
    handleImportTargetChange(item)
  })
  showBatchVolumeModal.value = false
  message.success('已应用批量分卷设置')
}

function applyImportBatchStrategy(): void {
  if (!importBatchStrategy.value) return
  filteredImportPlan.value.filter((item) => item.enabled && !item.error).forEach((item) => {
    if (importBatchStrategy.value === 'overwrite' && !hasImportDuplicate(item)) return
    item.strategy = importBatchStrategy.value as ImportStrategy
    handleImportStrategyChange(item)
  })
  showBatchStrategyModal.value = false
  message.success('已应用批量策略设置')
}

function parseImportLocation(location: string): Pick<OutlineImportPlanEntry, 'position' | 'anchorOutlineId'> {
  if (location.startsWith('before:')) return { position: 'before', anchorOutlineId: location.slice(7) }
  if (location.startsWith('after:')) return { position: 'after', anchorOutlineId: location.slice(6) }
  if (location === 'start' || location === 'keep') return { position: location }
  return { position: 'end' }
}

function commitOutlineImport(): void {
  const selected = filteredImportPlan.value.filter((item) => item.enabled && !item.error && item.strategy !== 'skip')
  if (!selected.length) {
    message.warning('请至少选择一条有效数据')
    return
  }
  const plan: OutlineImportPlanEntry[] = selected.map((item) => ({
    sourceRow: item.sourceRow,
    action: item.strategy === 'overwrite' ? 'overwrite' : 'add',
    matchOutlineId: item.strategy === 'overwrite' ? resolveImportOverwriteId(item) : undefined,
    targetVolumeKey: item.targetVolumeKey,
    ...parseImportLocation(item.location),
    order: item.order,
    item: {
      title: item.title,
      wordTarget: item.wordTarget || undefined,
      conflict: item.conflict || undefined,
      summary: item.summary || undefined,
      status: item.strategy === 'add' || item.statusProvided ? item.status : undefined
    }
  }))
  const usedVolumeKeys = new Set(plan.map((item) => item.targetVolumeKey))
  const result = appStore.applyOutlineImportPlan(
    plan,
    importNewVolumes.value.filter((volume) => usedVolumeKeys.has(volume.key)),
    importVolumeUpdates.value.filter((volume) =>
      importVolumesConfirmed.value.some((confirmed) => confirmed.enabled && confirmed.existingId === volume.volumeId)
    )
  )
  importVisible.value = false
  message.success(`导入完成：新增 ${result.added}，覆盖 ${result.overwritten}，新建分卷 ${result.createdVolumes}`)
}

async function downloadOutlineTemplate(): Promise<void> {
  const result = await window.characterArc.exportOutlineTemplate()
  if (result.canceled) return
  result.success ? message.success('大纲模板已保存') : message.error(result.error ?? '模板下载失败')
}

function previewOutlineExport(): void {
  const volumeMap = new Map(appStore.outlineVolumes.map((volume) => [volume.id, volume]))
  const orderedItems = getOrderedOutlineItemsForExport()

  // 按分卷分组并标记每个分卷的第一行（仅用于预览显示）
  const rowsWithVolumeInfo = orderedItems.slice(0, 10).map((item, index, array) => {
    const volume = volumeMap.get(item.volumeId)
    const volumeTitle = volume?.title ?? ''
    const prevItem = index > 0 ? array[index - 1] : null
    const showVolume = !prevItem || prevItem.volumeId !== item.volumeId

    return {
      volume: showVolume ? volumeTitle : '',
      title: item.title,
      wordTarget: item.wordTarget,
      conflict: item.conflict ?? '',
      summary: item.summary ?? ''
    }
  })

  exportPreviewData.value = {
    projectTitle: appStore.currentProject?.title ?? 'CharacterArc',
    volumeCount: appStore.outlineVolumes.length,
    itemCount: orderedItems.length,
    rows: rowsWithVolumeInfo
  }
  exportPreviewVisible.value = true
}

async function confirmExport(): Promise<void> {
  exportPreviewVisible.value = false
  try {
    const result = await window.characterArc.exportOutlineSpreadsheet(toIpcPayload({
      projectTitle: appStore.currentProject?.title,
      volumes: appStore.outlineVolumes,
      items: getOrderedOutlineItemsForExport()
    }))
    if (result.canceled) return
    result.success ? message.success('剧情大纲 Excel 已导出') : message.error(result.error ?? '大纲导出失败')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '大纲导出失败')
  }
}

async function exportOutlineExcel(): Promise<void> {
  if (appStore.outlineItems.length === 0) {
    message.warning('当前没有大纲节点可以导出')
    return
  }
  previewOutlineExport()
}

function createAllUnboundChapters(): void {
  const items = [...unboundOutlineItems.value]
  if (items.length === 0) {
    message.info('所有大纲节点都已经绑定章节')
    return
  }
  dialog.info({
    title: '一键生成章节',
    content: `将为 ${items.length} 个未绑定大纲创建章节草稿，已有章节不会修改。`,
    positiveText: '确认生成',
    negativeText: '取消',
    onPositiveClick: () => {
      items.forEach((item) => {
        appStore.createChapterFromOutlineItem(item)
        appStore.updateOutlineItem(item.id, { status: item.status === 'done' ? 'done' : 'drafting' })
      })
      message.success(`已创建并绑定 ${items.length} 个章节草稿`)
    }
  })
}

function resolveLinkedChapterMeta(item: OutlineItem): { label: string; tone: string } {
  const chapter = resolveLinkedChapter(item)
  if (!chapter) {
    return { label: '未生成章节', tone: 'ghost' }
  }

  switch (chapter.status) {
    case 'final':
      return { label: '章节已定稿', tone: 'success' }
    case 'polish':
      return { label: '章节待润色', tone: 'warning' }
    case 'review':
      return { label: '章节审阅中', tone: 'neutral' }
    case 'draft':
    default:
      return { label: '章节写作中', tone: 'primary' }
  }
}

function resolveLinkedChapterProgress(item: OutlineItem): { actual: number; target: number; percent: number } {
  const chapter = resolveLinkedChapter(item)
  if (!chapter) {
    return { actual: 0, target: 0, percent: 0 }
  }

  const actual = getChapterCharacterCount(chapter.content)
  const wanMatch = chapter.wordTarget.match(/(\d+(?:\.\d+)?)\s*万/)
  const target = wanMatch
    ? Math.round(Number(wanMatch[1]) * 10000)
    : Math.round(Number(chapter.wordTarget.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0))

  const percent = target ? Math.min(100, Math.max(0, Math.round((actual / target) * 100))) : 0
  return { actual, target, percent }
}

// 节点点击处理
function handleNodeClick(item: OutlineItem, event: MouseEvent): void {
  const id = item.id

  // 选择模式激活时，默认行为是多选
  if (isSelectionModeActive.value) {
    event.preventDefault()
    if (event.shiftKey && selectedOutlineIds.value.size > 0) {
      // Shift：范围选择
      const allIds = filteredOutlineGroups.value.flatMap(g => g.items.map(i => i.id))
      const lastSelected = Array.from(selectedOutlineIds.value).pop()
      if (!lastSelected) return

      const start = allIds.indexOf(lastSelected)
      const end = allIds.indexOf(id)
      const [min, max] = [Math.min(start, end), Math.max(start, end)]
      const range = allIds.slice(min, max + 1)
      range.forEach(id => selectedOutlineIds.value.add(id))
      selectedOutlineIds.value = new Set(selectedOutlineIds.value)
    } else {
      // 普通点击：切换选中
      if (selectedOutlineIds.value.has(id)) {
        selectedOutlineIds.value.delete(id)
      } else {
        selectedOutlineIds.value.add(id)
      }
      selectedOutlineIds.value = new Set(selectedOutlineIds.value)
    }
    return
  }

  // 非选择模式：Ctrl/Cmd 可以临时多选
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    if (selectedOutlineIds.value.has(id)) {
      selectedOutlineIds.value.delete(id)
    } else {
      selectedOutlineIds.value.add(id)
    }
    selectedOutlineIds.value = new Set(selectedOutlineIds.value)
  } else if (event.shiftKey && selectedOutlineIds.value.size > 0) {
    // Shift：范围选择
    event.preventDefault()
    const allIds = filteredOutlineGroups.value.flatMap(g => g.items.map(i => i.id))
    const lastSelected = Array.from(selectedOutlineIds.value).pop()
    if (!lastSelected) return

    const start = allIds.indexOf(lastSelected)
    const end = allIds.indexOf(id)
    const [min, max] = [Math.min(start, end), Math.max(start, end)]
    const range = allIds.slice(min, max + 1)
    range.forEach(id => selectedOutlineIds.value.add(id))
    selectedOutlineIds.value = new Set(selectedOutlineIds.value)
  } else {
    // 普通点击：清空选中并打开编辑
    selectedOutlineIds.value.clear()
    openEditor(item)
  }
}

// 判断节点是否选中
function isNodeSelected(id: string): boolean {
  return selectedOutlineIds.value.has(id)
}

// 批量删除
function handleBatchDelete(): void {
  const count = selectedOutlineIds.value.size
  dialog.warning({
    title: '确认批量删除',
    content: `确定要删除选中的 ${count} 个大纲节点吗？删除后无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: () => {
      Array.from(selectedOutlineIds.value).forEach(id => {
        appStore.deleteOutlineItem(id)
      })
      selectedOutlineIds.value.clear()
      message.success(`已删除 ${count} 个大纲节点`)
    }
  })
}

// --- 拖拽排序相关函数 ---
function readDraggedOutlineIds(event: DragEvent): string[] {
  const dataStr = event.dataTransfer?.getData('text/plain')
  if (!dataStr) {
    return []
  }

  try {
    const parsed = JSON.parse(dataStr)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return [dataStr]
  }
}

function resolveDropPosition(event: DragEvent): OutlineDropPosition {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function autoScrollDragContainer(event: DragEvent): void {
  const container = (event.currentTarget as HTMLElement).closest('.workspace-body-main')
  if (!(container instanceof HTMLElement)) {
    return
  }

  const rect = container.getBoundingClientRect()
  const edgeSize = Math.min(72, rect.height / 4)
  const maxStep = 18
  if (event.clientY < rect.top + edgeSize) {
    const intensity = (rect.top + edgeSize - event.clientY) / edgeSize
    container.scrollBy({ top: -Math.ceil(maxStep * intensity) })
  } else if (event.clientY > rect.bottom - edgeSize) {
    const intensity = (event.clientY - (rect.bottom - edgeSize)) / edgeSize
    container.scrollBy({ top: Math.ceil(maxStep * intensity) })
  }
}

// 拖拽开始：记录被拖拽的大纲节点 ID
function handleDragStart(outlineId: string, event: DragEvent): void {
  // 如果拖拽的节点未选中，清空并只拖它
  if (!selectedOutlineIds.value.has(outlineId)) {
    selectedOutlineIds.value.clear()
    selectedOutlineIds.value.add(outlineId)
  }

  draggingOutlineId.value = outlineId
  dragTargetOutlineId.value = null
  dragTargetPosition.value = null
  dragTargetVolumeId.value = null

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', JSON.stringify(Array.from(selectedOutlineIds.value)))
    const dragImage = (event.currentTarget as HTMLElement).closest('.timeline-card')
    if (dragImage instanceof HTMLElement) {
      event.dataTransfer.setDragImage(dragImage, 24, 24)
    }
  }
}

// 拖拽经过：更新拖拽目标位置
function handleDragOver(outlineId: string, event: DragEvent): void {
  if (!draggingOutlineId.value || selectedOutlineIds.value.has(outlineId)) {
    return
  }

  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  autoScrollDragContainer(event)
  dragTargetOutlineId.value = outlineId
  dragTargetPosition.value = resolveDropPosition(event)
  dragTargetVolumeId.value = null
}

function handleDragLeave(outlineId: string, event: DragEvent): void {
  const currentTarget = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget
  if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
    return
  }
  if (dragTargetOutlineId.value === outlineId) {
    dragTargetOutlineId.value = null
    dragTargetPosition.value = null
  }
}

// 拖拽放下：调用 store 执行大纲节点的排序移动
function handleDrop(outlineId: string, event: DragEvent): void {
  event.preventDefault()
  const draggedIds = readDraggedOutlineIds(event)

  if (!draggedIds.length || draggedIds.includes(outlineId)) {
    resetDragState()
    return
  }

  const position = dragTargetOutlineId.value === outlineId && dragTargetPosition.value
    ? dragTargetPosition.value
    : resolveDropPosition(event)
  appStore.moveOutlineItems(draggedIds, outlineId, position)

  selectedOutlineIds.value.clear()
  resetDragState()
}

function handleVolumeDragOver(volumeId: string, event: DragEvent): void {
  if (!draggingOutlineId.value) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  autoScrollDragContainer(event)
  dragTargetOutlineId.value = null
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
}

// 拖到分卷标记时，统一追加到该卷末尾
function handleDropOnVolume(volumeId: string, event: DragEvent): void {
  event.preventDefault()
  const draggedIds = readDraggedOutlineIds(event)

  if (!draggedIds.length) {
    resetDragState()
    return
  }

  appStore.moveOutlineItemsToVolumeEnd(draggedIds, volumeId)
  selectedOutlineIds.value.clear()
  resetDragState()
}

// 重置拖拽状态
function resetDragState(): void {
  draggingOutlineId.value = null
  dragTargetOutlineId.value = null
  dragTargetPosition.value = null
  dragTargetVolumeId.value = null
}

// 处理大纲节点的下拉菜单操作：编辑或删除（删除前弹出二次确认）
function handleMenuSelect(action: string | number, item: OutlineItem): void {
  if (action === 'edit') {
    openEditor(item)
    return
  }

  dialog.warning({
    title: '确认删除节点',
    content: `确定要删除"${item.title}"吗？删除后该大纲节点将无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteOutlineItem(item.id)
      message.success('大纲节点已删除')
    }
  })
}

const ENHANCE_ITEM_KEY = 'outline-enhance-item'
const ENHANCE_VOLUME_KEY = 'outline-enhance-volume'
const enhanceItemLoading = computed(() => appStore.isAiTaskRunning(ENHANCE_ITEM_KEY))
const enhanceVolumeLoading = computed(() => appStore.isAiTaskRunning(ENHANCE_VOLUME_KEY))
const enhanceItemVisible = ref(false)
const enhanceVolumeVisible = ref(false)
const enhanceItemFields = ref<EnhanceFieldDiff[]>([])
const enhanceVolumeFields = ref<EnhanceFieldDiff[]>([])

async function handleAiEnhanceItem(): Promise<void> {
  if (enhanceItemLoading.value) return

  const volume = appStore.outlineVolumes.find((v) => v.id === form.volumeId)

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: ENHANCE_ITEM_KEY,
        kind: 'outline',
        label: 'AI 补充大纲节点',
        description: '正在根据上下文补充大纲节点信息',
        panel: 'outline'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'outline-enhance',
          settings: appStore.appSettings,
          context: {
            mode: 'item',
            currentForm: { title: form.title, wordTarget: form.wordTarget, conflict: form.conflict, summary: form.summary },
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            volumeTitle: volume?.title ?? '',
            volumeSummary: volume?.summary ?? '',
            outlineTitles: appStore.outlineItems.map((i) => i.title),
            volumes: buildAiVolumesContext(),
            outlineItems: buildAiOutlineContext(),
            worldviewEntries: buildAiWorldviewContext(),
            characters: buildAiCharactersContext(),
            currentVolumeOutlineItems: appStore.outlineItems
              .filter((i) => i.volumeId === form.volumeId)
              .map((i) => ({ title: i.title, conflict: i.conflict, summary: i.summary })),
            worldviewTitles: appStore.worldviewEntries.map((e) => e.title),
            characterNames: appStore.characters.map((c) => c.name)
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 补充失败，请检查模型配置')
    }

    const suggested = result.result as { title?: string; wordTarget?: string; conflict?: string; summary?: string }
    const suggestedWordTarget = normalizeOutlineItemWordTarget(suggested.wordTarget)

    enhanceItemFields.value = [
      { key: 'title', label: '节点标题', type: 'text', original: form.title, suggested: suggested.title ?? '', changed: (suggested.title ?? '') !== form.title && Boolean(suggested.title?.trim()) },
      { key: 'wordTarget', label: '预估字数', type: 'text', original: form.wordTarget, suggested: suggestedWordTarget, changed: suggestedWordTarget !== form.wordTarget },
      { key: 'conflict', label: '核心冲突', type: 'text', original: form.conflict, suggested: suggested.conflict ?? '', changed: (suggested.conflict ?? '') !== form.conflict && Boolean(suggested.conflict?.trim()) },
      { key: 'summary', label: '剧情描述', type: 'textarea', original: form.summary, suggested: suggested.summary ?? '', changed: (suggested.summary ?? '') !== form.summary && Boolean(suggested.summary?.trim()) }
    ]
    enhanceItemVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 补充失败，请检查模型配置')
  }
}

function handleEnhanceItemApply(accepted: Record<string, string | string[]>): void {
  if (accepted.title != null) form.title = accepted.title as string
  if (accepted.wordTarget != null) form.wordTarget = normalizeOutlineItemWordTarget(accepted.wordTarget)
  if (accepted.conflict != null) form.conflict = accepted.conflict as string
  if (accepted.summary != null) form.summary = accepted.summary as string
  enhanceItemVisible.value = false
}

async function handleAiEnhanceVolume(): Promise<void> {
  if (enhanceVolumeLoading.value) return

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: ENHANCE_VOLUME_KEY,
        kind: 'outline',
        label: 'AI 补充分卷',
        description: '正在根据上下文补充分卷信息',
        panel: 'outline'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'outline-enhance',
          settings: appStore.appSettings,
          context: {
            mode: 'volume',
            currentForm: { title: volumeForm.title, wordTarget: volumeForm.wordTarget, summary: volumeForm.summary },
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            volumeTitles: appStore.outlineVolumes.map((v) => v.title),
            volumes: buildAiVolumesContext(),
            outlineItems: buildAiOutlineContext(),
            worldviewEntries: buildAiWorldviewContext(),
            characters: buildAiCharactersContext(),
            worldviewTitles: appStore.worldviewEntries.map((e) => e.title),
            characterNames: appStore.characters.map((c) => c.name)
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 补充失败，请检查模型配置')
    }

    const suggested = result.result as { title?: string; wordTarget?: string; summary?: string }
    const suggestedWordTarget = normalizeVolumeWordTarget(suggested.wordTarget)

    enhanceVolumeFields.value = [
      { key: 'title', label: '分卷标题', type: 'text', original: volumeForm.title, suggested: suggested.title ?? '', changed: (suggested.title ?? '') !== volumeForm.title && Boolean(suggested.title?.trim()) },
      { key: 'wordTarget', label: '目标字数', type: 'text', original: volumeForm.wordTarget, suggested: suggestedWordTarget, changed: suggestedWordTarget !== volumeForm.wordTarget && Boolean(suggestedWordTarget) },
      { key: 'summary', label: '分卷摘要', type: 'textarea', original: volumeForm.summary, suggested: suggested.summary ?? '', changed: (suggested.summary ?? '') !== volumeForm.summary && Boolean(suggested.summary?.trim()) }
    ]
    enhanceVolumeVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 补充失败，请检查模型配置')
  }
}

function handleEnhanceVolumeApply(accepted: Record<string, string | string[]>): void {
  if (accepted.title != null) volumeForm.title = accepted.title as string
  if (accepted.wordTarget != null) volumeForm.wordTarget = normalizeVolumeWordTarget(accepted.wordTarget as string)
  if (accepted.summary != null) volumeForm.summary = accepted.summary as string
  enhanceVolumeVisible.value = false
}

watch(
  () => appStore.assistantFocusTarget,
  async (target) => {
    if (!target || target.panel !== 'outline') {
      return
    }

    focusedOutlineId.value = target.entityId
    await nextTick()
    document.querySelector<HTMLElement>(`[data-assistant-focus-id="${target.entityId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      appStore.clearAssistantFocusTarget('outline', target.entityId)
      if (focusedOutlineId.value === target.entityId) {
        focusedOutlineId.value = ''
      }
    }, 2200)
  },
  { immediate: true }
)
</script>

<template>
  <section class="outline-panel">
    <!-- 进度概览条 -->
    <div v-if="progressStats.total" class="progress-bar-section">
      <div class="progress-track">
        <span class="progress-fill done" :style="{ width: (progressStats.done / progressStats.total) * 100 + '%' }" />
        <span class="progress-fill drafting" :style="{ width: (progressStats.drafting / progressStats.total) * 100 + '%' }" />
        <span class="progress-fill planned" :style="{ width: (progressStats.planned / progressStats.total) * 100 + '%' }" />
      </div>
      <div class="progress-legend">
        <span class="legend-item done">已完成 {{ progressStats.done }}</span>
        <span class="legend-item drafting">写作中 {{ progressStats.drafting }}</span>
        <span class="legend-item planned">已规划 {{ progressStats.planned }}</span>
        <span class="legend-item idea">点子 {{ progressStats.idea }}</span>
        <span class="legend-total">共 {{ progressStats.total }} 个节点</span>
      </div>
    </div>

    <!-- 标题区 -->
    <div class="section-head">
      <div>
        <span class="section-kicker">Outline Architecture</span>
        <h2>剧情大纲</h2>
        <p>按卷组织剧情骨架、冲突节拍和章节节点，方便后续创作连续推进。</p>
      </div>
      <div class="section-actions">
        <n-dropdown :options="importExportOptions" placement="bottom-start" @select="handleImportExportAction">
          <button class="soft-button neutral">
            <FileSpreadsheet :size="16" />
            <span>导入导出</span>
            <ChevronDown :size="14" />
          </button>
        </n-dropdown>
        <button class="soft-button neutral" :disabled="unboundOutlineItems.length === 0" @click="createAllUnboundChapters">
          <Files :size="16" />
          <span>一键生成章节{{ unboundOutlineItems.length ? ` (${unboundOutlineItems.length})` : '' }}</span>
        </button>
        <button
          class="soft-button neutral"
          :class="{ active: isSelectionModeActive }"
          @click="toggleSelectionMode"
        >
          <CheckSquare :size="16" />
          <span>{{ isSelectionModeActive ? '✓ 选择模式' : '选择模式' }}</span>
        </button>
        <button class="soft-button" @click="openVolumeEditor()">
          <Rows3 :size="16" />
          <span>新增分卷</span>
        </button>
        <button class="soft-button primary" :disabled="isExpanding" @click="handleExpandOutline">
          <Sparkles :size="16" />
          <span>{{ isExpanding ? '扩写中...' : 'AI 扩写分卷' }}</span>
        </button>
      </div>
    </div>

    <!-- 快捷键提示 -->
    <div v-if="isSelectionModeActive && selectedOutlineIds.size === 0" class="selection-hint">
      💡 提示：点击节点进行选择，按住 Ctrl 多选，按住 Shift 范围选择，ESC 退出
    </div>

    <!-- 时间线主体 -->
    <div v-if="filteredOutlineGroups.length" class="timeline">
      <template v-for="group in filteredOutlineGroups" :key="group.volume.id">
        <!-- 分卷标记 -->
        <div
          class="timeline-volume-marker"
          :class="{ 'drop-target': dragTargetVolumeId === group.volume.id }"
          @dragover="handleVolumeDragOver(group.volume.id, $event)"
          @drop="handleDropOnVolume(group.volume.id, $event)"
          @dragleave="handleVolumeDragLeave(group.volume.id, $event)"
        >
          <button class="volume-marker-btn" @click="volumeCollapsed[group.volume.id] = !volumeCollapsed[group.volume.id]">
            <span class="volume-diamond" />
            <span class="volume-label">{{ formatVolumeLabel(group.volume, group.index, 'formal') }}</span>
            <span v-if="dragTargetVolumeId === group.volume.id" class="volume-drop-label">放到卷末</span>
            <span v-if="group.volume.summary" class="volume-summary">{{ group.volume.summary }}</span>
            <ChevronDown :size="14" class="volume-chevron" :class="{ collapsed: volumeCollapsed[group.volume.id] }" />
          </button>
          <div class="volume-marker-actions">
            <n-button size="small" secondary @click="openVolumeEditor(group.volume)">编辑</n-button>
            <n-button size="small" secondary type="error" @click="handleDeleteVolume(group.volume)">
              <template #icon><Trash2 :size="12" /></template>
              删除
            </n-button>
            <n-button size="small" secondary :disabled="isAnyVolumeExpanding" @click="handleExpandVolumeOutline(group.volume)">
              {{ isExpandingVolume(group.volume.id) ? '扩写中...' : 'AI扩写节点' }}
            </n-button>
            <n-button size="small" type="primary" @click="handleCreateOutline(group.volume.id)">
              <template #icon><Plus :size="12" /></template>
              新增节点
            </n-button>
          </div>
        </div>

        <!-- 节点列表 -->
        <template v-if="!volumeCollapsed[group.volume.id]">
          <div
            v-for="(item, idx) in group.items"
            :key="item.id"
            class="timeline-node"
            :class="{
              left: idx % 2 === 0,
              right: idx % 2 === 1,
              selected: isNodeSelected(item.id),
              dragging: draggingOutlineId === item.id,
              'multi-dragging': draggingOutlineId !== null && isMultiSelectMode && isNodeSelected(item.id) && draggingOutlineId !== item.id,
              'drop-before': dragTargetOutlineId === item.id && dragTargetPosition === 'before',
              'drop-after': dragTargetOutlineId === item.id && dragTargetPosition === 'after',
              'assistant-focused': focusedOutlineId === item.id
            }"
            :data-assistant-focus-id="item.id"
            @dragover="handleDragOver(item.id, $event)"
            @dragleave="handleDragLeave(item.id, $event)"
            @drop="handleDrop(item.id, $event)"
          >
            <span class="timeline-dot" :class="resolveOutlineStatusMeta(item.status).tone" />
            <article class="timeline-card" @click="handleNodeClick(item, $event)">
              <div class="card-header">
                <button
                  class="card-grip"
                  type="button"
                  draggable="true"
                  title="拖动节点"
                  aria-label="拖动节点"
                  @click.stop
                  @dragstart.stop="handleDragStart(item.id, $event)"
                  @dragend.stop="resetDragState"
                >
                  <GripVertical :size="14" />
                </button>
                <span class="card-title">{{ item.title }}</span>
                <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key) => handleMenuSelect(key, item)">
                  <button class="more-button" @click.stop>
                    <MoreVertical :size="13" />
                  </button>
                </n-dropdown>
              </div>
              <div class="card-meta">
                <span class="status-pill" :class="resolveOutlineStatusMeta(item.status).tone">
                  {{ resolveOutlineStatusMeta(item.status).label }}
                </span>
                <span class="status-pill chapter" :class="resolveLinkedChapterMeta(item).tone">
                  {{ resolveLinkedChapterMeta(item).label }}
                </span>
                <span v-if="item.wordTarget" class="card-word">{{ item.wordTarget }}字</span>
              </div>
              <p v-if="item.conflict" class="card-conflict">{{ item.conflict }}</p>
              <div class="card-actions">
                <n-button quaternary size="tiny" @click.stop="openLinkedChapter(item)">
                  <template #icon><FilePlus2 :size="12" /></template>
                  {{ resolveLinkedChapter(item) ? '打开章节' : '创建章节' }}
                </n-button>
              </div>
            </article>
          </div>

          <!-- 本卷新增按钮 -->
          <div v-if="!props.searchQuery" class="timeline-node add-node">
            <span class="timeline-dot ghost" />
            <button class="timeline-add-btn" @click="handleCreateOutline(group.volume.id)">
              <Plus :size="14" />
              <span>在本卷新增节点</span>
            </button>
          </div>
        </template>
      </template>
    </div>

    <div v-else class="arc-empty-state">没有匹配"{{ props.searchQuery }}"的大纲节点。</div>

    <n-modal
      :show="importVisible"
      preset="card"
      class="outline-import-modal"
      :title="`导入大纲 · ${importFileName}`"
      :bordered="false"
      @close="importVisible = false"
    >
      <div class="import-modal-body">
        <!-- 步骤 1：字段映射 -->
        <template v-if="importStep === 1">
          <div class="import-step-head">
            <span class="import-step-index">1</span>
            <div><strong>确认字段映射</strong><p>系统已自动识别表头，章节标题为必选字段。</p></div>
          </div>
          <div class="import-mapping-grid">
            <n-form-item label="分卷名称"><n-select v-model:value="importMapping.volume" clearable :options="importColumnOptions" placeholder="可选" /></n-form-item>
            <n-form-item label="分卷目标字数"><n-select v-model:value="importMapping.volumeWordTarget" clearable :options="importColumnOptions" placeholder="可选" /></n-form-item>
            <n-form-item label="分卷摘要"><n-select v-model:value="importMapping.volumeSummary" clearable :options="importColumnOptions" placeholder="可选" /></n-form-item>
            <n-form-item label="章节标题（必选）"><n-select v-model:value="importMapping.title" clearable :options="importColumnOptions" placeholder="选择标题列" /></n-form-item>
            <n-form-item label="目标字数"><n-select v-model:value="importMapping.wordTarget" clearable :options="importColumnOptions" placeholder="可选" /></n-form-item>
            <n-form-item label="核心冲突"><n-select v-model:value="importMapping.conflict" clearable :options="importColumnOptions" placeholder="可选" /></n-form-item>
            <n-form-item label="剧情摘要"><n-select v-model:value="importMapping.summary" clearable :options="importColumnOptions" placeholder="可选" /></n-form-item>
            <n-form-item label="章节序号"><n-select v-model:value="importMapping.sequence" clearable :options="importColumnOptions" placeholder="可选" /></n-form-item>
            <n-form-item label="状态"><n-select v-model:value="importMapping.status" clearable :options="importColumnOptions" placeholder="可选" /></n-form-item>
          </div>
          <div class="import-preview-head">
            <strong>数据预览</strong>
            <span>{{ importPreviewCountLabel }}</span>
          </div>
          <div class="import-preview-table-wrap compact">
            <table class="import-preview-table">
              <colgroup>
                <col class="preview-col-sequence">
                <col class="preview-col-volume">
                <col class="preview-col-title">
                <col class="preview-col-target">
                <col class="preview-col-conflict">
                <col class="preview-col-status">
              </colgroup>
              <thead><tr><th>序号</th><th>分卷</th><th>章节标题</th><th>目标字数</th><th>核心冲突</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="(row, index) in importPreviewRows" :key="index">
                  <td class="preview-sequence">{{ row.sequence }}</td>
                  <td class="preview-volume" :title="row.volume">{{ row.volume }}</td>
                  <td class="preview-title" :class="{ 'text-muted': row.title === '（未识别标题）' }" :title="row.title">{{ row.title }}</td>
                  <td class="preview-target">{{ row.wordTarget }}</td>
                  <td class="preview-conflict" :title="row.conflict">{{ row.conflict }}</td>
                  <td><span class="import-preview-status" :class="`status-${row.status}`">{{ row.statusLabel }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- 步骤 2：确认分卷 -->
        <template v-else-if="importStep === 2">
           <div class="import-step-head">
             <span class="import-step-index">2</span>
             <div><strong>确认导入分卷</strong><p>可选择需要导入的分卷；如果一个都不选，下一步需将章节逐行分配到项目已有分卷。</p></div>
          </div>
          <div class="import-volumes-list">
            <div v-for="vol in importVolumesConfirmed" :key="vol.key" class="import-volume-item">
              <n-checkbox v-model:checked="vol.enabled">
                <span class="volume-title">{{ vol.title }}</span>
                <span v-if="vol.isNew" class="volume-badge new">新建</span>
                <span v-else class="volume-badge existing">已存在</span>
              </n-checkbox>
            </div>
          </div>
        </template>

        <!-- 步骤 3：确认章节 -->
        <template v-else-if="importStep === 3">
          <div class="import-step-head">
            <span class="import-step-index">3</span>
             <div><strong>确认导入章节</strong><p>检查目标分卷和处理策略；空选分卷时，目标分卷只能选择项目已有分卷。</p></div>
          </div>
          <div class="import-stats-strip">
            <span class="add">新增 {{ importStats.add }}</span>
            <span class="overwrite">覆盖 {{ importStats.overwrite }}</span>
            <span>跳过 {{ importStats.skip }}</span>
            <span :class="{ error: importStats.error }">错误 {{ importStats.error }}</span>
          </div>

          <div class="import-view-toolbar">
            <div class="import-batch-actions">
              <n-button size="small" @click="toggleAllImportRows(true)">全选</n-button>
              <n-button size="small" @click="toggleAllImportRows(false)">全不选</n-button>
              <n-button size="small" :disabled="importSelectedCount === 0" @click="showBatchVolumeModal = true">
                <template #icon><FolderTree :size="14" /></template>
                批量设置分卷
              </n-button>
              <n-button size="small" :disabled="importSelectedCount === 0" @click="showBatchStrategyModal = true">
                <template #icon><ListChecks :size="14" /></template>
                批量设置策略
              </n-button>
            </div>
          </div>

          <div class="import-plan-table-wrap">
            <table class="import-plan-table">
              <thead>
                <tr><th style="width: 50px;">导入</th><th style="min-width: 200px;">章节</th><th style="width: 140px;">来源分卷</th><th style="width: 180px;">目标分卷</th><th style="width: 120px;">处理方式</th><th style="width: 80px;">状态</th></tr>
              </thead>
              <tbody>
                <tr v-for="item in filteredImportPlan" :key="item.key" :class="{ disabled: !item.enabled, invalid: item.error }">
                  <td><n-checkbox :checked="item.enabled" :disabled="Boolean(item.error)" @update:checked="(value) => setImportEnabled(item, value)" /></td>
                  <td class="title-cell">
                    <strong>{{ item.title || '未识别标题' }}</strong>
                  </td>
                  <td>{{ item.sourceVolumeTitle || '未指定' }}</td>
                  <td>
                    <n-select v-model:value="item.targetVolumeKey" size="small" :options="filteredImportVolumeOptions" @update:value="handleImportTargetChange(item)" />
                  </td>
                  <td>
                    <n-select :value="item.strategy" size="small" :options="importStrategyOptions(item)" @update:value="(value) => handleImportStrategyChange(item, value)" />
                  </td>
                  <td><span class="import-row-status" :class="{ error: item.error, duplicate: hasImportDuplicate(item) }">{{ item.error || (hasImportDuplicate(item) ? '重复' : '正常') }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

        </template>
      </div>
      <template #footer>
        <div class="import-modal-footer">
          <n-button @click="importVisible = false">取消</n-button>
          <n-button v-if="importStep === 2" @click="backToFieldMapping">返回字段映射</n-button>
          <n-button v-if="importStep === 3" @click="backToVolumeConfirm">返回分卷确认</n-button>
          <n-button v-if="importStep === 1" type="primary" :disabled="importMapping.title == null" @click="buildImportPlan">
            下一步：确认分卷
          </n-button>
          <n-button v-else-if="importStep === 2" type="primary" @click="confirmVolumesAndProceed">
            下一步：确认章节
          </n-button>
          <n-button v-else-if="importStep === 3" type="primary" :disabled="importEnabledCount === 0" @click="commitOutlineImport">
            确认导入 {{ importEnabledCount }} 条
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 导出预览弹窗 -->
    <n-modal
      :show="exportPreviewVisible"
      preset="card"
      class="export-preview-modal"
      title="导出预览"
      :bordered="false"
      @close="exportPreviewVisible = false"
    >
      <div class="export-preview-hint">
        <div class="hint-icon">
          <FileDown :size="24" :stroke-width="2" />
        </div>
        <div class="hint-content">
          <div class="hint-title">即将导出 {{ exportPreviewData.itemCount }} 个大纲节点</div>
          <div class="hint-desc">导出为 Excel 文件，包含以下字段：分卷名称、分卷目标字数、分卷摘要、章节序号、章节标题、目标字数、核心冲突、剧情摘要</div>
        </div>
      </div>

      <div class="export-preview-section-title">数据预览（前10条）</div>

      <div class="export-preview-table-wrap">
        <table class="export-preview-table">
          <thead>
            <tr>
              <th style="width: 140px;">分卷</th>
              <th style="width: 200px;">章节标题</th>
              <th style="width: 80px;">字数</th>
              <th>核心冲突</th>
              <th>剧情摘要</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in exportPreviewData.rows" :key="i">
              <td>{{ row.volume }}</td>
              <td><strong>{{ row.title }}</strong></td>
              <td class="number-cell">{{ row.wordTarget }}</td>
              <td class="text-cell">{{ row.conflict || '—' }}</td>
              <td class="text-cell">{{ row.summary || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="exportPreviewData.itemCount > 10" class="preview-more">
          还有 {{ exportPreviewData.itemCount - 10 }} 个节点未显示，将一并导出
        </div>
      </div>

      <template #footer>
        <div class="export-modal-footer">
          <n-button @click="exportPreviewVisible = false">取消</n-button>
          <n-button type="primary" @click="confirmExport">
            <template #icon><FileDown :size="14" /></template>
            确认导出
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 批量设置分卷弹窗 -->
    <n-modal
      :show="showBatchVolumeModal"
      preset="dialog"
      title="批量设置分卷"
      positive-text="应用"
      negative-text="取消"
      @positive-click="applyImportBatchTarget"
      @negative-click="showBatchVolumeModal = false"
    >
      <n-form label-placement="top">
        <n-form-item label="目标分卷">
          <n-select v-model:value="importBatchTarget" :options="importVolumeOptions" placeholder="选择目标分卷" />
        </n-form-item>
      </n-form>
      <p style="margin-top: 12px; font-size: 13px; color: var(--arc-text-hint);">
        将所有已选中的节点迁移到所选分卷
      </p>
    </n-modal>

    <!-- 批量设置策略弹窗 -->
    <n-modal
      :show="showBatchStrategyModal"
      preset="dialog"
      title="批量设置策略"
      positive-text="应用"
      negative-text="取消"
      @positive-click="applyImportBatchStrategy"
      @negative-click="showBatchStrategyModal = false"
    >
      <n-form label-placement="top">
        <n-form-item label="处理策略">
          <n-select v-model:value="importBatchStrategy" :options="importBatchStrategyOptions" placeholder="选择处理策略" />
        </n-form-item>
      </n-form>
      <p style="margin-top: 12px; font-size: 13px; color: var(--arc-text-hint);">
        批量设置所有节点的导入策略
      </p>
    </n-modal>

    <!-- 编辑弹窗保持不变 -->
    <n-modal
      :show="editorVisible"
      preset="card"
      class="arc-editor-modal-wide"
      :title="editingOutlineId ? '编辑大纲节点' : '新建大纲节点'"
      :bordered="false"
      @close="editorVisible = false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top">
            <n-form-item label="所属分卷">
              <n-select v-model:value="form.volumeId" :options="volumeOptions" placeholder="选择这一节点所在的分卷" />
            </n-form-item>
            <n-form-item label="节点标题">
              <n-input v-model:value="form.title" placeholder="例如：第4章：夜城回响" />
            </n-form-item>
            <n-form-item label="预估字数">
              <n-input v-model:value="form.wordTarget" placeholder="例如：3200">
                <template #suffix>字</template>
              </n-input>
            </n-form-item>
            <n-form-item label="推进状态">
              <n-select v-model:value="form.status" :options="outlineStatusOptions" placeholder="选择当前节点所处阶段" />
            </n-form-item>
            <n-form-item label="核心冲突">
              <n-input v-model:value="form.conflict" placeholder="概括这一节点的核心矛盾..." />
            </n-form-item>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">剧情描述</div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="form.summary"
              type="textarea"
              placeholder="补充这一节点如何推进剧情..."
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ form.summary.length }} 字</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button round strong :loading="enhanceItemLoading" @click="handleAiEnhanceItem">
            <template #icon><Sparkles :size="14" /></template>
            AI 补充
          </n-button>
          <n-button type="primary" round strong @click="submitOutline">
            {{ editingOutlineId ? '保存修改' : '创建节点' }}
          </n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>

    <AiEnhancePreview
      :show="enhanceItemVisible"
      :fields="enhanceItemFields"
      :loading="enhanceItemLoading"
      @apply="handleEnhanceItemApply"
      @close="enhanceItemVisible = false"
    />

    <n-modal
      :show="volumeEditorVisible"
      preset="card"
      class="arc-editor-modal-wide"
      :title="editingVolumeId ? '编辑分卷' : '新建分卷'"
      :bordered="false"
      @close="volumeEditorVisible = false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top">
            <n-form-item label="分卷标题">
              <n-input v-model:value="volumeForm.title" placeholder="例如：霓虹下的老鼠" />
            </n-form-item>
            <n-form-item label="目标字数">
              <n-input v-model:value="volumeForm.wordTarget" placeholder="例如：50000" :allow-input="allowDigitsOnly">
                <template #suffix>字</template>
              </n-input>
            </n-form-item>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">分卷摘要</div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="volumeForm.summary"
              type="textarea"
              placeholder="概括这一卷的主线、冲突和情绪走向..."
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ volumeForm.summary.length }} 字</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button round strong @click="volumeEditorVisible = false">取消</n-button>
          <n-button round strong :loading="enhanceVolumeLoading" @click="handleAiEnhanceVolume">
            <template #icon><Sparkles :size="14" /></template>
            AI 补充
          </n-button>
          <n-button type="primary" round strong @click="submitVolume">
            {{ editingVolumeId ? '保存修改' : '创建分卷' }}
          </n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>

    <AiEnhancePreview
      :show="enhanceVolumeVisible"
      :fields="enhanceVolumeFields"
      :loading="enhanceVolumeLoading"
      @apply="handleEnhanceVolumeApply"
      @close="enhanceVolumeVisible = false"
    />

    <!-- 右下角悬浮工具栏 -->
    <Transition name="slideUp">
      <div v-if="selectedOutlineIds.size > 0" class="floating-toolbar">
        <div class="toolbar-info">
          <span class="toolbar-count">已选中 {{ selectedOutlineIds.size }} 个节点</span>
          <button class="toolbar-link" @click="selectAllVisible">全选</button>
          <button class="toolbar-link" @click="selectedOutlineIds.clear()">清空</button>
        </div>
        <div class="toolbar-actions">
          <n-button size="small" @click="openMigrateModal">迁移</n-button>
          <n-button size="small" type="error" @click="batchDeleteSelected">删除</n-button>
        </div>
      </div>
    </Transition>

    <!-- 迁移分卷弹窗 -->
    <n-modal
      :show="migrateModalVisible"
      preset="dialog"
      title="迁移节点到分卷"
      positive-text="确认迁移"
      negative-text="取消"
      @positive-click="submitMigrate"
      @negative-click="migrateModalVisible = false"
    >
      <n-form label-placement="top">
        <n-form-item label="目标分卷">
          <n-select v-model:value="migrateTargetVolumeId" :options="volumeOptions" placeholder="选择要迁移到的分卷" />
        </n-form-item>
      </n-form>
      <p style="margin-top: 12px; font-size: 13px; color: var(--arc-text-hint);">
        将 {{ selectedOutlineIds.size }} 个节点迁移到所选分卷
      </p>
    </n-modal>
  </section>
</template>

<style scoped>
.outline-panel {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 24px;
}

/* ── 进度概览条 ── */
.progress-bar-section {
  margin-bottom: 40px;
  padding: 20px 24px;
  background: linear-gradient(135deg, var(--arc-bg-surface) 0%, color-mix(in srgb, var(--arc-bg-surface) 98%, var(--arc-primary) 2%) 100%);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.progress-track {
  display: flex;
  height: 8px;
  border-radius: 999px;
  background: var(--arc-bg-surface-hover);
  overflow: hidden;
  gap: 2px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.progress-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.2) 0%, transparent 100%);
  border-radius: 999px 999px 0 0;
}

.progress-fill.done { background: #10b981; }
.progress-fill.drafting { background: #f59e0b; }
.progress-fill.planned { background: #3b82f6; }

.progress-legend {
  display: flex;
  gap: 20px;
  margin-top: 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-secondary);
  flex-wrap: wrap;
  align-items: center;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  transition: color 0.2s;
}

.legend-item:hover {
  color: var(--arc-text-primary);
}

.legend-item::before {
  content: '';
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 15%, transparent);
}

.legend-item.done::before { background: #10b981; }
.legend-item.drafting::before { background: #f59e0b; }
.legend-item.planned::before { background: #3b82f6; }
.legend-item.idea::before { background: var(--arc-text-hint); }

.legend-total {
  margin-left: auto;
  color: var(--arc-primary);
  font-weight: 700;
  letter-spacing: -0.01em;
}

/* ── 标题区 ── */
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 40px;
  gap: 20px;
  flex-wrap: wrap;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--arc-border);
}

.section-kicker {
  display: inline-block;
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  margin-bottom: 8px;
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--arc-primary) 20%, transparent);
}

.section-head h2 {
  margin: 4px 0 6px;
  font-size: clamp(22px, 2.4vw, 28px);
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--arc-text-primary);
  line-height: 1.2;
}

.section-head p {
  max-width: 520px;
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.section-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
  padding-top: 4px;
}

.import-mapping-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 16px;
}

.import-modal-body {
  max-height: calc(100vh - 240px);
  overflow-y: auto;
  padding-right: 4px;
}

.import-modal-body::-webkit-scrollbar {
  width: 8px;
}

.import-modal-body::-webkit-scrollbar-track {
  background: var(--arc-bg-surface-hover);
  border-radius: 4px;
}

.import-modal-body::-webkit-scrollbar-thumb {
  background: var(--arc-border);
  border-radius: 4px;
}

.import-modal-body::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--arc-border) 70%, var(--arc-text-hint));
}

.import-step-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 18px;
}

.import-step-index {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  flex: 0 0 28px;
  border-radius: 6px;
  background: var(--arc-primary);
  color: white;
  font-size: 13px;
  font-weight: 800;
}

.import-step-head strong {
  color: var(--arc-text-primary);
  font-size: 15px;
}

.import-step-head p {
  margin: 3px 0 0;
  color: var(--arc-text-muted);
  font-size: 12px;
}

.import-preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin: 4px 0 10px;
}

.import-preview-head span {
  color: var(--arc-text-muted);
  font-size: 12px;
}

.import-preview-table-wrap {
  overflow: auto;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
}

.import-preview-table-wrap.compact {
  max-height: 340px;
  margin-bottom: 20px;
}

.import-preview-table {
  width: 100%;
  min-width: 820px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}

.import-preview-table .preview-col-sequence { width: 64px; }
.import-preview-table .preview-col-volume { width: 150px; }
.import-preview-table .preview-col-title { width: 210px; }
.import-preview-table .preview-col-target { width: 100px; }
.import-preview-table .preview-col-conflict { width: auto; }
.import-preview-table .preview-col-status { width: 92px; }

.import-preview-table th {
  position: sticky;
  z-index: 1;
  top: 0;
  padding: 9px 12px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.import-preview-table td {
  height: 42px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--arc-border);
  color: var(--arc-text-secondary);
  vertical-align: middle;
}

.import-preview-table .preview-volume,
.import-preview-table .preview-title,
.import-preview-table .preview-conflict {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-preview-table .preview-sequence {
  color: var(--arc-text-hint);
  font-variant-numeric: tabular-nums;
}

.import-preview-table .preview-title {
  color: var(--arc-text-primary);
  font-weight: 600;
}

.import-preview-table .preview-target {
  font-variant-numeric: tabular-nums;
}

.import-preview-table td.text-muted {
  color: var(--arc-text-hint);
  font-style: italic;
}

.import-preview-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 54px;
  height: 22px;
  padding: 0 7px;
  border: 1px solid var(--arc-border);
  border-radius: 4px;
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.import-preview-status.status-planned {
  border-color: color-mix(in srgb, #2563eb 28%, var(--arc-border));
  background: color-mix(in srgb, #2563eb 7%, var(--arc-bg-surface));
  color: #2563eb;
}

.import-preview-status.status-drafting {
  border-color: color-mix(in srgb, #d97706 30%, var(--arc-border));
  background: color-mix(in srgb, #d97706 7%, var(--arc-bg-surface));
  color: #b45309;
}

.import-preview-status.status-done {
  border-color: color-mix(in srgb, #059669 30%, var(--arc-border));
  background: color-mix(in srgb, #059669 7%, var(--arc-bg-surface));
  color: #047857;
}

.import-preview-table tbody tr:last-child td {
  border-bottom: none;
}

.import-preview-table tbody tr:hover {
  background: var(--arc-bg-surface-hover);
}

.import-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.import-stats-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.import-stats-strip span,
.import-row-status {
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 4px 9px;
  font-size: 11px;
  white-space: nowrap;
}

.import-stats-strip .add,
.import-row-status:not(.error):not(.duplicate) {
  border-color: color-mix(in srgb, #10b981 35%, var(--arc-border));
  color: #059669;
}

.import-stats-strip .overwrite,
.import-row-status.duplicate {
  border-color: color-mix(in srgb, #f59e0b 38%, var(--arc-border));
  color: #d97706;
}

.import-stats-strip .error,
.import-row-status.error {
  border-color: color-mix(in srgb, #ef4444 38%, var(--arc-border));
  color: #dc2626;
}

.import-batch-toolbar {
  display: grid;
  grid-template-columns: auto minmax(260px, 1fr) minmax(260px, 1fr);
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  display: none; /* 隐藏旧版批量工具栏，改用悬浮工具栏 */
}

.import-batch-actions,
.import-batch-control {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.import-batch-control :deep(.n-select) {
  min-width: 0;
  flex: 1;
}

.import-plan-table-wrap {
  max-height: 480px;
  min-height: 320px;
  overflow: auto;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
}

.import-plan-table {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}

.import-plan-table th,
.import-plan-table td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--arc-border);
  text-align: left;
  vertical-align: middle;
}

.import-plan-table th {
  position: sticky;
  z-index: 2;
  top: 0;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-weight: 700;
}

.import-plan-table th:nth-child(1) { width: 54px; }
.import-plan-table th:nth-child(2) { width: 76px; }
.import-plan-table th:nth-child(3) { width: 210px; }
.import-plan-table th:nth-child(4) { width: 135px; }
.import-plan-table th:nth-child(5) { width: 170px; }
.import-plan-table th:nth-child(6) { width: 230px; }
.import-plan-table th:nth-child(7) { width: 90px; }
.import-plan-table th:nth-child(8) { width: 90px; }

.import-plan-table tr.disabled td {
  opacity: 0.58;
}

.import-plan-table tr.invalid td {
  background: color-mix(in srgb, #ef4444 5%, transparent);
}

.source-cell {
  color: var(--arc-text-muted);
  white-space: nowrap;
}

.title-cell strong,
.title-cell small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-cell strong {
  color: var(--arc-text-primary);
  font-size: 12px;
}

.title-cell small {
  margin-top: 3px;
  color: var(--arc-text-muted);
}

@media (max-width: 760px) {
  .import-mapping-grid {
    grid-template-columns: 1fr;
  }

  .import-batch-toolbar {
    grid-template-columns: 1fr;
  }
}

.soft-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: none;
  border-radius: var(--arc-radius-md);
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 14px;
  transition: background 0.15s, transform 0.1s;
}

.soft-button:hover {
  background: color-mix(in srgb, var(--arc-primary) 16%, var(--arc-bg-surface));
}

.soft-button:active {
  transform: scale(0.97);
}

.soft-button.neutral {
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  color: var(--arc-text-primary);
}

.soft-button.neutral:hover {
  background: var(--arc-bg-surface-hover);
}

.soft-button.active {
  background: var(--arc-primary);
  color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.soft-button.active:hover {
  background: color-mix(in srgb, var(--arc-primary) 90%, black);
}

.soft-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.soft-button.primary {
  background: var(--arc-primary);
  color: white;
  font-weight: 700;
}

.soft-button.primary:hover {
  background: color-mix(in srgb, var(--arc-primary) 90%, black);
}

.soft-button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.import-view-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 14px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
}

.import-batch-actions {
  display: flex;
  gap: 8px;
}

/* ── 导出预览弹窗 ── */
.export-preview-hint {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 20px;
  padding: 16px 18px;
  border-left: 3px solid var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  border-radius: var(--arc-radius-md);
}

.hint-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: var(--arc-radius-md);
  background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
  color: var(--arc-primary);
}

.hint-content {
  flex: 1;
  min-width: 0;
}

.hint-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--arc-text-primary);
  margin-bottom: 6px;
  letter-spacing: -0.01em;
}

.hint-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--arc-text-secondary);
}

.export-preview-section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--arc-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 10px;
  padding-left: 2px;
}

.export-preview-table-wrap {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  overflow: hidden;
  max-height: 450px;
  overflow-y: auto;
}

.export-preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
}

.export-preview-table th,
.export-preview-table td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--arc-border);
  text-align: left;
  vertical-align: top;
}

.export-preview-table th {
  position: sticky;
  top: 0;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.02em;
  z-index: 2;
  box-shadow: 0 1px 0 var(--arc-border);
}

.export-preview-table tbody tr:last-child td {
  border-bottom: none;
}

.export-preview-table tbody tr:hover {
  background: var(--arc-bg-surface-hover);
}

.export-preview-table tbody tr:not(:last-child) td:first-child:not(:empty)::after {
  content: '';
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 0;
  height: 1px;
  background: color-mix(in srgb, var(--arc-primary) 20%, var(--arc-border));
}

.export-preview-table td:first-child {
  position: relative;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.export-preview-table td:first-child:empty {
  color: var(--arc-text-hint);
}

.export-preview-table td:first-child:empty::before {
  content: '↓';
  display: block;
  text-align: center;
  font-size: 11px;
  opacity: 0.4;
}

.export-preview-table .number-cell {
  font-variant-numeric: tabular-nums;
  color: var(--arc-text-secondary);
}

.export-preview-table .text-cell {
  font-size: 12px;
  color: var(--arc-text-secondary);
  line-height: 1.5;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-preview-table td strong {
  color: var(--arc-text-primary);
  font-weight: 600;
}

.preview-more {
  padding: 14px;
  text-align: center;
  font-size: 13px;
  color: var(--arc-text-hint);
  background: var(--arc-bg-surface-hover);
  border-top: 1px solid var(--arc-border);
  font-weight: 600;
}

.export-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.floating-toolbar {
  position: fixed;
  bottom: 32px;
  right: 32px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.08);
  z-index: 100;
  backdrop-filter: blur(10px);
}

.toolbar-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-count {
  font-size: 14px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.toolbar-link {
  background: none;
  border: none;
  color: var(--arc-primary);
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  padding: 4px 8px;
  transition: color 0.15s;
}

.toolbar-link:hover {
  color: color-mix(in srgb, var(--arc-primary) 80%, black);
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.slideUp-enter-active,
.slideUp-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slideUp-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.slideUp-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

/* ── 选择模式提示 ── */
.selection-hint {
  padding: 12px 20px;
  margin-bottom: 20px;
  background: color-mix(in srgb, var(--arc-info) 8%, var(--arc-bg-surface));
  border: 1px solid color-mix(in srgb, var(--arc-info) 20%, var(--arc-border));
  border-radius: var(--arc-radius-md);
  color: var(--arc-text-secondary);
  font-size: 13px;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* ── 时间线 ── */
.timeline {
  position: relative;
  padding: 8px 0 32px;
  max-width: 720px;
  margin: 0 auto;
}

.timeline::before {
  content: '';
  position: absolute;
  left: 24px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    color-mix(in srgb, var(--arc-primary) 25%, var(--arc-border)) 8%,
    color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border)) 50%,
    color-mix(in srgb, var(--arc-primary) 25%, var(--arc-border)) 92%,
    transparent 100%
  );
  border-radius: 2px;
}

/* ── 分卷标记 ── */
.timeline-volume-marker {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 48px 0 32px;
  gap: 12px;
}

.timeline-volume-marker:first-child {
  margin-top: 8px;
}

.volume-marker-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 24px 10px 18px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 25%, var(--arc-border));
  border-radius: var(--arc-radius-lg);
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06), 0 0 0 3px color-mix(in srgb, var(--arc-primary) 6%, transparent);
  transition: box-shadow 0.2s, border-color 0.2s, background 0.2s, transform 0.2s;
}

.volume-marker-btn:hover {
  background: color-mix(in srgb, var(--arc-primary) 9%, var(--arc-bg-surface));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1), 0 0 0 4px color-mix(in srgb, var(--arc-primary) 10%, transparent);
  border-color: color-mix(in srgb, var(--arc-primary) 45%, var(--arc-border));
}

.timeline-volume-marker.drop-target .volume-marker-btn {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 14%, transparent), 0 6px 18px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.volume-diamond {
  width: 11px;
  height: 11px;
  background: var(--arc-primary);
  transform: rotate(45deg);
  border-radius: 2px;
  flex-shrink: 0;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 15%, transparent);
}

.volume-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--arc-text-primary);
  letter-spacing: -0.01em;
}

.volume-drop-label {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--arc-primary);
  color: white;
  font-size: 11px;
  font-weight: 700;
}

.volume-summary {
  font-size: 12px;
  color: var(--arc-text-hint);
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
  border-left: 2px solid var(--arc-border);
}

.volume-chevron {
  color: color-mix(in srgb, var(--arc-primary) 60%, var(--arc-text-hint));
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.volume-chevron.collapsed {
  transform: rotate(-90deg);
}

.volume-marker-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

/* ── 时间线节点 ── */
.timeline-node {
  position: relative;
  display: flex;
  align-items: flex-start;
  margin-bottom: 28px;
  width: 100%;
  padding-left: 56px;
  justify-content: flex-start;
}

.timeline-node.left,
.timeline-node.right,
.timeline-node.add-node {
  align-self: flex-start;
  margin-left: 0;
  padding-right: 0;
  padding-left: 56px;
  justify-content: flex-start;
}

/* ── 轴线圆点 ── */
.timeline-dot {
  position: absolute;
  top: 20px;
  left: 17px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 3px solid var(--arc-bg-surface);
  box-shadow: 0 0 0 2px var(--arc-border);
  z-index: 3;
  flex-shrink: 0;
  transition: transform 0.2s, box-shadow 0.2s;
}

.timeline-node:hover .timeline-dot {
  transform: scale(1.2);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 30%, transparent);
}

.timeline-node.left .timeline-dot,
.timeline-node.right .timeline-dot,
.timeline-node.add-node .timeline-dot {
  left: 17px;
  right: auto;
}

.timeline-dot.ghost { background: var(--arc-text-hint); }
.timeline-dot.neutral { background: #3b82f6; box-shadow: 0 0 0 2px color-mix(in srgb, #3b82f6 20%, var(--arc-border)); }
.timeline-dot.primary { background: #f59e0b; box-shadow: 0 0 0 2px color-mix(in srgb, #f59e0b 20%, var(--arc-border)); }
.timeline-dot.success { background: #10b981; box-shadow: 0 0 0 2px color-mix(in srgb, #10b981 20%, var(--arc-border)); }

/* ── 节点卡片 ── */
.timeline-card {
  flex: 1;
  max-width: none;
  padding: 16px 18px 14px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s, border-color 0.2s;
  position: relative;
  overflow: hidden;
}

.timeline-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: transparent;
  transition: background 0.2s;
}

.timeline-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.10), 0 2px 8px rgba(0, 0, 0, 0.06);
  border-color: color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
}

.timeline-card:hover::before {
  background: linear-gradient(90deg, var(--arc-primary), color-mix(in srgb, var(--arc-primary) 60%, transparent));
}

.timeline-node.dragging .timeline-card {
  opacity: 0.4;
  transform: scale(0.95) rotate(1deg);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.15);
}

.timeline-node.drop-before .timeline-card,
.timeline-node.drop-after .timeline-card {
  border-color: var(--arc-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-primary) 10%, transparent), 0 4px 12px rgba(0, 0, 0, 0.08);
}

.timeline-node.drop-before::before,
.timeline-node.drop-after::after {
  content: '';
  position: absolute;
  left: 56px;
  right: 0;
  z-index: 6;
  height: 3px;
  border-radius: 3px;
  background: var(--arc-primary);
  box-shadow: -4px 0 0 var(--arc-primary), 0 0 0 4px color-mix(in srgb, var(--arc-primary) 10%, transparent);
  pointer-events: none;
}

.timeline-node.drop-before::before {
  top: -14px;
}

.timeline-node.drop-after::after {
  bottom: -14px;
}

.timeline-node.assistant-focused .timeline-card {
  border-color: color-mix(in srgb, var(--arc-accent) 78%, white 22%);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-accent) 18%, transparent), 0 20px 48px rgba(15, 23, 42, 0.14);
}

/* 选中状态 */
.timeline-node.selected .timeline-card {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}

/* 多选拖拽中 */
.timeline-node.multi-dragging .timeline-card {
  opacity: 0.5;
  transform: scale(0.98);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 11px;
}

.card-grip {
  display: inline-flex;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--arc-radius-sm);
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--arc-text-hint);
  flex-shrink: 0;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.2s, color 0.2s, background 0.2s;
}

.timeline-card:hover .card-grip,
.card-grip:focus-visible {
  opacity: 0.8;
  color: var(--arc-text-secondary);
}

.card-grip:hover,
.card-grip:focus-visible {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-primary);
  outline: none;
}

.card-grip:active {
  cursor: grabbing;
}

.card-title {
  flex: 1;
  font-size: 15px;
  font-weight: 700;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.2s;
  letter-spacing: -0.02em;
  line-height: 1.4;
}

.timeline-card:hover .card-title {
  color: var(--arc-primary);
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 9px;
  letter-spacing: 0.03em;
}

.status-pill.ghost { background: var(--arc-bg-surface-hover); color: var(--arc-text-hint); }
.status-pill.neutral { background: color-mix(in srgb, #3b82f6 14%, var(--arc-bg-surface)); color: #2563eb; }
.status-pill.primary { background: color-mix(in srgb, #f59e0b 14%, var(--arc-bg-surface)); color: #d97706; }
.status-pill.success { background: color-mix(in srgb, #10b981 14%, var(--arc-bg-surface)); color: #059669; }
.status-pill.chapter { border: 1px solid var(--arc-border); color: var(--arc-text-secondary); }

.card-word {
  font-size: 11px;
  color: var(--arc-text-hint);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  background: var(--arc-bg-surface-hover);
  padding: 2px 7px;
  border-radius: 999px;
}

.card-conflict {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  padding: 8px 10px;
  background: var(--arc-bg-surface-hover);
  border-radius: var(--arc-radius-sm);
  border-left: 2px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
}

.card-actions {
  display: flex;
  padding-top: 8px;
  border-top: 1px solid var(--arc-border);
  margin-top: 2px;
}

.more-button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--arc-radius-sm);
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.more-button:hover {
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface-hover));
  color: var(--arc-primary);
}

/* ── 新增按钮 ── */
.timeline-add-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px 18px;
  border: 1px dashed color-mix(in srgb, var(--arc-primary) 25%, var(--arc-border));
  border-radius: var(--arc-radius-md);
  background: color-mix(in srgb, var(--arc-primary) 3%, transparent);
  color: var(--arc-text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, background 0.2s, transform 0.15s;
}

.timeline-add-btn:hover {
  border-color: var(--arc-primary);
  border-style: solid;
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface));
  transform: translateY(-2px);
}

/* ── 响应式：窄屏退化为单侧 ── */
@media (max-width: 1000px) {
  .outline-panel {
    padding: 0 20px;
  }

  .timeline {
    max-width: 600px;
  }

}

@media (max-width: 900px) {
  .outline-panel {
    padding: 0 16px;
  }

  .timeline {
    max-width: none;
  }

  .timeline::before {
    left: 24px;
  }

  .timeline-node,
  .timeline-node.left,
  .timeline-node.right,
  .timeline-node.add-node {
    width: 100%;
    margin-left: 0;
    padding-left: 56px;
    padding-right: 0;
    justify-content: flex-start;
  }

  .timeline-node .timeline-dot,
  .timeline-node.left .timeline-dot,
  .timeline-node.right .timeline-dot,
  .timeline-node.add-node .timeline-dot {
    left: 17px;
    right: auto;
  }

  .timeline-volume-marker {
    align-items: flex-start;
    padding-left: 48px;
  }

  .volume-summary {
    display: none;
  }
}

/* ── 多选工具栏 ── */
.multi-select-toolbar {
  position: fixed;
  bottom: 32px;
  right: 32px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

.toolbar-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

@media (max-width: 600px) {
  .section-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .section-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .volume-marker-actions {
    flex-wrap: wrap;
    gap: 4px;
  }

  .progress-bar-section {
    padding: 14px 16px;
  }

  .progress-legend {
    gap: 12px;
    font-size: 12px;
  }

  .section-head h2 {
    font-size: 22px;
  }

  .timeline-card {
    padding: 14px 16px 12px;
  }

  .card-title {
    font-size: 14px;
  }
}
</style>

<style>
.outline-import-modal {
  width: min(1200px, calc(100vw - 48px));
  max-height: calc(100vh - 80px);
}

.outline-import-modal :deep(.n-card__content) {
  padding: 24px;
}

.import-volumes-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
  padding: 4px;
}

.import-volume-item {
  padding: 14px 16px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.import-volume-item:hover {
  background: var(--arc-bg-surface-hover);
  border-color: var(--arc-border-hover);
}

.import-volume-item .volume-title {
  font-size: 14px;
  font-weight: 500;
  margin-right: 8px;
}

.import-volume-item .volume-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
}

.import-volume-item .volume-badge.new {
  background: #dbeafe;
  color: #1e40af;
}

.import-volume-item .volume-badge.existing {
  background: #e5e7eb;
  color: #4b5563;
}

.export-preview-modal {
  width: min(1100px, calc(100vw - 32px));
}
</style>
