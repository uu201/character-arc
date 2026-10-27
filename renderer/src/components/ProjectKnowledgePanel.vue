<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import { Boxes, Clock, FileCheck2, GitBranch, History, MapPin, Pause, Play, RefreshCw, ScrollText, Sparkles, Users } from 'lucide-vue-next'
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NInputNumber,
  NModal,
  NScrollbar,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  NVirtualList,
  useDialog,
  useMessage
} from 'naive-ui'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { formatKnowledgeDateTime, isProjectKnowledgeSource, resolveKnowledgeSourceTypeLabel } from '@/features/knowledge/knowledgeCenter'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { KnowledgeDocument } from '@/types/app'
import { useIncrementalList } from '@/composables/useIncrementalList'

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string
}

type StoryState = NonNullable<Awaited<ReturnType<typeof window.characterArc.readStoryState>>['result']>

const isRunningStoryAudit = ref(false)
const isStartingBackfill = ref(false)
const backfillProgress = ref<CharacterArcBackfillStateProgressPayload | null>(null)
const isBackfillingState = computed(() => {
  const status = backfillProgress.value?.status
  return status === 'running' || status === 'pausing' || status === 'paused'
})
const isBackfillPaused = computed(() => backfillProgress.value?.status === 'paused')
const isBackfillPausing = computed(() => backfillProgress.value?.status === 'pausing')
const isBackfillControlsLocked = computed(() => isStartingBackfill.value || isBackfillingState.value)
const backfillStatuses = ref<CharacterArcBackfillChapterStatus[]>([])
const isLoadingBackfillStatuses = ref(false)
const backfillMode = ref<'pending' | 'failed' | 'range'>('pending')
const rangeStart = ref(1)
const rangeEnd = ref(1)
const storyState = ref<StoryState | null>(null)
const isLoadingStoryState = ref(false)
const projectRenderKey = computed(() => appStore.currentProject?.id ?? '')

const characterNameMap = computed(
  () => new Map(appStore.characters.map((character) => [character.id, character.name]))
)

function resolveCharacterName(id: string): string {
  return characterNameMap.value.get(id) || id || '未知角色'
}

function formatChapterRef(index: number | null | undefined, planned = false): string {
  if (index === null || index === undefined || index < 0) return '—'
  return planned && index === 0 ? '起始' : `第 ${planned ? index : index + 1} 章`
}

const foreshadowingStatusMeta: Record<string, { label: string; type: 'success' | 'warning' | 'info' | 'error' | 'default' }> = {
  active: { label: '埋设中', type: 'warning' },
  advanced: { label: '已推进', type: 'info' },
  resolved: { label: '已回收', type: 'success' },
  abandoned: { label: '已废弃', type: 'default' }
}

const storyStateSummary = computed(() => {
  const s = storyState.value
  if (!s) return null
  return {
    characters: s.characterStates.length,
    foreshadowing: s.activeForeshadowing.length,
    relationships: s.relationships.length,
    timeline: s.recentTimeline.length,
    worldRules: s.worldRules.length,
    clocks: s.activeClocks.length
  }
})

const hasStoryState = computed(() => {
  const sum = storyStateSummary.value
  if (!sum) return false
  return Object.values(sum).some((v) => v > 0)
})

const storyCharacterStates = computed<StoryState['characterStates']>(() => storyState.value?.characterStates ?? [])
const storyForeshadowing = computed<StoryState['activeForeshadowing']>(() => storyState.value?.activeForeshadowing ?? [])
const storyRelationships = computed<StoryState['relationships']>(() => storyState.value?.relationships ?? [])
const storyTimeline = computed<StoryState['recentTimeline']>(() => storyState.value?.recentTimeline ?? [])
const storyWorldRules = computed<StoryState['worldRules']>(() => storyState.value?.worldRules ?? [])
const storyClocks = computed<StoryState['activeClocks']>(() => storyState.value?.activeClocks ?? [])
const visibleStoryCharacterStates = useIncrementalList(storyCharacterStates, projectRenderKey, { initialSize: 24, batchSize: 24 })
const visibleStoryForeshadowing = useIncrementalList(storyForeshadowing, projectRenderKey, { initialSize: 24, batchSize: 24 })
const visibleStoryRelationships = useIncrementalList(storyRelationships, projectRenderKey, { initialSize: 24, batchSize: 24 })
const visibleStoryTimeline = useIncrementalList(storyTimeline, projectRenderKey, { initialSize: 24, batchSize: 24 })
const visibleStoryWorldRules = useIncrementalList(storyWorldRules, projectRenderKey, { initialSize: 24, batchSize: 24 })
const visibleStoryClocks = useIncrementalList(storyClocks, projectRenderKey, { initialSize: 24, batchSize: 24 })

