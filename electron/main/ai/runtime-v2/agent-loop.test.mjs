import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'

// 与打包器一致地解析运行时代码中的别名和省略扩展名的导入。
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
const { AgentLoopCore } = await import('./agent-loop-core.ts')
import { createEvidenceLedger, wrapToolsWithRuntimeBudget } from './evidence-ledger.ts'
const { createRuntimePlan } = await import('./planner.ts')
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

test('技能请求作者选择后持久化检查点，阻止后续写入且不触发补生成', async () => {
  let writes = 0
  let runs = 0
  const { loop, conversation } = makeLoop(async (params) => {
    runs++
    const ask = params.tools.find((tool) => tool.definition.name === 'skill_ask_user')
    const progress = params.tools.find((tool) => tool.definition.name === 'skill_workflow')
    await progress.handler({ skill_id: 'story-long-write', step_id: 'topic', title: '确认选题', status: 'running' }, params.ctx)
    await ask.handler({ skill_id: 'story-long-write', step: '确认选题', questions: [{
      id: 'genre', question: '想写哪一种题材？', options: [{ label: '玄幻', description: '成长冒险' }, { label: '都市', description: '日常故事' }]
    }] }, params.ctx)
    assert.equal(params.shouldStop(), true)
    const blocked = await params.tools.find((tool) => tool.definition.name === 'stage_test').handler({}, params.ctx)
    assert.equal(blocked.isError, true)
    return { finalText: '已生成待审阅的修改。', toolCalls: [], iterations: 1 }
  })
  const options = makeOptions(new AbortController().signal)
  options.skillPlan = { mode: 'only', items: [{ id: 'story-long-write', name: '长篇写作', state: 'injected' }] }
  options.tools = [
    { definition: { name: 'skill_load' }, handler: async () => ({ content: '技能正文' }) },
    { definition: { name: 'stage_test' }, handler: async () => { writes++; return { content: '已写入' } } }
  ]
  const result = await loop.run(options)
  assert.equal(result.status, 'done')
  assert.equal(result.waitingForUser, true)
  assert.match(result.finalText, /流程已暂停/)
  assert.equal(writes, 0)
  assert.equal(runs, 1)
  const checkpoint = conversation.persistedEvents.find((event) => event.kind === 'user_input_requested')
  assert.equal(checkpoint.request.goal, '测试请求')
  assert.equal(checkpoint.request.questions[0].options.length, 2)
  assert.equal(conversation.persistedEvents.at(-1).kind, 'done')
})

test('没有技能权限的场景不注入技能交互工具', async () => {
  const { loop } = makeLoop(async (params) => {
    assert.ok(!params.tools.some((tool) => tool.definition.name === 'skill_ask_user'))
    return { finalText: '普通回复', toolCalls: [], iterations: 1 }
  })
  await loop.run(makeOptions(new AbortController().signal))
})

function makeLoop(runAgentImpl) {
  const conversation = makeConversation()
  const pushedEvents = []
  const staged = new StagedChangesStore()
  const loop = new AgentLoopCore(
    conversation,
    staged,
    (event) => pushedEvents.push(event),
    runAgentImpl,
    () => false
  )
  return { loop, conversation, pushedEvents, staged }
}

function stagedDraft(turnId = 'turn-1') {
  return {
    sessionId: 'session-1', turnId, kind: 'worldview', action: 'create',
    entityTitle: '雨城', reason: '按用户要求录入设定', before: '', after: '终年多雨。'
  }
}

function withStageTool(options, staged) {
  options.tools = [{
    definition: { name: 'stage_worldview', description: '暂存设定', inputSchema: { type: 'object', properties: {} } },
    handler: async () => {
      const change = staged.add(stagedDraft())
      return { content: `change_id=${change.id}` }
    }
  }]
  return options
}

