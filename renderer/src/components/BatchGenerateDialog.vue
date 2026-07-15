<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { NButton, NForm, NFormItem, NInput, NInputNumber, NModal, NProgress, NSelect } from 'naive-ui'

const props = withDefaults(defineProps<{
  show: boolean
  title: string
  description?: string
  itemLabel: string
  loading?: boolean
  progress?: number
  maxCount?: number
  typeOptions?: Array<{ label: string; value: string }>
  defaultTypes?: string[]
}>(), {
  description: '',
  loading: false,
  progress: 0,
  maxCount: 100,
  typeOptions: () => [],
  defaultTypes: () => []
})

const emit = defineEmits<{
  close: []
  submit: [payload: { count: number; prompt: string; types: string[] }]
}>()

const count = ref(10)
const prompt = ref('')
const types = ref<string[]>([])
const hasTypes = computed(() => props.typeOptions.length > 0)

watch(() => props.show, (show) => {
  if (!show || props.loading) return
  count.value = Math.min(10, props.maxCount)
  prompt.value = ''
  types.value = [...props.defaultTypes]
})

function submit(): void {
  if (props.loading || count.value < 1 || (hasTypes.value && types.value.length === 0)) return
  emit('submit', { count: count.value, prompt: prompt.value.trim(), types: [...types.value] })
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    class="batch-generate-modal"
    :title="title"
    :bordered="false"
    :mask-closable="!loading"
    :closable="!loading"
    @close="emit('close')"
  >
    <p v-if="description" class="batch-description">{{ description }}</p>
    <n-form label-placement="top">
      <n-form-item v-if="hasTypes" label="生成类型">
        <n-select v-model:value="types" multiple :options="typeOptions" placeholder="至少选择一种类型" />
      </n-form-item>
      <n-form-item :label="`${itemLabel}数量`">
        <n-input-number v-model:value="count" :min="1" :max="maxCount" :precision="0" style="width: 100%" />
      </n-form-item>
      <n-form-item label="补充要求（可选）">
        <n-input
          v-model:value="prompt"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 6 }"
          placeholder="例如：偏群像、避免同质化、优先补充反派阵营"
        />
      </n-form-item>
    </n-form>
    <div v-if="loading" class="batch-progress">
      <n-progress type="line" :percentage="progress" :show-indicator="false" />
      <span>已完成 {{ progress }}%</span>
    </div>
    <template #footer>
      <div class="batch-footer">
        <n-button :disabled="loading" @click="emit('close')">取消</n-button>
        <n-button type="primary" :loading="loading" @click="submit">
          <template #icon><Sparkles :size="16" /></template>
          开始生成
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.batch-description {
  margin: 0 0 18px;
  color: var(--arc-text-muted);
  line-height: 1.7;
}

.batch-progress {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  color: var(--arc-text-muted);
  font-size: 12px;
}

.batch-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

<style>
.batch-generate-modal {
  width: min(520px, calc(100vw - 32px));
}
</style>
