import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { buildChapterAssistantContext } from '@/features/ai/chapterAssistantContext'
import { getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { ChapterInsertionMode } from '@/types/app'

export type ChapterAiRole = 'user' | 'assistant'

export type ChapterAiToolCall = {
  toolUseId: string
  toolName: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: string
  isError?: boolean
  durationMs?: number
}

export type ChapterAiEditEvent = {
  chapterId: string
  editType: string
  preview: string
  versionId: string
}

export interface ChapterAiMessage {
  id: string
  role: ChapterAiRole
  content: string
  createdAt: number
  chapterId?: string
  toolCalls?: ChapterAiToolCall[]
  editEvents?: ChapterAiEditEvent[]
}

const TASK_KEY = 'chapter-workspace-chat'

let messageSeq = 0
function nextMessageId(): string {
  messageSeq += 1
  return `cwm-${Date.now().toString(36)}-${messageSeq}`
}

function providerSupportsTools(provider: string): boolean {
  if (provider === 'anthropic') return true
  if (provider === 'deepseek') return false
  if (provider === 'ollama') return false
  return true
}

export function useChapterAi(): {
  messages: Ref<ChapterAiMessage[]>
  isResponding: Ref<boolean>
  agentStatus: Ref<string>
  hasSelection: Ref<boolean>
  selectedText: Ref<string>
  send: (prompt: string) => Promise<void>
  stop: () => Promise<void>
  resetMessages: () => void
  applyToChapter: (content: string, mode: ChapterInsertionMode) => boolean
  registerStreamListener: () => void
  unregisterStreamListener: () => void
} {
  const appStore = useAppStore()
  const messages = ref<ChapterAiMessage[]>([])
  const isResponding = computed(() => appStore.isAiTaskRunning(TASK_KEY))
  const agentStatus = ref('')

  const selectedText = computed(() => appStore.currentChapterSelection?.text.trim() ?? '')
  const hasSelection = computed(() =>
    Boolean(
      appStore.currentChapterSelection?.chapterId === appStore.selectedChapter?.id
      && selectedText.value
    )
  )

  let streamId: string | null = null
  let resolveStream: ((text: string) => void) | null = null
  let rejectStream: ((err: Error) => void) | null = null
  let removeListener: (() => void) | null = null
  let streamingMsgId: string | null = null

  function finalizeStreamingMsg(): void {
    const msg = messages.value.find((m) => m.id === streamingMsgId)
    if (!msg?.toolCalls) return
    for (const tc of msg.toolCalls) {
      if (tc.status === 'running') {
        tc.status = 'error'
        tc.result = '（连接中断）'
        tc.isError = true
      }
    }
  }

  function handleStreamEvent(payload: CharacterArcAiStreamEvent): void {
    if (payload.streamId !== streamId) return

    if (payload.type === 'chunk') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (msg) msg.content += payload.delta
      return
    }
    if (payload.type === 'tool_use_start') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (msg) {
        if (!msg.toolCalls) msg.toolCalls = []
        msg.toolCalls.push({
          toolUseId: payload.toolUseId,
          toolName: payload.toolName,
          args: payload.args,
          status: 'running'
        })
      }
      return
    }
    if (payload.type === 'tool_result') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      const tc = msg?.toolCalls?.find((t) => t.toolUseId === payload.toolUseId)
      if (tc) {
        tc.status = payload.isError ? 'error' : 'done'
        tc.result = payload.content
        tc.isError = payload.isError
        tc.durationMs = payload.durationMs
      }
      return
    }
    if (payload.type === 'edit_applied') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (msg) {
        if (!msg.editEvents) msg.editEvents = []
        msg.editEvents.push({
          chapterId: payload.chapterId,
          editType: payload.editType,
          preview: payload.preview,
          versionId: payload.versionId
        })
      }
      void appStore.reloadChapterFromDb(payload.chapterId)
      return
    }
    if (payload.type === 'agent_status') {
      agentStatus.value = payload.message
      return
    }
    if (payload.type === 'done') {
      finalizeStreamingMsg()
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (msg && payload.content && !msg.content) msg.content = payload.content
      const resolve = resolveStream
      resolveStream = null
      rejectStream = null
      streamId = null
      streamingMsgId = null
      agentStatus.value = ''
      resolve?.(msg?.content ?? '')
      return
    }
    if (payload.type === 'canceled') {
      finalizeStreamingMsg()
      const reject = rejectStream
      resolveStream = null
      rejectStream = null
      streamId = null
      streamingMsgId = null
      agentStatus.value = ''
      reject?.(new Error('canceled'))
      return
    }
    if (payload.type === 'error') {
      finalizeStreamingMsg()
      const reject = rejectStream
      resolveStream = null
      rejectStream = null
      streamId = null
      streamingMsgId = null
      agentStatus.value = ''
      reject?.(new Error(payload.error || 'AI 对话生成失败'))
    }
  }

  function registerStreamListener(): void {
    if (removeListener) return
    removeListener = window.characterArc.onAiStreamEvent(handleStreamEvent)
  }

  function unregisterStreamListener(): void {
    removeListener?.()
    removeListener = null
  }

  function pushMessage(role: ChapterAiRole, content: string): ChapterAiMessage {
    const item: ChapterAiMessage = {
      id: nextMessageId(),
      role,
      content,
      createdAt: Date.now(),
      chapterId: appStore.selectedChapter?.id
    }
    messages.value.push(item)
    return item
  }

  async function send(prompt: string): Promise<void> {
    const trimmed = prompt.trim()
    if (!trimmed) return
    if (isResponding.value) return

    const chapter = appStore.selectedChapter
    if (!chapter) {
      pushMessage('assistant', '请先在左侧选择或新建一个章节，再使用 AI 助手。')
      return
    }

    pushMessage('user', trimmed)
    const assistantMsg = pushMessage('assistant', '')
    streamingMsgId = assistantMsg.id

    const useAgentMode = providerSupportsTools(appStore.appSettings.provider)

    try {
      await appStore.runTrackedAiTask(
        {
          key: TASK_KEY,
          kind: 'chapter-assistant',
          label: 'AI 章节助手',
          description: '与创作助理对话',
          panel: 'chapters',
          timeoutMs: 0
        },
        async () => {
          const sameVolume = appStore.chapters.filter((item) => item.volumeId === chapter.volumeId)
          const context = buildChapterAssistantContext({
            project: appStore.currentProject,
            chapter,
            chapterVolume: appStore.selectedChapterVolume,
            relatedChapters: sameVolume
              .filter((item) => item.id !== chapter.id)
              .slice(0, 2)
              .map((item) => ({
                title: item.title,
                summary: item.summary,
                preview: getChapterPreviewText(item.content, '该章节暂无正文')
              })),
            volumeChapterSummaries: sameVolume
              .filter((item) => item.id !== chapter.id)
              .map((item) => ({ title: item.title, summary: item.summary })),
            novelOpenerSummary:
              appStore.chapters[0] && appStore.chapters[0].id !== chapter.id
                ? { title: appStore.chapters[0].title, summary: appStore.chapters[0].summary }
                : undefined,
            recentMessages: messages.value
              .slice(-8, -2)
              .map((item) => ({ role: item.role, content: item.content })),
            worldviewEntries: appStore.worldviewEntries,
            characters: appStore.characters,
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            inspirationEntries: appStore.inspirationEntries,
            outlineItems: appStore.outlineItems,
            plotThreads: appStore.plotThreads,
            workflowDocuments: appStore.workflowDocuments,
            knowledgeDocuments: appStore.knowledgeDocuments,
            selectedText: selectedText.value,
            responseMode: 'freeform',
            responseLength: 'medium',
            userPrompt: trimmed,
            chapterContent: getPlainTextFromEditorContent(chapter.content ?? '')
          })

          const startFn = useAgentMode
            ? window.characterArc.startAiAgentStream
            : window.characterArc.startAiStream

          const result = await startFn(toIpcPayload({
            task: 'chapter-assistant',
            settings: appStore.appSettings,
            context: { ...context, chapterId: chapter.id }
          }))

          const sid = (result.result as { streamId?: string } | undefined)?.streamId
          if (!result.success || !sid) {
            throw new Error(result.error ?? 'AI 对话启动失败')
          }
          streamId = sid

          return new Promise<string>((resolve, reject) => {
            resolveStream = resolve
            rejectStream = reject
          })
        }
      )

      if (!assistantMsg.content.trim() && !assistantMsg.toolCalls?.length && !assistantMsg.editEvents?.length) {
        assistantMsg.content = '（AI 未返回内容）'
      }
    } catch (error) {
      const isCanceled = error instanceof Error && error.message === 'canceled'
      if (isCanceled) {
        if (!assistantMsg.content.trim()) {
          assistantMsg.content = '（已取消）'
        }
      } else {
        assistantMsg.content = `生成失败：${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  async function stop(): Promise<void> {
    if (!streamId) return
    await window.characterArc.stopAiStream(streamId)
  }

  function resetMessages(): void {
    messages.value = []
  }

  function applyToChapter(content: string, mode: ChapterInsertionMode): boolean {
    return appStore.insertIntoChapter(content, mode)
  }

  return {
    messages,
    isResponding,
    agentStatus,
    hasSelection,
    selectedText,
    send,
    stop,
    resetMessages,
    applyToChapter,
    registerStreamListener,
    unregisterStreamListener
  }
}
