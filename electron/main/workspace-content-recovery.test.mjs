import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { recoverMissingChapterContentFromUpgradeBackup } from './workspace-content-recovery.ts'

function createContentDatabase(path, contents) {
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      content TEXT NOT NULL,
      content_length INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE chapter_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      content TEXT NOT NULL,
      content_length INTEGER NOT NULL DEFAULT 0
    ) STRICT;
  `)
  const insertChapter = db.prepare('INSERT INTO chapters (id, project_id, content) VALUES (?, ?, ?)')
  const insertVersion = db.prepare('INSERT INTO chapter_versions (id, project_id, content) VALUES (?, ?, ?)')
  for (const chapter of contents.chapters) {
    insertChapter.run(chapter.id, 'project-1', chapter.content)
  }
  for (const version of contents.versions) {
    insertVersion.run(version.id, 'project-1', version.content)
  }
  db.exec(`
    CREATE TRIGGER chapters_content_length_after_update
    AFTER UPDATE OF content ON chapters
    BEGIN
      UPDATE chapters SET content_length = chapter_character_count(NEW.content) WHERE id = NEW.id;
    END;
    CREATE TRIGGER chapter_versions_content_length_after_update
    AFTER UPDATE OF content ON chapter_versions
    BEGIN
      UPDATE chapter_versions SET content_length = chapter_character_count(NEW.content) WHERE id = NEW.id;
    END;
  `)
  db.close()
}

test('1.21.1 仅从升级备份回填被清空的正文和历史版本', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'characterarc-content-recovery-'))
  const backupDir = join(workspaceDir, 'backups', 'pre-upgrade', '2026-10-02_schema-1-to-2')
  await mkdir(backupDir, { recursive: true })

  try {
    createContentDatabase(join(workspaceDir, 'workspace.db'), {
      chapters: [
        { id: 'chapter-1', content: '<p>当前第一章</p>' },
        { id: 'chapter-2', content: '' }
      ],
      versions: [{ id: 'version-1', content: '' }]
    })
    createContentDatabase(join(backupDir, 'workspace.db'), {
      chapters: [
        { id: 'chapter-1', content: '<p>备份第一章</p>' },
        { id: 'chapter-2', content: '<p>备份第二章</p>' }
      ],
      versions: [{ id: 'version-1', content: '<p>备份历史版本</p>' }]
    })
    await writeFile(join(backupDir, 'manifest.json'), JSON.stringify({
      appVersion: '1.21.0',
      fromSchemaVersion: 1,
      toSchemaVersion: 2
    }), 'utf8')

    const result = await recoverMissingChapterContentFromUpgradeBackup(workspaceDir)
    assert.equal(result?.chaptersRestored, 1)
    assert.equal(result?.versionsRestored, 1)

    const db = new DatabaseSync(join(workspaceDir, 'workspace.db'))
    assert.equal(db.prepare('SELECT content FROM chapters WHERE id = ?').get('chapter-1').content, '<p>当前第一章</p>')
    assert.equal(db.prepare('SELECT content FROM chapters WHERE id = ?').get('chapter-2').content, '<p>备份第二章</p>')
    assert.equal(db.prepare('SELECT content FROM chapter_versions WHERE id = ?').get('version-1').content, '<p>备份历史版本</p>')
    assert.ok(db.prepare('SELECT content_length FROM chapters WHERE id = ?').get('chapter-2').content_length > 0)
    assert.ok(db.prepare('SELECT content_length FROM chapter_versions WHERE id = ?').get('version-1').content_length > 0)
    db.close()
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
