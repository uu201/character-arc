<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NCheckbox, NModal, NTag } from 'naive-ui'

export interface EnhanceFieldDiff {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'tags'
  original: string | string[]
  suggested: string | string[]
  changed: boolean
}

const props = defineProps<{
  show: boolean
  fields: EnhanceFieldDiff[]
  loading: boolean
}>()

const emit = defineEmits<{
  apply: [accepted: Record<string, string | string[]>]
  close: []
}>()

const checkedKeys = ref<Set<string>>(new Set())

watch(() => props.fields, (fields) => {
  checkedKeys.value = new Set(fields.filter((f) => f.changed).map((f) => f.key))
}, { immediate: true })

const changedFields = computed(() => props.fields.filter((f) => f.changed))
const hasChecked = computed(() => checkedKeys.value.size > 0)

function toggleField(key: string, checked: boolean): void {
  if (checked) {
    checkedKeys.value.add(key)
  } else {
    checkedKeys.value.delete(key)
  }
  checkedKeys.value = new Set(checkedKeys.value)
}

function handleAcceptAll(): void {
  const accepted: Record<string, string | string[]> = {}
  for (const field of changedFields.value) {
    accepted[field.key] = field.suggested
  }
  emit('apply', accepted)
}

function handleAcceptSelected(): void {
  const accepted: Record<string, string | string[]> = {}
  for (const field of changedFields.value) {
    if (checkedKeys.value.has(field.key)) {
      accepted[field.key] = field.suggested
    }
  }
  emit('apply', accepted)
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    class="arc-editor-modal arc-enhance-modal"
    title="AI 补充建议"
    :bordered="false"
    @close="emit('close')"
  >
    <div v-if="changedFields.length === 0 && !props.loading" class="enhance-empty">
      AI 未产生有效的补充建议，请尝试补充更多上下文后重试。
    </div>

    <div v-else class="enhance-field-list">
      <div v-for="field in changedFields" :key="field.key" class="enhance-field-row">
        <div class="field-header">
          <n-checkbox
            :checked="checkedKeys.has(field.key)"
            @update:checked="(val) => toggleField(field.key, val)"
          />
          <span class="field-label">{{ field.label }}</span>
        </div>
        <div class="field-compare">
          <div class="field-original">
            <span class="compare-tag">当前</span>
            <template v-if="field.type === 'tags'">
              <span v-if="!Array.isArray(field.original) || field.original.length === 0" class="empty-hint">（空）</span>
              <span v-else class="tag-list">
                <n-tag v-for="t in field.original" :key="String(t)" size="small" round>{{ t }}</n-tag>
              </span>
            </template>
            <span v-else class="field-text">{{ field.original || '（空）' }}</span>
          </div>
          <div class="field-suggested">
            <span class="compare-tag suggested">AI 建议</span>
            <template v-if="field.type === 'tags'">
              <span class="tag-list">
                <n-tag v-for="t in field.suggested" :key="String(t)" size="small" round type="success">{{ t }}</n-tag>
              </span>
            </template>
            <span v-else class="field-text highlighted">{{ field.suggested }}</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="arc-modal-actions">
        <n-button round @click="emit('close')">放弃</n-button>
        <n-button round :disabled="!hasChecked" @click="handleAcceptSelected">采纳选中</n-button>
        <n-button type="primary" round :disabled="changedFields.length === 0" @click="handleAcceptAll">
          全部采纳
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.enhance-empty {
  text-align: center;
  color: var(--arc-text-hint);
  padding: 32px 0;
}

.enhance-field-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.enhance-field-row {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md, 8px);
  padding: 12px;
}

.field-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.field-label {
  font-weight: 500;
  font-size: 13px;
  color: var(--arc-text-primary);
}

.field-compare {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 28px;
}

.field-original,
.field-suggested {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.compare-tag {
  flex-shrink: 0;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--arc-bg-mix);
  color: var(--arc-text-hint);
}

.compare-tag.suggested {
  background: color-mix(in srgb, var(--arc-primary) 15%, transparent);
  color: var(--arc-primary);
}

.field-text {
  font-size: 13px;
  color: var(--arc-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.field-text.highlighted {
  color: var(--arc-text-primary);
}

.empty-hint {
  font-size: 13px;
  color: var(--arc-text-hint);
  font-style: italic;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
