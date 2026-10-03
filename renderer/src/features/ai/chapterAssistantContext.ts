import { pickRelevantInspirationEntries } from '@/features/inspiration/relevance'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import type {
  ChapterDraft,
  CharacterCard,
  CharacterRelationship,
  InspirationEntry,
  KnowledgeDocument,
  OrganizationEntry,
  OrganizationMembership,
  OutlineItem,
  OutlineVolume,
  PlotThread,
  ProjectSummary,
  WorkflowDocument,
  WorldviewEntry
} from '@/types/app'

// 章节助理对话消息结构
type ChapterAssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChapterOutlineItemContext = {
  id?: string
  title: string
  wordTarget: string
  conflict: string
  summary: string
  relatedCharacterIds?: string[]
  relatedCharacterNames?: string[]
  relatedOrganizationIds?: string[]
  relatedOrganizationNames?: string[]
  relatedWorldviewIds?: string[]
  relatedWorldviewTitles?: string[]
}

type OutlineItemContextSource = Pick<
  OutlineItem,
  'id' | 'title' | 'wordTarget' | 'conflict' | 'summary' | 'relatedCharacterIds' | 'relatedOrganizationIds' | 'relatedWorldviewIds'
> | ChapterOutlineItemContext

export type ChapterReferencePreview = {
  currentOutlineItem: ChapterOutlineItemContext | null
  characters: Array<{ id: string; name: string; role: string }>
  organizations: Array<{ id: string; name: string; type: string }>
  worldviewEntries: Array<{ id: string; title: string; type: string }>
  characterRelationships: Array<{ id: string; label: string }>
  organizationMemberships: Array<{ id: string; label: string }>
  counts: {
    characters: number
    organizations: number
    worldviewEntries: number
    characterRelationships: number
    organizationMemberships: number
  }
}

// 构建章节助理上下文所需的全部输入数据
type ChapterAssistantContextInput = {
  project?: ProjectSummary                              // 当前项目信息
  chapter?: ChapterDraft                                // 当前编辑的章节
  chapterVolume?: OutlineVolume                         // 当前章节所属的分卷
  relatedChapters: Array<{                              // 关联章节的摘要信息，用于上下文连贯
    title: string
    summary: string
    preview: string
  }>
  volumeChapterSummaries: Array<{                       // 当前分卷内其他章节的摘要（不含 relatedChapters）
    title: string
    summary: string
  }>
  novelOpenerSummary?: {                                // 全书第 1 章摘要（世界/角色基调参照）
    title: string
    summary: string
  }
  recentMessages: ChapterAssistantMessage[]             // 最近的对话消息，用于维持对话上下文
  worldviewEntries: WorldviewEntry[]                    // 世界观设定列表
  characters: CharacterCard[]                           // 角色卡列表
  organizations: OrganizationEntry[]                    // 组织列表
  characterRelationships: CharacterRelationship[]       // 角色关系列表
  organizationMemberships: OrganizationMembership[]     // 组织成员关系列表
  inspirationEntries: InspirationEntry[]                // 灵感条目列表
  currentOutlineItem?: ChapterOutlineItemContext | null // 当前章节绑定的大纲节点
  outlineChapterSplit?: {                               // 同一大纲拆成多章时的章节位置
    currentPart: number
    totalParts: number
    previousParts: Array<{
      title: string
      summary: string
      preview?: string
    }>
  } | null
  outlineItems: OutlineItem[]                           // 大纲条目列表
  plotThreads: PlotThread[]                             // 剧情线索（活跃伏笔）
  projectSkills?: Array<{                               // 当前项目启用的 skills 摘要
    id: string
    name: string
    description: string
    content: string
  }>
  workflowDocuments?: WorkflowDocument[]                // 当前激活分卷的创作记忆
  knowledgeDocuments?: KnowledgeDocument[]              // 当前项目知识文档摘要
  selectedText: string                                  // 编辑器中用户选中的文本片段
  responseMode: 'freeform' | 'polish' | 'continue' | 'suggest' | 'reference'  // 响应模式
  responseLength: 'short' | 'medium' | 'long'          // 期望的响应长度
  quickAction?: string                                  // 触发的快捷动作标识
  diffReviewMode?: boolean                              // 是否要求正文修改走 Diff 审阅
  userPrompt: string                                    // 用户输入的提示词
  chapterContent: string                                // 当前章节的完整正文内容
}

