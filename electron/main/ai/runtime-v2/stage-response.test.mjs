import assert from 'node:assert/strict'
import test from 'node:test'

import { toStageResponse } from './stage-response.ts'

function makeChange() {
  return {
    id: 'change-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    kind: 'chapter',
    action: 'update',
    entityId: 'chapter-1',
    entityTitle: '第一章',
    reason: '润色正文',
    before: '旧'.repeat(1500),
    after: '新'.repeat(1500),
    chapterHtml: { old: '<p>旧正文</p>', new: '<p>新正文</p>' },
    entityPayload: { title: '第一章', content: '大段结构化内容' },
    status: 'pending',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z'
  }
}

test('暂存摘要截断差异并移除正文与结构化载荷', () => {
  const response = toStageResponse(makeChange())

  assert.equal(response.detailLoaded, false)
  assert.equal(response.before.length, 1201)
  assert.equal(response.after.length, 1201)
  assert.equal(response.before.endsWith('…'), true)
  assert.equal('chapterHtml' in response, false)
  assert.equal('entityPayload' in response, false)
})

test('按需详情保留完整暂存内容', () => {
  const change = makeChange()
  const response = toStageResponse(change, true)

  assert.equal(response.detailLoaded, true)
  assert.equal(response.before, change.before)
  assert.deepEqual(response.chapterHtml, change.chapterHtml)
  assert.deepEqual(response.entityPayload, change.entityPayload)
})

test('不存在的暂存项返回 null', () => {
  assert.equal(toStageResponse(null, true), null)
})
