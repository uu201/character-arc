<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Sparkles, SquareTerminal, UserRound } from 'lucide-vue-next'
import type { AssistantMessageView, AssistantToolCallView } from '@/composables/useAssistant'

const MD_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th',
  'td', 'a', 'span', 'del', 'hr', 'input'
]
const MD_ALLOWED_ATTR = ['class', 'href', 'target', 'rel', 'type', 'checked', 'disabled']

marked.setOptions({
  breaks: true,
  gfm: true
})

function splitTableCells(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableCells(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function normalizeMarkdownTables(content: string): string {
  const lines = content.split('\n')
  let inFence = false

  return lines.map((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence || !isTableSeparator(line) || index === 0) return line

    const headerCells = splitTableCells(lines[index - 1])
    const separatorCells = splitTableCells(line)
    if (headerCells.length <= separatorCells.length) return line

    const normalizedCells = [
      ...separatorCells,
      ...Array.from({ length: headerCells.length - separatorCells.length }, () => '------')
    ]
    return `| ${normalizedCells.join(' | ')} |`
  }).join('\n')
}

function renderMarkdown(content: string): string {
  const html = marked.parse(normalizeMarkdownTables(content || ''), { async: false }) as string
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MD_ALLOWED_TAGS,
    ALLOWED_ATTR: MD_ALLOWED_ATTR
  })
}

const props = defineProps<{
  messages: AssistantMessageView[]
  isStreaming: boolean
  isInitializing?: boolean
  assistantName?: string
}>()

const emit = defineEmits<{
  (e: 'open-knowledge', documentId?: string): void
  (e: 'continue', prompt: string): void
}>()

const scrollRef = ref<HTMLDivElement | null>(null)

watch(
  () => props.messages.map((m) => [
    m.assistantMessage,
    m.reasoning.length,
    m.flowBlocks.length,
    m.toolCalls.map((t) => `${t.status}:${t.resultPreview?.length ?? 0}`).join(','),
    m.status
  ].join(':')).join('|'),
  async () => {
    await nextTick()
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  }
)

/** 人类可读的工具动作说明。 */
function describeToolAction(t: AssistantToolCallView): string {
  const a = t.args
  switch (t.toolName) {
    case 'read_chapter': return `读取章节 ${short(a.chapter_id ?? '当前章节')}`
    case 'list_chapters': return '列出所有章节'
    case 'search_project': return `全项目搜索: "${short(a.query ?? a.q)}"`
    case 'read_project_data':
      return `读取${short(a.entity_type ?? '项目数据')}${a.entity_id ? ' · ' + short(a.entity_id) : ''}`
    case 'stage_chapter_edit':
      return `暂存章节修改（${short(a.operation ?? 'edit')} · ${short(a.chapter_id ?? '当前章节')}）`
    case 'stage_chapter_delete':
      return `暂存删除章节（${short(a.chapter_id ?? '当前章节')}）`
    case 'stage_chapter_update': return `暂存章节资料修改（${short(a.chapter_id ?? '当前章节')}）`
    case 'list_chapter_versions': return `查看章节版本（${short(a.chapter_id ?? '当前章节')}）`
    case 'stage_chapter_restore': return `暂存章节版本恢复（${short(a.version_id)}）`
    case 'stage_relationship': return `暂存人物关系（${short(a.action ?? 'update')}）`
    case 'stage_organization_membership': return `暂存组织归属（${short(a.action ?? 'update')}）`
    case 'stage_inspiration': return `暂存灵感（${short(a.action ?? 'update')}）`
    case 'list_outline_volumes': return '列出所有分卷'
    case 'stage_outline_volume': return `暂存分卷（${short(a.action ?? 'update')}）`
    case 'stage_knowledge_document': return `暂存知识文档（${short(a.action ?? 'update')}）`
    case 'stage_project_metadata': return '暂存项目资料修改'
    case 'stage_worldview': return `暂存世界观（${short(a.action ?? 'update')}）`
    case 'stage_character': return `暂存人物卡（${short(a.action ?? 'update')}）`
    case 'stage_organization': return `暂存组织（${short(a.action ?? 'update')}）`
    case 'stage_outline': return `暂存大纲节点（${short(a.action ?? 'update')}）`
    case 'stage_constraint': return `暂存项目约束（${short(a.action ?? 'create')}）`
    case 'stage_plot_thread': return `暂存剧情线索（${short(a.action ?? 'update')}）`
    case 'stage_workflow_document': return `暂存创作记忆（${short(a.doc_key ?? '')}${a.operation ? ' · ' + short(a.operation) : ''}）`
    case 'skill_list': return '查看可用技能'
    case 'skill_load': return `加载技能: ${short(a.id ?? a.name)}`
    case 'knowledge_save_document': return `保存知识文档: ${short(a.title)}`
    default: return t.toolName
  }
}

