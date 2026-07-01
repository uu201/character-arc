<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowDown, Brain, Check, ChevronDown as ChevronDownIcon, Copy, Edit3, Replace, RotateCw, Sparkles, Undo2, Wand2 } from 'lucide-vue-next'
import { useMessage } from 'naive-ui'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import markdown from 'highlight.js/lib/languages/markdown'
import ChapterAiToolCard from './ChapterAiToolCard.vue'
import type { ChapterAiMessage } from './useChapterAi'
import { useAppStore } from '@/stores/app'

// Register highlight.js languages
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true
})

// Custom renderer for code blocks
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : ''
  const highlighted = language
    ? hljs.highlight(text, { language }).value
    : hljs.highlightAuto(text).value
  const langLabel = language || 'code'
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${langLabel}</span><button class="code-copy-btn" data-code="${encodeURIComponent(text)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div><pre><code class="hljs">${highlighted}</code></pre></div>`
}

marked.use({ renderer })

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'span', 'del', 'div', 'button', 'svg', 'rect', 'path']
const ALLOWED_ATTR = ['class', 'href', 'target', 'rel', 'data-code', 'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'x', 'y', 'rx', 'd']

function renderMarkdown(content: string): string {
  const html = marked.parse(content) as string
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })
}

const props = defineProps<{
  messages: ChapterAiMessage[]
  isResponding: boolean
  hasSelection: boolean
}>()

const emit = defineEmits<{
  apply: [content: string, mode: 'cursor' | 'append' | 'replace-selection']
  regenerate: [prompt: string]
  undo: [versionId: string]
  send: [prompt: string]
  'generate-draft': []
}>()

const message = useMessage()
const appStore = useAppStore()
const scrollRef = ref<HTMLDivElement | null>(null)
const isAtBottom = ref(true)
const showScrollBtn = ref(false)
const copiedMsgId = ref<string | null>(null)
const expandedReasoning = ref<Record<string, boolean>>({})

const lastMsg = computed(() => props.messages[props.messages.length - 1])

function checkScrollPosition(): void {
  if (!scrollRef.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollRef.value
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight
  isAtBottom.value = distanceFromBottom < 100
  showScrollBtn.value = distanceFromBottom > 200
}

function scrollToBottom(smooth = true): void {
  if (!scrollRef.value) return
  scrollRef.value.scrollTo({
    top: scrollRef.value.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto'
  })
}

watch(
  () => [props.messages.length, lastMsg.value?.content, lastMsg.value?.reasoning, lastMsg.value?.toolCalls?.length, lastMsg.value?.editEvents?.length] as const,
  () => {
    if (isAtBottom.value) {
      nextTick(() => scrollToBottom(false))
    }
  }
)

function isStreaming(msg: ChapterAiMessage): boolean {
  return props.isResponding && msg.id === lastMsg.value?.id && msg.role === 'assistant'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function findUserPromptBefore(msgId: string): string | undefined {
  const idx = props.messages.findIndex((m) => m.id === msgId)
  if (idx <= 0) return undefined
  for (let i = idx - 1; i >= 0; i--) {
    if (props.messages[i].role === 'user') return props.messages[i].content
  }
  return undefined
}

async function copyMessage(content: string, msgId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content)
    copiedMsgId.value = msgId
    setTimeout(() => { copiedMsgId.value = null }, 2000)
  } catch {
    message.error('复制失败')
  }
}

function handleCodeCopy(event: MouseEvent): void {
  const btn = (event.target as HTMLElement).closest('.code-copy-btn') as HTMLElement | null
  if (!btn) return
  const code = decodeURIComponent(btn.dataset.code || '')
  if (code) {
    navigator.clipboard.writeText(code).then(() => {
      btn.classList.add('copied')
      setTimeout(() => btn.classList.remove('copied'), 2000)
    })
  }
}

const quickSuggestions = [
  '帮我分析当前章节的节奏感',
  '基于大纲给出下一段的写作建议',
  '检查对话是否自然'
]

