import { generateObject, generateText, streamObject, streamText } from 'ai'
import type { LanguageModelUsage } from 'ai'
import type { ZodTypeAny } from 'zod'
import { buildSystemPrompt, createModel, providerSupportsNativeStructuredOutput } from './provider'
import type { AiRunUsage, AppSettings, AiStreamHandlers, PromptPair } from './shared-types'

function useStreamFallback(settings: AppSettings): boolean {
  return settings.provider === 'anthropic'
}

export type AiGenerateOptions = {
  schema?: ZodTypeAny
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

  if (options?.schema && canUseNativeStructuredOutput) {
    if (useStreamFallback(settings)) {
      const result = streamObject({
        model: createModel(settings),
        system,
        prompt: prompt.user,
        schema: options.schema,
        maxOutputTokens: maxTokens,
        abortSignal: signal
      })
      let full = ''
      for await (const chunk of result.textStream) {
        full += chunk
      }
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
      abortSignal: signal
    })
    return {
      text: JSON.stringify(result.object),
      usage: toAiRunUsage(result.usage)
    }
  }

  if (useStreamFallback(settings)) {
    const result = streamText({
      model: createModel(settings),
      system,
      prompt: prompt.user,
      maxOutputTokens: maxTokens,
      abortSignal: signal
    })
    let full = ''
    for await (const chunk of result.textStream) {
      full += chunk
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
  const result = streamText({
    model: createModel(settings),
    system: buildSystemPrompt(settings, prompt.system),
    prompt: prompt.user,
    maxOutputTokens: maxTokens,
    abortSignal: signal
  })
  let full = ''
  for await (const chunk of result.textStream) {
    full += chunk
    handlers.onTextDelta(chunk)
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

  const result = streamObject({
    model: createModel(settings),
    system: buildSystemPrompt(settings, prompt.system),
    prompt: prompt.user,
    schema,
    maxOutputTokens: maxTokens,
    abortSignal: signal
  })

  let full = ''
  for await (const chunk of result.textStream) {
    full += chunk
    handlers.onTextDelta(chunk)
  }

  return {
    text: full,
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
