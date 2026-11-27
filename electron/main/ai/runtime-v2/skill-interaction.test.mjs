import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks, createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import ts from 'typescript'
import * as shared from '../../../shared/assistant-runtime.ts'
import { createSkillInteractionTools, resolveSkillUserInput } from './skill-interaction.ts'

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@shared/')) return nextResolve(new URL(`../../../shared/${specifier.slice(8)}.ts`, import.meta.url).href, context)
  if (specifier.startsWith('.') && context.parentURL && !/\.[cm]?[jt]s$/.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL)
    if (existsSync(candidate)) return nextResolve(candidate.href, context)
  }
  return nextResolve(specifier, context)
} })
const { ConversationManager, initAssistantRuntimeSchema } = await import('./conversation-manager.ts')
const require = createRequire(import.meta.url)

function setup(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT; INSERT INTO projects VALUES ('project-1');")
  initAssistantRuntimeSchema(db)
  const cm = new ConversationManager(db)
  const session = cm.createSession({ projectId: 'project-1', surfaceId: 'global-page', title: '交互测试' })
  const turn = cm.createTurn({ sessionId: session.id, userMessage: '帮我开一本长篇小说' })
  cm.appendEvent(turn.id, { kind: 'skill_plan', seq: 0, mode: 'only', items: [{ id: 'story-long-write', name: '长篇写作', state: 'injected' }] })
  const tools = createSkillInteractionTools({
    goal: turn.userMessage, isSkillAllowed: (id) => id === 'story-long-write',
    onQuestion: (request) => cm.appendEvent(turn.id, { kind: 'user_input_requested', seq: 0, request }),
    onStep: (step) => cm.appendEvent(turn.id, { kind: 'skill_workflow', seq: 0, step })
  })
  return { db, cm, session, turn, ask: tools[0], progress: tools[1] }
}
const questionInput = {
  skill_id: 'story-long-write', step: '确认题材', questions: [{
    id: 'genre', question: '想写哪类故事？', options: [{ label: '玄幻', description: '成长冒险' }, { label: '都市', description: '现实生活' }]
  }]
}
function getRequest(cm, turnId) {
  return cm.listEvents(turnId).map((event) => JSON.parse(event.payloadJson)).find((event) => event.kind === 'user_input_requested').request
}

test('数据库回放恢复问题、选项和步骤；用户回答恢复目标与原技能策略', async (t) => {
  const { db, cm, session, turn, ask, progress } = setup(t)
  await progress.handler({ skill_id: 'story-long-write', step_id: 'genre', title: '确认题材', status: 'running' })
  await ask.handler(questionInput)
  cm.updateTurnStatus(turn.id, 'done', '等待选择')
  const reloaded = new ConversationManager(db)
  const request = getRequest(reloaded, turn.id)
  assert.equal(request.questions[0].options.length, 2)
  const resumed = resolveSkillUserInput(reloaded, session.id, { turnId: turn.id, requestId: request.id, answers: { genre: '玄幻' } })
  assert.match(resumed.context, /帮我开一本长篇小说/)
  assert.match(resumed.context, /用户回答：玄幻/)
  assert.equal(resumed.steps[0].status, 'running')
  assert.deepEqual(resumed.skillPolicy, { mode: 'only', skillIds: ['story-long-write'] })
})

test('跨会话、缺答、过期、重复回答和未授权技能均不会推进流程', async (t) => {
  const { cm, session, turn, ask } = setup(t)
  await ask.handler(questionInput)
  cm.updateTurnStatus(turn.id, 'done', '等待选择')
  const request = getRequest(cm, turn.id)
  const answer = { turnId: turn.id, requestId: request.id, answers: { genre: '玄幻' } }
  assert.throws(() => resolveSkillUserInput(cm, 'other-session', answer), /不属于/)
  assert.throws(() => resolveSkillUserInput(cm, session.id, { ...answer, requestId: 'stale' }), /过期/)
  assert.throws(() => resolveSkillUserInput(cm, session.id, { ...answer, answers: {} }), /回答.*不能为空/)
  await assert.rejects(ask.handler({ ...questionInput, skill_id: 'other-skill' }), /不在本轮/)
  await assert.rejects(ask.handler({ ...questionInput, questions: [] }), /1–4/)
  cm.appendEvent(turn.id, { kind: 'user_input_answered', seq: 0, requestId: request.id, answers: answer.answers, responseTurnId: 'next-turn' })
  assert.throws(() => resolveSkillUserInput(cm, session.id, answer), /已经提交/)
})

