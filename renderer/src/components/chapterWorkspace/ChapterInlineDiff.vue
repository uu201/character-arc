<script setup lang="ts">
import { computed } from 'vue'
import { CheckCheck, X } from 'lucide-vue-next'
import type { StagedChange } from '@shared/assistant-runtime'

const props = defineProps<{
  changes: StagedChange[]
  isCommitting?: boolean
}>()

const emit = defineEmits<{
  accept: [id: string]
  reject: [id: string]
}>()

const pending = computed(() =>
  props.changes.filter((c) => c.kind === 'chapter' && (c.status === 'pending' || c.status === 'streaming'))
)

function splitLines(text: string): string[] {
  return text.split(/\n+/).map((s) => s.trim()).filter(Boolean)
}

type DiffRow = { type: 'del' | 'add' | 'context'; line: string }

function diffRows(before: string, after: string): DiffRow[] {
  const b = splitLines(before)
  const a = splitLines(after)
  const n = b.length
  const m = a.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = b[i] === a[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0; let j = 0
  while (i < n && j < m) {
    if (b[i] === a[j]) { rows.push({ type: 'context', line: b[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { rows.push({ type: 'del', line: b[i] }); i++ }
    else { rows.push({ type: 'add', line: a[j] }); j++ }
  }
  while (i < n) { rows.push({ type: 'del', line: b[i] }); i++ }
  while (j < m) { rows.push({ type: 'add', line: a[j] }); j++ }
  return rows
}
</script>

<template>
  <div v-if="pending.length > 0" class="inline-diff-list">
    <div
      v-for="change in pending"
      :key="change.id"
      class="inline-diff"
      :class="{ streaming: change.status === 'streaming' }"
    >
      <div class="diff-header">
        <span class="diff-badge">STAGED</span>
        <span class="diff-title">{{ change.entityTitle }}</span>
        <span class="diff-reason">{{ change.reason }}</span>
      </div>

      <div class="diff-body">
        <template v-if="change.status === 'streaming'">
          <div class="diff-streaming">
            <span class="streaming-dot" /><span class="streaming-dot" /><span class="streaming-dot" />
            AI 正在生成修改内容…
          </div>
        </template>
        <template v-else>
          <div
            v-for="(row, idx) in diffRows(change.before, change.after)"
            :key="idx"
            class="diff-line"
            :class="row.type"
          >
            <span class="diff-sign">{{ row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ' }}</span>
            <span class="diff-text">{{ row.line }}</span>
          </div>
        </template>
      </div>

      <div v-if="change.status === 'pending'" class="diff-bar">
        <button
          class="diff-btn accept"
          :disabled="isCommitting"
          @click="emit('accept', change.id)"
        >
          <CheckCheck :size="13" />
          接受
        </button>
        <button
          class="diff-btn reject"
          @click="emit('reject', change.id)"
        >
          <X :size="13" />
          拒绝
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inline-diff-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 0 16px;
}

.inline-diff {
  border: 1px solid var(--arc-primary-soft, rgba(13,125,90,.22));
  border-left: 3px solid var(--arc-primary, #0d7d5a);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  box-shadow: 0 2px 8px rgba(0,0,0,.06);
  overflow: hidden;
  animation: slideIn .22s cubic-bezier(.16,1,.3,1);
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.inline-diff.streaming {
  border-color: rgba(180,83,9,.3);
  border-left-color: #b45309;
}

.diff-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-weak);
}

.diff-badge {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .06em;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--arc-primary-soft, rgba(13,125,90,.1));
  color: var(--arc-primary, #0d7d5a);
  flex-shrink: 0;
}

.diff-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-primary);
  flex-shrink: 0;
}

.diff-reason {
  font-size: 11.5px;
  color: var(--arc-text-hint);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-body {
  font-family: ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.65;
}

.diff-line {
  display: flex;
  gap: 8px;
  padding: 2px 12px;
}

.diff-line + .diff-line {
  border-top: 1px solid var(--arc-border);
}

.diff-line.del {
  background: rgba(185,28,28,.055);
  color: #b91c1c;
}

.diff-line.add {
  background: rgba(4,120,87,.07);
  color: #047857;
}

.diff-line.context {
  color: var(--arc-text-hint);
}

.diff-sign {
  flex: 0 0 12px;
  text-align: center;
  user-select: none;
  opacity: .7;
}

.diff-text {
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}

.diff-streaming {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px;
  font-size: 12px;
  color: #b45309;
}

.streaming-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #b45309;
  animation: bounce 1.3s ease-in-out infinite;
}
.streaming-dot:nth-child(2) { animation-delay: .18s; }
.streaming-dot:nth-child(3) { animation-delay: .36s; }

@keyframes bounce {
  0%,60%,100% { opacity: .3; transform: translateY(0); }
  30%          { opacity: 1;  transform: translateY(-3px); }
}

.diff-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--arc-border);
  background: var(--arc-bg-weak);
}

.diff-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all .15s ease;
}

.diff-btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.diff-btn.accept {
  background: var(--arc-primary, #0d7d5a);
  color: #fff;
  border-color: var(--arc-primary, #0d7d5a);
}

.diff-btn.accept:hover:not(:disabled) {
  filter: brightness(1.1);
}

.diff-btn.reject {
  background: transparent;
  color: var(--arc-text-secondary);
  border-color: var(--arc-border-strong);
}

.diff-btn.reject:hover {
  color: #b91c1c;
  border-color: rgba(185,28,28,.4);
  background: rgba(185,28,28,.05);
}
</style>
