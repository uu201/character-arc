import type { ControlledMcpTool } from '@shared/assistant-runtime'

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

const PROTOCOL_VERSION = '2024-11-05'
const CONNECT_TIMEOUT_MS = 12_000
const TOOL_TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 20_000

export function validateControlledMcpUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(String(rawUrl || '').trim())
  } catch {
    throw new Error('MCP URL 格式无效。')
  }
  if (url.username || url.password) throw new Error('MCP URL 不允许内嵌用户名或密码。')
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('远程 MCP 必须使用 HTTPS；本机服务只允许 localhost/127.0.0.1 的 HTTP。')
  }
  url.hash = ''
  return url.toString()
}

function parseSseResponse(raw: string, requestId: number): JsonRpcResponse {
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!data) continue
    try {
      const response = JSON.parse(data) as JsonRpcResponse
      if (response.id === requestId) return response
    } catch {
      // Ignore unrelated/non-JSON SSE events.
    }
  }
  throw new Error('MCP SSE 响应中没有匹配的 JSON-RPC 结果。')
}

function extractToolResult(result: unknown): string {
  const value = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  const content = Array.isArray(value.content) ? value.content : []
  const parts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const block = item as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'resource' && block.resource && typeof block.resource === 'object') {
      const resource = block.resource as Record<string, unknown>
      if (typeof resource.text === 'string') parts.push(resource.text)
    }
  }
  if (value.structuredContent && typeof value.structuredContent === 'object') {
    parts.push(JSON.stringify(value.structuredContent))
  }
  const text = parts.join('\n').trim().slice(0, MAX_OUTPUT_CHARS)
  if (value.isError === true) throw new Error(text || 'MCP 工具返回错误。')
  return text || '（MCP 工具返回空结果）'
}

export class ControlledHttpMcpClient {
  private readonly url: string
  private readonly apiKey: string
  private requestId = 0
  private sessionId = ''
  private initialized = false

  constructor(url: string, apiKey = '') {
    this.url = validateControlledMcpUrl(url)
    this.apiKey = apiKey
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.initialized) return
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'character-arc', version: '1.17.0' }
    }, CONNECT_TIMEOUT_MS, signal)
    await this.notify('notifications/initialized', {}, signal)
    this.initialized = true
  }

  async listTools(signal?: AbortSignal): Promise<ControlledMcpTool[]> {
    await this.connect(signal)
    const result = await this.request('tools/list', {}, TOOL_TIMEOUT_MS, signal)
    const value = result && typeof result === 'object' ? result as Record<string, unknown> : {}
    const tools = Array.isArray(value.tools) ? value.tools : []
    return tools.slice(0, 100).map((tool) => {
      const item = tool && typeof tool === 'object' ? tool as Record<string, unknown> : {}
      return {
        name: String(item.name ?? '').slice(0, 120),
        description: String(item.description ?? '').slice(0, 500) || undefined,
        inputSchema: item.inputSchema && typeof item.inputSchema === 'object'
          ? item.inputSchema as Record<string, unknown>
          : undefined
      }
    }).filter((tool) => tool.name)
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    await this.connect(signal)
    const serialized = JSON.stringify(args ?? {})
    if (serialized.length > 20_000) throw new Error('MCP 工具参数过大，请缩小输入范围。')
    const result = await this.request('tools/call', {
      name: String(name || '').slice(0, 120),
      arguments: args ?? {}
    }, TOOL_TIMEOUT_MS, signal)
    return extractToolResult(result)
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    return headers
  }

  private async notify(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, CONNECT_TIMEOUT_MS)
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
        redirect: 'error',
        signal: controller.signal
      })
      if (!response.ok && response.status !== 202 && response.status !== 204) {
        throw new Error(`MCP 初始化通知失败：HTTP ${response.status}`)
      }
    } catch (error) {
      if (controller.signal.aborted) {
        if (signal?.aborted) throw new Error('MCP 请求已取消。')
        throw new Error(`MCP 初始化通知超时（${CONNECT_TIMEOUT_MS}ms）。`)
      }
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): Promise<unknown> {
    const id = ++this.requestId
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    externalSignal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, timeoutMs)
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        redirect: 'error',
        signal: controller.signal
      })
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300)
        throw new Error(`MCP 请求失败：HTTP ${response.status}${detail ? ` · ${detail}` : ''}`)
      }
      const sessionId = response.headers.get('mcp-session-id')
      if (sessionId) this.sessionId = sessionId
      const contentType = response.headers.get('content-type') ?? ''
      const rpc = contentType.includes('text/event-stream')
        ? parseSseResponse(await response.text(), id)
        : await response.json() as JsonRpcResponse
      if (rpc.error) throw new Error(rpc.error.message || `MCP 错误 ${rpc.error.code ?? ''}`)
      return rpc.result
    } catch (error) {
      if (controller.signal.aborted) {
        if (externalSignal?.aborted) throw new Error('MCP 请求已取消。')
        throw new Error(`MCP 请求超时（${timeoutMs}ms）。`)
      }
      throw error
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', abort)
    }
  }
}
