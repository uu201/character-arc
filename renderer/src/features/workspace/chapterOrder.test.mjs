import assert from 'node:assert/strict'
import test from 'node:test'

import { assignSparseChapterOrder } from './chapterOrder.ts'

function chapter(index) {
  return {
    id: `chapter-${index}`,
    volumeId: 'volume-1',
    sortOrder: (index + 1) * 1024
  }
}

test('数千章中移动单章只生成一条排序写入', () => {
  const original = Array.from({ length: 5000 }, (_, index) => chapter(index))
  const moved = original[0]
  const reordered = [...original.slice(1, 2500), moved, ...original.slice(2500)]

  const result = assignSparseChapterOrder(reordered, [moved.id])

  assert.equal(result.items.length, 5000)
  assert.equal(result.chapters.length, 1)
  assert.equal(result.chapters[0].id, moved.id)
  assert.ok(result.chapters[0].sortOrder > result.items[2498].sortOrder)
  assert.ok(result.chapters[0].sortOrder < result.items[2500].sortOrder)
})

test('排序间隙耗尽时才回退为全量重排', () => {
  const items = [
    { id: 'chapter-a', volumeId: 'volume-1', sortOrder: 10 },
    { id: 'chapter-c', volumeId: 'volume-1', sortOrder: 99 },
    { id: 'chapter-b', volumeId: 'volume-1', sortOrder: 11 }
  ]

  const result = assignSparseChapterOrder(items, ['chapter-c'])

  assert.equal(result.chapters.length, 3)
  assert.deepEqual(result.items.map((item) => item.sortOrder), [1024, 2048, 3072])
})
