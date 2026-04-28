<script setup lang="ts">
import { computed } from 'vue'
import { MoreVertical, Plus, Sparkles } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'

const props = defineProps<{
  searchQuery?: string
}>()

const appStore = useAppStore()

const entryTypes = ['地理', '法则', '物种']
const filteredEntries = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() ?? ''
  if (!query) {
    return appStore.worldviewEntries
  }

  return appStore.worldviewEntries.filter((entry) =>
    `${entry.title} ${entry.content}`.toLowerCase().includes(query)
  )
})
</script>

<template>
  <section class="world-panel">
    <div class="section-head">
      <div>
        <h2>世界观设定</h2>
        <p>AI 协助构建的世界基石，所有的故事都在这里发生。</p>
      </div>
      <div class="head-actions">
        <button class="soft-button">
          <Sparkles :size="16" />
          <span>AI 扩写</span>
        </button>
        <button class="primary-button">
          <Plus :size="16" />
          <span>新建词条</span>
        </button>
      </div>
    </div>

    <div class="world-grid">
      <article
        v-for="(entry, index) in filteredEntries"
        :key="entry.id"
        class="world-card"
        :style="{ animationDelay: `${index * 70}ms` }"
      >
        <div class="card-top">
          <span class="entry-type">{{ entryTypes[index % entryTypes.length] }}</span>
          <button class="more-button">
            <MoreVertical :size="14" />
          </button>
        </div>
        <h3>{{ entry.title }}</h3>
        <p>{{ entry.content }}</p>
      </article>

      <button v-if="!props.searchQuery" class="empty-card">
        <Plus :size="28" />
        <span>添加新设定</span>
      </button>
    </div>

    <div v-if="filteredEntries.length === 0" class="empty-state">
      没有匹配“{{ props.searchQuery }}”的世界观设定。
    </div>
  </section>
</template>

<style scoped>
.world-panel {
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
  color: #1d1d1f;
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
  gap: 12px;
  flex-wrap: wrap;
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
  transition: all 0.24s ease;
}

.soft-button {
  background: #f5f5f7;
  color: #1d1d1f;
}

.soft-button :deep(svg) {
  color: var(--arc-primary);
}

.soft-button:hover {
  background: #ebedf0;
}

.primary-button {
  background: var(--arc-primary);
  color: white;
  box-shadow: 0 12px 28px color-mix(in srgb, var(--arc-primary) 24%, transparent);
}

.primary-button:hover {
  background: var(--arc-primary-hover);
  transform: translateY(-2px);
}

.world-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}

.world-card {
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 28px;
  background: white;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
  cursor: pointer;
  padding: 24px;
  animation: floatIn 0.42s ease both;
  transition:
    transform 0.24s ease,
    box-shadow 0.24s ease;
}

.world-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.06);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.entry-type {
  display: inline-flex;
  align-items: center;
  border-radius: 10px;
  background: #f8fafc;
  color: #86868b;
  font-size: 12px;
  font-weight: 650;
  padding: 7px 10px;
  transition: all 0.2s ease;
}

.world-card:hover .entry-type {
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
  color: var(--arc-primary);
}

.more-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #c4cad4;
  cursor: pointer;
}

.more-button:hover {
  color: #6b7280;
}

.world-card h3 {
  margin: 0 0 12px;
  color: #1d1d1f;
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.03em;
}

.world-card p {
  margin: 0;
  color: #86868b;
  font-size: 14px;
  line-height: 1.8;
}

.empty-card {
  display: flex;
  min-height: 212px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 2px dashed rgba(229, 231, 235, 0.95);
  border-radius: 28px;
  background: transparent;
  color: #86868b;
  cursor: pointer;
  font-size: 15px;
  font-weight: 650;
  transition: all 0.24s ease;
}

.empty-card:hover {
  background: color-mix(in srgb, var(--arc-primary) 5%, white);
  border-color: color-mix(in srgb, var(--arc-primary) 20%, white);
  color: var(--arc-primary);
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
  .soft-button,
  .primary-button {
    flex: 1 1 100%;
    justify-content: center;
  }

  .world-grid {
    grid-template-columns: 1fr;
  }
}

@keyframes floatIn {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
