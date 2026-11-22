import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_ASSISTANT_EXECUTION_SETTINGS, normalizeAssistantExecutionSettings } from './assistant-execution-settings.ts'

test('旧设置默认提供 16 轮，读取和搜索不单独限次', () => {
  assert.deepEqual(normalizeAssistantExecutionSettings(), DEFAULT_ASSISTANT_EXECUTION_SETTINGS)
  assert.deepEqual(normalizeAssistantExecutionSettings(null), DEFAULT_ASSISTANT_EXECUTION_SETTINGS)
})

test('助手执行预算保留合法自定义值和不限次的零值', () => {
  assert.deepEqual(normalizeAssistantExecutionSettings({
    assistantMaxSteps: 32,
    assistantMaxReadToolCalls: 20,
    assistantMaxSearchToolCalls: 0
  }), { assistantMaxSteps: 32, assistantMaxReadToolCalls: 20, assistantMaxSearchToolCalls: 0 })
})

test('助手执行预算限制范围、取整并回退非法值', () => {
  assert.deepEqual(normalizeAssistantExecutionSettings({
    assistantMaxSteps: Infinity,
    assistantMaxReadToolCalls: NaN,
    assistantMaxSearchToolCalls: '10'
  }), DEFAULT_ASSISTANT_EXECUTION_SETTINGS)
  assert.deepEqual(normalizeAssistantExecutionSettings({
    assistantMaxSteps: 999,
    assistantMaxReadToolCalls: -4,
    assistantMaxSearchToolCalls: 999
  }), { assistantMaxSteps: 100, assistantMaxReadToolCalls: 0, assistantMaxSearchToolCalls: 200 })
  assert.deepEqual(normalizeAssistantExecutionSettings({
    assistantMaxSteps: 1,
    assistantMaxReadToolCalls: 12.8,
    assistantMaxSearchToolCalls: 6.2
  }), { assistantMaxSteps: 2, assistantMaxReadToolCalls: 12, assistantMaxSearchToolCalls: 6 })
})
