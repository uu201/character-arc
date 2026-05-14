import type {
  AiRunRecord,
  ChapterDraft,
  ChapterVersion,
  ChatMessage,
  CharacterRelationship,
  CharacterCard,
  InspirationEntry,
  OutlineItemStatus,
  OrganizationEntry,
  OrganizationMembership,
  OutlineItem,
  OutlineVolume,
  PlotThread,
  ProjectWorkspaceData,
  WorkflowDocument,
  WorldviewEntry
} from '@/types/app'
import { createDefaultWorkflowDocuments, normalizeWorkflowDocuments } from '@/features/novelWorkflow/documents'
import { cloneOutlineVolumes, createOutlineVolume, ensureVolumeCollections, normalizeVolumeWorkflowDocuments } from '@/features/workspace/outlineVolumes'

// 将日期字符串安全转为 ISO 时间戳，无效值回退到当前时间
function toIsoTimestamp(value?: string): string {
  const parsed = value ? new Date(value) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return new Date().toISOString()
}

// 校正世界观条目：按 sortOrder 排序并确保时间戳合法
function normalizeWorldviewEntries(worldviewEntries?: WorldviewEntry[]): WorldviewEntry[] {
  const sortedEntries = (worldviewEntries ?? [])
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (left.entry.sortOrder ?? left.index) - (right.entry.sortOrder ?? right.index))

  return sortedEntries.map(({ entry }, index) => {
    const createdAt = toIsoTimestamp(entry.createdAt)
    const updatedAt = toIsoTimestamp(entry.updatedAt || entry.createdAt)

    return {
      ...entry,
      sortOrder: index,
      createdAt,
      updatedAt
    }
  })
}

// 校正大纲条目：按 sortOrder 排序并重新分配连续索引
function normalizeOutlineItems(outlineItems?: OutlineItem[]): OutlineItem[] {
  const sortedItems = (outlineItems ?? [])
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (left.item.sortOrder ?? left.index) - (right.item.sortOrder ?? right.index))

  return sortedItems.map(({ item }, index) => ({
    ...item,
    status: normalizeOutlineItemStatus(item.status),
    sortOrder: index
  }))
}

function normalizeOutlineItemStatus(status?: string): OutlineItemStatus {
  switch (status) {
    case 'idea':
    case 'planned':
    case 'drafting':
    case 'done':
      return status
    default:
      return 'planned'
  }
}

// 校正灵感条目：排序、清理标签、规范化来源类型并确保时间戳
function normalizeInspirationEntries(inspirationEntries?: InspirationEntry[]): InspirationEntry[] {
  const sortedEntries = (inspirationEntries ?? [])
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (left.entry.sortOrder ?? left.index) - (right.entry.sortOrder ?? right.index))

  return sortedEntries.map(({ entry }, index) => ({
    ...entry,
    tags: entry.tags?.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 5) ?? [], // 最多保留5个标签
    source: entry.source === 'manual' ? 'manual' : 'ai', // 来源只允许 'manual' 或 'ai' 两种值
    sortOrder: index,
    createdAt: toIsoTimestamp(entry.createdAt),
    updatedAt: toIsoTimestamp(entry.updatedAt || entry.createdAt)
  }))
}

// 校正组织条目：按 sortOrder 排序并确保时间戳合法
function normalizeOrganizations(organizations?: OrganizationEntry[]): OrganizationEntry[] {
  const sortedEntries = (organizations ?? [])
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (left.entry.sortOrder ?? left.index) - (right.entry.sortOrder ?? right.index))

  return sortedEntries.map(({ entry }, index) => ({
    ...entry,
    sortOrder: index,
    createdAt: toIsoTimestamp(entry.createdAt),
    updatedAt: toIsoTimestamp(entry.updatedAt || entry.createdAt)
  }))
}

// 校正角色关系：将强度值限制在 0-100 范围内，默认 50
function normalizeCharacterRelationships(relationships?: CharacterRelationship[]): CharacterRelationship[] {
  return (relationships ?? []).map((relationship) => ({
    ...relationship,
    intensity: Number.isFinite(relationship.intensity) ? Math.min(100, Math.max(0, relationship.intensity)) : 50,
    createdAt: toIsoTimestamp(relationship.createdAt),
    updatedAt: toIsoTimestamp(relationship.updatedAt || relationship.createdAt)
  }))
}

