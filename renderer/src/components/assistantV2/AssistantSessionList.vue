<script setup lang="ts">
import { computed } from 'vue'
import type { AssistantSession } from '@shared/assistant-runtime'

const props = defineProps<{
  sessions: AssistantSession[]
  activeSessionId: string | null
}>()

const emit = defineEmits<{
  (e: 'switch', sessionId: string): void
  (e: 'create'): void
  (e: 'delete', sessionId: string): void
}>()

type GroupKey = 'today' | 'yesterday' | 'week' | 'earlier'
const GROUP_LABEL: Record<GroupKey, string> = {
  today: '今天',
  yesterday: '昨天',
  week: '本周',
  earlier: '更早'
}

function groupOf(iso: string): GroupKey {
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 86400_000)
  const startOfWeek = new Date(startOfToday.getTime() - 7 * 86400_000)
  if (d >= startOfToday) return 'today'
  if (d >= startOfYesterday) return 'yesterday'
  if (d >= startOfWeek) return 'week'
  return 'earlier'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

const grouped = computed(() => {
  const buckets: Record<GroupKey, AssistantSession[]> = {
    today: [], yesterday: [], week: [], earlier: []
  }
  for (const s of props.sessions) {
    buckets[groupOf(s.updatedAt)].push(s)
  }
  const order: GroupKey[] = ['today', 'yesterday', 'week', 'earlier']
  return order
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: GROUP_LABEL[k], items: buckets[k] }))
})
</script>

<template>
  <div class="session-list">
    <div class="head">
      <div class="brand">
        <span class="dot" />
        <span>全局助理</span>
        <span class="ver">v2</span>
      </div>
    </div>

    <button class="new-btn" @click="emit('create')">
      <span class="plus">+</span>
      <span>新建对话</span>
    </button>

    <div class="list">
      <div v-if="props.sessions.length === 0" class="empty">
        <div class="empty-title">还没有会话</div>
        <div class="empty-hint">点击上方"新建对话"开始一段。</div>
      </div>

      <template v-for="group in grouped" :key="group.key">
        <div class="group-label">{{ group.label }}</div>
        <div
          v-for="s in group.items"
          :key="s.id"
          class="item"
          :class="{ active: s.id === props.activeSessionId }"
          @click="emit('switch', s.id)"
        >
          <div class="title">{{ s.title }}</div>
          <div class="meta">
            <span>{{ formatTime(s.updatedAt) }}</span>
            <button class="del" @click.stop="emit('delete', s.id)" aria-label="删除会话">✕</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.session-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--arc-bg-surface);
  border-right: 1px solid var(--arc-border);
}
.head {
  padding: 16px 14px 10px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: -0.02em;
  color: var(--arc-text-primary);
}
.brand .dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--arc-primary);
  box-shadow: 0 0 0 3px var(--arc-primary-soft);
}
.brand .ver {
  font-family: var(--v2-mono);
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-hint);
  font-weight: 500;
  letter-spacing: 0;
}
.new-btn {
  margin: 4px 12px 14px;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--arc-text-primary);
  color: var(--arc-bg-body);
  border: none;
  font-size: 12.5px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: transform 0.16s ease;
  font-family: inherit;
}
.new-btn:hover { transform: translateY(-1px); }
.new-btn:active { transform: translateY(0); }
.new-btn .plus { font-size: 14px; line-height: 1; }
.list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.group-label {
  padding: 12px 10px 4px;
  font-size: 10.5px;
  color: var(--arc-text-hint);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-family: var(--v2-mono);
}
.empty {
  padding: 24px 12px;
  text-align: center;
}
.empty-title {
  font-size: 12.5px;
  color: var(--arc-text-secondary);
  font-weight: 500;
  margin-bottom: 4px;
}
.empty-hint {
  font-size: 11px;
  color: var(--arc-text-hint);
}
.item {
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.item:hover { background: var(--arc-bg-weak); }
.item.active { background: var(--arc-primary-soft); }
.item.active .title { color: var(--arc-primary); }
.title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--arc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.35;
}
.meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10.5px;
  color: var(--arc-text-hint);
  font-family: var(--v2-mono);
}
.del {
  border: none;
  background: transparent;
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.15s ease;
  line-height: 1;
}
.item:hover .del { opacity: 1; }
.del:hover { color: var(--v2-danger); background: var(--v2-danger-soft); }
</style>
