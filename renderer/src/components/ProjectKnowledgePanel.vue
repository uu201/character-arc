<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { marked } from 'marked'
import { FileCheck2, History, RefreshCw, Sparkles } from 'lucide-vue-next'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NModal,
  NScrollbar,
  NSpace,
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { formatKnowledgeDateTime } from '@/features/knowledge/knowledgeCenter'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { KnowledgeDocument } from '@/types/app'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string
}

const isRunningStoryAudit = ref(false)
const isBackfillingState = ref(false)
const backfillProgress = ref<CharacterArcBackfillStateProgressPayload | null>(null)
const selectedAuditReport = ref<KnowledgeDocument | null>(null)

const cleanupBackfillProgress = window.characterArc.onBackfillStateProgress((payload) => {
  backfillProgress.value = payload
})

onBeforeUnmount(() => {
  cleanupBackfillProgress()
})

const auditReports = computed(() =>
  appStore.knowledgeDocuments
    .filter((doc) => doc.sourceType === 'canon-fact' && doc.sourceLabel === 'story-deep-audit')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
)

const latestAuditReport = computed(() => auditReports.value[0] ?? null)

const chapterCount = computed(() => appStore.chapters.length)
const validChapterCount = computed(
  () => appStore.chapters.filter((ch) => ch.content && ch.content.trim().length >= 50).length
)

const backfillButtonLabel = computed(() => {
  if (!isBackfillingState.value) return '从已有章节补录状态'
  if (backfillProgress.value) {
    return `补录中 ${backfillProgress.value.current}/${backfillProgress.value.total}`
  }
  return '补录中...'
})

async function runStoryDeepAudit(): Promise<void> {
  const project = appStore.currentProject
  if (!project) {
    message.warning('请先选择一个项目再执行一致性审计。')
    return
  }
  if (isRunningStoryAudit.value) {
    message.info('上一次一致性审计还在进行中，请稍候。')
    return
  }

  const currentChapterIndex = appStore.chapters.length

  isRunningStoryAudit.value = true
  const loading = message.loading('AI 正在对全局状态进行一致性审计，可能需要 1-2 分钟…', { duration: 0 })
  try {
    const response = await window.characterArc.generateAi(toIpcPayload({
      task: 'story-deep-audit',
      settings: appStore.appSettings,
      context: {
        projectId: project.id,
        projectTitle: project.title,
        projectGenre: project.genre,
        currentChapterIndex,
        projectSkills: await loadEnabledProjectSkillsContext(project, 'draft')
      }
    }))

    if (!response.success) {
      throw new Error(response.error ?? '一致性审计失败')
    }

    const reportContent = String((response.result as { content?: string })?.content ?? '').trim()
    if (!reportContent) {
      throw new Error('AI 未返回可读的审计报告内容。')
    }

    const now = new Date().toISOString()
    const title = `一致性审计报告·第 ${currentChapterIndex} 章节点`
    appStore.mergeKnowledgeDocuments([{
      id: `knowledge-story-audit-${Date.now()}`,
      title,
      sourceType: 'canon-fact',
      sourceLabel: 'story-deep-audit',
      content: reportContent,
      summary: reportContent.slice(0, 220),
      keywords: ['一致性审计', '伏笔健康度', '节奏评估', project.genre].map((v) => String(v).trim()).filter(Boolean),
      metadata: {
        auditTargetChapterIndex: currentChapterIndex,
        generatedAt: now
      },
      createdAt: now,
      updatedAt: now
    }])
    message.success('一致性审计完成，报告已归档。')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '一致性审计失败')
  } finally {
    loading.destroy()
    isRunningStoryAudit.value = false
  }
}

function runStateBackfill(): void {
  const project = appStore.currentProject
  if (!project) {
    message.warning('请先选择一个项目再执行状态补录。')
    return
  }
  if (isBackfillingState.value) {
    message.info('上一次状态补录还在进行中，请稍候。')
    return
  }
  if (!validChapterCount.value) {
    message.warning('当前项目还没有正文可以补录状态。')
    return
  }

  dialog.warning({
    title: '从已有章节补录状态库',
    content: `将对 ${validChapterCount.value} 个已有章节逐章调用 AI 提取状态变更并写入状态库。这会消耗较多 token（约 ${validChapterCount.value} 次 AI 调用）。确认继续？`,
    positiveText: '开始补录',
    negativeText: '取消',
    onPositiveClick: async () => {
      isBackfillingState.value = true
      backfillProgress.value = null
      try {
        const response = await window.characterArc.backfillProjectState({
          settings: appStore.appSettings,
          projectId: project.id
        })
        if (!response.success || !response.result) {
          throw new Error(response.error ?? '状态补录失败')
        }
        const { totalChapters, processedChapters, skipped } = response.result
        message.success(`状态补录完成：${processedChapters} / ${totalChapters} 章成功，${skipped} 章跳过。`)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '状态补录失败')
      } finally {
        isBackfillingState.value = false
        backfillProgress.value = null
      }
    }
  })
}

