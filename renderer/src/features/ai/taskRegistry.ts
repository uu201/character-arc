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
export type AiTaskRunStage = 'running' | 'done' | 'error'

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
  /** 可取消令牌：提供时，进度面板会显示"停止"按钮。 */
  onCancel?: () => void
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
  /**
   * 客户端超时（毫秒）。超时后前端会自动标记任务失败并通知主进程 abort。
   * 默认 90_000ms（90 秒）。设为 0 表示不超时。
   */
  timeoutMs?: number
}

/**
 * 任务结束后在列表里保留多久（毫秒）。
 * 给用户一点时间看到"成功 ✓"或"失败 ×"反馈再淡出。
 */
export const AI_TASK_RETENTION_MS = 4_500

/**
 * 非流式 AI 任务的默认客户端超时（毫秒）。
 * 超时后前端会标记任务失败并通知主进程 abort。
 * 90 秒对大多数任务足够；章节初稿等长任务应在 input 里覆盖为更大值。
 */
export const AI_TASK_DEFAULT_TIMEOUT_MS = 300_000
