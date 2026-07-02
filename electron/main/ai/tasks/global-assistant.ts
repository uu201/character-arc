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
8. 上一条只适用于“录入外部草稿”。如果用户要求修改、改写、润色、扩写项目中已有章节正文（例如“修改第一章内容”“改第 1 章”“调整当前章节”），你必须把它当作项目内章节任务：自己分析用户说的是哪一章，先查询章节列表或读取目标章节正文，不要要求用户粘贴正文或提供章节 ID。
9. 如果用户只说“我需要修改小说第一章内容 / 修改第一章内容 / 改第 1 章 / 调整当前章节”这类模糊请求，但没有说明修改目标、风格或问题点，读取章节后先给出简短诊断、可选修改方向或追问；不要直接调用 edit_chapter，也不要生成写回提案。
10. 项目里已有资料只作为参考上下文，不能在用户明确要“录入草稿”但尚未提供草稿时，被当作本次要整理的原始输入。
11. 输出使用简体中文，不要返回 JSON。`

function formatWorkflowDocuments(source: unknown): string {
  if (!Array.isArray(source)) {
    return ''
  }

  return source
    .map((item) => item as Record<string, unknown>)
    .filter((item) => String(item.content ?? '').trim())
    .slice(0, 6)
    .map((item) => `${truncateText(item.title, 40)}：${truncateText(item.content, 1200)}`)
    .join('\n')
}

function formatKnowledgeDocuments(source: unknown): string {
  if (!Array.isArray(source)) {
    return ''
  }

  return source
    .map((item) => item as Record<string, unknown>)
    .slice(0, 12)
    .map((item, index) => {
      const title = String(item.title ?? '').trim() || `知识条目${index + 1}`
      const summary = String(item.summary ?? '').trim() || String(item.content ?? '').trim().slice(0, 300)
      const content = String(item.content ?? '').trim()
      const sourceLabel = String(item.sourceLabel ?? '').trim()
      const body = content ? `${summary}\n${truncateText(content, 700)}` : summary
      return `${truncateText(title, 40)}${sourceLabel ? ` / ${truncateText(sourceLabel, 36)}` : ''}：${truncateText(body, 900)}`
    })
    .join('\n')
}

function formatProjectConstraints(source: unknown): string {
  if (!Array.isArray(source)) {
    return ''
  }

  return source
    .map((item) => item as Record<string, unknown>)
    .slice(0, 24)
    .map((item) => {
      const title = truncateText(item.title, 40)
      const content = truncateText(item.content, 420)
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata as Record<string, unknown> : {}
      const scope = truncateText(metadata.scope, 24)
      const weight = truncateText(metadata.weight, 16)
      const locked = metadata.locked === false ? 'unlocked' : 'locked'
      const meta = [scope, weight, locked].filter(Boolean).join(' / ')
      return `${title}${meta ? ` / ${meta}` : ''}：${content}`
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
      return '当前模式是“录入整理”。优先帮助用户把长设定、草稿和口述内容整理成结构化项目资产；如果用户只是表达“我有一份草稿”但没有提供正文，先请用户粘贴草稿，不要整理项目已有资料。若用户要求修改项目内已有章节正文，则不属于录入草稿，必须先读取项目章节。'
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
    const retrievalBlock = knowledgeBlock ? `\n\n检索到的项目记忆与参考资料：\n${truncateText(knowledgeBlock, 2400)}` : ''
    const skillsSummary = skillsBlock ? truncateText(skillsBlock, 1000) : ''
    const worldviewEntries = takeRecords(context.worldviewEntries, 24, { content: 900, title: 80, type: 32 })
    const characters = takeRecords(context.characters, 24, { description: 700, name: 50, role: 60 })
    const organizations = takeRecords(context.organizations, 16, { description: 500, name: 50, type: 40, motto: 120 })
    const characterRelationships = takeRecords(context.characterRelationships, 36, { description: 360, type: 50 })
    const outlineItems = takeRecords(context.outlineItems, 48, { summary: 650, conflict: 220, title: 80 })
    const plotThreads = takeRecords(context.plotThreads, 20, { description: 420, title: 80 })
    const inspirationEntries = takeRecords(context.inspirationEntries, 16, { content: 360, title: 80, type: 32 })

    return {
      system: `${capabilityPreamble.system}\n\n${GLOBAL_ASSISTANT_SYSTEM}\n\n补充约束：项目约束里标记为 locked 的规则、用户写明 [锁定] 的内容、以及 weight=core 的规则，均是最高优先级设定。你不能覆盖、反转、弱化它们；如果用户要求修改锁定项，只能先指出冲突并请求确认。`,
      user: `${capabilityPreamble.user}

请处理当前项目级创作请求。

项目标题：${String(context.projectTitle ?? '')}
项目题材：${String(context.projectGenre ?? '')}
项目字数：${String(context.projectWordCount ?? '')}
默认写作风格：${String(context.writingStyleLabel ?? '未指定')}
风格要求：${String(context.writingStylePrompt ?? '暂无')}
当前模式：${mode}
模式说明：${resolveModeInstruction(mode)}
当前章节：${String(context.chapterTitle ?? '') || '未选中'}${String(context.chapterId ?? '') ? `（ID: ${String(context.chapterId)}）` : ''}
当前章节摘要：${String(context.chapterSummary ?? '') || '暂无'}

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

创作记忆摘录：
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
2. 如果用户要求修改项目内已有章节正文（例如“修改第一章内容”“改第 1 章”“润色当前章节”），不要要求用户粘贴正文或提供章节 ID；应自行判断章节目标并通过工具读取对应章节正文。只有用户给出了明确修改方向、风格或问题点时，才生成修改提案；若用户只说“我需要修改小说第一章内容 / 修改第一章内容 / 改第 1 章 / 调整当前章节”，读取正文后先询问修改目标或给出 3 到 5 个可选方向，不要调用 edit_chapter。
3. 如果用户是在修正设定，先用 1 到 3 句确认你理解到的修正内容，再说明建议更新的对象和影响范围。
4. 如果用户要求调整大纲，优先说明“调整建议 + 连锁影响”。
5. 如果用户要求一致性检查，按“问题 -> 证据 -> 最小修法”输出。
6. 项目级约束属于后续生成必须遵守的高优先级边界，不能被你擅自推翻。
7. 不要替用户凭空发明核心设定；补完内容要明确区分“已知事实”和“建议补完”。
8. 回答尽量具体、可执行，可直接被后续 UI 作为提案基础。`
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeAssistantText(raw) as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    return Boolean((result as GlobalAssistantResult).content?.trim())
  },
  resolveMaxTokens(): number {
    return 2400
  }
}

export default handler
