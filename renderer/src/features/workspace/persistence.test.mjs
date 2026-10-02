import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

import { ref } from 'vue'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context)
    }
    return nextResolve(specifier, context)
  }
})

const { createWorkspacePersistence } = await import('./persistence.ts')

function createPersistence() {
  return createWorkspacePersistence({
    hasHydrated: ref(true),
    serializeWorkspaceState: () => ({}),
    getSettingsSnapshot: () => ({
      theme: 'light',
      selectedProjectId: 'project-1',
      appSettings: { autoSaveInterval: 'live' }
    }),
    applyRemoteState: () => {}
  })
}

test('章节排序保存失败后自动重试并保留较新的排序', async () => {
  const originalWindow = globalThis.window
  const timers = new Map()
  const calls = []
  let nextTimerId = 1
  let resolveRetrySave
  let persistence
  const retrySaved = new Promise((resolve) => {
    resolveRetrySave = resolve
  })

  globalThis.window = {
    setTimeout(callback, delay) {
      const id = nextTimerId
      nextTimerId += 1
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    characterArc: {
      saveChapterOrder(payload) {
        calls.push(payload)
        if (calls.length === 1) {
          void persistence.persistChapterOrder({
            projectId: 'project-1',
            chapters: [
              { id: 'chapter-a', volumeId: 'volume-1', sortOrder: 300 }
            ]
          })
          return Promise.resolve({ success: false, error: 'database busy' })
        }
        resolveRetrySave()
        return Promise.resolve({ success: true })
      }
    }
  }

  try {
    persistence = createPersistence()
    await persistence.persistChapterOrder({
      projectId: 'project-1',
      chapters: [
        { id: 'chapter-a', volumeId: 'volume-1', sortOrder: 100 },
        { id: 'chapter-b', volumeId: 'volume-1', sortOrder: 200 }
      ]
    })

    assert.equal(persistence.hasPendingChapterPersists.value, true)
    assert.equal(persistence.persistenceError.value, 'database busy')
    assert.equal(timers.size, 1)
    const [retryTimer] = timers.values()
    assert.equal(retryTimer.delay, 1500)

    timers.clear()
    retryTimer.callback()
    await retrySaved
    await Promise.resolve()

    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1].chapters, [
      { id: 'chapter-a', volumeId: 'volume-1', sortOrder: 300 },
      { id: 'chapter-b', volumeId: 'volume-1', sortOrder: 200 }
    ])
    assert.equal(persistence.hasPendingChapterPersists.value, false)
    assert.equal(persistence.persistenceError.value, null)
  } finally {
    globalThis.window = originalWindow
  }
})
