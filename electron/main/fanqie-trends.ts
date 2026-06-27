import { fetchWithCache, type FetchWithCacheResult } from './github-mirror'

/**
 * 番茄风向标数据抓取。
 *
 * 底层走 github-mirror 公共工具：jsDelivr → fastly → ghproxy → raw.githubusercontent
 * 四通道 fallback，带 6 小时本地磁盘缓存（<userData>/data/fanqie-trends-cache/）。
 */

const REPO = 'uu201/FanqieRankTracker'
const BRANCH = 'main'
const CACHE_DIR = 'fanqie-trends-cache'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

export type FanqieTrendsFetchResult = FetchWithCacheResult

export async function fetchFanqieTrends(remotePath: string, force = false): Promise<FanqieTrendsFetchResult> {
  return fetchWithCache({
    repo: REPO,
    branch: BRANCH,
    filePath: remotePath,
    cacheDir: CACHE_DIR,
    ttlMs: CACHE_TTL_MS,
    force,
  })
}
