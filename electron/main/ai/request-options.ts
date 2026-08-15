import type { AppSettings } from './shared-types'

export type AiProviderOptions = {
  openai?: {
    reasoningEffort: 'none'
  }
  openaiCompatible?: {
    reasoningEffort: 'low'
  }
}

function isChatProtocolForSampling(settings: AppSettings): boolean {
  if (settings.apiProtocol === 'openai-chat') return true
  if (settings.apiProtocol && settings.apiProtocol !== 'auto') return false

  const provider = settings.provider.trim().toLowerCase()
  const model = settings.model.trim().toLowerCase()
  if (provider === 'openai' || provider === 'anthropic') return false
  if (provider === 'opencode-go') {
    if (/^gpt-5\.6-luna(?:[.-]|$)/.test(model) || /^(minimax-|qwen3(?:[.-]|$))/.test(model)) return false
  }
  if (provider === 'opencode-zen') {
    if (/^(claude-|qwen3(?:[.-]|$)|gpt-|grok-)/.test(model)) return false
  }
  return true
}

export function resolveSamplingOptions(settings: AppSettings): {
  temperature?: number
  topP?: number
  presencePenalty?: number
  frequencyPenalty?: number
} {
  if (isOpenAIReasoningChatModel(settings)) {
    return {}
  }

  const options: {
    temperature?: number
    topP?: number
    presencePenalty?: number
    frequencyPenalty?: number
  } = {
    temperature: typeof settings.temperature === 'number' && Number.isFinite(settings.temperature) ? settings.temperature : undefined,
    topP: typeof settings.topP === 'number' && Number.isFinite(settings.topP) ? settings.topP : undefined
  }

  if (isChatProtocolForSampling(settings)) {
    options.presencePenalty = typeof settings.presencePenalty === 'number' && Number.isFinite(settings.presencePenalty)
      ? settings.presencePenalty
      : undefined
    options.frequencyPenalty = typeof settings.frequencyPenalty === 'number' && Number.isFinite(settings.frequencyPenalty)
      ? settings.frequencyPenalty
      : undefined
  }

  return options
}

export function isOpenAIReasoningChatModel(settings: AppSettings): boolean {
  const model = settings.model?.trim().toLowerCase() || ''
  return /^(gpt-5|o1|o3|o4-mini)/.test(model)
}

export function resolveProviderOptions(
  settings: AppSettings,
  options?: { disableReasoning?: boolean; preferLowReasoning?: boolean }
): AiProviderOptions | undefined {
  if (
    options?.preferLowReasoning
    && isOpenCodeReasoningChatModel(settings)
  ) {
    return {
      openaiCompatible: {
        reasoningEffort: 'low'
      }
    }
  }

  if (
    !options?.disableReasoning
    || settings.provider !== 'openai'
    || !isOpenAIReasoningChatModel(settings)
  ) {
    return undefined
  }

  return {
    openai: {
      reasoningEffort: 'none'
    }
  }
}

export function isOpenCodeReasoningChatModel(settings: AppSettings): boolean {
  const provider = settings.provider.trim().toLowerCase()
  if (provider !== 'opencode-zen' && provider !== 'opencode-go') {
    return false
  }

  const model = settings.model?.trim().toLowerCase() || ''
  if (/^(claude-|qwen3(?:[.-]|$)|gpt-|grok-)/.test(model)) return false
  return /^(deepseek-v4|minimax-|mimo-|glm-|kimi-|nemotron-)/.test(model)
}
