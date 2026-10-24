import type { StagedChange } from '@shared/assistant-runtime'

export type StagedChangeFilter = 'all' | 'chapter' | 'setting' | 'pending' | 'deleted'

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
