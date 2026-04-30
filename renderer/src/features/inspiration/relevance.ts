import type { InspirationEntry } from '@/types/app'

// 章节上下文的简化类型，只需标题、摘要和内容用于相关性匹配
type ChapterContextLike = {
  title?: string
  summary?: string
  content?: string
}

// 将文本分词为关键词片段，用于后续相关性匹配：
// - 按标点、空白等分隔符拆分
// - 过滤掉长度不足 2 的短词
// - 超过 6 字符的词同时保留前 4 和后 4 字符作为子片段，提高模糊匹配率
function tokenizeSource(text: string): string[] {
  if (!text.trim()) {
    return []
  }

  const rawTokens = text
    .split(/[\s,，。.!！？?；;：:、/\\|(){}（）【】《》"'""''\r\n\t\-\[\]]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)

  return rawTokens.flatMap((token) => {
    if (token.length <= 6) {
      return [token]
    }

    return [token, token.slice(0, 4), token.slice(-4)]
  })
}

// 从章节的标题、摘要和正文中提取去重后的关键词集合（最多 40 个）
function buildContextTokens(chapter: ChapterContextLike): string[] {
  return Array.from(
    new Set(
      [chapter.title ?? '', chapter.summary ?? '', chapter.content ?? '']
        .flatMap((text) => tokenizeSource(text))
        .filter(Boolean)
    )
  ).slice(0, 40)
}

// 计算单条灵感条目相对于当前章节的相关性得分：
// - 基础分：排序靠前的条目获得更高基础分（最多 6 分）
// - 关键词匹配：灵感文本包含章节关键词时加分，长词（>=4字符）加 7 分，短词加 4 分
// - 标签匹配：章节内容和灵感标签有交叉时加 3 分
// - 标题完全匹配：灵感标题被章节内容直接包含时加 10 分（强信号）
function computeInspirationScore(entry: InspirationEntry, chapter: ChapterContextLike, contextTokens: string[]): number {
  const haystack = `${entry.type} ${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase()
  const chapterHaystack = `${chapter.title ?? ''} ${chapter.summary ?? ''} ${chapter.content ?? ''}`.toLowerCase()
  let score = Math.max(0, 6 - entry.sortOrder)

  for (const token of contextTokens) {
    const normalizedToken = token.toLowerCase()
    if (normalizedToken.length < 2) {
      continue
    }

    // 灵感文本包含该关键词
    if (haystack.includes(normalizedToken)) {
      score += normalizedToken.length >= 4 ? 7 : 4
      continue
    }

    // 关键词在章节中出现且与灵感标签有交叉匹配
    if (chapterHaystack.includes(normalizedToken) && entry.tags.some((tag) => normalizedToken.includes(tag.toLowerCase()))) {
      score += 3
    }
  }

  // 灵感标题被章节内容直接包含，视为高度相关
  const title = entry.title.trim().toLowerCase()
  if (title && chapterHaystack.includes(title)) {
    score += 10
  }

  return score
}

// 从灵感库中筛选与当前章节最相关的条目：
// 1. 为每条灵感计算相关性得分
// 2. 按得分降序排列，得分相同时按更新时间排序
// 3. 优先返回得分大于 0 的条目（最多 limit 条）
// 4. 若所有条目得分均为 0（无匹配），则按更新时间倒序取最近的条目作为兜底
export function pickRelevantInspirationEntries(
  entries: InspirationEntry[],
  chapter: ChapterContextLike,
  limit = 4
): InspirationEntry[] {
  if (!entries.length) {
    return []
  }

  const contextTokens = buildContextTokens(chapter)
  const rankedEntries = entries
    .map((entry) => ({
      entry,
      score: computeInspirationScore(entry, chapter, contextTokens),
      updatedAt: Date.parse(entry.updatedAt || '')
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return (right.updatedAt || 0) - (left.updatedAt || 0)
    })

  const positiveEntries = rankedEntries.filter((item) => item.score > 0).map((item) => item.entry)
  if (positiveEntries.length > 0) {
    return positiveEntries.slice(0, limit)
  }

  // 无匹配条目时，按最近更新时间取前 limit 条
  return [...entries]
    .sort((left, right) => {
      const rightTime = Date.parse(right.updatedAt || '')
      const leftTime = Date.parse(left.updatedAt || '')
      return (rightTime || 0) - (leftTime || 0)
    })
    .slice(0, limit)
}
