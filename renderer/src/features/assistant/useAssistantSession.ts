import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useMessage } from 'naive-ui'
import { marked } from 'marked'
import { buildChapterAssistantContext } from '@/features/ai/chapterAssistantContext'
import {
  getResolvedChapterAssistantTemplates,
  type ChapterAssistantQuickAction
} from '@/features/ai/chapterAssistantOptions'
import { createAgentProposalFromResult } from '@/features/assistant/agentTypes'
import { getChapterPreviewText, getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { loadEnabledProjectSkillsContext } from '@/features/projectSkills/context'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { useAppStore } from '@/stores/app'
import { isAssistantWindow } from '@/utils/windowKind'
import type {
  AssistantActionProposalResult,
  AssistantIntentResult,
  ChapterInsertionMode
} from '@/types/app'

function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const MORE_ACTION_OPTIONS = [
  { label: '替换选区', key: 'replace-selection' },
  { label: '追加末尾', key: 'append' },
  { label: '设为标题', key: 'set-title' },
  { label: '设为摘要', key: 'set-summary' }
]

export type AssistantMessageActionKey = typeof MORE_ACTION_OPTIONS[number]['key']

function formatAiRunStartedAt(value?: string): string {
  if (!value) {
    return '时间未知'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '时间未知'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function getAiRunTaskLabel(task: string): string {
  switch (task) {
    case 'chapter-assistant':
      return '章节助理'
    case 'chapter-first-draft':
      return '章节初稿'
    case 'chapter-summarize':
      return '章节总结'
    case 'assistant-action-proposal':
      return '动作提议'
    case 'assistant-intent':
      return '意图识别'
    default:
      return task
  }
}

function getAiRunStatusText(status?: string): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'success':
      return '已完成'
    case 'error':
      return '失败'
    case 'canceled':
      return '已停止'
    default:
      return ''
  }
}

export function useAssistantSession(messagesViewport?: Ref<HTMLElement | null>) {
  const appStore = useAppStore()
  const message = useMessage()

  const draft = ref('')
  const isResponding = ref(false)
  const isStopping = ref(false)
  const activeStreamId = ref<string | null>(null)
  const streamingReply = ref('')
  const responseMode = ref<'freeform' | 'polish' | 'continue' | 'suggest' | 'reference'>('freeform')
  const responseLength = ref<'short' | 'medium' | 'long'>('medium')
  let removeAiStreamListener: (() => void) | null = null

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
    if (!chapter) return []
    const chaptersInVolume = appStore.chapters.filter((item) => item.volumeId === chapter.volumeId)
    const currentIndex = chaptersInVolume.findIndex((item) => item.id === chapter.id)
    if (currentIndex === -1) return []
    return [chaptersInVolume[currentIndex - 1], chaptersInVolume[currentIndex + 1]]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({
        title: item.title,
        summary: item.summary,
        preview: getChapterPreviewText(item.content, '该章节暂无正文')
      }))
  })
  const volumeChapterSummaries = computed(() => {
    const chapter = currentChapter.value
    if (!chapter) return []
    const related = relatedChapters.value
    const relatedTitles = new Set(related.map((r) => r.title))
    return appStore.chapters
      .filter((c) => c.volumeId === chapter.volumeId && c.id !== chapter.id && !relatedTitles.has(c.title))
      .map((c) => ({ title: c.title, summary: c.summary }))
  })
  const novelOpenerSummary = computed(() => {
    const first = appStore.chapters[0]
    if (!first) return undefined
    const chapter = currentChapter.value
    if (first.id === chapter?.id) return undefined
    const related = relatedChapters.value
    if (related.some((r) => r.title === first.title)) return undefined
    return { title: first.title, summary: first.summary }
  })
  const recentAssistantMessages = computed(() =>
    appStore.messages
      .slice(-4)
      .map((item) => ({ role: item.role, content: item.content }))
  )
  const lastUserPrompt = computed(() => {
    const lastUserMessage = [...appStore.messages].reverse().find((item) => item.role === 'user')
    if (!lastUserMessage) return null
    const quickActionMatch = lastUserMessage.content.match(/^【([^】]+)】([\s\S]*)$/)
    if (!quickActionMatch) return { prompt: lastUserMessage.content, quickAction: undefined }
    return {
      quickAction: quickActionMatch[1]?.trim() || undefined,
      prompt: quickActionMatch[2]?.trim() || lastUserMessage.content
    }
  })
  const quickActions = computed(() => getResolvedChapterAssistantTemplates(currentProject.value))
  const recentAiRuns = computed(() => {
    const projectId = currentProject.value?.id
    const chapterId = currentChapter.value?.id
    if (!projectId) {
      return []
    }

    return [...appStore.aiRuns]
      .reverse()
      .filter((run) => (
        run.projectId === projectId
        && (!chapterId || run.chapterId === chapterId || run.task === 'chapter-assistant')
      ))
      .slice(0, 10)
  })
  const latestAiRun = computed(() => recentAiRuns.value[0])
  const latestAiRunKnowledge = computed(() => latestAiRun.value?.usedKnowledge ?? [])
  const latestAiRunStatusText = computed(() => {
    return getAiRunStatusText(latestAiRun.value?.status)
  })
  const recentAiRunsDisplay = computed(() =>
    recentAiRuns.value.map((run) => ({
      ...run,
      startedAtLabel: formatAiRunStartedAt(run.startedAt),
      taskLabel: getAiRunTaskLabel(run.task),
      statusText: getAiRunStatusText(run.status)
    }))
  )
  const hasSelection = computed(() => Boolean(selectedExcerpt.value))
  const activeAgentProposal = computed(() => appStore.activeAgentProposal)
  const agentConfirmationState = computed(() => appStore.agentConfirmationState)
  const agentExecutionStep = computed(() => appStore.agentExecutionStep)

  function renderMarkdown(content: string): string {
    return marked.parse(content, { async: false }) as string
  }

  async function scrollToBottom(): Promise<void> {
    await nextTick()
    if (messagesViewport?.value) {
      messagesViewport.value.scrollTop = messagesViewport.value.scrollHeight
    }
  }

  function resetStreamingState(): void {
    activeStreamId.value = null
    streamingReply.value = ''
    isResponding.value = false
    isStopping.value = false
  }

  function normalizeAssistantReply(content: string): string {
    return content.trim()
  }

  function resolveCompletedReplyContent(payloadContent?: string): string {
    const directContent = typeof payloadContent === 'string' ? payloadContent.trim() : ''
    if (directContent) {
      return directContent
    }

    return streamingReply.value.trim()
  }

  async function appendConversationMessage(role: 'user' | 'assistant', content: string): Promise<void> {
    const normalizedContent = content.trim()
    if (!normalizedContent) {
      return
    }

    if (isAssistantWindow) {
      await window.characterArc.publishAssistantMessage(toIpcPayload({
        role,
        content: normalizedContent
      }))
      return
    }

    if (role === 'assistant') {
      appStore.pushAssistantMessage(normalizedContent)
      return
    }

    appStore.pushUserMessage(normalizedContent)
  }

  function buildProposalAssistantReply(
    intentReason: string,
    proposal: ReturnType<typeof createAgentProposalFromResult>
  ): string {
    const lines = [intentReason.trim() || proposal.reason]

    switch (proposal.commandType) {
      case 'update-chapter-title': {
        const value = String(proposal.payload.value ?? '').trim()
        if (value) {
          lines.push(`建议标题：${value}`)
        }
        break
      }
      case 'update-chapter-summary': {
        const value = String(proposal.payload.value ?? '').trim()
        if (value) {
          lines.push('建议摘要：')
          lines.push(value)
        }
        break
      }
      case 'create-outline-item': {
        const title = String(proposal.payload.title ?? '').trim()
        const summary = String(proposal.payload.summary ?? '').trim()
        if (title) {
          lines.push(`大纲标题：${title}`)
        }
        if (summary) {
          lines.push('大纲摘要：')
          lines.push(summary)
        }
        break
      }
      case 'append-workflow-document-entry': {
        const entryTitle = String(proposal.payload.entryTitle ?? '').trim()
        const content = String(proposal.payload.content ?? '').trim()
        if (entryTitle) {
          lines.push(`条目标题：${entryTitle}`)
        }
        if (content) {
          lines.push('条目内容：')
          lines.push(content)
        }
        break
      }
      case 'update-workflow-document': {
        const content = String(proposal.payload.content ?? '').trim()
        if (content) {
          lines.push('文档内容：')
          lines.push(content)
        }
        break
      }
      case 'save-knowledge-document': {
        const document = (proposal.payload.document ?? proposal.payload ?? {}) as Record<string, unknown>
        const title = String(document.title ?? '').trim()
        const summary = String(document.summary ?? '').trim()
        if (title) {
          lines.push(`知识标题：${title}`)
        }
        if (summary) {
          lines.push('知识摘要：')
          lines.push(summary)
        }
        break
      }
      case 'insert-into-chapter':
      default: {
        const content = String(proposal.payload.content ?? '').trim()
        if (content) {
          lines.push('建议内容：')
          lines.push(content)
        }
        break
      }
    }

    return lines.filter(Boolean).join('\n\n')
  }

  function shouldForceProposal(promptText: string, quickAction?: string): boolean {
    const text = `${quickAction ?? ''}\n${promptText}`.toLowerCase()
    return [
      '章节标题',
      '更新标题',
      '设为标题',
      '章节摘要',
      '更新摘要',
      '设为摘要',
      '可直接应用',
      '直接应用',
      '创建大纲',
      '下一章大纲',
      '写入 task_plan',
      '写入 findings',
      '写入 progress',
      '写入知识库',
      '沉淀',
      'canon',
      '替换选区',
      'replace-selection'
    ].some((keyword) => text.includes(keyword.toLowerCase()))
  }

  function normalizeOutlineProposalPayload(payload: Record<string, unknown>): Partial<typeof appStore.outlineItems[number]> {
    const nestedPayload = payload.payload && typeof payload.payload === 'object'
      ? payload.payload as Record<string, unknown>
      : null
    const source = nestedPayload ?? payload

    return {
      volumeId: String(source.volumeId ?? '').trim() || undefined,
      title: String(source.title ?? '').trim(),
      wordTarget: String(source.wordTarget ?? '').trim(),
      conflict: String(source.conflict ?? '').trim(),
      summary: String(source.summary ?? '').trim(),
      status: source.status as typeof appStore.outlineItems[number]['status'] | undefined
    }
  }

  async function createNextOutlineProposal(promptText: string, quickAction: string): Promise<void> {
    const content = promptText.trim()
    if (!content || isResponding.value) {
      return
    }

    await appendConversationMessage('user', `【${quickAction}】${content}`)
    draft.value = ''
    isResponding.value = true
    isStopping.value = false
    streamingReply.value = ''
    await scrollToBottom()

    try {
      const projectSkills = await loadEnabledProjectSkillsContext(currentProject.value, 'draft')
      const assistantContext = buildChapterAssistantContext({
        project: currentProject.value,
        chapter: currentChapter.value,
        chapterVolume: appStore.selectedChapterVolume,
        relatedChapters: relatedChapters.value,
        volumeChapterSummaries: volumeChapterSummaries.value,
        novelOpenerSummary: novelOpenerSummary.value,
        recentMessages: recentAssistantMessages.value,
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
        selectedText: selectedExcerpt.value,
        responseMode: 'suggest',
        responseLength: 'medium',
        quickAction,
        userPrompt: `${content}\n请务必输出 create-outline-item 动作提议，不要改成其他动作。`,
        chapterContent: getPlainTextFromEditorContent(currentChapter.value?.content ?? ''),
        projectSkills
      })

      const proposalResponse = await window.characterArc.generateAi(toIpcPayload({
        task: 'assistant-action-proposal',
        settings: appStore.appSettings,
        context: assistantContext
      }))

      const proposalResult = (proposalResponse.result as { result?: AssistantActionProposalResult } | undefined)?.result
      if (!proposalResponse.success || !proposalResult) {
        throw new Error(proposalResponse.error ?? 'AI 未返回有效大纲提议')
      }

      const proposal = createAgentProposalFromResult(proposalResult)
      if (proposal.commandType !== 'create-outline-item') {
        throw new Error('AI 没有返回下一章大纲提议，请重试。')
      }

      const outlinePayload = normalizeOutlineProposalPayload({
        ...(proposal.payload ?? {}),
        volumeId: appStore.selectedChapterVolume?.id || currentChapter.value?.volumeId || '',
        status: 'planned'
      })

      const commandPayload: CharacterArcAssistantCommand = {
        type: 'create-outline-item',
        kind: 'proposal',
        target: 'outline-item',
        reason: proposal.reason || '这会在当前分卷新增一个下一章大纲节点，建议确认后再写入。',
        preview: proposal.preview,
        destructive: proposal.destructive,
        requiresConfirmation: true,
        payload: outlinePayload
      }

      if (isAssistantWindow) {
        await window.characterArc.publishAssistantCommand(toIpcPayload(commandPayload))
      } else {
        appStore.handleAssistantCommand(commandPayload)
      }

      await appendConversationMessage(
        'assistant',
        [
          '已生成下一章大纲提议，请确认后执行。',
          outlinePayload.title ? `大纲标题：${outlinePayload.title}` : '',
          outlinePayload.conflict ? `核心冲突：${outlinePayload.conflict}` : '',
          outlinePayload.summary ? `剧情摘要：\n${outlinePayload.summary}` : ''
        ].filter(Boolean).join('\n\n')
      )
      await scrollToBottom()
      message.success('已生成下一章大纲提议')
    } catch (error) {
      resetStreamingState()
      message.error(error instanceof Error ? error.message : 'AI 生成下一章大纲失败')
    } finally {
      isResponding.value = false
      isStopping.value = false
    }
  }

  async function createSceneRevisionProposal(action: ChapterAssistantQuickAction): Promise<void> {
    const content = action.prompt.trim()
    const selectedText = selectedExcerpt.value.trim()
    if (!content || !selectedText || isResponding.value) {
      return
    }

    await appendConversationMessage('user', `【${action.label}】${content}`)
    draft.value = ''
    isResponding.value = true
    isStopping.value = false
    streamingReply.value = ''
    await scrollToBottom()

    try {
      const projectSkills = await loadEnabledProjectSkillsContext(currentProject.value, 'draft')
      const assistantContext = buildChapterAssistantContext({
        project: currentProject.value,
        chapter: currentChapter.value,
        chapterVolume: appStore.selectedChapterVolume,
        relatedChapters: relatedChapters.value,
        volumeChapterSummaries: volumeChapterSummaries.value,
        novelOpenerSummary: novelOpenerSummary.value,
        recentMessages: recentAssistantMessages.value,
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
        selectedText,
        responseMode: action.mode,
        responseLength: action.length,
        quickAction: action.label,
        userPrompt: content,
        chapterContent: getPlainTextFromEditorContent(currentChapter.value?.content ?? ''),
        projectSkills
      })

      const response = await window.characterArc.generateAi(toIpcPayload({
        task: 'chapter-assistant',
        settings: appStore.appSettings,
        context: assistantContext
      }))
      const revisionResult = (response.result as { result?: { content?: string } } | undefined)?.result
      const revisedContent = String(revisionResult?.content ?? '').trim()
      if (!response.success || !revisedContent) {
        throw new Error(response.error ?? 'AI 未返回有效修订稿')
      }

      const commandPayload: CharacterArcAssistantCommand = {
        type: 'insert-into-chapter',
        kind: 'proposal',
        target: 'chapter-content',
        reason: '这会替换当前选中的正文片段，建议确认后再写入。',
        preview: {
          title: '修订当前场景',
          summary: `准备使用 AI 生成的${action.label}结果替换当前选区。`,
          before: selectedText.slice(0, 220),
          after: revisedContent.slice(0, 220)
        },
        destructive: true,
        requiresConfirmation: true,
        content: revisedContent,
        mode: 'replace-selection'
      }

      if (isAssistantWindow) {
        await window.characterArc.publishAssistantCommand(toIpcPayload(commandPayload))
      } else {
        appStore.handleAssistantCommand(commandPayload)
      }

      await appendConversationMessage(
        'assistant',
        [
          `已生成${action.label}提议，请确认后执行。`,
          revisedContent
        ].filter(Boolean).join('\n\n')
      )
      await scrollToBottom()
      message.success(`已生成${action.label}提议`)
    } catch (error) {
      resetStreamingState()
      message.error(error instanceof Error ? error.message : 'AI 生成修订稿失败')
    } finally {
      isResponding.value = false
      isStopping.value = false
    }
  }

  async function sendPrompt(promptText?: string, quickAction?: string): Promise<void> {
    const content = (promptText ?? draft.value).trim()
    if (!content || isResponding.value) return

    const userMessage = quickAction ? `【${quickAction}】${content}` : content
    const projectSkills = await loadEnabledProjectSkillsContext(currentProject.value, 'draft')
    const assistantContext = buildChapterAssistantContext({
      project: currentProject.value,
      chapter: currentChapter.value,
      chapterVolume: appStore.selectedChapterVolume,
      relatedChapters: relatedChapters.value,
      volumeChapterSummaries: volumeChapterSummaries.value,
      novelOpenerSummary: novelOpenerSummary.value,
      recentMessages: recentAssistantMessages.value,
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
      selectedText: selectedExcerpt.value,
      responseMode: responseMode.value,
      responseLength: responseLength.value,
      quickAction,
      userPrompt: content,
      chapterContent: getPlainTextFromEditorContent(currentChapter.value?.content ?? ''),
      projectSkills
    })

    await appendConversationMessage('user', userMessage)
    draft.value = ''
    isResponding.value = true
    isStopping.value = false
    streamingReply.value = ''
    await scrollToBottom()

    try {
      const intentResponse = await window.characterArc.generateAi(toIpcPayload({
        task: 'assistant-intent',
        settings: appStore.appSettings,
        context: assistantContext
      }))
      const intentResult = (intentResponse.result as { result?: AssistantIntentResult } | undefined)?.result
      if (!intentResponse.success || !intentResult) {
        throw new Error(intentResponse.error ?? 'AI 意图识别失败')
      }

      if (intentResult.intent === 'proposal' || shouldForceProposal(content, quickAction)) {
        const proposalResponse = await window.characterArc.generateAi(toIpcPayload({
          task: 'assistant-action-proposal',
          settings: appStore.appSettings,
          context: assistantContext
        }))
        const proposalResult = (proposalResponse.result as { result?: AssistantActionProposalResult } | undefined)?.result
        if (!proposalResponse.success || !proposalResult) {
          throw new Error(proposalResponse.error ?? 'AI 动作提议生成失败')
        }

        const proposal = createAgentProposalFromResult(proposalResult)
        let commandPayload: CharacterArcAssistantCommand

        switch (proposal.commandType) {
          case 'update-chapter-title':
            commandPayload = {
              type: 'update-chapter-title',
              kind: 'proposal',
              target: proposal.target,
              reason: proposal.reason,
              preview: proposal.preview,
              destructive: proposal.destructive,
              requiresConfirmation: proposal.requiresConfirmation,
              value: String(proposal.payload.value ?? '').trim()
            }
            break
          case 'update-chapter-summary':
            commandPayload = {
              type: 'update-chapter-summary',
              kind: 'proposal',
              target: proposal.target,
              reason: proposal.reason,
              preview: proposal.preview,
              destructive: proposal.destructive,
              requiresConfirmation: proposal.requiresConfirmation,
              value: String(proposal.payload.value ?? '').trim()
            }
            break
          case 'create-outline-item':
            commandPayload = {
              type: 'create-outline-item',
              kind: 'proposal',
              target: proposal.target,
              reason: proposal.reason,
              preview: proposal.preview,
              destructive: proposal.destructive,
              requiresConfirmation: proposal.requiresConfirmation,
              payload: normalizeOutlineProposalPayload((proposal.payload ?? {}) as Record<string, unknown>)
            }
            break
          case 'append-workflow-document-entry':
            commandPayload = {
              type: 'append-workflow-document-entry',
              kind: 'proposal',
              target: proposal.target,
              reason: proposal.reason,
              preview: proposal.preview,
              destructive: proposal.destructive,
              requiresConfirmation: proposal.requiresConfirmation,
              documentKey: proposal.payload.documentKey as import('@/types/app').WorkflowDocumentKey,
              entryTitle: String(proposal.payload.entryTitle ?? '').trim(),
              content: String(proposal.payload.content ?? '').trim(),
              volumeId: String(proposal.payload.volumeId ?? '').trim() || undefined
            }
            break
          case 'update-workflow-document':
            commandPayload = {
              type: 'update-workflow-document',
              kind: 'proposal',
              target: proposal.target,
              reason: proposal.reason,
              preview: proposal.preview,
              destructive: proposal.destructive,
              requiresConfirmation: proposal.requiresConfirmation,
              documentKey: proposal.payload.documentKey as import('@/types/app').WorkflowDocumentKey,
              content: String(proposal.payload.content ?? '').trim(),
              volumeId: String(proposal.payload.volumeId ?? '').trim() || undefined
            }
            break
          case 'save-knowledge-document':
            commandPayload = {
              type: 'save-knowledge-document',
              kind: 'proposal',
              target: proposal.target,
              reason: proposal.reason,
              preview: proposal.preview,
              destructive: proposal.destructive,
              requiresConfirmation: proposal.requiresConfirmation,
              document: (proposal.payload.document ?? proposal.payload ?? {}) as Partial<typeof appStore.knowledgeDocuments[number]>
            }
            break
          case 'insert-into-chapter':
          default:
            commandPayload = {
              type: 'insert-into-chapter',
              kind: 'proposal',
              target: proposal.target,
              reason: proposal.reason,
              preview: proposal.preview,
              destructive: proposal.destructive,
              requiresConfirmation: proposal.requiresConfirmation,
              content: String(proposal.payload.content ?? '').trim(),
              mode: (proposal.payload.mode as ChapterInsertionMode) || 'append'
            }
            break
        }

        if (isAssistantWindow) {
          await window.characterArc.publishAssistantCommand(toIpcPayload(commandPayload))
        } else {
          appStore.handleAssistantCommand(commandPayload)
        }

        await appendConversationMessage('assistant', buildProposalAssistantReply(intentResult.reason, proposal))
        resetStreamingState()
        await scrollToBottom()
        message.success('已生成写作动作提议，请确认后执行')
        return
      }

      const result = await window.characterArc.startAiStream(toIpcPayload({
        task: 'chapter-assistant',
        settings: appStore.appSettings,
        context: assistantContext
      }))

      const streamId = (result.result as { streamId?: string } | undefined)?.streamId
      if (!result.success || !streamId) throw new Error(result.error ?? 'AI 流式生成启动失败')
      activeStreamId.value = streamId
    } catch (error) {
      resetStreamingState()
      message.error(error instanceof Error ? error.message : 'AI 请求失败')
    }
  }

  function handleQuickAction(action: ChapterAssistantQuickAction): void {
    if (action.requiresSelection && !selectedExcerpt.value) {
      message.warning('请先在正文中选中要处理的段落')
      return
    }

    responseMode.value = action.mode
    responseLength.value = action.length
    if (action.id === 'next-outline-draft') {
      void createNextOutlineProposal(action.prompt, action.label)
      return
    }
    if (action.id === 'polish-selection' || action.id === 'rewrite-selection' || action.id === 'humanize-ai') {
      void createSceneRevisionProposal(action)
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

    const requiresProposal = mode === 'replace-selection'

    if (isAssistantWindow) {
      void window.characterArc.publishAssistantCommand(toIpcPayload({
        type: 'insert-into-chapter',
        kind: requiresProposal ? 'proposal' : 'direct-command',
        target: 'chapter-content',
        reason: requiresProposal ? '这会替换正文中的当前选区，需要你确认后再执行。' : '将生成内容插入到当前章节。',
        preview: {
          title: requiresProposal ? '替换正文选区' : mode === 'append' ? '追加到章节末尾' : '插入章节正文',
          summary: requiresProposal ? '准备使用 AI 内容替换当前选中的正文片段。' : mode === 'append' ? '准备把 AI 内容追加到章节末尾。' : '准备把 AI 内容插入当前章节。',
          after: insertion.slice(0, 220)
        },
        destructive: requiresProposal,
        requiresConfirmation: requiresProposal,
        content: insertion,
        mode
      }))
      if (requiresProposal) {
        message.success('已发送替换提议，请在确认卡片中决定是否执行')
        return
      }
      if (mode === 'append') {
        message.success('AI 内容已发送到主窗口并准备追加到正文末尾')
        return
      }
      message.success('AI 内容已发送到主窗口，等待插入正文')
      return
    }

    if (requiresProposal) {
      appStore.handleAssistantCommand({
        type: 'insert-into-chapter',
        kind: 'proposal',
        target: 'chapter-content',
        reason: '这会替换正文中的当前选区，需要你确认后再执行。',
        preview: {
          title: '替换正文选区',
          summary: '准备使用 AI 内容替换当前选中的正文片段。',
          after: insertion.slice(0, 220)
        },
        destructive: true,
        requiresConfirmation: true,
        content: insertion,
        mode
      })
      message.info('已生成替换提议，请先确认')
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
    message.success('AI 内容已插入正文')
  }

  function handleUseAsSummary(content: string): void {
    const nextSummary = content.trim()
    if (!appStore.selectedChapter || !nextSummary) {
      message.warning('当前没有可更新摘要的章节')
      return
    }

    const commandPayload = {
      type: 'update-chapter-summary' as const,
      kind: 'proposal' as const,
      target: 'chapter-summary' as const,
      reason: '这会覆盖当前章节摘要，建议确认后再写入。',
      preview: {
        title: '更新章节摘要',
        summary: '准备使用 AI 生成内容覆盖当前章节摘要。',
        before: appStore.selectedChapter.summary,
        after: nextSummary.slice(0, 220)
      },
      destructive: true,
      requiresConfirmation: true,
      value: nextSummary
    }

    if (isAssistantWindow) {
      void window.characterArc.publishAssistantCommand(toIpcPayload(commandPayload))
      message.success('已发送摘要更新提议，请先确认')
      return
    }

    appStore.handleAssistantCommand(commandPayload)
    message.info('已生成摘要更新提议，请先确认')
  }

  function handleUseAsTitle(content: string): void {
    const nextTitle = content
      .split('\n').map((line) => line.trim()).find(Boolean)
      ?.replace(/^[-*#\d.\s]+/, '')
      .replace(/^标题[:：]\s*/, '')
      .replace(/[「」"'“”‘’]/g, '')
      .trim()
    if (!appStore.selectedChapter || !nextTitle) {
      message.warning('当前没有可更新标题的章节')
      return
    }

    const commandPayload = {
      type: 'update-chapter-title' as const,
      kind: 'proposal' as const,
      target: 'chapter-title' as const,
      reason: '这会覆盖当前章节标题，建议确认后再写入。',
      preview: {
        title: '更新章节标题',
        summary: '准备使用 AI 生成内容覆盖当前章节标题。',
        before: appStore.selectedChapter.title,
        after: nextTitle
      },
      destructive: true,
      requiresConfirmation: true,
      value: nextTitle
    }

    if (isAssistantWindow) {
      void window.characterArc.publishAssistantCommand(toIpcPayload(commandPayload))
      message.success('已发送标题更新提议，请先确认')
      return
    }

    appStore.handleAssistantCommand(commandPayload)
    message.info('已生成标题更新提议，请先确认')
  }

  function handleMoreAction(key: string, content: string): void {
    switch (key as AssistantMessageActionKey) {
      case 'replace-selection':
        handleInsert(content, 'replace-selection')
        break
      case 'append':
        handleInsert(content, 'append')
        break
      case 'set-title':
        handleUseAsTitle(content)
        break
      case 'set-summary':
        handleUseAsSummary(content)
        break
    }
  }

  function handleRegenerate(): void {
    const prompt = lastUserPrompt.value
    if (!prompt || isResponding.value) return
    void sendPrompt(prompt.prompt, prompt.quickAction)
  }

  async function handleStopResponse(): Promise<void> {
    if (!activeStreamId.value || isStopping.value) return
    isStopping.value = true
    const result = await window.characterArc.stopAiStream(activeStreamId.value)
    if (!result.success) {
      isStopping.value = false
      message.error(result.error ?? '停止生成失败')
    }
  }

  async function handleApproveProposal(): Promise<void> {
    if (!activeAgentProposal.value) {
      return
    }

    if (isAssistantWindow) {
      const result = await window.characterArc.approveAssistantProposal()
      if (!result.success) {
        message.error(result.error ?? '确认 proposal 失败')
        return
      }
      message.success('已发送确认请求')
      return
    }

    appStore.approveActiveAgentProposal()
    appStore.clearActiveAgentProposal()
    message.success('已执行提议动作')
  }

  async function handleRejectProposal(): Promise<void> {
    if (!activeAgentProposal.value) {
      return
    }

    if (isAssistantWindow) {
      const result = await window.characterArc.rejectAssistantProposal()
      if (!result.success) {
        message.error(result.error ?? '拒绝 proposal 失败')
        return
      }
      message.info('已发送取消请求')
      return
    }

    appStore.rejectActiveAgentProposal()
    message.info('已取消当前提议')
  }

  async function handleClearProposal(): Promise<void> {
    if (isAssistantWindow) {
      const result = await window.characterArc.clearAssistantProposal()
      if (!result.success) {
        message.error(result.error ?? '关闭 proposal 卡片失败')
        return
      }
      return
    }

    appStore.clearActiveAgentProposal()
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendPrompt()
    }
  }

  function handleAiStreamEvent(payload: CharacterArcAiStreamEvent): void {
    if (payload.streamId !== activeStreamId.value) return

    if (payload.type === 'chunk') {
      streamingReply.value += payload.delta
      void scrollToBottom()
      return
    }

    if (payload.type === 'done') {
      const finalReply = normalizeAssistantReply(resolveCompletedReplyContent(payload.content))
      if (finalReply) {
        void appendConversationMessage('assistant', finalReply)
      }
      resetStreamingState()
      void scrollToBottom()
      return
    }

    if (payload.type === 'canceled') {
      const partialReply = normalizeAssistantReply(resolveCompletedReplyContent(payload.content))
      if (partialReply) {
        void appendConversationMessage('assistant', partialReply)
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
    if (activeStreamId.value) void window.characterArc.stopAiStream(activeStreamId.value)
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
      if (!request || busy) return
      await sendPrompt(request.prompt, request.quickAction)
      appStore.consumeAssistantPrompt(request.id)
    },
    { deep: true }
  )

  return {
    appStore,
    draft,
    isResponding,
    isStopping,
    activeStreamId,
    streamingReply,
    responseMode,
    responseLength,
    currentProject,
    currentChapter,
    writingStyle,
    selectedExcerpt,
    relatedChapters,
    volumeChapterSummaries,
    novelOpenerSummary,
    recentAssistantMessages,
    lastUserPrompt,
    quickActions,
    recentAiRuns,
    recentAiRunsDisplay,
    latestAiRun,
    latestAiRunKnowledge,
    latestAiRunStatusText,
    hasSelection,
    activeAgentProposal,
    agentConfirmationState,
    agentExecutionStep,
    renderMarkdown,
    sendPrompt,
    handleQuickAction,
    handleInsert,
    handleUseAsSummary,
    handleUseAsTitle,
    handleMoreAction,
    handleApproveProposal,
    handleRejectProposal,
    handleClearProposal,
    handleRegenerate,
    handleStopResponse,
    handleComposerKeydown,
    scrollToBottom,
    resetStreamingState
  }
}
