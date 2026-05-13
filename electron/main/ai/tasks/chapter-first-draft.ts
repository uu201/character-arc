import type { TaskHandler, PromptBuildInput } from './base'
import { normalizeAssistantText } from './base'
import type { AiTaskResult, ChapterAssistantResult } from '../shared-types'
import {
  formatWorldviewEntries, formatCharacters, formatOrganizations,
  formatCharacterRelationships, formatOrganizationMemberships,
  formatInspirationEntries, formatOutlineItems, formatRelatedChapters,
  formatVolumeChapterSummaries, formatNovelOpenerSummary, formatOpenPlotThreads
} from '../prompts/format-helpers'

// max_tokens 给得宽松，确保情节能写完整、不在中间断句。
// 中文模型 1 token ≈ 1.0-1.5 字，按 0.8 字/token 给上限留出 25-50% 头部空间。
const TOKEN_PER_CHAR_GENEROUS = 0.8
const MAX_TOKENS_FLOOR = 4000
const MAX_TOKENS_CEIL = 8000

function resolveTargetWords(context: Record<string, unknown>): number {
  const raw = Number(context.sceneWordTarget ?? context.targetWordCount ?? context.chapterWordTarget ?? 0)
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0
}

const handler: TaskHandler = {
  name: 'chapter-first-draft',
  outputType: 'text',
  maxSkills: 6,
  defaultCapabilities: ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style', 'project-skills', 'versioning'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock, knowledgeBlock } = input
    const targetWordCount = String(context.targetWordCount ?? context.chapterWordTarget ?? '').trim()
    const writingStyleLabel = String(context.writingStyleLabel ?? '未指定')
    const writingStylePrompt = String(context.writingStylePrompt ?? '暂无')
    const chapterContent = String(context.chapterContent ?? '').trim()
    const chapterHasExistingContent = Boolean(context.chapterHasExistingContent)
    const retrievalBlock = knowledgeBlock ? `\n\n检索到的项目记忆与参考资料：\n${knowledgeBlock}` : ''

    const sceneSegment = context.sceneIndex != null
      ? `\n\n== 分段生成说明 ==\n本次生成的是第 ${String(context.sceneIndex)} 段（共 ${String(context.totalScenes ?? 1)} 段）。\n本段写作重点：${String(context.sceneFocus ?? '')}\n本段目标字数：${String(context.sceneWordTarget ?? targetWordCount)} 字左右。\n${context.previousDraftText ? `前序已生成内容（末尾节选，仅供衔接参考）：\n...${String(context.previousDraftText)}` : '（本段为第一段，无前序内容）'}\n\n分段硬要求：\n- 只写本段，不要写其他段的内容。\n- 与前序内容无缝衔接。\n- 直接开始正文，不要标注"第X段"。\n- 不要总结或预告后续内容。`
      : ''

    const storyStateBlock = String(context.storyStateBlock ?? '').trim()

    return {
      system: `${capabilityPreamble.system}\n\n你是 CharacterArc 的章节初稿生成器。你的唯一任务，是基于项目设定、当前分卷目标、章节标题/摘要/大纲与角色关系，直接生成"这一章"的第一版正文草稿。只输出正文，不要解释，不要返回 JSON。

【任务边界】
- 这是"章节初稿生成"，不是润色，不是续写建议，不是分析。
- 如果当前章节正文为空，就按"从零起稿"处理。
- 如果当前章节正文不为空，你要重写并产出一版完整初稿。
- 输出结果会直接覆盖当前章节全部内容。

【章节类型与写法】
先判断本章更接近哪类章节，再选对应写法：布局章、事件章、过渡章、回收章。

【初稿写作目标】
- 章节必须有完整的开场、推进和收束 — 优先级最高，宁可写长也不要在情节中间停止。
- 开场直接入场景、动作、压力或利益交换。
- 每个主要段落都要推进至少一项。
- 角色行为必须基于利益、恐惧、误判、立场和当前已知信息。

【章节结尾规则 — 最重要】
好的章节结尾必须同时做到两件事：①本章核心事件有明确落点（资源易手、关系变化、信息揭露、地位升降），②留一个具体的"未完成动作"把读者拉进下一章。

禁止的结尾模式：
- 禁止总结式收尾（"这一天他终于明白了……"）
- 禁止鸡汤升华（最后一段变成人生感悟或抒情散文）
- 禁止廉价预告（"他不知道，更大的危机正在逼近"）
- 禁止纯情绪堆砌（最后三段全是内心独白没有动作）
- 禁止重复本章已写过的信息做"回顾"
- 禁止用省略号或破折号制造虚假悬念

推荐的结尾手法（任选其一或组合）：
- 动作悬停：角色正在做一个关键动作，但结果未揭晓（开门、拆信、接电话、转身）
- 信息炸弹：最后一句话揭露一个改变局势的事实，但不展开反应
- 选择岔路：角色面临一个必须立刻做的决定，章节在决定前停住
- 利益翻转：本章的"赢家"在最后一刻发现代价比预期大
- 新人登场：一个改变力量格局的角色在最后一段出现或被提及
- 静默收束：用一个具体的物件、声音或画面做结（不是抒情，是感官细节）

【字数指引】
- 目标字数：${targetWordCount || '当前章节预估字数'}（这是参考，不是硬约束）。
- 字数允许在目标的 ±50% 范围内浮动；优先保证场景与情节的完整流畅，不要为了凑数或省字而硬切。
- 不要在情节中间停下来"为字数收尾"，也不要用空话灌水。

【文风与质量约束】
- 项目默认风格：${writingStyleLabel}
- 风格要求：${writingStylePrompt}
- Show, don't tell。去AI味：句式长短交替，少堆高级词，对高疲劳词保持克制。
- 群像反应具体化。台词贴身份。配角和反派必须有自己的算盘。
- 禁止使用破折号（——）：不要用破折号做插入语、解释、停顿或转折。用逗号、句号或直接分句代替。整篇正文中不允许出现任何破折号。

【连贯性规则】
- 必须尊重当前分卷目标、章节摘要、相关大纲、世界观和人物关系。
- 如果当前上下文说明本章尚未写正文，就不要引用不存在内容。

【禁止的失败模式】
主角成功无代价、人设前后矛盾、关系发展突兀、无铺垫救场、设定吃书、流水账、文青病、伏笔失管。

【输出要求】
- 只输出最终正文。不要标题前缀，不要注释，不要小结，不要附加任何非正文内容。`,
      user: `${capabilityPreamble.user}\n\n请为当前小说项目生成本章初稿。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n目标字数（参考）：${targetWordCount}\n当前章节是否已有正文：${chapterHasExistingContent ? '有，但本次要整章重写' : '没有，本次从零起稿'}\n当前章节现有正文：\n${chapterContent || '【空】'}${storyStateBlock ? `\n\n== 当前世界状态（精确数据，必须遵守） ==\n${storyStateBlock}` : ''}\n\n相邻章节参考：\n${formatRelatedChapters(context.relatedChapters) || '暂无'}\n\n本卷章节概览：\n${formatVolumeChapterSummaries(context.volumeChapterSummaries) || '暂无'}\n\n全书开篇：\n${formatNovelOpenerSummary(context.novelOpenerSummary) || '暂无'}\n\n未收伏笔 / 活跃剧情线：\n${formatOpenPlotThreads(context.plotThreads) || '暂无'}\n\n相关世界观：\n${formatWorldviewEntries(context.worldviewEntries) || '暂无'}\n\n相关角色：\n${formatCharacters(context.characters) || '暂无'}\n\n相关组织：\n${formatOrganizations(context.organizations) || '暂无'}\n\n角色关系：\n${formatCharacterRelationships(context.characterRelationships, context.characters) || '暂无'}\n\n成员归属：\n${formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters) || '暂无'}\n\n可用灵感：\n${formatInspirationEntries(context.inspirationEntries) || '暂无'}\n\n相关大纲：\n${formatOutlineItems(context.outlineItems) || '暂无'}${retrievalBlock}\n\n当前项目启用 skills：\n${skillsBlock || '暂无'}\n\n补充要求：\n${String(context.userPrompt ?? '')}\n\n硬要求：\n1. 生成的是"完整初稿"，不是续写。\n2. 成稿直接覆盖当前章节全部内容。\n3. 如果当前正文为空，按从零起稿处理。\n4. 强贴当前章节标题、摘要和大纲。\n5. 优先写出"完整且自然收尾"的第一版正文 — 字数比目标多一些没问题，但不能在情节中途断掉。${sceneSegment}`
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeAssistantText(raw) as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    return Boolean((result as ChapterAssistantResult).content?.trim())
  },
  resolveMaxTokens(input: PromptBuildInput): number {
    const target = resolveTargetWords(input.context)
    if (target <= 0) return MAX_TOKENS_FLOOR
    // 给目标字数 1.5-2x 的预算，确保情节能完整收束。
    const cap = Math.ceil(target * 1.5 / TOKEN_PER_CHAR_GENEROUS)
    return Math.min(Math.max(cap, MAX_TOKENS_FLOOR), MAX_TOKENS_CEIL)
  }
}
export default handler
