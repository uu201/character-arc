import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseCollapsedVolumeIds,
  readCollapsedVolumeIds,
  volumeCollapseStorageKey,
  writeCollapsedVolumeIds
} from './volumeCollapseState.ts'

function createStorage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    }
  }
}

test('折叠状态会去重并清理已删除的分卷', () => {
  assert.deepEqual(
    parseCollapsedVolumeIds('["v1","v2","v1","deleted"]', ['v1', 'v2', 'v3']),
    ['v1', 'v2']
  )
  assert.deepEqual(parseCollapsedVolumeIds('not-json', ['v1']), [])
})

test('剧情大纲和章节树按项目分别保存折叠状态', () => {
  const storage = createStorage()
  writeCollapsedVolumeIds(storage, 'outline', 'project-1', ['v1'], ['v1', 'v2'])
  writeCollapsedVolumeIds(storage, 'chapter-tree', 'project-1', ['v2'], ['v1', 'v2'])
  writeCollapsedVolumeIds(storage, 'outline', 'project-2', ['v2'], ['v1', 'v2'])

  assert.deepEqual(readCollapsedVolumeIds(storage, 'outline', 'project-1', ['v1', 'v2']), ['v1'])
  assert.deepEqual(readCollapsedVolumeIds(storage, 'chapter-tree', 'project-1', ['v1', 'v2']), ['v2'])
  assert.deepEqual(readCollapsedVolumeIds(storage, 'outline', 'project-2', ['v1', 'v2']), ['v2'])
  assert.notEqual(
    volumeCollapseStorageKey('outline', 'project-1'),
    volumeCollapseStorageKey('chapter-tree', 'project-1')
  )
})
