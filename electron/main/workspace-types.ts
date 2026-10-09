import type { ReferenceStyleMetric } from './referenceAnalysis'
import type { SkillUsePolicy } from '../shared/assistant-runtime'

export type KnowledgeDocumentSourceType =
  | 'reference-summary'
  | 'reference-chunk'
  | 'workflow-document'
  | 'canon-fact'
  | 'chapter-summary'

export type WorkspaceKnowledgeDocument = {
  id: string
  projectId?: string
  title: string
  sourceType: KnowledgeDocumentSourceType
  sourceLabel: string
  content: string
  summary: string
  keywords: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type WorkspaceReferenceWork = {
  id: string
  title: string
  source: string
  notes: string
  fileName: string
  analysis?: {
    createdAt: string
    fileName: string
    fileType: 'txt' | 'md' | 'docx'
    characterCount: number
    chapterCount: number
    excerpt: string
    topKeywords: string[]
    metrics: ReferenceStyleMetric[]
    overview: string
    sentenceStyle: string
    dialogueRatio: string
    pacingControl: string
    emotionExpression: string
    narrativePerspective: string
    styleRules: string[]
    plotOutline: string
    reusableStylePrompt: string
    avoidRules: string[]
  }
}

export type WorkspaceAiRunKnowledgeItem = {
  documentId: string
  title: string
  sourceType: KnowledgeDocumentSourceType
  sourceLabel: string
  snippet: string
  keywords: string[]
}

export type WorkspaceAiRunStatus = 'running' | 'success' | 'error' | 'canceled'

export type WorkspaceAiRunRecord = {
  id: string
  projectId: string
  chapterId?: string
  task: string
  provider: string
  model: string
  status: WorkspaceAiRunStatus
  startedAt: string
  finishedAt?: string
  durationMs?: number
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    reasoningTokens?: number
    cachedInputTokens?: number
  }
  usedKnowledge: WorkspaceAiRunKnowledgeItem[]
  toolCalls?: Array<{
    tool: string
    args: Record<string, unknown>
    durationMs: number
    status: 'ok' | 'error'
    error?: string
  }>
  repairTriggered: boolean
  error: string
  responsePreview: string
}

export type WorkspaceChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: unknown[]
  editEvents?: unknown[]
  turns?: unknown[]
  isError?: boolean
  isCanceled?: boolean
}

export type WorkspaceGlobalAssistantSession = {
  id: string
  title: string
  messages: WorkspaceChatMessage[]
  proposal: unknown | null
  lastProposalPrompt: string
  lastAssistantReply: string
  createdAt: string
  updatedAt: string
}

export type WorkflowDocumentKey =
  | 'task_plan'
  | 'findings'
  | 'progress'
  | 'current_status'
  | 'novel_setting'
  | 'character_relationships'
  | 'pending_hooks'
  | 'resource_ledger'

