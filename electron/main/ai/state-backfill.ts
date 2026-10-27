import { buildStoryStateContext, applyStateDelta } from '../story-state-store'
import { extractStateDeltaViaLLMWithDiagnostics } from './runtime/orchestrator'
import type { AiRunUsage, AppSettings } from './shared-types'
import { ensureWorkspaceDb } from '../workspace-store'
import { normalizeSettings, validateSettings } from './settings'
import {
  beginBackfillChapter,
  buildBackfillContentHash,
  finishBackfillChapter,
  readBackfillChapterStatuses,
  selectBackfillChapterStatuses
} from './state-backfill-store'
import type { BackfillChapterStatus, BackfillSelection } from './state-backfill-store'
export type { BackfillSelection } from './state-backfill-store'

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

export type BackfillTaskStatus = 'running' | 'pausing' | 'paused' | 'completed' | 'failed'

export type BackfillTaskSnapshot = {
  taskId: string
  projectId: string
  status: BackfillTaskStatus
  current: number
  total: number
  chapterTitle: string
  phase: 'starting' | BackfillProgressPayload['phase']
  message?: string
  startedAt: string
  updatedAt: string
  result?: BackfillResult
  error?: string
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
  selection?: BackfillSelection
  waitIfPaused?: (payload: Omit<BackfillProgressPayload, 'phase' | 'message'>) => Promise<void>
}

export async function getProjectBackfillChapterStatuses(projectId: string): Promise<BackfillChapterStatus[]> {
  const db = await ensureWorkspaceDb()
  return readBackfillChapterStatuses(db, projectId)
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

  const chapterRows = db.prepare(`
    SELECT id, title, content
    FROM chapters
    WHERE project_id = ? AND content IS NOT NULL AND LENGTH(content) >= 50
    ORDER BY sort_order ASC, rowid ASC
  `).all(projectId) as Array<{ id: string; title: string; content: string }>
  const chapterById = new Map(chapterRows.map((chapter) => [chapter.id, chapter]))
  const statuses = readBackfillChapterStatuses(db, projectId)
  const selectedStatuses = selectBackfillChapterStatuses(statuses, options.selection)
  const chapters = selectedStatuses.flatMap((status) => {
    const chapter = chapterById.get(status.chapterId)
    return chapter ? [{ ...chapter, chapterIndex: status.chapterIndex, contentHash: status.contentHash }] : []
  })

  let processed = 0
  let skipped = 0
  let failed = 0
  const errors: BackfillResult['errors'] = []

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const chapterTitle = ch.title || `第 ${ch.chapterIndex + 1} 章`
    await options.waitIfPaused?.({
      projectId,
      current: i + 1,
      total: chapters.length,
      chapterTitle
    })
    onProgress({ projectId, current: i + 1, total: chapters.length, chapterTitle, phase: 'extracting' })
    const startedAt = new Date().toISOString()
    beginBackfillChapter(db, {
      projectId,
      chapterId: ch.id,
      chapterTitle,
      chapterIndex: ch.chapterIndex,
      contentHash: ch.contentHash
    })

    try {
      const preState = buildStoryStateContext(db, projectId, [])
      let deltaResult = await extractStateDeltaViaLLMWithDiagnostics(normalizedSettings, ch.content, preState)
      if (deltaResult.issue) {
        deltaResult = await extractStateDeltaViaLLMWithDiagnostics(normalizedSettings, ch.content, preState)
      }
      const delta = deltaResult.delta
      if (delta) {
        const currentContentRow = db.prepare(`
          SELECT content FROM chapters WHERE project_id = ? AND id = ?
        `).get(projectId, ch.id) as { content?: unknown } | undefined
        const currentContent = typeof currentContentRow?.content === 'string' ? currentContentRow.content : ''
        if (!currentContent || buildBackfillContentHash(currentContent) !== ch.contentHash) {
          throw new Error('章节正文在扫描期间发生变化，本次结果未写入，请重新扫描该章。')
        }
        onProgress({ projectId, current: i + 1, total: chapters.length, chapterTitle, phase: 'applying' })
        applyStateDelta(db, projectId, ch.chapterIndex, delta)
        finishBackfillChapter(db, {
          projectId,
          chapterId: ch.id,
          contentHash: ch.contentHash,
          status: 'success',
          delta
        })
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
        finishBackfillChapter(db, {
          projectId,
          chapterId: ch.id,
          contentHash: ch.contentHash,
          status: 'failed',
          error: message
        })
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
        finishBackfillChapter(db, {
          projectId,
          chapterId: ch.id,
          contentHash: ch.contentHash,
          status: 'skipped'
        })
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
      finishBackfillChapter(db, {
        projectId,
        chapterId: ch.id,
        contentHash: ch.contentHash,
        status: 'failed',
        error: message
      })
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
