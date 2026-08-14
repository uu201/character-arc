<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch, type CSSProperties } from 'vue'
import { BookOpenText, LayoutGrid, Link2, MoreVertical, Network, Plus, Rows3, Search, Sparkles } from 'lucide-vue-next'
import { NButton, NCheckbox, NDropdown, NDynamicTags, NForm, NFormItem, NInput, NModal, NSelect, useDialog, useMessage } from 'naive-ui'
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
import { useIncrementalList } from '@/composables/useIncrementalList'
import { useBatchSelection } from '@/composables/useBatchSelection'
import BatchSelectionBar from './BatchSelectionBar.vue'

const appStore = useAppStore()
const dialog = useDialog()
const keyword = ref('') // 本面板内的本地搜索关键词
type CharacterTone = 'lead' | 'villain' | 'mentor' | 'support' | 'other'
type CharacterSort = 'default' | 'name' | 'relations' | 'chapters'
type CharacterGroup = 'none' | 'tone'
type CharacterView = 'grid' | 'list'
const toneFilter = ref<CharacterTone | null>(null)
const sortMode = ref<CharacterSort>('default')
const groupMode = ref<CharacterGroup>('none')
const viewMode = ref<CharacterView>('grid')
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词，由父组件传入
}>()

const toneMeta: Record<CharacterTone, { label: string; hue: number }> = {
  lead: { label: '主角', hue: 212 },
  villain: { label: '反派', hue: 356 },
  mentor: { label: '导师', hue: 38 },
  support: { label: '配角', hue: 155 },
  other: { label: '其他', hue: 265 }
}
const toneOrder = Object.keys(toneMeta) as CharacterTone[]
const sortOptions = [
  { label: '默认排序', value: 'default' },
  { label: '按名称', value: 'name' },
  { label: '按关系数', value: 'relations' },
  { label: '按出场章节', value: 'chapters' }
]
const groupOptions = [
  { label: '不分组', value: 'none' },
  { label: '按定位分组', value: 'tone' }
]

function resolveCharacterTone(role: string): CharacterTone {
  if (/主角|男主|女主|主人公/.test(role)) return 'lead'
  if (/反派|大反派|对手|宿敌|敌/.test(role)) return 'villain'
  if (/导师|师父|前辈|长老/.test(role)) return 'mentor'
  if (/配角|同伴|部下|亲友|副手/.test(role)) return 'support'
  return 'other'
}

function isCharacterIncomplete(character: CharacterCard): boolean {
  return !character.description.trim() || !character.role.trim() || character.tags.length === 0
}

