import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'

// ── 模块级单例状态（跨组件实例共享，页面切换不丢失） ──
const showModal = ref(false)
const stage = ref<'picker' | 'running' | 'done'>('picker')
const pickedFiles = ref<Array<{ filePath: string; fileName: string; size: number }>>([])
const concurrency = ref(3)
const books = ref<Map<string, BatchBookState>>(new Map())
const batchFinished = ref(false)
let batchGeneration = 0

type BookStatus = 'queued' | 'running' | 'success' | 'error' | 'canceled'

export interface BatchBookState {
  bookId: string
  fileName: string
  filePath: string
  status: BookStatus
  phase: string
  message: string
  percent: number
  chunkIndex: number
  chunkTotal: number
  chunkLabel: string
  startedAt: number
  elapsedLabel: string
}

// ── 进度监听器（模块级，只注册一次） ──
let progressCleanup: (() => void) | null = null
let listenerInstanceCount = 0

function ensureProgressListener(): void {
  if (progressCleanup) return
  progressCleanup = window.characterArc.onReferenceImportProgress((payload) => {
    if (!payload.bookId) return
    const map = books.value
    const existing = map.get(payload.bookId)
    const now = Date.now()

    const updatedBook: BatchBookState = existing
      ? {
          ...existing,
          phase: payload.phase,
          message: payload.message,
          percent: payload.percent,
          chunkIndex: payload.chunkIndex ?? existing.chunkIndex,
          chunkTotal: payload.chunkTotal ?? existing.chunkTotal,
          chunkLabel: payload.chunkLabel ?? existing.chunkLabel,
          fileName: payload.sourceTitle || existing.fileName,
          status: (payload.status && payload.status !== 'queued' ? payload.status : existing.status) as BookStatus,
          startedAt: existing.status === 'queued' && payload.status === 'running' ? now : existing.startedAt
        }
      : {
          bookId: payload.bookId,
          fileName: payload.sourceTitle || '',
          filePath: '',
          status: (payload.status ?? 'queued') as BookStatus,
          phase: payload.phase,
          message: payload.message,
          percent: payload.percent,
          chunkIndex: payload.chunkIndex ?? 0,
          chunkTotal: payload.chunkTotal ?? 0,
          chunkLabel: payload.chunkLabel ?? '',
          startedAt: payload.status === 'running' ? now : 0,
          elapsedLabel: ''
        }

    const next = new Map(map)
    next.set(payload.bookId, updatedBook)
    books.value = next
  })
}

function teardownProgressListener(): void {
  if (progressCleanup) {
    progressCleanup()
    progressCleanup = null
  }
}

// ── 耗时计时器 ──
let tickTimer: number | null = null

