import type {
  AiRunRecord,
  ChapterDraft,
  ChapterVersion,
  ChatMessage,
  CharacterRelationship,
  CharacterCard,
  GlobalAssistantProposal,
  GlobalAssistantSession,
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

// 创建聊天窗口的初始消息（保持为空，新会话直接进入空状态欢迎页）
export function createInitialMessages(): ChatMessage[] {
  return []
}

// 浅拷贝消息列表（新会话保持为空，由界面渲染空状态）
function cloneMessages(messages?: ChatMessage[]): ChatMessage[] {
  return messages?.length ? messages.map((message) => ({ ...message })) : []
}

export function normalizeGlobalAssistantProposal(proposal?: GlobalAssistantProposal | null): GlobalAssistantProposal | null {
  if (!proposal || typeof proposal !== 'object') {
    return null
  }

  return {
    summary: String(proposal.summary ?? '').trim(),
    constraintCreates: Array.isArray(proposal.constraintCreates) ? proposal.constraintCreates : [],
    worldviewCreates: Array.isArray(proposal.worldviewCreates) ? proposal.worldviewCreates : [],
    worldviewUpdates: Array.isArray(proposal.worldviewUpdates) ? proposal.worldviewUpdates : [],
    characterCreates: Array.isArray(proposal.characterCreates) ? proposal.characterCreates : [],
    characterUpdates: Array.isArray(proposal.characterUpdates) ? proposal.characterUpdates : [],
    outlineCreates: Array.isArray(proposal.outlineCreates) ? proposal.outlineCreates : [],
    outlineUpdates: Array.isArray(proposal.outlineUpdates) ? proposal.outlineUpdates : [],
    notes: Array.isArray(proposal.notes) ? proposal.notes : []
  }
}

/**
 * 合并两份写回提案：把 incoming 的各数组拼接到 existing 之后（而非覆盖），按关键字段去重，
 * summary 取 incoming 非空优先，全空则返回 null（等价 useGlobalAssistant 的 trimProposal）。
 */
export function mergeGlobalAssistantProposals(
  existing: GlobalAssistantProposal | null,
  incoming: Partial<GlobalAssistantProposal> | null
): GlobalAssistantProposal | null {
  const base = normalizeGlobalAssistantProposal(existing as GlobalAssistantProposal | null)
  const add = normalizeGlobalAssistantProposal(incoming as GlobalAssistantProposal | null)
  if (!base && !add) return null

  const dedupe = <T>(items: T[], keyOf: (item: T) => string): T[] => {
    const seen = new Set<string>()
    const result: T[] = []
    for (const item of items) {
      const key = keyOf(item).trim().toLowerCase()
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      result.push(item)
    }
    return result
  }

  const merged: GlobalAssistantProposal = {
    summary: (add?.summary || base?.summary || '').trim(),
    constraintCreates: dedupe([...(base?.constraintCreates ?? []), ...(add?.constraintCreates ?? [])], (item) => item.title),
    worldviewCreates: dedupe([...(base?.worldviewCreates ?? []), ...(add?.worldviewCreates ?? [])], (item) => item.title),
    worldviewUpdates: dedupe([...(base?.worldviewUpdates ?? []), ...(add?.worldviewUpdates ?? [])], (item) => item.matchTitle),
    characterCreates: dedupe([...(base?.characterCreates ?? []), ...(add?.characterCreates ?? [])], (item) => item.name),
    characterUpdates: dedupe([...(base?.characterUpdates ?? []), ...(add?.characterUpdates ?? [])], (item) => item.matchName),
    outlineCreates: dedupe([...(base?.outlineCreates ?? []), ...(add?.outlineCreates ?? [])], (item) => item.title),
    outlineUpdates: dedupe([...(base?.outlineUpdates ?? []), ...(add?.outlineUpdates ?? [])], (item) => item.matchTitle),
    notes: dedupe([...(base?.notes ?? []), ...(add?.notes ?? [])].filter((note) => String(note).trim()), (note) => String(note))
  }

  const hasContent = Boolean(
    merged.constraintCreates.length ||
    merged.worldviewCreates.length ||
    merged.worldviewUpdates.length ||
    merged.characterCreates.length ||
    merged.characterUpdates.length ||
    merged.outlineCreates.length ||
    merged.outlineUpdates.length ||
    merged.notes.length
  )
  return hasContent ? merged : null
}

function createGlobalAssistantSession(messages?: ChatMessage[]): GlobalAssistantSession {
  const now = new Date().toISOString()
  return {
    id: `global-assistant-session-${Date.now()}`,
    title: resolveGlobalAssistantSessionTitle(messages ?? []),
    messages: cloneMessages(messages),
    proposal: null,
    lastProposalPrompt: '',
    lastAssistantReply: '',
    createdAt: now,
    updatedAt: now
  }
}

function resolveGlobalAssistantSessionTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content.trim()
  if (!firstUserMessage) {
    return '新对话'
  }

  return firstUserMessage.length > 24 ? `${firstUserMessage.slice(0, 24)}...` : firstUserMessage
}

