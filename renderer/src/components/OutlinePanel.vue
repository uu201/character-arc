<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ChevronDown, FilePlus2, GripVertical, MoreVertical, Plus, Rows3, Sparkles, Trash2 } from 'lucide-vue-next'
import { NButton, NDropdown, NForm, NFormItem, NInput, NModal, NSelect, useDialog, useMessage } from 'naive-ui'
import { getChapterCharacterCount } from '@/features/chapters/editorContent'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { useAppStore } from '@/stores/app'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { formatVolumeLabel, normalizeVolumeWordTarget } from '@/features/workspace/outlineVolumes'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { DropdownOption, SelectOption } from 'naive-ui'
import type { OutlineItem, OutlineItemStatus, OutlineVolume } from '@/types/app'
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
const focusedOutlineId = ref<string>('')
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
        (async () => {
          // loadEnabledProjectSkillsContext 是 async 的，这里保留和原逻辑一致的入参构造顺序
          const projectSkills = await loadEnabledProjectSkillsContext(appStore.currentProject, 'outline')
          return window.characterArc.generateAi(toIpcPayload({
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
              characters: appStore.characters.map((character) => ({
                name: character.name,
                role: character.role,
                description: character.description
              })),
              currentVolumeOutlineItems: appStore.outlineItems
                .filter((item) => item.volumeId === volume.id)
                .map((item) => ({
                  title: item.title,
                  conflict: item.conflict,
                  summary: item.summary,
                  status: item.status
                })),
              projectSkills,
              userPrompt: '请优先扩写当前分卷从现有节点往后最需要的 3 到 5 个剧情子节点。'
            }
          }))
        })()
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
        wordTarget: entry.wordTarget ? String(Math.min(Number(entry.wordTarget.replace(/\D/g, '')) || 3000, 3500)) : undefined,
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

// --- 拖拽排序相关函数 ---
// 拖拽开始：记录被拖拽的大纲节点 ID
function handleDragStart(outlineId: string, event: DragEvent): void {
  draggingOutlineId.value = outlineId
  dragTargetOutlineId.value = outlineId

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', outlineId)
  }
}

// 拖拽经过：更新拖拽目标位置
function handleDragOver(outlineId: string, event: DragEvent): void {
  if (!draggingOutlineId.value || draggingOutlineId.value === outlineId) {
    return
  }

  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  dragTargetOutlineId.value = outlineId
}

// 拖拽放下：调用 store 执行大纲节点的排序移动
function handleDrop(outlineId: string, event: DragEvent): void {
  event.preventDefault()
  const sourceId = draggingOutlineId.value || event.dataTransfer?.getData('text/plain')

  if (!sourceId || sourceId === outlineId) {
    resetDragState()
    return
  }

  appStore.moveOutlineItem(sourceId, outlineId)
  resetDragState()
}

