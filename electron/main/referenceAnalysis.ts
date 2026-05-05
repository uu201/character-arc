import { basename, extname } from 'node:path'
import { readFile } from 'node:fs/promises'

export type ReferenceFileType = 'txt' | 'md' | 'docx'

export type ReferenceStyleMetric = {
  label: string
  value: string
}

export type ReferenceNovelChunk = {
  id: string
  label: string
  order: number
  text: string
  characterCount: number
  topKeywords: string[]
  metrics: ReferenceStyleMetric[]
}

export type ReferenceNovelLocalContext = {
  title: string
  fileName: string
  fileType: ReferenceFileType
  excerpt: string
  analysisSample: string
  characterCount: number
  chapterCount: number
  topKeywords: string[]
  metrics: ReferenceStyleMetric[]
  analysisChunks: ReferenceNovelChunk[]
}

type JiebaRuntime = {
  jieba: {
    cut(text: string, hmm?: boolean): string[]
  }
  tfidf: {
    extractKeywords(
      jieba: { cut(text: string, hmm?: boolean): string[] },
      text: string,
      limit: number
    ): Array<{ keyword: string }>
  }
}

let jiebaRuntimePromise: Promise<JiebaRuntime> | null = null
const CHAPTER_HEADING_RE = /^(第[0-9零一二三四五六七八九十百千万两]+[章节回卷部集][^\n]{0,40})$/gm
const MAX_ANALYSIS_CHUNKS = 12
const MAX_CHUNK_CHAR_COUNT = 6_000
const CHUNK_KEYWORD_LIMIT = 8
const STOP_WORDS = new Set([
  '一个',
  '一种',
  '一些',
  '没有',
  '他们',
  '自己',
  '这个',
  '那个',
  '这里',
  '那里',
  '我们',
  '你们',
  '不是',
  '然后',
  '已经',
  '可以',
  '因为',
  '所以',
  '而且',
  '只是',
  '还是',
  '如果',
  '但是',
  '开始',
  '时候',
  '东西',
  '什么',
  '怎么',
  '一个人',
  '一下',
  '出来',
  '进去',
  '之后',
  '之前',
  '起来',
  '下来',
  '现在',
  '真的',
  '有些',
  '这种',
  '那种'
])

async function getJiebaRuntime(): Promise<JiebaRuntime> {
  if (!jiebaRuntimePromise) {
    jiebaRuntimePromise = (async () => {
      const [{ Jieba, TfIdf }, { dict, idf }] = await Promise.all([
        import('@node-rs/jieba'),
        import('@node-rs/jieba/dict.js')
      ])

      return {
        jieba: Jieba.withDict(dict),
        tfidf: TfIdf.withDict(idf)
      }
    })()
  }

  return jiebaRuntimePromise
}

function resolveFileType(filePath: string): ReferenceFileType {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.docx') {
    return 'docx'
  }

  if (extension === '.md' || extension === '.markdown') {
    return 'md'
  }

  return 'txt'
}

