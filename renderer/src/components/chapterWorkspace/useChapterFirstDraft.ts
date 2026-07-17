import { ref } from 'vue'
import type { Ref } from 'vue'
import { buildChapterFirstDraftContext, type ChapterFirstDraftContextInput } from '@/features/ai/chapterAssistantContext'
import {
  ensureEditorHtmlContent,
  getChapterPreviewText,
  getPlainTextFromEditorContent
} from '@/features/chapters/editorContent'
import { formatChapterWordTargetLabel, parseChapterWordTarget } from '@/features/chapters/wordTarget'
import { loadProjectSkillsContextByIds } from '@/features/projectSkills/context'
import { useAppStore } from '@/stores/app'
import type { ReferenceStyleAnalysis } from '@/types/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const TASK_KEY = 'chapter-first-draft'

export type FirstDraftStepId = 'memo' | 'draft' | 'audit' | 'repair' | 'humanize' | 'session-note'
export type FirstDraftFailurePolicy = 'skip' | 'stop'
export type FirstDraftSkillMode = 'auto' | 'manual'

export type FirstDraftStepConfig = {
  id: FirstDraftStepId
  enabled: boolean
  skillMode: FirstDraftSkillMode
  skillIds: string[]
  userPrompt: string
  failurePolicy: FirstDraftFailurePolicy
}

export type FirstDraftConfig = {
  targetWordCount: number
  selectedReferenceWorkIds: string[]
  userPrompt: string
  steps: Record<FirstDraftStepId, FirstDraftStepConfig>
}

export const FIRST_DRAFT_STEP_DEFINITIONS: Array<{
  id: FirstDraftStepId
  label: string
  description: string
  required?: boolean
  defaultEnabled: boolean
  defaultFailurePolicy: FirstDraftFailurePolicy
}> = [
  { id: 'memo', label: '写作备忘', description: '先规划本章硬契约，供正文生成和审计使用。', defaultEnabled: true, defaultFailurePolicy: 'skip' },
  { id: 'draft', label: '生成初稿', description: '基于章节摘要、设定、参考作品和写作备忘生成整章正文。', required: true, defaultEnabled: true, defaultFailurePolicy: 'stop' },
  { id: 'audit', label: '章节审计', description: '检查备忘兑现、章首章尾钩子、字数和硬规则。', defaultEnabled: true, defaultFailurePolicy: 'skip' },
  { id: 'repair', label: '自动修复', description: '当审计发现关键问题时，最小改动修复正文。', defaultEnabled: true, defaultFailurePolicy: 'skip' },
  { id: 'humanize', label: '去 AI 味润色', description: '在修复之后整章润色，只改表达，不改剧情。', defaultEnabled: false, defaultFailurePolicy: 'skip' },
  { id: 'session-note', label: '写作日志', description: '把本章写作经验存入项目知识，后续章节可用于保持连续；快速出稿可关闭，长篇建议保留。', defaultEnabled: true, defaultFailurePolicy: 'skip' }
]

export function createDefaultFirstDraftSteps(): Record<FirstDraftStepId, FirstDraftStepConfig> {
  return FIRST_DRAFT_STEP_DEFINITIONS.reduce((acc, step) => {
    acc[step.id] = {
      id: step.id,
      enabled: step.required ? true : step.defaultEnabled,
      skillMode: 'auto',
      skillIds: [],
      userPrompt: '',
      failurePolicy: step.defaultFailurePolicy
    }
    return acc
  }, {} as Record<FirstDraftStepId, FirstDraftStepConfig>)
}

function resolveFirstDraftSteps(config: FirstDraftConfig): Record<FirstDraftStepId, FirstDraftStepConfig> {
  const defaults = createDefaultFirstDraftSteps()
  return FIRST_DRAFT_STEP_DEFINITIONS.reduce((acc, step) => {
    const current = config.steps?.[step.id]
    acc[step.id] = {
      ...defaults[step.id],
      ...current,
      id: step.id,
      enabled: step.required ? true : (current?.enabled ?? defaults[step.id].enabled),
      skillMode: current?.skillMode === 'manual' ? 'manual' : 'auto',
      skillIds: Array.isArray(current?.skillIds) ? [...current.skillIds] : []
    }
    return acc
  }, {} as Record<FirstDraftStepId, FirstDraftStepConfig>)
}

function appendStepPrompt(base: string, stepPrompt: string): string {
  const trimmed = stepPrompt.trim()
  if (!trimmed) return base
  return `${base}\n\n本步骤补充要求：${trimmed}`
}

