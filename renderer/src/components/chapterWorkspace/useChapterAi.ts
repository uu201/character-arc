import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { buildChapterAssistantContext } from '@/features/ai/chapterAssistantContext'
import { getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { ChapterInsertionMode } from '@/types/app'

export type ChapterAiRole = 'user' | 'assistant'

export interface ChapterAiMessage {
  id: string
  role: ChapterAiRole
  content: string
  createdAt: number
  chapterId?: string
}

const TASK_KEY = 'chapter-workspace-chat'

let messageSeq = 0
function nextMessageId(): string {
  messageSeq += 1
  return `cwm-${Date.now().toString(36)}-${messageSeq}`
}

export function useChapterAi(): {
  messages: Ref<ChapterAiMessage[]>
  isResponding: Ref<boolean>
  hasSelection: Ref<boolean>
  selectedText: Ref<string>
  send: (prompt: string) => Promise<void>
  resetMessages: () => void
  applyToChapter: (content: string, mode: ChapterInsertionMode) => boolean
  registerStreamListener: () => void
  unregisterStreamListener: () => void
} {
  const appStore = useAppStore()
  const messages = ref<ChapterAiMessage[]>([])
  const isResponding = computed(() => appStore.isAiTaskRunning(TASK_KEY))

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

  function handleStreamEvent(payload: CharacterArcAiStreamEvent): void {
    if (payload.streamId !== streamId) return

    if (payload.type === 'chunk') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (msg) msg.content += payload.delta
      return
    }
    if (payload.type === 'done') {
      const msg = messages.value.find((m) => m.id === streamingMsgId)
      if (msg && payload.content) msg.content = payload.content
      const resolve = resolveStream
      resolveStream = null
      rejectStream = null
      streamId = null
      streamingMsgId = null
      resolve?.(msg?.content ?? '')
      return
    }
    if (payload.type === 'canceled') {
      const reject = rejectStream
      resolveStream = null
      rejectStream = null
      streamId = null
      streamingMsgId = null
      reject?.(new Error('canceled'))
      return
    }
    if (payload.type === 'error') {
      const reject = rejectStream
      resolveStream = null
      rejectStream = null
      streamId = null
      streamingMsgId = null
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

          const result = await window.characterArc.startAiStream(toIpcPayload({
            task: 'chapter-assistant',
            settings: appStore.appSettings,
            context
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

      if (!assistantMsg.content.trim()) {
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

  function resetMessages(): void {
    messages.value = []
  }

  function applyToChapter(content: string, mode: ChapterInsertionMode): boolean {
    return appStore.insertIntoChapter(content, mode)
  }

  return {
    messages,
    isResponding,
    hasSelection,
    selectedText,
    send,
    resetMessages,
    applyToChapter,
    registerStreamListener,
    unregisterStreamListener
  }
}
