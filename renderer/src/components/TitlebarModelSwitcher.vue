<script setup lang="ts">
import { computed, ref } from 'vue'
import { RefreshCw, ScrollText } from 'lucide-vue-next'
import { NModal, NSelect, NTag } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AiRunRecord } from '@/types/app'

const appStore = useAppStore()
const isFetchingModels = ref(false)
const fetchedModels = ref<Array<{ id: string }>>([])
const logVisible = ref(false)

const profileOptions = computed(() =>
  appStore.appSettings.aiProfiles.map(p => ({ label: p.name, value: p.id }))
)

const modelOptions = computed(() => {
  if (fetchedModels.value.length > 0) {
    return fetchedModels.value.map(m => ({ label: m.id, value: m.id }))
  }
  const current = appStore.appSettings.model
  return current ? [{ label: current, value: current }] : []
})

const activeProfileId = computed({
  get: () => appStore.appSettings.activeAiProfileId,
  set: (id: string) => appStore.switchAiProfile(id)
})

const activeModel = computed({
  get: () => appStore.appSettings.model,
  set: (model: string) => appStore.updateActiveAiProfileModel(model)
})

const hasProfiles = computed(() => appStore.appSettings.aiProfiles.length > 0)
const aiRunLogs = computed(() => appStore.allAiRuns)
const projectTitleById = computed(() => {
  const map = new Map<string, string>()
  for (const project of appStore.projects) {
    map.set(project.id, project.title?.trim() || '未命名项目')
  }
  return map
})
function projectTitleFor(run: AiRunRecord): string {
  return projectTitleById.value.get(run.projectId) || '未知项目'
}

const statusMeta: Record<AiRunRecord['status'], { label: string; type: 'default' | 'info' | 'success' | 'error' | 'warning' }> = {
  running: { label: '运行中', type: 'info' },
  success: { label: '成功', type: 'success' },
  error: { label: '失败', type: 'error' },
  canceled: { label: '已取消', type: 'warning' }
}

const taskLabelMap: Record<string, string> = {
  'global-assistant': '全局助理',
  'global-assistant-proposal': '写回提案',
  'chapter-assistant': '章节助理',
  'chapter-first-draft': '章节初稿',
  'chapter-memo': '写作备忘',
  'chapter-audit': '章节审计',
  'chapter-repair': '章节修复',
  'chapter-summarize': '章节摘要',
  'chapter-scene-plan': '场景规划',
  'chapter-analysis': '章节分析',
  'chapter-session-note': '写作日志',
  'story-deep-audit': '全书审计',
  'assistant-intent': '意图判断',
  'assistant-action-proposal': '操作建议',
  'worldview-entry': '世界观生成',
  'worldview-enhance': '世界观补充',
  'character-card': '角色生成',
  'character-enhance': '角色补充',
  'relation-enhance': '关系补充',
  'outline-item': '大纲扩写',
  'outline-batch': '分卷补全',
  'outline-chain': '大纲链编',
  'outline-enhance': '大纲补充',
  'reference-deep-analyze': '深度拆书',
  'reference-style-chunk': '风格拆解',
  'reference-style-analysis': '风格分析',
  'style-fingerprint-extract': '风格指纹提取',
  'workflow-documents': '设定导出',
  'plot-thread-detect': '伏笔检测',
  'project-bootstrap': '项目初始化',
  'spiral-seed': '旋种生成',
  'spiral-expand': '旋种扩写',
  'spiral-validate': '旋种验证',
  'inspiration-pack': '灵感整理',
  'cover-generate': '封面生成'
}

async function handleFetchModels(): Promise<void> {
  if (isFetchingModels.value) return
  isFetchingModels.value = true
  try {
    const result = await window.characterArc.fetchModels(toIpcPayload({ ...appStore.appSettings }))
    if (result.success && result.result) {
      fetchedModels.value = result.result
    }
  } catch {
    // silent
  } finally {
    isFetchingModels.value = false
  }
}

function formatTaskLabel(task: string): string {
  return taskLabelMap[task] || task
}

