import type { DatabaseSync } from 'node:sqlite'
import type {
  PersistedChapterRecord,
  SaveChapterOrderRequest,
  SaveChaptersRequest
} from '@shared/ipc-types'

export function readChapterMutationPayload(
  db: DatabaseSync,
  projectId: string,
  chapterIds: string[]
): SaveChaptersRequest | null {
  const uniqueIds = Array.from(new Set(chapterIds.filter(Boolean)))
  if (uniqueIds.length === 0) return null

  const project = db.prepare('SELECT word_count AS wordCount FROM projects WHERE id = ?')
    .get(projectId) as { wordCount: string } | undefined
  if (!project) return null

  const placeholders = uniqueIds.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT id, outline_item_id AS outlineItemId, volume_id AS volumeId,
      title, summary, status, word_target AS wordTarget, content, sort_order AS sortOrder
    FROM chapters
    WHERE project_id = ? AND id IN (${placeholders})
  `).all(projectId, ...uniqueIds).map((row) => ({
    id: String(row.id),
    outlineItemId: String(row.outlineItemId),
    volumeId: String(row.volumeId),
    sortOrder: Number(row.sortOrder),
    title: String(row.title),
    summary: String(row.summary),
    status: String(row.status) as PersistedChapterRecord['status'],
    wordTarget: String(row.wordTarget),
    content: String(row.content)
  }))
  const rowsById = new Map(rows.map((chapter) => [chapter.id, chapter]))
  if (rowsById.size !== uniqueIds.length) return null

  return {
    projectId,
    projectWordCount: project.wordCount,
    chapters: uniqueIds.map((id) => rowsById.get(id) as PersistedChapterRecord)
  }
}

export function writeChapterRows(db: DatabaseSync, request: SaveChaptersRequest): void {
  if (request.chapters.length === 0) return

  const updateChapter = db.prepare(`
    UPDATE chapters
    SET volume_id = ?, outline_item_id = ?, title = ?, summary = ?, status = ?, word_target = ?,
      content = CASE WHEN ? <> 0 THEN ? ELSE content END
    WHERE id = ? AND project_id = ?
  `)
  const updateProject = db.prepare(`
    UPDATE projects SET word_count = ?, last_edited = ? WHERE id = ?
  `)

  db.exec('BEGIN')
  try {
    for (const chapter of request.chapters) {
      updateChapter.run(
        chapter.volumeId,
        chapter.outlineItemId,
        chapter.title,
        chapter.summary,
        chapter.status,
        chapter.wordTarget,
        chapter.contentLoaded === false ? 0 : 1,
        chapter.content,
        chapter.id,
        request.projectId
      )
    }
    updateProject.run(request.projectWordCount, new Date().toISOString(), request.projectId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function writeChapterOrder(db: DatabaseSync, request: SaveChapterOrderRequest): void {
  if (request.chapters.length === 0) return

  const updateChapter = db.prepare(`
    UPDATE chapters SET volume_id = ?, sort_order = ? WHERE id = ? AND project_id = ?
  `)

  db.exec('BEGIN')
  try {
    for (const chapter of request.chapters) {
      updateChapter.run(chapter.volumeId, chapter.sortOrder, chapter.id, request.projectId)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
