import { readCache, writeCache } from './github-mirror'

export const QIDIAN_RANK_URLS = {
  hotsales: 'https://m.qidian.com/rank/hotsales/',
  monthly: 'https://m.qidian.com/rank/yuepiao/',
  newbook: 'https://m.qidian.com/rank/newbook/',
  newauthor: 'https://m.qidian.com/rank/newauthor/'
} as const

export const QIDIAN_RANK_LABELS: Record<QidianRankType, string> = {
  hotsales: '畅销榜',
  monthly: '月票榜',
  newbook: '新书榜',
  newauthor: '新人作者新书榜'
}

export const QIDIAN_CATEGORY_LABELS: Record<string, string> = {
  '-1': '全部分类',
  '21': '玄幻',
  '1': '奇幻',
  '2': '武侠',
  '22': '仙侠',
  '4': '都市',
  '15': '现实',
  '6': '军事',
  '5': '历史',
  '7': '游戏',
  '8': '体育',
  '9': '科幻',
  '20109': '诸天无限',
  '10': '悬疑灵异',
  '12': '轻小说'
}

const QIDIAN_CACHE_DIR = 'qidian-rank-cache'
const QIDIAN_CACHE_TTL_MS = 2 * 60 * 60 * 1000
const QIDIAN_SOURCE = '起点移动端公开榜单'

export type QidianRankType = keyof typeof QIDIAN_RANK_URLS

export type QidianRankBook = {
  rank: number
  id: string
  title: string
  author: string
  category: string
  word_count: number
  word_display: string
  intro: string
  cover: string
  url: string
  source: '起点中文网'
}

export type QidianRankData = {
  platform: 'qidian'
  type: QidianRankType
  categoryId: string
  categoryName: string
  title: string
  date: string
  books: QidianRankBook[]
}

export type QidianRankFetchResult = {
  success: boolean
  data?: QidianRankData
  fromCache?: boolean
  stale?: boolean
  fetchedAt?: number
  source?: string
  error?: string
}

function decodeQidianText(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeQidianCover(value: unknown): string {
  const cover = String(value || '').trim()
  if (cover.startsWith('//')) return `https:${cover}`
  return /^https?:\/\//i.test(cover) ? cover : ''
}

function parseQidianWordCount(display: unknown): number {
  const value = String(display || '').replace(/字/g, '').trim()
  const amount = Number.parseFloat(value.replace(/万/g, ''))
  if (!Number.isFinite(amount)) return 0
  return value.includes('万') ? Math.round(amount * 10_000) : Math.round(amount)
}

export function parseQidianRankHtml(
  html: string,
  rankType: QidianRankType,
  categoryId = '-1'
): QidianRankData {
  const books: QidianRankBook[] = []
  const seen = new Set<string>()
  const blockPattern = /<a\s[^>]*href="\/\/m\.qidian\.com\/book\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = blockPattern.exec(html)) && books.length < 60) {
    const id = match[1]
    if (!id || seen.has(id)) continue
    const block = match[2]
    const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
      || block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
    const title = decodeQidianText(titleMatch?.[1])
    if (!title || title.length > 80) continue

    seen.add(id)
    const introMatch = block.match(/class="[^"]*bookDesc[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
    const subMatch = block.match(/class="[^"]*subTitle[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
    const rankMatch = block.match(/class="[^"]*ranking[^"]*"[^>]*>(\d+)<\/div>/i)
    const coverMatch = block.match(/data-src="([^"]+)"/i) || block.match(/<img[^>]+src="([^"]+)"/i)
    const subText = String(subMatch?.[1] || '').replace(/<em[^>]*>/gi, ' · ').replace(/<\/em>/gi, '')
    const parts = decodeQidianText(subText).split('·').map((item) => item.trim()).filter(Boolean)
    const wordDisplay = parts[2] || ''

    books.push({
      rank: Number(rankMatch?.[1]) || books.length + 1,
      id,
      title,
      author: parts[0] || '未知作者',
      category: parts[1] || '未分类',
      word_count: parseQidianWordCount(wordDisplay),
      word_display: wordDisplay,
      intro: decodeQidianText(introMatch?.[1]).slice(0, 500),
      cover: normalizeQidianCover(coverMatch?.[1]),
      url: `https://m.qidian.com/book/${id}/`,
      source: '起点中文网'
    })
  }

  return {
    platform: 'qidian',
    type: rankType,
    categoryId,
    categoryName: QIDIAN_CATEGORY_LABELS[categoryId] || '全部分类',
    title: `起点中文网 · ${QIDIAN_RANK_LABELS[rankType] || rankType} · ${QIDIAN_CATEGORY_LABELS[categoryId] || '全部分类'}`,
    date: new Date().toISOString().slice(0, 10),
    books
  }
}

export async function fetchQidianRank(
  rankType: string,
  categoryId = '-1',
  force = false
): Promise<QidianRankFetchResult> {
  const normalizedType: QidianRankType = Object.prototype.hasOwnProperty.call(QIDIAN_RANK_URLS, rankType)
    ? rankType as QidianRankType
    : 'hotsales'
  const normalizedCategory = Object.prototype.hasOwnProperty.call(QIDIAN_CATEGORY_LABELS, String(categoryId))
    ? String(categoryId)
    : '-1'
  const cacheKey = `qidian-${normalizedType}-cat-${normalizedCategory}`
  const cached = await readCache(QIDIAN_CACHE_DIR, cacheKey)

  if (!force && cached && Date.now() - cached.fetchedAt < QIDIAN_CACHE_TTL_MS) {
    return {
      success: true,
      data: cached.data as QidianRankData,
      fromCache: true,
      fetchedAt: cached.fetchedAt,
      source: cached.source || QIDIAN_SOURCE
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const categoryPath = normalizedCategory === '-1' ? '' : `catid${normalizedCategory}/`
    const response = await fetch(`${QIDIAN_RANK_URLS[normalizedType]}${categoryPath}`, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36 CharacterArc/1.17',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml'
      },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`起点返回 HTTP ${response.status}`)
    const html = await response.text()
    const data = parseQidianRankHtml(html, normalizedType, normalizedCategory)
    if (!data.books.length) throw new Error('未能从起点页面解析出榜单数据，可能触发了访问限制')
    const fetchedAt = Date.now()
    await writeCache(QIDIAN_CACHE_DIR, cacheKey, { fetchedAt, data, source: QIDIAN_SOURCE })
    return { success: true, data, fromCache: false, fetchedAt, source: QIDIAN_SOURCE }
  } catch (error) {
    if (cached) {
      return {
        success: true,
        data: cached.data as QidianRankData,
        fromCache: true,
        stale: true,
        fetchedAt: cached.fetchedAt,
        source: cached.source || QIDIAN_SOURCE
      }
    }
    return { success: false, error: error instanceof Error ? error.message : '起点榜单加载失败' }
  } finally {
    clearTimeout(timer)
  }
}
