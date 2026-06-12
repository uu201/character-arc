import { streamText, stepCountIs, tool, dynamicTool, jsonSchema } from 'ai'
import { buildSystemPrompt, createModel } from '../provider'
import type { AiRunUsage, AppSettings, AiAgentStreamHandlers, ToolCallTrace } from '../shared-types'
import type { Tool, ToolContext } from './tools/types'

export type RunAgentParams = {
  settings: AppSettings
  systemPrompt: string
  userPrompt: string
  tools: Tool[]
  ctx: ToolContext
  handlers: AiAgentStreamHandlers
  maxTokens?: number
  maxSteps?: number
  disableTools?: boolean
}

export type RunAgentResult = {
  finalText: string
  toolCalls: ToolCallTrace[]
  iterations: number
  usage?: AiRunUsage
}

export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const maxSteps = params.maxSteps ?? 8
  const toolCalls: ToolCallTrace[] = []
  const toolStartTimes = new Map<string, number>()
  let stepCount = 0

  const sdkTools: Record<string, ReturnType<typeof dynamicTool>> = {}
  for (const t of params.tools) {
    sdkTools[t.definition.name] = dynamicTool({
      description: t.definition.description,
      inputSchema: jsonSchema(t.definition.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (input) => {
        const result = await t.handler(input as Record<string, unknown>, params.ctx)
        if (result.isError) {
          throw new Error(result.content)
        }
        return result.content
      }
    })
  }

  params.handlers.onAgentStatus('正在思考...', 1, maxSteps)

  const result = streamText({
    model: createModel(params.settings),
    system: buildSystemPrompt(params.settings, params.systemPrompt),
    prompt: params.userPrompt,
    ...(params.disableTools ? {} : { tools: sdkTools, stopWhen: stepCountIs(maxSteps) }),
    maxOutputTokens: params.maxTokens,
    abortSignal: params.ctx.signal,
    experimental_onToolCallStart: ({ toolCall }) => {
      const id = toolCall.toolCallId
      toolStartTimes.set(id, Date.now())
      params.handlers.onToolUseStart(id, toolCall.toolName, (toolCall.input as Record<string, unknown>) ?? {})
    },
    experimental_onToolCallFinish: (event) => {
      const id = event.toolCall.toolCallId
      const startedAt = toolStartTimes.get(id) ?? Date.now()
      const durationMs = event.durationMs ?? (Date.now() - startedAt)
      const errored = !event.success
      const content = errored
        ? String(event.error ?? '')
        : typeof event.output === 'string' ? event.output : JSON.stringify(event.output ?? '')
      params.handlers.onToolResult(id, event.toolCall.toolName, content.slice(0, 200), errored, durationMs)
      toolCalls.push({
        tool: event.toolCall.toolName,
        args: (event.toolCall.input as Record<string, unknown>) ?? {},
        durationMs,
        status: errored ? 'error' : 'ok',
        ...(errored ? { error: content.slice(0, 240) } : {})
      })
    },
    onStepFinish: () => {
      stepCount++
      if (stepCount < maxSteps) {
        params.handlers.onAgentStatus(`第 ${stepCount + 1} 轮推理...`, stepCount + 1, maxSteps)
      }
    }
  })

  let fullText = ''
  if (params.disableTools) {
    for await (const chunk of result.textStream) {
      fullText += chunk
      params.handlers.onTextDelta(chunk)
    }
    // 某些中转站对非 Claude 模型会把文本放在 reasoning/thinking blocks 里，
    // textStream 拿不到。如果 textStream 为空但有 output tokens，从 fullStream 兜底。
    if (!fullText) {
      const finalText = await result.text
      if (finalText) {
        fullText = finalText
        params.handlers.onTextDelta(finalText)
      }
    }
  } else {
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        fullText += part.text
        params.handlers.onTextDelta(part.text)
      }
    }
  }

  const totalUsage = await result.totalUsage
  const usage: AiRunUsage = {
    promptTokens: Number.isFinite(totalUsage.inputTokens) ? totalUsage.inputTokens : undefined,
    completionTokens: Number.isFinite(totalUsage.outputTokens) ? totalUsage.outputTokens : undefined,
    totalTokens: Number.isFinite(totalUsage.totalTokens) ? totalUsage.totalTokens : undefined,
    reasoningTokens: Number.isFinite(totalUsage.reasoningTokens) ? totalUsage.reasoningTokens : undefined,
    cachedInputTokens: Number.isFinite(totalUsage.cachedInputTokens) ? totalUsage.cachedInputTokens : undefined
  }

  return {
    finalText: fullText,
    toolCalls,
    iterations: stepCount,
    usage: Object.values(usage).some((value) => value !== undefined) ? usage : undefined
  }
}