export type WorkspacePayload = {
  theme: string
  selectedProjectId: string
  knowledgeDocuments: WorkspaceKnowledgeDocument[]
  referenceWorks: WorkspaceReferenceWork[]
  /** 应用级 AI 调用历史；projectId 为空时表示不关联具体项目。 */
  aiRuns: WorkspaceAiRunRecord[]
  projects: Array<{
    id: string
    title: string
    /** 作品简介；null / 缺失表示旧项目尚未迁移独立字段 */
    premise?: string | null
    genre: string
    novelLength: 'short' | 'long'
    wordCount: string
    lastEdited: string
    cover: string
    targetPlatform: string
    coverHistory: Array<{
      id: string
      createdAt: string
      cover: string
      promptTitle: string
      prompt: string
      summary: string
      keywords: string[]
      genre: string
      targetPlatform: string
      authorName: string
      extraNotes: string
    }>
    writingStylePresetId: string
    writingStylePrompt: string
    novelWorkflowStages: Array<{
      id: 'reference' | 'premise' | 'setting' | 'outline' | 'draft'
      status: 'todo' | 'doing' | 'done'
    }>
    projectSkills: Array<{
      id: string
      name: string
      path: string
      scope?: 'builtin' | 'project'
      description: string
      enabled: boolean
      stageIds: Array<'reference' | 'premise' | 'setting' | 'outline' | 'draft'>
    }>
    skillPolicy: SkillUsePolicy
    chapterAssistantTemplates: Array<{
      id: string
      label: string
      group: 'write' | 'rewrite' | 'planning' | 'reference'
      prompt: string
      mode: 'freeform' | 'polish' | 'continue' | 'suggest' | 'reference'
      length: 'short' | 'medium' | 'long'
      task: 'chat' | 'outline-draft'
      requiresSelection: boolean
    }>
    selectedReferenceWorkIds: string[]
  }>
  workspaces: Record<
    string,
    {
      worldviewEntries: Array<{
        id: string
        type: string
        title: string
        content: string
        sortOrder: number
        createdAt: string
        updatedAt: string
      }>
      characters: Array<{
        id: string
        name: string
        role: string
        description: string
        avatar: string
        tags: Array<{ label: string; tone?: string }>
      }>
      organizations: Array<{
        id: string
        name: string
        type: string
        description: string
        motto: string
        color: string
        sortOrder: number
        createdAt: string
        updatedAt: string
      }>
      characterRelationships: Array<{
        id: string
        fromCharacterId: string
        toCharacterId: string
        type: string
        description: string
        intensity: number
        createdAt: string
        updatedAt: string
      }>
      organizationMemberships: Array<{
        id: string
        characterId: string
        organizationId: string
        role: string
        notes: string
        createdAt: string
        updatedAt: string
      }>
      inspirationEntries: Array<{
        id: string
        type: string
        title: string
        content: string
        tags: string[]
        source: 'ai' | 'manual'
        sortOrder: number
        createdAt: string
        updatedAt: string
      }>
      outlineVolumes: Array<{
        id: string
        title: string
        wordTarget: string
        summary: string
        workflowDocuments?: Array<{
          key: WorkflowDocumentKey
          title: string
          content: string
          updatedAt: string
        }>
      }>
      outlineItems: Array<{
        id: string
        volumeId: string
        title: string
        wordTarget: string
        conflict: string
        summary: string
        relatedCharacterIds?: string[]
        relatedOrganizationIds?: string[]
        relatedWorldviewIds?: string[]
        status: 'idea' | 'planned' | 'drafting' | 'done'
        sortOrder: number
      }>
      chapters: Array<{
        id: string
        outlineItemId: string
        volumeId: string
        sortOrder: number
        title: string
        summary: string
        status: 'draft' | 'review' | 'polish' | 'final'
        wordTarget: string
        content: string
        contentLoaded?: boolean
        contentLength?: number
        contentPreview?: string
        contentEnding?: string
      }>
      chapterVersions: Array<{
        id: string
        chapterId: string
        title: string
        summary: string
        status: 'draft' | 'review' | 'polish' | 'final'
        wordTarget: string
        content: string
        contentLoaded?: boolean
        contentLength?: number
        createdAt: string
      }>
      messages: Array<{
        id: string
        role: 'user' | 'assistant'
        content: string
      }>
      globalAssistantSessions: WorkspaceGlobalAssistantSession[]
      activeGlobalAssistantSessionId: string
      aiRuns: Array<Omit<WorkspaceAiRunRecord, 'projectId'>>
      workflowDocuments: Array<{
        key: WorkflowDocumentKey
        title: string
        content: string
        updatedAt: string
      }>
      plotThreads: Array<{
        id: string
        title: string
        description: string
        openedInChapterId: string
        status: 'open' | 'resolved'
        closedInChapterId: string
        tags: string[]
        createdAt: string
        updatedAt: string
      }>
    }
  >
  appSettings: {
    provider: string
    model: string
    apiKey: string
    baseUrl: string
    apiProtocol?: 'auto' | 'openai-responses' | 'openai-chat' | 'anthropic'
    codexCliPath?: string
    codexReasoningEffort?: 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
    proxyUrl: string
    temperature?: number
    topP?: number
    presencePenalty?: number
    frequencyPenalty?: number
    aiProfiles: Array<{
      id: string
      name: string
      provider: string
      baseUrl: string
      apiKey: string
      model: string
      apiProtocol?: 'auto' | 'openai-responses' | 'openai-chat' | 'anthropic'
      codexCliPath?: string
      codexReasoningEffort?: 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
      temperature?: number
      topP?: number
      presencePenalty?: number
      frequencyPenalty?: number
    }>
    activeAiProfileId: string
    imageProvider: string
    imageModel: string
    imageApiKey: string
    imageBaseUrl: string
    autoSaveInterval: string
    editorFont: string
    uiScale: number
    workspaceMenuOrder: string[]
    darkMode: boolean
    darkModeStyle: string
  }
  coverWorkbenchHistory: Array<{
    id: string
    createdAt: string
    cover: string
    promptTitle: string
    prompt: string
    summary: string
    keywords: string[]
    genre: string
    targetPlatform: string
    authorName: string
    extraNotes: string
  }>
}

