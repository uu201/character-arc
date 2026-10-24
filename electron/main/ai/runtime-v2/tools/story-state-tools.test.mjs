import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import ts from 'typescript'
import * as management from '../../../story-state-management.ts'
import { applyStateDelta, initStoryStateSchema, normalizeStateDelta, buildStoryStateContext } from '../../../story-state-store.ts'
import { StagedChangesStore } from '../staged-changes-store.ts'
import * as runtimeTypes from '../../../../shared/assistant-runtime.ts'

const require = createRequire(import.meta.url)

// 转译真实模块并注入数据库依赖，避免测试启动 Electron 应用或打开用户数据库。
function loadModule(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const exports = {}
  new Function('require', 'exports', outputText)((name) => dependencies[name] ?? require(name), exports)
  return exports
}

const { makeStoryStateTools } = loadModule('./story-state-tools.ts', {
  '../../../story-state-management': management
})
const { filterToolsBySurface } = loadModule('../permission.ts', { '@shared/assistant-runtime': runtimeTypes })

function setup() {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  db.exec(`CREATE TABLE characters (id TEXT, project_id TEXT, name TEXT);
    CREATE TABLE character_relationships (id TEXT, project_id TEXT);
    CREATE TABLE plot_threads (id TEXT, project_id TEXT);
    INSERT INTO characters VALUES ('林岚', 'project-a', '林岚');
    INSERT INTO character_relationships VALUES ('关系-1', 'project-a');
    INSERT INTO plot_threads VALUES ('伏笔-1', 'project-a');`)
  for (const project of ['project-a', 'project-b']) {
    applyStateDelta(db, project, 1, normalizeStateDelta({
      characters_updated: [{ character_id: '林岚', changes: { mental_state: '警觉' } }],
      relationships_delta: [{ relationship_id: '关系-1', participants: ['林岚', '顾川'], status_change: { to: '合作' } }],
      foreshadowing_delta: { planted: [{ id: '伏笔-1', type: '暗线', description: '旧信的秘密', method: '道具' }] },
      timeline: { events: ['离城'] }
    }))
    applyStateDelta(db, project, 2, normalizeStateDelta({
      characters_updated: [{ character_id: '林岚', changes: { mental_state: '平静' } }],
      foreshadowing_delta: { planted: [{ id: '伏笔-2', type: '道具', description: '密道钥匙', method: '特写' }] }
    }))
    db.prepare(`INSERT INTO story_world_rules (id, project_id, rule_id, rule_content, established_chapter, updated_at)
      VALUES (?, ?, '规则-1', '禁用法术', 1, 'now')`).run(`${project}-rule`, project)
    db.prepare(`INSERT INTO story_countdown_clocks (id, project_id, clock_id, event_description, updated_at)
      VALUES (?, ?, '时钟-1', '城门关闭', 'now')`).run(`${project}-clock`, project)
  }
  const store = new StagedChangesStore()
  const tools = makeStoryStateTools({
    sessionId: 'session-a', turnId: 'turn-a', projectId: 'project-a', stagedStore: store, ensureDb: async () => db
  })
  const { createCommitter } = loadModule('../committer.ts', {
    '../../workspace-store': { ensureWorkspaceDb: async () => db },
    '../../chapter-order': { insertChapterAtVolumeEnd: () => { throw new Error('不应新增章节') } },
    '../../story-state-management': management,
    '../agent/tools/chapter-data-access': { commitChapterEdit: () => { throw new Error('不应修改章节') } }
  })
  const committer = createCommitter({ resolveProjectId: () => 'project-a' })
  return { db, store, tools, read: tools[0], remove: tools[1], committer }
}

test('世界状态读取提供分类、精确 ID 和分页，包含已回收伏笔', async () => {
  const { db, read } = setup()
  db.prepare("UPDATE story_foreshadowing SET status = 'resolved' WHERE project_id = 'project-a' AND foreshadowing_id = '伏笔-1'").run()
  assert.match((await read.handler({})).content, /伏笔（entity_type=foreshadowing）：2/)
  const page = await read.handler({ entity_type: 'foreshadowing', limit: 1 })
  assert.match(page.content, /Next offset: 1/)
  assert.doesNotMatch(page.content, /project-b/)
  const second = await read.handler({ entity_type: 'foreshadowing', limit: 1, offset: 1 })
  assert.doesNotMatch(second.content, /Next offset/)
  const id = db.prepare("SELECT id FROM story_foreshadowing WHERE project_id = 'project-a' AND foreshadowing_id = '伏笔-1'").get().id
  const detail = await read.handler({ entity_type: 'foreshadowing', match_id: id })
  assert.match(detail.content, /旧信的秘密/)
  assert.match(detail.content, /resolved/)
  const characters = await read.handler({ entity_type: 'character_state' })
  assert.match(characters.content, /共 1 条/)
  assert.match(characters.content, /平静/)
  assert.doesNotMatch(characters.content, /警觉/)
  db.close()
})

