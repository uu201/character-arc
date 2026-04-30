<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { FilePlus2, GripVertical, MoreVertical, Plus, Rows3, Sparkles } from 'lucide-vue-next'
import { NButton, NDropdown, NForm, NFormItem, NInput, NModal, NSelect, useDialog, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import type { DropdownOption, SelectOption } from 'naive-ui'
import type { OutlineItem, OutlineVolume } from '@/types/app'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))
const isExpanding = ref(false) // AI 扩写大纲时的加载状态
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
  summary: ''
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
  editorVisible.value = true
}

// 调用 AI 接口自动扩写一个大纲节点，上下文包含已有大纲标题和世界观设定
async function handleExpandOutline(): Promise<void> {
  if (isExpanding.value) {
    return
  }

  isExpanding.value = true

  try {
    const result = await window.characterArc.generateAi({
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
    })

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
      summary: item.summary ?? 'AI 未返回有效剧情摘要'
    })
    message.success('AI 已补充新的大纲节点')
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 扩写大纲失败，请检查模型配置')
  } finally {
    isExpanding.value = false
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
  message.success('已根据大纲节点创建章节草稿')
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
                <span class="outline-title">{{ item.title }}</span>
              </div>
              <div class="outline-actions">
                <n-button tertiary size="small" @click.stop="handleCreateChapterFromOutline(item)">
                  <template #icon>
                    <FilePlus2 :size="14" />
                  </template>
                  创建章节
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
  color: color-mix(in srgb, var(--arc-primary) 74%, white);
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
  background: color-mix(in srgb, var(--arc-primary) 12%, white);
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
  background: rgba(248, 250, 252, 0.9);
  color: #64748b;
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
  border: 1px solid rgba(226, 232, 240, 0.76);
  border-radius: 30px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.92)),
    radial-gradient(circle at top left, color-mix(in srgb, var(--arc-primary) 8%, white), transparent 38%);
  padding: 22px;
}

.volume-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.72);
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
  color: #64748b;
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
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 20px;
  background: white;
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
  border-color: color-mix(in srgb, var(--arc-primary) 26%, white);
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

.outline-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  flex: 1;
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
