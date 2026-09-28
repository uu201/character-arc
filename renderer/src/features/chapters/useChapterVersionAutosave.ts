import { onBeforeUnmount, watch } from 'vue'

export interface ChapterVersionSnapshot {
  chapterId: string
  signature: string
}

export interface ChapterVersionAutosaveOptions {
  getSnapshot: () => ChapterVersionSnapshot | null
  saveVersion: (chapterId: string) => Promise<void>
  idleDelayMs?: number
  minimumIntervalMs?: number
  maximumIntervalMs?: number
}

const DEFAULT_IDLE_DELAY_MS = 30_000
const DEFAULT_MINIMUM_INTERVAL_MS = 3 * 60_000
const DEFAULT_MAXIMUM_INTERVAL_MS = 10 * 60_000

export function useChapterVersionAutosave(options: ChapterVersionAutosaveOptions): void {
  const idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS
  const minimumIntervalMs = options.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS
  const maximumIntervalMs = options.maximumIntervalMs ?? DEFAULT_MAXIMUM_INTERVAL_MS

  let activeSnapshot = options.getSnapshot()
  let dirty = false
  let lastVersionAt = 0
  let idleTimer: number | undefined
  let maximumTimer: number | undefined
  let saveQueue = Promise.resolve()

  function clearTimer(timer: number | undefined): void {
    if (timer !== undefined) window.clearTimeout(timer)
  }

  function clearCheckpointTimers(): void {
    clearTimer(idleTimer)
    clearTimer(maximumTimer)
    idleTimer = undefined
    maximumTimer = undefined
  }

  function queueVersionSave(snapshot: ChapterVersionSnapshot): void {
    const queuedSignature = snapshot.signature
    saveQueue = saveQueue
      .then(() => options.saveVersion(snapshot.chapterId))
      .then(() => {
        if (
          activeSnapshot?.chapterId === snapshot.chapterId &&
          activeSnapshot.signature === queuedSignature
        ) {
          dirty = false
          lastVersionAt = Date.now()
          clearCheckpointTimers()
        }
      })
      .catch((error) => {
        console.error('[chapter-version-autosave] 保存历史版本失败', error)
        if (activeSnapshot?.chapterId === snapshot.chapterId) {
          dirty = true
          scheduleIdleCheckpoint()
        }
      })
  }

  function saveActiveCheckpoint(): void {
    if (!dirty || !activeSnapshot) return

    if (lastVersionAt > 0) {
      const remaining = minimumIntervalMs - (Date.now() - lastVersionAt)
      if (remaining > 0) {
        scheduleIdleCheckpoint(remaining)
        return
      }
    }

    queueVersionSave(activeSnapshot)
  }

  function scheduleIdleCheckpoint(delay = idleDelayMs): void {
    clearTimer(idleTimer)
    idleTimer = window.setTimeout(() => {
      idleTimer = undefined
      saveActiveCheckpoint()
    }, delay)
  }

  function scheduleMaximumCheckpoint(): void {
    if (maximumTimer !== undefined) return
    maximumTimer = window.setTimeout(() => {
      maximumTimer = undefined
      if (activeSnapshot) queueVersionSave(activeSnapshot)
    }, maximumIntervalMs)
  }

  function markDirty(): void {
    dirty = true
    scheduleIdleCheckpoint()
    scheduleMaximumCheckpoint()
  }

  const stopWatch = watch(
    options.getSnapshot,
    (nextSnapshot, previousSnapshot) => {
      if (!nextSnapshot) {
        if (previousSnapshot && dirty) queueVersionSave(previousSnapshot)
        activeSnapshot = null
        dirty = false
        lastVersionAt = 0
        clearCheckpointTimers()
        return
      }

      if (!previousSnapshot || nextSnapshot.chapterId !== previousSnapshot.chapterId) {
        if (previousSnapshot && dirty) queueVersionSave(previousSnapshot)
        activeSnapshot = nextSnapshot
        dirty = false
        lastVersionAt = 0
        clearCheckpointTimers()
        return
      }

      activeSnapshot = nextSnapshot
      if (nextSnapshot.signature !== previousSnapshot.signature) markDirty()
    },
    { flush: 'post' }
  )

  onBeforeUnmount(() => {
    stopWatch()
    if (activeSnapshot && dirty) queueVersionSave(activeSnapshot)
    clearCheckpointTimers()
  })
}
