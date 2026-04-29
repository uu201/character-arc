<script setup lang="ts">
import { computed } from 'vue'
import { BookOpenText, FileText, GitMerge, Globe2, Lightbulb, Network, Search, Sparkles, Users } from 'lucide-vue-next'
import { getChapterCharacterCount, getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import type { PanelName } from '@/types/app'

const props = defineProps<{
  query: string
}>()

const emit = defineEmits<{
  openResult: [payload: { panel: PanelName; chapterId?: string }]
}>()

const appStore = useAppStore()

type ResultGroup = {
  id: string
  label: string
  panel: PanelName
  icon: typeof Globe2
  accent: string
  items: Array<{
    id: string
    title: string
    summary: string
    meta?: string
    chapterId?: string
  }>
}

const normalizedQuery = computed(() => props.query.trim().toLowerCase())

const resultGroups = computed<ResultGroup[]>(() => {
  const query = normalizedQuery.value
  if (!query) {
    return []
  }

  const worldviewItems = appStore.worldviewEntries
    .filter((entry) => `${entry.type} ${entry.title} ${entry.content}`.toLowerCase().includes(query))
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      summary: entry.content,
      meta: entry.type
    }))

  const characterItems = appStore.characters
    .filter((character) =>
      `${character.name} ${character.role} ${character.description} ${character.tags.map((tag) => tag.label).join(' ')}`
        .toLowerCase()
        .includes(query)
    )
    .map((character) => ({
      id: character.id,
      title: character.name,
      summary: character.description,
      meta: character.role || '待设定'
    }))

  const relationItems = [
    ...appStore.organizations
      .filter((organization) =>
        `${organization.name} ${organization.type} ${organization.description} ${organization.motto}`
          .toLowerCase()
          .includes(query)
      )
      .map((organization) => ({
        id: `organization-${organization.id}`,
        title: organization.name,
        summary: organization.description,
        meta: `组织 · ${organization.type}`
      })),
    ...appStore.characterRelationships
      .filter((relationship) => {
        const fromCharacter = appStore.characters.find((character) => character.id === relationship.fromCharacterId)
        const toCharacter = appStore.characters.find((character) => character.id === relationship.toCharacterId)

        return `${relationship.type} ${relationship.description} ${fromCharacter?.name ?? ''} ${toCharacter?.name ?? ''}`
          .toLowerCase()
          .includes(query)
      })
      .map((relationship) => {
        const fromCharacter = appStore.characters.find((character) => character.id === relationship.fromCharacterId)
        const toCharacter = appStore.characters.find((character) => character.id === relationship.toCharacterId)

        return {
          id: `relationship-${relationship.id}`,
          title: `${fromCharacter?.name ?? '未绑定角色'} - ${toCharacter?.name ?? '未绑定角色'}`,
          summary: relationship.description,
          meta: `关系 · ${relationship.type}`
        }
      }),
    ...appStore.organizationMemberships
      .filter((membership) => {
        const character = appStore.characters.find((item) => item.id === membership.characterId)
        const organization = appStore.organizations.find((item) => item.id === membership.organizationId)

        return `${membership.role} ${membership.notes} ${character?.name ?? ''} ${organization?.name ?? ''}`
          .toLowerCase()
          .includes(query)
      })
      .map((membership) => {
        const character = appStore.characters.find((item) => item.id === membership.characterId)
        const organization = appStore.organizations.find((item) => item.id === membership.organizationId)

        return {
          id: `membership-${membership.id}`,
          title: `${character?.name ?? '未绑定角色'} · ${organization?.name ?? '未绑定组织'}`,
          summary: membership.notes || '待补充成员归属说明',
          meta: `归属 · ${membership.role}`
        }
      })
  ]

  const outlineItems = appStore.outlineItems
    .filter((item) => `${item.title} ${item.conflict} ${item.summary}`.toLowerCase().includes(query))
    .map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      meta: item.wordTarget
    }))

  const inspirationItems = appStore.inspirationEntries
    .filter((entry) => `${entry.type} ${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase().includes(query))
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      summary: entry.content,
      meta: `${entry.type} · ${entry.source === 'ai' ? 'AI' : '手记'}`
    }))

  const chapterItems = appStore.chapters
    .filter((chapter) =>
      `${chapter.title} ${chapter.summary} ${chapter.wordTarget} ${chapter.status} ${getPlainTextFromEditorContent(chapter.content)}`
        .toLowerCase()
        .includes(query)
    )
    .map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary || getChapterPreviewText(chapter.content),
      meta: `${chapter.wordTarget} · ${getChapterCharacterCount(chapter.content)} 字`,
      chapterId: chapter.id
    }))

  return [
    {
      id: 'world',
      label: '世界观设定',
      panel: 'world' as PanelName,
      icon: Globe2,
      accent: 'rgba(59, 130, 246, 0.12)',
      items: worldviewItems
    },
    {
      id: 'characters',
      label: '角色图鉴',
      panel: 'characters' as PanelName,
      icon: Users,
      accent: 'rgba(244, 114, 182, 0.12)',
      items: characterItems
    },
    {
      id: 'relations',
      label: '关系组织',
      panel: 'relations' as PanelName,
      icon: Network,
      accent: 'rgba(59, 130, 246, 0.12)',
      items: relationItems
    },
    {
      id: 'inspiration',
      label: '灵感模块',
      panel: 'inspiration' as PanelName,
      icon: Lightbulb,
      accent: 'rgba(59, 130, 246, 0.1)',
      items: inspirationItems
    },
    {
      id: 'outline',
      label: '剧情大纲',
      panel: 'outline' as PanelName,
      icon: GitMerge,
      accent: 'rgba(16, 185, 129, 0.12)',
      items: outlineItems
    },
    {
      id: 'chapters',
      label: '章节创作',
      panel: 'chapters' as PanelName,
      icon: FileText,
      accent: 'rgba(251, 146, 60, 0.14)',
      items: chapterItems
    }
  ].filter((group) => group.items.length > 0)
})

const totalCount = computed(() => resultGroups.value.reduce((count, group) => count + group.items.length, 0))

function openGroupResult(group: ResultGroup, item: ResultGroup['items'][number]): void {
  emit('openResult', {
    panel: group.panel,
    chapterId: item.chapterId
  })
}
</script>

<template>
  <section class="search-panel">
    <div class="search-hero">
      <div class="search-hero-copy">
        <div class="search-badge">
          <Search :size="15" />
          <span>项目级搜索</span>
        </div>
        <h2>“{{ query }}”的搜索结果</h2>
        <p>跨世界观、角色、灵感、大纲与章节统一检索，帮你更快回到需要继续处理的内容。</p>
      </div>
      <div class="search-summary">
        <strong>{{ totalCount }}</strong>
        <span>条命中结果</span>
      </div>
    </div>

    <div v-if="resultGroups.length > 0" class="result-groups">
      <section
        v-for="group in resultGroups"
        :key="group.id"
        class="result-group"
      >
        <header class="group-head">
          <div class="group-title">
            <div class="group-icon" :style="{ background: group.accent }">
              <component :is="group.icon" :size="16" />
            </div>
            <div>
              <h3>{{ group.label }}</h3>
              <p>{{ group.items.length }} 条结果</p>
            </div>
          </div>
        </header>

        <div class="group-grid">
          <button
            v-for="item in group.items"
            :key="item.id"
            class="result-card"
            @click="openGroupResult(group, item)"
          >
            <div class="result-card-meta">
              <span>{{ item.meta }}</span>
              <Sparkles :size="14" />
            </div>
            <h4>{{ item.title }}</h4>
            <p>{{ item.summary }}</p>
            <small>点击跳转到对应内容</small>
          </button>
        </div>
      </section>
    </div>

    <div v-else class="search-empty">
      <div class="search-empty-icon">
        <BookOpenText :size="22" />
      </div>
      <h3>没有找到匹配内容</h3>
      <p>可以换一个关键词，或者尝试搜索角色名、灵感标题、设定词条、章节标题和剧情片段。</p>
    </div>
  </section>
</template>

<style scoped>
.search-panel {
  max-width: 1180px;
  margin: 0 auto;
  min-width: 0;
}

.search-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 28px;
  padding: clamp(22px, 2.4vw, 30px);
  border: 1px solid rgba(229, 231, 235, 0.82);
  border-radius: 30px;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--arc-primary) 12%, white), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.94));
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.04);
}

.search-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
  margin-bottom: 14px;
}

.search-hero-copy h2 {
  margin: 0 0 10px;
  font-size: clamp(30px, 3.8vw, 40px);
  font-weight: 700;
  letter-spacing: -0.04em;
}

.search-hero-copy p {
  max-width: 52rem;
  margin: 0;
  color: #6b7280;
  font-size: 15px;
  line-height: 1.75;
}

.search-summary {
  display: inline-flex;
  min-width: 148px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 26px;
  background: white;
  padding: 20px 18px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
}

.search-summary strong {
  font-size: clamp(28px, 3vw, 36px);
  font-weight: 700;
  line-height: 1;
}

.search-summary span {
  margin-top: 6px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
}

.result-groups {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.result-group {
  border: 1px solid rgba(243, 244, 246, 0.92);
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.94);
  padding: clamp(18px, 2.2vw, 24px);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.03);
}

.group-head {
  margin-bottom: 16px;
}

.group-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.group-icon {
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  color: #1d1d1f;
  flex-shrink: 0;
}

.group-title h3 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
}

.group-title p {
  margin: 0;
  color: #86868b;
  font-size: 13px;
}

.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 14px;
}

.result-card {
  display: flex;
  min-height: 208px;
  flex-direction: column;
  border: 1px solid rgba(243, 244, 246, 0.95);
  border-radius: 24px;
  background: white;
  cursor: pointer;
  padding: 18px;
  text-align: left;
  transition:
    transform 0.22s ease,
    box-shadow 0.22s ease,
    border-color 0.22s ease;
}

.result-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--arc-primary) 14%, white);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
}

.result-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  color: #9ca3af;
  font-size: 11px;
  font-weight: 700;
}

.result-card h4 {
  margin: 0 0 10px;
  color: #1d1d1f;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.result-card p {
  display: -webkit-box;
  margin: 0 0 14px;
  overflow: hidden;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.75;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.result-card small {
  margin-top: auto;
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 700;
}

.search-empty {
  display: flex;
  min-height: 320px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(209, 213, 219, 0.9);
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.9);
  text-align: center;
  padding: 32px;
}

.search-empty-icon {
  display: inline-flex;
  width: 56px;
  height: 56px;
  align-items: center;
  justify-content: center;
  border-radius: 20px;
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
  color: var(--arc-primary);
  margin-bottom: 16px;
}

.search-empty h3 {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 700;
}

.search-empty p {
  max-width: 34rem;
  margin: 0;
  color: #6b7280;
  font-size: 14px;
  line-height: 1.7;
}

@media (max-width: 820px) {
  .search-summary {
    width: 100%;
    min-width: 0;
    align-items: flex-start;
  }

  .group-grid {
    grid-template-columns: 1fr;
  }
}
</style>
