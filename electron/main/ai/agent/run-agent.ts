import { streamText, stepCountIs, dynamicTool, jsonSchema } from 'ai'
import { buildSystemPrompt, createModel } from '../provider'
import type { AiRunUsage, AppSettings, AiAgentStreamHandlers, ToolCallTrace } from '../shared-types'
import type { Tool, ToolContext } from './tools/types'
import { stripReasoningMarkup } from '../reasoning'
import { isAiStreamIdleTimeoutError } from '../sse'
import { resolveSamplingOptions } from '../request-options'

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

type AgentToolCallStartEvent = {
  toolCall: {
    toolCallId: string
    toolName: string
    input: unknown
  }
}

type AgentToolCallFinishEvent = AgentToolCallStartEvent & {
  durationMs?: number
  success: boolean
  output?: unknown
  error?: unknown
}

function shouldSynthesizeFinalAnswer(input: {
  disableTools?: boolean
  finalStepText: string
  finalStepHasToolCalls: boolean
  toolCallCount: number
  aborted: boolean
}): boolean {
  return !input.disableTools
    && input.toolCallCount > 0
    && (input.finalStepHasToolCalls || !input.finalStepText.trim())
    && !input.aborted
}

/**
 * 稳定序列化工具参数：键按字典序排序，让 `{a:1,b:2}` 与 `{b:2,a:1}` 得到同一指纹，
 * 用于识别「同工具 + 同参数」的重复调用。
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** 合并两段 usage，逐字段相加（任一为 undefined 时取另一方）。 */
function mergeUsage(a: AiRunUsage | undefined, b: AiRunUsage | undefined): AiRunUsage | undefined {
  if (!a) return b
  if (!b) return a
  const sum = (x?: number, y?: number): number | undefined =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0)
  return {
    promptTokens: sum(a.promptTokens, b.promptTokens),
    completionTokens: sum(a.completionTokens, b.completionTokens),
    totalTokens: sum(a.totalTokens, b.totalTokens),
    reasoningTokens: sum(a.reasoningTokens, b.reasoningTokens),
    cachedInputTokens: sum(a.cachedInputTokens, b.cachedInputTokens)
  }
}

