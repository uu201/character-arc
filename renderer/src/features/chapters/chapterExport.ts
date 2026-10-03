export async function loadAllChapterContent<T extends { id: string; title: string; contentLoaded?: boolean }>(
  items: T[],
  load: (id: string) => Promise<T | null>
): Promise<T[]> {
  const loadedItems = await Promise.all(items.map((item) =>
    item.contentLoaded === false ? load(item.id) : item
  ))
  const failedItem = loadedItems.find((item) => item === null)
  if (failedItem === null) {
    throw new Error('有章节正文加载失败，请重试后再导出。')
  }
  return loadedItems as T[]
}
