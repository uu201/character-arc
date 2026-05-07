import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'

import type { ReferenceStyleAnalysisResult, ReferenceStyleChunkResult } from './ai/shared-types'
import { registerAiIpcHandlers } from './ai/ipc'
import {
  type ReferenceNovelLocalContext,
  type ReferenceStyleMetric
} from './referenceAnalysis'
import { registerMainIpcHandlers } from './register-main-ipc'
import { initRegistry as initSkillRegistry } from './ai/skills'
import { createWindowManager, type AssistantPromptPayload } from './window-manager'
import {
  type LegacyWorkspacePayload,
  type WorkspaceAiRunRecord,
  type WorkspaceKnowledgeDocument,
  type WorkspacePayload,
  normalizeWorkspacePayload
} from './workspace-types'
import { ensureWorkspaceDb, readWorkspaceSnapshot, writeWorkspaceSnapshot } from './workspace-store'

/** 主窗口向助手窗口推送的上下文载荷 */
type AssistantContextPayload = {
  selectedProjectId?: string
  selectedChapterId?: string
  currentChapterSelection?: {
    chapterId: string
    text: string
  } | null
  activeAgentProposal?: import('../../renderer/src/types/app').AgentProposal | null
  agentConfirmationState?: import('../../renderer/src/types/app').AgentConfirmationState | null
  agentExecutionStep?: import('../../renderer/src/types/app').AgentExecutionStep
  agentIntentState?: import('../../renderer/src/types/app').AgentIntentKind
}

type ReferenceImportProgressPayload = {
  phase: 'extracting' | 'chunking' | 'chunk-analysis' | 'aggregating' | 'saving' | 'done'
  message: string
  current: number
  total: number
  percent: number
  sourceTitle?: string
}

type WorkspaceAiRunEventPayload = {
  projectId: string
  meta: Omit<WorkspaceAiRunRecord, 'projectId'>
}

let latestWorkspaceSnapshot: WorkspacePayload | null = null
let latestAssistantContext: AssistantContextPayload = {}
let latestAssistantPrompt: AssistantPromptPayload | null = null

const windowManager = createWindowManager({
  getLatestAssistantContext: () => latestAssistantContext,
  getLatestAssistantPrompt: () => latestAssistantPrompt
})

function updateLatestWorkspaceSnapshot(payload: WorkspacePayload | null): void {
  latestWorkspaceSnapshot = payload
}

function appendAiRunToLatestSnapshot(payload: WorkspaceAiRunEventPayload): void {
  if (!latestWorkspaceSnapshot?.workspaces?.[payload.projectId]) {
    return
  }

  const workspace = latestWorkspaceSnapshot.workspaces[payload.projectId]
  workspace.aiRuns = [...(workspace.aiRuns ?? []), payload.meta].slice(-200)
}

function emitAiRunEvent(payload: WorkspaceAiRunEventPayload): void {
  appendAiRunToLatestSnapshot(payload)
  windowManager.broadcastWindowEvent('characterarc:ai-run-event', payload)
}