function short(v: unknown, max = 40): string {
  if (v === undefined || v === null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > max ? s.slice(0, max) + '…' : s
}

function knowledgeDocumentId(t: AssistantToolCallView): string | undefined {
  if (t.toolName !== 'knowledge_save_document' || !t.resultPreview) return undefined
  const match = String(t.resultPreview).match(/ID:\s*([A-Za-z0-9_-]+)/)
  return match?.[1]
}

function canOpenKnowledge(t: AssistantToolCallView): boolean {
  return t.toolName === 'knowledge_save_document' && t.status === 'ok'
}

function isEvidenceTool(name: string): boolean {
  return name === 'search_project' ||
    name === 'read_project_data' ||
    name === 'read_chapter' ||
    name === 'list_chapters'
}

function evidenceLabel(t: AssistantToolCallView): string {
  if (t.toolName === 'search_project') return `搜索：${short(t.args.query ?? t.args.q, 28)}`
  if (t.toolName === 'read_project_data') return `读取资料：${short(t.args.entity_type ?? '项目索引', 28)}`
  if (t.toolName === 'read_chapter') return `读取章节：${short(t.args.chapter_id ?? '当前章节', 28)}`
  if (t.toolName === 'list_chapters') return '章节列表'
  return t.toolName
}

function toolStatusText(t: AssistantToolCallView): string {
  if (t.status === 'running') return '进行中'
  if (t.status === 'error') return '失败'
  return '完成'
}

function commandLabel(t: AssistantToolCallView): string {
  return isEvidenceTool(t.toolName) ? evidenceLabel(t) : describeToolAction(t)
}

function commandSummary(calls: AssistantToolCallView[]): string {
  const running = calls.filter((c) => c.status === 'running').length
  const failed = calls.filter((c) => c.status === 'error').length
  if (running > 0) return `正在运行 ${running} 条命令`
  if (failed > 0) return `已运行 ${calls.length} 条命令，${failed} 条失败`
  return `已运行 ${calls.length} 条命令`
}

const hasContent = computed(() => props.messages.length > 0)
</script>

<template>
  <div ref="scrollRef" class="messages">
    <!-- 骨架屏：初始加载中 -->
    <div v-if="props.isInitializing && !hasContent" class="skeleton">
      <div class="skeleton-item user">
        <div class="skeleton-avatar" />
        <div class="skeleton-bubble" />
      </div>
      <div class="skeleton-item assistant">
        <div class="skeleton-avatar" />
        <div class="skeleton-content">
          <div class="skeleton-line" />
          <div class="skeleton-line" />
          <div class="skeleton-line short" />
        </div>
      </div>
    </div>

    <div v-else-if="!hasContent" class="empty">
      <div class="title">开始一段对话</div>
      <div class="hint">
        {{ props.isStreaming ? '正在思考…' : '试试问："介绍项目里的第一个人物" 或"帮我优化第一章的开头"' }}
      </div>
    </div>

    <article
      v-for="(msg, index) in props.messages"
      :key="msg.turnId"
      class="turn-entry"
      :class="{ 'is-first': index === 0 }"
    >
      <div class="user-entry">
        <div class="user-avatar">
          <UserRound :size="14" :stroke-width="1.9" />
        </div>
        <div class="user-content">{{ msg.userMessage }}</div>
      </div>

      <div class="assistant-block">
        <div class="assistant-head">
          <span class="assistant-mark">
            <Sparkles :size="12" :stroke-width="2" />
          </span>
          <span class="assistant-name">{{ props.assistantName ?? '全局助手' }}</span>
          <span v-if="msg.status === 'streaming'" class="assistant-state">生成中</span>
        </div>

      <template v-if="msg.flowBlocks.length > 0">
        <template v-for="block in msg.flowBlocks" :key="block.id">
          <div
            v-if="block.kind === 'reasoning'"
            class="assistant-copy reasoning-copy markdown-body"
            v-html="renderMarkdown(block.content)"
          />

          <details v-else-if="block.kind === 'commands'" class="command-block">
            <summary class="command-summary">
              <SquareTerminal class="summary-icon" :size="15" :stroke-width="1.75" />
              <span>{{ commandSummary(block.commands) }}</span>
            </summary>

            <div class="command-details">
              <div
                v-for="item in block.commands"
                :key="item.toolUseId"
                class="command-item"
                :class="item.status"
              >
                <div class="command-item-head">
                  <span class="command-state" />
                  <span class="command-title">{{ commandLabel(item) }}</span>
                  <span class="command-meta">
                    {{ toolStatusText(item) }}
                  </span>
                  <button
                    v-if="canOpenKnowledge(item)"
                    type="button"
                    class="tool-open"
                    @click.stop="emit('open-knowledge', knowledgeDocumentId(item))"
                  >
                    打开
                  </button>
                </div>
                <details
                  v-if="item.resultPreview"
                  class="command-preview"
                >
                  <summary>查看返回内容</summary>
                  <pre>{{ item.resultPreview }}</pre>
                </details>
              </div>
            </div>
          </details>

          <div
            v-else
            class="assistant-copy markdown-body"
          >
            <div v-html="renderMarkdown(block.content)" />
            <span v-if="msg.status === 'streaming' && block.id === msg.flowBlocks[msg.flowBlocks.length - 1]?.id" class="cursor">▍</span>
          </div>
        </template>
      </template>
      <div v-else-if="msg.status === 'streaming'" class="assistant-copy thinking-copy">
        <span class="thinking-dots"><i /><i /><i /></span>
        正在分析你的问题，并按需读取项目上下文。
      </div>
      </div>

      <div v-if="msg.error" class="error-block">
        <div class="error-title">出错了</div>
        <div class="error-body">{{ msg.error }}</div>
      </div>

      <div v-if="msg.status === 'canceled'" class="status-tag">已取消</div>

      <div v-if="msg.resumable && msg.status === 'done'" class="continue-line">
        <SquareTerminal class="summary-icon" :size="15" :stroke-width="1.75" />
        <div class="continue-copy">
          <span>{{ msg.resumable.reason || '可以基于现有证据继续下一批读取与分析。' }}</span>
          <button type="button" class="resume-btn" @click="emit('continue', msg.resumable.prompt)">
            {{ msg.resumable.label || '继续' }}
          </button>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 18px;
  display: flex;
  flex-direction: column;
  gap: 26px;
  min-width: 0;
  min-height: 0;
}
/* ── Skeleton 加载占位 ── */
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 8px 0;
  pointer-events: none;
}
.skeleton-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.skeleton-item.user {
  flex-direction: row-reverse;
}
.skeleton-avatar {
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: var(--arc-border-strong);
  animation: shimmer 1.6s ease-in-out infinite;
}
.skeleton-bubble {
  width: 200px;
  height: 36px;
  border-radius: 12px;
  background: var(--arc-border-strong);
  animation: shimmer 1.6s ease-in-out infinite;
}
.skeleton-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
}
.skeleton-line {
  height: 13px;
  border-radius: 6px;
  background: var(--arc-border-strong);
  animation: shimmer 1.6s ease-in-out infinite;
}
.skeleton-line.short {
  width: 55%;
}
@keyframes shimmer {
  0%, 100% { opacity: 0.45; }
  50%       { opacity: 0.2;  }
}

