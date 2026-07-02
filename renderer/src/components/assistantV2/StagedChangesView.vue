<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton } from 'naive-ui'
import type { StagedChange } from '@shared/assistant-runtime'

const props = defineProps<{
  changes: StagedChange[]
  isBusy: boolean
  isCommitting?: boolean
}>()

const emit = defineEmits<{
  (e: 'accept', ids: string[]): void
  (e: 'reject', ids: string[]): void
  (e: 'commit', ids?: string[]): void
  (e: 'bind-target', changeId: string, entityId: string): void
}>()

const activeFilter = ref<'all' | 'chapter' | 'setting' | 'pending'>('all')

const filtered = computed(() => {
  const list = props.changes.filter((c) => c.status !== 'committed')
  switch (activeFilter.value) {
    case 'chapter':
      return list.filter((c) => c.kind === 'chapter')
    case 'setting':
      return list.filter((c) => c.kind !== 'chapter')
    case 'pending':
      return list.filter((c) => c.status === 'pending' || c.status === 'streaming')
    default:
      return list
  }
})

const pendingCount = computed(() =>
  props.changes.filter((c) => c.status === 'pending').length
)
const acceptedCount = computed(() =>
  props.changes.filter((c) => c.status === 'accepted').length
)
const visiblePendingIds = computed(() =>
  filtered.value
    .filter((c) => c.status === 'pending')
    .map((c) => c.id)
)

const expandedIds = ref<Set<string>>(new Set())
const reviewingId = ref<string | null>(null)
const reviewingChange = computed(() =>
  props.changes.find((c) => c.id === reviewingId.value) ?? null
)
function toggleExpand(id: string): void {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'chapter': return '章节'
    case 'worldview': return '世界观'
    case 'character': return '人物'
    case 'organization': return '组织'
    case 'outline': return '大纲'
    case 'constraint': return '约束'
    case 'plot_thread': return '线索'
    case 'workflow_document': return '流程'
    default: return kind
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'streaming': return '生成中'
    case 'pending': return '待审阅'
    case 'accepted': return '已确认'
    case 'rejected': return '已忽略'
    case 'committed': return '已写回'
    case 'stale': return '需重解析'
    default: return status
  }
}

function computeDiff(before: string, after: string): { added: string[]; removed: string[] } {
  // 简化 diff：按段落切分，粗粒度对比
  const b = before.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  const a = after.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  const bSet = new Set(b)
  const aSet = new Set(a)
  return {
    added: a.filter((line) => !bSet.has(line)),
    removed: b.filter((line) => !aSet.has(line))
  }
}

function reviewChange(id: string): void {
  reviewingId.value = id
}

function closeReview(): void {
  reviewingId.value = null
}

function reviewNext(): void {
  if (!reviewingChange.value) return
  const currentIndex = filtered.value.findIndex((item) => item.id === reviewingChange.value?.id)
  const next = filtered.value[currentIndex + 1] ?? filtered.value[0]
  reviewingId.value = next?.id ?? null
}

function diffBlocks(change: StagedChange): Array<{ type: 'del' | 'add'; line: string }> {
  const diff = computeDiff(change.before, change.after)
  return [
    ...diff.removed.map((line) => ({ type: 'del' as const, line })),
    ...diff.added.map((line) => ({ type: 'add' as const, line }))
  ]
}

function hasTargetCandidates(change: StagedChange): boolean {
  return change.action === 'update' && Boolean(change.candidates?.length)
}

function bindTarget(changeId: string, entityId: string): void {
  emit('bind-target', changeId, entityId)
}
</script>

