<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NModal, NTag } from 'naive-ui'
import type { ChapterAuditPayload } from './useChapterFirstDraft'

const props = defineProps<{
  show: boolean
  isGenerating: boolean
  isStopping: boolean
  isAuditing: boolean
  isStreaming: boolean
  executionLabel: string
  reasoningContent?: string
  previewTitle: string
  previewContent: string
  progressPercent: number
  progressText: string
  auditResult: ChapterAuditPayload | null
  elapsedSeconds: number
}>()

defineEmits<{
  stop: []
  close: []
}>()

const elapsedDisplay = computed(() => {
  const s = props.elapsedSeconds
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
})

const severityType = (s: 'critical' | 'warning' | 'hint'): 'error' | 'warning' | 'info' => {
  if (s === 'critical') return 'error'
  if (s === 'warning') return 'warning'
  return 'info'
}

const severityLabel = (s: 'critical' | 'warning' | 'hint'): string => {
  if (s === 'critical') return '严重'
  if (s === 'warning') return '建议'
  return '提示'
}

const auditSummary = computed(() => {
  if (!props.auditResult) return ''
  const issues = props.auditResult.issues
  const critical = issues.filter((i) => i.severity === 'critical').length
  const warning = issues.filter((i) => i.severity === 'warning').length
  const hint = issues.filter((i) => i.severity === 'hint').length
  return `共 ${issues.length} 项：${critical} 严重 / ${warning} 建议 / ${hint} 提示`
})
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="AI 初稿执行中"
    :style="{ width: 'min(720px, 92vw)' }"
    :mask-closable="false"
    :closable="!isGenerating"
    :bordered="false"
    @close="$emit('close')"
  >
    <div class="card">
      <div class="head">
        <div class="copy-block">
          <span class="label">AI 初稿执行中</span>
          <strong>{{ executionLabel || '等待开始' }}</strong>
        </div>
        <div class="head-right">
          <span v-if="isGenerating" class="elapsed">{{ elapsedDisplay }}</span>
          <span class="percent">
            {{ isGenerating ? `${progressPercent}%` : '已结束' }}
          </span>
        </div>
      </div>
      <div class="track">
        <div
          class="fill"
          :class="{ shimmer: isGenerating && !isStreaming }"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      <p class="copy">
        {{ progressText || '已停止或完成本次 AI 初稿生成。' }}
      </p>
      <div class="preview arc-scrollbar">
        <div v-if="previewTitle" class="preview-head">{{ previewTitle }}</div>
        <div v-if="reasoningContent" class="reasoning-block">
          <div class="reasoning-head">
            <span class="reasoning-dot" />
            模型思考过程
          </div>
          <pre class="reasoning-body">{{ reasoningContent }}</pre>
        </div>
        <pre v-if="previewContent">{{ previewContent }}</pre>
        <div v-else-if="!reasoningContent" class="preview-placeholder">
          <span class="placeholder-text">{{ executionLabel || 'AI 正在准备本章初稿内容' }}</span>
          <span class="blink-cursor" />
        </div>
      </div>

      <div v-if="isAuditing" class="audit-loading">
        <span class="dot-pulse" />
        正在对照写作备忘审计本章质量…
      </div>

      <div v-else-if="auditResult" class="audit-panel">
        <div class="audit-head">
          <n-tag :type="auditResult.pass ? 'success' : 'error'" size="small" round>
            {{ auditResult.pass ? '审计通过' : '审计未通过' }}
          </n-tag>
          <span class="audit-meta">{{ auditResult.wordCount }} 字 · {{ auditSummary }}</span>
        </div>
        <ul v-if="auditResult.issues.length > 0" class="audit-list arc-scrollbar">
          <li v-for="(issue, idx) in auditResult.issues" :key="idx" class="audit-item">
            <div class="audit-item-head">
              <n-tag :type="severityType(issue.severity)" size="tiny" round>
                {{ severityLabel(issue.severity) }}
              </n-tag>
              <span class="audit-category">{{ issue.category }}</span>
            </div>
            <div v-if="issue.ref" class="audit-ref">{{ issue.ref }}</div>
            <div class="audit-hint">{{ issue.hint }}</div>
          </li>
        </ul>
        <p v-else class="audit-empty">没有发现问题。</p>
      </div>
    </div>

    <template #footer>
      <div class="actions">
        <n-button
          v-if="isGenerating"
          round
          strong
          secondary
          type="warning"
          :loading="isStopping"
          @click="$emit('stop')"
        >
          停止生成
        </n-button>
        <n-button v-else round strong type="primary" @click="$emit('close')">
          关闭
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.copy-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 11px;
  color: var(--arc-text-hint);
  letter-spacing: 0.05em;
}

