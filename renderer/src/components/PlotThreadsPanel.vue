<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { BookMarked, CheckCircle, Circle, MoreVertical, Plus } from 'lucide-vue-next'
import { NButton, NCheckbox, NDivider, NDynamicTags, NDropdown, NEmpty, NForm, NFormItem, NInput, NModal, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import type { DropdownOption } from 'naive-ui'
import type { PlotThread } from '@/types/app'
import { useIncrementalList } from '@/composables/useIncrementalList'
import { useBatchSelection } from '@/composables/useBatchSelection'
import BatchSelectionBar from './BatchSelectionBar.vue'

const props = defineProps<{
  searchQuery?: string
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

const editorVisible = ref(false)
const editingThreadId = ref<string | null>(null)
const form = reactive({
  title: '',
  description: '',
  openedInChapterId: '',
  closedInChapterId: '',
  status: 'open' as 'open' | 'resolved',
  tags: [] as string[]
})

// 按 open/resolved 分组过滤
const filteredThreads = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() ?? ''
  const threads = appStore.plotThreads
  if (!query) return threads
  return threads.filter((t) =>
    `${t.title} ${t.description} ${t.tags.join(' ')}`.toLowerCase().includes(query)
  )
})

const openThreads = computed(() => filteredThreads.value.filter((t) => t.status === 'open'))
const resolvedThreads = computed(() => filteredThreads.value.filter((t) => t.status === 'resolved'))
const threadResetKey = computed(() => props.searchQuery?.trim().toLowerCase() ?? '')
const visibleOpenThreads = useIncrementalList(openThreads, threadResetKey, { initialSize: 30, batchSize: 30 })
const visibleResolvedThreads = useIncrementalList(resolvedThreads, threadResetKey, { initialSize: 30, batchSize: 30 })
const threadSelection = useBatchSelection(computed(() => filteredThreads.value.map((item) => item.id)))
const isEditing = computed(() => Boolean(editingThreadId.value))

// 章节选项，用于关联哪章埋下/哪章收束
const chapterOptions = computed(() =>
  appStore.chapters.map((c) => ({ label: c.title || '未命名章节', value: c.id }))
)

const menuOptions: DropdownOption[] = [
  { key: 'edit', label: '编辑线索' },
  { key: 'toggle', label: '切换状态' },
  { key: 'delete', label: '删除线索' }
]

function openCreateEditor(): void {
  editingThreadId.value = null
  form.title = ''
  form.description = ''
  form.openedInChapterId = appStore.selectedChapterId ?? ''
  form.closedInChapterId = ''
  form.status = 'open'
  form.tags = []
  editorVisible.value = true
}

function openEditEditor(thread: PlotThread): void {
  editingThreadId.value = thread.id
  form.title = thread.title
  form.description = thread.description
  form.openedInChapterId = thread.openedInChapterId
  form.closedInChapterId = thread.closedInChapterId ?? ''
  form.status = thread.status
  form.tags = [...thread.tags]
  editorVisible.value = true
}

