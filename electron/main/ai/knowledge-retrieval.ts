/**
 * 统一的知识检索模块。
 *
 * 合并了旧版两套检索：
 * - 关键词检索（原 electron/main/knowledge-retrieval.ts）：用于给 prompt 注入 `usedKnowledge`（参考拆书总纲、canon-fact、章节摘要等）。
 * - 混合检索（原 electron/main/ai/knowledge-retrieval-v2.ts）：状态块 + 向量语义检索，用于给 chapter-first-draft/chapter-assistant 等任务注入结构化世界状态和相关章节片段。
 *
 * 向量检索在 embedding 不可用时自动退化为仅状态块注入，不抛错。
 */

import type { DatabaseSync } from 'node:sqlite'
import type { AiTaskPayload, AppSettings } from './shared-types'
import { buildStoryStateContext, formatStoryStateForPrompt } from '../story-state-store'
import { embedText, cosineSimilarity, embedTexts, providerSupportsEmbedding } from './embedding-service'
import { ensureWorkspaceDb } from '../workspace-store'

// ─────────────────────────────────────────────────────────────
// 关键词检索（usedKnowledge）
// ─────────────────────────────────────────────────────────────

/** 知识文档来源类型 */
type KnowledgeDocumentSourceType = 'reference-summary' | 'reference-chunk' | 'workflow-document' | 'canon-fact' | 'chapter-summary'

