import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { AppSettings } from './shared-types'

const ANTHROPIC_PROMPT_CACHE = {
  type: 'ephemeral' as const,
  ttl: '5m' as const
}

function isOfficialOpenAIProvider(settings: AppSettings): boolean {
  return settings.provider === 'openai'
}

function isDeepSeekProvider(settings: AppSettings): boolean {
  return settings.provider === 'deepseek'
}

function isClaudeModel(settings: AppSettings): boolean {
  const model = settings.model?.trim().toLowerCase() || ''
  return model.startsWith('claude')
}

export function providerSupportsNativeStructuredOutput(settings: AppSettings): boolean {
  if (settings.provider === 'anthropic') return isClaudeModel(settings)
  return isOfficialOpenAIProvider(settings)
}

function isOllamaProvider(settings: AppSettings): boolean {
  return settings.provider === 'ollama'
}

function createOpenAICompatibleProvider(settings: AppSettings) {
  const apiKey = settings.apiKey.trim()

  return createOpenAI({
    apiKey: apiKey || undefined,
    baseURL: settings.baseUrl || undefined,
    name: isOllamaProvider(settings) ? 'ollama' : undefined
  })
}

export function createModel(settings: AppSettings): LanguageModel {
  if (settings.provider === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl || undefined
    })
    return anthropic(settings.model)
  }

  const openai = createOpenAICompatibleProvider(settings)
  if (isOfficialOpenAIProvider(settings)) {
    return openai(settings.model)
  }

  return openai.chat(settings.model)
}

export function buildSystemPrompt(settings: AppSettings, systemPrompt: string) {
  if (settings.provider !== 'anthropic') {
    return systemPrompt
  }

  return {
    role: 'system' as const,
    content: systemPrompt,
    providerOptions: {
      anthropic: {
        cacheControl: ANTHROPIC_PROMPT_CACHE
      }
    }
  }
}

export function providerSupportsTools(settings: AppSettings): boolean {
  if (settings.provider === 'anthropic') return isClaudeModel(settings)
  if (isDeepSeekProvider(settings)) return false
  if (isOllamaProvider(settings)) return false
  return true
}
