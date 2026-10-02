import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  createWorkspaceManualBackup,
  createWorkspacePreUpgradeBackup,
  listWorkspaceDatabaseBackups,
  readWorkspaceSchemaMarker,
  rollbackWorkspaceDatabase,
  writeWorkspaceSchemaMarker
} from './workspace-upgrade-backup.ts'

function readSampleValue(databasePath) {
  const db = new DatabaseSync(databasePath)
  try {
    return db.prepare('SELECT value FROM sample WHERE id = 1').get().value
  } finally {
    db.close()
  }
}

test('数据库回滚先备份当前数据，再恢复所选备份并更新版本标记', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'characterarc-rollback-'))
  try {
    const databasePath = join(workspaceDir, 'workspace.db')
    const db = new DatabaseSync(databasePath)
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    db.prepare('INSERT INTO sample (id, value) VALUES (1, ?)').run('备份中的旧数据')
    db.close()

    await writeWorkspaceSchemaMarker(workspaceDir, {
      schemaVersion: 1,
      appVersion: '1.20.0',
      upgradedAt: '2026-09-28T00:00:00.000Z'
    })
    const originalBackup = await createWorkspacePreUpgradeBackup({
      workspaceDir,
      appVersion: '1.20.0',
      fromSchemaVersion: 1,
      toSchemaVersion: 2
    })

    const currentDb = new DatabaseSync(databasePath)
    currentDb.prepare('UPDATE sample SET value = ? WHERE id = 1').run('回滚前的当前数据')
    currentDb.close()
    await writeWorkspaceSchemaMarker(workspaceDir, {
      schemaVersion: 2,
      appVersion: '1.21.1',
      upgradedAt: '2026-10-02T00:00:00.000Z'
    })

    const liveDb = new DatabaseSync(databasePath)
    const manualBackup = await createWorkspaceManualBackup({
      workspaceDir,
      appVersion: '1.21.1',
      schemaVersion: 2,
      database: liveDb
    })
    liveDb.close()
    assert.equal(readSampleValue(join(manualBackup.backupDir, 'workspace.db')), '回滚前的当前数据')

    const beforeRollback = await listWorkspaceDatabaseBackups(workspaceDir)
    assert.equal(beforeRollback.length, 2)
    assert.equal(beforeRollback.find((backup) => backup.type === 'manual')?.schemaVersion, 2)
    const upgradeBackup = beforeRollback.find((backup) => backup.type === 'pre-upgrade')
    assert.equal(upgradeBackup?.schemaVersion, 1)
    assert.ok(upgradeBackup)

    await assert.rejects(
      rollbackWorkspaceDatabase({
        workspaceDir,
        backupId: 'pre-upgrade/../../workspace.db',
        appVersion: '1.21.1',
        currentSchemaVersion: 2
      }),
      /不存在或已损坏/
    )

    const result = await rollbackWorkspaceDatabase({
      workspaceDir,
      backupId: upgradeBackup.id,
      appVersion: '1.21.1',
      currentSchemaVersion: 2
    })

    assert.equal(readSampleValue(databasePath), '备份中的旧数据')
    assert.equal(readSampleValue(join(result.safetyBackupDir, 'workspace.db')), '回滚前的当前数据')
    assert.equal((await readWorkspaceSchemaMarker(workspaceDir))?.schemaVersion, 1)

    const afterRollback = await listWorkspaceDatabaseBackups(workspaceDir)
    assert.deepEqual(new Set(afterRollback.map((backup) => backup.type)), new Set(['pre-upgrade', 'pre-rollback', 'manual']))
    assert.equal(afterRollback.find((backup) => backup.type === 'pre-rollback')?.schemaVersion, 2)
    assert.equal(originalBackup.backupDir.includes('pre-upgrade'), true)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