export type ChapterFirstDraftContextInput = {
  project?: ProjectSummary
  chapter?: ChapterDraft
  chapterIndex: number
  chapterVolume?: OutlineVolume
  relatedChapters: Array<{
    title: string
    summary: string
    preview?: string
  }>
  volumeChapterSummaries: Array<{                       // 当前分卷内其他章节的摘要
    title: string
    summary: string
  }>
  novelOpenerSummary?: {                                // 全书第 1 章摘要
    title: string
    summary: string
  }
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  organizations: OrganizationEntry[]
  characterRelationships: CharacterRelationship[]
  organizationMemberships: OrganizationMembership[]
  inspirationEntries: InspirationEntry[]
  currentOutlineItem?: ChapterOutlineItemContext | null // 当前章节绑定的大纲节点
  outlineChapterSplit?: {                               // 同一大纲拆成多章时的章节位置
    currentPart: number
    totalParts: number
    previousParts: Array<{
      title: string
      summary: string
      preview?: string
    }>
  } | null
  outlineItems: OutlineItem[]
  plotThreads: PlotThread[]                             // 剧情线索（活跃伏笔）
  projectSkills?: ProjectSummary['projectSkills']
  skillPolicy?: ProjectSummary['skillPolicy']
  knowledgeDocuments?: KnowledgeDocument[]
  chapterContent: string
  targetWordCount: number
  userPrompt: string
  chapterMemo?: {
    currentTask: string
    readerExpectation: string
    payoffs: string[]
    holds: string[]
    transitionFunctions: string
    decisionChecks: string[]
    endingChanges: string[]
    doNotDo: string[]
    emotionArc: string
  }
  recentEndingsTrail?: Array<{ chapterTitle: string; endingLine: string }>
  previousChapterHandoff?: {                            // 上一章结尾原文，供本章自然接续（L2 接续契约）
    title: string
    endingText: string
  }
  referenceStyleContext?: string
}

const CONTEXT_CHARACTER_LIMIT = 8
const CONTEXT_WORLDVIEW_LIMIT = 8
const CONTEXT_ORGANIZATION_LIMIT = 6
const CONTEXT_RELATION_LIMIT = 8
const CONTEXT_MEMBERSHIP_LIMIT = 8

function normalizeContextText(value: unknown, maxLength = 12000): string {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .toLocaleLowerCase()
}

function countOccurrences(source: string, phrase: string): number {
  const value = phrase.trim().toLocaleLowerCase()
  if (value.length < 2) return 0
  let count = 0
  let start = 0
  while (start < source.length) {
    const index = source.indexOf(value, start)
    if (index < 0) break
    count += 1
    start = index + value.length
  }
  return count
}

function rankContextEntries<T>(
  items: T[],
  fields: (item: T) => string[],
  limit: number,
  queryText: string,
  priorityIds: Set<string> = new Set(),
  getId?: (item: T) => string,
  includeUnmatched = true
): T[] {
  const query = normalizeContextText(queryText)
  return items
    .map((item, index) => {
      const values = fields(item).map((value) => normalizeContextText(value, 500)).filter(Boolean)
      const score = values.reduce((total, value, fieldIndex) => {
        const occurrences = countOccurrences(query, value)
        return total + occurrences * (fieldIndex === 0 ? 12 : 2)
      }, 0)
      const id = getId ? getId(item) : ''
      const priority = id && priorityIds.has(id) ? 1000 : 0
      return { item, index, score: score + priority }
    })
    .filter(({ score }) => includeUnmatched || score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item)
}

