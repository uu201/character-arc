import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAiProviderCatalogEntry,
  normalizeAiProtocolPreference,
  normalizeAiBaseUrl,
  normalizeAiProviderName,
  resolveAiProviderProtocol,
  shouldTryStreamingAgent
} from '../../shared/ai-provider-catalog.ts'

test('厂商预设会补齐默认地址并保持模型为空', () => {
  const preset = getAiProviderCatalogEntry('deepseek')

  assert.equal(preset?.baseUrl, 'https://api.deepseek.com/v1')
  assert.equal(preset?.model, '')
  assert.equal(preset?.supportsEmbedding, false)
})

test('Atlas Cloud 预设使用 OpenAI Chat 兼容入口', () => {
  const preset = getAiProviderCatalogEntry('atlascloud')

  assert.equal(preset?.baseUrl, 'https://api.atlascloud.ai/v1')
  assert.equal(preset?.model, '')
  assert.equal(preset?.protocol, 'openai-chat')
  assert.equal(preset?.supportsEmbedding, false)
})

test('OpenCode Go 厂商预设使用官方 Go 地址并保持模型为空', () => {
  const preset = getAiProviderCatalogEntry('opencode-go')

  assert.equal(preset?.baseUrl, 'https://opencode.ai/zen/go/v1')
  assert.equal(preset?.model, '')
  assert.equal(preset?.supportsEmbedding, false)
})

test('自定义接口保留明确填写的路径前缀', () => {
  assert.equal(
    normalizeAiBaseUrl('anthropic-compatible', 'https://relay.example.com/anthropic'),
    'https://relay.example.com/anthropic'
  )
})

test('旧版 OpenCode Zen 配置自动迁移为 Zen 厂商和规范地址', () => {
  assert.equal(normalizeAiProviderName('openai-compatible', 'https://opencode.ai/zen'), 'opencode-zen')
  assert.equal(normalizeAiBaseUrl('opencode-zen', 'https://opencode.ai/zen'), 'https://opencode.ai/zen/v1')
})

test('旧版自定义 OpenCode Go 地址自动迁移并剥离具体端点', () => {
  const chatEndpoint = 'https://opencode.ai/zen/go/v1/chat/completions'
  const messagesEndpoint = 'https://opencode.ai/zen/go/v1/messages'

  assert.equal(normalizeAiProviderName('openai-compatible', chatEndpoint), 'opencode-go')
  assert.equal(normalizeAiBaseUrl('openai-compatible', chatEndpoint), 'https://opencode.ai/zen/go/v1')
  assert.equal(normalizeAiBaseUrl('anthropic-compatible', messagesEndpoint), 'https://opencode.ai/zen/go/v1')
  assert.equal(normalizeAiBaseUrl('opencode-go', 'https://opencode.ai/zen/go'), 'https://opencode.ai/zen/go/v1')
})

test('OpenCode Go 地址不会被误识别为 OpenCode Zen', () => {
  assert.equal(normalizeAiProviderName('opencode-zen', 'https://opencode.ai/zen/go/v1'), 'opencode-go')
  assert.equal(normalizeAiProviderName('openai-compatible', 'https://opencode.ai/zen/v1'), 'opencode-zen')
})

test('OpenCode Go 根据官方模型端点选择协议', () => {
  assert.equal(resolveAiProviderProtocol('opencode-go', 'gpt-5.6-luna'), 'openai-responses')
  assert.equal(resolveAiProviderProtocol('opencode-go', 'minimax-m3'), 'anthropic')
  assert.equal(resolveAiProviderProtocol('opencode-go', 'qwen3.8-max'), 'anthropic')
  assert.equal(resolveAiProviderProtocol('opencode-go', 'grok-4.5'), 'openai-chat')
  assert.equal(resolveAiProviderProtocol('opencode-go', 'glm-5.2'), 'openai-chat')
  assert.equal(resolveAiProviderProtocol('opencode-go', 'kimi-k3'), 'openai-chat')
  assert.equal(resolveAiProviderProtocol('opencode-go', 'deepseek-v4-flash'), 'openai-chat')
})

test('OpenCode Zen 根据模型族选择协议', () => {
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'gpt-5.6-sol'), 'openai-responses')
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'grok-4.5'), 'openai-responses')
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'claude-sonnet-4-6'), 'anthropic')
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'qwen3.7-plus'), 'anthropic')
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'deepseek-v4-pro'), 'openai-chat')
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'kimi-k2.6'), 'openai-chat')
})

test('显式协议配置覆盖模型目录推断', () => {
  assert.equal(normalizeAiProtocolPreference('openai-responses'), 'openai-responses')
  assert.equal(normalizeAiProtocolPreference('invalid'), 'auto')
  assert.equal(
    resolveAiProviderProtocol('opencode-zen', 'unknown-future-model', 'anthropic'),
    'anthropic'
  )
  assert.equal(
    resolveAiProviderProtocol('opencode-zen', 'claude-sonnet-4-6', 'openai-chat'),
    'openai-chat'
  )
})

test('OpenCode Chat 全局助手启用工具，章节初稿保持单次生成', () => {
  assert.equal(
    shouldTryStreamingAgent('global-assistant', 'opencode-zen', 'deepseek-v4-flash-free'),
    true
  )
  assert.equal(
    shouldTryStreamingAgent('chapter-first-draft', 'opencode-zen', 'deepseek-v4-flash-free'),
    false
  )
  assert.equal(
    shouldTryStreamingAgent(
      'chapter-first-draft',
      'opencode-zen',
      'deepseek-v4-flash-free',
      'openai-responses'
    ),
    true
  )
  assert.equal(
    shouldTryStreamingAgent('chapter-first-draft', 'opencode-zen', 'gpt-5.6-sol'),
    true
  )
  assert.equal(
    shouldTryStreamingAgent('chapter-first-draft', 'opencode-zen', 'claude-sonnet-4-6'),
    true
  )
  assert.equal(shouldTryStreamingAgent('chapter-memo', 'opencode-zen', 'gpt-5.6-sol'), false)
})
