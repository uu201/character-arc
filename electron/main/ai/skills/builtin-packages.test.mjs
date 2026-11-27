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
const { isSkillAllowedByPolicy } = loadModule('./usage-policy.ts', { './selection-priority': selectionPriority })
const { pickSkillsFor } = loadModule('./matcher.ts', {
  './registry': registry,
  './loader': loader,
  '../tasks': { getTaskHandler: (task) => ({ maxSkills: ['global-assistant', 'chapter-assistant'].includes(task) ? 6 : 4 }) },
  './narrative-function-map': narrativeFunctions,
  './selection-priority': selectionPriority
})
const { resolveTaskSkills } = loadModule('./task-selection.ts', {
  '../../../shared/assistant-runtime': { normalizeSkillUsePolicy },
  './registry': registry,
  './matcher': { pickSkillsFor },
  './usage-policy': { isSkillAllowedByPolicy }
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

test('助手按当前需求跨阶段推荐，不再让通用任务和阶段加分挤掉世界观技能', async () => {
  const task = { task: 'chapter-assistant', context: {
    userPrompt: '检查这一章的世界观和力量体系是否有矛盾', stageId: 'draft', projectNovelLength: 'long'
  } }
  for (const stageOverrides of [undefined, new Map(skills.map((skill) => [skill.id, skill.manifest.stages]))]) {
    const selected = await pickSkillsFor(task, { stageOverrides })
    const world = selected.find((skill) => skill.id === 'novel-worldbuilding')
    assert.ok(world)
    assert.ok(world.scoreBreakdown.trigger > world.scoreBreakdown.task + world.scoreBreakdown.stage)
    assert.ok(!selected.some((skill) => ['novel-pacing', 'novel-pleasure-points'].includes(skill.id)))
  }
})

test('闲聊不为界面阶段凑满候选，后台题材也不能覆盖本轮明确需求', async () => {
  assert.deepEqual(await pickSkillsFor({ task: 'global-assistant', context: { userPrompt: '你好', stageId: 'setting' } }), [])
  const selected = await pickSkillsFor({ task: 'chapter-assistant', context: {
    userPrompt: '只润色这段人物对白，保持事实不变', stageId: 'draft', projectGenre: '升级爽文', chapterSummary: '这是一场激烈的战斗'
  } })
  assert.ok(selected.some((skill) => skill.id === 'novel-polishing'))
  assert.ok(!selected.some((skill) => ['novel-pacing', 'novel-pleasure-points'].includes(skill.id)))
})

test('大纲请求不误选部署、导入、路由或写作工具，显式空列表保留', async () => {
  const selected = await pickSkillsFor({ task: 'global-assistant', context: {
    userPrompt: '帮我规划后面五章的大纲', stageId: 'outline', projectNovelLength: 'long'
  } })
  assert.ok(selected.some((skill) => skill.id === 'story-long-write'))
  for (const id of ['story-setup', 'story-import', 'story', 'novel-tools']) {
    assert.ok(!selected.some((skill) => skill.id === id), id)
    assert.deepEqual(byId.get(id).manifest.tasks, [], id)
  }
  assert.equal(byId.get('story-setup').compatibility, 'external-only')
  const explicit = buildFullManifest({ tasks: [], stages: [], triggers: [] }, inferSkillMeta('generic-write', '写作技能'))
  assert.deepEqual([explicit.tasks, explicit.stages, explicit.triggers], [[], [], []])
})

test('明确排除和外部技能不能被点名、required 或手动选择绕过', async () => {
  const selected = await pickSkillsFor({ task: 'global-assistant', context: {
    userPrompt: '不要使用 story-long-write，只检查人物设定', stageId: 'setting'
  } })
  assert.ok(!selected.some((skill) => skill.id === 'story-long-write' || skill.id === 'story'))
  const enabledOverrides = new Map(skills.map((skill) => [skill.id, true]))
  assert.deepEqual(await pickSkillsFor({ task: 'global-assistant', context: { userPrompt: '使用 browser-cdp' } }, {
    enabledOverrides, onlySkillIds: ['browser-cdp']
  }), [])
  assert.deepEqual(await pickSkillsFor({ task: 'chapter-assistant', context: { userPrompt: '不要使用 humanizer-zh' } }, {
    onlySkillIds: ['humanizer-zh']
  }), [])
})

test('自动模式能加载初筛外已启用技能，成功返回规范 ID 与回执名称', async () => {
  const policy = { mode: 'auto', skillIds: [] }
  const task = { task: 'global-assistant', context: { userPrompt: '整理角色设定', stageId: 'setting' } }
  const selected = await pickSkillsFor(task)
  assert.ok(!selected.some((skill) => skill.id === 'style-fingerprint'))
  const tools = new Map(createSkillTools({
    resolveSkill: registry.getSkillById,
    allowSkillUse: (skill) => isSkillAllowedByPolicy(skill, policy, task.context.userPrompt)
  }).map((tool) => [tool.definition.name, tool]))
  const loaded = await tools.get('skill_load').handler({ skill_id: 'style-fingerprint' })
  assert.equal(loaded.isError, undefined)
  assert.deepEqual(loaded.loadedSkill, { id: 'style-fingerprint', name: byId.get('style-fingerprint').name })
})

test('only、off、停用、本轮排除和外部兼容性限制覆盖所有技能工具入口', async () => {
  for (const scenario of [
    { policy: { mode: 'only', skillIds: ['novel-worldbuilding'] }, id: 'novel-pacing' },
    { policy: { mode: 'off', skillIds: [] }, id: 'novel-worldbuilding' },
    { policy: { mode: 'auto', skillIds: [] }, id: 'novel-worldbuilding', enabled: false },
    { policy: { mode: 'auto', skillIds: [] }, id: 'novel-worldbuilding', prompt: '不要使用 novel-worldbuilding' },
    { policy: { mode: 'auto', skillIds: [] }, id: 'browser-cdp' }
  ]) {
    const tools = createSkillTools({ resolveSkill: registry.getSkillById,
      resolveSkillEnabled: () => scenario.enabled !== false,
      allowSkillUse: (skill) => isSkillAllowedByPolicy(skill, scenario.policy, scenario.prompt ?? '')
    })
    for (const tool of tools.filter((tool) => tool.definition.name !== 'skill_list')) {
      const result = await tool.handler({ skill_id: scenario.id, file: 'references/test.md', pattern: '*', script: 'test.js' })
      assert.equal(result.isError, true, `${scenario.policy.mode}/${scenario.id}/${tool.definition.name}`)
      assert.equal(result.loadedSkill, undefined)
    }
  }
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
