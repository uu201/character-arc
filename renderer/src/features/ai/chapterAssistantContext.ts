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
  currentOutlineItem?: OutlineItem | null               // 当前章节绑定的大纲节点
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
  currentOutlineItem?: OutlineItem | null               // 当前章节绑定的大纲节点
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
  projectSkills?: Array<{
    id: string
    name: string
    description: string
    content: string
  }>
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

// 构建发送给 AI 的章节助理上下文对象：
// 1. 解析项目写作风格预设
// 2. 基于章节内容筛选最相关的灵感条目（最多6条）
// 3. 将所有数据精简为 AI 所需的字段格式返回
export function buildChapterAssistantContext(input: ChapterAssistantContextInput): Record<string, unknown> {
  const writingStyle = buildProjectWritingStyleContext(input.project)
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
    recentMessages: input.recentMessages,
    // 只传递活跃（open）的剧情线索，精简字段
    plotThreads: input.plotThreads
      .filter((t) => t.status === 'open')
      .map((t) => ({ title: t.title, description: t.description, status: t.status })),
    // 精简世界观字段，只保留标题和内容
    worldviewEntries: input.worldviewEntries.map((entry) => ({
      title: entry.title,
      content: entry.content
    })),
    // 精简角色字段，只保留名称、角色和描述
    characters: input.characters.map((character) => ({
      // 透传 id：主进程 extractCharacterIds 依赖它把 story-state 收敛到本章相关角色，
      // 不带 id 会退化为注入全项目所有角色状态。id 不会被 formatCharacters 渲染进 prompt。
      id: character.id,
      name: character.name,
      role: character.role,
      description: character.description
    })),
    // 精简组织字段，保留核心标识信息
    organizations: input.organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      type: organization.type,
      description: organization.description,
      motto: organization.motto
    })),
    // 精简角色关系字段
    characterRelationships: input.characterRelationships.map((relationship) => ({
      fromCharacterId: relationship.fromCharacterId,
      toCharacterId: relationship.toCharacterId,
      type: relationship.type,
      description: relationship.description,
      intensity: relationship.intensity
    })),
    // 精简组织成员关系字段
    organizationMemberships: input.organizationMemberships.map((membership) => ({
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
    worldviewEntries: input.worldviewEntries.map((entry) => ({
      title: entry.title,
      content: entry.content
    })),
    characters: input.characters.map((character) => ({
      // 透传 id：主进程 extractCharacterIds 依赖它把 story-state 收敛到本章相关角色，
      // 不带 id 会退化为注入全项目所有角色状态。id 不会被 formatCharacters 渲染进 prompt。
      id: character.id,
      name: character.name,
      role: character.role,
      description: character.description
    })),
    organizations: input.organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      type: organization.type,
      description: organization.description,
      motto: organization.motto
    })),
    characterRelationships: input.characterRelationships.map((relationship) => ({
      fromCharacterId: relationship.fromCharacterId,
      toCharacterId: relationship.toCharacterId,
      type: relationship.type,
      description: relationship.description,
      intensity: relationship.intensity
    })),
    organizationMemberships: input.organizationMemberships.map((membership) => ({
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
    currentOutlineItem: input.currentOutlineItem
      ? {
          title: input.currentOutlineItem.title,
          wordTarget: input.currentOutlineItem.wordTarget,
          conflict: input.currentOutlineItem.conflict,
          summary: input.currentOutlineItem.summary
        }
      : null,
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
    userPrompt: input.userPrompt,
    chapterMemo: input.chapterMemo ?? null,
    recentEndingsTrail: input.recentEndingsTrail ?? [],
    previousChapterHandoff: input.previousChapterHandoff ?? null,
    referenceStyleContext: input.referenceStyleContext ?? ''
  }
}
