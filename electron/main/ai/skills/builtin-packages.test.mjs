import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import { parseSkillFrontmatter } from './frontmatter.ts'
import { validateManifest } from './manifest.ts'
import { buildFullManifest, inferSkillMeta } from './heuristics.ts'
import * as loader from './loader.ts'
import * as registryMerge from './registry-merge.ts'
import * as selectionPriority from './selection-priority.ts'
import * as narrativeFunctions from './narrative-function-map.ts'
import * as textWindow from '../agent/tools/text-window.ts'
import { runScript } from '../agent/tools/script-runner.ts'
import { normalizeSkillUsePolicy } from '../../../shared/assistant-runtime.ts'

const { loadSkillReferenceFile, loadSkillReferences } = loader

const require = createRequire(import.meta.url)
const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const builtinRoot = join(projectRoot, 'resources/skills')
const lock = JSON.parse(readFileSync(join(builtinRoot, 'upstream-lock.json'), 'utf8'))

function loadModule(path, dependencies) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const exports = {}
  new Function('require', 'exports', outputText)((name) => dependencies[name] ?? require(name), exports)
  return exports
}

// 使用真实扫描器和真实内置文件，仅替换 Electron 的路径查询，避免启动应用或读取用户数据。
const discovery = loadModule('./discovery.ts', {
  electron: { app: { getAppPath: () => projectRoot, getPath: () => join(builtinRoot, '__test_user_data_not_present__') } },
  './frontmatter': { parseSkillFrontmatter },
  './manifest': { validateManifest },
  './heuristics': { buildFullManifest, inferSkillMeta }
})
const skills = await discovery.scanSkillsFromDisk()
const byId = new Map(skills.map((skill) => [skill.id, skill]))
const registry = loadModule('./registry.ts', { './discovery': discovery, './registry-merge': registryMerge })
await registry.initRegistry()
const { pickSkillsFor } = loadModule('./matcher.ts', {
  './registry': registry,
  './loader': loader,
  '../tasks': { getTaskHandler: () => ({}) },
  './narrative-function-map': narrativeFunctions,
  './selection-priority': selectionPriority
})
const { resolveTaskSkills } = loadModule('./task-selection.ts', {
  '../../../shared/assistant-runtime': { normalizeSkillUsePolicy },
  './registry': registry,
  './matcher': { pickSkillsFor }
})
const { createSkillTools } = loadModule('../agent/tools/skill-tools.ts', {
  '../../skills/loader': loader,
  './script-runner': { runScript },
  './text-window': textWindow
})
const skillTools = new Map(createSkillTools({
  resolveSkill: registry.getSkillById,
  listSkills: registry.getAllSkills,
  allowScriptExecution: (skill) => skill.scope === 'builtin',
  scriptTimeoutMs: 5000
}).map((tool) => [tool.definition.name, tool]))

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

test('真实扫描器加载来源记录中的全部内置技能，ID 唯一且来源可追溯', () => {
  const expected = [...lock.sources.flatMap((source) => source.skillIds), ...lock.localSkills.map((path) => path.split('/').at(-1))]
  assert.equal(byId.size, skills.length)
  assert.deepEqual([...byId.keys()].sort(), expected.sort())
  for (const source of lock.sources) {
    assert.match(source.revision, /^[a-f0-9]{40}$/)
    for (const id of source.skillIds) {
      const skill = byId.get(id)
      assert.equal(skill.source, source.repository, id)
      assert.ok(skill.description, id)
      assert.equal(skill.scope, 'builtin', id)
    }
  }
})

test('工具箱任务映射和本地风格技能保留，版本可在技能面板展示', () => {
  const worldview = byId.get('novel-worldbuilding')
  assert.ok(worldview.manifest.tasks.includes('worldview-entry'))
  assert.ok(worldview.manifest.stages.includes('setting'))
  assert.equal(worldview.enabled, true)
  assert.equal(worldview.version, '1.0.0')
  assert.equal(byId.get('novel-polishing').version, '2.0.0')
  assert.equal(byId.get('humanizer-zh').manifest.required, true)
  assert.equal(byId.get('humanizer-zh').version, '2026.09.23')
  assert.equal(byId.get('style-fingerprint').compatibility, 'native')
  assert.equal(byId.get('style-fusion').compatibility, 'native')
  assert.equal(byId.get('story-publish').enabled, false)
  assert.equal(byId.get('story-publish').compatibility, 'external-only')
})

test('任务命中时会自动加载指纹 schema 和小说词库，其他任务不加载', async () => {
  const fingerprint = byId.get('style-fingerprint')
  const references = await loadSkillReferences(fingerprint, { task: 'reference-style-analysis', context: {} })
  assert.deepEqual(references.map((item) => item.file), ['references/fingerprint-schema.md'])
  assert.ok(references[0].content.length > 0)
  assert.deepEqual(await loadSkillReferences(fingerprint, { task: 'worldview-entry', context: {} }), [])
  const humanizer = byId.get('humanizer-zh')
  for (const task of ['chapter-first-draft', 'chapter-assistant']) {
    const loaded = await loadSkillReferences(humanizer, { task, context: {} })
    assert.deepEqual(loaded.map((item) => item.file), ['references/replacement-dict.md'])
    assert.ok(loaded[0].content.length > 0)
  }
})

