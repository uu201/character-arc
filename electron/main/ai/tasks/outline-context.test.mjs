import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const taskFiles = [
  'outline-batch.ts',
  'outline-item.ts',
  'outline-chain.ts',
  'outline-enhance.ts'
]

const formatHelpersSource = readFileSync(new URL('../prompts/format-helpers.ts', import.meta.url), 'utf8')
const chapterContextSource = readFileSync(new URL('../../../../renderer/src/features/ai/chapterAssistantContext.ts', import.meta.url), 'utf8')
const firstDraftSource = readFileSync(new URL('../../../../renderer/src/components/chapterWorkspace/useChapterFirstDraft.ts', import.meta.url), 'utf8')
const outlinePanelSource = readFileSync(new URL('../../../../renderer/src/components/OutlinePanel.vue', import.meta.url), 'utf8')

test('角色关键标签会进入大纲与章节创作上下文', () => {
  assert.match(formatHelpersSource, /关键标签，必须遵守/)
  assert.match(formatHelpersSource, /record\.tags/)
  assert.equal(
    chapterContextSource.match(/tags:\s*character\.tags\.map\(\(tag\) => tag\.label\)/g)?.length,
    2
  )
  assert.match(firstDraftSource, /tags:\s*c\.tags\.map\(\(tag\) => tag\.label\)/)
  assert.match(outlinePanelSource, /tags:\s*character\.tags\.map\(\(tag\) => tag\.label\)/)
})

for (const fileName of taskFiles) {
  test(`${fileName} 提示词包含角色关系和组织归属`, () => {
    const source = readFileSync(new URL(fileName, import.meta.url), 'utf8')

    assert.match(source, /角色关系参考：\$\{JSON\.stringify\(context\.characterRelationships/)
    assert.match(source, /组织归属参考：\$\{JSON\.stringify\(context\.organizationMemberships/)
    assert.match(source, /relatedCharacterIds/)
    assert.match(source, /relatedOrganizationIds/)
    assert.match(source, /relatedWorldviewIds/)
  })
}

test('全局助手大纲提案示例包含关联 ID 数组', () => {
  const source = readFileSync(new URL('global-assistant-proposal.ts', import.meta.url), 'utf8')
  const returnExample = source.slice(source.indexOf('返回格式：'))

  assert.match(returnExample, /relatedCharacterIds/)
  assert.match(returnExample, /relatedOrganizationIds/)
  assert.match(returnExample, /relatedWorldviewIds/)
})

test('分卷扩写提示词包含用户补充要求', () => {
  const source = readFileSync(new URL('outline-enhance.ts', import.meta.url), 'utf8')

  assert.match(source, /补充要求：\$\{String\(context\.userPrompt \?\? ''\)\}/)
})

test('大纲面板的两个扩写入口均传递用户补充要求', () => {
  assert.match(outlinePanelSource, /handleExpandOutline\(userPrompt/)
  assert.match(outlinePanelSource, /handleExpandVolumeOutline\(targetVolume, userPrompt\)/)
  assert.match(outlinePanelSource, /userPrompt:\s*\[/)
})