export function buildOutlineItemContext(
  source?: OutlineItemContextSource | null,
  lookups?: {
    characters?: CharacterCard[]
    organizations?: OrganizationEntry[]
    worldviewEntries?: WorldviewEntry[]
  }
): ChapterOutlineItemContext | null {
  if (!source) return null
  const id = String(source.id ?? '').trim()
  const title = String(source.title ?? '').trim()
  const wordTarget = String(source.wordTarget ?? '').trim()
  const conflict = String(source.conflict ?? '').trim()
  const summary = String(source.summary ?? '').trim()
  const relatedCharacterIds = Array.isArray(source.relatedCharacterIds) ? [...new Set(source.relatedCharacterIds.map((id) => String(id).trim()).filter(Boolean))] : []
  const relatedOrganizationIds = Array.isArray(source.relatedOrganizationIds) ? [...new Set(source.relatedOrganizationIds.map((id) => String(id).trim()).filter(Boolean))] : []
  const relatedWorldviewIds = Array.isArray(source.relatedWorldviewIds) ? [...new Set(source.relatedWorldviewIds.map((id) => String(id).trim()).filter(Boolean))] : []
  const characterNameById = new Map((lookups?.characters ?? []).map((character) => [character.id, character.name]))
  const organizationNameById = new Map((lookups?.organizations ?? []).map((organization) => [organization.id, organization.name]))
  const worldviewTitleById = new Map((lookups?.worldviewEntries ?? []).map((entry) => [entry.id, entry.title]))
  const relatedCharacterNames = relatedCharacterIds.map((id) => characterNameById.get(id) ?? id).filter(Boolean)
  const relatedOrganizationNames = relatedOrganizationIds.map((id) => organizationNameById.get(id) ?? id).filter(Boolean)
  const relatedWorldviewTitles = relatedWorldviewIds.map((id) => worldviewTitleById.get(id) ?? id).filter(Boolean)
  if (!title && !summary && !conflict) return null
  return {
    ...(id ? { id } : {}),
    title,
    wordTarget,
    conflict,
    summary,
    ...(relatedCharacterIds.length ? { relatedCharacterIds } : {}),
    ...(relatedCharacterNames.length ? { relatedCharacterNames } : {}),
    ...(relatedOrganizationIds.length ? { relatedOrganizationIds } : {}),
    ...(relatedOrganizationNames.length ? { relatedOrganizationNames } : {}),
    ...(relatedWorldviewIds.length ? { relatedWorldviewIds } : {}),
    ...(relatedWorldviewTitles.length ? { relatedWorldviewTitles } : {})
  }
}

function selectRelevantReferenceData(input: {
  chapter?: ChapterDraft
  chapterContent: string
  currentOutlineItem?: ChapterOutlineItemContext | null
  relatedChapters: Array<{ title: string; summary: string; preview?: string }>
  selectedText?: string
  userPrompt: string
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  organizations: OrganizationEntry[]
  characterRelationships: CharacterRelationship[]
  organizationMemberships: OrganizationMembership[]
}) {
  const outline = input.currentOutlineItem
  const contextQuery = [
    input.chapter?.title,
    input.chapter?.summary,
    input.chapterContent,
    input.selectedText,
    input.userPrompt,
    outline?.title,
    outline?.conflict,
    outline?.summary,
    ...input.relatedChapters.flatMap((chapter) => [chapter.title, chapter.summary, chapter.preview])
  ].filter(Boolean).join('\n')

  const preferredCharacterIds = new Set(outline?.relatedCharacterIds ?? [])
  const preferredOrganizationIds = new Set(outline?.relatedOrganizationIds ?? [])
  const preferredWorldviewIds = new Set(outline?.relatedWorldviewIds ?? [])

  const characters = rankContextEntries(
    input.characters,
    (character) => [character.name, character.role, character.description, character.tags.map((tag) => tag.label).join(' ')],
    CONTEXT_CHARACTER_LIMIT,
    contextQuery,
    preferredCharacterIds,
    (character) => character.id
  )
  const characterIds = new Set(characters.map((character) => character.id))
  // Keep the other endpoint of a directly relevant relationship when it is just outside the first ranking.
  for (const relationship of input.characterRelationships) {
    if (!characterIds.has(relationship.fromCharacterId) && !characterIds.has(relationship.toCharacterId)) continue
    const counterpartId = characterIds.has(relationship.fromCharacterId)
      ? relationship.toCharacterId
      : relationship.fromCharacterId
    const counterpart = input.characters.find((character) => character.id === counterpartId)
    if (counterpart && !characterIds.has(counterpart.id)) {
      if (characters.length >= CONTEXT_CHARACTER_LIMIT) {
        const removed = characters.pop()
        if (removed) characterIds.delete(removed.id)
      }
      characters.push(counterpart)
      characterIds.add(counterpart.id)
    }
  }

  const organizations = rankContextEntries(
    input.organizations,
    (organization) => [organization.name, organization.type, organization.description, organization.motto],
    CONTEXT_ORGANIZATION_LIMIT,
    contextQuery,
    preferredOrganizationIds,
    (organization) => organization.id
  )
  const organizationIds = new Set(organizations.map((organization) => organization.id))
  const worldviews = rankContextEntries(
    input.worldviewEntries,
    (entry) => [entry.title, entry.type, entry.content],
    CONTEXT_WORLDVIEW_LIMIT,
    contextQuery,
    preferredWorldviewIds,
    (entry) => entry.id,
    false
  )
  const relationships = rankContextEntries(
    input.characterRelationships.filter((relationship) => (
      characterIds.has(relationship.fromCharacterId) || characterIds.has(relationship.toCharacterId)
    )),
    (relationship) => [relationship.type, relationship.description],
    CONTEXT_RELATION_LIMIT,
    contextQuery
  )
  const memberships = rankContextEntries(
    input.organizationMemberships.filter((membership) => (
      characterIds.has(membership.characterId) || organizationIds.has(membership.organizationId)
    )),
    (membership) => [membership.role, membership.notes],
    CONTEXT_MEMBERSHIP_LIMIT,
    contextQuery
  )

  return { worldviewEntries: worldviews, characters, organizations, characterRelationships: relationships, organizationMemberships: memberships }
}

