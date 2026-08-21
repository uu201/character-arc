import type { JSONContent } from '@tiptap/core'

export type ChapterFormatResult = {
  document: JSONContent
  changed: boolean
  paragraphCount: number
}

/**
 * 整理正文的块级结构：
 * - 段落内的硬换行拆为独立段落；
 * - 删除多余空段和段首/段尾手工空格；
 * - 保留文字的 marks（加粗、下划线等）和非段落块节点。
 *
 * 首行缩进和段间距由编辑器 CSS 统一呈现，避免在正文中插入
 * 全角空格或空段落，导致字数和导出内容被污染。
 */
export function formatChapterEditorDocument(document: JSONContent): ChapterFormatResult {
  const sourceContent = Array.isArray(document.content) ? document.content : []
  const content: JSONContent[] = []
  let paragraphCount = 0

  for (const node of sourceContent) {
    if (node.type !== 'paragraph') {
      content.push(node)
      continue
    }

    const paragraphs = splitParagraphNode(node)
    paragraphCount += paragraphs.length
    content.push(...paragraphs)
  }

  if (content.length === 0) {
    content.push({ type: 'paragraph' })
  }

  const formatted: JSONContent = {
    ...document,
    type: document.type || 'doc',
    content
  }

  return {
    document: formatted,
    changed: JSON.stringify(formatted) !== JSON.stringify(document),
    paragraphCount
  }
}

function splitParagraphNode(node: JSONContent): JSONContent[] {
  const segments: JSONContent[][] = [[]]

  for (const inline of node.content ?? []) {
    if (inline.type === 'hardBreak') {
      segments.push([])
      continue
    }

    if (inline.type === 'text' && typeof inline.text === 'string' && /[\r\n]/.test(inline.text)) {
      const parts = inline.text.replace(/\r\n?/g, '\n').split('\n')
      parts.forEach((part, index) => {
        if (index > 0) segments.push([])
        if (part) segments[segments.length - 1].push({ ...inline, text: part })
      })
      continue
    }

    segments[segments.length - 1].push(inline)
  }

  return segments
    .map(trimInlineWhitespace)
    .filter((segment) => hasVisibleInlineContent(segment))
    .map((segment) => ({
      ...node,
      content: segment
    }))
}

function trimInlineWhitespace(content: JSONContent[]): JSONContent[] {
  const trimmed = content.map((node) => ({ ...node }))

  for (let index = 0; index < trimmed.length; index += 1) {
    const node = trimmed[index]
    if (node.type !== 'text' || typeof node.text !== 'string') continue
    node.text = node.text.replace(/^[\s\u3000]+/u, '')
    if (!node.text) {
      trimmed.splice(index, 1)
      index -= 1
      continue
    }
    break
  }

  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    const node = trimmed[index]
    if (node.type !== 'text' || typeof node.text !== 'string') continue
    node.text = node.text.replace(/[\s\u3000]+$/u, '')
    if (!node.text) {
      trimmed.splice(index, 1)
      continue
    }
    break
  }

  return trimmed
}

function hasVisibleInlineContent(content: JSONContent[]): boolean {
  return content.some((node) => {
    if (node.type === 'text') return Boolean(node.text?.trim())
    return node.type !== 'hardBreak'
  })
}
