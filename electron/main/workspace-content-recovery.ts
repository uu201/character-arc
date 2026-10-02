import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const BACKUP_ROOT = 'backups/pre-upgrade'
const AFFECTED_APP_VERSION = '1.21.0'
const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i
const ENTITY_MAP: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'"
}

type BackupManifest = {
  appVersion?: string
  fromSchemaVersion?: number
  toSchemaVersion?: number
}

export type WorkspaceContentRecoveryResult = {
  backupDir: string
  chaptersRestored: number
  versionsRestored: number
}

export async function recoverMissingChapterContentFromUpgradeBackup(
  workspaceDir: string
): Promise<WorkspaceContentRecoveryResult | null> {
  const backupRoot = join(workspaceDir, BACKUP_ROOT)
  let directories
  try {
    directories = await readdir(backupRoot, { withFileTypes: true })
  } catch {
    return null
  }

  const candidates = directories
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(backupRoot, entry.name))
    .sort((left, right) => right.localeCompare(left))

  for (const backupDir of candidates) {
    const manifest = await readBackupManifest(backupDir)
    if (
      manifest?.appVersion !== AFFECTED_APP_VERSION
      || manifest.fromSchemaVersion !== 1
      || manifest.toSchemaVersion !== 2
    ) {
      continue
    }

    try {
      const result = recoverFromBackupDatabase(
        join(workspaceDir, 'workspace.db'),
        join(backupDir, 'workspace.db')
      )
      if (result.chaptersRestored > 0 || result.versionsRestored > 0) {
        return { backupDir, ...result }
      }
    } catch {
      // 单个备份损坏或结构异常时继续检查更早的升级备份。
    }
  }

  return null
}

async function readBackupManifest(backupDir: string): Promise<BackupManifest | null> {
  try {
    return JSON.parse(await readFile(join(backupDir, 'manifest.json'), 'utf8')) as BackupManifest
  } catch {
    return null
  }
}

function recoverFromBackupDatabase(
  liveDatabasePath: string,
  backupDatabasePath: string
): Omit<WorkspaceContentRecoveryResult, 'backupDir'> {
  const db = new DatabaseSync(liveDatabasePath)
  let backupAttached = false
  try {
    db.function('chapter_character_count', (content) => countRecoveredChapterCharacters(String(content ?? '')))
    db.prepare('ATTACH DATABASE ? AS upgrade_backup').run(backupDatabasePath)
    backupAttached = true
    db.exec('BEGIN IMMEDIATE')
    try {
      const chapterResult = db.prepare(`
        UPDATE chapters
        SET content = (
          SELECT backup.content
          FROM upgrade_backup.chapters AS backup
          WHERE backup.id = chapters.id
            AND backup.project_id = chapters.project_id
        )
        WHERE content = ''
          AND EXISTS (
            SELECT 1
            FROM upgrade_backup.chapters AS backup
            WHERE backup.id = chapters.id
              AND backup.project_id = chapters.project_id
              AND backup.content <> ''
          )
      `).run()
      const versionResult = db.prepare(`
        UPDATE chapter_versions
        SET content = (
          SELECT backup.content
          FROM upgrade_backup.chapter_versions AS backup
          WHERE backup.id = chapter_versions.id
            AND backup.project_id = chapter_versions.project_id
        )
        WHERE content = ''
          AND EXISTS (
            SELECT 1
            FROM upgrade_backup.chapter_versions AS backup
            WHERE backup.id = chapter_versions.id
              AND backup.project_id = chapter_versions.project_id
              AND backup.content <> ''
          )
      `).run()
      db.exec('COMMIT')
      return {
        chaptersRestored: Number(chapterResult.changes),
        versionsRestored: Number(versionResult.changes)
      }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } finally {
    if (backupAttached) db.exec('DETACH DATABASE upgrade_backup')
    db.close()
  }
}

// 恢复连接不经过 workspace-store 初始化，但现有字数触发器仍依赖同名函数。
function countRecoveredChapterCharacters(value: string): number {
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
  return Array.from(plain.replace(/[\s\u200B-\u200D\u2060\uFEFF]/gu, '')).length
}
