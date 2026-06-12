type ChapterExecutionPacketShape = {
  chapterGoal?: string
  targetEmotion?: string
  openingHook?: string
  endingHook?: string
  sceneBeats?: string[]
  mustInclude?: string[]
  mustNotInclude?: string[]
  continuityNotes?: string[]
  minimalMemory?: string[]
  qualityGates?: string[]
  wordCountRange?: {
    min?: number
    target?: number
    max?: number
    basis?: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => cleanText(item)).filter(Boolean).slice(0, 8)
}

function readNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined
}

function normalizePacket(source: unknown): ChapterExecutionPacketShape | null {
  if (!isRecord(source)) return null

  const rangeSource = isRecord(source.wordCountRange) ? source.wordCountRange : null
  const wordCountRange = rangeSource
    ? {
        min: readNumber(rangeSource.min),
        target: readNumber(rangeSource.target),
        max: readNumber(rangeSource.max),
        basis: cleanText(rangeSource.basis)
      }
    : undefined

  const packet: ChapterExecutionPacketShape = {
    chapterGoal: cleanText(source.chapterGoal),
    targetEmotion: cleanText(source.targetEmotion),
    openingHook: cleanText(source.openingHook),
    endingHook: cleanText(source.endingHook),
    sceneBeats: readStringList(source.sceneBeats),
    mustInclude: readStringList(source.mustInclude),
    mustNotInclude: readStringList(source.mustNotInclude),
    continuityNotes: readStringList(source.continuityNotes),
    minimalMemory: readStringList(source.minimalMemory),
    qualityGates: readStringList(source.qualityGates),
    wordCountRange
  }

  if (
    !packet.chapterGoal
    && !packet.targetEmotion
    && !packet.openingHook
    && !packet.endingHook
    && packet.sceneBeats?.length === 0
    && packet.mustInclude?.length === 0
    && packet.mustNotInclude?.length === 0
    && packet.continuityNotes?.length === 0
    && packet.minimalMemory?.length === 0
    && packet.qualityGates?.length === 0
  ) {
    return null
  }

  return packet
}

function formatList(title: string, values: string[] | undefined): string {
  if (!values || values.length === 0) {
    return `${title}：暂无`
  }
  return [`${title}：`, ...values.map((value) => `  - ${value}`)].join('\n')
}

export function formatChapterExecutionPacket(packetSource: unknown): string {
  const packet = normalizePacket(packetSource)
  if (!packet) return ''

  const range = packet.wordCountRange
  const wordCountLine = range?.min && range.target && range.max
    ? `字数范围：${range.min}-${range.max} 字，目标 ${range.target} 字${range.basis ? `（${range.basis}）` : ''}`
    : ''

  return [
    '== 章节执行包（共享硬约束，优先于普通参考信息） ==',
    `chapterGoal：${packet.chapterGoal || '未指定'}`,
    `targetEmotion：${packet.targetEmotion || '未指定'}`,
    `openingHook：${packet.openingHook || '未指定'}`,
    `endingHook：${packet.endingHook || '未指定'}`,
    wordCountLine,
    formatList('sceneBeats', packet.sceneBeats),
    formatList('mustInclude', packet.mustInclude),
    formatList('mustNotInclude', packet.mustNotInclude),
    formatList('continuityNotes', packet.continuityNotes),
    formatList('minimalMemory', packet.minimalMemory),
    formatList('qualityGates', packet.qualityGates)
  ].filter(Boolean).join('\n')
}
