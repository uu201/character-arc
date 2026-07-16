<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { MoreVertical, Plus, Search, Sparkles } from 'lucide-vue-next'
import { NButton, NDropdown, NDynamicTags, NForm, NFormItem, NInput, NModal, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { useAppStore } from '@/stores/app'
import type { DropdownOption } from 'naive-ui'
import type { InspirationEntry } from '@/types/app'
import BatchGenerateDialog from './BatchGenerateDialog.vue'
import { normalizeCatalogTags, useCatalogBatch } from '@/composables/useCatalogBatch'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词
}>()

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))
const AI_TASK_KEY = 'catalog-batch:inspiration'
const isGenerating = computed(() => appStore.isAiTaskRunning(AI_TASK_KEY)) // 走全局注册表，跨面板保持状态
const batchVisible = ref(false)
const batchProgress = ref(0)
const keyword = ref('')
const typeFilter = ref<string | null>(null)
const sourceFilter = ref<'all' | 'ai' | 'manual'>('all')
const { generateCatalogBatch } = useCatalogBatch()
const editorVisible = ref(false) // 控制灵感编辑弹窗
const editingEntryId = ref<string | null>(null) // 当前编辑的灵感 ID，null 为新建
// 灵感编辑表单
const form = reactive({
  type: '场景火花',
  title: '',
  content: '',
  tags: [] as string[]
})

