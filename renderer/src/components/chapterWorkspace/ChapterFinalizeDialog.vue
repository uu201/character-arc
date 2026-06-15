<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NModal, NTag, useMessage } from 'naive-ui'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { ChapterDraft } from '@/types/app'

type FinalizationPreview = {
  chapterSummary: string
  stateDelta: {
    characters_updated?: unknown[]
    relationships_delta?: unknown[]
    foreshadowing_delta?: {
      planted?: unknown[]
      advanced?: unknown[]
      resolved?: unknown[]
    }
    timeline?: {
      events?: string[]
      world_state_changes?: string[]
    }
  } | null
  nextChapterBridge: string
  warnings: string[]
}

const props = defineProps<{
  show: boolean
  chapter: ChapterDraft | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  applied: []
}>()

const TASK_KEY = 'chapter-finalize'

const appStore = useAppStore()
const message = useMessage()
const preview = ref<FinalizationPreview | null>(null)
const errorText = ref('')
const showGuidance = ref(false)
const guidance = ref('')
const isApplying = ref(false)

const isGenerating = computed(() => appStore.isAiTaskRunning(TASK_KEY))

const stateCounts = computed(() => {
  const state = preview.value?.stateDelta
  return {
    characters: state?.characters_updated?.length ?? 0,
    relationships: state?.relationships_delta?.length ?? 0,
    planted: state?.foreshadowing_delta?.planted?.length ?? 0,
    advanced: state?.foreshadowing_delta?.advanced?.length ?? 0,
    resolved: state?.foreshadowing_delta?.resolved?.length ?? 0,
    events: state?.timeline?.events?.length ?? 0
  }
})

function close(): void {
  if (isGenerating.value || isApplying.value) return
  emit('update:show', false)
}

function normalizePreview(value: unknown): FinalizationPreview | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  return {
    chapterSummary: String(raw.chapterSummary ?? '').trim(),
    stateDelta: (raw.stateDelta && typeof raw.stateDelta === 'object') ? raw.stateDelta as FinalizationPreview['stateDelta'] : null,
    nextChapterBridge: String(raw.nextChapterBridge ?? '').trim(),
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map((item) => String(item).trim()).filter(Boolean) : []
  }
}

function nearbyChapters(): Array<{ title: string; summary: string }> {
  const chapter = props.chapter
  if (!chapter) return []
  const index = appStore.chapters.findIndex((item) => item.id === chapter.id)
  if (index < 0) return []
  return appStore.chapters
    .slice(Math.max(0, index - 2), Math.min(appStore.chapters.length, index + 3))
    .filter((item) => item.id !== chapter.id)
    .map((item) => ({ title: item.title, summary: item.summary }))
}

async function generatePreview(extraGuidance = ''): Promise<void> {
  const chapter = props.chapter
  const project = appStore.currentProject
  if (!chapter || !project) return

  const plainContent = getPlainTextFromEditorContent(chapter.content ?? '').trim()
  if (!plainContent) {
    errorText.value = '当前章节没有正文，无法生成归档预览。'
    return
  }

  errorText.value = ''
  try {
    const storyStateResponse = await window.characterArc.readStoryState(project.id)
    const result = await appStore.runTrackedAiTask(
      {
        key: TASK_KEY,
        kind: 'chapter-summary',
        label: 'AI 生成归档预览',
        description: `为《${chapter.title}》生成确认归档预览`,
        panel: 'chapters',
        timeoutMs: 180_000
      },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'chapter-finalize',
          settings: appStore.appSettings,
          context: {
            projectId: project.id,
            projectTitle: project.title,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            chapterSummary: chapter.summary,
            chapterIndex: appStore.chapters.findIndex((item) => item.id === chapter.id) + 1,
            chapterContent: plainContent,
            nearbyChapters: nearbyChapters(),
            storyState: storyStateResponse.success ? storyStateResponse.result : null,
            userGuidance: extraGuidance,
            previousPreview: preview.value
          }
        }))
    )

    if (!result.success) {
      errorText.value = result.error ?? '归档预览生成失败。'
      return
    }

    const normalized = normalizePreview(result.result)
    if (!normalized) {
      errorText.value = 'AI 未返回有效的归档预览。'
      return
    }
    preview.value = normalized
    showGuidance.value = false
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '归档预览生成失败。'
  }
}

async function regenerate(): Promise<void> {
  await generatePreview(guidance.value.trim())
}

