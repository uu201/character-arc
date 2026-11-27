<script setup lang="ts">
import { computed, ref } from 'vue'
import { PanelLeftClose, Plus } from 'lucide-vue-next'
import type { AssistantSession } from '@shared/assistant-runtime'

const props = defineProps<{
  sessions: AssistantSession[]
  activeSessionId: string | null
}>()

const emit = defineEmits<{
  (e: 'switch', sessionId: string): void
  (e: 'create'): void
  (e: 'delete', sessionId: string): void
  (e: 'collapse'): void
  (e: 'cleanup', days: number): void
}>()

const cleanupDays = ref('30')

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
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  })
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
        <span>AI 助手</span>
      </div>
      <button class="collapse-side" title="收起对话记录" @click="emit('collapse')">
        <PanelLeftClose :size="16" />
      </button>
    </div>

    <button type="button" class="new-btn" @click="emit('create')">
      <Plus :size="16" :stroke-width="2" aria-hidden="true" />
      <span>新建对话</span>
    </button>
    <div class="cleanup-row">
      <select v-model="cleanupDays" aria-label="清理多久以前的对话">
        <option value="30">1个月前</option>
        <option value="90">3个月前</option>
        <option value="180">6个月前</option>
      </select>
      <button type="button" class="cleanup-btn" @click="emit('cleanup', Number(cleanupDays))">清理</button>
    </div>

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
  background: var(--assistant-subtle, var(--arc-bg-body));
  border-right: 1px solid var(--assistant-border, var(--arc-border));
}
.head {
  padding: 18px 16px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 54px;
}
.collapse-side {
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 6px;
  transition: background 0.15s ease, color 0.15s ease;
}
.collapse-side:hover {
  background: var(--arc-bg-weak);
  color: var(--arc-text-primary);
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
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--arc-text-secondary);
  box-shadow: none;
}
.new-btn {
  margin: 6px 12px 14px;
  min-height: 40px;
  padding: 10px 14px;
  border-radius: 9px;
  background: var(--assistant-action-bg, var(--arc-text-primary));
  color: var(--assistant-action-fg, var(--arc-bg-surface));
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-shrink: 0;
  cursor: pointer;
  transition: background .15s, transform .15s;
  font-family: inherit;
}
.new-btn:hover { background: var(--arc-text-secondary); }
.new-btn:active { transform: translateY(1px); }
.new-btn svg { flex-shrink: 0; }
.list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cleanup-row {
  display: flex;
  gap: 6px;
  padding: 0 12px 10px;
}
.cleanup-row select,
.cleanup-btn {
  min-width: 0;
  height: 28px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font: inherit;
  font-size: 11px;
}
.cleanup-row select { flex: 1; padding: 0 5px; }
.cleanup-btn { padding: 0 9px; cursor: pointer; }
.cleanup-btn:hover { color: var(--arc-primary); border-color: var(--arc-primary); }
.group-label {
  padding: 18px 12px 7px;
  font-size: 11px;
  color: var(--arc-text-secondary);
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  font-family: inherit;
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
  position: relative;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex-shrink: 0;
}
.item:hover { background: var(--assistant-hover, var(--arc-bg-surface-hover)); }
.item.active {
  background: color-mix(in srgb, var(--arc-text-primary) 12%, var(--arc-bg-surface));
  border-color: color-mix(in srgb, var(--arc-text-primary) 18%, transparent);
}
.item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--arc-text-primary);
}
.item.active .title { color: var(--arc-text-primary); font-weight: 600; }
.title {
  font-size: 12.5px;
  font-weight: 400;
  color: var(--arc-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.5;
}
.meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--arc-text-secondary);
  font-family: inherit;
}
.del {
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.15s ease;
  line-height: 1;
}
.item:hover .del, .item:focus-within .del { opacity: 1; }
.del:hover { color: var(--v2-danger); background: var(--v2-danger-soft); }
</style>
