import type { KnowledgeDocument, KnowledgeDocumentSourceType, ReferenceWorkItem } from '@/types/app'

export type KnowledgeSourceScope = 'project' | 'reference'
export type KnowledgeSourceFilter = 'all' | KnowledgeSourceScope | KnowledgeDocumentSourceType

export interface KnowledgeDocumentView {
  document: KnowledgeDocument
  sourceScope: KnowledgeSourceScope
  sourceScopeLabel: string
  sourceTypeLabel: string
  sourceLabelText: string
  preview: string
  updatedAtLabel: string
  duplicateGroupId?: string
  conflictGroupId?: string
}

export interface KnowledgeDuplicateGroup {
  id: string
  title: string
  sourceTypeLabel: string
  sourceScopeLabel: string
  keepDocumentId: string
  removeDocumentIds: string[]
  documents: KnowledgeDocumentView[]
}

export interface KnowledgeConflictGroup {
  id: string
  title: string
  reason: string
  documents: KnowledgeDocumentView[]
}

export interface KnowledgeCenterStats {
  totalDocuments: number
  projectDocuments: number
  referenceDocuments: number
  duplicateGroups: number
  duplicateDocuments: number
  conflictGroups: number
  conflictDocuments: number
}

export interface KnowledgeCenterState {
  documents: KnowledgeDocumentView[]
  duplicateGroups: KnowledgeDuplicateGroup[]
  conflictGroups: KnowledgeConflictGroup[]
  stats: KnowledgeCenterStats
}

export interface ReferenceAssetLibrary {
  id: string
  title: string
  source: string
  fileName: string
  notes: string
  summary: string
  topKeywords: string[]
  styleRules: string[]
  documentCount: number
  summaryCount: number
  chunkCount: number
  chapterCount: number
  characterCount: number
  updatedAtLabel: string
  primaryDocument: KnowledgeDocumentView | null
  relatedDocumentIds: string[]
}

const PROJECT_SOURCE_TYPES = new Set<KnowledgeDocumentSourceType>([
  'workflow-document',
  'canon-fact',
  'chapter-summary'
])

const KNOWLEDGE_SOURCE_TYPE_LABELS: Record<KnowledgeDocumentSourceType, string> = {
  'reference-summary': '拆书总纲',
  'reference-chunk': '拆书分块',
  'workflow-document': '流程文档',
  'canon-fact': '设定事实',
  'chapter-summary': '章节摘要'
}

function normalizeKnowledgeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s`~!@#$%^&*()_\-+=\[\]{}\\|;:'",.<>/?，。！？；：、（）【】《》“”‘’]+/g, '')
    .trim()
}

function buildKnowledgePreview(document: KnowledgeDocument): string {
  const baseText = String(document.summary || document.content || '').replace(/\s+/g, ' ').trim()
  if (baseText.length <= 180) {
    return baseText
  }

  return `${baseText.slice(0, 180).trimEnd()}...`
}

function resolveKnowledgeTimestamp(value?: string): number {
  const timestamp = value ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : 0
}

function compareKnowledgeDocuments(a: KnowledgeDocument, b: KnowledgeDocument): number {
  const updatedDiff = resolveKnowledgeTimestamp(b.updatedAt) - resolveKnowledgeTimestamp(a.updatedAt)
  if (updatedDiff !== 0) {
    return updatedDiff
  }

  const createdDiff = resolveKnowledgeTimestamp(b.createdAt) - resolveKnowledgeTimestamp(a.createdAt)
  if (createdDiff !== 0) {
    return createdDiff
  }

  return b.id.localeCompare(a.id)
}

function buildKnowledgeDuplicateKey(document: KnowledgeDocument): string {
  const titleKey = normalizeKnowledgeText(document.title || document.sourceLabel || '')
  const bodyKey = normalizeKnowledgeText(document.summary || document.content).slice(0, 320)
  const keywordsKey = document.keywords
    .map((keyword) => normalizeKnowledgeText(String(keyword)))
    .filter(Boolean)
    .sort()
    .join('|')

  return [titleKey, document.sourceType, bodyKey, keywordsKey].join('::')
}

function buildKnowledgeConflictKey(document: KnowledgeDocument): string {
  const metadataTitle = String(document.metadata?.sourceTitle ?? '').trim()
  const titleSeed = document.title || metadataTitle || document.sourceLabel || ''
  return normalizeKnowledgeText(titleSeed)
}

function buildKnowledgeConflictBodyKey(document: KnowledgeDocument): string {
  const summaryKey = normalizeKnowledgeText(document.summary)
  const contentKey = normalizeKnowledgeText(document.content).slice(0, 320)
  return summaryKey || contentKey
}

function normalizeReferenceAssetKey(value: string): string {
  return normalizeKnowledgeText(value)
}

function getReferenceAssetSourceTitle(documentView: KnowledgeDocumentView): string {
  const metadataTitle = String(documentView.document.metadata?.sourceTitle ?? '').trim()
  if (metadataTitle) {
    return metadataTitle
  }

  return String(documentView.document.title.split('｜')[0] ?? '').trim()
}

function getReferenceAssetFileName(documentView: KnowledgeDocumentView): string {
  return String(documentView.document.metadata?.fileName ?? '').trim()
}

function getReferenceAssetStyleRules(documentViews: KnowledgeDocumentView[]): string[] {
  const metadataRules = documentViews.flatMap((item) => {
    const rawRules = item.document.metadata?.styleRules
    return Array.isArray(rawRules) ? rawRules : []
  })

  return Array.from(
    new Set(
      metadataRules
        .map((rule) => String(rule).trim())
        .filter(Boolean)
    )
  ).slice(0, 6)
}

function buildReferenceAssetLibrary(
  referenceWork: ReferenceWorkItem | null,
  documentViews: KnowledgeDocumentView[],
  fallbackTitle = ''
): ReferenceAssetLibrary {
  const sortedDocumentViews = [...documentViews].sort((left, right) => {
    if (left.document.sourceType === 'reference-summary' && right.document.sourceType !== 'reference-summary') {
      return -1
    }

    if (right.document.sourceType === 'reference-summary' && left.document.sourceType !== 'reference-summary') {
      return 1
    }

    return compareKnowledgeDocuments(left.document, right.document)
  })

  const primaryDocument = sortedDocumentViews[0] ?? null
  const analysis = referenceWork?.analysis
  const timestamps = [
    analysis?.createdAt,
    ...sortedDocumentViews.map((item) => item.document.updatedAt),
    ...sortedDocumentViews.map((item) => item.document.createdAt)
  ]
    .map((value) => resolveKnowledgeTimestamp(value))
    .filter((value) => value > 0)
  const latestTimestamp = timestamps.length ? Math.max(...timestamps) : 0

  const topKeywords = referenceWork?.analysis?.topKeywords?.length
    ? referenceWork.analysis.topKeywords
    : Array.from(new Set(sortedDocumentViews.flatMap((item) => item.document.keywords))).slice(0, 8)

  const styleRules = referenceWork?.analysis?.styleRules?.length
    ? referenceWork.analysis.styleRules
    : getReferenceAssetStyleRules(sortedDocumentViews)

  const metadataCharacterCount = sortedDocumentViews.find((item) =>
    Number.isFinite(Number(item.document.metadata?.characterCount ?? NaN))
  )?.document.metadata?.characterCount
  const metadataChapterCount = sortedDocumentViews.find((item) =>
    Number.isFinite(Number(item.document.metadata?.chapterCount ?? NaN))
  )?.document.metadata?.chapterCount
  const primaryFileName = primaryDocument ? getReferenceAssetFileName(primaryDocument) : ''
  const fileName = referenceWork?.fileName?.trim()
    || analysis?.fileName?.trim()
    || primaryDocument?.document.sourceLabel.trim().split('/')[0]?.trim()
    || primaryFileName
    || ''

  return {
    id: referenceWork?.id || `reference-asset-${normalizeReferenceAssetKey(fallbackTitle || primaryDocument?.document.id || 'unknown')}`,
    title: referenceWork?.title?.trim() || fallbackTitle || primaryDocument?.document.title || '未命名参考资产',
    source: referenceWork?.source?.trim() || '未绑定参考作品',
    fileName,
    notes: referenceWork?.notes?.trim() || '',
    summary:
      analysis?.overview?.trim()
      || referenceWork?.notes?.trim()
      || primaryDocument?.preview
      || '已沉淀参考资产，等待进一步整理。',
    topKeywords,
    styleRules,
    documentCount: sortedDocumentViews.length,
    summaryCount: sortedDocumentViews.filter((item) => item.document.sourceType === 'reference-summary').length,
    chunkCount: sortedDocumentViews.filter((item) => item.document.sourceType === 'reference-chunk').length,
    chapterCount: Number(analysis?.chapterCount ?? metadataChapterCount ?? 0),
    characterCount: Number(analysis?.characterCount ?? metadataCharacterCount ?? 0),
    updatedAtLabel: latestTimestamp ? formatKnowledgeDateTime(new Date(latestTimestamp).toISOString()) : '未知时间',
    primaryDocument,
    relatedDocumentIds: sortedDocumentViews.map((item) => item.document.id)
  }
}

export function isProjectKnowledgeSource(sourceType: KnowledgeDocumentSourceType): boolean {
  return PROJECT_SOURCE_TYPES.has(sourceType)
}

export function resolveKnowledgeSourceScope(sourceType: KnowledgeDocumentSourceType): KnowledgeSourceScope {
  return isProjectKnowledgeSource(sourceType) ? 'project' : 'reference'
}

export function resolveKnowledgeSourceScopeLabel(sourceType: KnowledgeDocumentSourceType): string {
  return resolveKnowledgeSourceScope(sourceType) === 'project' ? '项目记忆' : '参考资料'
}

export function resolveKnowledgeSourceTypeLabel(sourceType: KnowledgeDocumentSourceType): string {
  return KNOWLEDGE_SOURCE_TYPE_LABELS[sourceType] ?? sourceType
}

export function formatKnowledgeDateTime(value?: string): string {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) {
    return value?.trim() || '未知时间'
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function buildReferenceAssetLibraries(
  referenceWorks: ReferenceWorkItem[],
  documents: KnowledgeDocumentView[]
): ReferenceAssetLibrary[] {
  const referenceDocumentViews = documents.filter((item) =>
    item.document.sourceType === 'reference-summary' || item.document.sourceType === 'reference-chunk'
  )
  const claimedDocumentIds = new Set<string>()

  const libraries = referenceWorks.map((referenceWork) => {
    const titleKey = normalizeReferenceAssetKey(referenceWork.title)
    const fileNameKey = normalizeReferenceAssetKey(referenceWork.fileName || referenceWork.analysis?.fileName || '')
    const matchedDocuments = referenceDocumentViews.filter((item) => {
      const sourceTitleKey = normalizeReferenceAssetKey(getReferenceAssetSourceTitle(item))
      const sourceFileNameKey = normalizeReferenceAssetKey(getReferenceAssetFileName(item))
      return (titleKey && sourceTitleKey === titleKey) || (fileNameKey && sourceFileNameKey === fileNameKey)
    })

    matchedDocuments.forEach((item) => claimedDocumentIds.add(item.document.id))
    return buildReferenceAssetLibrary(referenceWork, matchedDocuments, referenceWork.title)
  })

  const orphanGroups = new Map<string, KnowledgeDocumentView[]>()
  referenceDocumentViews
    .filter((item) => !claimedDocumentIds.has(item.document.id))
    .forEach((item) => {
      const groupKey = normalizeReferenceAssetKey(getReferenceAssetSourceTitle(item))
        || normalizeReferenceAssetKey(getReferenceAssetFileName(item))
        || item.document.id
      const group = orphanGroups.get(groupKey) ?? []
      group.push(item)
      orphanGroups.set(groupKey, group)
    })

  const orphanLibraries = Array.from(orphanGroups.values()).map((group) =>
    buildReferenceAssetLibrary(null, group, getReferenceAssetSourceTitle(group[0]))
  )

  return [...libraries, ...orphanLibraries].sort((left, right) => {
    const rightTimestamp = resolveKnowledgeTimestamp(right.primaryDocument?.document.updatedAt)
    const leftTimestamp = resolveKnowledgeTimestamp(left.primaryDocument?.document.updatedAt)
    return rightTimestamp - leftTimestamp
  })
}

export function filterKnowledgeDocumentViews(
  documents: KnowledgeDocumentView[],
  query: string,
  sourceFilter: KnowledgeSourceFilter
): KnowledgeDocumentView[] {
  const normalizedQuery = query.trim().toLowerCase()

  return documents.filter((item) => {
    if (sourceFilter !== 'all') {
      const matchesScope = sourceFilter === item.sourceScope
      const matchesType = sourceFilter === item.document.sourceType
      if (!matchesScope && !matchesType) {
        return false
      }
    }

    if (!normalizedQuery) {
      return true
    }

    const haystack = [
      item.document.title,
      item.document.summary,
      item.document.content,
      item.document.sourceLabel,
      item.document.keywords.join(' '),
      item.sourceTypeLabel,
      item.sourceScopeLabel
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  })
}

export function buildKnowledgeCenterState(documents: KnowledgeDocument[]): KnowledgeCenterState {
  const sortedDocuments = [...documents].sort(compareKnowledgeDocuments)
  const documentViews = sortedDocuments.map<KnowledgeDocumentView>((document) => ({
    document,
    sourceScope: resolveKnowledgeSourceScope(document.sourceType),
    sourceScopeLabel: resolveKnowledgeSourceScopeLabel(document.sourceType),
    sourceTypeLabel: resolveKnowledgeSourceTypeLabel(document.sourceType),
    sourceLabelText: document.sourceLabel.trim() || String(document.metadata?.sourceTitle ?? '').trim() || '未标注来源',
    preview: buildKnowledgePreview(document),
    updatedAtLabel: formatKnowledgeDateTime(document.updatedAt)
  }))

  const duplicateGroupMap = new Map<string, KnowledgeDocumentView[]>()
  documentViews.forEach((view) => {
    const duplicateKey = buildKnowledgeDuplicateKey(view.document)
    if (!duplicateKey.replace(/:/g, '').trim()) {
      return
    }

    const group = duplicateGroupMap.get(duplicateKey) ?? []
    group.push(view)
    duplicateGroupMap.set(duplicateKey, group)
  })

  const duplicateGroups = Array.from(duplicateGroupMap.values())
    .filter((group) => group.length > 1)
    .map<KnowledgeDuplicateGroup>((group, index) => {
      const sortedGroup = [...group].sort((a, b) => compareKnowledgeDocuments(a.document, b.document))
      return {
        id: `duplicate-${index + 1}`,
        title: sortedGroup[0]?.document.title || '未命名知识',
        sourceTypeLabel: sortedGroup[0]?.sourceTypeLabel || '未知来源',
        sourceScopeLabel: sortedGroup[0]?.sourceScopeLabel || '知识文档',
        keepDocumentId: sortedGroup[0]?.document.id || '',
        removeDocumentIds: sortedGroup.slice(1).map((item) => item.document.id),
        documents: sortedGroup
      }
    })
    .sort((a, b) => b.removeDocumentIds.length - a.removeDocumentIds.length)

  const duplicateGroupIdByDocument = new Map<string, string>()
  duplicateGroups.forEach((group) => {
    group.documents.forEach((item) => {
      duplicateGroupIdByDocument.set(item.document.id, group.id)
    })
  })

  const conflictGroupMap = new Map<string, KnowledgeDocumentView[]>()
  documentViews
    .filter((view) => view.sourceScope === 'project')
    .forEach((view) => {
      const conflictKey = buildKnowledgeConflictKey(view.document)
      if (!conflictKey.replace(/:/g, '').trim()) {
        return
      }

      const group = conflictGroupMap.get(conflictKey) ?? []
      group.push(view)
      conflictGroupMap.set(conflictKey, group)
    })

  const conflictGroups = Array.from(conflictGroupMap.values())
    .filter((group) => {
      if (group.length <= 1) {
        return false
      }

      return new Set(group.map((item) => buildKnowledgeConflictBodyKey(item.document))).size > 1
    })
    .map<KnowledgeConflictGroup>((group, index) => {
      const sortedGroup = [...group].sort((a, b) => compareKnowledgeDocuments(a.document, b.document))
      const versionCount = new Set(sortedGroup.map((item) => buildKnowledgeConflictBodyKey(item.document))).size
      return {
        id: `conflict-${index + 1}`,
        title: sortedGroup[0]?.document.title || '未命名知识',
        reason: `同名项目知识出现 ${versionCount} 个不同版本，建议核对最新结论与旧记录是否存在冲突。`,
        documents: sortedGroup
      }
    })
    .sort((a, b) => b.documents.length - a.documents.length)

  const conflictGroupIdByDocument = new Map<string, string>()
  conflictGroups.forEach((group) => {
    group.documents.forEach((item) => {
      conflictGroupIdByDocument.set(item.document.id, group.id)
    })
  })

  const decoratedDocuments = documentViews.map((view) => ({
    ...view,
    duplicateGroupId: duplicateGroupIdByDocument.get(view.document.id),
    conflictGroupId: conflictGroupIdByDocument.get(view.document.id)
  }))

  return {
    documents: decoratedDocuments,
    duplicateGroups: duplicateGroups.map((group) => ({
      ...group,
      documents: group.documents.map((item) => ({
        ...item,
        duplicateGroupId: group.id,
        conflictGroupId: conflictGroupIdByDocument.get(item.document.id)
      }))
    })),
    conflictGroups: conflictGroups.map((group) => ({
      ...group,
      documents: group.documents.map((item) => ({
        ...item,
        duplicateGroupId: duplicateGroupIdByDocument.get(item.document.id),
        conflictGroupId: group.id
      }))
    })),
    stats: {
      totalDocuments: decoratedDocuments.length,
      projectDocuments: decoratedDocuments.filter((item) => item.sourceScope === 'project').length,
      referenceDocuments: decoratedDocuments.filter((item) => item.sourceScope === 'reference').length,
      duplicateGroups: duplicateGroups.length,
      duplicateDocuments: duplicateGroups.reduce((count, group) => count + group.removeDocumentIds.length, 0),
      conflictGroups: conflictGroups.length,
      conflictDocuments: conflictGroups.reduce((count, group) => count + group.documents.length, 0)
    }
  }
}
