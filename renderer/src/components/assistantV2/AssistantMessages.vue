<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { AssistantMessageView, AssistantToolCallView } from '@/composables/useAssistant'

const MD_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th',
  'td', 'a', 'span', 'del', 'hr'
]
const MD_ALLOWED_ATTR = ['class', 'href', 'target', 'rel']

function renderMarkdown(content: string): string {
  const html = marked.parse(content || '', { async: false }) as string
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MD_ALLOWED_TAGS,
    ALLOWED_ATTR: MD_ALLOWED_ATTR
  })
}

const props = defineProps<{
  messages: AssistantMessageView[]
  isStreaming: boolean
}>()

const emit = defineEmits<{
  (e: 'open-knowledge', documentId?: string): void
}>()

const scrollRef = ref<HTMLDivElement | null>(null)

watch(
  () => props.messages.map((m) => m.assistantMessage + m.toolCalls.length + m.status).join('|'),
  async () => {
    await nextTick()
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  }
)

function groupToolCalls(calls: AssistantToolCallView[]): {
  label: string
  items: AssistantToolCallView[]
}[] {
  const groups: Record<string, AssistantToolCallView[]> = {}
  for (const c of calls) {
    const key = classify(c.toolName)
    if (!groups[key]) groups[key] = []
    groups[key].push(c)
  }
  const order: [string, string][] = [
    ['search', '搜索线索'],
    ['read', '读取资料'],
    ['stage', '产出暂存'],
    ['skill', '加载技能'],
    ['knowledge', '沉淀知识'],
    ['other', '其他动作']
  ]
  return order
    .filter(([k]) => groups[k])
    .map(([k, label]) => ({ label, items: groups[k] }))
}

function classify(name: string): string {
  if (name.startsWith('search_')) return 'search'
  if (name.startsWith('read_') || name.startsWith('list_')) return 'read'
  if (name.startsWith('stage_')) return 'stage'
  if (name.startsWith('skill_')) return 'skill'
  if (name.startsWith('knowledge_')) return 'knowledge'
  return 'other'
}

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

const hasContent = computed(() => props.messages.length > 0)
</script>

<template>
  <div ref="scrollRef" class="messages">
    <div v-if="!hasContent" class="empty">
      <div class="title">开始一段对话</div>
      <div class="hint">试试问："介绍项目里的第一个人物" 或"帮我优化第一章的开头"</div>
    </div>

    <div v-for="msg in props.messages" :key="msg.turnId" class="turn">
      <!-- 用户消息 -->
      <div class="msg user">
        <div class="avatar">你</div>
        <div class="body">
          <div class="content">{{ msg.userMessage }}</div>
        </div>
      </div>

      <!-- 助手消息 -->
      <div class="msg ai">
        <div class="avatar">AI</div>
        <div class="body">
          <!-- 工具调用日志 · 分组 + 人类可读描述 -->
          <div v-if="msg.toolCalls.length > 0" class="tools">
            <div v-for="group in groupToolCalls(msg.toolCalls)" :key="group.label" class="tool-group">
              <div class="tool-group-label">{{ group.label }}</div>
              <div v-for="t in group.items" :key="t.toolUseId" class="tool-row" :class="t.status">
                <span class="tool-dot" />
                <span class="tool-action">{{ describeToolAction(t) }}</span>
                <span v-if="t.status === 'ok' && t.resultPreview" class="tool-result">{{ short(t.resultPreview, 80) }}</span>
                <span v-else-if="t.status === 'error'" class="tool-result err">{{ short(t.resultPreview, 80) }}</span>
                <span v-else-if="t.status === 'running'" class="tool-result running">进行中</span>
                <button
                  v-if="canOpenKnowledge(t)"
                  type="button"
                  class="tool-open"
                  @click="emit('open-knowledge', knowledgeDocumentId(t))"
                >
                  打开
                </button>
              </div>
            </div>
          </div>

          <!-- 推理内容（可选） -->
          <details v-if="msg.reasoning" class="reasoning">
            <summary>思考过程</summary>
            <div class="reasoning-body">{{ msg.reasoning }}</div>
          </details>

          <!-- 主体回复 · markdown 渲染 -->
          <div v-if="msg.assistantMessage" class="content markdown-body">
            <span v-html="renderMarkdown(msg.assistantMessage)" />
            <span v-if="msg.status === 'streaming'" class="cursor">▍</span>
          </div>

          <!-- 错误 -->
          <div v-if="msg.error" class="error-block">
            <div class="error-title">出错了</div>
            <div class="error-body">{{ msg.error }}</div>
          </div>

          <!-- 状态标签 -->
          <div v-if="msg.status === 'canceled'" class="status-tag">已取消</div>
        </div>
      </div>
    </div>

    <div v-if="props.isStreaming && props.messages[props.messages.length - 1]?.assistantMessage === ''" class="hint-line">
      正在思考…
    </div>
  </div>
