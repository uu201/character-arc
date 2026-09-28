import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChapterVersionCompareRows } from './chapterVersionDiff.ts'

test('段落增加文字时显示为修改并精确标记新增内容', () => {
  const rows = buildChapterVersionCompareRows('他走进房间。', '他缓慢地走进房间。')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].state, 'modified')
  assert.equal(rows[0].afterSegments.filter((segment) => segment.changed).map((segment) => segment.text).join(''), '缓慢地')
})

test('同一段多处修改时保留多个字符级差异片段', () => {
  const rows = buildChapterVersionCompareRows('清晨，他独自走进旧城。', '深夜，他缓慢走进新城。')
  assert.equal(rows[0].state, 'modified')
  assert.ok(rows[0].beforeSegments.filter((segment) => segment.changed).length >= 2)
  assert.ok(rows[0].afterSegments.filter((segment) => segment.changed).length >= 2)
})

test('完全无关的段落仍显示为删除和新增', () => {
  const rows = buildChapterVersionCompareRows('春天到了。', '飞船降落在火星基地。')
  assert.deepEqual(rows.map((row) => row.state), ['removed', 'added'])
})
