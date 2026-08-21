import assert from 'node:assert/strict'
import test from 'node:test'
import { formatChapterEditorDocument } from './chapterFormatting.ts'

test('一键排版将段内换行拆为段落并删除空段', () => {
  const result = formatChapterEditorDocument({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '　　第一段  ' },
          { type: 'hardBreak' },
          { type: 'hardBreak' },
          { type: 'text', text: '  第二段　' }
        ]
      },
      { type: 'paragraph' }
    ]
  })

  assert.equal(result.changed, true)
  assert.equal(result.paragraphCount, 2)
  assert.deepEqual(result.document.content, [
    { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] }
  ])
})

test('一键排版保留行内格式和非段落节点', () => {
  const heading = { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '场景一' }] }
  const result = formatChapterEditorDocument({
    type: 'doc',
    content: [
      heading,
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '  重要', marks: [{ type: 'bold' }] },
          { type: 'text', text: '内容', marks: [{ type: 'underline' }] }
        ]
      }
    ]
  })

  assert.deepEqual(result.document.content?.[0], heading)
  assert.deepEqual(result.document.content?.[1]?.content, [
    { type: 'text', text: '重要', marks: [{ type: 'bold' }] },
    { type: 'text', text: '内容', marks: [{ type: 'underline' }] }
  ])
})

test('空正文排版后仍保留一个可编辑段落', () => {
  const result = formatChapterEditorDocument({
    type: 'doc',
    content: [{ type: 'paragraph' }, { type: 'paragraph' }]
  })

  assert.deepEqual(result.document, {
    type: 'doc',
    content: [{ type: 'paragraph' }]
  })
  assert.equal(result.paragraphCount, 0)
})