function buildImportedReferenceKnowledgeDocuments(
  projectId: string,
  title: string,
  localContext: ReferenceNovelLocalContext,
  analysis: ReferenceStyleAnalysisResult,
  importedAt: string
): WorkspaceKnowledgeDocument[] {
  const summaryDocument: WorkspaceKnowledgeDocument = {
    id: `knowledge-reference-summary-${randomUUID()}`,
    projectId,
    title: `${title}｜拆书总纲`,
    sourceType: 'reference-summary',
    sourceLabel: localContext.fileName,
    content: [
      `作品：${title}`,
      `风格总述：${analysis.overview}`,
      `句式特征：${analysis.sentenceStyle}`,
      `对白策略：${analysis.dialogueRatio}`,
      `节奏控制：${analysis.pacingControl}`,
      `情绪表达：${analysis.emotionExpression}`,
      `叙事视角：${analysis.narrativePerspective}`,
      localContext.topKeywords.length ? `关键词：${localContext.topKeywords.join('、')}` : '',
      analysis.styleRules.length ? `风格规则：${analysis.styleRules.join('；')}` : '',
      analysis.avoidRules.length ? `避免照搬：${analysis.avoidRules.join('；')}` : '',
      `剧情骨架：${analysis.plotOutline}`,
      `仿写模板：${analysis.reusableStylePrompt}`
    ]
      .filter(Boolean)
      .join('\n'),
    summary: analysis.overview,
    keywords: Array.from(new Set([...localContext.topKeywords, ...analysis.styleRules])).slice(0, 20),
    metadata: {
      sourceTitle: title,
      fileName: localContext.fileName,
      fileType: localContext.fileType,
      characterCount: localContext.characterCount,
      chapterCount: localContext.chapterCount,
      metrics: localContext.metrics,
      styleRules: analysis.styleRules,
      avoidRules: analysis.avoidRules
    },
    createdAt: importedAt,
    updatedAt: importedAt
  }

  const chunkDocuments = localContext.analysisChunks.map((chunk) => ({
    id: `knowledge-reference-chunk-${randomUUID()}`,
    projectId,
    title: `${title}｜${chunk.label}`,
    sourceType: 'reference-chunk' as const,
    sourceLabel: `${localContext.fileName} / ${chunk.label}`,
    content: chunk.text,
    summary: `${chunk.label}，约 ${chunk.characterCount} 字；关键词：${chunk.topKeywords.join('、') || '待补充'}`,
    keywords: chunk.topKeywords,
    metadata: {
      sourceTitle: title,
      fileName: localContext.fileName,
      fileType: localContext.fileType,
      chunkId: chunk.id,
      chunkLabel: chunk.label,
      chunkOrder: chunk.order,
      characterCount: chunk.characterCount,
      metrics: chunk.metrics
    },
    createdAt: importedAt,
    updatedAt: importedAt
  }))

  return [summaryDocument, ...chunkDocuments]
}

function buildImportedReferenceStylePrompt(title: string, analysis: ReferenceStyleAnalysisResult): string {
  return [
    `以下规则来自参考作品《${title}》的拆书结果，已做去具体化处理，只借鉴文笔和结构骨架，不复用专有设定：`,
    analysis.reusableStylePrompt,
    `补充校准：句式 ${analysis.sentenceStyle}；对白 ${analysis.dialogueRatio}；节奏 ${analysis.pacingControl}；情绪 ${analysis.emotionExpression}；视角 ${analysis.narrativePerspective}。`
  ].join('\n')
}

function buildImportedReferenceFindingsMarkdown(title: string, analysis: ReferenceStyleAnalysisResult, metrics: ReferenceStyleMetric[], keywords: string[]): string {
  const metricLines = metrics.map((metric) => `- ${metric.label}：${metric.value}`).join('\n')
  const styleRuleLines = analysis.styleRules.map((rule) => `- ${rule}`).join('\n')
  const avoidRuleLines = analysis.avoidRules.map((rule) => `- ${rule}`).join('\n')
  return [
    `- 参考作品：${title}`,
    `- 风格总述：${analysis.overview}`,
    ...(keywords.length ? [`- 关键词：${keywords.join('、')}`] : []),
    '',
    '### 局部统计',
    metricLines,
    '',
    '### 可复用风格规则',
    styleRuleLines,
    '',
    '### 去具体化剧情骨架',
    analysis.plotOutline,
    '',
    '### 避免照搬',
    avoidRuleLines
  ].join('\n')
}

function emitReferenceImportProgress(window: BrowserWindow, payload: ReferenceImportProgressPayload): void {
  if (window.isDestroyed()) {
    return
  }

  window.webContents.send('characterarc:reference-import-progress', payload)
}

function formatReferenceChunkSummaries(
  chunkResults: Array<{
    label: string
    characterCount: number
    result: ReferenceStyleChunkResult
  }>
): string {
  return chunkResults
    .map(({ label, characterCount, result }, index) => [
      `【分块 ${index + 1}｜${label}｜约 ${characterCount} 字】`,
      `局部概括：${result.overview}`,
      `句式：${result.sentenceStyle}`,
      `对白：${result.dialogueRatio}`,
      `节奏：${result.pacingControl}`,
      `情绪：${result.emotionExpression}`,
      `桥段功能：${result.plotFunction}`,
      `局部规则：${result.styleRules.join('；')}`
    ].join('\n'))
    .join('\n\n')
}

/** 导出文件 schema 版本号 */
const EXPORT_SCHEMA_VERSION = '2.0'
/** 导出文件兼容性说明 */
const EXPORT_COMPATIBILITY_NOTE =
  '2.x 导出文件可直接导入当前版本；1.x 旧导出会按兼容模式解析，并默认按完整项目导入。'

/** 导入模块类型 */
type ImportModuleType = 'project' | 'characters' | 'outline' | 'inspiration' | 'relations' | 'chapters'