const focusTypes = ['标题灵感', '开篇钩子', '场景火花', '剧情转折', '设定补完', '人物动机', '伏笔'] // 灵感焦点类型列表
const batchTypeOptions = ['场景火花', '伏笔'].map((type) => ({ label: type, value: type }))
const typeOptions = computed(() =>
  [...new Set([...focusTypes, ...appStore.inspirationEntries.map((entry) => entry.type.trim()).filter(Boolean)])]
    .map((type) => ({ label: type, value: type }))
)
const menuOptions: DropdownOption[] = [ // 灵感卡片的下拉菜单选项
  { key: 'edit', label: '编辑灵感' },
  { key: 'delete', label: '删除灵感' }
]
// 当前选中章节的纯文本内容（用于 AI 生成灵感时提供上下文）
const selectedChapterText = computed(() =>
  getPlainTextFromEditorContent(appStore.selectedChapter?.content ?? '').trim()
)
// 根据搜索关键词过滤灵感列表，在类型、标题、内容和标签中匹配
const filteredEntries = computed(() => {
  const query = [props.searchQuery, keyword.value].filter(Boolean).join(' ').trim().toLowerCase()
  return appStore.inspirationEntries.filter((entry) => {
    const matchesType = !typeFilter.value || entry.type === typeFilter.value
    const matchesSource = sourceFilter.value === 'all' || entry.source === sourceFilter.value
    const matchesQuery = !query
      || `${entry.type} ${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase().includes(query)
    return matchesType && matchesSource && matchesQuery
  })
})
// AI 生成的灵感数量
const aiEntryCount = computed(() => appStore.inspirationEntries.filter((entry) => entry.source === 'ai').length)
// 手动记录的灵感数量
const manualEntryCount = computed(() => appStore.inspirationEntries.filter((entry) => entry.source === 'manual').length)
const isEditing = computed(() => Boolean(editingEntryId.value)) // 判断当前是编辑模式还是新建模式

// 格式化灵感卡片的更新时间为中文简短格式
function formatEntryMetaTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '刚刚更新'
  }

  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 打开新建灵感弹窗，type 默认为当前选中的焦点类型
function openCreateEditor(type = typeFilter.value ?? '场景火花'): void {
  editingEntryId.value = null
  form.type = type
  form.title = ''
  form.content = ''
  form.tags = []
  editorVisible.value = true
}

// 打开灵感编辑弹窗（编辑已有灵感或查看）
function openEditor(entry?: InspirationEntry): void {
  editingEntryId.value = entry?.id ?? null
  form.type = entry?.type ?? typeFilter.value ?? '场景火花'
  form.title = entry?.title ?? ''
  form.content = entry?.content ?? ''
  form.tags = [...(entry?.tags ?? [])]
  editorVisible.value = true
}

// 调用 AI 接口批量生成灵感卡片（根据选中的焦点类型和当前章节上下文）
async function handleGeneratePack(payload: { count: number; prompt: string; types: string[] }): Promise<void> {
  if (isGenerating.value) {
    return
  }

  try {
    batchProgress.value = 0
    const entries = await generateCatalogBatch({
      mode: 'inspiration',
      count: payload.count,
      label: '批量生成灵感',
      panel: 'inspiration',
      kind: 'inspiration',
      keyField: 'title',
      existingKeys: appStore.inspirationEntries.map((entry) => entry.title),
      onProgress: (completed, total) => { batchProgress.value = Math.round(completed / total * 100) },
      context: {
        projectTitle: appStore.currentProject?.title,
        projectGenre: appStore.currentProject?.genre,
        writingStyleLabel: writingStyle.value.label,
        writingStylePrompt: writingStyle.value.prompt,
        userPrompt: payload.prompt,
        requestedTypes: payload.types,
        chapterTitle: appStore.selectedChapter?.title,
        chapterSummary: appStore.selectedChapter?.summary,
        chapterContent: selectedChapterText.value,
        worldviewEntries: appStore.worldviewEntries,
        characters: appStore.characters,
        organizations: appStore.organizations,
        characterRelationships: appStore.characterRelationships,
        organizationMemberships: appStore.organizationMemberships,
        outlineItems: appStore.outlineItems
      }
    })
    entries.forEach((entry, index) => {
      appStore.createInspirationEntry({
        type: String(entry.type ?? payload.types[0] ?? typeFilter.value ?? '场景火花'),
        title: String(entry.title ?? `${payload.types[0] ?? typeFilter.value ?? '场景火花'} ${index + 1}`),
        content: String(entry.content ?? 'AI 未返回有效灵感内容'),
        tags: normalizeCatalogTags(entry.tags),
        source: 'ai'
      })
    })
    batchVisible.value = false
    message.success(`已生成 ${entries.length} 张灵感卡片`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 生成灵感失败，请稍后重试')
  }
}

// 提交灵感表单：校验必填项后根据编辑/新建模式保存，手动创建的灵感来源标记为 manual
function submitEntry(): void {
  if (!form.title.trim() || !form.content.trim()) {
    message.warning('请完整填写灵感标题和灵感内容')
    return
  }

  if (editingEntryId.value) {
    appStore.updateInspirationEntry(editingEntryId.value, form)
    message.success('灵感卡片已更新')
  } else {
    appStore.createInspirationEntry({
      ...form,
      source: 'manual'
    })
    message.success('已新增灵感卡片')
  }

  editorVisible.value = false
}

// 处理灵感卡片的下拉菜单操作：编辑或删除（删除前弹出二次确认）
function handleMenuSelect(action: string | number, entry: InspirationEntry): void {
  if (action === 'edit') {
    openEditor(entry)
    return
  }

  dialog.warning({
    title: '确认删除灵感',
    content: `确定要删除“${entry.title}”吗？删除后这张灵感卡片将无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteInspirationEntry(entry.id)
      message.success('灵感卡片已删除')
    }
  })
}
</script>

