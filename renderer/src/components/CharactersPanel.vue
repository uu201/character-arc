<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { MoreVertical, Plus, Search, Sparkles } from 'lucide-vue-next'
import { NButton, NDropdown, NDynamicTags, NForm, NFormItem, NInput, NModal, NTag, useDialog, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import type { CharacterCard } from '@/types/app'
import type { DropdownOption } from 'naive-ui'

const appStore = useAppStore()
const dialog = useDialog()
const keyword = ref('')

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
  searchQuery?: string
}>()
const message = useMessage()
const isGenerating = ref(false)
const editorVisible = ref(false)
const editingCharacterId = ref<string | null>(null)
const form = reactive({
  name: '',
  role: '',
  description: '',
  tags: [] as string[]
})
const menuOptions: DropdownOption[] = [
  { key: 'edit', label: '编辑角色' },
  { key: 'delete', label: '删除角色' }
]

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

function handleCreateCharacter(): void {
  editingCharacterId.value = null
  form.name = ''
  form.role = ''
  form.description = ''
  form.tags = []
  editorVisible.value = true
}

async function handleGenerateCharacter(): Promise<void> {
  if (isGenerating.value) {
    return
  }

  isGenerating.value = true

  try {
    const result = await window.characterArc.generateAi({
      task: 'character-card',
      settings: appStore.appSettings,
      context: {
        projectTitle: appStore.currentProject?.title,
        projectGenre: appStore.currentProject?.genre,
        characterNames: appStore.characters.map((character) => character.name),
        worldviewTitles: appStore.worldviewEntries.map((entry) => entry.title)
      }
    })

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
  } finally {
    isGenerating.value = false
  }
}

function openEditor(character?: CharacterCard): void {
  editingCharacterId.value = character?.id ?? null
  form.name = character?.name ?? ''
  form.role = character?.role ?? ''
  form.description = character?.description ?? ''
  form.tags = character?.tags.map((tag) => tag.label) ?? []
  editorVisible.value = true
}

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
        <button class="primary-button" @click="handleCreateCharacter">
          <Plus :size="16" />
          <span>新建</span>
        </button>
      </div>
    </div>

    <div class="character-grid">
      <!-- Direct card click keeps high-frequency editing faster than routing every change through the overflow menu. -->
      <article v-for="character in filteredCharacters" :key="character.id" class="character-card" @click="openEditor(character)">
        <div class="avatar" :style="{ background: character.avatar }"></div>
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
  border-color: color-mix(in srgb, var(--arc-primary) 22%, white);
  background: white;
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
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 28px;
  background: white;
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
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 999px;
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