test('声称已暂存但无实际记录时，同一轮自动补生成并核验真实暂存', async () => {
  let calls = 0
  const { loop, staged, conversation, pushedEvents } = makeLoop(async (params) => {
    calls++
    if (calls === 1) return { finalText: '已生成待审阅的世界观变更。', toolCalls: [], iterations: 2, usage: { totalTokens: 20 } }
    assert.match(params.systemPrompt, /本轮实际没有任何暂存记录/)
    assert.match(params.userPrompt, /上一轮答复/)
    await params.tools[0].handler({}, params.ctx)
    return { finalText: '已暂存雨城设定，供你审阅。', toolCalls: [], iterations: 1, usage: { totalTokens: 10 } }
  })
  // 旧轮次的记录不能冒充本轮产出。
  staged.add(stagedDraft('old-turn'))
  const result = await loop.run(withStageTool(makeOptions(new AbortController().signal), staged))
  assert.equal(result.status, 'done')
  assert.equal(calls, 2)
  assert.equal(conversation.createdTurns.length, 1)
  assert.equal(staged.list({ turnId: 'turn-1' }, 'session-1').length, 1)
  assert.equal(result.usage.totalTokens, 30)
  assert.equal(result.agentIterations, 3)
  assert.match(result.finalText, /暂存核验/)
  assert.ok(pushedEvents.some(({ event }) => event.kind === 'staged_change'))
})

test('补生成仍虚报成功时最多重试一次，并以错误结束', async () => {
  let calls = 0
  const { loop, staged, pushedEvents } = makeLoop(async () => {
    calls++
    return { finalText: '已生成暂存变更。', toolCalls: [], iterations: 1 }
  })
  const result = await loop.run(withStageTool(makeOptions(new AbortController().signal), staged))
  assert.equal(calls, 2)
  assert.equal(result.status, 'error')
  assert.match(result.error, /未生成任何暂存变更/)
  assert.equal(pushedEvents.at(-1).event.kind, 'error')
  assert.ok(!pushedEvents.some(({ event }) => event.kind === 'done'))
})

test('已经实际产出暂存或用户刚删除的提案不会重复生成', async () => {
  for (const rejected of [false, true]) {
    let calls = 0
    const { loop, staged } = makeLoop(async (params) => {
      calls++
      await params.tools[0].handler({}, params.ctx)
      if (rejected) staged.reject(staged.list({}, 'session-1').map((change) => change.id))
      return { finalText: '已生成暂存变更。', toolCalls: [], iterations: 1 }
    })
    const result = await loop.run(withStageTool(makeOptions(new AbortController().signal), staged))
    assert.equal(result.status, 'done')
    assert.equal(calls, 1)
    assert.equal(staged.list().length, 1)
  }
})

test('讨论、待澄清和明确说明未暂存的回复不会触发自动写操作', async () => {
  for (const finalText of ['建议增强人物的动机，你希望怎么调整？', '我会生成暂存变更，请先明确方向。', '尚未生成暂存变更，目标章节不存在。']) {
    let calls = 0
    const { loop, staged } = makeLoop(async () => {
      calls++
      return { finalText, toolCalls: [], iterations: 1 }
    })
    const result = await loop.run(withStageTool(makeOptions(new AbortController().signal), staged))
    assert.equal(result.status, 'done')
    assert.equal(calls, 1)
    assert.equal(staged.list().length, 0)
  }
})

test('补生成可纠正成功声明并如实说明受阻，无需强制生成内容', async () => {
  let calls = 0
  const { loop, staged } = makeLoop(async () => ({
    finalText: ++calls === 1 ? '已生成待审阅的修改。' : '尚未生成暂存内容，找不到目标章节，请指定章节。',
    toolCalls: [], iterations: 1
  }))
  const result = await loop.run(withStageTool(makeOptions(new AbortController().signal), staged))
  assert.equal(calls, 2)
  assert.equal(result.status, 'done')
  assert.match(result.finalText, /尚未生成暂存内容/)
  assert.equal(staged.list().length, 0)
})

test('取消自动补生成后不继续重试，也不发送完成事件', async () => {
  const controller = new AbortController()
  let calls = 0
  const { loop, staged, pushedEvents } = makeLoop(async () => {
    calls++
    if (calls === 2) controller.abort()
    return { finalText: '已生成暂存变更。', toolCalls: [], iterations: 1 }
  })
  const result = await loop.run(withStageTool(makeOptions(controller.signal), staged))
  assert.equal(calls, 2)
  assert.equal(result.status, 'canceled')
  assert.ok(!pushedEvents.some(({ event }) => event.kind === 'done'))
})

test('没有暂存工具的场景不会放行虚假的暂存成功声明', async () => {
  const { loop } = makeLoop(async () => ({ finalText: '已生成暂存变更。', toolCalls: [], iterations: 1 }))
  const result = await loop.run(makeOptions(new AbortController().signal))
  assert.equal(result.status, 'error')
  assert.match(result.error, /没有可用的暂存工具/)
})

