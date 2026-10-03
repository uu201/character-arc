import assert from 'node:assert/strict'
import test from 'node:test'

import {
  insertInHtml,
  joinChapterBlocks,
  replaceInHtml,
  replaceAllInHtml
} from './chapter-html-edit.ts'

test('段内替换不会生成嵌套 p 或额外空段落', () => {
  const result = replaceInHtml('<p>风从旧城吹过。</p>', '旧城', '北境')

  assert.equal(result, '<p>风从北境吹过。</p>')
  assert.doesNotMatch(result, /<p>[^]*<p>/)
  assert.doesNotMatch(result, /<p><\/p>/)
})

test('整段替换保留与下一段之间的段落边界', () => {
  const result = replaceInHtml(
    '<p>需要完整替换的第一段。</p><p>下一段必须保持独立。</p>',
    '需要完整替换的第一段。',
    '替换后的第一段。'
  )

  assert.equal(result, '<p>替换后的第一段。</p><p>下一段必须保持独立。</p>')
})

test('局部替换禁止跨越两个独立段落', () => {
  assert.throws(
    () => replaceInHtml('<p>甲。</p><p>乙。</p>', '甲。乙。', '跨段。'),
    /Could not find target text/
  )
})

test('段首全角缩进不会导致替换位置漂移', () => {
  assert.equal(
    replaceInHtml('<p>　旧句</p>', '旧句', '新句'),
    '<p>　新句</p>'
  )
})

test('目标文本重复时拒绝猜测替换位置', () => {
  assert.throws(
    () => replaceInHtml(
      '<p>重复句。</p><p>中间。</p><p>重复句。</p>',
      '重复句。',
      '目标句。'
    ),
    /Ambiguous target text/
  )
})

test('中间整段替换不会与前后段落合并', () => {
  const result = replaceInHtml(
    '<p>第一段。</p><p>需要替换的中间段。</p><p>第三段。</p>',
    '需要替换的中间段。',
    '新的中间段。'
  )

  assert.equal(result, '<p>第一段。</p><p>新的中间段。</p><p>第三段。</p>')
})

test('多行替换在原段落内使用硬换行，不产生额外空段落', () => {
  const result = replaceInHtml('<p>开头旧句结尾</p>', '旧句', '第一句\n第二句')

  assert.equal(result, '<p>开头第一句<br>第二句结尾</p>')
  assert.doesNotMatch(result, /<p><\/p>/)
})

test('锚点插入保持合法段落结构', () => {
  assert.equal(
    insertInHtml('<p>甲乙</p>', '甲', '新增', 'after'),
    '<p>甲<br>新增乙</p>'
  )
})

test('在整段末尾插入不会吞掉下一段的开始标签', () => {
  assert.equal(
    insertInHtml('<p>第一段</p><p>第二段</p>', '第一段', '新增', 'after'),
    '<p>第一段<br>新增</p><p>第二段</p>'
  )
})

test('空编辑器追加正文时替换占位空段落', () => {
  assert.equal(joinChapterBlocks('<p></p>', '<p>正文</p>', 'end'), '<p>正文</p>')
})

test('整章替换不需要定位原文，并重新生成合法段落', () => {
  assert.equal(
    replaceAllInHtml('<p>旧正文</p>', '新正文第一段\n\n新正文第二段'),
    '<p>新正文第一段</p><p>新正文第二段</p>'
  )
})

test('AI 修改内容写入可追溯的颜色标记', () => {
  const revision = {
    id: 'change-1',
    source: 'ai',
    color: '#FFE58F',
    turnId: 'turn-1',
    reason: '调整人物语气',
    createdAt: '2026-10-03T08:00:00.000Z'
  }
  const result = replaceInHtml('<p>他说旧话。</p>', '旧话', '新话', revision)

  assert.match(result, /<mark /)
  assert.match(result, /data-arc-revision-id="change-1"/)
  assert.match(result, /data-arc-revision-turn-id="turn-1"/)
  assert.match(result, /data-arc-revision-reason="调整人物语气"/)
  assert.match(result, />新话<\/mark>/)
})

test('再次替换已标注内容时不会生成嵌套标记', () => {
  const result = replaceInHtml(
    '<p><mark data-arc-revision-id="old" data-arc-revision-source="ai">前旧句后</mark></p>',
    '旧句',
    '新句',
    {
      id: 'new',
      source: 'ai',
      color: '#BAE7FF',
      createdAt: '2026-10-03T09:00:00.000Z'
    }
  )

  assert.doesNotMatch(result, /<mark[^>]*>[^]*<mark/)
  assert.equal((result.match(/<mark\b/g) ?? []).length, 1)
  assert.match(result, /前<mark[^>]*>新句<\/mark>后/)
})