onMounted(() => {
  scrollRef.value?.addEventListener('scroll', checkScrollPosition)
  scrollRef.value?.addEventListener('click', handleCodeCopy)
})

onBeforeUnmount(() => {
  scrollRef.value?.removeEventListener('scroll', checkScrollPosition)
  scrollRef.value?.removeEventListener('click', handleCodeCopy)
})
</script>

<template>
  <div class="messages-container">
    <div ref="scrollRef" class="messages arc-scrollbar">
      <!-- Empty state -->
      <div v-if="!messages.length && !isResponding" class="empty">
        <Sparkles :size="28" class="empty-icon" />
        <p class="empty-text">创作助理擅长讨论思路、改写段落、续写片段和审校。</p>
        <p class="empty-hint">想要按大纲生成整章正文，请用工具栏的「生成初稿」，它会带上写作备忘、参考文笔和完整上下文一次写满。</p>
        <button class="empty-cta" @click="emit('generate-draft')">
          <Wand2 :size="13" />
          <span>生成整章初稿</span>
        </button>
        <div class="empty-suggestions">
          <button
            v-for="suggestion in quickSuggestions"
            :key="suggestion"
            class="suggestion-btn"
            @click="emit('send', suggestion)"
          >
            {{ suggestion }}
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div v-for="msg in messages" :key="msg.id" class="msg" :class="msg.role">
        <!-- User message: single bubble -->
        <template v-if="msg.role === 'user'">
          <div class="bubble user">{{ msg.content }}</div>
        </template>

        <!-- AI message: multi-turn display -->
        <template v-else>
          <div v-if="msg.reasoning" class="reasoning-card" :class="{ expanded: expandedReasoning[msg.id] }">
            <button type="button" class="reasoning-head" @click="expandedReasoning[msg.id] = !expandedReasoning[msg.id]">
              <Brain :size="12" />
              <span>{{ isStreaming(msg) ? '正在思考' : '思考过程' }}</span>
              <ChevronDownIcon :size="13" class="reasoning-chevron" />
            </button>
            <pre v-if="expandedReasoning[msg.id] || isStreaming(msg)" class="reasoning-body">{{ msg.reasoning }}</pre>
          </div>

          <!-- 新结构：使用 turns -->
          <div v-if="msg.turns && msg.turns.length > 0" class="ai-turns">
            <div v-for="(turn, idx) in msg.turns" :key="idx" class="turn">
              <!-- Turn text bubble -->
              <div
                v-if="turn.text || (isStreaming(msg) && idx === msg.turns.length - 1 && turn.toolCalls.length === 0)"
                class="bubble ai"
                :class="{
                  streaming: isStreaming(msg) && idx === msg.turns.length - 1,
                  error: msg.isError && idx === msg.turns.length - 1,
                  canceled: msg.isCanceled && idx === msg.turns.length - 1
                }"
              >
                <template v-if="turn.text">
                  <div class="markdown-body" v-html="renderMarkdown(turn.text)" />
                  <span v-if="isStreaming(msg) && idx === msg.turns.length - 1" class="cursor" />
                </template>
                <template v-else-if="isStreaming(msg)">
                  <span class="dot" /><span class="dot" /><span class="dot" />
                </template>
              </div>

              <!-- Turn tool calls -->
              <div v-if="turn.toolCalls.length > 0" class="turn-tools">
                <ChapterAiToolCard v-for="tc in turn.toolCalls" :key="tc.toolUseId" :tool-call="tc" />
              </div>

              <!-- Turn edit events -->
              <div v-if="turn.editEvents.length > 0" class="turn-edits">
                <div v-for="edit in turn.editEvents" :key="edit.versionId" class="edit-card">
                  <Edit3 :size="12" />
                  <span>{{ edit.preview }}</span>
                  <button class="mini" @click="emit('undo', edit.versionId)">
                    <Undo2 :size="11" /> 撤销
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 旧结构：向后兼容 -->
          <template v-else>
            <!-- Tool call cards -->
            <div v-if="msg.toolCalls?.length" class="tool-calls">
              <ChapterAiToolCard v-for="tc in msg.toolCalls" :key="tc.toolUseId" :tool-call="tc" />
            </div>

            <!-- Edit events -->
            <div v-if="msg.editEvents?.length" class="edit-events">
              <div v-for="edit in msg.editEvents" :key="edit.versionId" class="edit-card">
                <Edit3 :size="12" />
                <span>{{ edit.preview }}</span>
                <button class="mini" @click="emit('undo', edit.versionId)">
                  <Undo2 :size="11" /> 撤销
                </button>
              </div>
            </div>

            <!-- Text bubble -->
            <div
              v-if="msg.content || (isStreaming(msg) && (!msg.toolCalls || msg.toolCalls.length === 0))"
              class="bubble ai"
              :class="{ streaming: isStreaming(msg), error: msg.isError, canceled: msg.isCanceled }"
            >
              <template v-if="msg.content">
                <div class="markdown-body" v-html="renderMarkdown(msg.content)" />
                <span v-if="isStreaming(msg)" class="cursor" />
              </template>
              <template v-else-if="isStreaming(msg)">
                <span class="dot" /><span class="dot" /><span class="dot" />
              </template>
            </div>
          </template>

          <!-- Message footer with actions -->
          <div v-if="!isStreaming(msg) && (msg.content || (msg.turns && msg.turns.some(t => t.text)))" class="msg-footer">
            <span v-if="msg.createdAt" class="msg-time">{{ formatTime(msg.createdAt) }}</span>
            <div class="actions">
              <button
                v-if="hasSelection"
                class="mini primary"
                title="替换当前选区"
                @click="emit('apply', msg.content, 'replace-selection')"
              >
                <Replace :size="11" /> 替换选区
              </button>
              <button
                class="mini"
                title="插入到光标处"
                @click="emit('apply', msg.content, 'cursor')"
              >
                <ArrowDown :size="11" /> 插入光标
              </button>
              <span class="actions-divider" />
              <button class="mini" title="复制" @click="copyMessage(msg.content, msg.id)">
                <Check v-if="copiedMsgId === msg.id" :size="11" class="icon-success" />
                <Copy v-else :size="11" />
              </button>
              <button
                class="mini"
                title="重新生成"
                :disabled="isResponding"
                @click="() => { const p = findUserPromptBefore(msg.id); if (p) emit('regenerate', p) }"
              >
                <RotateCw :size="11" />
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Scroll to bottom button -->
    <Transition name="fade">
      <button v-if="showScrollBtn" class="scroll-bottom-btn" @click="scrollToBottom()">
        <ChevronDownIcon :size="16" />
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.messages-container {
  flex: 1;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.messages {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ── Empty State ── */
.empty {
  margin: auto;
  text-align: center;
  padding: 32px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.empty-icon {
  color: var(--arc-primary);
  opacity: 0.6;
}

.empty-text {
  font-size: 13px;
  color: var(--arc-text-hint);
  max-width: 240px;
  line-height: 1.7;
}

.empty-hint {
  font-size: 11.5px;
  color: var(--arc-text-hint);
  max-width: 260px;
  line-height: 1.6;
  opacity: 0.75;
  margin-top: -4px;
}

.empty-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
  border-radius: 8px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.empty-cta:hover {
  background: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-bg-surface));
  border-color: var(--arc-primary);
}

.empty-suggestions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  width: 100%;
  max-width: 280px;
}

