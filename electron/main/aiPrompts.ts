import type { AiTaskPayload, PromptPair } from './aiShared'
import { resolveProjectBootstrapPromptParts } from './projectBootstrapPrompts'
import {
  buildCapabilityPromptContext,
  resolveChapterAssistantLengthInstruction,
  resolveChapterAssistantModeInstruction,
  resolveChapterAssistantQuickActionInstruction
} from './promptLibrary'

/**
 * 根据任务类型构建完整的提示词对（system + user）。
 * 每种任务类型有独立的提示词模板，上下文信息通过 context 对象注入。
 * 章节助理任务会额外注入写作风格、输出模式、响应长度等指令。
 */
export function buildTaskPrompt(task: AiTaskPayload): PromptPair {
  const { context } = task
  const writingStyleInstruction = resolveWritingStyleInstruction(context)
  const projectSkills = formatProjectSkills(context.projectSkills)
  const wrapPrompt = (prompt: PromptPair): PromptPair => {
    const capabilityPrompt = buildCapabilityPromptContext(task)
    return {
      system: `${capabilityPrompt.system}\n\n${prompt.system}`,
      user: `${capabilityPrompt.user}\n\n${prompt.user}`
    }
  }

  // ── 世界观设定任务 ──
  if (task.task === 'worldview-entry') {
    return wrapPrompt({
      system:
        '你是小说世界观设定助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 type、title、content。',
      user: `基于以下上下文，为当前小说项目新增一条世界观设定。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有世界观：${JSON.stringify(context.worldviewTitles ?? [])}\n\n要求：\n1. 返回一条不与已有条目重复的新设定\n2. type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一\n3. title 要简洁\n4. content 用中文完整描述，80 到 180 字\n5. ${writingStyleInstruction}\n\n返回格式：{"type":"","title":"","content":""}`
    })
  }

  // ── 角色卡生成任务 ──
  if (task.task === 'character-card') {
    const organizations = formatOrganizations(context.organizations)
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters)
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters)

    return wrapPrompt({
      system:
        '你是小说角色设定助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 name、role、description、tags。',
      user: `基于以下上下文，为当前小说项目生成一名新角色。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n\n已有组织：\n${organizations || '暂无'}\n\n已有角色关系：\n${relationships || '暂无'}\n\n已有成员归属：\n${memberships || '暂无'}\n\n要求：\n1. 不与已有角色重名\n2. role 用短语概括角色定位\n3. 新角色要尽量能自然嵌入现有关系网络或组织结构，避免像孤立路人\n4. description 用中文完整描述，80 到 160 字，尽量体现其立场、关系张力或潜在冲突\n5. tags 返回 2 到 4 个简短标签数组\n6. ${writingStyleInstruction}\n\n返回格式：{"name":"","role":"","description":"","tags":["",""]}`
    })
  }

  // ── 项目初始化任务（批量生成世界观 + 大纲） ──
  if (task.task === 'project-bootstrap') {
    const { genreLabel, lengthLabel, strategyBlock } = resolveProjectBootstrapPromptParts(context)
    return wrapPrompt({
      system:
        '你是小说项目初始化助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 worldviewEntries、outlineItems。',
      user: `请基于以下信息，为小说项目生成首批世界观设定和剧情大纲。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${genreLabel}\n作品长度：${lengthLabel}\n小说简介：${String(context.projectPremise ?? '')}\n\n题材与长度策略：\n${strategyBlock}\n\n要求：\n1. worldviewEntries 返回 3 条设定，每条都包含 type、title、content\n2. worldviewEntries 的 type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一\n3. outlineItems 返回 3 条章节大纲，每条都包含 title、wordTarget、conflict、summary\n4. wordTarget 使用"预估 xxxx字"格式，并与${lengthLabel}节奏相匹配\n5. 所有内容使用中文，必须紧贴题材、长度和小说简介，不要写成通用模板\n6. 三条世界观设定之间要能互相支撑，三条大纲之间要形成连续推进\n7. 如果简介里已经给出了主角目标、关系或异常事件，要优先围绕它展开，而不是另起炉灶\n8. ${writingStyleInstruction}\n\n返回格式：{"worldviewEntries":[{"type":"","title":"","content":""}],"outlineItems":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    })
  }

  // ── 参考作品分块分析任务 ──
  if (task.task === 'reference-style-chunk') {
    return wrapPrompt({
      system:
        '你是小说拆书分块分析助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 overview、sentenceStyle、dialogueRatio、pacingControl、emotionExpression、plotFunction、styleRules。',
      user: `请分析下面这个参考作品分块，提炼它在局部层面的风格和桥段作用。\n\n当前项目标题：${String(context.projectTitle ?? '')}\n当前项目题材：${String(context.projectGenre ?? '')}\n当前目标平台：${String(context.projectPlatform ?? '')}\n参考作品标题：${String(context.sourceTitle ?? '')}\n分块标签：${String(context.chunkLabel ?? '')}\n分块顺序：${String(context.chunkIndex ?? '')} / ${String(context.chunkTotal ?? '')}\n分块字数：${String(context.chunkCharacterCount ?? '')}\n分块局部统计：${JSON.stringify(context.chunkMetrics ?? [])}\n分块关键词：${JSON.stringify(context.chunkKeywords ?? [])}\n分块正文：\n${String(context.chunkText ?? '')}\n\n要求：\n1. 只分析这一块，不要假装知道整本书全貌\n2. overview 用 1 到 2 句话概括这一块在文风和桥段上的局部特征\n3. sentenceStyle 必须明确句式长短、描述密度或叙述颗粒度\n4. dialogueRatio 必须明确对白占比倾向及其在这一块里的作用\n5. pacingControl 必须说明这一块是快推、蓄压、回收还是过渡，以及怎么做到的\n6. emotionExpression 必须指出情绪靠什么细节外化\n7. plotFunction 必须说明这一块承担的桥段功能，比如开篇钩子、冲突升级、关系试探、结果兑现、余波过渡等\n8. styleRules 返回 2 到 4 条局部可复用规则，仍然必须去具体化，不能包含专有名词和桥段细节照搬\n9. 不要长篇复述剧情，不要输出版权敏感的连续原文\n\n返回格式：{"overview":"","sentenceStyle":"","dialogueRatio":"","pacingControl":"","emotionExpression":"","plotFunction":"","styleRules":["",""]}`
    })
  }

  // ── 参考作品仿写分析任务 ──
  if (task.task === 'reference-style-analysis') {
    return wrapPrompt({
      system:
        '你是小说拆书分析助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 overview、sentenceStyle、dialogueRatio、pacingControl、emotionExpression、narrativePerspective、styleRules、plotOutline、reusableStylePrompt、avoidRules。',
      user: `请基于以下参考作品的全局统计和分块分析结果，汇总出一套可以复用于后续原创写作的仿写规则。\n\n当前项目标题：${String(context.projectTitle ?? '')}\n当前项目题材：${String(context.projectGenre ?? '')}\n当前目标平台：${String(context.projectPlatform ?? '')}\n参考作品标题：${String(context.sourceTitle ?? '')}\n参考文件类型：${String(context.sourceFileType ?? '')}\n参考作品估计字数：${String(context.sourceCharacterCount ?? '')}\n参考作品章节估计：${String(context.sourceChapterCount ?? '')}\n全局统计：${JSON.stringify(context.styleMetrics ?? [])}\n全局关键词：${JSON.stringify(context.topKeywords ?? [])}\n开篇摘录：\n${String(context.sourceExcerpt ?? '')}\n\n全书抽样：\n${String(context.analysisSample ?? '')}\n\n分块分析结果：\n${String(context.chunkSummaries ?? '')}\n\n要求：\n1. 目标不是复述剧情，而是汇总出跨分块稳定成立的风格骨架\n2. 优先相信多个分块重复出现的共性，不要被单个桥段带偏\n3. sentenceStyle 必须明确句式简洁度、长短句分布、描写密度或叙述颗粒度\n4. dialogueRatio 必须明确对白比例倾向，以及对白在推进剧情中的职责\n5. pacingControl 必须明确该作品如何在不同桥段里控节奏、如何分配冲突和反馈\n6. emotionExpression 必须明确情绪是靠什么外化的，不要空泛说"有感染力"\n7. narrativePerspective 必须说明视角稳定性、镜头距离或场景组织方式\n8. styleRules 返回 4 到 6 条可执行风格规则，不能包含具体人名、地名、外挂、组织名或桥段专有设定\n9. plotOutline 用 120 到 220 字概括故事骨架，但必须抽象到可迁移层，不要把原剧情直接压缩复写\n10. reusableStylePrompt 写成可直接放进后续章节生成的风格模板，强调文笔、对白、节奏、情绪表达和去 AI 味约束，180 到 320 字\n11. avoidRules 返回 3 到 5 条主动避险规则，提醒后续创作不要照搬原作的专有名词、关系网和桥段顺序\n12. 全部内容必须用简体中文，严格去具体化，不能输出版权敏感的连续原文，也不能鼓励照抄\n\n返回格式：{"overview":"","sentenceStyle":"","dialogueRatio":"","pacingControl":"","emotionExpression":"","narrativePerspective":"","styleRules":["",""],"plotOutline":"","reusableStylePrompt":"","avoidRules":["",""]}`
    })
  }

  // ── 项目流程文件生成任务 ──
  if (task.task === 'workflow-documents') {
    const stageId = String(context.stageId ?? 'reference')
    const stageLabel = String(context.stageLabel ?? '选题与参考')
    const requestedDocuments = Array.isArray(context.requestedDocuments) ? JSON.stringify(context.requestedDocuments) : '[]'
    return wrapPrompt({
      system:
        '你是小说项目流程文件生成助手。请只返回 JSON 对象，不要返回 Markdown 代码块，不要解释。只生成本阶段要求的流程文件字段，字段值必须是 markdown 文本字符串。',
      user: `请基于以下项目信息，只为当前阶段生成对应的流程文件内容。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n项目目标平台：${String(context.projectPlatform ?? '未指定')}\n项目当前阶段 ID：${stageId}\n项目当前阶段：${stageLabel}\n本阶段要求生成的文件：${requestedDocuments}\n当前世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n当前角色参考：${JSON.stringify(context.characters ?? [])}\n当前关系参考：${JSON.stringify(context.characterRelationships ?? [])}\n当前大纲参考：${JSON.stringify(context.outlineItems ?? [])}\n当前章节参考：${JSON.stringify(context.chapters ?? [])}\n当前已有流程文件：${JSON.stringify(context.workflowDocuments ?? [])}\n当前项目启用 skills：\n${projectSkills || '暂无'}\n补充要求：${String(context.userPrompt ?? '')}\n\n要求：\n1. 只生成 requestedDocuments 里列出的字段，不要额外输出其他字段\n2. 每个字段都必须贴当前小说项目，不要写成通用教程模板\n3. 如果当前已有流程文件里已经存在有效内容，要优先延续和整合，而不是完全重写成另一套口径\n4. 如果当前项目启用了 skills，优先吸收其中与当前阶段相关的规则和口径\n5. task_plan 重点写当前阶段接下来要推进的任务\n6. findings 重点写当前已锁定的关键信息、设定、事实和风险\n7. progress 重点写当前阶段真实进度与下一步\n8. current_status 重点写当前主角、当前卷章、当前主线和即时矛盾\n9. novel_setting 重点写题材、世界线、文风边界、主角路线和外挂设定\n10. character_relationships 重点写当前人物、势力和关系骨架\n11. pending_hooks 重点写当前阶段已埋或待埋的钩子\n12. resource_ledger 重点写当前已到账 / 未到账的资源与风险\n13. 所有字段内容都用简体中文 markdown 写法，但放在 JSON 字符串里返回\n14. 不要输出空壳模板，要生成可直接继续编辑的第一版内容\n\n返回示例：{"task_plan":"","findings":""}`
    })
  }

  // ── 章节质量分析任务 ──
  if (task.task === 'chapter-analysis') {
    // 组装分析所需的上下文片段：世界观、角色、组织、关系、灵感、大纲
    const worldviewEntries = Array.isArray(context.worldviewEntries)
      ? context.worldviewEntries
          .slice(0, 8)
          .map((entry) => `${String((entry as Record<string, unknown>).title ?? '')}：${String((entry as Record<string, unknown>).content ?? '')}`)
          .join('\n')
      : ''
    const characters = Array.isArray(context.characters)
      ? context.characters
          .slice(0, 8)
          .map((character) => `${String((character as Record<string, unknown>).name ?? '')} / ${String((character as Record<string, unknown>).role ?? '')}：${String((character as Record<string, unknown>).description ?? '')}`)
          .join('\n')
      : ''
    const organizations = formatOrganizations(context.organizations)
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters)
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters)
    const inspirationEntries = Array.isArray(context.inspirationEntries)
      ? context.inspirationEntries
          .slice(0, 6)
          .map((entry) => {
            const record = entry as Record<string, unknown>
            const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)).join('、') : ''
            return `${String(record.type ?? '')} / ${String(record.title ?? '')}：${String(record.content ?? '')}${tags ? `（标签：${tags}）` : ''}`
          })
          .join('\n')
      : ''
    const outlineItems = Array.isArray(context.outlineItems)
      ? context.outlineItems
          .slice(0, 6)
          .map((item) => `${String((item as Record<string, unknown>).title ?? '')}：${String((item as Record<string, unknown>).summary ?? '')}`)
          .join('\n')
      : ''

    return wrapPrompt({
      system:
        '你是小说章节分析助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 overview、pacing、tension、continuity、highlights、risks、revisionActions。',
      user: `请分析当前章节的写作质量与可优化点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节实际字数：${String(context.chapterWordCount ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n\n相关世界观：\n${worldviewEntries || '暂无'}\n\n相关角色：\n${characters || '暂无'}\n\n相关组织：\n${organizations || '暂无'}\n\n角色关系：\n${relationships || '暂无'}\n\n成员归属：\n${memberships || '暂无'}\n\n相关大纲：\n${outlineItems || '暂无'}\n\n要求：\n1. overview 用 1 到 2 句话概括当前章节完成度、情绪和主要问题\n2. pacing / tension / continuity 都用一句中文短评，既要判断也要说明原因\n3. highlights 返回 2 到 4 条，强调当前章节已经做得好的地方\n4. risks 返回 2 到 4 条，指出节奏、逻辑、人物一致性、设定引用、关系张力、阵营立场或信息密度方面的风险\n5. revisionActions 返回 3 到 5 条，必须是作者可以立刻执行的修改动作，尽量具体\n6. 如果人物关系、阵营动机或组织归属没有被有效利用，也要明确指出\n7. 输出务必紧贴当前正文，不要给空泛写作建议\n\n返回格式：{"overview":"","pacing":"","tension":"","continuity":"","highlights":["",""],"risks":["",""],"revisionActions":["","",""]}`
    })
  }

  // ── 当前分卷批量补全大纲任务 ──
  if (task.task === 'outline-batch') {
    return wrapPrompt({
      system:
        '你是小说分卷大纲规划助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 entries，entries 中每项都必须包含 title、wordTarget、conflict、summary。',
      user: `请基于以下上下文，为当前分卷连续补充 3 到 5 个新的剧情大纲节点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前分卷目标字数：${String(context.chapterVolumeWordTarget ?? '')}\n当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}\n全局已有大纲标题：${JSON.stringify(context.outlineTitles ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n角色参考：${JSON.stringify(context.characters ?? [])}\n当前项目启用 skills：\n${projectSkills || '暂无'}\n补充要求：${String(context.userPrompt ?? '')}\n\n要求：\n1. entries 返回 3 到 5 条新节点，按顺序推进，不要重复已有节点\n2. 每条都必须包含 title、wordTarget、conflict、summary\n3. title 要体现章节推进关系，避免空泛命名\n4. wordTarget 使用"预估 xxxx字"格式\n5. conflict 用一句话概括该节点最核心的矛盾或压力\n6. summary 用中文描述剧情推进，80 到 180 字\n7. 各节点之间要形成连续节奏，不能像互相无关的散点\n8. 如果当前项目启用了 skills，优先吸收其中与大纲阶段相关的规则和限制\n9. 如果当前分卷已有节点偏少，优先补桥接节点；如果已有节点较多，优先补冲突升级和转折节点\n10. 必须保持与当前分卷摘要、已有角色关系和世界观一致\n11. ${writingStyleInstruction}\n\n返回格式：{"entries":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    })
  }

  // ── 基于当前章节生成后续剧情链任务 ──
  if (task.task === 'outline-chain') {
    return wrapPrompt({
      system:
        '你是小说剧情链规划助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 entries，entries 中每项都必须包含 title、wordTarget、conflict、summary。',
      user: `请基于以下上下文，为当前章节之后连续规划 2 到 4 个后续剧情大纲节点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n当前关联大纲节点：${JSON.stringify(context.currentOutlineItem ?? {})}\n当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n角色参考：${JSON.stringify(context.characters ?? [])}\n当前项目启用 skills：\n${projectSkills || '暂无'}\n补充要求：${String(context.userPrompt ?? '')}\n\n要求：\n1. entries 返回 2 到 4 个后续节点，必须严格体现“当前章节之后”的连续推进\n2. 每条都必须包含 title、wordTarget、conflict、summary\n3. 第一条要紧贴当前章节收束后的直接后果或下一步动作\n4. 后续条目之间要形成递进，至少包含一次冲突升级或转折\n5. wordTarget 使用"预估 xxxx字"格式\n6. summary 用中文描述剧情推进，80 到 180 字\n7. 如果当前项目启用了 skills，优先吸收其中与大纲续推相关的规则和写法限制\n8. 不要重复当前分卷中已有节点标题和主要推进\n9. 必须保持与当前角色关系、组织立场和世界观一致\n10. ${writingStyleInstruction}\n\n返回格式：{"entries":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    })
  }

  // ── 灵感卡片批量生成任务 ──
  if (task.task === 'inspiration-pack') {
    const worldviewEntries = Array.isArray(context.worldviewEntries)
      ? context.worldviewEntries
          .slice(0, 8)
          .map((entry) => `${String((entry as Record<string, unknown>).title ?? '')}：${String((entry as Record<string, unknown>).content ?? '')}`)
          .join('\n')
      : ''
    const characters = Array.isArray(context.characters)
      ? context.characters
          .slice(0, 8)
          .map((character) => `${String((character as Record<string, unknown>).name ?? '')} / ${String((character as Record<string, unknown>).role ?? '')}：${String((character as Record<string, unknown>).description ?? '')}`)
          .join('\n')
      : ''
    const organizations = formatOrganizations(context.organizations)
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters)
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters)
    const inspirationEntries = Array.isArray(context.inspirationEntries)
      ? context.inspirationEntries
          .slice(0, 6)
          .map((entry) => {
            const record = entry as Record<string, unknown>
            const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)).join('、') : ''
            return `${String(record.type ?? '')} / ${String(record.title ?? '')}：${String(record.content ?? '')}${tags ? `（标签：${tags}）` : ''}`
          })
          .join('\n')
      : ''
    const outlineItems = Array.isArray(context.outlineItems)
      ? context.outlineItems
          .slice(0, 6)
          .map((item) => `${String((item as Record<string, unknown>).title ?? '')}：${String((item as Record<string, unknown>).summary ?? '')}`)
          .join('\n')
      : ''
    const existingInspirationTitles = Array.isArray(context.existingInspirationTitles)
      ? JSON.stringify(context.existingInspirationTitles)
      : '[]'

    return wrapPrompt({
      system:
        '你是小说灵感生成助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 entries，entries 中每一项都必须包含 type、title、content、tags。',
      user: `请围绕当前小说项目生成一组可直接保存的灵感卡片。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n\n灵感焦点：${String(context.focusType ?? '场景火花')}\n已有灵感标题：${existingInspirationTitles}\n\n相关世界观：\n${worldviewEntries || '暂无'}\n\n相关角色：\n${characters || '暂无'}\n\n相关组织：\n${organizations || '暂无'}\n\n角色关系：\n${relationships || '暂无'}\n\n成员归属：\n${memberships || '暂无'}\n\n相关大纲：\n${outlineItems || '暂无'}\n\n要求：\n1. entries 返回 4 条灵感卡片，每条都必须紧贴"灵感焦点"\n2. type 必须从以下类型中选一个：标题灵感、开篇钩子、场景火花、剧情转折、设定补完、人物动机\n3. title 要短而明确，避免与已有灵感标题重复\n4. content 用中文写成 60 到 140 字的可执行灵感描述，强调可落地场景、冲突、情绪或推进方式\n5. 当关系、组织或阵营立场明显可用时，优先让灵感围绕这些张力展开\n6. tags 返回 2 到 4 个简短标签，方便后续筛选\n7. 不要空泛鸡汤，不要写成长篇大纲，要像作者工作台里的"灵感卡片"\n8. ${writingStyleInstruction}\n\n返回格式：{"entries":[{"type":"","title":"","content":"","tags":["",""]}]}`
    })
  }

  // ── 章节创作助理任务（支持流式输出） ──
  if (task.task === 'chapter-assistant') {
    // 组装完整的创作上下文：世界观、角色、组织、关系、灵感、大纲、相邻章节、历史对话
    const worldviewEntries = Array.isArray(context.worldviewEntries)
      ? context.worldviewEntries
          .slice(0, 8)
          .map((entry) => `${String((entry as Record<string, unknown>).title ?? '')}：${String((entry as Record<string, unknown>).content ?? '')}`)
          .join('\n')
      : ''
    const characters = Array.isArray(context.characters)
      ? context.characters
          .slice(0, 8)
          .map((character) => `${String((character as Record<string, unknown>).name ?? '')} / ${String((character as Record<string, unknown>).role ?? '')}：${String((character as Record<string, unknown>).description ?? '')}`)
          .join('\n')
      : ''
    const organizations = formatOrganizations(context.organizations)
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters)
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters)
    const inspirationEntries = Array.isArray(context.inspirationEntries)
      ? context.inspirationEntries
          .slice(0, 6)
          .map((entry) => {
            const record = entry as Record<string, unknown>
            const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)).join('、') : ''
            return `${String(record.type ?? '')} / ${String(record.title ?? '')}：${String(record.content ?? '')}${tags ? `（标签：${tags}）` : ''}`
          })
          .join('\n')
      : ''
    const outlineItems = Array.isArray(context.outlineItems)
      ? context.outlineItems
          .slice(0, 6)
          .map((item) => `${String((item as Record<string, unknown>).title ?? '')}：${String((item as Record<string, unknown>).summary ?? '')}`)
          .join('\n')
      : ''
    // 最多引用 2 章相邻章节的内容预览，帮助 AI 理解上下文衔接
    const relatedChapters = Array.isArray(context.relatedChapters)
      ? context.relatedChapters
          .slice(0, 2)
          .map((item, index) => {
            const record = item as Record<string, unknown>
            return `关联章节${index + 1}：${String(record.title ?? '')}\n摘要：${String(record.summary ?? '')}\n正文预览：${String(record.preview ?? '')}`
          })
          .join('\n\n')
      : ''
    // 当前分卷内其他章节的摘要（不含前两章），供 AI 做情节衔接参考
    const volumeChapterSummaries = Array.isArray(context.volumeChapterSummaries)
      ? context.volumeChapterSummaries
          .map((item, index) => {
            const record = item as Record<string, unknown>
            return `第${index + 1}节：${String(record.title ?? '')}\n  摘要：${String(record.summary ?? '') || '暂无摘要'}`
          })
          .join('\n\n')
      : ''
    // 全书第 1 章摘要（世界/角色基调参照，仅当不在前两层时才添加）
    const novelOpenerSummary = context.novelOpenerSummary
      ? (() => {
          const record = context.novelOpenerSummary as Record<string, unknown>
          return `标题：${String(record.title ?? '')}\n摘要：${String(record.summary ?? '') || '暂无摘要'}`
        })()
      : ''
    // 活跃剧情线索（status=open），供 AI 避免矛盾、按需收束
    const openPlotThreads = Array.isArray(context.plotThreads)
      ? context.plotThreads
          .filter((t) => (t as Record<string, unknown>).status === 'open')
          .map((t) => {
            const record = t as Record<string, unknown>
            return `- ${String(record.title ?? '')}：${String(record.description ?? '')}`
          })
          .join('\n')
      : ''
    const recentMessages = Array.isArray(context.recentMessages)
      ? context.recentMessages
          .slice(-4)
          .map((item) => {
            const record = item as Record<string, unknown>
            const role = String(record.role ?? '') === 'assistant' ? '助理' : '用户'
            return `${role}：${String(record.content ?? '')}`
          })
          .join('\n')
      : ''
    // 用户在编辑器中选中的文本，用于润色、改写等定向操作
    const selectedText = String(context.selectedText ?? '').trim()
    // 快捷动作标识，如"章节标题"、"润色选中"、"下一章建议"等
    const quickAction = String(context.quickAction ?? '自由提问')
    // 输出模式：freeform / polish / continue / suggest / reference
    const responseMode = String(context.responseMode ?? 'freeform')
    // 输出长度偏好：short / medium / long
    const responseLength = String(context.responseLength ?? 'medium')
    const modeInstruction = resolveChapterAssistantModeInstruction(responseMode)
    const lengthInstruction = resolveChapterAssistantLengthInstruction(responseLength)
    const quickActionInstruction = resolveChapterAssistantQuickActionInstruction(quickAction)

    return wrapPrompt({
      system: `你是 CharacterArc 的小说创作助理，同时扮演资深编辑与角色构建专家。请基于当前项目和章节上下文，用中文直接输出可供作者使用的正文、润色稿、分析或建议。不要输出 Markdown 标题，不要解释你是 AI，也不要返回 JSON。

【连贯性铁律】
新内容必须与前文完美衔接，禁止自相矛盾、时间线断裂和利益链断裂。前文埋下的资源、人脉、交易、仇怨，后文必须按因果兑现。拒绝机械降神——解决问题必须在已写内容中有迹可循，不能临时发明设定填坑。

【创作原则】
- Show, don't tell。用动作、物件、感官、价格、制度摩擦说话，少喊口号，少用空泛判断制造气氛。
- 场景压力：每个场景至少推进一项（信息、地位、资源、伤亡、仇恨、关系），小冲突尽快兑现反馈，不要把爽点无限后置。
- 章节类型识别：先判断本章更接近布局章（交易/试探/威慑）、事件章（行动/冲突/兑现）、过渡章（状态变化/余波/钩子）还是回收章（回应旧伏笔），再选择对应写法，不要用同一种模板写所有章节。
- 收益落地：本章收益必须落到具体资源、地位变化、信息获取或伏笔回收，不能只写抽象的"更强了""暴涨""难以估量"。

【动机校验】
动笔前自问：此刻利益最大化的选择是什么？冲突是谁先动手、为什么非做不可？配角/反派是否有明确诉求、恐惧和反制，而不是站着等死？反派是否基于其已知信息行动，而非不可能知道的信息？本段推进靠的是前文铺垫，还是凭空掉设定？任何一个问题答不上来，先补动机链再写。

【改写边界】
润色：只改表达、节奏和段落呼吸，不改事实与剧情结论。改写：可改叙述顺序、画面、力度，但保留核心事实与人物动机。重写：可重构场景推进和冲突组织，但不改主设定和大事件结果。续写：只在现有文本之后向前推进，不反改前文。用户指令与边界冲突时，以用户要求为准。

【去AI味约束】
- 句式多样化：长短句交替，避免连续重复相同句式、相同主语开头。
- 词汇控制：多用动词和名词，少堆形容词和高级词汇；对"冷笑""蝼蚁""轰然炸裂""倒吸一口凉气""瞳孔骤缩""满场死寂"等高疲劳词保持克制，同章同一高识别词默认只出现1次。
- 群像反应具体化：不要一律写成"全场震惊"或"众人倒吸凉气"，改写成1-2个具体角色的身体反应、判断偏差或利益震荡。
- 反派与配角的狠话必须贴合身份、地域与处境，不要复制通用口号。
- 避免过于完美或机械的逻辑结构，保留人物的非理性冲动和情感瑕疵。
- 合理分段，每段聚焦1个核心信息点，段落长度适中，适合手机阅读。

【禁止的失败模式】
- 无铺垫强行让已退场角色回归（假死/分身/复活必须以前文铺垫为前提）
- 为了推剧情让角色突然仁慈、犯蠢、讲武德
- 反派像木桩一样排队送死，或基于其不可能知道的信息行动
- 用大段设定说明替代战斗、压迫和收益兑现
- 没有铺垫突然塞入新体系、新地图、新外挂解决问题
- 配角工具人化——配角必须有自己的算盘、恐惧、筹码、误判与反扑
- 用模糊词掩盖跳变与降智（如"暴涨""海量""难以估量"跳过结算）
- 完成大剧情节点后忘记更新伏笔状态，导致逃敌、宝物或耳语无故消失
- 流水账——每一行字都要推动剧情或塑造人物，拒绝无效情节堆砌
- 连续空话、同义反复和模板化狠话——每段应带来新信息、态度变化或利益变化，避免空转
- 数据通胀和战力崩坏——同层级增量不得无说明跨越数量级，收益必须有可追溯的锚点
- 设定吃书——前文已写明的设定，后文不能矛盾覆盖；若必须修改，要明确说明覆盖了哪些旧设定
- 无理由的爱/恨——所有关系的改变必须有事件驱动和铺垫，不能跨越式发展
- 把所有章节都写成主角无敌碾压模板——不同章节类型使用不同压迫方式
- 文青病——不要在紧张推进时突然感慨人生、抒情独白，该推进就推进
- 历史课件式开头——用场面、动作、感官切入，不要用大段背景介绍开场
- 主角成功无代价——成功最好伴随不可逆的代价，表层爽点里层成本
- 人设前后矛盾——角色不能突然做出与性格矛盾的选择，成长必须在逻辑合理范畴内
- 关系发展突兀——情感和关系必须有递进过程，不能通过标签化互动强行推进

【质量审查框架】
审查时按"问题→证据→最小修法"输出，优先修根因，不做表面润色。审查维度包括：设定冲突、人物OOC、爽点缺失、节奏拖沓、配角降智、敌方信息越界、战力崩坏、伏笔失管、语言机械、词汇疲劳、利益链不成立、台词失真。`,
      user: `请处理当前写作请求，并优先给出可直接使用的结果。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前项目默认风格：${String(context.writingStyleLabel ?? '未指定')}\n风格要求：${String(context.writingStylePrompt ?? '暂无')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n\n当前选中文本：\n${selectedText || '暂无'}\n\n相邻章节参考（含正文预览）：\n${relatedChapters || '暂无'}\n\n本卷章节概览（摘要，供情节衔接参考）：\n${volumeChapterSummaries || '暂无'}\n\n全书开篇（世界与角色基调参照）：\n${novelOpenerSummary || '暂无'}\n\n未收伏笔 / 活跃剧情线：\n${openPlotThreads || '暂无（请注意：若有遗漏伏笔，请不要引入与已有伏笔矛盾的设定）'}\n\n相关世界观：\n${worldviewEntries || '暂无'}\n\n相关角色：\n${characters || '暂无'}\n\n相关组织：\n${organizations || '暂无'}\n\n角色关系：\n${relationships || '暂无'}\n\n成员归属：\n${memberships || '暂无'}\n\n当前可用灵感：\n${inspirationEntries || '暂无'}\n\n相关大纲：\n${outlineItems || '暂无'}\n\n最近对话：\n${recentMessages || '暂无'}\n\n当前项目启用 skills：\n${projectSkills || '暂无'}\n\n快捷动作：${quickAction}\n输出模式：${responseMode}\n输出长度：${responseLength}\n用户请求：${String(context.userPrompt ?? '')}\n\n要求：\n1. 回答要紧贴当前章节上下文\n2. 如果请求是润色、续写、描写，请优先输出可直接插入正文的内容\n3. 如果提供了当前选中文本，并且请求与润色、改写、分析有关，请优先只围绕这段文本处理，不要重写整章\n4. 如果请求是分析或建议，请给出清晰可执行的建议\n5. 避免与最近几条对话重复表达，除非用户明确要求重写\n6. 如果是续写，请尽量与相邻章节和当前分卷的情绪、节奏保持连续\n7. 若当前可用灵感不为空，可优先借用其中最贴合的一条，把它自然落到正文、桥段或冲突推进中\n8. 如果角色关系、组织立场或成员归属会影响人物行为、冲突走向或措辞，请优先把这些因素写进结果\n9. 如果当前项目启用了 skills，优先吸收其中与正文创作、优化、审查相关的规则与口径\n10. 必须遵循当前项目默认风格；若用户请求与风格冲突，以用户请求优先，但尽量保留风格骨架\n11. 续写或改写前确认最近章节中的人物状态、已公开情报和未回收伏笔，确保因果连续，不凭空引入未铺垫的设定或资源\n12. 如果"未收伏笔 / 活跃剧情线"不为空，本次内容不得与这些线索相矛盾；若本章计划收尾某条线，请在正文中给出明确收束情节\n13. 先识别当前章节类型（布局章/事件章/过渡章/回收章），再选择对应写法，不要用同一种模板写所有章节\n14. 配角和反派必须有反扑、误判和自己的算盘，不能工具人化或为了推剧情而降智\n15. 去AI味：句式长短交替，避免重复句式和相同主语开头；对高疲劳词保持克制，同章同一高识别词默认只出现1次；群像反应不要一律"全场震惊"，改写成具体角色的身体反应或利益震荡\n16. 收益必须落到具体资源、地位变化、信息获取或伏笔回收，不能只写抽象提升\n17. ${modeInstruction}\n18. ${lengthInstruction}\n19. ${quickActionInstruction}`
    })
  }

  // ── 章节初稿生成任务（支持流式输出） ──
  if (task.task === 'chapter-first-draft') {
    const worldviewEntries = Array.isArray(context.worldviewEntries)
      ? context.worldviewEntries
          .slice(0, 8)
          .map((entry) => `${String((entry as Record<string, unknown>).title ?? '')}：${String((entry as Record<string, unknown>).content ?? '')}`)
          .join('\n')
      : ''
    const characters = Array.isArray(context.characters)
      ? context.characters
          .slice(0, 10)
          .map((character) => `${String((character as Record<string, unknown>).name ?? '')} / ${String((character as Record<string, unknown>).role ?? '')}：${String((character as Record<string, unknown>).description ?? '')}`)
          .join('\n')
      : ''
    const organizations = formatOrganizations(context.organizations)
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters)
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters)
    const inspirationEntries = Array.isArray(context.inspirationEntries)
      ? context.inspirationEntries
          .slice(0, 6)
          .map((entry) => {
            const record = entry as Record<string, unknown>
            const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)).join('、') : ''
            return `${String(record.type ?? '')} / ${String(record.title ?? '')}：${String(record.content ?? '')}${tags ? `（标签：${tags}）` : ''}`
          })
          .join('\n')
      : ''
    const outlineItems = Array.isArray(context.outlineItems)
      ? context.outlineItems
          .slice(0, 8)
          .map((item) => `${String((item as Record<string, unknown>).title ?? '')}：${String((item as Record<string, unknown>).summary ?? '')}`)
          .join('\n')
      : ''
    const relatedChapters = Array.isArray(context.relatedChapters)
      ? context.relatedChapters
          .slice(0, 2)
          .map((item, index) => {
            const record = item as Record<string, unknown>
            return `关联章节${index + 1}：${String(record.title ?? '')}\n摘要：${String(record.summary ?? '')}\n正文预览：${String(record.preview ?? '')}`
          })
          .join('\n\n')
      : ''
    // 当前分卷内其他章节的摘要，供 AI 做情节衔接参考
    const volumeChapterSummaries = Array.isArray(context.volumeChapterSummaries)
      ? context.volumeChapterSummaries
          .map((item, index) => {
            const record = item as Record<string, unknown>
            return `第${index + 1}节：${String(record.title ?? '')}\n  摘要：${String(record.summary ?? '') || '暂无摘要'}`
          })
          .join('\n\n')
      : ''
    // 全书第 1 章摘要（世界/角色基调参照）
    const novelOpenerSummaryDraft = context.novelOpenerSummary
      ? (() => {
          const record = context.novelOpenerSummary as Record<string, unknown>
          return `标题：${String(record.title ?? '')}\n摘要：${String(record.summary ?? '') || '暂无摘要'}`
        })()
      : ''
    // 活跃剧情线索
    const openPlotThreadsDraft = Array.isArray(context.plotThreads)
      ? context.plotThreads
          .filter((t) => (t as Record<string, unknown>).status === 'open')
          .map((t) => {
            const record = t as Record<string, unknown>
            return `- ${String(record.title ?? '')}：${String(record.description ?? '')}`
          })
          .join('\n')
      : ''
    const chapterContent = String(context.chapterContent ?? '').trim()
    const chapterHasExistingContent = Boolean(context.chapterHasExistingContent)
    const targetWordCount = String(context.targetWordCount ?? context.chapterWordTarget ?? '').trim()
    const writingStyleLabel = String(context.writingStyleLabel ?? '未指定')
    const writingStylePrompt = String(context.writingStylePrompt ?? '暂无')

    return wrapPrompt({
      system: `你是 CharacterArc 的章节初稿生成器。你的唯一任务，是基于项目设定、当前分卷目标、章节标题/摘要/大纲与角色关系，直接生成“这一章”的第一版正文草稿。只输出正文，不要解释，不要返回 JSON，不要写提示语，不要自我说明。

【任务边界】
- 这是“章节初稿生成”，不是润色，不是续写建议，不是分析。
- 如果当前章节正文为空，就按“从零起稿”处理，禁止假装承接不存在的前文。
- 如果当前章节正文不为空，也不要把任务理解成“续写”；你要重写并产出一版完整初稿，而不是在旧文后面往下接。
- 输出结果会直接覆盖当前章节全部内容，所以正文必须是完整可读的一章，不要输出提纲、注释、分点说明或“以下是初稿”。

【初稿写作目标】
- 先识别本章更接近哪类章节：布局章、事件章、过渡章、回收章，再决定写法。
- 章节必须有明确开场、推进和收束，不要写成散段拼贴。
- 开场直接入场景、动作、压力或利益交换，不要历史课件式开头，不要长段背景介绍。
- 每个主要段落都要推进至少一项：信息、关系、利益、风险、地位、资源、伏笔回收。
- 角色行为必须基于利益、恐惧、误判、立场和当前已知信息，不能为了推进剧情降智。
- 收益要落到具体资源、情报、关系变化、地位变化或钩子回收，不能写抽象提升。

【字数与完成度】
- 目标字数尽量贴近 ${targetWordCount || '当前章节预估字数'}，允许上下浮动约 10%。
- 不要为了凑字数灌水；宁可密度更高，也不要流水账。
- 如果目标字数较高，优先扩展冲突过程、人物互动、反馈兑现与余波，而不是堆背景说明。

【文风与质量约束】
- 项目默认风格：${writingStyleLabel}
- 风格要求：${writingStylePrompt}
- Show, don't tell。用动作、物件、感官、代价、价格、制度摩擦说话。
- 去AI味：句式长短交替，避免同一句式和同一主语反复起头；少堆高级词和空泛判断。
- 群像反应要具体，不要写成“全场震惊”模板。
- 配角和反派必须有自己的算盘、误判和反扑，不是木桩。
- 禁止机械降神，禁止无铺垫新设定救场，禁止文青病，禁止空话。

【连贯性规则】
- 你必须尊重当前分卷目标、章节摘要、相关大纲、世界观和人物关系。
- 可以参考相邻章节摘要与预览来保持整卷连续性，但不要把这次任务写成“上一章之后的补几段”。
- 如果当前上下文说明本章尚未写正文，就不要引用“本章前文已经发生了什么”这类不存在内容。

【输出要求】
- 只输出最终正文。
- 不要标题前缀，不要“第X章”编号，不要注释，不要小结，不要分析。`,
      user: `请为当前小说项目生成本章初稿。

项目标题：${String(context.projectTitle ?? '')}
项目题材：${String(context.projectGenre ?? '')}
当前分卷：${String(context.chapterVolumeTitle ?? '')}
当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}
当前章节标题：${String(context.chapterTitle ?? '')}
当前章节摘要：${String(context.chapterSummary ?? '')}
当前章节状态：${String(context.chapterStatus ?? '')}
当前章节预估字数：${String(context.chapterWordTarget ?? '')}
目标字数：${targetWordCount || String(context.chapterWordTarget ?? '')}
当前章节是否已有正文：${chapterHasExistingContent ? '有，但本次要整章重写' : '没有，本次从零起稿'}
当前章节现有正文（如为空则代表从零起稿）：
${chapterContent || '【空】'}

相邻章节参考（含正文预览）：
${relatedChapters || '暂无'}

本卷章节概览（摘要，供情节衔接参考）：
${volumeChapterSummaries || '暂无'}

全书开篇（世界与角色基调参照）：
${novelOpenerSummaryDraft || '暂无'}

未收伏笔 / 活跃剧情线：
${openPlotThreadsDraft || '暂无（请注意：若有遗漏伏笔，请不要引入与已有伏笔矛盾的设定）'}

相关世界观：
${worldviewEntries || '暂无'}

相关角色：
${characters || '暂无'}

相关组织：
${organizations || '暂无'}

角色关系：
${relationships || '暂无'}

成员归属：
${memberships || '暂无'}

可用灵感：
${inspirationEntries || '暂无'}

相关大纲：
${outlineItems || '暂无'}

当前项目启用 skills：
${projectSkills || '暂无'}

补充要求：
${String(context.userPrompt ?? '')}

硬要求：
1. 生成的是”完整初稿”，不是续写，不是建议，不是分析。
2. 成稿直接覆盖当前章节全部内容，所以必须完整可读。
3. 如果当前正文为空，按从零起稿处理，不得虚构”上文已经写过”的内容。
4. 强贴当前章节标题、章节摘要、分卷目标和大纲，不要跑偏到别的章节。
5. 字数尽量贴近目标字数，允许上下浮动 10%。
6. 如果”未收伏笔 / 活跃剧情线”不为空，本章内容不得与这些线索相矛盾；若本章计划收尾某条线，请在正文中给出明确的收束情节。
7. 优先写出可继续改稿的第一版正文，不要解释。`
    })
  }

  // ── 章节摘要自动生成任务（非流式，4 维结构化文本） ──
  if (task.task === 'chapter-summarize') {
    return wrapPrompt({
      system:
        '你是小说章节摘要助手。请按照指定的四维格式输出纯文本摘要，不要输出 Markdown、JSON 或额外解释。',
      user: `请为以下章节生成一段结构化摘要，供后续章节创作时快速了解本章关键信息。\n\n章节标题：${String(context.chapterTitle ?? '')}\n章节正文：\n${String(context.chapterContent ?? '')}\n\n要求：\n1. 严格按以下四维格式输出，每一维单独一行开头：\n   核心事件：\n   信息增量：\n   状态变化：\n   留存悬念：\n2. 每一维用 1 到 2 句话描述，总字数控制在 80 到 150 字之间\n3. 核心事件：本章推进的主要情节（发生了什么）\n4. 信息增量：读者或人物获知的新信息（知道了什么）\n5. 状态变化：人物、势力、资源的具体变化（改变了什么）\n6. 留存悬念：埋下但未解的伏笔或疑问（留下了什么）\n7. 不要输出"摘要："前缀，直接从"核心事件："开始\n8. 只输出摘要正文，不要解释`
    })
  }

  // ── 章节伏笔自动识别任务（从正文识别潜在伏笔，返回 JSON） ──
  if (task.task === 'plot-thread-detect') {
    const existingThreads = Array.isArray(context.existingThreads) ? context.existingThreads : []
    const existingList = existingThreads.length
      ? existingThreads.map((t: unknown) => `- ${String(t)}`).join('\n')
      : '（暂无）'

    return wrapPrompt({
      system:
        '你是专业小说编辑，擅长识别正文中的伏笔、未解悬念和潜在剧情线索。请只返回 JSON 对象，不要返回 Markdown 或多余文字。字段必须包含 entries 数组。',
      user: `请分析以下章节正文，识别其中明确埋下或潜在的伏笔与悬念，生成候选剧情线索列表。\n\n章节标题：${String(context.chapterTitle ?? '')}\n\n正文内容：\n${String(context.chapterContent ?? '')}\n\n已有线索（请勿重复）：\n${existingList}\n\n要求：\n1. 只识别正文中真实存在的伏笔或悬念，不要凭空捏造\n2. 每条线索给出简洁标题（≤20字）、详细描述（≤80字）和 1-3 个关联标签（角色名/地点/主题）\n3. 最多返回 6 条，去掉与已有线索重复的内容\n4. 按重要程度从高到低排列\n\n返回格式：{"entries":[{"title":"","description":"","tags":[]}]}`
    })
  }

  // ── 默认：大纲节点生成任务 ──
  return wrapPrompt({
    system:
      '你是小说剧情大纲助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 title、wordTarget、conflict、summary。',
    user: `基于以下上下文，为当前小说项目补充一个新的章节大纲节点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n已有大纲：${JSON.stringify(context.outlineTitles ?? [])}\n当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n角色参考：${JSON.stringify(context.characters ?? [])}\n补充要求：${String(context.userPrompt ?? '')}\n\n要求：\n1. title 为新的章节标题，并体现与当前章节的承接关系\n2. wordTarget 使用"预估 xxxx字"格式\n3. conflict 用一句话概括下一章的核心冲突\n4. summary 用中文描述剧情推进，80 到 180 字\n5. 与当前分卷目标、已有大纲和当前章节情绪保持连续，不要重复已有节点\n6. ${writingStyleInstruction}\n\n返回格式：{"title":"","wordTarget":"","conflict":"","summary":""}`
  })
}

/**
 * 构建 JSON 修复提示词。
 * 当 AI 返回的结构化 JSON 不合法时，将原始提示词和错误输出一起发送给 AI，要求重新生成合法 JSON。
 */
export function buildRepairPrompt(task: AiTaskPayload, brokenText: string): PromptPair {
  const originalPrompt = buildTaskPrompt(task)

  return {
    system:
      '你是 JSON 输出修复助手。你只负责把已有回复整理成合法 JSON，不能输出 Markdown、解释或额外文本。',
    user: `请根据原始任务要求，把下面这段回复修正为严格合法的 JSON。\n\n原始系统要求：\n${originalPrompt.system}\n\n原始用户要求：\n${originalPrompt.user}\n\n模型原始回复：\n${brokenText}\n\n要求：\n1. 只返回一个合法 JSON 对象\n2. 不要补充与任务无关的解释\n3. 缺失字段时，根据原始任务要求补齐最合理的内容`
  }
}

/** 将组织列表格式化为纯文本，供提示词注入。每行格式：名称 / 类型：描述（信条：xxx） */
function formatOrganizations(source: unknown): string {
  return Array.isArray(source)
    ? source
        .slice(0, 6)
        .map((entry) => {
          const record = entry as Record<string, unknown>
          return `${String(record.name ?? '')} / ${String(record.type ?? '')}：${String(record.description ?? '')}${record.motto ? `（信条：${String(record.motto)}）` : ''}`
        })
        .join('\n')
    : ''
}

/** 将角色关系列表格式化为纯文本。通过 characterNameMap 将角色 ID 解析为可读姓名。每行格式：角色A -> 角色B / 关系类型：描述（强度 x） */
function formatCharacterRelationships(source: unknown, charactersSource: unknown): string {
  if (!Array.isArray(source)) {
    return ''
  }

  // 构建角色 ID → 姓名的映射表
  const characterNameMap = new Map(
    Array.isArray(charactersSource)
      ? charactersSource.map((character) => {
          const record = character as Record<string, unknown>
          return [String(record.id ?? ''), String(record.name ?? '')]
        })
      : []
  )

  return source
    .slice(0, 8)
    .map((entry) => {
      const record = entry as Record<string, unknown>
      const fromName = characterNameMap.get(String(record.fromCharacterId ?? '')) || String(record.fromCharacterId ?? '')
      const toName = characterNameMap.get(String(record.toCharacterId ?? '')) || String(record.toCharacterId ?? '')
      return `${fromName} -> ${toName} / ${String(record.type ?? '')}：${String(record.description ?? '')}（强度 ${String(record.intensity ?? '')}）`
    })
    .join('\n')
}

/** 将组织成员归属列表格式化为纯文本。同时解析角色和组织的 ID → 名称映射。每行格式：角色名 属于 组织名 / 身份：xxx */
function formatOrganizationMemberships(membershipsSource: unknown, organizationsSource: unknown, charactersSource: unknown): string {
  if (!Array.isArray(membershipsSource)) {
    return ''
  }

  // 构建组织 ID → 名称的映射表
  const organizationNameMap = new Map(
    Array.isArray(organizationsSource)
      ? organizationsSource.map((organization) => {
          const record = organization as Record<string, unknown>
          return [String(record.id ?? ''), String(record.name ?? '')]
        })
      : []
  )
  // 构建角色 ID → 姓名的映射表
  const characterNameMap = new Map(
    Array.isArray(charactersSource)
      ? charactersSource.map((character) => {
          const record = character as Record<string, unknown>
          return [String(record.id ?? ''), String(record.name ?? '')]
        })
      : []
  )

  return membershipsSource
    .slice(0, 8)
    .map((entry) => {
      const record = entry as Record<string, unknown>
      const characterName = characterNameMap.get(String(record.characterId ?? '')) || String(record.characterId ?? '')
      const organizationName = organizationNameMap.get(String(record.organizationId ?? '')) || String(record.organizationId ?? '')
      return `${characterName} 属于 ${organizationName} / 身份：${String(record.role ?? '')}${record.notes ? ` / 备注：${String(record.notes)}` : ''}`
    })
    .join('\n')
}

function formatProjectSkills(source: unknown): string {
  if (!Array.isArray(source)) {
    return ''
  }

  return source
    .slice(0, 4)
    .map((entry, index) => {
      const record = entry as Record<string, unknown>
      const name = String(record.name ?? `Skill ${index + 1}`)
      const description = String(record.description ?? '').trim()
      const content = String(record.content ?? '').trim().slice(0, 1200)
      return `Skill ${index + 1}：${name}\n说明：${description || '暂无说明'}\n内容摘录：\n${content || '暂无内容'}`
    })
    .join('\n\n')
}

/**
 * 根据项目的写作风格设置生成风格指令片段。
 * 优先使用完整的 label + prompt 组合；仅有时则只提风格名称或要求；都没有时使用默认兜底文案。
 */
function resolveWritingStyleInstruction(context: Record<string, unknown>): string {
  const label = String(context.writingStyleLabel ?? '').trim()
  const prompt = String(context.writingStylePrompt ?? '').trim()

  if (!label && !prompt) {
    return '若当前项目未指定写作风格，则使用最贴合作品题材的自然表达。'
  }

  if (label && prompt) {
    return `当前项目默认写作风格为"${label}"。请在输出中遵循以下风格要求：${prompt}`
  }

  if (label) {
    return `当前项目默认写作风格为"${label}"，请让输出保持这一风格的一致性。`
  }

  return `请在输出中遵循以下写作风格要求：${prompt}`
}
