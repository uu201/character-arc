import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AiTaskPayload, AppSettings, ChapterPostGenerationIssuesPayload, ChapterPostGenerationTaskPayload, ChapterStateWarningsPayload } from './shared-types'
import { runAiTask, streamAiTask, testAiConnection, fetchModels, fetchImageModels, generateImage } from './runtime'
import { runStreamingAgentTask } from './agent/streaming-orchestrator'
import { isToolUseNotSupportedError } from './provider'
import { setChapterPostGenerationIssuesEmitter, setChapterPostGenerationTaskEmitter, setChapterWarningsEmitter } from './runtime/orchestrator'
import { retrieveKnowledgeContext } from './knowledge-retrieval'
import { buildRunMeta } from './runtime/run-meta'
import { backfillProjectStateFromChapters, getProjectBackfillChapterStatuses } from './state-backfill'
import type { BackfillTaskSnapshot } from './state-backfill'
import type { BackfillSelection } from './state-backfill'
import { BackfillTaskPauseController } from './state-backfill-task-controller'
import { buildStoryStateContext } from '../story-state-store'
import { ensureWorkspaceDb } from '../workspace-store'
import { runSpiralBootstrap } from './spiral'
import type { SpiralBootstrapInput } from './spiral'
import { formatAiErrorMessage } from './error-message'
import { testProxyConnection } from './proxy-fetch'
import { normalizeSettings } from './settings'
import { isCodexCliProvider, shouldTryStreamingAgent } from '@shared/ai-provider-catalog'

/**
 * AI IPC 模块的外部依赖注入接口。
 * 由主进程初始化时提供，用于获取工作区快照和广播事件。
 */
type AiIpcDeps = {
  /** 获取最新工作区快照（知识文档、AI 运行记录等） */
  getLatestWorkspaceSnapshot: () => { knowledgeDocuments?: unknown[]; workspaces?: Record<string, { aiRuns?: unknown[] }> } | null
  /** 向 renderer 广播 AI 运行事件 */
  emitAiRunEvent: (payload: { projectId: string; meta: Record<string, unknown> }) => void
  /** 向 renderer 广播章节状态告警事件 */
  emitChapterStateWarnings: (payload: ChapterStateWarningsPayload) => void
  /** 向 renderer 广播章节生成后处理问题事件 */
  emitChapterPostGenerationIssues: (payload: ChapterPostGenerationIssuesPayload) => void
  /** 向 renderer 广播章节生成后处理任务生命周期 */
  emitChapterPostGenerationTask: (payload: ChapterPostGenerationTaskPayload) => void
}

/** 注入的外部依赖，registerAiIpcHandlers 调用时初始化 */
let deps: AiIpcDeps | null = null

/** 流式任务的 AbortController（按 streamId 索引） */
const activeAiStreams = new Map<string, AbortController>()

/**
 * 非流式任务的 AbortController（按 clientTaskId 索引）。
 * 前端 `runTrackedAiTask` 发起请求时带上 `clientTaskId`，
 * 超时或用户手动取消时通过 `characterarc:ai-cancel` 通道 abort。
 */
const activeAiTasks = new Map<string, AbortController>()
type BackfillTaskRecord = {
  controller: BackfillTaskPauseController
  snapshot: BackfillTaskSnapshot
}
const backfillTasks = new Map<string, BackfillTaskRecord>()

function isActiveBackfillTask(snapshot: BackfillTaskSnapshot): boolean {
  return snapshot.status === 'running' || snapshot.status === 'pausing' || snapshot.status === 'paused'
}

function broadcastBackfillTask(snapshot: BackfillTaskSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('characterarc:ai-backfill-state-progress', snapshot)
    }
  }
}

function updateBackfillTask(
  record: BackfillTaskRecord,
  patch: Partial<BackfillTaskSnapshot>
): BackfillTaskSnapshot {
  record.snapshot = {
    ...record.snapshot,
    ...patch,
    updatedAt: new Date().toISOString()
  }
  broadcastBackfillTask(record.snapshot)
  return record.snapshot
}

/**
 * 注册所有 AI 相关的 IPC handler。
 * 包括非流式生成、流式生成、Agent 生成、连接测试、模型列表、图片生成、
 * 世界状态读取、章节版本读取、螺旋生成、状态补录等。
 *
 * @param injectedDeps - 外部依赖注入
 */
