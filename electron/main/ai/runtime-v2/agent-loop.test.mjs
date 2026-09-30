import assert from 'node:assert/strict'
import test from 'node:test'

import { AgentLoopCore } from './agent-loop-core.ts'
import { createEvidenceLedger, wrapToolsWithRuntimeBudget } from './evidence-ledger.ts'
import { createRuntimePlan } from './planner.ts'
import { StagedChangesStore } from './staged-changes-store.ts'
import { normalizeTurnAttachments } from '../../../shared/assistant-runtime.ts'

function makeConversation() {
  const persistedEvents = []
  const statusUpdates = []
  const createdTurns = []
  let status = 'streaming'
  return {
    persistedEvents,
    statusUpdates,
    createdTurns,
    createTurn({ sessionId, userMessage, attachments }) {
      createdTurns.push({ sessionId, userMessage, attachments })
      return { id: 'turn-1', sessionId, userMessage, attachments }
    },
    appendEvent(turnId, event) {
      const persisted = { ...event, turnId, seq: persistedEvents.length + 1 }
      persistedEvents.push(persisted)
      return persisted
    },
    getTurn() {
      return { status }
    },
    updateTurnStatus(turnId, nextStatus, finalText) {
      statusUpdates.push({ turnId, status: nextStatus, finalText })
      status = nextStatus
    }
  }
}

test('图片附件经过校验后传给 Agent，并随原始消息持久化', async () => {
  const image = normalizeTurnAttachments([{
    kind: 'image',
    ref: 'image:test',
    label: '人物参考.png',
    mimeType: 'image/png',
    size: 3,
    dataUrl: 'data:image/png;base64,AQID'
  }])[0]
  let receivedImages = []
  const { loop, conversation } = makeLoop(async (params) => {
    receivedImages = params.imageAttachments
    return {
      finalText: '已识别图片。',
      toolCalls: [],
      iterations: 1
    }
  })
  const options = makeOptions(new AbortController().signal)
  options.turnInput.attachments = [image]

  const result = await loop.run(options)

  assert.equal(result.status, 'done')
  assert.equal(receivedImages.length, 1)
  assert.equal(receivedImages[0].label, '人物参考.png')
  assert.equal(conversation.createdTurns[0].userMessage, '测试请求')
  assert.deepEqual(conversation.createdTurns[0].attachments, [image])
})

test('图片附件拒绝不支持的格式', () => {
  assert.throws(() => normalizeTurnAttachments([{
    kind: 'image',
    ref: 'image:svg',
    label: 'unsafe.svg',
    mimeType: 'image/svg+xml',
    size: 10,
    dataUrl: 'data:image/svg+xml;base64,PHN2Zz4='
  }]), /仅支持 PNG、JPEG、WebP 和 GIF/)
})

test('文本附件随轮次持久化并加入模型提示', async () => {
  const document = normalizeTurnAttachments([{
    kind: 'document',
    ref: 'document:test',
    label: '背景.txt',
    mimeType: 'text/plain',
    size: 12,
    content: '故事发生在雨城。'
  }])[0]
  let receivedPrompt = ''
  const { loop, conversation } = makeLoop(async (params) => {
    receivedPrompt = params.userPrompt
    return { finalText: '已读取文档。', toolCalls: [], iterations: 1 }
  })
  const options = makeOptions(new AbortController().signal)
  options.turnInput.attachments = [document]

  const result = await loop.run(options)

  assert.equal(result.status, 'done')
  assert.deepEqual(conversation.createdTurns[0].attachments, [document])
  assert.match(receivedPrompt, /背景\.txt/)
  assert.match(receivedPrompt, /故事发生在雨城/)
})

function makeOptions(signal) {
  return {
    session: { id: 'session-1', projectId: 'project-1' },
    surface: {
      id: 'global-assistant',
      scope: 'project',
      autoCommit: false,
      maxSteps: 8
    },
    turnInput: { userMessage: '测试请求' },
    systemPrompt: '系统提示',
    tools: [],
    settings: {},
    signal
  }
}

function makeLoop(runAgentImpl) {
  const conversation = makeConversation()
  const pushedEvents = []
  const loop = new AgentLoopCore(
    conversation,
    new StagedChangesStore(),
    (event) => pushedEvents.push(event),
    runAgentImpl,
    () => false
  )
  return { loop, conversation, pushedEvents }
}

test('项目级全局助手不设置工具次数预算或自动续批', async () => {
  const surface = {
    id: 'global-page',
    scope: 'project',
    autoCommit: false,
    maxSteps: 8
  }
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '请完整审计整个项目的所有设定'
    }
  })
  const ledger = createEvidenceLedger()
  const [tool] = wrapToolsWithRuntimeBudget([{
    definition: { name: 'read_project_data' },
    handler: async () => ({ content: 'ok' })
  }], plan, ledger)

  for (let index = 0; index < 10; index += 1) {
    assert.equal((await tool.handler({}, {})).content, 'ok')
  }

  assert.equal(plan.enforceToolBudgets, false)
  assert.equal(plan.requiresBatching, false)
  assert.doesNotMatch(plan.guidance, /每批读取预算有限/)
  assert.equal(ledger.snapshot().readCalls, 10)
  assert.equal(ledger.snapshot().budgetExhausted, false)
})

