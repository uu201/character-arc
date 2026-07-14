export type OutlineDropPosition = 'before' | 'after'

interface OutlineOrderItem {
  id: string
  volumeId: string
}

function collectMovedItems<T extends OutlineOrderItem>(items: T[], outlineIds: string[]): {
  movedItems: T[]
  remainingItems: T[]
} {
  const outlineIdSet = new Set(outlineIds)
  return {
    movedItems: items.filter((item) => outlineIdSet.has(item.id)),
    remainingItems: items.filter((item) => !outlineIdSet.has(item.id))
  }
}

export function moveOutlineItemsAroundTarget<T extends OutlineOrderItem>(
  items: T[],
  outlineIds: string[],
  targetOutlineId: string,
  position: OutlineDropPosition
): T[] {
  const outlineIdSet = new Set(outlineIds)
  if (!outlineIdSet.size || outlineIdSet.has(targetOutlineId)) {
    return items
  }

  const targetItem = items.find((item) => item.id === targetOutlineId)
  if (!targetItem) {
    return items
  }

  const { movedItems, remainingItems } = collectMovedItems(items, outlineIds)
  if (!movedItems.length) {
    return items
  }

  const targetIndex = remainingItems.findIndex((item) => item.id === targetOutlineId)
  if (targetIndex === -1) {
    return items
  }

  const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex
  const movedToTargetVolume = movedItems.map((item) => ({
    ...item,
    volumeId: targetItem.volumeId
  }))

  return [
    ...remainingItems.slice(0, insertIndex),
    ...movedToTargetVolume,
    ...remainingItems.slice(insertIndex)
  ]
}

export function moveOutlineItemsToVolumeEnd<T extends OutlineOrderItem>(
  items: T[],
  outlineIds: string[],
  volumeId: string,
  volumeIds: string[]
): T[] {
  if (!outlineIds.length || !volumeIds.includes(volumeId)) {
    return items
  }

  const { movedItems, remainingItems } = collectMovedItems(items, outlineIds)
  if (!movedItems.length) {
    return items
  }

  const movedToTargetVolume = movedItems.map((item) => ({
    ...item,
    volumeId
  }))
  let insertIndex = -1

  for (let index = remainingItems.length - 1; index >= 0; index -= 1) {
    if (remainingItems[index].volumeId === volumeId) {
      insertIndex = index + 1
      break
    }
  }

  if (insertIndex === -1) {
    const targetVolumeIndex = volumeIds.indexOf(volumeId)
    insertIndex = remainingItems.findIndex((item) => volumeIds.indexOf(item.volumeId) > targetVolumeIndex)
    if (insertIndex === -1) {
      insertIndex = remainingItems.length
    }
  }

  return [
    ...remainingItems.slice(0, insertIndex),
    ...movedToTargetVolume,
    ...remainingItems.slice(insertIndex)
  ]
}
