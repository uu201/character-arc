<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Search, Sparkles } from 'lucide-vue-next'
import { NTag } from 'naive-ui'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
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
        <button class="soft-button">
          <Sparkles :size="16" />
          <span>AI生成角色</span>
        </button>
        <button class="primary-button">
          <Plus :size="16" />
          <span>新建</span>
        </button>
      </div>
    </div>

    <div class="character-grid">
      <article v-for="character in filteredCharacters" :key="character.id" class="character-card">
        <div class="avatar" :style="{ background: character.avatar }"></div>
        <div class="character-info">
          <h3>{{ character.name }}<span v-if="character.role"> ({{ character.role }})</span></h3>
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

    <div v-if="filteredCharacters.length === 0" class="empty-state">
      没有匹配当前搜索条件的角色。
    </div>
  </section>
</template>

<style scoped>
.character-panel {
  max-width: 1180px;
  margin: 0 auto;
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
  width: min(100%, 100%);
}

.search-input {
  display: inline-flex;
  width: min(260px, 100%);
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
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

.character-card {
  display: flex;
  gap: 16px;
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 28px;
  background: white;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
  padding: 20px;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.character-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.06);
}

.avatar {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 999px;
}

.character-info h3 {
  margin: 0 0 4px;
  font-size: 16px;
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

.empty-state {
  margin-top: 18px;
  border: 1px dashed rgba(209, 213, 219, 0.95);
  border-radius: 22px;
  color: #86868b;
  font-size: 14px;
  padding: 22px;
  text-align: center;
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
}
</style>
