<script setup lang="ts">
import { CheckCircle2, ChevronLeft, Copy, ExternalLink, Flame, Lightbulb, RefreshCw, Sparkles } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { NButton, NCard, NModal, NSelect, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { renderMarkdown } from '@/composables/useGlobalAssistant'
import { toIpcPayload } from '@/utils/ipcPayload'

const appStore = useAppStore()
const message = useMessage()

type Platform = 'fanqie' | 'qidian'
type ScanStage = 'setup' | 'running' | 'error' | 'report' | 'ideating' | 'idea-error' | 'ideas'

type RankingIdeaCombination = {
  id: string
  title: string
  genre: string
  premise: string
  hook: string
  protagonist: string
  world: string
  conflict: string
  innovation: string
  tags: string[]
}

type RankingIdeaDirection = {
  id: string
  name: string
  rationale: string
  readerPromise: string
  risk: string
  combinations: RankingIdeaCombination[]
}

type QidianRankData = {
  date?: string
  title?: string
  books?: AnyRecord[]
}

const platform = ref<Platform>('fanqie')
const scanVisible = ref(false)
const scanLoading = ref(false)
const scanReport = ref('')
const scanError = ref('')
const scanGeneratedAt = ref('')
const scanCache = new Map<string, { content: string; generatedAt: string }>()
const ideaCache = new Map<string, RankingIdeaDirection[]>()
const ideaDirections = ref<RankingIdeaDirection[]>([])
const ideaError = ref('')
const selectedDirectionId = ref('')
const selectedIdeaId = ref('')
const scanStage = ref<ScanStage>('setup')
const scanSelectedPlatform = ref<Platform>('fanqie')
const scanSelectedBoard = ref('female-new')
const scanSelectedCategory = ref('-1')

function openBookUrl(url: unknown): void {
  const target = typeof url === 'string' ? url.trim() : ''
  if (!target) {
    message.warning('该书暂无原文链接')
    return
  }
  void window.characterArc.openExternalUrl(target)
}

async function copyBookIntro(intro: unknown): Promise<void> {
  const text = typeof intro === 'string' ? intro.trim() : ''
  if (!text) {
    message.warning('该书暂无简介可复制')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    message.success('简介已复制到剪贴板')
  } catch {
    message.error('复制失败，请重试')
  }
}

function backToProjectCenter(): void {
  appStore.backToProjects()
}

// ===== 频道标签与展示顺序 =====
const BOARD_ORDER = ['female-new', 'male-new']
const QIDIAN_BOARDS: BoardItem[] = [
  { slug: 'hotsales', name: '畅销榜', channel: '可分类', has_genres: false },
  { slug: 'monthly', name: '月票榜', channel: '可分类', has_genres: false },
  { slug: 'newbook', name: '新书榜', channel: '可分类', has_genres: false },
  { slug: 'newauthor', name: '新人作者新书榜', channel: '可分类', has_genres: false }
]
const QIDIAN_CATEGORIES = [
  { label: '全部分类', value: '-1' },
  { label: '玄幻', value: '21' },
  { label: '奇幻', value: '1' },
  { label: '武侠', value: '2' },
  { label: '仙侠', value: '22' },
  { label: '都市', value: '4' },
  { label: '现实', value: '15' },
  { label: '军事', value: '6' },
  { label: '历史', value: '5' },
  { label: '游戏', value: '7' },
  { label: '体育', value: '8' },
  { label: '科幻', value: '9' },
  { label: '诸天无限', value: '20109' },
  { label: '悬疑灵异', value: '10' },
  { label: '轻小说', value: '12' }
]
const SCAN_BOARD_CATALOG: Record<Platform, Array<{ label: string; value: string }>> = {
  fanqie: [
    { label: '女频新书榜', value: 'female-new' },
    { label: '男频新书榜', value: 'male-new' }
  ],
  qidian: QIDIAN_BOARDS.map((board) => ({ label: board.name, value: board.slug }))
}
const CHANNEL_LABEL: Record<string, string> = { female: '女频', male: '男频', mixed: '综合' }

type BoardItem = {
  slug: string
  name: string
  channel?: string
  has_genres?: boolean
  _empty?: boolean
}

type AnyRecord = Record<string, any>

// ===== 状态 =====
const loading = ref(true)
const switching = ref(false)
const errorMsg = ref('')
const boardsList = ref<BoardItem[]>([])
const curBoard = ref<string | null>(null)
const qidianCategory = ref('-1')
const summaryData = ref<AnyRecord | null>(null)
const allData = ref<AnyRecord | null>(null)
const curPeriod = ref('7')
const curCat = ref<string | null>(null)
const dataDate = ref('—')
const dataPrev = ref('')
const srcNote = ref('')
const boardEmptyName = ref('')
const boardEmpty = ref(false)
let boardRequestId = 0

const pageTitle = computed(() => platform.value === 'qidian' ? '起点风向标' : '番茄风向标')
const pageSubtitle = computed(() => platform.value === 'qidian'
  ? '起点中文网榜单 · 支持榜单与作品分类组合筛选'
  : '番茄小说榜单 · 每日趋势与题材风向')
const pageSource = computed(() => platform.value === 'qidian'
  ? '抓取逻辑参考 QiuNova/Qbook（MIT）'
  : '数据来源于 https://github.com/uu201/FanqieRankTracker')
const scanReportHtml = computed(() => renderMarkdown(scanReport.value))
const scanBoardOptions = computed(() => SCAN_BOARD_CATALOG[scanSelectedPlatform.value] || [])
const scanSelectedPlatformLabel = computed(() => scanSelectedPlatform.value === 'qidian' ? '起点中文网' : '番茄小说')
const scanSelectedBoardLabel = computed(() =>
  scanBoardOptions.value.find((option) => option.value === scanSelectedBoard.value)?.label || '当前榜单'
)
const scanSelectedCategoryLabel = computed(() =>
  QIDIAN_CATEGORIES.find((option) => option.value === scanSelectedCategory.value)?.label || '全部分类'
)
const selectedDirection = computed(() =>
  ideaDirections.value.find((direction) => direction.id === selectedDirectionId.value) || null
)
const selectedIdea = computed(() =>
  selectedDirection.value?.combinations.find((idea) => idea.id === selectedIdeaId.value) || null
)
const scanModalTitle = computed(() => {
  if (scanStage.value === 'setup') return 'AI 扫榜分析'
  if (['ideating', 'ideas', 'idea-error'].includes(scanStage.value)) {
    return `${scanSelectedPlatformLabel.value} · 从榜单到新书`
  }
  return `${scanSelectedPlatformLabel.value} · ${scanSelectedBoardLabel.value}${scanSelectedPlatform.value === 'qidian' ? ` · ${scanSelectedCategoryLabel.value}` : ''}风格报告`
})

// ===== 工具 =====
function fmtScore(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万'
  return String(n)
}

async function fetchJson(path: string, force = false): Promise<AnyRecord> {
  const res = await window.characterArc.fetchFanqieTrends(path, force)
  if (!res.success || res.data == null) {
    throw new Error(res.error || '加载失败')
  }
  if (res.mirror) {
    srcNote.value = (res.fromCache ? '缓存 · ' : '镜像 · ') + res.mirror
  }
  return res.data as AnyRecord
}

// ===== 切换榜单 =====
async function switchBoard(slug: string, force = false): Promise<void> {
  const board = boardsList.value.find((b) => b.slug === slug)
  if (!board) return
  const requestId = ++boardRequestId
  const requestedPlatform = platform.value
  curBoard.value = slug
  curCat.value = null
  curPeriod.value = '7'

  if (board._empty) {
    boardEmpty.value = true
    boardEmptyName.value = board.name
    summaryData.value = null
    allData.value = null
    loading.value = false
    return
  }
  boardEmpty.value = false
  switching.value = true
  errorMsg.value = ''
  try {
    if (platform.value === 'qidian') {
      const result = await window.characterArc.fetchQidianRank(slug, qidianCategory.value, force)
      if (!result.success || !result.data) {
        throw new Error(result.error || '起点榜单加载失败')
      }
      if (requestId !== boardRequestId || platform.value !== requestedPlatform) return
      const data = result.data as QidianRankData
      const books = Array.isArray(data.books)
        ? data.books.map((book) => ({
            ...book,
            qidianMeta: [book.author, book.category, book.word_display].filter(Boolean).join(' · ')
          }))
        : []
      summaryData.value = { date: data.date, periods: {} }
      allData.value = {
        date: data.date,
        categories: [{ name: data.title || board.name, books, trend: {} }]
      }
      dataDate.value = '数据日期 ' + (data.date || '—')
      dataPrev.value = ''
      srcNote.value = `${result.fromCache ? (result.stale ? '过期缓存 · ' : '缓存 · ') : '实时 · '}${result.source || '起点移动端公开榜单'}`
      curCat.value = allData.value.categories[0].name
      loading.value = false
      switching.value = false
      return
    }

    const [summary, all] = await Promise.all([
      fetchJson(`data/${slug}/market_summary.json`, force),
      fetchJson(`api/${slug}/lastest/all.json`, force)
    ])
    if (requestId !== boardRequestId || platform.value !== requestedPlatform) return
    summaryData.value = summary
    allData.value = all
    dataDate.value = '数据日期 ' + (all.date || summary.date || '—')
    dataPrev.value = summary.prev_date ? `对比 ${summary.prev_date}` : ''
    const cats = (all.categories || []) as AnyRecord[]
    if (cats.length) curCat.value = cats[0].name
    loading.value = false
    switching.value = false
  } catch (e) {
    if (requestId !== boardRequestId || platform.value !== requestedPlatform) return
    loading.value = false
    switching.value = false
    errorMsg.value = `加载榜单「${board.name}」失败：` + (e instanceof Error ? e.message : String(e))
  }
}

// ===== 主加载 =====
async function loadAll(force = false): Promise<void> {
  loading.value = true
  errorMsg.value = ''
  try {
    if (platform.value === 'qidian') {
      boardsList.value = QIDIAN_BOARDS.map((board) => ({ ...board, _empty: false }))
      const firstReady = boardsList.value.find((board) => board.slug === curBoard.value) || boardsList.value[0]
      if (firstReady) await switchBoard(firstReady.slug, force)
      return
    }

    let known: BoardItem[] = []
    try {
      known = ((await fetchJson('api/boards.json', force)).boards || []) as BoardItem[]
    } catch {
      known = []
    }
    const knownMap: Record<string, BoardItem> = {}
    known.forEach((b) => { knownMap[b.slug] = b })

    const defaults: Record<string, BoardItem> = {
      'female-new': { slug: 'female-new', name: '女频新书榜', channel: 'female', has_genres: true },
      'male-new': { slug: 'male-new', name: '男频新书榜', channel: 'male', has_genres: true }
    }
    boardsList.value = BOARD_ORDER.map((slug) => {
      if (knownMap[slug]) return { ...knownMap[slug], _empty: false }
      return { ...defaults[slug], _empty: true }
    })
    known.forEach((b) => {
      if (!BOARD_ORDER.includes(b.slug)) boardsList.value.push({ ...b, _empty: false })
    })

    const firstReady = boardsList.value.find((b) => b.slug === curBoard.value && !b._empty)
      || boardsList.value.find((b) => !b._empty)
      || boardsList.value[0]
    if (firstReady) {
      await switchBoard(firstReady.slug, force)
    } else {
      loading.value = false
    }
  } catch (e) {
    loading.value = false
    errorMsg.value = e instanceof Error ? e.message : String(e)
  }
}

function selectPeriod(p: string): void {
  curPeriod.value = p
}

function selectCat(name: string): void {
  curCat.value = name
}

function channelLabel(b: BoardItem): string {
  return CHANNEL_LABEL[b.channel || ''] || b.channel || ''
}

function bookMeta(book: AnyRecord): string {
  if (platform.value === 'qidian') {
    return book.qidianMeta || [book.author, book.category, book.word_display].filter(Boolean).join(' · ')
  }
  return `${book.author || '未知作者'} · ${book.reads || 0} 在读`
}

function collectRankingScanBooks(): AnyRecord[] {
  const groups = categories.value.map((category) => ({
    name: category.name,
    books: Array.isArray(category.books) ? category.books : []
  }))
  const selected: AnyRecord[] = []
  const seen = new Set<string>()

  for (let index = 0; selected.length < 48; index += 1) {
    let added = false
    for (const group of groups) {
      const book = group.books[index]
      if (!book) continue
      added = true
      const key = String(book.id || book.title || '').trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      selected.push({
        rank: Number(book.rank) || index + 1,
        title: book.title || '未命名作品',
        author: book.author || '未知作者',
        category: book.category || group.name || '未分类',
        wordCount: book.word_display || book.word_count || book.reads || '',
        intro: book.intro || ''
      })
      if (selected.length >= 48) break
    }
    if (!added || index >= 59) break
  }
  return selected
}

function openRankingStyleScan(): void {
  scanSelectedPlatform.value = platform.value
  const availableBoards = SCAN_BOARD_CATALOG[platform.value] || []
  scanSelectedBoard.value = availableBoards.some((option) => option.value === curBoard.value)
    ? String(curBoard.value)
    : availableBoards[0]?.value || ''
  scanSelectedCategory.value = platform.value === 'qidian' ? qidianCategory.value : '-1'
  scanStage.value = 'setup'
  scanLoading.value = false
  scanError.value = ''
  scanVisible.value = true
}

function updateScanPlatform(value: Platform): void {
  if (value !== 'fanqie' && value !== 'qidian') return
  scanSelectedPlatform.value = value
  scanSelectedBoard.value = SCAN_BOARD_CATALOG[value]?.[0]?.value || ''
  scanSelectedCategory.value = value === 'qidian' ? qidianCategory.value : '-1'
}

function returnToScanSetup(): void {
  scanStage.value = 'setup'
  scanLoading.value = false
  scanError.value = ''
}

async function prepareSelectedRankingForScan(): Promise<void> {
  const targetPlatform = scanSelectedPlatform.value
  const targetBoard = scanSelectedBoard.value
  const targetCategory = targetPlatform === 'qidian' ? scanSelectedCategory.value : '-1'
  if (!targetBoard) throw new Error('请先选择要分析的榜单')

  if (platform.value !== targetPlatform) {
    platform.value = targetPlatform
    if (targetPlatform === 'qidian') qidianCategory.value = targetCategory
    boardsList.value = []
    curBoard.value = null
    summaryData.value = null
    allData.value = null
    curCat.value = null
    srcNote.value = ''
    await loadAll()
  }

  const categoryChanged = targetPlatform === 'qidian' && qidianCategory.value !== targetCategory
  if (categoryChanged) qidianCategory.value = targetCategory
  if (curBoard.value !== targetBoard || !allData.value || categoryChanged) {
    const board = boardsList.value.find((item) => item.slug === targetBoard)
    if (!board) throw new Error('所选榜单暂不可用，请刷新榜单数据后重试')
    await switchBoard(targetBoard)
  }
  if (curBoard.value !== targetBoard || !allData.value) {
    throw new Error(errorMsg.value || '所选榜单数据加载失败')
  }
}

async function runRankingStyleScan(force = false): Promise<void> {
  scanVisible.value = true
  scanStage.value = 'running'
  scanLoading.value = true
  scanError.value = ''
  ideaDirections.value = []
  selectedDirectionId.value = ''
  selectedIdeaId.value = ''
  ideaError.value = ''

  try {
    await prepareSelectedRankingForScan()
    const books = collectRankingScanBooks()
    if (!books.length) throw new Error('所选榜单没有可分析的作品数据')

    const cacheKey = `${platform.value}:${curBoard.value || 'default'}:${platform.value === 'qidian' ? qidianCategory.value : 'all'}:${dataDate.value}`
    const cachedReport = scanCache.get(cacheKey)
    if (!force && cachedReport) {
      scanReport.value = cachedReport.content
      scanGeneratedAt.value = cachedReport.generatedAt
      scanStage.value = 'report'
      return
    }

    scanReport.value = ''
    scanGeneratedAt.value = ''
    const board = curBoardItem.value
    const response = await window.characterArc.generateAi(toIpcPayload({
      task: 'ranking-style-analysis',
      settings: appStore.appSettings,
      context: {
        platformName: platform.value === 'qidian' ? '起点中文网' : '番茄小说',
        boardName: `${board?.name || '当前榜单'}${platform.value === 'qidian' ? ` · ${QIDIAN_CATEGORIES.find((option) => option.value === qidianCategory.value)?.label || '全部分类'}` : ''}`,
        dataDate: dataDate.value.replace(/^数据日期\s*/, ''),
        books
      }
    }))
    const content = (response.result as { content?: unknown } | undefined)?.content
    if (!response.success || typeof content !== 'string' || !content.trim()) {
      throw new Error(response.error || 'AI 未返回有效的扫榜报告')
    }
    scanReport.value = content.trim()
    scanGeneratedAt.value = new Date().toLocaleString('zh-CN')
    scanCache.set(cacheKey, { content: scanReport.value, generatedAt: scanGeneratedAt.value })
    scanStage.value = 'report'
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : 'AI 扫榜分析失败'
    scanStage.value = 'error'
  } finally {
    scanLoading.value = false
  }
}

async function generateIdeaDirections(force = false): Promise<void> {
  if (!scanReport.value.trim()) {
    ideaError.value = '请先完成扫榜分析'
    scanStage.value = 'idea-error'
    return
  }

  scanStage.value = 'ideating'
  ideaError.value = ''
  try {
    const books = collectRankingScanBooks()
    const board = curBoardItem.value
    const boardName = `${board?.name || '当前榜单'}${platform.value === 'qidian' ? ` · ${QIDIAN_CATEGORIES.find((option) => option.value === qidianCategory.value)?.label || '全部分类'}` : ''}`
    const ideaCacheKey = `${platform.value}:${curBoard.value || 'default'}:${platform.value === 'qidian' ? qidianCategory.value : 'all'}:${dataDate.value}:${scanReport.value.slice(0, 120)}`
    const cachedIdeas = ideaCache.get(ideaCacheKey)
    if (!force && cachedIdeas) {
      ideaDirections.value = cachedIdeas
      selectedDirectionId.value = ''
      selectedIdeaId.value = ''
      scanStage.value = 'ideas'
      return
    }

    const response = await window.characterArc.generateAi(toIpcPayload({
      task: 'ranking-idea-combinations',
      settings: appStore.appSettings,
      context: {
        platformName: platform.value === 'qidian' ? '起点中文网' : '番茄小说',
        boardName,
        scanReport: scanReport.value,
        books
      }
    }))
    const directions = (response.result as { directions?: unknown } | undefined)?.directions
    if (!response.success || !Array.isArray(directions) || !directions.length) {
      throw new Error(response.error || 'AI 未返回有效的创作方向')
    }
    ideaDirections.value = directions as RankingIdeaDirection[]
    ideaCache.set(ideaCacheKey, ideaDirections.value)
    selectedDirectionId.value = ''
    selectedIdeaId.value = ''
    scanStage.value = 'ideas'
  } catch (error) {
    ideaError.value = error instanceof Error ? error.message : '生成创作方向失败'
    scanStage.value = 'idea-error'
  }
}

function chooseIdeaDirection(directionId: string): void {
  selectedDirectionId.value = directionId
  selectedIdeaId.value = ''
}

function chooseIdea(ideaId: string): void {
  selectedIdeaId.value = ideaId
}

function startNovelFromIdea(): void {
  const idea = selectedIdea.value
  if (!idea) {
    message.warning('请先选择一个脑洞组合')
    return
  }

  const premise = [
    idea.premise,
    '',
    '【立项锚点】',
    `核心钩子：${idea.hook}`,
    `主角设计：${idea.protagonist}`,
    `世界设定：${idea.world}`,
    `核心冲突：${idea.conflict}`,
    `差异化：${idea.innovation}`
  ].filter((line) => !line.endsWith('：undefined') && !line.endsWith('：')).join('\n')

  scanVisible.value = false
  appStore.openWizard({ title: idea.title, genre: idea.genre, premise })
}

async function copyScanReport(): Promise<void> {
  if (!scanReport.value) return
  try {
    await navigator.clipboard.writeText(scanReport.value)
    message.success('扫榜报告已复制')
  } catch {
    message.error('复制失败，请重试')
  }
}

function switchPlatform(nextPlatform: Platform): void {
  if (nextPlatform === platform.value) return
  platform.value = nextPlatform
  boardsList.value = []
  curBoard.value = null
  summaryData.value = null
  allData.value = null
  curCat.value = null
  srcNote.value = ''
  void loadAll()
}

function switchQidianCategory(categoryId: string): void {
  if (platform.value !== 'qidian' || qidianCategory.value === categoryId || switching.value) return
  qidianCategory.value = categoryId
  if (curBoard.value) void switchBoard(curBoard.value)
}

// ===== 派生数据 =====
const curBoardItem = computed(() => boardsList.value.find((b) => b.slug === curBoard.value) || null)

const periodTabs = computed<Array<{ key: string; label: string }>>(() => {
  const periods = summaryData.value?.periods
  if (!periods) return []
  return ['7', '14', '30', 'all']
    .filter((k) => periods[k])
    .map((k) => ({ key: k, label: periods[k].period as string }))
})

const curPeriodData = computed<AnyRecord | null>(() => summaryData.value?.periods?.[curPeriod.value] ?? null)

const summaryText = computed(() => {
  const p = curPeriodData.value
  return p ? (p.summary || p.fallback_summary || '暂无速评') : ''
})
const summarySrc = computed(() => (curPeriodData.value?.source === 'ai' ? 'AI 生成' : '规则统计'))

const hotGenres = computed<AnyRecord[]>(() => curPeriodData.value?.hot_genres || [])

const hotTypes = computed<Array<AnyRecord & { _pct: number; _val: number }>>(() => {
  const types: AnyRecord[] = curPeriodData.value?.hot_types || []
  const maxScore = Math.max(...types.map((t) => Number(t.score) || 0), 1)
  return types.map((t) => ({
    ...t,
    _pct: Math.max(8, ((Number(t.score) || 0) / maxScore) * 100),
    _val: Number(t.read_growth_total ?? t.score) || 0
  }))
})

const hotThemes = computed<Array<AnyRecord & { _size: number }>>(() => {
  const themes: AnyRecord[] = curPeriodData.value?.hot_themes || []
  const maxCount = Math.max(...themes.map((t) => Number(t.count) || 0), 1)
  return themes.map((t) => ({
    ...t,
    _size: Number((((0.86 + ((Number(t.count) || 0) / maxCount) * 0.6) * 14).toFixed(1)))
  }))
})

const categories = computed<AnyRecord[]>(() => allData.value?.categories || [])

const curCatData = computed<AnyRecord | null>(() => categories.value.find((c) => c.name === curCat.value) ?? null)

const curCatTrend = computed<AnyRecord>(() => curCatData.value?.trend || {})

const curCatSummaryHtml = computed(() =>
  String(curCatTrend.value.summary || '暂无该分类速评')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
)

const curCatBooks = computed<AnyRecord[]>(() => (curCatData.value?.books || []).slice(0, 15))

function isNewBook(title: string): boolean {
  return (curCatTrend.value.new_books || []).includes(title)
}

function fmt(n: unknown): string {
  return fmtScore(Number(n) || 0)
}

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <section class="fanqie-page arc-scrollbar">
    <div class="fanqie-shell">
      <div class="topbar">
        <div class="topbar-lead">
          <n-button quaternary size="small" class="back-btn" @click="backToProjectCenter">
            <template #icon><ChevronLeft :size="16" /></template>
            返回项目中心
          </n-button>
          <h1><span class="flame"><Flame :size="24" /></span> {{ pageTitle }}</h1>
          <p class="sub">{{ pageSubtitle }}</p>
          <p class="sub">{{ pageSource }}</p>
          <div class="platform-tabs">
            <button type="button" class="platform-tab" :class="{ active: platform === 'fanqie' }" @click="switchPlatform('fanqie')">番茄小说</button>
            <button type="button" class="platform-tab" :class="{ active: platform === 'qidian' }" @click="switchPlatform('qidian')">起点中文网</button>
          </div>
        </div>
        <div class="meta">
          <div class="date num">{{ dataDate }}</div>
          <div v-if="dataPrev" class="prev">{{ dataPrev }}</div>
          <button class="refresh-btn" :disabled="loading" @click="loadAll(true)">
            <RefreshCw :size="13" /> 刷新
          </button>
          <button class="refresh-btn scan-btn" title="选择平台和榜单后开始分析" @click="openRankingStyleScan">
            <Sparkles :size="13" /> AI 扫榜
          </button>
          <div v-if="srcNote" class="src-note">{{ srcNote }}</div>
        </div>
      </div>

      <div v-if="loading" class="state">
        <div class="spinner" aria-hidden="true"></div>
        正在加载榜单数据…
      </div>

      <div v-else-if="errorMsg" class="state">
        <div>数据加载失败</div>
        <div class="err-detail">{{ errorMsg }}</div>
        <button class="refresh-btn" style="margin-top:16px" @click="loadAll(true)">重试</button>
      </div>

      <div v-else class="content" :class="{ switching }">
        <div class="board-tabs">
          <button
            v-for="b in boardsList"
            :key="b.slug"
            class="board-tab"
            :class="{ active: b.slug === curBoard, empty: b._empty }"
            :title="b._empty ? '该榜单暂无数据' : ''"
            @click="switchBoard(b.slug)"
          >
            {{ b.name }}<span class="ch">{{ channelLabel(b) }}</span>
          </button>
        </div>

        <div v-if="platform === 'qidian'" class="qidian-category-filter">
          <strong>作品分类</strong>
          <div class="qidian-category-tabs">
            <button
              v-for="category in QIDIAN_CATEGORIES"
              :key="category.value"
              type="button"
              class="qidian-category-tab"
              :class="{ active: qidianCategory === category.value }"
              :disabled="switching"
              @click="switchQidianCategory(category.value)"
            >{{ category.label }}</button>
          </div>
        </div>

        <div v-if="boardEmpty" class="state">
          <div>「{{ boardEmptyName }}」榜单暂无数据</div>
          <div class="src-note" style="margin-top:10px;max-width:460px;line-height:1.7">
            该榜单需在 fork 仓库里配置榜单 ID 并跑过一次抓取后才有数据。
          </div>
        </div>

        <template v-else>
          <div v-if="platform === 'fanqie'" class="period-tabs">
            <button
              v-for="p in periodTabs"
              :key="p.key"
              class="period-tab"
              :class="{ active: p.key === curPeriod }"
              @click="selectPeriod(p.key)"
            >{{ p.label }}</button>
          </div>

          <div v-if="platform === 'fanqie'" class="summary-card">
            <div class="label">AI 风向速评 <span class="badge-src">{{ summarySrc }}</span></div>
            <p class="text">{{ summaryText }}</p>
          </div>

          <div v-if="curBoardItem?.has_genres && hotGenres.length" class="section">
            <h3 class="section-title">热门综合赛道 <span class="hint">按阅读增长加权</span></h3>
            <div class="grid">
              <div v-for="(g, i) in hotGenres" :key="g.name" class="genre-card" :class="['rank-' + (i + 1), { top1: i === 0 }]">
                <div class="rank-badge num">#{{ i + 1 }}</div>
                <div class="genre-head">
                  <div class="name">{{ g.name }}</div>
                  <div v-if="g.lead_category" class="lead">
                    <span class="lead-label">领涨</span>
                    <span class="lead-val">{{ g.lead_category }}</span>
                  </div>
                </div>
                <div class="score-row">
                  <span class="score-arrow" aria-hidden="true">▲</span>
                  <span class="score num">{{ fmt(g.read_growth_total ?? g.score) }}</span>
                  <span class="score-unit">在读增长</span>
                </div>
                <div v-if="g.new_count != null || g.dropped_count != null || g.active_days != null" class="metrics">
                  <span v-if="g.new_count != null" class="metric metric-up">
                    <span class="m-val num">+{{ g.new_count }}</span>
                    <span class="m-label">新书</span>
                  </span>
                  <span v-if="g.dropped_count != null" class="metric metric-down">
                    <span class="m-val num">−{{ g.dropped_count }}</span>
                    <span class="m-label">掉榜</span>
                  </span>
                  <span v-if="g.active_days != null" class="metric metric-mute">
                    <span class="m-val num">{{ g.active_days }}d</span>
                    <span class="m-label">活跃</span>
                  </span>
                </div>
                <div v-if="(g.categories || []).length" class="cats">
                  <span
                    v-for="c in (g.categories || [])"
                    :key="c"
                    class="chip"
                    :class="{ 'chip-lead': c === g.lead_category }"
                  >{{ c }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="hotTypes.length" class="section">
            <h3 class="section-title">热门具体分类</h3>
            <div class="type-list">
              <div v-for="t in hotTypes" :key="t.name" class="type-row">
                <div class="t-label">{{ t.name }}</div>
                <div class="t-bar-wrap"><div class="t-bar" :style="{ width: t._pct + '%' }"></div></div>
                <div class="t-val num">+{{ fmt(t._val) }}</div>
              </div>
            </div>
          </div>

          <div v-if="hotThemes.length" class="section">
            <h3 class="section-title">高频题材标签</h3>
            <div class="themes">
              <span v-for="t in hotThemes" :key="t.name" class="theme-tag" :style="{ fontSize: t._size + 'px' }">
                <span class="t-name">{{ t.name }}</span><span class="t-count num">×{{ t.count }}</span>
              </span>
            </div>
          </div>

          <div v-if="categories.length" class="section">
            <h3 class="section-title">分类榜单 &amp; 趋势</h3>
            <div class="cat-selector">
              <button
                v-for="c in categories"
                :key="c.name"
                class="cat-btn"
                :class="{ active: c.name === curCat }"
                @click="selectCat(c.name)"
              >{{ c.name }}</button>
            </div>
            <div class="cat-summary" v-html="curCatSummaryHtml"></div>
            <div class="cat-detail">
              <div class="book-list">
                <div v-for="(b, i) in curCatBooks" :key="b.title + i" class="book-card">
                  <div class="bk-rank num">{{ i + 1 }}</div>
                  <img v-if="b.cover" loading="lazy" :src="b.cover" :alt="`${b.title} 封面`" @error="(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')" />
                  <div class="bk-info">
                    <div class="bk-title">{{ b.title }} <span v-if="isNewBook(b.title)" class="tag-new">NEW</span></div>
                    <div class="bk-meta">{{ bookMeta(b) }}</div>
                    <div class="bk-intro">{{ b.intro }}</div>
                    <div class="bk-actions">
                      <button
                        type="button"
                        class="bk-action-btn"
                        :disabled="!b.url"
                        :title="b.url ? '在浏览器中打开原文' : '该书暂无原文链接'"
                        @click="openBookUrl(b.url)"
                      >
                        <ExternalLink :size="12" /> 访问原文
                      </button>
                      <button
                        type="button"
                        class="bk-action-btn"
                        :disabled="!b.intro"
                        title="复制简介到剪贴板"
                        @click="copyBookIntro(b.intro)"
                      >
                        <Copy :size="12" /> 复制简介
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="trend-side">
                <div v-if="(curCatTrend.top_risers || []).length" class="trend-box">
                  <h4>排名上升 <span class="badge-src num">{{ curCatTrend.top_risers.length }}</span></h4>
                  <div v-for="x in curCatTrend.top_risers" :key="x.title" class="trend-item">
                    <span class="ti-title">{{ x.title }}</span><span class="up num">{{ x.change }}</span>
                  </div>
                </div>
                <div v-if="(curCatTrend.top_fallers || []).length" class="trend-box">
                  <h4>排名下降</h4>
                  <div v-for="x in curCatTrend.top_fallers" :key="x.title" class="trend-item">
                    <span class="ti-title">{{ x.title }}</span><span class="down num">{{ x.change }}</span>
                  </div>
                </div>
                <div v-if="(curCatTrend.reads_growth || []).length" class="trend-box">
                  <h4>阅读增长</h4>
                  <div v-for="x in curCatTrend.reads_growth" :key="x.title" class="trend-item">
                    <span class="ti-title">{{ x.title }}</span><span class="growth num">{{ x.growth }}</span>
                  </div>
                </div>
                <div v-if="(curCatTrend.new_books || []).length" class="trend-box">
                  <h4>新上榜 <span class="badge-src num">{{ curCatTrend.new_books.length }}</span></h4>
                  <div v-for="t in curCatTrend.new_books" :key="t" class="trend-item">
                    <span class="ti-title">{{ t }}</span><span class="tag-new">NEW</span>
                  </div>
                </div>
                <div v-if="(curCatTrend.dropped_books || []).length" class="trend-box">
                  <h4>掉出榜单 <span class="badge-src num">{{ curCatTrend.dropped_books.length }}</span></h4>
                  <div v-for="(x, i) in curCatTrend.dropped_books" :key="i" class="trend-item">
                    <span class="ti-title">{{ typeof x === 'string' ? x : x.title }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

    </div>
    <n-modal
    v-model:show="scanVisible"
    class="ranking-scan-modal"
    :mask-closable="!['running', 'ideating'].includes(scanStage)"
    :close-on-esc="!['running', 'ideating'].includes(scanStage)"
  >
    <n-card
      :title="scanModalTitle"
      :bordered="false"
      role="dialog"
      aria-modal="true"
      :closable="!['running', 'ideating'].includes(scanStage)"
      style="width: min(1080px, calc(100vw - 36px));"
      @close="scanVisible = false"
    >
      <div v-if="scanStage === 'setup'" class="ranking-scan-setup">
        <div class="ranking-scan-setup__intro">
          <strong>选择扫榜范围</strong>
          <p>先选择小说平台、目标榜单与作品分类。这里只做配置，不会自动加载榜单或调用 AI。</p>
        </div>

        <div class="ranking-scan-choice-grid">
          <div class="ranking-scan-choice">
            <label>小说平台</label>
            <div class="ranking-scan-platforms">
              <button
                type="button"
                class="ranking-scan-platform"
                :class="{ active: scanSelectedPlatform === 'fanqie' }"
                @click="updateScanPlatform('fanqie')"
              >
                <strong>番茄小说</strong>
                <span>男频、女频新书榜</span>
              </button>
              <button
                type="button"
                class="ranking-scan-platform"
                :class="{ active: scanSelectedPlatform === 'qidian' }"
                @click="updateScanPlatform('qidian')"
              >
                <strong>起点中文网</strong>
                <span>畅销、月票与新书</span>
              </button>
            </div>
          </div>

          <div class="ranking-scan-choice">
            <label>目标榜单</label>
            <n-select v-model:value="scanSelectedBoard" :options="scanBoardOptions" />
          </div>

          <div v-if="scanSelectedPlatform === 'qidian'" class="ranking-scan-choice">
            <label>作品分类</label>
            <n-select v-model:value="scanSelectedCategory" :options="QIDIAN_CATEGORIES" />
          </div>
        </div>

        <div class="ranking-scan-setup-note">
          <Sparkles :size="16" />
          <span>点击“开始扫榜”后，才会加载所选榜单并调用当前模型生成风格报告。</span>
        </div>
      </div>

      <div v-else-if="scanStage === 'running'" class="ranking-scan-state">
        <div class="spinner" aria-hidden="true"></div>
        <strong>正在分析榜单市场风格</strong>
        <p>将根据书名、分类和简介识别题材组合、核心钩子、主角模型与情绪承诺。</p>
      </div>

      <div v-else-if="scanStage === 'error'" class="ranking-scan-state ranking-scan-state--error">
        <strong>扫榜分析失败</strong>
        <p>{{ scanError }}</p>
      </div>

      <div v-else-if="scanStage === 'ideating'" class="ranking-scan-state">
        <div class="spinner" aria-hidden="true"></div>
        <strong>正在生成创作方向与脑洞组合</strong>
        <p>AI 正在把榜单市场信号转化为原创选题，并检查方向之间是否具有足够差异。</p>
      </div>

      <div v-else-if="scanStage === 'idea-error'" class="ranking-scan-state ranking-scan-state--error">
        <strong>创作方向生成失败</strong>
        <p>{{ ideaError }}</p>
      </div>

      <div v-else-if="scanStage === 'ideas'" class="ranking-idea-workbench">
        <header class="ranking-idea-heading">
          <div><span>第一步</span><h3>选择一个创作方向</h3></div>
          <p>方向决定主要读者承诺与差异化策略；选中后再从该方向的三个脑洞中挑一个。</p>
        </header>

        <div class="ranking-direction-grid">
          <button
            v-for="direction in ideaDirections"
            :key="direction.id"
            type="button"
            class="ranking-direction-card"
            :class="{ active: selectedDirectionId === direction.id }"
            @click="chooseIdeaDirection(direction.id)"
          >
            <div class="ranking-direction-card__title">
              <Lightbulb :size="17" />
              <strong>{{ direction.name }}</strong>
              <CheckCircle2 v-if="selectedDirectionId === direction.id" :size="17" />
            </div>
            <p>{{ direction.rationale }}</p>
            <div class="ranking-direction-card__meta">
              <span><b>读者承诺：</b>{{ direction.readerPromise }}</span>
              <span><b>规避风险：</b>{{ direction.risk }}</span>
            </div>
          </button>
        </div>

        <div v-if="selectedDirection" class="ranking-idea-combinations">
          <header class="ranking-idea-heading ranking-idea-heading--second">
            <div><span>第二步</span><h3>选择一个脑洞组合</h3></div>
            <p>选中的组合会预填到新书向导，书名、题材和简介仍可继续修改。</p>
          </header>
          <div class="ranking-combination-grid">
            <button
              v-for="idea in selectedDirection.combinations"
              :key="idea.id"
              type="button"
              class="ranking-combination-card"
              :class="{ active: selectedIdeaId === idea.id }"
              @click="chooseIdea(idea.id)"
            >
              <div class="ranking-combination-card__title">
                <Sparkles :size="16" />
                <strong>{{ idea.title }}</strong>
                <CheckCircle2 v-if="selectedIdeaId === idea.id" :size="16" />
              </div>
              <span class="ranking-combination-card__genre">{{ idea.genre }}</span>
              <p class="ranking-combination-card__hook">{{ idea.hook }}</p>
              <div class="ranking-combination-card__details">
                <p><b>故事前提：</b>{{ idea.premise }}</p>
                <p><b>主角：</b>{{ idea.protagonist }}</p>
                <p><b>核心冲突：</b>{{ idea.conflict }}</p>
                <p><b>差异化：</b>{{ idea.innovation }}</p>
              </div>
              <div class="ranking-combination-card__tags">
                <span v-for="tag in idea.tags" :key="tag">{{ tag }}</span>
              </div>
            </button>
          </div>
        </div>
        <div v-else class="ranking-idea-empty">先选择上方一个方向，再查看对应脑洞组合。</div>
      </div>

      <article v-else class="ranking-scan-report" v-html="scanReportHtml"></article>

      <template #footer>
        <div class="ranking-scan-footer">
          <span v-if="scanStage === 'setup'">配置完成前不会加载数据或调用 AI</span>
          <span v-else-if="['ideas', 'idea-error', 'ideating'].includes(scanStage)">榜单用于识别市场信号，生成的方向与脑洞需保持原创</span>
          <span v-else>{{ scanGeneratedAt ? `生成于 ${scanGeneratedAt} · ` : '' }}基于榜单元数据，不等于正文文风分析</span>

          <div v-if="scanStage === 'setup'" class="ranking-scan-footer__actions">
            <n-button quaternary @click="scanVisible = false">取消</n-button>
            <n-button type="primary" :loading="scanLoading" @click="runRankingStyleScan(false)">
              <template #icon><Sparkles :size="15" /></template>
              开始扫榜
            </n-button>
          </div>
          <div v-else-if="scanStage === 'running'" class="ranking-scan-footer__actions">
            <n-button type="primary" loading disabled>正在扫榜</n-button>
          </div>
          <div v-else-if="scanStage === 'error'" class="ranking-scan-footer__actions">
            <n-button quaternary @click="returnToScanSetup">重新选择</n-button>
            <n-button type="primary" @click="runRankingStyleScan(true)">重试</n-button>
          </div>
          <div v-else-if="scanStage === 'ideating'" class="ranking-scan-footer__actions">
            <n-button type="primary" loading disabled>正在生成脑洞</n-button>
          </div>
          <div v-else-if="scanStage === 'idea-error'" class="ranking-scan-footer__actions">
            <n-button quaternary @click="scanStage = 'report'">返回报告</n-button>
            <n-button type="primary" @click="generateIdeaDirections(true)">重新生成</n-button>
          </div>
          <div v-else-if="scanStage === 'ideas'" class="ranking-scan-footer__actions">
            <n-button quaternary @click="scanStage = 'report'">返回报告</n-button>
            <n-button type="primary" :disabled="!selectedIdea" @click="startNovelFromIdea">用这个脑洞新建小说</n-button>
          </div>
          <div v-else class="ranking-scan-footer__actions">
            <n-button quaternary @click="returnToScanSetup">更换榜单</n-button>
            <n-button quaternary @click="copyScanReport"><Copy :size="14" /> 复制报告</n-button>
            <n-button quaternary @click="runRankingStyleScan(true)"><RefreshCw :size="14" /> 重新分析</n-button>
            <n-button type="primary" @click="generateIdeaDirections(false)">
              <template #icon><Lightbulb :size="14" /></template>
              生成创作方向
            </n-button>
          </div>
        </div>
      </template>
    </n-card>
    </n-modal>
  </section>
</template>

<style scoped>
.fanqie-page {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 100%;
  overflow-y: auto;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
}
.fanqie-shell {
  width: min(100%, 1180px);
  margin: 0 auto;
  padding: calc(var(--arc-titlebar-height) + 24px) clamp(16px, 2.6vw, 28px) 64px;
}
.num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }

.topbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 20px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--arc-border);
}
.topbar-lead { min-width: 0; }
.back-btn { margin-bottom: 8px; }
.topbar h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 760;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 10px;
}
.topbar h1 .flame { display: inline-flex; color: var(--arc-primary); }
.topbar .sub { margin: 6px 0 0; color: var(--arc-text-hint); font-size: 13px; }
.meta { text-align: right; font-size: 12px; color: var(--arc-text-hint); flex-shrink: 0; }
.meta .date { color: var(--arc-text-secondary); font-weight: 600; font-size: 13px; }
.refresh-btn {
  margin-top: 8px;
  border: 1px solid var(--arc-border-strong);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  border-radius: var(--arc-radius-md);
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.18s, color 0.18s;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.refresh-btn:hover:not(:disabled) { border-color: var(--arc-primary); color: var(--arc-primary); }
.refresh-btn:disabled { opacity: 0.5; cursor: default; }
.src-note { font-size: 11px; color: var(--arc-text-hint); margin-top: 6px; }

.board-tabs { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
.board-tab {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 9px 20px;
  border-radius: var(--arc-radius-md);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s;
  display: flex;
  align-items: center;
  gap: 8px;
}
.board-tab:hover { border-color: var(--arc-border-strong); color: var(--arc-text-primary); }
.board-tab.active { background: var(--arc-primary); border-color: var(--arc-primary); color: #fff; box-shadow: var(--arc-shadow-sm); }
.board-tab.empty { opacity: 0.5; }
.board-tab .ch {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-hint);
  font-weight: 600;
}
.board-tab.active .ch { background: rgba(255,255,255,0.22); color: #fff; }

.period-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  margin-bottom: 22px;
}
.period-tab {
  border: none;
  background: transparent;
  color: var(--arc-text-secondary);
  padding: 7px 18px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s;
}
.period-tab:hover { color: var(--arc-text-primary); }
.period-tab.active { background: var(--arc-primary); color: #fff; box-shadow: var(--arc-shadow-sm); }
.summary-card {
  background: linear-gradient(135deg, color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-surface)) 0%, var(--arc-bg-surface) 70%);
  border: 1px solid color-mix(in srgb, var(--arc-primary) 25%, var(--arc-border));
  border-left: 3px solid var(--arc-primary);
  border-radius: var(--arc-radius-lg);
  padding: 16px 20px;
  margin-bottom: 24px;
  box-shadow: 0 2px 12px -4px color-mix(in srgb, var(--arc-primary) 15%, transparent);
}
.summary-card .label {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--arc-primary);
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.summary-card .text { font-size: 14.5px; color: var(--arc-text-primary); margin: 0; }
.badge-src {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--arc-border-strong);
  color: var(--arc-text-hint);
  font-weight: 600;
  letter-spacing: 0.04em;
}

