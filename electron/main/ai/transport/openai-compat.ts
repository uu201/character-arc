import type { AppSettings, AiStreamHandlers, PromptPair } from '../shared-types'
import type { StructuredOutputOptions } from './index'
import type {
  AgentMessage,
  AgentRequestParams,
  AgentResponse,
  AgentStopReason,
  AssistantContentBlock,
  AssistantToolUseBlock,
  ToolDefinition,
  ToolResultBlock
} from '../agent/tools/types'
import { performAiRequest, readErrorMessage } from './http'
import { consumeSseResponse, extractOpenAiCompatibleDelta } from './sse'

const MAX_TOKENS_RETRY_CAP = 16000

type SingleShotOutcome =
  | { ok: true; content: string }
  | { ok: false; retryableLength: boolean; error: Error }

async function runOpenAiCompatibleAttempt(
  settings: AppSettings,
  prompt: PromptPair,
  maxTokens: number | undefined,
  structured: StructuredOutputOptions | undefined,
  signal: AbortSignal | undefined
): Promise<SingleShotOutcome> {
  const body: Record<string, unknown> = {
    model: settings.model,
    temperature: 0.8,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ]
  }
  if (maxTokens) body.max_tokens = maxTokens
  if (structured?.mode === 'json_object') {
    body.response_format = { type: 'json_object' }
  }
  const response = await performAiRequest(
    `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
      },
      body: JSON.stringify(body)
    },
    'OpenAI 兼容接口',
    signal
  )
  const data = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string
      message?: { content?: string | null; refusal?: string | null }
    }>
    error?: { message?: string }
  }
  if (data.error?.message) {
    return { ok: false, retryableLength: false, error: new Error(`AI 接口错误：${data.error.message}`) }
  }
  const choice = data.choices?.[0]
  const content = choice?.message?.content
  if (!content) {
    if (choice?.finish_reason === 'content_filter') {
      return { ok: false, retryableLength: false, error: new Error('AI 返回内容为空：内容被安全过滤器拦截，请检查输入内容或更换模型。') }
    }
    if (choice?.finish_reason === 'length') {
      return {
        ok: false,
        retryableLength: true,
        error: new Error('AI 返回内容为空：输出被截断（max_tokens 不足或上下文超限），请尝试缩短输入或更换支持更长上下文的模型。')
      }
    }
    if (choice?.message?.refusal) {
      return { ok: false, retryableLength: false, error: new Error(`AI 拒绝生成：${choice.message.refusal}`) }
    }
    return { ok: false, retryableLength: false, error: new Error('AI 返回内容为空，请检查模型是否正常、输入是否过长，或稍后重试。') }
  }
  return { ok: true, content }
}

export async function requestOpenAiCompatible(
  settings: AppSettings,
  prompt: PromptPair,
  maxTokens?: number,
  structured?: StructuredOutputOptions,
  signal?: AbortSignal
): Promise<string> {
  const first = await runOpenAiCompatibleAttempt(settings, prompt, maxTokens, structured, signal)
  if (first.ok) return first.content
  if (!first.retryableLength || !maxTokens) throw first.error
  const retryBudget = Math.min(maxTokens * 2, MAX_TOKENS_RETRY_CAP)
  if (retryBudget <= maxTokens) throw first.error
  const second = await runOpenAiCompatibleAttempt(settings, prompt, retryBudget, structured, signal)
  if (second.ok) return second.content
  throw second.error
}

export async function requestOpenAiCompatibleStream(
  settings: AppSettings,
  prompt: PromptPair,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
  maxTokens?: number
): Promise<string> {
  const timeoutCtl = new AbortController()
  const timeoutId = setTimeout(() => timeoutCtl.abort(), 180_000)
  const combinedSignal = AbortSignal.any([signal, timeoutCtl.signal])

  try {
    const response = await fetch(
      `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
        },
        signal: combinedSignal,
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.8,
          stream: true,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ]
        })
      }
    )
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'OpenAI 兼容接口'))
    }
    let content = ''
    await consumeSseResponse(response, (_eventName, data) => {
      if (!data || data === '[DONE]') return
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(data) as Record<string, unknown>
      } catch {
        return
      }
      const delta = extractOpenAiCompatibleDelta(payload)
      if (!delta) return
      content += delta
      handlers.onTextDelta(delta)
    })
    return content
  } finally {
    clearTimeout(timeoutId)
  }
}

