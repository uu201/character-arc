import assert from 'node:assert/strict'
import test from 'node:test'
import { claimsStagedChanges } from './staging-outcome.ts'

test('识别常见暂存成功声明，包含生成、放入和已将句式', () => {
  for (const text of [
    '已生成待审阅的修改。', '已经为你成功创建3项暂存内容。',
    '我已暂存这段正文。', '已将本章改稿放入暂存区，请确认。',
    '暂存区已经有这次的变更。', '已完成修改，可在暂存区审阅。', '已生成【未来之城】的暂存变更。'
  ]) assert.equal(claimsStagedChanges(text), true, text)
})

test('建议、将来计划、失败说明和引用示例不会被当作实际暂存声明', () => {
  for (const text of [
    '建议给人物增加动机。', '接下来会生成暂存内容。',
    '尚未生成暂存变更。', '没有生成待审阅的修改。',
    '不能声称已生成暂存变更。', '比如“已生成暂存变更”这样的提示。',
    '如果已生成暂存内容，可以在右侧查看。', '已读取当前章节。'
  ]) assert.equal(claimsStagedChanges(text), false, text)
})