.suggestion-btn {
  padding: 8px 12px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}

.suggestion-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}

/* ── Messages ── */
.msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  user-select: text;
}

.msg.user { align-items: flex-end; }
.msg.assistant { align-items: flex-start; }

.reasoning-card {
  width: min(96%, 720px);
  border: 1px solid color-mix(in srgb, var(--arc-primary) 16%, var(--arc-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-surface));
  overflow: hidden;
}

.reasoning-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 30px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}

.reasoning-head svg:first-child {
  color: var(--arc-primary);
}

.reasoning-chevron {
  margin-left: auto;
  color: var(--arc-text-hint);
  transition: transform 0.15s ease;
}

.reasoning-card.expanded .reasoning-chevron {
  transform: rotate(180deg);
}

.reasoning-body {
  max-height: 180px;
  margin: 0;
  padding: 8px 10px 10px;
  overflow: auto;
  border-top: 1px solid color-mix(in srgb, var(--arc-primary) 12%, var(--arc-border));
  color: var(--arc-text-hint);
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
}

/* ── Multi-turn AI messages ── */
.ai-turns {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  max-width: 96%;
  width: 100%;
}

.turn {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.turn-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 12px;
}

/* 如果 turn 只有工具调用没有文本，不缩进 */
.turn:not(:has(.bubble)) .turn-tools {
  padding-left: 0;
}

