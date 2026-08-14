export type VolumeCollapseScope = 'outline' | 'chapter-tree'

export interface CollapseStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function volumeCollapseStorageKey(scope: VolumeCollapseScope, projectId: string): string {
  return `characterarc:volume-collapse:${scope}:${projectId}`
}

export function normalizeCollapsedVolumeIds(value: unknown, validVolumeIds: readonly string[]): string[] {
  if (!Array.isArray(value)) return []
  const validIds = new Set(validVolumeIds)
  return [...new Set(value.map(String).filter((id) => validIds.has(id)))]
}

export function parseCollapsedVolumeIds(raw: string | null, validVolumeIds: readonly string[]): string[] {
  if (!raw) return []
  try {
    return normalizeCollapsedVolumeIds(JSON.parse(raw), validVolumeIds)
  } catch {
    return []
  }
}

export function readCollapsedVolumeIds(
  storage: CollapseStorage,
  scope: VolumeCollapseScope,
  projectId: string,
  validVolumeIds: readonly string[]
): string[] {
  try {
    return parseCollapsedVolumeIds(storage.getItem(volumeCollapseStorageKey(scope, projectId)), validVolumeIds)
  } catch {
    return []
  }
}

export function writeCollapsedVolumeIds(
  storage: CollapseStorage,
  scope: VolumeCollapseScope,
  projectId: string,
  collapsedVolumeIds: readonly string[],
  validVolumeIds: readonly string[]
): void {
  try {
    const normalized = normalizeCollapsedVolumeIds(collapsedVolumeIds, validVolumeIds)
    storage.setItem(volumeCollapseStorageKey(scope, projectId), JSON.stringify(normalized))
  } catch {
    // 界面偏好写入失败不应影响正文编辑。
  }
}
