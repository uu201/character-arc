export const WORKBENCH_MENU_DEFINITIONS = [
  { id: 'overview', label: '作品概览' },
  { id: 'characters', label: '角色图鉴' },
  { id: 'relations', label: '关系组织' },
  { id: 'world', label: '世界观设定' },
  { id: 'outline', label: '剧情大纲' },
  { id: 'threads', label: '剧情线索' },
  { id: 'chapters', label: '章节创作' },
  { id: 'inspiration', label: '灵感模块' },
  { id: 'project-knowledge', label: '项目知识库' },
  { id: 'global-assistant-v2', label: '全局助手 v2' }
] as const

export type WorkbenchMenuId = typeof WORKBENCH_MENU_DEFINITIONS[number]['id']
export type WorkbenchMenuDropPosition = 'before' | 'after'

export const DEFAULT_WORKBENCH_MENU_ORDER: WorkbenchMenuId[] = WORKBENCH_MENU_DEFINITIONS.map(
  (item) => item.id
)

const workbenchMenuIdSet = new Set<string>(DEFAULT_WORKBENCH_MENU_ORDER)

export function normalizeWorkbenchMenuOrder(value?: readonly string[] | null): WorkbenchMenuId[] {
  const result: WorkbenchMenuId[] = []
  const seen = new Set<string>()

  if (Array.isArray(value)) {
    for (const rawId of value) {
      const id = typeof rawId === 'string' ? rawId.trim() : ''
      if (!id || seen.has(id) || !workbenchMenuIdSet.has(id)) continue
      seen.add(id)
      result.push(id as WorkbenchMenuId)
    }
  }

  for (const id of DEFAULT_WORKBENCH_MENU_ORDER) {
    if (!seen.has(id)) result.push(id)
  }

  return result
}

export function moveWorkbenchMenuItem(
  order: readonly string[],
  sourceId: WorkbenchMenuId,
  targetId: WorkbenchMenuId,
  position: WorkbenchMenuDropPosition
): WorkbenchMenuId[] {
  const normalized = normalizeWorkbenchMenuOrder(order)
  if (sourceId === targetId) return normalized

  const remaining = normalized.filter((id) => id !== sourceId)
  const targetIndex = remaining.indexOf(targetId)
  if (targetIndex === -1) return normalized

  const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex
  remaining.splice(insertIndex, 0, sourceId)
  return remaining
}

export function shiftWorkbenchMenuItem(
  order: readonly string[],
  menuId: WorkbenchMenuId,
  offset: -1 | 1
): WorkbenchMenuId[] {
  const normalized = normalizeWorkbenchMenuOrder(order)
  const currentIndex = normalized.indexOf(menuId)
  const targetIndex = currentIndex + offset
  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= normalized.length) return normalized

  const next = [...normalized]
  ;[next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]]
  return next
}
