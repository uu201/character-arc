import { fetchWithCache, type FetchWithCacheResult } from './github-mirror'

/**
 * 纵横风向标静态 API 适配层。
 *
 * 数据来自 siweimidu/ZongHengRankTracker 的生成结果，不直接请求纵横官网。
 * 仅开放页面需要的固定 JSON 路径，并复用 GitHub 多镜像和本地缓存。
 */

const REPO = 'siweimidu/ZongHengRankTracker'
const BRANCH = 'main'
const CACHE_DIR = 'zongheng-trends-cache'
const CACHE_TTL_MS = 2 * 60 * 60 * 1000
const ALLOWED_PATH = /^api\/(?:boards\.json|market-brief\.json|cross-board\.json|[a-z0-9-]+\/latest\/all\.json)$/

export type ZonghengTrendsFetchResult = FetchWithCacheResult

export function normalizeZonghengApiPath(remotePath: string): string {
  const path = String(remotePath || '').replace(/^\/+/, '').trim()
  if (!ALLOWED_PATH.test(path)) throw new Error('不支持的纵横榜单数据路径。')
  return path
}

export async function fetchZonghengTrends(
  remotePath: string,
  force = false
): Promise<ZonghengTrendsFetchResult> {
  let filePath: string
  try {
    filePath = normalizeZonghengApiPath(remotePath)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '纵横榜单路径无效' }
  }

  return fetchWithCache({
    repo: REPO,
    branch: BRANCH,
    filePath,
    cacheDir: CACHE_DIR,
    ttlMs: CACHE_TTL_MS,
    force
  })
}
