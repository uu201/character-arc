<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Copy, Download, History, ImagePlus, Sparkles, Wand2 } from 'lucide-vue-next'
import {
  NAlert,
  NButton,
  NCard,
  NDivider,
  NEmpty,
  NForm,
  NFormItem,
  NImage,
  NInput,
  NSpace,
  NSpin,
  NTag,
  NTooltip,
  useMessage
} from 'naive-ui'
import {
  buildCoverPromptWorkbenchResult,
  type CoverPromptWorkbenchInput,
  type CoverPromptWorkbenchResult
} from '@/features/cover/promptWorkbench'
import { isImageCover } from '@/features/cover/display'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { CoverGenerationHistoryItem, ProjectSummary } from '@/types/app'

const props = defineProps<{
  project: ProjectSummary | null
}>()

const emit = defineEmits<{
  (e: 'update-cover', payload: { projectId: string; cover: string }): void
  (e: 'save-cover-prompt', payload: CoverPromptWorkbenchInput): void
}>()

const appStore = useAppStore()
const message = useMessage()

const workbench = reactive({
  authorName: '',
  extraNotes: ''
})

const generatedPrompt = ref<CoverPromptWorkbenchResult | null>(null)
const generatedPromptFingerprint = ref('')
const isGeneratingImage = ref(false)
const revisedPrompt = ref('')
const previewCoverUrl = ref('')

const resolvedImageConfig = computed(() => ({
  model: appStore.appSettings.imageModel.trim(),
  baseUrl: appStore.appSettings.imageBaseUrl.trim(),
  apiKey: appStore.appSettings.imageApiKey.trim()
}))

const imageConfigReady = computed(() => {
  const config = resolvedImageConfig.value
  return !!(config.model && config.baseUrl && config.apiKey)
})

const imageConfigSummary = computed(() => {
  const config = resolvedImageConfig.value
  if (!config.model || !config.baseUrl || !config.apiKey) {
    return '尚未配置专用图片生成接口，请先到主页设置中填写图片模型、Base URL 和 API Key。'
  }
  return `${config.model} · ${config.baseUrl}`
})

const coverHistory = computed(() => props.project?.coverHistory ?? [])

const isPromptStale = computed(() => {
  const input = createWorkbenchInput()
  if (!input || !generatedPrompt.value) {
    return false
  }
  return buildWorkbenchFingerprint(input) !== generatedPromptFingerprint.value
})

function resetWorkbench(): void {
  workbench.authorName = ''
  workbench.extraNotes = ''
  generatedPrompt.value = null
  generatedPromptFingerprint.value = ''
  revisedPrompt.value = ''
  previewCoverUrl.value = ''
  isGeneratingImage.value = false
}

watch(
  () => props.project?.id,
  () => {
    resetWorkbench()
  },
  { immediate: true }
)

function createWorkbenchInput(): CoverPromptWorkbenchInput | null {
  if (!props.project) {
    return null
  }
  return {
    project: props.project,
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
    referenceTitles: [],
    authorName: input.authorName.trim(),
    extraNotes: input.extraNotes.trim()
  })
}

function buildHistoryItem(input: CoverPromptWorkbenchInput, result: CoverPromptWorkbenchResult, cover: string): CoverGenerationHistoryItem {
  return {
    id: `cover-history-${Date.now()}`,
    createdAt: new Date().toISOString(),
    cover,
    promptTitle: result.title,
    prompt: result.prompt,
    summary: result.summary,
    keywords: result.keywords,
    genre: input.project.genre,
    targetPlatform: input.project.targetPlatform,
    authorName: input.authorName.trim(),
    extraNotes: input.extraNotes.trim()
  }
}

function ensureProjectReady(): CoverPromptWorkbenchInput | null {
  const input = createWorkbenchInput()
  if (!input) {
    return null
  }
  if (!input.project.title.trim()) {
    message.warning('请先在编辑项目信息里填写作品标题，再生成封面。')
    return null
  }
  return input
}

