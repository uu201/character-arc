import type { AiTaskPayload, PromptPair } from './aiShared'

export function buildTaskPrompt(task: AiTaskPayload): PromptPair {
  const { context } = task
  const writingStyleInstruction = resolveWritingStyleInstruction(context)

  if (task.task === 'worldview-entry') {
    return {
      system:
        '你是小说世界观设定助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 type、title、content。',
      user: `基于以下上下文，为当前小说项目新增一条世界观设定。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有世界观：${JSON.stringify(context.worldviewTitles ?? [])}\n\n要求：\n1. 返回一条不与已有条目重复的新设定\n2. type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一\n3. title 要简洁\n4. content 用中文完整描述，80 到 180 字\n5. ${writingStyleInstruction}\n\n返回格式：{"type":"","title":"","content":""}`
    }
  }

  if (task.task === 'character-card') {
    return {
      system:
        '你是小说角色设定助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 name、role、description、tags。',
      user: `基于以下上下文，为当前小说项目生成一名新角色。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n已有角色：${JSON.stringify(context.characterNames ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n\n要求：\n1. 不与已有角色重名\n2. role 用短语概括角色定位\n3. description 用中文完整描述，80 到 160 字\n4. tags 返回 2 到 4 个简短标签数组\n5. ${writingStyleInstruction}\n\n返回格式：{"name":"","role":"","description":"","tags":["",""]}`
    }
  }

  if (task.task === 'project-bootstrap') {
    return {
      system:
        '你是小说项目初始化助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 worldviewEntries、outlineItems。',
      user: `请基于以下信息，为小说项目生成首批世界观设定和剧情大纲。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n目标字数：${String(context.projectWordTarget ?? '')}\n核心点子：${String(context.projectPremise ?? '')}\n\n要求：\n1. worldviewEntries 返回 3 条设定，每条都包含 type、title、content\n2. worldviewEntries 的 type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一\n3. outlineItems 返回 3 条章节大纲，每条都包含 title、wordTarget、conflict、summary\n4. wordTarget 使用“预估 xxxx字”格式\n5. 所有内容使用中文，紧贴题材和核心点子，不要重复\n6. ${writingStyleInstruction}\n\n返回格式：{"worldviewEntries":[{"type":"","title":"","content":""}],"outlineItems":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    }
  }

  if (task.task === 'chapter-analysis') {
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

    return {
      system:
        '你是小说章节分析助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 overview、pacing、tension、continuity、highlights、risks、revisionActions。',
      user: `请分析当前章节的写作质量与可优化点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节实际字数：${String(context.chapterWordCount ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n\n相关世界观：\n${worldviewEntries || '暂无'}\n\n相关角色：\n${characters || '暂无'}\n\n相关大纲：\n${outlineItems || '暂无'}\n\n要求：\n1. overview 用 1 到 2 句话概括当前章节完成度、情绪和主要问题\n2. pacing / tension / continuity 都用一句中文短评，既要判断也要说明原因\n3. highlights 返回 2 到 4 条，强调当前章节已经做得好的地方\n4. risks 返回 2 到 4 条，指出节奏、逻辑、人物一致性、设定引用或信息密度方面的风险\n5. revisionActions 返回 3 到 5 条，必须是作者可以立刻执行的修改动作，尽量具体\n6. 输出务必紧贴当前正文，不要给空泛写作建议\n\n返回格式：{"overview":"","pacing":"","tension":"","continuity":"","highlights":["",""],"risks":["",""],"revisionActions":["","",""]}`
    }
  }

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

    return {
      system:
        '你是小说灵感生成助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 entries，entries 中每一项都必须包含 type、title、content、tags。',
      user: `请围绕当前小说项目生成一组可直接保存的灵感卡片。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n\n灵感焦点：${String(context.focusType ?? '场景火花')}\n已有灵感标题：${existingInspirationTitles}\n\n相关世界观：\n${worldviewEntries || '暂无'}\n\n相关角色：\n${characters || '暂无'}\n\n相关大纲：\n${outlineItems || '暂无'}\n\n要求：\n1. entries 返回 4 条灵感卡片，每条都必须紧贴“灵感焦点”\n2. type 必须从以下类型中选一个：标题灵感、开篇钩子、场景火花、剧情转折、设定补完、人物动机\n3. title 要短而明确，避免与已有灵感标题重复\n4. content 用中文写成 60 到 140 字的可执行灵感描述，强调可落地场景、冲突、情绪或推进方式\n5. tags 返回 2 到 4 个简短标签，方便后续筛选\n6. 不要空泛鸡汤，不要写成长篇大纲，要像作者工作台里的“灵感卡片”\n7. ${writingStyleInstruction}\n\n返回格式：{"entries":[{"type":"","title":"","content":"","tags":["",""]}]}`
    }
  }

  if (task.task === 'chapter-assistant') {
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
    const relatedChapters = Array.isArray(context.relatedChapters)
      ? context.relatedChapters
          .slice(0, 2)
          .map((item, index) => {
            const record = item as Record<string, unknown>
            return `关联章节${index + 1}：${String(record.title ?? '')}\n摘要：${String(record.summary ?? '')}\n正文预览：${String(record.preview ?? '')}`
          })
          .join('\n\n')
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
    const selectedText = String(context.selectedText ?? '').trim()
    const quickAction = String(context.quickAction ?? '自由提问')
    const responseMode = String(context.responseMode ?? 'freeform')
    const responseLength = String(context.responseLength ?? 'medium')
    const modeInstruction = resolveChapterAssistantModeInstruction(responseMode)
    const lengthInstruction = resolveChapterAssistantLengthInstruction(responseLength)
    const quickActionInstruction = resolveChapterAssistantQuickActionInstruction(quickAction)

    return {
      system:
        '你是 CharacterArc 的小说创作助理。请基于当前项目和章节上下文，用中文直接输出可供作者使用的正文、润色稿、分析或建议。不要输出 Markdown 标题，不要解释你是 AI，也不要返回 JSON。',
      user: `请处理当前写作请求，并优先给出可直接使用的结果。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前项目默认风格：${String(context.writingStyleLabel ?? '未指定')}\n风格要求：${String(context.writingStylePrompt ?? '暂无')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节状态：${String(context.chapterStatus ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n\n当前选中文本：\n${selectedText || '暂无'}\n\n相邻章节参考：\n${relatedChapters || '暂无'}\n\n相关世界观：\n${worldviewEntries || '暂无'}\n\n相关角色：\n${characters || '暂无'}\n\n当前可用灵感：\n${inspirationEntries || '暂无'}\n\n相关大纲：\n${outlineItems || '暂无'}\n\n最近对话：\n${recentMessages || '暂无'}\n\n快捷动作：${quickAction}\n输出模式：${responseMode}\n输出长度：${responseLength}\n用户请求：${String(context.userPrompt ?? '')}\n\n要求：\n1. 回答要紧贴当前章节上下文\n2. 如果请求是润色、续写、描写，请优先输出可直接插入正文的内容\n3. 如果提供了当前选中文本，并且请求与润色、改写、分析有关，请优先只围绕这段文本处理，不要重写整章\n4. 如果请求是分析或建议，请给出清晰可执行的建议\n5. 避免与最近几条对话重复表达，除非用户明确要求重写\n6. 如果是续写，请尽量与相邻章节和当前分卷的情绪、节奏保持连续\n7. 若当前可用灵感不为空，可优先借用其中最贴合的一条，把它自然落到正文、桥段或冲突推进中\n8. 必须遵循当前项目默认风格；若用户请求与风格冲突，以用户请求优先，但尽量保留风格骨架\n9. ${modeInstruction}\n10. ${lengthInstruction}\n11. ${quickActionInstruction}`
    }
  }

  return {
    system:
      '你是小说剧情大纲助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 title、wordTarget、conflict、summary。',
    user: `基于以下上下文，为当前小说项目补充一个新的章节大纲节点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n已有大纲：${JSON.stringify(context.outlineTitles ?? [])}\n当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n角色参考：${JSON.stringify(context.characters ?? [])}\n补充要求：${String(context.userPrompt ?? '')}\n\n要求：\n1. title 为新的章节标题，并体现与当前章节的承接关系\n2. wordTarget 使用“预估 xxxx字”格式\n3. conflict 用一句话概括下一章的核心冲突\n4. summary 用中文描述剧情推进，80 到 180 字\n5. 与当前分卷目标、已有大纲和当前章节情绪保持连续，不要重复已有节点\n6. ${writingStyleInstruction}\n\n返回格式：{"title":"","wordTarget":"","conflict":"","summary":""}`
  }
}

export function buildRepairPrompt(task: AiTaskPayload, brokenText: string): PromptPair {
  const originalPrompt = buildTaskPrompt(task)

  return {
    system:
      '你是 JSON 输出修复助手。你只负责把已有回复整理成合法 JSON，不能输出 Markdown、解释或额外文本。',
    user: `请根据原始任务要求，把下面这段回复修正为严格合法的 JSON。\n\n原始系统要求：\n${originalPrompt.system}\n\n原始用户要求：\n${originalPrompt.user}\n\n模型原始回复：\n${brokenText}\n\n要求：\n1. 只返回一个合法 JSON 对象\n2. 不要补充与任务无关的解释\n3. 缺失字段时，根据原始任务要求补齐最合理的内容`
  }
}

function resolveChapterAssistantModeInstruction(mode: string): string {
  switch (mode) {
    case 'polish':
      return '当前模式是“润色”。请尽量直接输出可替换原文的润色结果，减少分析。'
    case 'continue':
      return '当前模式是“续写”。请紧接现有正文自然续写，保持语气、节奏和剧情方向一致。'
    case 'suggest':
      return '当前模式是“剧情建议”。请给出 3 到 5 条具体建议，按可执行性优先排序。'
    case 'reference':
      return '当前模式是“设定查阅”。请优先提炼与当前章节最相关的设定、角色和风险点。'
    default:
      return '当前模式是“自由提问”。请根据用户请求选择最合适的回答形式。'
  }
}

function resolveChapterAssistantLengthInstruction(length: string): string {
  switch (length) {
    case 'short':
      return '控制在 80 到 180 字，结论优先，避免铺垫过长。'
    case 'long':
      return '控制在 350 到 800 字，可以展开完整段落或多条具体建议。'
    case 'medium':
    default:
      return '控制在 160 到 360 字，兼顾可读性和可执行性。'
  }
}

function resolveChapterAssistantQuickActionInstruction(quickAction: string): string {
  switch (quickAction) {
    case '章节标题':
      return '如果当前任务是生成章节标题，只输出一个最终标题，不要解释、不要分点、不要加书名号；若与通用长度要求冲突，以本条为准。'
    case '章节摘要':
      return '如果当前任务是生成章节摘要，请输出一段可直接作为本章定位的简洁摘要，不要分点，不要额外说明。'
    case '润色选中':
      return '如果当前任务是润色选中内容，请只输出润色后的最终文本，紧贴当前选中文本，不要解释，不要分点。'
    case '下一章建议':
      return '如果当前任务是下一章建议，请输出 3 条具体方案，每条都要体现推进方向、冲突和悬念。'
    default:
      return '如果快捷动作已经明确输出形态，请优先遵循该动作要求。'
  }
}

function resolveWritingStyleInstruction(context: Record<string, unknown>): string {
  const label = String(context.writingStyleLabel ?? '').trim()
  const prompt = String(context.writingStylePrompt ?? '').trim()

  if (!label && !prompt) {
    return '若当前项目未指定写作风格，则使用最贴合作品题材的自然表达。'
  }

  if (label && prompt) {
    return `当前项目默认写作风格为“${label}”。请在输出中遵循以下风格要求：${prompt}`
  }

  if (label) {
    return `当前项目默认写作风格为“${label}”，请让输出保持这一风格的一致性。`
  }

  return `请在输出中遵循以下写作风格要求：${prompt}`
}
