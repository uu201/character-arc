import type { StagedChange } from '@shared/assistant-runtime'

export type StagedChangeFilter = 'all' | 'chapter' | 'setting' | 'pending' | 'deleted'

export type OutlineReferenceLabels = Record<'角色' | '组织' | '设定', ReadonlyMap<string, string>>

/** 仅转换审阅文本；保留原始 ID 和写回载荷，也兼容已有的暂存记录。 */
export function formatStagedChangeForDisplay(
  change: StagedChange,
  labels: OutlineReferenceLabels
): StagedChange {
  if (change.kind !== 'outline') return change

  const formatText = (text: string): string => text.replace(
    /^关联(角色|组织|设定) ID：([^\r\n]*)/gm,
    (_, kind: keyof OutlineReferenceLabels, ids: string) => {
      const references = ids.split(/\s*\/\s*/).map((id) => {
        const label = labels[kind].get(id)?.trim()
        return label ? `${label}（${id}）` : id
      })
      return `关联${kind}：${references.join(' / ')}`
    }
  )

  return { ...change, before: formatText(change.before), after: formatText(change.after) }
}

export function visibleStagedChanges(
  changes: readonly StagedChange[],
  filter: StagedChangeFilter
): StagedChange[] {
  return changes
    .map((change, index) => ({ change, index }))
    .filter(({ change }) => {
      if (filter === 'deleted') return change.status === 'rejected'
      if (change.status === 'committed' || change.status === 'rejected') return false
      if (filter === 'chapter') return change.kind === 'chapter'
      if (filter === 'setting') return change.kind !== 'chapter'
      if (filter === 'pending') return change.status === 'pending' || change.status === 'streaming'
      return true
    })
    .sort((a, b) => b.change.createdAt.localeCompare(a.change.createdAt) || b.index - a.index)
    .map(({ change }) => change)
}