// ---------------------------------------------------------------------------
// Tool-aware (agentic) request — non-streaming.
// Translates AgentMessage[] / ToolDefinition[] to Chat Completions `tools` /
// `tool_calls` and translates the response back into provider-neutral blocks.
// ---------------------------------------------------------------------------

export async function requestOpenAiCompatibleWithTools(
  settings: AppSettings,
  params: AgentRequestParams,
  signal?: AbortSignal
): Promise<AgentResponse> {
  const body: Record<string, unknown> = {
    model: settings.model,
    temperature: 0.8,
    messages: [
      { role: 'system', content: params.system },
      ...params.messages.flatMap(toOpenAiMessages)
    ],
    tools: params.tools.map(toOpenAiTool),
    tool_choice: 'auto'
  }
  if (params.maxTokens) body.max_tokens = params.maxTokens

  const response = await performAiRequest(
    `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
      },
      body: JSON.stringify(body)
    },
    'OpenAI 兼容接口',
    signal
  )

  const data = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string
      message?: {
        content?: string | null
        reasoning_content?: string | null
        tool_calls?: Array<{
          id?: string
          type?: string
          function?: { name?: string; arguments?: string }
        }>
      }
    }>
  }
  const choice = data.choices?.[0]
  const message = choice?.message ?? {}
  const blocks: AssistantContentBlock[] = []

  if (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0) {
    blocks.push({ type: 'reasoning', reasoning: message.reasoning_content })
  }
  if (typeof message.content === 'string' && message.content.length > 0) {
    blocks.push({ type: 'text', text: message.content })
  }
  for (const call of message.tool_calls ?? []) {
    const block = fromOpenAiToolCall(call)
    if (block) blocks.push(block)
  }

  return {
    stopReason: mapOpenAiFinishReason(choice?.finish_reason),
    contentBlocks: blocks
  }
}

function toOpenAiTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }
}

function toOpenAiMessages(message: AgentMessage): Array<Record<string, unknown>> {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ role: 'user', content: message.content }]
    }
    // tool results — emit one `tool` message per result
    return message.content.map((block: ToolResultBlock) => ({
      role: 'tool',
      tool_call_id: block.toolUseId,
      content: block.content
    }))
  }
  // assistant
  const text = message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const reasoning = message.content
    .filter((b): b is { type: 'reasoning'; reasoning: string } => b.type === 'reasoning')
    .map((b) => b.reasoning)
    .join('')
  const toolCalls = message.content
    .filter((b): b is AssistantToolUseBlock => b.type === 'tool_use')
    .map((b) => ({
      id: b.id,
      type: 'function' as const,
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }
    }))
  const out: Record<string, unknown> = { role: 'assistant' }
  out.content = text || null
  if (reasoning) out.reasoning_content = reasoning
  if (toolCalls.length > 0) out.tool_calls = toolCalls
  return [out]
}

function fromOpenAiToolCall(call: {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}): AssistantToolUseBlock | null {
  if (!call?.id || !call.function?.name) return null
  let input: Record<string, unknown> = {}
  if (typeof call.function.arguments === 'string' && call.function.arguments.trim().length > 0) {
    try {
      input = JSON.parse(call.function.arguments) as Record<string, unknown>
    } catch {
      input = { _raw: call.function.arguments }
    }
  }
  return { type: 'tool_use', id: call.id, name: call.function.name, input }
}

function mapOpenAiFinishReason(reason: string | undefined): AgentStopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    default:
      return 'other'
  }
}
