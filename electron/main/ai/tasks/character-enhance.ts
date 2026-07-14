import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject, jsonStringField } from './base'
import type { AiTaskResult, CharacterResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { formatOrganizations, formatCharacterRelationships, formatOrganizationMemberships, formatWorldviewEntries } from '../prompts/format-helpers'

/** 检测模型返回的占位符 / 拒绝性内容 */
const REFUSAL_RE = /未定义|待补充|无法生成|信息不足|缺少.*(?:信息|档案|资料)|(?:not|cannot|unable)\s+(?:generate|provide|create)/i

function sanitizeField(value?: string): string {
  if (!value) return ''
  return REFUSAL_RE.test(value) ? '' : value
}

const handler: TaskHandler = {
  name: 'character-enhance',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'characters', 'relations', 'worldview', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const organizations = formatOrganizations(context.organizations)
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters)
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters)
    const worldview = formatWorldviewEntries(context.worldviewEntries)
    const currentForm = context.currentForm as Record<string, unknown> | undefined
    const allEmpty = !currentForm?.name && !currentForm?.role && !currentForm?.description && (!currentForm?.tags || (Array.isArray(currentForm.tags) && currentForm.tags.length === 0))
    const taskDirective = allEmpty
      ? '所有字段均为空，这是一个**新建角色**任务。你必须从零创作一个完整的角色设定，所有字段都必须填入有实质内容的值，绝不允许返回空字符串或占位符。'
      : '用户正在编辑一个角色卡片，请根据已有内容和项目上下文对每个字段进行补充或优化。对于空字段，生成合适的内容；对于已有内容的字段，在保留作者意图的基础上扩展和完善。'

    return {
      system: `${capabilityPreamble.system}\n\n你是小说角色设定助手。${taskDirective}\n\n重要约束：\n- 你必须直接返回填充完毕的 JSON，不要询问用户任何问题\n- 即使上下文信息有限，你也必须根据已有信息发挥创造力，生成完整内容\n- 绝不允许返回占位内容（如"未定义""待补充""无法生成""信息不足"等）\n- 请只返回 JSON 对象，不要返回 Markdown 或任何解释文字`,
      user: `${capabilityPreamble.user}\n\n当前表单状态：\n- 角色名称：${String(currentForm?.name ?? '') || '（待生成）'}\n- 角色定位：${String(currentForm?.role ?? '') || '（待生成）'}\n- 角色简介：${String(currentForm?.description ?? '') || '（待生成）'}\n- 角色标签：${JSON.stringify(currentForm?.tags ?? [])}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n\n相关世界观：\n${worldview || '暂无'}\n\n已有组织：\n${organizations || '暂无'}\n\n已有角色关系：\n${relationships || '暂无'}\n\n已有成员归属：\n${memberships || '暂无'}\n\n要求：\n1. name：生成不与已有角色重名的名字\n2. role：用短语概括角色定位\n3. description：80-160字，按"核心定位 + 反差细节 + 动机逻辑"组织\n4. tags：2-4个简短标签数组\n5. 新内容要能自然嵌入现有角色关系网络\n6. ${writingStyle}\n\n返回格式（所有值必须填充实质内容）：{"name":"...","role":"...","description":"...","tags":["...","..."]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<CharacterResult>
    const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 4) : []
    return {
      name: sanitizeField(jsonStringField(parsed.name)),
      role: sanitizeField(jsonStringField(parsed.role)),
      description: sanitizeField(jsonStringField(parsed.description)),
      tags: tags.filter((t) => !REFUSAL_RE.test(t))
    } as CharacterResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as CharacterResult
    return Boolean(r.name?.trim() && r.role?.trim() && r.description?.trim() && r.tags?.length >= 2 && !REFUSAL_RE.test(r.name) && !REFUSAL_RE.test(r.description))
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const r = result as CharacterResult
    const errors: string[] = []
    if (!r.name?.trim()) errors.push('缺少 name。')
    if (!r.role?.trim()) errors.push('缺少 role。')
    if (!r.description?.trim()) errors.push('缺少 description。')
    if (!r.tags || r.tags.length < 2) errors.push('tags 至少需要 2 项。')
    return errors
  }
}
export default handler