async function loadStoryState(): Promise<void> {
  const project = appStore.currentProject
  if (!project) {
    storyState.value = null
    return
  }
  const projectId = project.id
  isLoadingStoryState.value = true
  try {
    const response = await window.characterArc.readStoryState(projectId)
    if (appStore.currentProject?.id !== projectId) return
    if (!response.success || !response.result) {
      throw new Error(response.error ?? '读取世界状态失败')
    }
    storyState.value = response.result
  } catch (error) {
    if (appStore.currentProject?.id !== projectId) return
    storyState.value = null
    message.error(error instanceof Error ? error.message : '读取世界状态失败')
  } finally {
    if (appStore.currentProject?.id === projectId) {
      isLoadingStoryState.value = false
    }
  }
}

async function loadBackfillStatuses(): Promise<void> {
  const project = appStore.currentProject
  if (!project) {
    backfillStatuses.value = []
    return
  }
  const projectId = project.id
  isLoadingBackfillStatuses.value = true
  try {
    const response = await window.characterArc.readBackfillStateStatus(projectId)
    if (appStore.currentProject?.id !== projectId) return
    if (!response.success || !response.result) {
      throw new Error(response.error ?? '读取补录状态失败')
    }
    backfillStatuses.value = response.result
    rangeEnd.value = Math.max(rangeStart.value, response.result.at(-1)?.chapterNumber ?? 1)
  } catch (error) {
    if (appStore.currentProject?.id !== projectId) return
    backfillStatuses.value = []
    message.error(error instanceof Error ? error.message : '读取补录状态失败')
  } finally {
    if (appStore.currentProject?.id === projectId) {
      isLoadingBackfillStatuses.value = false
    }
  }
}

async function loadBackfillTaskStatus(): Promise<void> {
  const projectId = appStore.currentProject?.id
  if (!projectId) {
    backfillProgress.value = null
    return
  }

  const response = await window.characterArc.readBackfillTaskStatus(projectId)
  if (appStore.currentProject?.id !== projectId) return
  if (!response.success) {
    message.error(response.error ?? '读取状态补录任务失败')
    return
  }
  backfillProgress.value = response.result ?? null
}

const selectedAuditReport = ref<KnowledgeDocument | null>(null)
const selectedKnowledgeDocument = ref<KnowledgeDocument | null>(null)
const knowledgeHistoryRef = ref<HTMLElement | null>(null)

const notifiedBackfillTaskIds = new Set<string>()

function handleBackfillTaskFinished(payload: CharacterArcBackfillStateProgressPayload): void {
  if (notifiedBackfillTaskIds.has(payload.taskId)) return
  notifiedBackfillTaskIds.add(payload.taskId)
  void loadStoryState()
  void loadBackfillStatuses()

  if (payload.status === 'failed') {
    message.error(payload.error || '状态补录失败')
    return
  }

  const result = payload.result
  if (!result) return
  if (result.failed > 0) {
    const firstError = result.errors[0]
    const detail = firstError ? `首个失败：${firstError.chapterTitle} - ${firstError.message}` : ''
    message.error(`状态补录完成但有失败：${result.processedChapters} / ${result.totalChapters} 章成功，${result.skipped} 章跳过，${result.failed} 章失败。${detail}`, { duration: 8000 })
    return
  }
  message.success(`状态补录完成：${result.processedChapters} / ${result.totalChapters} 章成功，${result.skipped} 章跳过。`)
}

const cleanupBackfillProgress = window.characterArc.onBackfillStateProgress((payload) => {
  if (payload.projectId !== appStore.currentProject?.id) return
  backfillProgress.value = payload
  if (payload.status === 'completed' || payload.status === 'failed') {
    handleBackfillTaskFinished(payload)
  }
})

// 助手写回后会同步工作区；世界状态不在工作区快照内，需要单独重新读取。
const cleanupWorkspaceSync = window.characterArc.onWorkspaceSync(() => {
  void loadStoryState()
})