export type LegacyWorkspacePayload = Omit<WorkspacePayload, 'workspaces' | 'aiRuns'> & {
  aiRuns?: WorkspaceAiRunRecord[]
  worldviewEntries?: Array<{
    id: string
    type: string
    title: string
    content: string
    sortOrder?: number
    createdAt?: string
    updatedAt?: string
  }>
  characters?: Array<{
    id: string
    name: string
    role: string
    description: string
    avatar: string
    tags: Array<{ label: string; tone?: string }>
  }>
  organizations?: Array<{
    id: string
    name: string
    type: string
    description: string
    motto: string
    color: string
    sortOrder?: number
    createdAt?: string
    updatedAt?: string
  }>
  characterRelationships?: Array<{
    id: string
    fromCharacterId: string
    toCharacterId: string
    type: string
    description: string
    intensity?: number
    createdAt?: string
    updatedAt?: string
  }>
  organizationMemberships?: Array<{
    id: string
    characterId: string
    organizationId: string
    role: string
    notes?: string
    createdAt?: string
    updatedAt?: string
  }>
  inspirationEntries?: Array<{
    id: string
    type: string
    title: string
    content: string
    tags: string[]
    source?: 'ai' | 'manual'
    sortOrder?: number
    createdAt?: string
    updatedAt?: string
  }>
  outlineVolumes?: Array<{
    id: string
    title: string
    wordTarget: string
    summary: string
  }>
  outlineItems?: Array<{
    id: string
    volumeId?: string
    title: string
    wordTarget: string
    conflict: string
    summary: string
    relatedCharacterIds?: string[]
    relatedOrganizationIds?: string[]
    relatedWorldviewIds?: string[]
    status?: 'idea' | 'planned' | 'drafting' | 'done'
    sortOrder?: number
  }>
  chapters?: Array<{
    id: string
    outlineItemId?: string
    volumeId?: string
    sortOrder?: number
    title: string
    summary: string
    status: 'draft' | 'review' | 'polish' | 'final'
    wordTarget: string
    content: string
  }>
  chapterVersions?: Array<{
    id: string
    chapterId: string
    title: string
    summary: string
    status: 'draft' | 'review' | 'polish' | 'final'
    wordTarget: string
    content: string
    createdAt: string
  }>
  messages?: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
  }>
}

function normalizeApiProtocol(
  value: unknown
): 'auto' | 'openai-responses' | 'openai-chat' | 'anthropic' {
  return value === 'openai-responses' || value === 'openai-chat' || value === 'anthropic'
    ? value
    : 'auto'
}

function normalizeCodexReasoningEffort(
  value: unknown
): 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' {
  return typeof value === 'string'
    && ['default', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value)
    ? value as 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
    : 'default'
}