function formatTime(value?: string): string {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatDuration(durationMs?: number): string {
  if (!durationMs || durationMs <= 0) return '未记录'
  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${(durationMs / 60_000).toFixed(1)}min`
}

function formatTokenUsage(run: AiRunRecord): string {
  const total = run.usage?.totalTokens
  const prompt = run.usage?.promptTokens
  const completion = run.usage?.completionTokens
  if (total) {
    return `总 ${total} tokens${prompt || completion ? ` · 输入 ${prompt || 0} / 输出 ${completion || 0}` : ''}`
  }
  if (prompt || completion) {
    return `输入 ${prompt || 0} / 输出 ${completion || 0}`
  }
  return '未记录 token'
}

function chapterTitleFor(run: AiRunRecord): string {
  if (!run.chapterId) return ''
  return appStore.chapters.find((chapter) => chapter.id === run.chapterId)?.title ?? ''
}

function toolReadStats(run: AiRunRecord): { reads: number; hits: number } {
  const calls = Array.isArray(run.toolCalls) ? run.toolCalls : []
  const readTools = new Set(['read_project_data', 'read_chapter', 'list_chapters'])
  const discoveryTools = new Set(['search_project'])

  let reads = 0
  let hits = 0

  for (const call of calls) {
    if (!call || call.status !== 'ok') {
      continue
    }

    if (readTools.has(call.tool) || discoveryTools.has(call.tool)) {
      reads += 1
    }

    if (call.tool === 'read_project_data' || call.tool === 'read_chapter') {
      hits += 1
      continue
    }

    if (call.tool === 'list_chapters') {
      hits += 1
      continue
    }

    if (call.tool === 'search_project') {
      const rawQuery = typeof call.args.query === 'string' ? call.args.query.trim() : ''
      hits += rawQuery ? 1 : 0
    }
  }

  return { reads, hits }
}
</script>

<template>
  <div v-if="hasProfiles" class="titlebar-switcher">
    <span class="switcher-label">模型切换:</span>
    <n-select
      :value="activeProfileId"
      :options="profileOptions"
      size="tiny"
      class="switcher-profile"
      :consistent-menu-width="false"
      @update:value="(v: string) => { activeProfileId = v; fetchedModels = [] }"
    />
    <span class="switcher-sep" />
    <n-select
      :value="activeModel"
      :options="modelOptions"
      size="tiny"
      class="switcher-model"
      filterable
      tag
      :consistent-menu-width="false"
      @update:value="(v: string) => { activeModel = v }"
    />
    <button
      class="switcher-refresh"
      title="刷新模型列表"
      :disabled="isFetchingModels"
      @click="handleFetchModels"
    >
      <RefreshCw :size="13" :class="{ spinning: isFetchingModels }" />
    </button>
    <button
      class="switcher-log"
      title="查看 AI 调用日志"
      @click="logVisible = true"
    >
      <ScrollText :size="13" />
      <span>AI调用日志</span>
    </button>
  </div>

  <n-modal
    :show="logVisible"
    preset="card"
    class="ai-log-modal"
    :bordered="false"
    :style="{ width: 'min(680px, calc(100vw - 24px))' }"
    @close="logVisible = false"
  >
    <div class="ai-log-modal__summary">
      <strong>AI 调用日志</strong>
      <span>全部项目 · {{ aiRunLogs.length }} 条记录</span>
    </div>

    <div v-if="!aiRunLogs.length" class="ai-log-empty">
      还没有任何 AI 调用日志。
    </div>

    <div v-else class="ai-log-list arc-scrollbar">
      <article
        v-for="run in aiRunLogs"
        :key="run.id"
        class="ai-log-card"
        :class="`ai-log-card--${run.status}`"
      >
        <div class="ai-log-card__head">
          <div class="ai-log-card__title">
            <div class="ai-log-card__title-row">
              <strong>{{ formatTaskLabel(run.task) }}</strong>
              <span class="ai-log-card__run-id">#{{ run.id.slice(-6) }}</span>
            </div>
            <span>{{ run.provider }} / {{ run.model }}</span>
          </div>
          <n-tag size="small" :type="statusMeta[run.status]?.type || 'default'" :bordered="false">
            {{ statusMeta[run.status]?.label || run.status }}
          </n-tag>
        </div>

        <div class="ai-log-card__meta">
          <span>项目：{{ projectTitleFor(run) }}</span>
          <span>开始：{{ formatTime(run.startedAt) }}</span>
          <span>耗时：{{ formatDuration(run.durationMs) }}</span>
          <span>{{ formatTokenUsage(run) }}</span>
        </div>

        <div v-if="chapterTitleFor(run)" class="ai-log-card__chapter">
          关联章节：{{ chapterTitleFor(run) }}
        </div>

        <div v-if="run.responsePreview" class="ai-log-card__preview">
          <span class="ai-log-card__section-label">响应预览</span>
          {{ run.responsePreview }}
        </div>

        <div v-if="run.error" class="ai-log-card__error">
          <span class="ai-log-card__section-label">错误信息</span>
          {{ run.error }}
        </div>

        <div class="ai-log-card__foot">
          <span class="ai-log-chip">工具读取：{{ toolReadStats(run).reads }} 次 / 命中资料：{{ toolReadStats(run).hits }} 条</span>
          <span v-if="run.repairTriggered" class="ai-log-chip">触发过结构化修复</span>
          <span v-if="run.finishedAt" class="ai-log-chip">结束：{{ formatTime(run.finishedAt) }}</span>
        </div>
      </article>
    </div>
  </n-modal>
</template>

<style scoped>
.titlebar-switcher {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.switcher-label {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  margin-right: 2px;
  user-select: none;
}

.switcher-profile {
  width: 120px;
}

.switcher-model {
  width: 160px;
}

.switcher-sep {
  width: 1px;
  height: 16px;
  background: var(--arc-border);
  margin: 0 2px;
}

.switcher-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.switcher-refresh:hover,
.switcher-log:hover {
  border-color: var(--arc-border-strong);
  color: var(--arc-text-primary);
  background: var(--arc-bg-weak);
}

.switcher-refresh:disabled,
.switcher-log:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.switcher-log {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.ai-log-modal :deep(.n-card) {
  border-radius: 18px;
  overflow: hidden;
  background: linear-gradient(180deg, color-mix(in srgb, var(--arc-bg-surface) 96%, white 4%) 0%, var(--arc-bg-surface) 100%);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
}

.ai-log-modal :deep(.n-card-header) {
  display: none;
}

.ai-log-modal :deep(.n-card__content) {
  padding: 18px;
}

.ai-log-modal__summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.ai-log-modal__summary strong {
  color: var(--arc-text-primary);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.ai-log-modal__summary span {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.ai-log-empty {
  padding: 28px 18px;
  border: 1px dashed color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border));
  border-radius: 14px;
  color: var(--arc-text-hint);
  text-align: center;
  background: var(--arc-bg-weak);
}

.ai-log-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: min(62vh, 620px);
  overflow: auto;
  padding-right: 4px;
}

.ai-log-card {
  position: relative;
  padding: 14px 16px 16px;
  border: 1px solid var(--arc-border);
  border-radius: 14px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--arc-bg-surface) 94%, white 6%) 0%, var(--arc-bg-surface) 100%);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
}

.ai-log-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-border) 70%, transparent);
}

.ai-log-card--success::before {
  background: linear-gradient(180deg, #10b981 0%, #34d399 100%);
}

.ai-log-card--error::before {
  background: linear-gradient(180deg, #ef4444 0%, #f87171 100%);
}

.ai-log-card--running::before {
  background: linear-gradient(180deg, #3b82f6 0%, #60a5fa 100%);
}

.ai-log-card--canceled::before {
  background: linear-gradient(180deg, #f59e0b 0%, #fbbf24 100%);
}

.ai-log-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ai-log-card__title {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ai-log-card__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ai-log-card__title strong {
  color: var(--arc-text-primary);
  font-size: 15px;
  letter-spacing: -0.02em;
}

.ai-log-card__title span {
  color: var(--arc-text-hint);
  font-size: 12px;
  word-break: break-all;
}

.ai-log-card__run-id {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-hint);
  font-size: 11px;
  letter-spacing: 0.03em;
}

.ai-log-card__meta,
.ai-log-card__foot {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: 10px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.ai-log-card__chapter {
  margin-top: 10px;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.ai-log-card__preview {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 10%, var(--arc-border));
  border-radius: 10px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-surface)) 0%, var(--arc-bg-weak) 100%);
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.ai-log-card__error {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, #ef4444 24%, var(--arc-border));
  border-radius: 10px;
  background: linear-gradient(180deg, color-mix(in srgb, #ef4444 10%, var(--arc-bg-surface)) 0%, color-mix(in srgb, #ef4444 5%, var(--arc-bg-surface)) 100%);
  color: #b91c1c;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.ai-log-card__section-label {
  display: block;
  margin-bottom: 6px;
  color: var(--arc-text-hint);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ai-log-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
}

@media (max-width: 900px) {
  .ai-log-modal {
    width: calc(100vw - 14px);
  }

  .ai-log-modal :deep(.n-card__content) {
    padding: 14px;
  }
}

@media (max-width: 640px) {
  .ai-log-modal__summary {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