function handleMenuSelect(key: string, thread: PlotThread): void {
  if (key === 'edit') {
    openEditEditor(thread)
  } else if (key === 'toggle') {
    const nextStatus = thread.status === 'open' ? 'resolved' : 'open'
    appStore.updatePlotThread(thread.id, {
      status: nextStatus,
      closedInChapterId: nextStatus === 'resolved' ? (appStore.selectedChapterId ?? '') : undefined
    })
    message.success(nextStatus === 'resolved' ? '已标记为已收尾' : '已重新激活')
  } else if (key === 'delete') {
    dialog.warning({
      title: '删除线索',
      content: `确定删除"${thread.title}"？此操作无法撤销。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        appStore.deletePlotThread(thread.id)
        message.success('已删除')
      }
    })
  }
}

function handleThreadClick(thread: PlotThread): void {
  if (threadSelection.selectionMode.value) threadSelection.toggleSelection(thread.id)
}

function confirmBatchDeleteThreads(): void {
  const ids = [...threadSelection.selectedAvailableIds.value]
  if (!ids.length) return
  dialog.warning({
    title: '批量删除剧情线索',
    content: `确定删除选中的 ${ids.length} 条剧情线索吗？此操作无法撤销。`,
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: () => {
      ids.forEach((id) => appStore.deletePlotThread(id))
      threadSelection.finishSelection()
      message.success(`已删除 ${ids.length} 条剧情线索`)
    }
  })
}

function handleSave(): void {
  if (!form.title.trim()) {
    message.warning('请填写线索标题')
    return
  }

  if (editingThreadId.value) {
    appStore.updatePlotThread(editingThreadId.value, {
      title: form.title.trim(),
      description: form.description.trim(),
      openedInChapterId: form.openedInChapterId,
      closedInChapterId: form.status === 'resolved' ? form.closedInChapterId : undefined,
      status: form.status,
      tags: form.tags
    })
    message.success('已更新')
  } else {
    appStore.createPlotThread({
      title: form.title.trim(),
      description: form.description.trim(),
      openedInChapterId: form.openedInChapterId,
      status: 'open',
      tags: form.tags
    })
    message.success('已添加')
  }
  editorVisible.value = false
}

function chapterTitleById(id: string): string {
  return appStore.chapters.find((c) => c.id === id)?.title || id || '未知章节'
}

function formatTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '刚刚'
  return parsed.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="threads-panel arc-scrollbar">
    <!-- 顶部工具栏 -->
    <div class="panel-toolbar">
      <div class="toolbar-stats">
        <span class="stat-badge open">活跃 {{ openThreads.length }}</span>
        <span class="stat-badge resolved">已收尾 {{ resolvedThreads.length }}</span>
      </div>
      <n-button size="small" type="primary" @click="openCreateEditor">
        <template #icon><Plus :size="14" /></template>
        新建线索
      </n-button>
    </div>

    <BatchSelectionBar
      :active="threadSelection.selectionMode.value"
      :selected-count="threadSelection.selectedAvailableIds.value.length"
      :total-count="filteredThreads.length"
      :all-selected="threadSelection.allAvailableSelected.value"
      item-label="线索"
      @toggle="threadSelection.toggleSelectionMode"
      @select-all="threadSelection.toggleSelectAll"
      @clear="threadSelection.clearSelection"
      @delete="confirmBatchDeleteThreads"
    />

    <!-- 活跃线索 -->
    <div v-if="openThreads.length > 0" class="thread-group">
      <div class="group-label"><Circle :size="13" class="group-icon open-icon" /> 活跃伏笔</div>
      <div
        v-for="thread in visibleOpenThreads"
        :key="thread.id"
        class="thread-card"
        :class="{ selected: threadSelection.selectedIds.value.has(thread.id) }"
        @click="handleThreadClick(thread)"
      >
        <div class="thread-header">
          <n-checkbox
            v-if="threadSelection.selectionMode.value"
            :checked="threadSelection.selectedIds.value.has(thread.id)"
            @click.stop
            @update:checked="threadSelection.toggleSelection(thread.id)"
          />
          <div class="thread-title">{{ thread.title }}</div>
          <n-dropdown :options="menuOptions" @select="(key: string) => handleMenuSelect(key, thread)">
            <n-button text size="tiny" class="more-btn" @click.stop>
              <MoreVertical :size="14" />
            </n-button>
          </n-dropdown>
        </div>
        <div v-if="thread.description" class="thread-desc">{{ thread.description }}</div>
        <div class="thread-meta">
          <span v-if="thread.openedInChapterId" class="meta-item">
            埋入：{{ chapterTitleById(thread.openedInChapterId) }}
          </span>
          <span v-if="thread.tags.length" class="thread-tags">
            <n-tag
              v-for="tag in thread.tags"
              :key="tag"
              size="tiny"
              :bordered="false"
              class="tag-chip"
            >{{ tag }}</n-tag>
          </span>
          <span class="meta-time">{{ formatTime(thread.updatedAt) }}</span>
        </div>
      </div>
    </div>

    <!-- 已收尾线索 -->
    <div v-if="resolvedThreads.length > 0" class="thread-group resolved-group">
      <n-divider class="group-divider" />
      <div class="group-label"><CheckCircle :size="13" class="group-icon resolved-icon" /> 已收尾</div>
      <div
        v-for="thread in visibleResolvedThreads"
        :key="thread.id"
        class="thread-card resolved-card"
        :class="{ selected: threadSelection.selectedIds.value.has(thread.id) }"
        @click="handleThreadClick(thread)"
      >
        <div class="thread-header">
          <n-checkbox
            v-if="threadSelection.selectionMode.value"
            :checked="threadSelection.selectedIds.value.has(thread.id)"
            @click.stop
            @update:checked="threadSelection.toggleSelection(thread.id)"
          />
          <div class="thread-title resolved-title">{{ thread.title }}</div>
          <n-dropdown :options="menuOptions" @select="(key: string) => handleMenuSelect(key, thread)">
            <n-button text size="tiny" class="more-btn" @click.stop>
              <MoreVertical :size="14" />
            </n-button>
          </n-dropdown>
        </div>
        <div v-if="thread.description" class="thread-desc resolved-desc">{{ thread.description }}</div>
        <div class="thread-meta">
          <span v-if="thread.openedInChapterId" class="meta-item">
            埋入：{{ chapterTitleById(thread.openedInChapterId) }}
          </span>
          <span v-if="thread.closedInChapterId" class="meta-item">
            收尾：{{ chapterTitleById(thread.closedInChapterId) }}
          </span>
          <span class="meta-time">{{ formatTime(thread.updatedAt) }}</span>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="openThreads.length === 0 && resolvedThreads.length === 0" class="empty-state">
      <n-empty description="暂无剧情线索">
        <template #icon><BookMarked :size="32" class="empty-icon" /></template>
        <template #extra>
          <n-button size="small" @click="openCreateEditor">添加第一条线索</n-button>
        </template>
      </n-empty>
    </div>

    <!-- 新建/编辑弹窗 -->
    <n-modal
      v-model:show="editorVisible"
      preset="card"
      :title="isEditing ? '编辑线索' : '新建线索'"
      class="arc-editor-modal-wide"
      :mask-closable="false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top" :show-feedback="false" class="thread-form">
            <n-form-item label="线索标题" required>
              <n-input v-model:value="form.title" placeholder="如：林莫的穿越遗物" maxlength="60" show-count />
            </n-form-item>
            <n-form-item label="埋入章节">
              <n-select
                v-model:value="form.openedInChapterId"
                :options="chapterOptions"
                placeholder="选择埋入的章节"
                clearable
                filterable
              />
            </n-form-item>
            <n-form-item v-if="isEditing" label="状态">
              <n-select
                v-model:value="form.status"
                :options="[{ label: '活跃（未收尾）', value: 'open' }, { label: '已收尾', value: 'resolved' }]"
              />
            </n-form-item>
            <n-form-item v-if="form.status === 'resolved'" label="收尾章节">
              <n-select
                v-model:value="form.closedInChapterId"
                :options="chapterOptions"
                placeholder="选择收尾的章节"
                clearable
                filterable
              />
            </n-form-item>
            <n-form-item label="关联标签">
              <n-dynamic-tags v-model:value="form.tags" />
            </n-form-item>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">详细描述</div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="form.description"
              type="textarea"
              placeholder="描述这条伏笔的内容、背景或潜在影响"
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ form.description.length }} 字</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button @click="editorVisible = false">取消</n-button>
          <n-button type="primary" @click="handleSave">{{ isEditing ? '保存' : '添加' }}</n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.threads-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  gap: 8px;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}

.toolbar-stats {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--arc-radius-sm);
  border: 1px solid var(--arc-border);
  color: var(--arc-text-secondary);
  background: var(--arc-bg-body);
}

.stat-badge.open {
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
  border-color: color-mix(in srgb, var(--arc-primary) 24%, var(--arc-border));
}

.thread-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.resolved-group {
  margin-top: 4px;
}

.group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--arc-text-hint);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 4px 0 2px;
}

.group-icon {
  flex-shrink: 0;
}

.open-icon {
  color: var(--arc-primary);
}

.resolved-icon {
  color: var(--arc-success, #15803d);
}

.group-divider {
  margin: 4px 0 8px;
}

.thread-card {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: border-color 0.15s;
}

.thread-card:hover {
  border-color: var(--arc-border-strong);
}

.thread-card.selected {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
}

.resolved-card {
  opacity: 0.65;
  background: var(--arc-bg-body);
}

.thread-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.thread-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--arc-text-primary);
  line-height: 1.4;
  flex: 1;
}

.resolved-title {
  text-decoration: line-through;
  color: var(--arc-text-hint);
}

.more-btn {
  flex-shrink: 0;
  color: var(--arc-text-hint);
}

.thread-desc {
  font-size: 12px;
  color: var(--arc-text-secondary);
  line-height: 1.55;
}

.resolved-desc {
  color: var(--arc-text-hint);
}

.thread-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.meta-item {
  font-size: 11px;
  color: var(--arc-text-hint);
}

.thread-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag-chip {
  background: var(--arc-bg-body) !important;
  color: var(--arc-text-secondary);
  font-size: 10px;
}

.meta-time {
  font-size: 11px;
  color: var(--arc-text-hint);
  margin-left: auto;
}

.empty-state {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
}

.empty-icon {
  color: var(--arc-text-hint);
}

.thread-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