/** 工作区知识文档在 SQLite 中的完整结构 */
type WorkspaceKnowledgeDocument = {
  id: string
  projectId: string
  title: string
  sourceType: KnowledgeDocumentSourceType
  sourceLabel: string
  content: string
  summary: string
  keywords: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * 检索后注入 prompt 的知识条目（精简字段，不含全文）。
 */
export type WorkspaceAiRunKnowledgeItem = {
  documentId: string
  title: string
  sourceType: KnowledgeDocumentSourceType
  sourceLabel: string
  /** 摘要片段，长度受 buildKnowledgeSnippet 控制 */
  snippet: string
  keywords: string[]
}

/** 将文本分词，过滤掉短于 2 字符的 token，用于关键词匹配。 */
function tokenizeKnowledgeText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

/** 从任务上下文中提取所有可能的关键词，拼接为检索查询文本。 */
function buildKnowledgeQuery(task: AiTaskPayload): string {
  return [
    String(task.context.userPrompt ?? ''),
    String(task.context.quickAction ?? ''),
    String(task.context.projectTitle ?? ''),
    String(task.context.projectGenre ?? ''),
    String(task.context.chapterVolumeTitle ?? ''),
    String(task.context.chapterVolumeSummary ?? ''),
    String(task.context.chapterTitle ?? ''),
    String(task.context.chapterSummary ?? ''),
    String(task.context.selectedText ?? ''),
    String(task.context.sceneFocus ?? ''),
    String(task.context.chapterContent ?? '').slice(0, 1200)
  ].filter(Boolean).join('\n')
}

/** 判断知识来源是否属于项目内文档（工作流文档、设定事实、章节摘要）。 */
function isProjectKnowledgeSource(sourceType: KnowledgeDocumentSourceType): boolean {
  return sourceType === 'workflow-document' || sourceType === 'canon-fact' || sourceType === 'chapter-summary'
}

/** 根据知识来源类型返回基础相关性分数，设定事实优先级最高。 */
function resolveKnowledgeSourceBaseScore(sourceType: KnowledgeDocumentSourceType): number {
  switch (sourceType) {
    case 'canon-fact': return 3.4
    case 'chapter-summary': return 2.8
    case 'workflow-document': return 2.4
    case 'reference-summary': return 1.4
    case 'reference-chunk':
    default: return 1
  }
}

/** 需要知识检索注入的 AI 任务白名单 */
const KNOWLEDGE_RETRIEVAL_TASKS: ReadonlySet<string> = new Set([
  'global-assistant',
  'global-assistant-proposal',
  'chapter-assistant',
  'chapter-first-draft',
  'assistant-action-proposal',
  'outline-batch',
  'outline-chain',
  'outline-item',
  'inspiration-pack',
  'chapter-analysis',
  'chapter-scene-plan',
  'project-bootstrap'
])

/** 根据文档类型截取不同长度的摘要片段。参考文献类允许更长，项目内文档较短。 */
function buildKnowledgeSnippet(document: WorkspaceKnowledgeDocument): string {
  const sourceType = document.sourceType
  if (sourceType === 'reference-summary') {
    const text = (document.content || document.summary || '').trim()
    return text.length > 2400 ? `${text.slice(0, 2400)}…` : text
  }
  if (sourceType === 'reference-chunk') {
    const text = (document.content || document.summary || '').trim()
    return text.length > 1400 ? `${text.slice(0, 1400)}…` : text
  }
  const text = (document.summary || document.content || '').trim()
  return text.length > 320 ? `${text.slice(0, 320)}…` : text
}

/**
 * 基于关键词匹配的知识检索：从工作区快照中筛选与当前任务最相关的知识文档。
 * 最多返回 5 条，优先项目内文档。
 *
 * @param task - AI 任务 payload
 * @param latestWorkspaceSnapshot - 最新工作区快照
 * @returns 匹配的知识条目列表
 */
export function retrieveKnowledgeContext(
  task: AiTaskPayload,
  latestWorkspaceSnapshot: { knowledgeDocuments?: WorkspaceKnowledgeDocument[] } | null
): { usedKnowledge: WorkspaceAiRunKnowledgeItem[] } {
  if (!KNOWLEDGE_RETRIEVAL_TASKS.has(task.task)) {
    return { usedKnowledge: [] }
  }

  const projectId = String(task.context.projectId ?? '').trim()
  if (!projectId || !latestWorkspaceSnapshot) {
    return { usedKnowledge: [] }
  }

  // 知识文档（含跨项目拆书库）统一存放在快照顶层，而非 workspaces[projectId] 下。
  const allDocuments = Array.isArray(latestWorkspaceSnapshot.knowledgeDocuments) ? latestWorkspaceSnapshot.knowledgeDocuments : []
  // 排除拆书库文档（reference-summary / reference-chunk）——这些只在用户显式选择参考书时注入
  const documents = allDocuments.filter((d) => d.sourceType !== 'reference-summary' && d.sourceType !== 'reference-chunk')
  if (!documents.length) {
    return { usedKnowledge: [] }
  }

  const queryText = buildKnowledgeQuery(task)
  const queryTokens = Array.from(new Set(tokenizeKnowledgeText(queryText)))
  if (!queryTokens.length) {
    return { usedKnowledge: [] }
  }

  const ranked = documents
    .map((document) => {
      const title = String(document.title ?? '').toLowerCase()
      const summary = String(document.summary ?? '').toLowerCase()
      const sourceLabel = String(document.sourceLabel ?? '').toLowerCase()
      const keywords = Array.isArray(document.keywords) ? document.keywords.map((k) => String(k).trim()).filter(Boolean) : []
      const lowerKeywords = keywords.map((k) => k.toLowerCase())
      const keywordSet = new Set(lowerKeywords)

      const contentText = String(document.content ?? '').toLowerCase()
      const wordSet = new Set(tokenizeKnowledgeText(`${title} ${summary} ${contentText} ${sourceLabel}`))

      let score = resolveKnowledgeSourceBaseScore(document.sourceType)

      for (const token of queryTokens) {
        if (keywordSet.has(token)) score += 4
        else if (lowerKeywords.some((k) => k.includes(token) || token.includes(k))) score += 2.5
        if (title.includes(token)) score += 2
        if (sourceLabel.includes(token)) score += 1.5
        if (summary.includes(token)) score += 1.2
        if (wordSet.has(token)) score += 0.6
      }

      return { score, document, keywords, projectSource: isProjectKnowledgeSource(document.sourceType) }
    })
    .filter((entry) => entry.score > 2)
    .sort((a, b) => b.score - a.score)

  const selectedIds = new Set<string>()
  const selected = [
    ...ranked.filter((e) => e.projectSource).slice(0, 3),
    ...ranked.filter((e) => !e.projectSource).slice(0, 2)
  ].filter((e) => { if (selectedIds.has(e.document.id)) return false; selectedIds.add(e.document.id); return true })

  for (const entry of ranked) {
    if (selected.length >= 5) break
    if (selectedIds.has(entry.document.id)) continue
    selected.push(entry)
    selectedIds.add(entry.document.id)
  }

  return {
    usedKnowledge: selected
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ document, keywords }) => ({
        documentId: document.id,
        title: document.title,
        sourceType: document.sourceType,
        sourceLabel: document.sourceLabel,
        snippet: buildKnowledgeSnippet(document),
        keywords: keywords.slice(0, 8)
      }))
  }
}

