import type { AiTaskResult, CatalogBatchResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { extractJsonObject, jsonStringField, type PromptBuildInput, type TaskHandler } from './base'

type CatalogMode = 'character' | 'organization' | 'relationship' | 'membership' | 'worldview' | 'inspiration'

const modeRules: Record<CatalogMode, string> = {
  character: '每项字段：name、role、description（80-160字）、tags（2-4项）。角色不能与已有角色重名，并应能嵌入现有关系网。',
  organization: '每项字段：name、type、description（80-160字）、motto。组织不能与已有组织重名。',
  relationship: 'targets 中每个对象生成且仅生成一项。字段：targetIndex（原样返回）、type、description（80-160字）、intensity（0-100）。',
  membership: 'targets 中每个角色生成且仅生成一项。字段：targetIndex（原样返回）、organizationName（必须从已有组织中选择）、role、notes（80-160字）。',
  worldview: '每项字段：type、title、content（80-180字）。type 只能从 requestedTypes 中选择，各类型尽量均匀分布。',
  inspiration: '每项字段：type、title、content（60-140字）、tags（2-4项）。type 只能从 requestedTypes 中选择，各类型尽量均匀分布。'
}

function normalizeEntry(source: unknown): Record<string, unknown> {
  const entry = source && typeof source === 'object' ? source as Record<string, unknown> : {}
  const normalized: Record<string, unknown> = {}
  for (const key of ['name', 'type', 'title', 'content', 'description', 'motto', 'role', 'notes', 'organizationName'] as const) {
    const value = jsonStringField(entry[key])
    if (value) normalized[key] = value
  }
  if (Array.isArray(entry.tags)) {
    normalized.tags = entry.tags
      .map((tag) => {
        if (tag && typeof tag === 'object') {
          return jsonStringField((tag as Record<string, unknown>).label)
        }
        return jsonStringField(tag)
      })
      .filter((tag) => tag && tag !== '[object Object]')
      .slice(0, 4)
  }
  if (entry.targetIndex != null && Number.isFinite(Number(entry.targetIndex))) {
    normalized.targetIndex = Math.max(0, Math.floor(Number(entry.targetIndex)))
  }
  if (entry.intensity != null && Number.isFinite(Number(entry.intensity))) {
    normalized.intensity = Math.max(0, Math.min(100, Math.round(Number(entry.intensity))))
  }
  return normalized
}

const handler: TaskHandler = {
  name: 'catalog-batch',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const requestedMode = String(context.mode ?? 'character') as CatalogMode
    const mode = requestedMode in modeRules ? requestedMode : 'character'
    const count = Math.max(1, Math.min(10, Number(context.count) || 1))
    const style = resolveWritingStyleInstruction(context)
    return {
      system: `${capabilityPreamble.system}\n\n你是小说项目的批量结构化资料生成器。只返回 JSON 对象，不要 Markdown、解释或提问。必须返回格式 {"entries":[...]}。`,
      user: `${capabilityPreamble.user}\n\n生成模式：${mode}\n本批数量：${count}\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n补充要求：${String(context.userPrompt ?? '') || '无'}\n指定类型：${JSON.stringify(context.requestedTypes ?? [])}\n主角色：${JSON.stringify(context.mainCharacter ?? null)}\n关系方向：${String(context.relationshipDirection ?? '')}\n待处理目标：${JSON.stringify(context.targets ?? [])}\n已有标题或名称（严格避重）：${JSON.stringify(context.existingNames ?? [])}\n相关世界观：${JSON.stringify(context.worldviewEntries ?? [])}\n相关角色：${JSON.stringify(context.characters ?? [])}\n相关组织：${JSON.stringify(context.organizations ?? [])}\n已有角色关系：${JSON.stringify(context.characterRelationships ?? [])}\n已有组织归属：${JSON.stringify(context.organizationMemberships ?? [])}\n相关大纲：${JSON.stringify(context.outlineItems ?? [])}\n\n本模式规则：${modeRules[mode]}\n通用要求：\n1. entries 必须恰好返回 ${count} 项，内容要彼此有区分度。\n2. 不得返回待补充、未定义、信息不足等占位内容。\n3. ${style}\n4. relationship 和 membership 模式必须严格按 targets 顺序返回，并保留 targetIndex。\n\n现在只返回 JSON。`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const entries = Array.isArray(parsed.entries) ? parsed.entries.slice(0, 10).map(normalizeEntry) : []
    return { entries } as CatalogBatchResult
  },
  validate(result: AiTaskResult): boolean {
    const entries = (result as CatalogBatchResult).entries
    return entries.length > 0 && entries.every((entry) => Object.keys(entry).length >= 2)
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const entries = (result as CatalogBatchResult).entries
    return entries.length ? ['entries 中存在字段不完整的条目。'] : ['entries 不能为空。']
  },
  resolveMaxTokens(input: PromptBuildInput): number {
    const count = Math.max(1, Math.min(10, Number(input.context.count) || 1))
    return Math.min(7000, 1200 + count * 550)
  }
}

export default handler
