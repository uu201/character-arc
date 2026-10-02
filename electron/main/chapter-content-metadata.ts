import type { DatabaseSync } from 'node:sqlite'

export type ChapterContentMigrationProgress = {
  phase: 'chapters' | 'chapter-versions'
  current: number
  total: number
}

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i
const ENTITY_MAP: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'"
}

export function countChapterCharacters(value: string): number {
  const normalized = value.trim()
  if (!normalized) return 0

  const plain = HTML_TAG_PATTERN.test(normalized)
    ? normalized
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|blockquote)>/gi, '\n')
        .replace(/<li>/gi, '- ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&([^;]+);/g, (match, entity) => ENTITY_MAP[entity] ?? match)
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : normalized
  const text = plain.replace(/[\s\u200B-\u200D\u2060\uFEFF]/gu, '')
  return Array.from(text).length
}

export function ensureChapterContentMetadata(
  db: DatabaseSync,
  onProgress?: (progress: ChapterContentMigrationProgress) => void
): void {
  db.exec('SAVEPOINT chapter_content_metadata_migration')
  try {
    const chapterColumns = db.prepare(`PRAGMA table_info('chapters')`).all() as Array<{ name: string }>
    const chapterColumnNames = new Set(chapterColumns.map((column) => column.name))
    const versionColumns = db.prepare(`PRAGMA table_info('chapter_versions')`).all() as Array<{ name: string }>
    const versionColumnNames = new Set(versionColumns.map((column) => column.name))
    let shouldBackfillChapterLengths = false
    let shouldBackfillVersionLengths = false

    if (!chapterColumnNames.has('content_length')) {
      db.exec(`ALTER TABLE chapters ADD COLUMN content_length INTEGER NOT NULL DEFAULT 0;`)
      shouldBackfillChapterLengths = true
    }
    if (!versionColumnNames.has('content_length')) {
      db.exec(`ALTER TABLE chapter_versions ADD COLUMN content_length INTEGER NOT NULL DEFAULT 0;`)
      shouldBackfillVersionLengths = true
    }

    if (shouldBackfillChapterLengths) {
      backfillContentLengths(db, 'chapters', 'chapters', onProgress)
    }
    if (shouldBackfillVersionLengths) {
      backfillContentLengths(db, 'chapter_versions', 'chapter-versions', onProgress)
    }

    db.exec(`
      DROP TRIGGER IF EXISTS chapters_content_length_after_insert;
      DROP TRIGGER IF EXISTS chapters_content_length_after_update;
      DROP TRIGGER IF EXISTS chapter_versions_content_length_after_insert;
      DROP TRIGGER IF EXISTS chapter_versions_content_length_after_update;

      CREATE TRIGGER chapters_content_length_after_insert
      AFTER INSERT ON chapters
      BEGIN
        UPDATE chapters
        SET content_length = chapter_character_count(NEW.content)
        WHERE id = NEW.id;
      END;

      CREATE TRIGGER chapters_content_length_after_update
      AFTER UPDATE OF content ON chapters
      BEGIN
        UPDATE chapters
        SET content_length = chapter_character_count(NEW.content)
        WHERE id = NEW.id;
      END;

      CREATE TRIGGER chapter_versions_content_length_after_insert
      AFTER INSERT ON chapter_versions
      BEGIN
        UPDATE chapter_versions
        SET content_length = chapter_character_count(NEW.content)
        WHERE id = NEW.id;
      END;

      CREATE TRIGGER chapter_versions_content_length_after_update
      AFTER UPDATE OF content ON chapter_versions
      BEGIN
        UPDATE chapter_versions
        SET content_length = chapter_character_count(NEW.content)
        WHERE id = NEW.id;
      END;
    `)
    db.exec('RELEASE SAVEPOINT chapter_content_metadata_migration')
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT chapter_content_metadata_migration')
    db.exec('RELEASE SAVEPOINT chapter_content_metadata_migration')
    throw error
  }
}

function backfillContentLengths(
  db: DatabaseSync,
  tableName: 'chapters' | 'chapter_versions',
  phase: ChapterContentMigrationProgress['phase'],
  onProgress?: (progress: ChapterContentMigrationProgress) => void
): void {
  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get() as { total?: number } | undefined)?.total ?? 0
  )
  if (total === 0) {
    onProgress?.({ phase, current: 0, total: 0 })
    return
  }

  const batchSize = 200
  const readBatch = db.prepare(`
    SELECT rowid
    FROM ${tableName}
    WHERE rowid > ?
    ORDER BY rowid ASC
    LIMIT ?
  `)
  let current = 0
  let lastRowId = 0
  onProgress?.({ phase, current, total })

  while (current < total) {
    const rows = readBatch.all(lastRowId, batchSize) as Array<{ rowid: number }>
    if (rows.length === 0) break
    const rowIds = rows.map((row) => Number(row.rowid))
    const placeholders = rowIds.map(() => '?').join(', ')
    db.prepare(`
      UPDATE ${tableName}
      SET content_length = chapter_character_count(content)
      WHERE rowid IN (${placeholders})
    `).run(...rowIds)
    current += rowIds.length
    lastRowId = rowIds[rowIds.length - 1]
    onProgress?.({ phase, current: Math.min(current, total), total })
  }
}
