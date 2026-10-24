type OrderableChapter = { id: string; volumeId: string; sortOrder?: number }

/** 与分卷目录保持一致；旧卷内排序和手动拖拽顺序优先于标题中的数字。 */
export function normalizeChapterOrder<T extends OrderableChapter>(items: T[], volumeIds: string[]): T[] {
  const volumeOrder = new Map(volumeIds.map((id, index) => [id, index]))
  const ordered = items.map((item, index) => ({
    ...item,
    sortOrder: Number.isSafeInteger(item.sortOrder) ? Number(item.sortOrder) : (index + 1) * 1024
  })).sort((left, right) => left.sortOrder - right.sortOrder)
    .sort((left, right) => (
      (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER)
      - (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER)
    ))

  // 分卷重组后可能不再单调递增，必须同时修复排序值，防止持久化后再次错序。
  if (ordered.some((item, index) => index > 0 && item.sortOrder <= ordered[index - 1].sortOrder)) {
    return ordered.map((item, index) => ({ ...item, sortOrder: (index + 1) * 1024 }))
  }
  return ordered
}
