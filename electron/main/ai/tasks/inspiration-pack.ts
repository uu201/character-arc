import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject, jsonStringField } from './base'
import type { AiTaskResult, InspirationPackResult, InspirationResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { formatWorldviewEntries, formatCharacters, formatOrganizations, formatCharacterRelationships, formatOrganizationMemberships, formatInspirationEntries, formatOutlineItems } from '../prompts/format-helpers'

/** 灵感包生成任务：围绕当前章节生成一组灵感卡片 */
const handler: TaskHandler = {
  name: 'inspiration-pack',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'inspiration', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const compact = (value: unknown, maxLength: number) => {
      const text = String(value ?? '').trim()
      return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
    }
    return {
      system: `${capabilityPreamble.system}\n\n你是小说灵感生成助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 entries，entries 中每一项都必须包含 type、title、content、tags。`,
      user: `${capabilityPreamble.user}\n\n请围绕当前小说项目生成一组可直接保存的灵感卡片。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${compact(context.chapterSummary, 800)}\n当前章节正文：\n${compact(context.chapterContent, 4000)}\n\n灵感焦点：${String(context.focusType ?? '场景火花')}\n已有灵感标题：${JSON.stringify(context.existingInspirationTitles ?? [])}\n\n相关世界观：\n${compact(formatWorldviewEntries(context.worldviewEntries), 1000) || '暂无'}\n\n相关角色：\n${compact(formatCharacters(context.characters), 1000) || '暂无'}\n\n相关组织：\n${compact(formatOrganizations(context.organizations), 800) || '暂无'}\n\n角色关系：\n${compact(formatCharacterRelationships(context.characterRelationships, context.characters), 1000) || '暂无'}\n\n成员归属：\n${compact(formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters), 800) || '暂无'}\n\n相关大纲：\n${compact(formatOutlineItems(context.outlineItems), 1000) || '暂无'}\n\n要求：\n1. entries 必须返回完整的 4 条灵感卡片\n2. type 必须从：标题灵感、开篇钩子、场景火花、剧情转折、设定补完、人物动机 中选\n3. content 60 到 140 字\n4. tags 返回 2 到 4 个简短标签\n5. ${writingStyle}\n\n返回格式：{"entries":[{"type":"","title":"","content":"","tags":[""]}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<InspirationPackResult>
    const entries = Array.isArray(parsed.entries) ? parsed.entries.slice(0, 6).map((e) => {
      const entry = e as Partial<InspirationResult>
      const tags = Array.isArray(entry.tags) ? entry.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 4) : []
      return { type: jsonStringField(entry.type), title: jsonStringField(entry.title), content: jsonStringField(entry.content), tags } as InspirationResult
    }) : []
    return { entries } as InspirationPackResult
  },
  validate(result: AiTaskResult): boolean {
    const entries = (result as InspirationPackResult).entries
    return entries.length === 4 && entries.every((entry) => entry.type.trim() && entry.title.trim() && entry.content.trim() && entry.tags.length >= 2)
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const entries = (result as InspirationPackResult).entries
    if (entries.length !== 4) return [`entries 必须恰好返回 4 条，当前为 ${entries.length} 条。`]
    return entries.some((entry) => !entry.type.trim() || !entry.title.trim() || !entry.content.trim() || entry.tags.length < 2)
      ? ['每条灵感必须包含 type、title、content 和至少 2 个 tags。']
      : []
  }
}
export default handler
