import { fetchWithCache, type FetchWithCacheResult } from './github-mirror'

/**
 * 七猫风向标公开静态 API 适配层。
 *
 * 只允许读取榜单目录、单榜最新数据和单榜市场摘要，避免渲染层把该 IPC
 * 当成任意 GitHub 文件代理。数据通过公共镜像回退并缓存在本机。
 */

const REPO = 'siweimidu/QiMaoRankTracker2'
const BRANCH = 'main'
const CACHE_DIR = 'qimao-trends-cache'
const CACHE_TTL_MS = 2 * 60 * 60 * 1000
const ALLOWED_PATH = /^api\/(?:boards\.json|[a-z0-9-]+\/(?:latest\/all\.json|market_summary\.json))$/

export type QimaoTrendsFetchResult = FetchWithCacheResult

export function normalizeQimaoApiPath(remotePath: string): string {
  const path = String(remotePath || '').replace(/^\/+/, '').trim()
  if (!ALLOWED_PATH.test(path)) throw new Error('不支持的七猫榜单数据路径。')
  return path
}

export async function fetchQimaoTrends(
  remotePath: string,
  force = false
): Promise<QimaoTrendsFetchResult> {
  let filePath: string
  try {
    filePath = normalizeQimaoApiPath(remotePath)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '七猫榜单路径无效' }
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
