import type { AppSettings } from './shared-types'
import { normalizeSettings } from './settings'
import { ensureWorkspaceDb } from '../workspace-store'

/** 每次向 Embedding API 发送的最大文本条数 */
const MAX_BATCH_SIZE = 16
/** 单批 Embedding 请求超时（毫秒）。检索在生成前同步执行，超时即放弃向量召回，避免卡住首字。 */
const EMBEDDING_REQUEST_TIMEOUT_MS = 20_000
/** 无法从聊天模型推断 embedding 模型时的兜底候选列表 */
const EMBEDDING_MODEL_FALLBACKS = ['text-embedding-3-small', 'text-embedding-ada-002', 'embedding-2']

/** 已知不支持 Embedding 接口的供应商 */
const PROVIDERS_WITHOUT_EMBEDDINGS: ReadonlySet<string> = new Set(['anthropic'])

/** 已观测到的 embedding 维度缓存，key 格式为 `provider:model` */
const observedDimensions = new Map<string, number>()
let hydratePromise: Promise<void> | null = null

/**
 * 从数据库加载历史 embedding 维度记录到内存缓存。
 * 仅首次调用时执行，后续调用复用同一 Promise。
 */
function hydrateDimensions(): Promise<void> {
  if (hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    try {
      const db = await ensureWorkspaceDb()
      const rows = db.prepare('SELECT key, dimension FROM embedding_metadata').all() as Array<{ key: string; dimension: number }>
      for (const row of rows) {
        observedDimensions.set(row.key, row.dimension)
      }
    } catch {
      hydratePromise = null
    }
  })()
  return hydratePromise
}

/**
 * 将观测到的 embedding 维度持久化到数据库，用于后续一致性校验。
 * 异步执行，失败不影响主流程。
 */
function persistDimension(key: string, dimension: number): void {
  ensureWorkspaceDb().then((db) => {
    try {
      db.prepare('INSERT OR REPLACE INTO embedding_metadata (key, dimension) VALUES (?, ?)').run(key, dimension)
    } catch { /* non-critical */ }
  }).catch(() => {})
}

/** 当前供应商不支持 Embedding 接口时抛出 */
export class EmbeddingUnsupportedError extends Error {
  constructor(provider: string) {
    super(`当前 provider「${provider}」不支持 embedding 接口，向量检索已禁用。`)
    this.name = 'EmbeddingUnsupportedError'
  }
}

/** Embedding 维度与历史不一致（可能切换了模型），需要重建索引 */
export class EmbeddingDimensionMismatchError extends Error {
  constructor(key: string, expected: number, actual: number) {
    super(`Embedding 维度不一致（${key}）：首次观测 ${expected}，本次返回 ${actual}。可能是切换了模型，请重建向量索引。`)
    this.name = 'EmbeddingDimensionMismatchError'
  }
}

/**
 * 判断当前供应商是否支持 Embedding 接口。
 *
 * @param settings - AI 设置
 * @returns 是否支持 embedding
 */
export function providerSupportsEmbedding(settings: AppSettings): boolean {
  const provider = (settings.provider ?? '').trim().toLowerCase()
  if (!provider) return true
  return !PROVIDERS_WITHOUT_EMBEDDINGS.has(provider)
}

/**
 * 获取当前供应商+模型组合历史上观测到的 embedding 维度。
 *
 * @param settings - AI 设置
 * @returns 维度数值，未观测过则返回 null
 */
export function getObservedEmbeddingDimension(settings: AppSettings): number | null {
  const normalized = normalizeSettings(settings)
  return observedDimensions.get(`${normalized.provider}:${normalized.model}`) ?? null
}

/**
 * 批量将文本转为向量。自动分批、校验维度一致性。
 *
 * @param settings - AI 设置
 * @param texts - 待嵌入的文本数组
 * @returns 与 texts 等长的 Float32Array 数组
 */
