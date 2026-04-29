<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowDownToLine, Bot, ChevronDown, RotateCcw, SendHorizonal, Square } from 'lucide-vue-next'
import { useMessage } from 'naive-ui'
import { buildChapterAssistantContext } from '@/features/ai/chapterAssistantContext'
import {
  chapterAssistantLengthOptions,
  chapterAssistantModeOptions,
  chapterAssistantQuickActions,
  type ChapterAssistantQuickAction
} from '@/features/ai/chapterAssistantOptions'
import { getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { useAppStore } from '@/stores/app'
import { isAssistantWindow } from '@/utils/windowKind'
import type { ChapterInsertionMode } from '@/types/app'

const appStore = useAppStore()
const message = useMessage()
const draft = ref('')
const isResponding = ref(false)
const isStopping = ref(false)
const activeStreamId = ref<string | null>(null)
const streamingReply = ref('')
const messagesViewport = ref<HTMLElement | null>(null)
const responseMode = ref<'freeform' | 'polish' | 'continue' | 'suggest' | 'reference'>('freeform')
const responseLength = ref<'short' | 'medium' | 'long'>('medium')
const isToolboxCollapsed = ref(isAssistantWindow)
let removeAiStreamListener: (() => void) | null = null

function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const currentProject = computed(() => appStore.currentProject)
const writingStyle = computed(() => buildProjectWritingStyleContext(currentProject.value))
const currentChapter = computed(() => appStore.selectedChapter)
const selectedExcerpt = computed(() =>
  appStore.currentChapterSelection?.chapterId === currentChapter.value?.id
    ? appStore.currentChapterSelection.text
    : ''
)
const relatedChapters = computed(() => {
  const chapter = currentChapter.value
  if (!chapter) {
    return []
  }

  const chaptersInVolume = appStore.chapters.filter((item) => item.volumeId === chapter.volumeId)
  const currentIndex = chaptersInVolume.findIndex((item) => item.id === chapter.id)
  if (currentIndex === -1) {
    return []
  }

  return [chaptersInVolume[currentIndex - 1], chaptersInVolume[currentIndex + 1]]
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      title: item.title,
      summary: item.summary,
      preview: getChapterPreviewText(item.content, '该章节暂无正文')
    }))
})
const recentAssistantMessages = computed(() =>
  appStore.messages
    .slice(-4)
    .map((item) => ({
      role: item.role,
      content: item.content
    }))
)
const lastUserPrompt = computed(() => {
  const lastUserMessage = [...appStore.messages].reverse().find((item) => item.role === 'user')
  if (!lastUserMessage) {
    return null
  }

  const quickActionMatch = lastUserMessage.content.match(/^【([^】]+)】([\s\S]*)$/)
  if (!quickActionMatch) {
    return {
      prompt: lastUserMessage.content,
      quickAction: undefined
    }
  }

  return {
    quickAction: quickActionMatch[1]?.trim() || undefined,
    prompt: quickActionMatch[2]?.trim() || lastUserMessage.content
  }
})
const activeModeLabel = computed(
  () => chapterAssistantModeOptions.find((option) => option.value === responseMode.value)?.label ?? '自由提问'
)
const activeLengthLabel = computed(
  () => chapterAssistantLengthOptions.find((option) => option.value === responseLength.value)?.label ?? '适中'
)
const toolboxSummary = computed(() => {
  const summary = [`模式 ${activeModeLabel.value}`, `长度 ${activeLengthLabel.value}`]
  if (selectedExcerpt.value) {
    summary.push('含选中文本')
  }
  return summary.join(' · ')
})

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (messagesViewport.value) {
    messagesViewport.value.scrollTop = messagesViewport.value.scrollHeight
  }
}

function resetStreamingState(): void {
  activeStreamId.value = null
  streamingReply.value = ''
  isResponding.value = false
  isStopping.value = false
}

