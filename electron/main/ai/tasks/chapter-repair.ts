import type { TaskHandler, PromptBuildInput } from './base'
import { normalizeAssistantText } from './base'
import type { AiTaskResult, ChapterAssistantResult } from '../shared-types'
import { formatProjectSkillsContext } from '../prompts/shared'

/** 章节修复系统提示词：定义诊断维度（风格偏移、剧情bug、角色OOC、AI痕迹、节奏失衡）和最小改动修复原则 */
const CHAPTER_REPAIR_SYSTEM = `你是章节诊断修复专家，专精于识别和修复长篇创作中的问题章节。

你的工作流程分三步：
1. 诊断：识别章节中的具体问题（风格偏移、剧情bug、角色OOC、AI痕迹、节奏失衡）
2. 外科手术式重写：只修改有问题的段落，保留正常段落不动
3. 输出状态更新：列出本次修复涉及的角色状态、伏笔、关系变更

【诊断维度】
- 风格偏移：与前文语言风格不一致的段落
- 剧情bug：与已建立事实矛盾的内容
- 角色OOC：不符合角色已建立性格/动机的行为或台词
- AI痕迹：机械化表达、套路化描写、过度使用特定词汇
- 节奏失衡：信息密度突变、场景转换生硬

【修复原则】
- 最小改动原则：能改一句不改一段，能改一段不改全章
- 保持前后文衔接：修复后的内容必须与未修改部分无缝衔接
- 尊重已建立设定：修复不能引入新的设定矛盾
- 保留作者意图：修复方向是让原有意图更好地表达，而非改变方向

【输出格式】
先输出诊断报告，再输出修复后的完整章节正文。`

/** 审计驱动的修复模式：跳过诊断，直接针对已知问题进行外科手术式修复 */
const AUDIT_REPAIR_SYSTEM = `你是章节修复专家。质量审计已经完成诊断，你只需根据审计发现的问题进行外科手术式修复。

【修复原则】
- 最小改动原则：只修改审计指出的问题段落，保留其他段落不动
- 保持前后文衔接：修复后的内容必须与未修改部分无缝衔接
- 尊重已建立设定：修复不能引入新的设定矛盾
- 字数约束：修复后总字数与原文偏差不超过 ±10%
- 保留作者意图：修复方向是让原有意图更好地表达，而非改变方向

【输出格式】
直接输出修复后的完整章节正文。不要诊断报告，不要解释，不要 markdown 标记，不要说你是谁，不要复述问题，不要写"我理解了"或"我会"。直接以正文第一句开始。`

function formatAuditIssues(issues: unknown): string {
  if (!Array.isArray(issues) || issues.length === 0) return ''
  return issues
    .map((issue) => {
      const i = issue as Record<string, unknown>
      const severity = String(i.severity ?? '')
      const category = String(i.category ?? '')
      const ref = String(i.ref ?? '')
      const hint = String(i.hint ?? '')
      return `[${severity}] ${category}：${ref}${hint ? `（建议：${hint}）` : ''}`
    })
    .join('\n')
}

function stripRepairPreamble(text: string): string {
  const normalized = normalizeAssistantText(text).content.trim()
  if (!normalized) return ''

  const separator = normalized.match(/(?:^|\n)\s*(?:---+|\*\*\*+|===+)\s*(?:\n|$)/)
  if (separator?.index !== undefined && separator.index < 2500) {
    return normalized.slice(separator.index + separator[0].length).trim()
  }

  const lines = normalized.split(/\r?\n/)
  let dropUntil = 0
  let sawMetaPreamble = false
  const metaLine = (line: string): boolean => {
    const t = line.trim()
    return Boolean(
      /^I am Claude,?\s+made by Anthropic\.?$/i.test(t)
      || /^我是\s*Claude/i.test(t)
      || /^我(理解了|会|将|需要|来|已经|会在)/.test(t)
      || /^这是一次.*修复/.test(t)
      || /^需要解决/.test(t)
      || /^以下是/.test(t)
      || /^修复后的完整章节正文[:：]?/.test(t)
      || /^正文[:：]?$/.test(t)
      || /^(?:\d+\.|[-*])\s*.*(?:payoff|ending-change|关系变化|缺失|不足|强化|修复|问题)/i.test(t)
    )
  }

  for (let i = 0; i < Math.min(lines.length, 50); i += 1) {
    const line = lines[i].trim()
    if (!line) {
      if (sawMetaPreamble) dropUntil = i + 1
      continue
    }

    if (metaLine(line) || (sawMetaPreamble && /^(?:---+|\*\*\*+|===+)$/.test(line))) {
      sawMetaPreamble = true
      dropUntil = i + 1
      continue
    }

    break
  }

  if (sawMetaPreamble && dropUntil > 0) {
    return lines.slice(dropUntil).join('\n').trim()
  }
  return normalized
}