function deleteAuditReport(report: KnowledgeDocument): void {
  const project = appStore.currentProject
  if (!project) return

  dialog.warning({
    title: '删除审计报告',
    content: `确认删除「${report.title}」吗？此操作无法撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      appStore.removeKnowledgeDocuments([report.id])
      if (selectedAuditReport.value?.id === report.id) {
        selectedAuditReport.value = null
      }
      message.success('已删除审计报告')
    }
  })
}
</script>

<template>
  <section class="project-knowledge-screen">
    <header class="pk-header">
      <div class="pk-header-left">
        <strong>项目知识库</strong>
        <span class="pk-header-subtitle">沉淀项目级一致性审计与结构化世界状态</span>
      </div>
    </header>

    <div class="pk-grid">
      <n-card class="pk-card" size="small">
        <template #header>
          <div class="pk-card-title">
            <FileCheck2 :size="16" />
            <span>一致性审计</span>
          </div>
        </template>
        <template #header-extra>
          <n-button
            type="primary"
            size="small"
            :loading="isRunningStoryAudit"
            :disabled="!appStore.currentProject || isRunningStoryAudit"
            @click="runStoryDeepAudit"
          >
            <template #icon><Sparkles :size="14" /></template>
            {{ isRunningStoryAudit ? '审计中...' : '执行审计' }}
          </n-button>
        </template>

        <p class="pk-card-desc">
          基于当前世界状态（角色状态、伏笔、关系、时间线、世界规则）对项目进行整体一致性审计。
          报告会归档到下方"审计历史"列表，可随时查看。
        </p>

        <div class="pk-card-meta">
          <n-tag size="small" :bordered="false">当前章节数 {{ chapterCount }}</n-tag>
          <n-tag size="small" :bordered="false" type="info">历史报告 {{ auditReports.length }}</n-tag>
          <n-tag v-if="latestAuditReport" size="small" :bordered="false" type="success">
            最近审计 {{ formatKnowledgeDateTime(latestAuditReport.createdAt) }}
          </n-tag>
        </div>
      </n-card>

      <n-card class="pk-card" size="small">
        <template #header>
          <div class="pk-card-title">
            <RefreshCw :size="16" />
            <span>状态补录</span>
          </div>
        </template>
        <template #header-extra>
          <n-button
            size="small"
            :loading="isBackfillingState"
            :disabled="!appStore.currentProject || isBackfillingState || !validChapterCount"
            @click="runStateBackfill"
          >
            <template #icon><Sparkles :size="14" /></template>
            {{ backfillButtonLabel }}
          </n-button>
        </template>

        <p class="pk-card-desc">
          适用于已有章节但状态库为空的老项目：遍历所有已写章节，逐章调用 AI 提取角色状态、伏笔、关系等结构化数据。
          补录后，写作时才能用上世界状态注入。
        </p>

        <div class="pk-card-meta">
          <n-tag size="small" :bordered="false">可补录章节 {{ validChapterCount }}</n-tag>
          <n-tag v-if="isBackfillingState && backfillProgress" size="small" type="warning" :bordered="false">
            进度 {{ backfillProgress.current }} / {{ backfillProgress.total }}
          </n-tag>
        </div>
        <n-alert v-if="isBackfillingState && backfillProgress?.chapterTitle" type="info" :show-icon="false" class="pk-card-progress">
          正在处理：{{ backfillProgress.chapterTitle }}
        </n-alert>
      </n-card>
    </div>

    <section class="pk-history">
      <div class="pk-history-head">
        <div class="pk-history-title">
          <History :size="16" />
          <strong>审计历史</strong>
          <n-tag size="tiny" :bordered="false">{{ auditReports.length }} 份</n-tag>
        </div>
      </div>

      <n-empty v-if="!auditReports.length" description="还没有执行过一致性审计。" />
      <n-space v-else vertical size="small">
        <n-card
          v-for="report in auditReports"
          :key="report.id"
          size="small"
          hoverable
          class="pk-history-item"
          @click="selectedAuditReport = report"
        >
          <template #header>
            <div class="pk-history-item-title">
              <strong>{{ report.title }}</strong>
              <n-tag size="tiny" :bordered="false" type="info">
                {{ formatKnowledgeDateTime(report.createdAt) }}
              </n-tag>
            </div>
          </template>
          <template #header-extra>
            <n-button size="tiny" quaternary type="error" @click.stop="deleteAuditReport(report)">删除</n-button>
          </template>
          <p class="pk-history-summary">{{ report.summary || report.content.slice(0, 160) }}</p>
        </n-card>
      </n-space>
    </section>

    <n-modal
      :show="Boolean(selectedAuditReport)"
      preset="card"
      style="width: min(840px, 94vw); max-height: 88vh;"
      :title="selectedAuditReport?.title ?? '审计报告'"
      :bordered="false"
      size="small"
      closable
      role="dialog"
      aria-modal="true"
      @update:show="(v: boolean) => { if (!v) selectedAuditReport = null }"
    >
      <n-scrollbar v-if="selectedAuditReport" style="max-height: 72vh;">
        <div class="pk-report-content pk-md" v-html="renderMarkdown(selectedAuditReport.content)" />
      </n-scrollbar>
    </n-modal>
  </section>
</template>

<style scoped>
.project-knowledge-screen {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.pk-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.pk-header-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.pk-header-left strong {
  font-size: 16px;
}

.pk-header-subtitle {
  color: var(--arc-text-hint);
  font-size: 12px;
}

.pk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 12px;
}

.pk-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.pk-card-desc {
  margin: 0 0 10px;
  color: var(--arc-text-secondary);
  line-height: 1.6;
  font-size: 13px;
}

.pk-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pk-card-progress {
  margin-top: 10px;
}

.pk-history {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pk-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pk-history-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pk-history-item {
  cursor: pointer;
}

.pk-history-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pk-history-item-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pk-history-summary {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pk-report-content {
  padding: 4px 2px;
  color: var(--arc-text-primary);
  font-size: 14px;
  line-height: 1.72;
}

.pk-md :deep(h1),
.pk-md :deep(h2),
.pk-md :deep(h3),
.pk-md :deep(h4) {
  margin: 14px 0 8px;
  color: var(--arc-text-primary);
  font-weight: 600;
  line-height: 1.4;
}

.pk-md :deep(h1) { font-size: 18px; }
.pk-md :deep(h2) { font-size: 16px; }
.pk-md :deep(h3) { font-size: 15px; }
.pk-md :deep(h4) { font-size: 14px; }

.pk-md :deep(p) {
  margin: 0 0 8px;
  color: var(--arc-text-secondary);
  line-height: 1.72;
}

.pk-md :deep(ul),
.pk-md :deep(ol) {
  margin: 0 0 10px;
  padding-left: 20px;
  color: var(--arc-text-secondary);
  line-height: 1.72;
}

.pk-md :deep(li + li) {
  margin-top: 3px;
}

.pk-md :deep(strong) {
  color: var(--arc-text-primary);
  font-weight: 600;
}

.pk-md :deep(code) {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--arc-bg-mix);
  font-size: 12px;
}

.pk-md :deep(pre) {
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--arc-bg-mix);
  overflow-x: auto;
}

.pk-md :deep(pre code) {
  padding: 0;
  background: transparent;
}

.pk-md :deep(blockquote) {
  margin: 0 0 10px;
  padding: 4px 12px;
  border-left: 3px solid var(--arc-border);
  color: var(--arc-text-hint);
}

.pk-md :deep(hr) {
  border: none;
  border-top: 1px solid var(--arc-border);
  margin: 14px 0;
}

.pk-md :deep(table) {
  border-collapse: collapse;
  margin: 0 0 10px;
  width: 100%;
  font-size: 13px;
}

.pk-md :deep(th),
.pk-md :deep(td) {
  border: 1px solid var(--arc-border);
  padding: 6px 10px;
  text-align: left;
}

.pk-md :deep(th) {
  background: var(--arc-bg-mix);
  font-weight: 600;
}
</style>