function finalCleanGeneratedChapterText(text: string): string {
  const normalized = text
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^\s*(?:I am Claude,?\s+made by Anthropic\.?|我是\s*Claude[^\n]*|我理解了[^\n]*|以下是[^\n]*|修复后的完整章节正文[:：]?|润色后的完整章节正文[:：]?|正文[:：]?)\s*/i, '')
    .replace(/(?:^|\n)\s*(?:---+|\*\*\*+|===+)\s*(?=\n)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return normalized
}

function formatMemoForRepair(memo: Record<string, unknown>): string {
  const parts: string[] = []
  if (memo.currentTask) parts.push(`任务：${memo.currentTask}`)
  if (memo.emotionArc) parts.push(`情绪轨迹：${memo.emotionArc}`)
  if (Array.isArray(memo.payoffs) && memo.payoffs.length > 0) parts.push(`兑现：${memo.payoffs.join('；')}`)
  if (Array.isArray(memo.doNotDo) && memo.doNotDo.length > 0) parts.push(`红线：${memo.doNotDo.join('；')}`)
  return parts.join('\n')
}

/** 把单个参考作品的拆书分析整理成一段风格提示文本。优先用作品自带的 analysis，兜底用拆书总纲文档。 */
function formatReferenceWorkStyle(
  work: { title: string; analysis?: ReferenceStyleAnalysis },
  summaryDoc?: { summary?: string; content: string }
): string {
  const a = work.analysis
  const lines: string[] = []
  if (a?.overview) lines.push(`风格总述：${a.overview}`)
  if (a?.sentenceStyle) lines.push(`句式特征：${a.sentenceStyle}`)
  if (a?.dialogueRatio) lines.push(`对白策略：${a.dialogueRatio}`)
  if (a?.pacingControl) lines.push(`节奏控制：${a.pacingControl}`)
  if (a?.emotionExpression) lines.push(`情绪表达：${a.emotionExpression}`)
  if (a?.narrativePerspective) lines.push(`叙事视角：${a.narrativePerspective}`)
  if (a?.styleRules?.length) lines.push(`风格规则：${a.styleRules.join('；')}`)
  if (a?.reusableStylePrompt) lines.push(`仿写模板：${a.reusableStylePrompt}`)
  if (a?.avoidRules?.length) lines.push(`避免照搬：${a.avoidRules.join('；')}`)
  // analysis 为空时兜底用拆书总纲文档的摘要 / 正文
  if (!lines.length && summaryDoc) {
    const snippet = (summaryDoc.summary || summaryDoc.content || '').slice(0, 600).trim()
    if (snippet) lines.push(snippet)
  }
  if (!lines.length) return ''
  return `【${work.title}】\n${lines.join('\n')}`
}

function buildReferenceStyleContext(selectedRefIds: string[]): string {
  if (!selectedRefIds.length) return ''
  const { referenceWorks, knowledgeDocuments } = useAppStore()
  const selectedWorks = referenceWorks.filter((w) => selectedRefIds.includes(w.id))
  if (!selectedWorks.length) return ''
  // 拆书总纲文档按 sourceTitle 建索引，仅作为 analysis 缺失时的兜底数据源
  const summaryByTitle = new Map<string, { summary?: string; content: string }>()
  for (const d of knowledgeDocuments) {
    if (d.sourceType !== 'reference-summary') continue
    const title = String(d.metadata?.sourceTitle ?? '').trim()
    if (title && !summaryByTitle.has(title)) summaryByTitle.set(title, d)
  }
  const MAX_TOTAL_CHARS = 1800
  let totalChars = 0
  const parts: string[] = []
  for (const work of selectedWorks.slice(0, 3)) {
    const block = formatReferenceWorkStyle(work, summaryByTitle.get(work.title))
    if (!block) continue
    if (totalChars + block.length > MAX_TOTAL_CHARS) break
    parts.push(block)
    totalChars += block.length
  }
  return parts.join('\n\n')
}

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