const relationshipCountByCharacter = computed(() => {
  const counts = new Map<string, number>()
  appStore.characterRelationships.forEach((relationship) => {
    counts.set(relationship.fromCharacterId, (counts.get(relationship.fromCharacterId) ?? 0) + 1)
    counts.set(relationship.toCharacterId, (counts.get(relationship.toCharacterId) ?? 0) + 1)
  })
  return counts
})
const appearanceCountByCharacter = computed(() => {
  const relatedByOutlineId = new Map(appStore.outlineItems.map((item) => [item.id, item.relatedCharacterIds ?? []]))
  const counts = new Map<string, number>()
  appStore.chapters.forEach((chapter) => {
    const ids = relatedByOutlineId.get(chapter.outlineItemId) ?? []
    ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1))
  })
  return counts
})
const toneCounts = computed(() => {
  const counts = new Map<CharacterTone, number>()
  appStore.characters.forEach((character) => {
    const tone = resolveCharacterTone(character.role)
    counts.set(tone, (counts.get(tone) ?? 0) + 1)
  })
  return counts
})
// 合并本地搜索框和全局工作区搜索关键词，对角色列表进行过滤
// 在角色名、角色定位和简介中做全文匹配
const filteredCharacters = computed(() => {
  // Combine the local search box with the global workspace search for a simple, predictable filter model.
  const mergedQuery = [props.searchQuery, keyword.value].filter(Boolean).join(' ').trim().toLowerCase()
  return appStore.characters.filter((character) => {
    const matchesTone = !toneFilter.value || resolveCharacterTone(character.role) === toneFilter.value
    const haystack = [character.name, character.role, character.description, ...character.tags.map((tag) => tag.label)]
      .join(' ')
      .toLowerCase()
    return matchesTone && (!mergedQuery || haystack.includes(mergedQuery))
  })
})
const sortedCharacters = computed(() => {
  const characters = [...filteredCharacters.value]
  if (sortMode.value === 'name') return characters.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  if (sortMode.value === 'relations') {
    return characters.sort((a, b) => (relationshipCountByCharacter.value.get(b.id) ?? 0) - (relationshipCountByCharacter.value.get(a.id) ?? 0))
  }
  if (sortMode.value === 'chapters') {
    return characters.sort((a, b) => (appearanceCountByCharacter.value.get(b.id) ?? 0) - (appearanceCountByCharacter.value.get(a.id) ?? 0))
  }
  return characters
})
const visibleCharacters = useIncrementalList(
  sortedCharacters,
  computed(() => `${props.searchQuery ?? ''}\u0000${keyword.value}\u0000${toneFilter.value ?? ''}\u0000${sortMode.value}`)
)
const characterSelection = useBatchSelection(computed(() => filteredCharacters.value.map((item) => item.id)))
const characterGroups = computed(() => {
  if (groupMode.value === 'none') return [{ key: 'all', label: '', items: visibleCharacters.value }]
  return toneOrder
    .map((tone) => ({ key: tone, label: toneMeta[tone].label, items: visibleCharacters.value.filter((item) => resolveCharacterTone(item.role) === tone) }))
    .filter((group) => group.items.length > 0)
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

function handleCharacterClick(character: CharacterCard): void {
  if (characterSelection.selectionMode.value) {
    characterSelection.toggleSelection(character.id)
    return
  }
  openEditor(character)
}

function characterToneStyle(character: CharacterCard): CSSProperties {
  const tone = toneMeta[resolveCharacterTone(character.role)]
  return { '--tone-color': `hsl(${tone.hue} 62% 52%)` } as CSSProperties
}

function clearCatalogFilters(): void {
  keyword.value = ''
  toneFilter.value = null
}

function confirmBatchDeleteCharacters(): void {
  const ids = [...characterSelection.selectedAvailableIds.value]
  if (!ids.length) return
  dialog.warning({
    title: '批量删除角色',
    content: `确定删除选中的 ${ids.length} 个角色吗？相关人物关系和成员归属也会一并清理，此操作无法撤销。`,
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: () => {
      ids.forEach((id) => appStore.deleteCharacter(id))
      characterSelection.finishSelection()
      message.success(`已删除 ${ids.length} 个角色`)
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
            projectId: appStore.currentProject?.id,
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
        <h2>角色图鉴 <span class="title-count">{{ appStore.characters.length }} 位</span></h2>
        <p>人物设定、定位与彼此关系的总览。</p>
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
      <n-input v-model:value="keyword" class="character-search" placeholder="搜索姓名、定位、标签或简介" clearable>
        <template #prefix><Search :size="16" /></template>
      </n-input>
      <div class="toolbar-spacer"></div>
      <n-select v-model:value="sortMode" class="sort-select" :options="sortOptions" />
      <n-select v-model:value="groupMode" class="group-select" :options="groupOptions" />
      <div class="view-switch" role="group" aria-label="角色展示方式">
        <button type="button" :class="{ active: viewMode === 'grid' }" title="卡片视图" aria-label="卡片视图" @click="viewMode = 'grid'">
          <LayoutGrid :size="15" />
        </button>
        <button type="button" :class="{ active: viewMode === 'list' }" title="列表视图" aria-label="列表视图" @click="viewMode = 'list'">
          <Rows3 :size="15" />
        </button>
      </div>
      <div class="result-summary">
        <strong>{{ filteredCharacters.length }}</strong>
        <span>/ {{ appStore.characters.length }}</span>
      </div>
    </div>

    <div class="filter-chips">
      <button type="button" class="filter-chip" :class="{ active: toneFilter === null }" @click="toneFilter = null">
        全部 <span>{{ appStore.characters.length }}</span>
      </button>
      <button
        v-for="tone in toneOrder.filter((item) => toneCounts.get(item))"
        :key="tone"
        type="button"
        class="filter-chip"
        :class="{ active: toneFilter === tone }"
        :style="{ '--chip-color': `hsl(${toneMeta[tone].hue} 55% 48%)` }"
        @click="toneFilter = toneFilter === tone ? null : tone"
      >
        <span class="tone-dot"></span>{{ toneMeta[tone].label }} <small>{{ toneCounts.get(tone) }}</small>
      </button>
    </div>

    <BatchSelectionBar
      :active="characterSelection.selectionMode.value"
      :selected-count="characterSelection.selectedAvailableIds.value.length"
      :total-count="filteredCharacters.length"
      :all-selected="characterSelection.allAvailableSelected.value"
      item-label="角色"
      @toggle="characterSelection.toggleSelectionMode"
      @select-all="characterSelection.toggleSelectAll"
      @clear="characterSelection.clearSelection"
      @delete="confirmBatchDeleteCharacters"
    />

    <template v-if="filteredCharacters.length > 0">
      <div v-if="viewMode === 'grid'" class="character-groups">
        <section v-for="group in characterGroups" :key="group.key" class="character-group">
          <div v-if="groupMode === 'tone'" class="group-heading">
            <span>{{ group.label }}</span><small>{{ group.items.length }}</small>
          </div>
          <div class="character-grid">
            <article
              v-for="character in group.items"
              :key="character.id"
              class="character-card"
              :class="{ 'assistant-focused': focusedCharacterId === character.id, selected: characterSelection.selectedIds.value.has(character.id) }"
              :style="characterToneStyle(character)"
              :data-assistant-focus-id="character.id"
              @click="handleCharacterClick(character)"
            >
              <div class="card-top">
                <n-checkbox
                  v-if="characterSelection.selectionMode.value"
                  :checked="characterSelection.selectedIds.value.has(character.id)"
                  @click.stop
                  @update:checked="characterSelection.toggleSelection(character.id)"
                />
                <div class="avatar" :style="avatarStyle(character.avatar, character.name)">
                  <span>{{ character.name.slice(0, 1) }}</span><i class="activity-dot"></i>
                </div>
                <div class="card-identity">
                  <h3>{{ character.name }}</h3>
                  <div class="card-meta-row">
                    <span class="role-badge" :class="{ muted: !character.role }">{{ character.role || '未设置定位' }}</span>
                    <span v-if="isCharacterIncomplete(character)" class="todo-badge">待完善</span>
                  </div>
                </div>
                <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key) => handleMenuSelect(key, character)">
                  <button class="more-button" type="button" title="更多操作" aria-label="更多操作" @click.stop><MoreVertical :size="15" /></button>
                </n-dropdown>
              </div>
              <p class="card-description" :class="{ empty: !character.description.trim() }" :title="character.description">
                {{ character.description.trim() || '还没有角色简介，点击卡片补充背景、动机与冲突。' }}
              </p>
              <div class="card-footer">
                <div class="tag-row">
                  <span v-for="tag in character.tags" :key="tag.label" class="character-tag">{{ tag.label }}</span>
                  <span v-if="character.tags.length === 0" class="tag-overflow">暂无标签</span>
                </div>
                <div class="card-stats">
                  <span title="人物关系"><Link2 :size="12" />{{ relationshipCountByCharacter.get(character.id) ?? 0 }}</span>
                  <span title="出场章节"><BookOpenText :size="12" />{{ appearanceCountByCharacter.get(character.id) ?? 0 }}</span>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>

      <div v-else class="character-list" :class="{ 'selection-mode': characterSelection.selectionMode.value }">
        <div class="list-head">
          <span v-if="characterSelection.selectionMode.value"></span><span></span><span>角色</span><span>定位</span><span>简介</span><span>标签</span><span>关系 / 出场</span><span></span>
        </div>
        <article
          v-for="character in visibleCharacters"
          :key="character.id"
          class="list-row"
          :class="{ selected: characterSelection.selectedIds.value.has(character.id), 'assistant-focused': focusedCharacterId === character.id }"
          :style="characterToneStyle(character)"
          :data-assistant-focus-id="character.id"
          @click="handleCharacterClick(character)"
        >
          <n-checkbox v-if="characterSelection.selectionMode.value" :checked="characterSelection.selectedIds.value.has(character.id)" @click.stop @update:checked="characterSelection.toggleSelection(character.id)" />
          <div class="avatar" :style="avatarStyle(character.avatar, character.name)"><span>{{ character.name.slice(0, 1) }}</span></div>
          <strong class="list-name">{{ character.name }}</strong>
          <span class="role-badge" :class="{ muted: !character.role }">{{ character.role || '未设置' }}</span>
          <p class="list-description">{{ character.description || '暂无简介' }}</p>
          <div class="tag-row"><span v-for="tag in character.tags" :key="tag.label" class="character-tag">{{ tag.label }}</span></div>
          <div class="card-stats"><span><Link2 :size="12" />{{ relationshipCountByCharacter.get(character.id) ?? 0 }}</span><span><BookOpenText :size="12" />{{ appearanceCountByCharacter.get(character.id) ?? 0 }}</span></div>
          <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key) => handleMenuSelect(key, character)">
            <button class="more-button" type="button" title="更多操作" aria-label="更多操作" @click.stop><MoreVertical :size="15" /></button>
          </n-dropdown>
        </article>
      </div>
    </template>

    <div v-else class="catalog-empty-state">
      <div class="empty-icon"><Network :size="22" /></div>
      <h4>{{ appStore.characters.length === 0 ? '还没有角色' : '没有匹配的角色' }}</h4>
      <p>{{ appStore.characters.length === 0 ? '先建立一位主角，或让 AI 依据现有设定生成候选角色。' : '尝试更换关键词或清除当前定位筛选。' }}</p>
      <div class="empty-actions">
        <n-button v-if="appStore.characters.length === 0" secondary @click="batchVisible = true">AI 生成角色</n-button>
        <n-button v-if="appStore.characters.length === 0" type="primary" @click="handleCreateCharacter">新建角色</n-button>
        <n-button v-else @click="clearCatalogFilters">清除筛选</n-button>
      </div>
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
.character-panel { max-width: 1180px; min-width: 0; margin: 0 auto; }

.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 18px; flex-wrap: wrap; }
.section-title h2 { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--arc-text-primary); font-size: 22px; font-weight: 700; letter-spacing: 0; }
.section-title p { margin: 6px 0 0; color: var(--arc-text-hint); font-size: 13px; line-height: 1.5; }
.title-count { border-radius: 999px; background: var(--arc-primary-soft); color: var(--arc-primary); padding: 2px 8px; font-size: 12px; font-weight: 650; }
.head-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }

.catalog-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; border: 1px solid var(--arc-border); border-radius: 6px; background: var(--arc-bg-mix); padding: 10px; flex-wrap: wrap; }
.character-search { width: min(340px, 38vw); min-width: 200px; }
.toolbar-spacer { flex: 1 1 auto; }
.sort-select { width: 130px; }
.group-select { width: 132px; }
.result-summary { display: inline-flex; align-items: baseline; flex-shrink: 0; gap: 4px; color: var(--arc-text-hint); font-size: 12px; white-space: nowrap; }
.result-summary strong { color: var(--arc-text-primary); font-size: 14px; }
.view-switch { display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--arc-border); border-radius: 6px; background: var(--arc-bg-surface); padding: 2px; }
.view-switch button { display: inline-flex; width: 30px; height: 28px; align-items: center; justify-content: center; border: none; border-radius: 4px; background: transparent; color: var(--arc-text-hint); cursor: pointer; }
.view-switch button:hover { color: var(--arc-text-secondary); }
.view-switch button.active { background: var(--arc-primary-soft); color: var(--arc-primary); }

