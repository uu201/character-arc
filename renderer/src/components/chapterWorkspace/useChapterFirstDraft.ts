import { ref } from 'vue'
import type { Ref } from 'vue'
import { buildChapterFirstDraftContext, type ChapterFirstDraftContextInput } from '@/features/ai/chapterAssistantContext'
import {
  ensureEditorHtmlContent,
  getChapterPreviewText,
  getPlainTextFromEditorContent
} from '@/features/chapters/editorContent'
import { formatChapterWordTargetLabel, parseChapterWordTarget } from '@/features/chapters/wordTarget'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const TASK_KEY = 'chapter-first-draft'

export type ChapterAuditPayload = {
  pass: boolean
  wordCount: number
  issues: Array<{
    severity: 'critical' | 'warning' | 'hint'
    category: string
    ref: string
    hint: string
  }>
}

type StreamTaskName = 'chapter-first-draft' | 'chapter-memo' | 'chapter-audit'

type StreamTaskResult = {
  text: string
  result?: unknown
}

export function useChapterFirstDraft(): {
  isGenerating: Ref<boolean>
  isStopping: Ref<boolean>
  modalVisible: Ref<boolean>
  streamingContent: Ref<string>
  streamingCharCount: Ref<number>
  executionLabel: Ref<string>
  previewTitle: Ref<string>
  previewContent: Ref<string>
  progressPercent: Ref<number>
  progressText: Ref<string>
  auditResult: Ref<ChapterAuditPayload | null>
  isAuditing: Ref<boolean>
  elapsedSeconds: Ref<number>
  isStreaming: Ref<boolean>
  start: () => Promise<void>
  stop: () => Promise<void>
  closeModal: () => void
  registerStreamListener: () => void
  unregisterStreamListener: () => void
} {
  const appStore = useAppStore()

  const isGenerating = ref(false)
  const isStopping = ref(false)
  const modalVisible = ref(false)
  const streamingContent = ref('')
  const streamingCharCount = ref(0)
  const executionLabel = ref('')
  const previewTitle = ref('')
  const previewContent = ref('')

  const streamId = ref<string | null>(null)
  const currentStreamTask = ref<StreamTaskName | null>(null)
  let resolveStream: ((result: StreamTaskResult) => void) | null = null
  let rejectStream: ((err: Error) => void) | null = null
  let removeListener: (() => void) | null = null

  const progressPercent = ref(0)
  const progressText = ref('')

  const auditResult = ref<ChapterAuditPayload | null>(null)
  const isAuditing = ref(false)

  const elapsedSeconds = ref(0)
  const isStreaming = ref(false)
  let elapsedTimer: ReturnType<typeof setInterval> | null = null

  function startElapsedTimer(): void {
    elapsedSeconds.value = 0
    elapsedTimer = setInterval(() => { elapsedSeconds.value++ }, 1000)
  }

  function stopElapsedTimer(): void {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null }
  }

  function recompute(): void {
    const target = Math.max(parseChapterWordTarget(appStore.selectedChapter?.wordTarget), 1)
    const words = streamingCharCount.value || streamingContent.value.trim().length
    if (!isGenerating.value) {
      progressPercent.value = 0
      progressText.value = ''
      return
    }
    if (currentStreamTask.value === 'chapter-memo') {
      progressPercent.value = previewContent.value.trim() ? 14 : 10
      progressText.value = '正在流式生成本章写作备忘...'
      return
    }
    if (currentStreamTask.value === 'chapter-audit') {
      progressPercent.value = previewContent.value.trim() ? 98 : 96
      progressText.value = '正在流式审计本章质量...'
      return
    }
    if (!words) {
      progressPercent.value = 12
      progressText.value = '正在整理大纲、文风和角色关系上下文...'
      return
    }
    const estimated = Math.round((words / target) * 100)
    progressPercent.value = Math.min(95, Math.max(18, estimated))
    progressText.value = `已生成 ${words} 字 / 目标 ${formatChapterWordTargetLabel(target)}（${progressPercent.value}%）`
  }

  function reset(finalLabel = ''): void {
    streamId.value = null
    currentStreamTask.value = null
    resolveStream = null
    rejectStream = null
    streamingCharCount.value = 0
    executionLabel.value = finalLabel
    isStopping.value = false
    isGenerating.value = false
    isAuditing.value = false
    isStreaming.value = false
    stopElapsedTimer()
    recompute()
  }

  function releaseCurrentStreamState(): void {
    streamId.value = null
    resolveStream = null
    rejectStream = null
    isStopping.value = false
    isStreaming.value = false
  }

  function isAlreadyStoppedStreamError(message: string): boolean {
    return message.includes('当前没有可停止的生成任务')
  }

  function getActiveStreamBuffer(): string {
    if (currentStreamTask.value === 'chapter-first-draft') {
      return streamingContent.value
    }
    return previewContent.value
  }

  function shouldRenderStreamPreview(task: StreamTaskName | null): boolean {
    return task === 'chapter-first-draft' || task === 'chapter-memo'
  }

  function getActiveTaskErrorMessage(): string {
    if (currentStreamTask.value === 'chapter-memo') return 'AI 写作备忘生成失败'
    if (currentStreamTask.value === 'chapter-audit') return 'AI 章节审计失败'
    return 'AI 初稿生成失败'
  }

  function handleStreamEvent(payload: CharacterArcAiStreamEvent): void {
    if (payload.streamId !== streamId.value) return

    if (payload.type === 'agent_status') {
      executionLabel.value = (payload as { message?: string }).message ?? '正在分析写作技巧...'
      return
    }
    if (payload.type === 'tool_use_start') {
      const args = (payload as { toolName?: string; args?: Record<string, unknown> })
      if (args.toolName === 'skill_load') {
        executionLabel.value = `加载写作技巧：${String(args.args?.skill_id ?? '')}...`
      } else if (args.toolName === 'skill_read_reference') {
        executionLabel.value = `读取参考资料：${String(args.args?.file ?? '')}...`
      }
      return
    }
    if (payload.type === 'tool_result') {
      executionLabel.value = '技巧就绪，准备写作...'
      return
    }

    if (payload.type === 'chunk') {
      isStreaming.value = true
      if (currentStreamTask.value === 'chapter-first-draft') {
        streamingContent.value += payload.delta
        previewContent.value = streamingContent.value
        if (payload.charCount != null) streamingCharCount.value = payload.charCount
      } else if (shouldRenderStreamPreview(currentStreamTask.value)) {
        previewContent.value += payload.delta
      }
      recompute()
      return
    }
    if (payload.type === 'done') {
      const text = (payload.content?.trim() ? payload.content : getActiveStreamBuffer()).trim()
      const resolve = resolveStream
      releaseCurrentStreamState()
      resolve?.({ text, result: payload.result })
      return
    }
    if (payload.type === 'canceled') {
      const reject = rejectStream
      releaseCurrentStreamState()
      reject?.(new Error('canceled'))
      return
    }
    if (payload.type === 'error') {
      const reject = rejectStream
      releaseCurrentStreamState()
      reject?.(new Error(payload.error || getActiveTaskErrorMessage()))
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

  async function streamTask(task: StreamTaskName, context: Record<string, unknown>): Promise<StreamTaskResult> {
    currentStreamTask.value = task
    if (task === 'chapter-first-draft') {
      streamingContent.value = ''
      streamingCharCount.value = 0
      previewTitle.value = '章节初稿实时输出'
      previewContent.value = ''
    } else if (task === 'chapter-memo') {
      previewTitle.value = '写作备忘实时输出'
      previewContent.value = ''
    } else {
      previewTitle.value = '章节审计进行中'
      previewContent.value = ''
    }

    const result = await window.characterArc.startAiStream(toIpcPayload({
      task,
      settings: appStore.appSettings,
      context
    }))

    const sid = (result.result as { streamId?: string } | undefined)?.streamId
    if (!result.success || !sid) {
      throw new Error(result.error ?? getActiveTaskErrorMessage())
    }
    streamId.value = sid

    return new Promise<StreamTaskResult>((resolve, reject) => {
      resolveStream = resolve
      rejectStream = reject
    })
  }

  async function start(): Promise<void> {
    const chapter = appStore.selectedChapter
    const project = appStore.currentProject
    const chapterVolume = appStore.selectedChapterVolume
    if (!chapter || !project || !chapterVolume) return
    if (isGenerating.value) return

    registerStreamListener()
    isGenerating.value = true
    isStopping.value = false
    isStreaming.value = false
    streamingContent.value = ''
    auditResult.value = null
    executionLabel.value = '加载角色与关系数据'
    previewTitle.value = ''
    previewContent.value = ''
    modalVisible.value = true
    startElapsedTimer()
    recompute()
    let finalLabel = '本次 AI 初稿流程已完成'

    try {
      await appStore.runTrackedAiTask(
        {
          key: TASK_KEY,
          kind: 'chapter-draft',
          label: 'AI 生成章节初稿',
          description: `正在生成《${chapter.title}》初稿`,
          panel: 'chapters',
          timeoutMs: 0,
          onCancel: () => { void stop() }
        },
        async () => {
          const targetWordCount = parseChapterWordTarget(chapter.wordTarget)
          const currentChapterIndex = appStore.chapters.findIndex((item) => item.id === chapter.id)
          const precedingChapters = appStore.chapters.slice(0, currentChapterIndex)
          const relatedChapters = precedingChapters
            .slice(-4)
            .map((item) => ({
              title: item.title,
              summary: item.summary,
              preview: getChapterPreviewText(item.content ?? '').slice(0, 800)
            }))
          const relatedTitles = new Set(relatedChapters.map((r) => r.title))
          const volumeChapterSummaries = precedingChapters
            .filter((c) => c.volumeId === chapter.volumeId && !relatedTitles.has(c.title))
            .map((c) => ({ title: c.title, summary: c.summary }))
          const firstChapter = appStore.chapters[0]
          const novelOpenerSummary =
            firstChapter && firstChapter.id !== chapter.id && !relatedTitles.has(firstChapter.title)
              ? { title: firstChapter.title, summary: firstChapter.summary }
              : undefined

          const recentEndingsTrail = precedingChapters
            .filter((c) => Boolean(c.content?.trim()))
            .slice(-3)
            .map((c) => {
              const plain = getPlainTextFromEditorContent(c.content ?? '').trim()
              const lastLine = plain.split('\n').map((s) => s.trim()).filter(Boolean).at(-1) ?? ''
              return {
                chapterTitle: c.title,
                endingLine: lastLine.length > 80 ? lastLine.slice(0, 77) + '...' : lastLine
              }
            })
            .filter((entry) => entry.endingLine)

          const volumeOutlineItems = appStore.outlineItems.filter((item) => item.volumeId === chapter.volumeId)
          const currentOutlineItem = chapter.outlineItemId
            ? volumeOutlineItems.find((item) => item.id === chapter.outlineItemId)
            : volumeOutlineItems.find((item) => item.title.trim() === chapter.title.trim())
          const currentChapterOutlineIndex = currentOutlineItem
            ? volumeOutlineItems.findIndex((item) => item.id === currentOutlineItem.id)
            : -1
          const outlineItemsForCurrentChapter = currentChapterOutlineIndex >= 0
            ? volumeOutlineItems.slice(Math.max(0, currentChapterOutlineIndex - 3), currentChapterOutlineIndex + 1)
            : volumeOutlineItems.slice(0, 6)
          const sameOutlineChapters = currentOutlineItem
            ? appStore.chapters.filter((c) =>
                c.outlineItemId === currentOutlineItem.id
                || (!c.outlineItemId && c.volumeId === currentOutlineItem.volumeId && c.title.trim() === currentOutlineItem.title.trim())
              )
            : []
          const currentOutlineChapterIndex = sameOutlineChapters.findIndex((c) => c.id === chapter.id)
          const previousSameOutlineChapters = currentOutlineChapterIndex >= 0
            ? sameOutlineChapters.slice(0, currentOutlineChapterIndex)
            : []
          const outlineChapterSplit = currentOutlineItem
            ? {
                currentPart: currentOutlineChapterIndex >= 0 ? currentOutlineChapterIndex + 1 : 1,
                totalParts: Math.max(sameOutlineChapters.length, 1),
                previousParts: previousSameOutlineChapters.map((c) => ({
                  title: c.title,
                  summary: c.summary,
                  preview: getChapterPreviewText(c.content ?? '').slice(0, 220)
                }))
              }
            : null

          const memoBaseContext: Record<string, unknown> = {
            projectId: project.id,
            projectGenre: project.genre,
            chapterTitle: chapter.title,
            chapterSummary: chapter.summary,
            chapterVolumeTitle: chapterVolume.title,
            chapterVolumeSummary: chapterVolume.summary,
            chapterWordTarget: chapter.wordTarget,
            targetWordCount,
            relatedChapters,
            volumeChapterSummaries,
            plotThreads: appStore.plotThreads
              .filter((t) => t.status === 'open')
              .map((t) => ({ title: t.title, description: t.description, status: t.status })),
            worldviewEntries: appStore.worldviewEntries.map((e) => ({ title: e.title, content: e.content })),
            characters: appStore.characters.map((c) => ({ name: c.name, role: c.role, description: c.description })),
            characterRelationships: appStore.characterRelationships.map((r) => ({
              fromCharacterId: r.fromCharacterId,
              toCharacterId: r.toCharacterId,
              type: r.type,
              description: r.description,
              intensity: r.intensity
            })),
            currentOutlineItem: currentOutlineItem
              ? {
                  title: currentOutlineItem.title,
                  wordTarget: currentOutlineItem.wordTarget,
                  conflict: currentOutlineItem.conflict,
                  summary: currentOutlineItem.summary
                }
              : null,
            outlineChapterSplit,
            outlineItems: outlineItemsForCurrentChapter
              .map((item) => ({
                title: item.title,
                conflict: item.conflict,
                summary: item.summary,
                isCurrent: currentOutlineItem ? item.id === currentOutlineItem.id : false
              }))
          }

          executionLabel.value = '检索相关章节与情节线索'
          recompute()
          await new Promise((r) => setTimeout(r, 0))
          executionLabel.value = '正在流式生成写作备忘...'
          let chapterMemo: ChapterFirstDraftContextInput['chapterMemo'] | undefined
          try {
            const memoStream = await streamTask('chapter-memo', memoBaseContext)
            const memoResult = memoStream.result as { memo?: ChapterFirstDraftContextInput['chapterMemo'] } | undefined
            if (memoResult?.memo) {
              chapterMemo = memoResult.memo
            }
          } catch {
            // memo 步骤失败不阻塞主流程，回退到无 memo 的写作
          }

          const context = buildChapterFirstDraftContext({
            project,
            chapter,
            chapterVolume,
            relatedChapters,
            volumeChapterSummaries,
            novelOpenerSummary,
            worldviewEntries: appStore.worldviewEntries,
            characters: appStore.characters,
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            inspirationEntries: appStore.inspirationEntries,
            currentOutlineItem,
            outlineChapterSplit,
            outlineItems: outlineItemsForCurrentChapter,
            plotThreads: appStore.plotThreads,
            knowledgeDocuments: appStore.projectConstraints,
            chapterContent: '',
            targetWordCount,
            userPrompt: `请生成这一章的完整初稿，目标字数约 ${targetWordCount} 字（参考值，优先保证情节自然完整）。如果当前正文为空，就从零起稿；如果当前正文不为空，也按整章重写处理，而不是续写。`,
            projectSkills: await loadEnabledProjectSkillsContext(project, 'draft'),
            chapterMemo,
            recentEndingsTrail
          })

          executionLabel.value = '构建写作提示词…'
          recompute()
          await new Promise((r) => setTimeout(r, 0))

          executionLabel.value = `正在生成本章初稿（目标约 ${targetWordCount} 字）…`
          isStreaming.value = true
          recompute()
          const draftStream = await streamTask('chapter-first-draft', context)
          const fullText = draftStream.text
          if (fullText) {
            executionLabel.value = '正在覆盖当前章节'
            appStore.updateChapterContent(ensureEditorHtmlContent(fullText))

            if (chapterMemo) {
              executionLabel.value = '正在流式审计章节质量...'
              isAuditing.value = true
              try {
                const auditStream = await streamTask('chapter-audit', {
                  projectId: project.id,
                  chapterId: chapter.id,
                  chapterTitle: chapter.title,
                  targetWordCount,
                  draftText: fullText,
                  chapterMemo,
                  chapterExecutionPacket: context.chapterExecutionPacket
                })
                const auditResp = auditStream.result as { audit?: ChapterAuditPayload } | undefined
                if (auditResp?.audit) {
                  auditResult.value = auditResp.audit
                }
              } catch {
                // audit 步骤失败不影响章节落盘
              } finally {
                isAuditing.value = false
              }
            }
          }
        }
      )
    } catch (error) {
      const isCanceled = error instanceof Error && error.message === 'canceled'
      if (isCanceled) {
        finalLabel = '本次 AI 初稿流程已停止'
        return
      }
      finalLabel = '本次 AI 初稿流程失败'
      throw error
    } finally {
      reset(finalLabel)
    }
  }

  async function stop(): Promise<void> {
    if (!streamId.value || isStopping.value) return
    isStopping.value = true
    const result = await window.characterArc.stopAiStream(streamId.value)
    if (!result.success) {
      if (isAlreadyStoppedStreamError(result.error ?? '')) {
        releaseCurrentStreamState()
        return
      }
      isStopping.value = false
      throw new Error(result.error ?? '停止 AI 初稿失败')
    }
  }

  function closeModal(): void {
    if (isGenerating.value) return
    modalVisible.value = false
    streamingContent.value = ''
    previewTitle.value = ''
    previewContent.value = ''
  }

  return {
    isGenerating,
    isStopping,
    modalVisible,
    streamingContent,
    streamingCharCount,
    executionLabel,
    previewTitle,
    previewContent,
    progressPercent,
    progressText,
    auditResult,
    isAuditing,
    elapsedSeconds,
    isStreaming,
    start,
    stop,
    closeModal,
    registerStreamListener,
    unregisterStreamListener
  }
}
