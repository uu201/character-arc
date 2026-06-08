export type ChapterExecutionPacketWordCountRange = {
  min: number
  target: number
  max: number
  basis: string
}

export type ChapterExecutionMemoInput = {
  currentTask?: string
  readerExpectation?: string
  payoffs?: string[]
  holds?: string[]
  transitionFunctions?: string
  decisionChecks?: string[]
  endingChanges?: string[]
  doNotDo?: string[]
}

export type ChapterExecutionPacketInput = {
  chapterTitle?: string
  chapterSummary?: string
  targetWordCount: number
  currentOutlineItem?: {
    title?: string
    summary?: string
    conflict?: string
    wordTarget?: string
  } | null
  outlineChapterSplit?: {
    currentPart: number
    totalParts: number
    previousParts: Array<{
      title: string
      summary: string
      preview?: string
    }>
  } | null
  relatedChapters: Array<{
    title: string
    summary: string
    preview?: string
  }>
  recentEndingsTrail?: Array<{
    chapterTitle: string
    endingLine: string
  }>
  chapterMemo?: ChapterExecutionMemoInput | null
}

export type ChapterExecutionPacket = {
  chapterGoal: string
  targetEmotion: string
  openingHook: string
  endingHook: string
  sceneBeats: string[]
  mustInclude: string[]
  mustNotInclude: string[]
  continuityNotes: string[]
  minimalMemory: string[]
  qualityGates: string[]
  wordCountRange?: ChapterExecutionPacketWordCountRange
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function clipText(value: unknown, limit = 48): string {
  const text = cleanText(value)
  if (!text) return ''
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}...`
}

function takeFirstSentence(value: unknown, limit = 72): string {
  const text = cleanText(value)
  if (!text) return ''
  const sentence = text.split(/[。！？!?；;]\s*/).find(Boolean) ?? text
  return clipText(sentence, limit)
}

function firstNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    const text = cleanText(value)
    if (text) return text
  }
  return ''
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))]
}

function buildWordCountRange(targetWordCount: number): ChapterExecutionPacketWordCountRange | undefined {
  if (!Number.isFinite(targetWordCount) || targetWordCount <= 0) {
    return undefined
  }

  const target = Math.round(targetWordCount)
  const min = Math.max(200, Math.round(target * 0.8))
  const max = Math.max(min, Math.round(target * 1.2))

  return {
    min,
    target,
    max,
    basis: `基于本章目标字数 ${target} 字`
  }
}

function inferTargetEmotion(packet: ChapterExecutionPacketInput): string {
  const corpus = [
    packet.chapterMemo?.readerExpectation,
    packet.chapterMemo?.currentTask,
    packet.currentOutlineItem?.summary,
    packet.currentOutlineItem?.conflict,
    packet.chapterSummary,
    packet.chapterTitle,
    packet.relatedChapters.map((chapter) => chapter.summary).join(' '),
    packet.recentEndingsTrail?.map((entry) => entry.endingLine).join(' ') ?? ''
  ].join(' ')

  const rules: Array<{ patterns: RegExp[]; value: string }> = [
    { patterns: [/危机|追击|逼近|对峙|冲突|压迫|失控/, /紧张|焦灼|压迫感/], value: '紧张压迫、追读感强' },
    { patterns: [/悬念|谜|真相|揭示|发现|线索/, /未知|吊胃口/], value: '悬念推进、逐步揭示' },
    { patterns: [/温暖|安稳|松弛|轻松|日常|柔和/, /安心/], value: '克制温和、略带松弛' },
    { patterns: [/悲|失落|沉重|低落|告别/, /遗憾/], value: '低沉克制、保留余味' },
    { patterns: [/胜利|反击|逆转|爽|爆发|扭转/, /扬眉吐气/], value: '压住后释放、强调反击感' }
  ]

  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(corpus))) {
      return rule.value
    }
  }

  return '紧张推进、保持追读感'
}

function inferOpeningHook(packet: ChapterExecutionPacketInput): string {
  const anchor = firstNonEmpty(
    packet.currentOutlineItem?.conflict,
    packet.currentOutlineItem?.summary,
    packet.chapterSummary,
    packet.chapterTitle
  )

  return anchor
    ? `从“${clipText(anchor, 32)}”切入，尽快把冲突摆到台前。`
    : '直接从本章最有变化的动作或对话切入。'
}

function inferEndingHook(packet: ChapterExecutionPacketInput): string {
  const anchor = firstNonEmpty(
    packet.chapterMemo?.endingChanges?.[0],
    packet.currentOutlineItem?.summary,
    packet.chapterSummary,
    packet.recentEndingsTrail?.[packet.recentEndingsTrail.length - 1]?.endingLine
  )

  return anchor
    ? `把章末落到“${clipText(anchor, 32)}”这个变化上，并顺势抛出下一步。`
    : '章末留下明确的新问题或下一步行动。'
}

function buildSceneBeats(packet: ChapterExecutionPacketInput, openingHook: string, endingHook: string): string[] {
  const memo = packet.chapterMemo ?? {}
  const goalAnchor = firstNonEmpty(
    packet.currentOutlineItem?.title,
    packet.currentOutlineItem?.conflict,
    packet.currentOutlineItem?.summary,
    packet.chapterSummary,
    packet.chapterTitle
  )
  const beats = uniqueStrings([
    openingHook ? `开场：${takeFirstSentence(openingHook, 42)}` : '开场尽快进入本章变化',
    goalAnchor ? `推进：围绕${clipText(goalAnchor, 28)}展开` : '推进：围绕本章核心冲突展开',
    memo.decisionChecks?.[0] ? `决策：让关键选择经过${clipText(memo.decisionChecks[0], 28)}` : '',
    memo.payoffs?.[0] ? `兑现：${clipText(memo.payoffs[0], 32)}` : '兑现至少一项本章成果',
    memo.payoffs?.[1] ? `延展：继续兑现${clipText(memo.payoffs[1], 28)}` : '',
    endingHook ? `收束：${takeFirstSentence(endingHook, 42)}` : '收束到明确的追读钩子'
  ])

  return beats.slice(0, 6)
}

function buildMustInclude(packet: ChapterExecutionPacketInput): string[] {
  const memo = packet.chapterMemo ?? {}
  const relatedChapter = packet.recentEndingsTrail?.[packet.recentEndingsTrail.length - 1]
  return uniqueStrings([
    ...(memo.payoffs ?? []),
    ...(memo.decisionChecks ?? []),
    packet.currentOutlineItem?.title ? `落实大纲节点：${packet.currentOutlineItem.title}` : '',
    packet.currentOutlineItem?.conflict ? `处理核心冲突：${packet.currentOutlineItem.conflict}` : '',
    relatedChapter?.endingLine ? `承接上一章结尾：${relatedChapter.endingLine}` : ''
  ]).slice(0, 6)
}

function buildMustNotInclude(packet: ChapterExecutionPacketInput): string[] {
  const memo = packet.chapterMemo ?? {}
  const outlineSplit = packet.outlineChapterSplit
  return uniqueStrings([
    ...(memo.holds ?? []),
    ...(memo.doNotDo ?? []),
    packet.currentOutlineItem?.summary ? `不要偏离当前大纲摘要：${packet.currentOutlineItem.summary}` : '',
    outlineSplit?.previousParts?.length ? '不要重复同一大纲前置章节已经写过的内容' : ''
  ]).slice(0, 6)
}

function buildContinuityNotes(packet: ChapterExecutionPacketInput): string[] {
  const lastEnding = packet.recentEndingsTrail?.[packet.recentEndingsTrail.length - 1]
  const outlineSplit = packet.outlineChapterSplit
  const relatedChapter = packet.relatedChapters[packet.relatedChapters.length - 1]

  return uniqueStrings([
    lastEnding?.endingLine ? `承接上一章结尾：${lastEnding.endingLine}` : '',
    packet.currentOutlineItem?.title ? `围绕《${packet.currentOutlineItem.title}》推进，不要偏离当前节点。` : '',
    outlineSplit?.previousParts?.length
      ? `同一大纲前置部分已写 ${outlineSplit.previousParts.length} 段，本章只推进后续部分。`
      : '',
    relatedChapter?.title ? `参考最近相关章节《${relatedChapter.title}》的状态变化。` : ''
  ]).slice(0, 4)
}

function buildMinimalMemory(packet: ChapterExecutionPacketInput): string[] {
  const lastEnding = packet.recentEndingsTrail?.[packet.recentEndingsTrail.length - 1]
  const outline = firstNonEmpty(
    packet.currentOutlineItem?.title,
    packet.currentOutlineItem?.summary,
    packet.currentOutlineItem?.conflict
  )

  return uniqueStrings([
    packet.chapterTitle ? `章节：${packet.chapterTitle}` : '',
    packet.chapterSummary ? `摘要：${takeFirstSentence(packet.chapterSummary, 56)}` : '',
    outline ? `大纲：${takeFirstSentence(outline, 56)}` : '',
    lastEnding?.endingLine ? `上一章结尾：${takeFirstSentence(lastEnding.endingLine, 56)}` : '',
    packet.targetWordCount > 0 ? `目标字数：${Math.round(packet.targetWordCount)} 字` : ''
  ]).slice(0, 5)
}

function buildQualityGates(packet: ChapterExecutionPacketInput): string[] {
  const range = buildWordCountRange(packet.targetWordCount)
  return uniqueStrings([
    '开场尽快进入本章核心冲突',
    '至少兑现一条必须出现项',
    '章末留下明确的下一步或悬念',
    '不违背禁止项',
    range ? `字数落在 ${range.min}-${range.max} 字范围内` : ''
  ]).slice(0, 6)
}

export function buildChapterExecutionPacket(input: ChapterExecutionPacketInput): ChapterExecutionPacket {
  const chapterGoal = firstNonEmpty(
    input.chapterMemo?.currentTask,
    input.currentOutlineItem?.title && input.currentOutlineItem?.conflict
      ? `推进《${clipText(input.currentOutlineItem.title, 24)}》对应的核心冲突。`
      : '',
    input.currentOutlineItem?.summary
      ? `围绕当前大纲节点推进：${takeFirstSentence(input.currentOutlineItem.summary, 52)}`
      : '',
    input.chapterSummary
      ? '围绕本章摘要推进核心冲突并完成必要转折。'
      : '',
    '推进本章核心冲突并交付明确章末钩子。'
  )

  const targetEmotion = inferTargetEmotion(input)
  const openingHook = inferOpeningHook(input)
  const endingHook = inferEndingHook(input)
  const sceneBeats = buildSceneBeats(input, openingHook, endingHook)
  const mustInclude = buildMustInclude(input)
  const mustNotInclude = buildMustNotInclude(input)
  const continuityNotes = buildContinuityNotes(input)
  const minimalMemory = buildMinimalMemory(input)
  const qualityGates = buildQualityGates(input)
  const wordCountRange = buildWordCountRange(input.targetWordCount)

  return {
    chapterGoal,
    targetEmotion,
    openingHook,
    endingHook,
    sceneBeats,
    mustInclude,
    mustNotInclude,
    continuityNotes,
    minimalMemory,
    qualityGates,
    wordCountRange
  }
}