function normalizeNovelText(rawText: string): string {
  return rawText
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readNovelText(filePath: string, fileType: ReferenceFileType): Promise<string> {
  if (fileType === 'docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ path: filePath })
    return normalizeNovelText(result.value)
  }

  const buffer = await readFile(filePath)
  return normalizeNovelText(buffer.toString('utf-8'))
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function splitChapters(text: string): string[] {
  const matches = Array.from(text.matchAll(CHAPTER_HEADING_RE))
  if (matches.length >= 3) {
    return matches
      .map((match, index) => {
        const start = match.index ?? 0
        const end = matches[index + 1]?.index ?? text.length
        return text.slice(start, end).trim()
      })
      .filter(Boolean)
  }

  const paragraphs = splitParagraphs(text)
  if (paragraphs.length === 0) {
    return []
  }

  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length > 2600 && current.trim()) {
      chunks.push(current.trim())
      current = paragraph
      continue
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks
}

function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trim()}……`
}

function buildAnalysisSample(chapters: string[], text: string): string {
  const sourceSections = chapters.length >= 3
    ? [chapters[0], chapters[Math.floor(chapters.length / 2)], chapters[chapters.length - 1]]
    : [
        text.slice(0, 2200),
        text.slice(Math.max(0, Math.floor(text.length / 2) - 1100), Math.max(0, Math.floor(text.length / 2) - 1100) + 2200),
        text.slice(Math.max(0, text.length - 2200))
      ]

  return sourceSections
    .map((section, index) => {
      const label = index === 0 ? '开篇样本' : index === 1 ? '中段样本' : '后段样本'
      return `【${label}】\n${clipText(section.trim(), 2200)}`
    })
    .join('\n\n')
}

function computeMetrics(text: string, chapters: string[]): ReferenceStyleMetric[] {
  const plainText = text.replace(/\s+/g, '')
  const characterCount = plainText.length
  const paragraphs = splitParagraphs(text)
  const sentences = text
    .split(/[。！？!?；;]+/)
    .map((sentence) => sentence.replace(/\s+/g, '').trim())
    .filter(Boolean)
  const dialogueParagraphCount = paragraphs.filter((paragraph) => /[“”「」『』"']/u.test(paragraph)).length
  const shortSentenceCount = sentences.filter((sentence) => sentence.length <= 18).length
  const emotionMarkCount = (text.match(/[!?！？]/g) ?? []).length
  const avgSentenceLength = sentences.length ? plainText.length / sentences.length : 0
  const dialogueParagraphRatio = paragraphs.length ? dialogueParagraphCount / paragraphs.length : 0
  const shortSentenceRatio = sentences.length ? shortSentenceCount / sentences.length : 0
  const emotionMarksPerThousand = characterCount ? (emotionMarkCount / characterCount) * 1000 : 0

  return [
    { label: '总字数', value: `${characterCount.toLocaleString('zh-CN')} 字` },
    { label: '章节估计', value: `${Math.max(chapters.length, 1)} 段/章` },
    { label: '平均句长', value: `${avgSentenceLength.toFixed(1)} 字/句` },
    { label: '对白段落占比', value: `${(dialogueParagraphRatio * 100).toFixed(0)}%` },
    { label: '短句比例', value: `${(shortSentenceRatio * 100).toFixed(0)}%` },
    { label: '情绪标点密度', value: `每千字 ${emotionMarksPerThousand.toFixed(1)} 个` }
  ]
}

async function extractKeywords(text: string, limit = 10): Promise<string[]> {
  const { jieba, tfidf } = await getJiebaRuntime()
  const keywords = tfidf.extractKeywords(jieba, clipText(text, 36_000), Math.max(limit * 2, 18))
  return keywords
    .map((entry) => entry.keyword.trim())
    .filter((keyword) => keyword.length >= 2 && !STOP_WORDS.has(keyword))
    .slice(0, limit)
}

function mergeSectionsIntoChunks(sections: string[]): string[] {
  if (sections.length === 0) {
    return []
  }

  const merged: string[] = []
  let current = ''

  for (const section of sections) {
    if (section.length > MAX_CHUNK_CHAR_COUNT) {
      if (current.trim()) {
        merged.push(current.trim())
        current = ''
      }

      for (let index = 0; index < section.length; index += MAX_CHUNK_CHAR_COUNT) {
        const slice = section.slice(index, index + MAX_CHUNK_CHAR_COUNT).trim()
        if (slice) {
          merged.push(slice)
        }
      }
      continue
    }

    const candidate = current ? `${current}\n\n${section}` : section
    if (candidate.length > MAX_CHUNK_CHAR_COUNT && current.trim()) {
      merged.push(current.trim())
      current = section
      continue
    }

    current = candidate
  }

  if (current.trim()) {
    merged.push(current.trim())
  }

  return merged
}

function pickRepresentativeChunkIndexes(total: number): number[] {
  if (total <= MAX_ANALYSIS_CHUNKS) {
    return Array.from({ length: total }, (_, index) => index)
  }

  const indexes = new Set<number>([0, total - 1, Math.floor(total / 2)])
  const step = (total - 1) / (MAX_ANALYSIS_CHUNKS - 1)

  for (let index = 0; index < MAX_ANALYSIS_CHUNKS; index += 1) {
    indexes.add(Math.round(index * step))
  }

  return Array.from(indexes)
    .sort((left, right) => left - right)
    .slice(0, MAX_ANALYSIS_CHUNKS)
}

function buildChunkLabel(index: number, total: number): string {
  if (index === 0) {
    return '开篇段'
  }

  if (index === total - 1) {
    return '收束段'
  }

  const ratio = total <= 1 ? 0 : index / (total - 1)
  if (ratio < 0.34) {
    return '前段'
  }

  if (ratio > 0.66) {
    return '后段'
  }

  return '中段'
}

async function buildAnalysisChunks(chapters: string[]): Promise<ReferenceNovelChunk[]> {
  const mergedChunks = mergeSectionsIntoChunks(chapters)
  const selectedIndexes = pickRepresentativeChunkIndexes(mergedChunks.length)

  return Promise.all(selectedIndexes.map(async (chunkIndex, order) => {
    const text = mergedChunks[chunkIndex]
    const plainText = text.replace(/\s+/g, '')
    const label = `${buildChunkLabel(chunkIndex, mergedChunks.length)} ${chunkIndex + 1}/${mergedChunks.length}`
    return {
      id: `chunk-${chunkIndex + 1}`,
      label,
      order,
      text,
      characterCount: plainText.length,
      topKeywords: await extractKeywords(text, CHUNK_KEYWORD_LIMIT),
      metrics: computeMetrics(text, [text])
    }
  }))
}

export async function extractReferenceNovelContext(filePath: string): Promise<ReferenceNovelLocalContext> {
  const fileType = resolveFileType(filePath)
  const fileName = basename(filePath)
  const title = basename(filePath, extname(filePath)).trim() || '未命名参考作品'
  const text = await readNovelText(filePath, fileType)

  if (!text.trim()) {
    throw new Error('导入的文件没有可用正文，请确认文件内容不是空白。')
  }

  const chapters = splitChapters(text)
  const excerpt = clipText(chapters[0] ?? text, 800)
  const [topKeywords, analysisChunks] = await Promise.all([
    extractKeywords(text),
    buildAnalysisChunks(chapters)
  ])

  return {
    title,
    fileName,
    fileType,
    excerpt,
    analysisSample: buildAnalysisSample(chapters, text),
    characterCount: text.replace(/\s+/g, '').length,
    chapterCount: Math.max(chapters.length, 1),
    topKeywords,
    metrics: computeMetrics(text, chapters),
    analysisChunks
  }
}