<template>
  <section class="inspiration-panel">
    <div class="section-head">
      <div class="section-title">
        <h2>灵感模块</h2>
      </div>
      <div class="head-actions">
        <n-button secondary strong :loading="isGenerating" @click="batchVisible = true">
          <template #icon><Sparkles :size="16" /></template>
          批量生成
        </n-button>
        <n-button type="primary" strong @click="openCreateEditor()">
          <template #icon><Plus :size="16" /></template>
          新建灵感
        </n-button>
      </div>
    </div>

    <div class="catalog-toolbar">
      <div class="catalog-filters">
        <n-input v-model:value="keyword" class="entry-search" placeholder="搜索标题、内容或标签" clearable>
          <template #prefix><Search :size="16" /></template>
        </n-input>
        <n-select
          v-model:value="typeFilter"
          class="type-filter"
          :options="typeOptions"
          placeholder="全部类型"
          clearable
          filterable
        />
        <div class="source-switch" role="group" aria-label="灵感来源筛选">
          <button type="button" :class="{ active: sourceFilter === 'all' }" @click="sourceFilter = 'all'">
            全部 <span>{{ appStore.inspirationEntries.length }}</span>
          </button>
          <button type="button" :class="{ active: sourceFilter === 'ai' }" @click="sourceFilter = 'ai'">
            AI <span>{{ aiEntryCount }}</span>
          </button>
          <button type="button" :class="{ active: sourceFilter === 'manual' }" @click="sourceFilter = 'manual'">
            手记 <span>{{ manualEntryCount }}</span>
          </button>
        </div>
      </div>
      <div class="result-summary">
        <strong>{{ filteredEntries.length }}</strong>
        <span>条结果</span>
      </div>
    </div>

    <BatchGenerateDialog
      :show="batchVisible"
      title="批量生成灵感"
      description="批量铺设可用于章节创作的场景火花和伏笔。"
      item-label="灵感"
      :loading="isGenerating"
      :progress="batchProgress"
      :type-options="batchTypeOptions"
      :default-types="typeFilter && batchTypeOptions.some((option) => option.value === typeFilter) ? [typeFilter] : ['场景火花', '伏笔']"
      @close="batchVisible = false"
      @submit="handleGeneratePack"
    />

    <div v-if="filteredEntries.length > 0" class="inspiration-grid">
      <article
        v-for="entry in filteredEntries"
        :key="entry.id"
        class="inspiration-card"
        @click="openEditor(entry)"
      >
        <div class="card-top">
          <div class="type-row">
            <span class="entry-type">{{ entry.type }}</span>
            <span class="entry-source" :class="entry.source">{{ entry.source === 'ai' ? 'AI 生成' : '手动记录' }}</span>
          </div>
          <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key) => handleMenuSelect(key, entry)">
            <button class="more-button" type="button" title="更多操作" aria-label="更多操作" @click.stop>
              <MoreVertical :size="16" />
            </button>
          </n-dropdown>
        </div>

        <h4>{{ entry.title }}</h4>
        <p :title="entry.content">{{ entry.content }}</p>

        <div v-if="entry.tags.length" class="tag-row">
          <n-tag v-for="tag in entry.tags.slice(0, 3)" :key="tag" size="small">
            {{ tag }}
          </n-tag>
          <span v-if="entry.tags.length > 3" class="tag-overflow">+{{ entry.tags.length - 3 }}</span>
        </div>

        <div class="card-footer">
          <span>更新于 {{ formatEntryMetaTime(entry.updatedAt) }}</span>
        </div>
      </article>
    </div>

    <div v-else class="arc-empty-state">
      {{ appStore.inspirationEntries.length === 0 ? '还没有灵感，先生成或手动记录一条。' : '没有匹配当前筛选条件的灵感。' }}
    </div>

    <n-modal
      :show="editorVisible"
      preset="card"
      class="arc-editor-modal-wide"
      :title="isEditing ? '编辑灵感卡片' : '新建灵感卡片'"
      :bordered="false"
      @close="editorVisible = false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top">
            <n-form-item label="灵感类型">
              <div class="modal-chip-row">
                <button
                  v-for="type in focusTypes"
                  :key="type"
                  type="button"
                  class="modal-chip"
                  :class="{ active: form.type === type }"
                  @click="form.type = type"
                >
                  {{ type }}
                </button>
              </div>
            </n-form-item>
            <n-form-item label="灵感标题">
              <n-input v-model:value="form.title" placeholder="例如：寒夜长街的第一次试探" />
            </n-form-item>
            <n-form-item label="灵感标签">
              <n-dynamic-tags v-model:value="form.tags" />
            </n-form-item>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">灵感内容</div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="form.content"
              type="textarea"
              placeholder="记录冲突、情绪、场景、台词或推进动作..."
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ form.content.length }} 字</span>
          <span>{{ form.tags.length }} 个标签</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitEntry">
            {{ isEditing ? '保存修改' : '创建卡片' }}
          </n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.inspiration-panel {
  max-width: 1180px;
  margin: 0 auto;
  min-width: 0;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 16px;
  flex-wrap: wrap;
}

