<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowDownToLine, Bot, Lightbulb, PenTool, RotateCcw, Rows3, ScrollText, SendHorizonal, Sparkles, Square } from 'lucide-vue-next'
import { useMessage } from 'naive-ui'
import { getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
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
let removeAiStreamListener: (() => void) | null = null

function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const modeOptions = [
  { label: '自由', value: 'freeform' as const },
  { label: '润色', value: 'polish' as const },
  { label: '续写', value: 'continue' as const },
  { label: '建议', value: 'suggest' as const },
  { label: '设定', value: 'reference' as const }
] as const

const lengthOptions = [
  { label: '短', value: 'short' as const },
  { label: '中', value: 'medium' as const },
  { label: '长', value: 'long' as const }
] as const

const quickActions = [
  {
    label: '润色选中',
    prompt: '请只针对当前选中的正文片段做一版润色，保留原意和剧情信息，提升节奏、画面感与表达准确度。直接输出润色后的最终文本。',
    icon: PenTool,
    mode: 'polish' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: true
  },
  {
    label: '下一章大纲',
    prompt: '请基于当前章节、分卷目标和已有剧情，生成一条适合作为下一章的大纲草稿。',
    icon: Rows3,
    mode: 'suggest' as const,
    length: 'medium' as const,
    task: 'outline-draft' as const,
    requiresSelection: false
  },
  {
    label: '章节标题',
    prompt: '请基于当前章节内容、分卷定位和剧情推进，拟定一个更贴切的章节标题。只保留一个最终标题，要求有小说感，简洁，不要解释。',
    icon: PenTool,
    mode: 'freeform' as const,
    length: 'short' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '章节摘要',
    prompt: '请基于当前章节内容，生成一段适合作为章节摘要或本章定位的简洁文案，突出主要冲突与推进，控制在 60 到 100 字。',
    icon: ScrollText,
    mode: 'freeform' as const,
    length: 'short' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '描写环境',
    prompt: '请基于当前章节氛围，补写一段可以直接插入正文的环境描写，让画面感更强。',
    icon: ScrollText,
    mode: 'continue' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '润色段落',
    prompt: '请基于当前章节内容给出一版更有节奏感和画面感的润色稿，优先输出可直接插入正文的内容。',
    icon: PenTool,
    mode: 'polish' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '续写片段',
    prompt: '请紧接当前章节正文往后续写一小段，保持人物语气、世界观和剧情方向一致。',
    icon: Sparkles,
    mode: 'continue' as const,
    length: 'long' as const,
    task: 'chat' as const,
    requiresSelection: false
  },
  {
    label: '下一章建议',
    prompt: '请结合当前章节、分卷目标和已有大纲，给出 3 条下一章剧情推进建议。每条都要包含推进方向、核心冲突和一个能勾住读者的钩子。',
    icon: Lightbulb,
    mode: 'suggest' as const,
    length: 'medium' as const,
    task: 'chat' as const,
    requiresSelection: false
  }
] as const

const currentProject = computed(() => appStore.currentProject)
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

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (messagesViewport.value) {
    messagesViewport.value.scrollTop = messagesViewport.value.scrollHeight
  }
}

function buildChapterAssistantContext(quickAction: string | undefined, content: string): Record<string, unknown> {
  return {
    projectTitle: currentProject.value?.title,
    projectGenre: currentProject.value?.genre,
    chapterVolume: appStore.selectedChapterVolume?.title,
    chapterTitle: currentChapter.value?.title,
    chapterSummary: currentChapter.value?.summary,
    chapterStatus: currentChapter.value?.status,
    chapterWordTarget: currentChapter.value?.wordTarget,
    chapterContent: getPlainTextFromEditorContent(currentChapter.value?.content ?? ''),
    chapterVolumeTitle: appStore.selectedChapterVolume?.title,
    chapterVolumeSummary: appStore.selectedChapterVolume?.summary,
    relatedChapters: relatedChapters.value,
    recentMessages: recentAssistantMessages.value,
    worldviewEntries: appStore.worldviewEntries.map((entry) => ({
      title: entry.title,
      content: entry.content
    })),
    characters: appStore.characters.map((character) => ({
      name: character.name,
      role: character.role,
      description: character.description
    })),
    outlineItems: appStore.outlineItems.map((item) => ({
      title: item.title,
      summary: item.summary
    })),
    selectedText: selectedExcerpt.value,
    responseMode: responseMode.value,
    responseLength: responseLength.value,
    quickAction,
    userPrompt: content
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
      context: buildChapterAssistantContext(quickAction, content)
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

function handleQuickAction(action: (typeof quickActions)[number]): void {
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
        <div>
          <strong>AI 创作助理</strong>
          <p>围绕当前章节给建议、润色或续写。</p>
        </div>
      </div>
    </header>

    <div class="assistant-quick-actions">
      <button
        v-for="action in quickActions"
        :key="action.label"
        class="quick-action"
        :disabled="isResponding || (action.requiresSelection && !selectedExcerpt)"
        @click="handleQuickAction(action)"
      >
        <component :is="action.icon" :size="14" />
        <span>{{ action.label }}</span>
      </button>
    </div>

    <div v-if="selectedExcerpt" class="selection-preview">
      <span class="selection-preview-label">当前选中</span>
      <p>{{ selectedExcerpt }}</p>
    </div>

    <div class="assistant-controls">
      <div class="control-group">
        <span class="control-label">模式</span>
        <div class="segmented-control">
          <button
            v-for="option in modeOptions"
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
            v-for="option in lengthOptions"
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

    <div ref="messagesViewport" class="assistant-messages arc-scrollbar">
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

    <footer class="assistant-composer">
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

<style scoped>
.assistant-shell {
  display: flex;
  width: clamp(260px, 20vw, 320px);
  min-width: 260px;
  flex-shrink: 0;
  flex-direction: column;
  border-left: 1px solid rgba(229, 231, 235, 0.82);
  background:
    linear-gradient(180deg, rgba(248, 250, 255, 0.96), rgba(255, 255, 255, 0.98)),
    radial-gradient(circle at top right, color-mix(in srgb, var(--arc-primary) 10%, white), transparent 34%);
}

.assistant-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: calc(var(--arc-titlebar-height) + 12px) 18px 14px;
  border-bottom: 1px solid rgba(229, 231, 235, 0.78);
}

.assistant-title {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.assistant-badge {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--arc-primary) 12%, white);
  color: var(--arc-primary);
  flex-shrink: 0;
}

.assistant-title strong {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
}

.assistant-title p {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.ghost-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(209, 213, 219, 0.88);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #4b5563;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  padding: 7px 10px;
  white-space: nowrap;
}

.ghost-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.assistant-quick-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 16px 18px 14px;
}

