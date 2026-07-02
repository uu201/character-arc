/**
 * Runtime v2 · 启动装配入口
 *
 * 把 Phase 2 的所有零件 wire 在一起：
 *   - registerAssistantIpcHandlers（IPC 通道 + configureRuntimeState）
 *   - registerBuiltinProviders（ContextBuilder 数据源）
 *   - createExecutionPlanner（Turn 执行计划）
 *   - createCommitter（Staged Change 写库分发）
 *
 * main entry 只需要调 `bootstrapAssistantRuntime({ ensureDb, getSnapshot })`。
 */

import type { DatabaseSync } from 'node:sqlite'
import type { WorkspacePayload } from '../../workspace-types'
import { contextBuilder } from './context-builder'
import { registerAssistantIpcHandlers } from './ipc'
import { createExecutionPlanner } from './execution-plan'
import { createCommitter } from './committer'
import { registerBuiltinProviders } from './providers'
import { getSharedConversation, peekSharedConversation } from './state'

export interface BootstrapAssistantRuntimeDeps {
  /** 首次调用时 ensure schema，返回 DatabaseSync 实例。 */
  ensureDb: () => Promise<DatabaseSync>
  /** 拿 latest workspace snapshot（AppSettings 与项目数据）。 */
  getSnapshot: () => WorkspacePayload | null
  /** 写库成功后刷新主进程快照并通知渲染进程。 */
  refreshSnapshot?: () => Promise<void>
}

export function bootstrapAssistantRuntime(deps: BootstrapAssistantRuntimeDeps): void {
  const snapshotAccessor = {
    getSnapshot: deps.getSnapshot
  }

  // 1. 注册 Context Provider
  registerBuiltinProviders({
    contextBuilder,
    snapshot: snapshotAccessor,
    getConversation: () => getSharedConversation()
  })

  // 2. 构造 execution planner
  const resolveTurnExecutionPlan = createExecutionPlanner({
    snapshot: snapshotAccessor,
    onKnowledgeSaved: deps.refreshSnapshot
  })

  // 3. 构造 committer。resolveProjectId 走同步 peek——
  //    committer 只在有变更被 accept 后触发，那时 conversation 单例必然已 ready。
  const commitChange = createCommitter({
    resolveProjectId: (sessionId) => {
      const cm = peekSharedConversation()
      if (!cm) return null
      const session = cm.getSession(sessionId)
      return session?.projectId ?? null
    },
    onCommitted: deps.refreshSnapshot
  })

  // 4. 注册 IPC（内部会 configureRuntimeState）
  registerAssistantIpcHandlers({
    ensureDb: deps.ensureDb,
    resolveTurnExecutionPlan,
    commitChange
  })
}
