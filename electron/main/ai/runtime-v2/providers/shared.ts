/**
 * Provider 公共依赖：workspace snapshot 访问 + 项目子集切片。
 *
 * Runtime v2 的 provider 不直接访问 `latestWorkspaceSnapshot`，
 * 而是通过 SnapshotAccessor 拿数据。这一层隔离让 provider 可测、可换源。
 */

import type { ContextSlice, SurfaceDefinition } from '@shared/assistant-runtime'
import type { WorkspacePayload } from '../../../workspace-types'
import { estimateTokens } from '../context-builder'

/** 项目工作区子集类型：WorkspacePayload['workspaces'][projectId]。 */
export type ProjectWorkspaceSnapshot = WorkspacePayload['workspaces'][string]

/** Provider 的数据源抽象，注入到工厂。 */
export interface SnapshotAccessor {
  /** 拿到最新的 snapshot。可能为 null（首次启动、项目未选中等）。 */
  getSnapshot(): WorkspacePayload | null
}

/** 从 snapshot 中拿到某项目的顶层记录与子工作区。缺任一返回 null。 */
export function getProjectView(
  snapshot: WorkspacePayload | null,
  projectId: string
): {
  project: WorkspacePayload['projects'][number]
  workspace: ProjectWorkspaceSnapshot
} | null {
  if (!snapshot) return null
  const project = snapshot.projects.find((p) => p.id === projectId)
  if (!project) return null
  const workspace = snapshot.workspaces[projectId]
  if (!workspace) return null
  return { project, workspace }
}

/** 从 scopeRef "chapter:cha_042" / "selection:cha_042#§6-7" 中拆出 chapterId。 */
export function parseChapterScopeRef(scopeRef: string | undefined): string | null {
  if (!scopeRef) return null
  const [kind, ref] = scopeRef.split(':', 2)
  if (!ref) return null
  if (kind === 'chapter') return ref
  if (kind === 'selection') return ref.split('#')[0] ?? null
  return null
}

/** 判断 Surface 是否需要章节 scope（chapter-panel / inline-selection）。 */
export function surfaceHasChapterScope(surface: SurfaceDefinition): boolean {
  return surface.scope === 'chapter' || surface.scope === 'selection'
}

/** 构造一个 slice，自动估算 token。 */
export function makeSlice(
  providerId: string,
  priority: number,
  heading: string,
  body: string
): ContextSlice {
  return {
    providerId,
    priority,
    heading,
    body,
    estimatedTokens: estimateTokens(body) + estimateTokens(heading) + 4
  }
}
