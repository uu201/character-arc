import type { SkillDefinition, SkillScanEntry } from './types'
import { scanSkillsFromDisk } from './discovery'

/** 按项目 ID 存储的 skill 注册表，每个项目有独立的 skill Map */
const skillMaps = new Map<string, Map<string, SkillDefinition>>()
/** 注册表是否已完成初始化 */
let initialized = false

/** 将 projectId 标准化为注册表 key，空值时返回 '_shared' */
function resolveRegistryKey(projectId?: string): string {
  const normalizedProjectId = String(projectId ?? '').trim()
  return normalizedProjectId || '_shared'
}

/**
 * 初始化 skill 注册表：从磁盘扫描并加载 skill
 * @param projectId - 项目标识
 */
export async function initRegistry(projectId?: string): Promise<void> {
  const skills = await scanSkillsFromDisk(projectId)
  skillMaps.set(resolveRegistryKey(projectId), new Map(skills.map((s) => [s.id, s])))
  initialized = true
}

/**
 * 刷新 skill 注册表：重新从磁盘扫描并替换旧数据
 * @param projectId - 项目标识
 */
export async function refreshRegistry(projectId?: string): Promise<void> {
  const skills = await scanSkillsFromDisk(projectId)
  skillMaps.set(resolveRegistryKey(projectId), new Map(skills.map((s) => [s.id, s])))
  initialized = true
}

/** 检查注册表是否已初始化 */
export function ensureInitialized(): boolean {
  return initialized
}

/**
 * 获取指定项目的所有 skill 列表
 * @param projectId - 项目标识
 * @returns skill 定义数组
 */
export function getAllSkills(projectId?: string): SkillDefinition[] {
  const key = resolveRegistryKey(projectId)
  const projectMap = skillMaps.get(key)
  const sharedMap = key !== '_shared' ? skillMaps.get('_shared') : undefined
  if (!sharedMap) return Array.from(projectMap?.values() ?? [])
  if (!projectMap) return Array.from(sharedMap.values())
  const merged = new Map(sharedMap)
  for (const [k, v] of projectMap) merged.set(k, v)
  return Array.from(merged.values())
}

/**
 * 根据 ID 查找 skill
 * @param id - skill 标识
 * @param projectId - 项目标识
 * @returns 匹配的 skill 定义，未找到时返回 undefined
 */
export function getSkillById(id: string, projectId?: string): SkillDefinition | undefined {
  const key = resolveRegistryKey(projectId)
  return skillMaps.get(key)?.get(id)
    ?? (key !== '_shared' ? skillMaps.get('_shared')?.get(id) : undefined)
}

/**
 * 获取指定项目中已启用的 skill 列表
 * @param projectId - 项目标识
 * @returns 已启用的 skill 定义数组
 */
export function getEnabledSkills(projectId?: string): SkillDefinition[] {
  return getAllSkills(projectId).filter((s) => s.enabled)
}

/**
 * 将所有 skill 转换为前端扫描摘要条目
 * @param projectId - 项目标识
 * @returns 用于前端展示的 skill 摘要列表
 */
export function toScanEntries(projectId?: string): SkillScanEntry[] {
  return getAllSkills(projectId).map((s) => ({
    id: s.id,
    name: s.name,
    version: s.version,
    path: s.path,
    scope: s.scope,
    description: s.description,
    category: s.manifest.category,
    compatibility: s.compatibility,
    compatibilityNote: s.compatibilityNote,
    source: s.source,
    referencesCount: s.referencesCount,
    enabled: s.enabled,
    stageIds: s.manifest.stages
  }))
}

/**
 * 将所有 skill 转换为可注入 prompt 的上下文条目
 * @param projectId - 项目标识
 * @returns 包含 id、名称、描述和内容的上下文条目数组
 */
export function toContextEntries(projectId?: string): Array<{ id: string; name: string; description: string; content: string }> {
  return getAllSkills(projectId).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    content: s.content
  }))
}
