export interface ZonghengBoardMeta {
  slug: string
  name: string
  description: string
  metricLabel: string
  date?: string
  isAuthor: boolean
}

type AnyRecord = Record<string, any>

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' ? value as AnyRecord : {}
}

function safeText(value: unknown, max = 120): string {
  return String(value ?? '').trim().slice(0, max)
}

function normalizeBook(value: unknown): AnyRecord {
  const book = asRecord(value)
  return {
    ...book,
    id: safeText(book.bookId || book.book_id || book.id),
    title: safeText(book.title, 200) || '未命名作品',
    author: safeText(book.author, 120) || '未知作者',
    category: safeText(book.category, 120) || '未分类',
    reads: Number(book.metric) || 0,
    metric: Number(book.metric) || 0,
    metricLabel: safeText(book.metricLabel, 40),
    intro: safeText(book.intro, 3000),
    url: safeText(book.url, 1000),
    cover: safeText(book.cover, 1000),
    updatedToday: book.updatedToday === true,
    isNew: book.is_new === true
  }
}

function normalizeTrend(value: unknown, fallbackSummary: string): AnyRecord {
  const trend = asRecord(value)
  const newBooks = Array.isArray(trend.new_books)
    ? trend.new_books.map((item: unknown) => typeof item === 'string' ? item : safeText(asRecord(item).title)).filter(Boolean)
    : []
  const topMovers = Array.isArray(trend.top_movers) ? trend.top_movers : []
  const topRisers = topMovers
    .filter((item: unknown) => Number(asRecord(item).rankChange) > 0)
    .slice(0, 8)
    .map((item: unknown) => {
      const row = asRecord(item)
      return { title: safeText(row.title), change: `+${Number(row.rankChange)}` }
    })
    .filter((item: AnyRecord) => item.title)
  const topFallers = topMovers
    .filter((item: unknown) => Number(asRecord(item).rankChange) < 0)
    .slice(0, 8)
    .map((item: unknown) => {
      const row = asRecord(item)
      return { title: safeText(row.title), change: String(Number(row.rankChange)) }
    })
    .filter((item: AnyRecord) => item.title)
  const readsGrowth = topMovers
    .filter((item: unknown) => Number(asRecord(item).metricGrowth) > 0)
    .slice(0, 8)
    .map((item: unknown) => {
      const row = asRecord(item)
      const growth = Number(row.metricGrowth) * 100
      return { title: safeText(row.title), growth: `+${growth.toFixed(growth >= 10 ? 0 : 1)}%` }
    })
    .filter((item: AnyRecord) => item.title)

  return {
    ...trend,
    summary: safeText(trend.summary, 3000) || fallbackSummary || '暂无该分类速评',
    new_books: newBooks,
    dropped_books: Array.isArray(trend.dropped_books) ? trend.dropped_books : [],
    top_risers: topRisers,
    top_fallers: topFallers,
    reads_growth: readsGrowth
  }
}

export function parseZonghengBoardCatalog(payload: unknown): ZonghengBoardMeta[] {
  const root = asRecord(payload)
  if (!Array.isArray(root.boards)) return []
  const seen = new Set<string>()
  const result: ZonghengBoardMeta[] = []
  for (const value of root.boards) {
    const board = asRecord(value)
    const slug = safeText(board.slug, 80)
    if (!/^[a-z0-9-]+$/.test(slug) || seen.has(slug)) continue
    seen.add(slug)
    result.push({
      slug,
      name: safeText(board.name, 120) || slug,
      description: safeText(board.desc, 300),
      metricLabel: safeText(board.metric_label, 40) || '热度',
      date: safeText(board.date, 40) || undefined,
      isAuthor: board.is_author === true
    })
  }
  return result
}

export function buildZonghengViewData(boardPayload: unknown, briefPayload?: unknown): {
  summaryData: AnyRecord
  allData: AnyRecord
} {
  const root = asRecord(boardPayload)
  const analysis = asRecord(root.analysis)
  const trends = asRecord(analysis.trends)
  const brief = asRecord(briefPayload)
  const categories = Array.isArray(root.categories) ? root.categories.map((value: unknown) => {
    const category = asRecord(value)
    const name = safeText(category.name, 120) || '未分类'
    const books = Array.isArray(category.books) ? category.books.map(normalizeBook) : []
    return {
      ...category,
      name,
      books,
      trend: normalizeTrend(trends[name], '')
    }
  }) : []
  const categoryHeat = Array.isArray(analysis.category_heat) ? analysis.category_heat : []
  const keywordHeat = Array.isArray(analysis.keyword_heat) ? analysis.keyword_heat : []
  const overview = safeText(brief.brief, 5000)
    || safeText(asRecord(trends['全部']).summary, 5000)
    || '暂无纵横市场速评'
  const period = {
    period: '最新一期',
    summary: overview,
    source: brief.engine === 'AI' ? 'ai' : 'rule',
    hot_genres: categoryHeat.map((item: unknown) => {
      const row = asRecord(item)
      return {
        name: safeText(row.name),
        score: Number(row.heat) || 0,
        read_growth_total: Number(row.heat) || 0,
        new_count: Number(asRecord(trends[row.name]).new_count) || 0,
        dropped_count: Number(asRecord(trends[row.name]).dropped_count) || 0,
        categories: []
      }
    }).filter((item: AnyRecord) => item.name),
    hot_types: [],
    hot_themes: keywordHeat.map((item: unknown) => {
      const row = asRecord(item)
      return { name: safeText(row.keyword), count: Number(row.count) || 0 }
    }).filter((item: AnyRecord) => item.name)
  }

  const allBooks = categories.find((category: AnyRecord) => category.name === '全部')?.books || []
  const normalizedCategories = categories.some((category: AnyRecord) => category.name === '全部')
    ? categories
    : [{ name: '全部', books: allBooks, trend: normalizeTrend(trends['全部'], overview) }, ...categories]

  return {
    summaryData: {
      date: safeText(root.date || analysis.date, 40),
      periods: { all: period }
    },
    allData: {
      date: safeText(root.date || analysis.date, 40),
      prev_date: safeText(analysis.prev_date, 40),
      board: asRecord(root.board),
      categories: normalizedCategories,
      stats: analysis,
      marketBrief: overview
    }
  }
}
