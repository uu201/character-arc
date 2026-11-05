import assert from 'node:assert/strict'
import test from 'node:test'
import { formatStagedChangeForDisplay, visibleStagedChanges } from './stagedChangeList.ts'

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

const referenceLabels = {
  角色: new Map([['character-lin', '林澈'], ['character-qiao', '乔知夏']]),
  组织: new Map([['org-guard', '守城军']]),
  设定: new Map([['world-port', '灰潮港']])
}

test('已有大纲暂存的前后文本显示角色、组织和设定名称，并保留 ID', () => {
  const change = Object.freeze({
    ...changes[1],
    kind: 'outline',
    before: '关联角色 ID：character-lin\r\n关联设定 ID：world-port',
    after: '标题：雨夜追查\n摘要：保留 character-lin 原文\n关联角色 ID：character-lin / character-qiao\n关联组织 ID：org-guard\n关联设定 ID：world-port',
    entityPayload: Object.freeze({ relatedCharacterIds: ['character-lin', 'character-qiao'] })
  })
  const displayed = formatStagedChangeForDisplay(change, referenceLabels)
  assert.equal(displayed.before, '关联角色：林澈（character-lin）\r\n关联设定：灰潮港（world-port）')
  assert.equal(displayed.after, '标题：雨夜追查\n摘要：保留 character-lin 原文\n关联角色：林澈（character-lin） / 乔知夏（character-qiao）\n关联组织：守城军（org-guard）\n关联设定：灰潮港（world-port）')
  assert.equal(displayed.entityPayload, change.entityPayload)
  assert.equal(change.before, '关联角色 ID：character-lin\r\n关联设定 ID：world-port')
})

test('已删除或名称为空的实体回退到原 ID，保留关联顺序', () => {
  const labels = { ...referenceLabels, 角色: new Map([['character-empty', '  ']]) }
  const change = {
    ...changes[1], kind: 'outline', before: '',
    after: '关联角色 ID：character-missing / character-empty\n关联设定 ID：world-port / world-missing'
  }
  const displayed = formatStagedChangeForDisplay(change, labels)
  assert.equal(displayed.before, '')
  assert.equal(displayed.after, '关联角色：character-missing / character-empty\n关联设定：灰潮港（world-port） / world-missing')
})

test('同名实体仍能通过 ID 区分，重复格式化不会叠加备注', () => {
  const labels = { ...referenceLabels, 角色: new Map([['character-a', '林澈'], ['character-b', '林澈']]) }
  const change = { ...changes[1], kind: 'outline', before: '', after: '关联角色 ID：character-a / character-b' }
  const displayed = formatStagedChangeForDisplay(change, labels)
  assert.equal(displayed.after, '关联角色：林澈（character-a） / 林澈（character-b）')
  assert.deepEqual(formatStagedChangeForDisplay(displayed, labels), displayed)
})

test('章节和其他类型的正文不做 ID 替换', () => {
  for (const kind of ['chapter', 'worldview', 'character']) {
    const change = { ...changes[1], kind, before: '', after: '关联角色 ID：character-lin' }
    assert.equal(formatStagedChangeForDisplay(change, referenceLabels), change)
  }
})