test('项目级全局助手允许完整读取章节正文', async () => {
  const surface = {
    id: 'global-page',
    scope: 'project',
    autoCommit: false,
    maxSteps: 8
  }
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '请分析第三章后半部分'
    }
  })
  const ledger = createEvidenceLedger()
  let receivedArgs = null
  const [tool] = wrapToolsWithRuntimeBudget([{
    definition: { name: 'read_chapter' },
    handler: async (input) => {
      receivedArgs = input
      return { content: 'ok' }
    }
  }], plan, ledger)

  await tool.handler({ chapter_id: 'chapter-1' }, {})

  assert.equal(plan.allowFullChapterRead, true)
  assert.notEqual(receivedArgs.include_content, false)
})

test('项目级全局助手对目标章节的 read_project_data 不强制降级为预览', async () => {
  const surface = {
    id: 'global-page',
    scope: 'project',
    autoCommit: false,
    maxSteps: 8
  }
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '请分析第三章后半部分'
    }
  })
  const ledger = createEvidenceLedger()
  let receivedArgs = null
  const [tool] = wrapToolsWithRuntimeBudget([{
    definition: { name: 'read_project_data' },
    handler: async (input) => {
      receivedArgs = input
      return { content: 'ok' }
    }
  }], plan, ledger)

  await tool.handler({ entity_type: 'chapters', entity_id: 'chapter-1' }, {})

  assert.equal(receivedArgs.summary_only, undefined)
})

test('模型没有最终可见文本时将 turn 标记为 error', async () => {
  const { loop, conversation, pushedEvents } = makeLoop(async () => ({
    finalText: '   ',
    toolCalls: [],
    iterations: 2,
    usage: { totalTokens: 42 }
  }))

  const result = await loop.run(makeOptions(new AbortController().signal))

  assert.equal(result.status, 'error')
  assert.match(result.error, /模型未产出可见回复/)
  assert.equal(pushedEvents.at(-1).event.kind, 'error')
  assert.match(pushedEvents.at(-1).event.error, /iterations=2/)
  assert.deepEqual(conversation.statusUpdates, [{
    turnId: 'turn-1',
    status: 'error',
    finalText: '   '
  }])
})

test('工具失败同时写入事件和 toolCalls 结果', async () => {
  const { loop, conversation, pushedEvents } = makeLoop(async (params) => {
    params.handlers.onToolUseStart('tool-use-1', 'read_chapter', { chapterId: 'chapter-1' })
    params.handlers.onToolResult(
      'tool-use-1',
      'read_chapter',
      '章节不存在',
      true,
      17
    )
    return {
      finalText: '读取章节失败，请检查目标章节。',
      toolCalls: [],
      iterations: 1
    }
  })

  const result = await loop.run(makeOptions(new AbortController().signal))

  assert.equal(result.status, 'done')
  assert.deepEqual(result.toolCalls, [{
    tool: 'read_chapter',
    args: { chapterId: 'chapter-1' },
    durationMs: 17,
    status: 'error',
    error: '章节不存在'
  }])
  assert.deepEqual(
    pushedEvents.map((event) => event.event.kind),
    ['tool_use_start', 'tool_result', 'done']
  )
  assert.equal(pushedEvents[1].event.isError, true)
  assert.equal(conversation.statusUpdates[0].status, 'done')
})

test('连续文本增量合并后再落盘和推送', async () => {
  const { loop, conversation, pushedEvents } = makeLoop(async (params) => {
    params.handlers.onTextDelta('第一段')
    params.handlers.onTextDelta('，第二段')
    return {
      finalText: '第一段，第二段',
      toolCalls: [],
      iterations: 1
    }
  })

  const result = await loop.run(makeOptions(new AbortController().signal))

  assert.equal(result.status, 'done')
  assert.deepEqual(
    pushedEvents.map((event) => event.event.kind),
    ['chunk', 'done']
  )
  assert.equal(pushedEvents[0].event.delta, '第一段，第二段')
  assert.equal(conversation.persistedEvents.length, 2)
})

test('运行被中止时发送 canceled 事件并更新 turn 状态', async () => {
  const controller = new AbortController()
  const { loop, conversation, pushedEvents } = makeLoop(async () => {
    controller.abort()
    throw new Error('aborted')
  })

  const result = await loop.run(makeOptions(controller.signal))

  assert.equal(result.status, 'canceled')
  assert.equal(result.error, undefined)
  assert.equal(pushedEvents.at(-1).event.kind, 'canceled')
  assert.deepEqual(conversation.statusUpdates, [{
    turnId: 'turn-1',
    status: 'canceled',
    finalText: ''
  }])
})

test('模型在取消后迟到的成功结果不会把 turn 改回完成', async () => {
  const controller = new AbortController()
  const { loop, conversation, pushedEvents } = makeLoop(async (params) => {
    controller.abort()
    params.handlers.onTextDelta('取消后的迟到内容')
    return {
      finalText: '取消后的迟到回复',
      toolCalls: [],
      iterations: 1
    }
  })

  const result = await loop.run(makeOptions(controller.signal))

  assert.equal(result.status, 'canceled')
  assert.deepEqual(pushedEvents.map((event) => event.event.kind), ['canceled'])
  assert.deepEqual(conversation.statusUpdates, [{
    turnId: 'turn-1',
    status: 'canceled',
    finalText: ''
  }])
})
