import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeAppSettingsIntoWorkspaceSnapshot, normalizeWorkspacePayload } from './workspace-types.ts'

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
