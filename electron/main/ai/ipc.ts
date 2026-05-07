import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AiTaskPayload, AppSettings } from './shared-types'
import { runAiTask, streamAiTask, testAiConnection, fetchModels } from './runtime'
import { retrieveKnowledgeContext } from '../knowledge-retrieval'

type AiIpcDeps = {
  getLatestWorkspaceSnapshot: () => { workspaces?: Record<string, { knowledgeDocuments?: unknown[]; aiRuns?: unknown[] }> } | null
  emitAiRunEvent: (payload: { projectId: string; meta: Record<string, unknown> }) => void
}

let deps: AiIpcDeps | null = null
const activeAiStreams = new Map<string, AbortController>()

export function registerAiIpcHandlers(injectedDeps: AiIpcDeps): void {
  deps = injectedDeps

  ipcMain.handle('characterarc:ai-generate', async (_event, payload: AiTaskPayload) => {
    const knowledgeContext = retrieveKnowledgeContext(payload, deps!.getLatestWorkspaceSnapshot() as Parameters<typeof retrieveKnowledgeContext>[1])
    try {
      const response = await runAiTask(payload, knowledgeContext)
      if (response.meta.projectId) {
        deps!.emitAiRunEvent({ projectId: response.meta.projectId, meta: { id: randomUUID(), ...response.meta } })
      }
      // 只把内层 AiTaskResult 返给 renderer；meta 通过 ai-run-event 单独广播。
      // renderer 全部约定为 `(result.result as <Type>).field`，不能再多包一层 wrapper。
      return { success: true, result: response.result }
    } catch (error) {
      const aiRunMeta = error && typeof error === 'object' && 'aiRunMeta' in error
        ? (error as { aiRunMeta?: Record<string, unknown> }).aiRunMeta : undefined
      if (aiRunMeta && (aiRunMeta as { projectId?: string }).projectId) {
        deps!.emitAiRunEvent({ projectId: String((aiRunMeta as { projectId?: string }).projectId), meta: { id: randomUUID(), ...aiRunMeta } })
      }
      return { success: false, error: error instanceof Error ? error.message : 'AI 调用失败' }
    }
  })

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
                  event.sender.send('characterarc:ai-stream-event', { streamId, type: 'chunk', delta })
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
          }
          if (!event.sender.isDestroyed()) {
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

  ipcMain.handle('characterarc:ai-stream-stop', async (_event, streamId: unknown) => {
    const key = typeof streamId === 'string' ? streamId : ''
    const controller = activeAiStreams.get(key)
    if (!controller) return { success: false, error: '当前没有可停止的生成任务' }
    controller.abort()
    return { success: true }
  })

  ipcMain.handle('characterarc:ai-test-connection', async (_event, settings: unknown) => {
    try {
      const result = await testAiConnection(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'AI 连接测试失败' }
    }
  })

  ipcMain.handle('characterarc:ai-fetch-models', async (_event, settings: unknown) => {
    try {
      const result = await fetchModels(settings as AppSettings)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取模型列表失败' }
    }
  })
}
