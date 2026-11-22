/** 一次用户发送可包含多次模型请求；工具预算与模型轮数分别控制。 */
export interface AssistantExecutionSettings {
  assistantMaxSteps?: number
  /** 0 表示不单独限制读取次数，仍受模型轮数限制。 */
  assistantMaxReadToolCalls?: number
  /** 0 表示不单独限制搜索次数，仍受模型轮数限制。 */
  assistantMaxSearchToolCalls?: number
}

export const DEFAULT_ASSISTANT_EXECUTION_SETTINGS = {
  assistantMaxSteps: 16,
  assistantMaxReadToolCalls: 0,
  assistantMaxSearchToolCalls: 0
} as const

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback
}

export function normalizeAssistantExecutionSettings(settings?: AssistantExecutionSettings | null): Required<AssistantExecutionSettings> {
  return {
    assistantMaxSteps: normalizeInteger(settings?.assistantMaxSteps, DEFAULT_ASSISTANT_EXECUTION_SETTINGS.assistantMaxSteps, 2, 100),
    assistantMaxReadToolCalls: normalizeInteger(settings?.assistantMaxReadToolCalls, DEFAULT_ASSISTANT_EXECUTION_SETTINGS.assistantMaxReadToolCalls, 0, 200),
    assistantMaxSearchToolCalls: normalizeInteger(settings?.assistantMaxSearchToolCalls, DEFAULT_ASSISTANT_EXECUTION_SETTINGS.assistantMaxSearchToolCalls, 0, 200)
  }
}