.empty {
  margin: auto;
  text-align: center;
  padding: 40px 20px;
}
.empty .title {
  font-size: 15px;
  font-weight: 500;
  color: var(--arc-text-primary);
  margin-bottom: 6px;
}
.empty .hint {
  font-size: 13px;
  color: var(--arc-text-hint);
}
.turn-entry {
  width: min(100%, 900px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding-top: 30px;
  border-top: 1px solid var(--arc-border);
}
.turn-entry.is-first {
  padding-top: 0;
  border-top: none;
}
.user-entry {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.user-avatar {
  display: inline-flex;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-strong);
  color: var(--arc-text-secondary);
  transform: translateY(1px);
}
.user-content,
.assistant-copy {
  color: var(--arc-text-primary);
  font-size: 15px;
  line-height: 1.8;
  word-break: break-word;
}
.user-content {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  font-weight: 500;
}
.assistant-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.assistant-head {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.assistant-mark {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}
.assistant-name {
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.assistant-state {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-family: var(--v2-mono);
  font-size: 10.5px;
}
.thinking-copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-secondary);
}
.thinking-dots {
  display: inline-flex;
  gap: 3px;
}
.thinking-dots i {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--arc-text-hint);
  animation: thinking-bounce 1.3s ease-in-out infinite;
}
.thinking-dots i:nth-child(2) { animation-delay: 0.18s; }
.thinking-dots i:nth-child(3) { animation-delay: 0.36s; }
@keyframes thinking-bounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}
.reasoning-copy {
  padding-left: 12px;
  border-left: 2px solid var(--arc-border-strong);
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.75;
}
.markdown-body :deep(p) { margin: 0 0 10px; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  font-weight: 600;
  margin: 14px 0 7px;
  color: var(--arc-text-primary);
}
.markdown-body :deep(h1) { font-size: 18px; }
.markdown-body :deep(h2) { font-size: 16.5px; }
.markdown-body :deep(h3) { font-size: 15px; }
.markdown-body :deep(h4) { font-size: 14px; }
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 4px 0 10px;
  padding-left: 22px;
}
.markdown-body :deep(li) {
  margin: 3px 0;
}
.markdown-body :deep(input[type='checkbox']) {
  margin: 0 6px 0 0;
  transform: translateY(1px);
}
.markdown-body :deep(code) {
  font-family: var(--v2-mono);
  font-size: 12.5px;
  background: var(--arc-bg-weak);
  padding: 1px 5px;
  border-radius: 4px;
}
.markdown-body :deep(pre) {
  background: var(--arc-bg-weak);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
}
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--arc-border-strong);
  padding: 2px 0 2px 10px;
  color: var(--arc-text-secondary);
  margin: 8px 0;
}
.markdown-body :deep(a) {
  color: var(--arc-primary);
  text-decoration: none;
}
.markdown-body :deep(a:hover) {
  text-decoration: underline;
}
.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--arc-border);
  padding: 4px 8px;
  font-size: 12.5px;
}
.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--arc-border);
  margin: 12px 0;
}
.cursor {
  display: inline-block;
  animation: blink 1s steps(2) infinite;
  color: var(--arc-primary);
  margin-left: 2px;
}
@keyframes blink {
  50% { opacity: 0; }
}
@keyframes pulse {
  50% { opacity: 0.35; }
}
.command-block {
  display: block;
}
.command-summary {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 13px;
  line-height: 1.45;
  list-style: none;
  user-select: none;
}
.command-summary::-webkit-details-marker,
.command-preview summary::-webkit-details-marker {
  display: none;
}
.command-summary::marker,
.command-preview summary::marker {
  content: '';
}
.command-block[open] > .command-summary {
  color: var(--arc-text-secondary);
}
.summary-icon {
  flex: 0 0 auto;
  color: currentColor;
}
.command-details {
  margin: 10px 0 0 26px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.command-item {
  min-width: 0;
  color: var(--arc-text-secondary);
  font-size: 12.5px;
  line-height: 1.5;
}
.command-item-head {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.command-state {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--arc-text-hint);
  transform: translateY(-1px);
}
.command-item.ok .command-state {
  background: var(--arc-primary);
}
.command-item.error .command-state {
  background: var(--v2-danger);
}
.command-item.running .command-state {
  background: var(--v2-warn);
  animation: pulse 1.4s ease-in-out infinite;
}
.command-title {
  min-width: 0;
  overflow: hidden;
  color: var(--arc-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command-meta {
  color: var(--arc-text-hint);
  font-family: var(--v2-mono);
  font-size: 11px;
  white-space: nowrap;
}
.tool-open {
  border: 0;
  background: transparent;
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.tool-open:hover,
.resume-btn:hover {
  text-decoration: underline;
}
.command-preview {
  margin: 6px 0 0 16px;
}
.command-preview summary {
  width: fit-content;
  color: var(--arc-text-hint);
  cursor: pointer;
  font-size: 12px;
  list-style: none;
}
.command-preview pre {
  margin: 7px 0 0;
  max-height: 220px;
  overflow: auto;
  padding: 8px 10px;
  border-left: 2px solid var(--arc-border);
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-family: var(--v2-mono);
  font-size: 11.5px;
  line-height: 1.62;
  white-space: pre-wrap;
  word-break: break-word;
}
.error-block {
  padding-left: 10px;
  border-left: 2px solid var(--v2-danger);
  font-size: 13px;
}
.error-title {
  color: var(--v2-danger);
  font-weight: 600;
  margin-bottom: 3px;
}
.error-body {
  color: var(--arc-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
.continue-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--arc-text-hint);
  font-size: 13px;
  line-height: 1.5;
}
.continue-copy {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.resume-btn {
  border: 0;
  background: transparent;
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 0;
}
.status-tag {
  color: var(--arc-text-hint);
  font-size: 12px;
}

@media (max-width: 720px) {
  .messages {
    padding: 18px 16px 14px;
    gap: 22px;
  }
  .turn-entry {
    gap: 14px;
    padding-top: 22px;
  }
  .user-content,
  .assistant-copy {
    font-size: 14px;
    line-height: 1.72;
  }
  .command-details {
    margin-left: 22px;
  }
  .command-item-head {
    grid-template-columns: 8px minmax(0, 1fr);
  }
  .command-title {
    white-space: normal;
  }
  .command-meta,
  .tool-open {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
