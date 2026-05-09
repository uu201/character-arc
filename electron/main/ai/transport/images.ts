import type { AppSettings } from '../shared-types'
import { performAiRequest } from './http'

export type GeneratedImageResult = {
  dataUrl: string
  revisedPrompt?: string
}

function normalizeImageSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    model: settings.imageModel?.trim() || '',
    apiKey: settings.imageApiKey?.trim() || '',
    baseUrl: settings.imageBaseUrl?.trim() || ''
  }
}

function inferMimeType(base64: string): string {
  if (base64.startsWith('/9j/')) {
    return 'image/jpeg'
  }

  if (base64.startsWith('UklGR')) {
    return 'image/webp'
  }

  return 'image/png'
}

export async function generateImage(settings: AppSettings, prompt: string): Promise<GeneratedImageResult> {
  const normalized = normalizeImageSettings(settings)
  if (!normalized.model.trim()) {
    throw new Error('请先在设置中填写专用的图片生成模型（不会自动回退到文本模型）。')
  }
  if (!normalized.baseUrl.trim()) {
    throw new Error('请先在设置中填写专用的图片生成 Base URL。')
  }
  if (!normalized.apiKey.trim()) {
    throw new Error('请先在设置中填写专用的图片生成 API Key。')
  }

  const response = await performAiRequest(
    `${normalized.baseUrl.replace(/\/$/, '')}/images/generations`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalized.apiKey}`
      },
      body: JSON.stringify({
        model: normalized.model,
        prompt,
        size: '1024x1536',
        response_format: 'b64_json'
      })
    },
    '图片生成接口'
  )

  const data = (await response.json()) as {
    data?: Array<{
      b64_json?: string
      revised_prompt?: string
      url?: string
    }>
  }
  const first = data.data?.[0]
  if (!first) {
    throw new Error('图片生成成功，但没有返回图片数据。')
  }

  if (first.b64_json?.trim()) {
    const base64 = first.b64_json.trim()
    return {
      dataUrl: `data:${inferMimeType(base64)};base64,${base64}`,
      revisedPrompt: first.revised_prompt?.trim() || undefined
    }
  }

  if (first.url?.trim()) {
    return {
      dataUrl: first.url.trim(),
      revisedPrompt: first.revised_prompt?.trim() || undefined
    }
  }

  throw new Error('图片生成成功，但返回结果中没有可用图片。')
}