test('六类世界状态均通过暂存、确认、写回删除，仅影响当前项目和指定类别', async () => {
  for (const type of Object.keys(management.STORY_STATE_ENTITIES)) {
    const { db, read, remove, store, committer } = setup()
    const { rows } = management.listStoryStateRecords(db, 'project-a', type, 0, 30)
    const id = String(rows[0][management.STORY_STATE_ENTITIES[type].key])
    const result = await remove.handler({ entity_type: type, match_id: id, reason: '用户要求删除此知识库条目' })
    assert.equal(result.isError, undefined, type)
    assert.match(result.content, /尚未删除/)
    const [change] = store.list({}, 'session-a')
    assert.equal(change.kind, 'story_state')
    assert.equal(change.action, 'delete')
    assert.equal(change.after, '')
    assert.ok(change.before)
    assert.ok(management.readStoryStateRecords(db, 'project-a', type, id).length > 0)
    assert.deepEqual(await store.commit(committer, { sessionId: 'session-a' }), [])
    store.accept([change.id])
    const [committed] = await store.commit(committer, { sessionId: 'session-a' })
    assert.equal(committed.ok, true, type)
    assert.equal(store.get(change.id).status, 'committed')
    assert.deepEqual(management.readStoryStateRecords(db, 'project-a', type, id), [])
    assert.ok(management.listStoryStateRecords(db, 'project-b', type, 0, 30).total > 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM characters').get().total, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM character_relationships').get().total, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM plot_threads').get().total, 1)
    if (type === 'foreshadowing') {
      assert.equal(management.listStoryStateRecords(db, 'project-a', type, 0, 30).total, 1)
      assert.equal(buildStoryStateContext(db, 'project-a', ['林岚']).activeForeshadowing.length, 1)
    }
    if (type === 'character_state') {
      assert.match(change.before, /警觉/)
      assert.match(change.before, /平静/)
      assert.equal(buildStoryStateContext(db, 'project-a', ['林岚']).characterStates.length, 0)
    }
    assert.equal((await read.handler({ entity_type: type, match_id: id })).isError, true)
    db.close()
  }
})

test('不存在、跨项目、标题和非法类别不会生成删除提案', async () => {
  const { db, remove, store } = setup()
  const otherId = db.prepare("SELECT id FROM story_foreshadowing WHERE project_id = 'project-b'").get().id
  for (const input of [
    { entity_type: 'foreshadowing', match_id: otherId, reason: '删除' },
    { entity_type: 'foreshadowing', match_id: '旧信的秘密', reason: '删除' },
    { entity_type: 'foreshadowing', match_id: 'missing', reason: '删除' },
    { entity_type: 'constructor', match_id: 'x', reason: '删除' },
    { entity_type: 'character_state', match_id: '林岚' }
  ]) assert.equal((await remove.handler(input)).isError, true)
  assert.equal(store.list({}, 'session-a').length, 0)
  db.close()
})

test('拒绝提案不删除数据，暂存后发生变化时写回拒绝删除', async () => {
  const { db, remove, store, committer } = setup()
  await remove.handler({ entity_type: 'character_state', match_id: '林岚', reason: '用户要求' })
  const [rejected] = store.list({}, 'session-a')
  store.reject([rejected.id])
  assert.deepEqual(await store.commit(committer, { sessionId: 'session-a' }), [])
  assert.equal(management.readStoryStateRecords(db, 'project-a', 'character_state', '林岚').length, 2)
  await remove.handler({ entity_type: 'character_state', match_id: '林岚', reason: '用户要求' })
  const change = store.list({}, 'session-a').find((entry) => entry.status === 'pending')
  db.prepare("UPDATE story_character_state SET mental_state = '新状态' WHERE project_id = 'project-a'").run()
  store.accept([change.id])
  const [result] = await store.commit(committer, { sessionId: 'session-a' })
  assert.equal(result.ok, false)
  assert.match(result.error, /暂存后已发生变化/)
  assert.equal(management.readStoryStateRecords(db, 'project-a', 'character_state', '林岚').length, 2)
  db.close()
})

test('删除工具仅提供给全局助手，章节助手保留读取权限', () => {
  const { db, tools } = setup()
  for (const id of ['global-page', 'global-panel']) {
    assert.equal(filterToolsBySurface(tools, { id }).length, 2)
  }
  assert.deepEqual(filterToolsBySurface(tools, { id: 'chapter-panel' }).map((tool) => tool.definition.name), ['read_story_state'])
  assert.deepEqual(filterToolsBySurface(tools, { id: 'inline-selection' }), [])
  db.close()
})