async function sendPrompt(promptText?: string, quickAction?: string): Promise<void> {
  const content = (promptText ?? draft.value).trim()
  if (!content || isResponding.value) {
    return
  }

  const userMessage = quickAction ? `【${quickAction}】${content}` : content
  appStore.pushUserMessage(userMessage)
  draft.value = ''
  isResponding.value = true
  isStopping.value = false
  streamingReply.value = ''
  await scrollToBottom()

  try {
    const result = await window.characterArc.startAiStream(toIpcPayload({
      task: 'chapter-assistant',
      settings: appStore.appSettings,
      context: buildChapterAssistantContext({
        project: currentProject.value,
        chapter: currentChapter.value,
        chapterVolume: appStore.selectedChapterVolume,
        relatedChapters: relatedChapters.value,
        recentMessages: recentAssistantMessages.value,
        worldviewEntries: appStore.worldviewEntries,
        characters: appStore.characters,
        inspirationEntries: appStore.inspirationEntries,
        outlineItems: appStore.outlineItems,
        selectedText: selectedExcerpt.value,
        responseMode: responseMode.value,
        responseLength: responseLength.value,
        quickAction,
        userPrompt: content,
        chapterContent: getPlainTextFromEditorContent(currentChapter.value?.content ?? '')
      })
    }))

    const streamId = (result.result as { streamId?: string } | undefined)?.streamId
    if (!result.success || !streamId) {
      throw new Error(result.error ?? 'AI 流式生成启动失败')
    }

    activeStreamId.value = streamId
  } catch (error) {
    resetStreamingState()
    message.error(error instanceof Error ? error.message : 'AI 请求失败')
  }
}

async function createOutlineDraft(promptText: string, quickAction: string): Promise<void> {
  const content = promptText.trim()
  if (!content || isResponding.value) {
    return
  }

  appStore.pushUserMessage(`【${quickAction}】${content}`)
  isResponding.value = true
  await scrollToBottom()

  try {
    // Use the structured outline task here so the result can be written straight
    // into the outline store instead of forcing the user to manually整理助手文本.
    const result = await window.characterArc.generateAi(toIpcPayload({
      task: 'outline-item',
      settings: appStore.appSettings,
      context: {
        projectTitle: currentProject.value?.title,
        projectGenre: currentProject.value?.genre,
        writingStyleLabel: writingStyle.value.label,
        writingStylePrompt: writingStyle.value.prompt,
        chapterTitle: currentChapter.value?.title,
        chapterSummary: currentChapter.value?.summary,
        chapterWordTarget: currentChapter.value?.wordTarget,
        chapterContent: getPlainTextFromEditorContent(currentChapter.value?.content ?? ''),
        chapterVolumeTitle: appStore.selectedChapterVolume?.title,
        chapterVolumeSummary: appStore.selectedChapterVolume?.summary,
        outlineTitles: appStore.outlineItems.map((item) => item.title),
        worldviewTitles: appStore.worldviewEntries.map((entry) => entry.title),
        characters: appStore.characters.map((character) => ({
          name: character.name,
          role: character.role,
          description: character.description
        })),
        currentVolumeOutlineItems: appStore.outlineItems
          .filter((item) => item.volumeId === appStore.selectedChapterVolume?.id)
          .slice(-4)
          .map((item) => ({
            title: item.title,
            conflict: item.conflict,
            summary: item.summary
          })),
        userPrompt: content
      }
    }))

    if (!result.success || !result.result) {
      throw new Error(result.error ?? 'AI 未返回有效大纲草稿')
    }

    const item = result.result as {
      title?: string
      wordTarget?: string
      conflict?: string
      summary?: string
    }

    appStore.createOutlineItem({
      volumeId: appStore.selectedChapterVolume?.id || currentChapter.value?.volumeId,
      title: item.title,
      wordTarget: item.wordTarget,
      conflict: item.conflict,
      summary: item.summary
    })
    appStore.pushAssistantMessage(
      `已创建下一章大纲草稿：${item.title ?? '新剧情节点'}\n预估字数：${item.wordTarget ?? '预估 3000字'}\n核心冲突：${item.conflict ?? '新的冲突正在酝酿。'}\n剧情摘要：${item.summary ?? 'AI 未返回有效剧情摘要'}`
    )
    await scrollToBottom()
    message.success('AI 已写入下一章大纲草稿')
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 生成下一章大纲失败')
  } finally {
    isResponding.value = false
  }
}

function handleQuickAction(action: ChapterAssistantQuickAction): void {
  if (action.requiresSelection && !selectedExcerpt.value) {
    message.warning('请先在正文中选中要处理的段落')
    return
  }

  responseMode.value = action.mode
  responseLength.value = action.length
  if (action.task === 'outline-draft') {
    void createOutlineDraft(action.prompt, action.label)
    return
  }

  void sendPrompt(action.prompt, action.label)
}

function handleInsert(content: string, mode: ChapterInsertionMode): void {
  const insertion = content.trim()
  if (!appStore.selectedChapter || !insertion) {
    message.warning('当前没有可插入内容的章节')
    return
  }

  if (isAssistantWindow) {
    void window.characterArc.publishAssistantCommand({
      type: 'insert-into-chapter',
      content: insertion,
      mode
    })

    if (mode === 'append') {
      message.success('AI 内容已发送到主窗口并准备追加到正文末尾')
      return
    }

    if (mode === 'replace-selection') {
      message.success('AI 内容已发送到主窗口并准备替换当前选区')
      return
    }

    message.success('AI 内容已发送到主窗口，等待插入正文')
    return
  }

  const inserted = appStore.insertIntoChapter(content, mode)
  if (!inserted) {
    message.warning('当前没有可插入内容的章节')
    return
  }

  if (mode === 'append') {
    message.success('AI 内容已追加到正文末尾')
    return
  }

  if (mode === 'replace-selection') {
    message.success('AI 内容已尝试替换当前选区')
    return
  }

  message.success('AI 内容已插入正文')
}