function cloneGlobalAssistantSessions(
  sessions?: GlobalAssistantSession[],
  legacyMessages?: ChatMessage[],
  activeSessionId?: string
): { sessions: GlobalAssistantSession[]; activeSessionId: string; messages: ChatMessage[] } {
  const normalizedSessions = sessions?.length
    ? sessions.map((session) => {
        const messages = cloneMessages(session.messages)
        const createdAt = toIsoTimestamp(session.createdAt)
        return {
          ...session,
          id: session.id || `global-assistant-session-${Date.now()}`,
          title: session.title?.trim() || resolveGlobalAssistantSessionTitle(messages),
          messages,
          proposal: normalizeGlobalAssistantProposal(session.proposal),
          lastProposalPrompt: String(session.lastProposalPrompt ?? ''),
          lastAssistantReply: String(session.lastAssistantReply ?? ''),
          createdAt,
          updatedAt: toIsoTimestamp(session.updatedAt || session.createdAt)
        }
      })
    : [createGlobalAssistantSession(legacyMessages)]

  const active = normalizedSessions.find((session) => session.id === activeSessionId) ?? normalizedSessions[0]

  return {
    sessions: normalizedSessions,
    activeSessionId: active.id,
    messages: active.messages
  }
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
        usage: run.usage && typeof run.usage === 'object'
          ? {
              promptTokens: Number.isFinite(run.usage.promptTokens) ? Math.max(0, Number(run.usage.promptTokens)) : undefined,
              completionTokens: Number.isFinite(run.usage.completionTokens) ? Math.max(0, Number(run.usage.completionTokens)) : undefined,
              totalTokens: Number.isFinite(run.usage.totalTokens) ? Math.max(0, Number(run.usage.totalTokens)) : undefined,
              reasoningTokens: Number.isFinite(run.usage.reasoningTokens) ? Math.max(0, Number(run.usage.reasoningTokens)) : undefined,
              cachedInputTokens: Number.isFinite(run.usage.cachedInputTokens) ? Math.max(0, Number(run.usage.cachedInputTokens)) : undefined
            }
          : undefined,
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
  const assistantSessionState = cloneGlobalAssistantSessions(
    overrides?.globalAssistantSessions,
    overrides?.messages,
    overrides?.activeGlobalAssistantSessionId
  )

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
    messages: assistantSessionState.messages,
    globalAssistantSessions: assistantSessionState.sessions,
    activeGlobalAssistantSessionId: assistantSessionState.activeSessionId,
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
  const assistantSessionState = cloneGlobalAssistantSessions(
    workspace.globalAssistantSessions,
    workspace.messages,
    workspace.activeGlobalAssistantSessionId
  )

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
    messages: assistantSessionState.messages,
    globalAssistantSessions: assistantSessionState.sessions,
    activeGlobalAssistantSessionId: assistantSessionState.activeSessionId,
    aiRuns: cloneAiRuns(workspace.aiRuns),
    workflowDocuments: normalizeWorkflowDocuments(projectLevelDocs),
    plotThreads: Array.isArray(workspace.plotThreads) ? (workspace.plotThreads as PlotThread[]) : []
  }
}
