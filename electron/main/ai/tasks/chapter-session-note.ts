import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult } from '../shared-types'

export type ChapterSessionNoteResult = {
  sessionNote: {
    craftDecisions: string
    effectiveReferences: string
    nextChapterAdvice: string
  }
}

const handler: TaskHandler = {
  name: 'chapter-session-note',
  outputType: 'json',
  defaultCapabilities: [],
  buildPrompt(input: PromptBuildInput) {
    const { context } = input
    return {
      system: `你是写作流程记录员。基于刚完成的章节生成过程，提取关键经验供下一章参考。只返回 JSON，不要解释。

字段语义：
- craftDecisions：本章使用了什么写作技法或节奏策略（1-2句，具体到"用了对白推进信息"或"用感官锚定切场景"级别）
- effectiveReferences：哪些参考资料/skill对本章帮助最大（如果有的话，写skill名或参考文件名；没有就写"无"）
- nextChapterAdvice：下一章需要注意什么（基于本章结尾状态，1-2句具体建议）`,
      user: `刚完成的章节信息：
章节标题：${String(context.chapterTitle ?? '')}
章节摘要：${String(context.chapterSummary ?? '')}
写作备忘中的情绪轨迹：${String(context.emotionArc ?? '未指定')}
章节结尾片段：${String(context.endingSnippet ?? '')}
审计结果：${String(context.auditSummary ?? '未审计')}

返回格式：{"sessionNote":{"craftDecisions":"","effectiveReferences":"","nextChapterAdvice":""}}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as { sessionNote?: Partial<ChapterSessionNoteResult['sessionNote']> }
    const note = parsed.sessionNote ?? {}
    return {
      sessionNote: {
        craftDecisions: String(note.craftDecisions ?? '').trim(),
        effectiveReferences: String(note.effectiveReferences ?? '').trim(),
        nextChapterAdvice: String(note.nextChapterAdvice ?? '').trim()
      }
    } as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    const note = (result as unknown as ChapterSessionNoteResult).sessionNote
    return Boolean(note?.craftDecisions || note?.nextChapterAdvice)
  },
  resolveMaxTokens(): number {
    return 500
  }
}
export default handler
