<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { FilePlus2, GripVertical, MoreVertical, Plus, Rows3, Sparkles } from 'lucide-vue-next'
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
const isExpanding = ref(false) // AI 扩写大纲时的加载状态
const expandingVolumeId = ref<string | null>(null)
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

  isExpanding.value = true

  try {
    const result = await window.characterArc.generateAi(toIpcPayload({
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
  } finally {
    isExpanding.value = false
  }
}

async function handleExpandVolumeOutline(volume: OutlineVolume): Promise<void> {
  if (expandingVolumeId.value) {
    return
  }

  expandingVolumeId.value = volume.id

  try {
    const result = await window.characterArc.generateAi(toIpcPayload({
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
        projectSkills: await loadEnabledProjectSkillsContext(appStore.currentProject, 'outline'),
        userPrompt: '请优先补足当前分卷从现有节点往后最需要的 3 到 5 个剧情节点。'
      }
    }))

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
  } finally {
    expandingVolumeId.value = null
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
    content: `确定要删除“${item.title}”吗？删除后该大纲节点将无法恢复。`,
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

    <div class="outline-summary">
      <span>{{ appStore.outlineVolumes.length }} 个分卷</span>
      <span>{{ totalVisibleItems }} 个剧情节点</span>
      <span>{{ props.searchQuery ? `搜索：${props.searchQuery}` : '支持按卷管理与章节规划' }}</span>
    </div>

    <div v-if="filteredOutlineGroups.length" class="outline-groups">
      <section v-for="group in filteredOutlineGroups" :key="group.volume.id" class="volume-section">
        <div class="volume-header">
          <div class="volume-copy">
            <span class="volume-kicker">{{ group.volume.wordTarget }}</span>
            <h3>{{ formatVolumeLabel(group.volume, group.index, 'formal') }}</h3>
            <p>{{ group.volume.summary }}</p>
          </div>
          <div class="volume-actions">
            <n-button round secondary strong @click="openVolumeEditor(group.volume)">编辑分卷</n-button>
            <n-button
              round
              strong
              secondary
              :disabled="Boolean(expandingVolumeId)"
              @click="handleExpandVolumeOutline(group.volume)"
            >
              {{ expandingVolumeId === group.volume.id ? '补全中...' : 'AI补本卷' }}
            </n-button>
            <n-button round type="primary" strong @click="handleCreateOutline(group.volume.id)">新增节点</n-button>
          </div>
        </div>

        <div class="outline-list">
          <article
            v-for="item in group.items"
            :key="item.id"
            class="outline-item"
            :class="{
              dragging: draggingOutlineId === item.id,
              'drop-target': dragTargetOutlineId === item.id && draggingOutlineId !== item.id
            }"
            draggable="true"
            @click="openEditor(item)"
            @dragstart="handleDragStart(item.id, $event)"
            @dragover="handleDragOver(item.id, $event)"
            @drop="handleDrop(item.id, $event)"
            @dragend="resetDragState"
          >
            <div class="outline-header">
              <div class="outline-title-row">
                <span class="outline-grip" aria-hidden="true">
                  <GripVertical :size="14" />
                </span>
                <div class="outline-title-copy">
                  <span class="outline-title">{{ item.title }}</span>
                  <div class="outline-meta-row">
                    <span class="outline-status-pill" :class="resolveOutlineStatusMeta(item.status).tone">
                      {{ resolveOutlineStatusMeta(item.status).label }}
                    </span>
                    <span class="outline-status-pill chapter" :class="resolveLinkedChapterMeta(item).tone">
                      {{ resolveLinkedChapterMeta(item).label }}
                    </span>
                  </div>
                  <div v-if="resolveLinkedChapter(item)" class="outline-progress-row">
                    <span class="outline-progress-copy">
                      实际 {{ resolveLinkedChapterProgress(item).actual }} 字
                      <template v-if="resolveLinkedChapterProgress(item).target">
                        / 目标 {{ resolveLinkedChapterProgress(item).target }} 字
                      </template>
                    </span>
                    <span class="outline-progress-copy emphasis">
                      {{ resolveLinkedChapterProgress(item).target ? `${resolveLinkedChapterProgress(item).percent}%` : '自由字数' }}
                    </span>
                    <span v-if="resolveLinkedChapterProgress(item).target" class="outline-progress-track">
                      <span :style="{ width: `${resolveLinkedChapterProgress(item).percent}%` }"></span>
                    </span>
                  </div>
                </div>
              </div>
              <div class="outline-actions">
                <n-button tertiary size="small" @click.stop="openLinkedChapter(item)">
                  <template #icon>
                    <FilePlus2 :size="14" />
                  </template>
                  {{ resolveLinkedChapter(item) ? '打开章节' : '创建章节' }}
                </n-button>
                <span class="outline-word">{{ item.wordTarget }}</span>
                <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key) => handleMenuSelect(key, item)">
                  <button class="more-button" @click.stop>
                    <MoreVertical :size="14" />
                  </button>
                </n-dropdown>
              </div>
            </div>
            <div class="outline-desc">
              <b>核心冲突：</b>{{ item.conflict }}<br />
              <b>剧情：</b>{{ item.summary }}
            </div>
          </article>

          <button v-if="!props.searchQuery" class="outline-add" @click="handleCreateOutline(group.volume.id)">
            <Plus :size="16" />
            <span>在本卷中新增章节节点</span>
          </button>
        </div>
      </section>
    </div>

    <div v-else class="arc-empty-state">没有匹配“{{ props.searchQuery }}”的大纲节点。</div>

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
  max-width: 1040px;
  margin: 0 auto;
}

