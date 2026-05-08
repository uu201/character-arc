import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, ReferenceStyleChunkResult } from '../shared-types'

function toList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const normalized = value.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
  return normalized.length ? normalized : fallback
}

const handler: TaskHandler = {
  name: 'reference-style-chunk',
  outputType: 'json',
  defaultCapabilities: ['settings', 'analysis', 'writing-style', 'outline', 'import-export', 'project-skills'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock } = input
    const skillsSection = skillsBlock ? `\n\n## 拆书方法论（来自已启用 skills）\n\n以下是当前项目启用的拆书相关 skills。请优先按这些 skills 的分析框架、关注维度和输出口径来提炼本分块特征；仅在 skills 没覆盖时，再用通用拆书经验补足。\n\n${skillsBlock}` : ''
    return {
      system: `${capabilityPreamble.system}\n\n你是小说拆书分块分析助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 overview、sentenceStyle、dialogueRatio、pacingControl、emotionExpression、plotFunction、styleRules。${skillsSection}`,
      user: `${capabilityPreamble.user}\n\n请分析下面这个参考作品分块，提炼它在局部层面的风格和桥段作用。\n\n当前项目标题：${String(context.projectTitle ?? '')}\n当前项目题材：${String(context.projectGenre ?? '')}\n参考作品标题：${String(context.sourceTitle ?? '')}\n分块标签：${String(context.chunkLabel ?? '')}\n分块顺序：${String(context.chunkIndex ?? '')} / ${String(context.chunkTotal ?? '')}\n分块字数：${String(context.chunkCharacterCount ?? '')}\n分块局部统计：${JSON.stringify(context.chunkMetrics ?? [])}\n分块关键词：${JSON.stringify(context.chunkKeywords ?? [])}\n分块正文：\n${String(context.chunkText ?? '')}\n\n要求：\n1. 只分析这一块\n2. styleRules 返回 2 到 4 条局部可复用规则\n3. 不要输出版权敏感的连续原文\n4. 如果当前项目启用了拆书 skills，优先沿用其中的拆书口径和术语\n\n返回格式：{"overview":"","sentenceStyle":"","dialogueRatio":"","pacingControl":"","emotionExpression":"","plotFunction":"","styleRules":[""]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<ReferenceStyleChunkResult>
    return {
      overview: parsed.overview?.trim() || '这一段以稳定推进和局部反馈为主。',
      sentenceStyle: parsed.sentenceStyle?.trim() || '句式偏直接。',
      dialogueRatio: parsed.dialogueRatio?.trim() || '对白承担推进信息的职责。',
      pacingControl: parsed.pacingControl?.trim() || '节奏以短回合推进。',
      emotionExpression: parsed.emotionExpression?.trim() || '情绪通过动作和人物反应外化。',
      plotFunction: parsed.plotFunction?.trim() || '该段桥段主要承担冲突抬升。',
      styleRules: toList(parsed.styleRules, ['保持信息推进和场景反馈同步。'])
    } as ReferenceStyleChunkResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as ReferenceStyleChunkResult
    return Boolean(r.overview?.trim() && r.sentenceStyle?.trim() && r.styleRules.length > 0)
  }
}
export default handler
