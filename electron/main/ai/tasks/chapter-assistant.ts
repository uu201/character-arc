import type { TaskHandler, PromptBuildInput } from './base'
import { normalizeAssistantText } from './base'
import type { AiTaskResult, ChapterAssistantResult } from '../shared-types'
import {
  formatWorldviewEntries, formatCharacters, formatOrganizations,
  formatCharacterRelationships, formatOrganizationMemberships,
  formatInspirationEntries, formatOutlineItems, formatRelatedChapters,
  formatVolumeChapterSummaries, formatNovelOpenerSummary,
  formatOpenPlotThreads, formatRecentMessages
} from '../prompts/format-helpers'
import {
  resolveChapterAssistantModeInstruction,
  resolveChapterAssistantLengthInstruction,
  resolveChapterAssistantQuickActionInstruction
} from '../prompts/chapter-assistant-modifiers'

function formatProjectConstraints(source: unknown): string {
  if (!Array.isArray(source)) return ''
  return source
    .map((item) => item as Record<string, unknown>)
    .slice(0, 24)
    .map((item) => {
      const title = String(item.title ?? '').trim()
      const content = String(item.content ?? item.summary ?? '').trim()
      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata as Record<string, unknown> : {}
      const scope = String(metadata.scope ?? '').trim()
      const weight = String(metadata.weight ?? '').trim()
      const locked = metadata.locked === false ? 'unlocked' : 'locked'
      const meta = [scope, weight, locked].filter(Boolean).join(' / ')
      return `${title}${meta ? `（${meta}）` : ''}：${content}`
    })
    .filter(Boolean)
    .join('\n')
}

/** 章节助手系统提示词：定义创作助理的连贯性铁律、创作原则、去AI味约束等规则 */
const CHAPTER_ASSISTANT_SYSTEM = `你是 CharacterArc 的小说创作助理，同时扮演资深编辑与角色构建专家。请基于当前项目和章节上下文，用中文直接输出可供作者使用的正文、润色稿、分析或建议。不要输出 Markdown 标题，不要解释你是 AI，也不要返回 JSON。

【连贯性铁律】
新内容必须与前文完美衔接，禁止自相矛盾、时间线断裂和利益链断裂。前文埋下的资源、人脉、交易、仇怨，后文必须按因果兑现。拒绝机械降神——解决问题必须在已写内容中有迹可循，不能临时发明设定填坑。

【创作原则】
- Show, don't tell。用动作、物件、感官、价格、制度摩擦说话，少喊口号，少用空泛判断制造气氛。
- 场景压力：每个场景至少推进一项（信息、地位、资源、伤亡、仇恨、关系），小冲突尽快兑现反馈，不要把爽点无限后置。
- 章节类型识别：先判断本章更接近布局章、事件章、过渡章还是回收章，再选择对应写法。
- 收益落地：本章收益必须落到具体资源、地位变化、信息获取或伏笔回收，不能只写抽象的"更强了""暴涨"。

【章节/片段结尾约束】
当输出内容是一个完整章节或较长片段时，结尾必须：
- 有明确的事件落点（不能悬在半空）
- 留一个具体的"未完成动作"或"新信息"把读者拉向下文
- 禁止总结式收尾、鸡汤升华、廉价预告（"他不知道更大的危机……"）、纯情绪堆砌、省略号/破折号制造虚假悬念
- 推荐手法：动作悬停、信息炸弹、选择岔路、利益翻转、新人登场、感官细节静默收束

【动机校验】
动笔前自问：此刻利益最大化的选择是什么？冲突是谁先动手、为什么非做不可？配角/反派是否有明确诉求、恐惧和反制？反派是否基于其已知信息行动？本段推进靠的是前文铺垫，还是凭空掉设定？

【改写边界】
润色：只改表达不改事实。改写：可改叙述但保留核心事实。重写：可重构场景但不改主设定。续写：只向前推进不反改前文。用户指令与边界冲突时，以用户要求为准。

【去AI味约束】
- 句式多样化：长短句交替，避免连续重复相同句式、相同主语开头。
- 词汇控制：多用动词和名词，少堆形容词；对"冷笑""蝼蚁""轰然炸裂""倒吸一口凉气""瞳孔骤缩""满场死寂"等高疲劳词保持克制，同章同一高识别词默认只出现1次。
- 群像反应具体化：不要一律写成"全场震惊"，改写成具体角色的身体反应或利益震荡。
- 反派与配角的狠话必须贴合身份、地域与处境。
- 合理分段，每段聚焦1个核心信息点。
- 禁止使用破折号（——）：不要用破折号做插入语、解释、停顿或转折。用逗号、句号或直接分句代替。这是硬性规则，整篇正文中不允许出现任何破折号。

【禁止的失败模式】
无铺垫救场、角色突然降智、反派排队送死、大段设定替代行动、没铺垫塞新外挂、配角工具人化、模糊词掩盖跳变、伏笔失管、流水账、同义反复、数据通胀、设定吃书、无理由爱恨、主角碾压模板、文青病、历史课件式开头、主角成功无代价、人设前后矛盾、关系发展突兀。

【质量审查框架】
审查时按"问题→证据→最小修法"输出。审查维度：设定冲突、人物OOC、爽点缺失、节奏拖沓、配角降智、敌方信息越界、战力崩坏、伏笔失管、语言机械、词汇疲劳、利益链不成立、台词失真。

【自检规则】
当你输出超过 500 字的创作内容（续写、重写、整段生成）后，主动执行以下检查，不需要等用户要求：
- 字数是否达到用户期望（如有明确要求）
- 与前文是否衔接（最后一句是否能接上下文）
- 是否出现了上面列出的禁止失败模式
- 是否存在高疲劳词过度使用
如发现问题，在正文输出后简要说明并给出修正版本，格式："⚠ 自检发现：[问题]，已修正如下：[修正片段]"。无问题则不需要额外说明。`

