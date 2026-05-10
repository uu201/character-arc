<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { MoreVertical, Network, Plus, Search, Sparkles } from 'lucide-vue-next'
import { NButton, NDropdown, NDynamicTags, NForm, NFormItem, NInput, NModal, NTag, useDialog, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { CharacterCard } from '@/types/app'
import type { DropdownOption } from 'naive-ui'

const appStore = useAppStore()
const dialog = useDialog()
const keyword = ref('') // 本面板内的本地搜索关键词
const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))

// 合并本地搜索框和全局工作区搜索关键词，对角色列表进行过滤
// 在角色名、角色定位和简介中做全文匹配
const filteredCharacters = computed(() => {
  // Combine the local search box with the global workspace search for a simple, predictable filter model.
  const mergedQuery = [props.searchQuery, keyword.value].filter(Boolean).join(' ').trim().toLowerCase()
  const value = mergedQuery
  if (!value) {
    return appStore.characters
  }

  return appStore.characters.filter((character) => {
    const haystack = [character.name, character.role, character.description].join(' ').toLowerCase()
    return haystack.includes(value)
  })
})

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词，由父组件传入
}>()
const message = useMessage()
const AI_TASK_KEY = 'character-card'
const isGenerating = computed(() => appStore.isAiTaskRunning(AI_TASK_KEY)) // AI 生成角色时的加载状态（走全局注册表）
const editorVisible = ref(false) // 控制角色编辑弹窗的显示
const editingCharacterId = ref<string | null>(null) // 当前正在编辑的角色 ID，null 表示新建模式
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

// 将标签的语义色调（danger/success/warning）映射为 Naive UI NTag 组件所需的 type 值
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
async function handleGenerateCharacter(): Promise<void> {
  if (isGenerating.value) {
    return
  }

  try {
    const result = await appStore.runTrackedAiTask(
      {
        key: AI_TASK_KEY,
        kind: 'character',
        label: 'AI 生成角色',
        description: '正在根据当前世界观与已有角色生成新的角色草稿',
        panel: 'characters'
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'character-card',
          settings: appStore.appSettings,
          context: {
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            characterNames: appStore.characters.map((character) => character.name),
            worldviewTitles: appStore.worldviewEntries.map((entry) => entry.title),
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
        }))
    )

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 生成角色失败，请检查模型配置')
    }

    const character = result.result as {
      name?: string
      role?: string
      description?: string
      tags?: string[]
    }

    appStore.createCharacter({
      name: character.name ?? '新角色',
      role: character.role ?? '待设定',
      description: character.description ?? 'AI 未返回有效角色描述',
      tags: (character.tags ?? ['待完善']).map((label) => ({ label }))
    })
    message.success('AI 已生成新的角色草稿')
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
    content: `确定要删除“${character.name}”吗？删除后角色资料将无法恢复。`,
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
</script>

