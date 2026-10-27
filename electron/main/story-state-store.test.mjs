import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { repairStoryStateChapterIndexes } from './story-state-chapter-index.ts'
import { beginBackfillChapter, initStateBackfillSchema } from './ai/state-backfill-store.ts'

import {
  applyStateDelta,
  buildStoryStateContext,
  formatStoryStateForPrompt,
  getLatestCharacterStates,
  initStoryStateSchema,
  normalizeStateDelta
} from './story-state-store.ts'

function makeChapterIndexDb() {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  initStateBackfillSchema(db)
  db.exec(`
    CREATE TABLE outline_volumes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, sort_order INTEGER NOT NULL);
    INSERT INTO outline_volumes VALUES ('v1', 'p1', 0), ('v2', 'p1', 1), ('other-volume', 'p2', 0);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, volume_id TEXT NOT NULL, sort_order INTEGER NOT NULL);
    INSERT INTO chapters VALUES ('c1', 'p1', 'v1', 1024), ('c2', 'p1', 'v1', 2048),
      ('c3', 'p1', 'v1', 52224), ('other', 'p2', 'other-volume', 7);
  `)
  return db
}

test('历史状态按章节 ID 修复稀疏章号，保留正常索引和未来计划章号', () => {
  const db = makeChapterIndexDb()
  beginBackfillChapter(db, {
    projectId: 'p1', chapterId: 'c2', chapterTitle: '第二章', chapterIndex: 15360, contentHash: 'hash'
  })
  applyStateDelta(db, 'p1', 15360, normalizeStateDelta({
    characters_updated: [{ character_id: '林岚', changes: { mental_state: '警觉' } }],
    relationships_delta: [{ relationship_id: '关系', participants: ['林岚', '顾川'] }],
    foreshadowing_delta: {
      planted: [{ id: '伏笔', type: '暗线', description: '旧信', method: '道具', payoff_chapter: 52224 }],
      advanced: [{ id: '伏笔', clue: '印记', method: '特写' }]
    },
    timeline: { events: ['发现旧信'] }
  }))
  applyStateDelta(db, 'p1', 52224, normalizeStateDelta({
    characters_updated: [{ character_id: '林岚', changes: { mental_state: '释然' } }],
    foreshadowing_delta: { resolved: [{ id: '伏笔', method: '揭示', impact: '解密' }] },
    timeline: { events: ['揭示真相'] }
  }))
  applyStateDelta(db, 'p1', 0, normalizeStateDelta({ timeline: { events: ['开篇'] } }))
  applyStateDelta(db, 'p2', 15360, normalizeStateDelta({ timeline: { events: ['其他项目'] } }))
  db.exec(`
    INSERT INTO story_world_rules (id, project_id, rule_id, rule_content, established_chapter, updated_at)
      VALUES ('rule', 'p1', 'rule', '规则内容', 15360, '2026-01-01');
    INSERT INTO story_countdown_clocks (id, project_id, clock_id, event_description, deadline_chapter, updated_at)
      VALUES ('clock', 'p1', 'clock', '计划事件', 52224, '2026-01-01');
  `)

  repairStoryStateChapterIndexes(db)

  const [character] = getLatestCharacterStates(db, 'p1', ['林岚'])
  assert.equal(character.chapterIndex, 2)
  assert.equal(character.mentalState, '释然')
  assert.deepEqual(db.prepare('SELECT chapter_index FROM story_timeline WHERE project_id = ? ORDER BY chapter_index')
    .all('p1').map((row) => row.chapter_index), [0, 1, 2])
  const foreshadowing = db.prepare('SELECT * FROM story_foreshadowing').get()
  assert.equal(foreshadowing.planted_chapter, 1)
  assert.equal(foreshadowing.resolved_chapter, 2)
  assert.equal(foreshadowing.payoff_chapter, 52224)
  assert.deepEqual(JSON.parse(foreshadowing.clues_json), [{ chapter: 1, clue: '印记', method: '特写' }])
  assert.equal(db.prepare('SELECT last_interaction_chapter AS chapter FROM story_relationships').get().chapter, 1)
  assert.equal(db.prepare('SELECT established_chapter AS chapter FROM story_world_rules').get().chapter, 1)
  assert.equal(db.prepare('SELECT deadline_chapter AS chapter FROM story_countdown_clocks').get().chapter, 52224)
  assert.equal(db.prepare('SELECT chapter_index FROM story_state_backfill_chapters').get().chapter_index, 1)
  assert.equal(db.prepare('SELECT chapter_index FROM story_timeline WHERE project_id = ?').get('p2').chapter_index, 15360)
  const prompt = formatStoryStateForPrompt(buildStoryStateContext(db, 'p1', ['林岚']))
  assert.ok(prompt.includes('第1章: 开篇'))
  assert.ok(prompt.includes('第3章: 揭示真相'))
  assert.ok(prompt.includes('第2章确立'))
  const changes = db.prepare('SELECT total_changes() AS count').get().count
  repairStoryStateChapterIndexes(db)
  assert.equal(db.prepare('SELECT total_changes() AS count').get().count, changes)
  db.close()
})

