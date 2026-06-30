import type { SkillDefinition } from '../skills/types'

/**
 * 把候选 skills 编排成"渐进式披露"的 skill index 写进 system prompt。
 * 模型只看到 id + 简短描述；要看主体得调 skill_load 工具——这是 Claude Code 的 skill 协议。
 */
export function buildSkillIndex(skills: SkillDefinition[]): string {
  if (!skills.length) return ''

  const entries = skills.map((skill) => {
    const desc = (skill.description || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    const files = skill.referenceFiles ?? []
    if (!files.length) return `- ${skill.id}：${desc}`
    const fileList = files.slice(0, 20).map((f) => `    - ${f}`).join('\n')
    const more = files.length > 20 ? `\n    - …（共 ${files.length} 个文件，调用 skill_glob 查看完整列表）` : ''
    return `- ${skill.id}：${desc}\n  references:\n${fileList}${more}`
  })

  return [
    '',
    '## 当前任务候选 SKILLS（按需加载，不要一次性全部加载）',
    '',
    '以下只是当前任务自动匹配到的候选 skill 索引，不是完整 skill 清单；用户询问现有/全部/启用 skills 时请调用 `skill_list`。',
    '每个候选 skill 列出了它的 references/ 文件清单。',
    '判断哪些参考文件与当前任务相关后，用 `skill_read_reference` 直接读对应文件；',
    '想看 SKILL.md 主体用 `skill_load`；想列其他子目录用 `skill_glob`。',
    '不相关的文件不要加载，避免浪费上下文。',
    '',
    ...entries
  ].join('\n')
}

/**
 * 在 system prompt 末尾追加 agent 行为规则——告诉模型：
 * 1) 在调用工具前先思考是否真的需要；
 * 2) 工具失败时要看 error 信息再决定下一步；
 * 3) 最终输出必须满足任务的原始格式约束（JSON / 正文等）。
 */
export function buildAgentBehaviorRules(): string {
  return [
    '',
    '## Agent 行为约束',
    '',
    '- 工具调用是可选的：如果你已经能根据上下文给出高质量结果，直接输出最终答案，不要为了调用而调用。',
    '- 工具失败（tool_result 带 error）时，先读 error 文本判断是参数错误还是环境问题，再决定是否重试或换路线。',
    '- 不要连续重复调用同一个工具+同一组参数；如果同一个 tool 已经返回过结果，直接用之前的结果。',
    '- **完成工具调用后必须输出文本回复**：即使工具返回空数据或错误，也要基于已有信息给用户一个明确的文字回复，不要只调用工具就结束。',
    '- 最终回复的格式必须严格满足任务的原始要求（如要求返回 JSON 就只输出 JSON，不要包裹 markdown fence）。'
  ].join('\n')
}
