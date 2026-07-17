import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject, jsonStringField } from './base'
import type { AiTaskResult, WorldviewResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { formatCharacters, formatOrganizations, formatOutlineItems, formatWorldviewEntries } from '../prompts/format-helpers'
import { normalizeWorldviewType } from './worldview-type'

/** 世界观设定生成任务：为小说项目新增一条世界观设定 */
const handler: TaskHandler = {
  name: 'worldview-entry',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'worldview', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    return {
      system: `${capabilityPreamble.system}\n\n你是小说世界观设定助手。必须直接生成完整设定，不要向用户提问。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 type、title、content。type 只能使用中文分类：地理、法则、物种、势力、历史。`,
      user: `${capabilityPreamble.user}\n\n基于以下上下文，为当前小说项目新增一条世界观设定。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有世界观：${JSON.stringify(context.worldviewTitles ?? [])}\n\n已有世界观详情：\n${formatWorldviewEntries(context.worldviewEntries) || '暂无'}\n\n相关角色：\n${formatCharacters(context.characters) || '暂无'}\n\n相关组织：\n${formatOrganizations(context.organizations) || '暂无'}\n\n相关大纲：\n${formatOutlineItems(context.outlineItems) || '暂无'}\n\n要求：\n1. 返回一条不与已有条目重复的新设定\n2. type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一\n3. title 要简洁\n4. content 用中文完整描述，80 到 180 字\n5. ${writingStyle}\n\n返回格式：{"type":"","title":"","content":""}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<WorldviewResult>
    return {
      type: normalizeWorldviewType(jsonStringField(parsed.type, '地理')),
      title: jsonStringField(parsed.title),
      content: jsonStringField(parsed.content)
    } as WorldviewResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as WorldviewResult
    return Boolean(r.title?.trim() && r.content?.trim())
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const r = result as WorldviewResult
    const errors: string[] = []
    if (!r.title?.trim()) errors.push('缺少 title。')
    if (!r.content?.trim()) errors.push('缺少 content。')
    return errors
  }
}
export default handler
