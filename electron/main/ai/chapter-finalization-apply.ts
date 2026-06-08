import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { applyStateDelta } from '../story-state-store'
import type { ChapterFinalizationPreview } from './chapter-finalization'
import {
  normalizeFinalizationPreview,
  validateFinalizationPreview
} from './chapter-finalization'

export interface ApplyChapterFinalizationRequest {
  projectId: string
  chapterId: string
  chapterIndex?: number
  preview: ChapterFinalizationPreview
}

export interface ApplyChapterFinalizationResult {
  chapter: {
    id: string
    title: string
    summary: string
    status: string
    wordTarget: string
    content: string
  }
  version: {
    id: string
    chapterId: string
    title: string
    summary: string
    status: string
    wordTarget: string
    content: string
    createdAt: string
  }
  versionId: string
  nextChapterBridge: string
  appliedStateDelta: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hasStateDeltaContent(preview: ChapterFinalizationPreview): boolean {
  const delta = preview.stateDelta
  if (!delta) return false
  return delta.characters_updated.length > 0
    || delta.relationships_delta.length > 0
    || delta.foreshadowing_delta.planted.length > 0
    || delta.foreshadowing_delta.advanced.length > 0
    || delta.foreshadowing_delta.resolved.length > 0
    || delta.timeline.events.length > 0
    || Boolean(delta.timeline.world_state_changes?.length)
}

export function normalizeApplyChapterFinalizationRequest(value: unknown): ApplyChapterFinalizationRequest {
  const record = asRecord(value)
  const projectId = asString(record.projectId ?? record.project_id)
  const chapterId = asString(record.chapterId ?? record.chapter_id)
  const chapterIndexValue = Number(record.chapterIndex ?? record.chapter_index)
  const preview = normalizeFinalizationPreview(record.preview)

  return {
    projectId,
    chapterId,
    chapterIndex: Number.isFinite(chapterIndexValue) && chapterIndexValue > 0 ? chapterIndexValue : undefined,
    preview
  }
}

export function applyChapterFinalization(
  db: DatabaseSync,
  request: ApplyChapterFinalizationRequest
): ApplyChapterFinalizationResult {
  if (!request.projectId) {
    throw new Error('projectId is required')
  }
  if (!request.chapterId) {
    throw new Error('chapterId is required')
  }
  if (!validateFinalizationPreview(request.preview)) {
    throw new Error('finalization preview is empty')
  }

  const row = db.prepare(`
    SELECT id, title, summary, status, word_target, content, sort_order
    FROM chapters
    WHERE id = ? AND project_id = ?
  `).get(request.chapterId, request.projectId) as Record<string, unknown> | undefined

  if (!row) {
    throw new Error(`Chapter not found: ${request.chapterId}`)
  }

  const content = String(row.content ?? '')
  if (!content.trim()) {
    throw new Error('Chapter content is empty')
  }

  const versionId = randomUUID()
  const timestamp = new Date().toISOString()
  const nextSummary = request.preview.chapterSummary || String(row.summary ?? '')
  const chapterIndex = request.chapterIndex ?? Number(row.sort_order ?? 0) + 1
  const version = {
    id: versionId,
    chapterId: request.chapterId,
    title: String(row.title ?? ''),
    summary: String(row.summary ?? ''),
    status: String(row.status ?? ''),
    wordTarget: String(row.word_target ?? ''),
    content,
    createdAt: timestamp
  }

  db.exec('BEGIN')
  try {
    db.prepare(`
      INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      version.id,
      request.projectId,
      version.chapterId,
      version.title,
      version.summary,
      version.status,
      version.wordTarget,
      version.content,
      version.createdAt
    )

    db.prepare(`
      UPDATE chapters
      SET summary = ?, status = 'final'
      WHERE id = ? AND project_id = ?
    `).run(nextSummary, request.chapterId, request.projectId)

    const shouldApplyStateDelta = Boolean(request.preview.stateDelta && hasStateDeltaContent(request.preview))
    if (request.preview.stateDelta && shouldApplyStateDelta) {
      applyStateDelta(db, request.projectId, chapterIndex, request.preview.stateDelta, { useTransaction: false })
    }

    db.exec('COMMIT')

    return {
      chapter: {
        id: String(row.id ?? ''),
        title: String(row.title ?? ''),
        summary: nextSummary,
        status: 'final',
        wordTarget: String(row.word_target ?? ''),
        content
      },
      version,
      versionId,
      nextChapterBridge: request.preview.nextChapterBridge,
      appliedStateDelta: shouldApplyStateDelta
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
