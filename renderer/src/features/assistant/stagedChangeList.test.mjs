import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleStagedChanges } from './stagedChangeList.ts'

const changes = [
  { id: 'deleted', kind: 'chapter', status: 'rejected', createdAt: '2026-10-24T01:00:00.000Z' },
  { id: 'old', kind: 'chapter', status: 'pending', createdAt: '2026-10-24T02:00:00.000Z' },
  { id: 'accepted', kind: 'worldview', status: 'accepted', createdAt: '2026-10-24T03:00:00.000Z' },
  { id: 'new', kind: 'chapter', status: 'pending', createdAt: '2026-10-24T04:00:00.000Z' },
  { id: 'committed', kind: 'worldview', status: 'committed', createdAt: '2026-10-24T05:00:00.000Z' }
]

test('已删除提案退出所有待处理分类，新提案优先，保留已确认未写回项', () => {
  assert.deepEqual(visibleStagedChanges(changes, 'all').map((c) => c.id), ['new', 'accepted', 'old'])
  assert.deepEqual(visibleStagedChanges(changes, 'chapter').map((c) => c.id), ['new', 'old'])
  assert.deepEqual(visibleStagedChanges(changes, 'setting').map((c) => c.id), ['accepted'])
  assert.deepEqual(visibleStagedChanges(changes, 'pending').map((c) => c.id), ['new', 'old'])
})

test('旧版本忽略的提案只在已删除分类中显示，恢复后回到待处理列表', () => {
  assert.deepEqual(visibleStagedChanges(changes, 'deleted').map((c) => c.id), ['deleted'])
  const restored = changes.map((c) => c.id === 'deleted' ? { ...c, status: 'accepted' } : c)
  assert.deepEqual(visibleStagedChanges(restored, 'deleted'), [])
  assert.ok(visibleStagedChanges(restored, 'all').some((c) => c.id === 'deleted'))
})

test('同毫秒内后到的项也排在前面，不改变原始依赖顺序', () => {
  const input = Object.freeze([
    { ...changes[1], id: 'first' },
    { ...changes[1], id: 'second' }
  ])
  assert.deepEqual(visibleStagedChanges(input, 'all').map((c) => c.id), ['second', 'first'])
  assert.deepEqual(input.map((c) => c.id), ['first', 'second'])
})