function generateCoverPrompt(): CoverPromptWorkbenchResult | null {
  const input = ensureProjectReady()
  if (!input) {
    return null
  }
  generatedPrompt.value = buildCoverPromptWorkbenchResult(input)
  generatedPromptFingerprint.value = buildWorkbenchFingerprint(input)
  return generatedPrompt.value
}

function saveCoverPrompt(): void {
  const input = createWorkbenchInput()
  if (!input || !generatedPrompt.value) {
    message.warning('请先生成封面提示词，再保存到知识库。')
    return
  }
  if (isPromptStale.value) {
    message.warning('封面提示词依赖的输入已变化，请重新生成后再保存。')
    return
  }
  emit('save-cover-prompt', input)
}

function reuseHistoryItem(item: CoverGenerationHistoryItem): void {
  workbench.authorName = item.authorName
  workbench.extraNotes = item.extraNotes
  generatedPrompt.value = {
    title: item.promptTitle,
    summary: item.summary,
    prompt: item.prompt,
    keywords: item.keywords
  }
  generatedPromptFingerprint.value = JSON.stringify({
    projectTitle: props.project?.title ?? '',
    genre: props.project?.genre ?? '',
    targetPlatform: props.project?.targetPlatform ?? '',
    novelLength: props.project?.novelLength ?? 'long',
    referenceTitles: [],
    authorName: item.authorName.trim(),
    extraNotes: item.extraNotes.trim()
  })
  revisedPrompt.value = ''
  message.success('已复用这条封面历史的提示词与参数。')
}

function applyHistoryCover(item: CoverGenerationHistoryItem): void {
  if (!props.project?.id) {
    return
  }
  previewCoverUrl.value = item.cover
  emit('update-cover', {
    projectId: props.project.id,
    cover: item.cover
  })
  message.success('已将历史封面设为当前封面。')
}

async function copyPrompt(prompt: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(prompt)
    message.success('提示词已复制。')
  } catch {
    message.warning('复制失败，请手动复制。')
  }
}

async function generateCoverImage(): Promise<void> {
  if (!props.project?.id || isGeneratingImage.value) {
    return
  }
  const input = ensureProjectReady()
  if (!input) {
    return
  }
  const promptResult = (!generatedPrompt.value || isPromptStale.value)
    ? generateCoverPrompt()
    : generatedPrompt.value
  if (!promptResult) {
    return
  }

  isGeneratingImage.value = true
  try {
    const result = await window.characterArc.generateImage({
      settings: toIpcPayload({ ...appStore.appSettings }),
      prompt: promptResult.prompt
    })
    if (!result.success || !result.result?.dataUrl) {
      throw new Error(result.error ?? '图片生成失败')
    }

    revisedPrompt.value = result.result.revisedPrompt?.trim() || ''
    previewCoverUrl.value = result.result.dataUrl
    emit('update-cover', {
      projectId: props.project.id,
      cover: result.result.dataUrl
    })

    appStore.updateProject(props.project.id, {
      coverHistory: [
        buildHistoryItem(input, promptResult, result.result.dataUrl),
        ...coverHistory.value
      ].slice(0, 24)
    })
    message.success('AI 封面已生成。')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '图片生成失败')
  } finally {
    isGeneratingImage.value = false
  }
}