.copy-block strong {
  font-size: 14px;
  color: var(--arc-text-primary);
}

.head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.elapsed {
  font-size: 12px;
  color: var(--arc-text-secondary);
  font-variant-numeric: tabular-nums;
}

.percent {
  font-size: 14px;
  font-weight: 600;
  color: var(--arc-primary);
  font-variant-numeric: tabular-nums;
}

.track {
  height: 6px;
  background: var(--arc-bg-surface-hover);
  border-radius: 3px;
  overflow: hidden;
}

.fill {
  height: 100%;
  background: linear-gradient(90deg, var(--arc-success), var(--arc-primary));
  border-radius: 3px;
  transition: width 0.3s ease;
}

.fill.shimmer {
  background: linear-gradient(
    90deg,
    var(--arc-success),
    var(--arc-primary),
    var(--arc-success),
    var(--arc-primary)
  );
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.copy {
  margin: 0;
  font-size: 12px;
  color: var(--arc-text-secondary);
  line-height: 1.6;
}

.preview {
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  padding: 12px 14px;
  max-height: 320px;
  overflow-y: auto;
}

.preview-head {
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--arc-text-hint);
  letter-spacing: 0.04em;
}

.preview pre {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  color: var(--arc-text-primary);
  user-select: text;
}

.reasoning-block {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--arc-fill-subtle, rgba(125, 125, 125, 0.08));
  border-left: 2px solid var(--arc-accent, #7c9cf0);
}

.reasoning-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--arc-text-hint);
  letter-spacing: 0.04em;
}

.reasoning-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-accent, #7c9cf0);
  animation: reasoning-pulse 1.2s ease-in-out infinite;
}

@keyframes reasoning-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.reasoning-body {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  color: var(--arc-text-secondary);
  user-select: text;
}

.preview-placeholder {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 48px;
}

.placeholder-text {
  font-size: 13px;
  color: var(--arc-text-secondary);
  line-height: 1.7;
}

.blink-cursor {
  display: inline-block;
  width: 2px;
  height: 16px;
  background: var(--arc-primary);
  border-radius: 1px;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.audit-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  padding: 8px 0;
}

.dot-pulse {
  display: inline-flex;
  gap: 4px;
  width: 24px;
  height: 8px;
  position: relative;
}

.dot-pulse::before,
.dot-pulse::after,
.dot-pulse {
  border-radius: 50%;
}

.dot-pulse::before {
  content: '';
  position: absolute;
  left: 0;
  width: 6px;
  height: 6px;
  background: var(--arc-primary);
  border-radius: 50%;
  animation: dot-bounce 1.2s ease-in-out infinite;
}

.dot-pulse::after {
  content: '';
  position: absolute;
  left: 9px;
  width: 6px;
  height: 6px;
  background: var(--arc-primary);
  border-radius: 50%;
  animation: dot-bounce 1.2s ease-in-out 0.2s infinite;
}

@keyframes dot-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

.audit-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--arc-border);
  padding-top: 12px;
}

.audit-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.audit-meta {
  font-size: 12px;
  color: var(--arc-text-secondary);
}

.audit-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
}

.audit-item {
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.audit-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.audit-category {
  font-size: 11px;
  color: var(--arc-text-hint);
}

.audit-ref {
  font-size: 12px;
  color: var(--arc-text-secondary);
  font-style: italic;
}

.audit-hint {
  font-size: 13px;
  color: var(--arc-text-primary);
  line-height: 1.6;
}

.audit-empty {
  margin: 0;
  font-size: 12px;
  color: var(--arc-text-secondary);
}
</style>
