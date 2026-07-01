/**
 * 根据章节助手模式返回对应的指令文本。
 *
 * @param mode 助手模式，如 polish / continue / suggest / reference
 * @returns 该模式下的指令说明字符串
 */
export function resolveChapterAssistantModeInstruction(mode: string): string {
  switch (mode) {
    case 'polish': return '当前模式是"润色"。若未启用正文 Diff 审阅，请尽量直接输出可替换原文的润色结果，减少分析；若已启用正文 Diff 审阅，必须生成待审查修改提案，不要直接输出润色全文。'
    case 'continue': return '当前模式是"续写"。请紧接现有正文自然续写，保持语气、节奏和剧情方向一致。'
    case 'suggest': return '当前模式是"剧情建议"。请给出 3 到 5 条具体建议，按可执行性优先排序。'
    case 'reference': return '当前模式是"设定查阅"。请优先提炼与当前章节最相关的设定、角色和风险点。'
    default: return '当前模式是"自由提问"。请根据用户请求选择最合适的回答形式。'
  }
}

/**
 * 根据期望输出长度返回篇幅倾向指令。
 *
 * 不再施加硬性字数上限——具体写多长由请求内容和上下文决定，
 * 真正的天花板是任务的 maxTokens。这里只给出篇幅倾向，避免模型
 * 既不草草收尾、也不无谓注水。
 *
 * @param length 长度偏好：short / medium / long
 * @returns 对应的篇幅倾向说明
 */
export function resolveChapterAssistantLengthInstruction(length: string): string {
  switch (length) {
    case 'short': return '篇幅偏好：精简。结论优先，只保留最关键的内容，不展开铺垫。'
    case 'long': return '篇幅偏好：充分展开。该写多长由内容决定，需要多少篇幅就写多少，把场景、段落或建议写完整，不要因长度顾虑而草草收尾。'
    case 'medium':
    default: return '篇幅根据请求和内容自然决定，不必刻意压缩或拉长；续写、润色、描写类请求该写多长就写多长，把内容写完整，不要中途收尾或省略。'
  }
}

/**
 * 根据快捷动作名称返回对应的输出形态指令。
 *
 * @param quickAction 快捷动作名称，如"章节标题"、"润色选中"等
 * @returns 该快捷动作下的输出格式要求
 */
export function resolveChapterAssistantQuickActionInstruction(quickAction: string): string {
  switch (quickAction) {
    case '章节标题': return '如果当前任务是生成章节标题，只输出一个最终标题，不要解释、不要分点、不要加书名号；若与通用长度要求冲突，以本条为准。'
    case '章节摘要': return '如果当前任务是生成章节摘要，请输出一段可直接作为本章定位的简洁摘要，不要分点，不要额外说明。'
    case '润色选中': return '如果当前任务是润色选中内容，请只输出润色后的最终文本，紧贴当前选中文本，不要解释，不要分点。'
    case '下一章建议': return '如果当前任务是下一章建议，请输出 3 条具体方案，每条都要体现推进方向、冲突和悬念。'
    case '关系冲突': return '如果当前任务是关系冲突，请输出 3 条关系驱动冲突方案，每条都明确人物关系、阵营立场和可触发场景。'
    case '阵营视角': return '如果当前任务是阵营视角，请优先输出可直接替换或插入正文的最终文本，突出组织立场、身份认同和冲突措辞。'
    case '降低AI感': return '如果当前任务是降低AI感润色，请严格遵循 prompt 中的人化规则重写选中文本。专有名词（人名/地名/势力名）一字不改，情节因果完整保留，字数偏差不超过 ±5%，只输出最终正文，不解释、不分点、不加标签。'
    default: return '如果快捷动作已经明确输出形态，请优先遵循该动作要求。'
  }
}
