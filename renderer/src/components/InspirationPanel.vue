<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Lightbulb, MoreVertical, Plus, Send, Sparkles, WandSparkles } from 'lucide-vue-next'
import { NButton, NDropdown, NDynamicTags, NForm, NFormItem, NInput, NModal, NTag, useDialog, useMessage } from 'naive-ui'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { DropdownOption } from 'naive-ui'
import type { InspirationEntry } from '@/types/app'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词
}>()

// AI 批量生成灵感时的返回结构类型
type InspirationPackResult = {
  entries?: Array<{
    type?: string
    title?: string
    content?: string
    tags?: string[]
  }>
}

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))
const AI_TASK_KEY = 'inspiration-pack'
const isGenerating = computed(() => appStore.isAiTaskRunning(AI_TASK_KEY)) // 走全局注册表，跨面板保持状态
const editorVisible = ref(false) // 控制灵感编辑弹窗
const editingEntryId = ref<string | null>(null) // 当前编辑的灵感 ID，null 为新建
const selectedFocus = ref('场景火花') // 当前选中的灵感焦点类型
// 灵感编辑表单
const form = reactive({
  type: '场景火花',
  title: '',
  content: '',
  tags: [] as string[]
})

const focusTypes = ['标题灵感', '开篇钩子', '场景火花', '剧情转折', '设定补完', '人物动机'] // 灵感焦点类型列表
const menuOptions: DropdownOption[] = [ // 灵感卡片的下拉菜单选项
  { key: 'expand', label: '发送给 AI 助手' },
  { key: 'edit', label: '编辑灵感' },
  { key: 'delete', label: '删除灵感' }
]
// 当前选中章节的纯文本内容（用于 AI 生成灵感时提供上下文）
const selectedChapterText = computed(() =>
  getPlainTextFromEditorContent(appStore.selectedChapter?.content ?? '').trim()
)
// 根据搜索关键词过滤灵感列表，在类型、标题、内容和标签中匹配
const filteredEntries = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() ?? ''
  const entries = appStore.inspirationEntries

  if (!query) {
    return entries
  }

  return entries.filter((entry) =>
    `${entry.type} ${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase().includes(query)
  )
})
// 统计每种焦点类型的灵感数量（用于焦点选择器旁的徽标）
const focusCounts = computed(() =>
  Object.fromEntries(focusTypes.map((type) => [type, appStore.inspirationEntries.filter((entry) => entry.type === type).length]))
)
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
function openCreateEditor(type = selectedFocus.value): void {
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
  form.type = entry?.type ?? selectedFocus.value
  form.title = entry?.title ?? ''
  form.content = entry?.content ?? ''
  form.tags = [...(entry?.tags ?? [])]
  editorVisible.value = true
}

// 调用 AI 接口批量生成灵感卡片（根据选中的焦点类型和当前章节上下文）
async function handleGeneratePack(): Promise<void> {
  if (isGenerating.value) {
    return
  }

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: AI_TASK_KEY,
        kind: 'inspiration',
        label: 'AI 生成灵感',
        description: `正在生成「${selectedFocus.value}」主题的灵感卡片`,
        panel: 'inspiration'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'inspiration-pack',
          settings: appStore.appSettings,
          context: {
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            chapterTitle: appStore.selectedChapter?.title,
            chapterSummary: appStore.selectedChapter?.summary,
            chapterContent: selectedChapterText.value,
            focusType: selectedFocus.value,
            existingInspirationTitles: appStore.inspirationEntries.map((entry) => entry.title),
            worldviewEntries: appStore.worldviewEntries,
            characters: appStore.characters,
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            outlineItems: appStore.outlineItems
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 生成灵感失败，请检查模型配置')
    }

    const payload = result.result as InspirationPackResult
    const entries = Array.isArray(payload.entries) ? payload.entries : []
    if (!entries.length) {
      throw new Error('AI 没有返回有效灵感卡片')
    }

    entries.forEach((entry, index) => {
      appStore.createInspirationEntry({
        type: entry.type ?? selectedFocus.value,
        title: entry.title ?? `${selectedFocus.value} ${index + 1}`,
        content: entry.content ?? 'AI 未返回有效灵感内容',
        tags: entry.tags ?? [],
        source: 'ai'
      })
    })

    message.success(`已生成 ${entries.length} 张${selectedFocus.value}灵感卡片`)
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

// 将灵感卡片发送给 AI 助手进行扩写，构建包含灵感内容和当前章节上下文的 prompt
function expandEntryToAssistant(entry: InspirationEntry): void {
  appStore.queueAssistantPrompt(
    `请基于这张灵感卡片，为当前章节工作台继续展开成可直接使用的创作内容。优先给出贴合当前章节的桥段、台词、推进动作或场景描写。\n\n灵感类型：${entry.type}\n灵感标题：${entry.title}\n灵感内容：${entry.content}\n灵感标签：${entry.tags.join('、') || '暂无'}\n当前章节：${appStore.selectedChapter?.title ?? '暂无'}\n当前章节摘要：${appStore.selectedChapter?.summary ?? '暂无'}`,
    '灵感扩写'
  )
  message.success('灵感卡片已发送给 AI 助手继续扩写')
}

// 处理灵感卡片的下拉菜单操作：发送给 AI 助手、编辑或删除（删除前弹出二次确认）
function handleMenuSelect(action: string | number, entry: InspirationEntry): void {
  if (action === 'expand') {
    expandEntryToAssistant(entry)
    return
  }

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
      <div>
        <h2>灵感模块</h2>
        <p>沉淀标题、钩子、桥段与转折，把零散火花收束成可继续创作的卡片。</p>
      </div>
      <div class="head-actions">
        <button class="soft-button" :disabled="isGenerating" @click="handleGeneratePack">
          <Sparkles :size="16" />
          <span>{{ isGenerating ? '生成中...' : `AI 生成${selectedFocus}` }}</span>
        </button>
        <button class="primary-button" @click="openCreateEditor()">
          <Plus :size="16" />
          <span>新建灵感</span>
        </button>
      </div>
    </div>

    <section class="hero-shell">
      <div class="hero-copy">
        <div class="focus-row">
          <button
            v-for="type in focusTypes"
            :key="type"
            type="button"
            class="focus-chip"
            :class="{ active: selectedFocus === type }"
            @click="selectedFocus = type"
          >
            <span>{{ type }}</span>
            <small>{{ focusCounts[type] ?? 0 }}</small>
          </button>
        </div>
      </div>

      <div class="hero-stats">
        <article class="stat-card">
          <span>灵感总数</span>
          <strong>{{ appStore.inspirationEntries.length }}</strong>
          <small>持续沉淀可复用素材</small>
        </article>
        <article class="stat-card">
          <span>AI 生成</span>
          <strong>{{ aiEntryCount }}</strong>
          <small>适合快速铺量</small>
        </article>
        <article class="stat-card">
          <span>手动记录</span>
          <strong>{{ manualEntryCount }}</strong>
          <small>保留即时灵感</small>
        </article>
      </div>
    </section>

    <div v-if="filteredEntries.length > 0" class="inspiration-grid">
      <article
        v-for="(entry, index) in filteredEntries"
        :key="entry.id"
        class="inspiration-card"
        :style="{ animationDelay: `${index * 60}ms` }"
        @click="openEditor(entry)"
      >
        <div class="card-top">
          <div class="type-row">
            <span class="entry-type">{{ entry.type }}</span>
            <span class="entry-source" :class="entry.source">{{ entry.source === 'ai' ? 'AI' : '手记' }}</span>
          </div>
          <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key) => handleMenuSelect(key, entry)">
            <button class="more-button" @click.stop>
              <MoreVertical :size="14" />
            </button>
          </n-dropdown>
        </div>

        <h4>{{ entry.title }}</h4>
        <p>{{ entry.content }}</p>

        <div v-if="entry.tags.length" class="tag-row">
          <n-tag v-for="tag in entry.tags" :key="tag" size="small" round>
            {{ tag }}
          </n-tag>
        </div>

        <div class="card-footer">
          <span>更新于 {{ formatEntryMetaTime(entry.updatedAt) }}</span>
          <button class="link-button" @click.stop="expandEntryToAssistant(entry)">
            <Send :size="14" />
            <span>发给 AI 助手</span>
          </button>
        </div>
      </article>

      <button v-if="!props.searchQuery" class="empty-card" @click="openCreateEditor(selectedFocus)">
        <Lightbulb :size="28" />
        <span>补一张灵感卡片</span>
      </button>
    </div>

    <div v-else class="arc-empty-state">
      {{ props.searchQuery ? `没有匹配“${props.searchQuery}”的灵感卡片。` : '还没有灵感卡片，先生成或手动记录一张吧。' }}
    </div>

    <n-modal
      :show="editorVisible"
      preset="card"
      class="arc-editor-modal"
      :title="isEditing ? '编辑灵感卡片' : '新建灵感卡片'"
      :bordered="false"
      @close="editorVisible = false"
    >
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
        <n-form-item label="灵感内容">
          <n-input
            v-model:value="form.content"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 8 }"
            placeholder="记录冲突、情绪、场景、台词或推进动作..."
          />
        </n-form-item>
        <n-form-item label="灵感标签">
          <n-dynamic-tags v-model:value="form.tags" />
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitEntry">
            {{ isEditing ? '保存修改' : '创建卡片' }}
          </n-button>
        </div>
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
  align-items: end;
  justify-content: space-between;
  margin-bottom: 28px;
  gap: 16px;
  flex-wrap: wrap;
}

.section-head h2 {
  margin: 0 0 8px;
  color: var(--arc-text-primary);
  font-size: clamp(30px, 3.4vw, 38px);
  font-weight: 650;
  letter-spacing: -0.04em;
}

.section-head p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 15px;
}

.head-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.soft-button,
.primary-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 650;
  padding: 12px 18px;
  transition:
    transform 0.22s ease,
    background 0.22s ease,
    box-shadow 0.22s ease,
    opacity 0.22s ease;
}

.soft-button:disabled,
.primary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.soft-button {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
  border: 1px solid var(--arc-border);
}

.soft-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    inset 0 0 0 1px rgba(147, 197, 253, 1),
    0 10px 24px rgba(59, 130, 246, 0.08);
}

.primary-button {
  background: var(--arc-primary);
  color: white;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--arc-primary) 22%, transparent);
}

.primary-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 18px 38px color-mix(in srgb, var(--arc-primary) 28%, transparent);
}

.hero-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
  gap: 18px;
  margin-bottom: 24px;
}

.hero-copy,
.hero-stats {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.04);
}

.hero-copy {
  padding: clamp(22px, 2.3vw, 28px);
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
  margin-bottom: 16px;
}

.hero-copy h3 {
  margin: 0 0 12px;
  color: var(--arc-text-primary);
  font-size: clamp(26px, 3.1vw, 34px);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1.15;
}

.hero-copy p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 15px;
  line-height: 1.75;
}

.focus-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.focus-chip {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  padding: 10px 14px;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}

.focus-chip small {
  display: inline-flex;
  min-width: 22px;
  justify-content: center;
  border-radius: 999px;
  background: var(--arc-glass-08);
  color: var(--arc-text-secondary);
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 700;
}

.focus-chip.active {
  border-color: color-mix(in srgb, var(--arc-primary) 36%, var(--arc-bg-mix));
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
  box-shadow: 0 10px 26px rgba(59, 130, 246, 0.1);
}

.focus-chip.active small {
  background: rgba(219, 234, 254, 0.95);
  color: var(--arc-primary);
}

.focus-chip:hover {
  transform: translateY(-1px);
}

.hero-stats {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.stat-card {
  border-radius: 10px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  padding: 18px 18px 16px;
}

.stat-card span,
.stat-card small {
  display: block;
}

.stat-card span {
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.stat-card strong {
  display: block;
  margin: 8px 0 6px;
  color: var(--arc-text-primary);
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
}

.stat-card small {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.inspiration-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
}

.inspiration-card,
.empty-card {
  position: relative;
  display: flex;
  min-height: 280px;
  flex-direction: column;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  padding: 18px 18px 16px;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.04);
  transition:
    transform 0.24s ease,
    box-shadow 0.24s ease,
    border-color 0.24s ease;
}

.inspiration-card {
  cursor: pointer;
  animation: float-up 0.42s ease both;
}

.inspiration-card:hover,
.empty-card:hover {
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--arc-primary) 22%, var(--arc-border));
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.07);
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
  border-radius: 999px;
  padding: 6px 10px;
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

.more-button,
.link-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
}

.more-button {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
}

.more-button:hover {
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.inspiration-card h4 {
  margin: 16px 0 10px;
  color: var(--arc-text-primary);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.25;
}

.inspiration-card p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.8;
}

.tag-row {
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.card-footer {
  margin-top: auto;
  padding-top: 18px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.link-button {
  gap: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
}

.link-button:hover {
  background: rgba(219, 234, 254, 0.98);
}

.empty-card {
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--arc-text-secondary);
  border-style: dashed;
  cursor: pointer;
}

.modal-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.modal-chip {
  min-height: 40px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-mix);
  color: var(--arc-text-secondary);
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.modal-chip.active {
  border-color: color-mix(in srgb, var(--arc-primary) 34%, var(--arc-bg-mix));
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

@keyframes float-up {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1040px) {
  .hero-shell {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .section-head {
    align-items: stretch;
  }

  .head-actions {
    width: 100%;
    justify-content: stretch;
  }

  .head-actions > button {
    flex: 1;
    justify-content: center;
  }

  .inspiration-grid {
    grid-template-columns: 1fr;
  }

  .card-footer {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
