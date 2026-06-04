import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, GlobalAssistantProposalResult } from '../shared-types'
import {
  formatWorldviewEntries,
  formatCharacters,
  formatOrganizations,
  formatCharacterRelationships,
  formatInspirationEntries,
  formatOutlineItems
} from '../prompts/format-helpers'

function formatProjectConstraints(source: unknown): string {
  if (!Array.isArray(source)) {
    return ''
  }

  return source
    .map((item) => item as Record<string, unknown>)
    .slice(0, 8)
    .map((item) => {
      const title = String(item.title ?? '').trim()
      const content = String(item.content ?? '').trim()
      return `${title}：${content}`
    })
    .filter(Boolean)
    .join('\n')
}

const handler: TaskHandler = {
  name: 'global-assistant-proposal',
  outputType: 'json',
  maxSkills: 6,
  defaultCapabilities: ['settings', 'workflow', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'analysis', 'writing-style', 'project-skills', 'versioning'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock, knowledgeBlock } = input
    const retrievalBlock = knowledgeBlock ? `\n\n检索到的项目记忆与参考资料：\n${knowledgeBlock}` : ''

    return {
      system: `${capabilityPreamble.system}

你是 CharacterArc 的全局设定提案生成 Agent。你的任务不是回答用户，而是把“刚刚这次全局创作请求”转换成可确认、可写回的结构化修改提案。

只返回 JSON 对象，不要返回 Markdown，不要解释，不要输出多余文本。

你必须遵守以下规则：
1. 只提取与本次用户请求直接相关的项目级约束、世界观、人物卡和大纲变更。
2. 如果用户表达的是“纠正”或“约束”，优先生成 update 或 constraintCreate，而不是无意义地 create 新条目。
3. update 必须使用现有条目的可匹配标题或名称：
   - 世界观用 matchTitle
   - 人物卡用 matchName
   - 大纲用 matchTitle
4. 如果无法可靠匹配现有条目，就不要瞎写 update，可以改为 notes 说明“需人工确认目标”。
5. 项目级约束适合“后续所有章节必须遵守”的规则、人物锚点、禁写项、世界规则红线。
6. 不要虚构核心设定；不确定的内容宁可留空，也不要装作确定。
7. notes 里只放需要提醒用户的边界、影响范围或未确认项。
8. 所有文本使用简体中文。
9. 你必须自己判断是否需要使用项目 skills。仅看到 skill 索引还不够；如果某个 skill 可能影响提案质量，你必须主动调用 \`skill_load\` 读取它，再继续生成提案。`,
      user: `${capabilityPreamble.user}

请基于以下项目上下文，为本次请求生成结构化写回提案。

项目标题：${String(context.projectTitle ?? '')}
项目题材：${String(context.projectGenre ?? '')}
当前模式：${String(context.assistantMode ?? 'ingest')}

现有项目级约束：
${formatProjectConstraints(context.projectConstraints) || '暂无'}

世界观：
${formatWorldviewEntries(context.worldviewEntries) || '暂无'}

角色卡：
${formatCharacters(context.characters) || '暂无'}

组织：
${formatOrganizations(context.organizations) || '暂无'}

角色关系：
${formatCharacterRelationships(context.characterRelationships, context.characters) || '暂无'}

大纲：
${formatOutlineItems(context.outlineItems) || '暂无'}

灵感：
${formatInspirationEntries(context.inspirationEntries) || '暂无'}

上一条助手回复：
${String(context.assistantReply ?? '') || '暂无'}${retrievalBlock}

当前项目启用 skills：
${skillsBlock || '暂无'}

重要要求：
1. 你必须自己决定是否需要调用 skills，不能把上面的 skill 列表当成已经读取完成。
2. 如果本次提案涉及方法论、分析框架、风格规则、审计标准、项目专用流程或能力包，先选择最相关的 skill，并主动调用 \`skill_load\`。
3. 只有在确认不需要 skill，或者读取过所需 skill 之后，才开始输出最终 JSON。

用户请求：
${String(context.userPrompt ?? '')}

输出要求：
1. summary：一句话概括本次写回提案。
2. constraintCreates：需要新增的项目级约束。适合“后续所有章节必须遵守”的人物锚点、禁写项、世界规则、红线限制。
3. worldviewCreates：需要新增的世界观词条。
4. worldviewUpdates：需要修改的世界观词条，必须带 matchTitle 和 reason。
5. characterCreates：需要新增的人物卡。
6. characterUpdates：需要修改的人物卡，必须带 matchName 和 reason。
7. outlineCreates：需要新增的大纲节点。
8. outlineUpdates：需要修改的大纲节点，必须带 matchTitle 和 reason。
9. notes：补充提醒，例如“这条约束尚未写入人物卡，需要用户确认”。
10. 如果某一类没有提案，返回空数组。

返回格式：
{"summary":"","constraintCreates":[{"title":"","content":"","scope":"","reason":"","keywords":[""]}],"worldviewCreates":[{"type":"","title":"","content":""}],"worldviewUpdates":[{"matchTitle":"","reason":"","type":"","title":"","content":""}],"characterCreates":[{"name":"","role":"","description":"","tags":[""]}],"characterUpdates":[{"matchName":"","reason":"","name":"","role":"","description":"","tags":[""]}],"outlineCreates":[{"title":"","wordTarget":"","conflict":"","summary":""}],"outlineUpdates":[{"matchTitle":"","reason":"","title":"","wordTarget":"","conflict":"","summary":""}],"notes":[""]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<GlobalAssistantProposalResult>

    const constraintCreates = Array.isArray(parsed.constraintCreates)
      ? parsed.constraintCreates
          .map((item) => ({
            title: String(item?.title ?? '').trim(),
            content: String(item?.content ?? '').trim(),
            scope: String(item?.scope ?? '').trim() || 'project',
            reason: String(item?.reason ?? '').trim(),
            keywords: Array.isArray(item?.keywords) ? item.keywords.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12) : []
          }))
          .filter((item) => item.title && item.content)
          .slice(0, 8)
      : []

    const worldviewCreates = Array.isArray(parsed.worldviewCreates)
      ? parsed.worldviewCreates
          .map((item) => ({
            type: String(item?.type ?? '').trim(),
            title: String(item?.title ?? '').trim(),
            content: String(item?.content ?? '').trim()
          }))
          .filter((item) => item.type && item.title && item.content)
          .slice(0, 6)
      : []

    const worldviewUpdates = Array.isArray(parsed.worldviewUpdates)
      ? parsed.worldviewUpdates
          .map((item) => ({
            matchTitle: String(item?.matchTitle ?? '').trim(),
            reason: String(item?.reason ?? '').trim(),
            type: String(item?.type ?? '').trim() || undefined,
            title: String(item?.title ?? '').trim() || undefined,
            content: String(item?.content ?? '').trim() || undefined
          }))
          .filter((item) => item.matchTitle && item.reason && (item.type || item.title || item.content))
          .slice(0, 6)
      : []

    const characterCreates = Array.isArray(parsed.characterCreates)
      ? parsed.characterCreates
          .map((item) => ({
            name: String(item?.name ?? '').trim(),
            role: String(item?.role ?? '').trim(),
            description: String(item?.description ?? '').trim(),
            tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8) : []
          }))
          .filter((item) => item.name && item.description)
          .slice(0, 6)
      : []

    const characterUpdates = Array.isArray(parsed.characterUpdates)
      ? parsed.characterUpdates
          .map((item) => ({
            matchName: String(item?.matchName ?? '').trim(),
            reason: String(item?.reason ?? '').trim(),
            name: String(item?.name ?? '').trim() || undefined,
            role: String(item?.role ?? '').trim() || undefined,
            description: String(item?.description ?? '').trim() || undefined,
            tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8) : undefined
          }))
          .filter((item) => item.matchName && item.reason && (item.name || item.role || item.description || (item.tags?.length ?? 0) > 0))
          .slice(0, 6)
      : []

    const outlineCreates = Array.isArray(parsed.outlineCreates)
      ? parsed.outlineCreates
          .map((item) => ({
            title: String(item?.title ?? '').trim(),
            wordTarget: String(item?.wordTarget ?? '').trim(),
            conflict: String(item?.conflict ?? '').trim(),
            summary: String(item?.summary ?? '').trim()
          }))
          .filter((item) => item.title && item.summary)
          .slice(0, 8)
      : []

    const outlineUpdates = Array.isArray(parsed.outlineUpdates)
      ? parsed.outlineUpdates
          .map((item) => ({
            matchTitle: String(item?.matchTitle ?? '').trim(),
            reason: String(item?.reason ?? '').trim(),
            title: String(item?.title ?? '').trim() || undefined,
            wordTarget: String(item?.wordTarget ?? '').trim() || undefined,
            conflict: String(item?.conflict ?? '').trim() || undefined,
            summary: String(item?.summary ?? '').trim() || undefined
          }))
          .filter((item) => item.matchTitle && item.reason && (item.title || item.wordTarget || item.conflict || item.summary))
          .slice(0, 8)
      : []

    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
      : []

    return {
      summary: String(parsed.summary ?? '').trim() || '已生成一组可确认的全局设定写回提案。',
      constraintCreates,
      worldviewCreates,
      worldviewUpdates,
      characterCreates,
      characterUpdates,
      outlineCreates,
      outlineUpdates,
      notes
    } as GlobalAssistantProposalResult
  },
  validate(result: AiTaskResult): boolean {
    const proposal = result as GlobalAssistantProposalResult
    return Boolean(proposal.summary?.trim())
  },
  resolveMaxTokens(): number {
    return 1800
  }
}

export default handler
