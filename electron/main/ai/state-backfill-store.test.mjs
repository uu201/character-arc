import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  beginBackfillChapter,
  buildBackfillContentHash,
  finishBackfillChapter,
  initStateBackfillSchema,
  readBackfillChapterStatuses,
  selectBackfillChapterStatuses
} from './state-backfill-store.ts'

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE ai_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    ) STRICT;
  `)
  initStateBackfillSchema(db)
  return db
}

test('扫描状态区分未扫描、成功和正文已变化', () => {
  const db = makeDb()
  const original = '正文'.repeat(30)
  db.prepare('INSERT INTO chapters VALUES (?, ?, ?, ?, ?)').run('c1', 'p1', '第一章', original, 1)
  db.prepare('INSERT INTO chapters VALUES (?, ?, ?, ?, ?)').run('c2', 'p1', '第二章', original, 2)

  const contentHash = buildBackfillContentHash(original)
  beginBackfillChapter(db, {
    projectId: 'p1', chapterId: 'c1', chapterTitle: '第一章', chapterIndex: 1, contentHash
  })
  finishBackfillChapter(db, {
    projectId: 'p1', chapterId: 'c1', contentHash, status: 'success', delta: { timeline: { events: ['出发'] } }
  })

  assert.deepEqual(readBackfillChapterStatuses(db, 'p1').map((item) => item.status), ['success', 'unscanned'])
  db.prepare('UPDATE chapters SET content = ? WHERE id = ?').run('修改后正文'.repeat(20), 'c1')
  assert.equal(readBackfillChapterStatuses(db, 'p1')[0].status, 'stale')
})

test('旧版成功运行记录会迁移为已扫描状态', () => {
  const db = makeDb()
  const content = '已有小说正文'.repeat(15)
  db.prepare('INSERT INTO chapters VALUES (?, ?, ?, ?, ?)').run('c1', 'p1', '第一章', content, 1)
  db.prepare('INSERT INTO ai_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'run1', 'p1', 'c1', 'state-backfill', 'success', '', '2026-07-20T10:00:00.000Z', 1
  )

  const [status] = readBackfillChapterStatuses(db, 'p1')
  assert.equal(status.status, 'success')
  assert.equal(status.attemptCount, 1)
})

test('稀疏排序值只参与排序，补录章号按全书位置计算并包含空白章节', () => {
  const db = makeDb()
  const insert = db.prepare('INSERT INTO chapters VALUES (?, ?, ?, ?, ?)')
  const content = '已有小说正文'.repeat(15)
  insert.run('c3', 'p1', '', content, 52224)
  insert.run('c1', 'p1', '第一章', content, 1024)
  insert.run('empty', 'p1', '第二章', '', 15360)
  insert.run('other', 'p2', '其他项目', content, 512)

  const statuses = readBackfillChapterStatuses(db, 'p1')
  assert.deepEqual(statuses.map(({ chapterId, chapterIndex, chapterNumber, chapterTitle }) => ({
    chapterId, chapterIndex, chapterNumber, chapterTitle
  })), [
    { chapterId: 'c1', chapterIndex: 0, chapterNumber: 1, chapterTitle: '第一章' },
    { chapterId: 'c3', chapterIndex: 2, chapterNumber: 3, chapterTitle: '第 3 章' }
  ])
  assert.equal(selectBackfillChapterStatuses(statuses, { mode: 'custom', chapterIds: ['c3'] })[0].chapterIndex, 2)
  db.close()
})

test('默认、失败和自定义范围都不会重复选择已完成章节', () => {
  const statuses = [
    { chapterId: 'c1', status: 'success' },
    { chapterId: 'c2', status: 'skipped' },
    { chapterId: 'c3', status: 'failed' },
    { chapterId: 'c4', status: 'unscanned' },
    { chapterId: 'c5', status: 'stale' }
  ].map((item, index) => ({
    chapterTitle: `第${index + 1}章`,
    chapterIndex: index,
    chapterNumber: index + 1,
    contentHash: `hash-${index}`,
    attemptCount: 0,
    error: '',
    updatedAt: '',
    ...item
  }))

  assert.deepEqual(selectBackfillChapterStatuses(statuses).map((item) => item.chapterId), ['c3', 'c4', 'c5'])
  assert.deepEqual(selectBackfillChapterStatuses(statuses, { mode: 'failed' }).map((item) => item.chapterId), ['c3'])
  assert.deepEqual(selectBackfillChapterStatuses(statuses, {
    mode: 'custom', chapterIds: ['c1', 'c4', 'c5']
  }).map((item) => item.chapterId), ['c4', 'c5'])
})