export function buildChapterReferencePreview(input: {
  chapter?: ChapterDraft
  chapterContent: string
  currentOutlineItem?: ChapterOutlineItemContext | null
  relatedChapters: Array<{ title: string; summary: string; preview?: string }>
  selectedText?: string
  userPrompt: string
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  organizations: OrganizationEntry[]
  characterRelationships: CharacterRelationship[]
  organizationMemberships: OrganizationMembership[]
}): ChapterReferencePreview {
  const referenceData = selectRelevantReferenceData(input)
  const characterNameById = new Map(input.characters.map((character) => [character.id, character.name]))
  const organizationNameById = new Map(input.organizations.map((organization) => [organization.id, organization.name]))

  return {
    currentOutlineItem: input.currentOutlineItem ?? null,
    characters: referenceData.characters.map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role
    })),
    organizations: referenceData.organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      type: organization.type
    })),
    worldviewEntries: referenceData.worldviewEntries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      type: entry.type
    })),
    characterRelationships: referenceData.characterRelationships.map((relationship) => ({
      id: relationship.id,
      label: [
        characterNameById.get(relationship.fromCharacterId) ?? relationship.fromCharacterId,
        relationship.type,
        characterNameById.get(relationship.toCharacterId) ?? relationship.toCharacterId
      ].filter(Boolean).join(' · ')
    })),
    organizationMemberships: referenceData.organizationMemberships.map((membership) => ({
      id: membership.id,
      label: [
        characterNameById.get(membership.characterId) ?? membership.characterId,
        membership.role,
        organizationNameById.get(membership.organizationId) ?? membership.organizationId
      ].filter(Boolean).join(' · ')
    })),
    counts: {
      characters: referenceData.characters.length,
      organizations: referenceData.organizations.length,
      worldviewEntries: referenceData.worldviewEntries.length,
      characterRelationships: referenceData.characterRelationships.length,
      organizationMemberships: referenceData.organizationMemberships.length
    }
  }
}