async function applyPreview(): Promise<void> {
  const chapter = props.chapter
  const project = appStore.currentProject
  if (!chapter || !project || !preview.value) return

  isApplying.value = true
  try {
    const result = await window.characterArc.applyChapterFinalization(toIpcPayload({
      projectId: project.id,
      chapterId: chapter.id,
      chapterIndex: appStore.chapters.findIndex((item) => item.id === chapter.id) + 1,
      preview: preview.value
    }))
    if (!result.success) {
      message.error(result.error ?? '章节归档失败')
      return
    }
    if (!result.result) {
      message.error('章节归档失败')
      return
    }

    appStore.applyChapterFinalizationResult(result.result)
    message.success('章节已确认归档')
    emit('applied')
    emit('update:show', false)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '章节归档失败')
  } finally {
    isApplying.value = false
  }
}

watch(
  () => props.show,
  (visible) => {
    if (!visible) return
    preview.value = null
    errorText.value = ''
    guidance.value = ''
    showGuidance.value = false
    void generatePreview()
  }
)
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="确认归档"
    :style="{ width: 'min(760px, 94vw)' }"
    :bordered="false"
    :mask-closable="false"
    :closable="!isGenerating && !isApplying"
    @update:show="(v) => !v && close()"
  >
    <div class="finalize-dialog">
      <div class="heading">
        <div>
          <span class="eyebrow">AI 归档预览</span>
          <h3>{{ chapter?.title || '未命名章节' }}</h3>
        </div>
        <n-tag size="small" :type="preview ? 'success' : isGenerating ? 'info' : 'default'" round>
          {{ preview ? '已生成预览' : isGenerating ? '生成中' : '等待生成' }}
        </n-tag>
      </div>

      <n-alert v-if="errorText" type="error" :show-icon="false">
        {{ errorText }}
      </n-alert>

      <div v-if="isGenerating && !preview" class="loading-panel">
        正在分析章节正文、项目上下文和故事状态...
      </div>

      <template v-if="preview">
        <section class="section">
          <div class="section-title">本章摘要</div>
          <p>{{ preview.chapterSummary || '本次预览没有建议更新摘要。' }}</p>
        </section>

        <section class="section">
          <div class="section-title">故事状态更新</div>
          <div class="state-grid">
            <div><strong>{{ stateCounts.characters }}</strong><span>人物</span></div>
            <div><strong>{{ stateCounts.relationships }}</strong><span>关系</span></div>
            <div><strong>{{ stateCounts.planted + stateCounts.advanced + stateCounts.resolved }}</strong><span>伏笔</span></div>
            <div><strong>{{ stateCounts.events }}</strong><span>时间线</span></div>
          </div>
          <pre>{{ JSON.stringify(preview.stateDelta ?? {}, null, 2) }}</pre>
        </section>

        <section class="section">
          <div class="section-title">下一章承接</div>
          <p>{{ preview.nextChapterBridge || '本次预览没有生成下一章承接。' }}</p>
        </section>

        <n-alert v-if="preview.warnings.length" type="warning" :show-icon="false">
          <ul class="warnings">
            <li v-for="item in preview.warnings" :key="item">{{ item }}</li>
          </ul>
        </n-alert>
      </template>

      <div v-if="showGuidance" class="guidance">
        <n-input
          v-model:value="guidance"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 5 }"
          placeholder="调整意见，可留空。留空时也会直接重新生成一版预览。"
        />
        <div class="guidance-actions">
          <n-button size="small" @click="showGuidance = false">收起</n-button>
          <n-button size="small" type="primary" :loading="isGenerating" @click="regenerate">
            重新生成预览
          </n-button>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="actions">
        <n-button :disabled="isGenerating || isApplying" @click="close">取消</n-button>
        <n-button :disabled="isApplying" :loading="isGenerating" @click="showGuidance = true">
          给出意见重新生成
        </n-button>
        <n-button
          type="primary"
          :disabled="!preview || isGenerating"
          :loading="isApplying"
          @click="applyPreview"
        >
          确认归档
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.finalize-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.eyebrow {
  font-size: 11px;
  color: var(--arc-text-hint);
}

h3 {
  margin: 2px 0 0;
  font-size: 17px;
  color: var(--arc-text-primary);
}

.loading-panel,
.section {
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-surface);
  padding: 12px 14px;
}

.loading-panel {
  color: var(--arc-text-secondary);
  font-size: 13px;
}

.section-title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--arc-text-secondary);
}

.section p {
  margin: 0;
  color: var(--arc-text-primary);
  line-height: 1.7;
  user-select: text;
}

.state-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.state-grid div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-radius: var(--arc-radius-sm);
  background: var(--arc-bg-weak);
}

.state-grid strong {
  color: var(--arc-primary);
  font-size: 18px;
}

.state-grid span {
  font-size: 11px;
  color: var(--arc-text-hint);
}

pre {
  max-height: 220px;
  overflow: auto;
  margin: 0;
  padding: 10px;
  border-radius: var(--arc-radius-sm);
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.warnings {
  margin: 0;
  padding-left: 18px;
}

.guidance {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.guidance-actions,
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
