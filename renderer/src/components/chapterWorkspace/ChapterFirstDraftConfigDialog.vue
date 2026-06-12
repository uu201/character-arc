<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NCheckbox, NCheckboxGroup, NInputNumber, NInput, NModal } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { parseChapterWordTarget } from '@/features/chapters/wordTarget'

export type FirstDraftConfig = {
  targetWordCount: number
  selectedReferenceWorkIds: string[]
  enabledSkillIds: string[]
  userPrompt: string
}

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'confirm', config: FirstDraftConfig): void
  (e: 'cancel'): void
}>()

const appStore = useAppStore()

const chapter = computed(() => appStore.selectedChapter)
const project = computed(() => appStore.currentProject)

const targetWordCount = ref(3000)
const selectedRefIds = ref<string[]>([])
const userPrompt = ref('')

const referenceWorks = computed(() => appStore.referenceWorks)
const projectSkills = computed(() =>
  (project.value?.projectSkills ?? []).filter((s) => s.enabled && s.stageIds.includes('draft'))
)

watch(() => props.show, (visible) => {
  if (!visible) return
  targetWordCount.value = parseChapterWordTarget(chapter.value?.wordTarget) || 3000
  selectedRefIds.value = [...(project.value?.selectedReferenceWorkIds ?? [])]
  userPrompt.value = ''
})

function handleConfirm(): void {
  emit('confirm', {
    targetWordCount: targetWordCount.value,
    selectedReferenceWorkIds: selectedRefIds.value,
    enabledSkillIds: projectSkills.value.map((s) => s.id),
    userPrompt: userPrompt.value.trim()
  })
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="生成初稿配置"
    :style="{ width: 'min(560px, 90vw)' }"
    :mask-closable="true"
    :closable="true"
    :bordered="false"
    @close="$emit('cancel')"
    @mask-click="$emit('cancel')"
  >
    <div class="config-form">
      <section class="config-section">
        <label class="section-label">目标字数</label>
        <n-input-number
          v-model:value="targetWordCount"
          :min="500"
          :max="10000"
          :step="500"
          size="small"
        />
      </section>

      <section v-if="referenceWorks.length > 0" class="config-section">
        <label class="section-label">参考作品（拆书库）</label>
        <p class="section-hint">勾选的作品风格将注入AI写作提示，不勾选则不参考</p>
        <n-checkbox-group v-model:value="selectedRefIds">
          <div class="checkbox-list">
            <n-checkbox v-for="work in referenceWorks" :key="work.id" :value="work.id" :label="work.title" />
          </div>
        </n-checkbox-group>
      </section>

      <section class="config-section">
        <label class="section-label">补充指令（可选）</label>
        <n-input
          v-model:value="userPrompt"
          type="textarea"
          placeholder="如：这章节奏要快、多写对白、强调角色内心冲突..."
          :rows="2"
          size="small"
        />
      </section>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <n-button size="small" @click="$emit('cancel')">取消</n-button>
        <n-button type="primary" size="small" @click="handleConfirm">开始生成</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.config-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.config-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.section-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color-1, #333);
}
.section-hint {
  font-size: 12px;
  color: var(--text-color-3, #999);
  margin: 0;
}
.checkbox-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>