function startTicker(): void {
  if (tickTimer) return
  tickTimer = window.setInterval(() => {
    const map = books.value
    let changed = false
    for (const book of map.values()) {
      if (book.status === 'running' && book.startedAt > 0) {
        const seconds = Math.round((Date.now() - book.startedAt) / 1000)
        const label = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`
        if (book.elapsedLabel !== label) {
          book.elapsedLabel = label
          changed = true
        }
      }
    }
    // 强制触发响应式更新
    if (changed) books.value = new Map(map)
  }, 1000)
}

function stopTicker(): void {
  if (tickTimer) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
}

// ── 工具函数 ──
const BOOK_PHASES = ['extracting', 'chunking', 'chunk-analysis', 'aggregating', 'saving', 'done'] as const
const PHASE_LABELS: Record<string, string> = {
  extracting: '读取',
  chunking: '切分',
  'chunk-analysis': '分块分析',
  aggregating: '汇总',
  saving: '归档',
  done: '完成'
}

function formatSize(bytes: number): string {
  const kb = bytes / 1024
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`
}

function phaseState(book: BatchBookState, p: string): 'done' | 'active' | 'pending' {
  if (book.status === 'success') return 'done'
  if (book.status === 'error' || book.status === 'canceled') return 'pending'
  const currentIdx = BOOK_PHASES.indexOf(book.phase as typeof BOOK_PHASES[number])
  const pIdx = BOOK_PHASES.indexOf(p as typeof BOOK_PHASES[number])
  if (pIdx < currentIdx) return 'done'
  if (pIdx === currentIdx) return 'active'
  return 'pending'
}

// ── Composable ──
const BATCH_TASK_KEY = 'batch-reference-import'

export function useBatchImport() {
  const appStore = useAppStore()

  const bookList = computed(() => Array.from(books.value.values()))
  const completedCount = computed(() => bookList.value.filter(b => b.status === 'success' || b.status === 'error' || b.status === 'canceled').length)
  const successCount = computed(() => bookList.value.filter(b => b.status === 'success').length)
  const errorCount = computed(() => bookList.value.filter(b => b.status === 'error').length)
  const runningCount = computed(() => bookList.value.filter(b => b.status === 'running').length)
  const queuedCount = computed(() => bookList.value.filter(b => b.status === 'queued').length)
  const overallPercent = computed(() => books.value.size === 0 ? 0 : Math.round((completedCount.value / books.value.size) * 100))
  const failedBooks = computed(() => bookList.value.filter(b => b.status === 'error'))
  const totalSize = computed(() => pickedFiles.value.reduce((sum, f) => sum + f.size, 0))
  const totalSizeLabel = computed(() => {
    const kb = totalSize.value / 1024
    return kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${Math.round(kb)} KB`
  })
  const isRunningInBackground = computed(() => stage.value === 'running' && !batchFinished.value)

  // 组件挂载时注册/复用监听器，卸载时按需清理
  onMounted(() => {
    listenerInstanceCount++
    ensureProgressListener()
  })

  onBeforeUnmount(() => {
    listenerInstanceCount--
    // 只在没有活跃组件且没有正在运行的批量任务时清理监听器
    if (listenerInstanceCount <= 0) {
      listenerInstanceCount = 0
      if (!isRunningInBackground.value) {
        teardownProgressListener()
      }
    }
  })

  async function startBatch(): Promise<void> {
    if (pickedFiles.value.length === 0) return
    stage.value = 'running'
    batchFinished.value = false
    books.value = new Map()
    startTicker()
    ensureProgressListener()

    const currentGen = ++batchGeneration

    // 注册到全局 AI 任务进度面板
    appStore.registerManualTask({
      key: BATCH_TASK_KEY,
      kind: 'reference',
      label: '批量拆书',
      description: `正在拆解 ${pickedFiles.value.length} 本参考小说`,
      panel: 'deconstruction-library',
      onCancel: () => {
        window.characterArc.cancelReferenceNovelBook()
        handleCancelAll()
      }
    })

    const filePaths = pickedFiles.value.map(f => f.filePath)
    const result = await window.characterArc.importReferenceNovelBatch(JSON.parse(JSON.stringify({
      settings: appStore.appSettings,
      projectSkills: [],
      filePaths,
      concurrency: concurrency.value
    })))

    if (currentGen !== batchGeneration) return

    stopTicker()
    batchFinished.value = true
    stage.value = 'done'

    // 终结全局任务面板
    const hasErrors = errorCount.value > 0
    appStore.finalizeManualTask(BATCH_TASK_KEY, hasErrors ? 'error' : 'done', hasErrors ? `${errorCount.value} 本拆书失败` : undefined)

    if (result.success && result.results) {
      for (const item of result.results) {
        if (item.success && item.result) {
          appStore.upsertReferenceWork(item.result.referenceWork)
          appStore.mergeKnowledgeDocuments(item.result.knowledgeDocuments)
        }
      }
    }
  }

  function handleCancelBook(bookId: string): void {
    window.characterArc.cancelReferenceNovelBook(bookId)
    const map = books.value
    const book = map.get(bookId)
    if (book && (book.status === 'running' || book.status === 'queued')) {
      const next = new Map(map)
      next.set(bookId, { ...book, status: 'canceled', message: '已取消', percent: 0 })
      books.value = next
    }
  }

  function handleCancelAll(): void {
    window.characterArc.cancelReferenceNovelBook()
    const map = books.value
    const next = new Map(map)
    for (const [id, book] of next) {
      if (book.status === 'running' || book.status === 'queued') {
        next.set(id, { ...book, status: 'canceled', message: '已取消', percent: 0 })
      }
    }
    books.value = next
    stopTicker()
    batchFinished.value = true
    stage.value = 'done'
    appStore.finalizeManualTask(BATCH_TASK_KEY, 'done')
  }

  async function handlePickFiles(): Promise<void> {
    const result = await window.characterArc.pickReferenceNovelFiles()
    if (!result.success || result.canceled || !result.files) return
    const existing = new Set(pickedFiles.value.map(f => f.filePath))
    for (const file of result.files) {
      if (!existing.has(file.filePath)) {
        pickedFiles.value.push(file)
      }
    }
  }

  function removeFile(index: number): void {
    pickedFiles.value.splice(index, 1)
  }

  function clearFiles(): void {
    pickedFiles.value = []
  }

  function closeModal(): void {
    if (isRunningInBackground.value) {
      showModal.value = false
      return
    }
    stage.value = 'picker'
    pickedFiles.value = []
    books.value = new Map()
    showModal.value = false
  }

  function finishAndClose(): void {
    batchGeneration++
    stage.value = 'picker'
    pickedFiles.value = []
    books.value = new Map()
    batchFinished.value = false
    showModal.value = false
    appStore.dismissAiTask(BATCH_TASK_KEY)
  }

  function setConcurrency(n: number): void {
    concurrency.value = n
  }

  function openModal(): void {
    showModal.value = true
  }

  return {
    showModal,
    stage,
    pickedFiles,
    concurrency,
    books,
    batchFinished,
    bookList,
    completedCount,
    successCount,
    errorCount,
    runningCount,
    queuedCount,
    overallPercent,
    failedBooks,
    totalSize,
    totalSizeLabel,
    isRunningInBackground,
    startBatch,
    handleCancelBook,
    handleCancelAll,
    handlePickFiles,
    removeFile,
    clearFiles,
    closeModal,
    finishAndClose,
    setConcurrency,
    openModal,
    BOOK_PHASES,
    PHASE_LABELS,
    formatSize,
    phaseState
  }
}