.turn-edits {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 12px;
}

.turn:not(:has(.bubble)) .turn-edits {
  padding-left: 0;
}

/* ── Bubbles ── */
.bubble {
  max-width: 92%;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.bubble.user {
  background: var(--arc-primary);
  color: white;
  border-radius: 16px 16px 4px 16px;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-primary) 20%, transparent);
  white-space: pre-wrap;
}

.bubble.ai {
  max-width: 96%;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  color: var(--arc-text-primary);
  border-radius: 4px 16px 16px 16px;
}

.bubble.ai.streaming {
  border-left: 2px solid var(--arc-primary);
}

.bubble.ai.error {
  background: color-mix(in srgb, #dc2626 8%, var(--arc-bg-weak));
  border-color: color-mix(in srgb, #dc2626 30%, var(--arc-border));
  border-left: 2px solid #dc2626;
}

.bubble.ai.canceled {
  background: color-mix(in srgb, var(--arc-text-hint) 5%, var(--arc-bg-weak));
  border-color: var(--arc-border-strong);
  color: var(--arc-text-secondary);
  font-style: italic;
}

/* ── Streaming indicators ── */
.cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--arc-primary);
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: blink 0.8s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--arc-text-hint);
  animation: bounce 1.2s infinite;
  margin-right: 4px;
}

.dot:nth-child(2) { animation-delay: 0.15s; }
.dot:nth-child(3) { animation-delay: 0.3s; margin-right: 0; }

@keyframes bounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

/* ── Message Footer ── */
.msg-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 0;
  align-self: stretch;
  max-width: 96%;
}

.msg-time {
  font-size: 10.5px;
  color: var(--arc-text-hint);
}

.actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
  opacity: 0.65;
  transition: opacity 0.15s;
}

.msg-footer:hover .actions {
  opacity: 1;
}

.actions-divider {
  width: 1px;
  height: 14px;
  background: var(--arc-border);
  margin: 0 2px;
}

.mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  font-size: 11px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mini:hover:not(:disabled) {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}

.mini:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
}

.mini.primary {
  background: var(--arc-primary);
  color: white;
  border-color: var(--arc-primary);
}

.mini.primary:hover {
  background: var(--arc-primary-hover);
  color: white;
}

.icon-success {
  color: var(--arc-success, #16a34a);
}

/* ── Tool Calls & Edit Events ── */
.tool-calls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 92%;
}

.edit-events {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 92%;
}

.edit-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-success) 8%, var(--arc-bg-surface));
  border: 1px solid color-mix(in srgb, var(--arc-success) 18%, var(--arc-border));
  font-size: 12px;
  color: var(--arc-success);
}

.edit-card .mini {
  margin-left: auto;
  padding: 3px 8px;
  font-size: 10.5px;
}

/* ── Scroll to Bottom Button ── */
.scroll-bottom-btn {
  position: absolute;
  bottom: 12px;
  right: 16px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.15s;
  z-index: 10;
}

