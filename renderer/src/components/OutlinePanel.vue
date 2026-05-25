<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ChevronDown, FilePlus2, GripVertical, MoreVertical, Plus, Rows3, Sparkles } from 'lucide-vue-next'
import { NButton, NDropdown, NForm, NFormItem, NInput, NModal, NSelect, useDialog, useMessage } from 'naive-ui'
import { getChapterCharacterCount } from '@/features/chapters/editorContent'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { useAppStore } from '@/stores/app'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { DropdownOption, SelectOption } from 'naive-ui'
import type { OutlineItem, OutlineItemStatus, OutlineVolume } from '@/types/app'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))
const AI_TASK_EXPAND_ITEM = 'outline-item'
const AI_TASK_EXPAND_VOLUME_PREFIX = 'outline-volume:'
// 通过响应式注册表读取 loading 态，切换面板不会丢
const isExpanding = computed(() => appStore.isAiTaskRunning(AI_TASK_EXPAND_ITEM))
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

// 打开新建大纲节点弹窗，默认归属到指定分卷
function handleCreateOutline(volumeId = appStore.outlineVolumes[0]?.id): void {
  editingOutlineId.value = null
  form.volumeId = volumeId || appStore.outlineVolumes[0]?.id || ''
  form.title = ''
  form.wordTarget = '预估 3000字'
  form.conflict = ''
  form.summary = ''
  form.status = 'planned'
  editorVisible.value = true
}

// 调用 AI 接口自动扩写一个大纲节点，上下文包含已有大纲标题和世界观设定
async function handleExpandOutline(): Promise<void> {
  if (isExpanding.value) {
    return
  }

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: AI_TASK_EXPAND_ITEM,
        kind: 'outline',
        label: 'AI 扩写大纲',
        description: '正在补充一条剧情大纲节点',
        panel: 'outline',
        timeoutMs: 300_000
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'outline-item',
          settings: appStore.appSettings,
          context: {
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            outlineTitles: appStore.outlineItems.map((item) => item.title),
            worldviewTitles: appStore.worldviewEntries.map((entry) => entry.title)
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 扩写大纲失败，请检查模型配置')
    }

    const item = result.result as {
      title?: string
      wordTarget?: string
      conflict?: string
      summary?: string
    }

    const fallbackVolumeId = appStore.selectedChapterVolume?.id || appStore.outlineVolumes[0]?.id
    appStore.createOutlineItem({
      volumeId: fallbackVolumeId,
      title: item.title ?? `第${appStore.outlineItems.length + 1}章：新剧情节点`,
      wordTarget: item.wordTarget ?? '预估 3000字',
      conflict: item.conflict ?? '新的冲突正在酝酿。',
      summary: item.summary ?? 'AI 未返回有效剧情摘要',
      status: 'planned'
    })
    message.success('AI 已补充新的大纲节点')
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 扩写大纲失败，请检查模型配置')
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
        label: `AI 补全分卷·${volume.title}`,
        description: `正在为《${volume.title}》补充 3-5 个剧情节点`,
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
              userPrompt: '请优先补足当前分卷从现有节点往后最需要的 3 到 5 个剧情节点。'
            }
          }))
        })()
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? '分卷批量大纲生成失败，请检查模型配置')
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
        wordTarget: entry.wordTarget,
        conflict: entry.conflict,
        summary: entry.summary,
        status: 'planned'
      })
    })

    appStore.appendWorkflowDocumentEntry(
      volume.id,
      'task_plan',
      `分卷补全：${volume.title}`,
      [
        `- 已为当前分卷补充 ${entries.length} 个大纲节点。`,
        ...entries.map((entry, index) => `- 节点${index + 1}：${entry.title ?? `新节点 ${index + 1}`}`)
      ].join('\n')
    )
    appStore.appendWorkflowDocumentEntry(
      volume.id,
      'pending_hooks',
      `分卷补全后待观察钩子：${volume.title}`,
      entries.map((entry) => `- ${entry.title ?? '新节点'}：${entry.conflict ?? '待补充核心冲突'}`).join('\n')
    )

    message.success(`已为 ${volume.title} 补充 ${entries.length} 个大纲节点`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '分卷批量大纲生成失败，请稍后重试')
  }
}

