import { ref, type Ref } from 'vue'
import { FAST_PERSIST_DELAY_MS, resolveAutoSaveDelayMs } from '@/features/settings/autoSave'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AppSettings, ThemeName } from '@/types/app'
import type {
  PersistedChapterRecord,
  SaveChapterOrderRequest,
  SaveChaptersRequest,
  SaveWorkspaceEntitiesRequest
} from '@shared/ipc-types'
import type { StoredState } from './storeHelpers'

const SETTINGS_PERSIST_DELAY_MS = 300
const WORKSPACE_SYNC_DELAY_MS = 500
const CHAPTER_ORDER_RETRY_DELAY_MS = 1500

export interface WorkspacePersistenceDeps {
  hasHydrated: Ref<boolean>
  serializeWorkspaceState: () => StoredState
  getSettingsSnapshot: () => {
    theme: ThemeName
    selectedProjectId: string
    appSettings: AppSettings
  }
  applyRemoteState: (payload: Partial<StoredState>) => void
}

export function createWorkspacePersistence(deps: WorkspacePersistenceDeps) {
  let saveTimer: number | null = null
  let settingsSaveTimer: number | null = null
  let workspaceSyncTimer: number | null = null
  let persistPromise: Promise<void> | null = null
  let workspaceEntityPersistPromise: Promise<void> | null = null
  let chapterPersistPromise: Promise<void> | null = null
  let chapterOrderPersistPromise: Promise<void> | null = null
  let chapterOrderRetryTimer: number | null = null
  let activeChapterPersistCount = 0
  let persistRequested = false
  let chapterSaveTimer: number | null = null
  let workspaceEntitySaveTimer: number | null = null
  const pendingChapterOrders = new Map<string, SaveChapterOrderRequest>()
  const pendingWorkspaceEntities = new Map<string, SaveWorkspaceEntitiesRequest>()
  const pendingChapters = new Map<string, {
    projectWordCount: string
    chapters: Map<string, PersistedChapterRecord>
  }>()
  let isApplyingRemoteWorkspaceSync = false
  const scheduledPersistAt = ref<number | null>(null)
  const isPersisting = ref(false)
  const isWorkspaceEntityPersisting = ref(false)
  const isChapterPersisting = ref(false)
  const hasPendingWorkspaceEntityPersists = ref(false)
  const hasPendingChapterPersists = ref(false)
  const persistenceError = ref<string | null>(null)

  function beginChapterPersist(): void {
    activeChapterPersistCount += 1
    isChapterPersisting.value = true
  }

  function updateWorkspaceEntityPendingState(): void {
    hasPendingWorkspaceEntityPersists.value = pendingWorkspaceEntities.size > 0
  }

  function mergeWorkspaceEntityBatch(
    current: SaveWorkspaceEntitiesRequest | undefined,
    next: SaveWorkspaceEntitiesRequest
  ): SaveWorkspaceEntitiesRequest {
    return {
      projectId: next.projectId,
      worldviewEntries: next.worldviewEntries ?? current?.worldviewEntries,
      characters: next.characters ?? current?.characters,
      inspirationEntries: next.inspirationEntries ?? current?.inspirationEntries
    }
  }

  function restoreWorkspaceEntityBatch(batch: SaveWorkspaceEntitiesRequest): void {
    const current = pendingWorkspaceEntities.get(batch.projectId)
    pendingWorkspaceEntities.set(batch.projectId, {
      projectId: batch.projectId,
      worldviewEntries: current?.worldviewEntries ?? batch.worldviewEntries,
      characters: current?.characters ?? batch.characters,
      inspirationEntries: current?.inspirationEntries ?? batch.inspirationEntries
    })
  }

  function scheduleWorkspaceEntitiesPersist(payload: SaveWorkspaceEntitiesRequest): void {
    if (!deps.hasHydrated.value || !payload.projectId) return
    pendingWorkspaceEntities.set(
      payload.projectId,
      mergeWorkspaceEntityBatch(pendingWorkspaceEntities.get(payload.projectId), payload)
    )
    updateWorkspaceEntityPendingState()
    if (workspaceEntitySaveTimer) window.clearTimeout(workspaceEntitySaveTimer)
    workspaceEntitySaveTimer = window.setTimeout(() => {
      workspaceEntitySaveTimer = null
      void flushWorkspaceEntityPersists()
    }, FAST_PERSIST_DELAY_MS)
  }

  async function flushWorkspaceEntityPersists(): Promise<void> {
    if (workspaceEntitySaveTimer) {
      window.clearTimeout(workspaceEntitySaveTimer)
      workspaceEntitySaveTimer = null
    }
    if (workspaceEntityPersistPromise) {
      await workspaceEntityPersistPromise.catch(() => {})
      if (pendingWorkspaceEntities.size > 0) await flushWorkspaceEntityPersists()
      return
    }
    if (pendingWorkspaceEntities.size === 0) {
      updateWorkspaceEntityPendingState()
      return
    }

    const batches = Array.from(pendingWorkspaceEntities.values())
    pendingWorkspaceEntities.clear()
    updateWorkspaceEntityPendingState()
    let failedIndex = batches.length
    workspaceEntityPersistPromise = (async () => {
      isWorkspaceEntityPersisting.value = true
      for (let index = 0; index < batches.length; index += 1) {
        failedIndex = index
        const result = await window.characterArc.saveWorkspaceEntities(toIpcPayload(batches[index]))
        if (!result.success) throw new Error(result.error ?? '工作区实体保存失败')
        failedIndex = index + 1
      }
      persistenceError.value = null
    })()

    try {
      await workspaceEntityPersistPromise
    } catch (error) {
      persistenceError.value = error instanceof Error ? error.message : '工作区实体保存失败'
      for (const batch of batches.slice(failedIndex)) restoreWorkspaceEntityBatch(batch)
    } finally {
      isWorkspaceEntityPersisting.value = false
      workspaceEntityPersistPromise = null
      updateWorkspaceEntityPendingState()
    }

    if (!persistenceError.value && pendingWorkspaceEntities.size > 0) {
      await flushWorkspaceEntityPersists()
    }
  }

  function endChapterPersist(): void {
    activeChapterPersistCount = Math.max(0, activeChapterPersistCount - 1)
    isChapterPersisting.value = activeChapterPersistCount > 0
  }

  function updateChapterPendingState(): void {
    hasPendingChapterPersists.value = pendingChapters.size > 0 || pendingChapterOrders.size > 0
  }

  function hasPendingChapterPersist(projectId: string, chapterId: string): boolean {
    return pendingChapters.get(projectId)?.chapters.has(chapterId) ?? false
  }

  function scheduleChapterPersist(
    projectId: string,
    projectWordCount: string,
    chapter: PersistedChapterRecord,
    mode: 'fast' | 'autosave' = 'autosave'
  ): void {
    if (!deps.hasHydrated.value || !projectId) return
    let batch = pendingChapters.get(projectId)
    if (!batch) {
      batch = { projectWordCount, chapters: new Map() }
      pendingChapters.set(projectId, batch)
    }
    batch.projectWordCount = projectWordCount
    batch.chapters.set(chapter.id, chapter)
    updateChapterPendingState()

    const delay = mode === 'fast'
      ? FAST_PERSIST_DELAY_MS
      : resolveAutoSaveDelayMs(deps.getSettingsSnapshot().appSettings.autoSaveInterval)
    if (mode === 'autosave' && chapterSaveTimer) return
    if (chapterSaveTimer) window.clearTimeout(chapterSaveTimer)
    chapterSaveTimer = window.setTimeout(() => {
      chapterSaveTimer = null
      void flushChapterPersists()
    }, delay)
  }

  async function flushChapterPersists(): Promise<void> {
    if (chapterSaveTimer) {
      window.clearTimeout(chapterSaveTimer)
      chapterSaveTimer = null
    }
    if (chapterPersistPromise) {
      await chapterPersistPromise
      if (pendingChapters.size > 0) await flushChapterPersists()
      return
    }
    if (pendingChapters.size === 0) {
      updateChapterPendingState()
      return
    }

    const batches: SaveChaptersRequest[] = Array.from(pendingChapters.entries()).map(([projectId, batch]) => ({
      projectId,
      projectWordCount: batch.projectWordCount,
      chapters: Array.from(batch.chapters.values())
    }))
    pendingChapters.clear()
    updateChapterPendingState()
    chapterPersistPromise = (async () => {
      beginChapterPersist()
      for (const batch of batches) {
        const result = await window.characterArc.saveChapters(toIpcPayload(batch))
        if (!result.success) throw new Error(result.error ?? '章节保存失败')
      }
      persistenceError.value = null
    })()

    try {
      await chapterPersistPromise
    } catch (error) {
      persistenceError.value = error instanceof Error ? error.message : '章节保存失败'
      for (const batch of batches) {
        let pending = pendingChapters.get(batch.projectId)
        if (!pending) {
          pending = { projectWordCount: batch.projectWordCount, chapters: new Map() }
          pendingChapters.set(batch.projectId, pending)
        }
        for (const chapter of batch.chapters) {
          if (!pending.chapters.has(chapter.id)) pending.chapters.set(chapter.id, chapter)
        }
      }
    } finally {
      endChapterPersist()
      chapterPersistPromise = null
      updateChapterPendingState()
    }

    if (!persistenceError.value && pendingChapters.size > 0) {
      await flushChapterPersists()
    }
  }

  function mergeChapterOrderBatch(
    current: SaveChapterOrderRequest | undefined,
    next: SaveChapterOrderRequest
  ): SaveChapterOrderRequest {
    const chapters = new Map(current?.chapters.map((chapter) => [chapter.id, chapter]) ?? [])
    for (const chapter of next.chapters) chapters.set(chapter.id, chapter)
    return { projectId: next.projectId, chapters: Array.from(chapters.values()) }
  }

  function restoreChapterOrderBatch(batch: SaveChapterOrderRequest): void {
    const newer = pendingChapterOrders.get(batch.projectId)
    pendingChapterOrders.set(
      batch.projectId,
      newer ? mergeChapterOrderBatch(batch, newer) : batch
    )
  }

  function scheduleChapterOrderRetry(): void {
    if (chapterOrderRetryTimer !== null || pendingChapterOrders.size === 0) return
    chapterOrderRetryTimer = window.setTimeout(() => {
      chapterOrderRetryTimer = null
      void flushChapterOrderPersists()
    }, CHAPTER_ORDER_RETRY_DELAY_MS)
  }

  function flushChapterOrderPersists(): Promise<void> {
    if (chapterOrderPersistPromise) return chapterOrderPersistPromise
    if (pendingChapterOrders.size === 0) {
      updateChapterPendingState()
      return Promise.resolve()
    }

    chapterOrderPersistPromise = (async () => {
      beginChapterPersist()
      let currentBatch: SaveChapterOrderRequest | null = null
      try {
        while (pendingChapterOrders.size > 0) {
          const nextEntry = pendingChapterOrders.entries().next().value as
            | [string, SaveChapterOrderRequest]
            | undefined
          if (!nextEntry) break
          const [projectId, next] = nextEntry
          currentBatch = next
          pendingChapterOrders.delete(projectId)
          updateChapterPendingState()
          persistenceError.value = null
          await flushChapterPersists()
          if (persistenceError.value) throw new Error(persistenceError.value)
          const result = await window.characterArc.saveChapterOrder(toIpcPayload(next))
          if (!result.success) throw new Error(result.error ?? '章节排序保存失败')
          currentBatch = null
        }
        persistenceError.value = null
      } catch (error) {
        if (currentBatch) restoreChapterOrderBatch(currentBatch)
        persistenceError.value = error instanceof Error ? error.message : '章节排序保存失败'
        scheduleChapterOrderRetry()
      } finally {
        endChapterPersist()
        chapterOrderPersistPromise = null
        updateChapterPendingState()
      }
    })()
    return chapterOrderPersistPromise
  }

  function persistChapterOrder(payload: SaveChapterOrderRequest): Promise<void> {
    pendingChapterOrders.set(
      payload.projectId,
      mergeChapterOrderBatch(pendingChapterOrders.get(payload.projectId), payload)
    )
    updateChapterPendingState()
    if (chapterOrderRetryTimer !== null) {
      window.clearTimeout(chapterOrderRetryTimer)
      chapterOrderRetryTimer = null
    }
    return flushChapterOrderPersists()
  }

  function scheduleWorkspaceSync(): void {
    if (!deps.hasHydrated.value || isApplyingRemoteWorkspaceSync) {
      return
    }
    if (workspaceSyncTimer) {
      window.clearTimeout(workspaceSyncTimer)
    }
    workspaceSyncTimer = window.setTimeout(() => {
      workspaceSyncTimer = null
      void window.characterArc.publishWorkspaceSync(toIpcPayload(deps.serializeWorkspaceState()))
    }, WORKSPACE_SYNC_DELAY_MS)
  }

  function flushWorkspaceSync(): void {
    if (!deps.hasHydrated.value || isApplyingRemoteWorkspaceSync) {
      return
    }
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    if (workspaceSyncTimer) {
      window.clearTimeout(workspaceSyncTimer)
      workspaceSyncTimer = null
    }
    if (workspaceEntitySaveTimer) {
      window.clearTimeout(workspaceEntitySaveTimer)
      workspaceEntitySaveTimer = null
    }
    pendingWorkspaceEntities.clear()
    updateWorkspaceEntityPendingState()
    const result = window.characterArc.saveWorkspaceSync(toIpcPayload(deps.serializeWorkspaceState()))
    persistenceError.value = result.success ? null : result.error ?? '保存失败'
    if (result.success) {
      scheduledPersistAt.value = null
    }
  }

  function persistWorkspace(): Promise<void> {
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    scheduledPersistAt.value = null
    persistRequested = true

    if (persistPromise) {
      return persistPromise
    }

    persistPromise = (async () => {
      isPersisting.value = true
      try {
        await flushWorkspaceEntityPersists()
        await flushChapterPersists()
        while (persistRequested) {
          persistRequested = false
          let result: { success: boolean; error?: string }
          try {
            result = await window.characterArc.saveWorkspace(toIpcPayload(deps.serializeWorkspaceState()))
          } catch (error) {
            const message = error instanceof Error ? error.message : '保存失败'
            console.error('[workspace] saveWorkspace failed:', error)
            persistenceError.value = message
            persistRequested = false
            return
          }
          if (!result.success) {
            console.error('[workspace] saveWorkspace failed:', result.error)
          }
          persistenceError.value = result.success ? null : result.error ?? '保存失败'
          if (!result.success) {
            persistRequested = false
          }
        }
      } finally {
        isPersisting.value = false
        persistPromise = null
      }
    })()

    return persistPromise
  }

  async function persistAppSettings(): Promise<void> {
    if (settingsSaveTimer) {
      window.clearTimeout(settingsSaveTimer)
      settingsSaveTimer = null
    }
    const result = await window.characterArc.saveAppSettings(toIpcPayload(deps.getSettingsSnapshot()))
    if (!result.success) {
      console.error('[workspace] saveAppSettings failed:', result.error)
      persistenceError.value = result.error ?? '保存失败'
    } else {
      persistenceError.value = null
    }
  }

  function schedulePersist(
    mode: 'fast' | 'autosave' = 'autosave',
    options: { syncWorkspace?: boolean } = {}
  ): void {
    if (!deps.hasHydrated.value) {
      return
    }
    if (options.syncWorkspace !== false) {
      scheduleWorkspaceSync()
    }
    const delay =
      mode === 'fast'
        ? FAST_PERSIST_DELAY_MS
        : resolveAutoSaveDelayMs(deps.getSettingsSnapshot().appSettings.autoSaveInterval)
    const nextPersistAt = Date.now() + delay
    if (mode === 'autosave' && saveTimer && scheduledPersistAt.value !== null) {
      return
    }
    scheduledPersistAt.value = nextPersistAt
    if (saveTimer) {
      window.clearTimeout(saveTimer)
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null
      void persistWorkspace()
    }, delay)
  }

  function scheduleSettingsPersist(options: { flushWorkspace?: boolean } = {}): void {
    if (!deps.hasHydrated.value) return
    if (options.flushWorkspace !== false) {
      scheduleWorkspaceSync()
      // Saving most settings should also flush any queued workspace edits before the app closes.
      schedulePersist('fast')
    }
    if (settingsSaveTimer) {
      window.clearTimeout(settingsSaveTimer)
    }
    settingsSaveTimer = window.setTimeout(() => {
      void persistAppSettings()
    }, SETTINGS_PERSIST_DELAY_MS)
  }

  function handleRemoteWorkspaceSync(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return
    }
    isApplyingRemoteWorkspaceSync = true
    try {
      deps.applyRemoteState(payload as Partial<StoredState>)
    } finally {
      isApplyingRemoteWorkspaceSync = false
    }
  }

  return {
    scheduledPersistAt,
    isPersisting,
    isWorkspaceEntityPersisting,
    isChapterPersisting,
    hasPendingWorkspaceEntityPersists,
    hasPendingChapterPersists,
    hasPendingChapterPersist,
    persistenceError,
    scheduleWorkspaceSync,
    flushWorkspaceSync,
    persistWorkspace,
    scheduleWorkspaceEntitiesPersist,
    flushWorkspaceEntityPersists,
    scheduleChapterPersist,
    flushChapterPersists,
    persistChapterOrder,
    persistAppSettings,
    schedulePersist,
    scheduleSettingsPersist,
    handleRemoteWorkspaceSync
  }
}