// ─────────────────────────────────────────────────────────────
// 混合检索（state block + 语义段）
// ─────────────────────────────────────────────────────────────

/**
 * 混合检索结果：结构化故事状态块 + 向量语义检索的相似片段。
 */
export interface HybridRetrievalResult {
  /** 格式化后的故事状态上下文文本（角色状态、关系、伏笔等） */
  storyStateBlock: string
  /** 语义检索命中的片段，按相似度降序 */
  semanticSegments: Array<{ text: string; score: number; sourceType: string; chapterIndex?: number }>
}

type SemanticQueryPlan = {
  queries: string[]
  anchorTokens: string[]
  currentChapterId?: string
  currentChapterIndex?: number
}

type SemanticCandidate = {
  text: string
  score: number
  sourceType: string
  sourceId: string
  chapterIndex?: number
  embedding: Float32Array
  semanticScore: number
  lexicalOverlap: number
}

/** 语义检索最终返回的最大片段数 */
const SEMANTIC_TOP_K = 6
/** 候选池至少需要扫这么多 embedding，避免小样本误召回 */
const SEMANTIC_MIN_FETCH_LIMIT = 600
/** 候选池硬上限，避免超大项目一次读入过多向量 */
const SEMANTIC_MAX_FETCH_LIMIT = 3000
/** 进入重排前的候选池大小 */
const SEMANTIC_RERANK_POOL_SIZE = 28
/** 语义检索最低相似度地板 */
const SEMANTIC_MIN_SCORE_FLOOR = 0.42
/** 同一 source 最多保留 2 段，避免同章刷屏 */
const SEMANTIC_MAX_SEGMENTS_PER_SOURCE = 2
/** 同一章节最多保留 2 段，避免相邻片段挤占上下文 */
const SEMANTIC_MAX_SEGMENTS_PER_CHAPTER = 2
/** 多样性重排时相关性权重 */
const SEMANTIC_MMR_LAMBDA = 0.78
/** 需要混合检索（状态块 + 语义）的任务白名单 */
const HYBRID_RETRIEVAL_TASKS = new Set([
  'chapter-first-draft',
  'chapter-assistant',
  'chapter-analysis',
  'chapter-scene-plan'
])

/**
 * 混合检索：注入结构化故事状态 + 向量语义检索相关片段。
 * embedding 不可用时静默退化为仅返回状态块。
 *
 * @param task - AI 任务 payload
 * @param settings - AI 设置（用于 embedding 调用）
 * @returns 混合检索结果，不适用的任务返回 null
 */
export async function retrieveHybridContext(
  task: AiTaskPayload,
  settings: AppSettings
): Promise<HybridRetrievalResult | null> {
  if (!HYBRID_RETRIEVAL_TASKS.has(task.task)) return null

  const projectId = String(task.context.projectId ?? '').trim()
  if (!projectId) return null

  let db: DatabaseSync
  try {
    db = await ensureWorkspaceDb()
  } catch {
    return null
  }

  const involvedCharIds = extractCharacterIds(task.context)
  const storyState = buildStoryStateContext(db, projectId, involvedCharIds)
  const storyStateBlock = formatStoryStateForPrompt(storyState)

  let semanticSegments: HybridRetrievalResult['semanticSegments'] = []
  try {
    semanticSegments = await retrieveSemanticSegments(db, projectId, task, settings)
  } catch {
    // embedding 不可用时静默退化为仅返回 state block
  }

  return { storyStateBlock, semanticSegments }
}