// 构建发送给 AI 的章节助理上下文对象：
// 1. 解析项目写作风格预设
// 2. 基于章节内容筛选最相关的灵感条目（最多6条）
// 3. 按当前章节/大纲相关性筛选参考实体，再精简为 AI 所需的字段格式返回
export function buildChapterAssistantContext(input: ChapterAssistantContextInput): Record<string, unknown> {
  const writingStyle = buildProjectWritingStyleContext(input.project)
  const relevantReferenceData = selectRelevantReferenceData(input)
  const currentOutlineItem = buildOutlineItemContext(input.currentOutlineItem, {
    characters: input.characters,
    organizations: input.organizations,
    worldviewEntries: input.worldviewEntries
  })
  // 根据当前章节标题、摘要和正文内容，从灵感库中挑选最相关的条目
  const relevantInspirationEntries = pickRelevantInspirationEntries(
    input.inspirationEntries,
    {
      title: input.chapter?.title,
      summary: input.chapter?.summary,
      content: input.chapterContent
    },
    6
  )

  return {
    projectId: input.project?.id,
    projectTitle: input.project?.title,
    projectGenre: input.project?.genre,
    writingStyleLabel: writingStyle.label,
    writingStylePrompt: writingStyle.prompt,
    chapterVolume: input.chapterVolume?.title,
    chapterTitle: input.chapter?.title,
    chapterSummary: input.chapter?.summary,
    chapterStatus: input.chapter?.status,
    chapterWordTarget: input.chapter?.wordTarget,
    chapterContent: input.chapterContent,
    chapterVolumeTitle: input.chapterVolume?.title,
    chapterVolumeSummary: input.chapterVolume?.summary,
    relatedChapters: input.relatedChapters,
    volumeChapterSummaries: input.volumeChapterSummaries,
    novelOpenerSummary: input.novelOpenerSummary ?? null,
    currentOutlineItem,
    recentMessages: input.recentMessages,
    // 只传递活跃（open）的剧情线索，精简字段
    plotThreads: input.plotThreads
      .filter((t) => t.status === 'open')
      .map((t) => ({ title: t.title, description: t.description, status: t.status })),
    // 精简世界观字段，只保留标题和内容
    worldviewEntries: relevantReferenceData.worldviewEntries.map((entry) => ({
      title: entry.title,
      content: entry.content
    })),
    // 精简角色字段，保留会直接影响剧情和行为逻辑的关键标签
    characters: relevantReferenceData.characters.map((character) => ({
      // 透传 id：主进程 extractCharacterIds 依赖它把 story-state 收敛到本章相关角色，
      // 不带 id 会退化为注入全项目所有角色状态。id 不会被 formatCharacters 渲染进 prompt。
      id: character.id,
      name: character.name,
      role: character.role,
      description: character.description,
      tags: character.tags.map((tag) => tag.label)
    })),
    // 精简组织字段，保留核心标识信息
    organizations: relevantReferenceData.organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      type: organization.type,
      description: organization.description,
      motto: organization.motto
    })),
    // 精简角色关系字段
    characterRelationships: relevantReferenceData.characterRelationships.map((relationship) => ({
      fromCharacterId: relationship.fromCharacterId,
      toCharacterId: relationship.toCharacterId,
      type: relationship.type,
      description: relationship.description,
      intensity: relationship.intensity
    })),
    // 精简组织成员关系字段
    organizationMemberships: relevantReferenceData.organizationMemberships.map((membership) => ({
      characterId: membership.characterId,
      organizationId: membership.organizationId,
      role: membership.role,
      notes: membership.notes
    })),
    // 只包含与当前章节相关的灵感条目
    inspirationEntries: relevantInspirationEntries.map((entry) => ({
      type: entry.type,
      title: entry.title,
      content: entry.content,
      tags: entry.tags
    })),
    // 精简大纲字段
    outlineItems: input.outlineItems.map((item) => ({
      title: item.title,
      summary: item.summary
    })),
    workflowDocuments: (input.workflowDocuments ?? []).map((document) => ({
      key: document.key,
      title: document.title,
      content: document.content
    })),
    knowledgeDocuments: (input.knowledgeDocuments ?? []).slice(0, 8).map((document) => ({
      id: document.id,
      title: document.title,
      sourceType: document.sourceType,
      sourceLabel: document.sourceLabel,
      summary: document.summary,
      keywords: document.keywords
    })),
    projectSkills: input.projectSkills ?? [],
    selectedText: input.selectedText,
    responseMode: input.responseMode,
    responseLength: input.responseLength,
    quickAction: input.quickAction,
    diffReviewMode: input.diffReviewMode ?? false,
    userPrompt: input.userPrompt
  }
}

