<script setup lang="ts">
import { computed } from 'vue'
import { GitMerge, Plus, Sparkles } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'

const props = defineProps<{
  searchQuery?: string
}>()

const appStore = useAppStore()
const filteredOutlineItems = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() ?? ''
  if (!query) {
    return appStore.outlineItems
  }

  return appStore.outlineItems.filter((item) =>
    `${item.title} ${item.conflict} ${item.summary}`.toLowerCase().includes(query)
  )
})
</script>

<template>
  <section class="outline-panel">
    <div class="section-head">
      <div>
        <h2>剧情大纲</h2>
        <p>整理篇章结构与关键冲突，让章节推进更加稳定。</p>
      </div>
      <button class="soft-button">
        <Sparkles :size="16" />
        <span>AI 扩写大纲</span>
      </button>
    </div>

    <div class="outline-wrap">
      <div class="volume-title">第一卷：霓虹下的老鼠 (目标字数: 5万字)</div>
      <div class="outline-list">
        <article v-for="item in filteredOutlineItems" :key="item.id" class="outline-item">
          <div class="outline-header">
            <span>{{ item.title }}</span>
            <span class="outline-word">{{ item.wordTarget }}</span>
          </div>
          <div class="outline-desc">
            <b>核心冲突：</b>{{ item.conflict }}<br />
            <b>剧情：</b>{{ item.summary }}
          </div>
        </article>
        <div v-if="!props.searchQuery" class="outline-add">
          <Plus :size="16" />
          <span>新增章节节点</span>
        </div>
      </div>
    </div>

    <div v-if="filteredOutlineItems.length === 0" class="empty-state">
      没有匹配“{{ props.searchQuery }}”的大纲节点。
    </div>
  </section>
</template>

<style scoped>
.outline-panel {
  max-width: 960px;
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

.soft-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: 999px;
  background: #f5f5f7;
  color: #1d1d1f;
  cursor: pointer;
  font-size: 14px;
  font-weight: 650;
  padding: 12px 18px;
}

.soft-button :deep(svg) {
  color: var(--arc-primary);
}

.outline-wrap {
  max-width: 820px;
  margin: 0 auto;
  width: 100%;
}

.volume-title {
  margin: 0 0 18px;
  font-size: 22px;
  font-weight: 650;
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
}

.outline-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
  font-weight: 600;
}

.outline-word {
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 400;
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
  border: 1px dashed var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 14px;
  padding: 18px 20px;
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

@media (max-width: 760px) {
  .soft-button {
    width: 100%;
    justify-content: center;
  }

  .outline-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
