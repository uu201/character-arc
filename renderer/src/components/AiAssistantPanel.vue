<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowDownToLine, Bot, Lightbulb, PenTool, ScrollText, SendHorizonal, Sparkles } from 'lucide-vue-next'
import { useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const message = useMessage()
const draft = ref('')
const isResponding = ref(false)
const messagesViewport = ref<HTMLElement | null>(null)

const quickActions = [
  {
    label: '描写环境',
    prompt: '请基于当前章节氛围，补写一段可以直接插入正文的环境描写，让画面感更强。',
    icon: ScrollText
  },
  {
    label: '润色段落',
    prompt: '请基于当前章节内容给出一版更有节奏感和画面感的润色稿，优先输出可直接插入正文的内容。',
    icon: PenTool
  },
  {
    label: '续写片段',
    prompt: '请紧接当前章节正文往后续写一小段，保持人物语气、世界观和剧情方向一致。',
    icon: Sparkles
  },
  {
    label: '剧情建议',
    prompt: '请结合当前章节和已有大纲，给出 3 条下一步剧情推进建议，每条都尽量具体。',
    icon: Lightbulb
  }
] as const

const currentProject = computed(() => appStore.currentProject)
const currentChapter = computed(() => appStore.selectedChapter)

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (messagesViewport.value) {
    messagesViewport.value.scrollTop = messagesViewport.value.scrollHeight
  }
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
  await scrollToBottom()

  try {
    const result = await window.characterArc.generateAi({
      task: 'chapter-assistant',
      settings: appStore.appSettings,
      context: {
        projectTitle: currentProject.value?.title,
        projectGenre: currentProject.value?.genre,
        chapterVolume: appStore.selectedChapterVolume?.title,
        chapterTitle: currentChapter.value?.title,
        chapterSummary: currentChapter.value?.summary,
        chapterStatus: currentChapter.value?.status,
        chapterWordTarget: currentChapter.value?.wordTarget,
        chapterContent: currentChapter.value?.content,
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
        quickAction,
        userPrompt: content
      }
    })

    const reply = (result.result as { content?: string } | undefined)?.content?.trim()
    if (!result.success || !reply) {
      throw new Error(result.error ?? 'AI 未返回有效内容')
    }

    appStore.pushAssistantMessage(reply)
    await scrollToBottom()
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 请求失败')
  } finally {
    isResponding.value = false
  }
}

function handleQuickAction(action: (typeof quickActions)[number]): void {
  void sendPrompt(action.prompt, action.label)
}

function handleInsert(content: string): void {
  appStore.insertIntoChapter(content)
  message.success('AI 内容已插入正文')
}

function handleComposerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendPrompt()
  }
}

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
        :disabled="isResponding"
        @click="handleQuickAction(action)"
      >
        <component :is="action.icon" :size="14" />
        <span>{{ action.label }}</span>
      </button>
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
          <button
            v-if="messageItem.role === 'assistant'"
            class="insert-button"
            @click="handleInsert(messageItem.content)"
          >
            <ArrowDownToLine :size="13" />
            <span>插入正文</span>
          </button>
        </div>
        <p>{{ messageItem.content }}</p>
      </article>

      <article v-if="isResponding" class="message-card assistant pending">
        <div class="message-meta">
          <span>创作助理</span>
        </div>
        <p>正在整理当前章节上下文并生成回复...</p>
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
        <button class="send-button" :disabled="isResponding || !draft.trim()" @click="sendPrompt()">
          <SendHorizonal :size="15" />
          <span>{{ isResponding ? '生成中...' : '发送' }}</span>
        </button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.assistant-shell {
  display: flex;
  width: clamp(300px, 26vw, 380px);
  min-width: 300px;
  flex-shrink: 0;
  flex-direction: column;
  border-left: 1px solid rgba(229, 231, 235, 0.82);
  background:
    linear-gradient(180deg, rgba(248, 250, 255, 0.96), rgba(255, 255, 255, 0.98)),
    radial-gradient(circle at top right, color-mix(in srgb, var(--arc-primary) 10%, white), transparent 34%);
}

.assistant-head {
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

.assistant-quick-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 16px 18px 14px;
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

.send-button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
  box-shadow: none;
}

@media (max-width: 1180px) {
  .assistant-shell {
    width: 320px;
    min-width: 320px;
  }
}
</style>
