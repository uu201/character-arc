<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { BookOpen, ImagePlus, X } from 'lucide-vue-next'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, NModal, NTag, useMessage } from 'naive-ui'
import {
  buildCoverPromptWorkbenchResult,
  type CoverPromptWorkbenchInput,
  type CoverPromptWorkbenchResult
} from '@/features/cover/promptWorkbench'
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
    targetPlatform: string
  }): void
  (e: 'pickCover'): void
  (e: 'save-cover-prompt', payload: CoverPromptWorkbenchInput): void
}>()

const message = useMessage()
const PLATFORM_SUGGESTIONS = ['番茄小说', '起点中文网', '晋江文学城', '知乎盐言', '七猫小说', '刺猬猫']

const form = reactive({
  title: '',
  genre: '',
  novelLength: 'long' as NovelLength,
  cover: '',
  targetPlatform: ''
})

const workbench = reactive({
  authorName: '',
  extraNotes: ''
})

const generatedPrompt = ref<CoverPromptWorkbenchResult | null>(null)
const generatedPromptFingerprint = ref('')

const referenceTitles = computed(() => props.project?.referenceWorks.map((work) => work.title).filter(Boolean) ?? [])
const workbenchReferenceLabel = computed(() => {
  if (!referenceTitles.value.length) {
    return '暂无拆书资产'
  }

  const previews = referenceTitles.value.slice(0, 3).join('、')
  const suffix = referenceTitles.value.length > 3 ? ` 等 ${referenceTitles.value.length} 部作品` : ''
  return `本次会参考：${previews}${suffix}`
})

const isPromptStale = computed(() => {
  const input = createWorkbenchInput()
  if (!input || !generatedPrompt.value) {
    return false
  }

  return buildWorkbenchFingerprint(input) !== generatedPromptFingerprint.value
})

function syncFormFromProject(project: ProjectSummary | null): void {
  form.title = project?.title ?? ''
  form.genre = project?.genre ?? ''
  form.novelLength = project?.novelLength === 'short' ? 'short' : 'long'
  form.cover = project?.cover ?? ''
  form.targetPlatform = project?.targetPlatform ?? ''
}

function resetWorkbench(): void {
  workbench.authorName = ''
  workbench.extraNotes = ''
  generatedPrompt.value = null
  generatedPromptFingerprint.value = ''
}

