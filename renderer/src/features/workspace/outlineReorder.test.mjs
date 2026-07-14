import assert from 'node:assert/strict'
import test from 'node:test'
import {
  moveOutlineItemsAroundTarget,
  moveOutlineItemsToVolumeEnd
} from './outlineReorder.ts'

function ids(items) {
  return items.map((item) => item.id)
}

const items = [
  { id: 'a', volumeId: 'v1' },
  { id: 'b', volumeId: 'v1' },
  { id: 'c', volumeId: 'v1' },
  { id: 'd', volumeId: 'v2' }
]

test('单节点向前或向后移动时遵循明确的插入位置', () => {
  assert.deepEqual(ids(moveOutlineItemsAroundTarget(items, ['a'], 'c', 'after')), ['b', 'c', 'a', 'd'])
  assert.deepEqual(ids(moveOutlineItemsAroundTarget(items, ['c'], 'a', 'before')), ['c', 'a', 'b', 'd'])
})

test('多选移动保持节点在时间线中的原始顺序', () => {
  const result = moveOutlineItemsAroundTarget(items, ['c', 'a'], 'd', 'before')
  assert.deepEqual(ids(result), ['b', 'a', 'c', 'd'])
  assert.equal(result.find((item) => item.id === 'a')?.volumeId, 'v2')
  assert.equal(result.find((item) => item.id === 'c')?.volumeId, 'v2')
})

test('目标节点属于移动集合时不执行重排', () => {
  assert.equal(moveOutlineItemsAroundTarget(items, ['a', 'b'], 'b', 'after'), items)
})

test('移动到卷末时允许移动集合包含原来的最后一个节点', () => {
  const result = moveOutlineItemsToVolumeEnd(items, ['b', 'c'], 'v1', ['v1', 'v2'])
  assert.deepEqual(ids(result), ['a', 'b', 'c', 'd'])
})

test('移动到空卷时插入到下一卷节点之前', () => {
  const itemsWithEmptyMiddleVolume = items.map((item) => (
    item.id === 'd' ? { ...item, volumeId: 'v3' } : item
  ))
  const result = moveOutlineItemsToVolumeEnd(itemsWithEmptyMiddleVolume, ['a'], 'v2', ['v1', 'v2', 'v3'])
  assert.deepEqual(ids(result), ['b', 'c', 'a', 'd'])
  assert.equal(result.find((item) => item.id === 'a')?.volumeId, 'v2')
})
