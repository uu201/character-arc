import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCodexExecArgs, parseCodexJsonLine, resolveCodexCommand } from './codex-cli.ts'
import { normalizeSettings, validateSettings } from './settings.ts'
import { getAiProviderCatalogEntry, shouldTryStreamingAgent } from '../../shared/ai-provider-catalog.ts'

const codexSettings = {
  provider: 'codex-cli',
  model: '',
  apiKey: '',
  baseUrl: '',
  codexCliPath: '',
  codexReasoningEffort: 'default',
  embeddingModel: '',
  imageModel: '',
  imageApiKey: '',
  imageBaseUrl: ''
}

test('Codex CLI 预设不要求 API 地址或 Key，并使用 default 模型', () => {
  const preset = getAiProviderCatalogEntry('codex-cli')
  const normalized = normalizeSettings(codexSettings)

  assert.equal(preset?.transport, 'codex-cli')
  assert.equal(preset?.supportsEmbedding, false)
  assert.equal(normalized.model, 'default')
  assert.equal(normalized.baseUrl, '')
  assert.doesNotThrow(() => validateSettings(normalized))
  assert.equal(shouldTryStreamingAgent('global-assistant', 'codex-cli', 'default'), false)
})

test('Codex exec 使用只读 JSONL 与 stdin，并传递模型和推理强度', () => {
  const args = buildCodexExecArgs({
    ...codexSettings,
    model: 'gpt-5.6-sol',
    codexReasoningEffort: 'high'
  })

  assert.deepEqual(args.slice(0, 6), [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-c'
  ])
  assert.ok(args.includes('features.shell_tool=false'))
  assert.ok(args.includes('model_reasoning_effort="high"'))
  assert.deepEqual(args.slice(-3), ['--model', 'gpt-5.6-sol', '-'])
})

test('Codex exec 将图片路径作为初始提示附件传入', () => {
  const args = buildCodexExecArgs(codexSettings, [
    'C:\\Temp\\scene.png',
    'C:\\Temp\\character.jpg'
  ])

  assert.deepEqual(args.slice(-5), [
    '--image',
    'C:\\Temp\\scene.png',
    '--image',
    'C:\\Temp\\character.jpg',
    '-'
  ])
})

test('Codex CLI 路径拒绝混入 shell 环境变量', () => {
  assert.throws(
    () => resolveCodexCommand({
      ...codexSettings,
      codexCliPath: 'HTTPS_PROXY=http://127.0.0.1:7890 /opt/homebrew/bin/codex'
    }),
    /只能填写可执行文件路径/
  )
})

test('Codex JSONL 事件转换为正文、推理和 token 用量', () => {
  const reasoning = []
  assert.deepEqual(
    parseCodexJsonLine(
      '{"type":"item.completed","item":{"type":"reasoning","text":"分析中"}}',
      { onTextDelta() {}, onReasoningDelta: (delta) => reasoning.push(delta) }
    ),
    {}
  )
  assert.deepEqual(reasoning, ['分析中'])
  assert.deepEqual(
    parseCodexJsonLine('{"type":"item.completed","item":{"type":"agent_message","text":"完成"}}'),
    { text: '完成' }
  )
  assert.deepEqual(
    parseCodexJsonLine('{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":8}}'),
    { usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 } }
  )
})
