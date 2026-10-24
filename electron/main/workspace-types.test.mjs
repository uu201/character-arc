import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(candidate)) return nextResolve(candidate.href, context)
    }
    return nextResolve(specifier, context)
  }
})

const { mergeAppSettingsIntoWorkspaceSnapshot, normalizeAppSettings, normalizeWorkspacePayload } = await import('./workspace-types.ts')

test('导入旧归档的跨卷错序章节时同步修复数组顺序和排序值', () => {
  const chapters = [
    { id: 'new-61', volumeId: 'v3', sortOrder: 0, title: '第61章', content: '新正文' },
    { id: 'old-b', volumeId: 'v1', sortOrder: 1024, title: '第2章', content: '旧正文二' },
    { id: 'old-a', volumeId: 'v1', sortOrder: 2048, title: '第1章', content: '旧正文一' }
  ]
  const payload = {
    projects: [{ id: 'p', title: '旧工程' }],
    workspaces: { p: { chapters, outlineVolumes: [{ id: 'v1' }, { id: 'v3' }] } }
  }
  const result = normalizeWorkspacePayload(payload).workspaces.p.chapters
  assert.deepEqual(result.map(item => item.id), ['old-b', 'old-a', 'new-61'])
  assert.deepEqual(result.map(item => item.sortOrder), [1024, 2048, 3072])
  assert.equal(result[2].title, '第61章')
  assert.equal(result[2].content, '新正文')
  assert.deepEqual(chapters.map(item => item.id), ['new-61', 'old-b', 'old-a'])
})

test('旧扁平工程迁移时同样恢复分卷顺序', () => {
  const result = normalizeWorkspacePayload({
    selectedProjectId: 'p', projects: [{ id: 'p', title: '旧工程' }],
    outlineVolumes: [{ id: 'v1' }, { id: 'v2' }],
    chapters: [
      { id: 'new', volumeId: 'v2', sortOrder: 0, content: '新增正文' },
      { id: 'old', volumeId: 'v1', sortOrder: 1024, content: '旧正文' }
    ]
  }).workspaces.p.chapters
  assert.deepEqual(result.map(item => item.id), ['old', 'new'])
  assert.ok(result[1].sortOrder > result[0].sortOrder)
})

test('采样惩罚参数按 -2 到 2 规范化，缺失值保持为空', () => {
  const normalized = normalizeAppSettings({
    presencePenalty: 4,
    frequencyPenalty: -4
  })
  assert.equal(normalized.presencePenalty, 2)
  assert.equal(normalized.frequencyPenalty, -2)
  assert.equal(normalizeAppSettings({}).presencePenalty, undefined)
})

test('保存 AI 设置时刷新内存快照并保留未落盘的工作区数据', () => {
  const workspaceMarker = { unsaved: true }
  const snapshot = {
    theme: 'ocean',
    selectedProjectId: 'project-old',
    projects: [],
    workspaces: { 'project-old': workspaceMarker },
    knowledgeDocuments: [],
    referenceWorks: [],
    coverWorkbenchHistory: [],
    appSettings: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'old-key',
      baseUrl: 'https://api.deepseek.com/v1',
      proxyUrl: '',
      aiProfiles: [],
      activeAiProfileId: '',
      imageProvider: '',
      imageModel: '',
      imageApiKey: '',
      imageBaseUrl: '',
      autoSaveInterval: '5m',
      editorFont: 'clear-mono',
      uiScale: 1,
      darkMode: false,
      darkModeStyle: 'standard'
    }
  }

  const merged = mergeAppSettingsIntoWorkspaceSnapshot(snapshot, {
    ...snapshot.appSettings,
    provider: 'opencode-zen',
    model: 'gpt-5.6-sol',
    apiKey: 'new-key',
    baseUrl: 'https://opencode.ai/zen/v1',
    apiProtocol: 'openai-responses',
    proxyUrl: 'http://127.0.0.1:7890'
  }, {
    theme: 'forest',
    selectedProjectId: 'project-old'
  })

  assert.equal(merged.appSettings.provider, 'opencode-zen')
  assert.equal(merged.appSettings.model, 'gpt-5.6-sol')
  assert.equal(merged.appSettings.apiProtocol, 'openai-responses')
  assert.equal(merged.appSettings.proxyUrl, 'http://127.0.0.1:7890')
  assert.equal(merged.theme, 'forest')
  assert.equal(merged.workspaces['project-old'], workspaceMarker)
  assert.equal(snapshot.appSettings.model, 'deepseek-chat')
})

