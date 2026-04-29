<script setup lang="ts">
import { computed } from 'vue'
import { BookCopy, Clock3, FileText, GitMerge, Lightbulb, Network, Sparkles, Users } from 'lucide-vue-next'
import { getChapterCharacterCount, getChapterPreviewText } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import type { PanelName } from '@/types/app'

const props = defineProps<{
  searchQuery?: string
}>()

const appStore = useAppStore()

const normalizedQuery = computed(() => props.searchQuery?.trim().toLowerCase() ?? '')
const currentProject = computed(() => appStore.currentProject)
const totalCharacters = computed(() => appStore.characters.length)
const totalOrganizations = computed(() => appStore.organizations.length)
const totalRelationships = computed(() => appStore.characterRelationships.length)
const totalOutlineItems = computed(() => appStore.outlineItems.length)
const totalInspirationItems = computed(() => appStore.inspirationEntries.length)
const totalChapters = computed(() => appStore.chapters.length)
const totalWords = computed(() =>
  appStore.chapters.reduce((count, chapter) => count + getChapterCharacterCount(chapter.content), 0)
)

const overviewCards = computed(() => [
  {
    key: 'words',
    label: '累计字数',
    value: `${totalWords.value.toLocaleString()} 字`,
    hint: '正文总量',
    icon: FileText,
    target: 'chapters' as PanelName
  },
  {
    key: 'characters',
    label: '角色数量',
    value: `${totalCharacters.value} 名`,
    hint: '已建角色',
    icon: Users,
    target: 'characters' as PanelName
  },
  {
    key: 'relations',
    label: '关系组织',
    value: `${totalOrganizations.value + totalRelationships.value} 项`,
    hint: `${totalOrganizations.value} 个组织 / ${totalRelationships.value} 条关系`,
    icon: Network,
    target: 'relations' as PanelName
  },
  {
    key: 'inspiration',
    label: '灵感卡片',
    value: `${totalInspirationItems.value} 张`,
    hint: '可扩写素材',
    icon: Lightbulb,
    target: 'inspiration' as PanelName
  },
  {
    key: 'outline',
    label: '大纲节点',
    value: `${totalOutlineItems.value} 条`,
    hint: '剧情推进',
    icon: GitMerge,
    target: 'outline' as PanelName
  },
  {
    key: 'chapters',
    label: '章节草稿',
    value: `${totalChapters.value} 章`,
    hint: '创作进度',
    icon: BookCopy,
    target: 'chapters' as PanelName
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
    ...appStore.organizations.map((organization) => ({
      id: `organization-${organization.id}`,
      type: '组织',
      title: organization.name,
      description: organization.description
    })),
    ...appStore.characterRelationships.map((relationship) => {
      const fromCharacter = appStore.characters.find((item) => item.id === relationship.fromCharacterId)
      const toCharacter = appStore.characters.find((item) => item.id === relationship.toCharacterId)

      return {
        id: `relationship-${relationship.id}`,
        type: '关系',
        title: `${fromCharacter?.name ?? '未绑定角色'} - ${toCharacter?.name ?? '未绑定角色'}`,
        description: relationship.description
      }
    }),
    ...appStore.inspirationEntries.map((entry) => ({
      id: `inspiration-${entry.id}`,
      type: '灵感',
      title: entry.title,
      description: entry.content
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
      description: getChapterPreviewText(chapter.content, '章节尚未写入内容')
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

function goToPanel(panel: PanelName): void {
  appStore.setPanel(panel)
}

function openEntry(type: string, title: string): void {
  if (type === '章节') {
    const chapter = appStore.chapters.find((item) => item.title === title)
    if (chapter) {
      appStore.selectChapter(chapter.id)
    }
    return
  }

  if (type === '角色') {
    appStore.setPanel('characters')
    return
  }

  if (type === '组织' || type === '关系') {
    appStore.setPanel('relations')
    return
  }

  if (type === '大纲') {
    appStore.setPanel('outline')
    return
  }

  if (type === '灵感') {
    appStore.setPanel('inspiration')
    return
  }

  appStore.setPanel('world')
}
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
        <div class="hero-card-top">
          <span class="hero-genre">{{ currentProject?.genre }}</span>
          <button class="hero-action" @click="appStore.setPanel('chapters')">
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
        <button
          v-for="card in overviewCards"
          :key="card.key"
          class="stat-card"
          @click="goToPanel(card.target)"
        >
          <div class="stat-icon">
            <component :is="card.icon" :size="18" />
          </div>
          <div class="stat-copy">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
            <small>{{ card.hint }}</small>
          </div>
        </button>
      </div>
    </div>

    <section class="focus-section">
      <div class="focus-head">
        <h4>重点内容</h4>
        <span v-if="normalizedQuery">搜索结果：{{ quickEntries.length }} 条</span>
        <span v-else>按当前项目内容聚合</span>
      </div>

      <div v-if="quickEntries.length > 0" class="focus-list">
        <button
          v-for="entry in quickEntries"
          :key="entry.id"
          class="focus-card"
          @click="openEntry(entry.type, entry.title)"
        >
          <span class="focus-type">{{ entry.type }}</span>
          <h5>{{ entry.title }}</h5>
          <p>{{ entry.description }}</p>
        </button>
      </div>
      <div v-else class="arc-empty-state">
        <p>没有匹配“{{ normalizedQuery }}”的项目内容。</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.overview-panel {
  max-width: 1180px;
  margin: 0 auto;
  min-width: 0;
}

.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.section-head h2 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--arc-text-primary);
}

.section-head p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--arc-radius-sm);
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12px;
  padding: 6px 10px;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.95fr);
  gap: clamp(12px, 1.6vw, 18px);
  margin-bottom: 20px;
}

.hero-card {
  overflow: hidden;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  padding: clamp(20px, 2.2vw, 24px);
}

.hero-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

.hero-genre {
  display: inline-flex;
  align-items: center;
  border-radius: var(--arc-radius-sm);
  background: var(--arc-bg-body);
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  letter-spacing: 0.01em;
}

.hero-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--arc-primary);
  border-radius: var(--arc-radius-md);
  background: transparent;
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 12px;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.hero-action:hover {
  background: var(--arc-primary-soft);
}

