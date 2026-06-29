import { buildStoryStateContext, applyStateDelta } from '../story-state-store'
import { extractStateDeltaViaLLMWithDiagnostics } from './runtime/orchestrator'
import type { AiRunUsage, AppSettings } from './shared-types'
import { ensureWorkspaceDb } from '../workspace-store'
import { normalizeSettings, validateSettings } from './settings'

/**
 * 状态补录进度回调的 payload 类型。
 * 通过 IPC 广播给前端进度面板。
 */
export type BackfillProgressPayload = {
  projectId: string
  /** 当前处理到第几章 */
  current: number
  /** 总章节数 */
  total: number
  chapterTitle: string
  /** 当前阶段：提取状态差异 / 写入状态表 / 完成 */
  phase: 'extracting' | 'applying' | 'skipped' | 'failed' | 'done'
  message?: string
}

/**
 * 状态补录的最终结果汇总。
 */
export type BackfillResult = {
  totalChapters: number
  /** 成功提取并写入状态的章节数 */
  processedChapters: number
  /** 因提取失败或内容不足而跳过的章节数 */
  skipped: number
  /** 因 AI 调用、解析或状态写入失败的章节数 */
  failed: number
  errors: Array<{ chapterTitle: string; message: string }>
}

export type BackfillChapterRunPayload = {
  projectId: string
  chapterId: string
  chapterTitle: string
  startedAt: string
  finishedAt: string
  status: 'success' | 'error'
  usage?: AiRunUsage
  responsePreview: string
  error: string
  settings: AppSettings
}

export type BackfillOptions = {
  onChapterRun?: (payload: BackfillChapterRunPayload) => void
}

/**
 * 遍历项目现存章节，逐章调用状态提取器并写入 `story_character_state` 等状态表。
 * 用于为"已有章节但状态库为空"的项目补录结构化世界状态。
 */
export async function backfillProjectStateFromChapters(
  settings: AppSettings,
  projectId: string,
  onProgress: (p: BackfillProgressPayload) => void,
  options: BackfillOptions = {}
): Promise<BackfillResult> {
  const normalizedSettings = normalizeSettings(settings)
  validateSettings(normalizedSettings)
  const db = await ensureWorkspaceDb()

  const chapters = db.prepare(`
    SELECT id, title, content, sort_order AS sortOrder
    FROM chapters
    WHERE project_id = ? AND content IS NOT NULL AND LENGTH(content) >= 50
    ORDER BY sort_order ASC
  `).all(projectId) as Array<{ id: string; title: string; content: string; sortOrder: number }>

  let processed = 0
  let skipped = 0
  let failed = 0
  const errors: BackfillResult['errors'] = []

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const chapterTitle = ch.title || `第 ${i + 1} 章`
    onProgress({ projectId, current: i + 1, total: chapters.length, chapterTitle, phase: 'extracting' })
    const startedAt = new Date().toISOString()

    try {
      const preState = buildStoryStateContext(db, projectId, [])
      const deltaResult = await extractStateDeltaViaLLMWithDiagnostics(normalizedSettings, ch.content, preState)
      const delta = deltaResult.delta
      if (delta) {
        onProgress({ projectId, current: i + 1, total: chapters.length, chapterTitle, phase: 'applying' })
        applyStateDelta(db, projectId, ch.sortOrder, delta)
        processed++
        options.onChapterRun?.({
          projectId,
          chapterId: ch.id,
          chapterTitle,
          startedAt,
          finishedAt: new Date().toISOString(),
          status: 'success',
          usage: deltaResult.usage,
          responsePreview: deltaResult.rawText || JSON.stringify(delta),
          error: '',
          settings: normalizedSettings
        })
      } else if (deltaResult.issue) {
        const message = deltaResult.issue.detail || deltaResult.issue.message
        failed++
        errors.push({ chapterTitle, message })
        onProgress({ projectId, current: i + 1, total: chapters.length, chapterTitle, phase: 'failed', message })
        options.onChapterRun?.({
          projectId,
          chapterId: ch.id,
          chapterTitle,
          startedAt,
          finishedAt: new Date().toISOString(),
          status: 'error',
          usage: deltaResult.usage,
          responsePreview: deltaResult.rawText || '',
          error: message,
          settings: normalizedSettings
        })
      } else {
        const message = 'AI 未提取到可写入的状态变更。'
        onProgress({ projectId, current: i + 1, total: chapters.length, chapterTitle, phase: 'skipped', message })
        skipped++
        options.onChapterRun?.({
          projectId,
          chapterId: ch.id,
          chapterTitle,
          startedAt,
          finishedAt: new Date().toISOString(),
          status: 'success',
          responsePreview: message,
          error: '',
          settings: normalizedSettings
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '状态补录失败'
      failed++
      errors.push({ chapterTitle, message })
      onProgress({ projectId, current: i + 1, total: chapters.length, chapterTitle, phase: 'failed', message })
      options.onChapterRun?.({
        projectId,
        chapterId: ch.id,
        chapterTitle,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'error',
        responsePreview: '',
        error: message,
        settings: normalizedSettings
      })
    }
  }

  onProgress({ projectId, current: chapters.length, total: chapters.length, chapterTitle: '', phase: 'done' })
  return { totalChapters: chapters.length, processedChapters: processed, skipped, failed, errors }
}