export function normalizeAppSettings(
  settings?: Partial<WorkspacePayload['appSettings']> | null
): WorkspacePayload['appSettings'] {
  const uiScale =
    settings?.uiScale !== undefined && Number.isFinite(settings.uiScale)
      ? Math.min(1.75, Math.max(0.75, settings.uiScale))
      : 1
  const temperature =
    typeof settings?.temperature === 'number' && Number.isFinite(settings.temperature)
      ? Math.min(2, Math.max(0, settings.temperature))
      : undefined
  const topP =
    typeof settings?.topP === 'number' && Number.isFinite(settings.topP)
      ? Math.min(1, Math.max(0, settings.topP))
      : undefined
  const presencePenalty =
    typeof settings?.presencePenalty === 'number' && Number.isFinite(settings.presencePenalty)
      ? Math.min(2, Math.max(-2, settings.presencePenalty))
      : undefined
  const frequencyPenalty =
    typeof settings?.frequencyPenalty === 'number' && Number.isFinite(settings.frequencyPenalty)
      ? Math.min(2, Math.max(-2, settings.frequencyPenalty))
      : undefined

  const aiProfiles = Array.isArray(settings?.aiProfiles)
    ? settings.aiProfiles
        .filter((item): item is NonNullable<typeof settings.aiProfiles>[number] => !!item && typeof item === 'object')
        .map((item) => ({
          id: String(item.id ?? '').trim(),
          name: String(item.name ?? '').trim(),
          provider: String(item.provider ?? '').trim(),
          baseUrl: String(item.baseUrl ?? '').trim(),
          apiKey: String(item.apiKey ?? '').trim(),
          model: String(item.model ?? '').trim(),
          apiProtocol: normalizeApiProtocol(item.apiProtocol),
          codexCliPath: typeof item.codexCliPath === 'string' ? item.codexCliPath.trim() : '',
          codexReasoningEffort: normalizeCodexReasoningEffort(item.codexReasoningEffort),
          temperature:
            typeof item.temperature === 'number' && Number.isFinite(item.temperature)
              ? Math.min(2, Math.max(0, item.temperature))
              : undefined,
          topP:
            typeof item.topP === 'number' && Number.isFinite(item.topP)
              ? Math.min(1, Math.max(0, item.topP))
              : undefined,
          presencePenalty:
            typeof item.presencePenalty === 'number' && Number.isFinite(item.presencePenalty)
              ? Math.min(2, Math.max(-2, item.presencePenalty))
              : undefined,
          frequencyPenalty:
            typeof item.frequencyPenalty === 'number' && Number.isFinite(item.frequencyPenalty)
              ? Math.min(2, Math.max(-2, item.frequencyPenalty))
              : undefined
        }))
        .filter((item) => item.id)
    : []
  const requestedActiveProfileId = typeof settings?.activeAiProfileId === 'string'
    ? settings.activeAiProfileId.trim()
    : ''
  const activeAiProfileId = aiProfiles.some((item) => item.id === requestedActiveProfileId)
    ? requestedActiveProfileId
    : aiProfiles[0]?.id ?? ''
  const activeProfile = aiProfiles.find((item) => item.id === activeAiProfileId)

  return {
    provider: activeProfile?.provider || settings?.provider || 'openai-compatible',
    model: activeProfile?.model ?? settings?.model ?? '',
    apiKey: activeProfile?.apiKey ?? settings?.apiKey ?? '',
    baseUrl: activeProfile?.baseUrl ?? settings?.baseUrl ?? '',
    apiProtocol: activeProfile?.apiProtocol ?? normalizeApiProtocol(settings?.apiProtocol),
    codexCliPath: activeProfile?.codexCliPath
      ?? (typeof settings?.codexCliPath === 'string' ? settings.codexCliPath.trim() : ''),
    codexReasoningEffort: activeProfile?.codexReasoningEffort
      ?? normalizeCodexReasoningEffort(settings?.codexReasoningEffort),
    proxyUrl: settings?.proxyUrl || '',
    temperature: activeProfile?.temperature ?? temperature,
    topP: activeProfile?.topP ?? topP,
    presencePenalty: activeProfile?.presencePenalty ?? presencePenalty,
    frequencyPenalty: activeProfile?.frequencyPenalty ?? frequencyPenalty,
    aiProfiles,
    activeAiProfileId,
    imageProvider: settings?.imageProvider || '',
    imageModel: settings?.imageModel || '',
    imageApiKey: settings?.imageApiKey || '',
    imageBaseUrl: settings?.imageBaseUrl || '',
    autoSaveInterval: settings?.autoSaveInterval || '5m',
    editorFont:
      typeof settings?.editorFont === 'string'
      && ['clear-mono', 'modern-sans', 'classic-serif', 'relaxed-kai', 'system'].includes(settings.editorFont)
        ? settings.editorFont
        : 'clear-mono',
    uiScale,
    workspaceMenuOrder: Array.isArray(settings?.workspaceMenuOrder)
      ? [...new Set(settings.workspaceMenuOrder
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean))]
      : [],
    darkMode: Boolean(settings?.darkMode),
    darkModeStyle:
      settings?.darkModeStyle === 'nord'
        ? settings.darkModeStyle
        : 'nord'
  }
}

export function mergeAppSettingsIntoWorkspaceSnapshot(
  snapshot: WorkspacePayload | null,
  settings: Partial<WorkspacePayload['appSettings']>,
  metadata: { theme: string; selectedProjectId: string }
): WorkspacePayload | null {
  if (!snapshot) return null

  return {
    ...snapshot,
    theme: metadata.theme,
    selectedProjectId: metadata.selectedProjectId,
    appSettings: normalizeAppSettings(settings)
  }
}

export function createFallbackVolume(title = '故事开端', volumeId = 'volume-legacy-default') {
  return {
    id: volumeId,
    title,
    wordTarget: '目标 5万字',
    summary: '用于承载当前项目的默认分卷。'
  }
}