.section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  margin-bottom: 18px;
  gap: 16px;
  flex-wrap: wrap;
}

.section-kicker {
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
}

.section-head h2 {
  margin: 8px 0;
  font-size: clamp(30px, 3.4vw, 38px);
  font-weight: 650;
  letter-spacing: -0.04em;
}

.section-head p {
  max-width: 660px;
  margin: 0;
  color: #86868b;
  font-size: 15px;
}

.section-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.soft-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-mix));
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 14px;
  font-weight: 650;
  padding: 12px 18px;
}

.soft-button.neutral {
  background: #f5f5f7;
  color: #1d1d1f;
}

.soft-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.outline-summary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}

.outline-summary span {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding: 9px 14px;
}

.outline-groups {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.volume-section {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  padding: 22px;
}

.volume-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--arc-border);
}

.volume-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.volume-kicker {
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.volume-copy h3 {
  margin: 0;
  color: #111827;
  font-size: clamp(22px, 2.6vw, 28px);
  font-weight: 650;
  letter-spacing: -0.03em;
}

.volume-copy p {
  max-width: 720px;
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.75;
}

.volume-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.outline-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.outline-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.03);
  padding: 16px 20px;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.outline-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.05);
}

.outline-item.dragging {
  opacity: 0.56;
}

.outline-item.drop-target {
  border-color: color-mix(in srgb, var(--arc-primary) 26%, var(--arc-bg-mix));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent);
}

.outline-item:hover .outline-title {
  color: var(--arc-primary);
}

.outline-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
  font-weight: 600;
}

.outline-title {
  flex: 1;
}

.outline-title-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
}

.outline-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.outline-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.outline-progress-row {
  display: grid;
  grid-template-columns: auto auto minmax(120px, 1fr);
  align-items: center;
  gap: 10px;
}

.outline-progress-copy {
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.outline-progress-copy.emphasis {
  color: var(--arc-text-primary);
  font-weight: 800;
}

.outline-progress-track {
  display: inline-flex;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--arc-border);
}

.outline-progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #93c5fd 0%, #2563eb 100%);
}

.outline-status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  padding: 5px 9px;
}

.outline-status-pill.ghost {
  background: rgba(241, 245, 249, 0.96);
  color: var(--arc-text-hint);
}

.outline-status-pill.neutral {
  background: rgba(219, 234, 254, 0.9);
  color: #1d4ed8;
}

.outline-status-pill.primary {
  background: rgba(219, 234, 254, 0.98);
  color: #2563eb;
}

.outline-status-pill.warning {
  background: rgba(254, 243, 199, 0.95);
  color: #b45309;
}

.outline-status-pill.success {
  background: rgba(220, 252, 231, 0.96);
  color: #15803d;
}

.outline-status-pill.chapter {
  border: 1px solid var(--arc-border);
}

.outline-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #c4cad4;
  flex-shrink: 0;
}

.outline-item:hover .outline-grip {
  color: #94a3b8;
}

.outline-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.outline-word {
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 400;
}

.more-button {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #c4cad4;
  cursor: pointer;
}

.more-button:hover {
  background: rgba(0, 0, 0, 0.04);
  color: #6b7280;
}

.outline-desc {
  border-radius: var(--arc-radius-sm);
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
  padding: 12px;
}

.outline-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  border: 1px dashed var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 14px;
  padding: 18px 20px;
}

@media (max-width: 860px) {
  .volume-header {
    flex-direction: column;
  }
}

@media (max-width: 760px) {
  .section-actions,
  .volume-actions {
    width: 100%;
  }

  .soft-button,
  .volume-actions :deep(.n-button) {
    width: 100%;
    justify-content: center;
  }

  .outline-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
