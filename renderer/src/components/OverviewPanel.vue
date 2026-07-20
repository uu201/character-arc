<script setup lang="ts">
import { computed } from 'vue'
import { BookCopy, ChevronRight, Clock3, FileText, GitMerge, Lightbulb, Network, PenLine, Users } from 'lucide-vue-next'
import { getChapterCharacterCount, getChapterPreviewText } from '@/features/chapters/editorContent'
import { formatProjectEditedAt } from '@/features/projects/lastEdited'
import { resolveNovelLengthLabel } from '@/features/wizard/projectGenres'
import { useAppStore } from '@/stores/app'
import type { PanelName } from '@/types/app'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词，用于过滤概览中的快速入口
}>()

const appStore = useAppStore()

const normalizedQuery = computed(() => props.searchQuery?.trim().toLowerCase() ?? '')
const currentProject = computed(() => appStore.currentProject)
const projectMeta = computed(() =>
  [currentProject.value?.genre?.trim(), resolveNovelLengthLabel(currentProject.value?.novelLength)]
    .filter(Boolean)
    .join(' · ')
)
// 各维度的统计数据，用于概览仪表盘
const totalCharacters = computed(() => appStore.characters.length)
const totalOrganizations = computed(() => appStore.organizations.length)
const totalRelationships = computed(() => appStore.characterRelationships.length)
const totalOutlineItems = computed(() => appStore.outlineItems.length)
const totalInspirationItems = computed(() => appStore.inspirationEntries.length)
const totalChapters = computed(() => appStore.chapters.length)
// 统计所有章节的累计字数（使用富文本字数计算）
const totalWords = computed(() =>
  appStore.chapters.reduce((count, chapter) => count + getChapterCharacterCount(chapter.content), 0)
)

// 概览仪表盘的统计卡片配置：累计字数、角色数量、关系组织、灵感卡片、大纲节点、章节草稿
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

// 快速入口数据：聚合所有模块内容（世界观、角色、组织、关系、灵感、大纲、章节），
// 无搜索时仅展示前 6 条，有搜索时按关键词过滤后取前 6 条
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

// 当前聚焦的章节，优先使用已选章节，否则取第一章
const recentChapter = computed(() => appStore.selectedChapter ?? appStore.chapters[0])

// 导航到指定面板
function goToPanel(panel: PanelName): void {
  appStore.setPanel(panel)
}

// 点击快速入口卡片后，根据类型导航到对应面板或选中具体章节
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
    <header class="overview-header">
      <div class="overview-heading">
        <span class="overview-kicker">作品概览</span>
        <h2>{{ currentProject?.title ?? '未命名作品' }}</h2>
        <div class="project-meta">
          <span v-if="projectMeta">{{ projectMeta }}</span>
          <span v-if="projectMeta" class="meta-divider" aria-hidden="true" />
          <span class="edited-time">
            <Clock3 :size="13" />
            {{ formatProjectEditedAt(currentProject?.lastEdited) }}
          </span>
        </div>
      </div>
      <button type="button" class="continue-action" @click="appStore.setPanel('chapters')">
        <PenLine :size="16" />
        <span>继续创作</span>
      </button>
    </header>

    <div class="current-focus">
      <span>当前章节</span>
      <button type="button" @click="appStore.setPanel('chapters')">
        {{ recentChapter?.title ?? '暂无章节' }}
        <ChevronRight :size="14" />
      </button>
    </div>

    <section class="stats-section" aria-labelledby="overview-stats-title">
      <div class="subsection-head">
        <h3 id="overview-stats-title">创作数据</h3>
      </div>
      <div class="stats-grid">
        <button
          v-for="card in overviewCards"
          :key="card.key"
          type="button"
          class="stat-card"
          :title="`${card.label}：${card.hint}`"
          @click="goToPanel(card.target)"
        >
          <div class="stat-icon">
            <component :is="card.icon" :size="16" />
          </div>
          <div class="stat-copy">
            <strong>{{ card.value }}</strong>
            <span>{{ card.label }}</span>
          </div>
        </button>
      </div>
    </section>

    <section class="focus-section" aria-labelledby="overview-focus-title">
      <div class="subsection-head focus-head">
        <h3 id="overview-focus-title">重点内容</h3>
        <span v-if="normalizedQuery">搜索结果：{{ quickEntries.length }} 条</span>
        <span v-else>{{ quickEntries.length }} 项</span>
      </div>

      <div v-if="quickEntries.length > 0" class="focus-list">
        <button
          v-for="entry in quickEntries"
          :key="entry.id"
          type="button"
          class="focus-row"
          @click="openEntry(entry.type, entry.title)"
        >
          <span class="focus-type">{{ entry.type }}</span>
          <span class="focus-copy">
            <strong>{{ entry.title }}</strong>
            <span>{{ entry.description }}</span>
          </span>
          <ChevronRight class="focus-arrow" :size="16" />
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
  max-width: 1160px;
  margin: 0 auto;
  min-width: 0;
  padding: 4px 2px 32px;
}

