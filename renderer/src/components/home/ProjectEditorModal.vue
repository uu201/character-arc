<script setup lang="ts">
import { reactive, watch } from 'vue'
import { BookOpen, ImagePlus, X } from 'lucide-vue-next'
import { NButton, NForm, NFormItem, NInput, NModal, useMessage } from 'naive-ui'
import { NOVEL_LENGTH_OPTIONS } from '@/features/wizard/projectGenres'
import type { NovelLength, ProjectSummary } from '@/types/app'

const props = defineProps<{
  show: boolean
  project: ProjectSummary | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'submit', payload: {
    id: string
    title: string
    genre: string
    novelLength: NovelLength
    cover: string
  }): void
  (e: 'pickCover'): void
}>()

const message = useMessage()

const form = reactive({
  title: '',
  genre: '',
  novelLength: 'long' as NovelLength,
  cover: ''
})

watch(
  () => props.project,
  (project) => {
    form.title = project?.title ?? ''
    form.genre = project?.genre ?? ''
    form.novelLength = project?.novelLength === 'short' ? 'short' : 'long'
    form.cover = project?.cover ?? ''
  },
  { immediate: true }
)

watch(
  () => props.project?.cover,
  (cover) => {
    if (cover !== undefined) {
      form.cover = cover
    }
  }
)

function closeModal(): void {
  emit('update:show', false)
}

function submitForm(): void {
  if (!props.project?.id) {
    return
  }

  if (!form.title.trim() || !form.genre.trim()) {
    message.warning('请完整填写项目标题和题材分类')
    return
  }

  emit('submit', {
    id: props.project.id,
    title: form.title,
    genre: form.genre,
    novelLength: form.novelLength,
    cover: form.cover
  })
}

function clearCover(): void {
  form.cover = ''
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    class="arc-editor-modal project-editor-modal"
    title="编辑项目信息"
    :bordered="false"
    @close="closeModal"
  >
    <n-form label-placement="top">
      <n-form-item label="项目封面">
        <div class="cover-editor">
          <div
            class="cover-preview"
            :style="{ background: form.cover || 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' }"
          >
            <BookOpen :size="30" />
          </div>
          <div class="cover-actions">
            <n-button round strong @click="emit('pickCover')">
              <template #icon>
                <ImagePlus :size="16" />
              </template>
              选择本地图片
            </n-button>
            <n-button round strong secondary :disabled="!form.cover" @click="clearCover">
              <template #icon>
                <X :size="16" />
              </template>
              清除封面
            </n-button>
          </div>
        </div>
      </n-form-item>

      <div class="form-grid">
        <n-form-item label="项目标题">
          <n-input v-model:value="form.title" placeholder="例如：赛博飞升指南" />
        </n-form-item>
        <n-form-item label="题材分类">
          <n-input v-model:value="form.genre" placeholder="例如：科幻 / 赛博朋克" />
        </n-form-item>
      </div>

      <n-form-item label="作品长度">
        <div class="length-grid">
          <button
            v-for="option in NOVEL_LENGTH_OPTIONS"
            :key="option.value"
            type="button"
            class="length-card"
            :class="{ active: form.novelLength === option.value }"
            @click="form.novelLength = option.value"
          >
            <strong>{{ option.label }}</strong>
            <span>{{ option.description }}</span>
          </button>
        </div>
      </n-form-item>
    </n-form>

    <template #footer>
      <div class="arc-modal-actions">
        <n-button round strong @click="closeModal">取消</n-button>
        <n-button type="primary" round strong @click="submitForm">保存修改</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.project-editor-modal :deep(.n-card) {
  border-radius: 10px;
}

.cover-editor {
  display: flex;
  align-items: center;
  gap: 18px;
}

.cover-preview {
  display: inline-flex;
  width: 112px;
  height: 112px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: white;
  flex-shrink: 0;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.1);
  background-size: cover !important;
  background-position: center !important;
}

.cover-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.length-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.length-card {
  display: flex;
  min-height: 88px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  border: 2px solid transparent;
  border-radius: 8px;
  background: var(--arc-bg-weak);
  color: #4b5563;
  cursor: pointer;
  padding: 16px;
  text-align: left;
  transition: all 0.24s ease;
}

.length-card:hover {
  background: rgba(243, 244, 246, 0.96);
}

.length-card.active {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-bg-mix));
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.length-card strong {
  font-size: 16px;
}

.length-card span {
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 720px) {
  .cover-editor {
    align-items: flex-start;
    flex-direction: column;
  }

  .form-grid,
  .length-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