test('修复旧章号与新状态冲突时保留最新记录，正常的新条目仍为最新角色状态', () => {
  const db = makeChapterIndexDb()
  beginBackfillChapter(db, {
    projectId: 'p1', chapterId: 'c1', chapterTitle: '', chapterIndex: 0, contentHash: 'new-hash'
  })
  for (const chapterIndex of [1024, 0, 2]) {
    applyStateDelta(db, 'p1', chapterIndex, normalizeStateDelta({
      characters_updated: [{ character_id: '林岚', changes: { mental_state: `状态-${chapterIndex}` } }],
      timeline: { events: [`事件-${chapterIndex}`] }
    }))
  }
  for (const table of ['story_character_state', 'story_timeline']) {
    db.exec(`UPDATE ${table} SET updated_at = CASE WHEN chapter_index = 1024 THEN '2026-01-01' ELSE '2026-02-01' END`)
  }

  repairStoryStateChapterIndexes(db)

  assert.equal(db.prepare('SELECT mental_state FROM story_character_state WHERE chapter_index = 0').get().mental_state, '状态-0')
  assert.deepEqual(JSON.parse(db.prepare('SELECT events_json FROM story_timeline WHERE chapter_index = 0').get().events_json), ['事件-0'])
  assert.equal(getLatestCharacterStates(db, 'p1', ['林岚'])[0].chapterIndex, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_character_state').get().count, 2)
  db.close()
})

test('无法唯一关联章节的历史值保持原样，不按 1024 系数猜测章号', () => {
  const db = makeChapterIndexDb()
  for (const chapterId of ['c1', 'c2']) {
    beginBackfillChapter(db, {
      projectId: 'p1', chapterId, chapterTitle: '', chapterIndex: 15360, contentHash: 'hash'
    })
  }
  applyStateDelta(db, 'p1', 15360, normalizeStateDelta({ timeline: { events: ['来源有歧义'] } }))
  applyStateDelta(db, 'p1', 3, normalizeStateDelta({ timeline: { events: ['旧版正常章号'] } }))

  repairStoryStateChapterIndexes(db)

  assert.deepEqual(db.prepare('SELECT chapter_index FROM story_timeline ORDER BY chapter_index')
    .all().map((row) => row.chapter_index), [3, 15360])
  db.close()
})

test('历史章号恢复遵循分卷目录顺序，兼容尚未重新编排的旧排序值', () => {
  const db = makeChapterIndexDb()
  db.exec("UPDATE chapters SET volume_id = 'v2' WHERE id = 'c1'")
  applyStateDelta(db, 'p1', 1024, normalizeStateDelta({ timeline: { events: ['第二卷'] } }))
  applyStateDelta(db, 'p1', 2048, normalizeStateDelta({ timeline: { events: ['第一卷'] } }))

  repairStoryStateChapterIndexes(db)

  assert.deepEqual(db.prepare('SELECT chapter_index, events_json FROM story_timeline ORDER BY chapter_index')
    .all().map((row) => [row.chapter_index, JSON.parse(row.events_json)]), [
    [0, ['第一卷']], [2, ['第二卷']]
  ])
  db.close()
})

test('畸形状态增量会被规范化为可遍历、可绑定的字段', () => {
  const delta = normalizeStateDelta({
    characters_updated: [{
      character_id: '林岚',
      changes: {
        mental_state: { value: '紧张' },
        arc_progression: ['第一阶段'],
        new_knowledge: ['密道', '密道', { value: '无效' }]
      }
    }],
    foreshadowing_delta: {
      planted: null,
      advanced: { id: '伏笔-1', clue: '旧信出现', method: '侧写' },
      resolved: '无'
    },
    timeline: { events: '抵达城门' }
  })

  assert.deepEqual(delta.foreshadowing_delta.advanced, [{ id: '伏笔-1', clue: '旧信出现', method: '侧写' }])
  assert.equal(delta.characters_updated[0].changes.mental_state, undefined)
  assert.deepEqual(delta.characters_updated[0].changes.new_knowledge, ['密道'])
  assert.deepEqual(delta.timeline.events, [])
})

test('同一章节状态增量重复写入不会重复累积数组字段', () => {
  const db = new DatabaseSync(':memory:')
  initStoryStateSchema(db)
  const delta = normalizeStateDelta({
    characters_updated: [{
      character_id: '林岚',
      changes: {
        mental_state: '警觉',
        inventory_delta: { added: ['旧信'], removed: [] },
        new_knowledge: ['密道入口'],
        goals_update: { completed: [], added: ['找到证人'] }
      }
    }],
    relationships_delta: [{
      relationship_id: '林岚-顾川',
      participants: ['林岚', '顾川'],
      status_change: { from: '陌生', to: '合作', pivot_event: '共同脱险' },
      new_tension_points: ['互不信任']
    }],
    foreshadowing_delta: {
      planted: [{ id: '伏笔-1', type: '暗线', description: '旧信', method: '道具', payoff_chapter: 20 }],
      advanced: [{ id: '伏笔-1', clue: '火漆印', method: '特写' }],
      resolved: []
    },
    timeline: { current_story_date: '第三日', events: ['离城'] }
  })

  applyStateDelta(db, 'project-1', 3, delta)
  applyStateDelta(db, 'project-1', 3, delta)

  const character = db.prepare('SELECT knowledge_json, inventory_json, goals_json FROM story_character_state').get()
  const relationship = db.prepare('SELECT tension_points_json FROM story_relationships').get()
  const foreshadowing = db.prepare('SELECT clues_json FROM story_foreshadowing').get()
  assert.deepEqual(JSON.parse(character.knowledge_json), ['密道入口'])
  assert.deepEqual(JSON.parse(character.inventory_json), ['旧信'])
  assert.deepEqual(JSON.parse(character.goals_json), ['找到证人'])
  assert.deepEqual(JSON.parse(relationship.tension_points_json), ['互不信任'])
  assert.deepEqual(JSON.parse(foreshadowing.clues_json), [{ chapter: 3, clue: '火漆印', method: '特写' }])
})
