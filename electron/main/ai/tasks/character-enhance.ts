import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, CharacterResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { formatOrganizations, formatCharacterRelationships, formatOrganizationMemberships } from '../prompts/format-helpers'

const handler: TaskHandler = {
  name: 'character-enhance',
  outputType: 'json',
  defaultCapabilities: ['settings', 'characters', 'relations', 'worldview', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const organizations = formatOrganizations(context.organizations)
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters)
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters)
    const currentForm = context.currentForm as Record<string, unknown> | undefined

    return {
      system: `${capabilityPreamble.system}\n\n你是小说角色设定增强助手。用户正在编辑一个角色卡片，请根据已有内容和项目上下文对每个字段进行补充或优化。对于空字段，生成合适的内容；对于已有内容的字段，在保留作者意图的基础上扩展和完善。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n当前表单状态：\n- 角色名称：${String(currentForm?.name ?? '')}\n- 角色定位：${String(currentForm?.role ?? '')}\n- 角色简介：${String(currentForm?.description ?? '')}\n- 角色标签：${JSON.stringify(currentForm?.tags ?? [])}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n\n已有组织：\n${organizations || '暂无'}\n\n已有角色关系：\n${relationships || '暂无'}\n\n已有成员归属：\n${memberships || '暂无'}\n\n要求：\n1. name：若为空则生成不与已有角色重名的名字；若已有则保持不变或微调\n2. role：用短语概括角色定位，若已有则可微调使其更精准\n3. description：80-160字，按"核心定位 + 反差细节 + 动机逻辑"组织；若已有则在原文基础上扩展完善\n4. tags：2-4个简短标签数组；若已有则可补充或优化\n5. 新内容要能自然嵌入现有角色关系网络\n6. ${writingStyle}\n\n返回格式：{"name":"","role":"","description":"","tags":["",""]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<CharacterResult>
    const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 4) : []
    return {
      name: parsed.name?.trim() || '',
      role: parsed.role?.trim() || '',
      description: parsed.description?.trim() || '',
      tags: tags
    } as CharacterResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as CharacterResult
    return Boolean(r.name?.trim() || r.description?.trim())
  }
}
export default handler
