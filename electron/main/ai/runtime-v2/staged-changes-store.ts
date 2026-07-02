/**
 * StagedChangesStore
 *
 * 统一变更暂存区。所有 `stage_*` 工具产出的变更进入此 store，
 * AgentLoop 通过事件订阅推送到 IPC，用户处理后批量 commit 到业务库。
 *
 * Phase 1：仅内存实现。Phase 2 由 ConversationManager 追加落盘至
 * `assistant_events` 表（`kind = 'staged_change'`）以支持 replay。
 *
 * 不与业务库耦合：commit 时由调用方传入 committer 回调按 kind 分发写库。
 */

import { randomUUID } from 'node:crypto'
import type {
  StagedChange,
  StagedChangeAction,
  StagedChangeCandidate,
  StagedChangeCommitResult,
  StagedChangeKind,
  StagedChangeStatus
} from '@shared/assistant-runtime'

/** add 时的入参，不含状态/时间戳/id。 */
export interface StageChangeInput {
  sessionId: string
  turnId: string
  toolUseId?: string
  kind: StagedChangeKind
  action: StagedChangeAction
  entityId?: string
  entityTitle: string
  reason: string
  before: string
  after: string
  chapterHtml?: { old: string; new: string }
  entityPayload?: Record<string, unknown>
  candidates?: StagedChangeCandidate[]
  /** 是否处于 streaming 中；工具 finalize 时改为 pending。默认 false（直接 pending）。 */
  streaming?: boolean
}

/** commit 阶段由外部注入的写库回调。 */
export type StagedChangeCommitter = (
  change: StagedChange
) => Promise<StagedChangeCommitResult>

/** 事件订阅 handler。listener 里 push 到 IPC。 */
export type StagedChangesListener = (evt: StagedChangesEvent) => void

/** Store 对外发布的事件。 */
export type StagedChangesEvent =
  | { type: 'added'; change: StagedChange }
  | { type: 'updated'; change: StagedChange }
  | { type: 'removed'; changeId: string; sessionId: string }

/** 列表查询过滤器。 */
export interface StagedChangesFilter {
  status?: readonly StagedChangeStatus[]
  kind?: readonly StagedChangeKind[]
  turnId?: string
}

/**
 * 单例 store。按 changeId 索引，附带 sessionId / toolUseId 反向索引。
 * 全部同步 API（业务态无 IO），commit 才异步。
 */
export class StagedChangesStore {
  private readonly items = new Map<string, StagedChange>()
  private readonly bySession = new Map<string, Set<string>>()
  private readonly byToolUse = new Map<string, string>() // toolUseId → changeId
  private readonly listeners = new Set<StagedChangesListener>()

