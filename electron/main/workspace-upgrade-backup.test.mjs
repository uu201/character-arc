import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  createWorkspacePreUpgradeBackup,
  readWorkspaceSchemaMarker,
  restoreWorkspaceUpgradeBackup,
  writeWorkspaceSchemaMarker
} from './workspace-upgrade-backup.ts'

test('升级前备份可打开、带校验清单并记录版本标记', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'characterarc-upgrade-'))
  try {
    const db = new DatabaseSync(join(workspaceDir, 'workspace.db'))
    db.exec(`CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL);`)
    db.prepare('INSERT INTO sample (value) VALUES (?)').run('旧数据')
    db.close()

    const result = await createWorkspacePreUpgradeBackup({
      workspaceDir,
      appVersion: '1.20.0',
      fromSchemaVersion: 1,
      toSchemaVersion: 2
    })
    const backupDb = new DatabaseSync(join(result.backupDir, 'workspace.db'))
    assert.equal(backupDb.prepare('SELECT value FROM sample').get().value, '旧数据')
    backupDb.close()
    const manifest = JSON.parse(await readFile(join(result.backupDir, 'manifest.json'), 'utf8'))
    assert.equal(manifest.fromSchemaVersion, 1)
    assert.equal(manifest.toSchemaVersion, 2)
    assert.equal(manifest.files[0].sha256.length, 64)

    const changedDb = new DatabaseSync(join(workspaceDir, 'workspace.db'))
    changedDb.prepare('UPDATE sample SET value = ?').run('升级后数据')
    changedDb.close()
    await writeWorkspaceSchemaMarker(workspaceDir, {
      schemaVersion: 2,
      appVersion: '1.20.0',
      upgradedAt: '2026-10-02T00:00:00.000Z'
    })
    const restored = await restoreWorkspaceUpgradeBackup(workspaceDir, result.backupDir)
    const restoredDb = new DatabaseSync(join(workspaceDir, 'workspace.db'))
    assert.equal(restoredDb.prepare('SELECT value FROM sample').get().value, '旧数据')
    restoredDb.close()
    assert.equal(await readWorkspaceSchemaMarker(workspaceDir), null)

    const failedUpgradeDb = new DatabaseSync(join(restored.failedUpgradeDir, 'workspace.db'))
    assert.equal(failedUpgradeDb.prepare('SELECT value FROM sample').get().value, '升级后数据')
    failedUpgradeDb.close()
    assert.equal((await readWorkspaceSchemaMarker(restored.failedUpgradeDir))?.schemaVersion, 2)

    await writeWorkspaceSchemaMarker(workspaceDir, {
      schemaVersion: 2,
      appVersion: '1.20.0',
      upgradedAt: '2026-10-02T00:00:00.000Z'
    })
    assert.equal((await readWorkspaceSchemaMarker(workspaceDir))?.schemaVersion, 2)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
