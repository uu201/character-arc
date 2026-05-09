import type { AppSettings, AiStreamHandlers, PromptPair } from '../shared-types'
import type { AgentRequestParams, AgentResponse } from '../agent/tools/types'
import { requestOpenAiCompatible, requestOpenAiCompatibleStream, requestOpenAiCompatibleWithTools } from './openai-compat'
import { requestAnthropic, requestAnthropicStream, requestAnthropicWithTools } from './anthropic'
export { fetchModels, fetchImageModels, type FetchedModel } from './models'
export { generateImage, type GeneratedImageResult } from './images'

export type StructuredOutputMode = 'json_object' | 'tool_use' | 'prompt_only'

export type StructuredOutputOptions = {
  mode: StructuredOutputMode
}

export async function requestAiText(
  settings: AppSettings,
  prompt: PromptPair,
  maxTokens?: number,
  structured?: StructuredOutputOptions
): Promise<string> {
  return settings.provider === 'anthropic'
    ? requestAnthropic(settings, prompt, maxTokens)
    : requestOpenAiCompatible(settings, prompt, maxTokens, structured)
}

export async function requestAiTextStream(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  maxTokens?: number
): Promise<string> {
  return settings.provider === 'anthropic'
    ? requestAnthropicStream(settings, prompt, handlers, signal, maxTokens)
    : requestOpenAiCompatibleStream(settings, prompt, handlers, signal, maxTokens)
}

/**
 * Provider-neutral tool-aware request.
 * Used by the agent loop to drive multi-turn tool calling.
 * Streaming intentionally not supported here: middle turns (tool_use)
 * stream as partial JSON which is not useful to the renderer.
 */
export async function requestAiWithTools(
  settings: AppSettings,
  params: AgentRequestParams,
  signal?: AbortSignal
): Promise<AgentResponse> {
  return settings.provider === 'anthropic'
    ? requestAnthropicWithTools(settings, params, signal)
    : requestOpenAiCompatibleWithTools(settings, params, signal)
}

/**
 * Whether the provider's API surface supports tool calling.
 * Anthropic Messages API has native tool_use; most OpenAI-compat
 * gateways pass `tools` through to a backend that supports them.
 * Local Ollama varies by model — default to false to avoid surprising
 * users; the agent orchestrator falls back to the legacy single-shot
 * path when this returns false.
 */
export function providerSupportsTools(settings: AppSettings): boolean {
  if (settings.provider === 'anthropic') return true
  if (settings.provider === 'ollama') return false
  return true
}