<template>
  <div class="stage">
    <div v-if="reviewingChange" class="review">
      <div class="review-head">
        <button class="back-btn" type="button" @click="closeReview">‹ 返回</button>
        <div class="review-title">
          <span class="kind" :class="reviewingChange.kind">{{ kindLabel(reviewingChange.kind) }}</span>
          <strong>{{ reviewingChange.entityTitle }}</strong>
          <span class="status">{{ statusLabel(reviewingChange.status) }}</span>
        </div>
      </div>

      <div class="review-meta">
        <div>
          <span>动作</span>
          <strong>{{ reviewingChange.action }}</strong>
        </div>
        <div v-if="reviewingChange.entityId">
          <span>目标</span>
          <strong>{{ reviewingChange.entityId }}</strong>
        </div>
        <div>
          <span>原因</span>
          <strong>{{ reviewingChange.reason }}</strong>
        </div>
      </div>

      <div class="review-body">
        <div v-if="hasTargetCandidates(reviewingChange)" class="target-box">
          <div class="target-head">匹配目标</div>
          <div class="target-options">
            <button
              v-for="candidate in reviewingChange.candidates"
              :key="candidate.entityId"
              type="button"
              :class="{ active: candidate.entityId === reviewingChange.entityId }"
              @click="bindTarget(reviewingChange.id, candidate.entityId)"
            >
              <strong>{{ candidate.label }}</strong>
              <span v-if="candidate.hint">{{ candidate.hint }}</span>
            </button>
          </div>
        </div>

        <div class="review-section">
          <div class="review-section-head">差异摘要</div>
          <div v-if="diffBlocks(reviewingChange).length" class="review-diff">
            <div
              v-for="(block, index) in diffBlocks(reviewingChange)"
              :key="index"
              class="review-diff-line"
              :class="block.type"
            >
              <span>{{ block.type === 'add' ? '+' : '-' }}</span>
              <p>{{ block.line }}</p>
            </div>
          </div>
          <div v-else class="review-empty">没有检测到文本差异。</div>
        </div>

        <div class="compare">
          <div class="compare-col before">
            <div class="compare-head">修改前</div>
            <pre>{{ reviewingChange.before || '（空）' }}</pre>
          </div>
          <div class="compare-col after">
            <div class="compare-head">修改后</div>
            <pre>{{ reviewingChange.after || '（空）' }}</pre>
          </div>
        </div>
      </div>

      <div class="review-actions">
        <NButton
          size="small"
          :type="reviewingChange.status === 'accepted' ? 'primary' : 'default'"
          :disabled="reviewingChange.status === 'committed'"
          @click="emit('accept', [reviewingChange.id])"
        >
          {{ reviewingChange.status === 'accepted' ? '已确认' : reviewingChange.status === 'rejected' ? '恢复这项' : '确认这项' }}
        </NButton>
        <NButton
          size="small"
          :disabled="reviewingChange.status === 'rejected' || reviewingChange.status === 'committed'"
          @click="emit('reject', [reviewingChange.id])"
        >
          忽略这项
        </NButton>
        <NButton size="small" quaternary @click="reviewNext">
          下一项
        </NButton>
      </div>
    </div>

    <template v-else>
    <div class="head">
      <div class="title-row">
        <div class="title">暂存变更</div>
        <div class="count">
          <strong>{{ pendingCount }}</strong> 待审阅
          <span class="sep">·</span>
          <strong>{{ acceptedCount }}</strong> 已确认
        </div>
      </div>
      <div class="filter">
        <button :class="{ active: activeFilter === 'all' }" @click="activeFilter = 'all'">全部</button>
        <button :class="{ active: activeFilter === 'chapter' }" @click="activeFilter = 'chapter'">章节</button>
        <button :class="{ active: activeFilter === 'setting' }" @click="activeFilter = 'setting'">设定</button>
        <button :class="{ active: activeFilter === 'pending' }" @click="activeFilter = 'pending'">待审阅</button>
      </div>
    </div>

    <div class="list">
      <div v-if="filtered.length === 0" class="empty">
        <div class="empty-title">暂无变更</div>
        <div class="empty-hint">让 AI 帮你改点什么，暂存的变更会显示在这里。</div>
      </div>

      <div
        v-for="c in filtered"
        :key="c.id"
        class="change"
        :class="c.status"
      >
        <div class="change-head">
          <span class="kind" :class="c.kind">{{ kindLabel(c.kind) }}</span>
          <span class="entity">{{ c.entityTitle }}</span>
          <span class="status-pill" :class="c.status">{{ statusLabel(c.status) }}</span>
        </div>
        <div class="action-line">{{ c.action }}</div>
        <div class="reason">{{ c.reason }}</div>

        <div v-if="hasTargetCandidates(c)" class="target-box compact">
          <div class="target-head">匹配目标</div>
          <div class="target-options">
            <button
              v-for="candidate in c.candidates"
              :key="candidate.entityId"
              type="button"
              :class="{ active: candidate.entityId === c.entityId }"
              @click="bindTarget(c.id, candidate.entityId)"
            >
              <strong>{{ candidate.label }}</strong>
              <span v-if="candidate.hint">{{ candidate.hint }}</span>
            </button>
          </div>
        </div>

        <div class="diff">
          <template v-for="(line, i) in computeDiff(c.before, c.after).removed" :key="'d' + i">
            <div v-if="i < 3" class="diff-line del">- {{ line.slice(0, 120) }}{{ line.length > 120 ? '…' : '' }}</div>
          </template>
          <template v-for="(line, i) in computeDiff(c.before, c.after).added" :key="'a' + i">
            <div v-if="i < 3" class="diff-line add">+ {{ line.slice(0, 120) }}{{ line.length > 120 ? '…' : '' }}</div>
          </template>
        </div>

        <div v-if="expandedIds.has(c.id)" class="expanded">
          <div class="side-head">修改前</div>
          <div class="side-body">{{ c.before || '（空）' }}</div>
          <div class="side-head">修改后</div>
          <div class="side-body">{{ c.after || '（空）' }}</div>
        </div>

        <div class="actions">
          <NButton
            size="tiny"
            :type="c.status === 'accepted' ? 'primary' : 'default'"
            :disabled="c.status === 'committed'"
            @click="emit('accept', [c.id])"
          >
            {{ c.status === 'accepted' ? '✓ 已确认' : c.status === 'rejected' ? '恢复' : '确认' }}
          </NButton>
          <NButton
            size="tiny"
            :disabled="c.status === 'rejected' || c.status === 'committed'"
            @click="emit('reject', [c.id])"
          >
            忽略
          </NButton>
          <NButton size="tiny" quaternary @click="toggleExpand(c.id)">
            {{ expandedIds.has(c.id) ? '收起' : '展开全文' }}
          </NButton>
          <NButton size="tiny" quaternary @click="reviewChange(c.id)">
            审阅
          </NButton>
        </div>
      </div>
    </div>

    <div class="foot">
      <div class="foot-actions">
        <NButton
          size="small"
          :disabled="visiblePendingIds.length === 0 || props.isBusy"
          @click="emit('accept', visiblePendingIds)"
        >
          全部确认
        </NButton>
        <NButton
          size="small"
          :disabled="visiblePendingIds.length === 0 || props.isBusy"
          @click="emit('reject', visiblePendingIds)"
        >
          全部忽略
        </NButton>
      </div>
      <NButton
        class="commit-btn"
        size="medium"
        type="primary"
        block
        :loading="props.isCommitting"
        :disabled="acceptedCount === 0 || props.isBusy || props.isCommitting"
        @click="emit('commit')"
      >
        {{ acceptedCount > 0 ? `写回 ${acceptedCount} 项已确认变更` : '写回已确认' }}
      </NButton>
    </div>
    </template>
  </div>