  /** 订阅事件。返回取消函数。 */
  subscribe(listener: StagedChangesListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(evt: StagedChangesEvent): void {
    for (const l of this.listeners) {
      try {
        l(evt)
      } catch (e) {
        // 单个 listener 抛错不影响其余；打印到主进程即可。
        console.error('[StagedChangesStore] listener error', e)
      }
    }
  }

  /** 新增一条变更。streaming=true 时状态为 streaming，稍后 finalize。 */
  add(input: StageChangeInput): StagedChange {
    const now = new Date().toISOString()
    const change: StagedChange = {
      id: randomUUID(),
      sessionId: input.sessionId,
      turnId: input.turnId,
      toolUseId: input.toolUseId,
      kind: input.kind,
      action: input.action,
      entityId: input.entityId,
      entityTitle: input.entityTitle,
      reason: input.reason,
      before: input.before,
      after: input.after,
      chapterHtml: input.chapterHtml,
      entityPayload: input.entityPayload,
      candidates: input.candidates,
      status: input.streaming ? 'streaming' : 'pending',
      createdAt: now,
      updatedAt: now
    }
    this.items.set(change.id, change)
    this.indexAdd(change)
    this.emit({ type: 'added', change })
    return change
  }

  private indexAdd(change: StagedChange): void {
    let set = this.bySession.get(change.sessionId)
    if (!set) {
      set = new Set()
      this.bySession.set(change.sessionId, set)
    }
    set.add(change.id)
    if (change.toolUseId) this.byToolUse.set(change.toolUseId, change.id)
  }

  private indexRemove(change: StagedChange): void {
    this.bySession.get(change.sessionId)?.delete(change.id)
    if (change.toolUseId && this.byToolUse.get(change.toolUseId) === change.id) {
      this.byToolUse.delete(change.toolUseId)
    }
  }

  /** 内部状态迁移 + 发事件 + 更新 updatedAt。 */
  private transition(id: string, mut: (c: StagedChange) => void): StagedChange | null {
    const change = this.items.get(id)
    if (!change) return null
    mut(change)
    change.updatedAt = new Date().toISOString()
    this.emit({ type: 'updated', change })
    return change
  }

  /** streaming → pending。工具 finalize 时调用。 */
  finalize(id: string): StagedChange | null {
    return this.transition(id, (c) => {
      if (c.status === 'streaming') c.status = 'pending'
    })
  }

  /** 更新 pending 变更的目标绑定（用户在 UI 中手动指定 entityId）。 */
  bindTarget(id: string, entityId: string): StagedChange | null {
    return this.transition(id, (c) => {
      c.entityId = entityId
    })
  }

  /** 批量接受。pending/rejected 均可转 accepted（rejected→accepted 即"恢复"）。 */
  accept(ids: readonly string[]): StagedChange[] {
    const changed: StagedChange[] = []
    for (const id of ids) {
      const c = this.transition(id, (c) => {
        if (c.status === 'pending' || c.status === 'rejected') c.status = 'accepted'
      })
      if (c && c.status === 'accepted') changed.push(c)
    }
    return changed
  }

  /** 批量拒绝。pending/accepted 都可转 rejected。 */
  reject(ids: readonly string[]): StagedChange[] {
    const changed: StagedChange[] = []
    for (const id of ids) {
      const c = this.transition(id, (c) => {
        if (c.status === 'pending' || c.status === 'accepted') c.status = 'rejected'
      })
      if (c) changed.push(c)
    }
    return changed
  }

  /**
   * 批量 commit。仅 accepted 状态才会送入 committer。
   * 若 changeIds 缺省，则 commit 传入 sessionId 下所有 accepted。
   * committer 内部完成写库，返回 CommitResult；失败的变更保持 accepted 供重试。
   */
  async commit(
    committer: StagedChangeCommitter,
    opts: { sessionId?: string; changeIds?: readonly string[] } = {}
  ): Promise<StagedChangeCommitResult[]> {
    const targets = this.collectAcceptedTargets(opts)
    const results: StagedChangeCommitResult[] = []

    for (const change of targets) {
      let result: StagedChangeCommitResult
      try {
        result = await committer(change)
      } catch (e) {
        result = {
          changeId: change.id,
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
      results.push(result)
      if (result.ok) {
        this.transition(change.id, (c) => {
          c.status = 'committed'
          if (result.entityId) c.entityId = result.entityId
        })
      }
    }
    return results
  }

  private collectAcceptedTargets(opts: {
    sessionId?: string
    changeIds?: readonly string[]
  }): StagedChange[] {
    if (opts.changeIds && opts.changeIds.length > 0) {
      const out: StagedChange[] = []
      for (const id of opts.changeIds) {
        const c = this.items.get(id)
        if (c && c.status === 'accepted') out.push(c)
      }
      return out
    }
    return this.list({ status: ['accepted'] }, opts.sessionId)
  }

  /** 单条读取。 */
  get(id: string): StagedChange | null {
    return this.items.get(id) ?? null
  }

  /** 通过 toolUseId 反查（工具日志 ↔ 变更卡片跳转）。 */
  findByToolUseId(toolUseId: string): StagedChange | null {
    const id = this.byToolUse.get(toolUseId)
    return id ? this.items.get(id) ?? null : null
  }

  /** 列表查询。缺省 sessionId 时查全库；带 sessionId 时只查该会话。 */
  list(filter: StagedChangesFilter = {}, sessionId?: string): StagedChange[] {
    const ids = sessionId
      ? Array.from(this.bySession.get(sessionId) ?? [])
      : Array.from(this.items.keys())
    const out: StagedChange[] = []
    for (const id of ids) {
      const c = this.items.get(id)
      if (!c) continue
      if (filter.status && !filter.status.includes(c.status)) continue
      if (filter.kind && !filter.kind.includes(c.kind)) continue
      if (filter.turnId && c.turnId !== filter.turnId) continue
      out.push(c)
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** 硬删除（一般不用；仅测试清理或用户 clear all）。 */
  remove(id: string): void {
    const c = this.items.get(id)
    if (!c) return
    this.items.delete(id)
    this.indexRemove(c)
    this.emit({ type: 'removed', changeId: id, sessionId: c.sessionId })
  }

  /** 清空某个 session 的全部变更。会话删除时调用。 */
  clearSession(sessionId: string): void {
    const set = this.bySession.get(sessionId)
    if (!set) return
    for (const id of Array.from(set)) this.remove(id)
    this.bySession.delete(sessionId)
  }
}

/** 单例，供整个 Runtime 共享。 */
export const stagedChangesStore = new StagedChangesStore()