test('补生成保留实际读取证据、用户附件和两次工具调用记录', async () => {
  let calls = 0
  const { loop, staged } = makeLoop(async (params) => {
    calls++
    assert.match(params.userPrompt, /原始创作要求/)
    assert.equal(params.imageAttachments.length, 1)
    const tool = params.tools[calls === 1 ? 1 : 0]
    const toolUseId = `tool-${calls}`
    if (calls === 2) assert.match(params.userPrompt, /verified-chapter-id/)
    params.handlers.onToolUseStart(toolUseId, tool.definition.name, {})
    const output = await tool.handler({}, params.ctx)
    params.handlers.onToolResult(toolUseId, tool.definition.name, output.content, false, 3)
    return {
      finalText: '已生成暂存变更。',
      // runAgent 同时返回汇总，不能与 handlers 记录重复。
      toolCalls: [{ tool: tool.definition.name, args: {}, durationMs: 3, status: 'ok' }],
      iterations: 1
    }
  })
  const options = withStageTool(makeOptions(new AbortController().signal), staged)
  options.turnInput.userMessage = '原始创作要求'
  options.turnInput.attachments = normalizeTurnAttachments([{
    kind: 'image', ref: 'image:test', label: '参考图.png', mimeType: 'image/png', size: 3,
    dataUrl: 'data:image/png;base64,AQID'
  }])
  options.tools.push({
    definition: { name: 'read_chapter', description: '读章节', inputSchema: { type: 'object', properties: {} } },
    handler: async () => ({ content: 'chapter_id=verified-chapter-id，正文：雨落在城门前。' })
  })
  const result = await loop.run(options)
  assert.equal(result.status, 'done')
  assert.deepEqual(result.toolCalls.map((call) => call.tool), ['read_chapter', 'stage_worldview'])
})

test('补生成返回空回复时不会被上一段成功声明掩盖', async () => {
  let calls = 0
  const { loop, staged } = makeLoop(async () => ({
    finalText: ++calls === 1 ? '已生成暂存变更。' : '', toolCalls: [], iterations: 1
  }))
  const result = await loop.run(withStageTool(makeOptions(new AbortController().signal), staged))
  assert.equal(calls, 2)
  assert.equal(result.status, 'error')
  assert.match(result.error, /补生成未返回可见回复/)
})

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

test('章节助手默认可连续读取和搜索，超过旧版四次读取与两次搜索限制', async () => {
  const surface = { id: 'chapter-panel', scope: 'chapter', autoCommit: false, maxSteps: 6 }
  const plan = createRuntimePlan({ surface, request: { surface, userMessage: '润色当前章节' } })
  const ledger = createEvidenceLedger()
  const tools = wrapToolsWithRuntimeBudget(['read_chapter', 'search_project'].map((name) => ({
    definition: { name },
    handler: async () => ({ content: 'ok' })
  })), plan, ledger)
  for (let index = 0; index < 12; index += 1) {
    for (const tool of tools) assert.equal((await tool.handler({}, {})).content, 'ok')
  }
  assert.equal(ledger.snapshot().readCalls, 12)
  assert.equal(ledger.snapshot().searchCalls, 12)
  assert.equal(ledger.snapshot().budgetExhausted, false)
  assert.match(plan.guidance, /同一轮一起调用/)
})

for (const scope of ['project', 'chapter', 'selection']) {
  test(`${scope} 场景遵守自定义读取和搜索上限，二者独立计数`, async () => {
    const surface = { id: 'global-page', scope, autoCommit: false, maxSteps: 8 }
    const plan = createRuntimePlan({
      surface,
      request: { surface, userMessage: '分析已有资料' },
      settings: { assistantMaxSteps: 28, assistantMaxReadToolCalls: 6, assistantMaxSearchToolCalls: 3 }
    })
    const ledger = createEvidenceLedger()
    const calls = { read_project_data: 0, search_project: 0 }
    const [read, search] = wrapToolsWithRuntimeBudget(Object.keys(calls).map((name) => ({
      definition: { name },
      handler: async () => { calls[name] += 1; return { content: 'ok' } }
    })), plan, ledger)
    for (let index = 0; index < 6; index += 1) assert.equal((await read.handler({}, {})).content, 'ok')
    assert.match((await read.handler({}, {})).content, /读取次数已达上限（6 次）/)
    for (let index = 0; index < 3; index += 1) assert.equal((await search.handler({}, {})).content, 'ok')
    assert.match((await search.handler({}, {})).content, /搜索次数已达上限（3 次）/)
    assert.deepEqual(calls, { read_project_data: 6, search_project: 3 })
    assert.equal(ledger.snapshot().budgetExhausted, true)
    assert.match(plan.guidance, /最多运行 28 轮/)
  })
}

