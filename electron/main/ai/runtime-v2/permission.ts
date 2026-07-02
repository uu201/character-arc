/**
 * Surface × Tool 权限过滤。
 *
 * ToolMatcher 语法：
 *   - `*`            匹配所有工具
 *   - `stage_*`      前缀匹配（末尾 `*`）
 *   - `stage_chapter_edit`  精确匹配
 *
 * 用于 AgentLoop 在构建 tool registry 时按 Surface 白名单过滤，
 * 让模型看到的工具集本身就受权限约束，避免依赖 system prompt 中的软约束。
 */

import {
  DEFAULT_PERMISSION_MATRIX,
  type SurfaceDefinition,
  type ToolMatcher
} from '@shared/assistant-runtime'

/** 单个工具名是否匹配某个 matcher。 */
export function matchesTool(matcher: ToolMatcher, toolName: string): boolean {
  if (matcher === '*') return true
  if (matcher.endsWith('*')) {
    const prefix = matcher.slice(0, -1)
    return toolName.startsWith(prefix)
  }
  return matcher === toolName
}

/** 工具名是否匹配 matcher 集合中的任意一条。 */
export function isToolAllowed(
  toolName: string,
  matchers: readonly ToolMatcher[]
): boolean {
  for (const m of matchers) {
    if (matchesTool(m, toolName)) return true
  }
  return false
}

/**
 * 解析 Surface 的最终 matcher 列表。
 * - Surface 显式指定 allowedTools → 使用之
 * - 未指定 → 回落到 DEFAULT_PERMISSION_MATRIX[surface.id]
 * - 都没有 → 空集（保守拒绝）
 */
export function resolveAllowedMatchers(
  surface: SurfaceDefinition
): readonly ToolMatcher[] {
  if (surface.allowedTools && surface.allowedTools.length > 0) {
    return surface.allowedTools
  }
  return DEFAULT_PERMISSION_MATRIX[surface.id] ?? []
}

/** 具备 `definition.name` 字段的最小 Tool 形状，便于测试与解耦。 */
export interface NamedTool {
  definition: { name: string }
}

/**
 * 按 Surface 过滤工具列表。返回被允许的工具子集。
 * Runtime 组装 registry 时对拼接后的完整工具集调用此函数。
 */
export function filterToolsBySurface<T extends NamedTool>(
  tools: readonly T[],
  surface: SurfaceDefinition
): T[] {
  const matchers = resolveAllowedMatchers(surface)
  if (matchers.length === 0) return []
  return tools.filter((t) => isToolAllowed(t.definition.name, matchers))
}

/**
 * 调试用：把 Surface 的允许集展开成实际能命中的工具名列表。
 * UI 层想展示"当前 Surface 可用工具"时用。
 */
export function listAllowedToolNames(
  tools: readonly NamedTool[],
  surface: SurfaceDefinition
): string[] {
  return filterToolsBySurface(tools, surface).map((t) => t.definition.name)
}