test('参考规则保留任务与首章条件，不吞掉后续 manifest 字段', async () => {
  const parsed = parseSkillFrontmatter(`---
name: conditional-reference
manifest:
  references:
    - file: "references/fingerprint-schema.md"
      loadWhen:
        task: reference-style-analysis
        chapterIndexMax: 0
  priority: 7
  required: true
---
正文`)
  assert.equal(parsed.manifest.priority, 7)
  assert.equal(parsed.manifest.required, true)
  const skill = { ...byId.get('style-fingerprint'), manifest: parsed.manifest }
  const first = await loadSkillReferences(skill, { task: 'reference-style-analysis', context: { chapterIndex: 0 } })
  assert.equal(first.length, 1)
  const later = await loadSkillReferences(skill, { task: 'reference-style-analysis', context: { chapterIndex: 1 } })
  assert.deepEqual(later, [])
})

test('真实匹配与任务策略支持自动选择、手动指定和关闭，参考正文进入选择结果', async () => {
  const automatic = await resolveTaskSkills({ task: 'worldview-entry', context: {
    userPrompt: '构建世界观和力量体系', stageId: 'setting', projectNovelLength: 'long'
  } })
  assert.ok(automatic.usedSkillIds.includes('novel-worldbuilding'))
  assert.ok(!automatic.usedSkillIds.includes('story-publish'))
  assert.ok(!automatic.usedSkillIds.includes('browser-cdp'))
  const context = { skillPolicy: { mode: 'only', skillIds: ['style-fingerprint'] } }
  const manual = await resolveTaskSkills({ task: 'reference-style-analysis', context })
  assert.deepEqual(manual.usedSkillIds, ['style-fingerprint'])
  assert.deepEqual(manual.skills[0].referenceContents.map((item) => item.file), ['references/fingerprint-schema.md'])
  const off = await resolveTaskSkills({ task: 'chapter-first-draft', context: { skillPolicy: { mode: 'off' } } })
  assert.deepEqual(off.skills, [])
})

test('真实 Skill 工具能列出清单、加载全部已启用技能并读取其参考文件', async () => {
  const listed = await skillTools.get('skill_list').handler({})
  assert.equal(listed.isError, undefined)
  for (const skill of skills.filter((item) => item.enabled)) {
    assert.ok(listed.content.includes(skill.id))
    const loaded = await skillTools.get('skill_load').handler({ skill_id: skill.id })
    assert.equal(loaded.isError, undefined, skill.id)
    assert.equal(loaded.content, skill.content)
    for (const file of skill.referenceFiles) {
      const reference = await skillTools.get('skill_read_reference').handler({ skill_id: skill.id, file })
      assert.equal(reference.isError, undefined, `${skill.id}/${file}`)
      assert.equal(reference.content, readFileSync(join(skill.rootDir, file), 'utf8'))
    }
  }
  const files = await skillTools.get('skill_glob').handler({ skill_id: 'story-long-write', pattern: 'scripts/normalize-punctuation.js' })
  assert.equal(files.isError, undefined)
  assert.ok(files.content.includes('scripts/normalize-punctuation.js'))
  const disabled = await skillTools.get('skill_load').handler({ skill_id: 'story-publish' })
  assert.equal(disabled.isError, true)
})

test('通过真实工具执行上游标点脚本，修改临时稿件并可重复校验', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'characterarc-skill-smoke-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const manuscript = join(directory, '正文.md')
  writeFileSync(manuscript, '“他还没来......”\n', 'utf8')
  const invoke = (args) => skillTools.get('skill_run_script').handler({
    skill_id: 'story-long-write', script: 'scripts/normalize-punctuation.js', args
  }, { signal: new AbortController().signal })
  const first = await invoke([manuscript])
  assert.equal(first.isError, false, first.content)
  const normalized = readFileSync(manuscript, 'utf8')
  assert.ok(normalized.includes('……'), normalized)
  const checked = await invoke(['--check', manuscript])
  assert.equal(checked.isError, false, checked.content)
  assert.equal(readFileSync(manuscript, 'utf8'), normalized)
})

test('任务提示词中显式加载的技能参考文件全部可由真实读取器打开', async () => {
  let references = 0
  for (const file of walk(join(projectRoot, 'electron/main/ai/tasks')).filter((path) => path.endsWith('.ts'))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/skill_read_reference\("([^"]+)",\s*"([^"]+)"\)/g)) {
      const skill = byId.get(match[1])
      assert.ok(skill, `${file}: ${match[1]}`)
      assert.ok((await loadSkillReferenceFile(skill, match[2])).trim(), `${file}: ${match[2]}`)
      references += 1
    }
  }
  assert.ok(references > 0)
})

test('技能声明的参考路径和 Markdown 相对文件链接均存在', () => {
  const missing = []
  for (const skill of skills) {
    for (const rule of skill.manifest.references) {
      assert.ok(existsSync(resolve(skill.rootDir, rule.file)), `${skill.id}: ${rule.file}`)
    }
    for (const file of walk(skill.rootDir).filter((path) => path.endsWith('.md'))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/(?<!!)\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const href = match[1].split('#')[0]
        if (!href || /^(?:[a-z]+:|\/)/i.test(href) || /[{}<>]/.test(href)) continue
        const target = resolve(dirname(file), decodeURIComponent(href))
        if (!existsSync(target)) missing.push(`${skill.id}/${file.slice(skill.rootDir.length + 1)} -> ${href}`)
      }
    }
  }
  assert.deepEqual(missing, [])
})
