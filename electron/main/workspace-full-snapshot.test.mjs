import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { prepareWorkspaceHierarchyUpserts } from './workspace-snapshot-upserts.ts'

test('父记录更新不会级联清空未加载的章节正文和历史版本', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE outline_volumes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      word_target TEXT NOT NULL,
      summary TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      volume_id TEXT NOT NULL,
      outline_item_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      word_target TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
      FOREIGN KEY (volume_id) REFERENCES outline_volumes (id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE chapter_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      word_target TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE
    ) STRICT;

    INSERT INTO projects (id) VALUES ('project-1');
    INSERT INTO outline_volumes (id, project_id, title, word_target, summary, sort_order)
    VALUES ('volume-1', 'project-1', '第一卷', '100000', '', 0);
    INSERT INTO chapters (id, project_id, volume_id, outline_item_id, title, summary, status, word_target, content, sort_order)
    VALUES ('chapter-1', 'project-1', 'volume-1', '', '第一章', '', 'draft', '3000', '<p>原始正文</p>', 1024);
    INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
    VALUES ('version-1', 'project-1', 'chapter-1', '第一章', '', 'draft', '3000', '<p>历史正文</p>', '2026-10-02T00:00:00.000Z');
  `)

  const { insertOutlineVolume, insertChapter } = prepareWorkspaceHierarchyUpserts(db)
  insertOutlineVolume.run('volume-1', 'project-1', '第一卷（更新）', '120000', '新摘要', 0)

  assert.equal(
    db.prepare('SELECT content FROM chapters WHERE id = ?').get('chapter-1').content,
    '<p>原始正文</p>'
  )
  assert.equal(
    db.prepare('SELECT content FROM chapter_versions WHERE id = ?').get('version-1').content,
    '<p>历史正文</p>'
  )

  insertChapter.run(
    'chapter-1',
    'project-1',
    'volume-1',
    '',
    '第一章（更新）',
    '',
    'draft',
    '3000',
    '<p>更新正文</p>',
    1024
  )

  assert.equal(
    db.prepare('SELECT content FROM chapter_versions WHERE id = ?').get('version-1').content,
    '<p>历史正文</p>'
  )
  db.close()
})
