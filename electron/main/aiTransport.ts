import type { AiStreamHandlers, AiTaskPayload, AppSettings, PromptPair } from './aiShared'
import { AI_REQUEST_TIMEOUT_MS, resolveMaxTokens } from './aiShared'

/**
 * 从 HTTP 错误响应中提取可读的错误信息。
 * 优先从 JSON body 的 error.message / error.error / message 字段读取，失败时使用默认文案。
 */
async function readErrorMessage(response: Response, fallbackLabel: string): Promise<string> {
  const fallback = `${fallbackLabel} 请求失败：${response.status} ${response.statusText}`

  try {
    const data = (await response.json()) as Record<string, unknown>
    const error = (data.error ?? data) as Record<string, unknown>
    const message =
      (typeof error.message === 'string' && error.message) ||
      (typeof error.error === 'string' && error.error) ||
      (typeof data.message === 'string' && data.message)

    return message ? `${fallbackLabel} 请求失败：${message}` : fallback
  } catch {
    return fallback
  }
}

/**
 * 执行一次带超时控制的 AI HTTP 请求。
 * 超时时间由 AI_REQUEST_TIMEOUT_MS（60s）决定，超时后抛出中文超时错误。
 */
async function performAiRequest(url: string, init: RequestInit, providerLabel: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, providerLabel))
    }

    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${providerLabel} 请求超时，请检查网络、代理或模型服务状态。`)
    }

    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 向 OpenAI 兼容接口发送非流式聊天补全请求。
 * 适用于 DeepSeek、Qwen、Moonshot、SiliconFlow、Ollama、new-api/one-api 等供应商。
 * 返回模型生成的纯文本内容。
 */
async function requestOpenAiCompatible(
  settings: AppSettings,
  prompt: PromptPair,
  task?: AiTaskPayload
): Promise<string> {
  const response = await performAiRequest(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.8,
      ...(resolveMaxTokens(task) ? { max_tokens: resolveMaxTokens(task) } : {}),
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ]
    })
  }, 'OpenAI 兼容接口')

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('AI 返回内容为空')
  }

  return content
}

/**
 * 向 Anthropic Messages API 发送非流式请求。
 * 使用 x-api-key 头部鉴权，遵循 Anthropic 2023-06-01 API 版本。
 */
async function requestAnthropic(settings: AppSettings, prompt: PromptPair, task?: AiTaskPayload): Promise<string> {
  const response = await performAiRequest(`${settings.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: resolveMaxTokens(task) ?? 600,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }]
    })
  }, 'Anthropic')

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }

  const content = data.content?.find((item) => item.type === 'text')?.text
  if (!content) {
    throw new Error('Anthropic 返回内容为空')
  }

  return content
}

/**
 * 从 OpenAI 兼容流式 SSE 数据块中提取增量文本。
 * 处理两种格式：choices[0].delta.content 为字符串或 content_parts 数组。
 */
function extractOpenAiCompatibleDelta(payload: Record<string, unknown>): string {
  const choice = Array.isArray(payload.choices) ? (payload.choices[0] as Record<string, unknown> | undefined) : undefined
  const delta = choice?.delta as Record<string, unknown> | string[] | string | undefined

  // 标准格式：delta.content 为字符串
  if (typeof (delta as Record<string, unknown> | undefined)?.content === 'string') {
    return String((delta as Record<string, unknown>).content)
  }

  // 部分供应商（如某些代理网关）返回 content_parts 数组格式
  const contentParts = (delta as Record<string, unknown> | undefined)?.content
  if (Array.isArray(contentParts)) {
    return contentParts
      .map((part) => {
        const record = part as Record<string, unknown>
        if (typeof record.text === 'string') {
          return record.text
        }

        return typeof record.content === 'string' ? record.content : ''
      })
      .join('')
  }

  return ''
}

/**
 * 从 Anthropic 流式 SSE 事件中提取增量文本。
 * 仅处理 content_block_delta 类型事件，提取 delta.text 字段。
 */
