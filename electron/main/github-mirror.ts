import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getWorkspaceDirPath } from './workspace-store'

/**
 * GitHub 多镜像抓取 + 本地磁盘缓存（公共工具）。
 *
 * 通道顺序：jsDelivr(CDN) → fastly → ghproxy → raw.githubusercontent（直连兜底）。
 * 上次命中的镜像下次优先尝试；缓存新鲜则跳过网络；网络失败则回退旧缓存。
 */

// ── 镜像通道 ──

const MIRROR_BUILDERS: Array<(repo: string, branch: string, path: string) => string> = [
  (repo, branch, p) => `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${p}`,
  (repo, branch, p) => `https://fastly.jsdelivr.net/gh/${repo}@${branch}/${p}`,
  (_repo, branch, p) => `https://ghproxy.net/https://raw.githubusercontent.com/${_repo}/${branch}/${p}`,
  (repo, branch, p) => `https://raw.githubusercontent.com/${repo}/${branch}/${p}`
]

const MIRROR_NAMES = ['jsDelivr', 'jsDelivr(fastly)', 'ghproxy', 'GitHub raw'] as const

/** 每个 repo 维护一个独立的 activeMirror 指针，跨调用记忆最快镜像 */
const activeMirrorMap = new Map<string, number>()

function getActiveMirror(repo: string): number {
  return activeMirrorMap.get(repo) ?? 0
}

function setActiveMirror(repo: string, idx: number): void {
  activeMirrorMap.set(repo, idx)
}

// ── 缓存层 ──

type CacheEnvelope = {
  fetchedAt: number
  mirror: string
  data: unknown
}

function getCacheDir(dirName: string): string {
  return join(getWorkspaceDirPath(), dirName)
}

function getCacheFilePath(dirName: string, remotePath: string): string {
  const hash = createHash('sha1').update(remotePath).digest('hex').slice(0, 16)
  return join(getCacheDir(dirName), `${hash}.json`)
}

async function readCache(dirName: string, remotePath: string): Promise<CacheEnvelope | null> {
  try {
    const raw = await readFile(getCacheFilePath(dirName, remotePath), 'utf-8')
    const parsed = JSON.parse(raw) as CacheEnvelope
    if (parsed && typeof parsed.fetchedAt === 'number' && 'data' in parsed) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

async function writeCache(dirName: string, remotePath: string, envelope: CacheEnvelope): Promise<void> {
  try {
    await mkdir(getCacheDir(dirName), { recursive: true })
    await writeFile(getCacheFilePath(dirName, remotePath), JSON.stringify(envelope), 'utf-8')
  } catch {
    // 缓存写入失败不影响本次返回
  }
}

// ── 多镜像抓取 ──

const DEFAULT_TIMEOUT_MS = 12_000

type FetchResult = {
  data: unknown
  mirror: string
}

async function fetchJsonFromMirrors(
  repo: string,
  branch: string,
  filePath: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<FetchResult> {
  let lastErr: unknown
  const cur = getActiveMirror(repo)
  const order = [cur, ...MIRROR_BUILDERS.map((_, i) => i).filter((i) => i !== cur)]

  for (const idx of order) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const url = MIRROR_BUILDERS[idx](repo, branch, filePath)
        + (filePath.includes('?') ? '' : `?t=${Date.now()}`)
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { 'User-Agent': 'CharacterArc-Desktop' },
        signal: controller.signal
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setActiveMirror(repo, idx)
      return { data, mirror: MIRROR_NAMES[idx] ?? `mirror#${idx}` }
    } catch (error) {
      lastErr = error
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('全部镜像通道均失败')
}

// ── 公开 API ──

export type FetchWithCacheOptions = {
  /** GitHub 仓库，如 `'uu201/character-arc'` */
  repo: string
  /** 分支名，如 `'main'` */
  branch: string
  /** 仓库内文件路径，如 `'announcements.json'` */
  filePath: string
  /** 缓存目录名（相对 userData/data），如 `'announcements-cache'` */
  cacheDir: string
  /** 缓存有效期（毫秒），默认 6 小时 */
  ttlMs?: number
  /** 单次镜像请求超时（毫秒），默认 12 秒 */
  timeoutMs?: number
  /** 为 true 时跳过缓存强制走网络 */
  force?: boolean
}

export type FetchWithCacheResult = {
  success: boolean
  data?: unknown
  fromCache?: boolean
  fetchedAt?: number
  mirror?: string
  error?: string
}

export async function fetchWithCache(opts: FetchWithCacheOptions): Promise<FetchWithCacheResult> {
  const {
    repo,
    branch,
    filePath,
    cacheDir,
    ttlMs = 6 * 60 * 60 * 1000,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    force = false
  } = opts

  const path = String(filePath ?? '').replace(/^\/+/, '').trim()
  if (!path) return { success: false, error: '缺少文件路径' }

  const cached = await readCache(cacheDir, path)

  // 非强制刷新且缓存新鲜 → 直接复用
  if (!force && cached && Date.now() - cached.fetchedAt < ttlMs) {
    return {
      success: true,
      data: cached.data,
      fromCache: true,
      fetchedAt: cached.fetchedAt,
      mirror: cached.mirror
    }
  }

  try {
    const { data, mirror } = await fetchJsonFromMirrors(repo, branch, path, timeoutMs)
    const fetchedAt = Date.now()
    await writeCache(cacheDir, path, { fetchedAt, mirror, data })
    return { success: true, data, fromCache: false, fetchedAt, mirror }
  } catch (error) {
    // 网络失败：能回退到旧缓存就回退（哪怕已过期）
    if (cached) {
      return {
        success: true,
        data: cached.data,
        fromCache: true,
        fetchedAt: cached.fetchedAt,
        mirror: cached.mirror
      }
    }
    return { success: false, error: error instanceof Error ? error.message : '抓取失败' }
  }
}
