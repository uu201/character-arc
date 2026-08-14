/**
 * 全局 AI 任务注册表 —— 让按钮 loading 状态与页面切换解耦。
 *
 * 问题：原实现里每个面板组件用自己的 `ref(false)` 管 loading。
 *       只要用户切到别的 panel，组件卸载 → 状态归零 → 按钮 "生成中…" 消失，
 *       但 IPC 请求其实还在后台跑，再点一次会并发发第二次请求。
 *
 * 解法：把正在运行的 AI 任务集中登记到 Pinia store 持有的这份 Map 上。
 *       组件只负责读 `isAiTaskRunning(key)` 渲染按钮态，真正的调用走 `runTrackedAiTask`。
 *       跨面板、跨窗口渲染都能看到一致的进行中列表，并驱动全局进度面板。
 *
 * 这里只定义数据结构和纯函数，store 负责持有响应式容器。
 */

/** AI 任务执行阶段 */
export type AiTaskRunStage = 'running' | 'done' | 'error' | 'canceled'

/** 单个正在/刚结束的 AI 任务记录 */
export interface AiTaskRun {
  /** 任务唯一标识，例如 `worldview-entry`、`outline-volume:${volumeId}`。 */
  key: string
  /** 任务分类，决定图标/默认文案。 */
  kind: AiTaskKind
  /** 展示名称，如 "AI 扩写世界观"。 */
  label: string
  /** 面向用户的简短描述，例如 "正在补写一条地理设定"。 */
  description?: string
  /** 所属面板/视图，点击后可跳回原处查看结果。 */
  panel?: string
  /** 启动时间戳（毫秒）。 */
  startedAt: number
  /** 结束时间戳，只有 stage !== 'running' 时才有值。 */
  finishedAt?: number
  /** 当前阶段。 */
  stage: AiTaskRunStage
  /** 报错信息（如果 stage === 'error'）。 */
  error?: string
  /** 可确定进度的后台任务使用；普通 AI 请求保持未定义并显示动态进度条。 */
  progress?: {
    current: number
    total: number
    percentage: number
  }
  /** 可取消令牌：提供时，进度面板会显示"停止"按钮。 */
  onCancel?: () => void
  /** 主进程后台任务的运行版本，用于忽略上一轮迟到的终态事件。 */
  runId?: string
}

/**
 * AI 任务分类——用作图标/默认文案的 hint。
 * 不强制每个地方都填，但分好类后进度面板能更有信息量。
 */
export type AiTaskKind =
  | 'worldview'
  | 'character'
  | 'outline'
  | 'workflow'
  | 'inspiration'
  | 'chapter-draft'
  | 'chapter-summary'
  | 'chapter-assistant'
  | 'chapter-post-process'
  | 'plot-thread'
  | 'cover'
  | 'reference'
  | 'other'

/** 启动任务时所需的输入（不含 startedAt/stage，内部补齐） */
export interface AiTaskRunInput {
  key: string
  kind: AiTaskKind
  label: string
  description?: string
  panel?: string
  onCancel?: () => void
}

/**
 * 成功或取消任务结束后在列表里保留多久（毫秒）。
 * 失败任务由任务中心保留到用户手动关闭。
 */
export const AI_TASK_RETENTION_MS = 4_500

export type ExternalAiTaskEvent = {
  taskKey: string
  runId: string
  stage: AiTaskRunStage
  label: string
  description?: string
  startedAt: number
  finishedAt?: number
  error?: string
}

/** 将主进程任务事件归并到注册表；旧 runId 的终态不会覆盖新任务。 */
export function applyExternalAiTaskEvent(
  current: ReadonlyMap<string, AiTaskRun>,
  event: ExternalAiTaskEvent
): Map<string, AiTaskRun> {
  const existing = current.get(event.taskKey)
  if (event.stage !== 'running' && existing?.runId !== event.runId) {
    return current as Map<string, AiTaskRun>
  }

  const next = new Map(current)
  if (event.stage === 'running') {
    next.set(event.taskKey, {
      key: event.taskKey,
      kind: 'chapter-post-process',
      label: event.label,
      description: event.description,
      startedAt: event.startedAt,
      stage: 'running',
      runId: event.runId
    })
    return next
  }

  next.set(event.taskKey, {
    ...existing,
    key: event.taskKey,
    kind: existing?.kind ?? 'chapter-post-process',
    label: existing?.label ?? event.label,
    startedAt: existing?.startedAt ?? event.startedAt,
    stage: event.stage,
    runId: event.runId,
    finishedAt: event.finishedAt ?? Date.now(),
    error: event.error
  })
  return next
}