function handleUseAsSummary(content: string): void {
  const nextSummary = content.trim()
  if (!appStore.selectedChapter || !nextSummary) {
    message.warning('当前没有可更新摘要的章节')
    return
  }

  appStore.updateChapterSummary(nextSummary)
  message.success('AI 内容已设为本章摘要')
}

function handleUseAsTitle(content: string): void {
  const nextTitle = content
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^[-*#\d.\s]+/, '')
    .replace(/^标题[:：]\s*/, '')
    .replace(/[「」"'“”]/g, '')
    .trim()

  if (!appStore.selectedChapter || !nextTitle) {
    message.warning('当前没有可更新标题的章节')
    return
  }

  // Title application deliberately keeps only the first meaningful line so
  // verbose AI replies do not overwrite the chapter title with a paragraph.
  appStore.updateChapterTitle(nextTitle)
  message.success('AI 内容已设为章节标题')
}

function handleRegenerate(): void {
  const prompt = lastUserPrompt.value
  if (!prompt || isResponding.value) {
    return
  }

  // Reuse the latest author intent so the writer can quickly ask the model for
  // another variation without retyping the whole request.
  void sendPrompt(prompt.prompt, prompt.quickAction)
}

async function handleStopResponse(): Promise<void> {
  if (!activeStreamId.value || isStopping.value) {
    return
  }

  isStopping.value = true

  const result = await window.characterArc.stopAiStream(activeStreamId.value)
  if (!result.success) {
    isStopping.value = false
    message.error(result.error ?? '停止生成失败')
  }
}

function handleComposerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendPrompt()
  }
}

function handleAiStreamEvent(payload: CharacterArcAiStreamEvent): void {
  if (payload.streamId !== activeStreamId.value) {
    return
  }

  if (payload.type === 'chunk') {
    streamingReply.value += payload.delta
    void scrollToBottom()
    return
  }

  if (payload.type === 'done') {
    const finalReply = (payload.content ?? streamingReply.value).trim()
    if (finalReply) {
      appStore.pushAssistantMessage(finalReply)
    }
    resetStreamingState()
    void scrollToBottom()
    return
  }

  if (payload.type === 'canceled') {
    const partialReply = (payload.content ?? streamingReply.value).trim()
    if (partialReply) {
      appStore.pushAssistantMessage(partialReply)
      message.info('已停止生成，并保留当前已生成内容')
    } else {
      message.info('已停止生成')
    }
    resetStreamingState()
    void scrollToBottom()
    return
  }

  if (payload.type === 'error') {
    resetStreamingState()
    message.error(payload.error || 'AI 流式请求失败')
  }
}

onMounted(() => {
  removeAiStreamListener = window.characterArc.onAiStreamEvent(handleAiStreamEvent)
})

onBeforeUnmount(() => {
  if (activeStreamId.value) {
    void window.characterArc.stopAiStream(activeStreamId.value)
  }

  removeAiStreamListener?.()
  removeAiStreamListener = null
})

watch(
  () => appStore.messages.length,
  () => {
    void scrollToBottom()
  }
)

watch(
  [() => appStore.pendingAssistantRequest, isResponding],
  async ([request, busy]) => {
    if (!request || busy) {
      return
    }

    await sendPrompt(request.prompt, request.quickAction)
    appStore.consumeAssistantPrompt(request.id)
  },
  { deep: true }
)
</script>

<template>
  <aside class="assistant-shell">
    <header class="assistant-head">
      <div class="assistant-title">
        <div class="assistant-badge">
          <Bot :size="16" />
        </div>
        <div class="assistant-title-copy">
          <span class="assistant-kicker">Chapter Copilot</span>
          <strong>AI 创作助理</strong>
          <p>围绕当前章节给建议、润色或续写。</p>
          <div class="assistant-context-pills">
            <span class="assistant-context-pill">{{ currentProject?.title ?? '未命名项目' }}</span>
            <span class="assistant-context-pill strong">{{ currentChapter?.title ?? '未命名章节' }}</span>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="assistant-toolbox-toggle"
        :class="{ collapsed: isToolboxCollapsed }"
        :title="isToolboxCollapsed ? '展开工具抽屉' : '收起工具抽屉'"
        @click="isToolboxCollapsed = !isToolboxCollapsed"
      >
        <span class="assistant-toolbox-toggle-copy">
          <strong>{{ isToolboxCollapsed ? '展开工具' : '收起工具' }}</strong>
          <span>{{ toolboxSummary }}</span>
        </span>
        <ChevronDown :size="15" class="assistant-toolbox-toggle-icon" />
      </button>
    </header>

    <div class="assistant-toolbox" :class="{ collapsed: isToolboxCollapsed }">
      <div class="assistant-toolbox-inner">
        <div class="assistant-quick-actions">
          <button
            v-for="action in chapterAssistantQuickActions"
            :key="action.label"
            class="quick-action"
            :disabled="isResponding || (action.requiresSelection && !selectedExcerpt)"
            @click="handleQuickAction(action)"
          >
            <component :is="action.icon" :size="14" />
            <span>{{ action.label }}</span>
          </button>
        </div>

        <div class="assistant-controls">
          <div class="control-group">
            <span class="control-label">模式</span>
            <div class="segmented-control">
              <button
                v-for="option in chapterAssistantModeOptions"
                :key="option.value"
                class="segment-button"
                :class="{ active: responseMode === option.value }"
                :disabled="isResponding"
                @click="responseMode = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="control-group">
            <span class="control-label">长度</span>
            <div class="segmented-control compact">
              <button
                v-for="option in chapterAssistantLengthOptions"
                :key="option.value"
                class="segment-button"
                :class="{ active: responseLength === option.value }"
                :disabled="isResponding"
                @click="responseLength = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div ref="messagesViewport" class="assistant-messages arc-scrollbar">
      <div class="assistant-messages-stack">
        <article
          v-for="messageItem in appStore.messages"
          :key="messageItem.id"
          class="message-card"
          :class="messageItem.role"
        >
          <div class="message-meta">
            <span>{{ messageItem.role === 'assistant' ? '创作助理' : '你' }}</span>
            <div v-if="messageItem.role === 'assistant'" class="message-actions">
              <button
                class="insert-button"
                @click="handleInsert(messageItem.content, 'cursor')"
              >
                <ArrowDownToLine :size="13" />
                <span>插入</span>
              </button>
              <button
                class="insert-button secondary"
                @click="handleInsert(messageItem.content, 'replace-selection')"
              >
                <span>替换选区</span>
              </button>
              <button
                class="insert-button secondary"
                @click="handleInsert(messageItem.content, 'append')"
              >
                <span>追加末尾</span>
              </button>
              <button
                class="insert-button secondary"
                @click="handleUseAsTitle(messageItem.content)"
              >
                <span>设为标题</span>
              </button>
              <button
                class="insert-button secondary"
                @click="handleUseAsSummary(messageItem.content)"
              >
                <span>设为摘要</span>
              </button>
            </div>
          </div>
          <p>{{ messageItem.content }}</p>
        </article>

        <article v-if="isResponding" class="message-card assistant pending">
          <div class="message-meta">
            <span>创作助理</span>
          </div>
          <p>{{ streamingReply || '正在整理当前章节上下文并生成回复...' }}</p>
        </article>
      </div>
    </div>

    <footer class="assistant-composer">
      <div v-if="selectedExcerpt" class="composer-selection-preview">
        <div class="composer-selection-head">
          <span class="selection-preview-label">已附加选中文本</span>
          <span class="composer-selection-meta">AI 将优先参考这段内容</span>
        </div>
        <p>{{ selectedExcerpt }}</p>
      </div>

      <textarea
        v-model="draft"
        class="composer-input"
        rows="4"
        placeholder="例如：帮我把这一章开头写得更压迫一些，保留赛博朋克的冷感。"
        @keydown="handleComposerKeydown"
      ></textarea>
      <div class="composer-actions">
        <span class="composer-hint">Enter 发送，Shift + Enter 换行</span>
        <div class="composer-buttons">
          <button class="ghost-action" :disabled="isResponding || !lastUserPrompt" @click="handleRegenerate">
            <RotateCcw :size="13" />
            <span>重试</span>
          </button>
          <button
            class="send-button"
            :class="{ danger: isResponding }"
            :disabled="(!isResponding && !draft.trim()) || isStopping"
            @click="isResponding ? handleStopResponse() : sendPrompt()"
          >
            <component :is="isResponding ? Square : SendHorizonal" :size="15" />
            <span>{{ isResponding ? (isStopping ? '停止中...' : '停止生成') : '发送' }}</span>
          </button>
        </div>
      </div>
    </footer>
  </aside>
</template>

<style scoped src="./AiAssistantPanel.css"></style>