.section { margin-bottom: 30px; }
.section-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-primary);
  padding-left: 10px;
  border-left: 3px solid var(--arc-primary);
}
.section-title .hint { font-size: 12px; color: var(--arc-text-hint); font-weight: 400; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 14px; }
.genre-card {
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-lg);
  padding: 16px 16px 14px;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.genre-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: transparent;
  transition: background 0.18s ease;
}
.genre-card:hover {
  border-color: var(--arc-border-strong);
  transform: translateY(-2px);
  box-shadow: var(--arc-shadow-md, 0 6px 18px -10px rgba(0,0,0,0.25));
}
.genre-card.top1 {
  background: linear-gradient(155deg, color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface)) 0%, var(--arc-bg-surface) 55%);
  border-color: color-mix(in srgb, var(--arc-primary) 35%, var(--arc-border));
  box-shadow: 0 4px 20px -6px color-mix(in srgb, var(--arc-primary) 30%, transparent);
}
.genre-card.top1::before { background: linear-gradient(90deg, var(--arc-primary), #ff9466 70%, transparent); }
.genre-card.rank-2::before { background: linear-gradient(90deg, color-mix(in srgb, var(--arc-primary) 55%, transparent), transparent); }
.genre-card.rank-3::before { background: linear-gradient(90deg, color-mix(in srgb, var(--arc-primary) 30%, transparent), transparent); }

.genre-card .rank-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  min-width: 30px;
  height: 22px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--arc-text-hint);
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  line-height: 1;
}
.genre-card.rank-1 .rank-badge { color: #92510a; background: linear-gradient(135deg, #fde68a, #fbbf24); border-color: #f59e0b; }
.genre-card.rank-2 .rank-badge { color: #475569; background: linear-gradient(135deg, #f1f5f9, #cbd5e1); border-color: #94a3b8; }
.genre-card.rank-3 .rank-badge { color: #7c2d12; background: linear-gradient(135deg, #fed7aa, #fb923c); border-color: #ea580c; }

.genre-card .genre-head { padding-right: 44px; }
.genre-card .name {
  font-size: 17px;
  font-weight: 760;
  letter-spacing: -0.01em;
  color: var(--arc-text-primary);
  margin-bottom: 6px;
  line-height: 1.25;
}
.genre-card .lead {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--arc-text-secondary);
}
.genre-card .lead-label {
  font-size: 10.5px;
  letter-spacing: 0.05em;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 700;
}
.genre-card .lead-val { font-weight: 600; color: var(--arc-text-primary); }

.genre-card .score-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
}
.genre-card .score-arrow {
  font-size: 11px;
  color: var(--arc-success, #15803d);
  transform: translateY(-1px);
}
.genre-card .score {
  font-size: 26px;
  font-weight: 800;
  color: var(--arc-success, #15803d);
  letter-spacing: -0.025em;
  line-height: 1;
}
.genre-card .score-unit { font-size: 11.5px; color: var(--arc-text-hint); font-weight: 500; }

.genre-card .metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.genre-card .metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
}
.genre-card .metric .m-val { font-weight: 700; letter-spacing: -0.01em; }
.genre-card .metric .m-label { color: var(--arc-text-hint); }
.genre-card .metric-up .m-val { color: var(--arc-success, #15803d); }
.genre-card .metric-down .m-val { color: var(--arc-danger, #dc2626); }
.genre-card .metric-mute .m-val { color: var(--arc-text-secondary); }

.genre-card .cats {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px dashed var(--arc-border);
}
.chip {
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  color: var(--arc-text-secondary);
  transition: border-color 0.16s, color 0.16s;
}
.chip.chip-lead {
  background: var(--arc-primary-soft);
  border-color: color-mix(in srgb, var(--arc-primary) 45%, var(--arc-border));
  color: var(--arc-primary);
  font-weight: 600;
}

.themes { display: flex; flex-wrap: wrap; gap: 9px; }
.theme-tag {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  transition: all 0.18s;
}
.theme-tag:hover { border-color: var(--arc-primary); background: var(--arc-primary-soft); }
.theme-tag .t-name { font-weight: 600; }
.theme-tag .t-count { font-size: 11px; color: var(--arc-text-hint); }

.type-list { display: flex; flex-direction: column; gap: 9px; }
.type-row { display: grid; grid-template-columns: 90px 1fr 80px; align-items: center; gap: 12px; }
.type-row .t-label { font-size: 13px; font-weight: 600; text-align: right; }
.type-row .t-bar-wrap { height: 22px; background: var(--arc-bg-weak); border-radius: 6px; overflow: hidden; }
.type-row .t-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--arc-primary), #ff9466);
  border-radius: 6px;
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.type-row .t-val { font-size: 12px; color: var(--arc-text-secondary); }

.cat-selector { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 18px; }
.cat-btn {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 5px 13px;
  border-radius: 999px;
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.16s;
}
.cat-btn:hover { border-color: var(--arc-border-strong); color: var(--arc-text-primary); }
.cat-btn.active { background: var(--arc-primary-soft); border-color: var(--arc-primary); color: var(--arc-primary); font-weight: 600; }

.cat-detail { display: grid; grid-template-columns: 1fr 320px; gap: 20px; }
@media (max-width: 880px) { .cat-detail { grid-template-columns: 1fr; } }

.book-list { display: flex; flex-direction: column; gap: 10px; }
.book-card {
  display: flex;
  gap: 12px;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  padding: 12px;
  transition: all 0.16s;
}
.book-card:hover { border-color: var(--arc-border-strong); }
.book-card .bk-rank { flex-shrink: 0; width: 26px; font-size: 17px; font-weight: 800; color: var(--arc-text-hint); text-align: center; }
.book-card:nth-child(-n+3) .bk-rank { color: var(--arc-primary); }
.book-card img { width: 60px; height: 80px; object-fit: cover; border-radius: 6px; flex-shrink: 0; background: var(--arc-bg-weak); box-shadow: 0 2px 8px -2px rgba(0,0,0,0.18); }
.book-card .bk-info { min-width: 0; flex: 1; }
.book-card .bk-title { font-size: 14px; font-weight: 700; margin-bottom: 2px; display: flex; align-items: center; gap: 7px; }
.book-card .bk-meta { font-size: 12px; color: var(--arc-text-hint); margin-bottom: 5px; }
.book-card .bk-reads { color: var(--arc-success, #15803d); font-weight: 600; }
.book-card .bk-intro {
  font-size: 12px;
  color: var(--arc-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.book-card .bk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.bk-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--arc-text-secondary);
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  cursor: pointer;
  transition: border-color 0.16s, color 0.16s, background 0.16s;
}
.bk-action-btn:hover:not(:disabled) {
  border-color: var(--arc-primary);
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}
.bk-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.trend-side { display: flex; flex-direction: column; gap: 14px; }
.trend-box { background: var(--arc-bg-surface); border: 1px solid var(--arc-border); border-radius: var(--arc-radius-md); padding: 14px; border-left: 3px solid var(--arc-border); }
.trend-box:nth-child(1) { border-left-color: var(--arc-success, #15803d); }
.trend-box:nth-child(2) { border-left-color: var(--arc-danger, #dc2626); }
.trend-box:nth-child(3) { border-left-color: var(--arc-warning, #a16207); }
.trend-box:nth-child(4) { border-left-color: var(--arc-primary); }
.trend-box:nth-child(5) { border-left-color: var(--arc-border-strong); }
.trend-box h4 { margin: 0 0 10px; font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
.trend-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--arc-border);
}
.trend-item:last-child { border-bottom: none; }
.trend-item .ti-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--arc-text-secondary); }
.trend-item .up { color: var(--arc-success, #15803d); font-weight: 700; flex-shrink: 0; }
.trend-item .down { color: var(--arc-danger, #dc2626); font-weight: 700; flex-shrink: 0; }
.trend-item .growth { color: var(--arc-warning, #a16207); font-weight: 700; flex-shrink: 0; }
.tag-new { font-size: 10px; padding: 0 6px; border-radius: 4px; background: var(--arc-success, #15803d); color: #fff; font-weight: 700; }

.cat-summary {
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  padding: 14px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--arc-text-secondary);
  margin-bottom: 18px;
}
.cat-summary :deep(strong) { color: var(--arc-text-primary); }

.content { transition: opacity 0.18s; }
.content.switching { opacity: 0.45; pointer-events: none; }

.state { text-align: center; padding: 80px 20px; color: var(--arc-text-hint); }
.state .spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--arc-border);
  border-top-color: var(--arc-primary);
  border-radius: 50%;
  margin: 0 auto 16px;
  animation: fanqie-spin 0.8s linear infinite;
}
@keyframes fanqie-spin { to { transform: rotate(360deg); } }
.state .err-detail { font-size: 12px; margin-top: 10px; color: var(--arc-danger, #dc2626); }

.platform-tabs {
  display: inline-flex;
  gap: 4px;
  margin-top: 14px;
  padding: 4px;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-weak);
}
.platform-tab {
  min-height: 34px;
  padding: 6px 15px;
  border: 0;
  border-radius: calc(var(--arc-radius-md) - 3px);
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition: color .18s ease, background .18s ease, box-shadow .18s ease;
}
.platform-tab:hover { color: var(--arc-text-primary); background: var(--arc-bg-surface-hover); }
.platform-tab.active { color: var(--arc-primary); background: var(--arc-bg-surface); box-shadow: var(--arc-shadow-sm); }
.scan-btn {
  margin-left: 6px;
  border-color: color-mix(in srgb, var(--arc-primary) 38%, var(--arc-border));
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 650;
}

.qidian-category-filter {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: -4px 0 20px;
  padding: 12px 14px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
}
.qidian-category-filter > strong {
  flex: 0 0 auto;
  padding-top: 6px;
  color: var(--arc-text-primary);
  font-size: 13px;
}
.qidian-category-tabs { display: flex; flex-wrap: wrap; gap: 4px 6px; }
.qidian-category-tab {
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--arc-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: color .18s ease, background-color .18s ease, border-color .18s ease;
}
.qidian-category-tab:hover:not(:disabled) { color: var(--arc-primary); background: var(--arc-bg-surface-hover); }
.qidian-category-tab.active {
  border-color: color-mix(in srgb, var(--arc-primary) 38%, transparent);
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-surface));
  color: var(--arc-primary);
  font-weight: 700;
}
.qidian-category-tab:disabled { cursor: wait; opacity: .55; }
.cat-detail:has(.trend-side:empty) { grid-template-columns: 1fr; }
.trend-side:empty { display: none; }

.ranking-scan-modal :deep(.n-card__content) {
  max-height: min(72vh, 760px);
  overflow-y: auto;
  padding: 20px 24px 28px;
}
.ranking-scan-setup { display: flex; flex-direction: column; gap: 24px; padding: 4px 0 8px; }
.ranking-scan-setup__intro strong { color: var(--arc-text-primary); font-size: 18px; }
.ranking-scan-setup__intro p { margin: 8px 0 0; color: var(--arc-text-secondary); line-height: 1.7; }
.ranking-scan-choice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
}
.ranking-scan-choice { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.ranking-scan-choice > label { color: var(--arc-text-primary); font-size: 13px; font-weight: 700; }
.ranking-scan-platforms { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ranking-scan-platform {
  min-height: 68px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-card);
  color: var(--arc-text-primary);
  cursor: pointer;
  text-align: left;
  transition: border-color .18s ease, background-color .18s ease, box-shadow .18s ease;
}
.ranking-scan-platform:hover { border-color: color-mix(in srgb, var(--arc-accent) 55%, var(--arc-border)); }
.ranking-scan-platform.active {
  border-color: var(--arc-accent);
  background: color-mix(in srgb, var(--arc-accent) 9%, var(--arc-bg-card));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-accent) 14%, transparent);
}
.ranking-scan-platform strong { font-size: 14px; }
.ranking-scan-platform span { color: var(--arc-text-secondary); font-size: 12px; }
.ranking-scan-setup-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 12px 14px;
  border-radius: 9px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.ranking-scan-setup-note svg { flex: 0 0 auto; margin-top: 2px; color: var(--arc-accent); }
.ranking-scan-state {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  color: var(--arc-text-secondary);
}
.ranking-scan-state strong { color: var(--arc-text-primary); font-size: 17px; }
.ranking-scan-state p { max-width: 560px; margin: 0; line-height: 1.7; }
.ranking-scan-state--error strong { color: var(--arc-danger); }
.ranking-scan-report { color: var(--arc-text-secondary); font-size: 14px; line-height: 1.75; overflow-x: auto; }
.ranking-scan-report :deep(h1),
.ranking-scan-report :deep(h2),
.ranking-scan-report :deep(h3) { color: var(--arc-text-primary); line-height: 1.35; }
.ranking-scan-report :deep(h2) {
  margin: 26px 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--arc-border);
  font-size: 18px;
}
.ranking-scan-report :deep(h2:first-child) { margin-top: 0; }
.ranking-scan-report :deep(h3) { margin: 20px 0 8px; font-size: 15px; }
.ranking-scan-report :deep(p) { margin: 8px 0; }
.ranking-scan-report :deep(ul), .ranking-scan-report :deep(ol) { margin: 8px 0; padding-left: 24px; }
.ranking-scan-report :deep(li) { margin: 5px 0; }
.ranking-scan-report :deep(blockquote) {
  margin: 14px 0;
  padding: 10px 14px;
  border-left: 3px solid var(--arc-primary);
  border-radius: 0 var(--arc-radius-md) var(--arc-radius-md) 0;
  background: var(--arc-primary-soft);
}
.ranking-scan-report :deep(table) { width: 100%; min-width: 720px; margin: 14px 0; border-collapse: collapse; font-size: 12.5px; }
.ranking-scan-report :deep(th), .ranking-scan-report :deep(td) {
  padding: 9px 10px;
  border: 1px solid var(--arc-border);
  text-align: left;
  vertical-align: top;
}
.ranking-scan-report :deep(th) { background: var(--arc-bg-weak); color: var(--arc-text-primary); font-weight: 700; }
.ranking-scan-footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: var(--arc-text-hint);
  font-size: 12px;
}
.ranking-scan-footer__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.ranking-idea-workbench { display: flex; flex-direction: column; gap: 20px; padding: 2px 0 10px; }
.ranking-idea-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
.ranking-idea-heading > div > span { display: inline-block; margin-bottom: 4px; color: var(--arc-primary); font-size: 12px; font-weight: 700; }
.ranking-idea-heading h3 { margin: 0; color: var(--arc-text-primary); font-size: 19px; }
.ranking-idea-heading > p { max-width: 520px; margin: 0; color: var(--arc-text-secondary); font-size: 13px; line-height: 1.6; text-align: right; }
.ranking-direction-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ranking-direction-card,
.ranking-combination-card {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-primary);
  cursor: pointer;
  text-align: left;
  transition: border-color .18s ease, background-color .18s ease, box-shadow .18s ease, transform .18s ease;
}
.ranking-direction-card { min-height: 160px; padding: 16px; border-radius: 11px; }
.ranking-direction-card:hover, .ranking-combination-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 50%, var(--arc-border));
  transform: translateY(-1px);
}
.ranking-direction-card.active, .ranking-combination-card.active {
  border-color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 7%, var(--arc-bg-surface));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-primary) 14%, transparent);
}
.ranking-direction-card__title, .ranking-combination-card__title { display: flex; align-items: center; gap: 8px; }
.ranking-direction-card__title svg, .ranking-combination-card__title svg { flex: 0 0 auto; color: var(--arc-primary); }
.ranking-direction-card__title strong, .ranking-combination-card__title strong { flex: 1; font-size: 15px; }
.ranking-direction-card > p { margin: 10px 0 12px; color: var(--arc-text-secondary); font-size: 13px; line-height: 1.65; }
.ranking-direction-card__meta { display: flex; flex-direction: column; gap: 5px; color: var(--arc-text-hint); font-size: 12px; line-height: 1.5; }
.ranking-idea-combinations { display: flex; flex-direction: column; gap: 14px; padding-top: 20px; border-top: 1px solid var(--arc-border); }
.ranking-combination-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.ranking-combination-card { min-height: 330px; display: flex; flex-direction: column; padding: 16px; border-radius: 11px; }
.ranking-combination-card__genre {
  align-self: flex-start;
  margin-top: 9px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 700;
}
.ranking-combination-card__hook { margin: 12px 0; color: var(--arc-text-primary); font-size: 13px; font-weight: 600; line-height: 1.6; }
.ranking-combination-card__details { display: flex; flex-direction: column; gap: 7px; }
.ranking-combination-card__details p { margin: 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.55; }
.ranking-combination-card__details b { color: var(--arc-text-primary); font-weight: 700; }
.ranking-combination-card__tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; padding-top: 14px; }
.ranking-combination-card__tags span { padding: 2px 7px; border-radius: 999px; background: var(--arc-bg-weak); color: var(--arc-text-hint); font-size: 11px; }
.ranking-idea-empty {
  padding: 28px;
  border: 1px dashed var(--arc-border);
  border-radius: 10px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  text-align: center;
}

@media (max-width: 700px) {
  .ranking-scan-choice-grid { grid-template-columns: 1fr; }
  .ranking-scan-platforms { grid-template-columns: 1fr; }
  .ranking-idea-heading { align-items: flex-start; flex-direction: column; gap: 6px; }
  .ranking-idea-heading > p { text-align: left; }
  .ranking-direction-grid, .ranking-combination-grid { grid-template-columns: 1fr; }
  .ranking-combination-card { min-height: 0; }
  .ranking-scan-footer { align-items: flex-start; flex-direction: column; }
  .ranking-scan-footer__actions { width: 100%; justify-content: flex-end; flex-wrap: wrap; }
}
</style>

