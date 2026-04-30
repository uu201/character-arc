import { pickRelevantInspirationEntries } from '@/features/inspiration/relevance'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import type {
  ChapterDraft,
  CharacterCard,
  CharacterRelationship,
  InspirationEntry,
  OrganizationEntry,
  OrganizationMembership,
  OutlineItem,
  OutlineVolume,
  ProjectSummary,
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
  recentMessages: ChapterAssistantMessage[]             // 最近的对话消息，用于维持对话上下文
  worldviewEntries: WorldviewEntry[]                    // 世界观设定列表
  characters: CharacterCard[]                           // 角色卡列表
  organizations: OrganizationEntry[]                    // 组织列表
  characterRelationships: CharacterRelationship[]       // 角色关系列表
  organizationMemberships: OrganizationMembership[]     // 组织成员关系列表
  inspirationEntries: InspirationEntry[]                // 灵感条目列表
  outlineItems: OutlineItem[]                           // 大纲条目列表
  selectedText: string                                  // 编辑器中用户选中的文本片段
  responseMode: 'freeform' | 'polish' | 'continue' | 'suggest' | 'reference'  // 响应模式
  responseLength: 'short' | 'medium' | 'long'          // 期望的响应长度
  quickAction?: string                                  // 触发的快捷动作标识
  userPrompt: string                                    // 用户输入的提示词
  chapterContent: string                                // 当前章节的完整正文内容
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
    recentMessages: input.recentMessages,
    // 精简世界观字段，只保留标题和内容
    worldviewEntries: input.worldviewEntries.map((entry) => ({
      title: entry.title,
      content: entry.content
    })),
    // 精简角色字段，只保留名称、角色和描述
    characters: input.characters.map((character) => ({
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
    selectedText: input.selectedText,
    responseMode: input.responseMode,
    responseLength: input.responseLength,
    quickAction: input.quickAction,
    userPrompt: input.userPrompt
  }
}
