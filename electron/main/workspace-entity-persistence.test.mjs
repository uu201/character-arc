import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { writeWorkspaceEntities } from './workspace-entity-persistence.ts'

function createDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE worldview_entries (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE characters (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      description TEXT NOT NULL, avatar TEXT NOT NULL, tags_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE inspiration_entries (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, tags_json TEXT NOT NULL, source TEXT NOT NULL, sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE character_relationships (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, from_character_id TEXT NOT NULL,
      to_character_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE organization_memberships (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, character_id TEXT NOT NULL
    ) STRICT;
  `)
  return db
}

test('实体增量保存会更新排序并删除当前项目中的旧行', () => {
  const db = createDb()
  db.prepare(`INSERT INTO worldview_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'world-old', 'project-1', '历史', '旧条目', '旧内容', 0, '2026-01-01', '2026-01-01'
  )
  db.prepare(`INSERT INTO worldview_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'world-keep', 'project-1', '地理', '旧标题', '旧内容', 1, '2026-01-01', '2026-01-01'
  )

  writeWorkspaceEntities(db, {
    projectId: 'project-1',
    worldviewEntries: [{
      id: 'world-keep',
      type: '法则',
      title: '新标题',
      content: '新内容',
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-10-02'
    }]
  })

  const rows = db.prepare(`SELECT id, type, title, sort_order AS sortOrder FROM worldview_entries`)
    .all()
    .map((row) => ({ ...row }))
  assert.deepEqual(rows, [{ id: 'world-keep', type: '法则', title: '新标题', sortOrder: 0 }])
})

test('删除角色时会在同一事务清理关系和组织归属', () => {
  const db = createDb()
  const insertCharacter = db.prepare(`INSERT INTO characters VALUES (?, ?, ?, ?, ?, ?, ?)`)
  insertCharacter.run('char-keep', 'project-1', '保留角色', '', '', '', '[]')
  insertCharacter.run('char-delete', 'project-1', '删除角色', '', '', '', '[]')
  db.prepare(`INSERT INTO character_relationships VALUES (?, ?, ?, ?)`).run(
    'rel-delete', 'project-1', 'char-keep', 'char-delete'
  )
  db.prepare(`INSERT INTO organization_memberships VALUES (?, ?, ?)`).run(
    'membership-delete', 'project-1', 'char-delete'
  )

  writeWorkspaceEntities(db, {
    projectId: 'project-1',
    characters: [{
      id: 'char-keep',
      name: '保留角色（更新）',
      role: '主角',
      description: '',
      avatar: '',
      tags: []
    }]
  })

  assert.deepEqual(db.prepare(`SELECT id, name FROM characters`).all().map((row) => ({ ...row })), [
    { id: 'char-keep', name: '保留角色（更新）' }
  ])
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM character_relationships`).get().count, 0)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM organization_memberships`).get().count, 0)
})

test('灵感集合以最后一次快照为准并删除旧卡片', () => {
  const db = createDb()
  db.prepare(`INSERT INTO inspiration_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'idea-old', 'project-1', '场景火花', '旧灵感', '旧内容', '[]', 'manual', 0, '2026-01-01', '2026-01-01'
  )

  writeWorkspaceEntities(db, {
    projectId: 'project-1',
    inspirationEntries: [{
      id: 'idea-new',
      type: '剧情转折',
      title: '新灵感',
      content: '新内容',
      tags: ['反转'],
      source: 'manual',
      sortOrder: 0,
      createdAt: '2026-10-02',
      updatedAt: '2026-10-02'
    }]
  })

  assert.deepEqual(
    db.prepare(`SELECT id, title, tags_json AS tagsJson FROM inspiration_entries`).all().map((row) => ({ ...row })),
    [{ id: 'idea-new', title: '新灵感', tagsJson: '["反转"]' }]
  )
})
