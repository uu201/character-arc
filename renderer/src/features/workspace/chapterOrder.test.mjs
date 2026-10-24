import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'

import { assignSparseChapterOrder } from './chapterOrder.ts'
import { loadAllChapterContent } from '../chapters/chapterExport.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context)
    }
    if (specifier.startsWith('@shared/')) {
      return nextResolve(new URL(`../../../../electron/shared/${specifier.slice(8)}.ts`, import.meta.url).href, context)
    }
    if (specifier.startsWith('.') && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(candidate)) return nextResolve(candidate.href, context)
    }
    return nextResolve(specifier, context)
  }
})

const { normalizeProjectWorkspaceData } = await import('./storeHelpers.ts')

test('旧错序数据加载后目录、编辑页序号和导出数组均按卷序保持一致', async () => {
  const oldChapters = Array.from({ length: 60 }, (_, index) => ({
    id: `old-${index + 1}`, volumeId: index < 30 ? 'v1' : 'v2', title: `旧第${index + 1}章`,
    sortOrder: (index + 1) * 1024, content: `旧正文${index + 1}`
  }))
  const newChapters = Array.from({ length: 3 }, (_, index) => ({
    id: `new-${index + 61}`, volumeId: 'v3', title: `第${index + 61}章`, sortOrder: index,
    content: '', contentLoaded: false, contentLength: 15000
  }))
  const workspace = normalizeProjectWorkspaceData({
    outlineVolumes: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
    chapters: [...newChapters, ...oldChapters]
  })
  const expectedIds = [...oldChapters, ...newChapters].map(item => item.id)
  assert.deepEqual(workspace.chapters.map(item => item.id), expectedIds)
  assert.equal(workspace.chapters.findIndex(item => item.id === 'new-61') + 1, 61)
  assert.equal(workspace.chapters[30].id, 'old-31')
  assert.equal(workspace.chapters[62].id, 'new-63')
  assert.equal(workspace.chapters[60].contentLoaded, false)
  assert.equal(workspace.chapters[60].contentLength, 15000)
  const exported = await loadAllChapterContent(workspace.chapters, async id => ({
    ...workspace.chapters.find(item => item.id === id), contentLoaded: true, content: `完整正文${id}`
  }))
  assert.deepEqual(exported.map(item => item.id), expectedIds)
  assert.equal(exported[60].content, '完整正文new-61')
  assert.deepEqual(normalizeProjectWorkspaceData(workspace).chapters, workspace.chapters)
})

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
