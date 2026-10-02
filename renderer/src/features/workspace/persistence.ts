import { ref, type Ref } from 'vue'
import { FAST_PERSIST_DELAY_MS, resolveAutoSaveDelayMs } from '@/features/settings/autoSave'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AppSettings, ThemeName } from '@/types/app'
import type {
  PersistedChapterRecord,
  SaveChapterOrderRequest,
  SaveChaptersRequest
} from '@shared/ipc-types'
import type { StoredState } from './storeHelpers'

const SETTINGS_PERSIST_DELAY_MS = 300
const WORKSPACE_SYNC_DELAY_MS = 120

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
  let chapterPersistPromise: Promise<void> | null = null
  let chapterOrderPersistPromise: Promise<void> | null = null
  let activeChapterPersistCount = 0
  let persistRequested = false
  let chapterSaveTimer: number | null = null
  let pendingChapterOrder: SaveChapterOrderRequest | null = null
  const pendingChapters = new Map<string, {
    projectWordCount: string
    chapters: Map<string, PersistedChapterRecord>
  }>()
  let isApplyingRemoteWorkspaceSync = false
  const scheduledPersistAt = ref<number | null>(null)
  const isPersisting = ref(false)
  const isChapterPersisting = ref(false)
  const hasPendingChapterPersists = ref(false)
  const persistenceError = ref<string | null>(null)

  function beginChapterPersist(): void {
    activeChapterPersistCount += 1
    isChapterPersisting.value = true
  }

  function endChapterPersist(): void {
    activeChapterPersistCount = Math.max(0, activeChapterPersistCount - 1)
    isChapterPersisting.value = activeChapterPersistCount > 0
  }

  function updateChapterPendingState(): void {
    hasPendingChapterPersists.value = pendingChapters.size > 0 || pendingChapterOrder !== null
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

  function persistChapterOrder(payload: SaveChapterOrderRequest): Promise<void> {
    if (pendingChapterOrder?.projectId === payload.projectId) {
      const chapters = new Map(pendingChapterOrder.chapters.map((chapter) => [chapter.id, chapter]))
      for (const chapter of payload.chapters) chapters.set(chapter.id, chapter)
      pendingChapterOrder = { projectId: payload.projectId, chapters: Array.from(chapters.values()) }
    } else {
      pendingChapterOrder = payload
    }
    updateChapterPendingState()
    if (chapterOrderPersistPromise) return chapterOrderPersistPromise

    chapterOrderPersistPromise = (async () => {
      beginChapterPersist()
      try {
        while (pendingChapterOrder) {
          const next = pendingChapterOrder
          pendingChapterOrder = null
          updateChapterPendingState()
          await flushChapterPersists()
          if (persistenceError.value) {
            pendingChapterOrder = next
            updateChapterPendingState()
            return
          }
          const result = await window.characterArc.saveChapterOrder(toIpcPayload(next))
          if (!result.success) throw new Error(result.error ?? '章节排序保存失败')
        }
        persistenceError.value = null
      } catch (error) {
        persistenceError.value = error instanceof Error ? error.message : '章节排序保存失败'
      } finally {
        endChapterPersist()
        chapterOrderPersistPromise = null
        updateChapterPendingState()
      }
    })()
    return chapterOrderPersistPromise
  }

  function scheduleWorkspaceSync(): void {
    if (!deps.hasHydrated.value || isApplyingRemoteWorkspaceSync) {
      return
    }
    if (workspaceSyncTimer) {
      window.clearTimeout(workspaceSyncTimer)
    }
    workspaceSyncTimer = window.setTimeout(() => {
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
    isChapterPersisting,
    hasPendingChapterPersists,
    hasPendingChapterPersist,
    persistenceError,
    scheduleWorkspaceSync,
    flushWorkspaceSync,
    persistWorkspace,
    scheduleChapterPersist,
    flushChapterPersists,
    persistChapterOrder,
    persistAppSettings,
    schedulePersist,
    scheduleSettingsPersist,
    handleRemoteWorkspaceSync
  }
}
