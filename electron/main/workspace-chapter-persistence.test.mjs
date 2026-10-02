import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  readChapterMutationPayload,
  writeChapterOrder,
  writeChapterRows
} from './chapter-persistence.ts'

function createDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      word_count TEXT NOT NULL,
      last_edited TEXT NOT NULL
    ) STRICT;
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      volume_id TEXT NOT NULL,
      outline_item_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      word_target TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    ) STRICT;
  `)
  db.prepare('INSERT INTO projects (id, word_count, last_edited) VALUES (?, ?, ?)')
    .run('project-1', '共 6 字', '2026-10-01T00:00:00.000Z')
  const insert = db.prepare(`
    INSERT INTO chapters (
      id, project_id, volume_id, outline_item_id, title, summary,
      status, word_target, content, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insert.run('chapter-1', 'project-1', 'volume-1', '', '第一章', '摘要一', 'draft', '预估 3000字', '旧正文一', 1024)
  insert.run('chapter-2', 'project-1', 'volume-1', '', '第二章', '摘要二', 'draft', '预估 3000字', '旧正文二', 2048)
  return db
}

test('章节增量保存只更新请求中的章节，不重写其他正文', () => {
  const db = createDb()

  writeChapterRows(db, {
    projectId: 'project-1',
    projectWordCount: '共 8 字',
    chapters: [{
      id: 'chapter-2',
      outlineItemId: '',
      volumeId: 'volume-1',
      sortOrder: 2048,
      title: '第二章（修订）',
      summary: '新摘要',
      status: 'review',
      wordTarget: '预估 4000字',
      content: '新正文二'
    }]
  })

  const rows = db.prepare('SELECT id, title, content, sort_order FROM chapters ORDER BY sort_order').all()
    .map((row) => ({ ...row }))
  assert.deepEqual(rows, [
    { id: 'chapter-1', title: '第一章', content: '旧正文一', sort_order: 1024 },
    { id: 'chapter-2', title: '第二章（修订）', content: '新正文二', sort_order: 2048 }
  ])
  assert.equal(db.prepare('SELECT word_count FROM projects WHERE id = ?').get('project-1').word_count, '共 8 字')
})

test('章节排序保存只更新轻量排序字段并保留正文', () => {
  const db = createDb()

  writeChapterOrder(db, {
    projectId: 'project-1',
    chapters: [
      { id: 'chapter-2', volumeId: 'volume-2', sortOrder: 1024 },
      { id: 'chapter-1', volumeId: 'volume-1', sortOrder: 2048 }
    ]
  })

  const rows = db.prepare('SELECT id, volume_id, content, sort_order FROM chapters ORDER BY sort_order').all()
    .map((row) => ({ ...row }))
  assert.deepEqual(rows, [
    { id: 'chapter-2', volume_id: 'volume-2', content: '旧正文二', sort_order: 1024 },
    { id: 'chapter-1', volume_id: 'volume-1', content: '旧正文一', sort_order: 2048 }
  ])
})

test('稀疏章节排序只更新请求中的章节', () => {
  const db = createDb()

  writeChapterOrder(db, {
    projectId: 'project-1',
    chapters: [
      { id: 'chapter-2', volumeId: 'volume-2', sortOrder: 512 }
    ]
  })

  const rows = db.prepare('SELECT id, volume_id, content, sort_order FROM chapters ORDER BY id').all()
    .map((row) => ({ ...row }))
  assert.deepEqual(rows, [
    { id: 'chapter-1', volume_id: 'volume-1', content: '旧正文一', sort_order: 1024 },
    { id: 'chapter-2', volume_id: 'volume-2', content: '旧正文二', sort_order: 512 }
  ])
})

test('未加载正文的元数据保存不会用预览覆盖完整正文', () => {
  const db = createDb()

  writeChapterRows(db, {
    projectId: 'project-1',
    projectWordCount: '共 6 字',
    chapters: [{
      id: 'chapter-1',
      outlineItemId: '',
      volumeId: 'volume-1',
      title: '第一章（改名）',
      summary: '摘要已更新',
      status: 'review',
      wordTarget: '预估 3500字',
      content: '仅为预览',
      contentLoaded: false
    }]
  })

  const row = db.prepare('SELECT title, summary, status, word_target, content FROM chapters WHERE id = ?')
    .get('chapter-1')
  assert.deepEqual({ ...row }, {
    title: '第一章（改名）',
    summary: '摘要已更新',
    status: 'review',
    word_target: '预估 3500字',
    content: '旧正文一'
  })
})

test('章节增量快照只读取指定章节并携带项目字数', () => {
  const db = createDb()

  const payload = readChapterMutationPayload(db, 'project-1', ['chapter-2'])

  assert.deepEqual(payload, {
    projectId: 'project-1',
    projectWordCount: '共 6 字',
    chapters: [{
      id: 'chapter-2',
      outlineItemId: '',
      volumeId: 'volume-1',
      sortOrder: 2048,
      title: '第二章',
      summary: '摘要二',
      status: 'draft',
      wordTarget: '预估 3000字',
      content: '旧正文二'
    }]
  })
  assert.equal(readChapterMutationPayload(db, 'project-1', ['missing']), null)
})
