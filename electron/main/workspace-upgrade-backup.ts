import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  mkdir,
  copyFile,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile
} from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA_MARKER_FILE = 'workspace-schema.json'
const BACKUP_ROOT = 'backups/pre-upgrade'

export type WorkspaceSchemaMarker = {
  schemaVersion: number
  appVersion: string
  upgradedAt: string
}

export type WorkspaceBackupProgress = {
  currentBytes: number
  totalBytes: number
  percent: number
  message: string
}

export type WorkspaceBackupManifest = {
  createdAt: string
  appVersion: string
  fromSchemaVersion: number
  toSchemaVersion: number
  sourcePath: string
  files: Array<{
    name: string
    size: number
    sha256: string
  }>
}

export async function readWorkspaceSchemaMarker(
  workspaceDir: string
): Promise<WorkspaceSchemaMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(join(workspaceDir, SCHEMA_MARKER_FILE), 'utf8')) as Partial<WorkspaceSchemaMarker>
    if (!Number.isInteger(parsed.schemaVersion) || Number(parsed.schemaVersion) < 1) return null
    return {
      schemaVersion: Number(parsed.schemaVersion),
      appVersion: String(parsed.appVersion ?? ''),
      upgradedAt: String(parsed.upgradedAt ?? '')
    }
  } catch {
    return null
  }
}

export async function writeWorkspaceSchemaMarker(
  workspaceDir: string,
  marker: WorkspaceSchemaMarker
): Promise<void> {
  await mkdir(workspaceDir, { recursive: true })
  await writeFile(
    join(workspaceDir, SCHEMA_MARKER_FILE),
    JSON.stringify(marker, null, 2),
    'utf8'
  )
}

export async function createWorkspacePreUpgradeBackup(options: {
  workspaceDir: string
  appVersion: string
  fromSchemaVersion: number
  toSchemaVersion: number
  onProgress?: (progress: WorkspaceBackupProgress) => void
}): Promise<{ backupDir: string; manifest: WorkspaceBackupManifest }> {
  const sourceDbPath = join(options.workspaceDir, 'workspace.db')
  const sourceFiles = [sourceDbPath, `${sourceDbPath}-wal`, `${sourceDbPath}-shm`]
  const files: Array<{ sourcePath: string; name: string; size: number }> = []
  for (const sourcePath of sourceFiles) {
    try {
      const info = await stat(sourcePath)
      if (info.isFile()) files.push({ sourcePath, name: sourcePath.slice(options.workspaceDir.length + 1), size: info.size })
    } catch {
      // WAL/SHM 可能不存在；主数据库由调用方保证存在。
    }
  }
  if (!files.some((file) => file.name === 'workspace.db')) {
    throw new Error('未找到需要备份的 workspace.db')
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  const disk = await statfs(options.workspaceDir)
  const availableBytes = Number(disk.bavail) * Number(disk.bsize)
  const reserveBytes = Math.max(64 * 1024 * 1024, Math.ceil(totalBytes * 0.2))
  if (availableBytes < totalBytes + reserveBytes) {
    throw new Error('磁盘空间不足，无法在升级前安全备份数据库。请至少释放数据库大小加 20% 的空间。')
  }

  const createdAt = new Date().toISOString()
  const timestamp = createdAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const backupDir = join(
    options.workspaceDir,
    BACKUP_ROOT,
    `${timestamp}_schema-${options.fromSchemaVersion}-to-${options.toSchemaVersion}`
  )
  await mkdir(backupDir, { recursive: true })

  let copiedBytes = 0
  const manifestFiles: WorkspaceBackupManifest['files'] = []
  try {
    for (const file of files) {
      const result = await copyFileWithHash(
        file.sourcePath,
        join(backupDir, file.name),
        (chunkBytes) => {
          copiedBytes += chunkBytes
          options.onProgress?.({
            currentBytes: copiedBytes,
            totalBytes,
            percent: totalBytes > 0 ? Math.min(100, Math.round(copiedBytes / totalBytes * 100)) : 100,
            message: `正在备份 ${file.name}…`
          })
        }
      )
      manifestFiles.push({ name: file.name, size: result.size, sha256: result.sha256 })
    }

    const manifest: WorkspaceBackupManifest = {
      createdAt,
      appVersion: options.appVersion,
      fromSchemaVersion: options.fromSchemaVersion,
      toSchemaVersion: options.toSchemaVersion,
      sourcePath: sourceDbPath,
      files: manifestFiles
    }
    await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    validateBackupDatabase(join(backupDir, 'workspace.db'))
    return { backupDir, manifest }
  } catch (error) {
    await rm(backupDir, { recursive: true, force: true })
    throw error
  }
}

export async function pruneWorkspaceUpgradeBackups(workspaceDir: string, keep = 5): Promise<void> {
  const root = join(workspaceDir, BACKUP_ROOT)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left))
  for (const name of directories.slice(Math.max(0, keep))) {
    await rm(join(root, name), { recursive: true, force: true })
  }
}

export async function restoreWorkspaceUpgradeBackup(
  workspaceDir: string,
  backupDir: string
): Promise<{ failedUpgradeDir: string }> {
  const backupDbPath = join(backupDir, 'workspace.db')
  validateBackupDatabase(backupDbPath)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const failedUpgradeDir = join(workspaceDir, 'backups/failed-upgrade', timestamp)
  await mkdir(failedUpgradeDir, { recursive: true })

  for (const name of ['workspace.db', 'workspace.db-wal', 'workspace.db-shm', SCHEMA_MARKER_FILE]) {
    try {
      await rename(join(workspaceDir, name), join(failedUpgradeDir, name))
    } catch {
      // 文件可能不存在。
    }
  }

  await copyFile(backupDbPath, join(workspaceDir, 'workspace.db'))
  for (const name of ['workspace.db-wal']) {
    try {
      await copyFile(join(backupDir, name), join(workspaceDir, name))
    } catch {
      // 备份可能没有 WAL 文件。
    }
  }
  validateBackupDatabase(join(workspaceDir, 'workspace.db'))
  return { failedUpgradeDir }
}

async function copyFileWithHash(
  sourcePath: string,
  destinationPath: string,
  onChunk: (bytes: number) => void
): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256')
  const source = createReadStream(sourcePath)
  const destination = createWriteStream(destinationPath, { flags: 'wx' })
  let size = 0
  try {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      hash.update(buffer)
      size += buffer.length
      if (!destination.write(buffer)) await once(destination, 'drain')
      onChunk(buffer.length)
    }
    destination.end()
    await once(destination, 'finish')
    return { size, sha256: hash.digest('hex') }
  } catch (error) {
    destination.destroy()
    throw error
  }
}

function validateBackupDatabase(databasePath: string): void {
  const db = new DatabaseSync(databasePath)
  try {
    const result = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined
    if (!result || !Object.values(result).some((value) => value === 'ok')) {
      throw new Error('升级前备份未通过 SQLite 完整性检查')
    }
  } finally {
    db.close()
  }
}
