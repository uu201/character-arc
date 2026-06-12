import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, ChapterMemoResult } from '../shared-types'
import {
  formatWorldviewEntries, formatCharacters,
  formatCharacterRelationships,
  formatCurrentOutlineItem, formatOutlineChapterSplit,
  formatOutlineItems, formatRelatedChapters,
  formatVolumeChapterSummaries, formatOpenPlotThreads
} from '../prompts/format-helpers'

const handler: TaskHandler = {
  name: 'chapter-memo',
  outputType: 'json',
  defaultCapabilities: ['settings', 'chapters', 'worldview', 'characters', 'relations', 'outline'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const targetWordCount = String(context.targetWordCount ?? context.chapterWordTarget ?? '').trim()

    return {
      system: `${capabilityPreamble.system}\n\n你是小说写作的章节备忘规划师。任务：严格基于"当前章节摘要"，输出本章的"写作备忘"——这是后续 Writer 写正文的硬指令，不是泛泛的写作建议。

【重要约束】
- 你只负责规划"当前章节"这一章的内容，不要规划后续章节的内容。
- "当前章节摘要"是本章的唯一剧情边界，所有规划必须围绕这个摘要展开。
- 分卷摘要仅供了解整体方向，不要把分卷中其他章节的剧情写进本章备忘。
- 如果当前章节是第一章（没有相邻章节参考），就按开篇来规划。

只返回 JSON 对象，不要返回 markdown 或解释。每个字段都要具体可落地：写"林秋发现父亲的旧账本"而不是"推进调查线"。

字段语义：
- currentTask：本章必须完成的具体动作，1 句话，必须以动词开头
- readerExpectation：读者此刻最在等什么（1 句话，控制本章情绪缺口的兑现节奏）
- payoffs：本章必须兑现的具体内容（数组，0-3 条，每条 1 句具体动作或揭示）
- holds：本章必须压住不掀的底牌（数组，0-3 条）
- transitionFunctions：非冲突段落各自承担什么功能（1-3 句）
- decisionChecks：本章关键人物选择必须过的检查问题（数组，2-3 条）
- endingChanges：章尾必须发生的具体改变（数组，1-3 条，类型必须是 信息变化/关系变化/物理变化/权力变化 之一）
- doNotDo：本章红线（数组，1-3 条具体禁忌，不要写"避免 AI 味"这种泛泛的）
- emotionArc：本章情绪轨迹（1 句话，格式"起点情绪→转折→终点情绪"，如"安逸→被突袭打碎→自我怀疑"）`,
      user: `${capabilityPreamble.user}\n\n请为以下章节生成写作备忘。\n\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n目标字数：${targetWordCount}\n\n当前绑定大纲：\n${formatCurrentOutlineItem(context.currentOutlineItem) || '暂无'}\n\n同一大纲拆章情况：\n${formatOutlineChapterSplit(context.outlineChapterSplit) || '未拆分或暂无前置同纲章节'}\n\n相邻章节参考：\n${formatRelatedChapters(context.relatedChapters) || '暂无'}\n\n本卷章节概览：\n${formatVolumeChapterSummaries(context.volumeChapterSummaries) || '暂无'}\n\n未收伏笔 / 活跃剧情线：\n${formatOpenPlotThreads(context.plotThreads) || '暂无'}\n\n相关世界观：\n${formatWorldviewEntries(context.worldviewEntries) || '暂无'}\n\n相关角色：\n${formatCharacters(context.characters) || '暂无'}\n\n角色关系：\n${formatCharacterRelationships(context.characterRelationships, context.characters) || '暂无'}\n\n相关大纲：\n${formatOutlineItems(context.outlineItems) || '暂无'}\n\n返回格式：{"memo":{"currentTask":"","readerExpectation":"","payoffs":[],"holds":[],"transitionFunctions":"","decisionChecks":[],"endingChanges":[],"doNotDo":[],"emotionArc":""}}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as { memo?: Partial<ChapterMemoResult['memo']> }
    const memoRaw = parsed.memo ?? {}
    const stringArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []
    return {
      memo: {
        currentTask: String(memoRaw.currentTask ?? '').trim(),
        readerExpectation: String(memoRaw.readerExpectation ?? '').trim(),
        payoffs: stringArray(memoRaw.payoffs),
        holds: stringArray(memoRaw.holds),
        transitionFunctions: String(memoRaw.transitionFunctions ?? '').trim(),
        decisionChecks: stringArray(memoRaw.decisionChecks),
        endingChanges: stringArray(memoRaw.endingChanges),
        doNotDo: stringArray(memoRaw.doNotDo),
        emotionArc: String((memoRaw as Record<string, unknown>).emotionArc ?? '').trim()
      }
    } as ChapterMemoResult
  },
  validate(result: AiTaskResult): boolean {
    const memo = (result as ChapterMemoResult).memo
    return Boolean(
      memo
      && memo.currentTask
      && memo.endingChanges.length > 0
    )
  },
  resolveMaxTokens(): number {
    return 1500
  }
}
export default handler