export function normalizeProjectRecord(
  project: Partial<WorkspacePayload['projects'][number]> & { id: string }
): WorkspacePayload['projects'][number] {
  return {
    id: project.id,
    title: project.title || '未命名作品',
    premise: typeof project.premise === 'string' ? project.premise.trim() : undefined,
    genre: project.genre || '未分类',
    novelLength: project.novelLength === 'short' ? 'short' : 'long',
    wordCount: project.wordCount || '待统计',
    lastEdited: project.lastEdited || '',
    cover: project.cover || 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
    targetPlatform: project.targetPlatform || '',
    coverHistory: Array.isArray(project.coverHistory) ? project.coverHistory : [],
    writingStylePresetId: project.writingStylePresetId || 'cinematic-cool',
    writingStylePrompt: project.writingStylePrompt || '',
    novelWorkflowStages: Array.isArray(project.novelWorkflowStages) ? project.novelWorkflowStages : [],
    projectSkills: Array.isArray(project.projectSkills) ? project.projectSkills : [],
    skillPolicy: normalizeWorkspaceSkillPolicy(project.skillPolicy),
    chapterAssistantTemplates: Array.isArray(project.chapterAssistantTemplates) ? project.chapterAssistantTemplates : [],
    selectedReferenceWorkIds: Array.isArray(project.selectedReferenceWorkIds)
      ? project.selectedReferenceWorkIds.map((id) => String(id).trim()).filter(Boolean)
      : []
  }
}

function normalizeWorkspaceSkillPolicy(value: unknown): SkillUsePolicy {
  if (!value || typeof value !== 'object') return { mode: 'auto', skillIds: [] }
  const raw = value as { mode?: unknown; skillIds?: unknown }
  const mode = raw.mode === 'only' || raw.mode === 'off' ? raw.mode : 'auto'
  const skillIds = Array.isArray(raw.skillIds)
    ? [...new Set(raw.skillIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
    : []
  return { mode, skillIds }
}

export function normalizeCoverWorkbenchHistory(
  items?: unknown
): WorkspacePayload['coverWorkbenchHistory'] {
  if (!Array.isArray(items)) return []
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: String(item.id ?? ''),
      createdAt: String(item.createdAt ?? ''),
      cover: String(item.cover ?? ''),
      promptTitle: String(item.promptTitle ?? ''),
      prompt: String(item.prompt ?? ''),
      summary: String(item.summary ?? ''),
      keywords: Array.isArray(item.keywords)
        ? item.keywords.map((k) => String(k)).filter(Boolean)
        : [],
      genre: String(item.genre ?? ''),
      targetPlatform: String(item.targetPlatform ?? ''),
      authorName: String(item.authorName ?? ''),
      extraNotes: String(item.extraNotes ?? '')
    }))
    .filter((item) => item.id)
}

