export interface QimaoBoardMeta {
  slug: string
  name: string
  channel: string
  categories: string[]
  latestDate?: string
  bookCount?: number
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
    id: safeText(book.book_id || book.id),
    title: safeText(book.title, 200) || '未命名作品',
    author: safeText(book.author, 120) || '未知作者',
    category: safeText(book.category || book.minor, 120) || '未分类',
    word_display: safeText(book.word_count_text || book.word_display, 80),
    reads: Number(book.heat) || 0,
    intro: safeText(book.intro, 3000),
    url: safeText(book.url, 1000),
    cover: safeText(book.cover, 1000)
  }
}

function normalizeTrend(value: unknown, books: AnyRecord[], fallbackSummary: string): AnyRecord {
  const trend = asRecord(value)
  const newBooks = Array.isArray(trend.new_books)
    ? trend.new_books.map((item: unknown) => typeof item === 'string' ? item : safeText(asRecord(item).title)).filter(Boolean)
    : books.filter((book) => book.is_new === true).map((book) => book.title)
  const topRisers = Array.isArray(trend.top_risers) ? trend.top_risers : books
    .filter((book) => Number(book.rank_change) > 0)
    .sort((a, b) => Number(b.rank_change) - Number(a.rank_change))
    .slice(0, 8)
    .map((book) => ({ title: book.title, change: `+${Number(book.rank_change)}` }))
  const topFallers = Array.isArray(trend.top_fallers) ? trend.top_fallers : books
    .filter((book) => Number(book.rank_change) < 0)
    .sort((a, b) => Number(a.rank_change) - Number(b.rank_change))
    .slice(0, 8)
    .map((book) => ({ title: book.title, change: String(Number(book.rank_change)) }))
  const heatLeaders = Array.isArray(trend.heat_leaders) ? trend.heat_leaders : books
    .filter((book) => Number(book.heat_change) > 0)
    .sort((a, b) => Number(b.heat_change) - Number(a.heat_change))
    .slice(0, 8)
  const readsGrowth = heatLeaders.map((item: unknown) => {
    const row = asRecord(item)
    return {
      title: safeText(row.title),
      growth: Number(row.heat_change ?? row.growth) > 0
        ? `+${Number(row.heat_change ?? row.growth)}`
        : String(row.heat_change ?? row.growth ?? '')
    }
  }).filter((item) => item.title)

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

export function parseQimaoBoardCatalog(payload: unknown): QimaoBoardMeta[] {
  const root = asRecord(payload)
  if (!Array.isArray(root.boards)) return []
  const seen = new Set<string>()
  const result: QimaoBoardMeta[] = []
  for (const value of root.boards) {
    const board = asRecord(value)
    const slug = safeText(board.slug, 80)
    if (!/^[a-z0-9-]+$/.test(slug) || seen.has(slug)) continue
    seen.add(slug)
    result.push({
      slug,
      name: safeText(board.name, 120) || slug,
      channel: board.channel === 'female' ? 'female' : 'male',
      categories: Array.isArray(board.categories)
        ? Array.from(new Set(board.categories.map((item: unknown) => safeText(item)).filter(Boolean))).slice(0, 100)
        : [],
      latestDate: safeText(board.latest_date, 40) || undefined,
      bookCount: Number(board.book_count) || 0
    })
  }
  return result
}

export function buildQimaoViewData(boardPayload: unknown, summaryPayload: unknown): {
  summaryData: AnyRecord
  allData: AnyRecord
} {
  const root = asRecord(boardPayload)
  const summary = asRecord(summaryPayload)
  const board = asRecord(root.board)
  const overview = asRecord(summary.overview)
  const allBooks = Array.isArray(root.books) ? root.books.map(normalizeBook) : []
  const overviewText = safeText(overview.text, 5000) || '暂无七猫市场速评'
  const sourceCategories = Array.isArray(root.categories) ? root.categories : []
  const categories = sourceCategories.map((value: unknown) => {
    const category = asRecord(value)
    const books = Array.isArray(category.books) ? category.books.map(normalizeBook) : []
    return {
      ...category,
      name: safeText(category.name, 120) || '未分类',
      books,
      trend: normalizeTrend(category.trend, books, '')
    }
  })

  const allTrend = normalizeTrend({}, allBooks, overviewText)
  const genreGroups = Array.isArray(summary.genre_groups) ? summary.genre_groups : []
  const keywords = Array.isArray(summary.keywords)
    ? summary.keywords
    : Array.isArray(root.keywords) ? root.keywords : []

  return {
    summaryData: {
      date: safeText(root.date || summary.date, 40),
      periods: {
        all: {
          period: safeText(board.period_name, 40) || '最新一期',
          summary: overviewText,
          source: overview.ai_source === 'ai' ? 'ai' : 'rule',
          hot_genres: genreGroups.map((value: unknown) => {
            const group = asRecord(value)
            return {
              name: safeText(group.name),
              score: Number(group.total_heat ?? group.count) || 0,
              read_growth_total: Number(group.total_heat ?? group.count) || 0,
              new_count: Number(group.change) || 0,
              categories: []
            }
          }).filter((group: AnyRecord) => group.name),
          hot_types: categories.map((category: AnyRecord) => ({
            name: category.name,
            score: Number(category.total_heat ?? category.count) || 0,
            read_growth_total: Number(category.total_heat ?? category.count) || 0
          })),
          hot_themes: keywords.map((value: unknown) => {
            const keyword = asRecord(value)
            return { name: safeText(keyword.word || keyword.name), count: Number(keyword.count) || 0 }
          }).filter((keyword: AnyRecord) => keyword.name)
        }
      }
    },
    allData: {
      board,
      date: safeText(root.date, 40),
      prev_date: safeText(root.prev_date, 40),
      stats: asRecord(root.stats),
      categories: [
        { name: '全部', books: allBooks, trend: allTrend },
        ...categories
      ]
    }
  }
}
