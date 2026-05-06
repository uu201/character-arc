<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChapterAssistantQuickAction } from '@/features/ai/chapterAssistantOptions'
import type { AiRunKnowledgeItem, AiRunRecord } from '@/types/app'
import { chapterAssistantQuickActionGroups } from '@/features/ai/chapterAssistantOptions'

type DisplayAiRun = AiRunRecord & {
  startedAtLabel: string
  taskLabel: string
  statusText: string
}

const props = defineProps<{
  quickActions: ChapterAssistantQuickAction[]
  selectedExcerpt: string
  recentAiRuns?: DisplayAiRun[]
  latestAiRun: AiRunRecord | undefined
  latestAiRunKnowledge: AiRunKnowledgeItem[]
  latestAiRunStatusText: string
  isResponding: boolean
  commandOnly?: boolean
}>()

const emit = defineEmits<{
  quickAction: [action: ChapterAssistantQuickAction]
}>()

const groupedQuickActions = computed(() =>
  chapterAssistantQuickActionGroups
    .map((group) => ({
      ...group,
      items: props.quickActions.filter((action) => action.group === group.key)
    }))
    .filter((group) => group.items.length > 0)
)

const expandedKnowledgeIds = ref<string[]>([])
const KNOWLEDGE_SNIPPET_PREVIEW_LENGTH = 140

const latestAiRunKnowledgeDisplay = computed(() =>
  props.latestAiRunKnowledge.map((item) => {
    const normalizedSnippet = item.snippet.replace(/\s+/g, ' ').trim()
    const isTruncated = normalizedSnippet.length > KNOWLEDGE_SNIPPET_PREVIEW_LENGTH
    const preview = isTruncated
      ? `${normalizedSnippet.slice(0, KNOWLEDGE_SNIPPET_PREVIEW_LENGTH).trimEnd()}...`
      : normalizedSnippet
    const key = `${props.latestAiRun?.id ?? 'run'}-${item.documentId}`
    const expanded = expandedKnowledgeIds.value.includes(key)
    return {
      ...item,
      displaySnippet: expanded || !isTruncated ? normalizedSnippet : preview,
      isTruncated,
      expanded,
      key
    }
  })
)

function toggleKnowledgeSnippet(key: string): void {
  if (expandedKnowledgeIds.value.includes(key)) {
    expandedKnowledgeIds.value = expandedKnowledgeIds.value.filter((item) => item !== key)
    return
  }

  expandedKnowledgeIds.value = [...expandedKnowledgeIds.value, key]
}
</script>

<template>
  <section class="claude-assistant-context arc-scrollbar" :class="{ 'claude-assistant-context--commands': props.commandOnly }">
    <template v-if="props.commandOnly">
      <div class="claude-assistant-context__section claude-assistant-context__section--commands">
        <div class="claude-assistant-context__head claude-assistant-context__head--commands">
          <strong>命令菜单</strong>
        </div>

        <div class="claude-assistant-command-groups">
          <section v-for="group in groupedQuickActions" :key="group.key" class="claude-assistant-command-group">
            <header class="claude-assistant-command-group__head">
              <strong>{{ group.label }}</strong>
              <span>{{ group.description }}</span>
            </header>

            <div class="claude-assistant-command-list">
              <button
                v-for="action in group.items"
                :key="action.id"
                type="button"
                class="claude-assistant-command-item"
                :disabled="props.isResponding || (action.requiresSelection && !props.selectedExcerpt)"
                :title="action.requiresSelection && !props.selectedExcerpt ? '请先在正文中选中内容' : action.prompt"
                @click="emit('quickAction', action)"
              >
                <span class="claude-assistant-command-item__prefix">/</span>
                <component :is="action.icon" :size="13" class="claude-assistant-command-item__icon" />
                <span class="claude-assistant-command-item__body">
                  <strong>{{ action.label }}</strong>
                  <span>{{ action.requiresSelection ? '需要选区' : '直接执行' }}</span>
                </span>
                <span class="claude-assistant-command-item__meta">{{ group.label }}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </template>

    <template v-else>
      <section v-if="props.latestAiRun" class="claude-assistant-context__section">
        <div class="claude-assistant-context__head">
          <strong>最近一次运行</strong>
          <span>{{ props.latestAiRunStatusText }}</span>
        </div>
        <div class="claude-assistant-run-meta">
          <span>{{ props.latestAiRun.model }}</span>
          <span v-if="props.latestAiRun.durationMs">{{ Math.max(1, Math.round(props.latestAiRun.durationMs / 100) / 10) }}s</span>
          <span v-if="props.latestAiRun.repairTriggered">已触发修复</span>
        </div>
        <p v-if="props.latestAiRun.error" class="claude-assistant-run-error">{{ props.latestAiRun.error }}</p>

        <div v-if="latestAiRunKnowledgeDisplay.length" class="claude-assistant-knowledge-list">
          <article v-for="item in latestAiRunKnowledgeDisplay" :key="item.key" class="claude-assistant-knowledge-item">
            <div class="claude-assistant-knowledge-item__title">
              <strong>{{ item.title }}</strong>
              <span>{{ item.sourceLabel || item.sourceType }}</span>
            </div>
            <p>{{ item.displaySnippet }}</p>
            <button
              v-if="item.isTruncated"
              type="button"
              class="claude-assistant-inline-btn claude-assistant-inline-btn--ghost"
              @click="toggleKnowledgeSnippet(item.key)"
            >
              {{ item.expanded ? '收起片段' : '展开片段' }}
            </button>
            <div v-if="item.keywords.length" class="claude-assistant-tag-row">
              <span v-for="keyword in item.keywords" :key="keyword">{{ keyword }}</span>
            </div>
          </article>
        </div>
        <p v-else class="claude-assistant-empty-copy">这次运行没有召回到额外知识片段，回复主要依赖当前章节上下文。</p>
      </section>

      <section v-if="(props.recentAiRuns?.length ?? 0) > 0" class="claude-assistant-context__section">
        <div class="claude-assistant-context__head">
          <strong>最近运行记录</strong>
          <span>只展示当前项目和当前章节相关记录</span>
        </div>

        <div class="claude-assistant-run-list">
          <article
            v-for="run in props.recentAiRuns"
            :key="run.id"
            class="claude-assistant-run-item"
            :class="`is-${run.status}`"
          >
            <div class="claude-assistant-run-item__main">
              <div class="claude-assistant-run-item__title">
                <strong>{{ run.taskLabel }}</strong>
                <span>{{ run.statusText }}</span>
              </div>
              <div class="claude-assistant-run-meta claude-assistant-run-meta--compact">
                <span>{{ run.model }}</span>
                <span>{{ run.startedAtLabel }}</span>
                <span v-if="run.durationMs">{{ Math.max(1, Math.round(run.durationMs / 100) / 10) }}s</span>
                <span>{{ run.usedKnowledge.length }} 条知识</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>