.filter-chips { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.filter-chip { display: inline-flex; min-height: 28px; align-items: center; gap: 6px; border: 1px solid var(--arc-border); border-radius: 999px; background: var(--arc-bg-surface); color: var(--arc-text-secondary); padding: 4px 11px; font-size: 12px; cursor: pointer; }
.filter-chip:hover { border-color: var(--arc-border-strong); color: var(--arc-text-primary); }
.filter-chip.active { border-color: var(--arc-primary); background: var(--arc-primary-soft); color: var(--arc-primary); font-weight: 600; }
.filter-chip:not(.active) .tone-dot { background: var(--chip-color); }
.filter-chip small, .filter-chip > span:last-child { color: var(--arc-text-hint); font-size: 11px; }
.tone-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: currentColor; }

.character-groups { display: grid; gap: 14px; }
.character-group { min-width: 0; }
.group-heading { display: flex; align-items: center; gap: 9px; margin: 2px 0 8px; color: var(--arc-text-secondary); font-size: 13px; font-weight: 650; }
.group-heading::after { height: 1px; flex: 1; background: var(--arc-border); content: ''; }
.group-heading small { color: var(--arc-text-hint); font-size: 11px; font-weight: 500; }
.character-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 268px), 1fr)); gap: 12px; }

.character-card { position: relative; display: flex; min-height: 174px; flex-direction: column; gap: 10px; overflow: hidden; border: 1px solid var(--arc-border); border-radius: 8px; background: var(--arc-bg-surface); padding: 14px 14px 12px; cursor: pointer; transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease; }
.character-card::before { position: absolute; top: 0; bottom: 0; left: 0; width: 3px; background: var(--tone-color); content: ''; opacity: 0.85; }
.character-card:hover { border-color: color-mix(in srgb, var(--arc-primary) 34%, var(--arc-border)); box-shadow: var(--arc-shadow-md); transform: translateY(-2px); }
.character-card.selected { border-color: var(--arc-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-primary) 20%, transparent); }
.character-card.assistant-focused, .list-row.assistant-focused { border-color: var(--arc-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-accent) 16%, transparent); }
.card-top { display: flex; align-items: flex-start; gap: 11px; }
.avatar { position: relative; display: flex; width: 46px; height: 46px; align-items: center; justify-content: center; flex: 0 0 46px; border-radius: 8px; }
.avatar span { color: inherit; font-size: 19px; font-weight: 700; }
.activity-dot { position: absolute; right: -2px; bottom: -2px; width: 12px; height: 12px; border: 2px solid var(--arc-bg-surface); border-radius: 50%; background: var(--tone-color); }
.card-identity { min-width: 0; flex: 1; }
.card-identity h3 { margin: 0; overflow: hidden; color: var(--arc-text-primary); font-size: 15.5px; font-weight: 700; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.character-card:hover h3, .list-row:hover .list-name { color: var(--arc-primary); }
.card-meta-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
.role-badge { display: inline-flex; max-width: 100%; min-height: 20px; align-items: center; overflow: hidden; border-radius: 4px; background: color-mix(in srgb, var(--tone-color) 12%, var(--arc-bg-surface)); color: color-mix(in srgb, var(--tone-color) 76%, var(--arc-text-primary)); padding: 2px 7px; font-size: 11.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.role-badge.muted { background: var(--arc-bg-surface-hover); color: var(--arc-text-hint); font-weight: 500; }
.todo-badge { display: inline-flex; min-height: 20px; align-items: center; border: 1px dashed color-mix(in srgb, var(--arc-warning) 45%, transparent); border-radius: 4px; color: var(--arc-warning); padding: 2px 6px; font-size: 11px; }
.more-button { display: inline-flex; width: 26px; height: 26px; align-items: center; justify-content: center; flex: 0 0 26px; border: none; border-radius: 4px; background: transparent; color: var(--arc-text-hint); opacity: 0; cursor: pointer; transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease; }
.character-card:hover .more-button, .list-row:hover .more-button, .more-button:focus-visible { opacity: 1; }
.more-button:hover { background: var(--arc-bg-surface-hover); color: var(--arc-text-primary); }
.card-description { display: -webkit-box; min-height: 38px; margin: 0; overflow: hidden; color: var(--arc-text-secondary); font-size: 12.5px; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.card-description.empty { color: var(--arc-text-hint); font-style: italic; }
.card-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; }
.tag-row { display: flex; min-width: 0; min-height: 22px; align-items: center; gap: 5px; overflow: visible; flex-wrap: wrap; }
.character-tag { border-radius: 4px; background: var(--arc-bg-surface-hover); color: var(--arc-text-secondary); padding: 3px 7px; font-size: 11.5px; white-space: nowrap; }
.tag-overflow { flex-shrink: 0; color: var(--arc-text-hint); font-size: 11.5px; }
.card-stats { display: flex; align-items: center; gap: 10px; flex-shrink: 0; color: var(--arc-text-hint); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.card-stats span { display: inline-flex; align-items: center; gap: 3px; }

.character-list { overflow: hidden; border: 1px solid var(--arc-border); border-radius: 6px; background: var(--arc-bg-surface); }
.list-head, .list-row { display: grid; grid-template-columns: 34px minmax(110px, 1.1fr) 104px minmax(0, 2.4fr) minmax(90px, 0.9fr) 92px 30px; align-items: center; gap: 12px; padding: 8px 12px; }
.character-list.selection-mode .list-head, .character-list.selection-mode .list-row { grid-template-columns: 22px 34px minmax(110px, 1.1fr) 104px minmax(0, 2.4fr) minmax(90px, 0.9fr) 92px 30px; }
.list-head { border-bottom: 1px solid var(--arc-border); background: var(--arc-bg-mix); color: var(--arc-text-hint); font-size: 11.5px; font-weight: 600; }
.list-row { min-height: 50px; border-bottom: 1px solid var(--arc-border); cursor: pointer; transition: background 0.14s ease; }
.list-row:last-child { border-bottom: none; }
.list-row:hover { background: var(--arc-bg-surface-hover); }
.list-row.selected { background: color-mix(in srgb, var(--arc-primary) 7%, var(--arc-bg-surface)); }
.list-row .avatar { width: 30px; height: 30px; flex-basis: 30px; border-radius: 6px; }
.list-row .avatar span { font-size: 13px; }
.list-name { overflow: hidden; color: var(--arc-text-primary); font-size: 13.5px; text-overflow: ellipsis; white-space: nowrap; }
.list-description { overflow: hidden; margin: 0; color: var(--arc-text-secondary); font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }

.catalog-empty-state { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; border: 1px dashed var(--arc-border-strong); border-radius: 8px; background: var(--arc-bg-mix); padding: 64px 20px; text-align: center; }
.empty-icon { display: grid; width: 48px; height: 48px; place-items: center; border-radius: 50%; background: var(--arc-bg-surface-hover); color: var(--arc-text-hint); }
.catalog-empty-state h4 { margin: 0; color: var(--arc-text-primary); font-size: 14px; }
.catalog-empty-state p { max-width: 340px; margin: 0; color: var(--arc-text-hint); font-size: 12.5px; line-height: 1.6; }
.empty-actions { display: flex; gap: 8px; margin-top: 4px; }

@media (max-width: 900px) {
  .list-head, .list-row { grid-template-columns: 34px minmax(100px, 1fr) 90px 30px; }
  .character-list.selection-mode .list-head, .character-list.selection-mode .list-row { grid-template-columns: 22px 34px minmax(100px, 1fr) 90px 30px; }
  .list-head > :nth-child(4), .list-head > :nth-child(5), .list-head > :nth-child(6), .list-row > .list-description, .list-row > .tag-row, .list-row > .card-stats { display: none; }
  .character-list.selection-mode .list-head > :nth-child(4) { display: block; }
  .character-list.selection-mode .list-head > :nth-child(5), .character-list.selection-mode .list-head > :nth-child(6), .character-list.selection-mode .list-head > :nth-child(7) { display: none; }
}

@media (max-width: 720px) {
  .section-head { flex-direction: column; }
  .head-actions { width: 100%; justify-content: flex-start; }
  .head-actions :deep(.n-button) { flex: 1 1 calc(33.333% - 6px); }
  .catalog-toolbar { align-items: stretch; }
  .character-search { width: 100%; max-width: none; }
  .toolbar-spacer { display: none; }
  .sort-select, .group-select { width: calc(50% - 5px); flex: 1 1 130px; }
  .result-summary { margin-left: auto; }
  .character-grid { grid-template-columns: 1fr; }
  .more-button { opacity: 1; }
}

@media (max-width: 480px) {
  .head-actions :deep(.n-button) { flex-basis: 100%; }
}
</style>
