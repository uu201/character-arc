import type { AppSettings } from '../shared-types'
import { normalizeSettings } from '../settings'

export interface FetchedModel {
  id: string
  ownedBy: string | null
}

const FETCH_MODELS_TIMEOUT_MS = 15_000

const KNOWN_COMPAT_SUFFIXES = [
  '/api/claudecode', '/api/anthropic', '/apps/anthropic',
  '/api/coding', '/claudecode', '/anthropic',
  '/step_plan', '/coding', '/claude'
]

function stripCompatSuffix(baseUrl: string): string | null {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) return baseUrl.slice(0, baseUrl.length - suffix.length)
  }
  return null
}

function buildModelsUrlCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return []
  const candidates: string[] = []
  if (trimmed.endsWith('/v1')) {
    candidates.push(`${trimmed}/models`)
  } else {
    candidates.push(`${trimmed}/v1/models`)
  }
  const stripped = stripCompatSuffix(trimmed)
  if (stripped) {
    const root = stripped.replace(/\/+$/, '')
    if (root.includes('://') && root.length > root.indexOf('://') + 3) {
      candidates.push(`${root}/v1/models`)
      candidates.push(`${root}/models`)
    }
  }
  return [...new Set(candidates)]
}

async function fetchModelsOpenAiCompatible(baseUrl: string, apiKey: string): Promise<FetchedModel[]> {
  const candidates = buildModelsUrlCandidates(baseUrl)
  if (candidates.length === 0) throw new Error('Base URL 为空，无法获取模型列表。')
  let lastError: string | null = null
  for (const url of candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        signal: controller.signal
      })
      if (response.status === 404 || response.status === 405) { lastError = `HTTP ${response.status}`; continue }
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      const data = (await response.json()) as { data?: Array<{ id: string; owned_by?: string | null }> }
      const models = (data.data ?? []).map((m) => ({ id: m.id, ownedBy: m.owned_by ?? null }))
      models.sort((a, b) => a.id.localeCompare(b.id))
      return models
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('获取模型列表超时，请检查网络或代理设置。')
      if (lastError !== null) continue
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`所有候选端点均返回 ${lastError ?? '错误'}，该供应商可能未开放模型列表接口。`)
}

async function fetchModelsAnthropic(baseUrl: string, apiKey: string): Promise<FetchedModel[]> {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const url = `${trimmed}/v1/models`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Anthropic 模型列表请求失败：HTTP ${response.status} ${response.statusText}`)
    const data = (await response.json()) as { data?: Array<{ id: string; owned_by?: string | null }> }
    const models = (data.data ?? []).map((m) => ({ id: m.id, ownedBy: m.owned_by ?? null }))
    models.sort((a, b) => a.id.localeCompare(b.id))
    return models
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('获取 Anthropic 模型列表超时，请检查网络或代理设置。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchModels(settings: AppSettings): Promise<FetchedModel[]> {
  const normalized = normalizeSettings(settings)
  if (!normalized.baseUrl.trim()) throw new Error('请先填写 Base URL。')
  if (normalized.provider === 'anthropic') {
    if (!normalized.apiKey.trim()) throw new Error('Anthropic 供应商需要 API Key 才能获取模型列表。')
    return fetchModelsAnthropic(normalized.baseUrl, normalized.apiKey)
  }
  return fetchModelsOpenAiCompatible(normalized.baseUrl, normalized.apiKey)
}

export async function fetchImageModels(settings: AppSettings): Promise<FetchedModel[]> {
  const baseUrl = settings.imageBaseUrl?.trim()
  const apiKey = settings.imageApiKey?.trim()
  if (!baseUrl) throw new Error('请先填写图片生成 Base URL。')
  if (!apiKey) throw new Error('请先填写图片生成 API Key。')
  return fetchModelsOpenAiCompatible(baseUrl, apiKey)
}