/** 导入验证结果：成功时包含解析后的载荷和元信息，失败时包含错误消息 */
type ImportValidationResult =
  | {
      valid: true
      payload: Record<string, unknown>
      meta: {
        schemaVersion: string
        moduleType: ImportModuleType
        compatibilityNote: string
        isLegacy: boolean
      }
    }
  | {
      valid: false
      message: string
    }

/** 校验导入的 workspace 数据结构完整性：检查 project 字段和各集合字段的类型 */
function validateImportedWorkspace(payload: unknown): { valid: true } | { valid: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, message: '导入文件不是有效的项目对象。' }
  }

  const data = payload as Record<string, unknown>
  if (!data.project || typeof data.project !== 'object') {
    return { valid: false, message: '缺少 project 字段，无法识别项目基础信息。' }
  }

  const project = data.project as Record<string, unknown>
  if (typeof project.title !== 'string' || !project.title.trim()) {
    return { valid: false, message: 'project.title 缺失或为空。' }
  }

  const collectionChecks: Array<[string, unknown]> = [
    ['worldviewEntries', data.worldviewEntries],
    ['characters', data.characters],
    ['organizations', data.organizations],
    ['characterRelationships', data.characterRelationships],
    ['organizationMemberships', data.organizationMemberships],
    ['inspirationEntries', data.inspirationEntries],
    ['outlineVolumes', data.outlineVolumes],
    ['outlineItems', data.outlineItems],
    ['chapters', data.chapters],
    ['chapterVersions', data.chapterVersions]
  ]

  for (const [field, value] of collectionChecks) {
    if (value !== undefined && !Array.isArray(value)) {
      return { valid: false, message: `${field} 必须是数组格式。` }
    }
  }

  if (Array.isArray(data.worldviewEntries)) {
    const invalidWorldview = data.worldviewEntries.find((item) => {
      if (!item || typeof item !== 'object') return true
      const worldview = item as Record<string, unknown>
      return (
        typeof worldview.type !== 'string' ||
        typeof worldview.title !== 'string' ||
        typeof worldview.content !== 'string' ||
        (worldview.sortOrder !== undefined && typeof worldview.sortOrder !== 'number') ||
        (worldview.createdAt !== undefined && typeof worldview.createdAt !== 'string') ||
        (worldview.updatedAt !== undefined && typeof worldview.updatedAt !== 'string')
      )
    })

    if (invalidWorldview) {
      return { valid: false, message: 'worldviewEntries 中存在字段缺失或格式错误的设定条目。' }
    }
  }

  if (Array.isArray(data.inspirationEntries)) {
    const invalidInspiration = data.inspirationEntries.find((item) => {
      if (!item || typeof item !== 'object') return true
      const inspiration = item as Record<string, unknown>
      return (
        typeof inspiration.type !== 'string' ||
        typeof inspiration.title !== 'string' ||
        typeof inspiration.content !== 'string' ||
        !Array.isArray(inspiration.tags) ||
        (inspiration.source !== undefined && inspiration.source !== 'ai' && inspiration.source !== 'manual') ||
        (inspiration.sortOrder !== undefined && typeof inspiration.sortOrder !== 'number') ||
        (inspiration.createdAt !== undefined && typeof inspiration.createdAt !== 'string') ||
        (inspiration.updatedAt !== undefined && typeof inspiration.updatedAt !== 'string')
      )
    })

    if (invalidInspiration) {
      return { valid: false, message: 'inspirationEntries 中存在字段缺失或格式错误的灵感条目。' }
    }
  }

  if (Array.isArray(data.organizations)) {
    const invalidOrganization = data.organizations.find((item) => {
      if (!item || typeof item !== 'object') return true
      const organization = item as Record<string, unknown>
      return (
        typeof organization.name !== 'string' ||
        typeof organization.type !== 'string' ||
        typeof organization.description !== 'string' ||
        typeof organization.motto !== 'string' ||
        typeof organization.color !== 'string' ||
        (organization.sortOrder !== undefined && typeof organization.sortOrder !== 'number') ||
        (organization.createdAt !== undefined && typeof organization.createdAt !== 'string') ||
        (organization.updatedAt !== undefined && typeof organization.updatedAt !== 'string')
      )
    })

    if (invalidOrganization) {
      return { valid: false, message: 'organizations 中存在字段缺失或格式错误的组织条目。' }
    }
  }

  if (Array.isArray(data.characterRelationships)) {
    const invalidRelationship = data.characterRelationships.find((item) => {
      if (!item || typeof item !== 'object') return true
      const relationship = item as Record<string, unknown>
      return (
        typeof relationship.fromCharacterId !== 'string' ||
        typeof relationship.toCharacterId !== 'string' ||
        typeof relationship.type !== 'string' ||
        typeof relationship.description !== 'string' ||
        (relationship.intensity !== undefined && typeof relationship.intensity !== 'number') ||
        (relationship.createdAt !== undefined && typeof relationship.createdAt !== 'string') ||
        (relationship.updatedAt !== undefined && typeof relationship.updatedAt !== 'string')
      )
    })

    if (invalidRelationship) {
      return { valid: false, message: 'characterRelationships 中存在字段缺失或格式错误的关系条目。' }
    }
  }

  if (Array.isArray(data.organizationMemberships)) {
    const invalidMembership = data.organizationMemberships.find((item) => {
      if (!item || typeof item !== 'object') return true
      const membership = item as Record<string, unknown>
      return (
        typeof membership.characterId !== 'string' ||
        typeof membership.organizationId !== 'string' ||
        typeof membership.role !== 'string' ||
        (membership.notes !== undefined && typeof membership.notes !== 'string') ||
        (membership.createdAt !== undefined && typeof membership.createdAt !== 'string') ||
        (membership.updatedAt !== undefined && typeof membership.updatedAt !== 'string')
      )
    })

    if (invalidMembership) {
      return { valid: false, message: 'organizationMemberships 中存在字段缺失或格式错误的成员归属条目。' }
    }
  }

  if (Array.isArray(data.outlineVolumes)) {
    const invalidVolume = data.outlineVolumes.find((item) => {
      if (!item || typeof item !== 'object') return true
      const volume = item as Record<string, unknown>
      return (
        typeof volume.title !== 'string' ||
        (volume.wordTarget !== undefined && typeof volume.wordTarget !== 'string') ||
        (volume.summary !== undefined && typeof volume.summary !== 'string')
      )
    })
    if (invalidVolume) {
      return { valid: false, message: 'outlineVolumes 中存在字段缺失或格式错误的分卷项。' }
    }
  }

  if (Array.isArray(data.outlineItems)) {
    const invalidOutlineItem = data.outlineItems.find((item) => {
      if (!item || typeof item !== 'object') return true
      const outlineItem = item as Record<string, unknown>
      return (
        typeof outlineItem.title !== 'string' ||
        (outlineItem.volumeId !== undefined && typeof outlineItem.volumeId !== 'string') ||
        (outlineItem.wordTarget !== undefined && typeof outlineItem.wordTarget !== 'string') ||
        (outlineItem.conflict !== undefined && typeof outlineItem.conflict !== 'string') ||
        (outlineItem.summary !== undefined && typeof outlineItem.summary !== 'string') ||
        (outlineItem.status !== undefined && typeof outlineItem.status !== 'string') ||
        (outlineItem.sortOrder !== undefined && typeof outlineItem.sortOrder !== 'number')
      )
    })
    if (invalidOutlineItem) {
      return { valid: false, message: 'outlineItems 中存在字段缺失或格式错误的大纲节点。' }
    }
  }

  if (Array.isArray(data.chapters)) {
    const invalidChapter = data.chapters.find((item) => {
      if (!item || typeof item !== 'object') return true
      const chapter = item as Record<string, unknown>
      return (
        typeof chapter.title !== 'string' ||
        typeof chapter.content !== 'string' ||
        (chapter.outlineItemId !== undefined && typeof chapter.outlineItemId !== 'string') ||
        (chapter.volumeId !== undefined && typeof chapter.volumeId !== 'string') ||
        (chapter.summary !== undefined && typeof chapter.summary !== 'string') ||
        (chapter.status !== undefined && typeof chapter.status !== 'string') ||
        (chapter.wordTarget !== undefined && typeof chapter.wordTarget !== 'string')
      )
    })
    if (invalidChapter) {
      return { valid: false, message: 'chapters 中存在字段缺失或格式错误的章节项。' }
    }
  }

  if (Array.isArray(data.chapterVersions)) {
    const invalidVersion = data.chapterVersions.find((item) => {
      if (!item || typeof item !== 'object') return true
      const version = item as Record<string, unknown>
      return (
        typeof version.chapterId !== 'string' ||
        typeof version.title !== 'string' ||
        typeof version.content !== 'string' ||
        typeof version.createdAt !== 'string' ||
        (version.summary !== undefined && typeof version.summary !== 'string') ||
        (version.status !== undefined && typeof version.status !== 'string') ||
        (version.wordTarget !== undefined && typeof version.wordTarget !== 'string')
      )
    })
    if (invalidVersion) {
      return { valid: false, message: 'chapterVersions 中存在字段缺失或格式错误的版本项。' }
    }
  }

  return { valid: true }
}

