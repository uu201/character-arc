import assert from 'node:assert/strict'
import test from 'node:test'
import { isSkillExplicitlyExcluded, isSkillExplicitlyMentioned, selectSkillCandidates } from './selection-priority.ts'
import { findSkillDefinitionByIdOrName } from './registry-merge.ts'

function entry(id, name, total, required = false) {
  return {
    skill: {
      id,
      name,
      manifest: { required }
    },
    breakdown: { total }
  }
}

const compare = (a, b) => b.breakdown.total - a.breakdown.total

test('点名完整技能 ID，不把短 ID 当作其他技能的前缀', () => {
  const router = entry('story', 'story', 10)
  const writer = entry('story-long-write', '长篇写作', 0)
  assert.equal(isSkillExplicitlyMentioned(router.skill, '使用 /story-long-write'), false)
  assert.equal(isSkillExplicitlyMentioned(writer.skill, '使用 /story-long-write'), true)
  assert.equal(isSkillExplicitlyMentioned(writer.skill, 'Use STORY-LONG-WRITE'), true)
  assert.equal(isSkillExplicitlyMentioned(router.skill, '请使用 $story'), true)
})

test('否定点名不会进入候选，required 也不能覆盖用户本轮排除', () => {
  const writer = entry('story-long-write', '长篇写作', 50, true)
  for (const prompt of ['不要使用 story-long-write，只检查设定', '不要使用 `story-long-write`', '不用长篇写作', "Don't use story-long-write", 'without story-long-write']) {
    assert.equal(isSkillExplicitlyMentioned(writer.skill, prompt), false, prompt)
    assert.equal(isSkillExplicitlyExcluded(writer.skill, prompt), true, prompt)
    assert.deepEqual(selectSkillCandidates([writer], prompt, 4, compare), [], prompt)
  }
  assert.equal(isSkillExplicitlyExcluded(writer.skill, '不要改正文，而是使用 story-long-write'), false)
  assert.equal(isSkillExplicitlyExcluded(writer.skill, '不要使用 story-long-write，后来想了想，使用 story-long-write'), false)
  assert.equal(isSkillExplicitlyExcluded(writer.skill, '不用其他方法而是 story-long-write'), false)
  assert.equal(isSkillExplicitlyExcluded(writer.skill, '不用其他方法\n使用 story-long-write'), false)
  assert.equal(isSkillExplicitlyExcluded(writer.skill, '不要使用 story-long-write 但请使用 story-long-write'), false)
})

test('自动模式中用户点名的 Skill 不会被高分候选和数量上限挤掉', () => {
  const entries = [
    entry('humanizer-zh', 'humanizer-zh', 20, true),
    entry('novel-pacing', 'novel-pacing', 15),
    entry('novel-emotion', 'novel-emotion', 14),
    entry('novel-language-style', 'novel-language-style', 13),
    entry('novel-polishing', 'novel-polishing', 12),
    entry('novel-pleasure-points', 'novel-pleasure-points', 11),
    entry('我吃西红柿笔锋', '我吃西红柿笔锋', 0)
  ]

  const selected = selectSkillCandidates(
    entries,
    '继续创作章节，写作优先使用我吃西红柿笔锋',
    6,
    compare
  )

  assert.equal(selected.length, 6)
  assert.ok(selected.some((item) => item.skill.id === '我吃西红柿笔锋'))
  assert.ok(selected.some((item) => item.skill.id === 'humanizer-zh'))
})

test('显示名称与目录 ID 不同时，点名显示名称也能优先并被工具解析', () => {
  const named = entry('fiction-human-texture', '我吃西红柿笔锋', 0)
  const selected = selectSkillCandidates([named], '请优先使用我吃西红柿笔锋', 4, compare)
  assert.equal(selected[0]?.skill.id, 'fiction-human-texture')
  assert.equal(
    findSkillDefinitionByIdOrName([named.skill], '我吃西红柿笔锋')?.id,
    'fiction-human-texture'
  )
})