// 打开大纲节点编辑弹窗
function openEditor(item?: OutlineItem): void {
  editingOutlineId.value = item?.id ?? null
  form.volumeId = item?.volumeId ?? appStore.outlineVolumes[0]?.id ?? ''
  form.title = item?.title ?? ''
  form.wordTarget = item?.wordTarget ?? '预估 3000字'
  form.conflict = item?.conflict ?? ''
  form.summary = item?.summary ?? ''
  form.status = item?.status ?? 'planned'
  editorVisible.value = true
}

// 打开分卷编辑弹窗
function openVolumeEditor(volume?: OutlineVolume): void {
  editingVolumeId.value = volume?.id ?? null
  volumeForm.title = volume?.title ?? ''
  volumeForm.wordTarget = volume?.wordTarget ?? '目标 5万字'
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

  if (editingOutlineId.value) {
    appStore.updateOutlineItem(editingOutlineId.value, form)
    message.success('大纲节点已更新')
  } else {
    appStore.createOutlineItem(form)
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
    appStore.updateOutlineVolume(editingVolumeId.value, volumeForm)
    message.success('分卷信息已更新')
  } else {
    appStore.createOutlineVolume(volumeForm)
    message.success('已新增分卷')
  }

  volumeEditorVisible.value = false
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
          <span>{{ isExpanding ? '扩写中...' : 'AI 扩写大纲' }}</span>
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
            <n-button size="small" secondary :disabled="isAnyVolumeExpanding" @click="handleExpandVolumeOutline(group.volume)">
              {{ isExpandingVolume(group.volume.id) ? '补全中...' : 'AI补本卷' }}
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
              'drop-target': dragTargetOutlineId === item.id && draggingOutlineId !== item.id
            }"
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
                <span v-if="item.wordTarget" class="card-word">{{ item.wordTarget }}</span>
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
      class="arc-editor-modal"
      :title="editingOutlineId ? '编辑大纲节点' : '新建大纲节点'"
      :bordered="false"
      @close="editorVisible = false"
    >
      <n-form label-placement="top">
        <n-form-item label="所属分卷">
          <n-select v-model:value="form.volumeId" :options="volumeOptions" placeholder="选择这一节点所在的分卷" />
        </n-form-item>
        <n-form-item label="节点标题">
          <n-input v-model:value="form.title" placeholder="例如：第4章：夜城回响" />
        </n-form-item>
        <n-form-item label="预估字数">
          <n-input v-model:value="form.wordTarget" placeholder="例如：预估 3200字" />
        </n-form-item>
        <n-form-item label="推进状态">
          <n-select v-model:value="form.status" :options="outlineStatusOptions" placeholder="选择当前节点所处阶段" />
        </n-form-item>
        <n-form-item label="核心冲突">
          <n-input v-model:value="form.conflict" placeholder="概括这一节点的核心矛盾..." />
        </n-form-item>
        <n-form-item label="剧情描述">
          <n-input
            v-model:value="form.summary"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 7 }"
            placeholder="补充这一节点如何推进剧情..."
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitOutline">
            {{ editingOutlineId ? '保存修改' : '创建节点' }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      :show="volumeEditorVisible"
      preset="card"
      class="arc-editor-modal"
      :title="editingVolumeId ? '编辑分卷' : '新建分卷'"
      :bordered="false"
      @close="volumeEditorVisible = false"
    >
      <n-form label-placement="top">
        <n-form-item label="分卷标题">
          <n-input v-model:value="volumeForm.title" placeholder="例如：霓虹下的老鼠" />
        </n-form-item>
        <n-form-item label="目标字数">
          <n-input v-model:value="volumeForm.wordTarget" placeholder="例如：目标 5万字" />
        </n-form-item>
        <n-form-item label="分卷摘要">
          <n-input
            v-model:value="volumeForm.summary"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            placeholder="概括这一卷的主线、冲突和情绪走向..."
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="volumeEditorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitVolume">
            {{ editingVolumeId ? '保存修改' : '创建分卷' }}
          </n-button>
        </div>
      </template>
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
  margin-bottom: 32px;
  padding: 16px 20px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
}