/** 章节修复任务：对问题章节进行诊断并进行外科手术式重写 */
const handler: TaskHandler = {
  name: 'chapter-repair',
  outputType: 'text',
  maxSkills: 6,
  defaultCapabilities: ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline', 'writing-style', 'project-skills'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock, knowledgeBlock } = input
    const retrievalBlock = knowledgeBlock ? `\n\n检索到的项目记忆与参考资料：\n${knowledgeBlock}` : ''
    const auditIssuesBlock = formatAuditIssues(context.auditIssues)
    const isAuditDriven = Boolean(auditIssuesBlock)
    const projectSkillsBlock = formatProjectSkillsContext(context.projectSkills)
    const effectiveSkillsBlock = [projectSkillsBlock, skillsBlock].filter(Boolean).join('\n\n')

    const systemPrompt = isAuditDriven ? AUDIT_REPAIR_SYSTEM : CHAPTER_REPAIR_SYSTEM

    const userPromptParts = [
      `${capabilityPreamble.user}`,
      `\n\n请对以下章节进行${isAuditDriven ? '针对性修复' : '诊断并修复'}。`,
      `\n\n项目标题：${String(context.projectTitle ?? '')}`,
      `\n项目题材：${String(context.projectGenre ?? '')}`,
      `\n当前风格：${String(context.writingStyleLabel ?? '未指定')}`,
      `\n风格要求：${String(context.writingStylePrompt ?? '暂无')}`,
      `\n当前章节标题：${String(context.chapterTitle ?? '')}`,
      `\n当前章节摘要：${String(context.chapterSummary ?? '')}`,
      `\n当前章节正文：\n${String(context.chapterContent ?? '')}`
    ]

    if (isAuditDriven) {
      userPromptParts.push(`\n\n== 质量审计发现的问题（必须全部修复） ==\n${auditIssuesBlock}`)
      if (context.chapterMemo) {
        userPromptParts.push(`\n\n== 本章写作备忘（修复时参考） ==\n${String(context.chapterMemoText ?? '')}`)
      }
    } else {
      userPromptParts.push(`\n\n用户反馈的问题：${String(context.userPrompt ?? '请自动诊断')}`)
    }

    userPromptParts.push(retrievalBlock)
    userPromptParts.push(`\n\n本步骤启用 skills：\n${effectiveSkillsBlock || '暂无'}`)
    if (String(context.userPrompt ?? '').trim()) {
      userPromptParts.push(`\n\n本步骤补充修复要求：${String(context.userPrompt).trim()}`)
    }

    return {
      system: `${capabilityPreamble.system}\n\n${systemPrompt}`,
      user: userPromptParts.join('')
    }
  },
  normalize(raw: string): AiTaskResult {
    return { content: stripRepairPreamble(raw) } as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    return Boolean((result as ChapterAssistantResult).content?.trim())
  },
  resolveMaxTokens(input: PromptBuildInput): number {
    const draftLength = String(input.context.chapterContent ?? '').length
    if (draftLength > 3000) return 8000
    return 4000
  }
}
export default handler