/** 章节助手任务：基于项目上下文提供润色、续写、分析等创作辅助 */
const handler: TaskHandler = {
  name: 'chapter-assistant',
  outputType: 'text',
  maxSkills: 6,
  defaultCapabilities: ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'inspiration', 'writing-style', 'project-skills', 'versioning'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock, knowledgeBlock } = input
    const selectedText = String(context.selectedText ?? '').trim()
    const quickAction = String(context.quickAction ?? '自由提问')
    const responseMode = String(context.responseMode ?? 'freeform')
    const responseLength = String(context.responseLength ?? 'medium')
    const modeInstruction = resolveChapterAssistantModeInstruction(responseMode)
    const lengthInstruction = resolveChapterAssistantLengthInstruction(responseLength)
    const quickActionInstruction = resolveChapterAssistantQuickActionInstruction(quickAction)
    const retrievalBlock = knowledgeBlock ? `\n\n检索到的项目记忆与参考资料：\n${knowledgeBlock}` : ''

    return {
      system: `${capabilityPreamble.system}\n\n${CHAPTER_ASSISTANT_SYSTEM}\n\n【全局设定最高优先级】\n项目级约束、locked 约束、weight=core 约束、用户标记 [锁定] 的设定，优先级高于本章灵感、临时改写和常规套路。不得覆盖、反转、弱化或绕开这些设定；人物锚点、世界规则红线和禁写项必须在输出时主动避让。`,
      user: `${capabilityPreamble.user}\n\n请处理当前写作请求，并优先给出可直接使用的结果。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前项目默认风格：${String(context.writingStyleLabel ?? '未指定')}\n风格要求：${String(context.writingStylePrompt ?? '暂无')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n\n当前选中文本：\n${selectedText || '暂无'}\n\n相邻章节参考：\n${formatRelatedChapters(context.relatedChapters) || '暂无'}\n\n本卷章节概览：\n${formatVolumeChapterSummaries(context.volumeChapterSummaries) || '暂无'}\n\n全书开篇：\n${formatNovelOpenerSummary(context.novelOpenerSummary) || '暂无'}\n\n未收伏笔 / 活跃剧情线：\n${formatOpenPlotThreads(context.plotThreads) || '暂无'}\n\n相关世界观：\n${formatWorldviewEntries(context.worldviewEntries) || '暂无'}\n\n相关角色：\n${formatCharacters(context.characters) || '暂无'}\n\n相关组织：\n${formatOrganizations(context.organizations) || '暂无'}\n\n角色关系：\n${formatCharacterRelationships(context.characterRelationships, context.characters) || '暂无'}\n\n成员归属：\n${formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters) || '暂无'}\n\n当前可用灵感：\n${formatInspirationEntries(context.inspirationEntries) || '暂无'}\n\n相关大纲：\n${formatOutlineItems(context.outlineItems) || '暂无'}\n\n项目级约束：\n${formatProjectConstraints(context.knowledgeDocuments) || '暂无'}${retrievalBlock}\n\n最近对话：\n${formatRecentMessages(context.recentMessages) || '暂无'}\n\n当前项目启用 skills：\n${skillsBlock || '暂无'}\n\n快捷动作：${quickAction}\n输出模式：${responseMode}\n输出长度：${responseLength}\n用户请求：${String(context.userPrompt ?? '')}\n\n要求：\n1. 回答要紧贴当前章节上下文\n2. 如果请求是润色、续写、描写，请优先输出可直接插入正文的内容\n3. 如果提供了当前选中文本，并且请求与润色、改写有关，请优先只围绕这段文本处理\n4. 续写必须与相邻章节保持连续\n5. 若当前可用灵感不为空，可优先借用其中最贴合的一条\n6. 项目级约束属于后续生成必须遵守的高优先级边界，不能擅自突破\n7. 如果当前项目启用了 skills，优先吸收其中与正文创作相关的规则\n8. 上方提供的角色、世界观、大纲等信息仅为索引摘要。如果你需要某个角色的完整设定、某条世界观的详细内容或大纲的具体描述，请使用 read_project_data 工具按需读取，不要基于不完整的摘要进行猜测\n9. ${modeInstruction}\n10. ${lengthInstruction}\n11. ${quickActionInstruction}`
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeAssistantText(raw) as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    return Boolean((result as ChapterAssistantResult).content?.trim())
  },
  resolveMaxTokens(input: PromptBuildInput): number {
    switch (String(input.context.responseLength ?? 'medium')) {
      case 'short': return 500
      case 'long': return 1400
      default: return 900
    }
  }
}
export default handler
