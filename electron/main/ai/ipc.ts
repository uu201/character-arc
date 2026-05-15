import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AiTaskPayload, AppSettings, ChapterStateWarningsPayload } from './shared-types'
import { runAiTask, streamAiTask, testAiConnection, fetchModels, fetchImageModels, generateImage } from './runtime'
import { setChapterWarningsEmitter } from './runtime/orchestrator'
import { retrieveKnowledgeContext } from './knowledge-retrieval'
import { backfillProjectStateFromChapters } from './state-backfill'
import { buildStoryStateContext } from '../story-state-store'
import { ensureWorkspaceDb } from '../workspace-store'

type AiIpcDeps = {
  getLatestWorkspaceSnapshot: () => { workspaces?: Record<string, { knowledgeDocuments?: unknown[]; aiRuns?: unknown[] }> } | null
  emitAiRunEvent: (payload: { projectId: string; meta: Record<string, unknown> }) => void
  emitChapterStateWarnings: (payload: ChapterStateWarningsPayload) => void
}

let deps: AiIpcDeps | null = null

/** 流式任务的 AbortController（按 streamId 索引） */
const activeAiStreams = new Map<string, AbortController>()

/**
 * 非流式任务的 AbortController（按 clientTaskId 索引）。
 * 前端 `runTrackedAiTask` 发起请求时带上 `clientTaskId`，
 * 超时或用户手动取消时通过 `characterarc:ai-cancel` 通道 abort。
 */
const activeAiTasks = new Map<string, AbortController>()

export function registerAiIpcHandlers(injectedDeps: AiIpcDeps): void {
  deps = injectedDeps
  setChapterWarningsEmitter((payload) => deps?.emitChapterStateWarnings(payload))

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
      return { success: false, error: error instanceof Error ? error.message : 'AI 调用失败' }
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

  // ── 流式 AI 生成 ──
  ipcMain.handle('characterarc:ai-stream-start', async (event, payload: AiTaskPayload) => {
    try {
      const streamId = `stream-${randomUUID()}`
      const controller = new AbortController()
      const knowledgeContext = retrieveKnowledgeContext(payload, deps!.getLatestWorkspaceSnapshot() as Parameters<typeof retrieveKnowledgeContext>[1])
      activeAiStreams.set(streamId, controller)

      let streamedContent = ''
      void (async () => {
        try {
          const result = await streamAiTask(
            payload,
            {
              onTextDelta: (delta: string) => {
                streamedContent += delta
                if (!event.sender.isDestroyed()) {
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'chunk', delta, charCount: streamedContent.length })
                }
              }
            },
            controller.signal,
            knowledgeContext
          )
          if (result.meta.projectId) {
            deps!.emitAiRunEvent({ projectId: result.meta.projectId, meta: { id: randomUUID(), ...result.meta } })
          }
          if (!event.sender.isDestroyed()) {
            event.sender.send('characterarc:ai-stream-event', { streamId, type: 'done', content: (result.result as { content?: string }).content ?? '' })
          }
        } catch (error) {
          const aiRunMeta = error && typeof error === 'object' && 'aiRunMeta' in error
            ? (error as { aiRunMeta?: Record<string, unknown> }).aiRunMeta : undefined
          if (aiRunMeta && (aiRunMeta as { projectId?: string }).projectId) {
            deps!.emitAiRunEvent({ projectId: String((aiRunMeta as { projectId?: string }).projectId), meta: { id: randomUUID(), ...aiRunMeta } })
          }          if (!event.sender.isDestroyed()) {
            event.sender.send('characterarc:ai-stream-event', controller.signal.aborted
              ? { streamId, type: 'canceled', content: streamedContent }
              : { streamId, type: 'error', error: error instanceof Error ? error.message : 'AI 流式调用失败' }
            )
          }
        } finally {
          activeAiStreams.delete(streamId)
        }
      })()

      return { success: true, result: { streamId } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'AI 流式调用启动失败' }
    }
  })

  // ── 停止流式任务 ──
  ipcMain.handle('characterarc:ai-stream-stop', async (_event, streamId: unknown) => {
    const key = typeof streamId === 'string' ? streamId : ''
    const controller = activeAiStreams.get(key)
    if (!controller) return { success: false, error: '当前没有可停止的生成任务' }
    controller.abort()
    return { success: true }
  })

  // ── 连接测试 ──
  ipcMain.handle('characterarc:ai-test-connection', async (_event, settings: unknown) => {
    try {
      const result = await testAiConnection(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'AI 连接测试失败' }
    }
  })

  // ── 模型列表 ──
  ipcMain.handle('characterarc:ai-fetch-models', async (_event, settings: unknown) => {
    try {
      const result = await fetchModels(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取模型列表失败' }
    }
  })

  ipcMain.handle('characterarc:ai-fetch-image-models', async (_event, settings: unknown) => {
    try {
      const result = await fetchImageModels(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取图片模型列表失败' }
    }
  })

  // ── 图片生成 ──
  ipcMain.handle('characterarc:ai-generate-image', async (_event, payload: unknown) => {
    try {
      const request = payload as { settings?: AppSettings; prompt?: string }
      const prompt = String(request?.prompt ?? '').trim()
      if (!prompt) {
        throw new Error('图片生成提示词不能为空。')
      }
      const result = await generateImage(request.settings as AppSettings, prompt)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '图片生成失败' }
    }
  })

  // ── 读取当前项目的结构化世界状态（供前端状态面板展示） ──
  ipcMain.handle('characterarc:ai-read-story-state', async (_event, projectId: unknown) => {
    try {
      const id = String(projectId ?? '').trim()
      if (!id) throw new Error('缺少 projectId。')
      const db = await ensureWorkspaceDb()
      const context = buildStoryStateContext(db, id, [])
      return { success: true, result: context }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '读取世界状态失败' }
    }
  })

  // ── 已有章节状态补录 ──
  ipcMain.handle('characterarc:ai-backfill-state', async (event, payload: unknown) => {
    try {
      const request = payload as { settings?: AppSettings; projectId?: string }
      const projectId = String(request?.projectId ?? '').trim()
      if (!projectId) throw new Error('缺少 projectId。')
      if (!request?.settings) throw new Error('缺少 AI 设置。')

      const result = await backfillProjectStateFromChapters(request.settings, projectId, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('characterarc:ai-backfill-state-progress', progress)
        }
      })
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '状态补录失败' }
    }
  })
}
