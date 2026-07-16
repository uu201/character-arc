<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { MoreVertical, Network, Plus, Search, Sparkles } from 'lucide-vue-next'
import { NButton, NDropdown, NDynamicTags, NForm, NFormItem, NInput, NModal, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { resolveAccentColor, resolveReadableTextColor } from '@/features/relations/graph'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { CharacterCard } from '@/types/app'
import type { DropdownOption } from 'naive-ui'
import AiEnhancePreview from './AiEnhancePreview.vue'
import BatchGenerateDialog from './BatchGenerateDialog.vue'
import type { EnhanceFieldDiff } from './AiEnhancePreview.vue'
import { normalizeCatalogTags, useCatalogBatch } from '@/composables/useCatalogBatch'

const appStore = useAppStore()
const dialog = useDialog()
const keyword = ref('') // 本面板内的本地搜索关键词
const roleFilter = ref<string | null>(null)
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词，由父组件传入
}>()

const roleOptions = computed(() =>
  [...new Set(appStore.characters.map((character) => character.role.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((role) => ({ label: role, value: role }))
)

// 合并本地搜索框和全局工作区搜索关键词，对角色列表进行过滤
// 在角色名、角色定位和简介中做全文匹配
const filteredCharacters = computed(() => {
  // Combine the local search box with the global workspace search for a simple, predictable filter model.
  const mergedQuery = [props.searchQuery, keyword.value].filter(Boolean).join(' ').trim().toLowerCase()
  return appStore.characters.filter((character) => {
    const matchesRole = !roleFilter.value || character.role.trim() === roleFilter.value
    const haystack = [character.name, character.role, character.description, ...character.tags.map((tag) => tag.label)]
      .join(' ')
      .toLowerCase()
    return matchesRole && (!mergedQuery || haystack.includes(mergedQuery))
  })
})
const message = useMessage()
const AI_TASK_KEY = 'catalog-batch:character'
const isGenerating = computed(() => appStore.isAiTaskRunning(AI_TASK_KEY)) // AI 生成角色时的加载状态（走全局注册表）
const batchVisible = ref(false)
const batchProgress = ref(0)
const { generateCatalogBatch } = useCatalogBatch()
const editorVisible = ref(false) // 控制角色编辑弹窗的显示
const editingCharacterId = ref<string | null>(null) // 当前正在编辑的角色 ID，null 表示新建模式
const focusedCharacterId = ref<string>('')
// 角色编辑表单数据
const form = reactive({
  name: '',
  role: '',
  description: '',
  tags: [] as string[]
})
// 角色卡片的右键菜单选项
const menuOptions: DropdownOption[] = [
  { key: 'edit', label: '编辑角色' },
  { key: 'delete', label: '删除角色' }
]

function avatarStyle(avatar: string, seed: string): { background: string, color: string } {
  const accent = resolveAccentColor(avatar, seed)
  return {
    background: avatar?.trim() ? avatar : accent,
    color: resolveReadableTextColor(accent)
  }
}

function tagType(tone?: 'default' | 'danger' | 'success' | 'warning'): 'default' | 'error' | 'success' | 'warning' {
  switch (tone) {
    case 'danger':
      return 'error'
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    default:
      return 'default'
  }
}

function buildAiWorldviewContext() {
  return appStore.worldviewEntries.slice(0, 12).map((entry) => ({
    type: entry.type,
    title: entry.title,
    content: entry.content.slice(0, 320)
  }))
}

// 打开新建角色弹窗，重置表单为空白状态
function handleCreateCharacter(): void {
  editingCharacterId.value = null
  form.name = ''
  form.role = ''
  form.description = ''
  form.tags = []
  editorVisible.value = true
}

// 调用 AI 接口自动生成一个角色草稿，上下文包含世界观、已有角色、关系组织等信息
async function handleGenerateCharacter(payload: { count: number; prompt: string; types: string[] }): Promise<void> {
  if (isGenerating.value) {
    return
  }

  try {
    batchProgress.value = 0
    const entries = await generateCatalogBatch({
      mode: 'character',
      count: payload.count,
      label: '批量生成角色',
      panel: 'characters',
      kind: 'character',
      keyField: 'name',
      existingKeys: appStore.characters.map((character) => character.name),
      onProgress: (completed, total) => { batchProgress.value = Math.round(completed / total * 100) },
      context: {
        projectTitle: appStore.currentProject?.title,
        projectGenre: appStore.currentProject?.genre,
        writingStyleLabel: writingStyle.value.label,
        writingStylePrompt: writingStyle.value.prompt,
        userPrompt: payload.prompt,
        worldviewEntries: buildAiWorldviewContext(),
        organizations: appStore.organizations,
        characterRelationships: appStore.characterRelationships,
        organizationMemberships: appStore.organizationMemberships,
        characters: appStore.characters.map((character) => ({
          id: character.id,
          name: character.name,
          role: character.role,
          description: character.description
        }))
      }
    })

    entries.forEach((character) => {
      const tags = normalizeCatalogTags(character.tags)
      appStore.createCharacter({
        name: String(character.name ?? '新角色'),
        role: String(character.role ?? '待设定'),
        description: String(character.description ?? 'AI 未返回有效角色描述'),
        tags: (tags.length ? tags : ['待完善']).map((label) => ({ label }))
      })
    })
    batchVisible.value = false
    message.success(`已生成 ${entries.length} 个角色`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 生成角色失败，请检查模型配置')
  }
}

// 打开角色编辑弹窗，传入角色数据时为编辑模式，不传则为新建模式
function openEditor(character?: CharacterCard): void {
  editingCharacterId.value = character?.id ?? null
  form.name = character?.name ?? ''
  form.role = character?.role ?? ''
  form.description = character?.description ?? ''
  form.tags = character?.tags.map((tag) => tag.label) ?? []
  editorVisible.value = true
}

// 提交角色表单：校验必填项，将标签字符串数组转为对象数组后保存
function submitCharacter(): void {
  if (!form.name.trim() || !form.description.trim()) {
    message.warning('请完整填写角色名称和角色简介')
    return
  }

  if (editingCharacterId.value) {
    appStore.updateCharacter(editingCharacterId.value, {
      ...form,
      tags: form.tags.map((label) => ({ label }))
    })
    message.success('角色信息已更新')
  } else {
    appStore.createCharacter({
      ...form,
      tags: form.tags.map((label) => ({ label }))
    })
    message.success('已新增角色草稿')
  }

  editorVisible.value = false
}

// 处理角色卡片的下拉菜单操作：编辑或删除角色（删除前弹出二次确认）
function handleMenuSelect(action: string | number, character: CharacterCard): void {
  if (action === 'edit') {
    openEditor(character)
    return
  }

  dialog.warning({
    title: '确认删除角色',
    content: `确定要删除”${character.name}”吗？删除后角色资料将无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteCharacter(character.id)
      message.success('角色已删除')
    }
  })
}

const ENHANCE_TASK_KEY = 'character-enhance'
const enhanceLoading = computed(() => appStore.isAiTaskRunning(ENHANCE_TASK_KEY))
const enhanceVisible = ref(false)
const enhanceFields = ref<EnhanceFieldDiff[]>([])

async function handleAiEnhance(): Promise<void> {
  if (enhanceLoading.value) return

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: ENHANCE_TASK_KEY,
        kind: 'character',
        label: 'AI 补充角色',
        description: '正在根据上下文补充角色信息',
        panel: 'characters'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'character-enhance',
          settings: appStore.appSettings,
          context: {
            currentForm: { name: form.name, role: form.role, description: form.description, tags: form.tags },
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            characterNames: appStore.characters.map((c) => c.name),
            worldviewTitles: appStore.worldviewEntries.map((e) => e.title),
            worldviewEntries: buildAiWorldviewContext(),
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            characters: appStore.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, description: c.description }))
          }
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 补充失败，请检查模型配置')
    }

    const suggested = result.result as { name?: string; role?: string; description?: string; tags?: string[] }
    const suggestedTags = Array.isArray(suggested.tags) ? suggested.tags : []

    enhanceFields.value = [
      { key: 'name', label: '角色名称', type: 'text', original: form.name, suggested: suggested.name ?? '', changed: (suggested.name ?? '') !== form.name && Boolean(suggested.name?.trim()) },
      { key: 'role', label: '角色定位', type: 'text', original: form.role, suggested: suggested.role ?? '', changed: (suggested.role ?? '') !== form.role && Boolean(suggested.role?.trim()) },
      { key: 'description', label: '角色简介', type: 'textarea', original: form.description, suggested: suggested.description ?? '', changed: (suggested.description ?? '') !== form.description && Boolean(suggested.description?.trim()) },
      { key: 'tags', label: '角色标签', type: 'tags', original: form.tags, suggested: suggestedTags, changed: JSON.stringify(suggestedTags) !== JSON.stringify(form.tags) && suggestedTags.length > 0 }
    ]
    enhanceVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 补充失败，请检查模型配置')
  }
}

function handleEnhanceApply(accepted: Record<string, string | string[]>): void {
  if (accepted.name != null) form.name = accepted.name as string
  if (accepted.role != null) form.role = accepted.role as string
  if (accepted.description != null) form.description = accepted.description as string
  if (accepted.tags != null) form.tags = accepted.tags as string[]
  enhanceVisible.value = false
}

watch(
  () => appStore.assistantFocusTarget,
  async (target) => {
    if (!target || target.panel !== 'characters') {
      return
    }

    focusedCharacterId.value = target.entityId
    await nextTick()
    document.querySelector<HTMLElement>(`[data-assistant-focus-id="${target.entityId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      appStore.clearAssistantFocusTarget('characters', target.entityId)
      if (focusedCharacterId.value === target.entityId) {
        focusedCharacterId.value = ''
      }
    }, 2200)
  },
  { immediate: true }
)
</script>

<template>
  <section class="character-panel">
    <div class="section-head">
      <div class="section-title">
        <h2>角色图鉴</h2>
      </div>
      <div class="head-actions">
        <n-button secondary strong @click="appStore.setPanel('relations')">
          <template #icon><Network :size="16" /></template>
          关系组织
        </n-button>
        <n-button secondary strong :loading="isGenerating" @click="batchVisible = true">
          <template #icon><Sparkles :size="16" /></template>
          AI 生成
        </n-button>
        <n-button type="primary" strong @click="handleCreateCharacter">
          <template #icon><Plus :size="16" /></template>
          新建角色
        </n-button>
      </div>
    </div>

    <div class="catalog-toolbar">
      <div class="catalog-filters">
        <n-input
          v-model:value="keyword"
          class="character-search"
          placeholder="搜索姓名、定位、标签或简介"
          clearable
        >
          <template #prefix><Search :size="16" /></template>
        </n-input>
        <n-select
          v-model:value="roleFilter"
          class="role-filter"
          :options="roleOptions"
          placeholder="全部角色定位"
          clearable
          filterable
        />
      </div>
      <div class="result-summary">
        <strong>{{ filteredCharacters.length }}</strong>
        <span>/ {{ appStore.characters.length }} 个角色</span>
      </div>
    </div>

    <div class="character-grid">
      <!-- Direct card click keeps high-frequency editing faster than routing every change through the overflow menu. -->
      <article
        v-for="character in filteredCharacters"
        :key="character.id"
        class="character-card"
        :class="{ 'assistant-focused': focusedCharacterId === character.id }"
        :data-assistant-focus-id="character.id"
        @click="openEditor(character)"
      >
        <div class="avatar" :style="avatarStyle(character.avatar, character.name)">
          <span>{{ character.name.slice(0, 1) }}</span>
        </div>
        <div class="character-info">
          <div class="character-head">
            <div class="character-identity">
              <h3>{{ character.name }}</h3>
              <span v-if="character.role" class="role-label">{{ character.role }}</span>
              <span v-else class="role-label muted">未设置定位</span>
            </div>
            <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key) => handleMenuSelect(key, character)">
              <button class="more-button" type="button" title="更多操作" aria-label="更多操作" @click.stop>
                <MoreVertical :size="14" />
              </button>
            </n-dropdown>
          </div>
          <p class="description" :title="character.description">{{ character.description }}</p>
          <div class="tag-row">
            <n-tag
              v-for="tag in character.tags.slice(0, 3)"
              :key="tag.label"
              size="small"
              :type="tagType(tag.tone)"
            >
              {{ tag.label }}
            </n-tag>
            <span v-if="character.tags.length > 3" class="tag-overflow">+{{ character.tags.length - 3 }}</span>
          </div>
        </div>
      </article>
    </div>

    <div v-if="filteredCharacters.length === 0" class="arc-empty-state">
      {{ appStore.characters.length === 0 ? '还没有角色，先新建一名角色。' : '没有匹配当前筛选条件的角色。' }}
    </div>

    <BatchGenerateDialog
      :show="batchVisible"
      title="批量生成角色"
      description="按项目现有设定连续生成角色，系统会自动分批并跳过重名结果。"
      item-label="角色"
      :loading="isGenerating"
      :progress="batchProgress"
      @close="batchVisible = false"
      @submit="handleGenerateCharacter"
    />

    <n-modal
      :show="editorVisible"
      preset="card"
      class="arc-editor-modal-wide"
      :title="editingCharacterId ? '编辑角色' : '新建角色'"
      :bordered="false"
      @close="editorVisible = false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top">
            <n-form-item label="角色名称">
              <n-input v-model:value="form.name" placeholder="例如：李雷 / 艾达" />
            </n-form-item>
            <n-form-item label="角色定位">
              <n-input v-model:value="form.role" placeholder="例如：男主 / 情报中间人" />
            </n-form-item>
            <n-form-item label="角色标签">
              <n-dynamic-tags v-model:value="form.tags" />
            </n-form-item>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">角色简介</div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="form.description"
              type="textarea"
              placeholder="补充角色背景、动机和冲突..."
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ form.description.length }} 字</span>
          <span>{{ form.tags.length }} 个标签</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button round strong :loading="enhanceLoading" @click="handleAiEnhance">
            <template #icon><Sparkles :size="14" /></template>
            AI 补充
          </n-button>
          <n-button type="primary" round strong @click="submitCharacter">
            {{ editingCharacterId ? '保存修改' : '创建角色' }}
          </n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>

    <AiEnhancePreview
      :show="enhanceVisible"
      :fields="enhanceFields"
      :loading="enhanceLoading"
      @apply="handleEnhanceApply"
      @close="enhanceVisible = false"
    />
  </section>
</template>

<style scoped>
.character-panel {
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
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.character-search {
  width: min(360px, 38vw);
}

.role-filter {
  width: 180px;
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

.character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: 12px;
}

.character-card {
  display: flex;
  min-height: 144px;
  gap: 12px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  padding: 14px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease;
}

.character-card.assistant-focused {
  border-color: color-mix(in srgb, var(--arc-accent) 78%, white 22%);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-accent) 16%, transparent);
}

.character-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 2%, var(--arc-bg-surface));
}

.character-card:hover h3 {
  color: var(--arc-primary);
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 6px;
}

.avatar span {
  color: inherit;
  font-size: 18px;
  font-weight: 750;
  letter-spacing: 0;
}

.character-info {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.character-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.character-identity {
  min-width: 0;
}

.character-identity h3 {
  margin: 0;
  overflow: hidden;
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-label {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-label.muted {
  color: var(--arc-text-hint);
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

.tag-row {
  display: flex;
  min-height: 22px;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  margin-top: auto;
  overflow: hidden;
}

.tag-row :deep(.n-tag) {
  max-width: 92px;
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

.description {
  display: -webkit-box;
  min-height: 39px;
  margin: 10px 0 12px;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

@media (max-width: 860px) {
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
  }

  .character-search {
    width: 100%;
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

  .role-filter {
    width: 100%;
  }

  .result-summary {
    align-self: flex-end;
  }

  .character-grid {
    grid-template-columns: 1fr;
  }
}
</style>
