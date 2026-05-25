import type { AppSettings } from '@/types/app'

export interface ProviderPreset {
  label: string
  value: string
  model: string
  baseUrl: string
  hint: string
}

export const providerPresets: ProviderPreset[] = [
  { label: 'OpenAI 兼容协议', value: 'openai-compatible', model: '', baseUrl: '', hint: '适用于 DeepSeek、通义千问、OpenAI、Moonshot、智谱、SiliconFlow、Ollama、New API 等。只需填域名或路径前缀（如 https://api.deepseek.com），系统自动补全 /v1。' },
  { label: 'Anthropic 协议', value: 'anthropic', model: '', baseUrl: '', hint: '适用于 Anthropic 官方及 Claude 中转站。只需填域名或路径前缀（如 https://api.anthropic.com 或 https://xxx.com/anthropic），系统自动补全 /v1。' }
]

export const providerOptions = providerPresets.map(({ label, value }) => ({ label, value }))

export function getProviderPreset(provider: string): ProviderPreset {
  return providerPresets.find((item) => item.value === provider) ?? providerPresets[0]
}

export function resolveProviderDefaults(provider: string): Pick<AppSettings, 'model' | 'baseUrl'> {
  const preset = getProviderPreset(provider)
  return {
    model: preset.model,
    baseUrl: preset.baseUrl
  }
}
