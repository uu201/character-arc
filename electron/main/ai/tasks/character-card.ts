import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject, jsonStringField } from './base'
import type { AiTaskResult, CharacterResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { formatOrganizations, formatCharacterRelationships, formatOrganizationMemberships, formatWorldviewEntries } from '../prompts/format-helpers'

/** 角色卡片生成任务：为小说项目生成一名新角色（名称/定位/描述/标签） */

/** 检测模型返回的占位符 / 拒绝性内容 */
const REFUSAL_RE = /未定义|待补充|无法生成|信息不足|缺少.*(?:信息|档案|资料)|(?:not|cannot|unable)\s+(?:generate|provide|create)/i

/** 如果字段值是拒绝性占位符，返回空字符串，让 validate 失败并触发修复 */
function sanitizeField(value?: string): string {
  if (!value) return ''
  return REFUSAL_RE.test(value) ? '' : value
}

const handler: TaskHandler = {
  name: 'character-card',
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
    return {
      system: `${capabilityPreamble.system}\n\n你是小说角色设定助手。你的任务是为小说项目从零创作一名新角色。\n\n重要约束：\n- 你必须直接返回填充完毕的 JSON，不要询问用户任何问题\n- 即使上下文信息有限，你也必须根据已有信息发挥创造力，生成完整的角色设定\n- 绝不允许返回占位内容（如"未定义""待补充""无法生成""信息不足"等）\n- description 中不允许出现"无法生成""信息不足""缺少"等拒绝性表述\n- 请只返回 JSON 对象，不要返回 Markdown 或任何解释文字`,
      user: `${capabilityPreamble.user}\n\n基于以下上下文，为当前小说项目生成一名新角色。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n\n相关世界观：\n${worldview || '暂无'}\n\n已有组织：\n${organizations || '暂无'}\n\n已有角色关系：\n${relationships || '暂无'}\n\n已有成员归属：\n${memberships || '暂无'}\n\n要求：\n1. 不与已有角色重名\n2. role 用短语概括角色定位\n3. 新角色要尽量能自然嵌入现有关系网络或组织结构，避免像孤立路人\n4. description 用中文完整描述，80 到 160 字，按"核心定位 + 反差细节 + 动机逻辑"组织\n5. tags 返回 2 到 4 个简短标签数组\n6. ${writingStyle}\n\n返回格式（所有值必须填充实质内容，不允许为空或占位符）：{"name":"...","role":"...","description":"...","tags":["...","..."]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<CharacterResult>
    const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 4) : []
    const name = sanitizeField(jsonStringField(parsed.name))
    const role = sanitizeField(jsonStringField(parsed.role))
    const description = sanitizeField(jsonStringField(parsed.description))
    return {
      name,
      role,
      description,
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