async function saveCoverToLocal(dataUrl?: string): Promise<void> {
  const coverData = dataUrl || previewCoverUrl.value
  if (!coverData) {
    message.warning('当前没有可保存的封面图片。')
    return
  }
  try {
    const projectTitle = props.project?.title?.trim() || 'cover'
    const result = await window.characterArc.saveCoverImage({
      dataUrl: coverData,
      defaultFileName: `${projectTitle}-封面-${Date.now()}.png`
    })
    if (result.canceled) {
      return
    }
    if (!result.success) {
      throw new Error(result.error ?? '保存失败')
    }
    message.success(`封面已保存到：${result.filePath}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '封面保存失败')
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch {
    return ''
  }
}
</script>

<template>
  <div class="cover-workbench-panel">
    <!-- 顶部标题 -->
    <div class="workbench-header">
      <div class="header-text">
        <span class="cover-kicker">Image Studio · story-cover skill</span>
        <h2>封面生图工作台</h2>
        <p>基于 story-cover skill 自动分析题材与平台风格，生成专业级网文封面提示词并调用生图模型一键出图。</p>
      </div>
    </div>

    <!-- 三栏主体 -->
    <div class="workbench-body">
      <!-- 左栏：输入区 -->
      <n-card class="panel-card" :bordered="true" size="small">
        <template #header>
          <div class="card-title">
            <span class="cover-kicker">Inputs</span>
            <strong>输入与操作</strong>
          </div>
        </template>

        <n-form label-placement="top" :show-feedback="false">
          <n-form-item label="作者署名">
            <n-input
              v-model:value="workbench.authorName"
              placeholder="例如：青岚 / 不填则使用「作者名待定」"
            />
          </n-form-item>
          <n-form-item label="补充画风 / 禁忌元素" style="margin-top: 12px">
            <n-input
              v-model:value="workbench.extraNotes"
              type="textarea"
              :autosize="{ minRows: 6, maxRows: 10 }"
              placeholder="例如：偏电影海报感、避免 Q 版、不要过曝、强调主角神情"
            />
          </n-form-item>
        </n-form>

        <n-divider style="margin: 16px 0 12px" />

        <n-space vertical :size="10">
          <n-button type="primary" block strong @click="generateCoverPrompt">
            <template #icon><Wand2 :size="15" /></template>
            生成提示词
          </n-button>
          <n-button
            block
            strong
            secondary
            :disabled="!generatedPrompt || isPromptStale"
            @click="saveCoverPrompt"
          >
            保存到知识库
          </n-button>
        </n-space>

        <n-divider style="margin: 16px 0 12px" />

        <div class="config-section">
          <span class="cover-kicker">Config</span>
          <strong class="config-title">图片接口状态</strong>
          <n-alert
            :type="imageConfigReady ? 'success' : 'warning'"
            :show-icon="true"
            style="margin-top: 8px"
          >
            {{ imageConfigSummary }}
          </n-alert>
          <n-alert
            v-if="revisedPrompt"
            type="info"
            :show-icon="true"
            style="margin-top: 8px"
          >
            模型重写提示词：{{ revisedPrompt }}
          </n-alert>
        </div>
      </n-card>

      <!-- 中栏：封面预览区 -->
      <n-card class="panel-card preview-card" :bordered="true" size="small">
        <template #header>
          <div class="card-title">
            <span class="cover-kicker">Preview</span>
            <strong>封面预览</strong>
          </div>
        </template>

        <div class="preview-area">
          <n-spin :show="isGeneratingImage" description="AI 正在生成封面...">
            <div class="cover-frame">
              <n-image
                v-if="previewCoverUrl"
                :src="previewCoverUrl"
                :previewed-img-props="{ style: { maxHeight: '90vh' } }"
                object-fit="cover"
                width="100%"
                style="border-radius: 12px; aspect-ratio: 2 / 3; display: block"
              />
              <n-empty
                v-else
                description="暂无封面"
                style="padding: 80px 0"
              >
                <template #icon>
                  <ImagePlus :size="48" :stroke-width="1" style="color: var(--arc-text-hint)" />
                </template>
                <template #extra>
                  <span style="color: var(--arc-text-secondary); font-size: 13px">
                    点击下方按钮生成 AI 封面
                  </span>
                </template>
              </n-empty>
            </div>
          </n-spin>
        </div>

        <n-divider style="margin: 14px 0 10px" />

        <n-space vertical :size="8">
          <n-button
            type="primary"
            block
            strong
            :loading="isGeneratingImage"
            :disabled="isGeneratingImage || !imageConfigReady"
            @click="generateCoverImage"
          >
            <template #icon><Sparkles :size="15" /></template>
            {{ isGeneratingImage ? 'AI 生成中...' : 'AI 生成封面' }}
          </n-button>
          <n-tooltip trigger="hover" :disabled="!!previewCoverUrl">
            <template #trigger>
              <n-button
                block
                strong
                secondary
                :disabled="!previewCoverUrl"
                @click="saveCoverToLocal()"
              >
                <template #icon><Download :size="15" /></template>
                保存到本地
              </n-button>
            </template>
            当前没有可保存的封面图片
          </n-tooltip>
        </n-space>
      </n-card>

      <!-- 右栏：提示词预览区 -->
      <n-card class="panel-card" :bordered="true" size="small">
        <template #header>
          <div class="card-title-row">
            <div class="card-title">
              <span class="cover-kicker">Output</span>
              <strong>{{ generatedPrompt?.title || '提示词预览区' }}</strong>
            </div>
            <n-tag
              v-if="generatedPrompt"
              size="small"
              round
              :bordered="false"
              :type="isPromptStale ? 'warning' : 'success'"
            >
              {{ isPromptStale ? '输入已变化' : '可直接生成' }}
            </n-tag>
          </div>
        </template>

        <template v-if="generatedPrompt">
          <p class="prompt-summary">{{ generatedPrompt.summary }}</p>

          <n-input
            :value="generatedPrompt.prompt"
            type="textarea"
            readonly
            :autosize="{ minRows: 14, maxRows: 22 }"
            style="margin-top: 8px"
          />

          <n-space :size="6" style="margin-top: 12px" wrap>
            <n-tag
              v-for="keyword in generatedPrompt.keywords"
              :key="keyword"
              size="small"
              round
              :bordered="false"
              type="primary"
            >
              {{ keyword }}
            </n-tag>
          </n-space>

          <n-divider style="margin: 14px 0 10px" />

          <n-button block secondary @click="copyPrompt(generatedPrompt!.prompt)">
            <template #icon><Copy :size="14" /></template>
            复制提示词
          </n-button>
        </template>

        <n-empty
          v-else
          description="先生成一版封面提示词"
          style="padding: 60px 0"
        >
          <template #icon>
            <Sparkles :size="40" :stroke-width="1" style="color: var(--arc-text-hint)" />
          </template>
          <template #extra>
            <span style="color: var(--arc-text-secondary); font-size: 13px">
              建议先补充画风方向，再点击左侧的「生成提示词」
            </span>
          </template>
        </n-empty>
      </n-card>
    </div>

    <!-- 历史记录区域 -->
    <n-card class="history-section" :bordered="true" size="small">
      <template #header>
        <div class="card-title-row">
          <div class="card-title">
            <span class="cover-kicker">History</span>
            <strong>历史生成记录</strong>
          </div>
          <n-tag size="small" round :bordered="false">
            {{ coverHistory.length }} 条
          </n-tag>
        </div>
      </template>

      <div v-if="coverHistory.length" class="history-masonry">
        <n-card
          v-for="item in coverHistory"
          :key="item.id"
          class="history-item-card"
          :bordered="true"
          size="small"
          hoverable
        >
          <div
            class="history-cover-img"
            @click="applyHistoryCover(item)"
          >
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-image
                  v-if="isImageCover(item.cover)"
                  :src="item.cover"
                  :previewed-img-props="{ style: { maxHeight: '90vh' } }"
                  object-fit="cover"
                  width="100%"
                  :preview-disabled="true"
                  style="border-radius: 10px; aspect-ratio: 2 / 3; display: block; cursor: pointer"
                />
              </template>
              点击设为当前封面
            </n-tooltip>
          </div>

          <div class="history-info">
            <strong>{{ item.promptTitle }}</strong>
            <p>{{ item.summary }}</p>
          </div>

          <n-space :size="6" wrap>
            <n-tag size="tiny" round :bordered="false">{{ item.genre || '封面' }}</n-tag>
            <n-tag size="tiny" round :bordered="false">{{ item.authorName || '未署名' }}</n-tag>
            <n-tag v-if="item.createdAt" size="tiny" round :bordered="false" type="default">
              {{ formatDate(item.createdAt) }}
            </n-tag>
          </n-space>

          <n-space :size="4" wrap style="margin-top: 6px">
            <n-tag
              v-for="keyword in item.keywords.slice(0, 4)"
              :key="keyword"
              size="tiny"
              round
              :bordered="false"
              type="primary"
            >
              {{ keyword }}
            </n-tag>
          </n-space>

          <n-space :size="8" style="margin-top: 10px">
            <n-button size="tiny" secondary @click="copyPrompt(item.prompt)">
              <template #icon><Copy :size="12" /></template>
              复制
            </n-button>
            <n-button size="tiny" secondary @click="reuseHistoryItem(item)">
              <template #icon><History :size="12" /></template>
              复用
            </n-button>
            <n-button
              v-if="isImageCover(item.cover)"
              size="tiny"
              secondary
              @click="saveCoverToLocal(item.cover)"
            >
              <template #icon><Download :size="12" /></template>
              保存
            </n-button>
          </n-space>
        </n-card>
      </div>

      <n-empty
        v-else
        description="还没有历史记录"
        style="padding: 40px 0"
      >
        <template #icon>
          <History :size="40" :stroke-width="1" style="color: var(--arc-text-hint)" />
        </template>
        <template #extra>
          <span style="color: var(--arc-text-secondary); font-size: 13px">
            第一次 AI 生成封面后，这里会自动保留历史结果
          </span>
        </template>
      </n-empty>
    </n-card>
  </div>
</template>

<style scoped>
.cover-workbench-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  min-width: 0;
}

/* ── 顶部标题 ── */
.workbench-header {
  padding: 4px 0;
}

.header-text h2 {
  margin: 6px 0 0;
  color: var(--arc-text-primary);
  font-size: 24px;
  font-weight: 760;
  letter-spacing: -0.03em;
}

.header-text p {
  margin: 8px 0 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.cover-kicker {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* ── 三栏主体 ── */
.workbench-body {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(260px, 0.9fr) minmax(280px, 1.1fr);
  gap: 16px;
  align-items: start;
}

.panel-card {
  border-radius: 16px;
}

.panel-card :deep(.n-card-header) {
  padding: 16px 18px 10px;
}

.panel-card :deep(.n-card__content) {
  padding: 10px 18px 18px;
}

.card-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-title strong {
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 720;
}

.card-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

/* ── 封面预览区 ── */
.preview-card {
  position: sticky;
  top: 0;
}

.preview-area {
  border-radius: 12px;
  background: color-mix(in srgb, var(--arc-bg-weak) 60%, var(--arc-bg-surface));
  overflow: hidden;
}

.cover-frame {
  min-height: 200px;
}

/* ── 配置区 ── */
.config-section {
  display: flex;
  flex-direction: column;
}

.config-title {
  display: block;
  margin-top: 4px;
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 680;
}

/* ── 提示词摘要 ── */
.prompt-summary {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

/* ── 历史记录 ── */
.history-section {
  border-radius: 16px;
}

.history-section :deep(.n-card-header) {
  padding: 16px 18px 10px;
}

.history-section :deep(.n-card__content) {
  padding: 10px 18px 18px;
}

.history-masonry {
  column-count: 3;
  column-gap: 14px;
}

.history-item-card {
  display: inline-flex;
  width: 100%;
  flex-direction: column;
  break-inside: avoid;
  margin-bottom: 14px;
  border-radius: 14px;
}

.history-item-card :deep(.n-card__content) {
  padding: 12px 14px 14px;
}

.history-cover-img {
  margin-bottom: 8px;
}

.history-info {
  margin-bottom: 8px;
}

.history-info strong {
  display: block;
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 680;
  line-height: 1.4;
}

.history-info p {
  margin: 4px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── 响应式 ── */
@media (max-width: 1100px) {
  .workbench-body {
    grid-template-columns: 1fr 1fr;
  }

  .workbench-body > .panel-card:last-child {
    grid-column: 1 / -1;
  }

  .history-masonry {
    column-count: 2;
  }
}

@media (max-width: 720px) {
  .workbench-body {
    grid-template-columns: 1fr;
  }

  .history-masonry {
    column-count: 1;
  }

  .panel-card,
  .history-section {
    border-radius: 12px;
  }

  .preview-card {
    position: static;
  }
}
</style>