/** 从 story_embeddings 表中做向量语义检索，返回最相关的片段。 */
async function retrieveSemanticSegments(
  db: DatabaseSync,
  projectId: string,
  task: AiTaskPayload,
  settings: AppSettings
): Promise<HybridRetrievalResult['semanticSegments']> {
  if (!providerSupportsEmbedding(settings)) return []

  const queryPlan = buildSemanticQueryPlan(task.context)
  if (!queryPlan.queries.length) return []

  const hasEmbeddings = db.prepare(
    `SELECT COUNT(*) as cnt FROM story_embeddings WHERE project_id = ?`
  ).get(projectId) as { cnt: number } | undefined

  if (!hasEmbeddings?.cnt) return []

  const queryEmbeddings = await embedTexts(settings, queryPlan.queries)
  if (!queryEmbeddings.length) return []
  const fetchLimit = resolveSemanticFetchLimit(hasEmbeddings.cnt)

  const rows = (queryPlan.currentChapterIndex != null
    ? db.prepare(`
        SELECT id, source_type, source_id, chapter_index, text_content, embedding
        FROM story_embeddings
        WHERE project_id = ?
        ORDER BY CASE
          WHEN chapter_index IS NULL THEN 999999
          ELSE ABS(chapter_index - ?)
        END ASC, created_at DESC
        LIMIT ?
      `).all(projectId, queryPlan.currentChapterIndex, fetchLimit)
    : db.prepare(`
        SELECT id, source_type, source_id, chapter_index, text_content, embedding
        FROM story_embeddings
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(projectId, fetchLimit)) as Array<{
    id: string
    source_type: string
    source_id: string
    chapter_index: number | null
    text_content: string
    embedding: Buffer
  }>

  const scored = rows
    .filter((row) => row.source_type !== 'chapter_segment' || row.source_id !== queryPlan.currentChapterId)
    .map((row) => {
      const storedVec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
      const semanticScore = queryEmbeddings.reduce((best, queryEmbedding) => (
        Math.max(best, cosineSimilarity(queryEmbedding, storedVec))
      ), -1)
      const lexicalOverlap = computeSemanticLexicalOverlap(row.text_content, queryPlan.anchorTokens)
      const score = semanticScore
        + computeChapterDistanceBoost(row.chapter_index, queryPlan.currentChapterIndex)
        + (row.source_type === 'chapter_segment' ? 0.03 : 0)
        + (lexicalOverlap * 0.14)
      return {
        text: row.text_content,
        score,
        semanticScore,
        lexicalOverlap,
        sourceType: row.source_type,
        sourceId: row.source_id,
        chapterIndex: row.chapter_index ?? undefined,
        embedding: storedVec
      }
    })
    .sort((a, b) => b.score - a.score)
  const filtered = filterSemanticCandidates(scored)
  const reranked = rerankSemanticCandidates(filtered)

  return reranked.map(({ text, score, sourceType, chapterIndex }) => ({
    text,
    score,
    sourceType,
    chapterIndex
  }))
}

function resolveSemanticFetchLimit(totalRows: number): number {
  if (totalRows <= SEMANTIC_MIN_FETCH_LIMIT) {
    return totalRows
  }

  const eightyPercent = Math.ceil(totalRows * 0.8)
  return Math.min(Math.max(eightyPercent, SEMANTIC_MIN_FETCH_LIMIT), SEMANTIC_MAX_FETCH_LIMIT)
}

function normalizeSemanticSnippet(value: unknown, maxChars = 240): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

function collectNamedItems(items: unknown, key: string, limit: number): string[] {
  if (!Array.isArray(items)) {
    return []
  }

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      return normalizeSemanticSnippet((item as Record<string, unknown>)[key], 80)
    })
    .filter(Boolean)
    .slice(0, limit)
}

/** 从任务上下文中构建更强的语义查询计划（主查询 + 实体查询 + 正文片段查询）。 */
function buildSemanticQueryPlan(context: Record<string, unknown>): SemanticQueryPlan {
  const rawChapterIndex = context.chapterIndex ?? context.chapterSortOrder
  const chapterTitle = normalizeSemanticSnippet(context.chapterTitle, 120)
  const chapterSummary = normalizeSemanticSnippet(context.chapterSummary, 280)
  const userPrompt = normalizeSemanticSnippet(context.userPrompt, 220)
  const selectedText = normalizeSemanticSnippet(context.selectedText, 220)
  const sceneFocus = normalizeSemanticSnippet(context.sceneFocus, 120)
  const volumeSummary = normalizeSemanticSnippet(context.chapterVolumeSummary, 200)
  const chapterContent = normalizeSemanticSnippet(context.chapterContent, 360)
  const characterNames = collectNamedItems(context.characters, 'name', 6)
  const plotThreadTitles = collectNamedItems(context.plotThreads, 'title', 4)
  const outlineTitles = collectNamedItems(context.outlineItems, 'title', 4)

  const primaryQuery = [
    chapterTitle && `章节标题：${chapterTitle}`,
    chapterSummary && `章节目标：${chapterSummary}`,
    userPrompt && `用户要求：${userPrompt}`,
    sceneFocus && `场景焦点：${sceneFocus}`,
    volumeSummary && `分卷摘要：${volumeSummary}`
  ].filter(Boolean).join('\n')

  const entityQuery = [
    characterNames.length ? `关键角色：${characterNames.join('、')}` : '',
    plotThreadTitles.length ? `活跃线索：${plotThreadTitles.join('、')}` : '',
    outlineTitles.length ? `相关大纲：${outlineTitles.join('、')}` : ''
  ].filter(Boolean).join('\n')

  const excerptQuery = [
    selectedText && `选中文本：${selectedText}`,
    chapterContent && `当前正文片段：${chapterContent}`
  ].filter(Boolean).join('\n')

  const queries = [primaryQuery, entityQuery, excerptQuery]
    .map((query) => query.trim())
    .filter((query) => query.length >= 12)

  const anchorTokens = Array.from(new Set(tokenizeKnowledgeText([
    chapterTitle,
    chapterSummary,
    userPrompt,
    sceneFocus,
    selectedText,
    ...characterNames,
    ...plotThreadTitles,
    ...outlineTitles
  ].filter(Boolean).join(' ')))).slice(0, 24)

  return {
    queries,
    anchorTokens,
    currentChapterId: String(context.chapterId ?? '').trim() || undefined,
    currentChapterIndex: rawChapterIndex !== undefined && rawChapterIndex !== null && String(rawChapterIndex).trim() !== ''
      && Number.isFinite(Number(rawChapterIndex))
      ? Number(rawChapterIndex)
      : undefined
  }
}

function computeSemanticLexicalOverlap(text: string, anchorTokens: string[]): number {
  if (!text || !anchorTokens.length) {
    return 0
  }

  const normalizedText = text.toLowerCase()
  let hitCount = 0
  for (const token of anchorTokens) {
    if (normalizedText.includes(token)) {
      hitCount += 1
    }
  }

  return hitCount / Math.min(anchorTokens.length, 12)
}

function computeChapterDistanceBoost(chapterIndex: number | null, currentChapterIndex?: number): number {
  if (!Number.isFinite(currentChapterIndex) || !Number.isFinite(chapterIndex)) {
    return 0
  }

  const normalizedChapterIndex = chapterIndex as number
  const normalizedCurrentChapterIndex = currentChapterIndex as number
  const distance = Math.abs(normalizedChapterIndex - normalizedCurrentChapterIndex)
  if (distance <= 1) return 0.06
  if (distance <= 3) return 0.03
  if (distance <= 6) return 0.01
  return 0
}

function filterSemanticCandidates(candidates: SemanticCandidate[]): SemanticCandidate[] {
  if (!candidates.length) {
    return []
  }

  const topSemanticScore = candidates.reduce((maxScore, candidate) => (
    Math.max(maxScore, candidate.semanticScore)
  ), -1)
  const adaptiveFloor = Math.max(
    SEMANTIC_MIN_SCORE_FLOOR,
    Math.min(0.76, topSemanticScore - 0.16)
  )

  return candidates
    .filter((candidate) => (
      candidate.semanticScore >= adaptiveFloor
      || (candidate.semanticScore >= adaptiveFloor - 0.08 && candidate.lexicalOverlap >= 0.25)
    ))
    .slice(0, SEMANTIC_RERANK_POOL_SIZE)
}

function rerankSemanticCandidates(candidates: SemanticCandidate[]): SemanticCandidate[] {
  if (!candidates.length) {
    return []
  }

  const selected: SemanticCandidate[] = []
  const remaining = [...candidates]
  const sourceCounts = new Map<string, number>()
  const chapterCounts = new Map<number, number>()

  while (remaining.length && selected.length < SEMANTIC_TOP_K) {
    let bestIndex = -1
    let bestScore = -Infinity

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]
      const sourceCount = sourceCounts.get(candidate.sourceId) ?? 0
      if (sourceCount >= SEMANTIC_MAX_SEGMENTS_PER_SOURCE) {
        continue
      }

      if (candidate.chapterIndex != null) {
        const chapterCount = chapterCounts.get(candidate.chapterIndex) ?? 0
        if (chapterCount >= SEMANTIC_MAX_SEGMENTS_PER_CHAPTER) {
          continue
        }
      }

      const redundancyPenalty = selected.reduce((maxPenalty, entry) => (
        Math.max(maxPenalty, cosineSimilarity(candidate.embedding, entry.embedding))
      ), 0)

      const mmrScore = selected.length === 0
        ? candidate.score
        : (candidate.score * SEMANTIC_MMR_LAMBDA) - (redundancyPenalty * (1 - SEMANTIC_MMR_LAMBDA))

      if (mmrScore > bestScore) {
        bestScore = mmrScore
        bestIndex = index
      }
    }

    if (bestIndex < 0) {
      break
    }

    const [picked] = remaining.splice(bestIndex, 1)
    selected.push(picked)
    sourceCounts.set(picked.sourceId, (sourceCounts.get(picked.sourceId) ?? 0) + 1)
    if (picked.chapterIndex != null) {
      chapterCounts.set(picked.chapterIndex, (chapterCounts.get(picked.chapterIndex) ?? 0) + 1)
    }
  }

  return selected
}

/** 从任务上下文中提取参与角色的 id 列表，用于构建角色相关的故事状态。 */
function extractCharacterIds(context: Record<string, unknown>): string[] {
  const characters = context.characters
  if (!Array.isArray(characters)) return []
  return characters
    .filter((c) => c && typeof c === 'object' && 'id' in c)
    .map((c) => String((c as { id: string }).id))
}

/**
 * 将语义检索结果格式化为可注入 prompt 的文本块。
 *
 * @param segments - 语义检索片段列表
 * @returns 格式化后的 Markdown 文本，无结果时返回空字符串
 */
export function formatSemanticSegmentsForPrompt(
  segments: HybridRetrievalResult['semanticSegments']
): string {
  if (!segments.length) return ''
  const lines = segments.map((seg) => {
    const chLabel = seg.chapterIndex != null ? `第${seg.chapterIndex}章` : ''
    const scoreLabel = Number.isFinite(seg.score) ? `检索分 ${seg.score.toFixed(2)}` : ''
    const meta = [seg.sourceType, chLabel, scoreLabel].filter(Boolean).join(' / ')
    return `- [${meta}] ${seg.text.slice(0, 320)}`
  })
  return `### 语义检索相关片段\n${lines.join('\n')}`
}

// ─────────────────────────────────────────────────────────────
// 向量索引写入
// ─────────────────────────────────────────────────────────────

/**
 * 将章节内容拆段并写入向量索引。先删除旧记录再插入，保证幂等。
 *
 * @param settings - AI 设置
 * @param projectId - 项目 id
 * @param chapterIndex - 章节序号
 * @param chapterContent - 章节全文
 * @param chapterId - 章节 id
 */
export async function indexChapterSegments(
  settings: AppSettings,
  projectId: string,
  chapterIndex: number,
  chapterContent: string,
  chapterId: string
): Promise<void> {
  if (!chapterContent || chapterContent.length < 50) return
  if (!providerSupportsEmbedding(settings)) return

  const db = await ensureWorkspaceDb()

  db.prepare(
    `DELETE FROM story_embeddings WHERE project_id = ? AND source_id = ?`
  ).run(projectId, chapterId)

  const segments = splitForEmbedding(chapterContent)
  if (!segments.length) return

  let embeddings: Float32Array[]
  try {
    embeddings = await embedTexts(settings, segments)
  } catch {
    return
  }

  const stmt = db.prepare(`
    INSERT INTO story_embeddings (id, project_id, source_type, source_id, chapter_index, text_content, embedding, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const timestamp = new Date().toISOString()
  for (let i = 0; i < segments.length; i++) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const buffer = Buffer.from(embeddings[i].buffer)
    stmt.run(id, projectId, 'chapter_segment', chapterId, chapterIndex, segments[i], buffer, timestamp)
  }
}

/**
 * 将参考小说文本拆段并写入向量索引，用于后续语义检索。
 *
 * @param settings - AI 设置
 * @param projectId - 项目 id
 * @param refId - 参考文献 id
 * @param novelText - 小说全文
 */
export async function indexReferenceNovel(
  settings: AppSettings,
  projectId: string,
  refId: string,
  novelText: string
): Promise<void> {
  if (!novelText || novelText.length < 100) return
  if (!providerSupportsEmbedding(settings)) return

  const db = await ensureWorkspaceDb()

  db.prepare(
    `DELETE FROM story_embeddings WHERE project_id = ? AND source_type = 'reference_novel' AND source_id = ?`
  ).run(projectId, refId)

  const segments = splitForEmbedding(novelText, 800)
  if (!segments.length) return

  const BATCH = 16
  const timestamp = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT INTO story_embeddings (id, project_id, source_type, source_id, chapter_index, text_content, embedding, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (let i = 0; i < segments.length; i += BATCH) {
    const batch = segments.slice(i, i + BATCH)
    const embeddings = await embedTexts(settings, batch)
    for (let j = 0; j < batch.length; j++) {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const buffer = Buffer.from(embeddings[j].buffer)
      stmt.run(id, projectId, 'reference_novel', refId, null, batch[j], buffer, timestamp)
    }
  }
}

/**
 * 在已索引的参考小说中做向量语义搜索。
 *
 * @param settings - AI 设置
 * @param projectId - 项目 id
 * @param refId - 参考文献 id
 * @param query - 查询文本
 * @param topK - 返回的最大结果数，默认 20
 * @returns 按相似度降序的文本片段及分数
 */
export async function searchReferenceNovel(
  settings: AppSettings,
  projectId: string,
  refId: string,
  query: string,
  topK = 20
): Promise<Array<{ text: string; score: number }>> {
  const db = await ensureWorkspaceDb()

  const rows = db.prepare(`
    SELECT text_content, embedding FROM story_embeddings
    WHERE project_id = ? AND source_type = 'reference_novel' AND source_id = ?
  `).all(projectId, refId) as Array<{ text_content: string; embedding: Buffer }>

  if (!rows.length) return []

  const queryEmbedding = await embedText(settings, query)

  return rows
    .map((row) => {
      const storedVec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
      return { text: row.text_content, score: cosineSimilarity(queryEmbedding, storedVec) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

function splitLongUnit(unit: string, maxChars: number): string[] {
  if (unit.length <= maxChars) {
    return [unit]
  }

  const sentences = unit
    .split(/(?<=[。！？!?；;])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  if (!sentences.length) {
    const chunks: string[] = []
    for (let start = 0; start < unit.length; start += maxChars) {
      chunks.push(unit.slice(start, start + maxChars).trim())
    }
    return chunks.filter(Boolean)
  }

  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current) {
      chunks.push(current.trim())
      current = sentence
      continue
    }
    current += sentence
  }
  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks.filter(Boolean)
}

function buildOverlapSeed(text: string, overlapChars: number): string {
  if (!text || text.length <= overlapChars) {
    return text
  }

  return text.slice(-overlapChars).trim()
}

/** 按段落与句子边界拆分文本，并保留轻量重叠窗口，便于语义检索命中上下文。 */
function splitForEmbedding(text: string, maxChars = 500): string[] {
  const normalizedUnits = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLongUnit(paragraph, maxChars))

  const segments: string[] = []
  const overlapChars = Math.max(40, Math.floor(maxChars * 0.18))
  let current = ''

  for (const unit of normalizedUnits) {
    if (current.length + unit.length + 2 > maxChars && current) {
      segments.push(current.trim())
      current = buildOverlapSeed(current, overlapChars)
    }

    current += (current ? '\n\n' : '') + unit
  }

  if (current.trim()) {
    segments.push(current.trim())
  }

  return Array.from(new Set(segments.map((segment) => segment.trim()).filter((segment) => segment.length >= 30)))
}