test('放开读取不会放开章节助手原有的暂存预算', async () => {
  const surface = { id: 'chapter-panel', scope: 'chapter', autoCommit: false, maxSteps: 6 }
  const plan = createRuntimePlan({ surface, request: { surface, userMessage: '润色当前章节' } })
  const ledger = createEvidenceLedger()
  let calls = 0
  const [stage] = wrapToolsWithRuntimeBudget([{
    definition: { name: 'stage_chapter_edit' },
    handler: async () => { calls += 1; return { content: 'ok' } }
  }], plan, ledger)
  for (let index = 0; index < plan.maxStageChanges; index += 1) assert.equal((await stage.handler({}, {})).content, 'ok')
  assert.match((await stage.handler({}, {})).content, /暂存变更数量已达上限/)
  assert.equal(calls, plan.maxStageChanges)
})

test('搜索保留明确请求的结果数量，避免被固定压到三条后反复请求', async () => {
  const surface = { id: 'global-page', scope: 'project', autoCommit: false, maxSteps: 8 }
  const plan = createRuntimePlan({ surface, request: { surface, userMessage: '查找相关设定' } })
  const received = []
  const [tool] = wrapToolsWithRuntimeBudget([{
    definition: { name: 'search_project' },
    handler: async (args) => { received.push(args); return { content: 'ok' } }
  }], plan, createEvidenceLedger())
  await tool.handler({ query: '主角', max_results: 12 }, {})
  await tool.handler({ query: '主角' }, {})
  assert.equal(received[0].max_results, 12)
  assert.equal(received[1].max_results, plan.defaultReadLimit)
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

test('断流时保留已输出的正文并以错误状态落盘', async () => {
  const { loop, conversation, pushedEvents } = makeLoop(async ({ handlers }) => {
    handlers.onTextDelta('已完成第一部分')
    handlers.onTextDelta('，第二部分尚未完成。')
    throw new Error('连接中断')
  })
  const result = await loop.run(makeOptions(new AbortController().signal))
  assert.equal(result.status, 'error')
  assert.equal(result.finalText, '已完成第一部分，第二部分尚未完成。')
  assert.equal(conversation.statusUpdates.at(-1).finalText, result.finalText)
  assert.equal(pushedEvents.at(-1).event.kind, 'error')
})

test('取消时连尚未刷出的正文也保留，且忽略取消后的迟到增量', async () => {
  const controller = new AbortController()
  const { loop, conversation, pushedEvents } = makeLoop(async ({ handlers }) => {
    handlers.onTextDelta('取消前已收到的正文')
    controller.abort()
    handlers.onTextDelta('取消后的迟到内容')
    throw new Error('aborted')
  })
  const result = await loop.run(makeOptions(controller.signal))
  assert.equal(result.status, 'canceled')
  assert.equal(result.finalText, '取消前已收到的正文')
  assert.equal(conversation.statusUpdates.at(-1).finalText, result.finalText)
  assert.equal(pushedEvents.at(-1).event.content, result.finalText)
})

test('取消通道提前收口后补齐最终正文，不把轮次恢复为完成', async () => {
  const controller = new AbortController()
  const { loop, conversation, pushedEvents } = makeLoop(async ({ handlers }) => {
    handlers.onTextDelta('取消前已收到的正文')
    conversation.updateTurnStatus('turn-1', 'canceled', '')
    controller.abort()
    throw new Error('aborted')
  })
  const result = await loop.run(makeOptions(controller.signal))
  assert.equal(result.status, 'canceled')
  assert.equal(conversation.statusUpdates.at(-1).finalText, '取消前已收到的正文')
  assert.equal(pushedEvents.at(-1).event.kind, 'canceled')
  assert.equal(pushedEvents.at(-1).event.content, result.finalText)
  assert.equal(pushedEvents.some(({ event }) => event.kind === 'done'), false)
})
