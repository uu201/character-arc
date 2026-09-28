import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { ConversationManager, initAssistantRuntimeSchema } from './conversation-manager.ts'
import { StagedChangesStore } from './staged-changes-store.ts'

function createDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT;
    INSERT INTO projects (id) VALUES ('project-1');
  `)
  initAssistantRuntimeSchema(db)
  return db
}

test('从中间轮次截断时级联删除后续事件并统计暂存影响', async () => {
  const db = createDatabase()
  const conversation = new ConversationManager(db)
  const changes = new StagedChangesStore()
  changes.configure(db)

  const session = conversation.createSession({
    projectId: 'project-1',
    surfaceId: 'global-page',
    title: '测试会话'
  })
  const first = conversation.createTurn({ sessionId: session.id, userMessage: '第一轮' })
  const second = conversation.createTurn({ sessionId: session.id, userMessage: '第二轮' })
  const third = conversation.createTurn({ sessionId: session.id, userMessage: '第三轮' })
  conversation.appendEvent(second.id, { kind: 'chunk', seq: 0, delta: '第二轮回复' })
  conversation.appendEvent(third.id, { kind: 'chunk', seq: 0, delta: '第三轮回复' })

  const pending = changes.add({
    sessionId: session.id,
    turnId: second.id,
    kind: 'worldview',
    action: 'create',
    entityTitle: '待确认设定',
    reason: '测试',
    before: '',
    after: '内容'
  })
  const committed = changes.add({
    sessionId: session.id,
    turnId: third.id,
    kind: 'character',
    action: 'update',
    entityTitle: '已写回人物',
    reason: '测试',
    before: '旧',
    after: '新'
  })
  changes.accept([committed.id])
  await changes.commit(
    async (change) => ({ changeId: change.id, ok: true, entityId: 'character-1' }),
    { changeIds: [committed.id] }
  )

  const truncated = conversation.truncateFrom(session.id, second.id)
  const staged = changes.clearTurns(truncated.removedTurnIds)

  assert.deepEqual(truncated.removedTurnIds, [second.id, third.id])
  assert.equal(truncated.restoredUserMessage, '第二轮')
  assert.deepEqual(conversation.listTurns(session.id).map((turn) => turn.id), [first.id])
  assert.equal(conversation.listEvents(second.id).length, 0)
  assert.equal(conversation.listEvents(third.id).length, 0)
  assert.deepEqual(staged, { discarded: 1, keptCommitted: 1 })
  assert.equal(changes.get(pending.id), null)
  assert.equal(changes.get(committed.id), null)
})

test('不能用其他会话的轮次作为截断锚点', () => {
  const db = createDatabase()
  const conversation = new ConversationManager(db)
  const a = conversation.createSession({ projectId: 'project-1', surfaceId: 'global-page', title: 'A' })
  const b = conversation.createSession({ projectId: 'project-1', surfaceId: 'global-page', title: 'B' })
  const turn = conversation.createTurn({ sessionId: a.id, userMessage: 'A 的问题' })

  assert.throws(() => conversation.truncateFrom(b.id, turn.id), /找不到要撤回/)
  assert.equal(conversation.listTurns(a.id).length, 1)
})

test('应用重启后会把遗留的生成中轮次恢复为已取消', () => {
  const db = createDatabase()
  const beforeRestart = new ConversationManager(db)
  const session = beforeRestart.createSession({
    projectId: 'project-1',
    surfaceId: 'global-page',
    title: '异常退出会话'
  })
  const interrupted = beforeRestart.createTurn({
    sessionId: session.id,
    userMessage: '生成到一半时退出'
  })
  beforeRestart.appendEvent(interrupted.id, {
    kind: 'chunk',
    seq: 0,
    delta: '已经生成的内容'
  })

  const afterRestart = new ConversationManager(db)
  assert.equal(afterRestart.recoverInterruptedTurns(), 1)
  assert.equal(afterRestart.getTurn(interrupted.id)?.status, 'canceled')
  assert.deepEqual(
    afterRestart.listEvents(interrupted.id).map((event) => event.kind),
    ['chunk', 'canceled']
  )

  assert.equal(afterRestart.recoverInterruptedTurns(), 0)
  assert.equal(afterRestart.listEvents(interrupted.id).length, 2)
})

test('停止生成会幂等收口生成中轮次并保留已有事件', () => {
  const db = createDatabase()
  const conversation = new ConversationManager(db)
  const session = conversation.createSession({
    projectId: 'project-1',
    surfaceId: 'global-page',
    title: '停止生成测试'
  })
  const turn = conversation.createTurn({ sessionId: session.id, userMessage: '请生成内容' })
  conversation.appendEvent(turn.id, { kind: 'chunk', seq: 0, delta: '已有内容' })

  const canceled = conversation.cancelStreamingTurn(turn.id)
  assert.equal(canceled?.kind, 'canceled')
  assert.equal(conversation.getTurn(turn.id)?.status, 'canceled')
  assert.deepEqual(
    conversation.listEvents(turn.id).map((event) => event.kind),
    ['chunk', 'canceled']
  )

  assert.equal(conversation.cancelStreamingTurn(turn.id), null)
  assert.equal(conversation.listEvents(turn.id).length, 2)
})

test('只加载最近指定数量的轮次并保持时间正序', () => {
  const db = createDatabase()
  const conversation = new ConversationManager(db)
  const session = conversation.createSession({
    projectId: 'project-1',
    surfaceId: 'global-page',
    title: '长会话'
  })
  const turns = []
  for (let index = 1; index <= 5; index++) {
    turns.push(conversation.createTurn({ sessionId: session.id, userMessage: `第 ${index} 轮` }))
  }

  assert.deepEqual(
    conversation.listTurns(session.id, 2).map((turn) => turn.userMessage),
    ['第 4 轮', '第 5 轮']
  )
  assert.deepEqual(
    conversation.listTurns(session.id, 2, turns[3].id).map((turn) => turn.userMessage),
    ['第 2 轮', '第 3 轮']
  )
  assert.equal(conversation.hasTurnsBefore(session.id, turns[1].id), true)
  assert.equal(conversation.hasTurnsBefore(session.id, turns[0].id), false)
  assert.equal(conversation.countTurns(session.id), 5)
})

test('按截止时间清理会话并级联删除轮次和事件', () => {
  const db = createDatabase()
  const conversation = new ConversationManager(db)
  const oldSession = conversation.createSession({
    projectId: 'project-1',
    surfaceId: 'global-page',
    title: '旧会话'
  })
  const recentSession = conversation.createSession({
    projectId: 'project-1',
    surfaceId: 'global-page',
    title: '新会话'
  })
  const otherSurface = conversation.createSession({
    projectId: 'project-1',
    surfaceId: 'chapter-panel',
    title: '章节会话'
  })
  const oldTurn = conversation.createTurn({ sessionId: oldSession.id, userMessage: '旧问题' })
  conversation.appendEvent(oldTurn.id, { kind: 'chunk', seq: 0, delta: '旧回答' })
  db.prepare('UPDATE assistant_sessions_v2 SET updated_at = ? WHERE id = ?')
    .run('2025-01-01T00:00:00.000Z', oldSession.id)

  const deleted = conversation.deleteSessionsBefore({
    projectId: 'project-1',
    surfaceId: 'global-page',
    before: '2025-02-01T00:00:00.000Z'
  })

  assert.equal(deleted, 1)
  assert.equal(conversation.getSession(oldSession.id), null)
  assert.equal(conversation.getTurn(oldTurn.id), null)
  assert.equal(conversation.listEvents(oldTurn.id).length, 0)
  assert.ok(conversation.getSession(recentSession.id))
  assert.ok(conversation.getSession(otherSurface.id))
})
