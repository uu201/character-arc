import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

import { AgentMemoryStore } from './agent-memory-store.ts'
import { ControlledMcpStore } from './controlled-mcp-store.ts'
import { ControlledHttpMcpClient, validateControlledMcpUrl } from './controlled-mcp-client.ts'
import { createControlledMemoryTools } from './tools/memory-tools.ts'
import { createRuntimePlan } from './planner.ts'

test('运行规划默认注入当前项目的长期记忆上下文', () => {
  const plan = createRuntimePlan({
    surface: {
      id: 'global-page',
      title: '全局助手',
      scope: 'project',
      allowedTools: []
    },
    request: { userMessage: '继续分析人物弧光' }
  })

  assert.equal(plan.contextProviders.includes('agent-memories'), true)
})

test('长期记忆按项目隔离、去重并允许用户删除和调整重要度', () => {
  const db = new DatabaseSync(':memory:')
  const store = new AgentMemoryStore(db)
  const first = store.create({ projectId: 'p1', content: '主角保持克制', kind: 'preference' })
  const duplicate = store.create({ projectId: 'p1', content: '主角保持克制', kind: 'preference' })
  store.create({ projectId: 'p2', content: '另一项目记忆', kind: 'fact' })

  assert.equal(first.id, duplicate.id)
  assert.deepEqual(store.list('p1').map((item) => item.content), ['主角保持克制'])
  assert.equal(store.setImportance(first.id, 'p1', 9)?.importance, 5)
  assert.equal(store.remove(first.id, 'p2'), false)
  assert.equal(store.remove(first.id, 'p1'), true)
  assert.equal(store.list('p1').length, 0)
  db.close()
})

test('模型只有在用户明确授权时才能写入长期记忆', async () => {
  const db = new DatabaseSync(':memory:')
  const store = new AgentMemoryStore(db)
  const denied = createControlledMemoryTools({
    store,
    projectId: 'p1',
    turnId: 't1',
    userMessage: '帮我分析人物设定'
  })[0]
  const allowed = createControlledMemoryTools({
    store,
    projectId: 'p1',
    turnId: 't2',
    userMessage: '请记住以后不要使用网络热梗'
  })[0]

  assert.equal((await denied.handler({ content: '擅自保存' }, {})).isError, true)
  assert.equal(store.list('p1').length, 0)
  assert.equal((await allowed.handler({ content: '不要使用网络热梗' }, {})).isError, undefined)
  assert.equal(store.list('p1')[0].content, '不要使用网络热梗')
  db.close()
})

test('MCP 配置不向渲染层暴露密钥，并强制使用已发现工具白名单', () => {
  const db = new DatabaseSync(':memory:')
  const store = new ControlledMcpStore(db)
  const server = store.save({
    projectId: 'p1',
    name: '榜单服务',
    url: 'https://example.com/mcp',
    apiKey: 'secret-key'
  })

  assert.equal(server.hasApiKey, true)
  assert.equal('apiKey' in server, false)
  assert.throws(() => store.setEnabled(server.id, 'p1', true), /选择允许的工具/)

  store.recordConnection(server.id, 'p1', [
    { name: 'rank_list', description: '读取榜单' },
    { name: 'book_detail', description: '读取书籍详情' }
  ])
  const allowed = store.setAllowedTools(server.id, 'p1', ['rank_list', 'not-discovered'])
  assert.deepEqual(allowed.allowedTools, ['rank_list'])
  assert.equal(store.setEnabled(server.id, 'p1', true).enabled, true)
  assert.equal(store.getSecret(server.id, 'p1')?.apiKey, 'secret-key')
  assert.equal(store.getSecret(server.id, 'p2'), null)
  db.close()
})

test('受控 MCP 只接受 HTTPS 或本机 HTTP', () => {
  assert.equal(validateControlledMcpUrl('https://example.com/mcp'), 'https://example.com/mcp')
  assert.equal(validateControlledMcpUrl('http://127.0.0.1:3000/mcp'), 'http://127.0.0.1:3000/mcp')
  assert.equal(validateControlledMcpUrl('http://[::1]:3000/mcp'), 'http://[::1]:3000/mcp')
  assert.throws(() => validateControlledMcpUrl('http://example.com/mcp'), /必须使用 HTTPS/)
  assert.throws(() => validateControlledMcpUrl('file:///tmp/mcp'), /必须使用 HTTPS/)
})

test('受控 MCP 不跟随可能绕过 URL 限制的重定向', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(302, { Location: 'http://example.com/mcp' }).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const client = new ControlledHttpMcpClient(`http://127.0.0.1:${address.port}/mcp`)
  try {
    await assert.rejects(() => client.listTools())
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('受控 MCP 客户端完成握手、携带会话 ID 并调用工具', async () => {
  const methods = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw)
    methods.push(payload.method)

    if (payload.method === 'notifications/initialized') {
      response.writeHead(202).end()
      return
    }
    if (payload.method === 'initialize') {
      response.setHeader('Mcp-Session-Id', 'session-test')
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2024-11-05' } }))
      return
    }
    assert.equal(request.headers['mcp-session-id'], 'session-test')
    response.setHeader('Content-Type', 'application/json')
    if (payload.method === 'tools/list') {
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { tools: [{ name: 'rank_list' }] } }))
      return
    }
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: payload.id,
      result: { content: [{ type: 'text', text: '榜单结果' }] }
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const client = new ControlledHttpMcpClient(`http://127.0.0.1:${address.port}/mcp`)
  try {
    assert.deepEqual((await client.listTools()).map((tool) => tool.name), ['rank_list'])
    assert.equal(await client.callTool('rank_list', {}), '榜单结果')
    assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/call'])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('子智能体工具限制任务数、并发和只读材料', () => {
  const source = readFileSync(new URL('./tools/delegate-novel-tools.ts', import.meta.url), 'utf8')
  assert.match(source, /const MAX_TASKS = 3/)
  assert.match(source, /const MAX_CONCURRENCY = 2/)
  assert.match(source, /tasks\.length < 2/)
  assert.match(source, /task\.description && task\.material/)
  assert.match(source, /不能调用工具、不能修改项目、不能形成长期记忆/)
})
