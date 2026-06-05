import type { TaskHandler, PromptBuildInput } from './base'
import { normalizeAssistantText } from './base'
import type { AiTaskResult, GlobalAssistantResult } from '../shared-types'
import {
  formatWorldviewEntries,
  formatCharacters,
  formatOrganizations,
  formatCharacterRelationships,
  formatInspirationEntries,
  formatOutlineItems,
  formatOpenPlotThreads,
  formatRecentMessages
} from '../prompts/format-helpers'

function truncateText(value: unknown, maxLength: number): string {
  const text = String(value ?? '').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function takeRecords(source: unknown, count: number, fieldLimits: Record<string, number>): Record<string, unknown>[] {
  if (!Array.isArray(source)) {
    return []
  }

  return source.slice(0, count).map((item) => {
    const record = item as Record<string, unknown>
    const next: Record<string, unknown> = { ...record }
    for (const [field, limit] of Object.entries(fieldLimits)) {
      if (field in next) {
        next[field] = truncateText(next[field], limit)
      }
    }
    return next
  })
}

const GLOBAL_ASSISTANT_SYSTEM = `你是 CharacterArc 的项目级创作助理。

你的职责不是替用户从零乱编一套故事，而是帮助用户把已有的脑内设定、手写草稿和粗糙大纲整理成结构化项目资产，并在必要时帮助用户修正全局设定。

你必须遵守以下原则：
1. 用户已有设定优先于你的补完内容，不能擅自篡改用户已经确认的核心设定。
2. 如果信息不足，不要假装确定，可以明确指出“这部分仍需确认”。
3. 回答要围绕世界观、人物卡、大纲、关系、时间线和项目约束来展开，而不是泛泛聊天。
4. 当用户要求修正设定时，先确认你理解到的修正内容，再说明会影响哪些部分。
5. 当用户要求整理设定时，优先输出可落地的结构化建议，而不是空泛口号。
6. 禁止把不确定内容写成既定事实；对尚未确认的补完建议，要明确标注为“建议补完”或“待确认”。
7. 如果用户说“我有一份草稿 / 大纲 / 角色设定 / 历史时间线”，但没有实际粘贴草稿正文，你必须先请用户把草稿内容发来；不要改为整理项目里已有的大纲、角色或世界观。
8. 项目里已有资料只作为参考上下文，不能在用户明确要“录入草稿”但尚未提供草稿时，被当作本次要整理的原始输入。
9. 输出使用简体中文，不要返回 JSON。`

function formatWorkflowDocuments(source: unknown): string {
  if (!Array.isArray(source)) {
    return ''
  }

  return source
    .map((item) => item as Record<string, unknown>)
    .filter((item) => String(item.content ?? '').trim())
    .slice(0, 3)
    .map((item) => `${truncateText(item.title, 40)}：${truncateText(item.content, 180)}`)
    .join('\n')
}

function formatKnowledgeDocuments(source: unknown): string {
  if (!Array.isArray(source)) {
    return ''
  }

  return source
    .map((item) => item as Record<string, unknown>)
    .slice(0, 5)
    .map((item, index) => {
      const title = String(item.title ?? '').trim() || `知识条目${index + 1}`
      const summary = String(item.summary ?? '').trim() || String(item.content ?? '').trim().slice(0, 100)
      const sourceLabel = String(item.sourceLabel ?? '').trim()
      return `${truncateText(title, 40)}${sourceLabel ? ` / ${truncateText(sourceLabel, 36)}` : ''}：${truncateText(summary, 120)}`
    })
    .join('\n')
}

function formatProjectConstraints(source: unknown): string {
  if (!Array.isArray(source)) {
    return ''
  }

  return source
    .map((item) => item as Record<string, unknown>)
    .slice(0, 8)
    .map((item) => {
      const title = truncateText(item.title, 40)
      const content = truncateText(item.content, 160)
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata as Record<string, unknown> : {}
      const scope = truncateText(metadata.scope, 24)
      return `${title}${scope ? ` / ${scope}` : ''}：${content}`
    })
    .filter(Boolean)
    .join('\n')
}

function resolveModeInstruction(mode: string): string {
  switch (mode) {
    case 'correct':
      return '当前模式是“修正设定”。优先识别用户要纠正的设定、人物锚点或大纲结构，明确指出修正点和影响范围。'
    case 'audit':
      return '当前模式是“一致性检查”。优先输出问题、证据和建议修法，避免空泛评价。'
    case 'ingest':
    default:
      return '当前模式是“录入整理”。优先帮助用户把长设定、草稿和口述内容整理成结构化项目资产；如果用户只是表达“我有一份草稿”但没有提供正文，先请用户粘贴草稿，不要整理项目已有资料。'
  }
}

const handler: TaskHandler = {
  name: 'global-assistant',
  outputType: 'text',
  maxSkills: 6,
  defaultCapabilities: ['settings', 'workflow', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'analysis', 'writing-style', 'project-skills', 'versioning'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock, knowledgeBlock } = input
    const mode = String(context.assistantMode ?? 'ingest')
    const retrievalBlock = knowledgeBlock ? `\n\n检索到的项目记忆与参考资料：\n${truncateText(knowledgeBlock, 1200)}` : ''
    const skillsSummary = skillsBlock ? truncateText(skillsBlock, 1000) : ''
    const worldviewEntries = takeRecords(context.worldviewEntries, 6, { content: 280, title: 60, type: 24 })
    const characters = takeRecords(context.characters, 6, { description: 240, name: 40, role: 40 })
    const organizations = takeRecords(context.organizations, 4, { description: 180, name: 40, type: 30, motto: 80 })
    const characterRelationships = takeRecords(context.characterRelationships, 8, { description: 180, type: 40 })
    const outlineItems = takeRecords(context.outlineItems, 8, { summary: 240, conflict: 120, title: 60 })
    const plotThreads = takeRecords(context.plotThreads, 6, { description: 180, title: 60 })
    const inspirationEntries = takeRecords(context.inspirationEntries, 5, { content: 160, title: 60, type: 24 })

    return {
      system: `${capabilityPreamble.system}\n\n${GLOBAL_ASSISTANT_SYSTEM}`,
      user: `${capabilityPreamble.user}

请处理当前项目级创作请求。

项目标题：${String(context.projectTitle ?? '')}
项目题材：${String(context.projectGenre ?? '')}
项目字数：${String(context.projectWordCount ?? '')}
默认写作风格：${String(context.writingStyleLabel ?? '未指定')}
风格要求：${String(context.writingStylePrompt ?? '暂无')}
当前模式：${mode}
模式说明：${resolveModeInstruction(mode)}

世界观设定：
${formatWorldviewEntries(worldviewEntries) || '暂无'}

角色卡：
${formatCharacters(characters) || '暂无'}

组织：
${formatOrganizations(organizations) || '暂无'}

角色关系：
${formatCharacterRelationships(characterRelationships, characters) || '暂无'}

剧情大纲：
${formatOutlineItems(outlineItems) || '暂无'}

活跃剧情线索：
${formatOpenPlotThreads(plotThreads) || '暂无'}

项目灵感：
${formatInspirationEntries(inspirationEntries) || '暂无'}

流程文档摘录：
${formatWorkflowDocuments(context.workflowDocuments) || '暂无'}

项目级约束：
${formatProjectConstraints(context.projectConstraints) || '暂无'}

项目知识摘要：
${formatKnowledgeDocuments(context.knowledgeDocuments) || '暂无'}${retrievalBlock}

最近对话：
${formatRecentMessages(context.recentMessages) || '暂无'}

当前项目启用 skills：
${skillsSummary || '暂无'}

用户请求：
${String(context.userPrompt ?? '')}

回答要求：
1. 如果用户是在录入设定，优先帮他拆成结构化条目、时间线节点、人物卡线索或大纲节点。
   - 但如果用户只是说有草稿、想录入、想整理，却没有在“用户请求”中提供实际草稿正文，请只追问“请把草稿内容粘贴过来”，不要整理上方项目资料里的现有大纲。
2. 如果用户是在修正设定，先用 1 到 3 句确认你理解到的修正内容，再说明建议更新的对象和影响范围。
3. 如果用户要求调整大纲，优先说明“调整建议 + 连锁影响”。
4. 如果用户要求一致性检查，按“问题 -> 证据 -> 最小修法”输出。
5. 项目级约束属于后续生成必须遵守的高优先级边界，不能被你擅自推翻。
6. 不要替用户凭空发明核心设定；补完内容要明确区分“已知事实”和“建议补完”。
7. 回答尽量具体、可执行，可直接被后续 UI 作为提案基础。`
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeAssistantText(raw) as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    return Boolean((result as GlobalAssistantResult).content?.trim())
  },
  resolveMaxTokens(): number {
    return 1400
  }
}

export default handler