test('流程第二次暂停后仍保留此前已确认的选择和完成步骤', async (t) => {
  const { cm, session, turn, ask } = setup(t)
  await ask.handler(questionInput)
  cm.updateTurnStatus(turn.id, 'done', '等待选择')
  const request = getRequest(cm, turn.id)
  const first = resolveSkillUserInput(cm, session.id, { turnId: turn.id, requestId: request.id, answers: { genre: '玄幻' } })
  const next = cm.createTurn({ sessionId: session.id, userMessage: '玄幻' })
  cm.appendEvent(next.id, { kind: 'user_input_requested', seq: 0, request: {
    ...request, id: 'question-two', step: '确认视角', decisions: first.decisions,
    steps: [{ skillId: 'story-long-write', id: 'genre', title: '确认题材', status: 'completed' }],
    questions: [{ id: 'pov', question: '采用什么叙述视角？', options: [] }]
  } })
  cm.updateTurnStatus(next.id, 'done', '等待视角')
  const second = resolveSkillUserInput(cm, session.id, { turnId: next.id, requestId: 'question-two', answers: { pov: '第三人称，限制主角视角' } })
  assert.equal(second.decisions.length, 2)
  assert.match(second.context, /用户回答：玄幻/)
  assert.match(second.context, /第三人称，限制主角视角/)
  assert.equal(second.steps[0].status, 'completed')
})

function ipcHarness(cm, db, planGate = async () => {}) {
  const handlers = new Map()
  const pushed = []
  const captured = {}
  class Loop {
    async run(options) {
      captured.loop = options
      const turn = cm.createTurn({ sessionId: options.session.id, userMessage: options.turnInput.userMessage })
      options.onTurnCreated(turn.id)
      cm.updateTurnStatus(turn.id, 'done', '继续流程')
      return { turnId: turn.id, finalText: '继续流程', status: 'done', toolCalls: [], agentIterations: 1 }
    }
  }
  const dependencies = {
    electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } },
    '@shared/assistant-runtime': shared,
    '../runtime/run-meta': { buildRunMeta: () => ({}) },
    './staged-changes-store': { stagedChangesStore: {} },
    './agent-loop': { AgentLoop: Loop },
    './state': { configureRuntimeState() {}, getSharedConversation: async () => cm },
    './commit-result': { finalizeCommitBatch() {} },
    './stage-response': { toStageResponse: (value) => value },
    './skill-interaction': { resolveSkillUserInput }
  }
  const { outputText } = ts.transpileModule(readFileSync(new URL('./ipc.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const exports = {}
  new Function('require', 'exports', outputText)((name) => dependencies[name] ?? require(name), exports)
  exports.registerAssistantIpcHandlers({
    ensureDb: async () => db,
    resolveTurnExecutionPlan: async ({ request }) => {
      captured.request = request
      await planGate()
      return { systemPrompt: '系统提示', tools: [], settings: {},
        runtimePlan: { requiresBatching: false }, evidenceLedger: { snapshot: () => ({ budgetExhausted: false }) },
        skillPlan: { mode: 'only', items: [{ id: 'story-long-write', name: '长篇写作', state: 'injected' }] }
      }
    }
  })
  return { captured, pushed, send: (payload) => handlers.get(shared.ASSISTANT_IPC_CHANNELS.TURN_SEND)({ sender: { send: (_channel, value) => pushed.push(value) } }, payload) }
}

test('真实提交入口验证回答、恢复原技能上下文并将已答状态推回原卡片', async (t) => {
  const { db, cm, session, turn, ask } = setup(t)
  await ask.handler(questionInput)
  cm.updateTurnStatus(turn.id, 'done', '等待选择')
  const request = getRequest(cm, turn.id)
  const harness = ipcHarness(cm, db)
  const payload = { sessionId: session.id, surface: { id: 'global-page', scope: 'project', maxSteps: 8, autoCommit: false },
    userMessage: '玄幻', skillPolicy: { mode: 'off', skillIds: [] },
    userInputResponse: { turnId: turn.id, requestId: request.id, answers: { genre: '玄幻' } }
  }
  const result = await harness.send(payload)
  assert.equal(result.status, 'done')
  assert.deepEqual(harness.captured.request.skillPolicy, { mode: 'only', skillIds: ['story-long-write'] })
  assert.match(harness.captured.loop.systemPrompt, /帮我开一本长篇小说/)
  assert.match(harness.captured.loop.systemPrompt, /用户回答：玄幻/)
  const answered = harness.pushed.find((event) => event.event.kind === 'user_input_answered')
  assert.equal(answered.turnId, turn.id)
  assert.equal(answered.event.responseTurnId, result.turnId)
  await assert.rejects(harness.send(payload), /已经提交/)
})

test('连续点击同一请求也只允许一个会话任务进入规划', async (t) => {
  const { db, cm, session } = setup(t)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const harness = ipcHarness(cm, db, () => gate)
  const payload = { sessionId: session.id, clientRequestId: 'same-click-id',
    surface: { id: 'global-page', scope: 'project', maxSteps: 8, autoCommit: false }, userMessage: '继续' }
  const running = harness.send(payload)
  await assert.rejects(harness.send(payload), /已有正在执行/)
  release()
  assert.equal((await running).status, 'done')
})
