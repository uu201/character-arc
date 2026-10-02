import type { ChapterOrderRecord } from '@shared/ipc-types'

const CHAPTER_ORDER_STEP = 1024

type OrderableChapter = {
  id: string
  volumeId: string
  sortOrder?: number
}

export function assignSparseChapterOrder<T extends OrderableChapter>(
  items: T[],
  movedChapterIds: string[]
): { items: T[]; chapters: ChapterOrderRecord[] } {
  const movedIds = new Set(movedChapterIds)
  const movedIndexes = items
    .map((item, index) => movedIds.has(item.id) ? index : -1)
    .filter((index) => index >= 0)
  if (movedIndexes.length === 0) return { items, chapters: [] }

  const hasMissingOrder = items.some((item) => !Number.isSafeInteger(item.sortOrder))
  const isContiguous = movedIndexes.every((index, position) => (
    position === 0 || index === movedIndexes[position - 1] + 1
  ))
  if (hasMissingOrder || !isContiguous) {
    return rebalanceChapterOrder(items)
  }

  const firstIndex = movedIndexes[0]
  const lastIndex = movedIndexes[movedIndexes.length - 1]
  const previous = items[firstIndex - 1]
  const next = items[lastIndex + 1]
  const previousOrder = previous?.sortOrder
  const nextOrder = next?.sortOrder
  const count = movedIndexes.length
  let assigned: number[]

  if (Number.isSafeInteger(previousOrder) && Number.isSafeInteger(nextOrder)) {
    const gap = Number(nextOrder) - Number(previousOrder)
    if (gap <= count) return rebalanceChapterOrder(items)
    const step = Math.floor(gap / (count + 1))
    assigned = movedIndexes.map((_, index) => Number(previousOrder) + step * (index + 1))
  } else if (Number.isSafeInteger(previousOrder)) {
    assigned = movedIndexes.map((_, index) => Number(previousOrder) + CHAPTER_ORDER_STEP * (index + 1))
  } else if (Number.isSafeInteger(nextOrder)) {
    assigned = movedIndexes.map((_, index) => Number(nextOrder) - CHAPTER_ORDER_STEP * (count - index))
  } else {
    assigned = movedIndexes.map((_, index) => CHAPTER_ORDER_STEP * (index + 1))
  }

  if (assigned.some((order) => !Number.isSafeInteger(order))) {
    return rebalanceChapterOrder(items)
  }

  const assignedById = new Map(movedIndexes.map((itemIndex, index) => [items[itemIndex].id, assigned[index]]))
  const nextItems = items.map((item) => {
    const sortOrder = assignedById.get(item.id)
    return sortOrder === undefined ? item : { ...item, sortOrder }
  })
  return {
    items: nextItems,
    chapters: nextItems
      .filter((item) => movedIds.has(item.id))
      .map((item) => ({ id: item.id, volumeId: item.volumeId, sortOrder: Number(item.sortOrder) }))
  }
}

function rebalanceChapterOrder<T extends OrderableChapter>(items: T[]): {
  items: T[]
  chapters: ChapterOrderRecord[]
} {
  const nextItems = items.map((item, index) => ({
    ...item,
    sortOrder: (index + 1) * CHAPTER_ORDER_STEP
  }))
  return {
    items: nextItems,
    chapters: nextItems.map((item) => ({
      id: item.id,
      volumeId: item.volumeId,
      sortOrder: Number(item.sortOrder)
    }))
  }
}