type StreamTaskName = 'chapter-first-draft' | 'chapter-memo' | 'chapter-audit' | 'chapter-repair' | 'chapter-humanize' | 'chapter-session-note'

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
  reasoningContent: Ref<string>
  executionLabel: Ref<string>
  previewTitle: Ref<string>
  previewContent: Ref<string>
  progressPercent: Ref<number>
  progressText: Ref<string>
  auditResult: Ref<ChapterAuditPayload | null>
  isAuditing: Ref<boolean>
  elapsedSeconds: Ref<number>
  isStreaming: Ref<boolean>
  start: (config: FirstDraftConfig) => Promise<void>
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
  const reasoningContent = ref('')
  const executionLabel = ref('')
  const previewTitle = ref('')
  const previewContent = ref('')

  const streamId = ref<string | null>(null)
  const currentStreamTask = ref<StreamTaskName | null>(null)
  let resolveStream: ((result: StreamTaskResult) => void) | null = null
  let rejectStream: ((err: Error) => void) | null = null
  let removeListener: (() => void) | null = null
  // `startAiStream` returns the stream id after the main process has started
  // the request. A very fast provider can emit chunks/done before that IPC
  // response reaches the renderer, so retain those early events until the id
  // is bound below instead of dropping them.
  let awaitingStreamId = false
  let pendingStreamEvents: CharacterArcAiStreamEvent[] = []

  const progressPercent = ref(0)
  const progressText = ref('')
  const progressFloor = ref(0)

  const auditResult = ref<ChapterAuditPayload | null>(null)
  const isAuditing = ref(false)

  const elapsedSeconds = ref(0)
  const isStreaming = ref(false)
  let elapsedTimer: ReturnType<typeof setInterval> | null = null

  function updateProgress(nextPercent: number, text: string): void {
    const bounded = Math.min(99, Math.max(0, Math.round(nextPercent)))
    progressFloor.value = Math.max(progressFloor.value, bounded)
    progressPercent.value = progressFloor.value
    progressText.value = text
  }

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
      progressFloor.value = 0
      return
    }
    if (currentStreamTask.value === 'chapter-memo') {
      updateProgress(previewContent.value.trim() ? 10 : 6, '正在生成本章写作备忘...')
      return
    }
    if (currentStreamTask.value === 'chapter-audit') {
      updateProgress(previewContent.value.trim() ? 58 : 52, '正在审计本章质量...')
      return
    }
    if (currentStreamTask.value === 'chapter-repair') {
      updateProgress(previewContent.value.trim() ? 68 : 62, '正在自动修复审计问题...')
      return
    }
    if (currentStreamTask.value === 'chapter-humanize') {
      updateProgress(previewContent.value.trim() ? 88 : 72, '正在执行去 AI 味润色...')
      return
    }
    if (currentStreamTask.value === 'chapter-session-note') {
      updateProgress(99, '正在生成写作日志...')
      return
    }
    if (!words) {
      if (reasoningContent.value) {
        updateProgress(14, '模型正在构思本章（思考中）...')
        return
      }
      updateProgress(4, '正在整理大纲、文风和角色关系上下文...')
      return
    }
    const estimated = Math.round((words / target) * 100)
    const draftProgress = 15 + Math.min(35, Math.max(0, Math.round(estimated * 0.35)))
    updateProgress(draftProgress, `已生成 ${words} 字 / 目标 ${formatChapterWordTargetLabel(target)}（${progressPercent.value}%）`)
  }

  function reset(finalLabel = ''): void {
    streamId.value = null
    awaitingStreamId = false
    pendingStreamEvents = []
    currentStreamTask.value = null
    resolveStream = null
    rejectStream = null
    streamingCharCount.value = 0
    progressFloor.value = finalLabel.includes('完成') ? 100 : progressFloor.value
    progressPercent.value = finalLabel.includes('完成') ? 100 : progressPercent.value
    progressText.value = finalLabel || progressText.value
    executionLabel.value = finalLabel
    isStopping.value = false
    isGenerating.value = false
    isAuditing.value = false
    isStreaming.value = false
    stopElapsedTimer()
  }

  function releaseCurrentStreamState(): void {
    streamId.value = null
    awaitingStreamId = false
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
    return task === 'chapter-first-draft' || task === 'chapter-memo' || task === 'chapter-repair' || task === 'chapter-humanize'
  }

  function getActiveTaskErrorMessage(): string {
    if (currentStreamTask.value === 'chapter-memo') return 'AI 写作备忘生成失败'
    if (currentStreamTask.value === 'chapter-audit') return 'AI 章节审计失败'
    if (currentStreamTask.value === 'chapter-repair') return 'AI 章节修复失败'
    if (currentStreamTask.value === 'chapter-humanize') return 'AI 去 AI 味润色失败'
    return 'AI 初稿生成失败'
  }

  function handleStreamEvent(payload: CharacterArcAiStreamEvent): void {
    if (payload.streamId !== streamId.value) {
      if (awaitingStreamId) pendingStreamEvents.push(payload)
      return
    }

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

    if (payload.type === 'reasoning') {
      isStreaming.value = true
      reasoningContent.value += payload.delta
      executionLabel.value = '正在构思本章（思考中）...'
      recompute()
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
    reasoningContent.value = ''
    if (task === 'chapter-first-draft') {
      streamingContent.value = ''
      streamingCharCount.value = 0
      previewTitle.value = '章节初稿实时输出'
      previewContent.value = ''
    } else if (task === 'chapter-memo') {
      previewTitle.value = '写作备忘实时输出'
      previewContent.value = ''
    } else if (task === 'chapter-humanize') {
      previewTitle.value = '去 AI 味润色实时输出'
      previewContent.value = ''
    } else if (task === 'chapter-repair') {
      previewTitle.value = '自动修复实时输出'
      previewContent.value = ''
    } else {
      previewTitle.value = '章节审计进行中'
      previewContent.value = ''
    }
    // 任务切换后立即刷新进度文案，避免 progressText 停留在上一个任务（如写作备忘）。
    recompute()

    pendingStreamEvents = []
    awaitingStreamId = true
    let result: Awaited<ReturnType<typeof window.characterArc.startAiStream>>
    try {
      result = await window.characterArc.startAiStream(toIpcPayload({
        task,
        settings: appStore.appSettings,
        context
      }))
    } catch (error) {
      awaitingStreamId = false
      pendingStreamEvents = []
      throw error
    }

    const sid = (result.result as { streamId?: string } | undefined)?.streamId
    awaitingStreamId = false
    if (!result.success || !sid) {
      pendingStreamEvents = []
      throw new Error(result.error ?? getActiveTaskErrorMessage())
    }
    streamId.value = sid

    return new Promise<StreamTaskResult>((resolve, reject) => {
      resolveStream = resolve
      rejectStream = reject
      // Resolve/reject handlers must be installed before replaying events; a
      // done event may be the only event received for a fast non-streaming
      // response.
      const earlyEvents = pendingStreamEvents
      pendingStreamEvents = []
      for (const event of earlyEvents) {
        if (event.streamId === sid) handleStreamEvent(event)
      }
    })
  }

  async function start(config: FirstDraftConfig): Promise<void> {
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
    progressFloor.value = 0
    progressPercent.value = 0
    progressText.value = ''
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
          const targetWordCount = config.targetWordCount || parseChapterWordTarget(chapter.wordTarget)
          const steps = resolveFirstDraftSteps(config)
          let latestAuditResult: ChapterAuditPayload | null = null
          const resolveStepProjectSkills = async (stepId: FirstDraftStepId) => {
            const step = steps[stepId]
            if (step.skillMode !== 'manual') return undefined
            return loadProjectSkillsContextByIds(project, step.skillIds)
          }
          const handleStepError = (stepId: FirstDraftStepId, error: unknown): void => {
            if (steps[stepId].failurePolicy === 'stop') {
              throw error instanceof Error ? error : new Error(`${steps[stepId].id} 执行失败`)
            }
          }
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

          // L2 接续契约：取最近一个有正文的前序章节的「结尾」原文，让本章自然承接。
          // 注意取的是末尾 ~800 字（结尾），与 relatedChapters 的开头预览方向相反。
          const chaptersWithContent = precedingChapters.filter((c) => Boolean(getPlainTextFromEditorContent(c.content ?? '').trim()))
          const handoffChapter = chaptersWithContent.at(-1)
          const previousChapterHandoff = handoffChapter
            ? {
                title: handoffChapter.title,
                endingText: getPlainTextFromEditorContent(handoffChapter.content ?? '').trim().slice(-800)
              }
            : undefined

          // recentEndingsTrail 仅用于「避免连续相同收尾形式」；紧邻上一章已交给接续契约独占，从这里剔除，
          // 避免「请承接上一章结尾」与「避免与该结尾雷同」的指令冲突。
          const recentEndingsTrail = chaptersWithContent
            .slice(0, handoffChapter ? -1 : undefined)
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

          const recentJournals = appStore.knowledgeDocuments
            .filter((d) => d.sourceLabel === 'writing-journal')
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
            .slice(0, 3)
          if (recentJournals.length > 0) {
            memoBaseContext.recentWritingJournals = recentJournals.map((j) => ({
              title: j.title,
              content: j.content
            }))
          }

          let chapterMemo: ChapterFirstDraftContextInput['chapterMemo'] | undefined
          if (steps.memo.enabled) {
            executionLabel.value = '正在流式生成写作备忘...'
            const memoHintTimer = setTimeout(() => {
              if (currentStreamTask.value === 'chapter-memo' && !previewContent.value) {
                executionLabel.value = 'AI 正在规划写作备忘，请稍候...'
              }
            }, 8000)

            try {
              const memoProjectSkills = await resolveStepProjectSkills('memo')
              const memoStream = await streamTask('chapter-memo', {
                ...memoBaseContext,
                ...(memoProjectSkills !== undefined ? { projectSkills: memoProjectSkills } : {}),
                userPrompt: appendStepPrompt(config.userPrompt, steps.memo.userPrompt)
              })
              clearTimeout(memoHintTimer)
              const memoResult = memoStream.result as { memo?: ChapterFirstDraftContextInput['chapterMemo'] } | undefined
              if (memoResult?.memo) {
                chapterMemo = memoResult.memo
              }
            } catch (error) {
              clearTimeout(memoHintTimer)
              executionLabel.value = '写作备忘生成失败，跳过直接写作...'
              handleStepError('memo', error)
            }
          }

          const draftProjectSkills = await resolveStepProjectSkills('draft')
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
            userPrompt: appendStepPrompt(`请生成这一章的完整初稿，目标字数约 ${targetWordCount} 字（参考值，优先保证情节自然完整）。如果当前正文为空，就从零起稿；如果当前正文不为空，也按整章重写处理，而不是续写。${config.userPrompt ? `\n\n补充要求：${config.userPrompt}` : ''}`, steps.draft.userPrompt),
            ...(draftProjectSkills !== undefined ? { projectSkills: draftProjectSkills } : {}),
            chapterMemo,
            recentEndingsTrail,
            previousChapterHandoff,
            referenceStyleContext: buildReferenceStyleContext(config.selectedReferenceWorkIds)
          })

          executionLabel.value = '构建写作提示词…'
          recompute()
          await new Promise((r) => setTimeout(r, 0))

          executionLabel.value = `正在生成本章初稿（目标约 ${targetWordCount} 字）…`
          isStreaming.value = true
          recompute()

          // 模型可能不支持流式输出（如 mimo 系列），10 秒后提示用户耐心等待
          const waitHintTimer = setTimeout(() => {
            if (currentStreamTask.value === 'chapter-first-draft' && !streamingContent.value) {
              executionLabel.value = `AI 正在创作中，请耐心等待（目标约 ${targetWordCount} 字）…`
            }
          }, 10000)

          const draftStream = await streamTask('chapter-first-draft', context)
          clearTimeout(waitHintTimer)
          const fullText = draftStream.text
          if (fullText) {
            updateProgress(50, '初稿生成完成，准备进入后续检查...')
            let finalText = fullText
            let repairedText = ''

            if (steps.audit.enabled && chapterMemo) {
              executionLabel.value = '正在流式审计章节质量...'
              isAuditing.value = true
              try {
                const auditProjectSkills = await resolveStepProjectSkills('audit')
                const auditStream = await streamTask('chapter-audit', {
                  projectId: project.id,
                  chapterId: chapter.id,
                  chapterTitle: chapter.title,
                  targetWordCount,
                  draftText: fullText,
                  chapterMemo,
                  ...(auditProjectSkills !== undefined ? { projectSkills: auditProjectSkills } : {}),
                  userPrompt: steps.audit.userPrompt
                })
                const auditResp = auditStream.result as { audit?: ChapterAuditPayload } | undefined
                if (auditResp?.audit) {
                  latestAuditResult = auditResp.audit

                  const criticalIssues = auditResp.audit.issues.filter((i) => i.severity === 'critical')
                  if (steps.repair.enabled && !auditResp.audit.pass && criticalIssues.length > 0) {
                    auditResult.value = null
                    isAuditing.value = false
                    executionLabel.value = `审计发现 ${criticalIssues.length} 个关键问题，正在自动修复...`
                    updateProgress(60, `审计发现 ${criticalIssues.length} 个关键问题，准备自动修复...`)
                    previewTitle.value = '自动修复实时输出'
                    previewContent.value = ''
                    try {
                      const repairProjectSkills = await resolveStepProjectSkills('repair')
                      const repairStream = await streamTask('chapter-repair', {
                        projectId: project.id,
                        chapterTitle: chapter.title,
                        chapterSummary: chapter.summary,
                        chapterContent: fullText,
                        projectTitle: project.title,
                        projectGenre: project.genre,
                        writingStyleLabel: project.writingStylePresetId,
                        writingStylePrompt: project.writingStylePrompt,
                        auditIssues: criticalIssues,
                        chapterMemoText: formatMemoForRepair(chapterMemo),
                        ...(repairProjectSkills !== undefined ? { projectSkills: repairProjectSkills } : {}),
                        userPrompt: steps.repair.userPrompt
                      })
                      repairedText = repairStream.text
                      if (repairedText && repairedText.length > fullText.length * 0.5) {
                        finalText = repairedText
                        executionLabel.value = `已自动修复 ${criticalIssues.length} 个问题`
                        updateProgress(70, `已自动修复 ${criticalIssues.length} 个问题`)
                      }
                    } catch (error) {
                      auditResult.value = auditResp.audit
                      handleStepError('repair', error)
                    }
                  } else {
                    auditResult.value = auditResp.audit
                    updateProgress(auditResp.audit.pass ? 60 : 59, auditResp.audit.pass ? '章节审计通过' : '章节审计完成，未触发自动修复')
                  }
                }
              } catch (error) {
                handleStepError('audit', error)
              } finally {
                isAuditing.value = false
              }
            }

            if (steps.humanize.enabled) {
              try {
                executionLabel.value = '正在执行去 AI 味润色...'
                const humanizeProjectSkills = await resolveStepProjectSkills('humanize')
                const humanizeStream = await streamTask('chapter-humanize', {
                  projectId: project.id,
                  chapterId: chapter.id,
                  projectTitle: project.title,
                  projectGenre: project.genre,
                  chapterTitle: chapter.title,
                  chapterSummary: chapter.summary,
                  writingStyleLabel: project.writingStylePresetId,
                  writingStylePrompt: project.writingStylePrompt,
                  sourceText: finalText,
                  ...(humanizeProjectSkills !== undefined ? { projectSkills: humanizeProjectSkills } : {}),
                  userPrompt: steps.humanize.userPrompt
                })
                const humanizedText = humanizeStream.text
                if (humanizedText && humanizedText.length > finalText.length * 0.5) {
                  finalText = humanizedText
                  executionLabel.value = '去 AI 味润色完成'
                  updateProgress(90, '去 AI 味润色完成')
                }
              } catch (error) {
                handleStepError('humanize', error)
              }
            }

            finalText = finalCleanGeneratedChapterText(finalText)
            if (finalText) {
              executionLabel.value = '正在写入最终章节'
              updateProgress(95, '正在写入最终章节...')
              appStore.updateChapterContent(ensureEditorHtmlContent(finalText))
            }

            if (steps['session-note'].enabled) {
              try {
                const endingSnippet = finalText.slice(-200)
                const auditForNote = latestAuditResult ?? auditResult.value
                const auditSummary = auditForNote
                  ? (auditForNote.pass ? '通过' : `未通过，${auditForNote.issues.length} 个问题`)
                  : '未审计'
                updateProgress(99, '正在生成写作日志...')
                const sessionNoteProjectSkills = await resolveStepProjectSkills('session-note')
                const noteStream = await streamTask('chapter-session-note', {
                  projectId: project.id,
                  chapterTitle: chapter.title,
                  chapterSummary: chapter.summary,
                  emotionArc: chapterMemo?.emotionArc ?? '',
                  endingSnippet,
                  auditSummary,
                  finalSource: repairedText ? '修复稿' : '初稿',
                  ...(sessionNoteProjectSkills !== undefined ? { projectSkills: sessionNoteProjectSkills } : {}),
                  userPrompt: steps['session-note'].userPrompt
                })
                const noteResult = noteStream.result as { sessionNote?: { craftDecisions: string; effectiveReferences: string; nextChapterAdvice: string } } | undefined
                if (noteResult?.sessionNote) {
                  const note = noteResult.sessionNote
                  const now = new Date().toISOString()
                  appStore.mergeKnowledgeDocuments([{
                    id: `journal-${Date.now()}`,
                    title: `写作日志｜${chapter.title}`,
                    sourceType: 'chapter-summary',
                    sourceLabel: 'writing-journal',
                    content: `技法：${note.craftDecisions}\n参考：${note.effectiveReferences}\n下章建议：${note.nextChapterAdvice}`,
                    summary: note.nextChapterAdvice,
                    keywords: [chapter.title, 'writing-journal'],
                    metadata: { chapterId: chapter.id, journalType: 'writing-journal' },
                    createdAt: now,
                    updatedAt: now
                  }])
                }
              } catch (error) {
                handleStepError('session-note', error)
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
    reasoningContent,
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
