import assert from 'node:assert/strict'
import test from 'node:test'

import { isOpenCodeReasoningChatModel, resolveProviderOptions, resolveSamplingOptions } from './request-options.ts'

const baseSettings = {
  apiKey: 'test-key',
  baseUrl: 'https://example.com/v1',
  temperature: 0.7,
  topP: 0.9
}

test('DeepSeek 状态提取请求不发送 reasoning_effort none', () => {
  assert.equal(resolveProviderOptions({
    ...baseSettings,
    provider: 'deepseek',
    model: 'deepseek-chat'
  }, { disableReasoning: true }), undefined)
})

test('只有官方 OpenAI 推理模型使用 reasoning_effort none', () => {
  assert.deepEqual(resolveProviderOptions({
    ...baseSettings,
    provider: 'openai',
    model: 'gpt-5.2'
  }, { disableReasoning: true }), {
    openai: { reasoningEffort: 'none' }
  })
  assert.equal(resolveProviderOptions({
    ...baseSettings,
    provider: 'openai-compatible',
    model: 'gpt-5.2'
  }, { disableReasoning: true }), undefined)
})

test('OpenCode 已知推理模型的流式请求使用低推理强度', () => {
  const settings = {
    ...baseSettings,
    provider: 'opencode-zen',
    model: 'deepseek-v4-flash-free'
  }
  assert.equal(isOpenCodeReasoningChatModel(settings), true)
  assert.deepEqual(resolveProviderOptions(settings, { preferLowReasoning: true }), {
    openaiCompatible: { reasoningEffort: 'low' }
  })

  assert.equal(isOpenCodeReasoningChatModel({
    ...settings,
    model: 'ling-3.0-flash-free'
  }), false)
})

test('OpenAI Chat 请求携带四项采样参数，其他协议省略 penalty', () => {
  const settings = {
    ...baseSettings,
    provider: 'deepseek',
    model: 'deepseek-chat',
    presencePenalty: 0.4,
    frequencyPenalty: -0.2
  }
  assert.deepEqual(resolveSamplingOptions(settings), {
    temperature: 0.7,
    topP: 0.9,
    presencePenalty: 0.4,
    frequencyPenalty: -0.2
  })
  assert.deepEqual(resolveSamplingOptions({
    ...settings,
    apiProtocol: 'anthropic'
  }), {
    temperature: 0.7,
    topP: 0.9
  })
  assert.deepEqual(resolveSamplingOptions({
    ...settings,
    provider: 'openai',
    apiProtocol: 'openai-responses'
  }), {
    temperature: 0.7,
    topP: 0.9
  })
})