export function buildChapterFirstDraftContext(input: ChapterFirstDraftContextInput): Record<string, unknown> {
  const writingStyle = buildProjectWritingStyleContext(input.project)
  const normalizedChapterContent = input.chapterContent.trim()
  const relevantReferenceData = selectRelevantReferenceData({
    ...input,
    chapterContent: normalizedChapterContent
  })
  const currentOutlineItem = buildOutlineItemContext(input.currentOutlineItem, {
    characters: input.characters,
    organizations: input.organizations,
    worldviewEntries: input.worldviewEntries
  })
  const relevantInspirationEntries = pickRelevantInspirationEntries(
    input.inspirationEntries,
    {
      title: input.chapter?.title,
      summary: input.chapter?.summary,
      content: normalizedChapterContent
    },
    6
  )

  return {
    projectId: input.project?.id,
    projectTitle: input.project?.title,
    projectGenre: input.project?.genre,
    writingStyleLabel: writingStyle.label,
    writingStylePrompt: writingStyle.prompt,
    chapterId: input.chapter?.id,
    chapterIndex: input.chapterIndex,
    deferStoryStateUntilFinal: true,
    chapterTitle: input.chapter?.title,
    chapterSummary: input.chapter?.summary,
    chapterStatus: input.chapter?.status,
    chapterWordTarget: input.chapter?.wordTarget,
    chapterContent: normalizedChapterContent,
    chapterHasExistingContent: Boolean(normalizedChapterContent),
    targetWordCount: input.targetWordCount,
    chapterVolumeTitle: input.chapterVolume?.title,
    chapterVolumeSummary: input.chapterVolume?.summary,
    relatedChapters: input.relatedChapters,
    volumeChapterSummaries: input.volumeChapterSummaries,
    novelOpenerSummary: input.novelOpenerSummary ?? null,
    // 只传递活跃（open）的剧情线索
    plotThreads: input.plotThreads
      .filter((t) => t.status === 'open')
      .map((t) => ({ title: t.title, description: t.description, status: t.status })),
    worldviewEntries: relevantReferenceData.worldviewEntries.map((entry) => ({
      title: entry.title,
      content: entry.content
    })),
    characters: relevantReferenceData.characters.map((character) => ({
      // 透传 id：主进程 extractCharacterIds 依赖它把 story-state 收敛到本章相关角色，
      // 不带 id 会退化为注入全项目所有角色状态。id 不会被 formatCharacters 渲染进 prompt。
      id: character.id,
      name: character.name,
      role: character.role,
      description: character.description,
      tags: character.tags.map((tag) => tag.label)
    })),
    organizations: relevantReferenceData.organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      type: organization.type,
      description: organization.description,
      motto: organization.motto
    })),
    characterRelationships: relevantReferenceData.characterRelationships.map((relationship) => ({
      fromCharacterId: relationship.fromCharacterId,
      toCharacterId: relationship.toCharacterId,
      type: relationship.type,
      description: relationship.description,
      intensity: relationship.intensity
    })),
    organizationMemberships: relevantReferenceData.organizationMemberships.map((membership) => ({
      characterId: membership.characterId,
      organizationId: membership.organizationId,
      role: membership.role,
      notes: membership.notes
    })),
    inspirationEntries: relevantInspirationEntries.map((entry) => ({
      type: entry.type,
      title: entry.title,
      content: entry.content,
      tags: entry.tags
    })),
    currentOutlineItem,
    outlineChapterSplit: input.outlineChapterSplit ?? null,
    outlineItems: input.outlineItems.map((item) => ({
      title: item.title,
      conflict: item.conflict,
      isCurrent: input.currentOutlineItem ? item.id === input.currentOutlineItem.id : false,
      summary: item.summary
    })),
    knowledgeDocuments: (input.knowledgeDocuments ?? []).slice(0, 8).map((document) => ({
      id: document.id,
      title: document.title,
      sourceType: document.sourceType,
      sourceLabel: document.sourceLabel,
      summary: document.summary,
      keywords: document.keywords
    })),
    ...(input.projectSkills !== undefined ? { projectSkills: input.projectSkills } : {}),
    ...(input.skillPolicy !== undefined ? { skillPolicy: input.skillPolicy } : {}),
    userPrompt: input.userPrompt,
    chapterMemo: input.chapterMemo ?? null,
    recentEndingsTrail: input.recentEndingsTrail ?? [],
    previousChapterHandoff: input.previousChapterHandoff ?? null,
    referenceStyleContext: input.referenceStyleContext ?? ''
  }
}
