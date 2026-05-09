<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
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
  NSelect,
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
import { PROJECT_GENRE_OPTIONS } from '@/features/wizard/projectGenres'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { CoverWorkbenchHistoryItem } from '@/types/app'

const appStore = useAppStore()
const message = useMessage()

const PLATFORM_SUGGESTIONS = ['番茄小说', '起点中文网', '晋江文学城', '知乎盐言', '七猫小说', '刺猬猫']
const genreSelectOptions = PROJECT_GENRE_OPTIONS
  .filter((o) => !o.isCustom)
  .map((o) => ({ label: o.label, value: o.label }))

const workbench = reactive({
  bookTitle: '',
  genre: '',
  targetPlatform: '',
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

const isPromptStale = computed(() => {
  const input = createWorkbenchInput()
  if (!input || !generatedPrompt.value) {
    return false
  }
  return buildWorkbenchFingerprint(input) !== generatedPromptFingerprint.value
})

function createWorkbenchInput(): CoverPromptWorkbenchInput | null {
  return {
    project: {
      id: '',
      title: workbench.bookTitle.trim(),
      genre: workbench.genre.trim(),
      targetPlatform: workbench.targetPlatform.trim(),
      novelLength: 'long',
      wordCount: '',
      lastEdited: '',
      cover: '',
      writingStylePresetId: '',
      writingStylePrompt: '',
      chapterAssistantTemplates: [],
      novelWorkflowStages: [],
      projectSkills: [],
      referenceWorks: [],
      selectedReferenceWorkIds: [],
      coverHistory: []
    },
    authorName: workbench.authorName,
    extraNotes: workbench.extraNotes
  }
}

function buildWorkbenchFingerprint(input: CoverPromptWorkbenchInput): string {
  return JSON.stringify({
    projectTitle: input.project.title,
    genre: input.project.genre,
    targetPlatform: input.project.targetPlatform,
    authorName: input.authorName.trim(),
    extraNotes: input.extraNotes.trim()
  })
}

function buildCoverWorkbenchHistoryItem(result: CoverPromptWorkbenchResult, cover: string): CoverWorkbenchHistoryItem {
  return {
    id: `cover-${Date.now()}`,
    createdAt: new Date().toISOString(),
    cover,
    promptTitle: result.title,
    prompt: result.prompt,
    summary: result.summary,
    keywords: result.keywords,
    genre: workbench.genre.trim(),
    targetPlatform: workbench.targetPlatform.trim(),
    authorName: workbench.authorName.trim(),
    extraNotes: workbench.extraNotes.trim()
  }
}

function ensureInputsReady(): CoverPromptWorkbenchInput | null {
  const input = createWorkbenchInput()
  if (!input) {
    return null
  }
  if (!input.project.title.trim()) {
    message.warning('请先填写书名，再生成封面。')
    return null
  }
  if (!input.project.genre.trim()) {
    message.warning('请先选择或填写题材，再生成封面。')
    return null
  }
  if (!input.project.targetPlatform.trim()) {
    message.warning('请先选择目标平台，再生成封面。')
    return null
  }
  return input
}

function generateCoverPrompt(): CoverPromptWorkbenchResult | null {
  const input = ensureInputsReady()
  if (!input) {
    return null
  }
  generatedPrompt.value = buildCoverPromptWorkbenchResult(input)
  generatedPromptFingerprint.value = buildWorkbenchFingerprint(input)
  return generatedPrompt.value
}

function reuseHistoryItem(item: CoverWorkbenchHistoryItem): void {
  workbench.bookTitle = item.promptTitle.replace(/｜封面提示词$/, '')
  workbench.genre = item.genre
  workbench.targetPlatform = item.targetPlatform
  workbench.authorName = item.authorName
  workbench.extraNotes = item.extraNotes
  generatedPrompt.value = {
    title: item.promptTitle,
    summary: item.summary,
    prompt: item.prompt,
    keywords: item.keywords
  }
  generatedPromptFingerprint.value = buildWorkbenchFingerprint(createWorkbenchInput()!)
  revisedPrompt.value = ''
  message.success('已复用这条历史记录的参数。')
}

function useHistoryCover(item: CoverWorkbenchHistoryItem): void {
  previewCoverUrl.value = item.cover
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
  if (isGeneratingImage.value) {
    return
  }
  const input = ensureInputsReady()
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

    appStore.updateCoverWorkbenchHistory([
      buildCoverWorkbenchHistoryItem(promptResult, result.result.dataUrl),
      ...appStore.coverWorkbenchHistory
    ].slice(0, 24))

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
    const title = workbench.bookTitle.trim() || 'cover'
    const result = await window.characterArc.saveCoverImage({
      dataUrl: coverData,
      defaultFileName: `${title}-封面-${Date.now()}.png`
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
          <n-form-item label="书名" required>
            <n-input
              v-model:value="workbench.bookTitle"
              placeholder="作品标题，将直接渲染在封面上"
            />
          </n-form-item>
          <n-form-item label="题材" required style="margin-top: 12px">
            <n-select
              v-model:value="workbench.genre"
              :options="genreSelectOptions"
              filterable
              tag
              placeholder="选择或输入题材"
            />
          </n-form-item>
          <n-form-item label="目标平台" required style="margin-top: 12px">
            <n-input
              v-model:value="workbench.targetPlatform"
              placeholder="例如：番茄小说 / 起点中文网"
            />
          </n-form-item>
          <n-space :size="6" style="margin-top: 6px" wrap>
            <n-tag
              v-for="platform in PLATFORM_SUGGESTIONS"
              :key="platform"
              size="small"
              round
              :bordered="false"
              :type="workbench.targetPlatform === platform ? 'info' : 'default'"
              style="cursor: pointer"
              @click="workbench.targetPlatform = platform"
            >
              {{ platform }}
            </n-tag>
          </n-space>
          <n-form-item label="作者署名" style="margin-top: 12px">
            <n-input
              v-model:value="workbench.authorName"
              placeholder="不填则使用「作者名待定」"
            />
          </n-form-item>
          <n-form-item label="补充画风 / 禁忌元素" style="margin-top: 12px">
            <n-input
              v-model:value="workbench.extraNotes"
              type="textarea"
              :autosize="{ minRows: 4, maxRows: 8 }"
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
          <n-tooltip trigger="hover" :disabled="!!generatedPrompt && !isPromptStale">
            <template #trigger>
              <n-button
                type="primary"
                block
                strong
                :loading="isGeneratingImage"
                :disabled="isGeneratingImage || !imageConfigReady || !generatedPrompt || isPromptStale"
                @click="generateCoverImage"
              >
                <template #icon><Sparkles :size="15" /></template>
                {{ isGeneratingImage ? 'AI 生成中...' : 'AI 生成封面' }}
              </n-button>
            </template>
            {{ !generatedPrompt ? '请先在左侧生成提示词' : '输入已变化，请重新生成提示词' }}
          </n-tooltip>
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
              填写书名、题材和平台后点击「生成提示词」
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
            <strong>本次生成记录</strong>
          </div>
          <n-tag size="small" round :bordered="false">
            {{ appStore.coverWorkbenchHistory.length }} 条
          </n-tag>
        </div>
      </template>

      <div v-if="appStore.coverWorkbenchHistory.length" class="history-list">
        <n-card
          v-for="item in appStore.coverWorkbenchHistory"
          :key="item.id"
          class="history-row-card"
          :bordered="true"
          size="small"
          hoverable
        >
          <div class="history-row">
            <div class="history-thumb" @click="useHistoryCover(item)">
              <n-image
                v-if="isImageCover(item.cover)"
                :src="item.cover"
                :previewed-img-props="{ style: { maxHeight: '90vh' } }"
                object-fit="cover"
                width="100%"
                :preview-disabled="true"
                style="border-radius: 8px; aspect-ratio: 2 / 3; display: block; cursor: pointer"
              />
            </div>

            <div class="history-body">
              <div class="history-body-head">
                <strong>{{ item.promptTitle }}</strong>
                <span class="history-time">{{ formatDate(item.createdAt) }}</span>
              </div>
              <p class="history-summary">{{ item.summary }}</p>
              <n-space :size="6" wrap style="margin-top: 6px">
                <n-tag size="tiny" round :bordered="false">{{ item.genre || '封面' }}</n-tag>
                <n-tag size="tiny" round :bordered="false">{{ item.targetPlatform || '通用' }}</n-tag>
                <n-tag size="tiny" round :bordered="false">{{ item.authorName || '未署名' }}</n-tag>
              </n-space>
            </div>

            <div class="history-actions">
              <n-tooltip trigger="hover">
                <template #trigger>
                  <n-button size="small" secondary circle @click="copyPrompt(item.prompt)">
                    <template #icon><Copy :size="14" /></template>
                  </n-button>
                </template>
                复制提示词
              </n-tooltip>
              <n-tooltip trigger="hover">
                <template #trigger>
                  <n-button size="small" secondary circle @click="reuseHistoryItem(item)">
                    <template #icon><History :size="14" /></template>
                  </n-button>
                </template>
                复用参数
              </n-tooltip>
              <n-tooltip v-if="isImageCover(item.cover)" trigger="hover">
                <template #trigger>
                  <n-button size="small" secondary circle @click="saveCoverToLocal(item.cover)">
                    <template #icon><Download :size="14" /></template>
                  </n-button>
                </template>
                保存到本地
              </n-tooltip>
            </div>
          </div>
        </n-card>
      </div>

      <n-empty
        v-else
        description="还没有生成记录"
        style="padding: 40px 0"
      >
        <template #icon>
          <History :size="40" :stroke-width="1" style="color: var(--arc-text-hint)" />
        </template>
        <template #extra>
          <span style="color: var(--arc-text-secondary); font-size: 13px">
            生成封面后会在这里保留本次会话的历史记录
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

.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-row-card {
  border-radius: 12px;
}

.history-row-card :deep(.n-card__content) {
  padding: 12px 14px;
}

.history-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.history-thumb {
  flex-shrink: 0;
  width: 72px;
}

.history-body {
  flex: 1;
  min-width: 0;
}

.history-body-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.history-body-head strong {
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 680;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-time {
  flex-shrink: 0;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.history-summary {
  margin: 4px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.history-actions {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
}

/* ── 响应式 ── */
@media (max-width: 1100px) {
  .workbench-body {
    grid-template-columns: 1fr 1fr;
  }

  .workbench-body > .panel-card:last-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .workbench-body {
    grid-template-columns: 1fr;
  }

  .panel-card,
  .history-section {
    border-radius: 12px;
  }

  .preview-card {
    position: static;
  }

  .history-row {
    flex-wrap: wrap;
  }

  .history-thumb {
    width: 56px;
  }

  .history-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
