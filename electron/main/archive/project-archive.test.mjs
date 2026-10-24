import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import JSZip from 'jszip'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@shared/')) {
      return nextResolve(new URL(`../../shared/${specifier.slice(8)}.ts`, import.meta.url).href, context)
    }
    if (specifier.startsWith('.') && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(candidate)) return nextResolve(candidate.href, context)
    }
    return nextResolve(specifier, context)
  }
})

const { importProjectArchive } = await import('./project-archive.ts')

test('导入带有跨卷排序冲突的旧归档后，新三章仍在末卷末尾', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'characterarc-chapter-order-archive-'))
  try {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ app: 'CharacterArc', archiveVersion: '1.0' }))
    zip.file('project.json', JSON.stringify({ id: 'source', title: '旧工程' }))
    zip.file('workspace/outline.json', JSON.stringify({
      outlineVolumes: [{ id: 'v1', title: '第一卷' }, { id: 'v2', title: '末卷' }], outlineItems: []
    }))
    const oldChapters = Array.from({ length: 60 }, (_, i) => ({
      id: `old-${i + 1}`, volumeId: 'v1', title: `旧第${i + 1}章`, content: `正文${i + 1}`, sortOrder: (i + 1) * 1024
    }))
    const newChapters = Array.from({ length: 3 }, (_, i) => ({
      id: `new-${i + 61}`, volumeId: 'v2', title: `第${i + 61}章`, content: `末卷正文${i + 61}`, sortOrder: i
    }))
    zip.file('workspace/chapters.json', JSON.stringify([...newChapters, ...oldChapters]))
    const filePath = join(directory, 'old.carc')
    await writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
    let saved
    const result = await importProjectArchive({
      db: {}, filePath, mode: 'new-project', modules: ['project', 'outline', 'chapters'],
      readWorkspaceSnapshot: () => ({ projects: [], workspaces: {}, knowledgeDocuments: [], referenceWorks: [] }),
      writeWorkspaceSnapshot: (_db, payload) => { saved = payload }
    })
    const chapters = saved.workspaces[result.selectedProjectId].chapters
    assert.equal(chapters.length, 63)
    assert.deepEqual(chapters.slice(-3).map(item => item.title), ['第61章', '第62章', '第63章'])
    assert.equal(chapters[60].content, '末卷正文61')
    assert.equal(chapters[62].content, '末卷正文63')
    assert.ok(chapters.every((item, index) => index === 0 || item.sortOrder > chapters[index - 1].sortOrder))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

for (const { name, premise, modules, expected } of [
  { name: '覆盖项目资料时更新独立简介', premise: '归档简介', modules: ['project'], expected: '归档简介' },
  { name: '覆盖项目资料时保留主动清空的简介', premise: '', modules: ['project'], expected: '' },
  { name: '旧归档覆盖项目资料时移除目标项目简介以允许兼容恢复', premise: undefined, modules: ['project'], expected: undefined },
  { name: '未选择项目资料模块时保留目标简介', premise: '归档简介', modules: ['referenceWorks'], expected: '目标简介' }
]) {
  test(name, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'characterarc-premise-archive-'))
    try {
      const zip = new JSZip()
      zip.file('manifest.json', JSON.stringify({ app: 'CharacterArc', archiveVersion: '1.0' }))
      zip.file('project.json', JSON.stringify({ id: 'source', title: '归档项目', premise }))
      const filePath = join(directory, 'project.carc')
      await writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))

      const snapshot = {
        selectedProjectId: 'target',
        projects: [{ id: 'target', title: '目标项目', premise: '目标简介' }],
        workspaces: { target: { chapters: [], aiRuns: [] } },
        knowledgeDocuments: [],
        referenceWorks: []
      }
      let saved
      await importProjectArchive({
        db: {},
        filePath,
        mode: 'overwrite-project',
        targetProjectId: 'target',
        modules,
        readWorkspaceSnapshot: () => snapshot,
        writeWorkspaceSnapshot: (_db, payload) => { saved = payload }
      })

      assert.equal(saved.projects[0].premise, expected)
      assert.equal(saved.projects[0].title, modules.includes('project') ? '归档项目' : '目标项目')
      assert.equal(snapshot.projects[0].premise, '目标简介')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