export function registerAiIpcHandlers(injectedDeps: AiIpcDeps): void {
  deps = injectedDeps
  setChapterWarningsEmitter((payload) => deps?.emitChapterStateWarnings(payload))
  setChapterPostGenerationIssuesEmitter((payload) => deps?.emitChapterPostGenerationIssues(payload))
  setChapterPostGenerationTaskEmitter((payload) => deps?.emitChapterPostGenerationTask(payload))

  // ── 非流式 AI 生成（支持 abort） ──
  ipcMain.handle('characterarc:ai-generate', async (_event, payload: AiTaskPayload) => {
    const clientTaskId = payload.clientTaskId || ''
    const controller = new AbortController()
    if (clientTaskId) {
      activeAiTasks.set(clientTaskId, controller)
    }

    const knowledgeContext = retrieveKnowledgeContext(payload, deps!.getLatestWorkspaceSnapshot() as Parameters<typeof retrieveKnowledgeContext>[1])
    try {
      if (controller.signal.aborted) {
        throw new Error('任务已被取消。')
      }

      const response = await runAiTask(payload, knowledgeContext, controller.signal)

      deps!.emitAiRunEvent({ projectId: response.meta.projectId ?? '', meta: { id: randomUUID(), ...response.meta } })
      return { success: true, result: response.result }
    } catch (error) {
      const aiRunMeta = error && typeof error === 'object' && 'aiRunMeta' in error
        ? (error as { aiRunMeta?: Record<string, unknown> }).aiRunMeta : undefined
      if (aiRunMeta) {
        deps!.emitAiRunEvent({ projectId: String((aiRunMeta as { projectId?: string }).projectId ?? ''), meta: { id: randomUUID(), ...aiRunMeta } })
      }
      return { success: false, error: formatAiErrorMessage(error, 'AI 调用失败') }
    } finally {
      if (clientTaskId) {
        activeAiTasks.delete(clientTaskId)
      }
    }
  })

  // ── 取消非流式任务 ──
  ipcMain.handle('characterarc:ai-cancel', async (_event, clientTaskId: unknown) => {
    const key = typeof clientTaskId === 'string' ? clientTaskId : ''
    const controller = activeAiTasks.get(key)
    if (!controller) return { success: false, error: '未找到对应的运行中任务' }
    controller.abort()
    return { success: true }
  })

  // ── 流式 AI 生成（支持自动升级到 Agent 路径） ──
  ipcMain.handle('characterarc:ai-stream-start', async (event, payload: AiTaskPayload) => {
    try {
      const streamId = `stream-${randomUUID()}`
      const controller = new AbortController()
      const knowledgeContext = retrieveKnowledgeContext(payload, deps!.getLatestWorkspaceSnapshot() as Parameters<typeof retrieveKnowledgeContext>[1])
      activeAiStreams.set(streamId, controller)
      const normalizedSettings = normalizeSettings(payload.settings)

      const shouldTryAgent = shouldTryStreamingAgent(
        payload.task,
        normalizedSettings.provider,
        normalizedSettings.model,
        normalizedSettings.apiProtocol
      )

      let streamedContent = ''
      void (async () => {
        try {
          if (shouldTryAgent) {
            try {
              const result = await runStreamingAgentTask(
                payload,
                {
                  onTextDelta: (delta) => {
                    streamedContent += delta
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'chunk', delta, charCount: streamedContent.length })
                    }
                  },
                  onReasoningDelta: (delta) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'reasoning', delta })
                    }
                  },
                  onToolUseStart: (toolUseId, toolName, args) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'tool_use_start', toolUseId, toolName, args })
                    }
                  },
                  onToolResult: (toolUseId, toolName, content, isError, durationMs) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'tool_result', toolUseId, toolName, content, isError, durationMs })
                    }
                  },
                  onAgentStatus: (message, iteration, maxIterations) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'agent_status', message, iteration, maxIterations })
                    }
                  },
                  onEditApplied: (chapterId, editType, preview, versionId) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'edit_applied', chapterId, editType, preview, versionId })
                    }
                  },
                  onEditProposed: (chapterId, proposalId, editType, preview, oldContent, newContent) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'edit_proposed', chapterId, proposalId, editType, preview, oldContent, newContent })
                    }
                  }
                },
                controller.signal,
                knowledgeContext
              )
              deps!.emitAiRunEvent({ projectId: result.meta.projectId ?? '', meta: { id: randomUUID(), ...result.meta } })
              if (!event.sender.isDestroyed()) {
                event.sender.send('characterarc:ai-stream-event', {
                  streamId,
                  type: 'done',
                  content: (result.result as { content?: string }).content ?? streamedContent,
                  result: result.result
                })
              }
              return
            } catch (agentError) {
              if (!isToolUseNotSupportedError(agentError)) throw agentError
              streamedContent = ''
            }
          }

          const result = await streamAiTask(
            payload,
            {
              onTextDelta: (delta: string) => {
                streamedContent += delta
                if (!event.sender.isDestroyed()) {
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'chunk', delta, charCount: streamedContent.length })
                }
              },
              onReasoningDelta: (delta: string) => {
                if (!event.sender.isDestroyed()) {
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'reasoning', delta })
                }
              }
            },
            controller.signal,
            knowledgeContext
          )
          deps!.emitAiRunEvent({ projectId: result.meta.projectId ?? '', meta: { id: randomUUID(), ...result.meta } })
          if (!event.sender.isDestroyed()) {
            event.sender.send('characterarc:ai-stream-event', {
              streamId,
              type: 'done',
              content: (result.result as { content?: string }).content ?? streamedContent,
              result: result.result
            })
          }
        } catch (error) {
          const aiRunMeta = error && typeof error === 'object' && 'aiRunMeta' in error
            ? (error as { aiRunMeta?: Record<string, unknown> }).aiRunMeta : undefined
          if (aiRunMeta) {
            deps!.emitAiRunEvent({ projectId: String((aiRunMeta as { projectId?: string }).projectId ?? ''), meta: { id: randomUUID(), ...aiRunMeta } })
          }
          if (!event.sender.isDestroyed()) {
            event.sender.send('characterarc:ai-stream-event', controller.signal.aborted
              ? { streamId, type: 'canceled', content: streamedContent }
              : { streamId, type: 'error', error: formatAiErrorMessage(error, 'AI 流式调用失败') }
            )
          }
        } finally {
          activeAiStreams.delete(streamId)
        }
      })()

      return { success: true, result: { streamId } }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, 'AI 流式调用启动失败') }
    }
  })

  // ── 停止流式任务 ──
  ipcMain.handle('characterarc:ai-stream-stop', async (event, streamId: unknown) => {
    const key = typeof streamId === 'string' ? streamId : ''
    const controller = activeAiStreams.get(key)
    if (!controller) return { success: false, error: '当前没有可停止的生成任务' }
    controller.abort()

    // 发送 canceled 事件给前端，确保用户看到停止反馈
    if (!event.sender.isDestroyed()) {
      event.sender.send('characterarc:ai-stream-event', { streamId: key, type: 'canceled', content: '' })
    }

    return { success: true }
  })

  // ── Agent 流式生成（带工具调用） ──
  ipcMain.handle('characterarc:ai-agent-stream-start', async (event, payload: AiTaskPayload) => {
    try {
      const streamId = `agent-${randomUUID()}`
      const controller = new AbortController()
      const knowledgeContext = retrieveKnowledgeContext(payload, deps!.getLatestWorkspaceSnapshot() as Parameters<typeof retrieveKnowledgeContext>[1])
      activeAiStreams.set(streamId, controller)
      let streamedContent = ''
      void (async () => {
        try {
          const normalizedSettings = normalizeSettings(payload.settings)
          if (!isCodexCliProvider(normalizedSettings.provider)) {
            try {
              const result = await runStreamingAgentTask(
                payload,
                {
                  onTextDelta: (delta) => {
                    streamedContent += delta
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'chunk', delta, charCount: streamedContent.length })
                    }
                  },
                  onReasoningDelta: (delta) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'reasoning', delta })
                    }
                  },
                  onToolUseStart: (toolUseId, toolName, args) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'tool_use_start', toolUseId, toolName, args })
                    }
                  },
                  onToolResult: (toolUseId, toolName, content, isError, durationMs) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'tool_result', toolUseId, toolName, content, isError, durationMs })
                    }
                  },
                  onAgentStatus: (message, iteration, maxIterations) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'agent_status', message, iteration, maxIterations })
                    }
                  },
                  onEditApplied: (chapterId, editType, preview, versionId) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'edit_applied', chapterId, editType, preview, versionId })
                    }
                  },
                  onEditProposed: (chapterId, proposalId, editType, preview, oldContent, newContent) => {
                    if (!event.sender.isDestroyed()) {
                      event.sender.send('characterarc:ai-stream-event', { streamId, type: 'edit_proposed', chapterId, proposalId, editType, preview, oldContent, newContent })
                    }
                  }
                },
                controller.signal,
                knowledgeContext
              )
              deps!.emitAiRunEvent({ projectId: result.meta.projectId ?? '', meta: { id: randomUUID(), ...result.meta } })
              if (!event.sender.isDestroyed()) {
                event.sender.send('characterarc:ai-stream-event', { streamId, type: 'done', content: streamedContent, result: result.result })
              }
              return
            } catch (agentError) {
              if (!isToolUseNotSupportedError(agentError)) throw agentError
              streamedContent = ''
            }
          }

          const result = await streamAiTask(
            payload,
            {
              onTextDelta: (delta: string) => {
                streamedContent += delta
                if (!event.sender.isDestroyed()) {
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'chunk', delta, charCount: streamedContent.length })
                }
              },
              onReasoningDelta: (delta: string) => {
                if (!event.sender.isDestroyed()) {
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'reasoning', delta })
                }
              }
            },
            controller.signal,
            knowledgeContext
          )
          deps!.emitAiRunEvent({ projectId: result.meta.projectId ?? '', meta: { id: randomUUID(), ...result.meta } })
          if (!event.sender.isDestroyed()) {
            event.sender.send('characterarc:ai-stream-event', {
              streamId,
              type: 'done',
              content: (result.result as { content?: string }).content ?? streamedContent,
              result: result.result
            })
          }
        } catch (error) {
          if (!event.sender.isDestroyed()) {
            event.sender.send('characterarc:ai-stream-event', controller.signal.aborted
              ? { streamId, type: 'canceled', content: streamedContent }
              : { streamId, type: 'error', error: formatAiErrorMessage(error, 'AI Agent 调用失败') }
            )
          }
        } finally {
          activeAiStreams.delete(streamId)
        }
      })()

      return { success: true, result: { streamId } }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, 'AI Agent 启动失败') }
    }
  })

  // ── 连接测试 ──
  ipcMain.handle('characterarc:ai-test-connection', async (_event, settings: unknown) => {
    try {
      const result = await testAiConnection(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, 'AI 连接测试失败') }
    }
  })

  ipcMain.handle('characterarc:ai-test-proxy', async (_event, proxyUrl: unknown) => {
    try {
      const result = await testProxyConnection(String(proxyUrl ?? ''))
      return { success: true, result }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '代理连接测试失败') }
    }
  })

  // ── 模型列表 ──
  ipcMain.handle('characterarc:ai-fetch-models', async (_event, settings: unknown) => {
    try {
      const result = await fetchModels(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '获取模型列表失败') }
    }
  })

  ipcMain.handle('characterarc:ai-fetch-image-models', async (_event, settings: unknown) => {
    try {
      const result = await fetchImageModels(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '获取图片模型列表失败') }
    }
  })

  // ── 图片生成 ──
  ipcMain.handle('characterarc:ai-generate-image', async (_event, payload: unknown) => {
    const request = payload as { settings?: AppSettings; prompt?: string; projectId?: string }
    const projectId = String(request?.projectId ?? '').trim()
    const settings = request?.settings as AppSettings
    const startedAt = new Date().toISOString()
    // 运行记录里展示图片模型（封面专用模型与文本模型分开配置）。
    const metaSettings = { ...settings, model: settings?.imageModel?.trim() || settings?.model } as AppSettings
    try {
      const prompt = String(request?.prompt ?? '').trim()
      if (!prompt) {
        throw new Error('图片生成提示词不能为空。')
      }
      const result = await generateImage(settings, prompt)

      const meta = buildRunMeta(
        'cover-generate', projectId ?? '', undefined, metaSettings, 'success',
        startedAt, new Date().toISOString(),
        result.usage,
        [], [],
        false, result.revisedPrompt ?? '封面图片已生成', ''
      )
      deps!.emitAiRunEvent({ projectId: projectId ?? '', meta: { id: randomUUID(), ...meta } })
      return { success: true, result }
    } catch (error) {
      const message = formatAiErrorMessage(error, '图片生成失败')
      const meta = buildRunMeta(
        'cover-generate', projectId ?? '', undefined, metaSettings, 'error',
        startedAt, new Date().toISOString(),
        undefined,
        [], [],
        false, '', message
      )
      deps!.emitAiRunEvent({ projectId: projectId ?? '', meta: { id: randomUUID(), ...meta } })
      return { success: false, error: message }
    }
  })

  // ── 读取当前项目的结构化世界状态（供前端状态面板展示） ──
  ipcMain.handle('characterarc:ai-read-story-state', async (_event, projectId: unknown) => {
    try {
      const id = String(projectId ?? '').trim()
      if (!id) throw new Error('缺少 projectId。')
      const db = await ensureWorkspaceDb()
      const context = buildStoryStateContext(db, id, [], { foreshadowingLimit: null })
      return { success: true, result: context }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '读取世界状态失败') }
    }
  })

  // ── 读取章节版本（供 agent 编辑撤销） ──
  ipcMain.handle('characterarc:ai-read-chapter-version', async (_event, payload: unknown) => {
    try {
      const req = payload as { projectId?: string; versionId?: string }
      const projectId = String(req?.projectId ?? '').trim()
      const versionId = String(req?.versionId ?? '').trim()
      if (!projectId || !versionId) throw new Error('缺少 projectId 或 versionId。')
      const db = await ensureWorkspaceDb()
      const row = db.prepare(
        'SELECT id, chapter_id, title, summary, status, word_target, content, created_at FROM chapter_versions WHERE id = ? AND project_id = ?'
      ).get(versionId, projectId) as Record<string, unknown> | undefined
      if (!row) throw new Error('版本不存在')
      return { success: true, result: { id: row.id, chapterId: row.chapter_id, title: row.title, summary: row.summary, status: row.status, wordTarget: row.word_target, content: row.content, createdAt: row.created_at } }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '读取版本失败') }
    }
  })

  // ── 读取单个章节内容（供 agent 编辑后前端刷新） ──
  ipcMain.handle('characterarc:ai-read-chapter', async (_event, payload: unknown) => {
    try {
      const req = payload as { projectId?: string; chapterId?: string }
      const projectId = String(req?.projectId ?? '').trim()
      const chapterId = String(req?.chapterId ?? '').trim()
      if (!projectId || !chapterId) throw new Error('缺少 projectId 或 chapterId。')
      const db = await ensureWorkspaceDb()
      const row = db.prepare(
        'SELECT id, title, summary, status, word_target, content FROM chapters WHERE id = ? AND project_id = ?'
      ).get(chapterId, projectId) as Record<string, unknown> | undefined
      if (!row) throw new Error('章节不存在')
      return { success: true, result: { id: row.id, title: row.title, summary: row.summary, status: row.status, wordTarget: row.word_target, content: row.content } }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '读取章节失败') }
    }
  })

  // ── 螺旋式深度生成 ──
  /** 当前进行中的螺旋生成任务的 AbortController */
  let activeSpiralController: AbortController | null = null

  ipcMain.handle('characterarc:ai-spiral-bootstrap', async (event, payload: unknown) => {
    const controller = new AbortController()
    activeSpiralController = controller
    try {
      const request = payload as Partial<SpiralBootstrapInput>
      if (!request.settings) throw new Error('缺少 AI 设置。')
      if (!request.projectPremise?.trim()) throw new Error('缺少小说简介。')

      const input: SpiralBootstrapInput = {
        settings: request.settings,
        projectTitle: request.projectTitle ?? '',
        projectGenre: request.projectGenre ?? '',
        projectNovelLength: request.projectNovelLength === 'short' ? 'short' : 'long',
        projectPremise: request.projectPremise,
        projectId: request.projectId,
        projectSkills: request.projectSkills
      }

      const result = await runSpiralBootstrap(input, (progressEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('characterarc:ai-spiral-progress', progressEvent)
        }
      }, controller.signal, (meta) => {
        deps!.emitAiRunEvent({ projectId: meta.projectId, meta: { id: randomUUID(), ...meta } })
      })

      return { success: true, result }
    } catch (error) {
      if (controller.signal.aborted) {
        return { success: false, error: '螺旋生成已取消' }
      }
      return { success: false, error: formatAiErrorMessage(error, '螺旋生成失败') }
    } finally {
      activeSpiralController = null
    }
  })

  ipcMain.handle('characterarc:ai-spiral-cancel', async () => {
    if (!activeSpiralController) return { success: false, error: '没有正在进行的螺旋生成任务' }
    activeSpiralController.abort()
    return { success: true }
  })

  // ── 已有章节状态补录 ──
  ipcMain.handle('characterarc:ai-backfill-state-status', async (_event, projectId: unknown) => {
    try {
      const normalizedProjectId = String(projectId ?? '').trim()
      if (!normalizedProjectId) throw new Error('缺少 projectId。')
      return { success: true, result: await getProjectBackfillChapterStatuses(normalizedProjectId) }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '读取状态补录进度失败') }
    }
  })

  ipcMain.handle('characterarc:ai-backfill-task-status', (_event, projectId: unknown) => {
    try {
      const normalizedProjectId = String(projectId ?? '').trim()
      if (!normalizedProjectId) throw new Error('缺少 projectId。')
      return { success: true, result: backfillTasks.get(normalizedProjectId)?.snapshot ?? null }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '读取状态补录任务失败') }
    }
  })

  ipcMain.handle('characterarc:ai-backfill-state-pause', (_event, projectId: unknown) => {
    try {
      const normalizedProjectId = String(projectId ?? '').trim()
      const record = backfillTasks.get(normalizedProjectId)
      if (!record || !isActiveBackfillTask(record.snapshot)) {
        throw new Error('该项目没有正在进行的状态补录任务。')
      }
      const status = record.controller.requestPause()
      return {
        success: true,
        result: updateBackfillTask(record, {
          status,
          message: status === 'paused' ? '任务已暂停。' : '将在当前章节处理完成后暂停。'
        })
      }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '暂停状态补录失败') }
    }
  })

  ipcMain.handle('characterarc:ai-backfill-state-resume', (_event, projectId: unknown) => {
    try {
      const normalizedProjectId = String(projectId ?? '').trim()
      const record = backfillTasks.get(normalizedProjectId)
      if (!record || !isActiveBackfillTask(record.snapshot)) {
        throw new Error('该项目没有可继续的状态补录任务。')
      }
      const status = record.controller.resume()
      return {
        success: true,
        result: updateBackfillTask(record, { status, message: '任务已继续。' })
      }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '继续状态补录失败') }
    }
  })

  ipcMain.handle('characterarc:ai-backfill-state', (_event, payload: unknown) => {
    try {
      const request = payload as { settings?: AppSettings; projectId?: string; selection?: BackfillSelection }
      const projectId = String(request?.projectId ?? '').trim()
      if (!projectId) throw new Error('缺少 projectId。')
      if (!request?.settings) throw new Error('缺少 AI 设置。')
      const existing = backfillTasks.get(projectId)
      if (existing && isActiveBackfillTask(existing.snapshot)) {
        throw new Error('该项目已有状态补录任务正在进行。')
      }

      const now = new Date().toISOString()
      const record: BackfillTaskRecord = {
        controller: new BackfillTaskPauseController(),
        snapshot: {
          taskId: randomUUID(),
          projectId,
          status: 'running',
          current: 0,
          total: 0,
          chapterTitle: '',
          phase: 'starting',
          message: '正在准备补录队列...',
          startedAt: now,
          updatedAt: now
        }
      }
      backfillTasks.set(projectId, record)
      broadcastBackfillTask(record.snapshot)

      void backfillProjectStateFromChapters(
        request.settings,
        projectId,
        (progress) => {
          updateBackfillTask(record, {
            current: progress.current,
            total: progress.total,
            chapterTitle: progress.chapterTitle,
            phase: progress.phase,
            message: progress.message
          })
        },
        {
          selection: request.selection,
          waitIfPaused: async (progress) => {
            await record.controller.waitIfPaused((status) => {
              updateBackfillTask(record, {
                ...progress,
                status,
                message: status === 'paused' ? '任务已暂停。' : '任务已继续。'
              })
            })
          },
          onChapterRun: (run) => {
            const meta = buildRunMeta(
              'state-backfill',
              run.projectId,
              run.chapterId,
              run.settings,
              run.status,
              run.startedAt,
              run.finishedAt,
              run.usage,
              [],
              [],
              false,
              run.responsePreview || `状态补录：${run.chapterTitle}`,
              run.error
            )
            deps!.emitAiRunEvent({ projectId: run.projectId, meta: { id: randomUUID(), ...meta } })
          }
        }
      )
        .then((result) => {
          updateBackfillTask(record, {
            status: 'completed',
            phase: 'done',
            current: result.totalChapters,
            total: result.totalChapters,
            chapterTitle: '',
            message: result.failed > 0 ? '状态补录已完成，部分章节失败。' : '状态补录已完成。',
            result,
            error: undefined
          })
        })
        .catch((error) => {
          updateBackfillTask(record, {
            status: 'failed',
            message: formatAiErrorMessage(error, '状态补录失败'),
            error: formatAiErrorMessage(error, '状态补录失败')
          })
        })

      return { success: true, result: record.snapshot }
    } catch (error) {
      return { success: false, error: formatAiErrorMessage(error, '状态补录失败') }
    }
  })
}