.assistant-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 18px 14px;
}

.selection-preview {
  margin: 0 18px 14px;
  border: 1px solid rgba(229, 231, 235, 0.9);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.88);
  padding: 10px 12px;
}

.selection-preview-label {
  display: inline-flex;
  margin-bottom: 6px;
  color: #6b7280;
  font-size: 11px;
  font-weight: 700;
}

.selection-preview p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: #374151;
  font-size: 12px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.control-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.control-label {
  color: #6b7280;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.segmented-control {
  display: inline-flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.segmented-control.compact {
  flex: 0 0 auto;
}

.segment-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(209, 213, 219, 0.9);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #4b5563;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  padding: 7px 11px;
  transition: all 0.18s ease;
}

.segment-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--arc-primary) 20%, white);
  color: var(--arc-primary);
}

.segment-button.active {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, white);
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
  color: var(--arc-primary);
}

.segment-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.quick-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid rgba(229, 231, 235, 0.9);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  color: #374151;
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
  padding: 12px 10px;
  transition: all 0.22s ease;
}

.quick-action:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, white);
  color: var(--arc-primary);
  transform: translateY(-1px);
}

.quick-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.assistant-messages {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 0 18px 16px;
}

.message-card {
  border-radius: 18px;
  padding: 14px 14px 12px;
}

.message-card.user {
  background: color-mix(in srgb, var(--arc-primary) 9%, white);
  border: 1px solid color-mix(in srgb, var(--arc-primary) 14%, white);
}

.message-card.assistant {
  background: white;
  border: 1px solid rgba(229, 231, 235, 0.9);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.message-card.pending {
  border-style: dashed;
}

.message-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  color: #6b7280;
  font-size: 11px;
  font-weight: 700;
}

.message-card p {
  margin: 0;
  color: #1f2937;
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
}

.message-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.insert-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  border-radius: 999px;
  background: #f5f7fb;
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  padding: 7px 10px;
}

.insert-button.secondary {
  background: #ffffff;
  color: #4b5563;
  border: 1px solid rgba(229, 231, 235, 0.9);
}

.assistant-composer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid rgba(229, 231, 235, 0.78);
  background: rgba(255, 255, 255, 0.94);
  padding: 16px 18px 18px;
}

.composer-input {
  width: 100%;
  min-height: 108px;
  border: 1px solid rgba(209, 213, 219, 0.76);
  border-radius: 18px;
  background: white;
  color: #1d1d1f;
  font: inherit;
  line-height: 1.7;
  outline: none;
  padding: 14px 15px;
  resize: vertical;
}

.composer-input:focus {
  border-color: color-mix(in srgb, var(--arc-primary) 26%, white);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 10%, transparent);
}

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.composer-buttons {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.composer-hint {
  color: #9ca3af;
  font-size: 11px;
}

.send-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: 999px;
  background: var(--arc-primary);
  color: white;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  padding: 11px 16px;
  box-shadow: 0 10px 24px color-mix(in srgb, var(--arc-primary) 24%, transparent);
}

.send-button.danger {
  background: #b42318;
  box-shadow: none;
}

.send-button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
  box-shadow: none;
}

@media (max-width: 1500px) {
  .assistant-shell {
    width: 280px;
    min-width: 280px;
  }
}

@media (max-width: 1320px) {
  .assistant-shell {
    width: 260px;
    min-width: 260px;
  }
}

@media (max-width: 1360px) {
  .assistant-shell {
    width: 100%;
    min-width: 0;
  }

  .assistant-head {
    padding: 14px 18px 12px;
  }

  .assistant-quick-actions {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .assistant-messages {
    padding-bottom: 12px;
  }
}

@media (max-width: 920px) {
  .assistant-quick-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .control-group {
    align-items: flex-start;
    flex-direction: column;
  }

  .message-meta,
  .composer-actions,
  .assistant-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .message-actions,
  .composer-buttons {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