<template>
  <section class="character-panel">
    <div class="section-head">
      <div>
        <h2>角色图鉴</h2>
        <p>主要角色卡与关键人设在这里集中维护。</p>
      </div>
      <div class="head-actions">
        <div class="search-input">
          <Search :size="16" />
          <input v-model="keyword" type="text" placeholder="搜索角色..." />
        </div>
        <button class="soft-button" :disabled="isGenerating" @click="handleGenerateCharacter">
          <Sparkles :size="16" />
          <span>{{ isGenerating ? '生成中...' : 'AI生成角色' }}</span>
        </button>
        <button class="soft-button" @click="appStore.setPanel('relations')">
          <Network :size="16" />
          <span>关系组织</span>
        </button>
        <button class="primary-button" @click="handleCreateCharacter">
          <Plus :size="16" />
          <span>新建</span>
        </button>
      </div>
    </div>

    <div class="character-grid">
      <!-- Direct card click keeps high-frequency editing faster than routing every change through the overflow menu. -->
      <article v-for="character in filteredCharacters" :key="character.id" class="character-card" @click="openEditor(character)">
        <div class="avatar" :style="{ background: character.avatar }">
          <span>{{ character.name.slice(0, 1) }}</span>
        </div>
        <div class="character-info">
          <div class="character-head">
            <h3>{{ character.name }}<span v-if="character.role"> ({{ character.role }})</span></h3>
            <n-dropdown :options="menuOptions" placement="bottom-end" @select="(key) => handleMenuSelect(key, character)">
              <button class="more-button" @click.stop>
                <MoreVertical :size="14" />
              </button>
            </n-dropdown>
          </div>
          <div class="tag-row">
            <n-tag
              v-for="tag in character.tags"
              :key="tag.label"
              round
              size="small"
              :type="tagType(tag.tone)"
            >
              {{ tag.label }}
            </n-tag>
          </div>
          <p class="description">{{ character.description }}</p>
        </div>
      </article>
    </div>

    <div v-if="filteredCharacters.length === 0" class="arc-empty-state">
      没有匹配当前搜索条件的角色。
    </div>

    <n-modal
      :show="editorVisible"
      preset="card"
      class="arc-editor-modal"
      :title="editingCharacterId ? '编辑角色' : '新建角色'"
      :bordered="false"
      @close="editorVisible = false"
    >
      <n-form label-placement="top">
        <n-form-item label="角色名称">
          <n-input v-model:value="form.name" placeholder="例如：李雷 / 艾达" />
        </n-form-item>
        <n-form-item label="角色定位">
          <n-input v-model:value="form.role" placeholder="例如：男主 / 情报中间人" />
        </n-form-item>
        <n-form-item label="角色简介">
          <n-input
            v-model:value="form.description"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 7 }"
            placeholder="补充角色背景、动机和冲突..."
          />
        </n-form-item>
        <n-form-item label="角色标签">
          <n-dynamic-tags v-model:value="form.tags" />
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="editorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitCharacter">
            {{ editingCharacterId ? '保存修改' : '创建角色' }}
          </n-button>
        </div>
      </template>
    </n-modal>
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
  align-items: end;
  justify-content: space-between;
  margin-bottom: 32px;
  gap: 16px;
  flex-wrap: wrap;
}

.section-head h2 {
  margin: 0 0 8px;
  font-size: clamp(30px, 3.4vw, 38px);
  font-weight: 650;
  letter-spacing: -0.04em;
}

.section-head p {
  margin: 0;
  color: #86868b;
  font-size: 15px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
  justify-content: flex-end;
}

.search-input {
  display: inline-flex;
  width: clamp(220px, 24vw, 280px);
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: #f5f5f7;
  color: #9ca3af;
  padding: 10px 14px;
}

.search-input:focus-within {
  border-color: color-mix(in srgb, var(--arc-primary) 22%, var(--arc-bg-mix));
  background: var(--arc-bg-surface);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.search-input input {
  width: 100%;
  border: none;
  background: transparent;
  outline: none;
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
}

.soft-button:disabled,
.primary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.soft-button {
  background: #f5f5f7;
  color: #1d1d1f;
}

.soft-button :deep(svg) {
  color: var(--arc-primary);
}

.primary-button {
  background: var(--arc-primary);
  color: white;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--arc-primary) 24%, transparent);
}

.character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: clamp(16px, 2vw, 24px);
}

.character-card {
  display: flex;
  gap: 16px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
  padding: 18px;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.character-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.06);
}

.character-card::after {
  content: '点击编辑';
  display: inline-flex;
  margin-top: auto;
  color: rgba(31, 41, 55, 0);
  font-size: 11px;
  font-weight: 600;
  transition: color 0.2s ease;
}

.character-card:hover h3 {
  color: var(--arc-primary);
}

.character-card:hover::after {
  color: #9ca3af;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 999px;
}

.avatar span {
  color: white;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.character-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.character-info h3 {
  margin: 0 0 4px;
  font-size: 16px;
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

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.description {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

@media (max-width: 1240px) {
  .head-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 860px) {
  .search-input {
    width: 100%;
    order: 1;
  }

  .soft-button,
  .primary-button {
    flex: 1 1 calc(50% - 6px);
    justify-content: center;
  }
}

@media (max-width: 720px) {
  .character-grid {
    grid-template-columns: 1fr;
  }

  .character-card {
    flex-direction: column;
  }

  .avatar {
    width: 56px;
    height: 56px;
  }
}
</style>