// 校正组织成员关系：确保每条记录都有合法的时间戳
function normalizeOrganizationMemberships(memberships?: OrganizationMembership[]): OrganizationMembership[] {
  return (memberships ?? []).map((membership) => ({
    ...membership,
    createdAt: toIsoTimestamp(membership.createdAt),
    updatedAt: toIsoTimestamp(membership.updatedAt || membership.createdAt)
  }))
}

// ==================== 工厂函数与工具函数 ====================

// 创建聊天窗口的初始欢迎消息，AI 助理自我介绍并提示可用功能
export function createInitialMessages(): ChatMessage[] {
  return [
    {
      id: `msg-${Date.now()}-welcome`,
      role: 'assistant',
      content: '我是你的创作助理。已读取世界观和当前章节内容。需要我帮你润色段落，或者提供剧情建议吗？'
    }
  ]
}

// 浅拷贝消息列表，空列表时回退到初始欢迎消息
function cloneMessages(messages?: ChatMessage[]): ChatMessage[] {
  return messages?.length ? messages.map((message) => ({ ...message })) : createInitialMessages()
}

// 浅拷贝章节版本列表
function cloneChapterVersions(chapterVersions?: ChapterVersion[]): ChapterVersion[] {
  return chapterVersions?.length ? chapterVersions.map((version) => ({ ...version })) : []
}

// 浅拷贝章节草稿列表
function cloneChapters(chapters?: ChapterDraft[]): ChapterDraft[] {
  return chapters?.length ? chapters.map((chapter) => ({ ...chapter })) : []
}

// 拷贝大纲条目并校正排序索引
function cloneOutlineItems(outlineItems?: OutlineItem[]): OutlineItem[] {
  return normalizeOutlineItems(outlineItems)
}

// 浅拷贝角色卡列表（含内部标签数组的深拷贝）
function cloneCharacters(characters?: CharacterCard[]): CharacterCard[] {
  return characters?.length
    ? characters.map((character) => ({
        ...character,
        tags: character.tags.map((tag) => ({ ...tag }))
      }))
    : []
}

// 拷贝组织列表并校正排序与时间戳
function cloneOrganizations(organizations?: OrganizationEntry[]): OrganizationEntry[] {
  return normalizeOrganizations(organizations)
}

// 拷贝角色关系并校正强度值与时间戳
function cloneCharacterRelationships(relationships?: CharacterRelationship[]): CharacterRelationship[] {
  return normalizeCharacterRelationships(relationships)
}

// 拷贝组织成员关系并校正时间戳
function cloneOrganizationMemberships(memberships?: OrganizationMembership[]): OrganizationMembership[] {
  return normalizeOrganizationMemberships(memberships)
}

// 拷贝灵感条目并校正标签、来源与时间戳
function cloneInspirationEntries(inspirationEntries?: InspirationEntry[]): InspirationEntry[] {
  return normalizeInspirationEntries(inspirationEntries)
}

// 拷贝世界观条目并校正排序与时间戳
function cloneWorldviewEntries(worldviewEntries?: WorldviewEntry[]): WorldviewEntry[] {
  return normalizeWorldviewEntries(worldviewEntries)
}

function cloneAiRuns(aiRuns?: AiRunRecord[]): AiRunRecord[] {
  return aiRuns?.length
    ? aiRuns.map((run) => ({
        ...run,
        startedAt: toIsoTimestamp(run.startedAt),
        finishedAt: run.finishedAt ? toIsoTimestamp(run.finishedAt) : undefined,
        durationMs: Number.isFinite(run.durationMs) ? Math.max(0, Number(run.durationMs)) : undefined,
        repairTriggered: Boolean(run.repairTriggered),
        error: run.error?.trim() || '',
        responsePreview: run.responsePreview?.trim() || '',
        usedKnowledge: Array.isArray(run.usedKnowledge)
          ? run.usedKnowledge.map((item) => ({
              ...item,
              snippet: item.snippet?.trim() || '',
              keywords: Array.isArray(item.keywords) ? item.keywords.map((keyword) => String(keyword).trim()).filter(Boolean) : []
            }))
          : []
      }))
    : []
}

