import { generateObject, generateText, streamObject, streamText } from 'ai'
import type { LanguageModelUsage } from 'ai'
import type { ZodTypeAny } from 'zod'
import { buildSystemPrompt, createModel, providerSupportsNativeStructuredOutput } from './provider'
import type { AiRunUsage, AppSettings, AiStreamHandlers, PromptPair } from './shared-types'

function useStreamFallback(settings: AppSettings): boolean {
  return settings.provider === 'anthropic'
}

function useOpenAIChatCompatibility(settings: AppSettings): boolean {
  const provider = settings.provider?.trim().toLowerCase() || ''
  const model = settings.model?.trim().toLowerCase() || ''
  if (provider === 'openai' || provider === 'anthropic') {
    return false
  }
  return /^(gpt-5|o1|o3|o4-mini)/.test(model)
}

type AiProviderOptions = Parameters<typeof generateText>[0]['providerOptions']

function resolveSamplingOptions(settings: AppSettings): { temperature?: number; topP?: number } {
  return {
    temperature: typeof settings.temperature === 'number' && Number.isFinite(settings.temperature) ? settings.temperature : undefined,
    topP: typeof settings.topP === 'number' && Number.isFinite(settings.topP) ? settings.topP : undefined
  }
}

function resolveProviderOptions(settings: AppSettings, options?: AiGenerateOptions): AiProviderOptions | undefined {
  const useCompatibilityOptions = useOpenAIChatCompatibility(settings)
  if (!useCompatibilityOptions && !options?.disableReasoning) {
    return undefined
  }

  return {
    openai: {
      forceReasoning: useCompatibilityOptions ? false : undefined,
      reasoningEffort: options?.disableReasoning ? 'none' : undefined,
      systemMessageMode: useCompatibilityOptions ? 'system' : undefined
    }
  }
}

export type AiGenerateOptions = {
  schema?: ZodTypeAny
  disableReasoning?: boolean
}

export type AiTextGenerationResult = {
  text: string
  usage?: AiRunUsage
}

function toAiRunUsage(usage?: LanguageModelUsage): AiRunUsage | undefined {
  if (!usage) {
    return undefined
  }

  const normalized: AiRunUsage = {
    promptTokens: Number.isFinite(usage.inputTokens) ? usage.inputTokens : undefined,
    completionTokens: Number.isFinite(usage.outputTokens) ? usage.outputTokens : undefined,
    totalTokens: Number.isFinite(usage.totalTokens) ? usage.totalTokens : undefined,
    reasoningTokens: Number.isFinite(usage.reasoningTokens) ? usage.reasoningTokens : undefined,
    cachedInputTokens: Number.isFinite(usage.cachedInputTokens) ? usage.cachedInputTokens : undefined
  }

  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined
}

export function addAiRunUsage(left?: AiRunUsage, right?: AiRunUsage): AiRunUsage | undefined {
  if (!left) return right
  if (!right) return left

  const add = (a?: number, b?: number): number | undefined => {
    const safeA = typeof a === 'number' && Number.isFinite(a) ? a : undefined
    const safeB = typeof b === 'number' && Number.isFinite(b) ? b : undefined

    if (safeA === undefined && safeB === undefined) {
      return undefined
    }
    return (safeA ?? 0) + (safeB ?? 0)
  }

  const merged: AiRunUsage = {
    promptTokens: add(left.promptTokens, right.promptTokens),
    completionTokens: add(left.completionTokens, right.completionTokens),
    totalTokens: add(left.totalTokens, right.totalTokens),
    reasoningTokens: add(left.reasoningTokens, right.reasoningTokens),
    cachedInputTokens: add(left.cachedInputTokens, right.cachedInputTokens)
  }

  return Object.values(merged).some((value) => value !== undefined) ? merged : undefined
}