test('旧 AI 设置和配置档案缺少协议时迁移为 auto', () => {
  const snapshot = {
    theme: 'ocean',
    selectedProjectId: '',
    projects: [],
    workspaces: {},
    knowledgeDocuments: [],
    referenceWorks: [],
    coverWorkbenchHistory: [],
    appSettings: {
      provider: 'opencode-zen',
      model: 'deepseek-v4-flash-free',
      apiKey: 'key',
      baseUrl: 'https://opencode.ai/zen/v1',
      proxyUrl: '',
      aiProfiles: [{
        id: 'profile-1',
        name: 'OpenCode',
        provider: 'opencode-zen',
        baseUrl: 'https://opencode.ai/zen/v1',
        apiKey: 'key',
        model: 'deepseek-v4-flash-free'
      }],
      activeAiProfileId: 'profile-1',
      imageProvider: '',
      imageModel: '',
      imageApiKey: '',
      imageBaseUrl: '',
      autoSaveInterval: '5m',
      editorFont: 'clear-mono',
      uiScale: 1,
      darkMode: false,
      darkModeStyle: 'nord'
    }
  }

  const merged = mergeAppSettingsIntoWorkspaceSnapshot(snapshot, snapshot.appSettings, {
    theme: 'ocean',
    selectedProjectId: ''
  })

  assert.equal(merged.appSettings.apiProtocol, 'auto')
  assert.equal(merged.appSettings.aiProfiles[0].apiProtocol, 'auto')
})

test('Codex CLI 路径和推理强度随配置档案持久化', () => {
  const normalized = normalizeAppSettings({
    provider: 'codex-cli',
    model: 'default',
    codexCliPath: ' /opt/homebrew/bin/codex ',
    codexReasoningEffort: 'high',
    activeAiProfileId: 'profile-codex',
    aiProfiles: [{
      id: 'profile-codex',
      name: 'Codex CLI',
      provider: 'codex-cli',
      baseUrl: '',
      apiKey: '',
      model: 'default',
      codexCliPath: ' /opt/homebrew/bin/codex ',
      codexReasoningEffort: 'xhigh'
    }]
  })

  assert.equal(normalized.codexCliPath, '/opt/homebrew/bin/codex')
  assert.equal(normalized.codexReasoningEffort, 'xhigh')
  assert.equal(normalized.aiProfiles[0].codexCliPath, '/opt/homebrew/bin/codex')
  assert.equal(normalized.aiProfiles[0].codexReasoningEffort, 'xhigh')
})

test('活动配置缺失时自动激活首个档案并同步运行模型', () => {
  const normalized = normalizeAppSettings({
    provider: 'openai-compatible',
    model: '',
    apiKey: '',
    baseUrl: '',
    activeAiProfileId: '',
    aiProfiles: [{
      id: 'profile-codex',
      name: '我的Codex',
      provider: 'codex-cli',
      baseUrl: '',
      apiKey: '',
      model: 'gpt-5.6-luna',
      codexCliPath: '/opt/homebrew/bin/codex',
      codexReasoningEffort: 'high'
    }]
  })

  assert.equal(normalized.activeAiProfileId, 'profile-codex')
  assert.equal(normalized.provider, 'codex-cli')
  assert.equal(normalized.model, 'gpt-5.6-luna')
  assert.equal(normalized.codexCliPath, '/opt/homebrew/bin/codex')
  assert.equal(normalized.codexReasoningEffort, 'high')
})

test('工作台菜单顺序按应用设置保存并清理重复值', () => {
  const normalized = normalizeWorkspacePayload({
    theme: 'ocean',
    selectedProjectId: '',
    projects: [],
    workspaces: {},
    knowledgeDocuments: [],
    referenceWorks: [],
    coverWorkbenchHistory: [],
    appSettings: {
      workspaceMenuOrder: ['chapters', 'overview', 'chapters', '  outline  ', '']
    }
  })

  assert.deepEqual(normalized.appSettings.workspaceMenuOrder, ['chapters', 'overview', 'outline'])
})

test('全局 AI 日志会合并旧项目级记录并按 ID 去重', () => {
  const legacyRun = {
    id: 'run-legacy',
    chapterId: '',
    task: 'chapter-first-draft',
    provider: 'deepseek',
    model: 'deepseek-chat',
    status: 'success',
    startedAt: '2026-08-01T00:00:00.000Z',
    usedKnowledge: [],
    repairTriggered: false,
    error: '',
    responsePreview: '旧记录'
  }
  const globalRun = {
    ...legacyRun,
    projectId: 'project-1',
    responsePreview: '全局记录'
  }

  const normalized = normalizeWorkspacePayload({
    theme: 'ocean',
    selectedProjectId: 'project-1',
    projects: [],
    workspaces: {
      'project-1': { aiRuns: [legacyRun] }
    },
    knowledgeDocuments: [],
    referenceWorks: [],
    aiRuns: [globalRun],
    coverWorkbenchHistory: [],
    appSettings: {}
  })

  assert.equal(normalized.aiRuns.length, 1)
  assert.equal(normalized.aiRuns[0].projectId, 'project-1')
  assert.equal(normalized.aiRuns[0].responsePreview, '全局记录')
  assert.deepEqual(normalized.workspaces['project-1'].aiRuns, [])
})
