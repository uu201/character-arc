import assert from 'node:assert/strict'
import test from 'node:test'
import { loadAllChapterContent } from './chapterExport.ts'

test('loads unloaded chapter bodies before export', async () => {
  const loaded = await loadAllChapterContent([
    { id: 'loaded', title: '已加载', contentLoaded: true, content: '<p>已有正文</p>' },
    { id: 'lazy', title: '待加载', contentLoaded: false, content: '' }
  ], async (id) => ({
    id,
    title: '待加载',
    contentLoaded: true,
    content: '<p>数据库正文</p>'
  }))

  assert.equal(loaded[0].content, '<p>已有正文</p>')
  assert.equal(loaded[1].content, '<p>数据库正文</p>')
})

test('stops export when a chapter body cannot be loaded', async () => {
  await assert.rejects(
    loadAllChapterContent([{ id: 'missing', title: '缺失正文', contentLoaded: false }], async () => null),
    /有章节正文加载失败/
  )
})
