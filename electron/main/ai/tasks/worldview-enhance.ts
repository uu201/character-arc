import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject, jsonStringField } from './base'
import type { AiTaskResult, WorldviewResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { formatCharacters, formatOrganizations, formatOutlineItems, formatWorldviewEntries } from '../prompts/format-helpers'

const VALID_TYPES = ['地理', '法则', '物种', '势力', '历史']

const handler: TaskHandler = {
  name: 'worldview-enhance',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'worldview', 'characters', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const currentForm = context.currentForm as Record<string, unknown> | undefined

    return {
      system: `${capabilityPreamble.system}\n\n你是小说世界观设定增强助手。用户正在编辑一条世界观词条，请根据已有内容和项目上下文对每个字段进行补充或优化。对于空字段，必须根据项目锚点直接生成，不要向用户提问。对于已有内容的字段，在保留作者意图的基础上扩展和完善。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n当前表单状态：\n- 词条分类：${String(currentForm?.type ?? '')}\n- 词条标题：${String(currentForm?.title ?? '')}\n- 词条内容：${String(currentForm?.content ?? '')}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有世界观词条：${JSON.stringify(context.worldviewTitles ?? [])}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n\n已有世界观详情：\n${formatWorldviewEntries(context.worldviewEntries) || '暂无'}\n\n相关角色：\n${formatCharacters(context.characters) || '暂无'}\n\n相关组织：\n${formatOrganizations(context.organizations) || '暂无'}\n\n相关大纲：\n${formatOutlineItems(context.outlineItems) || '暂无'}\n\n要求：\n1. type：必须是 地理/法则/物种/势力/历史 之一；若已有则保持不变\n2. title：简洁明了；若已有则可微调使其更精准\n3. content：80-180字，完整描述设定的核心规则和作用；若已有则在原文基础上扩展完善\n4. 不与已有词条重复\n5. ${writingStyle}\n\n返回格式：{"type":"","title":"","content":""}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<WorldviewResult>
    const type = jsonStringField(parsed.type, '地理')
    return {
      type: VALID_TYPES.includes(type) ? type : '地理',
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
