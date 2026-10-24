import type { DatabaseSync } from 'node:sqlite'
import type { PersistedChapterRecord } from '../shared/ipc-types'
import { normalizeChapterOrder } from '../shared/chapter-order'

type ChapterOrder = { id: string; volumeId: string; sortOrder: number }

function readChapterOrder(db: DatabaseSync, projectId: string) {
  const volumeIds = db.prepare(`
    SELECT id FROM outline_volumes WHERE project_id = ? ORDER BY sort_order, rowid
  `).all(projectId).map((row) => String(row.id))
  const chapters = db.prepare(`
    SELECT id, volume_id AS volumeId, sort_order AS sortOrder
    FROM chapters WHERE project_id = ? ORDER BY sort_order, rowid
  `).all(projectId) as ChapterOrder[]
  return { volumeIds, chapters }
}

function updateChangedOrder(db: DatabaseSync, projectId: string, previous: ChapterOrder[], next: ChapterOrder[]): void {
  const previousOrder = new Map(previous.map((item) => [item.id, item.sortOrder]))
  const update = db.prepare('UPDATE chapters SET sort_order = ? WHERE id = ? AND project_id = ?')
  for (const item of next) {
    if (previousOrder.has(item.id) && previousOrder.get(item.id) !== item.sortOrder) {
      update.run(item.sortOrder, item.id, projectId)
    }
  }
}

/** 兼容已有错误排序，只修改排序字段，不读取或重写正文及历史版本。 */
export function repairChapterOrder(db: DatabaseSync): void {
  db.exec('SAVEPOINT repair_chapter_order')
  try {
    const projects = db.prepare('SELECT DISTINCT project_id AS id FROM chapters').all()
    for (const project of projects) {
      const projectId = String(project.id)
      const { volumeIds, chapters } = readChapterOrder(db, projectId)
      updateChangedOrder(db, projectId, chapters, normalizeChapterOrder(chapters, volumeIds))
    }
    db.exec('RELEASE repair_chapter_order')
  } catch (error) {
    db.exec('ROLLBACK TO repair_chapter_order; RELEASE repair_chapter_order')
    throw error
  }
}

/** 新章节插入目标卷末尾，并使用全书唯一、递增的排序值。 */
export function insertChapterAtVolumeEnd(
  db: DatabaseSync,
  projectId: string,
  chapter: Omit<PersistedChapterRecord, 'sortOrder'>
): void {
  db.exec('SAVEPOINT insert_chapter')
  try {
    const { volumeIds, chapters } = readChapterOrder(db, projectId)
    const ordered = normalizeChapterOrder(chapters, volumeIds)
    const targetVolumeIndex = volumeIds.indexOf(chapter.volumeId)
    let insertIndex = ordered.findIndex((item) => volumeIds.indexOf(item.volumeId) > targetVolumeIndex)
    for (let index = ordered.length - 1; index >= 0; index--) {
      if (ordered[index].volumeId === chapter.volumeId) {
        insertIndex = index + 1
        break
      }
    }
    if (insertIndex < 0) insertIndex = ordered.length
    ordered.splice(insertIndex, 0, { id: chapter.id, volumeId: chapter.volumeId, sortOrder: 0 })
    const previousOrder = ordered[insertIndex - 1]?.sortOrder
    const nextOrder = ordered[insertIndex + 1]?.sortOrder
    const sortOrder = previousOrder !== undefined && nextOrder !== undefined
      ? previousOrder + Math.floor((nextOrder - previousOrder) / 2)
      : previousOrder !== undefined ? previousOrder + 1024 : nextOrder !== undefined ? nextOrder - 1024 : 1024
    const hasGap = Number.isSafeInteger(sortOrder)
      && (previousOrder === undefined || sortOrder > previousOrder)
      && (nextOrder === undefined || sortOrder < nextOrder)
    ordered[insertIndex].sortOrder = sortOrder
    const next = hasGap ? ordered : ordered.map((item, index) => ({ ...item, sortOrder: (index + 1) * 1024 }))
    updateChangedOrder(db, projectId, chapters, next)
    db.prepare(`
      INSERT INTO chapters (id, project_id, volume_id, outline_item_id, title, summary, status, word_target, content, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(chapter.id, projectId, chapter.volumeId, chapter.outlineItemId, chapter.title,
      chapter.summary, chapter.status, chapter.wordTarget, chapter.content, next[insertIndex].sortOrder)
    db.exec('RELEASE insert_chapter')
  } catch (error) {
    db.exec('ROLLBACK TO insert_chapter; RELEASE insert_chapter')
    throw error
  }
}