.progress-track {
  display: flex;
  height: 6px;
  border-radius: 999px;
  background: var(--arc-bg-surface-hover);
  overflow: hidden;
  gap: 1px;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.progress-fill.done { background: #10b981; }
.progress-fill.drafting { background: #f59e0b; }
.progress-fill.planned { background: #3b82f6; }

.progress-legend {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--arc-text-secondary);
  flex-wrap: wrap;
  align-items: center;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-item::before {
  content: '';
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-item.done::before { background: #10b981; }
.legend-item.drafting::before { background: #f59e0b; }
.legend-item.planned::before { background: #3b82f6; }
.legend-item.idea::before { background: var(--arc-text-hint); }

.legend-total {
  margin-left: auto;
  color: var(--arc-text-hint);
  font-weight: 600;
}

/* ── 标题区 ── */
.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 36px;
  gap: 20px;
  flex-wrap: wrap;
}

.section-kicker {
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.section-head h2 {
  margin: 6px 0;
  font-size: clamp(24px, 2.8vw, 32px);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--arc-text-primary);
}

.section-head p {
  max-width: 560px;
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.5;
}

.section-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
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
  padding: 24px 0;
}

.timeline::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--arc-border) 0%, color-mix(in srgb, var(--arc-primary) 20%, var(--arc-border)) 50%, var(--arc-border) 100%);
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
  margin: 40px 0 28px;
  gap: 10px;
}

.timeline-volume-marker:first-child {
  margin-top: 0;
}

.volume-marker-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 22px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  cursor: pointer;
  box-shadow: var(--arc-shadow-sm);
  transition: box-shadow 0.2s, border-color 0.2s;
}

.volume-marker-btn:hover {
  box-shadow: var(--arc-shadow-md);
  border-color: var(--arc-primary);
}

.volume-diamond {
  width: 10px;
  height: 10px;
  background: var(--arc-primary);
  transform: rotate(45deg);
  border-radius: 2px;
  flex-shrink: 0;
}

.volume-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--arc-text-primary);
}

.volume-summary {
  font-size: 12px;
  color: var(--arc-text-hint);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.volume-chevron {
  color: var(--arc-text-hint);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.volume-chevron.collapsed {
  transform: rotate(-90deg);
}

.volume-marker-actions {
  display: flex;
  gap: 6px;
}

/* ── 时间线节点 ── */
.timeline-node {
  position: relative;
  display: flex;
  align-items: flex-start;
  margin-bottom: 24px;
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
  padding: 16px 18px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  cursor: pointer;
  box-shadow: var(--arc-shadow-sm);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s, border-color 0.2s;
}

.timeline-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--arc-shadow-lg);
  border-color: color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
}

.timeline-node.dragging .timeline-card {
  opacity: 0.45;
  transform: scale(0.96);
}

.timeline-node.drop-target .timeline-card {
  border-color: var(--arc-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 15%, transparent);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.card-grip {
  color: var(--arc-text-hint);
  flex-shrink: 0;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.15s;
}

.timeline-card:hover .card-grip {
  opacity: 1;
}

.card-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s;
}

.timeline-card:hover .card-title {
  color: var(--arc-primary);
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  letter-spacing: 0.02em;
}

.status-pill.ghost { background: var(--arc-bg-surface-hover); color: var(--arc-text-hint); }
.status-pill.neutral { background: color-mix(in srgb, #3b82f6 12%, var(--arc-bg-surface)); color: #2563eb; }
.status-pill.primary { background: color-mix(in srgb, #f59e0b 12%, var(--arc-bg-surface)); color: #d97706; }
.status-pill.success { background: color-mix(in srgb, #10b981 12%, var(--arc-bg-surface)); color: #059669; }
.status-pill.chapter { border: 1px solid var(--arc-border); }

.card-word {
  font-size: 11px;
  color: var(--arc-text-hint);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.card-conflict {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-actions {
  display: flex;
  padding-top: 4px;
  border-top: 1px solid var(--arc-border);
  margin-top: 4px;
}

.more-button {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--arc-radius-sm);
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.more-button:hover {
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-primary);
}

/* ── 新增按钮 ── */
.timeline-add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: 1px dashed var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-text-hint);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.timeline-add-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 4%, transparent);
}

/* ── 响应式：窄屏退化为单侧 ── */
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
  }

  .volume-marker-actions {
    flex-wrap: wrap;
  }

  .progress-bar-section {
    padding: 12px 14px;
  }
}
</style>