onBeforeUnmount(() => {
  cleanupBackfillProgress()
  cleanupWorkspaceSync()
})

onMounted(() => {
  void loadStoryState()
  void loadBackfillStatuses()
  void loadBackfillTaskStatus()
})

watch(
  () => appStore.currentProject?.id,
  () => {
    backfillProgress.value = null
    void loadStoryState()
    void loadBackfillStatuses()
    void loadBackfillTaskStatus()
  }
)

const auditReports = computed(() =>
  appStore.knowledgeDocuments
    .filter((doc) => doc.sourceType === 'canon-fact' && doc.sourceLabel === 'story-deep-audit')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
)

const latestAuditReport = computed(() => auditReports.value[0] ?? null)

const assistantKnowledgeDocuments = computed(() =>
  appStore.knowledgeDocuments
    .filter((doc) => isProjectKnowledgeSource(doc.sourceType) && !(doc.sourceType === 'canon-fact' && doc.sourceLabel === 'story-deep-audit'))
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''))
)
const visibleAuditReports = useIncrementalList(auditReports, projectRenderKey, { initialSize: 24, batchSize: 24 })
const visibleKnowledgeDocuments = useIncrementalList(assistantKnowledgeDocuments, projectRenderKey, { initialSize: 24, batchSize: 24 })

const chapterCount = computed(() => appStore.chapters.length)
const validChapterCount = computed(
  () => appStore.chapters.filter((ch) => ch.content && ch.content.trim().length >= 50).length
)

const backfillModeOptions = [
  { label: '未完成章节', value: 'pending' },
  { label: '仅失败章节', value: 'failed' },
  { label: '指定章节范围', value: 'range' }
]

const backfillStatusMeta: Record<CharacterArcBackfillChapterStatus['status'], {
  label: string
  type: 'success' | 'warning' | 'info' | 'error' | 'default'
}> = {
  unscanned: { label: '未扫描', type: 'default' },
  running: { label: '上次中断', type: 'warning' },
  success: { label: '已补录', type: 'success' },
  skipped: { label: '已扫描·无变更', type: 'info' },
  failed: { label: '扫描失败', type: 'error' },
  stale: { label: '正文已变化', type: 'warning' }
}

function resolveBackfillStatusMeta(
  status: unknown,
  chapterTitle = ''
): (typeof backfillStatusMeta)[CharacterArcBackfillChapterStatus['status']] {
  const normalized = String(status) as CharacterArcBackfillChapterStatus['status']
  if (
    normalized === 'running'
    && isBackfillingState.value
    && backfillProgress.value?.chapterTitle === chapterTitle
  ) {
    return { label: '处理中', type: 'warning' }
  }
  return backfillStatusMeta[normalized] ?? backfillStatusMeta.unscanned
}

const backfillStatusCounts = computed(() => {
  const counts = { completed: 0, pending: 0, failed: 0 }
  for (const status of backfillStatuses.value) {
    if (status.status === 'success' || status.status === 'skipped') counts.completed++
    else if (status.status === 'failed' || status.status === 'running') counts.failed++
    else counts.pending++
  }
  return counts
})

const selectedBackfillChapterIds = computed(() => {
  const statuses = backfillStatuses.value
  if (backfillMode.value === 'failed') {
    return statuses
      .filter((status) => status.status === 'failed' || status.status === 'running')
      .map((status) => status.chapterId)
  }
  if (backfillMode.value === 'range') {
    const start = Math.min(rangeStart.value, rangeEnd.value)
    const end = Math.max(rangeStart.value, rangeEnd.value)
    return statuses
      .filter((status) => (
        status.chapterNumber >= start
        && status.chapterNumber <= end
        && status.status !== 'success'
        && status.status !== 'skipped'
      ))
      .map((status) => status.chapterId)
  }
  return statuses
    .filter((status) => status.status !== 'success' && status.status !== 'skipped')
    .map((status) => status.chapterId)
})

const backfillButtonLabel = computed(() => {
  return backfillProgress.value?.status === 'completed' ? '再次补录' : '从已有章节补录状态'
})

const backfillTaskStatusLabel = computed(() => {
  switch (backfillProgress.value?.status) {
    case 'pausing': return '等待暂停'
    case 'paused': return '已暂停'
    case 'running': return '后台运行中'
    default: return ''
  }
})

