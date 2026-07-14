import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, OutlineBatchResult } from '../shared-types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { normalizeOutline } from './outline-item'

/** 批量大纲生成任务：为当前分卷连续补充 3-5 个剧情大纲节点 */
const handler: TaskHandler = {
  name: 'outline-batch',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'outline', 'worldview', 'characters', 'relations', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    return {
      system: `${capabilityPreamble.system}\n\n你是小说分卷大纲规划助手。请基于当前项目已有分卷、节点、角色和世界观连续扩写，不要向用户提问。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 entries，entries 中每项都必须包含 title、wordTarget、conflict、summary。`,
      user: `${capabilityPreamble.user}\n\n请基于以下上下文，为当前分卷连续补充 3 到 5 个新的剧情大纲节点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前分卷目标字数：${String(context.chapterVolumeWordTarget ?? '')}\n已有分卷详情：${JSON.stringify(context.volumes ?? [])}\n当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}\n全局已有大纲标题：${JSON.stringify(context.outlineTitles ?? [])}\n全局已有大纲详情：${JSON.stringify(context.outlineItems ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n世界观参考：${JSON.stringify(context.worldviewEntries ?? [])}\n角色参考：${JSON.stringify(context.characters ?? [])}\n补充要求：${String(context.userPrompt ?? '')}\n\n要求：\n0. 不要回答“需要补充信息”或提出问题；信息不足时，从已有项目锚点中选择最稳妥的延展方向。\n1. entries 返回 3 到 5 条新节点，按顺序推进\n2. 每条都必须包含 title、wordTarget、conflict、summary\n3. wordTarget 使用 3000 到 4000 之间的纯数字\n4. summary 用中文描述剧情推进，80 到 180 字\n5. 各节点之间要形成连续节奏，不能生成与现有分卷方向脱节的散点\n6. ${writingStyle}\n\n返回格式：{"entries":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<OutlineBatchResult>
    const entries = Array.isArray(parsed.entries) ? parsed.entries.slice(0, 5).map((e) => normalizeOutline(e as Record<string, unknown>)) : []
    return { entries } as OutlineBatchResult
  },
  validate(result: AiTaskResult): boolean {
    return (result as OutlineBatchResult).entries.length > 0
  }
}
export default handler