export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const maxSteps = params.maxSteps ?? 8
  const toolCalls: ToolCallTrace[] = []
  const toolStartTimes = new Map<string, number>()
  let stepCount = 0

  // 记录已执行过的「工具+参数」指纹及其结果，命中重复时直接回灌旧结果，
  // 避免模型反复读同一份数据空烧步数。
  const seenToolResults = new Map<string, string>()
  const toolObservations: Array<{ tool: string; args: Record<string, unknown>; content: string }> = []

  const sdkTools: Record<string, ReturnType<typeof dynamicTool>> = {}
  for (const t of params.tools) {
    sdkTools[t.definition.name] = dynamicTool({
      description: t.definition.description,
      inputSchema: jsonSchema(t.definition.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (input) => {
        const args = (input as Record<string, unknown>) ?? {}
        const fingerprint = `${t.definition.name}:${stableStringify(args)}`
        const cached = seenToolResults.get(fingerprint)
        if (cached !== undefined) {
          return `（此调用「${t.definition.name}」已用相同参数执行过，结果见上文，无需重复调用。请基于已有结果继续。）\n\n${cached}`
        }
        const result = await t.handler(args, params.ctx)
        if (result.isError) {
          toolObservations.push({ tool: t.definition.name, args, content: `工具执行失败：${result.content}` })
          throw new Error(result.content)
        }
        seenToolResults.set(fingerprint, result.content)
        toolObservations.push({ tool: t.definition.name, args, content: result.content })
        return result.content
      }
    })
  }

  params.handlers.onAgentStatus('正在思考...', 1, maxSteps)

  const onToolCallStart = ({ toolCall }: AgentToolCallStartEvent): void => {
    const id = toolCall.toolCallId
    toolStartTimes.set(id, Date.now())
    params.handlers.onToolUseStart(id, toolCall.toolName, (toolCall.input as Record<string, unknown>) ?? {})
  }
  const onToolCallFinish = (event: AgentToolCallFinishEvent): void => {
    const id = event.toolCall.toolCallId
    const startedAt = toolStartTimes.get(id) ?? Date.now()
    const durationMs = event.durationMs ?? (Date.now() - startedAt)
    const errored = !event.success
    const content = errored
      ? String(event.error ?? '')
      : typeof event.output === 'string' ? event.output : JSON.stringify(event.output ?? '')
    params.handlers.onToolResult(id, event.toolCall.toolName, content.slice(0, 800), errored, durationMs)
    toolCalls.push({
      tool: event.toolCall.toolName,
      args: (event.toolCall.input as Record<string, unknown>) ?? {},
      durationMs,
      status: errored ? 'error' : 'ok',
      ...(errored ? { error: content.slice(0, 240) } : {})
    })
  }
  const onStepFinish = (): void => {
    stepCount++
    if (stepCount < maxSteps) {
      params.handlers.onAgentStatus(`第 ${stepCount + 1} 轮推理...`, stepCount + 1, maxSteps)
    }
  }

  let fullText = ''
  let firstAttemptReasoning = ''

  const startStream = (
    onReasoningDelta: (delta: string) => void,
    captureError: (error: unknown) => void
  ) => streamText({
    model: createModel(params.settings),
    system: buildSystemPrompt(params.settings, params.systemPrompt),
    prompt: params.userPrompt,
    ...resolveSamplingOptions(params.settings),
    ...(params.disableTools ? {} : { tools: sdkTools, stopWhen: stepCountIs(maxSteps) }),
    abortSignal: params.ctx.signal,
    onError: ({ error }) => captureError(error),
    experimental_onToolCallStart: onToolCallStart,
    experimental_onToolCallFinish: onToolCallFinish,
    onStepFinish
  })

  let result: ReturnType<typeof startStream> | null = null

  // 免费 API 偶尔会在 reasoning 阶段留下半开 SSE。连续无数据时仅在尚未产生
  // 正文或工具调用的前提下重试一次，避免重复执行工具或拼接两份正文。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let streamError: unknown = null
    let retryReasoningLength = 0
    const onReasoningDelta = (delta: string): void => {
      if (attempt === 0) {
        firstAttemptReasoning += delta
        params.handlers.onReasoningDelta?.(delta)
        return
      }

      const previousLength = retryReasoningLength
      retryReasoningLength += delta.length
      const visibleStart = Math.max(previousLength, firstAttemptReasoning.length)
      if (retryReasoningLength > visibleStart) {
        params.handlers.onReasoningDelta?.(delta.slice(visibleStart - previousLength))
      }
    }

    const currentResult = startStream(onReasoningDelta, (error) => { streamError = error })

    try {
      // fullStream 同时承载推理、正文、工具与错误，避免 reasoning 阶段界面无反馈。
      for await (const part of currentResult.fullStream) {
        if (part.type === 'reasoning-delta') {
          onReasoningDelta(part.text)
        } else if (part.type === 'text-delta') {
          fullText += part.text
          params.handlers.onTextDelta(part.text)
        } else if (part.type === 'error') {
          throw part.error
        }
      }
      if (streamError) throw streamError
      result = currentResult
      break
    } catch (error) {
      const canRetry = attempt === 0
        && isAiStreamIdleTimeoutError(error)
        && !params.ctx.signal.aborted
        && !fullText
        && toolCalls.length === 0
        && toolStartTimes.size === 0
      if (!canRetry) throw error
      params.handlers.onAgentStatus('流式连接中断，正在自动重试...', 1, maxSteps)
    }
  }

  if (!result) {
    throw new Error('AI 流式请求重试后仍未返回结果。')
  }

  // 若流式事件没拿到正文、但 SDK 在响应结束后汇总出了 text，回灌最终结果。
  if (!fullText) {
    try {
      const finalText = await result.text
      if (finalText) {
        fullText = finalText
        params.handlers.onTextDelta(finalText)
      }
    } catch {
      // 忽略：让下方 finishReason 逻辑决定报错还是返回空
    }
  }

  fullText = stripReasoningMarkup(fullText)
  const finishReason = await result.finishReason
  const steps = await result.steps
  const finalStep = steps.at(-1)
  const finalStepText = stripReasoningMarkup(finalStep?.text ?? '')
  const finalStepHasToolCalls = (finalStep?.toolCalls.length ?? 0) > 0

  let usage: AiRunUsage = toUsage(await result.totalUsage)
  // 部分中转站在带 tools 时会返回工具结果和 output tokens，却丢失最终 text delta，
  // 且 finishReason 不一定是 tool-calls。最后一步仍在调工具或没有正文时，就禁用工具收尾。
  // 收尾只传纯文本工具结果，避免再次触发 Responses / Chat 工具消息转换兼容问题。
  if (shouldSynthesizeFinalAnswer({
    disableTools: params.disableTools,
    finalStepText,
    finalStepHasToolCalls,
    toolCallCount: toolCalls.length,
    aborted: params.ctx.signal.aborted
  })) {
    const synthesis = await synthesizeFinalAnswer(params, toolObservations, (delta) => {
      fullText += delta
      params.handlers.onTextDelta(delta)
    })
    usage = mergeUsage(usage, synthesis.usage) ?? usage
  }

  // 推理模型可能把输出预算全用在推理 token 上，导致 finish_reason=length 且可见文本为空。
  // 此时静默返回空文本会让上层误判为成功并显示兜底语，必须显式报错引导用户。
  if (!fullText.trim() && finishReason === 'length') {
    const reasoningTokens = usage.reasoningTokens ?? 0
    throw new Error(
      reasoningTokens > 0
        ? `模型服务端截断了输出：${reasoningTokens} 个推理 token 已耗尽输出预算，未产生可见回复。请改用非推理模型或输出能力更强的模型。`
        : '模型服务端截断了输出（finish_reason=length），未产生可见回复。请改用输出能力更强的模型后重试。'
    )
  }

  // 步数耗尽且收尾后仍无有效正文：显式报错，不再静默返回空让上层显示兜底语。
  if (!fullText.trim() && finishReason === 'tool-calls') {
    throw new Error(
      `Agent 在 ${maxSteps} 步内未能产出最终答案（工具调用次数达上限）。请简化请求，或在设置中提高步数上限后重试。`
    )
  }

  return {
    finalText: fullText,
    toolCalls,
    iterations: stepCount,
    usage: Object.values(usage).some((value) => value !== undefined) ? usage : undefined
  }
}

