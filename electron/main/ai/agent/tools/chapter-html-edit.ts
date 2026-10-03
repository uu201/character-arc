export type ChapterRevisionMetadata = {
  id: string
  source: 'ai' | 'manual'
  color: string
  turnId?: string
  reason?: string
  createdAt: string
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function wrapChapterRevisionHtml(html: string, revision?: ChapterRevisionMetadata): string {
  if (!revision || !html) return html
  const attrs = [
    `data-arc-revision-id="${escapeAttribute(revision.id)}"`,
    `data-arc-revision-source="${revision.source}"`,
    `data-arc-revision-color="${escapeAttribute(revision.color)}"`,
    `data-arc-revision-created-at="${escapeAttribute(revision.createdAt)}"`
  ]
  if (revision.turnId) attrs.push(`data-arc-revision-turn-id="${escapeAttribute(revision.turnId)}"`)
  if (revision.reason) attrs.push(`data-arc-revision-reason="${escapeAttribute(revision.reason)}"`)
  return `<mark ${attrs.join(' ')} style="background-color: ${escapeAttribute(revision.color)}">${html}</mark>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const BLOCK_SEPARATOR = '\uE000'
const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'blockquote', 'pre', 'section', 'article',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr'
])

type HtmlTextIndex = {
  value: string
  htmlStarts: number[]
  htmlEnds: number[]
}

function decodeHtmlEntity(entity: string): string | null {
  const named: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'"
  }
  if (named[entity]) return named[entity]
  const decimal = entity.match(/^&#(\d+);$/)
  const hexadecimal = entity.match(/^&#x([0-9a-f]+);$/i)
  const codePoint = decimal
    ? Number.parseInt(decimal[1], 10)
    : hexadecimal ? Number.parseInt(hexadecimal[1], 16) : Number.NaN
  if (!Number.isFinite(codePoint)) return null
  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return null
  }
}

function buildHtmlTextIndex(html: string): HtmlTextIndex {
  let value = ''
  const htmlStarts: number[] = []
  const htmlEnds: number[] = []
  const append = (text: string, start: number, end: number): void => {
    value += text
    for (let offset = 0; offset < text.length; offset += 1) {
      htmlStarts.push(start)
      htmlEnds.push(end)
    }
  }

  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i)
      if (close === -1) {
        append(html[i], i, i + 1)
        i += 1
        continue
      }
      const tag = html.slice(i + 1, close).trim()
      const tagName = tag.replace(/^\//, '').split(/[\s/>]/, 1)[0]?.toLowerCase() ?? ''
      if (tagName === 'br') {
        append('\n', i, close + 1)
      } else if (tag.startsWith('/') && BLOCK_TAGS.has(tagName) && value && !value.endsWith(BLOCK_SEPARATOR)) {
        append(BLOCK_SEPARATOR, i, close + 1)
      }
      i = close + 1
      continue
    }

    if (html[i] === '&') {
      const semi = html.indexOf(';', i)
      if (semi !== -1 && semi - i < 12) {
        const decoded = decodeHtmlEntity(html.slice(i, semi + 1))
        if (decoded !== null) {
          append(decoded, i, semi + 1)
          i = semi + 1
          continue
        }
      }
    }

    append(html[i], i, i + 1)
    i += 1
  }

  return { value, htmlStarts, htmlEnds }
}

export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

export function textToHtmlParagraphs(text: string, revision?: ChapterRevisionMetadata): string {
  return text
    .split(/\n{2,}|\n/)
    .filter(Boolean)
    .map((paragraph) => `<p>${wrapChapterRevisionHtml(escapeHtml(paragraph.trim()), revision)}</p>`)
    .join('')
}

function textToInlineHtml(text: string, revision?: ChapterRevisionMetadata): string {
  const html = text
    .trim()
    .split(/\n+/)
    .map((line) => escapeHtml(line.trim()))
    .join('<br>')
  return wrapChapterRevisionHtml(html, revision)
}

function buildWhitespaceInsensitiveIndex(text: string): { value: string; indexMap: number[] } {
  let value = ''
  const indexMap: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    if (/\s/.test(text[i])) continue
    value += text[i]
    indexMap.push(i)
  }
  return { value, indexMap }
}

type PlainTextRangeResult = { start: number; end: number } | 'ambiguous' | null

type RevisionMarkBoundary = {
  openStart: number
  openEnd: number
  closeStart: number
  closeEnd: number
}

function findContainingRevisionMark(html: string, start: number, end: number): RevisionMarkBoundary | null {
  const stack: Array<{ start: number; end: number; revision: boolean }> = []
  const tags = /<\/?mark\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = tags.exec(html))) {
    const tag = match[0]
    if (!tag.startsWith('</')) {
      stack.push({
        start: match.index,
        end: tags.lastIndex,
        revision: /\bdata-arc-revision-id\s*=/.test(tag)
      })
      continue
    }
    const open = stack.pop()
    if (
      open?.revision &&
      open.end <= start &&
      match.index >= end
    ) {
      return {
        openStart: open.start,
        openEnd: open.end,
        closeStart: match.index,
        closeEnd: tags.lastIndex
      }
    }
  }
  return null
}

function findUniqueStart(text: string, target: string): number | 'ambiguous' | null {
  const start = text.indexOf(target)
  if (start === -1) return null
  return text.indexOf(target, start + 1) === -1 ? start : 'ambiguous'
}

function findPlainTextRange(plain: string, search: string): PlainTextRangeResult {
  const target = search.trim()
  if (!target) return null

  const exactStart = findUniqueStart(plain, target)
  if (exactStart === 'ambiguous') return 'ambiguous'
  if (exactStart !== null) {
    return { start: exactStart, end: exactStart + target.length }
  }

  const compactTarget = target.replace(/\s+/g, '')
  if (!compactTarget) return null

  const compactPlain = buildWhitespaceInsensitiveIndex(plain)
  const compactStart = findUniqueStart(compactPlain.value, compactTarget)
  if (compactStart === 'ambiguous') return 'ambiguous'
  if (compactStart === null) return null

  const compactEnd = compactStart + compactTarget.length - 1
  return {
    start: compactPlain.indexMap[compactStart],
    end: compactPlain.indexMap[compactEnd] + 1
  }
}

export function replaceInHtml(
  html: string,
  search: string,
  replacement: string,
  revision?: ChapterRevisionMetadata
): string {
  const index = buildHtmlTextIndex(html)
  const range = findPlainTextRange(index.value, search)
  if (range === 'ambiguous') {
    throw new Error(`Ambiguous target text: "${search.slice(0, 50)}..."`)
  }
  if (!range) {
    throw new Error(`Could not find target text: "${search.slice(0, 50)}..."`)
  }
  const htmlStart = index.htmlStarts[range.start]
  const htmlEnd = index.htmlEnds[range.end - 1]
  const replacementHtml = textToInlineHtml(replacement, revision)
  const containingRevision = findContainingRevisionMark(html, htmlStart, htmlEnd)
  if (containingRevision) {
    return html.slice(0, containingRevision.openStart) +
      html.slice(containingRevision.openEnd, htmlStart) +
      replacementHtml +
      html.slice(htmlEnd, containingRevision.closeStart) +
      html.slice(containingRevision.closeEnd)
  }
  return html.slice(0, htmlStart) + replacementHtml + html.slice(htmlEnd)
}

/** 整章替换：显式操作才会调用，不依赖原文定位，输出标准段落 HTML。 */
export function replaceAllInHtml(
  _html: string,
  replacement: string,
  revision?: ChapterRevisionMetadata
): string {
  return textToHtmlParagraphs(replacement, revision)
}

export function insertInHtml(
  html: string,
  search: string,
  insertion: string,
  position: 'before' | 'after',
  revision?: ChapterRevisionMetadata
): string {
  const index = buildHtmlTextIndex(html)
  const range = findPlainTextRange(index.value, search)
  if (range === 'ambiguous') {
    throw new Error(`Ambiguous anchor text: "${search.slice(0, 50)}..."`)
  }
  if (!range) {
    throw new Error(`Could not find anchor text: "${search.slice(0, 50)}..."`)
  }
  const anchorIdx = position === 'before'
    ? index.htmlStarts[range.start]
    : index.htmlEnds[range.end - 1]
  const insertionHtml = textToInlineHtml(insertion, revision)
  const separatedInsertion = position === 'before'
    ? `${insertionHtml}<br>`
    : `<br>${insertionHtml}`
  return html.slice(0, anchorIdx) + separatedInsertion + html.slice(anchorIdx)
}

export function joinChapterBlocks(current: string, addition: string, position: 'start' | 'end'): string {
  if (!stripHtmlTags(current)) return addition
  return position === 'start' ? addition + current : current + addition
}