.scroll-bottom-btn:hover {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

<style>
/* Markdown body styles (unscoped for v-html content) */
.markdown-body {
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.markdown-body p {
  margin: 0 0 8px;
}

.markdown-body p:last-child {
  margin-bottom: 0;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 12px 0 6px;
  font-weight: 600;
  line-height: 1.4;
}

.markdown-body h1 { font-size: 1.3em; }
.markdown-body h2 { font-size: 1.2em; }
.markdown-body h3 { font-size: 1.1em; }
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 { font-size: 1em; }

.markdown-body ul,
.markdown-body ol {
  margin: 6px 0;
  padding-left: 20px;
}

.markdown-body li {
  margin: 3px 0;
}

.markdown-body li > p {
  margin: 0;
}

.markdown-body blockquote {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
  border-radius: 0 6px 6px 0;
  color: var(--arc-text-secondary);
}

.markdown-body blockquote p {
  margin: 0;
}

.markdown-body code {
  padding: 2px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--arc-text-primary) 8%, var(--arc-bg-surface));
  font-size: 0.9em;
  font-family: 'Fira Code', 'JetBrains Mono', Consolas, monospace;
}

.markdown-body pre {
  margin: 0;
}

.markdown-body pre code {
  padding: 0;
  background: transparent;
  border-radius: 0;
  font-size: 12px;
}

.markdown-body strong {
  font-weight: 600;
}

.markdown-body em {
  font-style: italic;
}

.markdown-body del {
  text-decoration: line-through;
  opacity: 0.7;
}

.markdown-body a {
  color: var(--arc-primary);
  text-decoration: none;
}

.markdown-body a:hover {
  text-decoration: underline;
}

.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}

.markdown-body th,
.markdown-body td {
  padding: 6px 10px;
  border: 1px solid var(--arc-border);
  text-align: left;
}

.markdown-body th {
  background: var(--arc-bg-surface);
  font-weight: 600;
}

.markdown-body hr {
  border: none;
  border-top: 1px solid var(--arc-border);
  margin: 12px 0;
}

/* ── Code Block ── */
.markdown-body .code-block {
  margin: 8px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--arc-border);
  background: #1e1e2e;
}

.markdown-body .code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #181825;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.markdown-body .code-lang {
  font-size: 10px;
  font-weight: 500;
  color: #a6adc8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.markdown-body .code-copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #a6adc8;
  cursor: pointer;
  transition: all 0.15s;
}

.markdown-body .code-copy-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #cdd6f4;
}

.markdown-body .code-copy-btn.copied {
  color: #a6e3a1;
}

.markdown-body .code-block pre {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: #45475a transparent;
}

.markdown-body .code-block pre code {
  font-size: 12px;
  line-height: 1.6;
  color: #cdd6f4;
  font-family: 'Fira Code', 'JetBrains Mono', Consolas, monospace;
}

/* highlight.js theme overrides (Catppuccin-inspired) */
.markdown-body .hljs-keyword { color: #cba6f7; }
.markdown-body .hljs-string { color: #a6e3a1; }
.markdown-body .hljs-number { color: #fab387; }
.markdown-body .hljs-comment { color: #6c7086; font-style: italic; }
.markdown-body .hljs-function { color: #89b4fa; }
.markdown-body .hljs-title { color: #89b4fa; }
.markdown-body .hljs-params { color: #f5c2e7; }
.markdown-body .hljs-built_in { color: #f38ba8; }
.markdown-body .hljs-literal { color: #fab387; }
.markdown-body .hljs-type { color: #f9e2af; }
.markdown-body .hljs-attr { color: #89dceb; }
.markdown-body .hljs-selector-class { color: #a6e3a1; }
.markdown-body .hljs-selector-tag { color: #cba6f7; }
.markdown-body .hljs-property { color: #89dceb; }
.markdown-body .hljs-punctuation { color: #bac2de; }
.markdown-body .hljs-variable { color: #cdd6f4; }
.markdown-body .hljs-operator { color: #89dceb; }
.markdown-body .hljs-meta { color: #f38ba8; }
</style>