export function normalizeWorkspacePayload(payload: WorkspacePayload | LegacyWorkspacePayload): WorkspacePayload {
  if ('workspaces' in payload && payload.workspaces) {
    const workspaceAiRuns = Object.entries(payload.workspaces).flatMap(([projectId, workspace]) =>
      (workspace.aiRuns ?? []).map((run) => ({ ...run, projectId }))
    )
    const payloadAiRuns = Array.isArray((payload as WorkspacePayload).aiRuns)
      ? (payload as WorkspacePayload).aiRuns
      : []
    const globalAiRuns = Array.from(
      new Map([...workspaceAiRuns, ...payloadAiRuns].map((run) => [run.id, run])).values()
    )
    return {
      ...payload,
      aiRuns: globalAiRuns,
      workspaces: Object.fromEntries(
        Object.entries(payload.workspaces).map(([projectId, workspace]) => [
          projectId,
          {
            ...workspace,
            chapters: workspace.chapters.map((chapter, index) => ({
              ...chapter,
              sortOrder: Number.isSafeInteger(chapter.sortOrder)
                ? chapter.sortOrder
                : (index + 1) * 1024
            })),
            aiRuns: []
          }
        ])
      ),
      projects: payload.projects.map((project) => normalizeProjectRecord(project)),
      knowledgeDocuments: Array.isArray((payload as WorkspacePayload).knowledgeDocuments)
        ? (payload as WorkspacePayload).knowledgeDocuments
        : [],
      referenceWorks: Array.isArray((payload as WorkspacePayload).referenceWorks)
        ? (payload as WorkspacePayload).referenceWorks
        : [],
      appSettings: normalizeAppSettings(payload.appSettings),
      coverWorkbenchHistory: normalizeCoverWorkbenchHistory(
        (payload as WorkspacePayload).coverWorkbenchHistory
      )
    }
  }

  const legacyPayload = payload as LegacyWorkspacePayload
  const normalizedTimestamp = new Date().toISOString()
  const projects = legacyPayload.projects?.length ? legacyPayload.projects.map((project) => normalizeProjectRecord(project)) : []
  const selectedProjectId = legacyPayload.selectedProjectId || projects[0]?.id || 'project-1'
  const workspaces = Object.fromEntries(
    projects.map((project) => [
      project.id,
      {
        outlineVolumes:
          project.id === selectedProjectId
            ? legacyPayload.outlineVolumes?.length
              ? legacyPayload.outlineVolumes
              : [createFallbackVolume()]
            : [],
        worldviewEntries:
          project.id === selectedProjectId
            ? (legacyPayload.worldviewEntries ?? []).map((entry, index) => ({
                ...entry,
                sortOrder: entry.sortOrder ?? index,
                createdAt: entry.createdAt || normalizedTimestamp,
                updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
              }))
            : [],
        characters: project.id === selectedProjectId ? legacyPayload.characters ?? [] : [],
        organizations:
          project.id === selectedProjectId
            ? (legacyPayload.organizations ?? []).map((entry, index) => ({
                ...entry,
                sortOrder: entry.sortOrder ?? index,
                createdAt: entry.createdAt || normalizedTimestamp,
                updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
              }))
            : [],
        characterRelationships:
          project.id === selectedProjectId
            ? (legacyPayload.characterRelationships ?? []).map((entry) => ({
                ...entry,
                intensity: Number.isFinite(entry.intensity) ? Math.min(100, Math.max(0, entry.intensity ?? 50)) : 50,
                createdAt: entry.createdAt || normalizedTimestamp,
                updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
              }))
            : [],
        organizationMemberships:
          project.id === selectedProjectId
            ? (legacyPayload.organizationMemberships ?? []).map((entry) => ({
                ...entry,
                notes: entry.notes ?? '',
                createdAt: entry.createdAt || normalizedTimestamp,
                updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
              }))
            : [],
        inspirationEntries:
          project.id === selectedProjectId
            ? (legacyPayload.inspirationEntries ?? []).map((entry, index) => ({
                ...entry,
                tags: Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
                source: (entry.source === 'manual' ? 'manual' : 'ai') as 'ai' | 'manual',
                sortOrder: entry.sortOrder ?? index,
                createdAt: entry.createdAt || normalizedTimestamp,
                updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
              }))
            : [],
        outlineItems:
          project.id === selectedProjectId
            ? (legacyPayload.outlineItems ?? []).map((item, index) => ({
                ...item,
                volumeId: item.volumeId || legacyPayload.outlineVolumes?.[0]?.id || 'volume-legacy-default',
                status: item.status || 'planned',
                sortOrder: item.sortOrder ?? index
              }))
            : [],
        chapters:
          project.id === selectedProjectId
            ? (legacyPayload.chapters ?? []).map((chapter, index) => ({
                ...chapter,
                outlineItemId: chapter.outlineItemId || '',
                volumeId: chapter.volumeId || legacyPayload.outlineVolumes?.[0]?.id || 'volume-legacy-default',
                sortOrder: chapter.sortOrder ?? (index + 1) * 1024
              }))
            : [],
        chapterVersions: project.id === selectedProjectId ? legacyPayload.chapterVersions ?? [] : [],
        messages: project.id === selectedProjectId ? legacyPayload.messages ?? [] : [],
        globalAssistantSessions: [],
        activeGlobalAssistantSessionId: '',
        aiRuns: [],
        workflowDocuments: [],
        plotThreads: []
      }
    ])
  )

  return {
    theme: legacyPayload.theme,
    selectedProjectId,
    knowledgeDocuments: [],
    referenceWorks: [],
    aiRuns: Array.isArray(legacyPayload.aiRuns)
      ? legacyPayload.aiRuns.map((run) => ({
          ...run,
          projectId: run.projectId || selectedProjectId
        }))
      : [],
    projects,
    workspaces,
    appSettings: normalizeAppSettings(legacyPayload.appSettings),
    coverWorkbenchHistory: normalizeCoverWorkbenchHistory(
      (legacyPayload as { coverWorkbenchHistory?: unknown }).coverWorkbenchHistory
    )
  }
}