</template>

<style scoped>
.stage {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--arc-bg-surface);
  border-left: 1px solid var(--arc-border);
}
.review {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.review-head {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--arc-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.back-btn {
  align-self: flex-start;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 0;
}
.back-btn:hover {
  color: var(--arc-primary);
}
.review-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.review-title strong {
  min-width: 0;
  flex: 1;
  font-size: 14px;
  color: var(--arc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-meta {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-weak);
}
.review-meta div {
  display: flex;
  gap: 10px;
  align-items: baseline;
  min-width: 0;
}
.review-meta span {
  width: 34px;
  flex: 0 0 auto;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-family: var(--v2-mono, monospace);
}
.review-meta strong {
  min-width: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.5;
  font-weight: 500;
}
.review-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.target-box {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 10px;
}
.target-box.compact {
  margin: 8px 0 10px;
  padding: 8px;
  background: var(--arc-bg-weak);
}
.target-head {
  margin-bottom: 7px;
  color: var(--arc-text-hint);
  font-family: var(--v2-mono, monospace);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.target-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.target-options button {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--arc-border);
  border-radius: 7px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  padding: 7px 8px;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.target-options button:hover {
  border-color: var(--arc-primary);
}
.target-options button.active {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.target-options strong {
  overflow: hidden;
  color: var(--arc-text-primary);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.target-options span {
  overflow: hidden;
  color: var(--arc-text-hint);
  font-size: 11px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-section-head,
.compare-head {
  font-family: var(--v2-mono, monospace);
  color: var(--arc-text-hint);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.review-diff {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  overflow: hidden;
}
.review-diff-line {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  font-family: var(--v2-mono, monospace);
  font-size: 11.5px;
  line-height: 1.55;
  border-top: 1px solid var(--arc-border);
}
.review-diff-line:first-child {
  border-top: none;
}
.review-diff-line span {
  padding: 5px 8px;
  text-align: center;
}
.review-diff-line p {
  margin: 0;
  padding: 5px 9px 5px 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.review-diff-line.add {
  background: var(--v2-add-bg, rgba(4, 120, 87, 0.09));
  color: var(--v2-add, #047857);
}
.review-diff-line.del {
  background: var(--v2-del-bg, rgba(185, 28, 28, 0.07));
  color: var(--v2-del, #b91c1c);
}
.review-empty {
  padding: 14px;
  border: 1px dashed var(--arc-border-strong);
  border-radius: 8px;
  color: var(--arc-text-hint);
  font-size: 12px;
}
.compare {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.compare-col {
  min-width: 0;
}
.compare-col pre {
  margin: 0;
  padding: 10px 11px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--v2-mono, monospace);
  font-size: 11.5px;
  line-height: 1.6;
}
.compare-col.after pre {
  border-color: rgba(4, 120, 87, 0.22);
  background: rgba(4, 120, 87, 0.055);
}
.compare-col.before pre {
  border-color: rgba(185, 28, 28, 0.16);
  background: rgba(185, 28, 28, 0.04);
}
.review-actions {
  padding: 12px 16px 16px;
  border-top: 1px solid var(--arc-border);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.head {
  padding: 16px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-bottom: 1px solid var(--arc-border);
}
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--arc-text-primary);
}
.count {
  font-family: monospace;
  color: var(--arc-text-hint);
  font-size: 12px;
}
.count strong {
  color: var(--arc-text-primary);
  font-weight: 500;
}
.count .sep {
  margin: 0 4px;
}
.filter {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--arc-bg-weak);
  border-radius: 8px;
  border: 1px solid var(--arc-border);
}
.filter button {
  flex: 1;
  background: transparent;
  border: none;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: monospace;
}
.filter button.active {
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  box-shadow: var(--arc-shadow-sm);
}
.list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.empty {
  margin: 40px 8px;
  padding: 22px 20px;
  border: 1px dashed var(--arc-border-strong);
  border-radius: 14px;
  text-align: center;
  color: var(--arc-text-hint);
  font-size: 12.5px;
}
.empty-title {
  color: var(--arc-text-primary);
  font-weight: 500;
  font-size: 13px;
  margin-bottom: 4px;
}
.change {
  border: 1px solid var(--arc-border);
  border-radius: var(--v2-radius-card, 14px);
  padding: 12px 14px;
  transition: border-color 0.18s ease, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  background: var(--arc-bg-surface);
  animation: cardIn 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes cardIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.change:hover {
  border-color: var(--arc-border-strong);
}
.change.accepted {
  border-color: var(--v2-accent-line, var(--arc-primary));
  background: var(--arc-primary-soft);
}
.change.rejected {
  opacity: 0.5;
}
.change.streaming {
  border-color: var(--v2-warn, #b45309);
  background: var(--v2-warn-soft, rgba(180, 83, 9, 0.06));
}
.change-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.kind {
  font-family: var(--v2-mono, monospace);
  font-size: 10px;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  text-transform: uppercase;
}
.kind.chapter { background: var(--arc-primary-soft); color: var(--arc-primary); }
.kind.worldview { background: rgba(180, 83, 9, 0.1); color: #b45309; }
.kind.character { background: rgba(30, 64, 175, 0.1); color: #1e40af; }
.kind.organization { background: rgba(37, 99, 235, 0.1); color: #2563eb; }
.kind.outline { background: rgba(126, 34, 206, 0.1); color: #7e22ce; }
.kind.constraint { background: rgba(24, 24, 27, 0.08); color: var(--arc-text-primary); }
.kind.plot_thread { background: rgba(219, 39, 119, 0.1); color: #db2777; }
.kind.workflow_document { background: rgba(5, 150, 105, 0.1); color: #059669; }
.action-line {
  font-size: 10.5px;
  color: var(--arc-text-hint);
  font-family: var(--v2-mono, monospace);
  margin-bottom: 4px;
}
.status-pill {
  flex: 0 0 auto;
  font-size: 10px;
  font-family: var(--v2-mono, monospace);
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-hint);
  letter-spacing: 0.02em;
}
.status-pill.pending { background: rgba(180, 83, 9, 0.1); color: #b45309; }
.status-pill.accepted { background: var(--arc-primary-soft); color: var(--arc-primary); }
.status-pill.rejected { background: var(--arc-bg-weak); color: var(--arc-text-hint); }
.status-pill.streaming { background: var(--v2-warn-soft, rgba(180, 83, 9, 0.08)); color: var(--v2-warn, #b45309); }
.status-pill.stale { background: var(--v2-danger-soft, rgba(185, 28, 28, 0.06)); color: var(--v2-danger, #b91c1c); }
.entity {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--arc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reason {
  font-size: 12px;
  color: var(--arc-text-secondary);
  margin: 4px 0 8px;
  line-height: 1.5;
}
.diff {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  overflow: hidden;
  font-family: monospace;
  font-size: 11.5px;
  line-height: 1.55;
}
.diff-line {
  padding: 3px 10px;
  white-space: pre-wrap;
  word-break: break-word;
}
.diff-line.add {
  background: var(--v2-add-bg, rgba(4, 120, 87, 0.09));
  color: var(--v2-add, #047857);
}
.diff-line.del {
  background: var(--v2-del-bg, rgba(185, 28, 28, 0.07));
  color: var(--v2-del, #b91c1c);
}
.diff-line + .diff-line {
  border-top: 1px solid var(--arc-border);
}
.expanded {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--arc-border);
  font-size: 12px;
}
.side-head {
  font-size: 10.5px;
  color: var(--arc-text-hint);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 4px;
  font-family: monospace;
}
.side-body {
  padding: 6px 8px;
  background: var(--arc-bg-weak);
  border-radius: 6px;
  margin-bottom: 8px;
  color: var(--arc-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}
.actions {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.foot {
  padding: 12px 16px 16px;
  border-top: 1px solid var(--arc-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--arc-bg-surface);
}
.foot-actions {
  display: flex;
  gap: 8px;
}
.foot-actions :deep(.n-button) {
  flex: 1;
}
.commit-btn {
  font-weight: 600;
}
</style>