/**
 * 校验导入文件的顶层结构：区分 2.x 信封格式和 1.x 旧版格式。
 * 2.x 格式包含 app/schemaVersion/moduleType/data 信封字段；1.x 格式为裸项目对象。
 */
function validateImportedPayload(payload: unknown): ImportValidationResult {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, message: '导入文件不是有效的 JSON 对象。' }
  }

  const data = payload as Record<string, unknown>
  if (
    data.app === 'CharacterArc' &&
    typeof data.schemaVersion === 'string' &&
    typeof data.moduleType === 'string' &&
    data.data &&
    typeof data.data === 'object'
  ) {
    const moduleType = data.moduleType as ImportModuleType
    const normalizedPayload = data.data as Record<string, unknown>
    // New schema exports wrap the real workspace fragment in a stable envelope so
    // future import compatibility checks can evolve without breaking old files.
    const validation = validateImportedWorkspace({
      project: normalizedPayload.project ?? { title: '导入模块' },
      ...normalizedPayload
    })

    if (!validation.valid) {
      return validation
    }

    return {
      valid: true,
      payload: normalizedPayload,
      meta: {
        schemaVersion: data.schemaVersion,
        moduleType,
        compatibilityNote:
          typeof data.compatibilityNote === 'string' && data.compatibilityNote.trim()
            ? data.compatibilityNote
            : EXPORT_COMPATIBILITY_NOTE,
        isLegacy: false
      }
    }
  }

  const legacyValidation = validateImportedWorkspace(data)
  if (!legacyValidation.valid) {
    return legacyValidation
  }

  // Legacy 1.x exports were raw project objects, so we keep accepting them and
  // surface a compatibility note back to the renderer instead of hard failing.
  return {
    valid: true,
    payload: data,
    meta: {
      schemaVersion: '1.0',
      moduleType: 'project',
      compatibilityNote: '这是旧版 1.x 导出文件，系统已按兼容模式识别为完整项目导入。',
      isLegacy: true
    }
  }
}