function extractAnthropicDelta(eventName: string, payload: Record<string, unknown>): string {
  const payloadType = String(payload.type ?? '')
  if (eventName === 'content_block_delta' || payloadType === 'content_block_delta') {
    const delta = payload.delta as Record<string, unknown> | undefined
    return typeof delta?.text === 'string' ? delta.text : ''
  }

  return ''
}

/**
 * 消费 SSE（Server-Sent Events）流式响应。
 * 按照 SSE 协议解析 event: 和 data: 行，遇到 \n\n 分隔符时触发回调。
 * 流结束时处理残留在 buffer 中的最后一条事件。
 */
async function consumeSseResponse(
  response: Response,
  onEvent: (eventName: string, data: string) => void | Promise<void>
): Promise<void> {
  if (!response.body) {
    throw new Error('模型响应不支持流式读取。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

    // 按 SSE 协议：两条换行符分隔一个完整事件
    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex >= 0) {
      const rawEvent = buffer.slice(0, separatorIndex).trim()
      buffer = buffer.slice(separatorIndex + 2)

      if (rawEvent) {
        let eventName = 'message'
        const dataLines: string[] = []

        for (const line of rawEvent.split(/\r?\n/)) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() || eventName
            continue
          }

          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }

        await onEvent(eventName, dataLines.join('\n'))
      }

      separatorIndex = buffer.indexOf('\n\n')
    }

    if (done) {
      // 处理流结束后 buffer 中的残留事件
      const trailingEvent = buffer.trim()
      if (trailingEvent) {
        let eventName = 'message'
        const dataLines: string[] = []

        for (const line of trailingEvent.split(/\r?\n/)) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() || eventName
            continue
          }

          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }

        await onEvent(eventName, dataLines.join('\n'))
      }

      break
    }
  }
}

/**
 * 向 OpenAI 兼容接口发送流式聊天补全请求。
 * 通过 stream: true 开启 SSE，逐块解析 delta 并通过 handlers.onTextDelta 推送到 UI。
 * 返回拼接后的完整文本。
 */
async function requestOpenAiCompatibleStream(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  task?: AiTaskPayload
): Promise<string> {
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.8,
      stream: true,
      ...(resolveMaxTokens(task) ? { max_tokens: resolveMaxTokens(task) } : {}),
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ]
    })
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'OpenAI 兼容接口'))
  }

  let content = ''
  await consumeSseResponse(response, (_eventName, data) => {
    if (!data || data === '[DONE]') {
      return
    }

    const payload = JSON.parse(data) as Record<string, unknown>
    const delta = extractOpenAiCompatibleDelta(payload)
    if (!delta) {
      return
    }

    content += delta
    handlers.onTextDelta(delta)
  })

  return content
}

/**
 * 向 Anthropic Messages API 发送流式请求。
 * 使用 stream: true 开启 SSE，仅处理 content_block_delta 事件中的文本增量。
 */
async function requestAnthropicStream(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  task?: AiTaskPayload
): Promise<string> {
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01'
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      max_tokens: resolveMaxTokens(task) ?? 600,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }]
    })
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Anthropic'))
  }

  let content = ''
  await consumeSseResponse(response, (eventName, data) => {
    if (!data) {
      return
    }

    const payload = JSON.parse(data) as Record<string, unknown>
    const delta = extractAnthropicDelta(eventName, payload)
    if (!delta) {
      return
    }

    content += delta
    handlers.onTextDelta(delta)
  })

  return content
}

/** 发送非流式 AI 文本请求，自动根据 provider 分派到 OpenAI 兼容或 Anthropic 接口 */
export async function requestAiText(settings: AppSettings, prompt: PromptPair, task?: AiTaskPayload): Promise<string> {
  return settings.provider === 'anthropic'
    ? requestAnthropic(settings, prompt, task)
    : requestOpenAiCompatible(settings, prompt, task)
}

/** 发送流式 AI 文本请求，自动根据 provider 分派；通过 handlers 实时接收增量文本 */
export async function requestAiTextStream(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  task?: AiTaskPayload
): Promise<string> {
  return settings.provider === 'anthropic'
    ? requestAnthropicStream(settings, prompt, handlers, signal, task)
    : requestOpenAiCompatibleStream(settings, prompt, handlers, signal, task)
}
