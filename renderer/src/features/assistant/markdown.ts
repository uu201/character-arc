import { Marked, Tokenizer, type Tokens } from 'marked'

const CJK_TEXT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const PUNCTUATION_END = /\p{P}\s*$/u

export const ASSISTANT_MARKDOWN_SANITIZE_OPTIONS = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th',
    'td', 'a', 'span', 'del', 'hr', 'input'
  ],
  ALLOWED_ATTR: ['class', 'href', 'target', 'rel', 'type', 'checked', 'disabled', 'align', 'start']
}

/** maskedSrc 已由 marked 屏蔽代码、链接和转义，避免把其中的分隔符当成闭合标记。 */
function findCjkDelimited(src: string, maskedSrc: string, delimiter: string): { raw: string; text: string } | undefined {
  const masked = maskedSrc.slice(-src.length)
  const marker = delimiter[0]
  let end = masked.indexOf(delimiter, delimiter.length)
  while (end >= 0) {
    const text = src.slice(delimiter.length, end)
    if (text.includes('\n')) return undefined
    if (masked[end - 1] !== marker && masked[end + delimiter.length] !== marker
      && CJK_TEXT.test(text) && PUNCTUATION_END.test(text)) {
      return { raw: src.slice(0, end + delimiter.length), text }
    }
    end = masked.indexOf(delimiter, end + delimiter.length)
  }
  return undefined
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  const cells = ['']
  for (let index = 1; index < trimmed.length - 1; index++) {
    const char = trimmed[index]
    if (char === '\\' && index < trimmed.length - 2) {
      cells[cells.length - 1] += char + trimmed[++index]
    } else if (char === '|') {
      cells.push('')
    } else {
      cells[cells.length - 1] += char
    }
  }
  return cells.map(cell => cell.trim())
}

// 使用独立实例，避免章节代码高亮等全局 marked 配置影响助手消息。
const assistantMarkdown = new Marked({
  breaks: true,
  gfm: true,
  tokenizer: {
    emStrong(src, maskedSrc, prevChar) {
      const standard = Tokenizer.prototype.emStrong.call(this, src, maskedSrc, prevChar)
      if (standard) return standard
      const delimiter = /^(\*+|_+)/.exec(src)?.[1]
      if (!delimiter || delimiter.length > 3) return undefined
      if (delimiter[0] === '_' && prevChar && /[A-Za-z0-9_]/.test(prevChar)) return undefined
      const match = findCjkDelimited(src, maskedSrc, delimiter)
      if (!match) return undefined
      const tokens = this.lexer.inlineTokens(match.text)
      if (delimiter.length === 3) {
        const strong: Tokens.Strong = { type: 'strong', ...match, tokens }
        return { type: 'em', ...match, tokens: [strong] }
      }
      return { type: delimiter.length === 2 ? 'strong' : 'em', ...match, tokens }
    },
    del(src, maskedSrc, prevChar) {
      const standard = Tokenizer.prototype.del.call(this, src, maskedSrc, prevChar)
      if (standard || !src.startsWith('~~')) return standard
      const match = findCjkDelimited(src, maskedSrc, '~~')
      return match ? { type: 'del', ...match, tokens: this.lexer.inlineTokens(match.text) } : undefined
    },
    table(src) {
      const standard = Tokenizer.prototype.table.call(this, src)
      if (standard) return standard
      const firstBreak = src.indexOf('\n')
      if (firstBreak < 0) return undefined
      const secondBreak = src.indexOf('\n', firstBreak + 1)
      const separatorEnd = secondBreak < 0 ? src.length : secondBreak
      const header = splitTableCells(src.slice(0, firstBreak))
      const separatorLine = src.slice(firstBreak + 1, separatorEnd)
      const separator = splitTableCells(separatorLine)
      if (separator.length === 0 || header.length <= separator.length
        || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) return undefined

      const normalizedLine = `| ${[...separator, ...Array(header.length - separator.length).fill('------')].join(' | ')} |`
      const normalized = src.slice(0, firstBreak + 1) + normalizedLine + src.slice(separatorEnd)
      const table = Tokenizer.prototype.table.call(this, normalized)
      if (table) {
        // lexer 必须按原始字符数前进；修复仅作用于表格 token，不改动源消息或代码块。
        table.raw = src.slice(0, table.raw.length - (normalizedLine.length - separatorLine.length))
      }
      return table
    }
  }
})

/** 仅解析 Markdown；调用方仍须使用 DOMPurify 清理后再交给 v-html。 */
export function parseAssistantMarkdown(content: string): string {
  return assistantMarkdown.parse(content || '', { async: false })
}