.hero-card h3 {
  margin: 0 0 12px;
  font-size: clamp(18px, 2vw, 22px);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--arc-text-primary);
}

.hero-card p {
  max-width: 44rem;
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.stat-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  cursor: pointer;
  padding: 14px 16px;
  text-align: left;
  transition: border-color 0.16s ease;
}

.stat-card:hover {
  border-color: var(--arc-primary);
}

.stat-icon {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: var(--arc-radius-md);
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  flex-shrink: 0;
}

.stat-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-copy span {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.stat-copy strong {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--arc-text-primary);
  font-variant-numeric: tabular-nums;
}

.stat-copy small {
  color: var(--arc-text-hint);
  font-size: 11px;
}

.focus-section {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  padding: clamp(16px, 2vw, 20px);
}

.focus-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.focus-head h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.focus-head span {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.focus-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.focus-card {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  background: var(--arc-bg-surface);
  cursor: pointer;
  padding: 14px;
  text-align: left;
  transition: border-color 0.16s ease;
}

.focus-card:hover {
  border-color: var(--arc-primary);
}

.focus-type {
  display: inline-flex;
  align-items: center;
  border-radius: var(--arc-radius-sm);
  background: var(--arc-bg-body);
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 500;
  padding: 2px 7px;
  margin-bottom: 8px;
}

.focus-card h5 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--arc-text-primary);
}

.focus-card p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.empty-state {
  border: 1px dashed var(--arc-border);
  border-radius: var(--arc-radius-lg);
  padding: 24px;
  text-align: center;
  color: var(--arc-text-secondary);
  font-size: 13px;
}

@media (max-width: 1240px) {
  .hero-card p {
    font-size: 13px;
  }
}

@media (max-width: 1080px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 780px) {
  .stats-grid {
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
