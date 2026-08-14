import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const taskContextSource = readFileSync(new URL('../runtime/task-context.ts', import.meta.url), 'utf8')
const orchestratorSource = readFileSync(new URL('../runtime/orchestrator.ts', import.meta.url), 'utf8')
const firstDraftContextSource = readFileSync(new URL('../../../../renderer/src/features/ai/chapterAssistantContext.ts', import.meta.url), 'utf8')
const firstDraftFlowSource = readFileSync(new URL('../../../../renderer/src/components/chapterWorkspace/useChapterFirstDraft.ts', import.meta.url), 'utf8')
const chapterMetaDialogSource = readFileSync(new URL('../../../../renderer/src/components/chapterWorkspace/ChapterMetaDialog.vue', import.meta.url), 'utf8')
const appStoreSource = readFileSync(new URL('../../../../renderer/src/stores/app.ts', import.meta.url), 'utf8')
const aiTaskCenterSource = readFileSync(new URL('../../../../renderer/src/components/TitlebarAiTaskCenter.vue', import.meta.url), 'utf8')
const projectIdContextFiles = [
  '../../../../renderer/src/composables/useCatalogBatch.ts',
  '../../../../renderer/src/components/CharactersPanel.vue',
  '../../../../renderer/src/components/WorldviewPanel.vue',
  '../../../../renderer/src/components/OutlinePanel.vue'
]

const promptFiles = [
  'outline-item.ts',
  'outline-batch.ts',
  'outline-chain.ts',
  'outline-enhance.ts',
  'character-card.ts',
  'character-enhance.ts',
  'worldview-entry.ts',
  'worldview-enhance.ts',
  'catalog-batch.ts'
]

test('大纲、角色和世界观任务都会注入世界状态', () => {
  for (const task of [
    'outline-item',
    'outline-batch',
    'outline-chain',
    'outline-enhance',
    'character-card',
    'character-enhance',
    'worldview-entry',
    'worldview-enhance',
    'catalog-batch'
  ]) {
    assert.match(taskContextSource, new RegExp(`'${task}'`), `${task} 未加入世界状态注入范围`)
  }
})

test('相关生成提示词会实际消费世界状态', () => {
  for (const fileName of promptFiles) {
    const source = readFileSync(new URL(fileName, import.meta.url), 'utf8')
    assert.match(source, /formatStoryStateConstraint\(context\)/, `${fileName} 未使用世界状态提示块`)
  }
})

test('世界状态在 Agent 路由前完成注入', () => {
  const enrichIndex = orchestratorSource.indexOf('await enrichTaskContextForGeneration(task, settingsForRouting)')
  const agentRunIndex = orchestratorSource.indexOf('return await runAgentTask(task, knowledgeContext)')

  assert.ok(enrichIndex >= 0)
  assert.ok(agentRunIndex >= 0)
  assert.ok(enrichIndex < agentRunIndex)
})

test('相关界面请求会携带当前项目 ID', () => {
  for (const relativePath of projectIdContextFiles) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    assert.match(source, /projectId: appStore\.currentProject\?\.id/)
  }
})

test('初稿只建立索引，世界状态统一在章节定稿后同步', () => {
  assert.match(firstDraftContextSource, /chapterId: input\.chapter\?\.id/)
  assert.match(firstDraftContextSource, /chapterIndex: input\.chapterIndex/)
  assert.match(firstDraftContextSource, /deferStoryStateUntilFinal: true/)
  assert.match(firstDraftFlowSource, /chapterIndex: Math\.max\(currentChapterIndex, 0\)/)
  assert.match(orchestratorSource, /context\.deferStoryStateUntilFinal === true/)
  assert.match(chapterMetaDialogSource, /form\.status === 'final'/)
  assert.match(chapterMetaDialogSource, /await appStore\.persistWorkspace\(\)/)
  assert.match(chapterMetaDialogSource, /startChapterStateSync\(\[chapterId\]\)/)
  assert.match(chapterMetaDialogSource, /:loading="isSubmitting"/)
  assert.doesNotMatch(chapterMetaDialogSource, /title="同步世界状态"/)
  assert.match(appStoreSource, /backfillProjectState\(toIpcPayload\(\{/)
  assert.match(appStoreSource, /selection: \{ mode: 'custom', chapterIds: ids \}/)
  assert.match(appStoreSource, /onBackfillStateProgress\(handleBackfillStateProgress\)/)
  assert.match(appStoreSource, /label: '同步定稿章节故事状态'/)
  assert.match(aiTaskCenterSource, /run\.progress\?\.percentage/)
})
