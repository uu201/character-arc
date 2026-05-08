import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, ReferenceStyleAnalysisResult } from '../shared-types'

function toList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const normalized = value.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
  return normalized.length ? normalized : fallback
}

const handler: TaskHandler = {
  name: 'reference-style-analysis',
  outputType: 'json',
  defaultCapabilities: ['settings', 'analysis', 'writing-style', 'outline', 'import-export', 'project-skills'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock } = input
    const skillsSection = skillsBlock ? `\n\n## 拆书方法论（来自已启用 skills）\n\n以下是当前项目启用的拆书相关 skills。请优先按这些 skills 的汇总框架、判断标准和输出口径来提炼全局风格规则；仅在 skills 没覆盖时，再用通用拆书经验补足。\n\n${skillsBlock}` : ''
    return {
      system: `${capabilityPreamble.system}\n\n你是小说拆书分析助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 overview、sentenceStyle、dialogueRatio、pacingControl、emotionExpression、narrativePerspective、styleRules、plotOutline、reusableStylePrompt、avoidRules。${skillsSection}`,
      user: `${capabilityPreamble.user}\n\n请基于以下参考作品的全局统计和分块分析结果，汇总出一套可复用的仿写规则。\n\n当前项目标题：${String(context.projectTitle ?? '')}\n当前项目题材：${String(context.projectGenre ?? '')}\n参考作品标题：${String(context.sourceTitle ?? '')}\n参考文件类型：${String(context.sourceFileType ?? '')}\n参考作品字数：${String(context.sourceCharacterCount ?? '')}\n参考作品章节数：${String(context.sourceChapterCount ?? '')}\n全局统计：${JSON.stringify(context.styleMetrics ?? [])}\n全局关键词：${JSON.stringify(context.topKeywords ?? [])}\n开篇摘录：\n${String(context.sourceExcerpt ?? '')}\n\n全书抽样：\n${String(context.analysisSample ?? '')}\n\n分块分析结果：\n${String(context.chunkSummaries ?? '')}\n\n要求：\n1. 目标是汇总跨分块稳定成立的风格骨架\n2. styleRules 返回 4 到 6 条可执行风格规则\n3. plotOutline 用 120 到 220 字概括故事骨架\n4. reusableStylePrompt 写成可复用的风格模板，180 到 320 字\n5. avoidRules 返回 3 到 5 条避险规则\n6. 如果当前项目启用了拆书 skills，优先沿用其中的汇总口径、术语和判断标准\n7. 全部内容用简体中文，不能输出版权敏感内容\n\n返回格式：{"overview":"","sentenceStyle":"","dialogueRatio":"","pacingControl":"","emotionExpression":"","narrativePerspective":"","styleRules":[""],"plotOutline":"","reusableStylePrompt":"","avoidRules":[""]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<ReferenceStyleAnalysisResult>
    return {
      overview: parsed.overview?.trim() || '该参考作品的风格重在稳定推进。',
      sentenceStyle: parsed.sentenceStyle?.trim() || '句式偏直给。',
      dialogueRatio: parsed.dialogueRatio?.trim() || '对白占比适中。',
      pacingControl: parsed.pacingControl?.trim() || '节奏以短回合冲突推进。',
      emotionExpression: parsed.emotionExpression?.trim() || '情绪表达偏外显。',
      narrativePerspective: parsed.narrativePerspective?.trim() || '叙事视角相对稳定。',
      styleRules: toList(parsed.styleRules, ['保持句子干净直接。']),
      plotOutline: parsed.plotOutline?.trim() || '故事骨架围绕主角目标展开。',
      reusableStylePrompt: parsed.reusableStylePrompt?.trim() || '用简洁句式、较高对白驱动和快反馈节奏写作。',
      avoidRules: toList(parsed.avoidRules, ['不要照搬原作的人名和具体桥段。'])
    } as ReferenceStyleAnalysisResult
  },
  resolveMaxTokens(): number {
    return 2200
  },
  validate(result: AiTaskResult): boolean {
    const r = result as ReferenceStyleAnalysisResult
    return Boolean(r.overview?.trim() && r.reusableStylePrompt?.trim() && r.styleRules.length > 0 && r.avoidRules.length > 0)
  }
}
export default handler
