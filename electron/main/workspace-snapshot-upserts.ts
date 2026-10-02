import type { DatabaseSync } from 'node:sqlite'

export function prepareWorkspaceHierarchyUpserts(db: DatabaseSync) {
  const insertOutlineVolume = db.prepare(`
    INSERT INTO outline_volumes (id, project_id, title, word_target, summary, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      word_target = excluded.word_target,
      summary = excluded.summary,
      sort_order = excluded.sort_order
  `)

  const insertChapter = db.prepare(`
    INSERT INTO chapters (id, project_id, volume_id, outline_item_id, title, summary, status, word_target, content, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      volume_id = excluded.volume_id,
      outline_item_id = excluded.outline_item_id,
      title = excluded.title,
      summary = excluded.summary,
      status = excluded.status,
      word_target = excluded.word_target,
      content = excluded.content,
      sort_order = excluded.sort_order
  `)

  const insertChapterVersion = db.prepare(`
    INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      chapter_id = excluded.chapter_id,
      title = excluded.title,
      summary = excluded.summary,
      status = excluded.status,
      word_target = excluded.word_target,
      content = excluded.content,
      created_at = excluded.created_at
  `)

  return {
    insertOutlineVolume,
    insertChapter,
    insertChapterVersion
  }
}
