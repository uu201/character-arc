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
import { backup as backupSqliteDatabase, DatabaseSync } from 'node:sqlite'

const SCHEMA_MARKER_FILE = 'workspace-schema.json'
const PRE_UPGRADE_BACKUP_ROOT = 'backups/pre-upgrade'
const PRE_ROLLBACK_BACKUP_ROOT = 'backups/pre-rollback'
const MANUAL_BACKUP_ROOT = 'backups/manual'

export type WorkspaceDatabaseBackupType = 'pre-upgrade' | 'pre-rollback' | 'manual'

export type WorkspaceDatabaseBackupSummary = {
  id: string
  createdAt: string
  appVersion: string
  schemaVersion: number
  type: WorkspaceDatabaseBackupType
  size: number
}

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
  return createWorkspaceDatabaseBackup({
    ...options,
    backupRoot: PRE_UPGRADE_BACKUP_ROOT,
    directorySuffix: `schema-${options.fromSchemaVersion}-to-${options.toSchemaVersion}`
  })
}

export async function createWorkspaceRollbackSafetyBackup(options: {
  workspaceDir: string
  appVersion: string
  schemaVersion: number
}): Promise<{ backupDir: string; manifest: WorkspaceBackupManifest }> {
  return createWorkspaceDatabaseBackup({
    workspaceDir: options.workspaceDir,
    appVersion: options.appVersion,
    fromSchemaVersion: options.schemaVersion,
    toSchemaVersion: options.schemaVersion,
    backupRoot: PRE_ROLLBACK_BACKUP_ROOT,
    directorySuffix: `schema-${options.schemaVersion}`
  })
}

export async function createWorkspaceManualBackup(options: {
  workspaceDir: string
  appVersion: string
  schemaVersion: number
  database: DatabaseSync
}): Promise<{ backupDir: string; manifest: WorkspaceBackupManifest }> {
  const sourceDbPath = join(options.workspaceDir, 'workspace.db')
  const sourceInfo = await stat(sourceDbPath)
  await assertBackupDiskSpace(options.workspaceDir, sourceInfo.size)

  const createdAt = new Date().toISOString()
  const timestamp = createdAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const backupDir = join(options.workspaceDir, MANUAL_BACKUP_ROOT, `${timestamp}_schema-${options.schemaVersion}`)
  const backupDbPath = join(backupDir, 'workspace.db')
  await mkdir(backupDir, { recursive: true })
  try {
    await backupSqliteDatabase(options.database, backupDbPath)
    const backupInfo = await stat(backupDbPath)
    const manifest: WorkspaceBackupManifest = {
      createdAt,
      appVersion: options.appVersion,
      fromSchemaVersion: options.schemaVersion,
      toSchemaVersion: options.schemaVersion,
      sourcePath: sourceDbPath,
      files: [{
        name: 'workspace.db',
        size: backupInfo.size,
        sha256: await hashFile(backupDbPath)
      }]
    }
    await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    validateBackupDatabase(backupDbPath)
    return { backupDir, manifest }
  } catch (error) {
    await rm(backupDir, { recursive: true, force: true })
    throw error
  }
}

