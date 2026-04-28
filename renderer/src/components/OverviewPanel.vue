<script setup lang="ts">
import { computed } from 'vue'
import { BookCopy, Clock3, FileText, GitMerge, Sparkles, Users } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'

const props = defineProps<{
  searchQuery?: string
}>()

const appStore = useAppStore()

const normalizedQuery = computed(() => props.searchQuery?.trim().toLowerCase() ?? '')
const currentProject = computed(() => appStore.currentProject)
const totalCharacters = computed(() => appStore.characters.length)
const totalOutlineItems = computed(() => appStore.outlineItems.length)
const totalChapters = computed(() => appStore.chapters.length)
const totalWords = computed(() =>
  appStore.chapters.reduce((count, chapter) => count + chapter.content.trim().length, 0)
)

const overviewCards = computed(() => [
  {
    key: 'words',
    label: '累计字数',
    value: `${totalWords.value.toLocaleString()} 字`,
    hint: '正文总量',
    icon: FileText
  },
  {
    key: 'characters',
    label: '角色数量',
    value: `${totalCharacters.value} 名`,
    hint: '已建角色',
    icon: Users
  },
  {
    key: 'outline',
    label: '大纲节点',
    value: `${totalOutlineItems.value} 条`,
    hint: '剧情推进',
    icon: GitMerge
  },
  {
    key: 'chapters',
    label: '章节草稿',
    value: `${totalChapters.value} 章`,
    hint: '创作进度',
    icon: BookCopy
  }
])

const quickEntries = computed(() => {
  const groups = [
    ...appStore.worldviewEntries.map((entry) => ({
      id: `world-${entry.id}`,
      type: '世界观',
      title: entry.title,
      description: entry.content
    })),
    ...appStore.characters.map((character) => ({
      id: `character-${character.id}`,
      type: '角色',
      title: character.name,
      description: character.description
    })),
    ...appStore.outlineItems.map((item) => ({
      id: `outline-${item.id}`,
      type: '大纲',
      title: item.title,
      description: item.summary
    })),
    ...appStore.chapters.map((chapter) => ({
      id: `chapter-${chapter.id}`,
      type: '章节',
      title: chapter.title,
      description: chapter.content || '章节尚未写入内容'
    }))
  ]

  if (!normalizedQuery.value) {
    return groups.slice(0, 6)
  }

  return groups
    .filter((item) =>
      `${item.type} ${item.title} ${item.description}`.toLowerCase().includes(normalizedQuery.value)
    )
    .slice(0, 6)
})

const recentChapter = computed(() => appStore.selectedChapter ?? appStore.chapters[0])
</script>

<template>
  <section class="overview-panel">
    <div class="section-head">
      <div>
        <h2>作品概览</h2>
        <p>快速查看当前项目的创作状态、结构规模和重点内容。</p>
      </div>
      <div class="status-chip">
        <Clock3 :size="14" />
        <span>{{ currentProject?.lastEdited ?? '刚刚更新' }}</span>
      </div>
    </div>

    <div class="overview-grid">
      <article class="hero-card">
        <div class="hero-card-glow" :style="{ background: currentProject?.cover }"></div>
        <div class="hero-card-top">
          <span class="hero-genre">{{ currentProject?.genre }}</span>
          <button class="hero-action">
            <Sparkles :size="16" />
            <span>继续创作</span>
          </button>
        </div>
        <h3>{{ currentProject?.title ?? '未命名作品' }}</h3>
        <p>
          当前聚焦章节：{{ recentChapter?.title ?? '暂无章节' }}。你可以从这里继续推进正文、补充设定或整理大纲。
        </p>
      </article>

      <div class="stats-grid">
        <article v-for="card in overviewCards" :key="card.key" class="stat-card">
          <div class="stat-icon">
            <component :is="card.icon" :size="18" />
          </div>
          <div class="stat-copy">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
            <small>{{ card.hint }}</small>
          </div>
        </article>
      </div>
    </div>

    <section class="focus-section">
      <div class="focus-head">
        <h4>重点内容</h4>
        <span v-if="normalizedQuery">搜索结果：{{ quickEntries.length }} 条</span>
        <span v-else>按当前项目内容聚合</span>
      </div>

      <div v-if="quickEntries.length > 0" class="focus-list">
        <article v-for="entry in quickEntries" :key="entry.id" class="focus-card">
          <span class="focus-type">{{ entry.type }}</span>
          <h5>{{ entry.title }}</h5>
          <p>{{ entry.description }}</p>
        </article>
      </div>
      <div v-else class="empty-state">
        <p>没有匹配“{{ normalizedQuery }}”的项目内容。</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.overview-panel {
  max-width: 1180px;
  margin: 0 auto;
}

.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 28px;
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

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  color: #6b7280;
  padding: 10px 14px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04);
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.95fr);
  gap: 22px;
  margin-bottom: 24px;
}

.hero-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 30px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96));
  padding: 28px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}

.hero-card-glow {
  position: absolute;
  top: -48px;
  right: -42px;
  width: 190px;
  height: 190px;
  border-radius: 999px;
  filter: blur(56px);
  opacity: 0.12;
}

.hero-card-top,
.hero-card h3,
.hero-card p {
  position: relative;
  z-index: 1;
}

.hero-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
}

.hero-genre {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(243, 244, 246, 0.94);
  color: #6b7280;
  font-size: 12px;
  font-weight: 650;
  padding: 8px 12px;
}

.hero-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 650;
  padding: 10px 14px;
}

.hero-card h3 {
  margin: 0 0 14px;
  font-size: clamp(28px, 3vw, 34px);
  font-weight: 700;
  letter-spacing: -0.04em;
}

.hero-card p {
  max-width: 44rem;
  margin: 0;
  color: #4b5563;
  font-size: 15px;
  line-height: 1.8;
}

.stats-grid {
  display: grid;
  gap: 16px;
}

.stat-card {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 24px;
  background: white;
  padding: 18px 20px;
  box-shadow: 0 6px 22px rgba(15, 23, 42, 0.03);
}

.stat-icon {
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
  color: var(--arc-primary);
  flex-shrink: 0;
}

.stat-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.stat-copy span {
  color: #6b7280;
  font-size: 13px;
}

.stat-copy strong {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.stat-copy small {
  color: #9ca3af;
  font-size: 12px;
}

.focus-section {
  border: 1px solid rgba(243, 244, 246, 0.9);
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.9);
  padding: 24px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.03);
}

.focus-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.focus-head h4 {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
}

.focus-head span {
  color: #86868b;
  font-size: 13px;
}

.focus-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}

.focus-card {
  border: 1px solid rgba(243, 244, 246, 0.95);
  border-radius: 22px;
  background: white;
  padding: 16px;
}

.focus-type {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: #f5f5f7;
  color: #6b7280;
  font-size: 11px;
  font-weight: 650;
  padding: 6px 10px;
  margin-bottom: 10px;
}

.focus-card h5 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 650;
}

.focus-card p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.empty-state {
  border: 1px dashed rgba(209, 213, 219, 0.95);
  border-radius: 22px;
  padding: 24px;
  text-align: center;
  color: #86868b;
  font-size: 14px;
}

@media (max-width: 1080px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .hero-card-top,
  .focus-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
