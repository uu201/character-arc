<script setup lang="ts">
import { CheckSquare, Trash2, X } from 'lucide-vue-next'
import { NButton } from 'naive-ui'

defineProps<{
  active: boolean
  selectedCount: number
  totalCount: number
  allSelected: boolean
  itemLabel: string
}>()

const emit = defineEmits<{
  toggle: []
  selectAll: []
  clear: []
  delete: []
}>()
</script>

<template>
  <div class="batch-selection-bar" :class="{ active }">
    <n-button v-if="!active" size="small" secondary :disabled="totalCount === 0" @click="emit('toggle')">
      <template #icon><CheckSquare :size="14" /></template>
      多选
    </n-button>
    <template v-else>
      <div class="selection-summary">
        <CheckSquare :size="15" />
        <span>已选 <strong>{{ selectedCount }}</strong> 个{{ itemLabel }}</span>
      </div>
      <div class="selection-actions">
        <n-button size="small" secondary :disabled="totalCount === 0" @click="emit('selectAll')">
          {{ allSelected ? '取消全选' : `全选当前 ${totalCount} 项` }}
        </n-button>
        <n-button size="small" quaternary :disabled="selectedCount === 0" @click="emit('clear')">清空</n-button>
        <n-button size="small" type="error" secondary :disabled="selectedCount === 0" @click="emit('delete')">
          <template #icon><Trash2 :size="14" /></template>
          批量删除
        </n-button>
        <n-button size="small" quaternary title="退出多选" aria-label="退出多选" @click="emit('toggle')">
          <template #icon><X :size="14" /></template>
        </n-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.batch-selection-bar {
  display: flex;
  min-height: 34px;
  align-items: center;
  margin-bottom: 12px;
}

.batch-selection-bar.active {
  justify-content: space-between;
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 24%, var(--arc-border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
  padding: 8px 10px;
}

.selection-summary,
.selection-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.selection-summary {
  color: var(--arc-text-secondary);
  font-size: 13px;
  white-space: nowrap;
}

.selection-summary svg,
.selection-summary strong {
  color: var(--arc-primary);
}

@media (max-width: 680px) {
  .batch-selection-bar.active {
    align-items: flex-start;
    flex-direction: column;
  }

  .selection-actions {
    width: 100%;
    flex-wrap: wrap;
  }
}
</style>