.section-title h2 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.catalog-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-mix);
  padding: 10px;
}

.catalog-filters {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.entry-search {
  width: min(320px, 32vw);
}

.type-filter {
  width: 160px;
}

.source-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  padding: 3px;
}

.source-switch button {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--arc-text-secondary);
  padding: 5px 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.source-switch button span {
  color: var(--arc-text-hint);
  font-size: 11px;
}

.source-switch button.active {
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.source-switch button.active span {
  color: var(--arc-primary);
}

.result-summary {
  display: inline-flex;
  align-items: baseline;
  flex-shrink: 0;
  gap: 4px;
  color: var(--arc-text-hint);
  font-size: 12px;
  white-space: nowrap;
}

.result-summary strong {
  color: var(--arc-text-primary);
  font-size: 15px;
}

.inspiration-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: 12px;
}

.inspiration-card {
  position: relative;
  display: flex;
  min-height: 196px;
  flex-direction: column;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  padding: 14px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease;
}

.inspiration-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 2%, var(--arc-bg-surface));
}

.card-top,
.card-footer,
.type-row,
.tag-row {
  display: flex;
}

.card-top {
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.type-row {
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.entry-type,
.entry-source {
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  padding: 4px 7px;
  font-size: 12px;
  font-weight: 700;
}

.entry-type {
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.entry-source {
  background: var(--arc-bg-mix);
  color: var(--arc-text-secondary);
}

.entry-source.ai {
  background: color-mix(in srgb, #0369a1 14%, var(--arc-bg-surface));
  color: color-mix(in srgb, #0369a1 70%, var(--arc-text-primary));
}

.entry-source.manual {
  background: var(--arc-bg-mix);
  color: var(--arc-text-secondary);
}

.more-button {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
}

.more-button:hover {
  background: var(--arc-bg-mix);
  color: var(--arc-text-secondary);
}

.inspiration-card h4 {
  margin: 12px 0 7px;
  overflow: hidden;
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspiration-card p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.tag-row {
  min-height: 22px;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  margin-top: 10px;
  overflow: hidden;
}

.tag-row :deep(.n-tag) {
  max-width: 88px;
  flex-shrink: 1;
}

.tag-row :deep(.n-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-overflow {
  flex-shrink: 0;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.card-footer {
  margin-top: auto;
  padding-top: 12px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.modal-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.modal-chip {
  min-height: 34px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-mix);
  color: var(--arc-text-secondary);
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.modal-chip.active {
  border-color: color-mix(in srgb, var(--arc-primary) 34%, var(--arc-bg-mix));
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

@media (max-width: 980px) {
  .section-head {
    align-items: flex-start;
  }

  .head-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .catalog-toolbar {
    align-items: flex-end;
  }

  .catalog-filters {
    flex: 1;
    flex-wrap: wrap;
  }

  .entry-search {
    width: min(100%, 340px);
  }
}

@media (max-width: 720px) {
  .head-actions :deep(.n-button) {
    flex: 1 1 calc(50% - 6px);
  }

  .catalog-toolbar,
  .catalog-filters {
    align-items: stretch;
    flex-direction: column;
  }

  .entry-search,
  .type-filter {
    width: 100%;
  }

  .source-switch {
    align-self: flex-start;
  }

  .result-summary {
    align-self: flex-end;
  }

  .inspiration-grid {
    grid-template-columns: 1fr;
  }
}
</style>