export async function aiGenerateTextWithUsage(
  settings: AppSettings,
  prompt: PromptPair,
  maxTokens?: number,
  signal?: AbortSignal,
  options?: AiGenerateOptions
): Promise<AiTextGenerationResult> {
  const system = buildSystemPrompt(settings, prompt.system)
  const canUseNativeStructuredOutput = providerSupportsNativeStructuredOutput(settings)
  const providerOptions = resolveProviderOptions(settings, options)
  const samplingOptions = resolveSamplingOptions(settings)

  if (options?.schema && canUseNativeStructuredOutput) {
    if (useStreamFallback(settings)) {
      // AI SDK v6 的 streamObject/streamText 默认不在流错误时抛异常：textStream 会静默结束，
      // 错误只通过 onError 回调暴露。必须捕获并重抛，否则中转站 503 等错误会被吞掉、UI 无提示。
      let streamError: unknown = null
      const result = streamObject({
        model: createModel(settings),
        system,
        prompt: prompt.user,
        schema: options.schema,
        maxOutputTokens: maxTokens,
        ...samplingOptions,
        providerOptions,
        abortSignal: signal,
        onError: ({ error }) => { streamError = error }
      })
      let full = ''
      for await (const chunk of result.textStream) {
        full += chunk
      }
      if (streamError) throw streamError
      return {
        text: full || JSON.stringify(await result.object),
        usage: toAiRunUsage(await result.usage)
      }
    }
    const result = await generateObject({
      model: createModel(settings),
      system,
      prompt: prompt.user,
      schema: options.schema,
      maxOutputTokens: maxTokens,
      ...samplingOptions,
      providerOptions,
      abortSignal: signal
    })
    return {
      text: JSON.stringify(result.object),
      usage: toAiRunUsage(result.usage)
    }
  }

  if (useStreamFallback(settings)) {
    let streamError: unknown = null
    const result = streamText({
      model: createModel(settings),
      system,
      prompt: prompt.user,
      maxOutputTokens: maxTokens,
      ...samplingOptions,
      providerOptions,
      abortSignal: signal,
      onError: ({ error }) => { streamError = error }
    })
    let full = ''
    for await (const chunk of result.textStream) {
      full += chunk
    }
    if (streamError) throw streamError
    if (!full) {
      full = await result.text
    }
    return {
      text: full,
      usage: toAiRunUsage(await result.totalUsage)
    }
  }

  const result = await generateText({
    model: createModel(settings),
    system,
    prompt: prompt.user,
    maxOutputTokens: maxTokens,
    ...samplingOptions,
    providerOptions,
    abortSignal: signal
  })
  return {
    text: result.text,
    usage: toAiRunUsage(result.usage)
  }
}

export async function aiGenerateText(
  settings: AppSettings,
  prompt: PromptPair,
  maxTokens?: number,
  signal?: AbortSignal,
  options?: AiGenerateOptions
): Promise<string> {
  const result = await aiGenerateTextWithUsage(settings, prompt, maxTokens, signal, options)
  return result.text
}

export async function aiStreamTextWithUsage(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  maxTokens?: number
): Promise<AiTextGenerationResult> {
  const providerOptions = resolveProviderOptions(settings)
  const samplingOptions = resolveSamplingOptions(settings)
  let streamError: unknown = null
  // 推理模型（mimo / deepseek-r1 / 智谱 GLM-Z1 等）通过非标准 reasoning_content 字段
  // 返回思考内容，AI SDK 不解析。这里把回调注入到自定义 fetch，由其在 SSE 流中拦截。
  const result = streamText({
    model: createModel(settings, handlers.onReasoningDelta),
    system: buildSystemPrompt(settings, prompt.system),
    prompt: prompt.user,
    maxOutputTokens: maxTokens,
    ...samplingOptions,
    providerOptions,
    abortSignal: signal,
    onError: ({ error }) => { streamError = error }
  })
  let full = ''
  // 推理模型（如 mimo、deepseek-r1）会先输出 reasoning，再输出正文。
  // 走 fullStream 才能拿到 reasoning-delta，让思考过程实时可见，否则首字前界面长时间无反馈。
  for await (const part of result.fullStream) {
    if (part.type === 'reasoning-delta') {
      handlers.onReasoningDelta?.(part.text)
    } else if (part.type === 'text-delta') {
      full += part.text
      handlers.onTextDelta(part.text)
    } else if (part.type === 'error') {
      // fullStream 把流式错误作为 error part 发出而不抛异常，必须显式抛出
      throw part.error
    }
  }
  if (streamError) throw streamError
  // 某些中转站对非 Claude 模型会把文本放在 reasoning/thinking blocks 里，
  // textStream 拿不到。如果流式正文为空但有 output tokens，从最终结果兜底。
  if (!full) {
    const fallbackText = await result.text
    if (fallbackText) {
      full = fallbackText
      handlers.onTextDelta(fallbackText)
    }
  }
  return {
    text: full,
    usage: toAiRunUsage(await result.totalUsage)
  }
}

export async function aiStreamObjectWithUsage(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  schema: ZodTypeAny,
  maxTokens?: number
): Promise<AiTextGenerationResult> {
  if (!providerSupportsNativeStructuredOutput(settings)) {
    return aiStreamTextWithUsage(settings, prompt, handlers, signal, maxTokens)
  }

  let streamError: unknown = null
  const samplingOptions = resolveSamplingOptions(settings)
  const result = streamObject({
    model: createModel(settings, handlers.onReasoningDelta),
    system: buildSystemPrompt(settings, prompt.system),
    prompt: prompt.user,
    schema,
    maxOutputTokens: maxTokens,
    ...samplingOptions,
    providerOptions: resolveProviderOptions(settings),
    abortSignal: signal,
    onError: ({ error }) => { streamError = error }
  })

  let full = ''
  for await (const chunk of result.textStream) {
    full += chunk
    handlers.onTextDelta(chunk)
  }
  if (streamError) throw streamError
  let objectText = ''
  try {
    objectText = JSON.stringify(await result.object)
  } catch {
    objectText = ''
  }

  return {
    text: objectText || full,
    usage: toAiRunUsage(await result.usage)
  }
}

export async function aiStreamText(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  maxTokens?: number
): Promise<string> {
  const result = await aiStreamTextWithUsage(settings, prompt, handlers, signal, maxTokens)
  return result.text
}
