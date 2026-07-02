import { streamText, stepCountIs, dynamicTool, jsonSchema } from 'ai'
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

/** 步数耗尽收尾后，可见正文仍低于此长度则视为「未产出有效答案」。 */
const MIN_USEFUL_TEXT_LENGTH = 8

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
          throw new Error(result.content)
        }
        seenToolResults.set(fingerprint, result.content)
        return result.content
      }
    })
  }

  params.handlers.onAgentStatus('正在思考...', 1, maxSteps)

  // streamText 默认不抛流错误，仅通过 onError 暴露；捕获后在消费流时重抛，确保错误能上报到 UI。
  let streamError: unknown = null
  const result = streamText({
    model: createModel(params.settings, params.handlers.onReasoningDelta),
    system: buildSystemPrompt(params.settings, params.systemPrompt),
    prompt: params.userPrompt,
    ...(params.disableTools ? {} : { tools: sdkTools, stopWhen: stepCountIs(maxSteps) }),
    maxOutputTokens: params.maxTokens,
    abortSignal: params.ctx.signal,
    onError: ({ error }) => { streamError = error },
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
    // 推理模型（如 mimo、deepseek-r1）会先输出 reasoning，再输出正文。
    // 走 fullStream 才能拿到 reasoning-delta，让思考过程实时可见，否则首字前界面长时间无反馈。
    for await (const part of result.fullStream) {
      if (part.type === 'reasoning-delta') {
        params.handlers.onReasoningDelta?.(part.text)
      } else if (part.type === 'text-delta') {
        fullText += part.text
        params.handlers.onTextDelta(part.text)
      } else if (part.type === 'error') {
        // fullStream 把流式错误作为 error part 发出而不抛异常，必须显式抛出，
        // 否则错误会被静默吞掉、上层无法感知（如中转站 503「No available accounts」）。
        throw part.error
      }
    }
  } else {
    for await (const part of result.fullStream) {
      if (part.type === 'reasoning-delta') {
        params.handlers.onReasoningDelta?.(part.text)
      } else if (part.type === 'text-delta') {
        fullText += part.text
        params.handlers.onTextDelta(part.text)
      } else if (part.type === 'error') {
        throw part.error
      }
    }
  }

  // 兜底：若错误未以 error part 形式出现而是走了 onError，这里重抛。
  if (streamError) throw streamError

  // 流式正文兜底（两个分支共用）：
  //   - 推理模型可能把内容塞进 reasoning/thinking blocks，textStream 拿不到
  //   - 部分 openai-compatible 中转站在带 tools 时不吐 text-delta，
  //     只把正文放到最终 response 里
  // 若流式没拿到文本但最终结果有，就把它一次性回灌进来。
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

  const finishReason = await result.finishReason

  let usage: AiRunUsage = toUsage(await result.totalUsage)


  // 步数耗尽收尾：finishReason='tool-calls' 说明模型还想继续调工具但已撞上 maxSteps，
  // 此时最后一步往往是工具调用、可见正文为空或残缺。不报错也不返回残缺，
  // 而是禁用工具再调一次，让模型基于已收集的工具结果直接产出完整答案。
  if (
    !params.disableTools
    && finishReason === 'tool-calls'
    && fullText.trim().length < MIN_USEFUL_TEXT_LENGTH
    && !params.ctx.signal.aborted
  ) {
    const priorMessages = (await result.response).messages
    const synthesis = await synthesizeFinalAnswer(params, priorMessages, (delta) => {
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
        ? `模型输出被截断：${reasoningTokens} 个推理 token 已耗尽输出预算，未产生可见回复。请在设置中提高输出上限，或改用非推理模型。`
        : '模型输出被截断（finish_reason=length），未产生可见回复。请提高输出上限后重试。'
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
 * 步数耗尽后的收尾调用：禁用工具，把原始对话 + 已产生的工具结果交回模型，
 * 要求其基于已收集的信息直接产出最终答案。文本通过 onDelta 实时回灌。
 */
async function synthesizeFinalAnswer(
  params: RunAgentParams,
  priorMessages: Awaited<ReturnType<typeof streamText>['response']>['messages'],
  onDelta: (delta: string) => void
): Promise<{ text: string; usage?: AiRunUsage }> {
  params.handlers.onAgentStatus('正在整理最终答案...', params.maxSteps ?? 8, params.maxSteps ?? 8)

  const result = streamText({
    model: createModel(params.settings, params.handlers.onReasoningDelta),
    system: buildSystemPrompt(params.settings, params.systemPrompt),
    messages: [
      { role: 'user', content: params.userPrompt },
      ...priorMessages,
      {
        role: 'user',
        content: '工具调用次数已达上限。请不要再调用任何工具，基于上面已经收集到的信息，现在直接给出完整的最终答案，并严格满足任务要求的输出格式。'
      }
    ],
    maxOutputTokens: params.maxTokens,
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

  // 中转站可能把正文塞进 reasoning block，textStream 取不到时从最终结果兜底。
  if (!text) {
    const finalText = await result.text
    if (finalText) {
      text = finalText
      onDelta(finalText)
    }
  }

  return { text, usage: toUsage(await result.totalUsage) }
}