/** 把 SDK 的 LanguageModelUsage 映射为内部 AiRunUsage。 */
function toUsage(totalUsage: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}): AiRunUsage {
  return {
    promptTokens: Number.isFinite(totalUsage.inputTokens) ? totalUsage.inputTokens : undefined,
    completionTokens: Number.isFinite(totalUsage.outputTokens) ? totalUsage.outputTokens : undefined,
    totalTokens: Number.isFinite(totalUsage.totalTokens) ? totalUsage.totalTokens : undefined,
    reasoningTokens: Number.isFinite(totalUsage.reasoningTokens) ? totalUsage.reasoningTokens : undefined,
    cachedInputTokens: Number.isFinite(totalUsage.cachedInputTokens) ? totalUsage.cachedInputTokens : undefined
  }
}

/**
 * 工具调用后的收尾调用：禁用工具，把原始问题 + 已产生的工具结果交回模型，
 * 要求其基于已收集的信息直接产出最终答案。文本通过 onDelta 实时回灌。
 */
async function synthesizeFinalAnswer(
  params: RunAgentParams,
  observations: Array<{ tool: string; args: Record<string, unknown>; content: string }>,
  onDelta: (delta: string) => void
): Promise<{ text: string; usage?: AiRunUsage }> {
  params.handlers.onAgentStatus('正在整理最终答案...', params.maxSteps ?? 8, params.maxSteps ?? 8)

  const observationText = observations.length > 0
    ? observations.map((item, index) => [
        `### 工具结果 ${index + 1}：${item.tool}`,
        `参数：${stableStringify(item.args)}`,
        item.content
      ].join('\n')).join('\n\n')
    : '工具已执行，但没有返回可用结果。'

  const result = streamText({
    model: createModel(params.settings),
    system: buildSystemPrompt(params.settings, params.systemPrompt),
    prompt: [
      params.userPrompt,
      '以下是本轮已经收集到的工具结果，仅作为回答依据：',
      observationText,
      '请不要调用任何工具，直接给出完整的最终答案，并严格满足任务要求的输出格式。'
    ].join('\n\n'),
    ...resolveSamplingOptions(params.settings),
    abortSignal: params.ctx.signal
  })

  let text = ''
  for await (const part of result.fullStream) {
    if (part.type === 'reasoning-delta') {
      params.handlers.onReasoningDelta?.(part.text)
    } else if (part.type === 'text-delta') {
      text += part.text
      onDelta(part.text)
    } else if (part.type === 'error') {
      throw part.error
    }
  }

  // 流式事件缺失时，从 SDK 汇总的最终 text 兜底。
  if (!text) {
    const finalText = await result.text
    if (finalText) {
      text = finalText
      onDelta(finalText)
    }
  }

  return { text, usage: toUsage(await result.totalUsage) }
}