watch(
  () => [props.project?.id, props.show] as const,
  ([projectId, show], previousValue) => {
    if (!show) {
      return
    }

    const [previousProjectId, previousShow] = previousValue ?? []
    if (projectId !== previousProjectId || show !== previousShow) {
      syncFormFromProject(props.project)
      resetWorkbench()
    }
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

function buildWorkbenchProject(): ProjectSummary | null {
  if (!props.project) {
    return null
  }

  return {
    ...props.project,
    title: form.title.trim() || props.project.title,
    genre: form.genre.trim() || props.project.genre,
    novelLength: form.novelLength,
    cover: form.cover,
    targetPlatform: form.targetPlatform.trim()
  }
}

function createWorkbenchInput(): CoverPromptWorkbenchInput | null {
  const project = buildWorkbenchProject()
  if (!project) {
    return null
  }

  return {
    project,
    authorName: workbench.authorName,
    extraNotes: workbench.extraNotes
  }
}

function buildWorkbenchFingerprint(input: CoverPromptWorkbenchInput): string {
  return JSON.stringify({
    projectTitle: input.project.title,
    genre: input.project.genre,
    targetPlatform: input.project.targetPlatform,
    novelLength: input.project.novelLength,
    referenceTitles: input.project.referenceWorks.map((work) => work.title),
    authorName: input.authorName.trim(),
    extraNotes: input.extraNotes.trim()
  })
}

function generateCoverPrompt(): void {
  const input = createWorkbenchInput()
  if (!input) {
    return
  }

  if (!form.title.trim() || !form.genre.trim()) {
    message.warning('请先填写项目标题和题材分类，再生成封面提示词')
    return
  }

  generatedPrompt.value = buildCoverPromptWorkbenchResult(input)
  generatedPromptFingerprint.value = buildWorkbenchFingerprint(input)
}

function saveCoverPrompt(): void {
  const input = createWorkbenchInput()
  if (!input || !generatedPrompt.value) {
    message.warning('请先生成封面提示词，再保存到知识库')
    return
  }

  if (isPromptStale.value) {
    message.warning('封面提示词依赖的输入已变化，请重新生成后再保存')
    return
  }

  emit('save-cover-prompt', input)
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
    cover: form.cover,
    targetPlatform: form.targetPlatform
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
    <div class="project-editor-body">
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

      <n-form-item label="目标平台">
        <div class="platform-editor">
          <n-input
            v-model:value="form.targetPlatform"
            placeholder="例如：番茄小说 / 起点中文网 / 晋江文学城"
          />
          <div class="platform-suggestions">
            <n-tag
              v-for="platform in PLATFORM_SUGGESTIONS"
              :key="platform"
              round
              :bordered="false"
              :type="form.targetPlatform === platform ? 'info' : 'default'"
              class="platform-suggestion"
              @click="form.targetPlatform = platform"
            >
              {{ platform }}
            </n-tag>
          </div>
        </div>
      </n-form-item>

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

        <n-card :bordered="false" class="cover-workbench-card">
          <div class="cover-workbench-head">
            <div>
              <strong>封面提示词工作台</strong>
              <p>先把项目题材、平台和拆书资产翻译成可直接给画图模型或设计师使用的封面提示词。</p>
            </div>
            <n-tag round :bordered="false" type="info">
              {{ referenceTitles.length ? `已接入 ${referenceTitles.length} 个参考资产` : '通用模式' }}
            </n-tag>
          </div>

          <div class="form-grid">
            <n-form-item label="作者署名">
              <n-input v-model:value="workbench.authorName" placeholder="例如：青岚 / 不填则使用“作者名待定”" />
            </n-form-item>
            <n-form-item label="补充画风 / 禁忌元素">
              <n-input
                v-model:value="workbench.extraNotes"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 6 }"
                placeholder="例如：偏电影海报感、避免 Q 版、不要过曝、强调女主神情"
              />
            </n-form-item>
          </div>

          <n-alert type="info" :show-icon="false" class="cover-workbench-alert">
            {{ workbenchReferenceLabel }}
          </n-alert>

          <p class="cover-workbench-note">
            作者署名和画风补充只参与本次提示词生成；点击“保存到知识库”后，会以知识文档的形式沉淀下来。
          </p>

          <div class="cover-workbench-actions">
            <n-button type="primary" round strong @click="generateCoverPrompt">生成提示词</n-button>
            <n-button
              round
              strong
              secondary
              :disabled="!generatedPrompt || isPromptStale"
              @click="saveCoverPrompt"
            >
              保存到知识库
            </n-button>
          </div>

          <div v-if="generatedPrompt" class="cover-workbench-result">
            <div class="cover-workbench-result-head">
              <div>
                <strong>{{ generatedPrompt.title }}</strong>
                <p>{{ generatedPrompt.summary }}</p>
              </div>
              <n-tag
                round
                :bordered="false"
                :type="isPromptStale ? 'warning' : 'success'"
              >
                {{ isPromptStale ? '输入已变化' : '可保存' }}
              </n-tag>
            </div>

            <n-input
              :value="generatedPrompt.prompt"
              type="textarea"
              readonly
              :autosize="{ minRows: 9, maxRows: 18 }"
            />

            <div class="cover-workbench-keywords">
              <span v-for="keyword in generatedPrompt.keywords" :key="keyword">{{ keyword }}</span>
            </div>
          </div>
        </n-card>
      </n-form>
    </div>

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
  width: min(1040px, 92vw);
}

.project-editor-body {
  max-height: min(72vh, 860px);
  overflow-y: auto;
  padding-right: 4px;
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

.platform-editor {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 10px;
}

.platform-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.platform-suggestion {
  cursor: pointer;
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

.cover-workbench-card {
  margin-top: 8px;
  border-radius: 16px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--arc-primary) 5%, white) 0%, var(--arc-bg-surface) 100%);
}

.cover-workbench-head,
.cover-workbench-result-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.cover-workbench-head strong,
.cover-workbench-result-head strong {
  color: var(--arc-text-primary);
  font-size: 16px;
}

.cover-workbench-head p,
.cover-workbench-result-head p,
.cover-workbench-note {
  margin: 6px 0 0;
  color: var(--arc-text-secondary);
  line-height: 1.7;
}

.cover-workbench-alert {
  margin-top: 2px;
  border-radius: 14px;
}

.cover-workbench-note {
  font-size: 13px;
}

.cover-workbench-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 14px;
}

.cover-workbench-result {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 18px;
}

.cover-workbench-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cover-workbench-keywords span {
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
  color: var(--arc-primary);
  padding: 4px 10px;
  font-size: 12px;
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

  .cover-workbench-head,
  .cover-workbench-result-head {
    flex-direction: column;
  }
}
</style>