export async function embedTexts(
  settings: AppSettings,
  texts: string[]
): Promise<Float32Array[]> {
  if (!texts.length) return []

  await hydrateDimensions()

  const normalized = normalizeSettings(settings)
  if (!providerSupportsEmbedding(normalized)) {
    throw new EmbeddingUnsupportedError(normalized.provider)
  }

  const baseUrl = (normalized.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const apiKey = normalized.apiKey
  const embeddingModel = normalized.embeddingModel || resolveEmbeddingModel(normalized.model)
  const dimKey = `${normalized.provider}:${embeddingModel}`

  const results: Float32Array[] = []
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE)
    const batchResults = await requestEmbeddings(baseUrl, apiKey, batch, embeddingModel)
    if (batchResults.length) {
      const dim = batchResults[0].length
      const existing = observedDimensions.get(dimKey)
      if (existing == null) {
        observedDimensions.set(dimKey, dim)
        persistDimension(dimKey, dim)
      } else if (existing !== dim) {
        throw new EmbeddingDimensionMismatchError(dimKey, existing, dim)
      }
    }
    results.push(...batchResults)
  }
  return results
}

/**
 * 将单段文本转为向量，是 embedTexts 的便捷封装。
 *
 * @param settings - AI 设置
 * @param text - 待嵌入的文本
 * @returns 文本对应的向量
 */
export async function embedText(settings: AppSettings, text: string): Promise<Float32Array> {
  const results = await embedTexts(settings, [text])
  return results[0]
}

/**
 * 向 Embedding API 发送单批请求并返回向量结果。
 *
 * @param baseUrl - API 基础地址
 * @param apiKey - 认证密钥
 * @param inputs - 本批次的文本列表
 * @param embeddingModel - 使用的 embedding 模型名
 * @returns 每条输入对应的向量
 */
async function requestEmbeddings(
  baseUrl: string,
  apiKey: string,
  inputs: string[],
  embeddingModel: string
): Promise<Float32Array[]> {
  const url = `${baseUrl}/embeddings`

  // embedding 检索发生在生成请求之前并被同步 await，无超时会让慢/挂起的接口直接卡死首字输出。
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: inputs,
        encoding_format: 'float'
      }),
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Embedding API 请求超时（>${EMBEDDING_REQUEST_TIMEOUT_MS / 1000}s）`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Embedding API error ${response.status}: ${errorText.slice(0, 200)}`)
  }

  const json = await response.json() as {
    data?: Array<{ embedding: number[]; index: number }>
  }

  if (!json.data?.length) {
    throw new Error('Embedding API returned empty data')
  }

  const sorted = json.data.sort((a, b) => a.index - b.index)
  return sorted.map((item) => {
    const vec = new Float32Array(item.embedding.length)
    for (let i = 0; i < item.embedding.length; i++) {
      vec[i] = item.embedding[i]
    }
    return vec
  })
}

/**
 * 根据聊天模型名称推断对应的 embedding 模型。
 * 未匹配时回退到 EMBEDDING_MODEL_FALLBACKS 第一项。
 *
 * @param chatModel - 当前使用的聊天模型名
 * @returns 推荐的 embedding 模型名
 */
function resolveEmbeddingModel(chatModel: string): string {
  const lower = chatModel.toLowerCase()
  if (lower.includes('deepseek')) return 'text-embedding-3-small'
  if (lower.includes('qwen')) return 'text-embedding-v3'
  if (lower.includes('glm') || lower.includes('zhipu')) return 'embedding-3'
  return EMBEDDING_MODEL_FALLBACKS[0]
}

/**
 * 计算两个向量的余弦相似度，值域 [-1, 1]。
 *
 * @param a - 向量 a
 * @param b - 向量 b
 * @returns 余弦相似度
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * 将长文本按段落边界拆分为不超过 maxChars 的段落片段。
 * 过短的片段（< 20 字符）会被丢弃。
 *
 * @param text - 原始文本
 * @param maxChars - 每段最大字符数，默认 500
 * @returns 拆分后的文本片段数组
 */
export function splitTextIntoSegments(text: string, maxChars = 500): string[] {
  if (!text || text.length <= maxChars) return text ? [text] : []

  const paragraphs = text.split(/\n{2,}/)
  const segments: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current) {
      segments.push(current.trim())
      current = ''
    }
    current += (current ? '\n\n' : '') + para
  }
  if (current.trim()) {
    segments.push(current.trim())
  }

  return segments.filter((s) => s.length >= 20)
}
