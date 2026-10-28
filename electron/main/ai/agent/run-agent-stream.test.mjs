import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { formatAiErrorMessage, formatUnknownError, isAiConnectionInterruptedError } from '../error-message.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@shared/')) {
      return nextResolve(new URL(`../../../shared/${specifier.slice(8)}.ts`, import.meta.url).href, context)
    }
    if (specifier.startsWith('.') && context.parentURL && !/\.[cm]?[jt]s$/.test(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(candidate)) return nextResolve(candidate.href, context)
    }
    return nextResolve(specifier, context)
  }
})

const { runAgent } = await import('./run-agent.ts')

function interrupted() {
  return new TypeError('terminated', {
    cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  })
}

function response(parts = [], error) {
  let index = 0
  return new Response(new ReadableStream({
    async pull(controller) {
      if (index < parts.length) {
        const part = parts[index++]
        const data = typeof part === 'string' ? part : JSON.stringify({
          id: 'test-response', model: 'test-model', created: 1, ...part
        })
        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
      } else if (error) {
        // 让已到达的数据先经过 SDK，模拟用户已看到正文后网络才断开。
        await new Promise(resolve => setImmediate(resolve))
        controller.error(error)
      } else {
        controller.close()
      }
    }
  }), { headers: { 'content-type': 'text/event-stream' } })
}

function chunk(delta, finishReason = null) {
  return { choices: [{ index: 0, delta, finish_reason: finishReason }] }
}

function params(overrides = {}) {
  const text = []
  const status = []
  return {
    text,
    status,
    input: {
      settings: {
        provider: 'openai-compatible', model: 'test-model', apiKey: 'test-key',
        baseUrl: 'https://example.invalid/v1', apiProtocol: 'openai-chat'
      },
      systemPrompt: '回答用户的问题。',
      userPrompt: '你好',
      tools: [],
      ctx: { signal: new AbortController().signal, projectId: 'test-project' },
      handlers: {
        onTextDelta: delta => text.push(delta),
        onReasoningDelta() {},
        onToolUseStart() {},
        onToolResult() {},
        onAgentStatus: message => status.push(message)
      },
      ...overrides
    }
  }
}

test('断流错误转换为可读提示，同时保留原始错误供诊断', () => {
  const error = interrupted()
  for (const value of [error, 'terminated', new Error('stream failed', { cause: error }),
    { message: 'stream failed', cause: { code: 'ECONNRESET' } }]) {
    assert.equal(isAiConnectionInterruptedError(value), true)
    assert.match(formatUnknownError(value), /连接.*中断/)
    assert.match(formatAiErrorMessage(value, '调用失败'), /网络、代理或接口服务/)
  }
  assert.equal(error.message, 'terminated')
  assert.equal(error.cause.code, 'UND_ERR_SOCKET')
  assert.equal(formatUnknownError(new Error('模型不存在')), '模型不存在')
  assert.equal(isAiConnectionInterruptedError(new Error('Unauthorized')), false)
  assert.equal(isAiConnectionInterruptedError(new Error('terminated', {
    cause: new DOMException('用户停止', 'AbortError')
  })), false)
})

test('尚无正文和工具调用时，terminated 自动重试一次并返回完整回答', async (t) => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1
    ? response([chunk({ reasoning_content: '正在分析' })], interrupted())
    : response([chunk({ content: '完整回答' }), chunk({}, 'stop'), '[DONE]']))
  const run = params()

  const result = await runAgent(run.input)

  assert.equal(requests, 2)
  assert.equal(result.finalText, '完整回答')
  assert.equal(run.text.join(''), '完整回答')
  assert.equal(run.status.filter(message => message.includes('自动重试')).length, 1)
})

test('连续断流最多重试一次，仍以错误结束', async (t) => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    return response([], interrupted())
  })
  const run = params()

  await assert.rejects(runAgent(run.input), isAiConnectionInterruptedError)
  assert.equal(requests, 2)
  assert.deepEqual(run.text, [])
})

test('已输出部分正文时不自动重试，保留收到的正文', async (t) => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    return response([chunk({ content: '已有正文' })], interrupted())
  })
  const run = params()

  await assert.rejects(runAgent(run.input), isAiConnectionInterruptedError)
  assert.equal(requests, 1)
  assert.equal(run.text.join(''), '已有正文')
  assert.equal(run.status.some(message => message.includes('自动重试')), false)
})

test('工具已经执行后发生断流，不重跑整个 Agent 或重复执行工具', async (t) => {
  let requests = 0
  let toolEffects = 0
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1
    ? response([
        chunk({ tool_calls: [{ index: 0, id: 'call-1', type: 'function',
          function: { name: 'stage_test', arguments: '{}' } }] }),
        chunk({}, 'tool_calls'), '[DONE]'
      ])
    : response([], interrupted()))
  const run = params({ tools: [{
    definition: { name: 'stage_test', description: '暂存测试变更',
      inputSchema: { type: 'object', properties: {} } },
    handler: async () => {
      toolEffects++
      return { content: '已暂存变更' }
    }
  }] })

  await assert.rejects(runAgent(run.input), isAiConnectionInterruptedError)
  assert.equal(toolEffects, 1)
  assert.equal(requests, 2)
  assert.equal(run.status.some(message => message.includes('自动重试')), false)
})

test('用户取消后即使连接中断，也不自动重试', async (t) => {
  let requests = 0
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    controller.abort()
    return response([], interrupted())
  })
  const run = params({ ctx: { signal: controller.signal, projectId: 'test-project' } })

  // SDK 可能以 abort 事件结束流，也可能抛出 AbortError；二者都不得重试。
  await runAgent(run.input).catch(() => {})
  assert.equal(requests, 1)
  assert.equal(run.status.some(message => message.includes('自动重试')), false)
})