async function createWorkspaceDatabaseBackup(options: {
  workspaceDir: string
  appVersion: string
  fromSchemaVersion: number
  toSchemaVersion: number
  backupRoot: string
  directorySuffix: string
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
  await assertBackupDiskSpace(options.workspaceDir, totalBytes)

  const createdAt = new Date().toISOString()
  const timestamp = createdAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const backupDir = join(
    options.workspaceDir,
    options.backupRoot,
    `${timestamp}_${options.directorySuffix}`
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

export async function listWorkspaceDatabaseBackups(
  workspaceDir: string
): Promise<WorkspaceDatabaseBackupSummary[]> {
  const backups: WorkspaceDatabaseBackupSummary[] = []
  for (const entry of [
    { type: 'pre-upgrade' as const, root: PRE_UPGRADE_BACKUP_ROOT },
    { type: 'pre-rollback' as const, root: PRE_ROLLBACK_BACKUP_ROOT },
    { type: 'manual' as const, root: MANUAL_BACKUP_ROOT }
  ]) {
    const root = join(workspaceDir, entry.root)
    let directories
    try {
      directories = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }

    for (const directory of directories) {
      if (!directory.isDirectory()) continue
      const backupDir = join(root, directory.name)
      try {
        const manifest = JSON.parse(
          await readFile(join(backupDir, 'manifest.json'), 'utf8')
        ) as WorkspaceBackupManifest
        if (!manifest.createdAt || !Number.isInteger(manifest.fromSchemaVersion)) continue
        backups.push({
          id: `${entry.type}/${directory.name}`,
          createdAt: manifest.createdAt,
          appVersion: String(manifest.appVersion ?? ''),
          schemaVersion: manifest.fromSchemaVersion,
          type: entry.type,
          size: manifest.files.reduce((total, file) => total + Math.max(0, Number(file.size) || 0), 0)
        })
      } catch {
        // 忽略不完整或损坏的备份目录，避免在设置页展示不可用项。
      }
    }
  }
  return backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function rollbackWorkspaceDatabase(options: {
  workspaceDir: string
  backupId: string
  appVersion: string
  currentSchemaVersion: number
}): Promise<{ safetyBackupDir: string }> {
  const backup = (await listWorkspaceDatabaseBackups(options.workspaceDir))
    .find((item) => item.id === options.backupId)
  if (!backup) {
    throw new Error('选择的数据库备份不存在或已损坏')
  }

  const [, directoryName] = backup.id.split('/')
  if (!directoryName || directoryName.includes('\\') || directoryName.includes('/')) {
    throw new Error('数据库备份标识无效')
  }
  const selectedRoot = backup.type === 'pre-upgrade'
    ? PRE_UPGRADE_BACKUP_ROOT
    : backup.type === 'pre-rollback'
      ? PRE_ROLLBACK_BACKUP_ROOT
      : MANUAL_BACKUP_ROOT
  const selectedBackupDir = join(options.workspaceDir, selectedRoot, directoryName)

  const safetyBackup = await createWorkspaceRollbackSafetyBackup({
    workspaceDir: options.workspaceDir,
    appVersion: options.appVersion,
    schemaVersion: options.currentSchemaVersion
  })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const stagingDir = join(options.workspaceDir, 'backups', `.rollback-stage-${timestamp}`)
  await mkdir(stagingDir, { recursive: true })
  try {
    for (const name of ['workspace.db', 'workspace.db-wal', 'workspace.db-shm']) {
      try {
        await copyFile(join(selectedBackupDir, name), join(stagingDir, name))
      } catch (error) {
        if (name === 'workspace.db') throw error
      }
    }

    const stagingDbPath = join(stagingDir, 'workspace.db')
    checkpointAndValidateDatabase(stagingDbPath)

    for (const name of ['workspace.db-wal', 'workspace.db-shm']) {
      await rm(join(options.workspaceDir, name), { force: true })
    }
    await copyFile(stagingDbPath, join(options.workspaceDir, 'workspace.db'))
    await writeWorkspaceSchemaMarker(options.workspaceDir, {
      schemaVersion: backup.schemaVersion,
      appVersion: backup.appVersion,
      upgradedAt: backup.createdAt
    })
    validateBackupDatabase(join(options.workspaceDir, 'workspace.db'))
    return { safetyBackupDir: safetyBackup.backupDir }
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

export async function pruneWorkspaceUpgradeBackups(workspaceDir: string, keep = 5): Promise<void> {
  const root = join(workspaceDir, PRE_UPGRADE_BACKUP_ROOT)
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
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const failedUpgradeDir = join(workspaceDir, 'backups/failed-upgrade', timestamp)
  const stagingDir = join(workspaceDir, 'backups', `.upgrade-restore-stage-${timestamp}`)
  await mkdir(stagingDir, { recursive: true })
  try {
    for (const name of ['workspace.db', 'workspace.db-wal', 'workspace.db-shm']) {
      try {
        await copyFile(join(backupDir, name), join(stagingDir, name))
      } catch (error) {
        if (name === 'workspace.db' || !isMissingFileError(error)) throw error
      }
    }

    const stagingDbPath = join(stagingDir, 'workspace.db')
    checkpointAndValidateDatabase(stagingDbPath)
    await rm(join(stagingDir, 'workspace.db-wal'), { force: true })
    await rm(join(stagingDir, 'workspace.db-shm'), { force: true })

    await mkdir(failedUpgradeDir, { recursive: true })
    const movedFiles = await moveWorkspaceFiles(workspaceDir, failedUpgradeDir)
    try {
      await rename(stagingDbPath, join(workspaceDir, 'workspace.db'))
      validateBackupDatabase(join(workspaceDir, 'workspace.db'))
    } catch (error) {
      await clearWorkspaceDatabaseFiles(workspaceDir)
      try {
        await restoreMovedWorkspaceFiles(workspaceDir, failedUpgradeDir, movedFiles)
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], '恢复备份失败，且无法自动还原升级后的数据库文件')
      }
      throw error
    }
    return { failedUpgradeDir }
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

const WORKSPACE_DATABASE_FILES = [
  'workspace.db',
  'workspace.db-wal',
  'workspace.db-shm',
  SCHEMA_MARKER_FILE
] as const

async function moveWorkspaceFiles(workspaceDir: string, destinationDir: string): Promise<string[]> {
  const movedFiles: string[] = []
  for (const name of WORKSPACE_DATABASE_FILES) {
    try {
      await rename(join(workspaceDir, name), join(destinationDir, name))
      movedFiles.push(name)
    } catch (error) {
      if (isMissingFileError(error)) continue
      try {
        await restoreMovedWorkspaceFiles(workspaceDir, destinationDir, movedFiles)
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], '无法安全移动升级后的数据库文件')
      }
      throw error
    }
  }
  return movedFiles
}

async function restoreMovedWorkspaceFiles(
  workspaceDir: string,
  sourceDir: string,
  movedFiles: string[]
): Promise<void> {
  for (const name of [...movedFiles].reverse()) {
    await rename(join(sourceDir, name), join(workspaceDir, name))
  }
}

async function clearWorkspaceDatabaseFiles(workspaceDir: string): Promise<void> {
  for (const name of WORKSPACE_DATABASE_FILES) {
    await rm(join(workspaceDir, name), { force: true })
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
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

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return hash.digest('hex')
}

async function assertBackupDiskSpace(workspaceDir: string, totalBytes: number): Promise<void> {
  const disk = await statfs(workspaceDir)
  const availableBytes = Number(disk.bavail) * Number(disk.bsize)
  const reserveBytes = Math.max(64 * 1024 * 1024, Math.ceil(totalBytes * 0.2))
  if (availableBytes < totalBytes + reserveBytes) {
    throw new Error('磁盘空间不足，无法安全备份数据库。请至少释放数据库大小加 20% 的空间。')
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

function checkpointAndValidateDatabase(databasePath: string): void {
  const db = new DatabaseSync(databasePath)
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const result = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined
    if (!result || !Object.values(result).some((value) => value === 'ok')) {
      throw new Error('选择的数据库备份未通过 SQLite 完整性检查')
    }
  } finally {
    db.close()
  }
}
