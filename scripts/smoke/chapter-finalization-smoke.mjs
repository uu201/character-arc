import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    }
  }).outputText
}

const source = await readFile('electron/main/ai/chapter-finalization.ts', 'utf8')
const transpiled = transpile(source)

const mod = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`)

async function writeTranspiledModule(root, sourcePath, outputPath, replacements = []) {
  let output = transpile(await readFile(sourcePath, 'utf8'))
  for (const [from, to] of replacements) {
    output = output.replaceAll(from, to)
  }
  const fullPath = join(root, outputPath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, output, 'utf8')
}

async function loadApplyModules() {
  const root = await mkdtemp(join(tmpdir(), 'chapter-finalization-smoke-'))
  await mkdir(join(root, 'electron/main/ai'), { recursive: true })
  try {
    await writeTranspiledModule(root, 'electron/main/story-state-store.ts', 'electron/main/story-state-store.mjs')
    await writeTranspiledModule(root, 'electron/main/ai/chapter-finalization.ts', 'electron/main/ai/chapter-finalization.mjs')
    await writeTranspiledModule(
      root,
      'electron/main/ai/chapter-finalization-apply.ts',
      'electron/main/ai/chapter-finalization-apply.mjs',
      [
        [`from '../story-state-store'`, `from '../story-state-store.mjs'`],
        [`from './chapter-finalization'`, `from './chapter-finalization.mjs'`]
      ]
    )

    return {
      root,
      storyState: await import(pathToFileURL(join(root, 'electron/main/story-state-store.mjs')).href),
      apply: await import(pathToFileURL(join(root, 'electron/main/ai/chapter-finalization-apply.mjs')).href)
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

const preview = mod.normalizeFinalizationPreview({
  chapterSummary: '主角拿到关键证据，但局势尚未落定。',
  stateDelta: {
    characters_updated: [
      {
        character_id: 'protagonist',
        changes: {
          mental_state: '更冷静地掌握主动权'
        }
      }
    ],
    relationships_delta: [],
    foreshadowing_delta: {
      planted: [],
      advanced: [{ id: 'capital-camp-ledger', clue: '空饷名册落入主角手中', method: '实物证据' }],
      resolved: []
    },
    timeline: {
      story_time_elapsed: '一夜',
      current_story_date: '未明',
      events: ['京营空饷名册首次落入主角手中'],
      world_state_changes: []
    }
  },
  nextChapterBridge: '下一章应从反扑或证据验证切入。',
  warnings: ['不要把阶段性证据写成最终胜利']
})

assert.equal(preview.chapterSummary, '主角拿到关键证据，但局势尚未落定。')
assert.equal(preview.nextChapterBridge, '下一章应从反扑或证据验证切入。')
assert.equal(preview.warnings.length, 1)
assert.equal(preview.stateDelta?.foreshadowing_delta.advanced[0].id, 'capital-camp-ledger')
assert.equal(mod.validateFinalizationPreview(preview), true)

const request = mod.normalizeFinalizationRequest({
  projectId: 'project-1',
  chapterId: 'chapter-1',
  userGuidance: '   '
})

assert.equal(request.projectId, 'project-1')
assert.equal(request.chapterId, 'chapter-1')
assert.equal(request.userGuidance, '')
assert.equal(request.hasUserGuidance, false)

const invalidPreview = mod.normalizeFinalizationPreview({
  chapterSummary: '',
  stateDelta: null,
  nextChapterBridge: '',
  warnings: []
})

assert.equal(mod.validateFinalizationPreview(invalidPreview), false)
assert.match(mod.summarizePreviewForDisplay(preview), /主角拿到关键证据/)

const { DatabaseSync } = await import('node:sqlite')
const loaded = await loadApplyModules()
try {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      volume_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      word_target TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE chapter_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      word_target TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
  `)
  loaded.storyState.initStoryStateSchema(db)

  db.prepare(`
    INSERT INTO chapters (id, project_id, volume_id, title, summary, status, word_target, content, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'chapter-1',
    'project-1',
    'volume-1',
    '第一章',
    '旧摘要',
    'draft',
    '3000',
    '<p>正文内容</p>',
    0
  )

  const applied = loaded.apply.applyChapterFinalization(db, {
    projectId: 'project-1',
    chapterId: 'chapter-1',
    chapterIndex: 1,
    preview
  })

  assert.equal(applied.chapter.status, 'final')
  assert.equal(applied.chapter.summary, preview.chapterSummary)
  assert.equal(applied.version.id, applied.versionId)
  assert.equal(applied.version.summary, '旧摘要')
  assert.equal(applied.appliedStateDelta, true)

  const chapterRow = db.prepare('SELECT summary, status FROM chapters WHERE id = ?').get('chapter-1')
  assert.equal(chapterRow.summary, preview.chapterSummary)
  assert.equal(chapterRow.status, 'final')

  const versionRow = db.prepare('SELECT summary, status, content FROM chapter_versions WHERE id = ?').get(applied.versionId)
  assert.equal(versionRow.summary, '旧摘要')
  assert.equal(versionRow.status, 'draft')
  assert.equal(versionRow.content, '<p>正文内容</p>')

  const timelineRow = db.prepare('SELECT events_json FROM story_timeline WHERE project_id = ? AND chapter_index = ?')
    .get('project-1', 1)
  assert.deepEqual(JSON.parse(timelineRow.events_json), ['京营空饷名册首次落入主角手中'])
  db.close()
} finally {
  await rm(loaded.root, { recursive: true, force: true })
}

console.log('chapter finalization smoke checks passed')
