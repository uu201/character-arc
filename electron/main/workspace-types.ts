import type { ReferenceStyleMetric } from './referenceAnalysis'

export type KnowledgeDocumentSourceType =
  | 'reference-summary'
  | 'reference-chunk'
  | 'workflow-document'
  | 'canon-fact'
  | 'chapter-summary'

export type WorkspaceKnowledgeDocument = {
  id: string
  projectId: string
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
  usedKnowledge: WorkspaceAiRunKnowledgeItem[]
  repairTriggered: boolean
  error: string
  responsePreview: string
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
  projects: Array<{
    id: string
    title: string
    genre: string
    novelLength: 'short' | 'long'
    wordCount: string
    lastEdited: string
    cover: string
    targetPlatform: string
    referenceWorks: Array<{
      id: string
      title: string
      source: string
      notes: string
      fileName?: string
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
      description: string
      enabled: boolean
      stageIds: Array<'reference' | 'premise' | 'setting' | 'outline' | 'draft'>
    }>
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
        status: 'idea' | 'planned' | 'drafting' | 'done'
        sortOrder: number
      }>
      chapters: Array<{
        id: string
        outlineItemId: string
        volumeId: string
        title: string
        summary: string
        status: 'draft' | 'review' | 'polish' | 'final'
        wordTarget: string
        content: string
      }>
      chapterVersions: Array<{
        id: string
        chapterId: string
        title: string
        summary: string
        status: 'draft' | 'review' | 'polish' | 'final'
        wordTarget: string
        content: string
        createdAt: string
      }>
      messages: Array<{
        id: string
        role: 'user' | 'assistant'
        content: string
      }>
      knowledgeDocuments: Array<Omit<WorkspaceKnowledgeDocument, 'projectId'>>
      aiRuns: Array<Omit<WorkspaceAiRunRecord, 'projectId'>>
      workflowDocuments: Array<{
        key: WorkflowDocumentKey
        title: string
        content: string
        updatedAt: string
      }>
    }
  >
  appSettings: {
    provider: string
    model: string
    apiKey: string
    baseUrl: string
    autoSaveInterval: string
    uiScale: number
    darkMode: boolean
  }
}

export type LegacyWorkspacePayload = Omit<WorkspacePayload, 'workspaces'> & {
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
    status?: 'idea' | 'planned' | 'drafting' | 'done'
    sortOrder?: number
  }>
  chapters?: Array<{
    id: string
    outlineItemId?: string
    volumeId?: string
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

export function normalizeAppSettings(
  settings?: Partial<WorkspacePayload['appSettings']> | null
): WorkspacePayload['appSettings'] {
  const uiScale =
    settings?.uiScale !== undefined && Number.isFinite(settings.uiScale)
      ? Math.min(1.75, Math.max(0.75, settings.uiScale))
      : 1

  return {
    provider: settings?.provider || 'deepseek',
    model: settings?.model || 'deepseek-chat',
    apiKey: settings?.apiKey || 'sk-1234567890abcdef',
    baseUrl: settings?.baseUrl || 'https://api.deepseek.com/v1',
    autoSaveInterval: settings?.autoSaveInterval || '5m',
    uiScale,
    darkMode: Boolean(settings?.darkMode)
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
    genre: project.genre || '未分类',
    novelLength: project.novelLength === 'short' ? 'short' : 'long',
    wordCount: project.wordCount || '待统计',
    lastEdited: project.lastEdited || '刚刚更新',
    cover: project.cover || 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
    targetPlatform: project.targetPlatform || '',
    referenceWorks: Array.isArray(project.referenceWorks) ? project.referenceWorks : [],
    writingStylePresetId: project.writingStylePresetId || 'cinematic-cool',
    writingStylePrompt: project.writingStylePrompt || '',
    novelWorkflowStages: Array.isArray(project.novelWorkflowStages) ? project.novelWorkflowStages : [],
    projectSkills: Array.isArray(project.projectSkills) ? project.projectSkills : [],
    chapterAssistantTemplates: Array.isArray(project.chapterAssistantTemplates) ? project.chapterAssistantTemplates : []
  }
}

export function normalizeWorkspacePayload(payload: WorkspacePayload | LegacyWorkspacePayload): WorkspacePayload {
  if ('workspaces' in payload && payload.workspaces) {
    return {
      ...payload,
      projects: payload.projects.map((project) => normalizeProjectRecord(project)),
      appSettings: normalizeAppSettings(payload.appSettings)
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
            ? (legacyPayload.chapters ?? []).map((chapter) => ({
                ...chapter,
                outlineItemId: chapter.outlineItemId || '',
                volumeId: chapter.volumeId || legacyPayload.outlineVolumes?.[0]?.id || 'volume-legacy-default'
              }))
            : [],
        chapterVersions: project.id === selectedProjectId ? legacyPayload.chapterVersions ?? [] : [],
        messages: project.id === selectedProjectId ? legacyPayload.messages ?? [] : [],
        knowledgeDocuments: [],
        aiRuns: [],
        workflowDocuments: []
      }
    ])
  )

  return {
    theme: legacyPayload.theme,
    selectedProjectId,
    projects,
    workspaces,
    appSettings: normalizeAppSettings(legacyPayload.appSettings)
  }
}
