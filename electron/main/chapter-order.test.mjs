import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/workspace-store')) {
      return { url: 'test:chapter-order-workspace-store', shortCircuit: true }
    }
    if (specifier.startsWith('.') && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(candidate)) return nextResolve(candidate.href, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'test:chapter-order-workspace-store') {
      return { format: 'module', source: 'export async function ensureWorkspaceDb() { return globalThis.__chapterOrderTestDb }', shortCircuit: true }
    }
    return nextLoad(url, context)
  }
})

const { insertChapterAtVolumeEnd, repairChapterOrder } = await import('./chapter-order.ts')
const { createCommitter } = await import('./ai/runtime-v2/committer.ts')

function createDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE outline_volumes (id TEXT PRIMARY KEY, project_id TEXT, sort_order INTEGER);
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY, project_id TEXT, volume_id TEXT, outline_item_id TEXT,
      title TEXT, summary TEXT, status TEXT, word_target TEXT, content TEXT, sort_order INTEGER
    );
    CREATE TABLE chapter_versions (id TEXT PRIMARY KEY, chapter_id TEXT, content TEXT);
    CREATE TABLE outline_items (id TEXT PRIMARY KEY, project_id TEXT, volume_id TEXT);
    INSERT INTO outline_volumes VALUES ('v1', 'p', 0), ('v2', 'p', 1), ('v3', 'p', 2), ('other-v', 'other', 0);
  `)
  return db
}

function chapter(id, volumeId) {
  return { id, volumeId, outlineItemId: '', title: id, summary: '', status: 'draft', wordTarget: '3000', content: `<p>${id}</p>` }
}

function seed(db, id, volumeId, sortOrder, projectId = 'p') {
  const item = chapter(id, volumeId)
  db.prepare('INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, volumeId, item.outlineItemId, item.title, item.summary, item.status, item.wordTarget, item.content, sortOrder)
}

function ids(db, projectId = 'p') {
  return db.prepare('SELECT id FROM chapters WHERE project_id = ? ORDER BY sort_order, rowid').all(projectId).map(row => row.id)
}

test('AI按末卷大纲创建初稿时走统一全书排序，保留大纲绑定', async () => {
  const activeDb = createDb()
  globalThis.__chapterOrderTestDb = activeDb
  try {
    for (let i = 1; i <= 60; i++) seed(activeDb, `chapter-${i}`, i <= 30 ? 'v1' : 'v2', i * 1024)
    activeDb.exec("INSERT INTO outline_items VALUES ('outline-61', 'p', 'v3')")
    const commit = createCommitter({ resolveProjectId: () => 'p' })
    const created = []
    for (let i = 61; i <= 63; i++) {
      const result = await commit({
        id: `change-${i}`, sessionId: 'session', kind: 'chapter', action: 'create', entityTitle: `第${i}章`,
        entityPayload: { volumeId: 'v1', outlineItemId: 'outline-61', title: `第${i}章` },
        chapterHtml: { old: '', new: `<p>正文${i}</p>` }
      })
      assert.equal(result.ok, true)
      created.push(result.entityId)
    }
    assert.deepEqual(ids(activeDb).slice(-3), created)
    assert.equal(ids(activeDb).indexOf(created[0]) + 1, 61)
    const row = activeDb.prepare('SELECT volume_id, outline_item_id, content FROM chapters WHERE id = ?').get(created[0])
    assert.deepEqual({ ...row }, { volume_id: 'v3', outline_item_id: 'outline-61', content: '<p>正文61</p>' })
  } finally {
    delete globalThis.__chapterOrderTestDb
    activeDb.close()
  }
})

test('旧工程60章后新增末卷三章，内部序号保持61至63', () => {
  const db = createDb()
  try {
    for (let i = 1; i <= 60; i++) seed(db, `chapter-${i}`, i <= 30 ? 'v1' : 'v2', i * 1024)
    for (let i = 61; i <= 63; i++) insertChapterAtVolumeEnd(db, 'p', chapter(`chapter-${i}`, 'v3'))
    assert.deepEqual(ids(db), Array.from({ length: 63 }, (_, i) => `chapter-${i + 1}`))
    assert.equal(db.prepare('SELECT content FROM chapters WHERE id = ?').get('chapter-61').content, '<p>chapter-61</p>')
  } finally { db.close() }
})

test('在已有卷或空的中间卷新增章节，都插入目标卷末尾', () => {
  const db = createDb()
  try {
    seed(db, 'a', 'v1', 0)
    seed(db, 'c', 'v3', 1)
    insertChapterAtVolumeEnd(db, 'p', chapter('b', 'v2'))
    assert.deepEqual(ids(db), ['a', 'b', 'c'])
    insertChapterAtVolumeEnd(db, 'p', chapter('a2', 'v1'))
    assert.deepEqual(ids(db), ['a', 'a2', 'b', 'c'])
  } finally { db.close() }
})

test('修复旧错序时遵循卷序及现有卷内顺序，保留正文和版本且可重复执行', () => {
  const db = createDb()
  try {
    seed(db, 'old-b', 'v1', 1024)
    seed(db, 'old-a', 'v1', 2048)
    seed(db, 'new-61', 'v3', 0)
    seed(db, 'new-62', 'v3', 1)
    seed(db, 'new-63', 'v3', 2)
    seed(db, 'other', 'other-v', 99, 'other')
    db.prepare('INSERT INTO chapter_versions VALUES (?, ?, ?)').run('version', 'new-61', '历史正文')
    const before = db.prepare('SELECT id, volume_id, title, content FROM chapters ORDER BY id').all()
    repairChapterOrder(db)
    assert.deepEqual(ids(db), ['old-b', 'old-a', 'new-61', 'new-62', 'new-63'])
    assert.deepEqual(db.prepare('SELECT id, volume_id, title, content FROM chapters ORDER BY id').all(), before)
    assert.equal(db.prepare('SELECT content FROM chapter_versions').get().content, '历史正文')
    assert.equal(db.prepare('SELECT sort_order FROM chapters WHERE id = ?').get('other').sort_order, 99)
    const changes = db.prepare('SELECT total_changes() AS count').get().count
    repairChapterOrder(db)
    assert.equal(db.prepare('SELECT total_changes() AS count').get().count, changes)
  } finally { db.close() }
})

test('新建章节失败时回滚排序修复', () => {
  const db = createDb()
  try {
    seed(db, 'a', 'v1', 1024)
    seed(db, 'b', 'v3', 0)
    const before = db.prepare('SELECT * FROM chapters ORDER BY id').all()
    assert.throws(() => insertChapterAtVolumeEnd(db, 'p', chapter('a', 'v3')), /UNIQUE/)
    assert.deepEqual(db.prepare('SELECT * FROM chapters ORDER BY id').all(), before)
  } finally { db.close() }
})

test('稀疏排序存在间隔时，新建章节不重写其他章节排序', () => {
  const db = createDb()
  try {
    seed(db, 'a', 'v1', 1024)
    seed(db, 'c', 'v3', 8192)
    const changes = db.prepare('SELECT total_changes() AS count').get().count
    insertChapterAtVolumeEnd(db, 'p', chapter('b', 'v2'))
    assert.equal(db.prepare('SELECT total_changes() AS count').get().count - changes, 1)
    assert.deepEqual(ids(db), ['a', 'b', 'c'])
  } finally { db.close() }
})
