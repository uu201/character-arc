import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { formatOrganizations, formatCharacterRelationships, formatOrganizationMemberships } from '../prompts/format-helpers'

type RelationEnhanceResult = Record<string, unknown>

const handler: TaskHandler = {
  name: 'relation-enhance',
  outputType: 'json',
  defaultCapabilities: ['settings', 'characters', 'relations', 'worldview', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const mode = context.mode as string
    const currentForm = context.currentForm as Record<string, unknown> | undefined
    const organizations = formatOrganizations(context.organizations)
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters)
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters)

    if (mode === 'organization') {
      const allEmpty = !currentForm?.name && !currentForm?.type && !currentForm?.description && !currentForm?.motto
      const taskDirective = allEmpty
        ? '所有字段均为空，这是一个**新建组织**任务。你必须从零创作一个完整的组织设定，所有字段都必须填入有实质内容的值，绝不允许返回空字符串。'
        : '用户正在编辑一个组织/势力，请根据已有内容和项目上下文对每个字段进行补充或优化。对于空字段，生成合适的内容；对于已有内容的字段，在保留作者意图的基础上扩展和完善。'
      return {
        system: `${capabilityPreamble.system}\n\n你是小说组织设定助手。${taskDirective}\n\n重要约束：\n- 你必须直接返回填充完毕的 JSON，不要询问用户任何问题\n- 每个字段的值都必须是非空的实质内容，空字符串一律不允许\n- 请只返回 JSON 对象，不要返回 Markdown 或任何解释文字`,
        user: `${capabilityPreamble.user}\n\n当前表单状态：\n- 组织名称：${String(currentForm?.name ?? '') || '（待生成）'}\n- 组织类型：${String(currentForm?.type ?? '') || '（待生成）'}\n- 组织说明：${String(currentForm?.description ?? '') || '（待生成）'}\n- 口号/精神标识：${String(currentForm?.motto ?? '') || '（待生成）'}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有组织：\n${organizations || '暂无'}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n\n要求：\n1. name：生成不与已有组织重名的名字\n2. type：用短语概括组织性质（如地下据点/宫廷势力/商会联盟）\n3. description：80-160字，描述组织掌控资源、核心利益和故事作用\n4. motto：一句话口号或精神标识，体现组织气质\n5. 新组织要能自然嵌入现有世界观\n6. ${writingStyle}\n\n返回格式（所有值必须填充，不允许为空）：{"name":"...","type":"...","description":"...","motto":"..."}`
      }
    }

    if (mode === 'relationship') {
      const allEmpty = !currentForm?.type && !currentForm?.description
      const taskDirective = allEmpty
        ? '所有字段均为空，这是一个**新建关系**任务。你必须从零创作一段完整的关系描述，所有字段都必须填入有实质内容的值，绝不允许返回空字符串。'
        : '用户正在编辑一对角色之间的关系，请根据已有内容和项目上下文对可编辑字段进行补充或优化。对于空字段，生成合适的内容；对于已有内容的字段，在保留作者意图的基础上扩展和完善。'
      return {
        system: `${capabilityPreamble.system}\n\n你是小说角色关系助手。${taskDirective}\n\n重要约束：\n- 你必须直接返回填充完毕的 JSON，不要询问用户任何问题\n- 每个字段的值都必须是非空的实质内容，空字符串一律不允许\n- 请只返回 JSON 对象，不要返回 Markdown 或任何解释文字`,
        user: `${capabilityPreamble.user}\n\n当前表单状态：\n- 角色 A：${String(context.fromCharacterName ?? '')}\n- 角色 B：${String(context.toCharacterName ?? '')}\n- 关系类型：${String(currentForm?.type ?? '') || '（待生成）'}\n- 关系描述：${String(currentForm?.description ?? '') || '（待生成）'}\n- 关系强度：${String(currentForm?.intensity ?? 50)}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有角色关系：\n${relationships || '暂无'}\n已有组织：\n${organizations || '暂无'}\n已有成员归属：\n${memberships || '暂无'}\n角色 A 简介：${String(context.fromCharacterDescription ?? '')}\n角色 B 简介：${String(context.toCharacterDescription ?? '')}\n\n要求：\n1. type：用短语概括关系性质（如盟友/利用/师徒/竞争/暧昧）\n2. description：80-160字，描述两人冲突来源、情感张力或合作方式\n3. intensity：0-100的数字，表示关系强度\n4. 关系要基于两个角色的已知信息和利益驱动\n5. ${writingStyle}\n\n返回格式（所有值必须填充，不允许为空）：{"type":"...","description":"...","intensity":50}`
      }
    }

    // mode === 'membership'
    const allEmptyM = !currentForm?.role && !currentForm?.notes
    const taskDirectiveM = allEmptyM
      ? '所有字段均为空，这是一个**新建成员归属**任务。你必须从零创作完整的归属描述，所有字段都必须填入有实质内容的值，绝不允许返回空字符串。'
      : '用户正在编辑一个角色在组织中的归属信息，请根据已有内容和项目上下文对可编辑字段进行补充或优化。对于空字段，生成合适的内容；对于已有内容的字段，在保留作者意图的基础上扩展和完善。'
    return {
      system: `${capabilityPreamble.system}\n\n你是小说组织成员关系助手。${taskDirectiveM}\n\n重要约束：\n- 你必须直接返回填充完毕的 JSON，不要询问用户任何问题\n- 每个字段的值都必须是非空的实质内容，空字符串一律不允许\n- 请只返回 JSON 对象，不要返回 Markdown 或任何解释文字`,
      user: `${capabilityPreamble.user}\n\n当前表单状态：\n- 角色：${String(context.characterName ?? '')}\n- 组织：${String(context.organizationName ?? '')}\n- 组织身份：${String(currentForm?.role ?? '') || '（待生成）'}\n- 归属备注：${String(currentForm?.notes ?? '') || '（待生成）'}\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n角色简介：${String(context.characterDescription ?? '')}\n组织说明：${String(context.organizationDescription ?? '')}\n已有成员归属：\n${memberships || '暂无'}\n\n要求：\n1. role：用短语概括该角色在组织中的身份（如联络人/二把手/外围成员/导师）\n2. notes：80-160字，描述该角色在组织里的权限、职责、风险与站位\n3. 内容要基于角色和组织的已知信息\n4. ${writingStyle}\n\n返回格式（所有值必须填充，不允许为空）：{"role":"...","notes":"..."}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const result: Record<string, unknown> = {}

    // organization mode — 兼容中英文键名
    const name = parsed.name ?? parsed['组织名称']
    const type = parsed.type ?? parsed['组织类型']
    const description = parsed.description ?? parsed['组织说明']
    const motto = parsed.motto ?? parsed['口号/精神标识']

    if (name != null) result.name = String(name).trim()
    if (type != null) result.type = String(type).trim()
    if (description != null) result.description = String(description).trim()
    if (motto != null) result.motto = String(motto).trim()

    // relationship mode — 兼容中英文键名
    const role = parsed.role ?? parsed['角色身份'] ?? parsed['组织身份']
    const notes = parsed.notes ?? parsed['归属备注'] ?? parsed['关系描述']
    const intensity = parsed.intensity ?? parsed['关系强度']

    if (role != null) result.role = String(role).trim()
    if (notes != null) result.notes = String(notes).trim()
    if (intensity != null) result.intensity = Math.max(0, Math.min(100, Number(intensity) || 50))

    // relationship type — 兼容
    const relType = parsed.type ?? parsed['关系类型']
    if (relType != null && !result.type) result.type = String(relType).trim()

    return result as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as RelationEnhanceResult
    return Boolean(
      (r.name && String(r.name).trim()) ||
      (r.description && String(r.description).trim()) ||
      (r.type && String(r.type).trim()) ||
      (r.role && String(r.role).trim()) ||
      (r.notes && String(r.notes).trim())
    )
  }
}
export default handler