// 创建空工作区：对所有集合做标准化处理，保证数据结构完整
// 可通过 overrides 传入部分数据覆盖默认值
export function createEmptyWorkspace(overrides?: Partial<ProjectWorkspaceData>): ProjectWorkspaceData {
  const volumeState = ensureVolumeCollections({
    outlineVolumes: overrides?.outlineVolumes,
    outlineItems: overrides?.outlineItems,
    chapters: overrides?.chapters
  })

  const normalizedVolumes = cloneOutlineVolumes(volumeState.outlineVolumes).map((volume) => ({
    ...volume,
    workflowDocuments: normalizeVolumeWorkflowDocuments(volume)
  }))

  return {
    worldviewEntries: cloneWorldviewEntries(overrides?.worldviewEntries),
    characters: cloneCharacters(overrides?.characters),
    organizations: cloneOrganizations(overrides?.organizations),
    characterRelationships: cloneCharacterRelationships(overrides?.characterRelationships),
    organizationMemberships: cloneOrganizationMemberships(overrides?.organizationMemberships),
    inspirationEntries: cloneInspirationEntries(overrides?.inspirationEntries),
    outlineVolumes: normalizedVolumes,
    outlineItems: cloneOutlineItems(volumeState.outlineItems),
    chapters: cloneChapters(volumeState.chapters),
    chapterVersions: cloneChapterVersions(overrides?.chapterVersions),
    messages: cloneMessages(overrides?.messages),
    aiRuns: cloneAiRuns(overrides?.aiRuns),
    workflowDocuments: normalizeWorkflowDocuments(overrides?.workflowDocuments as WorkflowDocument[] | undefined),
    plotThreads: Array.isArray(overrides?.plotThreads) ? (overrides.plotThreads as PlotThread[]) : []
  }
}

// 创建演示工作区（已废弃，保留空实现以兼容旧调用路径）
export function createDemoWorkspace(): ProjectWorkspaceData {
  return createEmptyWorkspace()
}

// 标准化工作区数据：校正所有集合的结构和字段值
export function normalizeWorkspace(
  workspace?: Partial<ProjectWorkspaceData> | null,
  options?: Record<string, never>
): ProjectWorkspaceData {
  if (!workspace) {
    return createEmptyWorkspace()
  }

  const volumeState = ensureVolumeCollections({
    outlineVolumes: workspace.outlineVolumes,
    outlineItems: workspace.outlineItems,
    chapters: workspace.chapters
  })

  // 为每个分卷规范化流程文件：
  // - 已有 workflowDocuments 的分卷直接规范化
  // - 第一卷无文件时，尝试迁移旧的项目级 workflowDocuments
  // - 其余分卷无文件时，初始化为默认模板
  const projectLevelDocs = workspace.workflowDocuments as WorkflowDocument[] | undefined
  const normalizedVolumes = cloneOutlineVolumes(volumeState.outlineVolumes).map((volume, index) => ({
    ...volume,
    workflowDocuments: normalizeVolumeWorkflowDocuments(
      volume,
      index === 0 ? projectLevelDocs : undefined
    )
  }))

  return {
    worldviewEntries: cloneWorldviewEntries(workspace.worldviewEntries),
    characters: cloneCharacters(workspace.characters),
    organizations: cloneOrganizations(workspace.organizations),
    characterRelationships: cloneCharacterRelationships(workspace.characterRelationships),
    organizationMemberships: cloneOrganizationMemberships(workspace.organizationMemberships),
    inspirationEntries: cloneInspirationEntries(workspace.inspirationEntries),
    outlineVolumes: normalizedVolumes,
    outlineItems: cloneOutlineItems(volumeState.outlineItems),
    chapters: cloneChapters(volumeState.chapters),
    chapterVersions: cloneChapterVersions(workspace.chapterVersions),
    messages: cloneMessages(workspace.messages),
    aiRuns: cloneAiRuns(workspace.aiRuns),
    workflowDocuments: normalizeWorkflowDocuments(projectLevelDocs),
    plotThreads: Array.isArray(workspace.plotThreads) ? (workspace.plotThreads as PlotThread[]) : []
  }
}
