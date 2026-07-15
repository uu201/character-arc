import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AiTaskKind } from '@/features/ai/taskRegistry'

export type CatalogBatchMode = 'character' | 'organization' | 'relationship' | 'membership' | 'worldview' | 'inspiration'
export type CatalogBatchEntry = Record<string, unknown>

export function normalizeCatalogTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((tag) => {
      if (tag && typeof tag === 'object') {
        return String((tag as Record<string, unknown>).label ?? '').trim()
      }
      return String(tag ?? '').trim()
    })
    .filter((tag) => tag && tag !== '[object Object]')
    .slice(0, 4)
}

interface CatalogBatchOptions {
  mode: CatalogBatchMode
  count: number
  label: string
  panel: string
  kind: AiTaskKind
  context: Record<string, unknown>
  existingKeys?: string[]
  keyField?: 'name' | 'title'
  onProgress?: (completed: number, total: number) => void
}

export function useCatalogBatch() {
  const appStore = useAppStore()

  async function generateCatalogBatch(options: CatalogBatchOptions): Promise<CatalogBatchEntry[]> {
    const total = Math.max(1, Math.min(100, Math.floor(options.count)))
    const keyField = options.keyField
    const knownKeys = new Set((options.existingKeys ?? []).map((key) => key.trim().toLowerCase()).filter(Boolean))
    const entries: CatalogBatchEntry[] = []
    const maxAttempts = Math.ceil(total / 10) + 2

    for (let attempt = 0; entries.length < total && attempt < maxAttempts; attempt += 1) {
      const batchCount = Math.min(10, total - entries.length)
      const taskKey = `catalog-batch:${options.mode}`
      const allTargets = Array.isArray(options.context.targets) ? options.context.targets : null
      const batchContext = allTargets
        ? { ...options.context, targets: allTargets.slice(entries.length, entries.length + batchCount) }
        : options.context
      const response = await appStore.runTrackedAiTask(
        {
          key: taskKey,
          kind: options.kind,
          label: options.label,
          description: `正在生成 ${entries.length + 1}-${entries.length + batchCount} / ${total}`,
          panel: options.panel,
          timeoutMs: 0
        },
        () => window.characterArc.generateAi(toIpcPayload({
          task: 'catalog-batch',
          clientKey: taskKey,
          settings: appStore.appSettings,
          context: {
            ...batchContext,
            mode: options.mode,
            count: batchCount,
            existingNames: [...knownKeys]
          }
        }))
      )

      if (!response.success || !response.result) {
        throw new Error(response.error ?? `${options.label}失败`)
      }

      const result = response.result as { entries?: CatalogBatchEntry[] }
      for (const entry of result.entries ?? []) {
        if (entries.length >= total) break
        if (keyField) {
          const key = String(entry[keyField] ?? '').trim().toLowerCase()
          if (!key || knownKeys.has(key)) continue
          knownKeys.add(key)
        }
        entries.push(entry)
      }
      options.onProgress?.(entries.length, total)
    }

    return entries
  }

  return { generateCatalogBatch }
}
