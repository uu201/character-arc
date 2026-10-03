import assert from 'node:assert/strict'
import test from 'node:test'

import { StagedChangesStore } from '../staged-changes-store.ts'
import { makeStageChapterEditToolCore } from './stage-chapter-edit-core.ts'

const chapters = [
  { id: 'chapter-1', title: '第一章 雨夜', summary: '', status: 'draft', wordCount: 10 },
  { id: 'chapter-2', title: '第二章 入城', summary: '', status: 'draft', wordCount: 12 }
]

function makeDataAccess(calls = []) {
  return {
    async readChapterFromDb(_projectId, chapterId) {
      return chapters.find((chapter) => chapter.id === chapterId) ?? null
    },
    async listProjectChapters() {
      return chapters
    },
    async computeChapterEdit(projectId, chapterId, edit, overrideContent) {
      calls.push({ projectId, chapterId, edit, overrideContent })
      const oldContent = overrideContent ?? `<p>${chapterId}:old</p>`
      const newContent = `${oldContent}<p>${edit.content}</p>`
      return {
        oldContent,
        newContent,
        preview: `edit ${chapterId}`,
        chapterTitle: chapters.find((chapter) => chapter.id === chapterId)?.title ?? chapterId,
        beforeFragment: edit.search ?? '',
        afterFragment: edit.content
      }
    }
  }
}

function makeTool(options = {}) {
  const stagedStore = new StagedChangesStore()
  const calls = []
  const tool = makeStageChapterEditToolCore({
    sessionId: 'session-1',
    turnId: 'turn-1',
    projectId: 'project-1',
    stagedStore,
    dataAccess: makeDataAccess(calls),
    currentChapterId: options.currentChapterId
  })
  return { tool, stagedStore, calls }
}

async function runTool(tool, input) {
  return tool.handler(input, {
    signal: new AbortController().signal,
    projectId: 'project-1'
  })
}

test('按章节序号定位目标并写入暂存变更', async () => {
  const { tool, stagedStore, calls } = makeTool()

  const result = await runTool(tool, {
    chapter_id: '第二章',
    operation: 'append',
    content: '新增一段',
    reason: '补足入城氛围'
  })

  assert.equal(result.isError, undefined)
  const changes = stagedStore.list({}, 'session-1')
  assert.equal(changes.length, 1)
  assert.equal(changes[0].entityId, 'chapter-2')
  assert.equal(changes[0].entityTitle, '第二章 入城')
  assert.equal(changes[0].reason, '补足入城氛围')
  assert.equal(calls[0].edit.revision.id, changes[0].id)
  assert.equal(calls[0].edit.revision.turnId, 'turn-1')
  assert.equal(calls[0].edit.revision.reason, '补足入城氛围')
  assert.match(calls[0].edit.revision.color, /^#[0-9A-F]{6}$/)
})

test('章节面板禁止暂存当前章节之外的修改', async () => {
  const { tool, stagedStore } = makeTool({ currentChapterId: 'chapter-1' })

  const result = await runTool(tool, {
    chapter_id: '第二章',
    operation: 'append',
    content: '不该写入',
    reason: '跨章节测试'
  })

  assert.equal(result.isError, true)
  assert.match(result.content, /只能修改当前章节/)
  assert.equal(stagedStore.list({}, 'session-1').length, 0)
})

test('整章重写使用 replace_all，无需提供 search', async () => {
  const { tool, stagedStore } = makeTool({ currentChapterId: 'chapter-1' })
  const operationSchema = tool.definition.inputSchema.properties.operation

  assert.ok(operationSchema.enum.includes('replace_all'))
  const result = await runTool(tool, {
    operation: 'replace_all',
    content: '整章新正文',
    reason: '按拆章方案重写本章'
  })

  assert.equal(result.isError, undefined)
  assert.equal(stagedStore.list({}, 'session-1').length, 1)
})

test('局部 replace 缺少 search 时仍拒绝，避免误覆盖整章', async () => {
  const { tool, stagedStore } = makeTool({ currentChapterId: 'chapter-1' })
  const result = await runTool(tool, {
    operation: 'replace',
    content: '不能被当成整章正文',
    reason: '参数遗漏测试'
  })

  assert.equal(result.isError, true)
  assert.equal(result.content, 'replace 需要提供 search。')
  assert.equal(stagedStore.list({}, 'session-1').length, 0)
})

test('同一轮多次暂存会基于上一条暂存后的章节正文继续计算', async () => {
  const { tool, stagedStore, calls } = makeTool({ currentChapterId: 'chapter-1' })

  await runTool(tool, {
    operation: 'append',
    content: '第一处修改',
    reason: '第一次'
  })
  await runTool(tool, {
    operation: 'append',
    content: '第二处修改',
    reason: '第二次'
  })

  const changes = stagedStore.list({}, 'session-1')
  assert.equal(changes.length, 2)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].overrideContent, undefined)
  assert.equal(calls[1].overrideContent, changes[0].chapterHtml.new)
  assert.equal(changes[1].chapterHtml.old, changes[0].chapterHtml.new)
})