</template>

<style scoped>
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px 12px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-width: 0;
  min-height: 0;
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
.turn {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.msg {
  display: flex;
  gap: 12px;
  min-width: 0;
}
.avatar {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}
.msg.user .avatar {
  background: var(--arc-text-primary);
  color: var(--arc-bg-body);
}
.msg.ai .avatar {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
}
.body {
  flex: 1;
  min-width: 0;
}
.content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--arc-text-primary);
  word-break: break-word;
}
.msg.user .content {
  white-space: pre-wrap;
}
.markdown-body :deep(p) { margin: 0 0 8px; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  font-weight: 600;
  margin: 12px 0 6px;
  color: var(--arc-text-primary);
}
.markdown-body :deep(h1) { font-size: 17px; }
.markdown-body :deep(h2) { font-size: 15.5px; }
.markdown-body :deep(h3) { font-size: 14px; }
.markdown-body :deep(ul),
.markdown-body :deep(ol) { margin: 4px 0 8px; padding-left: 22px; }
.markdown-body :deep(li) { margin: 2px 0; }
.markdown-body :deep(code) {
  font-family: monospace;
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
  margin: 6px 0;
}
.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 12.5px;
}
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--arc-border-strong);
  padding: 2px 0 2px 10px;
  color: var(--arc-text-secondary);
  margin: 6px 0;
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
  margin: 6px 0;
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
  margin: 10px 0;
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
.tools {
  margin: 4px 0 10px;
  padding: 4px 0 4px 12px;
  border-left: 1px solid var(--arc-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tool-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.tool-group-label {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--arc-text-hint);
  margin-bottom: 3px;
  font-family: var(--v2-mono);
}
.tool-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  padding: 3px 0;
  color: var(--arc-text-secondary);
  line-height: 1.5;
}
.tool-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--arc-text-hint);
  flex: 0 0 6px;
  transform: translateY(3px);
}
.tool-row.ok .tool-dot { background: var(--arc-primary); }
.tool-row.error .tool-dot { background: var(--v2-danger); }
.tool-row.running .tool-dot { background: var(--v2-warn); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }
.tool-action {
  color: var(--arc-text-primary);
  flex-shrink: 0;
}
.tool-result {
  color: var(--arc-text-hint);
  font-size: 11.5px;
  font-family: var(--v2-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.tool-result.err { color: var(--v2-danger); }
.tool-result.running { color: var(--v2-warn); }
.tool-open {
  flex: 0 0 auto;
  border: 1px solid var(--arc-border);
  border-radius: 6px;
  background: var(--arc-bg-surface);
  color: var(--arc-primary);
  cursor: pointer;
  font-size: 11px;
  padding: 1px 6px;
}
.tool-open:hover {
  border-color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.reasoning {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--arc-text-hint);
}
.reasoning summary {
  cursor: pointer;
  padding: 4px 0;
}
.reasoning-body {
  padding: 8px 10px;
  background: var(--arc-bg-weak);
  border-radius: 6px;
  white-space: pre-wrap;
  color: var(--arc-text-secondary);
}
.error-block {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(185, 28, 28, 0.06);
  border: 1px solid rgba(185, 28, 28, 0.2);
  font-size: 12.5px;
}
.error-title {
  color: #b91c1c;
  font-weight: 600;
  margin-bottom: 3px;
}
.error-body {
  color: var(--arc-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
.status-tag {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-hint);
}
.hint-line {
  color: var(--arc-text-hint);
  font-size: 12px;
  padding: 4px 40px;
  font-family: monospace;
}
</style>
