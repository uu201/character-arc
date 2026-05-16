import type { AppSettings, AiAgentStreamHandlers, ToolCallTrace } from '../shared-types'
import { AGENT_STREAM_MAX_ITERATIONS } from '../shared-types'
import { requestAiWithTools } from '../transport'
import type { AgentMessage, AssistantContentBlock, ToolResultBlock } from './tools/types'
import { isTextBlock, isToolUseBlock } from './tools/types'
import { dispatchTool, listToolDefinitions, type ToolRegistry } from './tools/registry'

export type StreamingAgentLoopParams = {
  settings: AppSettings
  systemPrompt: string
  userPrompt: string
  messages?: AgentMessage[]
  registry: ToolRegistry
  ctx: { signal: AbortSignal; projectId: string }
  handlers: AiAgentStreamHandlers
  maxTokens?: number
  maxIterations?: number
}

export type StreamingAgentLoopResult = {
  finalText: string
  toolCalls: ToolCallTrace[]
  iterations: number
}

export async function runStreamingAgentLoop(params: StreamingAgentLoopParams): Promise<StreamingAgentLoopResult> {
  const maxIterations = params.maxIterations ?? AGENT_STREAM_MAX_ITERATIONS
  const tools = listToolDefinitions(params.registry)
  const messages: AgentMessage[] = params.messages
    ? [...params.messages]
    : [{ role: 'user', content: params.userPrompt }]
  const toolCalls: ToolCallTrace[] = []

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (params.ctx.signal.aborted) throw new Error('canceled')

    params.handlers.onAgentStatus(
      iteration === 1 ? '正在思考...' : `第 ${iteration} 轮推理...`,
      iteration,
      maxIterations
    )

    const response = await requestAiWithTools(
      params.settings,
      { system: params.systemPrompt, messages, tools, maxTokens: params.maxTokens },
      params.ctx.signal
    )

    const toolUses = response.contentBlocks.filter(isToolUseBlock)
    const hasNoTools = toolUses.length === 0

    if (response.stopReason === 'end_turn' || hasNoTools) {
      const finalText = extractText(response.contentBlocks)
      if (finalText) {
        params.handlers.onTextDelta(finalText)
      }
      return { finalText, toolCalls, iterations: iteration }
    }

    const textBeforeTools = extractText(response.contentBlocks)
    if (textBeforeTools) {
      params.handlers.onTextDelta(textBeforeTools + '\n\n')
    }

    messages.push({ role: 'assistant', content: response.contentBlocks })

    const toolResults: ToolResultBlock[] = []
    for (const toolUse of toolUses) {
      if (params.ctx.signal.aborted) throw new Error('canceled')

      params.handlers.onToolUseStart(toolUse.id, toolUse.name, toolUse.input ?? {})
      const startedAt = Date.now()

      const result = await dispatchTool(params.registry, toolUse, params.ctx)
      const durationMs = Date.now() - startedAt

      params.handlers.onToolResult(
        toolUse.id,
        toolUse.name,
        result.content.slice(0, 200),
        Boolean(result.isError),
        durationMs
      )

      const trace: ToolCallTrace = {
        tool: toolUse.name,
        args: toolUse.input ?? {},
        durationMs,
        status: result.isError ? 'error' : 'ok',
        ...(result.isError ? { error: result.content.slice(0, 240) } : {})
      }
      toolCalls.push(trace)
      toolResults.push(result)
    }

    messages.push({ role: 'user', content: toolResults })
  }

  const finalText = '（已达到最大推理轮数，停止执行）'
  params.handlers.onTextDelta(finalText)
  return { finalText, toolCalls, iterations: maxIterations }
}

function extractText(blocks: AssistantContentBlock[]): string {
  return blocks.filter(isTextBlock).map((b) => b.text).join('').trim()
}
