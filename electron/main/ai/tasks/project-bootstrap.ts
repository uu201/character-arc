import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, ProjectBootstrapResult, WorldviewResult, OutlineResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { resolveProjectBootstrapPromptParts } from '../prompts/bootstrap-strategies'
import { normalizeWorldviewType } from './worldview-type'

/** 项目初始化任务：基于小说简介生成首批世界观设定和剧情大纲 */
const handler: TaskHandler = {
  name: 'project-bootstrap',
  outputType: 'json',
  defaultCapabilities: ['settings', 'worldview', 'outline', 'characters', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const { genreLabel, lengthLabel, strategyBlock } = resolveProjectBootstrapPromptParts(context)
    return {
      system: `${capabilityPreamble.system}\n\n你是小说项目初始化助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 worldviewEntries、outlineItems。`,
      user: `${capabilityPreamble.user}\n\n请基于以下信息，为小说项目生成首批世界观设定和剧情大纲。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${genreLabel}\n作品长度：${lengthLabel}\n小说简介：${String(context.projectPremise ?? '')}\n\n题材与长度策略：\n${strategyBlock}\n\n要求：\n1. worldviewEntries 返回 3 条设定，每条都包含 type、title、content\n2. worldviewEntries 的 type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一\n3. outlineItems 返回 3 条章节大纲，每条都包含 title、wordTarget、conflict、summary\n4. wordTarget 使用"预估 xxxx字"格式，并与${lengthLabel}节奏相匹配\n5. 所有内容使用中文，必须紧贴题材、长度和小说简介\n6. 三条世界观设定之间要能互相支撑，三条大纲之间要形成连续推进\n7. 如果简介里已经给出了主角目标、关系或异常事件，要优先围绕它展开\n8. ${writingStyle}\n\n返回格式：{"worldviewEntries":[{"type":"","title":"","content":""}],"outlineItems":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<ProjectBootstrapResult>
    const worldviewEntries = Array.isArray(parsed.worldviewEntries)
      ? parsed.worldviewEntries.slice(0, 3).map((e) => {
          const entry = e as Partial<WorldviewResult>
          return { type: normalizeWorldviewType(entry.type, '地理'), title: entry.title?.trim() || '新世界观词条', content: entry.content?.trim() || 'AI 未返回有效内容' } as WorldviewResult
        })
      : []
    const outlineItems = Array.isArray(parsed.outlineItems)
      ? parsed.outlineItems.slice(0, 3).map((e) => {
          const item = e as Partial<OutlineResult>
          return { title: item.title?.trim() || '第1章：新剧情节点', wordTarget: item.wordTarget?.trim() || '预估 3000字', conflict: item.conflict?.trim() || '新的冲突正在酝酿。', summary: item.summary?.trim() || 'AI 未返回有效剧情摘要' } as OutlineResult
        })
      : []
    return { worldviewEntries, outlineItems } as ProjectBootstrapResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as ProjectBootstrapResult
    return r.worldviewEntries.length > 0 && r.outlineItems.length > 0
  }
}
export default handler
