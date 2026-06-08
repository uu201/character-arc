import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, ChapterScenePlanResult } from '../shared-types'
import { formatChapterExecutionPacket } from './chapter-execution-packet'

/** 章节场景规划任务：将章节拆分为 2-4 个连续场景段落 */
const handler: TaskHandler = {
  name: 'chapter-scene-plan',
  outputType: 'json',
  defaultCapabilities: ['settings', 'chapters', 'outline'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const words = Number(context.targetWordCount ?? 0)
    const sceneCount = words <= 0 || words <= 2500 ? 2 : words <= 4500 ? 3 : 4
    const executionPacketBlock = formatChapterExecutionPacket(context.chapterExecutionPacket)
    return {
      system: `${capabilityPreamble.system}\n\n你是小说章节场景规划助手。请只返回 JSON 对象，不要返回 Markdown 或多余文字。字段必须包含 scenes 数组。若提供章节执行包，优先使用其中的 sceneBeats、openingHook、endingHook、mustInclude 与 continuityNotes 来组织场景。`,
      user: `${capabilityPreamble.user}\n\n请将以下章节规划为 ${sceneCount} 个连续场景段落，每段用一句话（20-40字）描述写作重点。${executionPacketBlock ? `\n\n${executionPacketBlock}` : ''}\n\n章节标题：${String(context.chapterTitle ?? '')}\n章节摘要：${String(context.chapterSummary ?? '')}\n分卷目标：${String(context.chapterVolumeSummary ?? '')}\n目标字数：${String(context.targetWordCount ?? '')} 字（每段约 ${Math.round(Number(context.targetWordCount ?? 0) / sceneCount)} 字）\n\n要求：\n1. 每段 focus 描述本段的核心动作、冲突或转折\n2. 段与段之间要有明确的推进关系\n3. 如果章节执行包包含 sceneBeats，优先把这些 beats 合并进 ${sceneCount} 个场景\n4. 开场场景承接 openingHook，收束场景承接 endingHook\n5. 返回 ${sceneCount} 条\n\n返回格式：{"scenes":[{"focus":""}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<ChapterScenePlanResult>
    const scenes = Array.isArray(parsed.scenes)
      ? parsed.scenes.slice(0, 4).map((s) => ({ focus: String((s as { focus?: unknown }).focus ?? '').trim() })).filter((s) => s.focus)
      : []
    return { scenes } as ChapterScenePlanResult
  },
  validate(result: AiTaskResult): boolean {
    return (result as ChapterScenePlanResult).scenes.length >= 2
  },
  resolveMaxTokens(): number {
    return 400
  }
}
export default handler