// 重置拖拽状态
function resetDragState(): void {
  draggingOutlineId.value = null
  dragTargetOutlineId.value = null
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

    enhanceItemFields.value = [
      { key: 'title', label: '节点标题', type: 'text', original: form.title, suggested: suggested.title ?? '', changed: (suggested.title ?? '') !== form.title && Boolean(suggested.title?.trim()) },
      { key: 'wordTarget', label: '预估字数', type: 'text', original: form.wordTarget, suggested: suggested.wordTarget ?? '', changed: (suggested.wordTarget ?? '') !== form.wordTarget && Boolean(suggested.wordTarget?.trim()) },
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
  if (accepted.wordTarget != null) form.wordTarget = accepted.wordTarget as string
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
        <button class="soft-button neutral" @click="openVolumeEditor()">
          <Rows3 :size="16" />
          <span>新增分卷</span>
        </button>
        <button class="soft-button" :disabled="isExpanding" @click="handleExpandOutline">
          <Sparkles :size="16" />
          <span>{{ isExpanding ? '扩写中...' : 'AI 扩写分卷' }}</span>
        </button>
      </div>
    </div>

    <!-- 时间线主体 -->
    <div v-if="filteredOutlineGroups.length" class="timeline">
      <template v-for="group in filteredOutlineGroups" :key="group.volume.id">
        <!-- 分卷标记 -->
        <div class="timeline-volume-marker">
          <button class="volume-marker-btn" @click="volumeCollapsed[group.volume.id] = !volumeCollapsed[group.volume.id]">
            <span class="volume-diamond" />
            <span class="volume-label">{{ formatVolumeLabel(group.volume, group.index, 'formal') }}</span>
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
              dragging: draggingOutlineId === item.id,
              'drop-target': dragTargetOutlineId === item.id && draggingOutlineId !== item.id,
              'assistant-focused': focusedOutlineId === item.id
            }"
            :data-assistant-focus-id="item.id"
            draggable="true"
            @dragstart="handleDragStart(item.id, $event)"
            @dragover="handleDragOver(item.id, $event)"
            @drop="handleDrop(item.id, $event)"
            @dragend="resetDragState"
          >
            <span class="timeline-dot" :class="resolveOutlineStatusMeta(item.status).tone" />
            <article class="timeline-card" @click="openEditor(item)">
              <div class="card-header">
                <GripVertical :size="13" class="card-grip" />
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

.soft-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

/* ── 时间线 ── */
.timeline {
  position: relative;
  padding: 8px 0 32px;
}

.timeline::before {
  content: '';
  position: absolute;
  left: 50%;
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
  transform: translateX(-50%);
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
  transition: box-shadow 0.2s, border-color 0.2s, background 0.2s;
}

.volume-marker-btn:hover {
  background: color-mix(in srgb, var(--arc-primary) 9%, var(--arc-bg-surface));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1), 0 0 0 4px color-mix(in srgb, var(--arc-primary) 10%, transparent);
  border-color: color-mix(in srgb, var(--arc-primary) 45%, var(--arc-border));
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
  width: 50%;
}

.timeline-node.left {
  align-self: flex-start;
  padding-right: 40px;
  justify-content: flex-end;
}

.timeline-node.right {
  align-self: flex-end;
  margin-left: 50%;
  padding-left: 40px;
  justify-content: flex-start;
}

.timeline-node.add-node {
  justify-content: flex-end;
  padding-right: 40px;
}

/* ── 轴线圆点 ── */
.timeline-dot {
  position: absolute;
  top: 20px;
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

.timeline-node.left .timeline-dot {
  right: -7px;
}

.timeline-node.right .timeline-dot {
  left: -7px;
}

.timeline-node.add-node .timeline-dot {
  right: -7px;
}

.timeline-dot.ghost { background: var(--arc-text-hint); }
.timeline-dot.neutral { background: #3b82f6; box-shadow: 0 0 0 2px color-mix(in srgb, #3b82f6 20%, var(--arc-border)); }
.timeline-dot.primary { background: #f59e0b; box-shadow: 0 0 0 2px color-mix(in srgb, #f59e0b 20%, var(--arc-border)); }
.timeline-dot.success { background: #10b981; box-shadow: 0 0 0 2px color-mix(in srgb, #10b981 20%, var(--arc-border)); }

/* ── 节点卡片 ── */
.timeline-card {
  flex: 1;
  max-width: 440px;
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

.timeline-node.drop-target .timeline-card {
  border-color: var(--arc-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 18%, transparent), 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.timeline-node.assistant-focused .timeline-card {
  border-color: color-mix(in srgb, var(--arc-accent) 78%, white 22%);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-accent) 18%, transparent), 0 20px 48px rgba(15, 23, 42, 0.14);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 11px;
}

.card-grip {
  color: var(--arc-text-hint);
  flex-shrink: 0;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.2s, color 0.2s;
}

.timeline-card:hover .card-grip {
  opacity: 0.7;
  color: var(--arc-text-secondary);
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

  .timeline-card {
    max-width: 380px;
  }
}

@media (max-width: 900px) {
  .outline-panel {
    padding: 0 16px;
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

  .timeline-card {
    max-width: none;
  }

  .timeline-volume-marker {
    align-items: flex-start;
    padding-left: 48px;
  }

  .volume-summary {
    display: none;
  }
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
