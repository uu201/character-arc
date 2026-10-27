import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type StoredBackfillStatus = 'running' | 'success' | 'skipped' | 'failed'
export type BackfillChapterDisplayStatus = StoredBackfillStatus | 'unscanned' | 'stale'

export type BackfillChapterStatus = {
  chapterId: string
  chapterTitle: string
  chapterIndex: number
  chapterNumber: number
  contentHash: string
  status: BackfillChapterDisplayStatus
  attemptCount: number
  error: string
  updatedAt: string
}

export type BackfillSelection = {
  mode?: 'pending' | 'failed' | 'custom'
  chapterIds?: string[]
}

export function selectBackfillChapterStatuses(
  statuses: BackfillChapterStatus[],
  selection: BackfillSelection = {}
): BackfillChapterStatus[] {
  const mode = selection.mode ?? 'pending'
  const selectedIds = new Set((selection.chapterIds ?? []).map(String))
  return statuses.filter((status) => {
    if (mode === 'failed') {
      return status.status === 'failed' || status.status === 'running'
    }
    if (mode === 'custom' && !selectedIds.has(status.chapterId)) {
      return false
    }
    return status.status !== 'success' && status.status !== 'skipped'
  })
}

type BackfillRecordRow = {
  project_id: string
  chapter_id: string
  chapter_index: number
  chapter_title: string
  content_hash: string
  status: StoredBackfillStatus
  attempt_count: number
  delta_json: string
  error: string
  updated_at: string
}

type ChapterRow = {
  id: string
  title: string
  content: string
  chapterIndex: number
}

export function buildBackfillContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function initStateBackfillSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_state_backfill_chapters (
      project_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      chapter_title TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      delta_json TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, chapter_id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_story_state_backfill_project_status
      ON story_state_backfill_chapters (project_id, status, chapter_index);
  `)
}

function readChapters(db: DatabaseSync, projectId: string): ChapterRow[] {
  return db.prepare(`
    SELECT id, title, content, chapterIndex
    FROM (
      SELECT id, title, content,
             ROW_NUMBER() OVER (ORDER BY sort_order ASC, rowid ASC) - 1 AS chapterIndex
      FROM chapters
      WHERE project_id = ?
    )
    WHERE content IS NOT NULL AND LENGTH(content) >= 50
    ORDER BY chapterIndex ASC
  `).all(projectId) as ChapterRow[]
}

function readRecords(db: DatabaseSync, projectId: string): Map<string, BackfillRecordRow> {
  const rows = db.prepare(`
    SELECT project_id, chapter_id, chapter_index, chapter_title, content_hash,
           status, attempt_count, delta_json, error, updated_at
    FROM story_state_backfill_chapters
    WHERE project_id = ?
  `).all(projectId) as BackfillRecordRow[]
  return new Map(rows.map((row) => [row.chapter_id, row]))
}

/** 用 1.15 已有的 AI 运行记录初始化扫描状态，避免升级后重复扫描成功章节。 */
export function migrateLegacyBackfillRuns(db: DatabaseSync, projectId: string): void {
  const chapters = readChapters(db, projectId)
  if (!chapters.length) return
  const existing = readRecords(db, projectId)
  const legacyRows = db.prepare(`
    SELECT chapter_id AS chapterId, status, error, finished_at AS finishedAt, sort_order AS sortOrder
    FROM ai_runs
    WHERE project_id = ? AND task = 'state-backfill' AND chapter_id <> ''
    ORDER BY sort_order ASC
  `).all(projectId) as Array<{
    chapterId: string
    status: string
    error: string
    finishedAt: string
    sortOrder: number
  }>
  const latestByChapter = new Map(legacyRows.map((row) => [row.chapterId, row]))
  const insert = db.prepare(`
    INSERT OR IGNORE INTO story_state_backfill_chapters (
      project_id, chapter_id, chapter_index, chapter_title, content_hash,
      status, attempt_count, delta_json, error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, '', ?, ?)
  `)
  for (const chapter of chapters) {
    if (existing.has(chapter.id)) continue
    const legacy = latestByChapter.get(chapter.id)
    if (!legacy) continue
    insert.run(
      projectId,
      chapter.id,
      chapter.chapterIndex,
      chapter.title,
      buildBackfillContentHash(chapter.content),
      legacy.status === 'success' ? 'success' : 'failed',
      legacy.error || '',
      legacy.finishedAt || new Date().toISOString()
    )
  }
}

export function readBackfillChapterStatuses(db: DatabaseSync, projectId: string): BackfillChapterStatus[] {
  initStateBackfillSchema(db)
  migrateLegacyBackfillRuns(db, projectId)
  const records = readRecords(db, projectId)
  return readChapters(db, projectId).map((chapter) => {
    const contentHash = buildBackfillContentHash(chapter.content)
    const record = records.get(chapter.id)
    const status: BackfillChapterDisplayStatus = !record
      ? 'unscanned'
      : record.content_hash !== contentHash
        ? 'stale'
        : record.status
    return {
      chapterId: chapter.id,
      chapterTitle: chapter.title || `第 ${chapter.chapterIndex + 1} 章`,
      chapterIndex: chapter.chapterIndex,
      chapterNumber: chapter.chapterIndex + 1,
      contentHash,
      status,
      attemptCount: record?.attempt_count ?? 0,
      error: record?.error ?? '',
      updatedAt: record?.updated_at ?? ''
    }
  })
}

export function beginBackfillChapter(
  db: DatabaseSync,
  input: Pick<BackfillChapterStatus, 'chapterId' | 'chapterTitle' | 'chapterIndex' | 'contentHash'> & { projectId: string }
): void {
  const updatedAt = new Date().toISOString()
  db.prepare(`
    INSERT INTO story_state_backfill_chapters (
      project_id, chapter_id, chapter_index, chapter_title, content_hash,
      status, attempt_count, delta_json, error, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'running', 1, '', '', ?)
    ON CONFLICT(project_id, chapter_id) DO UPDATE SET
      chapter_index = excluded.chapter_index,
      chapter_title = excluded.chapter_title,
      content_hash = excluded.content_hash,
      status = 'running',
      attempt_count = story_state_backfill_chapters.attempt_count + 1,
      delta_json = '',
      error = '',
      updated_at = excluded.updated_at
  `).run(
    input.projectId,
    input.chapterId,
    input.chapterIndex,
    input.chapterTitle,
    input.contentHash,
    updatedAt
  )
}

export function finishBackfillChapter(
  db: DatabaseSync,
  input: {
    projectId: string
    chapterId: string
    contentHash: string
    status: Exclude<StoredBackfillStatus, 'running'>
    delta?: unknown
    error?: string
  }
): boolean {
  const result = db.prepare(`
    UPDATE story_state_backfill_chapters
    SET status = ?, delta_json = ?, error = ?, updated_at = ?
    WHERE project_id = ? AND chapter_id = ? AND content_hash = ?
  `).run(
    input.status,
    input.delta == null ? '' : JSON.stringify(input.delta),
    input.error || '',
    new Date().toISOString(),
    input.projectId,
    input.chapterId,
    input.contentHash
  )
  return result.changes > 0
}