const backfillProgressText = computed(() => {
  const task = backfillProgress.value
  if (!task) return ''
  if (task.status === 'pausing') return task.message || '将在当前章节处理完成后暂停。'
  if (task.status === 'paused') return task.chapterTitle ? `已暂停，下一章：${task.chapterTitle}` : '任务已暂停。'
  if (task.phase === 'starting') return '正在准备补录队列...'
  return task.chapterTitle ? `正在处理：${task.chapterTitle}` : task.message || '状态补录正在后台运行。'
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
      projectId: project.id,
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
  if (isStartingBackfill.value || isBackfillingState.value) {
    message.info('上一次状态补录还在进行中，请稍候。')
    return
  }
  if (!selectedBackfillChapterIds.value.length) {
    message.info('当前选择中没有需要补录的章节。')
    return
  }

  const selectedCount = selectedBackfillChapterIds.value.length

  dialog.warning({
    title: '从已有章节补录状态库',
    content: `将对 ${selectedCount} 个章节逐章提取状态变更，预计调用 AI ${selectedCount} 次。已完成且正文未变化的章节不会重复扫描。确认继续？`,
    positiveText: '开始补录',
    negativeText: '取消',
    onPositiveClick: () => {
      isStartingBackfill.value = true
      backfillProgress.value = null
      void runStateBackfillTask(project.id)
    }
  })
}

async function runStateBackfillTask(projectId: string): Promise<void> {
  try {
    const selection = backfillMode.value === 'failed'
      ? { mode: 'failed' as const }
      : backfillMode.value === 'range'
        ? { mode: 'custom' as const, chapterIds: selectedBackfillChapterIds.value }
        : { mode: 'pending' as const }
    const response = await window.characterArc.backfillProjectState(toIpcPayload({
      settings: appStore.appSettings,
      projectId,
      selection
    }))
    if (!response.success || !response.result) {
      throw new Error(response.error ?? '状态补录失败')
    }
    if (appStore.currentProject?.id === projectId) {
      backfillProgress.value = response.result
      message.success('状态补录已转入后台运行。')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '状态补录失败')
  } finally {
    isStartingBackfill.value = false
  }
}

async function pauseStateBackfill(): Promise<void> {
  const projectId = appStore.currentProject?.id
  if (!projectId || !isBackfillingState.value) return
  const response = await window.characterArc.pauseBackfillProjectState(projectId)
  if (!response.success || !response.result) {
    message.error(response.error ?? '暂停状态补录失败')
    return
  }
  if (appStore.currentProject?.id === projectId) {
    backfillProgress.value = response.result
  }
}

async function resumeStateBackfill(): Promise<void> {
  const projectId = appStore.currentProject?.id
  if (!projectId || !isBackfillPaused.value) return
  const response = await window.characterArc.resumeBackfillProjectState(projectId)
  if (!response.success || !response.result) {
    message.error(response.error ?? '继续状态补录失败')
    return
  }
  if (appStore.currentProject?.id === projectId) {
    backfillProgress.value = response.result
  }
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

function openKnowledgeDocument(document: KnowledgeDocument): void {
  selectedKnowledgeDocument.value = document
}

function deleteKnowledgeDocument(document: KnowledgeDocument): void {
  const project = appStore.currentProject
  if (!project) return

  dialog.warning({
    title: '删除知识文档',
    content: `确认删除「${document.title}」吗？此操作无法撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      appStore.removeKnowledgeDocuments([document.id])
      if (selectedKnowledgeDocument.value?.id === document.id) {
        selectedKnowledgeDocument.value = null
      }
      message.success('已删除知识文档')
    }
  })
}

watch(
  () => appStore.assistantFocusTarget,
  async (target) => {
    if (!target || target.panel !== 'project-knowledge') return
    const document = appStore.knowledgeDocuments.find((item) => item.id === target.entityId)
    if (!document) return

    selectedKnowledgeDocument.value = document
    await nextTick()
    knowledgeHistoryRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    appStore.clearAssistantFocusTarget('project-knowledge', target.entityId)
  },
  { immediate: true }
)
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
          <n-tag size="small" :bordered="false" type="success">知识文档 {{ assistantKnowledgeDocuments.length }}</n-tag>
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
          <n-space size="small">
            <n-button
              v-if="isBackfillingState && !isBackfillPaused"
              size="small"
              :loading="isBackfillPausing"
              :disabled="isBackfillPausing"
              @click="pauseStateBackfill"
            >
              <template #icon><Pause :size="14" /></template>
              暂停
            </n-button>
            <n-button
              v-else-if="isBackfillPaused"
              size="small"
              type="primary"
              @click="resumeStateBackfill"
            >
              <template #icon><Play :size="14" /></template>
              继续
            </n-button>
            <n-button
              v-else
              size="small"
              :loading="isStartingBackfill"
              :disabled="!appStore.currentProject || isLoadingBackfillStatuses || !selectedBackfillChapterIds.length"
              @click="runStateBackfill"
            >
              <template #icon><Sparkles :size="14" /></template>
              {{ backfillButtonLabel }}
            </n-button>
          </n-space>
        </template>

        <p class="pk-card-desc">
          按章节补录角色状态、伏笔、关系等结构化数据；任务会在后台继续，扫描结果会保留。
        </p>

        <div class="pk-backfill-controls">
          <label class="pk-backfill-field">
            <span>扫描范围</span>
            <n-select
              v-model:value="backfillMode"
              size="small"
              :options="backfillModeOptions"
              :disabled="isBackfillControlsLocked"
            />
          </label>
          <template v-if="backfillMode === 'range'">
            <label class="pk-backfill-field pk-backfill-field--number">
              <span>起始章节</span>
              <n-input-number v-model:value="rangeStart" size="small" :min="1" :max="Math.max(1, backfillStatuses.length)" :disabled="isBackfillControlsLocked" />
            </label>
            <label class="pk-backfill-field pk-backfill-field--number">
              <span>结束章节</span>
              <n-input-number v-model:value="rangeEnd" size="small" :min="1" :max="Math.max(1, backfillStatuses.length)" :disabled="isBackfillControlsLocked" />
            </label>
          </template>
        </div>

        <div class="pk-card-meta">
          <n-tag size="small" :bordered="false">可补录章节 {{ validChapterCount }}</n-tag>
          <n-tag size="small" :bordered="false" type="success">已完成 {{ backfillStatusCounts.completed }}</n-tag>
          <n-tag size="small" :bordered="false" type="warning">待补录 {{ backfillStatusCounts.pending }}</n-tag>
          <n-tag v-if="backfillStatusCounts.failed" size="small" :bordered="false" type="error">失败/中断 {{ backfillStatusCounts.failed }}</n-tag>
          <n-tag size="small" :bordered="false" type="info">本次 {{ selectedBackfillChapterIds.length }}</n-tag>
          <n-tag v-if="isBackfillingState" size="small" type="warning" :bordered="false">
            {{ backfillTaskStatusLabel }}
          </n-tag>
          <n-tag v-if="isBackfillingState && backfillProgress?.total" size="small" type="warning" :bordered="false">
            进度 {{ backfillProgress.current }} / {{ backfillProgress.total }}
          </n-tag>
        </div>
        <n-alert
          v-if="isBackfillingState && backfillProgress"
          :type="isBackfillPaused || isBackfillPausing ? 'warning' : 'info'"
          :show-icon="false"
          class="pk-card-progress"
        >
          {{ backfillProgressText }}
        </n-alert>
        <n-spin :show="isLoadingBackfillStatuses">
          <n-virtual-list
            v-if="backfillStatuses.length"
            class="pk-backfill-list"
            style="max-height: 230px;"
            :items="backfillStatuses"
            :item-size="50"
            item-resizable
          >
            <template #default="{ item: status }">
              <div :key="status.chapterId" class="pk-backfill-row">
                <span class="pk-backfill-chapter-number">{{ status.chapterNumber }}</span>
                <div class="pk-backfill-row-main">
                  <strong>{{ status.chapterTitle }}</strong>
                  <span v-if="status.error" class="pk-backfill-error" :title="status.error">{{ status.error }}</span>
                </div>
                <n-tag size="tiny" :bordered="false" :type="resolveBackfillStatusMeta(status.status, status.chapterTitle).type">
                  {{ resolveBackfillStatusMeta(status.status, status.chapterTitle).label }}
                </n-tag>
              </div>
            </template>
          </n-virtual-list>
        </n-spin>
      </n-card>
    </div>

    <section class="pk-state">
      <div class="pk-history-head">
        <div class="pk-history-title">
          <Boxes :size="16" />
          <strong>世界状态库</strong>
          <n-tag v-if="storyStateSummary" size="tiny" :bordered="false">
            角色 {{ storyStateSummary.characters }} · 伏笔 {{ storyStateSummary.foreshadowing }} · 关系 {{ storyStateSummary.relationships }}
          </n-tag>
        </div>
        <n-button
          size="small"
          quaternary
          :loading="isLoadingStoryState"
          :disabled="!appStore.currentProject || isLoadingStoryState"
          @click="loadStoryState"
        >
          <template #icon><RefreshCw :size="14" /></template>
          刷新
        </n-button>
      </div>

      <p class="pk-card-desc">
        章节定稿或状态补录时沉淀的结构化世界状态。这些数据会在 AI 写作/审校时作为上下文注入，保证前后一致。需要删除条目时，可向全局 AI 助手说明目标，在暂存区确认并写回后生效。
      </p>

      <n-spin :show="isLoadingStoryState">
        <n-empty
          v-if="!hasStoryState"
          :description="appStore.currentProject ? '状态库还是空的，请先定稿章节或执行上方的「状态补录」。' : '请先选择一个项目。'"
        />
        <n-collapse v-else :default-expanded-names="['characters', 'foreshadowing', 'relationships']" arrow-placement="right">
          <n-collapse-item v-if="storyState?.characterStates.length" name="characters">
            <template #header>
              <div class="pk-state-head"><Users :size="14" /><span>角色状态</span><n-tag size="tiny" :bordered="false">{{ storyState.characterStates.length }}</n-tag></div>
            </template>
            <div class="pk-state-list">
              <div v-for="cs in visibleStoryCharacterStates" :key="cs.characterId" class="pk-state-item">
                <div class="pk-state-item-title">
                  <strong>{{ resolveCharacterName(cs.characterId) }}</strong>
                  <n-tag size="tiny" :bordered="false" type="info">{{ formatChapterRef(cs.chapterIndex) }}</n-tag>
                </div>
                <div class="pk-state-fields">
                  <span v-if="cs.location"><MapPin :size="12" /> {{ cs.location }}</span>
                  <span v-if="cs.physicalState">身体：{{ cs.physicalState }}</span>
                  <span v-if="cs.mentalState">心理：{{ cs.mentalState }}</span>
                  <span v-if="cs.arcStage">弧光：{{ cs.arcStage }}</span>
                  <span v-if="cs.powerLevel">能力：{{ cs.powerLevel }}</span>
                </div>
                <div v-if="cs.goals.length || cs.inventory.length || cs.knowledge.length" class="pk-state-tags">
                  <n-tag v-for="g in cs.goals" :key="`g-${g}`" size="tiny" :bordered="false" type="warning">目标：{{ g }}</n-tag>
                  <n-tag v-for="it in cs.inventory" :key="`i-${it}`" size="tiny" :bordered="false">物品：{{ it }}</n-tag>
                  <n-tag v-for="k in cs.knowledge" :key="`k-${k}`" size="tiny" :bordered="false" type="success">已知：{{ k }}</n-tag>
                </div>
              </div>
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="storyState?.activeForeshadowing.length" name="foreshadowing">
            <template #header>
              <div class="pk-state-head"><ScrollText :size="14" /><span>伏笔</span><n-tag size="tiny" :bordered="false">{{ storyState.activeForeshadowing.length }}</n-tag></div>
            </template>
            <div class="pk-state-list">
              <div v-for="fs in visibleStoryForeshadowing" :key="fs.foreshadowingId" class="pk-state-item">
                <div class="pk-state-item-title">
                  <strong>{{ fs.description }}</strong>
                  <n-tag size="tiny" :bordered="false" :type="(foreshadowingStatusMeta[fs.status] ?? foreshadowingStatusMeta.active).type">
                    {{ (foreshadowingStatusMeta[fs.status] ?? { label: fs.status }).label }}
                  </n-tag>
                </div>
                <div class="pk-state-fields">
                  <span v-if="fs.type">类型：{{ fs.type }}</span>
                  <span>埋设：{{ formatChapterRef(fs.plantedChapter) }}</span>
                  <span v-if="fs.plantedMethod">手法：{{ fs.plantedMethod }}</span>
                  <span v-if="fs.payoffChapter !== null">预期回收：{{ formatChapterRef(fs.payoffChapter, true) }}</span>
                  <span v-if="fs.resolvedChapter !== null">实际回收：{{ formatChapterRef(fs.resolvedChapter) }}</span>
                </div>
                <div v-if="fs.clues.length" class="pk-state-tags">
                  <n-tag v-for="(clue, idx) in fs.clues" :key="`c-${idx}`" size="tiny" :bordered="false">
                    {{ formatChapterRef(clue.chapter) }}：{{ clue.clue }}
                  </n-tag>
                </div>
              </div>
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="storyState?.relationships.length" name="relationships">
            <template #header>
              <div class="pk-state-head"><GitBranch :size="14" /><span>角色关系</span><n-tag size="tiny" :bordered="false">{{ storyState.relationships.length }}</n-tag></div>
            </template>
            <div class="pk-state-list">
              <div v-for="rel in visibleStoryRelationships" :key="rel.relationshipId" class="pk-state-item">
                <div class="pk-state-item-title">
                  <strong>{{ resolveCharacterName(rel.participantA) }} ⇄ {{ resolveCharacterName(rel.participantB) }}</strong>
                  <n-tag size="tiny" :bordered="false" type="info">{{ rel.currentStatus }}</n-tag>
                </div>
                <div class="pk-state-fields">
                  <span v-if="rel.trajectory">走向：{{ rel.trajectory }}</span>
                  <span v-if="rel.lastInteractionChapter !== null">最近互动：{{ formatChapterRef(rel.lastInteractionChapter) }}</span>
                </div>
                <div v-if="rel.tensionPoints.length" class="pk-state-tags">
                  <n-tag v-for="tp in rel.tensionPoints" :key="`t-${tp}`" size="tiny" :bordered="false" type="error">张力：{{ tp }}</n-tag>
                </div>
              </div>
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="storyState?.recentTimeline.length" name="timeline">
            <template #header>
              <div class="pk-state-head"><Clock :size="14" /><span>时间线</span><n-tag size="tiny" :bordered="false">{{ storyState.recentTimeline.length }}</n-tag></div>
            </template>
            <div class="pk-state-list">
              <div v-for="(tl, idx) in visibleStoryTimeline" :key="`tl-${idx}`" class="pk-state-item">
                <div class="pk-state-item-title">
                  <strong>{{ formatChapterRef(tl.chapterIndex) }}</strong>
                  <n-tag v-if="tl.storyDate" size="tiny" :bordered="false" type="info">{{ tl.storyDate }}</n-tag>
                </div>
                <div v-if="tl.events.length" class="pk-state-tags">
                  <n-tag v-for="(ev, i) in tl.events" :key="`ev-${i}`" size="tiny" :bordered="false">{{ ev }}</n-tag>
                </div>
                <div v-if="tl.worldStateChanges.length" class="pk-state-tags">
                  <n-tag v-for="(wc, i) in tl.worldStateChanges" :key="`wc-${i}`" size="tiny" :bordered="false" type="warning">{{ wc }}</n-tag>
                </div>
              </div>
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="storyState?.worldRules.length" name="worldRules">
            <template #header>
              <div class="pk-state-head"><ScrollText :size="14" /><span>世界规则</span><n-tag size="tiny" :bordered="false">{{ storyState.worldRules.length }}</n-tag></div>
            </template>
            <div class="pk-state-list">
              <div v-for="wr in visibleStoryWorldRules" :key="wr.ruleId" class="pk-state-item">
                <div class="pk-state-item-title">
                  <strong>{{ wr.ruleContent }}</strong>
                  <n-tag v-if="wr.mustComply" size="tiny" :bordered="false" type="error">强约束</n-tag>
                </div>
                <div class="pk-state-fields">
                  <span>确立：{{ formatChapterRef(wr.establishedChapter) }}</span>
                </div>
                <div v-if="wr.exceptions.length" class="pk-state-tags">
                  <n-tag v-for="ex in wr.exceptions" :key="`ex-${ex}`" size="tiny" :bordered="false">例外：{{ ex }}</n-tag>
                </div>
              </div>
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="storyState?.activeClocks.length" name="clocks">
            <template #header>
              <div class="pk-state-head"><Clock :size="14" /><span>倒计时</span><n-tag size="tiny" :bordered="false">{{ storyState.activeClocks.length }}</n-tag></div>
            </template>
            <div class="pk-state-list">
              <div v-for="ck in visibleStoryClocks" :key="ck.clockId" class="pk-state-item">
                <div class="pk-state-item-title">
                  <strong>{{ ck.eventDescription }}</strong>
                  <n-tag size="tiny" :bordered="false" type="warning">{{ ck.urgency || ck.status }}</n-tag>
                </div>
                <div class="pk-state-fields">
                  <span v-if="ck.deadlineChapter !== null">截止：{{ formatChapterRef(ck.deadlineChapter, true) }}</span>
                </div>
              </div>
            </div>
          </n-collapse-item>
        </n-collapse>
      </n-spin>
    </section>

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
          v-for="report in visibleAuditReports"
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

    <section ref="knowledgeHistoryRef" class="pk-history">
      <div class="pk-history-head">
        <div class="pk-history-title">
          <FileCheck2 :size="16" />
          <strong>知识文档</strong>
          <n-tag size="tiny" :bordered="false">{{ assistantKnowledgeDocuments.length }} 份</n-tag>
        </div>
      </div>

      <n-empty v-if="!assistantKnowledgeDocuments.length" description="全局助理保存的知识文档会出现在这里。" />
      <n-space v-else vertical size="small">
        <n-card
          v-for="document in visibleKnowledgeDocuments"
          :key="document.id"
          size="small"
          hoverable
          class="pk-history-item"
          @click="openKnowledgeDocument(document)"
        >
          <template #header>
            <div class="pk-history-item-title">
              <strong>{{ document.title }}</strong>
              <n-tag size="tiny" :bordered="false" type="success">
                {{ resolveKnowledgeSourceTypeLabel(document.sourceType) }}
              </n-tag>
              <n-tag size="tiny" :bordered="false" type="info">
                {{ formatKnowledgeDateTime(document.updatedAt || document.createdAt) }}
              </n-tag>
            </div>
          </template>
          <template #header-extra>
            <n-button size="tiny" quaternary type="error" @click.stop="deleteKnowledgeDocument(document)">删除</n-button>
          </template>
          <p class="pk-history-summary">{{ document.summary || document.content.slice(0, 160) }}</p>
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

    <n-modal
      :show="Boolean(selectedKnowledgeDocument)"
      preset="card"
      style="width: min(840px, 94vw); max-height: 88vh;"
      :title="selectedKnowledgeDocument?.title ?? '知识文档'"
      :bordered="false"
      size="small"
      closable
      role="dialog"
      aria-modal="true"
      @update:show="(v: boolean) => { if (!v) selectedKnowledgeDocument = null }"
    >
      <n-scrollbar v-if="selectedKnowledgeDocument" style="max-height: 72vh;">
        <div class="pk-report-content pk-md" v-html="renderMarkdown(selectedKnowledgeDocument.content)" />
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

.pk-backfill-controls {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}

.pk-backfill-field {
  display: grid;
  gap: 5px;
  min-width: 180px;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.pk-backfill-field--number {
  min-width: 112px;
  width: 128px;
}

.pk-backfill-list {
  margin-top: 10px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
}

.pk-backfill-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 50px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--arc-border);
}

.pk-backfill-row:last-child {
  border-bottom: 0;
}

.pk-backfill-chapter-number {
  color: var(--arc-text-hint);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.pk-backfill-row-main {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.pk-backfill-row-main strong,
.pk-backfill-error {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pk-backfill-row-main strong {
  color: var(--arc-text-primary);
  font-size: 12px;
}

.pk-backfill-error {
  color: var(--arc-danger, #d03050);
  font-size: 11px;
}

@media (max-width: 680px) {
  .pk-backfill-field,
  .pk-backfill-field--number {
    min-width: min(100%, 180px);
    width: 100%;
  }
}

.pk-history {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pk-state {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pk-state-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.pk-state-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pk-state-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-mix);
}

.pk-state-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pk-state-item-title strong {
  color: var(--arc-text-primary);
  font-size: 14px;
}

.pk-state-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.pk-state-fields span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.pk-state-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
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
