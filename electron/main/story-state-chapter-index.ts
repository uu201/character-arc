import type { DatabaseSync } from 'node:sqlite'

type ChapterRow = {
  id: string
  projectId: string
  sortOrder: number
  chapterIndex: number
  chapterCount: number
  backfillIndex: number | null
}

/** 修复旧补录误存的稀疏排序值；正常的零基章节索引和未来计划章号不参与转换。 */
export function repairStoryStateChapterIndexes(db: DatabaseSync): void {
  const chapters = db.prepare(`
    SELECT c.id, c.project_id AS projectId, c.sort_order AS sortOrder,
           ROW_NUMBER() OVER (
             PARTITION BY c.project_id
             ORDER BY COALESCE(v.sort_order, 9007199254740991), v.rowid, c.sort_order, c.rowid
           ) - 1 AS chapterIndex,
           COUNT(*) OVER (PARTITION BY c.project_id) AS chapterCount,
           b.chapter_index AS backfillIndex
    FROM chapters c
    LEFT JOIN outline_volumes v ON v.project_id = c.project_id AND v.id = c.volume_id
    LEFT JOIN story_state_backfill_chapters b ON b.project_id = c.project_id AND b.chapter_id = c.id
  `).all() as ChapterRow[]
  const mappings = new Map<string, Map<number, number | null>>()
  for (const chapter of chapters) {
    // 异常补录记录有章节 ID，优先于可能已经重新编排过的当前排序值。
    const previous = chapter.backfillIndex !== null && chapter.backfillIndex > chapter.chapterCount
      ? chapter.backfillIndex : chapter.sortOrder
    if (previous <= chapter.chapterCount) continue
    const mapping = mappings.get(chapter.projectId) ?? new Map<number, number | null>()
    mapping.set(previous, mapping.has(previous) && mapping.get(previous) !== chapter.chapterIndex
      ? null : chapter.chapterIndex)
    mappings.set(chapter.projectId, mapping)
  }
  if (!mappings.size) return

  db.exec('SAVEPOINT repair_story_state_chapter_indexes')
  try {
    for (const [projectId, candidates] of mappings) {
      const mapping = new Map([...candidates].filter((entry): entry is [number, number] => entry[1] !== null))
      for (const [previous, chapterIndex] of mapping) {
        for (const [table, key] of [
          ['story_character_state', 'character_id'],
          ['story_timeline', null]
        ] as const) {
          const rows = db.prepare(`SELECT * FROM ${table} WHERE project_id = ? AND chapter_index = ?`)
            .all(projectId, previous)
          for (const row of rows) {
            const current = key
              ? db.prepare(`SELECT id, updated_at FROM ${table} WHERE project_id = ? AND chapter_index = ? AND ${key} = ?`)
                .get(projectId, chapterIndex, row[key])
              : db.prepare(`SELECT id, updated_at FROM ${table} WHERE project_id = ? AND chapter_index = ?`)
                .get(projectId, chapterIndex)
            // 同章若已重新生成，保留时间较新的状态，避免旧数据覆盖新条目。
            if (current && String(current.updated_at) >= String(row.updated_at)) {
              db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id)
            } else {
              if (current) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(current.id)
              db.prepare(`UPDATE ${table} SET chapter_index = ? WHERE id = ?`).run(chapterIndex, row.id)
            }
          }
        }
        for (const [table, column] of [
          ['story_foreshadowing', 'planted_chapter'],
          ['story_foreshadowing', 'resolved_chapter'],
          ['story_relationships', 'last_interaction_chapter'],
          ['story_world_rules', 'established_chapter']
        ]) {
          db.prepare(`UPDATE ${table} SET ${column} = ? WHERE project_id = ? AND ${column} = ?`)
            .run(chapterIndex, projectId, previous)
        }
      }
      const foreshadowing = db.prepare('SELECT id, clues_json FROM story_foreshadowing WHERE project_id = ?').all(projectId)
      for (const row of foreshadowing) {
        let clues: unknown
        try { clues = JSON.parse(String(row.clues_json)) } catch { continue }
        if (!Array.isArray(clues)) continue
        let changed = false
        for (const clue of clues) {
          if (clue && typeof clue === 'object' && mapping.has(clue.chapter)) {
            clue.chapter = mapping.get(clue.chapter)
            changed = true
          }
        }
        if (changed) db.prepare('UPDATE story_foreshadowing SET clues_json = ? WHERE id = ?')
          .run(JSON.stringify(clues), row.id)
      }
    }
    for (const chapter of chapters) {
      if (chapter.backfillIndex === null || chapter.backfillIndex <= chapter.chapterCount) continue
      db.prepare('UPDATE story_state_backfill_chapters SET chapter_index = ? WHERE project_id = ? AND chapter_id = ?')
        .run(chapter.chapterIndex, chapter.projectId, chapter.id)
    }
    db.exec('RELEASE repair_story_state_chapter_indexes')
  } catch (error) {
    db.exec('ROLLBACK TO repair_story_state_chapter_indexes; RELEASE repair_story_state_chapter_indexes')
    throw error
  }
}