/** 根据文件扩展名返回 MIME 类型，用于封面图片的 data URL 生成 */
function resolveImageMime(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'application/octet-stream'
}

registerMainIpcHandlers({
  windowManager,
  setLatestWorkspaceSnapshot: (payload) => {
    updateLatestWorkspaceSnapshot(payload as WorkspacePayload | null)
  },
  getLatestAssistantContext: () => latestAssistantContext,
  setLatestAssistantContext: (payload) => {
    latestAssistantContext = payload && typeof payload === 'object' ? (payload as AssistantContextPayload) : {}
  },
  getLatestAssistantPrompt: () => latestAssistantPrompt,
  setLatestAssistantPrompt: (payload) => {
    latestAssistantPrompt = payload
  },
  normalizeWorkspacePayload: (payload) => normalizeWorkspacePayload(payload as WorkspacePayload | LegacyWorkspacePayload),
  ensureWorkspaceDb,
  readWorkspaceSnapshot,
  writeWorkspaceSnapshot: (db, payload) => writeWorkspaceSnapshot(db, payload as WorkspacePayload),
  validateImportedPayload,
  resolveImageMime,
  emitReferenceImportProgress,
  buildImportedReferenceKnowledgeDocuments,
  buildImportedReferenceStylePrompt,
  buildImportedReferenceFindingsMarkdown,
  formatReferenceChunkSummaries
})

// ── AI IPC registration ──
registerAiIpcHandlers({
  getLatestWorkspaceSnapshot: () => latestWorkspaceSnapshot,
  emitAiRunEvent: emitAiRunEvent as (payload: { projectId: string; meta: Record<string, unknown> }) => void
})

// ── 应用生命周期 ──
// macOS 上关闭所有窗口后点击 dock 图标时重新创建主窗口
app.whenReady().then(async () => {
  await initSkillRegistry().catch(() => {})
  windowManager.createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