.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 2px 0 20px;
  border-bottom: 1px solid var(--arc-border);
}

.overview-heading {
  min-width: 0;
}

.overview-kicker {
  display: block;
  margin-bottom: 7px;
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 600;
}

.overview-heading h2 {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0;
  color: var(--arc-text-primary);
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 9px;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.meta-divider {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--arc-text-hint);
}

.edited-time {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.continue-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: var(--arc-radius-md);
  background: var(--arc-primary);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 7px 13px;
  transition:
    background 0.16s ease,
    transform 0.16s ease;
}

.continue-action:hover {
  background: var(--arc-primary-hover);
}

.continue-action:active {
  transform: translateY(1px);
}

.current-focus {
  display: flex;
  min-height: 46px;
  align-items: center;
  gap: 18px;
  border-bottom: 1px solid var(--arc-border);
}

.current-focus > span {
  flex-shrink: 0;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.current-focus button {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: var(--arc-text-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.current-focus button:hover {
  color: var(--arc-primary);
}

.stats-section,
.focus-section {
  margin-top: 28px;
}

.subsection-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.subsection-head h3 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0;
}

.subsection-head > span {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  border-top: 1px solid var(--arc-border);
  border-bottom: 1px solid var(--arc-border);
}

.stat-card {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  border: 0;
  border-left: 1px solid var(--arc-border);
  background: transparent;
  cursor: pointer;
  padding: 15px 13px;
  text-align: left;
  transition: background 0.16s ease;
}

.stat-card:first-child {
  border-left: 0;
}

.stat-card:hover {
  background: var(--arc-bg-surface-hover);
}

.stat-icon {
  display: inline-flex;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--arc-text-hint);
}

.stat-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.stat-copy span {
  overflow: hidden;
  color: var(--arc-text-hint);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-copy strong {
  overflow: hidden;
  font-size: 17px;
  font-weight: 650;
  letter-spacing: 0;
  color: var(--arc-text-primary);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focus-list {
  border-top: 1px solid var(--arc-border);
}

.focus-row {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 58px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 12px;
  border: 0;
  border-bottom: 1px solid var(--arc-border);
  background: transparent;
  cursor: pointer;
  padding: 13px 4px;
  text-align: left;
  transition: background 0.16s ease;
}

.focus-row:hover {
  background: var(--arc-bg-surface-hover);
}

.focus-type {
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 600;
}

.focus-copy {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(120px, 0.38fr) minmax(0, 1fr);
  align-items: center;
  gap: 20px;
}

.focus-copy strong,
.focus-copy > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focus-copy strong {
  color: var(--arc-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.focus-copy > span {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.focus-arrow {
  color: var(--arc-text-hint);
  transition:
    color 0.16s ease,
    transform 0.16s ease;
}

.focus-row:hover .focus-arrow {
  color: var(--arc-primary);
  transform: translateX(2px);
}

.empty-state {
  border: 1px dashed var(--arc-border);
  border-radius: var(--arc-radius-lg);
  padding: 24px;
  text-align: center;
  color: var(--arc-text-secondary);
  font-size: 13px;
}

@media (max-width: 1080px) {
  .stats-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .stat-card:nth-child(3n + 1) {
    border-left: 0;
  }

  .stat-card:nth-child(n + 4) {
    border-top: 1px solid var(--arc-border);
  }
}

@media (max-width: 720px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stat-card {
    border-left: 1px solid var(--arc-border);
  }

  .stat-card:nth-child(odd) {
    border-left: 0;
  }

  .stat-card:nth-child(n + 3) {
    border-top: 1px solid var(--arc-border);
  }
}

@media (max-width: 620px) {
  .overview-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 16px;
  }

  .overview-heading h2 {
    font-size: 22px;
  }

  .continue-action {
    align-self: flex-start;
  }

  .focus-copy {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}

@media (max-width: 460px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .stat-card,
  .stat-card:nth-child(odd) {
    border-left: 0;
  }

  .stat-card:nth-child(n + 2) {
    border-top: 1px solid var(--arc-border);
  }
}
</style>
